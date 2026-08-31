-- Duas incoerências herdadas, resolvidas juntas porque as duas são "a régua
-- mora em dois lugares e eles discordam".

-- ============================================================
-- 1) O funil: uma fonte de verdade, e ela vira dado
-- ============================================================
--
-- `leads.status` tinha um CHECK com sete valores cravados, e existe a tabela
-- `lead_statuses` — que a function contact-status-update alimentava livremente.
-- Ou seja: a origem CRIAVA status que o CHECK impedia de atribuir. A função é
-- quebrada para qualquer valor fora da lista, e isso nunca apareceu porque os
-- chamadores só mandavam os sete.
--
-- Aqui a tabela passa a mandar. Trocar o funil da HS deixa de ser uma migration
-- e vira um INSERT — que é o que a pergunta aberta do lote 1A precisa.

INSERT INTO public.lead_statuses (name, color, sort_order, is_system) VALUES
  ('Lead',                    '#94a3b8', 1, true),
  ('Iniciado',                '#a78bfa', 2, true),
  ('Lead Qualificado',        '#38bdf8', 3, true),
  ('MQL - Reunião agendada',  '#22c55e', 4, true),
  ('SQL - Em negociação',     '#eab308', 5, true),
  ('Em contrato',             '#f97316', 6, true),
  ('Venda realizada',         '#10b981', 7, true)
ON CONFLICT (lower(name)) DO NOTHING;

-- FK exige unicidade na COLUNA. O índice que existe é sobre lower(name), uma
-- expressão, e expressão não sustenta chave estrangeira.
ALTER TABLE public.lead_statuses ADD CONSTRAINT lead_statuses_name_key UNIQUE (name);

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE public.leads
  ADD CONSTRAINT leads_status_fkey FOREIGN KEY (status)
  REFERENCES public.lead_statuses (name) ON UPDATE CASCADE;

-- ON UPDATE CASCADE: renomear um status na tabela renomeia em todo contato.
-- Sem isso, corrigir um nome exigiria mexer nas duas pontas na mão.

-- ============================================================
-- 2) A origem do evento: o sistema tem nome próprio
-- ============================================================
--
-- `validate_contact_event_source_app` só aceitava 'dnmarketing', 'nexus' e
-- 'mentoria'. O primeiro é o nome do produto da dn.ia, cravado dentro dos
-- nossos dados. Renomear agora custa uma migration com três contatos na base;
-- daqui a um ano custa muito mais.

CREATE OR REPLACE FUNCTION public.validate_contact_event_source_app()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- 'dnmarketing' continua aceito por causa das linhas antigas e de qualquer
  -- integração externa que ainda o mande. O nosso é 'marketinghs'.
  IF NEW.source_app NOT IN ('marketinghs','dnmarketing','nexus','mentoria') THEN
    RAISE EXCEPTION 'Invalid source_app value: %', NEW.source_app;
  END IF;
  RETURN NEW;
END;
$$;

-- O trigger que cria o evento de cadastro escrevia 'dnmarketing' na mão.
--
-- ⚠️ Cópia FIEL do original, com uma única palavra trocada. A primeira versão
-- desta migration reescreveu a função de memória e teria perdido coisa: os
-- cinco UTMs e a etiqueta que vão no metadata, e o texto padrão 'formulário',
-- que eu havia trocado por 'site' sem perceber. Ao mexer em função herdada,
-- copie do banco e altere o mínimo.
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
      'etiqueta', NEW.etiqueta
    )
  );
  RETURN NEW;
END;
$$;

UPDATE public.contact_events SET source_app = 'marketinghs' WHERE source_app = 'dnmarketing';
UPDATE public.ecosystem_identities SET first_touch_app = 'marketinghs' WHERE first_touch_app = 'dndash';
