-- 025 — SELECT na coluna `lead_id` de `journey_events` para `authenticated` (02/10/2026)
--
-- Por quê: a 024 deu DELETE, mas `DELETE ... WHERE lead_id = $1` também LÊ a
-- coluna do filtro, e o Postgres exige SELECT nela. Sem isto a fusão de
-- contatos sob `authenticated` continuava com "permission denied for table
-- journey_events" (medido em produção logo depois da 024).
--
-- Só a coluna `lead_id`, não a tabela: o `authenticated` não precisa ler o
-- payload dos eventos para nada. Tabela sem RLS; quem autoriza é a rota
-- (`admin_atual`). GRANT é idempotente — tolera reaplicação.

GRANT SELECT (lead_id) ON public.journey_events TO authenticated;
