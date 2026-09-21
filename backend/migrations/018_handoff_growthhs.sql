-- 018 — O handoff para o GrowthHS: configuração, fila e vocabulário.
--
-- Sai o Nexus (CRM da dn.ia), entra o GrowthHS, chamado pela API dele
-- (POST /api/v1/integration/cards — docs/contratos/2026-09-02-...). Tudo o que
-- esta migration troca estava VAZIO em 21/09/2026: automation_rules (0 linhas),
-- nexus_config (0), nenhum nexus_contact_id preenchido.
--
-- ⚠️ `nexus_contact_id` FICA: ele é escrito pelo agendamento "dn.nexus"
-- (resolve_or_create_identity, source_app = 'nexus'), que é outro produto.
--
-- Reaplicável: rode duas vezes para provar.

-- 1. A configuração. A chave NÃO mora aqui: vai em integration_secrets
--    (GROWTHHS_API_KEY), como a do Resend e a do Meta.
CREATE TABLE IF NOT EXISTS public.growthhs_config (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    base_url   text,
    board_id   bigint,
    app_url    text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS growthhs_config_linha_unica
    ON public.growthhs_config ((true));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.growthhs_config TO service_role;

DROP TABLE IF EXISTS public.nexus_config;

-- 2. O vínculo do contato com o card. Inteiros: o GrowthHS devolve id numérico.
ALTER TABLE public.ecosystem_identities
    ADD COLUMN IF NOT EXISTS growthhs_card_id bigint,
    ADD COLUMN IF NOT EXISTS growthhs_person_id bigint;

-- 3. A fila de entrega. Um pedido por lead e ação enquanto pendente — é o que
--    impede o mesmo lead de virar dois cards por dois caminhos ao mesmo tempo
--    (regra + jornada + botão).
CREATE TABLE IF NOT EXISTS public.crm_handoffs (
    id             bigserial PRIMARY KEY,
    lead_id        uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
    acao           text NOT NULL DEFAULT 'criar' CHECK (acao IN ('criar', 'mover')),
    origem         text NOT NULL CHECK (origem IN ('regra', 'jornada', 'manual')),
    rule_id        uuid,
    journey_run_id uuid,
    status         text NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente', 'entregue', 'falhou')),
    tentativas     integer NOT NULL DEFAULT 0,
    visivel_em     timestamptz NOT NULL DEFAULT now(),
    erro           text,
    card_id        bigint,
    person_id      bigint,
    criado_em      timestamptz NOT NULL DEFAULT now(),
    atualizado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_crm_handoffs_pendente
    ON public.crm_handoffs (lead_id, acao) WHERE status = 'pendente';
CREATE INDEX IF NOT EXISTS idx_crm_handoffs_a_entregar
    ON public.crm_handoffs (visivel_em) WHERE status = 'pendente';
CREATE INDEX IF NOT EXISTS idx_crm_handoffs_lead
    ON public.crm_handoffs (lead_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_handoffs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.crm_handoffs_id_seq TO service_role;

-- 4. O vocabulário das regras: troca 'create_in_nexus'/'move_stage_nexus'/
--    'block_nexus' pelo trio do GrowthHS. Porte literal de
--    001_schema_origem.sql:2029-2066, só a última verificação muda.
CREATE OR REPLACE FUNCTION public.validate_automation_rule_fields() RETURNS trigger
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

  IF NEW.action_type NOT IN ('create_in_growthhs','move_stage_growthhs','block_growthhs') THEN
    RAISE EXCEPTION 'Invalid action_type: %', NEW.action_type;
  END IF;
  RETURN NEW;
END;
$$;

-- 5. O nó de jornada: 'handoff_nexus' vira 'handoff_growthhs', e sem
--    configuração obrigatória (decisão 7 — o card entra na etapa de entrada
--    do funil configurado, não numa stage cravada no fluxo). Porte literal de
--    001_schema_origem.sql:2171-2283.
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
       ('send_email','delay','wait_for_event','branch_attribute','branch_segment','branch_email_event','apply_tag','handoff_growthhs') THEN
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
