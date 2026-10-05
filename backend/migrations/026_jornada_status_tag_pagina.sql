-- 026 — R5 sem decisão (frente r5-jornadas, 05/10/2026): nós "mudar status" e
-- "remover tag", e o evento de conversão que carrega a página.
--
-- O ERICK RODA (`bash ~/marketinghs-migration-026.sh`). Reaplicável: só
-- CREATE OR REPLACE FUNCTION e GRANT. Rode duas vezes.
--
-- ⚠️ APLICAR ANTES DO DEPLOY da API/worker com o R5. Sem ela:
--   - o construtor deixa montar "Mudar status"/"Remover tag" e o banco recusa
--     ao salvar (`tipo de no invalido`) — erro à vista, nada se perde;
--   - o worker cai na `journey_enroll_event` de 2 argumentos (ver
--     `app/worker.py`), que IGNORA o filtro de página: um fluxo filtrado por
--     página entraria com a conversão de QUALQUER página.
--
-- Três funções, cada uma copiada do banco com o mínimo mudado:
--
--   1. `validate_journey_graph` (018): aceita `change_status` (exige
--      config.status) e `remove_tag` (exige config.tag_name).
--   2. `fn_lead_insert_event` (005): o `form_submitted` do INSERT de lead leva
--      `page_slug` no metadata quando a transação marcou a página com
--      `set_config('marketinghs.page_slug', ..., true)` — é o que a captura
--      faz. Quem não marca (importação, DataCore, painel, API de contato) grava
--      `page_slug: null`.
--   3. `journey_enroll_event(uuid, text, jsonb)` (NOVA, sobrecarga): igual à
--      de 2 argumentos (001) mais o filtro `entry_config.page_slug`. Sem
--      filtro = qualquer página (o comportamento de antes). A de 2 argumentos
--      passa a chamar a nova com metadata vazio — fluxo FILTRADO não casa com
--      evento sem página, que é o lado seguro para um worker antigo.

-- 1. -------------------------------------------------------------------------
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
        'change_status','remove_tag') THEN
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
        IF jsonb_typeof(v_node#>'{config,rules}') <> 'array'
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


-- 2. -------------------------------------------------------------------------
-- Cópia FIEL da 005 (que é cópia do banco); a única mudança é a chave
-- `page_slug` no metadata.
CREATE OR REPLACE FUNCTION public.fn_lead_insert_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO contact_events (lead_id, dnia_id, source_app, event_type, title, metadata)
  VALUES (
    NEW.id,
    NEW.dnia_id,
    'marketinghs',
    'form_submitted',
    'Lead capturado via ' || COALESCE(NEW.source, 'formulário'),
    jsonb_build_object(
      'source', NEW.source,
      'utm_source', NEW.utm_source,
      'utm_medium', NEW.utm_medium,
      'utm_campaign', NEW.utm_campaign,
      'utm_term', NEW.utm_term,
      'utm_content', NEW.utm_content,
      'etiqueta', NEW.etiqueta,
      -- 026: a página da conversão, marcada pela transação da captura.
      'page_slug', NULLIF(current_setting('marketinghs.page_slug', true), '')
    )
  );
  RETURN NEW;
END;
$$;


-- 3. -------------------------------------------------------------------------
-- Corpo da de 2 argumentos (001_schema_origem.sql), copiado. Mudanças:
--   - o filtro de página no CTE `j`;
--   - `page_slug` no contexto do run (rastro de por qual página entrou).
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
BEGIN
  IF p_lead_id IS NULL OR coalesce(p_event_type, '') = '' THEN
    RETURN 0;
  END IF;

  WITH j AS (
    SELECT id, entry_node_id, reentry, reentry_cooldown_hours
    FROM public.journeys
    WHERE status = 'active'
      AND entry_type = 'event'
      AND entry_config->>'event_type' = p_event_type
      AND entry_node_id IS NOT NULL
      -- 026: sem filtro, qualquer página; com filtro, só a página dele. Evento
      -- sem página nunca casa com fluxo filtrado.
      AND (coalesce(entry_config->>'page_slug', '') = ''
           OR entry_config->>'page_slug' = v_pagina)
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
    FROM cand c
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;

  RETURN v_count;
END $$;

-- A de 2 argumentos vira atalho para a nova, sem página: um worker antigo
-- continua funcionando e nunca matricula em fluxo filtrado por página.
CREATE OR REPLACE FUNCTION public.journey_enroll_event(p_lead_id uuid, p_event_type text)
RETURNS integer
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.journey_enroll_event(p_lead_id, p_event_type, '{}'::jsonb);
$$;

GRANT EXECUTE ON FUNCTION public.journey_enroll_event(uuid, text, jsonb)
  TO service_role;
