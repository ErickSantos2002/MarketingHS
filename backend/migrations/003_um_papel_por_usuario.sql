-- O schema de origem permite vários papéis por usuário: o único índice é em
-- (user_id, role). O MarketingHS trata papel como exclusivo — a tela tem um
-- seletor, não uma lista — e essa divergência não é cosmética.
--
-- ⚠️ Com dois papéis, o LEFT JOIN de auth/router.py:login e de
-- dependencies.py:usuario_atual devolve duas linhas, e o fetchrow pega a
-- primeira sem critério: a mesma pessoa entraria como admin numa vez e como
-- user na seguinte. O índice abaixo é o que torna aquelas queries
-- determinísticas, e também o que a rota PATCH /usuarios/{id}/papel usa para
-- fazer upsert.

DELETE FROM public.user_roles a USING public.user_roles b
 WHERE a.user_id = b.user_id AND a.ctid > b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_roles_user ON public.user_roles (user_id);
