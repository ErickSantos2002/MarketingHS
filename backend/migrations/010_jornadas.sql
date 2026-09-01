-- 010: a fila de eventos de jornada e o enfileirador de e-mail do fluxo.
--
-- ⚠️ Diferente do e-mail, a jornada NÃO tem fila para os runs:
-- journey_claim_due_runs já reivindica direto de journey_runs, com lock_token e
-- locked_until. Esta fila é só para os EVENTOS — o trigger roda dentro da
-- transação de quem grava o contact_event, e fazer o trabalho de acordar fluxos
-- ali seguraria a transação de quem só quis registrar uma abertura de e-mail.

CREATE TABLE IF NOT EXISTS public.journey_events (
    id          bigserial PRIMARY KEY,
    lead_id     uuid NOT NULL,
    event_type  text NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
    visivel_em  timestamptz NOT NULL DEFAULT now(),
    tentativas  integer NOT NULL DEFAULT 0,
    criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_journey_events_pronta
    ON public.journey_events (visivel_em, id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.journey_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.journey_events_id_seq TO service_role;

-- ⚠️ O trigger roda com o papel de quem gravou o evento — inclusive `anon`, no
-- caminho público de captura. Sem este GRANT a inserção do evento falharia com
-- permissão negada, derrubando a captura de lead inteira.
GRANT INSERT ON public.journey_events TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.journey_events_id_seq TO anon, authenticated;

-- E-mail de fluxo não tem campanha. O `campaign_id` nulo já significa "não é de
-- campanha"; uma coluna de origem separada seria maior e não compraria nada.
ALTER TABLE public.email_send_queue ALTER COLUMN campaign_id DROP NOT NULL;

-- Substitui fn_contact_event_to_journey_queue, que fazia pgmq.send().
-- ⚠️ Só INSERT, e nada mais: o que roda aqui roda DENTRO da transação de quem
-- gravou o evento. Chamar journey_wake_on_event daqui seguraria a transação de
-- quem só quis registrar uma abertura de e-mail.
CREATE OR REPLACE FUNCTION public.fn_contact_event_to_journey_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    INSERT INTO public.journey_events (lead_id, event_type, occurred_at, metadata)
    VALUES (NEW.lead_id, NEW.event_type,
            COALESCE(NEW.occurred_at, now()), COALESCE(NEW.metadata, '{}'::jsonb));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_contact_event_journey ON public.contact_events;
CREATE TRIGGER trg_contact_event_journey
  AFTER INSERT ON public.contact_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_contact_event_to_journey_queue();

-- Cria a linha de campaign_sends do nó e a põe na fila de e-mail do lote 3B.
--
-- ⚠️ O índice uniq_campaign_sends_journey_node é o que torna a reexecução
-- inofensiva: um lease expirado faz o nó rodar de novo, e o segundo INSERT bate
-- no índice. Devolve 'duplicate' em vez de criar um segundo e-mail — a mesma
-- garantia que o lote 3B usa para as campanhas.
CREATE OR REPLACE FUNCTION public.journey_enqueue_email(
    p_run_id uuid, p_node_id text, p_journey_id uuid, p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_send_id uuid;
BEGIN
  INSERT INTO public.campaign_sends
      (lead_id, channel, status, journey_run_id, journey_node_id)
  VALUES (p_lead_id, 'email', 'pending', p_run_id, p_node_id)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_send_id;

  IF v_send_id IS NULL THEN
    RETURN jsonb_build_object('status', 'duplicate');
  END IF;

  INSERT INTO public.email_send_queue (send_id, campaign_id, lead_id)
  VALUES (v_send_id, NULL, p_lead_id)
  ON CONFLICT (send_id) DO NOTHING;

  RETURN jsonb_build_object('status', 'enqueued', 'send_id', v_send_id);
END $$;

GRANT EXECUTE ON FUNCTION
  public.journey_enqueue_email(uuid, text, uuid, uuid) TO service_role;
