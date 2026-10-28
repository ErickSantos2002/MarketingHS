-- 036 — Agendamento de reunião na landing (frente agendamento, 28/10/2026).
--
-- Spec: docs/superpowers/specs/2026-10-28-agendamento-reuniao-design.md.
-- Plano: docs/superpowers/plans/2026-10-28-agendamento-reuniao.md, Task 1.
--
-- Reaplicável: CREATE TABLE / INDEX IF NOT EXISTS, CREATE OR REPLACE
-- FUNCTION, GRANT. Rode duas vezes para provar. Nenhuma extensão. Rodar com o
-- dono das tabelas. ADITIVA: o código de hoje não lê nada daqui.
--
-- Os três índices únicos que impedem e-mail duplicado (CLAUDE.md, "Banco") NÃO
-- são tocados — nem citados por nome.
--
-- O que faz:
--   1. `reuniao_roleta`: a fila de vendedores da roleta de REUNIÃO, uma por
--      ambiente do GrowthHS (os ids de vendedor de homologação e de produção
--      são outros). Menor `posicao` = a vez. Quem foi pulado por estar
--      ocupado guarda a vez; quem recebe vai para o fim (app/agendamento).
--   2. `reuniao_agendamentos`: do rascunho (etapa 1 do modal) à reunião
--      criada no GrowthHS. A trava de corrida está no BANCO, em dois índices
--      únicos parciais:
--        - `uniq_reuniao_vendedor_inicio`: um vendedor, um horário — dois
--          leads confirmando o mesmo horário ao mesmo tempo nunca caem no
--          mesmo vendedor (no espírito dos três índices de envio);
--        - `uniq_reuniao_email_futura`: uma reserva viva por e-mail e
--          ambiente — clique duplo e duas abas devolvem a mesma reserva.
--      `falhou` continua nos dois: a reserva cuja criação falhou de vez
--      segue bloqueando o vendedor (o lead já leu "confirmado").
--      Reunião que passou sai dos índices porque a varredura do worker a
--      marca `realizada`.
--   3. `fn_lead_insert_event` (cópia FIEL da 027) põe `agendamento` no
--      metadata, marcado pela transação da captura com
--      `set_config('marketinghs.agendamento', 'true', true)`.
--   4. `journey_enroll_event(uuid, text, jsonb)` (cópia FIEL da 028): evento
--      com `agendamento = true` NÃO matricula em jornada que tem nó
--      `handoff_growthhs` — o agendamento já cria o card; a jornada "lead
--      para o comercial" criaria o segundo. As demais jornadas seguem.


-- 1. A roleta de reunião -------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.reuniao_roleta (
    ambiente text   NOT NULL CHECK (ambiente IN ('homologacao', 'producao')),
    user_id  bigint NOT NULL,
    posicao  integer NOT NULL,
    nome     text,
    email    text,
    PRIMARY KEY (ambiente, user_id)
);


-- 2. Os agendamentos -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.reuniao_agendamentos (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token             text NOT NULL UNIQUE,
    ambiente          text NOT NULL,
    page_slug         text NOT NULL,
    email             text NOT NULL,
    dados             jsonb NOT NULL DEFAULT '{}'::jsonb,
    status            text NOT NULL DEFAULT 'rascunho'
                      CHECK (status IN ('rascunho', 'reservada', 'criada', 'falhou',
                                        'realizada', 'abandonada', 'lead_comum')),
    vendedor_id       bigint,
    vendedor_nome     text,
    vendedor_email    text,
    inicio            timestamptz,
    fim               timestamptz,
    card_existente_id bigint,
    lead_id           uuid REFERENCES public.leads(id) ON DELETE SET NULL,
    person_id         bigint,
    card_id           bigint,
    task_id           bigint,
    public_link       text,
    email_vendedor_em timestamptz,
    alerta_em         timestamptz,
    tentativas        integer NOT NULL DEFAULT 0,
    visivel_em        timestamptz NOT NULL DEFAULT now(),
    erro              text,
    criado_em         timestamptz NOT NULL DEFAULT now(),
    atualizado_em     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_reuniao_vendedor_inicio
    ON public.reuniao_agendamentos (ambiente, vendedor_id, inicio)
    WHERE status IN ('reservada', 'criada', 'falhou');

CREATE UNIQUE INDEX IF NOT EXISTS uniq_reuniao_email_futura
    ON public.reuniao_agendamentos (ambiente, email)
    WHERE status IN ('reservada', 'criada', 'falhou');

CREATE INDEX IF NOT EXISTS idx_reuniao_a_executar
    ON public.reuniao_agendamentos (visivel_em)
    WHERE status = 'reservada';

CREATE INDEX IF NOT EXISTS idx_reuniao_rascunho
    ON public.reuniao_agendamentos (criado_em)
    WHERE status = 'rascunho';

-- Tabelas só de máquina (molde `growthhs_receptor_pedidos`, 027): RLS ligado,
-- nenhuma política, GRANT só ao `service_role` (que tem BYPASSRLS). A rota de
-- admin da roleta grava como `service_role` atrás de `admin_atual`, como
-- `configuracao.py` faz com `growthhs_config`.
ALTER TABLE public.reuniao_roleta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reuniao_agendamentos ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reuniao_roleta,
    public.reuniao_agendamentos TO service_role;


-- 3. -------------------------------------------------------------------------
-- `fn_lead_insert_event`: cópia FIEL da 027. Mudança: `agendamento` no
-- metadata, marcado pela transação da captura (`registrar_captura(...,
-- agendamento=True)`). Quem não marca grava null.
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
      'site_id', NULLIF(current_setting('marketinghs.site_id', true), ''),
      -- 036: a conversão veio de um agendamento confirmado.
      'agendamento', NULLIF(current_setting('marketinghs.agendamento', true), '')
    )
  );
  RETURN NEW;
END;
$$;


-- 4. -------------------------------------------------------------------------
-- `journey_enroll_event(uuid, text, jsonb)`: cópia FIEL da 028. Mudanças:
-- `v_agendamento` e `tem_handoff` (o fluxo tem nó `handoff_growthhs`), e o
-- `AND NOT (v_agendamento AND tem_handoff)` no filtro. O resto não muda.
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
