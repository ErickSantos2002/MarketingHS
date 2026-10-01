"""A fila de envio. É o que o `pgmq` fazia, escrito à mão.

O pgmq é, por dentro, uma tabela com `SELECT ... FOR UPDATE SKIP LOCKED` e um
campo de visibilidade. Reimplementá-lo é o custo honesto de não instalar uma
extensão em Rust num Postgres que serve os bancos da empresa — e é o único
lugar do projeto que a spec manda nascer com teste automatizado.
"""

import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Mensagem:
    fila_id: int
    send_id: str
    campaign_id: str
    lead_id: str
    tentativas: int


async def publicar(conn, mensagens: list[dict]) -> int:
    """Põe mensagens na fila. Devolve quantas ENTRARAM de fato.

    ⚠️ `ON CONFLICT DO NOTHING` no `send_id`: republicar um órfão é o caminho de
    recuperação do enfileirador, e tem de ser inofensivo. Um retorno menor que o
    enviado não é erro — é a restrição fazendo o trabalho dela.
    """
    if not mensagens:
        return 0
    linhas = await conn.fetch(
        """INSERT INTO email_send_queue (send_id, campaign_id, lead_id)
           SELECT (m->>'send_id')::uuid, (m->>'campaign_id')::uuid,
                  (m->>'lead_id')::uuid
             FROM jsonb_array_elements($1::jsonb) AS m
           ON CONFLICT (send_id) DO NOTHING
           RETURNING id""",
        mensagens)
    return len(linhas)


async def reivindicar(conn, limite: int, visibilidade: int) -> list[Mensagem]:
    """Pega até `limite` mensagens prontas e as esconde por `visibilidade` s.

    ⚠️ O UPDATE e o SELECT são a MESMA instrução. Separá-los abriria uma janela
    em que dois workers enxergam a mesma linha — o `SKIP LOCKED` sozinho não
    fecha essa janela depois que a transação do primeiro termina.
    """
    linhas = await conn.fetch(
        """UPDATE email_send_queue q
              SET visivel_em = now() + make_interval(secs => $2::double precision),
                  tentativas = q.tentativas + 1
            WHERE q.id IN (
                SELECT id FROM email_send_queue
                 WHERE visivel_em <= now()
                 ORDER BY id
                 LIMIT $1
                 FOR UPDATE SKIP LOCKED
            )
          RETURNING q.id, q.send_id::text AS send_id,
                    q.campaign_id::text AS campaign_id,
                    q.lead_id::text AS lead_id, q.tentativas""",
        limite, visibilidade)
    return [Mensagem(fila_id=l["id"], send_id=l["send_id"],
                     campaign_id=l["campaign_id"], lead_id=l["lead_id"],
                     tentativas=l["tentativas"]) for l in linhas]


async def concluir(conn, fila_id: int) -> None:
    """Tira a mensagem da fila. Só depois do envio confirmado."""
    await conn.execute("DELETE FROM email_send_queue WHERE id = $1", fila_id)


async def devolver(conn, fila_id: int, erro: str, max_tentativas: int) -> str:
    """Reagenda a mensagem, ou a manda para a fila-morta se estourou o teto.

    Devolve 'reagendada' ou 'morta'.

    ⚠️ A fila-morta não é descarte: a mensagem sai da fila viva e continua
    registrada, com o último erro. Apagar direto esconderia justamente o caso
    que precisa ser investigado.
    """
    tentativas = await conn.fetchval(
        "SELECT tentativas FROM email_send_queue WHERE id = $1", fila_id)
    if tentativas is None:
        # Outro worker já concluiu ou matou esta mensagem. Não é erro.
        return "reagendada"

    if tentativas >= max_tentativas:
        await conn.execute(
            """INSERT INTO email_send_dead
                   (send_id, campaign_id, lead_id, tentativas, ultimo_erro)
               SELECT send_id, campaign_id, lead_id, tentativas, $2
                 FROM email_send_queue WHERE id = $1""",
            fila_id, erro)
        await conn.execute("DELETE FROM email_send_queue WHERE id = $1", fila_id)
        logger.warning("mensagem %s foi para a fila-morta: %s", fila_id, erro)
        return "morta"

    # Recuo progressivo: 1min, 2min, 4min... Um erro de rede que dura dois
    # minutos não deve consumir as cinco tentativas em dez segundos.
    await conn.execute(
        """UPDATE email_send_queue
              SET visivel_em = now() + make_interval(
                      secs => (60 * power(2, tentativas - 1))::double precision),
                  ultimo_erro = $2
            WHERE id = $1""",
        fila_id, erro)
    return "reagendada"


async def fechar_campanhas_drenadas(conn) -> list[str]:
    """Fecha toda campanha em 'sending' que não tem mais envio pendente.

    ⚠️ O `_tick` só chama o finalize para as campanhas do lote que ele mesmo
    processou. Se o worker morre entre o commit do último envio e esse
    finalize, a fila daquela campanha já está vazia e nenhuma passada futura
    volta a olhá-la — ela fica em 'sending' para sempre, e o
    `guard_campaign_delete` não deixa nem apagá-la. Esta varredura é a rede.

    Segura contra o enfileirador: ele faz o claim para 'sending' e insere
    TODAS as linhas 'pending' na mesma transação, então não existe instante
    visível de 'sending' com a audiência ainda não inserida. E o próprio
    finalize recusa campanha com pendente.

    Devolve os ids das campanhas fechadas.
    """
    candidatas = await conn.fetch(
        """SELECT c.id::text AS id
             FROM campaigns c
            WHERE c.status = 'sending'
              AND NOT EXISTS (SELECT 1 FROM campaign_sends cs
                               WHERE cs.campaign_id = c.id AND cs.status = 'pending')
              AND NOT EXISTS (SELECT 1 FROM email_send_queue q
                               WHERE q.campaign_id = c.id)""")
    fechadas = []
    for c in candidatas:
        if await conn.fetchval("SELECT finalize_campaign_if_drained($1::uuid)", c["id"]):
            fechadas.append(c["id"])
    if fechadas:
        logger.warning("campanhas drenadas sem finalize, fechadas pela varredura: %s",
                       fechadas)
    return fechadas
