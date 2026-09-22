-- 020 — O gatilho de automação não reenfileira lead já entregue.
--
-- Revisão final do 8D, achado I4: `evaluate_automation_on_etiqueta` (019)
-- reavalia a cada mudança de etiqueta, status ou pontuação — e um lead já
-- entregue ao GrowthHS voltava para a fila a cada mudança. A entrega o
-- absorvia ("já estava no comercial"), mas cada volta era um pedido, uma
-- reivindicação e uma linha na linha do tempo, para sempre.
--
-- A função abaixo é a da 019 INTEIRA, com uma única mudança: antes do INSERT
-- de 'criar', não enfileira se já existe `crm_handoffs` 'criar' 'entregue'
-- para NEW.id. ('mover' fica como estava; a regra de mover passou a ser
-- recusada ao salvar — rotas de automação — e a que existir falha à vista na
-- entrega.) O gatilho `trg_automation_on_etiqueta_change` não muda: ele
-- aponta para a função pelo nome, e o CREATE OR REPLACE basta.
--
-- A guarda aqui é pelo LEAD, como o gatilho só enxerga NEW. A guarda pela
-- PESSOA (outro lead com o mesmo dnia_id, card anotado na identidade) fica na
-- entrega (`app/crm/entrega.py`, I2) — lá o pedido não chama o GrowthHS.
--
-- Reaplicável: só CREATE OR REPLACE FUNCTION. Rode duas vezes para provar.

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
