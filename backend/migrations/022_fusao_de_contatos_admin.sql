-- 022 — a fusão de contatos sob `authenticated` (decisão 23+24 do Erick, 01/10/2026)
--
-- O ERICK RODA (não se aplica sozinha; ver CLAUDE.md, "Migration nova se aplica
-- sozinha"). Reaplicável: DROP POLICY IF EXISTS antes de cada CREATE; ENABLE RLS
-- e GRANT não falham na segunda vez. Rode duas vezes para provar.
--
-- Por quê: `POST /contatos/fundir` (`app/routers/escrita_contatos.py`) reatribui
-- TODO o histórico do contato descartado ao mantido e depois apaga o
-- descartado. Hoje ela roda como `service_role` (BYPASSRLS) — é a única do
-- router que não foi para `authenticated`, porque lá a reatribuição falharia:
--
--   * calada (0 linhas, sem erro) onde a tabela tem RLS e nenhuma política de
--     UPDATE: `lead_conversions`, `journey_runs`, `journey_step_log`,
--     `email_events` — e o DELETE do descartado levaria pelo CASCADE (ou
--     deixaria com `lead_id` NULL) o que não foi movido;
--   * com "permission denied" onde não há GRANT nenhum a `authenticated`
--     (tabelas de máquina, só `service_role`): `crm_handoffs`,
--     `email_send_queue`, `email_send_dead`.
--
-- As outras tabelas que a fusão toca já servem: `leads` (021), `lead_tags`,
-- `segment_contacts`, `campaign_sends`, `lead_notes`, `contact_events`,
-- `ab_events`, `ab_identities` (política admin ALL) e `email_suppressions`
-- (admin ALL).
--
-- Só ACRESCENTA permissão ao admin. `service_role` (BYPASSRLS) e o usuário
-- `leitura` (BYPASSRLS) não mudam. Os gatilhos que escrevem nas tabelas de
-- máquina são SECURITY DEFINER de dono superusuário — o RLS ligado abaixo não
-- os alcança.

-- 1. Tabelas com RLS e sem política de UPDATE: a política que falta.
DROP POLICY IF EXISTS "Admins can update lead conversions" ON public.lead_conversions;
CREATE POLICY "Admins can update lead conversions" ON public.lead_conversions
    FOR UPDATE TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can update journey runs" ON public.journey_runs;
CREATE POLICY "Admins can update journey runs" ON public.journey_runs
    FOR UPDATE TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can update journey step log" ON public.journey_step_log;
CREATE POLICY "Admins can update journey step log" ON public.journey_step_log
    FOR UPDATE TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can update email events" ON public.email_events;
CREATE POLICY "Admins can update email events" ON public.email_events
    FOR UPDATE TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- 2. Tabelas de máquina, hoje só de `service_role`. RLS ligado ANTES do GRANT:
--    o GRANT sozinho daria a qualquer `authenticated` (inclusive não-admin) a
--    tabela inteira. Com o RLS, só o admin passa — e é a segunda linha: a rota
--    já autoriza sozinha (`admin_atual`).
--    `crm_handoffs` precisa de DELETE: o pedido PENDENTE repetido do descartado
--    sai quando o mantido já tem um da mesma ação (`uniq_crm_handoffs_pendente`).
ALTER TABLE public.crm_handoffs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can manage crm handoffs" ON public.crm_handoffs;
CREATE POLICY "Admins can manage crm handoffs" ON public.crm_handoffs
    FOR ALL TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
GRANT SELECT, UPDATE, DELETE ON public.crm_handoffs TO authenticated;

ALTER TABLE public.email_send_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can manage email send queue" ON public.email_send_queue;
CREATE POLICY "Admins can manage email send queue" ON public.email_send_queue
    FOR ALL TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
GRANT SELECT, UPDATE ON public.email_send_queue TO authenticated;

ALTER TABLE public.email_send_dead ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can manage email send dead" ON public.email_send_dead;
CREATE POLICY "Admins can manage email send dead" ON public.email_send_dead
    FOR ALL TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
GRANT SELECT, UPDATE ON public.email_send_dead TO authenticated;
