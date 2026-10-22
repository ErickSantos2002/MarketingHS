-- 028 — Ajustes da prova do RD (frente ajustes-prova, 22/10/2026).
--
-- O ERICK RODA (`bash ~/marketinghs-migration-028.sh`). Reaplicável: só
-- CREATE OR REPLACE FUNCTION e GRANT. Rode duas vezes. Nenhuma extensão,
-- nenhuma tabela, nenhum índice — os três índices únicos de envio não são
-- tocados.
--
-- Duas funções, cada uma copiada da 027 (a versão vigente) com o mínimo
-- mudado:
--   a. `validate_journey_graph` (A7): `branch_attribute` sem `config.rules`
--      é recusado. Antes, `jsonb_typeof(NULL) <> 'array'` dava NULL e o IF
--      passava calado — o nó entrava no fluxo sem regra nenhuma;
--   b. `journey_enroll_event(uuid, text, jsonb)` (A4, pergunta 62): jornada
--      sem `page_slug` e sem `form_ids` NÃO matricula conversão vinda de site
--      de fora (`site_id` no metadata). Lead da landing e jornada filtrada
--      continuam como hoje.
--
-- ⚠️ ORDEM: pode ir antes ou depois do deploy — o código não muda a chamada.
-- Mas a regra (b) só vale depois de aplicada: antes de colar o snippet no
-- site institucional, ela TEM de estar no banco.


-- a. ---------------------------------------------------------------------------
-- `validate_journey_graph`: cópia FIEL da 027. Única mudança: o `coalesce` no
-- `branch_attribute`.
CREATE OR REPLACE FUNCTION public.validate_journey_graph(p_nodes jsonb, p_entry_node_id text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_ids   text[];
  v_node  jsonb;
  v_id    text;
  v_type  text;
  v_ref   text;
  v_cycle boolean;
BEGIN
  IF p_nodes IS NULL OR jsonb_typeof(p_nodes) <> 'array' THEN
    RAISE EXCEPTION 'journeys.nodes deve ser um array jsonb';
  END IF;
  IF jsonb_array_length(p_nodes) = 0 THEN
    RETURN;
  END IF;

  SELECT array_agg(n->>'id') INTO v_ids FROM jsonb_array_elements(p_nodes) n;

  IF EXISTS (SELECT 1 FROM unnest(v_ids) x WHERE x IS NULL OR btrim(x) = '') THEN
    RAISE EXCEPTION 'todo no precisa de um "id" nao vazio';
  END IF;
  IF (SELECT count(*) FROM unnest(v_ids)) <> (SELECT count(DISTINCT x) FROM unnest(v_ids) x) THEN
    RAISE EXCEPTION 'ids de no duplicados';
  END IF;
  IF p_entry_node_id IS NULL OR NOT (p_entry_node_id = ANY(v_ids)) THEN
    RAISE EXCEPTION 'entry_node_id % nao existe em nodes', coalesce(p_entry_node_id, '(null)');
  END IF;

  FOR v_node IN SELECT n FROM jsonb_array_elements(p_nodes) n
  LOOP
    v_id   := v_node->>'id';
    v_type := v_node->>'type';

    IF v_type IS NULL OR v_type NOT IN
       ('send_email','delay','wait_for_event','branch_attribute','branch_segment','branch_email_event','apply_tag','handoff_growthhs',
        'change_status','remove_tag',
        'notify_email','webhook') THEN
      RAISE EXCEPTION 'tipo de no invalido: % (no %)', coalesce(v_type, '(null)'), v_id;
    END IF;

    FOREACH v_ref IN ARRAY ARRAY[v_node->>'next', v_node->>'next_false', v_node->>'next_timeout']
    LOOP
      IF v_ref IS NOT NULL AND NOT (v_ref = ANY(v_ids)) THEN
        RAISE EXCEPTION 'no % aponta para "%" que nao existe', v_id, v_ref;
      END IF;
    END LOOP;

    CASE v_type
      WHEN 'send_email' THEN
        IF coalesce(v_node#>>'{config,template_id}', '') = ''
           OR coalesce(v_node#>>'{config,subject}', '') = '' THEN
          RAISE EXCEPTION 'no % (send_email) exige config.template_id e config.subject', v_id;
        END IF;
      WHEN 'delay' THEN
        IF coalesce((v_node#>>'{config,minutes}')::numeric, 0) <= 0 THEN
          RAISE EXCEPTION 'no % (delay) exige config.minutes > 0', v_id;
        END IF;
      WHEN 'wait_for_event' THEN
        IF coalesce(v_node#>>'{config,event_type}', '') = ''
           OR coalesce((v_node#>>'{config,timeout_minutes}')::numeric, 0) <= 0 THEN
          RAISE EXCEPTION 'no % (wait_for_event) exige config.event_type e config.timeout_minutes > 0', v_id;
        END IF;
      WHEN 'branch_attribute' THEN
        -- 028: `coalesce` no jsonb_typeof, como no notify_email da 027: sem
        -- ele, config sem `rules` dava NULL e o IF passava calado.
        IF coalesce(jsonb_typeof(v_node#>'{config,rules}'), '') <> 'array'
           OR jsonb_array_length(v_node#>'{config,rules}') = 0 THEN
          RAISE EXCEPTION 'no % (branch_attribute) exige config.rules nao vazio', v_id;
        END IF;
      WHEN 'branch_segment' THEN
        IF coalesce(v_node#>>'{config,segment_id}', '') = '' THEN
          RAISE EXCEPTION 'no % (branch_segment) exige config.segment_id', v_id;
        END IF;
      WHEN 'branch_email_event' THEN
        IF coalesce(v_node#>>'{config,source_node_id}', '') = '' THEN
          RAISE EXCEPTION 'no % (branch_email_event) exige config.source_node_id', v_id;
        END IF;
        IF coalesce(v_node#>>'{config,check}', '') NOT IN ('delivered','opened','clicked') THEN
          RAISE EXCEPTION 'no % (branch_email_event) exige config.check em (delivered,opened,clicked)', v_id;
        END IF;
      WHEN 'apply_tag' THEN
        IF coalesce(v_node#>>'{config,tag_name}', '') = '' THEN
          RAISE EXCEPTION 'no % (apply_tag) exige config.tag_name', v_id;
        END IF;
      -- 026: os dois nós novos (R5).
      WHEN 'remove_tag' THEN
        IF coalesce(v_node#>>'{config,tag_name}', '') = '' THEN
          RAISE EXCEPTION 'no % (remove_tag) exige config.tag_name', v_id;
        END IF;
      WHEN 'change_status' THEN
        IF coalesce(v_node#>>'{config,status}', '') = '' THEN
          RAISE EXCEPTION 'no % (change_status) exige config.status', v_id;
        END IF;
        -- ⚠️ A existência do status em `lead_statuses` NÃO é checada aqui:
        -- este gatilho roda em TODO UPDATE de `journeys` (pausar inclusive), e
        -- um status apagado depois travaria até a pausa do fluxo. Quem recusa
        -- é o executor, com o run em `failed` e o motivo à vista.
      -- 027: os dois nós de saída (prova do RD). `coalesce` no jsonb_typeof:
      -- sem ele, config sem `emails` daria NULL e o IF passaria calado.
      WHEN 'notify_email' THEN
        IF coalesce(jsonb_typeof(v_node#>'{config,emails}'), '') <> 'array'
           OR jsonb_array_length(v_node#>'{config,emails}') = 0 THEN
          RAISE EXCEPTION 'no % (notify_email) exige config.emails nao vazio', v_id;
        END IF;
      WHEN 'webhook' THEN
        IF coalesce(v_node#>>'{config,url}', '') !~* '^https://[^/[:space:]]+' THEN
          RAISE EXCEPTION 'no % (webhook) exige config.url com https://', v_id;
        END IF;
      ELSE NULL;
    END CASE;
  END LOOP;

  WITH RECURSIVE edges AS (
    SELECT n->>'id' AS src, e AS dst
    FROM jsonb_array_elements(p_nodes) n
    CROSS JOIN LATERAL (VALUES (n->>'next'), (n->>'next_false'), (n->>'next_timeout')) AS v(e)
    WHERE e IS NOT NULL
  ),
  walk AS (
    SELECT e.src, e.dst, ARRAY[e.src] AS path, false AS cyclic
    FROM edges e
    UNION ALL
    SELECT w.dst, e.dst, w.path || w.dst, (e.dst = ANY(w.path || w.dst))
    FROM walk w
    JOIN edges e ON e.src = w.dst
    WHERE NOT w.cyclic AND array_length(w.path, 1) < 200
  )
  SELECT EXISTS (SELECT 1 FROM walk WHERE cyclic) INTO v_cycle;

  IF v_cycle THEN
    RAISE EXCEPTION 'o grafo do fluxo tem ciclo';
  END IF;
END;
$$;


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
