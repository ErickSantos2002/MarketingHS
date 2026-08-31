--
-- PostgreSQL database dump
--

\restrict omrKdr0Z4YvTdoka89GvV59JiIPAJ2pPCMHCafbiDpOcOeW1Zd9hd6PkxTiB7xi

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'admin',
    'user'
);


--
-- Name: ab_activate_test(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ab_activate_test(p_test_id uuid, p_force boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_public_slug text;
  v_conflict_id uuid;
  v_conflict_name text;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  SELECT public_slug INTO v_public_slug
    FROM public.ab_tests WHERE id = p_test_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'test not found';
  END IF;

  SELECT id, name INTO v_conflict_id, v_conflict_name
    FROM public.ab_tests
   WHERE public_slug = v_public_slug
     AND status = 'running'
     AND id <> p_test_id
   FOR UPDATE;

  IF v_conflict_id IS NOT NULL THEN
    IF NOT p_force THEN
      RETURN jsonb_build_object(
        'activated', false,
        'conflict_id', v_conflict_id,
        'conflict_name', v_conflict_name
      );
    END IF;
    UPDATE public.ab_tests
       SET status = 'completed', ends_at = COALESCE(ends_at, now())
     WHERE id = v_conflict_id;
  END IF;

  UPDATE public.ab_tests
     SET status = 'running', starts_at = COALESCE(starts_at, now())
   WHERE id = p_test_id;

  RETURN jsonb_build_object(
    'activated', true,
    'completed_id', CASE WHEN p_force THEN v_conflict_id END,
    'completed_name', CASE WHEN p_force THEN v_conflict_name END
  );
END;
$$;


--
-- Name: build_segment_condition(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.build_segment_condition(p_rule jsonb) RETURNS text
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $_$
DECLARE
  v_field    TEXT := p_rule->>'field';
  v_operator TEXT := p_rule->>'operator';
  v_val      TEXT := p_rule->>'value';
  v_cond     TEXT;
  v_from     TEXT;
  v_to       TEXT;
  v_col      TEXT;
  v_variants TEXT;
BEGIN
  CASE v_field
    WHEN 'tag' THEN
      IF v_val ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_cond := 'EXISTS (SELECT 1 FROM lead_tags lt WHERE lt.lead_id = leads.id AND lt.tag_id = '
                   || quote_literal(v_val) || '::uuid)';
      ELSE
        v_cond := 'EXISTS (SELECT 1 FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id'
                   || ' WHERE lt.lead_id = leads.id AND t.name = ' || quote_literal(v_val) || ')';
      END IF;
      IF v_operator = 'is_not' THEN
        v_cond := '(NOT ' || v_cond || ')';
      END IF;

    WHEN 'etiqueta' THEN
      IF v_operator = 'is' THEN
        v_cond := 'etiqueta = ' || quote_literal(v_val);
      ELSE
        v_cond := 'etiqueta != ' || quote_literal(v_val);
      END IF;
    WHEN 'qualificacao' THEN
      IF v_val = 'hot' THEN
        IF v_operator = 'is' THEN v_cond := 'etiqueta = ''hotlead'''; ELSE v_cond := '(etiqueta IS NULL OR etiqueta != ''hotlead'')'; END IF;
      ELSIF v_val = 'warm' THEN
        IF v_operator = 'is' THEN v_cond := 'etiqueta = ''warm'''; ELSE v_cond := '(etiqueta IS NULL OR etiqueta != ''warm'')'; END IF;
      ELSIF v_val = 'raw' THEN
        IF v_operator = 'is' THEN v_cond := 'etiqueta IS NULL'; ELSE v_cond := 'etiqueta IS NOT NULL'; END IF;
      ELSE
        v_cond := 'FALSE';
      END IF;
    WHEN 'status' THEN
      IF v_operator = 'is' THEN v_cond := 'status = ' || quote_literal(v_val);
      ELSE v_cond := 'status != ' || quote_literal(v_val); END IF;
    WHEN 'tipo' THEN
      IF v_operator = 'is' THEN v_cond := 'tipo = ' || quote_literal(v_val);
      ELSE v_cond := 'tipo != ' || quote_literal(v_val); END IF;
    WHEN 'cargo' THEN
      IF v_operator = 'contains' THEN v_cond := 'cargo ILIKE ' || quote_literal('%' || v_val || '%');
      ELSE v_cond := 'cargo NOT ILIKE ' || quote_literal('%' || v_val || '%'); END IF;

    WHEN 'faturamento' THEN
      v_variants := CASE v_val
        WHEN 'ate-100k' THEN
          quote_literal('Até 100k/mês') || ',' ||
          quote_literal('Ate 100k/mes') || ',' ||
          quote_literal('Até R$ 100 mil por mês') || ',' ||
          quote_literal('ate-100k')
        WHEN '100k-500k' THEN
          quote_literal('Entre 100k e 500k/mês') || ',' ||
          quote_literal('Entre 100k e 500k/mes') || ',' ||
          quote_literal('Entre R$ 100 mil e R$ 500 mil por mês') || ',' ||
          quote_literal('100k-500k')
        WHEN '500k-1mm' THEN
          quote_literal('Entre 500k e 1MM/mês') || ',' ||
          quote_literal('Entre 500k e 1MM/mes') || ',' ||
          quote_literal('Entre R$ 500 mil e R$ 1 milhão por mês') || ',' ||
          quote_literal('500k-1mm')
        WHEN '1mm-3mm' THEN
          quote_literal('Entre 1MM e 3MM/mês') || ',' ||
          quote_literal('Entre 1MM e 3MM/mes') || ',' ||
          quote_literal('Entre R$ 1 milhão e R$ 3 milhões por mês') || ',' ||
          quote_literal('1mm-3mm')
        WHEN '3mm-5mm' THEN
          quote_literal('Entre 3MM e 5MM/mês') || ',' ||
          quote_literal('Entre 3MM e 5MM/mes') || ',' ||
          quote_literal('Entre R$ 3 milhões e R$ 5 milhões por mês') || ',' ||
          quote_literal('3mm-5mm')
        WHEN 'acima-5mm' THEN
          quote_literal('Acima de 5MM/mês') || ',' ||
          quote_literal('Acima de 5MM/mes') || ',' ||
          quote_literal('Acima de R$ 5 milhões por mês') || ',' ||
          quote_literal('acima-5mm')
        ELSE NULL
      END;

      IF v_variants IS NOT NULL THEN
        IF v_operator = 'is_not' THEN
          v_cond := '(faturamento IS NULL OR faturamento NOT IN (' || v_variants || '))';
        ELSE
          v_cond := 'faturamento IN (' || v_variants || ')';
        END IF;
      ELSE
        IF v_operator = 'gt' THEN v_cond := 'faturamento > ' || quote_literal(v_val);
        ELSIF v_operator = 'lt' THEN v_cond := 'faturamento < ' || quote_literal(v_val);
        ELSIF v_operator = 'is_not' THEN v_cond := 'faturamento != ' || quote_literal(v_val);
        ELSE v_cond := 'faturamento = ' || quote_literal(v_val);
        END IF;
      END IF;

    WHEN 'created_at', 'last_conversion_date' THEN
      v_col := v_field;
      IF v_val ~ '^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$' THEN
        v_from := split_part(v_val, '..', 1);
        v_to   := split_part(v_val, '..', 2);
        v_cond := v_col || ' >= ' || quote_literal(v_from) || '::timestamptz AND '
               || v_col || ' < (' || quote_literal(v_to) || '::date + 1)::timestamptz';
      ELSE
        v_cond := v_col || ' >= NOW() - INTERVAL ' || quote_literal(v_val || ' days');
      END IF;

    WHEN 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term' THEN
      IF v_operator = 'exact' THEN
        v_cond := v_field || ' = ' || quote_literal(v_val);
      ELSE
        v_cond := v_field || ' ILIKE ' || quote_literal('%' || v_val || '%');
      END IF;

    WHEN 'page_slug' THEN
      v_cond := 'source = ' || quote_literal(v_val);

    WHEN 'email_opened' THEN
      v_cond := 'EXISTS (SELECT 1 FROM email_events ee WHERE ee.lead_id = leads.id AND ee.campaign_id = '
                 || quote_literal(v_val) || '::uuid AND ee.event_type = ''email.opened'')';
    WHEN 'email_clicked' THEN
      v_cond := 'EXISTS (SELECT 1 FROM email_events ee WHERE ee.lead_id = leads.id AND ee.campaign_id = '
                 || quote_literal(v_val) || '::uuid AND ee.event_type = ''email.clicked'')';
    WHEN 'email_engagement' THEN
      v_cond := 'EXISTS (SELECT 1 FROM email_events ee WHERE ee.lead_id = leads.id AND ee.event_type IN (''email.opened'', ''email.clicked'') AND ee.occurred_at >= NOW() - INTERVAL '
                 || quote_literal(v_val || ' days') || ')';
    WHEN 'event_type' THEN
      v_cond := 'EXISTS (SELECT 1 FROM contact_events ce WHERE ce.lead_id = leads.id AND ce.event_type = '
                 || quote_literal(v_val) || ')';
    ELSE
      v_cond := NULL;
  END CASE;

  RETURN v_cond;
END; $_$;


--
-- Name: classify_lead_etiqueta(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.classify_lead_etiqueta() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $_$
DECLARE
  meets_revenue BOOLEAN := FALSE;
  meets_decision BOOLEAN := FALSE;
  faturamento_lower TEXT;
  cargo_lower TEXT;
BEGIN
  faturamento_lower := LOWER(COALESCE(NEW.faturamento, ''));
  cargo_lower := LOWER(COALESCE(NEW.cargo, ''));
  
  -- Verificar faturamento ICP (>= 100k/mês ou >= 1.5M/ano)
  IF faturamento_lower ~ '(entre 100k|entre 500k|entre 1mm|entre 3mm|acima de 5mm|acima de 1mm|acima de 3mm|acima de 100k|acima de 500k|mais de 100k|mais de 500k|mais de 1mm|de r\$ 1 milhão|de r\$ 5 milhões|de r\$ 10 milhões|acima de r\$ 50 milhões|acima de r\$ 1 milhão|acima de r\$ 5 milhões|mais de r\$ 1 milhão|mais de 1 milhão|mais de 5 milhões|entre r\$ 100 mil|entre r\$ 500 mil|entre r\$ 1 milhão|entre r\$ 3 milhões|acima de r\$ 5 milhões)' THEN
    meets_revenue := TRUE;
  END IF;
  
  -- Verificar cargo decisor usando WORD BOUNDARIES (\y) para evitar falsos positivos
  IF cargo_lower ~ '\y(ceo|fundador|cofundador|co-founder|founder|empresário|empresária|empresario|empresaria|empreendedor|empreendedora|microempreendedor|dono|dona|proprietário|proprietária|proprietario|owner|sócio|sócia|socio|socia|partner|presidente|diretor|diretora|director|cto|cfo|coo|cmo|cio|c-level|vp|vice-presidente|vice presidente|head|chief)\y' THEN
    meets_decision := TRUE;
  END IF;
  
  -- HotLead = ambos critérios atendidos
  IF meets_revenue AND meets_decision THEN
    NEW.etiqueta := 'hotlead';
  ELSE
    NEW.etiqueta := NULL;
  END IF;
  
  RETURN NEW;
END;
$_$;


--
-- Name: count_segment_audience(uuid[], uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.count_segment_audience(p_include uuid[], p_exclude uuid[] DEFAULT '{}'::uuid[]) RETURNS integer
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT count(*)::int
    FROM public.resolve_segment_audience(p_include, p_exclude, NULL);
$$;


--
-- Name: delete_integration_secret(text); Type: FUNCTION; Schema: public; Owner: -
--



--
-- Name: email_queue_delete(jsonb); Type: FUNCTION; Schema: public; Owner: -
--



--
-- Name: email_queue_read(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--



--
-- Name: email_queue_send_batch(jsonb); Type: FUNCTION; Schema: public; Owner: -
--



--
-- Name: evaluate_automation_on_etiqueta(); Type: FUNCTION; Schema: public; Owner: -
--



--
-- Name: evaluate_rules_for_lead(uuid, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.evaluate_rules_for_lead(p_lead_id uuid, p_rules jsonb, p_logic text DEFAULT 'and'::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_rule   jsonb;
  v_cond   text;
  v_conds  text[] := ARRAY[]::text[];
  v_logic  text := lower(coalesce(p_logic, 'and'));
  v_sql    text;
  v_result boolean;
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' = 'anon' THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;

  IF v_logic NOT IN ('and','or') THEN v_logic := 'and'; END IF;

  FOR v_rule IN SELECT jsonb_array_elements(coalesce(p_rules, '[]'::jsonb))
  LOOP
    v_cond := public.build_segment_condition(v_rule);
    IF v_cond IS NOT NULL THEN
      v_conds := v_conds || v_cond;
    END IF;
  END LOOP;

  IF array_length(v_conds, 1) IS NULL THEN
    RETURN false;
  END IF;

  v_sql := 'SELECT EXISTS (SELECT 1 FROM leads WHERE id = '
           || quote_literal(p_lead_id) || '::uuid AND ('
           || array_to_string(v_conds, CASE WHEN v_logic = 'or' THEN ' OR ' ELSE ' AND ' END)
           || '))';

  EXECUTE v_sql INTO v_result;
  RETURN coalesce(v_result, false);
END $$;


--
-- Name: evaluate_segment_for_lead(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.evaluate_segment_for_lead(p_lead_id uuid, p_segment_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_seg    public.segments%ROWTYPE;
  v_rule   jsonb;
  v_cond   text;
  v_conds  text[] := ARRAY[]::text[];
  v_sql    text;
  v_result boolean;
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' = 'anon' THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;

  SELECT * INTO v_seg FROM public.segments WHERE id = p_segment_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_seg.type = 'static' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.segment_contacts sc
       WHERE sc.segment_id = p_segment_id AND sc.lead_id = p_lead_id
    );
  END IF;

  FOR v_rule IN SELECT jsonb_array_elements(coalesce(v_seg.rules, '[]'::jsonb))
  LOOP
    v_cond := public.build_segment_condition(v_rule);
    IF v_cond IS NOT NULL THEN
      v_conds := v_conds || v_cond;
    END IF;
  END LOOP;

  IF array_length(v_conds, 1) IS NULL THEN
    RETURN EXISTS (SELECT 1 FROM public.leads WHERE id = p_lead_id);
  END IF;

  v_sql := 'SELECT EXISTS (SELECT 1 FROM leads WHERE id = '
           || quote_literal(p_lead_id) || '::uuid AND ('
           || array_to_string(v_conds, CASE WHEN v_seg.logic = 'or' THEN ' OR ' ELSE ' AND ' END)
           || '))';

  EXECUTE v_sql INTO v_result;
  RETURN coalesce(v_result, false);
END $$;


--
-- Name: evaluate_segment_rules(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.evaluate_segment_rules(p_segment_id uuid) RETURNS TABLE(lead_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_segment segments%ROWTYPE;
  v_rule    JSONB;
  v_cond    TEXT;
  v_conds   TEXT[] := ARRAY[]::TEXT[];
  v_where   TEXT := 'SELECT id FROM leads WHERE TRUE';
  v_joiner  TEXT;
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' = 'anon' THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;

  SELECT * INTO v_segment FROM segments WHERE id = p_segment_id;
  IF NOT FOUND OR v_segment.type = 'static' THEN
    RETURN QUERY SELECT sc.lead_id FROM segment_contacts sc WHERE sc.segment_id = p_segment_id;
    RETURN;
  END IF;

  FOR v_rule IN SELECT jsonb_array_elements(v_segment.rules)
  LOOP
    v_cond := public.build_segment_condition(v_rule);
    IF v_cond IS NOT NULL THEN
      v_conds := v_conds || v_cond;
    END IF;
  END LOOP;

  IF array_length(v_conds, 1) > 0 THEN
    v_joiner := CASE WHEN v_segment.logic = 'or' THEN ' OR ' ELSE ' AND ' END;
    v_where := v_where || ' AND (' || array_to_string(v_conds, v_joiner) || ')';
  END IF;

  RETURN QUERY EXECUTE v_where;
END; $$;


--
-- Name: execute_readonly_query(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.execute_readonly_query(query_text text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  result JSONB;
  clean_query TEXT;
  lower_q TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  clean_query := REGEXP_REPLACE(query_text, '^\s+|\s+$', '', 'g');
  clean_query := RTRIM(clean_query, ';');
  lower_q := LOWER(clean_query);

  IF NOT (lower_q LIKE 'select%' OR lower_q LIKE 'with%') THEN
    RAISE EXCEPTION 'Only SELECT/WITH queries are allowed';
  END IF;

  IF lower_q ~ '\y(insert|update|delete|drop|alter|create|truncate|grant|revoke)\y' THEN
    RAISE EXCEPTION 'Modification queries are not allowed';
  END IF;

  EXECUTE 'SELECT jsonb_agg(row_to_json(t)) FROM (' || clean_query || ') t' INTO result;
  RETURN COALESCE(result, '[]'::jsonb);
END;
$_$;


--
-- Name: finalize_campaign_if_drained(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.finalize_campaign_if_drained(p_campaign_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_pending integer;
  v_stats jsonb;
BEGIN
  SELECT count(*) FILTER (WHERE status = 'pending') INTO v_pending
  FROM public.campaign_sends WHERE campaign_id = p_campaign_id;

  IF v_pending > 0 THEN
    RETURN false;
  END IF;

  SELECT jsonb_build_object(
    'sent',       count(*) FILTER (WHERE status IN ('sent','delivered','opened','clicked','unsubscribed')),
    'delivered',  count(*) FILTER (WHERE status IN ('delivered','opened','clicked')),
    'opened',     count(*) FILTER (WHERE status IN ('opened','clicked')),
    'clicked',    count(*) FILTER (WHERE status = 'clicked'),
    'failed',     count(*) FILTER (WHERE status IN ('failed','bounced')),
    'suppressed', count(*) FILTER (WHERE status = 'suppressed')
  ) INTO v_stats
  FROM public.campaign_sends WHERE campaign_id = p_campaign_id;

  UPDATE public.campaigns
     SET status  = 'sent',
         sent_at = COALESCE(sent_at, now()),
         stats   = COALESCE(v_stats, stats)
   WHERE id = p_campaign_id
     AND status = 'sending';

  RETURN true;
END $$;


--
-- Name: fn_campaign_send_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_campaign_send_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_meta jsonb;
BEGIN
  v_meta := jsonb_build_object('campaign_id', NEW.campaign_id);
  IF NEW.journey_run_id IS NOT NULL THEN
    v_meta := v_meta || jsonb_build_object(
      'journey_run_id',  NEW.journey_run_id,
      'journey_node_id', NEW.journey_node_id
    );
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'sent' AND NEW.lead_id IS NOT NULL THEN
      INSERT INTO contact_events (lead_id, dnia_id, source_app, event_type, title, metadata)
      VALUES (NEW.lead_id, NEW.dnia_id, 'dnmarketing',
        CASE NEW.channel WHEN 'email' THEN 'email_sent' ELSE 'whatsapp_sent' END,
        'Campanha enviada via ' || NEW.channel, v_meta);
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.resend_email_id IS NULL AND NEW.resend_email_id IS NOT NULL
       AND NEW.channel = 'email' AND NEW.lead_id IS NOT NULL THEN
      INSERT INTO contact_events (lead_id, dnia_id, source_app, event_type, title, metadata)
      VALUES (NEW.lead_id, NEW.dnia_id, 'dnmarketing', 'email_sent',
              'Campanha enviada via ' || NEW.channel, v_meta);
    END IF;

    IF OLD.status IS DISTINCT FROM NEW.status THEN
      IF NEW.status = 'sent' AND OLD.status = 'pending' AND NEW.lead_id IS NOT NULL AND NEW.channel <> 'email' THEN
        INSERT INTO contact_events (lead_id, dnia_id, source_app, event_type, title, metadata)
        VALUES (NEW.lead_id, NEW.dnia_id, 'dnmarketing', 'whatsapp_sent',
                'Campanha enviada via ' || NEW.channel, v_meta);
      ELSIF NEW.status = 'delivered' AND NEW.lead_id IS NOT NULL THEN
        -- Ramo NOVO (ver cabecalho + limitacao de ordem monotonica).
        INSERT INTO contact_events (lead_id, dnia_id, source_app, event_type, title, metadata)
        VALUES (NEW.lead_id, NEW.dnia_id, 'dnmarketing', 'email_delivered',
                'Email entregue', v_meta);
      ELSIF NEW.status = 'opened' AND NEW.lead_id IS NOT NULL THEN
        INSERT INTO contact_events (lead_id, dnia_id, source_app, event_type, title, metadata)
        VALUES (NEW.lead_id, NEW.dnia_id, 'dnmarketing', 'email_opened',
                'Email aberto', v_meta);
      ELSIF NEW.status = 'clicked' AND NEW.lead_id IS NOT NULL THEN
        INSERT INTO contact_events (lead_id, dnia_id, source_app, event_type, title, metadata)
        VALUES (NEW.lead_id, NEW.dnia_id, 'dnmarketing', 'email_clicked',
                'Link clicado no email', v_meta);
      ELSIF NEW.status = 'bounced' AND NEW.lead_id IS NOT NULL THEN
        INSERT INTO contact_events (lead_id, dnia_id, source_app, event_type, title, metadata)
        VALUES (NEW.lead_id, NEW.dnia_id, 'dnmarketing', 'email_bounced',
                'Email retornou (bounce)', v_meta);
      ELSIF NEW.status = 'complained' AND NEW.lead_id IS NOT NULL THEN
        INSERT INTO contact_events (lead_id, dnia_id, source_app, event_type, title, metadata)
        VALUES (NEW.lead_id, NEW.dnia_id, 'dnmarketing', 'email_complained',
                'Email marcado como spam', v_meta);
      END IF;
    END IF;
  END IF;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_campaign_send_event: falha ao gravar contact_event (send %, lead %): %',
    NEW.id, NEW.lead_id, SQLERRM;
  RETURN NEW;
END;
$$;


--
-- Name: fn_contact_event_to_journey_queue(); Type: FUNCTION; Schema: public; Owner: -
--



--
-- Name: fn_journeys_validate(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_journeys_validate() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.validate_journey_graph(NEW.nodes, NEW.entry_node_id);

  IF NEW.status = 'active' THEN
    IF jsonb_array_length(coalesce(NEW.nodes, '[]'::jsonb)) = 0 OR NEW.entry_node_id IS NULL THEN
      RAISE EXCEPTION 'fluxo sem nos nao pode ser ativado';
    END IF;
    IF NEW.entry_type = 'segment' AND coalesce(NEW.entry_config->>'segment_id', '') = '' THEN
      RAISE EXCEPTION 'entrada por segmento exige entry_config.segment_id';
    END IF;
    IF NEW.entry_type = 'event' AND coalesce(NEW.entry_config->>'event_type', '') = '' THEN
      RAISE EXCEPTION 'entrada por evento exige entry_config.event_type';
    END IF;

    IF NEW.entry_type = 'event'
       AND NEW.reentry = 'allowed'
       AND (NEW.entry_config->>'event_type') IN ('email_sent', 'email_opened', 'email_clicked')
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(coalesce(NEW.nodes, '[]'::jsonb)) n
          WHERE n->>'type' = 'send_email'
       ) THEN
      RAISE EXCEPTION 'fluxo com entrada por "%" e reentrada permitida nao pode conter passo enviar email (auto-disparo)',
        NEW.entry_config->>'event_type';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


--
-- Name: fn_lead_insert_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_lead_insert_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO contact_events (lead_id, dnia_id, source_app, event_type, title, metadata)
  VALUES (
    NEW.id,
    NEW.dnia_id,
    'dnmarketing',
    'form_submitted',
    'Lead capturado via ' || COALESCE(NEW.source, 'formulário'),
    jsonb_build_object(
      'source', NEW.source,
      'utm_source', NEW.utm_source,
      'utm_medium', NEW.utm_medium,
      'utm_campaign', NEW.utm_campaign,
      'utm_term', NEW.utm_term,
      'utm_content', NEW.utm_content,
      'etiqueta', NEW.etiqueta
    )
  );
  RETURN NEW;
END;
$$;


--
-- Name: fn_update_last_conversion_date(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_update_last_conversion_date() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  update public.leads
     set last_conversion_date = greatest(coalesce(last_conversion_date, NEW.converted_at), NEW.converted_at),
         updated_at = now()
   where id = NEW.lead_id;
  return NEW;
end;
$$;


--
-- Name: get_integration_secret(text); Type: FUNCTION; Schema: public; Owner: -
--



--
-- Name: get_page_clarity(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_page_clarity(_slug text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(config->'clarity', '{}'::jsonb)
  from public.pages
  where slug = _slug and status = 'active'
  limit 1;
$$;


--
-- Name: guard_campaign_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_campaign_delete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_pending_count integer;
BEGIN
  IF OLD.status = 'sending' THEN
    RAISE EXCEPTION 'Nao e possivel excluir a campanha: o envio esta em andamento (status ''sending''). Aguarde a campanha terminar ou falhar antes de excluir.';
  END IF;

  SELECT count(*) INTO v_pending_count
  FROM public.campaign_sends
  WHERE campaign_id = OLD.id
    AND status = 'pending';

  IF v_pending_count > 0 THEN
    RAISE EXCEPTION 'Nao e possivel excluir a campanha: existem % envio(s) pendente(s) na fila. Aguarde o envio terminar antes de excluir.', v_pending_count;
  END IF;

  RETURN OLD;
END;
$$;


--
-- Name: guard_journey_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_journey_delete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'fluxo % nao pode ser excluido (status %)', OLD.id, OLD.status;
  END IF;
  IF EXISTS (SELECT 1 FROM public.journey_runs r WHERE r.journey_id = OLD.id) THEN
    RAISE EXCEPTION 'fluxo % ja possui execucoes', OLD.id;
  END IF;
  RETURN OLD;
END;
$$;


--
-- Name: guard_segment_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_segment_delete() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_campaign text;
  v_journey  text;
BEGIN
  SELECT c.name INTO v_campaign
    FROM public.campaigns c
   WHERE c.status IN ('draft', 'scheduled', 'sending', 'paused')
     AND (OLD.id = ANY(c.segment_ids) OR OLD.id = ANY(c.excluded_segment_ids))
   LIMIT 1;

  IF v_campaign IS NOT NULL THEN
    RAISE EXCEPTION 'Este segmento é usado pela campanha "%" (ainda não enviada). Remova-o da campanha antes de excluí-lo.', v_campaign;
  END IF;

  SELECT j.name INTO v_journey
    FROM public.journeys j
   WHERE j.status <> 'archived'
     AND j.entry_type = 'segment'
     AND (
           j.entry_config->>'segment_id' = OLD.id::text
        OR j.entry_config->'segment_ids' @> to_jsonb(OLD.id::text)
        OR j.entry_config->'excluded_segment_ids' @> to_jsonb(OLD.id::text)
     )
   LIMIT 1;

  IF v_journey IS NOT NULL THEN
    RAISE EXCEPTION 'Este segmento é usado pelo fluxo "%". Remova-o do fluxo antes de excluí-lo.', v_journey;
  END IF;

  RETURN OLD;
END $$;


--
-- Name: handle_new_user_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user_role() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  user_count INTEGER;
BEGIN
  -- Conta quantos usuários existem
  SELECT COUNT(*) INTO user_count FROM auth.users;
  
  -- Se for o primeiro usuário, torna admin
  IF user_count = 1 THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin');
  END IF;
  
  RETURN NEW;
END;
$$;


--
-- Name: has_role(uuid, public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;


--
-- Name: invoke_edge_function(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--



--
-- Name: journey_claim_due_runs(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.journey_claim_due_runs(p_limit integer DEFAULT 50, p_lease_seconds integer DEFAULT 300) RETURNS TABLE(run_id uuid, journey_id uuid, lead_id uuid, current_node_id text, state text, waiting_event text, context jsonb, lock_token uuid, nodes jsonb, reentry text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_token uuid := gen_random_uuid();
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT r.id
    FROM public.journey_runs r
    JOIN public.journeys j ON j.id = r.journey_id
    WHERE r.state IN ('active','waiting')
      AND r.wakeup_at <= now()
      AND (r.locked_until IS NULL OR r.locked_until <= now())
      AND j.status = 'active'
    ORDER BY r.wakeup_at
    LIMIT p_limit
    FOR UPDATE OF r SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.journey_runs r
       SET lock_token   = v_token,
           locked_until = now() + make_interval(secs => p_lease_seconds),
           updated_at   = now()
      FROM due
     WHERE r.id = due.id
    RETURNING r.id, r.journey_id, r.lead_id, r.current_node_id, r.state,
              r.waiting_event, r.context
  )
  SELECT c.id, c.journey_id, c.lead_id, c.current_node_id, c.state,
         c.waiting_event, c.context, v_token, j.nodes, j.reentry
  FROM claimed c
  JOIN public.journeys j ON j.id = c.journey_id;
END $$;


--
-- Name: journey_enqueue_email(uuid, text, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--



--
-- Name: journey_enroll_event(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.journey_enroll_event(p_lead_id uuid, p_event_type text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_count integer := 0;
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
    FROM cand c
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;

  RETURN v_count;
END $$;


--
-- Name: journey_enroll_segment(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.journey_enroll_segment(p_journey_id uuid, p_limit integer DEFAULT 500) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_j       public.journeys%ROWTYPE;
  v_include uuid[];
  v_exclude uuid[];
  v_count   integer := 0;
BEGIN
  SELECT * INTO v_j FROM public.journeys WHERE id = p_journey_id;
  IF NOT FOUND OR v_j.status <> 'active' OR v_j.entry_type <> 'segment' OR v_j.entry_node_id IS NULL THEN
    RETURN 0;
  END IF;

  IF jsonb_typeof(v_j.entry_config->'segment_ids') = 'array' THEN
    SELECT ARRAY(
      SELECT t.value::uuid
        FROM jsonb_array_elements_text(v_j.entry_config->'segment_ids') AS t(value)
    ) INTO v_include;
  ELSE
    v_include := CASE
      WHEN nullif(v_j.entry_config->>'segment_id', '') IS NULL THEN '{}'::uuid[]
      ELSE ARRAY[(v_j.entry_config->>'segment_id')::uuid]
    END;
  END IF;

  IF jsonb_typeof(v_j.entry_config->'excluded_segment_ids') = 'array' THEN
    SELECT ARRAY(
      SELECT t.value::uuid
        FROM jsonb_array_elements_text(v_j.entry_config->'excluded_segment_ids') AS t(value)
    ) INTO v_exclude;
  ELSE
    v_exclude := '{}'::uuid[];
  END IF;

  IF cardinality(v_include) = 0 THEN
    RETURN 0;
  END IF;

  WITH cand AS (
    SELECT a.lead_id
    FROM public.resolve_segment_audience(v_include, v_exclude, NULL) a
    WHERE NOT EXISTS (
      SELECT 1 FROM public.journey_runs r
       WHERE r.journey_id = p_journey_id
         AND r.lead_id = a.lead_id
         AND (
               v_j.reentry = 'once'
            OR r.state IN ('active','waiting')
            OR r.updated_at > now() - make_interval(hours => v_j.reentry_cooldown_hours)
         )
    )
    LIMIT p_limit
  ), ins AS (
    INSERT INTO public.journey_runs (journey_id, lead_id, current_node_id, state, wakeup_at, context)
    SELECT p_journey_id, c.lead_id, v_j.entry_node_id, 'active', now(),
           jsonb_build_object(
             'entry', 'segment',
             'segment_ids', to_jsonb(v_include),
             'excluded_segment_ids', to_jsonb(v_exclude)
           )
    FROM cand c
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;

  RETURN v_count;
END $$;


--
-- Name: journey_node_metrics(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.journey_node_metrics(p_journey_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' = 'anon' THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;

  WITH steps AS (
    SELECT node_id,
           count(DISTINCT run_id) FILTER (WHERE result = 'entered') AS entered
    FROM public.journey_step_log
    WHERE journey_id = p_journey_id
    GROUP BY node_id
  ),
  mails AS (
    SELECT cs.journey_node_id AS node_id,
           count(*)                                                          AS enqueued,
           count(*) FILTER (WHERE cs.resend_email_id IS NOT NULL)            AS sent,
           count(*) FILTER (WHERE cs.status IN ('opened','clicked'))         AS opened,
           count(*) FILTER (WHERE cs.status = 'clicked')                     AS clicked,
           count(*) FILTER (WHERE cs.status IN ('failed','bounced'))         AS failed
    FROM public.campaign_sends cs
    JOIN public.journey_runs r ON r.id = cs.journey_run_id
    WHERE r.journey_id = p_journey_id AND cs.journey_node_id IS NOT NULL
    GROUP BY cs.journey_node_id
  ),
  merged AS (
    SELECT coalesce(s.node_id, m.node_id) AS node_id,
           coalesce(s.entered, 0)         AS entered,
           jsonb_build_object(
             'enqueued', coalesce(m.enqueued, 0),
             'sent',     coalesce(m.sent, 0),
             'opened',   coalesce(m.opened, 0),
             'clicked',  coalesce(m.clicked, 0),
             'failed',   coalesce(m.failed, 0)
           ) AS emails
    FROM steps s
    FULL OUTER JOIN mails m ON m.node_id = s.node_id
  )
  SELECT coalesce(
           jsonb_object_agg(node_id, jsonb_build_object('entered', entered, 'emails', emails)),
           '{}'::jsonb
         )
    INTO v_out
  FROM merged;

  RETURN coalesce(v_out, '{}'::jsonb);
END $$;


--
-- Name: journey_queue_delete(jsonb); Type: FUNCTION; Schema: public; Owner: -
--



--
-- Name: journey_queue_read(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--



--
-- Name: journey_wake_on_event(uuid, text, timestamp with time zone, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.journey_wake_on_event(p_lead_id uuid, p_event_type text, p_occurred_at timestamp with time zone, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_count    integer := 0;
  v_deferred integer := 0;
BEGIN
  IF p_lead_id IS NULL OR coalesce(p_event_type, '') = '' THEN
    RETURN jsonb_build_object('woken', 0, 'deferred', 0);
  END IF;

  WITH upd AS (
    UPDATE public.journey_runs r
       SET state       = 'active',
           wakeup_at   = now(),
           context     = r.context
                         || jsonb_build_object('event_matched', true)
                         || jsonb_build_object('last_event', jsonb_build_object(
                              'event_type', p_event_type,
                              'occurred_at', COALESCE(p_occurred_at, now())
                            )),
           updated_at  = now()
      FROM public.journeys j,
           LATERAL (
             SELECT n
             FROM jsonb_array_elements(j.nodes) n
             WHERE n->>'id' = r.current_node_id
             LIMIT 1
           ) node
     WHERE j.id = r.journey_id
       AND j.status = 'active'
       AND r.lead_id = p_lead_id
       AND r.state = 'waiting'
       AND r.waiting_event = p_event_type
       AND (r.locked_until IS NULL OR r.locked_until <= now())
       AND COALESCE(p_occurred_at, now()) >=
           COALESCE((r.context->>'waiting_since')::timestamptz, r.entered_at)
       AND (
             coalesce(node.n#>>'{config,source_node_id}', '') = ''
             OR (
                  p_metadata->>'journey_node_id' = node.n#>>'{config,source_node_id}'
              AND p_metadata->>'journey_run_id'  = r.id::text
             )
           )
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;

  SELECT count(*) INTO v_deferred
  FROM public.journey_runs r
  JOIN public.journeys j ON j.id = r.journey_id,
  LATERAL (
    SELECT n
    FROM jsonb_array_elements(j.nodes) n
    WHERE n->>'id' = r.current_node_id
    LIMIT 1
  ) node
  WHERE j.status = 'active'
    AND r.lead_id = p_lead_id
    AND r.state = 'waiting'
    AND r.waiting_event = p_event_type
    AND r.locked_until IS NOT NULL
    AND r.locked_until > now()
    AND COALESCE(p_occurred_at, now()) >=
        COALESCE((r.context->>'waiting_since')::timestamptz, r.entered_at)
    AND (
          coalesce(node.n#>>'{config,source_node_id}', '') = ''
          OR (
               p_metadata->>'journey_node_id' = node.n#>>'{config,source_node_id}'
           AND p_metadata->>'journey_run_id'  = r.id::text
          )
        );

  RETURN jsonb_build_object('woken', v_count, 'deferred', v_deferred);
END $$;


--
-- Name: merge_identities(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merge_identities(p_keep uuid, p_discard uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_keep RECORD;
  v_discard RECORD;
BEGIN
  -- Validate both exist
  SELECT * INTO v_keep FROM ecosystem_identities WHERE dnia_id = p_keep;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Keep identity not found: %', p_keep;
  END IF;

  SELECT * INTO v_discard FROM ecosystem_identities WHERE dnia_id = p_discard;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Discard identity not found: %', p_discard;
  END IF;

  -- Re-point all references
  UPDATE leads SET dnia_id = p_keep WHERE dnia_id = p_discard;
  UPDATE contact_events SET dnia_id = p_keep WHERE dnia_id = p_discard;
  UPDATE campaign_sends SET dnia_id = p_keep WHERE dnia_id = p_discard;

  -- Merge nullable fields from discard into keep (fill blanks)
  UPDATE ecosystem_identities SET
    phone = COALESCE(phone, v_discard.phone),
    email = COALESCE(email, v_discard.email),
    nome = COALESCE(nome, v_discard.nome),
    nexus_contact_id = COALESCE(nexus_contact_id, v_discard.nexus_contact_id),
    mentoria_client_id = COALESCE(mentoria_client_id, v_discard.mentoria_client_id),
    dndash_lead_id = COALESCE(dndash_lead_id, v_discard.dndash_lead_id),
    first_touch_source = COALESCE(first_touch_source, v_discard.first_touch_source),
    first_touch_app = COALESCE(first_touch_app, v_discard.first_touch_app),
    stage = CASE
      WHEN array_position(ARRAY['lead','prospect','opportunity','client','active','churned'], stage)
           >= array_position(ARRAY['lead','prospect','opportunity','client','active','churned'], v_discard.stage)
      THEN stage
      ELSE v_discard.stage
    END,
    updated_at = NOW()
  WHERE dnia_id = p_keep;

  -- Delete discarded identity
  DELETE FROM ecosystem_identities WHERE dnia_id = p_discard;

  -- Re-fetch merged record
  SELECT * INTO v_keep FROM ecosystem_identities WHERE dnia_id = p_keep;

  RETURN jsonb_build_object(
    'dnia_id', v_keep.dnia_id,
    'merged_from', p_discard,
    'stage', v_keep.stage,
    'phone', v_keep.phone,
    'email', v_keep.email,
    'nome', v_keep.nome,
    'nexus_contact_id', v_keep.nexus_contact_id,
    'mentoria_client_id', v_keep.mentoria_client_id,
    'dndash_lead_id', v_keep.dndash_lead_id
  );
END;
$$;


--
-- Name: mql_reuniao_agendada_today(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mql_reuniao_agendada_today() RETURNS TABLE(lead_id uuid)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ce.lead_id
  FROM public.contact_events ce
  WHERE ce.event_type = 'contact_updated'
    AND ce.metadata->>'status_atual' = 'MQL - Reunião agendada'
    AND ce.lead_id IS NOT NULL
    AND (ce.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date
        = (now() AT TIME ZONE 'America/Sao_Paulo')::date;
END;
$$;


--
-- Name: normalize_phone_br(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_phone_br(raw text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public'
    AS $$
DECLARE
  digits TEXT;
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;
  digits := regexp_replace(raw, '[^0-9]', '', 'g');
  IF digits = '' THEN RETURN raw; END IF;
  IF left(digits, 2) = '55' AND length(digits) BETWEEN 12 AND 13 THEN
    RETURN '+' || digits;
  ELSIF length(digits) BETWEEN 10 AND 11 THEN
    RETURN '+55' || digits;
  ELSE
    RETURN raw;
  END IF;
END;
$$;


--
-- Name: normalize_suppression_email(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_suppression_email() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.email := lower(trim(NEW.email));
  RETURN NEW;
END; $$;


--
-- Name: preview_segment_rules(jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.preview_segment_rules(p_rules jsonb, p_logic text DEFAULT 'and'::text) RETURNS TABLE(lead_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_rule   JSONB;
  v_cond   TEXT;
  v_conds  TEXT[] := ARRAY[]::TEXT[];
  v_where  TEXT := 'SELECT id FROM leads WHERE TRUE';
  v_joiner TEXT;
  v_logic  TEXT := lower(coalesce(p_logic, 'and'));
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' = 'anon' THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;

  IF v_logic NOT IN ('and', 'or') THEN
    v_logic := 'and';
  END IF;

  FOR v_rule IN SELECT jsonb_array_elements(COALESCE(p_rules, '[]'::jsonb))
  LOOP
    v_cond := public.build_segment_condition(v_rule);
    IF v_cond IS NOT NULL THEN
      v_conds := v_conds || v_cond;
    END IF;
  END LOOP;

  IF array_length(v_conds, 1) > 0 THEN
    v_joiner := CASE WHEN v_logic = 'or' THEN ' OR ' ELSE ' AND ' END;
    v_where := v_where || ' AND (' || array_to_string(v_conds, v_joiner) || ')';
  END IF;

  RETURN QUERY EXECUTE v_where;
END; $$;


--
-- Name: promote_scheduled_campaigns(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.promote_scheduled_campaigns() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  r record;
  v_count integer := 0;
BEGIN
  FOR r IN
    SELECT id FROM public.campaigns
     WHERE status = 'scheduled'
       AND scheduled_at IS NOT NULL
       AND scheduled_at <= now()
     ORDER BY scheduled_at
     LIMIT 20
  LOOP
    PERFORM public.invoke_edge_function('send-campaign', jsonb_build_object('campaign_id', r.id));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;


--
-- Name: recover_lost_journey_sends(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recover_lost_journey_sends() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_exhausted integer := 0;
  v_recovered integer := 0;
  v_queued    integer := 0;
  v_messages  jsonb;
BEGIN
  WITH exhausted AS (
    SELECT cs.id
    FROM public.campaign_sends cs
    WHERE cs.channel = 'email'
      AND cs.journey_run_id IS NOT NULL
      AND cs.status = 'sent'
      AND cs.resend_email_id IS NULL
      AND cs.sent_at < now() - interval '20 minutes'
      AND cs.recovery_count >= 2
      AND cs.lead_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.email_events ee WHERE ee.campaign_send_id = cs.id
      )
    LIMIT 500
  )
  UPDATE public.campaign_sends cs
     SET status = 'failed', error = 'recuperacao esgotada'
    FROM exhausted e
   WHERE cs.id = e.id
     AND cs.status = 'sent'
     AND cs.resend_email_id IS NULL;
  GET DIAGNOSTICS v_exhausted = ROW_COUNT;

  WITH recovered AS (
    UPDATE public.campaign_sends cs
       SET status = 'pending', sent_at = NULL, recovery_count = cs.recovery_count + 1
     WHERE cs.id IN (
       SELECT c.id
       FROM public.campaign_sends c
       WHERE c.channel = 'email'
         AND c.journey_run_id IS NOT NULL
         AND c.status = 'sent'
         AND c.resend_email_id IS NULL
         AND c.sent_at < now() - interval '20 minutes'
         AND c.recovery_count < 2
         AND c.lead_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.email_events ee WHERE ee.campaign_send_id = c.id
         )
       ORDER BY c.sent_at
       LIMIT GREATEST(500 - v_exhausted, 0)
     )
    RETURNING cs.id, cs.lead_id, cs.journey_run_id, cs.journey_node_id
  )
  SELECT jsonb_agg(jsonb_build_object(
           'send_id', r.id,
           'lead_id', r.lead_id,
           'journey_id', (SELECT jr.journey_id FROM public.journey_runs jr WHERE jr.id = r.journey_run_id),
           'journey_run_id', r.journey_run_id,
           'journey_node_id', r.journey_node_id
         )),
         count(*)
    INTO v_messages, v_recovered
  FROM recovered r;

  IF v_messages IS NOT NULL THEN
    SELECT public.email_queue_send_batch(v_messages) INTO v_queued;
  END IF;

  RETURN jsonb_build_object('recovered', v_recovered, 'exhausted', v_exhausted, 'queued', v_queued);
END $$;


--
-- Name: recover_lost_sends(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recover_lost_sends() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_recovered integer := 0;
  v_exhausted integer := 0;
  v_queued integer := 0;
  v_reopened integer := 0;
  v_messages jsonb;
  v_campaign_ids uuid[];
  v_candidate_ids uuid[];
  v_confirmed_campaign_ids uuid[];
BEGIN
  WITH exhausted AS (
    SELECT cs.id
    FROM public.campaign_sends cs
    WHERE cs.channel = 'email'
      AND cs.status = 'sent'
      AND cs.resend_email_id IS NULL
      AND cs.sent_at < now() - interval '20 minutes'
      AND cs.sent_at >= '2026-07-13 00:00:00+00'::timestamptz
      AND cs.recovery_count >= 2
      AND cs.lead_id IS NOT NULL
      AND cs.campaign_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.email_events ee
         WHERE ee.campaign_id = cs.campaign_id AND ee.lead_id = cs.lead_id
      )
    LIMIT 500
  )
  UPDATE public.campaign_sends cs
     SET status = 'failed', error = 'recuperacao esgotada'
    FROM exhausted e
   WHERE cs.id = e.id
     AND cs.status = 'sent'
     AND cs.resend_email_id IS NULL;
  GET DIAGNOSTICS v_exhausted = ROW_COUNT;

  WITH candidates AS (
    SELECT cs.id, cs.campaign_id, cs.lead_id
    FROM public.campaign_sends cs
    WHERE cs.channel = 'email'
      AND cs.status = 'sent'
      AND cs.resend_email_id IS NULL
      AND cs.sent_at < now() - interval '20 minutes'
      AND cs.sent_at >= '2026-07-13 00:00:00+00'::timestamptz
      AND cs.recovery_count < 2
      AND cs.lead_id IS NOT NULL
      AND cs.campaign_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.email_events ee
         WHERE ee.campaign_id = cs.campaign_id AND ee.lead_id = cs.lead_id
      )
    ORDER BY cs.sent_at
    LIMIT GREATEST(500 - v_exhausted, 0)
  )
  SELECT array_agg(id), array_agg(DISTINCT campaign_id)
    INTO v_candidate_ids, v_campaign_ids
    FROM candidates;

  IF v_campaign_ids IS NOT NULL THEN
    UPDATE public.campaigns
       SET status = 'sending'
     WHERE id = ANY(v_campaign_ids)
       AND status <> 'sending';
    GET DIAGNOSTICS v_reopened = ROW_COUNT;

    SELECT array_agg(id) INTO v_confirmed_campaign_ids
      FROM public.campaigns
     WHERE id = ANY(v_campaign_ids)
       AND status = 'sending';
  END IF;

  WITH recovered AS (
    UPDATE public.campaign_sends cs
       SET status = 'pending', sent_at = NULL, recovery_count = cs.recovery_count + 1
     WHERE cs.id = ANY(COALESCE(v_candidate_ids, ARRAY[]::uuid[]))
       AND cs.status = 'sent'
       AND cs.resend_email_id IS NULL
       AND cs.campaign_id = ANY(COALESCE(v_confirmed_campaign_ids, ARRAY[]::uuid[]))
    RETURNING cs.id, cs.campaign_id, cs.lead_id
  )
  SELECT jsonb_agg(jsonb_build_object('send_id', id, 'campaign_id', campaign_id, 'lead_id', lead_id)),
         count(*)
    INTO v_messages, v_recovered
  FROM recovered;

  IF v_messages IS NOT NULL THEN
    SELECT public.email_queue_send_batch(v_messages) INTO v_queued;
  END IF;

  RETURN jsonb_build_object('recovered', v_recovered, 'exhausted', v_exhausted, 'queued', v_queued, 'reopened_campaigns', v_reopened);
END $$;


--
-- Name: requeue_orphan_journey_sends(); Type: FUNCTION; Schema: public; Owner: -
--



--
-- Name: reset_stuck_campaigns(); Type: FUNCTION; Schema: public; Owner: -
--



--
-- Name: resolve_or_create_identity(text, text, text, text, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_or_create_identity(p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_nome text DEFAULT NULL::text, p_source_app text DEFAULT NULL::text, p_local_id uuid DEFAULT NULL::uuid, p_utm_source text DEFAULT NULL::text, p_stage text DEFAULT 'lead'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_phone_norm TEXT;
  v_identity RECORD;
  v_cross_identity RECORD;
  v_is_new BOOLEAN := FALSE;
  v_id UUID;
  v_stage_order TEXT[] := ARRAY['lead','prospect','opportunity','client','active','churned'];
  v_current_idx INT;
  v_new_idx INT;
  v_final_stage TEXT;
  v_matched_by TEXT := NULL;
  v_merged BOOLEAN := FALSE;
  v_merged_from UUID := NULL;
  v_keep_id UUID;
  v_discard_id UUID;
  v_merge_result JSONB;
BEGIN
  v_phone_norm := normalize_phone_br(p_phone);

  -- Step 1: Match by phone
  IF v_phone_norm IS NOT NULL AND v_phone_norm <> '' THEN
    SELECT * INTO v_identity FROM ecosystem_identities WHERE phone = v_phone_norm LIMIT 1;
    IF v_identity IS NOT NULL THEN
      v_matched_by := 'phone';
    END IF;
  END IF;

  -- Step 2: Match by email if no phone match
  IF v_identity IS NULL AND p_email IS NOT NULL AND TRIM(p_email) <> '' THEN
    SELECT * INTO v_identity FROM ecosystem_identities WHERE LOWER(TRIM(email)) = LOWER(TRIM(p_email)) LIMIT 1;
    IF v_identity IS NOT NULL THEN
      v_matched_by := 'email';
    END IF;
  END IF;

  -- Step 3: Cross-check for conflicts (potential duplicate)
  IF v_identity IS NOT NULL THEN
    IF v_matched_by = 'phone' AND p_email IS NOT NULL AND TRIM(p_email) <> '' THEN
      -- Matched by phone, check if email belongs to a DIFFERENT identity
      SELECT * INTO v_cross_identity FROM ecosystem_identities
        WHERE LOWER(TRIM(email)) = LOWER(TRIM(p_email))
        AND dnia_id <> v_identity.dnia_id
        LIMIT 1;
    ELSIF v_matched_by = 'email' AND v_phone_norm IS NOT NULL AND v_phone_norm <> '' THEN
      -- Matched by email, check if phone belongs to a DIFFERENT identity
      SELECT * INTO v_cross_identity FROM ecosystem_identities
        WHERE phone = v_phone_norm
        AND dnia_id <> v_identity.dnia_id
        LIMIT 1;
    END IF;

    -- If cross-match found, merge keeping the older record
    IF v_cross_identity IS NOT NULL THEN
      IF v_identity.created_at <= v_cross_identity.created_at THEN
        v_keep_id := v_identity.dnia_id;
        v_discard_id := v_cross_identity.dnia_id;
      ELSE
        v_keep_id := v_cross_identity.dnia_id;
        v_discard_id := v_identity.dnia_id;
      END IF;

      v_merge_result := merge_identities(v_keep_id, v_discard_id);
      v_merged := TRUE;
      v_merged_from := v_discard_id;

      -- Re-fetch the kept identity
      SELECT * INTO v_identity FROM ecosystem_identities WHERE dnia_id = v_keep_id;
    END IF;
  END IF;

  -- Step 4: Create new if no match
  IF v_identity IS NULL THEN
    v_is_new := TRUE;
    v_id := gen_random_uuid();
    v_final_stage := COALESCE(p_stage, 'lead');

    INSERT INTO ecosystem_identities (dnia_id, phone, email, nome, stage, first_touch_source, first_touch_app, last_seen_at,
      dndash_lead_id, nexus_contact_id, mentoria_client_id)
    VALUES (
      v_id, v_phone_norm, LOWER(TRIM(p_email)), p_nome, v_final_stage, p_utm_source, p_source_app, NOW(),
      CASE WHEN p_source_app = 'dndash' THEN p_local_id ELSE NULL END,
      CASE WHEN p_source_app = 'nexus' THEN p_local_id ELSE NULL END,
      CASE WHEN p_source_app = 'mentoria' THEN p_local_id ELSE NULL END
    );

    RETURN jsonb_build_object(
      'dnia_id', v_id,
      'is_new', TRUE,
      'merged', FALSE,
      'merged_from', NULL,
      'stage', v_final_stage,
      'phone_normalized', v_phone_norm,
      'dndash_lead_id', CASE WHEN p_source_app = 'dndash' THEN p_local_id ELSE NULL END,
      'nexus_contact_id', CASE WHEN p_source_app = 'nexus' THEN p_local_id ELSE NULL END,
      'mentoria_client_id', CASE WHEN p_source_app = 'mentoria' THEN p_local_id ELSE NULL END,
      'first_touch_app', p_source_app
    );
  END IF;

  -- Step 5: Update existing identity
  v_id := v_identity.dnia_id;

  v_current_idx := array_position(v_stage_order, v_identity.stage);
  v_new_idx := array_position(v_stage_order, COALESCE(p_stage, 'lead'));
  IF v_current_idx IS NULL THEN v_current_idx := 1; END IF;
  IF v_new_idx IS NULL THEN v_new_idx := 1; END IF;
  IF v_new_idx > v_current_idx THEN
    v_final_stage := p_stage;
  ELSE
    v_final_stage := v_identity.stage;
  END IF;

  UPDATE ecosystem_identities SET
    phone = COALESCE(v_phone_norm, phone),
    email = COALESCE(LOWER(TRIM(p_email)), email),
    nome = COALESCE(p_nome, nome),
    stage = v_final_stage,
    first_touch_source = COALESCE(first_touch_source, p_utm_source),
    first_touch_app = COALESCE(first_touch_app, p_source_app),
    last_seen_at = NOW(),
    dndash_lead_id = CASE WHEN p_source_app = 'dndash' THEN COALESCE(p_local_id, dndash_lead_id) ELSE dndash_lead_id END,
    nexus_contact_id = CASE WHEN p_source_app = 'nexus' THEN COALESCE(p_local_id, nexus_contact_id) ELSE nexus_contact_id END,
    mentoria_client_id = CASE WHEN p_source_app = 'mentoria' THEN COALESCE(p_local_id, mentoria_client_id) ELSE mentoria_client_id END
  WHERE dnia_id = v_id;

  SELECT * INTO v_identity FROM ecosystem_identities WHERE dnia_id = v_id;

  RETURN jsonb_build_object(
    'dnia_id', v_id,
    'is_new', FALSE,
    'merged', v_merged,
    'merged_from', v_merged_from,
    'stage', v_identity.stage,
    'phone_normalized', v_identity.phone,
    'dndash_lead_id', v_identity.dndash_lead_id,
    'nexus_contact_id', v_identity.nexus_contact_id,
    'mentoria_client_id', v_identity.mentoria_client_id,
    'first_touch_app', v_identity.first_touch_app
  );
END;
$$;


--
-- Name: resolve_segment_audience(uuid[], uuid[], integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_segment_audience(p_include uuid[], p_exclude uuid[] DEFAULT '{}'::uuid[], p_limit integer DEFAULT NULL::integer) RETURNS TABLE(lead_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_include uuid[] := COALESCE(p_include, '{}'::uuid[]);
  v_exclude uuid[] := COALESCE(p_exclude, '{}'::uuid[]);
  v_missing uuid;
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' = 'anon' THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'acesso negado';
  END IF;

  SELECT s INTO v_missing
    FROM unnest(v_include || v_exclude) AS s
   WHERE NOT EXISTS (SELECT 1 FROM public.segments g WHERE g.id = s)
   LIMIT 1;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'segmento % não existe mais', v_missing;
  END IF;

  RETURN QUERY
  WITH inc AS (
    SELECT l.id AS lead_id
      FROM public.leads l
     WHERE cardinality(v_include) = 0
    UNION
    SELECT e.lead_id
      FROM unnest(v_include) AS s(id)
      CROSS JOIN LATERAL public.evaluate_segment_rules(s.id) AS e
  ),
  exc AS (
    SELECT e.lead_id
      FROM unnest(v_exclude) AS s(id)
      CROSS JOIN LATERAL public.evaluate_segment_rules(s.id) AS e
  )
  SELECT i.lead_id
    FROM inc i
   WHERE NOT EXISTS (SELECT 1 FROM exc x WHERE x.lead_id = i.lead_id)
   LIMIT p_limit;
END $$;


--
-- Name: sanitize_page_slug(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sanitize_page_slug() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $_$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    RAISE EXCEPTION 'slug cannot be empty';
  END IF;
  IF NEW.slug <> '/' THEN
    NEW.slug := lower(regexp_replace(NEW.slug, '^/+|/+$', '', 'g'));
    IF NEW.slug !~ '^[a-z0-9][a-z0-9_-]*$' THEN
      RAISE EXCEPTION 'invalid slug: % (allowed: lowercase letters, digits, hyphen, underscore)', NEW.slug;
    END IF;
  END IF;
  RETURN NEW;
END;
$_$;


--
-- Name: score_lead_from_config(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.score_lead_from_config() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  v_config RECORD;
  v_criteria JSONB;
  v_thresholds JSONB;
  v_score INT := 0;
  v_etiqueta TEXT := NULL;
  v_cargo_lower TEXT;
  v_fat_lower TEXT;
  v_func_lower TEXT;
  v_fat_value NUMERIC := 0;
  v_func_value NUMERIC := 0;
  v_cargos JSONB;
  v_sources JSONB;
  v_cargo_item TEXT;
  v_source_item TEXT;
  v_conv_count INT;
  v_matched BOOLEAN;
BEGIN
  SELECT criteria, thresholds INTO v_criteria, v_thresholds
  FROM scoring_config LIMIT 1;

  IF v_criteria IS NULL THEN
    RETURN NEW;
  END IF;

  v_cargo_lower := LOWER(COALESCE(NEW.cargo, ''));
  v_fat_lower := LOWER(COALESCE(NEW.faturamento, ''));
  v_func_lower := LOWER(COALESCE(NEW.funcionarios, ''));

  -- 1. Cargo decisor
  IF (v_criteria->'cargo_decisor'->>'enabled')::boolean THEN
    v_cargos := v_criteria->'cargo_decisor'->'cargos';
    IF v_cargos IS NULL OR jsonb_array_length(v_cargos) = 0 THEN
      v_cargos := '["CEO","Fundador","Founder","Diretor","Sócio","COO","CFO","CTO","Proprietário","Dono","Partner"]'::jsonb;
    END IF;
    v_matched := FALSE;
    FOR v_cargo_item IN SELECT jsonb_array_elements_text(v_cargos) LOOP
      IF v_cargo_lower ~ ('\y' || LOWER(v_cargo_item) || '\y') THEN
        v_matched := TRUE;
        EXIT;
      END IF;
    END LOOP;
    IF v_matched THEN
      v_score := v_score + COALESCE((v_criteria->'cargo_decisor'->>'points')::int, 0);
    END IF;
  END IF;

  -- 2. Faturamento
  IF (v_criteria->'faturamento'->>'enabled')::boolean THEN
    v_fat_value := 0;
    IF v_fat_lower ~ '(acima de r\$ 50 milhões|acima de 50mm)' THEN v_fat_value := 50000000;
    ELSIF v_fat_lower ~ '(acima de r\$ 10 milhões|acima de 10mm)' THEN v_fat_value := 10000000;
    ELSIF v_fat_lower ~ '(de r\$ 5 milhões|acima de r\$ 5 milhões|mais de 5 milhões|acima de 5mm|acima de r\$ 5 milhões por mês)' THEN v_fat_value := 5000000;
    ELSIF v_fat_lower ~ '(entre 3mm e 5mm|acima de 3mm|acima de r\$ 3 milhões|entre r\$ 3 milhões)' THEN v_fat_value := 3000000;
    ELSIF v_fat_lower ~ '(entre 1mm e 3mm|acima de 1mm|acima de r\$ 1 milhão|de r\$ 1 milhão|mais de 1 milhão|mais de r\$ 1 milhão|entre r\$ 1 milhão)' THEN v_fat_value := 1000000;
    ELSIF v_fat_lower ~ '(500k-1m|entre 500k|acima de 500k|mais de 500k|entre r\$ 500 mil)' THEN v_fat_value := 500000;
    ELSIF v_fat_lower ~ '(100k-500k|entre 100k|acima de 100k|mais de 100k|entre r\$ 100 mil)' THEN v_fat_value := 100000;
    ELSIF v_fat_lower ~ '(50k-100k|até r\$ 100 mil)' THEN v_fat_value := 50000;
    ELSIF v_fat_lower ~ '(10k-50k|até 10k)' THEN v_fat_value := 10000;
    END IF;
    IF v_fat_value >= COALESCE((v_criteria->'faturamento'->>'min_value')::numeric, 100000) THEN
      v_score := v_score + COALESCE((v_criteria->'faturamento'->>'points')::int, 0);
    END IF;
  END IF;

  -- 3. Funcionários
  IF COALESCE((v_criteria->'funcionarios'->>'enabled')::boolean, false) THEN
    v_func_value := 0;
    IF v_func_lower ~ 'acima de 50' THEN v_func_value := 50;
    ELSIF v_func_lower ~ '26' THEN v_func_value := 26;
    ELSIF v_func_lower ~ '11' THEN v_func_value := 11;
    ELSIF v_func_lower ~ '2' THEN v_func_value := 2;
    ELSIF v_func_lower ~ 'individual' THEN v_func_value := 1;
    END IF;
    IF v_func_value >= COALESCE((v_criteria->'funcionarios'->>'min_value')::numeric, 10) THEN
      v_score := v_score + COALESCE((v_criteria->'funcionarios'->>'points')::int, 0);
    END IF;
  END IF;

  -- 4. Desafios
  IF (v_criteria->'tem_desafios'->>'enabled')::boolean THEN
    IF LENGTH(COALESCE(NEW.desafios, '')) >= 20 THEN
      v_score := v_score + COALESCE((v_criteria->'tem_desafios'->>'points')::int, 0);
    END IF;
  END IF;

  -- 5. Origem qualificada
  IF (v_criteria->'origem'->>'enabled')::boolean THEN
    v_sources := v_criteria->'origem'->'sources';
    IF v_sources IS NOT NULL AND jsonb_array_length(v_sources) > 0 THEN
      v_matched := FALSE;
      FOR v_source_item IN SELECT jsonb_array_elements_text(v_sources) LOOP
        IF LOWER(COALESCE(NEW.utm_source, NEW.source, '')) LIKE '%' || LOWER(TRIM(v_source_item)) || '%' THEN
          v_matched := TRUE;
          EXIT;
        END IF;
      END LOOP;
      IF v_matched THEN
        v_score := v_score + COALESCE((v_criteria->'origem'->>'points')::int, 0);
      END IF;
    END IF;
  END IF;

  -- 6. Reconversão
  IF (v_criteria->'reconversao'->>'enabled')::boolean THEN
    SELECT COUNT(*) INTO v_conv_count FROM lead_conversions WHERE lead_id = NEW.id;
    IF v_conv_count > 1 THEN
      v_score := v_score + COALESCE((v_criteria->'reconversao'->>'points')::int, 0);
    END IF;
  END IF;

  -- 7. WhatsApp
  IF (v_criteria->'tem_whatsapp'->>'enabled')::boolean THEN
    IF NEW.whatsapp IS NOT NULL AND TRIM(NEW.whatsapp) <> '' THEN
      v_score := v_score + COALESCE((v_criteria->'tem_whatsapp'->>'points')::int, 0);
    END IF;
  END IF;

  v_score := LEAST(100, GREATEST(0, v_score));

  IF v_score >= COALESCE((v_thresholds->>'hotlead')::int, 70) THEN
    v_etiqueta := 'hotlead';
  ELSIF v_score >= COALESCE((v_thresholds->>'warm')::int, 40) THEN
    v_etiqueta := 'warm';
  ELSE
    v_etiqueta := NULL;
  END IF;

  NEW.lead_score := v_score;
  NEW.etiqueta := v_etiqueta;

  RETURN NEW;
END;
$_$;


--
-- Name: set_integration_secret(text, text); Type: FUNCTION; Schema: public; Owner: -
--



--
-- Name: sync_campaign_legacy_segment_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_campaign_legacy_segment_id() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.segment_ids          := COALESCE(NEW.segment_ids, '{}'::uuid[]);
  NEW.excluded_segment_ids := COALESCE(NEW.excluded_segment_ids, '{}'::uuid[]);

  IF TG_OP = 'INSERT' THEN
    IF cardinality(NEW.segment_ids) = 0 AND NEW.segment_id IS NOT NULL THEN
      NEW.segment_ids := ARRAY[NEW.segment_id];
    END IF;
  ELSIF NEW.segment_id IS DISTINCT FROM OLD.segment_id
        AND NEW.segment_ids IS NOT DISTINCT FROM OLD.segment_ids THEN
    NEW.segment_ids := CASE
      WHEN NEW.segment_id IS NULL THEN '{}'::uuid[]
      ELSE ARRAY[NEW.segment_id]
    END;
  END IF;

  NEW.segment_id := NEW.segment_ids[1];
  RETURN NEW;
END $$;


--
-- Name: update_leads_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_leads_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: validate_automation_rule_fields(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_automation_rule_fields() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_cond JSONB;
BEGIN
  -- Validate condition_logic
  IF NEW.condition_logic NOT IN ('and', 'or') THEN
    RAISE EXCEPTION 'Invalid condition_logic: %', NEW.condition_logic;
  END IF;

  -- Validate legacy single fields
  IF NEW.condition_type NOT IN ('status','etiqueta','tag','score','created_at') THEN
    RAISE EXCEPTION 'Invalid condition_type: %', NEW.condition_type;
  END IF;
  IF NEW.condition_operator NOT IN ('is','is_not','greater_than','less_than','contains','between','after','before','last_n_days') THEN
    RAISE EXCEPTION 'Invalid condition_operator: %', NEW.condition_operator;
  END IF;

  -- Validate each condition in the array
  IF NEW.conditions IS NOT NULL AND jsonb_array_length(NEW.conditions) > 0 THEN
    FOR v_cond IN SELECT jsonb_array_elements(NEW.conditions) LOOP
      IF (v_cond->>'type') NOT IN ('status','etiqueta','tag','score','created_at') THEN
        RAISE EXCEPTION 'Invalid condition type in conditions array: %', v_cond->>'type';
      END IF;
      IF (v_cond->>'operator') NOT IN ('is','is_not','greater_than','less_than','contains','between','after','before','last_n_days') THEN
        RAISE EXCEPTION 'Invalid operator in conditions array: %', v_cond->>'operator';
      END IF;
    END LOOP;
  END IF;

  IF NEW.action_type NOT IN ('create_in_nexus','move_stage_nexus','block_nexus') THEN
    RAISE EXCEPTION 'Invalid action_type: %', NEW.action_type;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: validate_campaign_channel(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_campaign_channel() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.channel NOT IN ('email','whatsapp') THEN
    RAISE EXCEPTION 'Invalid channel: %', NEW.channel;
  END IF;
  RETURN NEW;
END; $$;


--
-- Name: validate_campaign_send_channel(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_campaign_send_channel() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.channel NOT IN ('email','whatsapp') THEN
    RAISE EXCEPTION 'Invalid send channel: %', NEW.channel;
  END IF;
  RETURN NEW;
END; $$;


--
-- Name: validate_campaign_send_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_campaign_send_status() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.status NOT IN ('pending','sent','delivered','opened','clicked','failed','unsubscribed','bounced','complained','suppressed') THEN
    RAISE EXCEPTION 'Invalid send status: %', NEW.status;
  END IF;
  RETURN NEW;
END; $$;


--
-- Name: validate_campaign_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_campaign_status() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.status NOT IN ('draft','scheduled','sending','sent','paused','failed') THEN
    RAISE EXCEPTION 'Invalid campaign status: %', NEW.status;
  END IF;
  RETURN NEW;
END; $$;


--
-- Name: validate_contact_event_source_app(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_contact_event_source_app() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.source_app NOT IN ('dnmarketing','nexus','mentoria') THEN
    RAISE EXCEPTION 'Invalid source_app value: %', NEW.source_app;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: validate_ecosystem_identity_stage(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_ecosystem_identity_stage() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.stage NOT IN ('lead','prospect','opportunity','client','active','churned') THEN
    RAISE EXCEPTION 'Invalid stage value: %', NEW.stage;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: validate_journey_graph(jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_journey_graph(p_nodes jsonb, p_entry_node_id text) RETURNS void
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
       ('send_email','delay','wait_for_event','branch_attribute','branch_segment','branch_email_event','apply_tag','handoff_nexus') THEN
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
      WHEN 'handoff_nexus' THEN
        IF coalesce(v_node#>>'{config,stage_id}', '') = '' THEN
          RAISE EXCEPTION 'no % (handoff_nexus) exige config.stage_id', v_id;
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


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ab_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ab_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ab_test text NOT NULL,
    ab_var text NOT NULL,
    ab_vid text NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    landing_url text,
    referrer text,
    utm_source text,
    utm_medium text,
    utm_campaign text,
    utm_term text,
    utm_content text,
    gclid text,
    fbclid text,
    ttclid text,
    msclkid text,
    raw_query text,
    user_agent text,
    device_type text,
    browser text,
    browser_version text,
    os text,
    language text,
    metadata jsonb
);


--
-- Name: ab_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ab_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    production_domain text DEFAULT 'dnia.ai'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ab_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ab_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ab_test text NOT NULL,
    ab_var text,
    ab_vid text NOT NULL,
    event_type text NOT NULL,
    event_name text,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    page_slug text,
    url text,
    referrer text,
    lead_id uuid,
    dnia_id text,
    utm_source text,
    utm_medium text,
    utm_campaign text,
    utm_term text,
    utm_content text,
    gclid text,
    fbclid text,
    ttclid text,
    msclkid text,
    raw_query text,
    device_type text,
    browser text,
    browser_version text,
    os text,
    language text,
    screen_resolution text,
    metadata jsonb,
    dedupe_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ab_events_event_type_check CHECK ((event_type = ANY (ARRAY['assignment'::text, 'exposure'::text, 'behavior'::text, 'schedule_step'::text, 'conversion'::text])))
);


--
-- Name: ab_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ab_identities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ab_vid text NOT NULL,
    email text,
    phone text,
    phone_normalized text,
    lead_id uuid,
    dnia_id text,
    nexus_contact_id text,
    source_app text,
    linked_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb
);


--
-- Name: ab_tests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ab_tests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    hypothesis text,
    status text DEFAULT 'draft'::text NOT NULL,
    variants jsonb DEFAULT '[]'::jsonb NOT NULL,
    control_variant text,
    primary_metric text DEFAULT 'lead_criado'::text NOT NULL,
    guardrail_metric text DEFAULT 'agendamento'::text,
    target_sample_per_variant integer,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    public_slug text NOT NULL,
    winner_variant text,
    CONSTRAINT ab_tests_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'running'::text, 'paused'::text, 'completed'::text, 'archived'::text])))
);


--
-- Name: ai_chat_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_chat_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text DEFAULT 'Nova conversa'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_chat_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])))
);


--
-- Name: api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    key_hash text NOT NULL,
    key_prefix text NOT NULL,
    permissions text DEFAULT 'read_write'::text,
    expires_at timestamp with time zone,
    last_used_at timestamp with time zone,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: automation_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true,
    priority integer DEFAULT 0,
    condition_type text NOT NULL,
    condition_operator text NOT NULL,
    condition_value text NOT NULL,
    action_type text NOT NULL,
    action_value text,
    action_metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    conditions jsonb DEFAULT '[]'::jsonb,
    condition_logic text DEFAULT 'and'::text
);


--
-- Name: campaign_sends; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaign_sends (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid,
    lead_id uuid,
    dnia_id uuid,
    channel text NOT NULL,
    status text DEFAULT 'pending'::text,
    sent_at timestamp with time zone,
    opened_at timestamp with time zone,
    clicked_at timestamp with time zone,
    error text,
    resend_email_id text,
    recovery_count integer DEFAULT 0 NOT NULL,
    journey_run_id uuid,
    journey_node_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_campaign_sends_owner CHECK ((NOT ((campaign_id IS NOT NULL) AND (journey_run_id IS NOT NULL))))
);


--
-- Name: campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    channel text NOT NULL,
    status text DEFAULT 'draft'::text,
    segment_id uuid,
    subject text,
    body text,
    scheduled_at timestamp with time zone,
    sent_at timestamp with time zone,
    stats jsonb DEFAULT '{"sent": 0, "failed": 0, "opened": 0, "clicked": 0, "delivered": 0}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    design jsonb,
    segment_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    excluded_segment_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL
);


--
-- Name: challenge_insights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.challenge_insights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    insights jsonb NOT NULL,
    leads_analyzed integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);


--
-- Name: contact_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    dnia_id uuid,
    lead_id uuid,
    source_app text NOT NULL,
    event_type text NOT NULL,
    title text NOT NULL,
    description text,
    metadata jsonb DEFAULT '{}'::jsonb,
    occurred_at timestamp with time zone DEFAULT now()
);


--
-- Name: dashboard_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    setting_key text NOT NULL,
    setting_value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: ecosystem_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ecosystem_identities (
    dnia_id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone text,
    email text,
    nome text,
    stage text DEFAULT 'lead'::text NOT NULL,
    dndash_lead_id uuid,
    nexus_contact_id uuid,
    mentoria_client_id uuid,
    first_touch_source text,
    first_touch_app text,
    last_seen_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: email_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    svix_id text NOT NULL,
    event_type text NOT NULL,
    resend_email_id text,
    campaign_send_id uuid,
    campaign_id uuid,
    lead_id uuid,
    payload jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: email_suppressions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_suppressions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    reason text NOT NULL,
    source text,
    lead_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_suppressions_reason_check CHECK ((reason = ANY (ARRAY['bounce'::text, 'complaint'::text, 'unsubscribe'::text, 'manual'::text])))
);


--
-- Name: email_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    category text,
    design jsonb,
    html text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: journey_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journey_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    journey_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    current_node_id text,
    state text DEFAULT 'active'::text NOT NULL,
    wakeup_at timestamp with time zone DEFAULT now() NOT NULL,
    waiting_event text,
    context jsonb DEFAULT '{}'::jsonb NOT NULL,
    lock_token uuid,
    locked_until timestamp with time zone,
    entered_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT journey_runs_state_check CHECK ((state = ANY (ARRAY['active'::text, 'waiting'::text, 'done'::text, 'failed'::text, 'exited'::text])))
);


--
-- Name: journey_step_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journey_step_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    journey_id uuid NOT NULL,
    lead_id uuid,
    node_id text NOT NULL,
    node_type text NOT NULL,
    result text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: journeys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journeys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    status text DEFAULT 'draft'::text NOT NULL,
    entry_type text NOT NULL,
    entry_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    reentry text DEFAULT 'once'::text NOT NULL,
    reentry_cooldown_hours integer DEFAULT 168 NOT NULL,
    entry_node_id text,
    nodes jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_journeys_reentry_cooldown CHECK ((reentry_cooldown_hours > 0)),
    CONSTRAINT journeys_entry_type_check CHECK ((entry_type = ANY (ARRAY['segment'::text, 'event'::text]))),
    CONSTRAINT journeys_reentry_check CHECK ((reentry = ANY (ARRAY['once'::text, 'allowed'::text]))),
    CONSTRAINT journeys_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'paused'::text, 'archived'::text])))
);


--
-- Name: lead_conversions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_conversions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lead_id uuid NOT NULL,
    converted_at timestamp with time zone DEFAULT now() NOT NULL,
    tipo character varying(100),
    utm_source character varying(255),
    utm_campaign character varying(255),
    utm_medium character varying(255),
    utm_content character varying(255),
    utm_term character varying(255),
    page_slug character varying(255),
    session_id character varying(255),
    source text,
    ab_test text,
    ab_var text,
    ab_vid text
);


--
-- Name: lead_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lead_id uuid NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: lead_statuses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_statuses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    color text DEFAULT '#888780'::text NOT NULL,
    sort_order integer DEFAULT 100 NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: lead_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_tags (
    lead_id uuid NOT NULL,
    tag_id uuid NOT NULL
);


--
-- Name: leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    tipo text NOT NULL,
    session_id text,
    nome text,
    email text,
    whatsapp text,
    cargo text,
    empresa text,
    faturamento text,
    funcionarios text,
    desafios text,
    source text,
    tipo_participante text,
    utm_source text,
    utm_medium text,
    utm_campaign text,
    utm_term text,
    utm_content text,
    etiqueta text,
    interesse_ecossistema boolean,
    interesse_mtia boolean,
    interesse_formacao boolean,
    data_interesse timestamp with time zone,
    origem_campanha text,
    last_conversion_date timestamp with time zone DEFAULT now(),
    presenca text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    indicacao text,
    dnia_id uuid,
    phone_normalized text,
    status text DEFAULT 'Lead'::text,
    lead_score integer DEFAULT 0,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    ab_test text,
    ab_var text,
    ab_vid text,
    CONSTRAINT leads_status_check CHECK ((status = ANY (ARRAY['Lead'::text, 'Lead Qualificado'::text, 'MQL - Reunião agendada'::text, 'SQL - Em negociação'::text, 'Venda realizada'::text, 'Em contrato'::text, 'Iniciado'::text])))
);


--
-- Name: meta_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meta_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pixel_id text,
    access_token text,
    test_event_code text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid
);


--
-- Name: nexus_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nexus_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    api_key text,
    workspace_id text,
    base_url text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid
);


--
-- Name: page_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.page_stats AS
SELECT
    NULL::uuid AS id,
    NULL::text AS slug,
    NULL::text AS name,
    NULL::text AS status,
    NULL::jsonb AS config,
    NULL::text AS template_base,
    NULL::text AS page_type,
    NULL::timestamp with time zone AS created_at,
    NULL::timestamp with time zone AS updated_at,
    NULL::bigint AS total_leads,
    NULL::bigint AS hot_leads,
    NULL::timestamp with time zone AS last_lead_at;


--
-- Name: pages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    component_name text NOT NULL,
    page_type text NOT NULL,
    status text DEFAULT 'active'::text,
    description text,
    webhook_url text,
    whatsapp_group_url text,
    meta_title text,
    meta_description text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    config jsonb DEFAULT '{}'::jsonb,
    template_base text,
    CONSTRAINT pages_page_type_check CHECK ((page_type = ANY (ARRAY['landing'::text, 'thankyou'::text, 'form'::text, 'admin'::text]))),
    CONSTRAINT pages_status_check CHECK ((status = ANY (ARRAY['active'::text, 'draft'::text, 'inactive'::text])))
);


--
-- Name: pingback_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pingback_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    default_url text,
    modal_url text,
    paid_url text,
    convidado_url text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid
);


--
-- Name: scoring_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scoring_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    criteria jsonb DEFAULT '{}'::jsonb NOT NULL,
    thresholds jsonb DEFAULT '{"warm": 40, "hotlead": 70}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: segment_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.segment_contacts (
    segment_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    added_at timestamp with time zone DEFAULT now()
);


--
-- Name: segments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.segments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    type text DEFAULT 'dynamic'::text,
    rules jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    logic text DEFAULT 'and'::text NOT NULL,
    CONSTRAINT segments_logic_check CHECK ((logic = ANY (ARRAY['and'::text, 'or'::text]))),
    CONSTRAINT segments_type_check CHECK ((type = ANY (ARRAY['static'::text, 'dynamic'::text])))
);


--
-- Name: tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    color text DEFAULT 'purple'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: webhook_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    webhook_url text NOT NULL,
    payload jsonb,
    status_code integer,
    response_body text,
    error_message text,
    success boolean DEFAULT false
);


--
-- Data for Name: ab_assignments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ab_assignments (id, ab_test, ab_var, ab_vid, assigned_at, landing_url, referrer, utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid, ttclid, msclkid, raw_query, user_agent, device_type, browser, browser_version, os, language, metadata) FROM stdin;
\.


--
-- Data for Name: ab_config; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ab_config (id, production_domain, updated_at) FROM stdin;
\.


--
-- Data for Name: ab_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ab_events (id, ab_test, ab_var, ab_vid, event_type, event_name, occurred_at, page_slug, url, referrer, lead_id, dnia_id, utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid, ttclid, msclkid, raw_query, device_type, browser, browser_version, os, language, screen_resolution, metadata, dedupe_key, created_at) FROM stdin;
\.


--
-- Data for Name: ab_identities; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ab_identities (id, ab_vid, email, phone, phone_normalized, lead_id, dnia_id, nexus_contact_id, source_app, linked_at, metadata) FROM stdin;
\.


--
-- Data for Name: ab_tests; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ab_tests (id, slug, name, hypothesis, status, variants, control_variant, primary_metric, guardrail_metric, target_sample_per_variant, starts_at, ends_at, created_by, created_at, updated_at, public_slug, winner_variant) FROM stdin;
\.


--
-- Data for Name: ai_chat_conversations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ai_chat_conversations (id, user_id, title, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: ai_chat_messages; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ai_chat_messages (id, conversation_id, role, content, created_at) FROM stdin;
\.


--
-- Data for Name: api_keys; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.api_keys (id, name, description, key_hash, key_prefix, permissions, expires_at, last_used_at, is_active, created_at) FROM stdin;
\.


--
-- Data for Name: automation_rules; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.automation_rules (id, name, is_active, priority, condition_type, condition_operator, condition_value, action_type, action_value, action_metadata, created_at, updated_at, conditions, condition_logic) FROM stdin;
\.


--
-- Data for Name: campaign_sends; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.campaign_sends (id, campaign_id, lead_id, dnia_id, channel, status, sent_at, opened_at, clicked_at, error, resend_email_id, recovery_count, journey_run_id, journey_node_id, created_at) FROM stdin;
\.


--
-- Data for Name: campaigns; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.campaigns (id, name, channel, status, segment_id, subject, body, scheduled_at, sent_at, stats, created_at, updated_at, design, segment_ids, excluded_segment_ids) FROM stdin;
\.


--
-- Data for Name: challenge_insights; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.challenge_insights (id, insights, leads_analyzed, created_at, created_by) FROM stdin;
\.


--
-- Data for Name: contact_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.contact_events (id, dnia_id, lead_id, source_app, event_type, title, description, metadata, occurred_at) FROM stdin;
\.


--
-- Data for Name: dashboard_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.dashboard_settings (id, setting_key, setting_value, updated_at, created_at) FROM stdin;
\.


--
-- Data for Name: ecosystem_identities; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ecosystem_identities (dnia_id, phone, email, nome, stage, dndash_lead_id, nexus_contact_id, mentoria_client_id, first_touch_source, first_touch_app, last_seen_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: email_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.email_events (id, svix_id, event_type, resend_email_id, campaign_send_id, campaign_id, lead_id, payload, occurred_at, created_at) FROM stdin;
\.


--
-- Data for Name: email_suppressions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.email_suppressions (id, email, reason, source, lead_id, created_at) FROM stdin;
\.


--
-- Data for Name: email_templates; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.email_templates (id, name, description, category, design, html, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: journey_runs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.journey_runs (id, journey_id, lead_id, current_node_id, state, wakeup_at, waiting_event, context, lock_token, locked_until, entered_at, updated_at) FROM stdin;
\.


--
-- Data for Name: journey_step_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.journey_step_log (id, run_id, journey_id, lead_id, node_id, node_type, result, detail, occurred_at) FROM stdin;
\.


--
-- Data for Name: journeys; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.journeys (id, name, description, status, entry_type, entry_config, reentry, reentry_cooldown_hours, entry_node_id, nodes, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: lead_conversions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.lead_conversions (id, lead_id, converted_at, tipo, utm_source, utm_campaign, utm_medium, utm_content, utm_term, page_slug, session_id, source, ab_test, ab_var, ab_vid) FROM stdin;
\.


--
-- Data for Name: lead_notes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.lead_notes (id, lead_id, content, created_at) FROM stdin;
\.


--
-- Data for Name: lead_statuses; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.lead_statuses (id, name, color, sort_order, is_system, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: lead_tags; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.lead_tags (lead_id, tag_id) FROM stdin;
\.


--
-- Data for Name: leads; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.leads (id, created_at, tipo, session_id, nome, email, whatsapp, cargo, empresa, faturamento, funcionarios, desafios, source, tipo_participante, utm_source, utm_medium, utm_campaign, utm_term, utm_content, etiqueta, interesse_ecossistema, interesse_mtia, interesse_formacao, data_interesse, origem_campanha, last_conversion_date, presenca, updated_at, indicacao, dnia_id, phone_normalized, status, lead_score, deleted_at, deleted_by, ab_test, ab_var, ab_vid) FROM stdin;
\.


--
-- Data for Name: meta_config; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.meta_config (id, pixel_id, access_token, test_event_code, updated_at, updated_by) FROM stdin;
\.


--
-- Data for Name: nexus_config; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.nexus_config (id, api_key, workspace_id, base_url, updated_at, updated_by) FROM stdin;
\.


--
-- Data for Name: pages; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.pages (id, name, slug, component_name, page_type, status, description, webhook_url, whatsapp_group_url, meta_title, meta_description, created_at, updated_at, config, template_base) FROM stdin;
\.


--
-- Data for Name: pingback_config; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.pingback_config (id, default_url, modal_url, paid_url, convidado_url, updated_at, updated_by) FROM stdin;
\.


--
-- Data for Name: scoring_config; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.scoring_config (id, criteria, thresholds, updated_at) FROM stdin;
\.


--
-- Data for Name: segment_contacts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.segment_contacts (segment_id, lead_id, added_at) FROM stdin;
\.


--
-- Data for Name: segments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.segments (id, name, description, type, rules, created_at, updated_at, logic) FROM stdin;
\.


--
-- Data for Name: tags; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tags (id, name, color, created_at) FROM stdin;
\.


--
-- Data for Name: user_roles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_roles (id, user_id, role, created_at) FROM stdin;
\.


--
-- Data for Name: webhook_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.webhook_logs (id, created_at, webhook_url, payload, status_code, response_body, error_message, success) FROM stdin;
\.


--
-- Name: ab_assignments ab_assignments_ab_vid_ab_test_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ab_assignments
    ADD CONSTRAINT ab_assignments_ab_vid_ab_test_key UNIQUE (ab_vid, ab_test);


--
-- Name: ab_assignments ab_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ab_assignments
    ADD CONSTRAINT ab_assignments_pkey PRIMARY KEY (id);


--
-- Name: ab_config ab_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ab_config
    ADD CONSTRAINT ab_config_pkey PRIMARY KEY (id);


--
-- Name: ab_events ab_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ab_events
    ADD CONSTRAINT ab_events_pkey PRIMARY KEY (id);


--
-- Name: ab_identities ab_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ab_identities
    ADD CONSTRAINT ab_identities_pkey PRIMARY KEY (id);


--
-- Name: ab_tests ab_tests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ab_tests
    ADD CONSTRAINT ab_tests_pkey PRIMARY KEY (id);


--
-- Name: ab_tests ab_tests_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ab_tests
    ADD CONSTRAINT ab_tests_slug_key UNIQUE (slug);


--
-- Name: ai_chat_conversations ai_chat_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_chat_conversations
    ADD CONSTRAINT ai_chat_conversations_pkey PRIMARY KEY (id);


--
-- Name: ai_chat_messages ai_chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_chat_messages
    ADD CONSTRAINT ai_chat_messages_pkey PRIMARY KEY (id);


--
-- Name: api_keys api_keys_key_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_key_hash_key UNIQUE (key_hash);


--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);


--
-- Name: automation_rules automation_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_rules
    ADD CONSTRAINT automation_rules_pkey PRIMARY KEY (id);


--
-- Name: campaign_sends campaign_sends_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_sends
    ADD CONSTRAINT campaign_sends_pkey PRIMARY KEY (id);


--
-- Name: campaigns campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_pkey PRIMARY KEY (id);


--
-- Name: challenge_insights challenge_insights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_insights
    ADD CONSTRAINT challenge_insights_pkey PRIMARY KEY (id);


--
-- Name: contact_events contact_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_events
    ADD CONSTRAINT contact_events_pkey PRIMARY KEY (id);


--
-- Name: dashboard_settings dashboard_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_settings
    ADD CONSTRAINT dashboard_settings_pkey PRIMARY KEY (id);


--
-- Name: dashboard_settings dashboard_settings_setting_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_settings
    ADD CONSTRAINT dashboard_settings_setting_key_key UNIQUE (setting_key);


--
-- Name: dashboard_settings dashboard_settings_setting_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_settings
    ADD CONSTRAINT dashboard_settings_setting_key_unique UNIQUE (setting_key);


--
-- Name: ecosystem_identities ecosystem_identities_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ecosystem_identities
    ADD CONSTRAINT ecosystem_identities_phone_key UNIQUE (phone);


--
-- Name: ecosystem_identities ecosystem_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ecosystem_identities
    ADD CONSTRAINT ecosystem_identities_pkey PRIMARY KEY (dnia_id);


--
-- Name: email_events email_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_events
    ADD CONSTRAINT email_events_pkey PRIMARY KEY (id);


--
-- Name: email_events email_events_svix_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_events
    ADD CONSTRAINT email_events_svix_id_key UNIQUE (svix_id);


--
-- Name: email_suppressions email_suppressions_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_suppressions
    ADD CONSTRAINT email_suppressions_email_key UNIQUE (email);


--
-- Name: email_suppressions email_suppressions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_suppressions
    ADD CONSTRAINT email_suppressions_pkey PRIMARY KEY (id);


--
-- Name: email_templates email_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_pkey PRIMARY KEY (id);


--
-- Name: journey_runs journey_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journey_runs
    ADD CONSTRAINT journey_runs_pkey PRIMARY KEY (id);


--
-- Name: journey_step_log journey_step_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journey_step_log
    ADD CONSTRAINT journey_step_log_pkey PRIMARY KEY (id);


--
-- Name: journeys journeys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journeys
    ADD CONSTRAINT journeys_pkey PRIMARY KEY (id);


--
-- Name: lead_conversions lead_conversions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_conversions
    ADD CONSTRAINT lead_conversions_pkey PRIMARY KEY (id);


--
-- Name: lead_notes lead_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_notes
    ADD CONSTRAINT lead_notes_pkey PRIMARY KEY (id);


--
-- Name: lead_statuses lead_statuses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_statuses
    ADD CONSTRAINT lead_statuses_pkey PRIMARY KEY (id);


--
-- Name: lead_tags lead_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_tags
    ADD CONSTRAINT lead_tags_pkey PRIMARY KEY (lead_id, tag_id);


--
-- Name: leads leads_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_email_unique UNIQUE (email);


--
-- Name: leads leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (id);


--
-- Name: meta_config meta_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meta_config
    ADD CONSTRAINT meta_config_pkey PRIMARY KEY (id);


--
-- Name: nexus_config nexus_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nexus_config
    ADD CONSTRAINT nexus_config_pkey PRIMARY KEY (id);


--
-- Name: pages pages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_pkey PRIMARY KEY (id);


--
-- Name: pages pages_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_slug_key UNIQUE (slug);


--
-- Name: pingback_config pingback_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pingback_config
    ADD CONSTRAINT pingback_config_pkey PRIMARY KEY (id);


--
-- Name: scoring_config scoring_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scoring_config
    ADD CONSTRAINT scoring_config_pkey PRIMARY KEY (id);


--
-- Name: segment_contacts segment_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.segment_contacts
    ADD CONSTRAINT segment_contacts_pkey PRIMARY KEY (segment_id, lead_id);


--
-- Name: segments segments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.segments
    ADD CONSTRAINT segments_pkey PRIMARY KEY (id);


--
-- Name: tags tags_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_name_key UNIQUE (name);


--
-- Name: tags tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


--
-- Name: webhook_logs webhook_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_logs
    ADD CONSTRAINT webhook_logs_pkey PRIMARY KEY (id);


--
-- Name: idx_ab_assignments_test; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ab_assignments_test ON public.ab_assignments USING btree (ab_test, assigned_at DESC);


--
-- Name: idx_ab_assignments_vid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ab_assignments_vid ON public.ab_assignments USING btree (ab_vid);


--
-- Name: idx_ab_events_test_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ab_events_test_time ON public.ab_events USING btree (ab_test, occurred_at DESC);


--
-- Name: idx_ab_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ab_events_type ON public.ab_events USING btree (event_type, occurred_at DESC);


--
-- Name: idx_ab_events_vid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ab_events_vid ON public.ab_events USING btree (ab_vid);


--
-- Name: idx_ab_identities_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ab_identities_email ON public.ab_identities USING btree (lower(email));


--
-- Name: idx_ab_identities_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ab_identities_lead ON public.ab_identities USING btree (lead_id);


--
-- Name: idx_ab_identities_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ab_identities_phone ON public.ab_identities USING btree (phone_normalized);


--
-- Name: idx_ab_identities_vid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ab_identities_vid ON public.ab_identities USING btree (ab_vid);


--
-- Name: idx_ab_tests_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ab_tests_created_at ON public.ab_tests USING btree (created_at DESC);


--
-- Name: idx_ab_tests_public_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ab_tests_public_slug ON public.ab_tests USING btree (public_slug, updated_at DESC);


--
-- Name: idx_ab_tests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ab_tests_status ON public.ab_tests USING btree (status);


--
-- Name: idx_ai_chat_conversations_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_chat_conversations_updated_at ON public.ai_chat_conversations USING btree (updated_at DESC);


--
-- Name: idx_ai_chat_conversations_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_chat_conversations_user_id ON public.ai_chat_conversations USING btree (user_id);


--
-- Name: idx_ai_chat_messages_conversation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_chat_messages_conversation_id ON public.ai_chat_messages USING btree (conversation_id);


--
-- Name: idx_ai_chat_messages_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_chat_messages_created_at ON public.ai_chat_messages USING btree (created_at);


--
-- Name: idx_api_keys_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_keys_active ON public.api_keys USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_api_keys_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_keys_hash ON public.api_keys USING btree (key_hash);


--
-- Name: idx_automation_rules_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_rules_active ON public.automation_rules USING btree (is_active, priority DESC);


--
-- Name: idx_campaign_sends_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaign_sends_campaign ON public.campaign_sends USING btree (campaign_id);


--
-- Name: idx_campaign_sends_campaign_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaign_sends_campaign_status ON public.campaign_sends USING btree (campaign_id, status);


--
-- Name: idx_campaign_sends_journey_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaign_sends_journey_run ON public.campaign_sends USING btree (journey_run_id) WHERE (journey_run_id IS NOT NULL);


--
-- Name: idx_campaign_sends_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaign_sends_lead ON public.campaign_sends USING btree (lead_id);


--
-- Name: idx_campaign_sends_resend_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaign_sends_resend_id ON public.campaign_sends USING btree (resend_email_id);


--
-- Name: idx_contact_events_lead_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_events_lead_id ON public.contact_events USING btree (lead_id);


--
-- Name: idx_contact_events_lead_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_events_lead_occurred ON public.contact_events USING btree (lead_id, occurred_at DESC) WHERE (lead_id IS NOT NULL);


--
-- Name: idx_contact_events_occurred_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_events_occurred_at ON public.contact_events USING btree (occurred_at DESC);


--
-- Name: idx_contact_events_status_atual; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_events_status_atual ON public.contact_events USING btree (((metadata ->> 'status_atual'::text)), occurred_at DESC) WHERE (event_type = 'contact_updated'::text);


--
-- Name: idx_contact_events_type_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_events_type_occurred ON public.contact_events USING btree (event_type, occurred_at DESC);


--
-- Name: idx_contact_events_universal_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_events_universal_id ON public.contact_events USING btree (dnia_id);


--
-- Name: idx_ecosystem_identities_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ecosystem_identities_email ON public.ecosystem_identities USING btree (email);


--
-- Name: idx_ecosystem_identities_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ecosystem_identities_stage ON public.ecosystem_identities USING btree (stage);


--
-- Name: idx_email_events_campaign_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_events_campaign_type ON public.email_events USING btree (campaign_id, event_type);


--
-- Name: idx_email_events_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_events_lead ON public.email_events USING btree (lead_id, occurred_at DESC);


--
-- Name: idx_email_events_resend_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_events_resend_id ON public.email_events USING btree (resend_email_id);


--
-- Name: idx_email_templates_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_templates_category ON public.email_templates USING btree (category);


--
-- Name: idx_email_templates_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_templates_created_at ON public.email_templates USING btree (created_at DESC);


--
-- Name: idx_journey_runs_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journey_runs_due ON public.journey_runs USING btree (wakeup_at) WHERE (state = ANY (ARRAY['active'::text, 'waiting'::text]));


--
-- Name: idx_journey_runs_journey; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journey_runs_journey ON public.journey_runs USING btree (journey_id, state);


--
-- Name: idx_journey_runs_waiting_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journey_runs_waiting_event ON public.journey_runs USING btree (lead_id, waiting_event) WHERE (state = 'waiting'::text);


--
-- Name: idx_journey_step_log_metrics; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journey_step_log_metrics ON public.journey_step_log USING btree (journey_id, node_id, result);


--
-- Name: idx_journey_step_log_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journey_step_log_run ON public.journey_step_log USING btree (run_id, occurred_at);


--
-- Name: idx_journeys_event_entry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journeys_event_entry ON public.journeys USING btree (((entry_config ->> 'event_type'::text))) WHERE ((status = 'active'::text) AND (entry_type = 'event'::text));


--
-- Name: idx_journeys_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journeys_status ON public.journeys USING btree (status);


--
-- Name: idx_lead_conversions_ab_test; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_conversions_ab_test ON public.lead_conversions USING btree (ab_test);


--
-- Name: idx_lead_conversions_ab_vid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_conversions_ab_vid ON public.lead_conversions USING btree (ab_vid);


--
-- Name: idx_lead_conversions_converted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_conversions_converted_at ON public.lead_conversions USING btree (converted_at);


--
-- Name: idx_lead_conversions_lead_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_conversions_lead_id ON public.lead_conversions USING btree (lead_id);


--
-- Name: idx_lead_conversions_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_conversions_tipo ON public.lead_conversions USING btree (tipo);


--
-- Name: idx_lead_notes_lead_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_notes_lead_id ON public.lead_notes USING btree (lead_id);


--
-- Name: idx_leads_ab_test; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_ab_test ON public.leads USING btree (ab_test);


--
-- Name: idx_leads_ab_vid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_ab_vid ON public.leads USING btree (ab_vid);


--
-- Name: idx_leads_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_created_at ON public.leads USING btree (created_at DESC);


--
-- Name: idx_leads_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_deleted_at ON public.leads USING btree (deleted_at);


--
-- Name: idx_leads_dnia_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_dnia_id ON public.leads USING btree (dnia_id) WHERE (dnia_id IS NOT NULL);


--
-- Name: idx_leads_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_email ON public.leads USING btree (email);


--
-- Name: idx_leads_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_score ON public.leads USING btree (lead_score DESC);


--
-- Name: idx_leads_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_tipo ON public.leads USING btree (tipo);


--
-- Name: lead_statuses_name_lower_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX lead_statuses_name_lower_uniq ON public.lead_statuses USING btree (lower(name));


--
-- Name: uniq_campaign_sends_email_campaign_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_campaign_sends_email_campaign_lead ON public.campaign_sends USING btree (campaign_id, lead_id) WHERE ((channel = 'email'::text) AND (lead_id IS NOT NULL) AND (campaign_id IS NOT NULL));


--
-- Name: uniq_campaign_sends_journey_node; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_campaign_sends_journey_node ON public.campaign_sends USING btree (journey_run_id, journey_node_id) WHERE (journey_run_id IS NOT NULL);


--
-- Name: uniq_journey_runs_open; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_journey_runs_open ON public.journey_runs USING btree (journey_id, lead_id) WHERE (state = ANY (ARRAY['active'::text, 'waiting'::text]));


--
-- Name: uq_ab_events_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_ab_events_dedupe ON public.ab_events USING btree (dedupe_key) WHERE (dedupe_key IS NOT NULL);


--
-- Name: uq_ab_tests_public_slug_running; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_ab_tests_public_slug_running ON public.ab_tests USING btree (public_slug) WHERE (status = 'running'::text);


--
-- Name: page_stats _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.page_stats WITH (security_invoker='true') AS
 SELECT p.id,
    p.slug,
    p.name,
    p.status,
    p.config,
    p.template_base,
    p.page_type,
    p.created_at,
    p.updated_at,
    count(DISTINCT lc.lead_id) AS total_leads,
    count(DISTINCT lc.lead_id) FILTER (WHERE (l.etiqueta = 'hotlead'::text)) AS hot_leads,
    max(lc.converted_at) AS last_lead_at
   FROM ((public.pages p
     LEFT JOIN public.lead_conversions lc ON (((lc.page_slug)::text = p.slug)))
     LEFT JOIN public.leads l ON ((l.id = lc.lead_id)))
  GROUP BY p.id;


--
-- Name: ab_config trg_ab_config_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ab_config_updated BEFORE UPDATE ON public.ab_config FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: ab_tests trg_ab_tests_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ab_tests_updated BEFORE UPDATE ON public.ab_tests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: leads trg_automation_on_etiqueta_change; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: automation_rules trg_automation_rules_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_automation_rules_updated BEFORE UPDATE ON public.automation_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: campaign_sends trg_campaign_send_event; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_campaign_send_event AFTER INSERT OR UPDATE ON public.campaign_sends FOR EACH ROW EXECUTE FUNCTION public.fn_campaign_send_event();


--
-- Name: campaigns trg_campaigns_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_campaigns_updated BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: contact_events trg_contact_event_journey; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: ecosystem_identities trg_ecosystem_identities_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ecosystem_identities_updated_at BEFORE UPDATE ON public.ecosystem_identities FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: email_templates trg_email_templates_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_email_templates_updated BEFORE UPDATE ON public.email_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: campaigns trg_guard_campaign_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guard_campaign_delete BEFORE DELETE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.guard_campaign_delete();


--
-- Name: segments trg_guard_segment_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guard_segment_delete BEFORE DELETE ON public.segments FOR EACH ROW EXECUTE FUNCTION public.guard_segment_delete();


--
-- Name: journeys trg_journeys_delete_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_journeys_delete_guard BEFORE DELETE ON public.journeys FOR EACH ROW EXECUTE FUNCTION public.guard_journey_delete();


--
-- Name: journeys trg_journeys_validate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_journeys_validate BEFORE INSERT OR UPDATE ON public.journeys FOR EACH ROW EXECUTE FUNCTION public.fn_journeys_validate();


--
-- Name: leads trg_lead_insert_event; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_lead_insert_event AFTER INSERT ON public.leads FOR EACH ROW EXECUTE FUNCTION public.fn_lead_insert_event();


--
-- Name: lead_statuses trg_lead_statuses_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_lead_statuses_updated_at BEFORE UPDATE ON public.lead_statuses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: meta_config trg_meta_config_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_meta_config_updated_at BEFORE UPDATE ON public.meta_config FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: email_suppressions trg_normalize_suppression_email; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_normalize_suppression_email BEFORE INSERT OR UPDATE ON public.email_suppressions FOR EACH ROW EXECUTE FUNCTION public.normalize_suppression_email();


--
-- Name: pages trg_sanitize_page_slug; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sanitize_page_slug BEFORE INSERT OR UPDATE OF slug ON public.pages FOR EACH ROW EXECUTE FUNCTION public.sanitize_page_slug();


--
-- Name: leads trg_score_lead_on_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_score_lead_on_change BEFORE INSERT OR UPDATE OF cargo, faturamento, funcionarios, desafios, whatsapp, utm_source, source ON public.leads FOR EACH ROW EXECUTE FUNCTION public.score_lead_from_config();


--
-- Name: campaigns trg_sync_campaign_legacy_segment_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_campaign_legacy_segment_id BEFORE INSERT OR UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.sync_campaign_legacy_segment_id();


--
-- Name: lead_conversions trg_update_last_conversion_date; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_update_last_conversion_date AFTER INSERT ON public.lead_conversions FOR EACH ROW EXECUTE FUNCTION public.fn_update_last_conversion_date();


--
-- Name: leads trg_update_leads_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_update_leads_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.update_leads_updated_at();


--
-- Name: automation_rules trg_validate_automation_rule; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_automation_rule BEFORE INSERT OR UPDATE ON public.automation_rules FOR EACH ROW EXECUTE FUNCTION public.validate_automation_rule_fields();


--
-- Name: campaigns trg_validate_campaign_channel; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_campaign_channel BEFORE INSERT OR UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.validate_campaign_channel();


--
-- Name: campaign_sends trg_validate_campaign_send_channel; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_campaign_send_channel BEFORE INSERT OR UPDATE ON public.campaign_sends FOR EACH ROW EXECUTE FUNCTION public.validate_campaign_send_channel();


--
-- Name: campaign_sends trg_validate_campaign_send_status; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_campaign_send_status BEFORE INSERT OR UPDATE ON public.campaign_sends FOR EACH ROW EXECUTE FUNCTION public.validate_campaign_send_status();


--
-- Name: campaigns trg_validate_campaign_status; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_campaign_status BEFORE INSERT OR UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.validate_campaign_status();


--
-- Name: contact_events trg_validate_contact_event_source; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_contact_event_source BEFORE INSERT OR UPDATE ON public.contact_events FOR EACH ROW EXECUTE FUNCTION public.validate_contact_event_source_app();


--
-- Name: contact_events trg_validate_contact_event_source_app; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_contact_event_source_app BEFORE INSERT OR UPDATE ON public.contact_events FOR EACH ROW EXECUTE FUNCTION public.validate_contact_event_source_app();


--
-- Name: ecosystem_identities trg_validate_ecosystem_identity_stage; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_ecosystem_identity_stage BEFORE INSERT OR UPDATE ON public.ecosystem_identities FOR EACH ROW EXECUTE FUNCTION public.validate_ecosystem_identity_stage();


--
-- Name: ecosystem_identities trg_validate_ecosystem_stage; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_ecosystem_stage BEFORE INSERT OR UPDATE ON public.ecosystem_identities FOR EACH ROW EXECUTE FUNCTION public.validate_ecosystem_identity_stage();


--
-- Name: leads trigger_classify_lead_etiqueta; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_classify_lead_etiqueta BEFORE INSERT OR UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.classify_lead_etiqueta();

ALTER TABLE public.leads DISABLE TRIGGER trigger_classify_lead_etiqueta;


--
-- Name: leads trigger_leads_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_leads_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.update_leads_updated_at();


--
-- Name: ai_chat_conversations update_ai_chat_conversations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_ai_chat_conversations_updated_at BEFORE UPDATE ON public.ai_chat_conversations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: nexus_config update_nexus_config_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_nexus_config_updated_at BEFORE UPDATE ON public.nexus_config FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: pages update_pages_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_pages_updated_at BEFORE UPDATE ON public.pages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: pingback_config update_pingback_config_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_pingback_config_updated_at BEFORE UPDATE ON public.pingback_config FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: ai_chat_messages ai_chat_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_chat_messages
    ADD CONSTRAINT ai_chat_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.ai_chat_conversations(id) ON DELETE CASCADE;


--
-- Name: campaign_sends campaign_sends_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_sends
    ADD CONSTRAINT campaign_sends_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;


--
-- Name: campaign_sends campaign_sends_journey_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_sends
    ADD CONSTRAINT campaign_sends_journey_run_id_fkey FOREIGN KEY (journey_run_id) REFERENCES public.journey_runs(id) ON DELETE SET NULL;


--
-- Name: campaign_sends campaign_sends_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_sends
    ADD CONSTRAINT campaign_sends_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;


--
-- Name: challenge_insights challenge_insights_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_insights
    ADD CONSTRAINT challenge_insights_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: contact_events contact_events_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_events
    ADD CONSTRAINT contact_events_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;


--
-- Name: email_events email_events_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_events
    ADD CONSTRAINT email_events_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL;


--
-- Name: email_events email_events_campaign_send_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_events
    ADD CONSTRAINT email_events_campaign_send_id_fkey FOREIGN KEY (campaign_send_id) REFERENCES public.campaign_sends(id) ON DELETE SET NULL;


--
-- Name: email_events email_events_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_events
    ADD CONSTRAINT email_events_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;


--
-- Name: email_suppressions email_suppressions_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_suppressions
    ADD CONSTRAINT email_suppressions_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;


--
-- Name: journey_runs journey_runs_journey_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journey_runs
    ADD CONSTRAINT journey_runs_journey_id_fkey FOREIGN KEY (journey_id) REFERENCES public.journeys(id) ON DELETE CASCADE;


--
-- Name: journey_runs journey_runs_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journey_runs
    ADD CONSTRAINT journey_runs_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: journey_step_log journey_step_log_journey_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journey_step_log
    ADD CONSTRAINT journey_step_log_journey_id_fkey FOREIGN KEY (journey_id) REFERENCES public.journeys(id) ON DELETE CASCADE;


--
-- Name: journey_step_log journey_step_log_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journey_step_log
    ADD CONSTRAINT journey_step_log_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;


--
-- Name: journey_step_log journey_step_log_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journey_step_log
    ADD CONSTRAINT journey_step_log_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.journey_runs(id) ON DELETE CASCADE;


--
-- Name: lead_conversions lead_conversions_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_conversions
    ADD CONSTRAINT lead_conversions_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: lead_notes lead_notes_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_notes
    ADD CONSTRAINT lead_notes_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: lead_tags lead_tags_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_tags
    ADD CONSTRAINT lead_tags_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: lead_tags lead_tags_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_tags
    ADD CONSTRAINT lead_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;


--
-- Name: meta_config meta_config_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meta_config
    ADD CONSTRAINT meta_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);


--
-- Name: nexus_config nexus_config_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nexus_config
    ADD CONSTRAINT nexus_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: pingback_config pingback_config_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pingback_config
    ADD CONSTRAINT pingback_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: segment_contacts segment_contacts_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.segment_contacts
    ADD CONSTRAINT segment_contacts_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: segment_contacts segment_contacts_segment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.segment_contacts
    ADD CONSTRAINT segment_contacts_segment_id_fkey FOREIGN KEY (segment_id) REFERENCES public.segments(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: challenge_insights Admins can delete challenge insights; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete challenge insights" ON public.challenge_insights FOR DELETE USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: leads Admins can delete leads; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete leads" ON public.leads FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: meta_config Admins can delete meta config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete meta config" ON public.meta_config FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: nexus_config Admins can delete nexus_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete nexus_config" ON public.nexus_config FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: pages Admins can delete pages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete pages" ON public.pages FOR DELETE USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: pingback_config Admins can delete pingback_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete pingback_config" ON public.pingback_config FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: challenge_insights Admins can insert challenge insights; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can insert challenge insights" ON public.challenge_insights FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: dashboard_settings Admins can insert dashboard settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can insert dashboard settings" ON public.dashboard_settings FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: meta_config Admins can insert meta config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can insert meta config" ON public.meta_config FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: nexus_config Admins can insert nexus_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can insert nexus_config" ON public.nexus_config FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: pages Admins can insert pages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can insert pages" ON public.pages FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: pingback_config Admins can insert pingback_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can insert pingback_config" ON public.pingback_config FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: ab_config Admins can manage ab_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage ab_config" ON public.ab_config TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: ab_tests Admins can manage ab_tests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage ab_tests" ON public.ab_tests TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: email_suppressions Admins can manage email suppressions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage email suppressions" ON public.email_suppressions TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: email_templates Admins can manage email templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage email templates" ON public.email_templates TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: ab_assignments Admins can read ab_assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read ab_assignments" ON public.ab_assignments TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: ab_events Admins can read ab_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read ab_events" ON public.ab_events TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: ab_identities Admins can read ab_identities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read ab_identities" ON public.ab_identities TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: leads Admins can read all leads; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read all leads" ON public.leads FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: challenge_insights Admins can read challenge insights; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read challenge insights" ON public.challenge_insights FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: dashboard_settings Admins can read dashboard settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read dashboard settings" ON public.dashboard_settings FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: lead_conversions Admins can read lead conversions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read lead conversions" ON public.lead_conversions FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: pages Admins can read pages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read pages" ON public.pages FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: nexus_config Admins can select nexus_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can select nexus_config" ON public.nexus_config FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: pingback_config Admins can select pingback_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can select pingback_config" ON public.pingback_config FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: dashboard_settings Admins can update dashboard settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update dashboard settings" ON public.dashboard_settings FOR UPDATE USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: meta_config Admins can update meta config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update meta config" ON public.meta_config FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: nexus_config Admins can update nexus_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update nexus_config" ON public.nexus_config FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: pages Admins can update pages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update pages" ON public.pages FOR UPDATE USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: pingback_config Admins can update pingback_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update pingback_config" ON public.pingback_config FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: email_events Admins can view email events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view email events" ON public.email_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: meta_config Admins can view meta config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view meta config" ON public.meta_config FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: lead_statuses Admins manage lead_statuses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins manage lead_statuses" ON public.lead_statuses TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: webhook_logs Allow admin read on webhook_logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow admin read on webhook_logs" ON public.webhook_logs FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: lead_conversions Allow public insert on lead_conversions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public insert on lead_conversions" ON public.lead_conversions FOR INSERT WITH CHECK (true);


--
-- Name: lead_statuses Authenticated can read lead_statuses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated can read lead_statuses" ON public.lead_statuses FOR SELECT TO authenticated USING (true);


--
-- Name: user_roles Restrict deletes on user_roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Restrict deletes on user_roles" ON public.user_roles AS RESTRICTIVE FOR DELETE USING (false);


--
-- Name: user_roles Restrict inserts on user_roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Restrict inserts on user_roles" ON public.user_roles AS RESTRICTIVE FOR INSERT WITH CHECK (false);


--
-- Name: user_roles Restrict updates on user_roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Restrict updates on user_roles" ON public.user_roles AS RESTRICTIVE FOR UPDATE USING (false) WITH CHECK (false);


--
-- Name: ai_chat_messages Users can delete messages of own conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete messages of own conversations" ON public.ai_chat_messages FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.ai_chat_conversations
  WHERE ((ai_chat_conversations.id = ai_chat_messages.conversation_id) AND (ai_chat_conversations.user_id = auth.uid()) AND public.has_role(auth.uid(), 'admin'::public.app_role)))));


--
-- Name: ai_chat_conversations Users can delete own conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own conversations" ON public.ai_chat_conversations FOR DELETE USING (((user_id = auth.uid()) AND public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: ai_chat_messages Users can insert messages to own conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert messages to own conversations" ON public.ai_chat_messages FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.ai_chat_conversations
  WHERE ((ai_chat_conversations.id = ai_chat_messages.conversation_id) AND (ai_chat_conversations.user_id = auth.uid()) AND public.has_role(auth.uid(), 'admin'::public.app_role)))));


--
-- Name: ai_chat_conversations Users can insert own conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own conversations" ON public.ai_chat_conversations FOR INSERT WITH CHECK (((user_id = auth.uid()) AND public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: ai_chat_messages Users can read messages of own conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read messages of own conversations" ON public.ai_chat_messages FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.ai_chat_conversations
  WHERE ((ai_chat_conversations.id = ai_chat_messages.conversation_id) AND (ai_chat_conversations.user_id = auth.uid()) AND public.has_role(auth.uid(), 'admin'::public.app_role)))));


--
-- Name: ai_chat_conversations Users can read own conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own conversations" ON public.ai_chat_conversations FOR SELECT USING (((user_id = auth.uid()) AND public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: user_roles Users can read their own roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read their own roles" ON public.user_roles FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: ai_chat_conversations Users can update own conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own conversations" ON public.ai_chat_conversations FOR UPDATE USING (((user_id = auth.uid()) AND public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: ab_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ab_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: ab_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ab_config ENABLE ROW LEVEL SECURITY;

--
-- Name: ab_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ab_events ENABLE ROW LEVEL SECURITY;

--
-- Name: ab_identities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ab_identities ENABLE ROW LEVEL SECURITY;

--
-- Name: ab_tests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ab_tests ENABLE ROW LEVEL SECURITY;

--
-- Name: api_keys admin_all_api_keys; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_all_api_keys ON public.api_keys TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: automation_rules admin_all_automation_rules; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_all_automation_rules ON public.automation_rules TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: campaign_sends admin_all_campaign_sends; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_all_campaign_sends ON public.campaign_sends TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: campaigns admin_all_campaigns; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_all_campaigns ON public.campaigns TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: contact_events admin_all_contact_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_all_contact_events ON public.contact_events TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: ecosystem_identities admin_all_ecosystem_identities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_all_ecosystem_identities ON public.ecosystem_identities TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: journeys admin_all_journeys; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_all_journeys ON public.journeys TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: lead_notes admin_all_lead_notes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_all_lead_notes ON public.lead_notes TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: lead_tags admin_all_lead_tags; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_all_lead_tags ON public.lead_tags TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: segment_contacts admin_all_segment_contacts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_all_segment_contacts ON public.segment_contacts TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: segments admin_all_segments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_all_segments ON public.segments TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: tags admin_all_tags; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_all_tags ON public.tags TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: scoring_config admin_insert_scoring_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_insert_scoring_config ON public.scoring_config FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: journey_runs admin_read_journey_runs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read_journey_runs ON public.journey_runs FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: journey_step_log admin_read_journey_step_log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read_journey_step_log ON public.journey_step_log FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: scoring_config admin_read_scoring_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read_scoring_config ON public.scoring_config FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: scoring_config admin_update_scoring_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_update_scoring_config ON public.scoring_config FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: ai_chat_conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_chat_conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_chat_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_chat_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: api_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: automation_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: campaign_sends; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.campaign_sends ENABLE ROW LEVEL SECURITY;

--
-- Name: campaigns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

--
-- Name: challenge_insights; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.challenge_insights ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contact_events ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboard_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: ecosystem_identities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ecosystem_identities ENABLE ROW LEVEL SECURITY;

--
-- Name: email_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;

--
-- Name: email_suppressions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;

--
-- Name: email_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: journey_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.journey_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: journey_step_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.journey_step_log ENABLE ROW LEVEL SECURITY;

--
-- Name: journeys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.journeys ENABLE ROW LEVEL SECURITY;

--
-- Name: lead_conversions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lead_conversions ENABLE ROW LEVEL SECURITY;

--
-- Name: lead_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lead_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: lead_statuses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lead_statuses ENABLE ROW LEVEL SECURITY;

--
-- Name: lead_tags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lead_tags ENABLE ROW LEVEL SECURITY;

--
-- Name: leads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

--
-- Name: meta_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.meta_config ENABLE ROW LEVEL SECURITY;

--
-- Name: nexus_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nexus_config ENABLE ROW LEVEL SECURITY;

--
-- Name: pages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;

--
-- Name: pingback_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pingback_config ENABLE ROW LEVEL SECURITY;

--
-- Name: scoring_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scoring_config ENABLE ROW LEVEL SECURITY;

--
-- Name: segment_contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.segment_contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: segments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.segments ENABLE ROW LEVEL SECURITY;

--
-- Name: tags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: webhook_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict omrKdr0Z4YvTdoka89GvV59JiIPAJ2pPCMHCafbiDpOcOeW1Zd9hd6PkxTiB7xi

