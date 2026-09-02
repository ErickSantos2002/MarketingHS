-- 012: journey_wake_on_event volta a ser executável.
--
-- ⚠️ Segundo defeito herdado, achado ao rodar o worker com a fila de eventos
-- cheia. A função SOBREVIVEU ao port e estava na lista de "não reimplemente" —
-- mas ela levanta erro em toda chamada que passa do early return:
--
--     invalid reference to FROM-clause entry for table "r"
--
-- O UPDATE tinha um LATERAL no FROM que referenciava `r`, a própria tabela-alvo
-- do UPDATE. O Postgres não permite isso: o alvo não está no escopo do FROM.
-- Não é questão de versão — é inválido em qualquer uma. Ou seja: nenhum passo
-- `wait_for_event` jamais acordou neste banco, e todo evento de jornada morria
-- na primeira chamada.
--
-- O corpo abaixo é o do banco, COPIADO. Muda só COMO o nó atual é resolvido
-- dentro do UPDATE: subconsulta escalar no WHERE (que PODE ver `r`) no lugar do
-- LATERAL. Os predicados são os mesmos, na mesma ordem.
--
-- ⚠️ O EXISTS não é enfeite. O LATERAL era junção interna: run cujo
-- `current_node_id` não achasse nó no grafo era descartado. Uma subconsulta
-- escalar devolveria NULL, e `coalesce(NULL,'') = ''` daria VERDADEIRO — o run
-- órfão passaria a ser acordado, que é o oposto do que a função fazia. O EXISTS
-- reconstrói o descarte.
--
-- A segunda consulta (a contagem de `deferred`) é um SELECT comum e continua
-- palavra por palavra a mesma: LATERAL ali é legal, porque não há alvo de
-- UPDATE no escopo.

CREATE OR REPLACE FUNCTION public.journey_wake_on_event(
  p_lead_id     uuid,
  p_event_type  text,
  p_occurred_at timestamptz,   -- sem DEFAULT: a assinatura é a do banco
  p_metadata    jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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
      FROM public.journeys j
     WHERE j.id = r.journey_id
       AND j.status = 'active'
       AND r.lead_id = p_lead_id
       AND r.state = 'waiting'
       AND r.waiting_event = p_event_type
       AND (r.locked_until IS NULL OR r.locked_until <= now())
       AND COALESCE(p_occurred_at, now()) >=
           COALESCE((r.context->>'waiting_since')::timestamptz, r.entered_at)
       AND EXISTS (
             SELECT 1
               FROM jsonb_array_elements(j.nodes) n
              WHERE n->>'id' = r.current_node_id
           )
       AND (
             coalesce((
               SELECT n#>>'{config,source_node_id}'
                 FROM jsonb_array_elements(j.nodes) n
                WHERE n->>'id' = r.current_node_id
                LIMIT 1
             ), '') = ''
             OR (
                  p_metadata->>'journey_node_id' = (
                    SELECT n#>>'{config,source_node_id}'
                      FROM jsonb_array_elements(j.nodes) n
                     WHERE n->>'id' = r.current_node_id
                     LIMIT 1
                  )
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
