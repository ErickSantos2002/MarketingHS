-- 027 — Prova de substituição do RD (frente prova-captura, 21/10/2026): todo o
-- schema da prova de uma vez. Plano:
-- docs/superpowers/plans/2026-10-21-prova-substituir-rd.md, Tarefa 1.
--
-- O ERICK RODA (`bash ~/marketinghs-migration-027.sh`). Reaplicável: CREATE
-- TABLE / INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE
-- FUNCTION, DROP POLICY IF EXISTS antes de cada CREATE POLICY, GRANT. Rode
-- duas vezes. Nenhuma extensão.
--
-- ADITIVA: tabelas e colunas novas, funções recriadas com o comportamento de
-- antes preservado. Pode ir ANTES do deploy da Fase 1 — o código de hoje não
-- lê nada daqui, e os testes da Fase 1 pulam enquanto ela não estiver no banco.
--
-- Os três índices únicos que impedem e-mail duplicado (CLAUDE.md, "Banco") NÃO
-- são tocados — nem citados por nome, para o teste de texto provar isso.
--
-- O que faz:
--   1. Colunas: `leads.campos_extras`, a origem da conversão em
--      `lead_conversions`, o modo teste em `journeys.allowed_emails`.
--   2. Tabelas: `lead_consents`, `sites`, `visitas`, `journey_saidas`,
--      `growthhs_receptor_pedidos` — RLS ligado ANTES do GRANT (molde da 022).
--   3. Funções, cada uma copiada da versão vigente com o mínimo mudado:
--      a. `build_segment_condition` (001): regra `campo_extra`;
--      b. `validate_journey_graph` (026): nós `notify_email` e `webhook`;
--      c. `fn_lead_insert_event` (026): `form_id` e `site_id` no metadata;
--      d. `journey_enroll_event(uuid, text, jsonb)` (026): filtro por
--         formulário (`entry_config.form_ids`) em OU com a página;
--      e. `validate_contact_event_source_app` (006): aceita `growthhs`.


-- 1. Colunas ------------------------------------------------------------------

-- As respostas que não têm coluna própria (`ja_faz_testagem`, `qtd_equipamentos`…).
-- Chave validada no servidor (`^[a-z][a-z0-9_]{0,39}$`, app/captura/campos.py).
ALTER TABLE public.leads
    ADD COLUMN IF NOT EXISTS campos_extras jsonb NOT NULL DEFAULT '{}'::jsonb;

-- De onde veio CADA conversão (o primeiro toque do lead continua congelado em
-- `leads`): o formulário, o site cadastrado, o visitante, a URL e o canal.
ALTER TABLE public.lead_conversions
    ADD COLUMN IF NOT EXISTS form_id    text,
    ADD COLUMN IF NOT EXISTS site_id    uuid,
    ADD COLUMN IF NOT EXISTS visitor_id text,
    ADD COLUMN IF NOT EXISTS page_url   text,
    ADD COLUMN IF NOT EXISTS page_path  text,
    ADD COLUMN IF NOT EXISTS canal      text;

-- Modo teste da jornada: NULL = sem modo teste (o comportamento de hoje); lista
-- = só esses e-mails recebem efeito. Quem interpreta é o executor (Tarefa 7).
ALTER TABLE public.journeys
    ADD COLUMN IF NOT EXISTS allowed_emails text[];


-- 2. Tabelas ------------------------------------------------------------------

-- 2a. Os sites de fora (o site institucional, a página de teste). O token
--     (`pub_…`) é público: só cria/atualiza lead, conversão e visita, e só vale
--     com Origin de um dos `dominios`.
CREATE TABLE IF NOT EXISTS public.sites (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome          text NOT NULL,
    dominios      text[] NOT NULL DEFAULT '{}',
    token         text NOT NULL UNIQUE,
    mapa_campos   jsonb NOT NULL DEFAULT '{}'::jsonb,
    tags          text[] NOT NULL DEFAULT '{}',
    ativo         boolean NOT NULL DEFAULT true,
    criado_em     timestamptz NOT NULL DEFAULT now(),
    atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- 2b. Um registro por aceite (ou por base legal assumida), com o texto e a
--     versão que valiam na hora. Nunca se atualiza: o histórico é a prova.
CREATE TABLE IF NOT EXISTS public.lead_consents (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id      uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
    conversao_id uuid,
    base_legal   text NOT NULL
                 CHECK (base_legal IN ('consentimento', 'legitimo_interesse_pedido_contato')),
    texto        text NOT NULL,
    versao       text NOT NULL,
    provisoria   boolean NOT NULL DEFAULT false,
    ip           text,
    user_agent   text,
    origem_tipo  text CHECK (origem_tipo IN ('pagina', 'site')),
    page_slug    text,
    site_id      uuid,
    form_id      text,
    page_url     text,
    criado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_consents_lead
    ON public.lead_consents (lead_id, criado_em DESC);

-- 2c. Visitas: da landing (`page_slug`) ou de um site cadastrado (`site_id`).
--     Uma das duas tem que existir — visita sem origem não entra em conta
--     nenhuma.
CREATE TABLE IF NOT EXISTS public.visitas (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    criado_em      timestamptz NOT NULL DEFAULT now(),
    visitor_id     text NOT NULL,
    site_id        uuid REFERENCES public.sites(id) ON DELETE SET NULL,
    page_slug      text,
    url            text,
    path           text,
    titulo         text,
    referrer       text,
    utm_source     text,
    utm_medium     text,
    utm_campaign   text,
    utm_term       text,
    utm_content    text,
    gclid          text,
    fbclid         text,
    canal          text NOT NULL,
    primeiro_toque jsonb,
    CONSTRAINT visitas_com_origem CHECK (site_id IS NOT NULL OR page_slug IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_visitas_pagina
    ON public.visitas (page_slug, criado_em);
CREATE INDEX IF NOT EXISTS idx_visitas_site_path
    ON public.visitas (site_id, path, criado_em);
CREATE INDEX IF NOT EXISTS idx_visitas_visitante
    ON public.visitas (visitor_id);

-- 2d. Caixa de saída dos nós "avisar por e-mail" e "enviar para webhook",
--     drenada por um laço do worker (Tarefa 8). Uma saída por (run, nó): é a
--     mesma garantia de não duplicar que o índice único de (run, nó) dá
--     ao e-mail da jornada.
CREATE TABLE IF NOT EXISTS public.journey_saidas (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    journey_id      uuid,
    journey_run_id  uuid NOT NULL,
    journey_node_id text NOT NULL,
    lead_id         uuid,
    tipo            text NOT NULL CHECK (tipo IN ('aviso_email', 'webhook')),
    destino         text NOT NULL,
    payload         jsonb NOT NULL,
    status          text NOT NULL DEFAULT 'pendente'
                    CHECK (status IN ('pendente', 'enviado', 'falhou')),
    tentativas      integer NOT NULL DEFAULT 0,
    visivel_em      timestamptz NOT NULL DEFAULT now(),
    erro            text,
    resend_email_id text,
    enviado_em      timestamptz,
    criado_em       timestamptz NOT NULL DEFAULT now(),
    atualizado_em   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uniq_journey_saidas_run_node UNIQUE (journey_run_id, journey_node_id)
);
CREATE INDEX IF NOT EXISTS idx_journey_saidas_a_enviar
    ON public.journey_saidas (visivel_em) WHERE status = 'pendente';

-- 2e. O receptor de teste do contrato do GrowthHS (`POST /integration/cards`):
--     guarda o pedido para conferência. Um por `external_id`; repetição conta.
CREATE TABLE IF NOT EXISTS public.growthhs_receptor_pedidos (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    external_id   text NOT NULL UNIQUE,
    corpo         jsonb NOT NULL,
    vezes         integer NOT NULL DEFAULT 1,
    recebido_em   timestamptz NOT NULL DEFAULT now(),
    atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- 2f. RLS ANTES do GRANT (molde da 022): o GRANT sozinho daria a qualquer
--     `authenticated` (inclusive não-admin) a tabela inteira. A rota autoriza
--     sozinha (`admin_atual`); isto é a segunda linha.
--     `growthhs_receptor_pedidos` não tem política: só o service_role (BYPASSRLS).
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can manage sites" ON public.sites;
CREATE POLICY "Admins can manage sites" ON public.sites
    FOR ALL TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

ALTER TABLE public.lead_consents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can view lead consents" ON public.lead_consents;
CREATE POLICY "Admins can view lead consents" ON public.lead_consents
    FOR SELECT TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role));

ALTER TABLE public.visitas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can view visitas" ON public.visitas;
CREATE POLICY "Admins can view visitas" ON public.visitas
    FOR SELECT TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role));

ALTER TABLE public.journey_saidas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can view journey saidas" ON public.journey_saidas;
CREATE POLICY "Admins can view journey saidas" ON public.journey_saidas
    FOR SELECT TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role));

ALTER TABLE public.growthhs_receptor_pedidos ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sites, public.lead_consents,
    public.visitas, public.journey_saidas, public.growthhs_receptor_pedidos
    TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.visitas_id_seq, public.journey_saidas_id_seq,
    public.growthhs_receptor_pedidos_id_seq TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sites TO authenticated;
GRANT SELECT ON public.lead_consents, public.visitas TO authenticated;


-- 3a. -------------------------------------------------------------------------
-- `build_segment_condition`: cópia FIEL da 001 (não foi redefinida depois). A
-- única mudança é o `WHEN 'campo_extra'`. Ela é a mesma função para segmento e
-- para o ramo `branch_attribute` da jornada — vale nos dois.
--
--   {"field": "campo_extra", "key": "ja_faz_testagem", "operator": "is", "value": "sim"}
--
-- - Chave fora de `^[a-z][a-z0-9_]{0,39}$` (ou ausente) vira 'FALSE' — inclusive
--   em `is_not`, que de outro jeito pegaria a base inteira. A chave entra pelo
--   `quote_literal` de qualquer forma; o padrão é a primeira trava.
-- - Comparação sem caixa. `is_not` e `not_contains` incluem quem não tem a
--   chave (é "não é sim", e quem não respondeu não é).
-- - Valor ausente vale como texto vazio: `quote_literal(NULL)` é NULL, e
--   condição NULL é DESCARTADA pelo `evaluate_rules_for_lead` — a regra
--   sumiria do AND e alargaria o público.
-- - Operador desconhecido vira 'FALSE'.
CREATE OR REPLACE FUNCTION public.build_segment_condition(p_rule jsonb) RETURNS text
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
  v_key      TEXT;  -- 027
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

    -- 027: resposta de campo personalizado (`leads.campos_extras`).
    WHEN 'campo_extra' THEN
      v_key := p_rule->>'key';
      IF v_key IS NULL OR v_key !~ '^[a-z][a-z0-9_]{0,39}$' THEN
        v_cond := 'FALSE';
      ELSE
        v_col := '(campos_extras->>' || quote_literal(v_key) || ')';
        v_val := coalesce(v_val, '');
        CASE v_operator
          WHEN 'is' THEN
            v_cond := 'lower(' || v_col || ') = lower(' || quote_literal(v_val) || ')';
          WHEN 'is_not' THEN
            v_cond := '(' || v_col || ' IS NULL OR lower(' || v_col || ') <> lower('
                      || quote_literal(v_val) || '))';
          WHEN 'contains' THEN
            v_cond := v_col || ' ILIKE ' || quote_literal('%' || v_val || '%');
          WHEN 'not_contains' THEN
            v_cond := '(' || v_col || ' IS NULL OR ' || v_col || ' NOT ILIKE '
                      || quote_literal('%' || v_val || '%') || ')';
          ELSE
            v_cond := 'FALSE';
        END CASE;
      END IF;

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


-- 3b. -------------------------------------------------------------------------
-- `validate_journey_graph`: cópia FIEL da 026. Mudanças: os tipos
-- `notify_email` (exige config.emails, lista não vazia) e `webhook` (exige
-- config.url começando por https:// e com host). Os dois só ENFILEIRAM em
-- `journey_saidas`; quem envia é o worker (Tarefa 8).
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


-- 3c. -------------------------------------------------------------------------
-- `fn_lead_insert_event`: cópia FIEL da 026. Mudança: `form_id` e `site_id` no
-- metadata, marcados pela transação da captura com
-- `set_config('marketinghs.form_id' | 'marketinghs.site_id', ..., true)` —
-- igual à `page_slug` da 026. Quem não marca grava null.
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
      'page_slug', NULLIF(current_setting('marketinghs.page_slug', true), ''),
      -- 027: o formulário e o site de fora, marcados do mesmo jeito.
      'form_id', NULLIF(current_setting('marketinghs.form_id', true), ''),
      'site_id', NULLIF(current_setting('marketinghs.site_id', true), '')
    )
  );
  RETURN NEW;
END;
$$;


-- 3d. -------------------------------------------------------------------------
-- `journey_enroll_event(uuid, text, jsonb)`: cópia FIEL da 026. Mudanças:
--   - o filtro do CTE `j` passa a ser "sem `page_slug` e sem `form_ids` =
--     qualquer origem; senão casa se a página bate OU se o `form_id` do evento
--     está em `entry_config.form_ids`";
--   - a reconversão só entra em fluxo filtrado (por um OU por outro);
--   - `form_id` no contexto do run.
-- `form_ids` lista vazia = sem filtro de formulário. `form_ids` que NÃO é lista
-- (texto, objeto) conta como filtro que não casa com nada — o lado seguro: um
-- erro de forma não pode virar "qualquer origem".
-- A de 2 argumentos (026) não muda: continua atalho com metadata vazio.
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
      ((NOT f_pagina AND NOT f_form)
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


-- 3e. -------------------------------------------------------------------------
-- `validate_contact_event_source_app`: cópia FIEL da 006. Mudança: aceita
-- 'growthhs' — a volta do CRM ("reunião agendada", "venda fechada") chega pela
-- rota de evento com essa origem (Tarefa 6).
CREATE OR REPLACE FUNCTION public.validate_contact_event_source_app()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.source_app NOT IN ('marketinghs','dnmarketing','nexus','mentoria','website','growthhs') THEN
    RAISE EXCEPTION 'Invalid source_app value: %', NEW.source_app;
  END IF;
  RETURN NEW;
END;
$$;
