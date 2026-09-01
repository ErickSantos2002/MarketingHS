"""Templates de e-mail. Substitui a `templates-api`.

O `design` é o JSON do Unlayer e o `html` é o que ele exporta. Os dois andam
juntos: gravar um sem o outro deixa um template que abre no editor e sai
diferente no envio, ou que envia certo e não abre para editar.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, usuario_atual

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/templates", tags=["templates"])

COLUNAS = ("id::text, name, description, category, design, html, "
           "created_at::text, updated_at::text")


class TemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    category: str | None = None
    design: dict | None = None
    html: str | None = None


class TemplatePatch(BaseModel):
    # Tudo opcional: o editor grava só o que mudou.
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    category: str | None = None
    design: dict | None = None
    html: str | None = None


@router.get("")
async def listar(
    categoria: str | None = Query(None, alias="category"),
    pagina: int = Query(1, alias="page", ge=1),
    limite: int = Query(20, alias="limit", ge=1, le=100),
    _: Usuario = Depends(usuario_atual),
):
    """Lista paginada. O filtro vai por parâmetro, não concatenado na string."""
    async with sessao(role="service_role") as conn:
        total = await conn.fetchval(
            "SELECT count(*) FROM email_templates "
            "WHERE $1::text IS NULL OR category = $1", categoria)
        linhas = await conn.fetch(
            f"""SELECT {COLUNAS} FROM email_templates
                 WHERE $1::text IS NULL OR category = $1
                 ORDER BY updated_at DESC, id DESC
                 LIMIT $2 OFFSET $3""",
            categoria, limite, (pagina - 1) * limite)
    return {
        "data": [dict(l) for l in linhas],
        "pagination": {"page": pagina, "limit": limite, "total": total,
                       "pages": (total + limite - 1) // limite},
    }


@router.get("/{template_id}")
async def ler(template_id: str, _: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            f"SELECT {COLUNAS} FROM email_templates WHERE id = $1::uuid",
            template_id)
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Template não encontrado.")
    return dict(linha)


@router.post("", status_code=status.HTTP_201_CREATED)
async def criar(dados: TemplateIn, _: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            f"""INSERT INTO email_templates (name, description, category, design, html)
                VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING {COLUNAS}""",
            dados.name.strip(), dados.description, dados.category,
            dados.design, dados.html)
    return dict(linha)


@router.patch("/{template_id}")
async def editar(template_id: str, dados: TemplatePatch,
                 _: Usuario = Depends(usuario_atual)):
    """⚠️ PATCH de verdade: campo ausente NÃO vira NULL.

    `exclude_unset` separa "não mandou" de "mandou null". Sem isso, salvar só o
    nome apagaria o `design` e o `html` do template — e o editor gravaria uma
    casca por cima de um template pronto.
    """
    campos = dados.model_dump(exclude_unset=True)
    if not campos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nada a atualizar.")

    # Os nomes das colunas vêm do modelo, não da requisição — a lista é fechada.
    partes = []
    valores = []
    for i, (coluna, valor) in enumerate(campos.items(), start=2):
        cast = "::jsonb" if coluna == "design" else ""
        partes.append(f"{coluna} = ${i}{cast}")
        valores.append(valor)

    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            f"""UPDATE email_templates SET {', '.join(partes)}, updated_at = now()
                 WHERE id = $1::uuid RETURNING {COLUNAS}""",
            template_id, *valores)
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Template não encontrado.")
    return dict(linha)


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir(template_id: str, _: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        r = await conn.execute(
            "DELETE FROM email_templates WHERE id = $1::uuid", template_id)
    if r.endswith(" 0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Template não encontrado.")
