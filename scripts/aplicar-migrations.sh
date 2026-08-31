#!/usr/bin/env bash
# Aplica as migrations no Postgres do MarketingHS (serviço próprio no EasyPanel).
# Idempotente: pode rodar de novo sem estragar o que já existe.
set -euo pipefail
cd "$(dirname "$0")/.."

set -a; . ~/marketinghs.env; set +a
export PGPASSWORD="$POSTGRES_PASSWORD"
URL="postgresql://${POSTGRES_USER}@${POSTGRES_HOST_EXTERNO}:${POSTGRES_PORTA_EXTERNA}/${POSTGRES_DB}"

# Senha do marketinghs_app: gerada uma vez e guardada no mesmo arquivo.
if [ -z "${MARKETINGHS_APP_PASSWORD:-}" ]; then
  NOVA=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
  sed -i "s|^MARKETINGHS_APP_PASSWORD=.*|MARKETINGHS_APP_PASSWORD=${NOVA}|" ~/marketinghs.env
  MARKETINGHS_APP_PASSWORD="$NOVA"
  echo ">> senha do marketinghs_app gerada e gravada em ~/marketinghs.env"
fi

psql "$URL" -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='marketinghs_app') THEN
    CREATE ROLE marketinghs_app LOGIN NOINHERIT PASSWORD '${MARKETINGHS_APP_PASSWORD}';
  ELSE
    ALTER ROLE marketinghs_app PASSWORD '${MARKETINGHS_APP_PASSWORD}';
  END IF;
END \$\$;
SQL

for m in backend/migrations/*.sql; do
  echo ">> $m"
  psql "$URL" -v ON_ERROR_STOP=1 -f "$m"
done

echo
psql "$URL" -c "SELECT count(*) AS tabelas FROM information_schema.tables WHERE table_schema='public';"
psql "$URL" -c "SELECT auth.uid() IS NULL AS uid_ok;"
psql "$URL" -c "SELECT rolname, rolsuper FROM pg_roles WHERE rolname='marketinghs_app';"
