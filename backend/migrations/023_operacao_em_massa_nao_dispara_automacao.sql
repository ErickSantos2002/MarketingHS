-- 023 — Recálculo de pontuação e sincronização do DataCore NÃO disparam
-- automação (decisão 6 do Erick, 01/10/2026).
--
-- O ERICK RODA (não se aplica sozinha; ver CLAUDE.md, "Migration nova se aplica
-- sozinha"). Reaplicável: só CREATE OR REPLACE FUNCTION. Rode duas vezes.
--
-- Por quê: desde a 019 o gatilho de automação reavalia em TODO UPDATE de
-- `leads`. `POST /contatos/recalcular-scores` (`UPDATE leads SET cargo = cargo`
-- na base inteira) e `POST /datacore/sincronizar` (INSERT e UPDATE em lote)
-- mudam etiqueta e pontuação de muitos leads de uma vez: com uma regra ativa
-- casando, um recálculo virava um envio em massa ao GrowthHS. E a carga do
-- DataCore cria leads, o que grava `form_submitted` em `contact_events`
-- (`fn_lead_insert_event`), copiado para `journey_events` — matriculando
-- clientes do ERP em fluxo que entra por evento, inclusive com nó de entrega
-- ao comercial. A decisão: essas operações só ATUALIZAM DADO; quem dispara é
-- evento individual (captura, mudança manual de status, edição do contato).
--
-- Como: a transação que faz a operação em massa marca a si mesma com
-- `SET LOCAL marketinghs.sem_automacao = 'on'` (`app/dominio/automacao.py`).
-- `SET LOCAL` morre no fim da transação — conexão devolvida ao pool não leva a
-- marca para o próximo pedido. Nenhum papel precisa de privilégio novo:
-- parâmetro com ponto no nome é livre para qualquer sessão.
--
-- As duas funções abaixo são as do BANCO (020 e 010), copiadas, cada uma com
-- uma única mudança — a guarda logo depois do BEGIN:
--
--   1. `evaluate_automation_on_etiqueta` (regra de automação → `crm_handoffs`)
--   2. `fn_contact_event_to_journey_queue` (evento → fila de jornada). O
--      `contact_events` continua sendo gravado — a linha do tempo não perde
--      nada; só a cópia para a fila de jornada não é feita.
--
-- O que NÃO muda: a matrícula por SEGMENTO (`journey_enroll_segment`, bloco A
-- do worker) olha o estado do contato, não o evento. Contato que o recálculo
-- põe dentro de um segmento entra no fluxo daquele segmento no próximo tick,
-- como entraria se tivesse sido editado à mão — ver docs/frentes/backend.md.
--
-- ⚠️ Enquanto esta migration não for aplicada, a marca é inofensiva: nenhuma
-- função a lê, e o comportamento é o de antes (o teste do lado "em massa" é
-- pulado com o motivo).

CREATE OR REPLACE FUNCTION public.evaluate_automation_on_etiqueta() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_rule RECORD;
  v_cond JSONB;
  v_cond_matched BOOLEAN;
  v_all_matched BOOLEAN;
  v_any_matched BOOLEAN;
  v_final_matched BOOLEAN;
  v_parts TEXT[];
  v_has_conditions BOOLEAN;
BEGIN
  -- 023 (decisão 6 do Erick, 01/10/2026): operação EM MASSA não dispara
  -- automação. Quem marca é a própria transação, com
  -- `SET LOCAL marketinghs.sem_automacao = 'on'` (recálculo de pontuação e
  -- sincronização do DataCore). É a ÚNICA mudança em relação à 020.
  IF current_setting('marketinghs.sem_automacao', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- Mudança 2 (achado 7): a origem só via a etiqueta mudar.
  IF TG_OP = 'UPDATE' AND OLD.etiqueta IS NOT DISTINCT FROM NEW.etiqueta
     AND OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.lead_score IS NOT DISTINCT FROM NEW.lead_score THEN
    RETURN NEW;
  END IF;

  FOR v_rule IN
    SELECT id, action_type, condition_type, condition_operator, condition_value,
           conditions, COALESCE(condition_logic, 'and') AS condition_logic
    FROM public.automation_rules
    WHERE is_active = true
    ORDER BY priority DESC NULLS LAST
  LOOP
    v_final_matched := FALSE;

    -- Mudança 3 (achado 8): uma regra quebrada é ignorada, não derruba a
    -- gravação do lead.
    BEGIN
      v_has_conditions := v_rule.conditions IS NOT NULL AND jsonb_array_length(v_rule.conditions) > 0;

      IF v_has_conditions THEN
        -- Evaluate multiple conditions
        v_all_matched := TRUE;
        v_any_matched := FALSE;

        FOR v_cond IN SELECT jsonb_array_elements(v_rule.conditions) LOOP
          v_cond_matched := FALSE;

          CASE v_cond->>'type'
            WHEN 'etiqueta' THEN
              IF NEW.etiqueta IS NOT NULL THEN
                IF (v_cond->>'operator') = 'is' AND NEW.etiqueta = (v_cond->>'value') THEN v_cond_matched := TRUE;
                ELSIF (v_cond->>'operator') = 'is_not' AND NEW.etiqueta != (v_cond->>'value') THEN v_cond_matched := TRUE;
                END IF;
              END IF;
            WHEN 'status' THEN
              IF (v_cond->>'operator') = 'is' AND NEW.status = (v_cond->>'value') THEN v_cond_matched := TRUE;
              ELSIF (v_cond->>'operator') = 'is_not' AND NEW.status != (v_cond->>'value') THEN v_cond_matched := TRUE;
              END IF;
            WHEN 'score' THEN
              IF (v_cond->>'operator') = 'greater_than' AND COALESCE(NEW.lead_score, 0) > (v_cond->>'value')::int THEN v_cond_matched := TRUE;
              ELSIF (v_cond->>'operator') = 'less_than' AND COALESCE(NEW.lead_score, 0) < (v_cond->>'value')::int THEN v_cond_matched := TRUE;
              END IF;
            WHEN 'created_at' THEN
              IF (v_cond->>'operator') = 'between' THEN
                v_parts := string_to_array(v_cond->>'value', '|');
                IF array_length(v_parts, 1) = 2 THEN
                  IF NEW.created_at >= v_parts[1]::timestamptz AND NEW.created_at <= (v_parts[2]::date + interval '1 day' - interval '1 second')::timestamptz THEN
                    v_cond_matched := TRUE;
                  END IF;
                END IF;
              ELSIF (v_cond->>'operator') = 'after' THEN
                IF NEW.created_at >= (v_cond->>'value')::timestamptz THEN v_cond_matched := TRUE; END IF;
              ELSIF (v_cond->>'operator') = 'before' THEN
                IF NEW.created_at <= ((v_cond->>'value')::date + interval '1 day' - interval '1 second')::timestamptz THEN v_cond_matched := TRUE; END IF;
              ELSIF (v_cond->>'operator') = 'last_n_days' THEN
                IF NEW.created_at >= (now() - ((v_cond->>'value') || ' days')::interval) THEN v_cond_matched := TRUE; END IF;
              END IF;
            ELSE
              NULL;
          END CASE;

          IF v_cond_matched THEN v_any_matched := TRUE; END IF;
          IF NOT v_cond_matched THEN v_all_matched := FALSE; END IF;
        END LOOP;

        IF v_rule.condition_logic = 'and' THEN
          v_final_matched := v_all_matched;
        ELSE
          v_final_matched := v_any_matched;
        END IF;
      ELSE
        -- Fallback: legacy single condition
        v_final_matched := FALSE;
        CASE v_rule.condition_type
          WHEN 'etiqueta' THEN
            IF NEW.etiqueta IS NOT NULL THEN
              IF v_rule.condition_operator = 'is' AND NEW.etiqueta = v_rule.condition_value THEN v_final_matched := TRUE;
              ELSIF v_rule.condition_operator = 'is_not' AND NEW.etiqueta != v_rule.condition_value THEN v_final_matched := TRUE;
              END IF;
            END IF;
          WHEN 'status' THEN
            IF v_rule.condition_operator = 'is' AND NEW.status = v_rule.condition_value THEN v_final_matched := TRUE;
            ELSIF v_rule.condition_operator = 'is_not' AND NEW.status != v_rule.condition_value THEN v_final_matched := TRUE;
            END IF;
          WHEN 'score' THEN
            IF v_rule.condition_operator = 'greater_than' AND COALESCE(NEW.lead_score, 0) > v_rule.condition_value::int THEN v_final_matched := TRUE;
            ELSIF v_rule.condition_operator = 'less_than' AND COALESCE(NEW.lead_score, 0) < v_rule.condition_value::int THEN v_final_matched := TRUE;
            END IF;
          WHEN 'created_at' THEN
            IF v_rule.condition_operator = 'between' THEN
              v_parts := string_to_array(v_rule.condition_value, '|');
              IF array_length(v_parts, 1) = 2 THEN
                IF NEW.created_at >= v_parts[1]::timestamptz AND NEW.created_at <= (v_parts[2]::date + interval '1 day' - interval '1 second')::timestamptz THEN
                  v_final_matched := TRUE;
                END IF;
              END IF;
            ELSIF v_rule.condition_operator = 'after' THEN
              IF NEW.created_at >= v_rule.condition_value::timestamptz THEN v_final_matched := TRUE; END IF;
            ELSIF v_rule.condition_operator = 'before' THEN
              IF NEW.created_at <= (v_rule.condition_value::date + interval '1 day' - interval '1 second')::timestamptz THEN v_final_matched := TRUE; END IF;
            ELSIF v_rule.condition_operator = 'last_n_days' THEN
              IF NEW.created_at >= (now() - (v_rule.condition_value || ' days')::interval) THEN v_final_matched := TRUE; END IF;
            END IF;
          ELSE
            NULL;
        END CASE;
      END IF;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'regra de automação % ignorada: %', v_rule.id, SQLERRM;
    END;

    -- Mudanças 4 e 5: sai o net.http_post para a Edge Function do Supabase,
    -- entra o INSERT na fila de entrega. `block_growthhs` sai na hora, como
    -- `block_nexus` fazia.
    IF v_final_matched THEN
      IF v_rule.action_type = 'block_growthhs' THEN
        RETURN NEW;
      END IF;

      -- 020 (revisão final do 8D, I4): lead que já tem entrega `criar`
      -- `entregue` não volta para a fila a cada mudança de etiqueta, status
      -- ou pontuação. É a ÚNICA mudança em relação à 019.
      IF v_rule.action_type = 'move_stage_growthhs'
         OR NOT EXISTS (SELECT 1 FROM public.crm_handoffs
                         WHERE lead_id = NEW.id AND acao = 'criar' AND status = 'entregue') THEN
        INSERT INTO public.crm_handoffs (lead_id, acao, origem, rule_id)
        VALUES (NEW.id,
                CASE WHEN v_rule.action_type = 'move_stage_growthhs' THEN 'mover' ELSE 'criar' END,
                'regra', v_rule.id)
        ON CONFLICT (lead_id, acao) WHERE status = 'pendente' DO NOTHING;
      END IF;

      RETURN NEW;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;


CREATE OR REPLACE FUNCTION public.fn_contact_event_to_journey_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- 023: ver o cabeçalho. É a ÚNICA mudança em relação à 010.
  IF current_setting('marketinghs.sem_automacao', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.lead_id IS NOT NULL THEN
    INSERT INTO public.journey_events (lead_id, event_type, occurred_at, metadata)
    VALUES (NEW.lead_id, NEW.event_type,
            COALESCE(NEW.occurred_at, now()), COALESCE(NEW.metadata, '{}'::jsonb));
  END IF;
  RETURN NEW;
END $$;
