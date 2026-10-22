-- 028 — Ajustes da prova do RD (frente ajustes-prova, 22/10/2026).
--
-- O ERICK RODA (`bash ~/marketinghs-migration-028.sh`). Reaplicável: só
-- CREATE OR REPLACE FUNCTION e GRANT. Rode duas vezes. Nenhuma extensão,
-- nenhuma tabela, nenhum índice — os três índices únicos de envio não são
-- tocados.
--
-- Copiada da 027 (a versão vigente) com o mínimo mudado:
--   b. `journey_enroll_event(uuid, text, jsonb)` (A4, pergunta 62): jornada
--      sem `page_slug` e sem `form_ids` NÃO matricula conversão vinda de site
--      de fora (`site_id` no metadata). Lead da landing e jornada filtrada
--      continuam como hoje.
--
-- ⚠️ ORDEM: pode ir antes ou depois do deploy — o código não muda a chamada.
-- Mas a regra (b) só vale depois de aplicada: antes de colar o snippet no
-- site institucional, ela TEM de estar no banco.


-- b. ---------------------------------------------------------------------------
-- `journey_enroll_event(uuid, text, jsonb)`: cópia FIEL da 027. Mudanças:
-- `v_site` (o `site_id` do metadata) e `AND v_site IS NULL` no ramo "sem
-- filtro". A reconversão, o contexto do run e a de 2 argumentos não mudam.
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
           END AS f_form
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
      ((NOT f_pagina AND NOT f_form AND v_site IS NULL)
       OR (f_pagina AND entry_config->>'page_slug' = v_pagina)
       OR (f_form AND v_form IS NOT NULL
           AND jsonb_typeof(entry_config->'form_ids') = 'array'
           AND entry_config->'form_ids' ? v_form))
      -- 026: a RECONVERSÃO (contato que já existia converte de novo) só
      -- matricula em fluxo FILTRADO (027: por página ou por formulário). Fluxo
      -- sem filtro continua como antes do R5: só o lead novo entra — um
      -- "boas-vindas" não pode passar a disparar para a base inteira que
      -- reconverter.
      AND ((f_pagina OR f_form)
           OR NOT coalesce((p_metadata->>'reconversao')::boolean, false))
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
