-- 008: a fila de e-mail e os segredos de integração.
--
-- As duas substituem extensões do Supabase que não temos:
--   pgmq            -> email_send_queue, tabela comum + FOR UPDATE SKIP LOCKED
--   supabase_vault  -> integration_secrets, portado do integracoes.py do HS.OS
--
-- ⚠️ A fila de JORNADA (journey_events) NÃO entra aqui. É do lote 4, e criá-la
-- agora deixaria uma tabela sem ninguém escrevendo nem lendo.

CREATE TABLE IF NOT EXISTS public.email_send_queue (
    id           bigserial PRIMARY KEY,
    send_id      uuid NOT NULL,
    campaign_id  uuid NOT NULL,
    lead_id      uuid NOT NULL,
    -- Quantas vezes a mensagem já foi reivindicada. É o que separa "falhou uma
    -- vez" de "falha sempre" — e o que alimenta a fila-morta.
    tentativas   integer NOT NULL DEFAULT 0,
    -- Enquanto `visivel_em` estiver no futuro, a mensagem não é reivindicável.
    -- É o visibility timeout do pgmq, e é o que evita dois workers pegando a
    -- mesma mensagem: quem reivindica empurra este campo para frente na MESMA
    -- instrução do SELECT ... FOR UPDATE SKIP LOCKED.
    visivel_em   timestamptz NOT NULL DEFAULT now(),
    ultimo_erro  text,
    criado_em    timestamptz NOT NULL DEFAULT now()
);

-- O índice que a reivindicação usa. Sem ele, cada tick do worker varre a fila
-- inteira — e uma fila de campanha tem dezenas de milhares de linhas.
CREATE INDEX IF NOT EXISTS idx_email_send_queue_pronta
    ON public.email_send_queue (visivel_em, id);

-- ⚠️ Um send_id só pode estar na fila uma vez. O enfileirador republica órfãos
-- de uma execução que morreu no meio (é o caminho de recuperação), e sem esta
-- restrição a republicação criaria uma segunda mensagem para o mesmo envio.
-- O envio duplicado ainda seria barrado pelo índice único de campaign_sends,
-- mas o worker faria o trabalho duas vezes e o erro ficaria invisível.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_email_send_queue_send
    ON public.email_send_queue (send_id);

-- A fila-morta. Mensagem que estourou o teto de tentativas sai da fila viva e
-- vem para cá — some da fila, mas NÃO some do mundo. Apagar direto esconderia
-- exatamente o caso que precisa ser investigado.
CREATE TABLE IF NOT EXISTS public.email_send_dead (
    id           bigserial PRIMARY KEY,
    send_id      uuid NOT NULL,
    campaign_id  uuid NOT NULL,
    lead_id      uuid NOT NULL,
    tentativas   integer NOT NULL,
    ultimo_erro  text,
    morto_em     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.integration_secrets (
    name       text PRIMARY KEY,
    value      text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ⚠️ Os GRANTs de 002_permissoes.sql usaram ON ALL TABLES, que só alcança as
-- tabelas existentes NAQUELE momento. Tabela nova precisa do grant explícito,
-- ou a query falha com "permission denied" mesmo depois do SET LOCAL ROLE.
--
-- Só `service_role`: a fila e os segredos são operação interna. `anon` e
-- `authenticated` não têm o que fazer aqui, e dar acesso "por simetria" abriria
-- a leitura do RESEND_API_KEY a qualquer sessão autenticada.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_send_queue,
      public.email_send_dead, public.integration_secrets TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.email_send_queue_id_seq,
      public.email_send_dead_id_seq TO service_role;
