-- 011: o guard de ativação passa a aceitar entrada por VÁRIOS segmentos.
--
-- ⚠️ Defeito herdado, achado ao abrir a tela: duas funções do banco discordavam
-- entre si desde a origem.
--
--   journey_enroll_segment  (quem INSCREVE)  já lê `entry_config.segment_ids`
--                                            e cai para `segment_id` no legado
--   fn_journeys_validate    (quem LIBERA)    exigia `segment_id` e só ele
--
-- O construtor grava `segment_ids` desde que a entrada passou a aceitar N
-- inclusões e N exclusões (ver readEntrySegments em frontend/src/lib/journeys.ts).
-- Resultado: TODO fluxo com entrada por segmento criado pela tela era recusado
-- na ativação com 'entrada por segmento exige entry_config.segment_id' — o
-- inscritor sabia executar um fluxo que o guard nunca deixava começar.
--
-- O corpo abaixo é o que está no banco hoje, COPIADO, com uma única mudança: a
-- checagem de segmento. Nada mais foi reescrito — as outras três guardas
-- (fluxo sem nós, entrada por evento sem event_type, e o auto-disparo de
-- e-mail com reentrada permitida) continuam palavra por palavra as mesmas.

CREATE OR REPLACE FUNCTION public.fn_journeys_validate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.validate_journey_graph(NEW.nodes, NEW.entry_node_id);

  IF NEW.status = 'active' THEN
    IF jsonb_array_length(coalesce(NEW.nodes, '[]'::jsonb)) = 0 OR NEW.entry_node_id IS NULL THEN
      RAISE EXCEPTION 'fluxo sem nos nao pode ser ativado';
    END IF;

    -- Aceita as duas formas, na MESMA ordem de precedência de
    -- journey_enroll_segment: a lista quando ela existe e não está vazia; o
    -- campo singular como legado. Mudar a ordem aqui faria o guard liberar um
    -- fluxo por um segmento diferente do que o inscritor usaria.
    IF NEW.entry_type = 'segment'
       AND NOT (
         (jsonb_typeof(NEW.entry_config->'segment_ids') = 'array'
          AND jsonb_array_length(NEW.entry_config->'segment_ids') > 0)
         OR coalesce(NEW.entry_config->>'segment_id', '') <> ''
       ) THEN
      RAISE EXCEPTION 'entrada por segmento exige ao menos um segmento em entry_config.segment_ids';
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
