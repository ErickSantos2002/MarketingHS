"""Campanhas. Substitui a `campaigns-api`.

⚠️ Este lote (3A) NÃO envia. O enfileirador, o worker e o Resend chegam no 3B;
o agendamento, no 3C. Se você está escrevendo uma chamada ao Resend aqui, parou
no lote errado.

⚠️ `authenticated` + `admin_atual` desde 01/10/2026. `campaigns` e
`campaign_sends` são admin-only no RLS; com `usuario_atual` o não-admin
levaria lista vazia, sem erro. Teste: `tests/test_conversao_authenticated.py`.
"""

import logging
import uuid
from datetime import datetime, timezone

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, admin_atual
from app.dominio import controle_campanha

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
#
# ⚠️ Um MAPA id -> nome, não uma lista, e cobrindo inclusões E exclusões. É o
# que `describeAudience` no frontend consome para montar o rótulo ("Todos os
# contatos", "Quentes — exceto Descadastrados"); uma lista de nomes perderia
# qual id é qual e deixaria os excluídos de fora.
#
# Um id ausente do mapa é segmento apagado depois do envio — o rótulo mostra
# "Segmento removido", e é por isso que o mapa não pode ser um array posicional.
NOMES_DOS_SEGMENTOS = """
    LEFT JOIN LATERAL (
        SELECT jsonb_object_agg(g.id::text, g.name) AS nomes
          FROM segments g
         WHERE g.id = ANY(c.segment_ids || c.excluded_segment_ids)
    ) s ON true
"""

# ⚠️ `campaigns.stats` é CONGELADA. Ela só é escrita uma vez, por
# `finalize_campaign_if_drained`, no instante em que a fila drena — antes de
# qualquer humano abrir ou clicar. Ler a coluna e mandar para a tela faz a
# lista mostrar ~0% de abertura para sempre, que é exatamente o defeito que o
# frontend contornava calculando ao vivo no navegador.
#
# O contorno dele era pior que o problema: `supabase.rpc('execute_readonly_query')`
# com SQL montado por concatenação, uma função SECURITY DEFINER que aceita
# consulta arbitrária vinda do navegador. A spec já decidiu não portar essa RPC
# ("era dívida, não ativo" — ver publico.py). A agregação vem para cá.
#
# ⚠️ Os filtros abaixo são os MESMOS de `finalize_campaign_if_drained`, coluna
# por coluna. O cálculo ao vivo do frontend divergia num ponto: ele não contava
# `unsubscribed` como `sent`, e a função do banco conta. Seguir a função é o que
# evita uma terceira verdade — assim o valor ao vivo e o congelado têm a mesma
# semântica, e só a atualidade os separa.
ESTATISTICAS_AO_VIVO = """
    LEFT JOIN LATERAL (
        SELECT jsonb_build_object(
            'sent',       count(*) FILTER (WHERE cs.status IN ('sent','delivered','opened','clicked','unsubscribed')),
            'delivered',  count(*) FILTER (WHERE cs.status IN ('delivered','opened','clicked')),
            'opened',     count(*) FILTER (WHERE cs.status IN ('opened','clicked')),
            'clicked',    count(*) FILTER (WHERE cs.status = 'clicked'),
            'failed',     count(*) FILTER (WHERE cs.status IN ('failed','bounced')),
            'suppressed', count(*) FILTER (WHERE cs.status = 'suppressed'),
            'pending',    count(*) FILTER (WHERE cs.status = 'pending'),
            -- Os brutos, que a tela de detalhe mostra separados do roll-up.
            -- Antes eram DEZ consultas de contagem, uma por status.
            'bounced',      count(*) FILTER (WHERE cs.status = 'bounced'),
            'complained',   count(*) FILTER (WHERE cs.status = 'complained'),
            'unsubscribed', count(*) FILTER (WHERE cs.status = 'unsubscribed'),
            -- Parte dos 'suppressed': os que o "Parar" interrompeu (R1).
            -- É o que diz à tela que a campanha 'sent' foi interrompida.
            'interrompidos', count(*) FILTER (WHERE cs.status = 'suppressed'
                                                AND cs.error = '{interrompido}'),
            'total',        count(*)
        ) AS numeros
          FROM campaign_sends cs WHERE cs.campaign_id = c.id
    ) v ON true
""".replace("{interrompido}", controle_campanha.ERRO_INTERROMPIDO)

AMOSTRA_ENVIOS = 50


def _campanha(linha) -> dict:
    """Monta a campanha para a tela, com `stats` ao vivo no lugar da coluna.

    A coluna congelada continua no banco (é o que `finalize_campaign_if_drained`
    escreve) e vai junto como `stats_congelado`, para quem precisar comparar —
    mas o que a tela lê é o número de agora.
    """
    d = dict(linha)
    congelado = d.pop("stats", None)
    ao_vivo = d.pop("stats_ao_vivo", None)
    return {**d,
            "segment_names": d.get("segment_names") or {},
            "stats": ao_vivo or congelado or {},
            "stats_congelado": congelado}


@router.get("")
async def listar(
    estado: str | None = Query(None, alias="status"),
    canal: str | None = Query(None, alias="channel"),
    pagina: int = Query(1, alias="page", ge=1),
    limite: int = Query(20, alias="limit", ge=1, le=100),
    usuario: Usuario = Depends(admin_atual),
):
    """Lista paginada, com os NOMES dos segmentos já resolvidos.

    ⚠️ Os nomes vêm numa subconsulta lateral, não numa segunda ida ao banco por
    campanha. A `campaigns-api` buscava as campanhas e depois fazia um segundo
    `select` em `segments` com todos os ids — já era melhor que N+1, mas ainda
    são duas viagens e uma junção montada no navegador.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        total = await conn.fetchval(
            """SELECT count(*) FROM campaigns
                WHERE ($1::text IS NULL OR status = $1)
                  AND ($2::text IS NULL OR channel = $2)""",
            estado, canal)
        linhas = await conn.fetch(
            f"""SELECT {COLUNAS}, s.nomes AS segment_names, v.numeros AS stats_ao_vivo
                  FROM campaigns c {NOMES_DOS_SEGMENTOS} {ESTATISTICAS_AO_VIVO}
                 WHERE ($1::text IS NULL OR c.status = $1)
                   AND ($2::text IS NULL OR c.channel = $2)
                 ORDER BY c.created_at DESC
                 LIMIT $3 OFFSET $4""",
            estado, canal, limite, (pagina - 1) * limite)
    return {
        "data": [_campanha(l) for l in linhas],
        "pagination": {"page": pagina, "limit": limite, "total": total,
                       "pages": (total + limite - 1) // limite},
    }


@router.get("/{campanha_id}")
async def detalhe(campanha_id: str, usuario: Usuario = Depends(admin_atual)):
    """A campanha, os nomes dos segmentos e uma amostra dos envios.

    ⚠️ `stats` é lido da coluna, NÃO recalculado aqui. Quem calcula é
    `finalize_campaign_if_drained`, no banco, quando a fila drena. Uma segunda
    contagem nesta rota divergiria da primeira no meio de um envio, e a tela
    mostraria um número que o banco não confirma.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            f"""SELECT {COLUNAS}, s.nomes AS segment_names, v.numeros AS stats_ao_vivo
                  FROM campaigns c {NOMES_DOS_SEGMENTOS} {ESTATISTICAS_AO_VIVO}
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

    return {**_campanha(linha), "sends": [dict(e) for e in envios]}


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
async def criar(dados: CampanhaIn, usuario: Usuario = Depends(admin_atual)):
    """Nasce sempre em `draft`.

    ⚠️ O status NÃO vem do corpo. Deixar o cliente escolher permitiria criar uma
    campanha já em `sending` — que o worker do 3B pegaria e enviaria sem que
    ninguém tivesse clicado em enviar.

    ⚠️ Com `scheduled_at` no FUTURO a campanha nasce `scheduled`, e o agendador
    do worker a promove quando a hora chegar. Sem data, nasce `draft`. O status
    continua sendo DERIVADO pelo servidor, nunca escolhido pelo cliente — e
    `sending` continua fora de alcance.

    Data no passado nasce `draft` de propósito: agendar para trás significaria
    disparo imediato no primeiro tick do agendador, o que quase nunca é o que
    alguém quis ao digitar a data errada.
    """
    agendada = (dados.scheduled_at is not None
                and dados.scheduled_at > datetime.now(timezone.utc))
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        novo_id = await conn.fetchval(
            """INSERT INTO campaigns (name, channel, status, subject, body,
                                      design, segment_ids, excluded_segment_ids,
                                      scheduled_at)
               VALUES ($1, $2, $9, $3, $4, $5::jsonb,
                       $6::uuid[], $7::uuid[], $8::timestamptz)
               RETURNING id""",
            dados.name.strip(), dados.channel, dados.subject, dados.body,
            dados.design, dados.segment_ids, dados.excluded_segment_ids,
            dados.scheduled_at, "scheduled" if agendada else "draft")
    return {"id": str(novo_id)}


@router.patch("/{campanha_id}")
async def editar(campanha_id: str, dados: CampanhaPatch,
                 usuario: Usuario = Depends(admin_atual)):
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

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
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
async def duplicar(campanha_id: str, usuario: Usuario = Depends(admin_atual)):
    """A cópia nasce em `draft`, sem `scheduled_at`, sem `sent_at` e com `stats`
    no padrão da coluna — copiar o histórico de envio da original faria a cópia
    parecer já enviada. O sufixo é ' (cópia)', o mesmo que o lote 2 usou em
    segmentos.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
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
async def excluir(campanha_id: str, usuario: Usuario = Depends(admin_atual)):
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
        async with sessao(role="authenticated", user_id=usuario.id) as conn:
            r = await conn.execute(
                "DELETE FROM campaigns WHERE id = $1::uuid", campanha_id)
    except asyncpg.exceptions.RaiseError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
    if r.endswith(" 0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Campanha não encontrada.")


@router.get("/{campanha_id}/audiencia")
async def audiencia(campanha_id: str, usuario: Usuario = Depends(admin_atual)):
    """Quantos contatos esta campanha atingiria hoje.

    ⚠️ Chama `count_segment_audience` e `resolve_segment_audience` — as MESMAS
    funções que o envio do 3B vai usar. É isso que faz o número do card ser o
    número que sai. Uma contagem própria aqui viraria "o card dizia 500 e
    saíram 480".

    ⚠️ Sem segmento de inclusão, a audiência é a base inteira — e o enfileirador
    aplica um teto de 5.000 nesse caminho. `teto_aplicado` avisa a tela para que
    ela não prometa um número maior do que o envio entregaria.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            """SELECT segment_ids::text[] AS incluir,
                      excluded_segment_ids::text[] AS excluir
                 FROM campaigns WHERE id = $1::uuid""", campanha_id)
        if linha is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Campanha não encontrada.")

        incluir, excluir = linha["incluir"] or [], linha["excluir"] or []
        total = await conn.fetchval(
            "SELECT count_segment_audience($1::uuid[], $2::uuid[])",
            incluir, excluir)
        amostra = await conn.fetch(
            """SELECT COALESCE(l.nome, 'Sem nome') AS nome
                 FROM resolve_segment_audience($1::uuid[], $2::uuid[], 3) a
                 JOIN leads l ON l.id = a.lead_id""",
            incluir, excluir)

    return {"total": total or 0,
            "amostra_nomes": [a["nome"] for a in amostra],
            "teto_aplicado": len(incluir) == 0}


@router.get("/{campanha_id}/envios")
async def envios(campanha_id: str, usuario: Usuario = Depends(admin_atual)):
    """Todos os envios da campanha, com o contato já junto.

    ⚠️ `NULLS LAST` não é enfeite. A partir da fila os envios nascem `pending`
    com `sent_at` nulo, e em Postgres NULL vem PRIMEIRO num `ORDER BY DESC` —
    sem isso a lista mostraria os que ainda não saíram acima dos que já saíram.

    ⚠️ O contato vem por JOIN. A tela buscava os envios e depois os leads em
    lotes de 200, montando o mapa no navegador.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        existe = await conn.fetchval(
            "SELECT 1 FROM campaigns WHERE id = $1::uuid", campanha_id)
        if existe is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Campanha não encontrada.")
        linhas = await conn.fetch(
            """SELECT cs.id::text, cs.campaign_id::text, cs.lead_id::text,
                      cs.dnia_id::text, cs.channel, cs.status,
                      cs.sent_at::text, cs.opened_at::text, cs.clicked_at::text,
                      cs.error,
                      COALESCE(l.nome, '-')     AS lead_name,
                      COALESCE(l.email, '-')    AS lead_email,
                      COALESCE(l.whatsapp, '-') AS lead_phone
                 FROM campaign_sends cs
                 LEFT JOIN leads l ON l.id = cs.lead_id
                WHERE cs.campaign_id = $1::uuid
                ORDER BY cs.sent_at DESC NULLS LAST, cs.created_at DESC""",
            campanha_id)
    return [dict(l) for l in linhas]


# ── Pausar / retomar / parar (R1, 02/10/2026) ────────────────────────────────
# A lógica está em app/dominio/controle_campanha.py.
#
# ⚠️ `service_role`, como o `/enviar` (envio.py): `authenticated` só tem
# SELECT/UPDATE em `email_send_queue`, e retomar republica (INSERT) e parar
# esvazia (DELETE) a fila — na MESMA transação da troca de status, senão
# alguém vê o meio. Quem autoriza é o `admin_atual`.


async def _controlar(acao, campanha_id: str) -> dict:
    try:
        uuid.UUID(campanha_id)
    except ValueError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Campanha não encontrada.")
    try:
        async with sessao(role="service_role") as conn:
            resultado = await acao(conn, campanha_id)
    except controle_campanha.NaoEncontrada:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Campanha não encontrada.")
    except controle_campanha.EstadoInvalido as e:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Esta campanha está em {e.atual!r} e não pode ser alterada assim.")
    if isinstance(resultado, str):
        resultado = {"status": resultado}
    return {"id": campanha_id, **resultado}


@router.post("/{campanha_id}/pausar")
async def pausar(campanha_id: str, usuario: Usuario = Depends(admin_atual)):
    """O worker deixa de reivindicar mensagens dela. Nada sai da fila."""
    resultado = await _controlar(controle_campanha.pausar, campanha_id)
    logger.info("campanha %s pausada por %s", campanha_id, usuario.id)
    return resultado


@router.post("/{campanha_id}/retomar")
async def retomar(campanha_id: str, usuario: Usuario = Depends(admin_atual)):
    resultado = await _controlar(controle_campanha.retomar, campanha_id)
    logger.info("campanha %s retomada por %s", campanha_id, usuario.id)
    return resultado


@router.post("/{campanha_id}/parar")
async def parar(campanha_id: str, usuario: Usuario = Depends(admin_atual)):
    """Cancela o que falta: os pendentes viram `suppressed` (envio
    interrompido) e a campanha fecha. Não tem volta."""
    resultado = await _controlar(controle_campanha.parar, campanha_id)
    logger.warning("campanha %s PARADA por %s: %s envios interrompidos",
                   campanha_id, usuario.id, resultado.get("interrompidos"))
    return resultado


@router.post("/{campanha_id}/cancelar-agendamento")
async def cancelar_agendamento(campanha_id: str,
                               usuario: Usuario = Depends(admin_atual)):
    """Volta a campanha agendada para rascunho.

    ⚠️ O `AND status = 'scheduled'` é reavaliado NO BANCO, no instante do
    UPDATE. Entre o clique e a chegada da requisição, o agendador pode ter
    promovido a campanha para `sending` — e dizer "agendamento cancelado" para
    um envio em curso seria mentir. Zero linhas afetadas é o único sinal de que
    a corrida foi perdida.

    ⚠️ No 3A nada leva uma campanha a `scheduled` (o agendamento é do 3C), então
    este caminho existe para a tela não ficar sem ele — e já nasce com a trava
    certa para quando o agendador aparecer.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        r = await conn.execute(
            """UPDATE campaigns SET status = 'draft', scheduled_at = NULL,
                                    updated_at = now()
                WHERE id = $1::uuid AND status = 'scheduled'""",
            campanha_id)
    if r.endswith(" 0"):
        existe = None
        async with sessao(role="authenticated", user_id=usuario.id) as conn:
            existe = await conn.fetchval(
                "SELECT status FROM campaigns WHERE id = $1::uuid", campanha_id)
        if existe is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Campanha não encontrada.")
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Esta campanha está em {existe!r} e não pode mais ser cancelada.")
    return {"id": campanha_id, "status": "draft"}
