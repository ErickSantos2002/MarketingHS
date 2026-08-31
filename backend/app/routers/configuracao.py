"""Configuração do sistema. Tira do navegador o acesso direto a scoring_config
e a tags — dois dos 68 pontos que a spec mandou fechar."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.database import sessao
from app.dependencies import Usuario, admin_atual, usuario_atual

router = APIRouter(tags=["configuracao"])


class ScoringOut(BaseModel):
    criteria: dict
    thresholds: dict
    updated_at: str | None


class ScoringIn(BaseModel):
    criteria: dict
    thresholds: dict


class TagOut(BaseModel):
    id: str
    nome: str


@router.get("/config/scoring", response_model=ScoringOut)
async def ler_scoring(_: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            "SELECT criteria, thresholds, updated_at::text FROM scoring_config LIMIT 1")
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            "Nenhuma régua de scoring configurada.")
    return ScoringOut(**dict(linha))


@router.put("/config/scoring", response_model=ScoringOut)
async def gravar_scoring(dados: ScoringIn, _: Usuario = Depends(admin_atual)):
    """⚠️ Gravar aqui NÃO repontua a base. Os triggers só rodam em INSERT e
    UPDATE de `leads`; mudar a régua não toca em linha nenhuma. Depois de
    salvar, chame POST /contatos/recalcular-scores — a tela deve deixar isso
    explícito para quem edita."""
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            """UPDATE scoring_config
                  SET criteria = $1::jsonb, thresholds = $2::jsonb, updated_at = now()
                WHERE id = (SELECT id FROM scoring_config LIMIT 1)
            RETURNING criteria, thresholds, updated_at::text""",
            dados.criteria, dados.thresholds)
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            "Nenhuma régua de scoring para atualizar.")
    return ScoringOut(**dict(linha))


@router.get("/tags", response_model=list[TagOut])
async def listar_tags(_: Usuario = Depends(usuario_atual)):
    # A coluna no schema é `name`; a resposta fala `nome`. A tradução mora aqui
    # e em nenhum outro lugar.
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            "SELECT id::text, name AS nome FROM tags ORDER BY name")
    return [TagOut(**dict(l)) for l in linhas]
