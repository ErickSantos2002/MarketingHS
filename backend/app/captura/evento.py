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

Desde a prova do RD (migration 027) o evento leva também o formulário
(`form_id`) e o site de fora (`site_id`) — é por eles que a jornada filtra a
conversão que chega de outro domínio, como filtra a landing pela página.

O gatilho `trg_contact_event_journey` copia o evento para `journey_events`; o
worker chama `journey_enroll_event(lead, tipo, metadata)`, que aplica o filtro
`entry_config.page_slug` / `entry_config.form_ids` do fluxo.
"""

CHAVE_DA_PAGINA = "marketinghs.page_slug"
CHAVE_DO_FORMULARIO = "marketinghs.form_id"
CHAVE_DO_SITE = "marketinghs.site_id"
# 036 (agendamento, 28/10): a conversão veio de um agendamento CONFIRMADO. O
# `fn_lead_insert_event` põe a marca no metadata, e a `journey_enroll_event`
# não matricula o lead em jornada com nó `handoff_growthhs` — o agendamento
# já cria o card.
CHAVE_DO_AGENDAMENTO = "marketinghs.agendamento"


async def marcar_agendamento(conn, ligado: bool) -> None:
    """Marca (ou desmarca) a conversão desta transação como agendamento.
    `SET LOCAL`, como `marcar_pagina`."""
    await conn.execute("SELECT set_config($1, $2, true)", CHAVE_DO_AGENDAMENTO,
                       "true" if ligado else "")


async def marcar_pagina(conn, page_slug: str | None, *, form_id: str | None = None,
                        site_id: str | None = None) -> None:
    """Marca (ou desmarca, com `None`) a origem da conversão NESTA transação.

    `set_config(..., true)` = `SET LOCAL`: morre no fim da transação, e a
    conexão devolvida ao pool não leva a marca para o próximo pedido. Quem
    marca desmarca logo depois do INSERT, para a marca não alcançar outro
    INSERT de lead da mesma transação — por isso as três chaves andam juntas:
    `marcar_pagina(conn, None)` limpa as três.

    ⚠️ Sem a 027 no banco, `form_id` e `site_id` ficam marcados e ninguém os
    lê — inofensivo (`current_setting` de chave com ponto é livre).
    """
    await conn.execute(
        "SELECT set_config($1, $2, true), set_config($3, $4, true), "
        "set_config($5, $6, true)",
        CHAVE_DA_PAGINA, page_slug or "", CHAVE_DO_FORMULARIO, form_id or "",
        CHAVE_DO_SITE, site_id or "")


async def publicar_conversao(conn, lead_id: str, page_slug: str | None, *,
                             origem: str, form_id: str | None = None,
                             site_id: str | None = None,
                             informados: list[dict] | None = None,
                             agendamento: bool = False) -> None:
    """`form_submitted` com a origem, para contato que JÁ existia.

    `origem` vai no metadata (`captura`, `api` ou `site`) — a linha do tempo
    diz por onde a conversão entrou. Sem página (formulário de outro site), o
    título fala do formulário.

    `informados` (pergunta 73): o que a pessoa informou de DIFERENTE do
    contato (`captura.informados.divergencias`), em
    `metadata.informados_diferentes` — a linha do tempo mostra. Sem
    diferença, a chave não entra.

    `agendamento` (036): `"agendamento": true` no metadata — a reconversão
    de quem confirmou um agendamento não entra em jornada de handoff. Sem
    ele, a chave não entra.
    """
    await conn.execute(
        """INSERT INTO contact_events (lead_id, dnia_id, source_app, event_type,
                                       title, metadata)
           SELECT l.id, l.dnia_id, 'marketinghs', 'form_submitted',
                  CASE WHEN $2::text IS NOT NULL
                       THEN 'Nova conversão na página ' || $2::text
                       ELSE 'Nova conversão no formulário ' || coalesce($4::text, '?')
                  END,
                  jsonb_build_object('page_slug', $2::text, 'reconversao', true,
                                     'origem', $3::text, 'form_id', $4::text,
                                     'site_id', $5::text)
                  || CASE WHEN $6::jsonb IS NULL THEN '{}'::jsonb
                          ELSE jsonb_build_object('informados_diferentes', $6::jsonb) END
                  || CASE WHEN $7::boolean THEN jsonb_build_object('agendamento', true)
                          ELSE '{}'::jsonb END
             FROM leads l WHERE l.id = $1::uuid""",
        lead_id, page_slug, origem, form_id, site_id, informados or None, agendamento)
