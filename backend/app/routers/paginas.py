"""Cadastro de páginas do admin.

⚠️ `pages` é admin-only por RLS — as quatro políticas são
`has_role(auth.uid(), 'admin')`, medido no banco em 08/09/2026. E `page_stats`
é view com `security_invoker=true`: a RLS de `pages` vale para QUEM CHAMA a
view, não para o dono dela.

Isso obriga as rotas a duas coisas ao mesmo tempo, e errar qualquer uma
devolve LISTA VAZIA SEM ERRO — não 403:

  1. `admin_atual`, não `usuario_atual`: um autenticado sem o papel veria zero
     páginas e concluiria que o cadastro está vazio;
  2. `sessao(role="authenticated", user_id=usuario.id)`, não o `anon` padrão:
     sob `anon` nem o admin enxerga.

Mesma decisão de `painel.py` e das nove rotas de `ia.py`.

⚠️ A tabela está VAZIA (0 linhas em 08/09/2026). Rota devolvendo `[]` aqui é
o estado correto do sistema, não sintoma de permissão errada — as landings da
dn.ia saíram no lote 0 e a landing da HS é de outro lote.
"""

from typing import Any

import asyncpg
from fastapi import APIRouter, Body, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, admin_atual

router = APIRouter(prefix="/paginas", tags=["paginas"])

# As duas listas fechadas do CHECK de `pages`, repetidas aqui para o 422 do
# FastAPI chegar antes da exceção do Postgres — mensagem melhor, mesma recusa.
TIPOS = "^(landing|thankyou|form|admin)$"
ESTADOS = "^(active|draft|inactive)$"

# A forma que o frontend tipa como `Page`. Fixa numa constante porque cinco
# rotas devolvem exatamente esta lista, e uma coluna a menos numa delas vira
# campo `undefined` na tela sem erro nenhum.
COLUNAS = """id::text, name, slug, component_name, page_type, status,
             description, webhook_url, whatsapp_group_url, meta_title,
             meta_description, config, template_base,
             created_at::text, updated_at::text"""


class PaginaIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    slug: str = Field(min_length=1, max_length=200)
    component_name: str = Field(min_length=1, max_length=200)
    page_type: str = Field(pattern=TIPOS)
    status: str = Field(default="draft", pattern=ESTADOS)
    description: str | None = None
    webhook_url: str | None = None
    whatsapp_group_url: str | None = None
    meta_title: str | None = None
    meta_description: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)
    template_base: str | None = None


class PaginaPatch(BaseModel):
    """Todo campo opcional: o PATCH atualiza só o que veio.

    ⚠️ É esta classe que faz o `SET` do UPDATE ser seguro. Os nomes de coluna
    saem de `model_dump(exclude_unset=True)`, ou seja, das chaves DECLARADAS
    aqui — chave desconhecida no corpo o pydantic descarta antes. Nome de
    coluna nunca vem do corpo do request.
    """
    name: str | None = Field(default=None, min_length=1, max_length=200)
    slug: str | None = Field(default=None, min_length=1, max_length=200)
    component_name: str | None = Field(default=None, min_length=1, max_length=200)
    page_type: str | None = Field(default=None, pattern=TIPOS)
    status: str | None = Field(default=None, pattern=ESTADOS)
    description: str | None = None
    webhook_url: str | None = None
    whatsapp_group_url: str | None = None
    meta_title: str | None = None
    meta_description: str | None = None
    config: dict[str, Any] | None = None
    template_base: str | None = None


@router.get("")
async def listar(usuario: Usuario = Depends(admin_atual)):
    """As linhas cheias, na ordem que a tela espera (`created_at ASC`)."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            f"SELECT {COLUNAS} FROM pages ORDER BY created_at ASC")
    return [dict(l) for l in linhas]


@router.get("/estatisticas")
async def estatisticas(usuario: Usuario = Depends(admin_atual)):
    """A view `page_stats`, que é o que a TABELA da tela mostra.

    ⚠️ Esta rota precisa ser declarada ANTES de qualquer `GET /{algo}` neste
    router, senão `estatisticas` é lido como id. Hoje não há GET por id, mas
    quem adicionar um precisa pôr abaixo desta.

    ⚠️ `page_stats` conta lead por `lead_conversions.page_slug`. A rota
    pública `/publico/paginas` conta por `leads.source = slug` — duas
    definições de "lead da página" no mesmo sistema. As duas são portadas como
    estão, de propósito: mudar qualquer uma alteraria número que alguém pode
    estar lendo. Está registrado como pergunta ao Erick no CONTINUAR-AQUI.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            """SELECT id::text, slug, name, status, config, template_base,
                      page_type, created_at::text, updated_at::text,
                      total_leads, hot_leads, last_lead_at::text
                 FROM page_stats
                ORDER BY created_at ASC""")
    return [dict(l) for l in linhas]


@router.post("", status_code=status.HTTP_201_CREATED)
async def criar(dados: PaginaIn, usuario: Usuario = Depends(admin_atual)):
    """⚠️ O gatilho `trg_sanitize_page_slug` pode reescrever o slug. Por isso o
    `RETURNING`: quem chama deve usar o slug DEVOLVIDO, não o que mandou."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        try:
            linha = await conn.fetchrow(
                f"""INSERT INTO pages (name, slug, component_name, page_type,
                                       status, description, webhook_url,
                                       whatsapp_group_url, meta_title,
                                       meta_description, config, template_base)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                 RETURNING {COLUNAS}""",
                dados.name, dados.slug, dados.component_name, dados.page_type,
                dados.status, dados.description, dados.webhook_url,
                dados.whatsapp_group_url, dados.meta_title,
                dados.meta_description, dados.config, dados.template_base)
        except asyncpg.UniqueViolationError:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Já existe uma página com o slug '{dados.slug}'.")
    return dict(linha)


@router.patch("/{pagina_id}")
async def atualizar(pagina_id: str, dados: PaginaPatch,
                    usuario: Usuario = Depends(admin_atual)):
    campos = dados.model_dump(exclude_unset=True)
    if not campos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nada para atualizar.")
    atribuicoes = ", ".join(
        f"{nome} = ${i}" for i, nome in enumerate(campos, start=2))
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        try:
            linha = await conn.fetchrow(
                f"""UPDATE pages SET {atribuicoes}
                     WHERE id = $1::uuid
                 RETURNING {COLUNAS}""",
                pagina_id, *campos.values())
        except asyncpg.UniqueViolationError:
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "Já existe uma página com esse slug.")
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Página não encontrada.")
    return dict(linha)


@router.patch("/por-slug/{slug}/config")
async def atualizar_config(slug: str,
                           config: dict[str, Any] = Body(...),
                           usuario: Usuario = Depends(admin_atual)):
    """SUBSTITUI o `config` inteiro — não funde.

    ⚠️ É o comportamento do hook que esta rota substitui
    (`supabase.from('pages').update({ config }).eq('slug', slug)`), e é o que o
    `UTMPresetsModal` espera: ele monta o objeto completo e manda. A rota
    PÚBLICA `PATCH /publico/paginas/{slug}` funde, porque a function que ela
    substitui fundia. As duas semânticas são preservadas de propósito.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            f"UPDATE pages SET config = $2 WHERE slug = $1 RETURNING {COLUNAS}",
            slug, config)
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Página não encontrada.")
    return dict(linha)


@router.patch("/{pagina_id}/status")
async def alternar_status(pagina_id: str, usuario: Usuario = Depends(admin_atual)):
    """A inversão acontece no SQL, não no navegador.

    ⚠️ Mudança consciente em relação ao código herdado, registrada porque este
    projeto já perdeu capacidade em porte silencioso três vezes: o hook antigo
    lia `currentStatus` na tela, calculava o oposto e mandava o valor pronto.
    Duas abas abertas liam 'active' e as duas mandavam 'inactive' — a segunda
    desfazia nada. Aqui o banco lê e inverte na mesma instrução. A capacidade é
    a mesma; o que sai é a corrida.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        novo = await conn.fetchval(
            """UPDATE pages
                  SET status = CASE WHEN status = 'active'
                                    THEN 'inactive' ELSE 'active' END
                WHERE id = $1::uuid
            RETURNING status""",
            pagina_id)
    if novo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Página não encontrada.")
    return {"status": novo}


@router.delete("/{pagina_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir(pagina_id: str, usuario: Usuario = Depends(admin_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        resultado = await conn.execute(
            "DELETE FROM pages WHERE id = $1::uuid", pagina_id)
    if resultado == "DELETE 0":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Página não encontrada.")
