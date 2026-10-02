"""Pausar, retomar e parar uma campanha em envio (R1, 02/10/2026).

Separado da rota porque é a parte que precisa de teste em transação revertida:
uma campanha 'sending' com mensagem na fila, comitada no banco de produção,
seria pega pelo worker de lá.

- **pausar** (`sending` → `paused`): nada muda na fila. `fila.reivindicar`
  ignora mensagem de campanha pausada, e a que já tinha sido reivindicada volta
  sem gastar tentativa (`worker._processar`).
- **retomar** (`paused` → `sending`): o worker volta a enxergar. Republica o
  pendente que por acaso não esteja na fila (`ON CONFLICT DO NOTHING`) — sem
  isso a campanha nunca fecharia.
- **parar** (`sending`/`paused` → `sent`): tira da fila o que falta, marca os
  pendentes como `suppressed` com `ERRO_INTERROMPIDO`, e fecha pelo mesmo
  `finalize_campaign_if_drained` de sempre.

⚠️ Por que `suppressed` e `sent`, e não `cancelled`: os dois triggers de
validação (`validate_campaign_send_status`, `validate_campaign_status`) só
aceitam os estados herdados, e mudar isso pede migration. `suppressed` é
exatamente "envio deliberadamente pulado" — não infla a falha, e o finalize
e a estatística ao vivo já o contam. A campanha fecha em `sent` com as
estatísticas congeladas; a tela distingue a interrompida pelo contador
`interrompidos` da estatística ao vivo (`routers/campanhas.py`).
"""

ERRO_INTERROMPIDO = "envio interrompido pelo admin"


class NaoEncontrada(Exception):
    pass


class EstadoInvalido(Exception):
    def __init__(self, atual: str):
        super().__init__(atual)
        self.atual = atual


async def _recusar(conn, campanha_id: str):
    """A transição perdeu (zero linhas): 404 ou 409 com o estado de agora."""
    atual = await conn.fetchval(
        "SELECT status FROM campaigns WHERE id = $1::uuid", campanha_id)
    if atual is None:
        raise NaoEncontrada(campanha_id)
    raise EstadoInvalido(atual)


async def _transicao(conn, campanha_id: str, de: tuple[str, ...], para: str) -> None:
    # ⚠️ A condição de origem é reavaliada NO UPDATE: entre o clique e a
    # requisição a fila pode ter drenado e a campanha virado 'sent'.
    feito = await conn.fetchval(
        """UPDATE campaigns SET status = $3, updated_at = now()
            WHERE id = $1::uuid AND status = ANY($2::text[])
        RETURNING id""",
        campanha_id, list(de), para)
    if feito is None:
        await _recusar(conn, campanha_id)


async def pausar(conn, campanha_id: str) -> str:
    await _transicao(conn, campanha_id, ("sending",), "paused")
    return "paused"


async def retomar(conn, campanha_id: str) -> str:
    await _transicao(conn, campanha_id, ("paused",), "sending")
    await conn.execute(
        """INSERT INTO email_send_queue (send_id, campaign_id, lead_id)
           SELECT cs.id, cs.campaign_id, cs.lead_id
             FROM campaign_sends cs
            WHERE cs.campaign_id = $1::uuid AND cs.status = 'pending'
              AND cs.lead_id IS NOT NULL
           ON CONFLICT (send_id) DO NOTHING""",
        campanha_id)
    return "sending"


async def parar(conn, campanha_id: str) -> dict:
    # Volta para 'sending' (se estava pausada) porque o finalize só fecha a
    # partir dali. Tudo na mesma transação de quem chama: ninguém vê o meio.
    await _transicao(conn, campanha_id, ("sending", "paused"), "sending")
    await conn.execute(
        "DELETE FROM email_send_queue WHERE campaign_id = $1::uuid", campanha_id)
    r = await conn.execute(
        """UPDATE campaign_sends SET status = 'suppressed', sent_at = now(),
               error = $2
            WHERE campaign_id = $1::uuid AND status = 'pending'""",
        campanha_id, ERRO_INTERROMPIDO)
    interrompidos = int(r.split()[-1])
    await conn.fetchval("SELECT finalize_campaign_if_drained($1::uuid)", campanha_id)
    status = await conn.fetchval(
        "SELECT status FROM campaigns WHERE id = $1::uuid", campanha_id)
    return {"status": status, "interrompidos": interrompidos}
