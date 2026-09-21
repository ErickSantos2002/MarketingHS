-- 019 — O avaliador de regras de automação volta como gatilho no banco.
--
-- Decisão 1 do 8D: `evaluate_automation_on_etiqueta` volta quase literal —
-- porte extraído do dump da origem (docs/63cb903c-ece5-4157-8f7f-e7dc4686df2d_260831.backup,
-- `pg_restore -f - <backup> | awk '/CREATE FUNCTION public.evaluate_automation_on_etiqueta/,/^\$\$;/'`)
-- —, trocando o `net.http_post` por um `INSERT` na fila `crm_handoffs`
-- (migration 018). Assim o gatilho pega todo caminho de escrita do lead
-- (admin, API do 8B, captura, pontuação) sem que cada rota lembre de chamar.
--
-- Seis mudanças em relação à origem, e só estas:
--
--   1. Assinatura igual à origem: RETURNS trigger LANGUAGE plpgsql
--      SECURITY DEFINER SET search_path TO 'public' (o `search_path` ganhou
--      `'pg_temp'` depois, na revisão de código — ver "Endurecimento" no
--      fim deste cabeçalho; não é uma das seis mudanças de porte).
--   2. Saída cedo ampliada (achado 7): a origem só olhava a etiqueta mudar; a
--      tela de automações também oferece condição por status e por pontuação,
--      e elas nunca disparavam o gatilho. Agora a saída cedo confere as três
--      colunas com IS NOT DISTINCT FROM — e só se aplica a UPDATE: todo
--      INSERT em `leads` continua avaliando as regras, igual à origem.
--   3. Achado 8: regra mal preenchida (um cast que estoura, ex.: valor não
--      numérico numa condição de score) não pode derrubar o INSERT/UPDATE do
--      lead. Cada iteração do laço vira um bloco BEGIN...EXCEPTION WHEN
--      others, que loga um WARNING e segue para a próxima regra —
--      `v_final_matched` é zerado no início de cada iteração para a regra
--      quebrada não "herdar" o resultado da anterior.
--   4. `v_url`, `v_anon_key`, o `current_setting('app.settings.supabase_url')`,
--      o JWT anônimo cravado e o `PERFORM net.http_post(...)` saem inteiros —
--      não existe mais Supabase Edge Function para chamar.
--   5. No lugar deles: quando a regra casa, `block_growthhs` sai na hora
--      (RETURN NEW, igual ao `block_nexus` da origem); as outras duas ações
--      inserem em `crm_handoffs` (acao 'mover' para `move_stage_growthhs`,
--      'criar' para `create_in_growthhs`), com `ON CONFLICT ... DO NOTHING`
--      absorvendo pedido pendente repetido.
--   6. Gatilho: `AFTER INSERT OR UPDATE ON public.leads`, SEM lista de
--      colunas — nem a `etiqueta` sozinha da origem, nem `etiqueta, status,
--      lead_score` de uma primeira versão desta migration.
--
-- Defeito herdado, achado ao escrever o teste da mudança 6: `leads` tem
-- `trg_score_lead_on_change` (BEFORE INSERT OR UPDATE OF cargo, faturamento,
-- funcionarios, desafios, whatsapp, utm_source, source — de um lote
-- anterior, fora deste), que recalcula `etiqueta` e `lead_score` como efeito
-- colateral de mudar QUALQUER uma dessas colunas. Um `UPDATE OF etiqueta,
-- status, lead_score` no gatilho de automação (como a origem tinha só para
-- `etiqueta`) só dispara quando essas colunas aparecem na lista SET do
-- UPDATE que o CHAMADOR fez — o Postgres não sabe, e não pode saber antes de
-- rodar o BEFORE trigger, que uma trigger anterior vai tocar `etiqueta` de
-- lambuja. Resultado: um `UPDATE leads SET cargo = 'CEO'` que faz o score
-- virar 'hotlead' NUNCA disparava a regra de automação — o pedido de handoff
-- NUNCA ERA CRIADO (não é "ficava pendente": nem chega a existir uma linha
-- em `crm_handoffs`), sem erro nenhum — o modo de falhar que este lote existe
-- para evitar. A saída cedo da função (mudança 2) já compara OLD/NEW de
-- etiqueta, status e lead_score por conta própria; tirar a lista de colunas
-- do gatilho não perde precisão nenhuma — só perde a falha silenciosa.
--
-- ⚠️ Efeito colateral do conserto (fix round 1, revisão de código): sem lista
-- de colunas, o gatilho reavalia em TODO UPDATE de `leads` — inclusive
-- atualizações em massa que nunca tiveram etiqueta/status/score como alvo.
-- `POST /contatos/recalcular-scores` (`app/routers/contatos.py`) faz
-- `UPDATE leads SET cargo = cargo` para acordar `trg_score_lead_on_change`
-- na base inteira, e a sincronização do DataCore
-- (`app/dominio/sincronizacao_datacore.py`) faz `UPDATE ... SET source =
-- 'datacore'` em lote — `source` também é vigiada pelo scoring. Se uma regra
-- de automação ATIVA casar com o resultado, um recálculo ou uma sincronização
-- pode enfileirar MUITOS leads para o GrowthHS de uma vez só. Não é bug desta
-- migration — é a consequência direta de fechar o defeito acima — mas é
-- comportamento novo que não existia com a lista de colunas. Decisão de
-- produto em aberto com o Erick; nada foi mudado para evitar isso.
--
-- Continua valendo, sem mudança: primeira regra que casa, por prioridade
-- (DESC NULLS LAST), decide — como na origem. Regras depois dela nem são
-- avaliadas.
--
-- Reaplicável: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS antes do
-- CREATE TRIGGER. Rode duas vezes para provar.
--
-- Endurecimento (fix round 1, revisão de código — não é uma das seis
-- mudanças de porte acima, é reforço adicional pedido na revisão):
-- `SET search_path TO 'public', 'pg_temp'` (com `pg_temp` por ÚLTIMO — é a
-- prática recomendada para funções SECURITY DEFINER: impede que uma tabela
-- temporária de mesmo nome numa sessão maliciosa se disfarce de tabela real
-- antes de `public` ser consultado) e `public.automation_rules`
-- schema-qualificado no FROM do laço de regras, pela mesma razão.

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

      INSERT INTO public.crm_handoffs (lead_id, acao, origem, rule_id)
      VALUES (NEW.id,
              CASE WHEN v_rule.action_type = 'move_stage_growthhs' THEN 'mover' ELSE 'criar' END,
              'regra', v_rule.id)
      ON CONFLICT (lead_id, acao) WHERE status = 'pendente' DO NOTHING;

      RETURN NEW;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- Mudança 6: sem lista de colunas no UPDATE — ver o comentário acima sobre
-- `trg_score_lead_on_change` e o efeito colateral em etiqueta/lead_score.
DROP TRIGGER IF EXISTS trg_automation_on_etiqueta_change ON public.leads;
CREATE TRIGGER trg_automation_on_etiqueta_change
    AFTER INSERT OR UPDATE ON public.leads
    FOR EACH ROW EXECUTE FUNCTION public.evaluate_automation_on_etiqueta();
