"""Configuração do sistema. Tira do navegador o acesso direto a scoring_config
e a tags — dois dos 68 pontos que a spec mandou fechar."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

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
    cor: str | None = None


class TagIn(BaseModel):
    nome: str = Field(min_length=1, max_length=100)
    cor: str | None = Field(default=None, pattern="^#[0-9a-fA-F]{6}$")


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
            "SELECT id::text, name AS nome, color AS cor FROM tags ORDER BY name")
    return [TagOut(**dict(l)) for l in linhas]


@router.post("/tags", response_model=TagOut, status_code=status.HTTP_201_CREATED)
async def criar_tag(dados: TagIn, _: Usuario = Depends(usuario_atual)):
    """⚠️ Upsert, não INSERT — pelo mesmo motivo do lote 1A: `tags_name_key` é
    único, e duas pessoas criando a mesma tag ao mesmo tempo derrubariam uma
    delas com 500. DO UPDATE e não DO NOTHING, para o RETURNING devolver a linha
    também no conflito.

    ⚠️ `COALESCE(tags.color, EXCLUDED.color)` e não o contrário: a cor de quem
    já existe vence. Criar uma tag que já existe é engano de quem digitou, não
    pedido para repintar — e repintar mudaria a aparência dela em todo contato
    que a usa, sem ninguém pedir.

    Na prática o COALESCE sempre cai no primeiro ramo: `tags.color` tem DEFAULT
    'purple' e nunca é nulo. Ou seja, **cor de tag só muda por edição
    explícita**. Mantive o COALESCE mesmo assim: se alguém tirar o default um
    dia, o comportamento continua o desejado sem precisar lembrar disto.
    Trocar tag existente de cor é operação de tela de tags, não de criar."""
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            """INSERT INTO tags (name, color) VALUES ($1, $2)
               ON CONFLICT (name) DO UPDATE SET color = COALESCE(tags.color, EXCLUDED.color)
               RETURNING id::text, name AS nome, color AS cor""",
            dados.nome.strip(), dados.cor)
    return TagOut(**dict(linha))


@router.delete("/notas/{nota_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remover_nota(nota_id: str, _: Usuario = Depends(usuario_atual)):
    """A nota se identifica sozinha; não precisa do contato no caminho."""
    async with sessao(role="service_role") as conn:
        await conn.execute("DELETE FROM lead_notes WHERE id = $1::uuid", nota_id)


@router.get("/preferencias/{chave}")
async def ler_preferencia(chave: str, usuario: Usuario = Depends(usuario_atual)):
    """Preferência de tela, por usuário.

    ⚠️ A chave é composta no SERVIDOR, com o id de quem está autenticado. Se o
    cliente mandasse a chave inteira, um usuário leria a preferência de outro só
    trocando o texto. `dashboard_settings` é global — não tem coluna de dono —,
    então o isolamento vem daqui e de nenhum outro lugar.
    """
    async with sessao(role="service_role") as conn:
        valor = await conn.fetchval(
            "SELECT setting_value FROM dashboard_settings WHERE setting_key = $1",
            f"{usuario.id}:{chave}")
    return {"valor": valor}


@router.put("/preferencias/{chave}")
async def gravar_preferencia(chave: str, corpo: dict,
                             usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        await conn.execute(
            """INSERT INTO dashboard_settings (setting_key, setting_value)
               VALUES ($1, $2::jsonb)
               ON CONFLICT (setting_key) DO UPDATE
                 SET setting_value = EXCLUDED.setting_value, updated_at = now()""",
            f"{usuario.id}:{chave}", corpo.get("valor"))
    return {"valor": corpo.get("valor")}
