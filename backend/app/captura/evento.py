"""O evento de conversão que as jornadas escutam (R5, 05/10/2026).

`form_submitted` é o evento de entrada "Formulário enviado". Até o R5 ele só
existia no INSERT do lead (`fn_lead_insert_event`): o contato que já estava na
base e voltava para pedir demonstração não publicava nada, e jornada nenhuma
podia reagir. E nenhum dos dois carregava a página — o gatilho não tinha como
distinguir "pediu demonstração" de "baixou o e-book".

Agora:

- **lead novo**: a transação marca a página com `marcar_pagina` antes do
  INSERT, e o `fn_lead_insert_event` (migration 026) a põe no metadata. Um
  evento só, sem duplicar o do gatilho;
- **contato que já existia**: `publicar_conversao` grava um `form_submitted`
  com a página e `reconversao: true`.

O gatilho `trg_contact_event_journey` copia o evento para `journey_events`; o
worker chama `journey_enroll_event(lead, tipo, metadata)`, que aplica o filtro
`entry_config.page_slug` do fluxo.
"""

CHAVE_DA_PAGINA = "marketinghs.page_slug"


async def marcar_pagina(conn, page_slug: str | None) -> None:
    """Marca (ou desmarca, com `None`) a página da conversão NESTA transação.

    `set_config(..., true)` = `SET LOCAL`: morre no fim da transação, e a
    conexão devolvida ao pool não leva a marca para o próximo pedido. Quem
    marca desmarca logo depois do INSERT, para a marca não alcançar outro
    INSERT de lead da mesma transação.
    """
    await conn.execute("SELECT set_config($1, $2, true)",
                       CHAVE_DA_PAGINA, page_slug or "")


async def publicar_conversao(conn, lead_id: str, page_slug: str, *,
                             origem: str) -> None:
    """`form_submitted` com a página, para contato que JÁ existia.

    `origem` vai no metadata (`captura` ou `api`) — a linha do tempo diz por
    onde a conversão entrou.
    """
    await conn.execute(
        """INSERT INTO contact_events (lead_id, dnia_id, source_app, event_type,
                                       title, metadata)
           SELECT l.id, l.dnia_id, 'marketinghs', 'form_submitted',
                  'Nova conversão na página ' || $2::text,
                  jsonb_build_object('page_slug', $2::text, 'reconversao', true,
                                     'origem', $3::text)
             FROM leads l WHERE l.id = $1::uuid""",
        lead_id, page_slug, origem)
