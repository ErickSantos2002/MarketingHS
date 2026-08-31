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

-- ⚠️ DELETE incluído: sem ele a rota DELETE /usuarios/{id} falha com
-- "permission denied for table users", e o erro chega como 500 genérico
-- porque a exceção do asyncpg não tem tratamento próprio. A FK de
-- user_roles.user_id já é ON DELETE CASCADE, então o papel sai junto.
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.users TO service_role;
