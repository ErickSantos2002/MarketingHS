"""Cadastro dos sites de fora que usam o `rastreio.js` (prova do RD, 21/10).

Um site = nome, domínios permitidos, token público (`pub_…`), mapa de campos
e tags aplicadas na captura. O token vai no snippet colado no `<head>` do
site; ele não é segredo, mas também só vale com `Origin` de um dos domínios
(`routers/rastreio.py`).

⚠️ `sites` é admin-only no RLS (migration 027): `admin_atual` +
`sessao(role="authenticated", …)`, como `paginas.py` — senão o não-admin
veria a lista vazia e acharia que não há site cadastrado.

Sem DELETE de propósito: desligar é `ativo = false`. Apagar um site com
visitas esbarra no CHECK `visitas_com_origem` (a FK é ON DELETE SET NULL e a
visita precisa de site OU página) — ver a pergunta no arquivo da frente.
"""

import re
import secrets
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.captura.campos import CHAVE_EXTRA
from app.database import sessao
from app.dependencies import Usuario, admin_atual

router = APIRouter(prefix="/sites", tags=["sites"])

COLUNAS = """id::text, nome, dominios, token, mapa_campos, tags, ativo,
             criado_em::text, atualizado_em::text"""

_DOMINIO = re.compile(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$")
_NOME_DE_CAMPO = re.compile(r"^[A-Za-z0-9_\-\[\].]{1,100}$")


def normalizar_dominio(valor: str) -> str:
    """Minúsculo, sem esquema nem caminho: `https://Www.X.com/a` →
    `www.x.com`. Porta fica (`localhost:8099`)."""
    bruto = (valor or "").strip().lower()
    if "://" not in bruto:
        bruto = "//" + bruto
    try:
        partes = urlsplit(bruto)
        host = partes.hostname or ""
        porta = partes.port
    except ValueError:
        raise ValueError(f"domínio inválido: {valor!r}")
    dominio = f"{host}:{porta}" if porta else host
    if not _DOMINIO.match(dominio):
        raise ValueError(f"domínio inválido: {valor!r}")
    return dominio


def _dominios(valor):
    if valor is None:
        return valor
    saida = []
    for d in valor:
        n = normalizar_dominio(d)
        if n not in saida:
            saida.append(n)
    return saida


def _mapa(valor):
    if valor is None:
        return valor
    for nome, destino in valor.items():
        if not _NOME_DE_CAMPO.match(nome):
            raise ValueError(f"nome de campo inválido: {nome!r}")
        if destino != "email" and not CHAVE_EXTRA.match(destino):
            raise ValueError(f"destino inválido para {nome!r}: {destino!r}")
    return valor


def _tags(valor):
    if valor is None:
        return valor
    return list(dict.fromkeys(t.strip().lower() for t in valor if t.strip()))


class _Validacoes(BaseModel):
    """Os validadores dos dois corpos (os campos são declarados em cada um)."""

    @field_validator("dominios", check_fields=False)
    @classmethod
    def _v_dominios(cls, v):
        return _dominios(v)

    @field_validator("mapa_campos", check_fields=False)
    @classmethod
    def _v_mapa(cls, v):
        return _mapa(v)

    @field_validator("tags", check_fields=False)
    @classmethod
    def _v_tags(cls, v):
        return _tags(v)


class SiteIn(_Validacoes):
    nome: str = Field(min_length=1, max_length=200)
    dominios: list[str] = Field(min_length=1, max_length=20)
    mapa_campos: dict[str, str] = Field(default_factory=dict, max_length=100)
    tags: list[str] = Field(default_factory=list, max_length=20)


class SitePatch(_Validacoes):
    nome: str | None = Field(default=None, min_length=1, max_length=200)
    dominios: list[str] | None = Field(default=None, min_length=1, max_length=20)
    mapa_campos: dict[str, str] | None = Field(default=None, max_length=100)
    tags: list[str] | None = Field(default=None, max_length=20)
    ativo: bool | None = None


def _novo_token() -> str:
    return "pub_" + secrets.token_urlsafe(24)


def _esquecer_caches() -> None:
    """Token rotacionado ou site desligado vale na hora neste processo."""
    from app.middleware import cors_sites
    from app.routers import rastreio
    rastreio._limpar_cache()
    cors_sites._limpar_cache()


@router.get("")
async def listar(usuario: Usuario = Depends(admin_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(f"SELECT {COLUNAS} FROM sites ORDER BY criado_em")
    return [dict(l) for l in linhas]


@router.post("", status_code=status.HTTP_201_CREATED)
async def criar(dados: SiteIn, usuario: Usuario = Depends(admin_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            f"""INSERT INTO sites (nome, dominios, token, mapa_campos, tags)
                VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING {COLUNAS}""",
            dados.nome.strip(), dados.dominios, _novo_token(), dados.mapa_campos,
            dados.tags)
    _esquecer_caches()
    return dict(linha)


@router.patch("/{site_id}")
async def atualizar(site_id: UUID, dados: SitePatch, usuario: Usuario = Depends(admin_atual)):
    """⚠️ Os nomes de coluna saem das chaves DECLARADAS em `SitePatch`, nunca
    do corpo (molde de `paginas.py`)."""
    campos = dados.model_dump(exclude_unset=True)
    campos = {k: v for k, v in campos.items() if v is not None}
    if not campos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nada para atualizar.")
    casts = {"mapa_campos": "::jsonb"}
    atribuicoes = ", ".join(f"{nome} = ${i}{casts.get(nome, '')}"
                            for i, nome in enumerate(campos, start=2))
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            f"""UPDATE sites SET {atribuicoes}, atualizado_em = now()
                 WHERE id = $1::uuid RETURNING {COLUNAS}""",
            str(site_id), *campos.values())
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site não encontrado.")
    _esquecer_caches()
    return dict(linha)


@router.post("/{site_id}/token")
async def rotacionar_token(site_id: UUID, usuario: Usuario = Depends(admin_atual)):
    """Token novo; o antigo deixa de valer (neste processo na hora; nos
    outros, em até 60 s do cache). O snippet do site precisa ser trocado."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            f"""UPDATE sites SET token = $2, atualizado_em = now()
                 WHERE id = $1::uuid RETURNING {COLUNAS}""",
            str(site_id), _novo_token())
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site não encontrado.")
    _esquecer_caches()
    return dict(linha)
