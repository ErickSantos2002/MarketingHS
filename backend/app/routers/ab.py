"""O módulo de teste A/B no admin — o que as telas de Experiments faziam
direto no banco, pelo alias `const db = supabase as any`.

⚠️ As cinco tabelas `ab_*` são admin-only por RLS (`has_role(auth.uid(),
'admin')`, `001_schema_origem.sql:4673-4715`). Por isso toda rota é
`admin_atual` — um autenticado sem o papel levaria zero linhas, não erro — e
roda em `sessao(role="authenticated", user_id=...)`, que é o que põe o id em
`auth.uid()`. `ab_activate_test` confere o mesmo papel por dentro.
"""

import re
from typing import Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.ab.dominio import normalizar_dominio
from app.database import sessao
from app.dependencies import Usuario, admin_atual

router = APIRouter(prefix="/ab", tags=["ab"])

# Teto de `/eventos`. A origem paginava de 1000 em 1000 até 20.000
# (`useAbEvents`); o lote 6 já cortou um teto desses para 500 sem perceber.
# 20.000 fica, e a rota AVISA quando bate — padrão de `/painel/agendamentos`.
TETO_EVENTOS = 20000

_COLUNAS_TESTE = """id::text, slug, public_slug, name, hypothesis, status,
    variants, control_variant, winner_variant, primary_metric, guardrail_metric,
    target_sample_per_variant, starts_at::text, ends_at::text,
    created_at::text, updated_at::text"""

_COLUNAS_EVENTO = """id::text, ab_test, ab_var, ab_vid, event_type, event_name,
    occurred_at::text, page_slug, url, referrer, utm_source, utm_medium,
    utm_campaign, utm_term, utm_content, gclid, fbclid, ttclid, msclkid,
    device_type, browser, os, language, screen_resolution, metadata"""

# O `PUBLIC_SLUG_RE` de `useAbTests.tsx` — o endereço que vai no anúncio.
SLUG_PUBLICO = r"^[a-z0-9]+(-[a-z0-9]+)*$"

# Teto de `integer` no Postgres (M2) — acima disso o asyncpg levanta
# `DataError` ao codificar o parâmetro, e isso não deveria precisar de um
# round-trip pro banco pra virar 422.
INT32_MAX = 2147483647


class VarianteIn(BaseModel):
    key: str = Field(min_length=1, max_length=40)
    url: str = Field(min_length=1, max_length=2000)
    weight: float = 0
    label: str | None = Field(default=None, max_length=200)


class TesteIn(BaseModel):
    # M1: `slug` vira nome de cookie (`ab_{slug}`) em `Set-Cookie` no
    # redirecionador — `;`, espaço ou CR/LF ali é injeção de atributo de
    # cookie, ou 500 fora do try de `redirecionar`. Mesmo padrão do
    # `public_slug` — compatível com o `internalSlug` do frontend
    # (`{publicSlugify}-{4 chars base36}`).
    slug: str = Field(min_length=1, max_length=200, pattern=SLUG_PUBLICO)
    public_slug: str = Field(pattern=SLUG_PUBLICO, max_length=80)
    name: str = Field(min_length=1, max_length=200)
    hypothesis: str | None = None
    # ⚠️ Só nasce rascunho: `running` passa pela ativação (decisão 9).
    status: Literal["draft"] = "draft"
    variants: list[VarianteIn] = Field(min_length=1, max_length=6)
    control_variant: str | None = None
    primary_metric: str = Field(default="lead_criado", min_length=1, max_length=80)
    guardrail_metric: str | None = Field(default="agendamento", max_length=80)
    target_sample_per_variant: int | None = Field(default=None, ge=0, le=INT32_MAX)
    # Texto: a tela manda `YYYY-MM-DD` do <input type="date">, e quem converte
    # é o Postgres (`::text::timestamptz`) — asyncpg recusa str em timestamptz.
    starts_at: str | None = None
    ends_at: str | None = None


class TestePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    hypothesis: str | None = None
    status: Literal["draft", "paused", "completed", "archived"] | None = None
    variants: list[VarianteIn] | None = Field(default=None, min_length=1, max_length=6)
    control_variant: str | None = None
    winner_variant: str | None = None
    primary_metric: str | None = Field(default=None, min_length=1, max_length=80)
    guardrail_metric: str | None = Field(default=None, max_length=80)
    target_sample_per_variant: int | None = Field(default=None, ge=0, le=INT32_MAX)
    starts_at: str | None = None
    ends_at: str | None = None


# Colunas NOT NULL de `ab_tests` que o PATCH alcança: nulo explícito é 422,
# não NotNullViolation (500).
_NAO_NULOS = {"name", "status", "variants", "primary_metric"}
_CONVERSOES = {"variants": "::jsonb", "starts_at": "::text::timestamptz",
               "ends_at": "::text::timestamptz"}


class AtivacaoIn(BaseModel):
    force: bool = False


def _data_invalida() -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                         "Data inválida — use AAAA-MM-DD ou ISO 8601.")


class ConfigAbIn(BaseModel):
    production_domain: str | None = None
    redirector_base: str | None = None

    @field_validator("redirector_base")
    @classmethod
    def _endereco_completo(cls, valor):
        """Vazio apaga; o resto precisa do protocolo — é o que monta o link
        que o time cola no anúncio."""
        if valor is None or not valor.strip():
            return None
        valor = valor.strip().rstrip("/")
        if not re.match(r"^https?://[^/\s]+", valor, re.I):
            raise ValueError("use o endereço completo, com https://")
        return valor


@router.get("/config")
async def ler_config(usuario: Usuario = Depends(admin_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            "SELECT production_domain, redirector_base FROM ab_config LIMIT 1")
    if linha is None:
        return {"production_domain": None, "redirector_base": None}
    return dict(linha)


@router.put("/config")
async def gravar_config(dados: ConfigAbIn, usuario: Usuario = Depends(admin_atual)):
    """Grava só o que veio. A tabela é uma linha só (índice em `(true)`,
    migration 017), e é ele o alvo do ON CONFLICT."""
    enviados = dados.model_dump(exclude_unset=True)
    if "production_domain" in enviados:
        dominio = normalizar_dominio(enviados["production_domain"])
        if not dominio:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "Informe um domínio válido (ex.: exemplo.com.br).")
        enviados["production_domain"] = dominio
    if not enviados:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nada para gravar.")

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            """INSERT INTO ab_config (production_domain, redirector_base)
               VALUES ($1, $2)
               ON CONFLICT ((true)) DO UPDATE SET
                 production_domain = CASE WHEN $3 THEN EXCLUDED.production_domain
                                          ELSE ab_config.production_domain END,
                 redirector_base   = CASE WHEN $4 THEN EXCLUDED.redirector_base
                                          ELSE ab_config.redirector_base END
               RETURNING production_domain, redirector_base""",
            enviados.get("production_domain"), enviados.get("redirector_base"),
            "production_domain" in enviados, "redirector_base" in enviados)
    return dict(linha)


@router.get("/testes")
async def listar_testes(usuario: Usuario = Depends(admin_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            f"SELECT {_COLUNAS_TESTE} FROM ab_tests ORDER BY created_at DESC")
    return [dict(l) for l in linhas]


@router.get("/testes/{teste_id}")
async def obter_teste(teste_id: UUID, usuario: Usuario = Depends(admin_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            f"SELECT {_COLUNAS_TESTE} FROM ab_tests WHERE id = $1::uuid", str(teste_id))
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Teste não encontrado.")
    return dict(linha)


@router.post("/testes", status_code=status.HTTP_201_CREATED)
async def criar_teste(dados: TesteIn, usuario: Usuario = Depends(admin_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        try:
            linha = await conn.fetchrow(
                f"""INSERT INTO ab_tests
                        (slug, public_slug, name, hypothesis, status, variants,
                         control_variant, primary_metric, guardrail_metric,
                         target_sample_per_variant, starts_at, ends_at, created_by)
                    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10,
                            $11::text::timestamptz, $12::text::timestamptz, $13::uuid)
                    RETURNING {_COLUNAS_TESTE}""",
                dados.slug, dados.public_slug, dados.name, dados.hypothesis,
                dados.status, [v.model_dump() for v in dados.variants],
                dados.control_variant, dados.primary_metric, dados.guardrail_metric,
                dados.target_sample_per_variant, dados.starts_at, dados.ends_at,
                usuario.id)
        except asyncpg.UniqueViolationError:
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "Já existe um teste com essa chave interna.")
        except asyncpg.DataError:
            raise _data_invalida()
    return dict(linha)


@router.patch("/testes/{teste_id}")
async def editar_teste(teste_id: UUID, dados: TestePatch,
                       usuario: Usuario = Depends(admin_atual)):
    """Pausar, concluir (com a vencedora), arquivar, editar.

    ⚠️ `running` NÃO passa aqui (o `Literal` recusa com 422): ativar é
    `POST /ab/testes/{id}/ativar`, que é quem garante um teste rodando por slug.
    """
    enviados = dados.model_dump(exclude_unset=True)
    nulos = sorted(c for c in _NAO_NULOS if c in enviados and enviados[c] is None)
    if nulos:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"Estes campos não aceitam nulo: {', '.join(nulos)}.")
    if not enviados:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nada para alterar.")

    # Os nomes de coluna vêm dos campos de `TestePatch` — lista fechada.
    atribuicoes = ", ".join(f"{c} = ${i + 2}{_CONVERSOES.get(c, '')}"
                            for i, c in enumerate(enviados))
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        try:
            linha = await conn.fetchrow(
                f"UPDATE ab_tests SET {atribuicoes} WHERE id = $1::uuid "
                f"RETURNING {_COLUNAS_TESTE}", str(teste_id), *enviados.values())
        except asyncpg.DataError:
            raise _data_invalida()
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Teste não encontrado.")
    return dict(linha)


@router.post("/testes/{teste_id}/ativar")
async def ativar_teste(teste_id: UUID, dados: AtivacaoIn,
                       usuario: Usuario = Depends(admin_atual)):
    """A ativação é a RPC `ab_activate_test`, atômica: sem `force`, recusa e
    devolve quem já roda na slug; com `force`, conclui esse e ativa este na
    mesma transação."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        try:
            return await conn.fetchval("SELECT ab_activate_test($1::uuid, $2)",
                                       str(teste_id), dados.force)
        except asyncpg.UniqueViolationError:
            # Perdeu a corrida contra `uq_ab_tests_public_slug_running`.
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "Outro teste foi ativado nesta slug agora mesmo. "
                                "Recarregue a página.")
        except asyncpg.RaiseError as erro:
            if "test not found" in str(erro):
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Teste não encontrado.")
            raise


@router.get("/testes/{teste_id}/eventos")
async def eventos_do_teste(teste_id: UUID, usuario: Usuario = Depends(admin_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        slug = await conn.fetchval(
            "SELECT slug FROM ab_tests WHERE id = $1::uuid", str(teste_id))
        if slug is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Teste não encontrado.")
        total = await conn.fetchval(
            "SELECT count(*) FROM ab_events WHERE ab_test = $1", slug)
        linhas = await conn.fetch(
            f"""SELECT {_COLUNAS_EVENTO} FROM ab_events WHERE ab_test = $1
                 ORDER BY occurred_at DESC LIMIT $2""", slug, TETO_EVENTOS)
    return {"events": [dict(l) for l in linhas],
            "truncado": total > TETO_EVENTOS, "teto": TETO_EVENTOS}
