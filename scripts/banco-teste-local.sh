#!/usr/bin/env bash
# Postgres LOCAL só para a suíte pytest (26/10/2026): a suíte no banco do
# EasyPanel leva 1h13, quase tudo espera de rede, e as frentes fazem fila.
# Aqui: Postgres 17 (o de produção é 17.11) em container, dados em tmpfs
# (descartáveis), schema montado pelas MESMAS migrations, sem dado nenhum.
#
#   bash scripts/banco-teste-local.sh [nome] [porta]   # padrão: marketinghs-teste 5434
#
# Recria do zero a cada chamada. No fim imprime a DATABASE_URL para usar:
#   DATABASE_URL=<url> ./.venv/bin/pytest -q
set -euo pipefail
cd "$(dirname "$0")/.."

NOME="${1:-marketinghs-teste}"
PORTA="${2:-5434}"
SENHA_ADMIN=teste-local
SENHA_APP=teste-local-app

docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -p "127.0.0.1:${PORTA}:5432" \
  -e POSTGRES_PASSWORD="$SENHA_ADMIN" -e POSTGRES_DB=marketinghs \
  --tmpfs /var/lib/postgresql:rw,size=2g \
  postgres:17 -c fsync=off -c synchronous_commit=off -c full_page_writes=off \
  >/dev/null

export PGPASSWORD="$SENHA_ADMIN"
URL="postgresql://postgres@127.0.0.1:${PORTA}/marketinghs"
for _ in $(seq 60); do
  pg_isready -q -h 127.0.0.1 -p "$PORTA" && psql "$URL" -qc 'SELECT 1' >/dev/null 2>&1 && break
  sleep 0.5
done

psql "$URL" -q -v ON_ERROR_STOP=1 \
  -c "CREATE ROLE marketinghs_app LOGIN NOINHERIT PASSWORD '${SENHA_APP}';"

for m in backend/migrations/*.sql; do
  psql "$URL" -q -v ON_ERROR_STOP=1 -f "$m" >/dev/null || { echo "!! falhou em $m"; exit 1; }
done

# Um admin: vários testes conferem a visão `authenticated` contra a de
# `service_role` com "o primeiro admin de user_roles" e pulam sem ele.
psql "$URL" -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
WITH u AS (INSERT INTO auth.users (email, password_hash)
           VALUES ('admin-local@exemplo.invalid', 'sem-login') RETURNING id)
INSERT INTO public.user_roles (user_id, role) SELECT id, 'admin' FROM u;
SQL

echo "tabelas:$(psql "$URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
echo "DATABASE_URL=postgresql://marketinghs_app:${SENHA_APP}@127.0.0.1:${PORTA}/marketinghs"
