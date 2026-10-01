"""A marca de "operação em massa": a transação que só atualiza dado.

Decisão 6 do Erick (01/10/2026): recálculo de pontuação e sincronização do
DataCore **não disparam automação** — nem regra de automação (entrega ao
comercial pelo `crm_handoffs`) nem entrada em fluxo por evento. Quem dispara é
o evento individual: captura, mudança manual de status, edição do contato.

A automação mora em gatilhos do banco (migrations 019/020 e 010), que pegam
TODO caminho de escrita em `leads` — de propósito, para nenhuma rota esquecer.
Por isso a exceção também tem de ser lida lá dentro: a transação em massa se
marca com `SET LOCAL`, e as duas funções de gatilho saem cedo quando veem a
marca (migration 023).

⚠️ `SET LOCAL` só vale DENTRO de transação, e morre no fim dela — conexão
devolvida ao pool não carrega a marca para o pedido seguinte. Fora de
transação o Postgres só avisa e ignora: chame sempre dentro de `sessao()`.

A 023 foi aplicada em 01/10/2026; num banco sem ela a marca é inerte
(nenhuma função a lê) — `test_automacao_em_massa.py` fica vermelho.
"""

MARCA = "marketinghs.sem_automacao"


async def marcar_sem_automacao(conn) -> None:
    """Marca a transação corrente: o que ela escrever em `leads` e
    `contact_events` não dispara regra de automação nem fila de jornada."""
    # set_config(..., true) é o SET LOCAL em forma de função — aceita o nome
    # como parâmetro em vez de montar SQL com ele.
    await conn.execute("SELECT set_config($1, 'on', true)", MARCA)
