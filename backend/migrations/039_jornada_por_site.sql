-- 039 — Jornada por SITE (frente jornada-por-site, 23/11/2026).
--
-- Reaplicável: só CREATE OR REPLACE FUNCTION e GRANT. Rode duas vezes para
-- provar. Nenhuma extensão. Rodar com o dono das tabelas. ADITIVA: fluxo sem
-- `site_ids` se comporta exatamente como na 036.
--
-- Os três índices únicos que impedem e-mail duplicado (CLAUDE.md, "Banco") NÃO
-- são tocados — nem citados por nome.
--
-- Por quê: o site da agência gera um `form_id` por página (`/#form1`,
-- `/suporte#form1`, `/solucoes/acessorios#form1`, `lp-contatos`…). A jornada
-- que entrega ao comercial filtrando por LISTA de formulários deixaria página
-- nova sem card, em silêncio. `entry_config.site_ids` (lista de uuid em texto,
-- validada e normalizada em minúsculas pelo `routers/jornadas.py`) = qualquer
-- formulário desses sites.
--
-- `journey_enroll_event(uuid, text, jsonb)`: cópia FIEL da 036. Mudanças:
--   - `f_site` (o fluxo tem `site_ids` não vazio; nunca NULL, como `f_form`);
--   - casa `f_site AND v_site IS NOT NULL AND site_ids ? v_site`, em OU com
--     página e formulário;
--   - "qualquer origem" exige também `NOT f_site` (e continua sem incluir
--     site de fora — 028);
--   - fluxo por site conta como filtrado: a reconversão entra nele (026).
-- O resto (036: agendamento confirmado não entra em fluxo com
-- `handoff_growthhs`) fica igual.
--
-- O `site_id` já chega no metadata pelos dois caminhos: o gatilho de INSERT
-- `fn_lead_insert_event` (036, `marketinghs.site_id`) e o `publicar_conversao`
-- da reconversão (`app/captura/evento.py`). Nada muda neles.

CREATE OR REPLACE FUNCTION public.journey_enroll_event(
  p_lead_id    uuid,
  p_event_type text,
  p_metadata   jsonb          -- sem DEFAULT: com default, a chamada de 2
                              -- argumentos ficaria ambígua entre as duas
) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_count  integer := 0;
  v_pagina text := NULLIF(btrim(coalesce(p_metadata->>'page_slug', '')), '');
  v_form   text := NULLIF(btrim(coalesce(p_metadata->>'form_id', '')), '');  -- 027
  v_site   text := NULLIF(btrim(coalesce(p_metadata->>'site_id', '')), '');  -- 028
  -- 036: a marca vem como texto 'true' do gatilho de INSERT e como boolean
  -- da reconversão — `->>` dá 'true' nos dois.
  v_agendamento boolean := coalesce(p_metadata->>'agendamento', '') = 'true';
BEGIN
  IF p_lead_id IS NULL OR coalesce(p_event_type, '') = '' THEN
    RETURN 0;
  END IF;

  WITH j0 AS (
    SELECT id, entry_node_id, reentry, reentry_cooldown_hours, entry_config,
           -- 027: o fluxo tem filtro de página? de formulário? Os dois são
           -- boolean de verdade, nunca NULL: NULL aqui viraria "não casa" no
           -- fluxo SEM filtro (NOT NULL = NULL). O CASE garante que o
           -- jsonb_array_length só roda em lista.
           coalesce(entry_config->>'page_slug', '') <> '' AS f_pagina,
           CASE coalesce(jsonb_typeof(entry_config->'form_ids'), 'null')
             WHEN 'null'  THEN false
             WHEN 'array' THEN jsonb_array_length(entry_config->'form_ids') > 0
             ELSE true
           END AS f_form,
           -- 039: filtro por SITE — qualquer formulário dos sites listados,
           -- inclusive o de página que ainda não existe. Mesmo cuidado do
           -- f_form: boolean de verdade, nunca NULL.
           CASE coalesce(jsonb_typeof(entry_config->'site_ids'), 'null')
             WHEN 'null'  THEN false
             WHEN 'array' THEN jsonb_array_length(entry_config->'site_ids') > 0
             ELSE true
           END AS f_site,
           -- 036: o fluxo entrega ao comercial? Nunca NULL (pelo mesmo motivo).
           coalesce(jsonb_typeof(nodes) = 'array'
                    AND nodes @> '[{"type": "handoff_growthhs"}]'::jsonb, false)
             AS tem_handoff
    FROM public.journeys
    WHERE status = 'active'
      AND entry_type = 'event'
      AND entry_config->>'event_type' = p_event_type
      AND entry_node_id IS NOT NULL
  ), j AS (
    SELECT id, entry_node_id, reentry, reentry_cooldown_hours
    FROM j0
    WHERE
      -- 026/027: sem filtro, qualquer origem; com filtro, a página dele OU um
      -- dos formulários dele. Evento sem página nem formulário nunca casa com
      -- fluxo filtrado.
      -- 028 (pergunta 62): "qualquer origem" NÃO inclui site de fora. Evento
      -- com `site_id` só entra em fluxo que nomeia o formulário (ou a página):
      -- colado o snippet no site institucional, todo cliente que pede
      -- cotação publica `form_submitted`, e um "boas-vindas" sem filtro
      -- passaria a disparar para ele.
      -- 039: ou um dos SITES dele. Filtros combinados são OU, como página e
      -- formulário já eram. "Qualquer origem" continua sem incluir site (028).
      ((NOT f_pagina AND NOT f_form AND NOT f_site AND v_site IS NULL)
       OR (f_pagina AND entry_config->>'page_slug' = v_pagina)
       OR (f_form AND v_form IS NOT NULL
           AND jsonb_typeof(entry_config->'form_ids') = 'array'
           AND entry_config->'form_ids' ? v_form)
       OR (f_site AND v_site IS NOT NULL
           AND jsonb_typeof(entry_config->'site_ids') = 'array'
           AND entry_config->'site_ids' ? v_site))
      -- 026: a RECONVERSÃO (contato que já existia converte de novo) só
      -- matricula em fluxo FILTRADO (027: por página ou por formulário). Fluxo
      -- sem filtro continua como antes do R5: só o lead novo entra — um
      -- "boas-vindas" não pode passar a disparar para a base inteira que
      -- reconverter. 039: fluxo por site também é filtrado.
      AND ((f_pagina OR f_form OR f_site)
           OR NOT coalesce((p_metadata->>'reconversao')::boolean, false))
      -- 036: quem confirmou um agendamento já tem card (o agendamento o
      -- cria); a jornada que entrega ao comercial criaria o segundo.
      AND NOT (v_agendamento AND tem_handoff)
  ), cand AS (
    SELECT j.id AS journey_id, j.entry_node_id
    FROM j
    WHERE NOT EXISTS (
      SELECT 1 FROM public.journey_runs r
       WHERE r.journey_id = j.id
         AND r.lead_id = p_lead_id
         AND (
               j.reentry = 'once'
            OR r.state IN ('active','waiting')
            OR r.updated_at > now() - make_interval(hours => j.reentry_cooldown_hours)
         )
    )
  ), ins AS (
    INSERT INTO public.journey_runs (journey_id, lead_id, current_node_id, state, wakeup_at, context)
    SELECT c.journey_id, p_lead_id, c.entry_node_id, 'active', now(),
           jsonb_build_object('entry', 'event', 'event_type', p_event_type)
           || CASE WHEN v_pagina IS NULL THEN '{}'::jsonb
                   ELSE jsonb_build_object('page_slug', v_pagina) END
           -- 027: por qual formulário entrou.
           || CASE WHEN v_form IS NULL THEN '{}'::jsonb
                   ELSE jsonb_build_object('form_id', v_form) END
    FROM cand c
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;

  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.journey_enroll_event(uuid, text, jsonb)
  TO service_role;
