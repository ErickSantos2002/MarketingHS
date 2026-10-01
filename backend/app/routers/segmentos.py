"""Segmentos. A lógica de regra mora no Postgres — aqui só a exposição.

Oito funções de segmento sobreviveram ao port do schema e estão em produção há
meses: `build_segment_condition`, `evaluate_segment_rules`,
`preview_segment_rules`, `evaluate_segment_for_lead`, `resolve_segment_audience`,
`count_segment_audience` e os dois triggers. Nenhuma delas é reimplementada
aqui — transformar regra em SQL é trabalho do banco, e reescrever isso em Python
seria trocar código provado por código novo sem ganho.

⚠️ `authenticated` + `admin_atual` desde 01/10/2026. `segments` e
`segment_contacts` são admin-only no RLS; com `usuario_atual` o não-admin
levaria zero segmentos, sem erro. As funções de segmento são SECURITY
DEFINER e contam igual sob os dois papéis. Teste:
`tests/test_conversao_authenticated.py`.
"""

import logging

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, admin_atual
from app.routers.leitura_contatos import COLUNAS_LEAD

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/segmentos", tags=["segmentos"])


# ⚠️ lead_id que não existe é erro de quem chama, não bug do servidor. Sem esta
# tradução a violação de chave estrangeira sobe como 500 — e 500 manda quem
# depura procurar defeito no lugar errado.
CONTATO_INEXISTENTE = "Um ou mais contatos informados não existem."


class RegraIn(BaseModel):
    field: str
    operator: str
    value: str


class PreviaIn(BaseModel):
    regras: list[RegraIn] = Field(min_length=1)
    logica: str = Field(default="and", pattern="^(and|or)$")


class AudienciaIn(BaseModel):
    incluir: list[str] = Field(default_factory=list)
    excluir: list[str] = Field(default_factory=list)


class ContatosEmLoteIn(BaseModel):
    lead_ids: list[str] = Field(min_length=1, max_length=10000)


class SegmentoIn(BaseModel):
    nome: str = Field(min_length=1, max_length=200)
    descricao: str | None = None
    tipo: str = Field(pattern="^(static|dynamic)$")
    regras: list[RegraIn] = Field(default_factory=list)
    logica: str = Field(default="and", pattern="^(and|or)$")
    # Só para estático: a lista de membros.
    lead_ids: list[str] | None = None


@router.get("")
async def listar(usuario: Usuario = Depends(admin_atual)):
    """Lista os segmentos com a contagem de contatos já resolvida.

    ⚠️ Uma consulta, não N+1. A tela buscava os segmentos e depois, para CADA
    um, fazia outra ida ao banco para contar — dez segmentos eram onze
    consultas. O LATERAL abaixo resolve os dois tipos numa passada: estático
    conta linhas de segment_contacts, dinâmico chama evaluate_segment_rules.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            """SELECT s.id::text, s.name AS nome, s.description AS descricao,
                      s.type AS tipo, s.rules AS regras,
                      COALESCE(s.logic, 'and') AS logica,
                      s.created_at::text, s.updated_at::text,
                      c.total AS total_contatos
                 FROM segments s
                 LEFT JOIN LATERAL (
                     SELECT CASE
                         WHEN s.type = 'dynamic'
                           THEN (SELECT count(*) FROM evaluate_segment_rules(s.id))
                         ELSE (SELECT count(*) FROM segment_contacts sc
                                WHERE sc.segment_id = s.id)
                     END AS total
                 ) c ON true
                ORDER BY s.created_at DESC"""
        )
    return [dict(l) for l in linhas]


@router.post("", status_code=status.HTTP_201_CREATED)
async def criar(dados: SegmentoIn, usuario: Usuario = Depends(admin_atual)):
    """Cria o segmento e, se for estático, os membros — na MESMA transação.

    ⚠️ A tela gravava o segmento e só então inseria os membros, em lotes de 100.
    Falhar no meio deixava um segmento com parte dos contatos, e nada indicava
    que estava pela metade. Aqui ou nasce inteiro, ou não nasce.
    """
    try:
        async with sessao(role="authenticated", user_id=usuario.id) as conn:
            segmento_id = await conn.fetchval(
                """INSERT INTO segments (name, description, type, rules, logic)
                   VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id""",
                dados.nome.strip(), dados.descricao, dados.tipo,
                [r.model_dump() for r in dados.regras], dados.logica)

            if dados.tipo == "static" and dados.lead_ids:
                # unnest em vez de laço de lotes: uma instrução, e o banco cuida
                # do volume.
                await conn.execute(
                    """INSERT INTO segment_contacts (segment_id, lead_id)
                       SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING""",
                    segmento_id, dados.lead_ids)
    except asyncpg.exceptions.ForeignKeyViolationError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, CONTATO_INEXISTENTE)

    return {"id": str(segmento_id)}


@router.put("/{segmento_id}")
async def editar(segmento_id: str, dados: SegmentoIn,
                 usuario: Usuario = Depends(admin_atual)):
    """⚠️ A tela apagava TODOS os membros e reinseria. Havia uma janela em que o
    segmento ficava vazio, e se a reinserção falhasse ele ficava vazio para
    sempre. Na transação a janela não existe: quem consultar durante a operação
    vê o estado antigo, e quem consultar depois vê o novo.
    """
    try:
        async with sessao(role="authenticated", user_id=usuario.id) as conn:
            r = await conn.execute(
                """UPDATE segments SET name = $2, description = $3, type = $4,
                                       rules = $5::jsonb, logic = $6, updated_at = now()
                    WHERE id = $1::uuid""",
                segmento_id, dados.nome.strip(), dados.descricao, dados.tipo,
                [x.model_dump() for x in dados.regras], dados.logica)
            if r.endswith(" 0"):
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Segmento não encontrado.")

            if dados.tipo == "static" and dados.lead_ids is not None:
                await conn.execute(
                    "DELETE FROM segment_contacts WHERE segment_id = $1::uuid",
                    segmento_id)
                if dados.lead_ids:
                    await conn.execute(
                        """INSERT INTO segment_contacts (segment_id, lead_id)
                           SELECT $1::uuid, unnest($2::uuid[]) ON CONFLICT DO NOTHING""",
                        segmento_id, dados.lead_ids)
    except asyncpg.exceptions.ForeignKeyViolationError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, CONTATO_INEXISTENTE)

    return {"id": segmento_id}


@router.post("/{segmento_id}/duplicar", status_code=status.HTTP_201_CREATED)
async def duplicar(segmento_id: str, usuario: Usuario = Depends(admin_atual)):
    """Copia o segmento e os membros numa transação. O sufixo é ' (cópia)',
    o mesmo que a tela já usava.

    ⚠️ A tela duplicava com a lista de membros VAZIA — duplicar um segmento
    estático devolvia uma casca sem ninguém dentro. Aqui os membros vêm junto,
    que é o que "duplicar" quer dizer para quem clica.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        novo_id = await conn.fetchval(
            """INSERT INTO segments (name, description, type, rules, logic)
               SELECT name || ' (cópia)', description, type, rules, logic
                 FROM segments WHERE id = $1::uuid
               RETURNING id""",
            segmento_id)
        if novo_id is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Segmento não encontrado.")

        await conn.execute(
            """INSERT INTO segment_contacts (segment_id, lead_id)
               SELECT $2, lead_id FROM segment_contacts WHERE segment_id = $1::uuid
               ON CONFLICT DO NOTHING""",
            segmento_id, novo_id)

    return {"id": str(novo_id)}


@router.delete("/{segmento_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir(segmento_id: str, usuario: Usuario = Depends(admin_atual)):
    """⚠️ `guard_segment_delete` é um trigger que impede excluir segmento em uso
    por campanha não enviada ou fluxo ativo, e levanta exceção com uma mensagem
    escrita para quem usa:

        Este segmento é usado pela campanha "X" (ainda não enviada).
        Remova-o da campanha antes de excluí-lo.

    Deixar isso virar 500 seria trocar orientação por "Internal Server Error".
    O `except` abaixo devolve a mensagem do banco como 409.
    """
    try:
        async with sessao(role="authenticated", user_id=usuario.id) as conn:
            r = await conn.execute(
                "DELETE FROM segments WHERE id = $1::uuid", segmento_id)
    except asyncpg.exceptions.RaiseError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
    if r.endswith(" 0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Segmento não encontrado.")


# ⚠️ As rotas literais (/previa, /audiencia) precisam ser declaradas antes das
# paramétricas de mesma forma, ou o FastAPI casaria "previa" como se fosse um
# id. Aqui não há colisão — /{segmento_id}/contatos tem outra profundidade —
# mas a ordem segue a convenção do leitura_contatos para não virar armadilha
# quando alguém acrescentar POST /{segmento_id}.
@router.post("/previa")
async def previa(dados: PreviaIn, usuario: Usuario = Depends(admin_atual)):
    """Quantos contatos batem com regras AINDA NÃO SALVAS, mais uma amostra.

    `preview_segment_rules` reusa o MESMO `build_segment_condition` que
    `evaluate_segment_rules` — é isso que faz o número mostrado no construtor
    ser o número que a campanha vai enviar. Reimplementar a avaliação aqui
    reabriria a divergência que já causou o defeito do campo `qualificacao`.

    Uma chamada, não duas: a tela pedia a RPC e depois buscava os leads da
    amostra. O JOIN abaixo devolve as duas coisas juntas, e a lista completa de
    leads continua sem trafegar — só a amostra sai do banco.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        total = await conn.fetchval(
            "SELECT count(*) FROM preview_segment_rules($1::jsonb, $2)",
            [r.model_dump() for r in dados.regras], dados.logica)
        amostra = await conn.fetch(
            """SELECT l.id::text, l.nome, l.etiqueta
                 FROM preview_segment_rules($1::jsonb, $2) p
                 JOIN leads l ON l.id = p.lead_id
                WHERE l.deleted_at IS NULL
                LIMIT 5""",
            [r.model_dump() for r in dados.regras], dados.logica)
    return {"total": total, "amostra": [dict(a) for a in amostra]}


@router.post("/audiencia")
async def audiencia(dados: AudienciaIn, usuario: Usuario = Depends(admin_atual)):
    """Tamanho e amostra do público de vários segmentos, com exclusões.

    `count_segment_audience` e `resolve_segment_audience` são as MESMAS funções
    que o envio de campanha usa. É o que garante que o número exibido no
    assistente seja o número enviado — trocar por uma contagem própria aqui
    seria criar duas verdades.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        total = await conn.fetchval(
            "SELECT count_segment_audience($1::uuid[], $2::uuid[])",
            dados.incluir, dados.excluir)
        amostra = await conn.fetch(
            """SELECT COALESCE(l.nome, 'Sem nome') AS nome
                 FROM resolve_segment_audience($1::uuid[], $2::uuid[], 3) a
                 JOIN leads l ON l.id = a.lead_id""",
            dados.incluir, dados.excluir)
    return {"total": total or 0, "amostra_nomes": [a["nome"] for a in amostra]}


@router.get("/{segmento_id}/contatos")
async def contatos(segmento_id: str, usuario: Usuario = Depends(admin_atual)):
    """Os contatos do segmento, resolvendo os dois tipos no banco.

    ⚠️ Para segmento dinâmico a tela chamava a RPC, recebia os ids e buscava os
    leads em lotes de 200 — RPC mais N consultas. Um JOIN faz tudo.

    ⚠️ O filtro `deleted_at IS NULL` é NOVO. A tela não filtrava, então um
    contato excluído continuava aparecendo no segmento — e entraria numa
    campanha. Para o segmento dinâmico isso já valia (as regras filtram), mas o
    estático guarda o vínculo em segment_contacts, que a exclusão não apaga.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        tipo = await conn.fetchval(
            "SELECT type FROM segments WHERE id = $1::uuid", segmento_id)
        if tipo is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Segmento não encontrado.")

        if tipo == "dynamic":
            linhas = await conn.fetch(
                f"""SELECT {COLUNAS_LEAD} FROM evaluate_segment_rules($1::uuid) r
                      JOIN leads l ON l.id = r.lead_id
                     WHERE l.deleted_at IS NULL
                     ORDER BY l.created_at DESC""", segmento_id)
        else:
            linhas = await conn.fetch(
                f"""SELECT {COLUNAS_LEAD} FROM segment_contacts sc
                      JOIN leads l ON l.id = sc.lead_id
                     WHERE sc.segment_id = $1::uuid AND l.deleted_at IS NULL
                     ORDER BY l.created_at DESC""", segmento_id)
    return [dict(l) for l in linhas]


@router.post("/{segmento_id}/contatos", status_code=status.HTTP_204_NO_CONTENT)
async def adicionar_contatos(segmento_id: str, dados: ContatosEmLoteIn,
                             usuario: Usuario = Depends(admin_atual)):
    """Adiciona contatos a um segmento estático — o que a barra de ações em
    massa da tela de Contatos precisa.

    ⚠️ Só faz sentido em segmento estático: o dinâmico não guarda membros, e
    inserir em segment_contacts não mudaria nada do que ele devolve. Aceitar
    calado seria mentir para quem clicou.
    """
    try:
        async with sessao(role="authenticated", user_id=usuario.id) as conn:
            tipo = await conn.fetchval(
                "SELECT type FROM segments WHERE id = $1::uuid", segmento_id)
            if tipo is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND,
                                    "Segmento não encontrado.")
            if tipo != "static":
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    "Este segmento é dinâmico: quem entra nele é decidido pelas "
                    "regras, não na mão. Edite as regras do segmento.")
            await conn.execute(
                """INSERT INTO segment_contacts (segment_id, lead_id)
                   SELECT $1::uuid, unnest($2::uuid[]) ON CONFLICT DO NOTHING""",
                segmento_id, dados.lead_ids)
    except asyncpg.exceptions.ForeignKeyViolationError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, CONTATO_INEXISTENTE)
