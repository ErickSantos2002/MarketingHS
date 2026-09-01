"""Campanhas. Substitui a `campaigns-api`.

⚠️ Este lote (3A) NÃO envia. O enfileirador, o worker e o Resend chegam no 3B;
o agendamento, no 3C. Se você está escrevendo uma chamada ao Resend aqui, parou
no lote errado.
"""

import logging
from datetime import datetime

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, usuario_atual

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/campanhas", tags=["campanhas"])

COLUNAS = """
    c.id::text, c.name, c.channel, c.status, c.subject, c.body,
    c.scheduled_at::text, c.sent_at::text, c.stats, c.design,
    c.segment_ids::text[] AS segment_ids,
    c.excluded_segment_ids::text[] AS excluded_segment_ids,
    c.created_at::text, c.updated_at::text
"""

# Os nomes dos segmentos numa subconsulta lateral, não numa segunda viagem.
NOMES_DOS_SEGMENTOS = """
    LEFT JOIN LATERAL (
        SELECT array_agg(g.name ORDER BY g.name) AS nomes
          FROM segments g WHERE g.id = ANY(c.segment_ids)
    ) s ON true
"""

AMOSTRA_ENVIOS = 50


@router.get("")
async def listar(
    estado: str | None = Query(None, alias="status"),
    canal: str | None = Query(None, alias="channel"),
    pagina: int = Query(1, alias="page", ge=1),
    limite: int = Query(20, alias="limit", ge=1, le=100),
    _: Usuario = Depends(usuario_atual),
):
    """Lista paginada, com os NOMES dos segmentos já resolvidos.

    ⚠️ Os nomes vêm numa subconsulta lateral, não numa segunda ida ao banco por
    campanha. A `campaigns-api` buscava as campanhas e depois fazia um segundo
    `select` em `segments` com todos os ids — já era melhor que N+1, mas ainda
    são duas viagens e uma junção montada no navegador.
    """
    async with sessao(role="service_role") as conn:
        total = await conn.fetchval(
            """SELECT count(*) FROM campaigns
                WHERE ($1::text IS NULL OR status = $1)
                  AND ($2::text IS NULL OR channel = $2)""",
            estado, canal)
        linhas = await conn.fetch(
            f"""SELECT {COLUNAS}, s.nomes AS segment_names
                  FROM campaigns c {NOMES_DOS_SEGMENTOS}
                 WHERE ($1::text IS NULL OR c.status = $1)
                   AND ($2::text IS NULL OR c.channel = $2)
                 ORDER BY c.created_at DESC
                 LIMIT $3 OFFSET $4""",
            estado, canal, limite, (pagina - 1) * limite)
    return {
        "data": [{**dict(l), "segment_names": l["segment_names"] or []}
                 for l in linhas],
        "pagination": {"page": pagina, "limit": limite, "total": total,
                       "pages": (total + limite - 1) // limite},
    }


@router.get("/{campanha_id}")
async def detalhe(campanha_id: str, _: Usuario = Depends(usuario_atual)):
    """A campanha, os nomes dos segmentos e uma amostra dos envios.

    ⚠️ `stats` é lido da coluna, NÃO recalculado aqui. Quem calcula é
    `finalize_campaign_if_drained`, no banco, quando a fila drena. Uma segunda
    contagem nesta rota divergiria da primeira no meio de um envio, e a tela
    mostraria um número que o banco não confirma.
    """
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            f"""SELECT {COLUNAS}, s.nomes AS segment_names
                  FROM campaigns c {NOMES_DOS_SEGMENTOS}
                 WHERE c.id = $1::uuid""",
            campanha_id)
        if linha is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Campanha não encontrada.")

        envios = await conn.fetch(
            """SELECT cs.id::text, cs.status, cs.sent_at::text,
                      cs.opened_at::text, cs.clicked_at::text, cs.error,
                      l.id::text AS lead_id, l.nome, l.email
                 FROM campaign_sends cs
                 LEFT JOIN leads l ON l.id = cs.lead_id
                WHERE cs.campaign_id = $1::uuid
                ORDER BY cs.created_at DESC
                LIMIT $2""",
            campanha_id, AMOSTRA_ENVIOS)

    return {**dict(linha),
            "segment_names": linha["segment_names"] or [],
            "sends": [dict(e) for e in envios]}


class CampanhaIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    channel: str = Field(pattern="^(email|whatsapp)$")
    subject: str | None = None
    body: str | None = None
    design: dict | None = None
    segment_ids: list[str] = Field(default_factory=list)
    excluded_segment_ids: list[str] = Field(default_factory=list)
    # ⚠️ datetime, não str. O asyncpg recusa string num parâmetro timestamptz
    # ("expected a datetime.date or datetime.datetime instance") e o cast
    # `::timestamptz` não salva — ele age no SQL, depois de o driver já ter
    # rejeitado o argumento. O pydantic converte o ISO-8601 que a tela manda.
    scheduled_at: datetime | None = None


class CampanhaPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    subject: str | None = None
    body: str | None = None
    design: dict | None = None
    segment_ids: list[str] | None = None
    excluded_segment_ids: list[str] | None = None
    scheduled_at: datetime | None = None


# Editar campanha que já saiu (ou está saindo) reescreveria a história de um
# envio real: o corpo mudaria, mas o que chegou na caixa de entrada não.
EDITAVEL = ("draft", "scheduled", "paused", "failed")

CASTS = {"design": "::jsonb", "segment_ids": "::uuid[]",
         "excluded_segment_ids": "::uuid[]", "scheduled_at": "::timestamptz"}


@router.post("", status_code=status.HTTP_201_CREATED)
async def criar(dados: CampanhaIn, _: Usuario = Depends(usuario_atual)):
    """Nasce sempre em `draft`.

    ⚠️ O status NÃO vem do corpo. Deixar o cliente escolher permitiria criar uma
    campanha já em `sending` — que o worker do 3B pegaria e enviaria sem que
    ninguém tivesse clicado em enviar.

    ⚠️ `scheduled_at` é aceito e gravado, mas NADA no 3A leva a campanha para o
    status `scheduled`, e o promotor (`promote_scheduled_campaigns`) está
    quebrado até o 3C. A data fica guardada e não dispara nada — guardá-la é
    certo, é o que o 3C vai ler, mas não há botão de agendar neste lote.
    """
    async with sessao(role="service_role") as conn:
        novo_id = await conn.fetchval(
            """INSERT INTO campaigns (name, channel, status, subject, body,
                                      design, segment_ids, excluded_segment_ids,
                                      scheduled_at)
               VALUES ($1, $2, 'draft', $3, $4, $5::jsonb,
                       $6::uuid[], $7::uuid[], $8::timestamptz)
               RETURNING id""",
            dados.name.strip(), dados.channel, dados.subject, dados.body,
            dados.design, dados.segment_ids, dados.excluded_segment_ids,
            dados.scheduled_at)
    return {"id": str(novo_id)}


@router.patch("/{campanha_id}")
async def editar(campanha_id: str, dados: CampanhaPatch,
                 _: Usuario = Depends(usuario_atual)):
    """⚠️ PATCH de verdade (`exclude_unset`) e trava por status.

    Só `draft`, `scheduled`, `paused` e `failed` aceitam edição. `sending` e
    `sent` recusam com 409: a campanha já foi para a fila, e trocar o corpo
    agora faria a tela contar uma história diferente da que chegou ao contato.
    """
    campos = dados.model_dump(exclude_unset=True)
    if not campos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nada a atualizar.")

    partes, valores = [], []
    for i, (coluna, valor) in enumerate(campos.items(), start=2):
        partes.append(f"{coluna} = ${i}{CASTS.get(coluna, '')}")
        valores.append(valor)

    async with sessao(role="service_role") as conn:
        estado = await conn.fetchval(
            "SELECT status FROM campaigns WHERE id = $1::uuid", campanha_id)
        if estado is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Campanha não encontrada.")
        if estado not in EDITAVEL:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Esta campanha está em {estado!r} e não pode mais ser editada. "
                "Duplique-a para criar uma nova versão.")
        await conn.execute(
            f"""UPDATE campaigns SET {', '.join(partes)}, updated_at = now()
                 WHERE id = $1::uuid""",
            campanha_id, *valores)
    return {"id": campanha_id}


@router.post("/{campanha_id}/duplicar", status_code=status.HTTP_201_CREATED)
async def duplicar(campanha_id: str, _: Usuario = Depends(usuario_atual)):
    """A cópia nasce em `draft`, sem `scheduled_at`, sem `sent_at` e com `stats`
    no padrão da coluna — copiar o histórico de envio da original faria a cópia
    parecer já enviada. O sufixo é ' (cópia)', o mesmo que o lote 2 usou em
    segmentos.
    """
    async with sessao(role="service_role") as conn:
        novo = await conn.fetchval(
            """INSERT INTO campaigns (name, channel, status, subject, body,
                                      design, segment_ids, excluded_segment_ids)
               SELECT name || ' (cópia)', channel, 'draft', subject, body,
                      design, segment_ids, excluded_segment_ids
                 FROM campaigns WHERE id = $1::uuid
               RETURNING id""",
            campanha_id)
        if novo is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Campanha não encontrada.")
    return {"id": str(novo)}


@router.delete("/{campanha_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir(campanha_id: str, _: Usuario = Depends(usuario_atual)):
    """`guard_campaign_delete` é um trigger que recusa apagar campanha com envio
    em andamento, com mensagem escrita para quem usa. Devolvê-la como 409 é o
    mesmo tratamento que o lote 2 deu ao `guard_segment_delete`; deixar virar
    500 trocaria orientação por "Internal Server Error".

    ⚠️ A guarda recusa em DOIS casos, e campanha `sent` não é um deles:
      - `status = 'sending'` — o envio está acontecendo agora
      - existe `campaign_sends` com `status = 'pending'` — sobrou fila
    Campanha `sent` e drenada apaga normalmente.
    """
    try:
        async with sessao(role="service_role") as conn:
            r = await conn.execute(
                "DELETE FROM campaigns WHERE id = $1::uuid", campanha_id)
    except asyncpg.exceptions.RaiseError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
    if r.endswith(" 0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Campanha não encontrada.")
