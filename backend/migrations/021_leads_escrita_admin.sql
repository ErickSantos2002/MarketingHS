-- 021 — política de ESCRITA em `leads` para o admin (frente backend, 01/10/2026)
--
-- Por quê: `leads` só tem política de SELECT e DELETE para `authenticated`.
-- Sob `sessao(role="authenticated")` um UPDATE de lead afeta ZERO linhas, sem
-- erro, e um INSERT levanta "new row violates row-level security policy". É o
-- que impede converter `escrita_contatos.py` e `contatos.py` (importação) de
-- `service_role` para `authenticated` — ver docs/frentes/backend.md, Perguntas.
--
-- O ERICK RODA (não se aplica sozinha; ver CLAUDE.md, "Migration nova se aplica
-- sozinha"). Tolera reaplicação: DROP ... IF EXISTS antes de cada CREATE.
-- Só ACRESCENTA permissão ao admin; o service_role (BYPASSRLS) não muda.

DROP POLICY IF EXISTS "Admins can insert leads" ON public.leads;
CREATE POLICY "Admins can insert leads" ON public.leads
    FOR INSERT TO authenticated
    WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can update leads" ON public.leads;
CREATE POLICY "Admins can update leads" ON public.leads
    FOR UPDATE TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
