-- O backend conecta como marketinghs_app, que é NOINHERIT e não tem privilégio
-- nenhum em public por si. Ele só enxerga dado depois do SET LOCAL ROLE que
-- app/database.py:sessao() emite — sem isso a query falha com permissão negada,
-- em vez de rodar sem contexto de usuário. É proposital.

GRANT anon, authenticated, service_role TO marketinghs_app;

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
  TO authenticated, service_role;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
  TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth
  TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON auth.users TO service_role;
