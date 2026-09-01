-- 009: conserta promote_scheduled_campaigns.
--
-- ⚠️ A versão herdada chama public.invoke_edge_function, que o lote 0 apagou de
-- propósito: era o banco chamando a aplicação por HTTP, indireção que só
-- existia porque o Supabase separa os dois. Nós não separamos.
--
-- O defeito é LATENTE. A função devolve 0 sem erro enquanto não há campanha
-- agendada — o laço não roda — e estoura com UndefinedFunctionError no instante
-- em que uma vence. Ou seja: só quebra em produção, no pior momento.
--
-- A função passa a SÓ SELECIONAR. Quem dispara é o agendador Python, que chama
-- o enfileirador direto. É a decisão nº 4 da spec: apagar a indireção em vez de
-- portá-la.
--
-- ⚠️ DROP antes do CREATE: o tipo de retorno muda de `integer` para
-- `TABLE(uuid)`, e CREATE OR REPLACE não aceita trocar tipo de retorno.
DROP FUNCTION IF EXISTS public.promote_scheduled_campaigns();

CREATE FUNCTION public.promote_scheduled_campaigns()
RETURNS TABLE(id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT c.id FROM public.campaigns c
   WHERE c.status = 'scheduled'
     AND c.scheduled_at IS NOT NULL
     AND c.scheduled_at <= now()
   ORDER BY c.scheduled_at
   LIMIT 20
$$;

GRANT EXECUTE ON FUNCTION public.promote_scheduled_campaigns()
  TO anon, authenticated, service_role;
