# MarketingHS — Lote 0: Fundação — Plano de Implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para executar tarefa a tarefa. Os passos
> usam caixa (`- [ ]`) para acompanhamento.

**Objetivo:** deixar o MarketingHS logando com usuário do nosso Postgres, com o admin
abrindo, sem nenhuma dependência do Supabase no caminho da autenticação.

**Arquitetura:** monorepo `backend/` (FastAPI + asyncpg) + `frontend/` (o React de hoje,
movido) + `worker/` (vazio neste lote). O backend conecta no Postgres `marketinghs` em
62.72.11.28 como `marketinghs_app`, papel comum sem superpoderes, e aplica o contexto de
RLS por transação. Autenticação própria com bcrypt + PyJWT, espelhando o HS.OS.

**Stack:** FastAPI, asyncpg, PyJWT, bcrypt, pydantic-settings, pytest · React 18, Vite,
TanStack Query · Docker Compose

**Spec:** `docs/superpowers/specs/2026-08-31-marketinghs-design.md`

---

## Restrições globais

Valores exatos, copiados da spec. Valem para toda tarefa.

- **Banco:** serviço Postgres próprio no EasyPanel, versão **17.11** (o dump é 17.6 — mesma
  maior, restore sem atrito). Externo `62.72.11.28:3377` para migration e para o cadastro
  `bancos`; interno pelo nome do serviço, que é o que vai no `DATABASE_URL` de produção.
- **Backend e banco na mesma rede Docker do EasyPanel.** O tráfego entre eles não sai do
  host. Substitui, e melhora, a amarra que a spec herdou do HS.OS ("mesmo servidor porque
  o Postgres não aceita TLS"): aqui a proteção vem da rede interna, não da co-localização.
- **Nenhuma extensão é necessária.** O schema usa `gen_random_uuid()` 36 vezes, e isso é
  core no Postgres 13+ — verificado no banco novo com só `plpgsql` instalado. Zero uso de
  `pgcrypto` e zero de `uuid_generate_v4()`. Não escreva `CREATE EXTENSION`.
- **Usuário do backend:** `marketinghs_app`, comum, `NOINHERIT`, **sem superpoderes** —
  superusuário ignora RLS por definição e tornaria as 65 políticas decorativas.
- **DDL é feita pelo agente**, porque a instância é nossa: o EasyPanel entregou banco e
  superusuário, e as credenciais estão em `~/marketinghs.env` (fora do repositório, `600`).
  O `~/.config/bancos/admin.toml` continua fora dos limites — ele é dos 9 bancos de
  produção, não deste.
- ⚠️ **PENDÊNCIA DE FECHAMENTO, decidida pelo Erick em 31/08/2026:** a senha do
  superusuário é igual ao nome de usuário, numa porta exposta à internet. Rodar assim
  durante a construção foi decisão dele, com o risco explicado. **Trocar antes de qualquer
  dado real entrar no banco** — em especial antes da sincronização dos 2.077 clientes do
  DataCore (lote 5). A troca é pela interface do EasyPanel, não por `ALTER USER`, para o
  EasyPanel não ficar com credencial velha guardada.
- **Papel de admin:** o enum é `public.app_role` e o valor é **`'admin'`** — não
  `'administrador'`, que é o do HS.OS. Confira antes de escrever query.
- **Sem recuperação de senha por e-mail.** Senha é definida pelo TI; admin reseta a de quem
  esquecer. `ResetPassword.tsx` e o fluxo de `PASSWORD_RECOVERY` são removidos.
- **Nenhum endpoint depende de RLS para autorizar.** Cada rota autoriza sozinha; o RLS é
  segunda linha.
- **`.env` nunca versionado.** Ele está versionado hoje, com chaves da dn.ia no histórico.
- **Nome de módulo e comentário em português**, como no HS.OS e no resto da casa.
- **Teste automatizado:** a spec reserva pytest para o motor de fila (lote 3). Este lote
  abre **uma exceção justificada**: `app/auth/security.py` são funções puras e expiração de
  token é o caso clássico em que abrir a tela não prova nada. Nada além disso ganha teste
  neste lote.

---

## Estrutura de arquivos

**Cria:**

| Arquivo | Responsabilidade |
|---|---|
| `backend/app/config.py` | Settings do pydantic-settings |
| `backend/app/database.py` | Pool asyncpg + `sessao()` com contexto de RLS |
| `backend/app/main.py` | App FastAPI, ciclo de vida, CORS, `/health` |
| `backend/app/auth/security.py` | bcrypt + PyJWT — funções puras |
| `backend/app/auth/schemas.py` | Modelos pydantic de entrada/saída da auth |
| `backend/app/auth/router.py` | `/auth/status`, `/auth/bootstrap-admin`, `/auth/login`, `/auth/eu` |
| `backend/app/dependencies.py` | `usuario_atual`, `admin_atual` — a autorização da aplicação |
| `backend/app/middleware/limite_taxa.py` | Limite de taxa na borda pública |
| `backend/app/routers/usuarios.py` | As 6 rotas que substituem as 6 functions de usuário |
| `backend/migrations/000_compat_supabase.sql` | Esquema `auth`, `auth.uid()`, os três papéis |
| `backend/migrations/001_schema_origem.sql` | O schema do dump, adaptado |
| `backend/migrations/002_permissoes.sql` | Grants para `marketinghs_app` |
| `backend/tests/test_security.py` | Único teste do lote |
| `backend/requirements.txt` · `backend/Dockerfile` | |
| `scripts/aplicar-migrations.sh` | Cria o `marketinghs_app` e aplica as migrations |
| `frontend/src/lib/api.ts` | Cliente HTTP com JWT — substitui `supabase.functions.invoke` |
| `docker-compose.yml` | `backend` · `frontend` · `worker` |

**Modifica:**

| Arquivo | O quê |
|---|---|
| `frontend/src/hooks/useAuth.tsx` | Reescrito contra `/auth/*` |
| `frontend/src/integrations/supabase/client.ts` | Vira **toco que estoura** |
| `frontend/src/App.tsx` | Remove as rotas das landings e `/reset-password` |
| `.gitignore` | `.env`, `__pycache__`, `.venv` |
| `vite.config.ts` | Remove `lovable-tagger`, adiciona proxy `/api` |

**Apaga:** `src/components/landing/` (menos `humanoseagentes/`, que vai para
`docs/referencia/`), as 26 páginas públicas de `src/pages/`, `src/assets/` (menos o que o
admin usa), `.lovable/`, `.claude/skills/lovable-workflow/`, `README.md`,
`src/pages/admin/ResetPassword.tsx`, `public/videos/dnos-demo.mp4`.

---

## Tarefa 1: Reestruturar o repositório

**Arquivos:**
- Move: `src/` → `frontend/src/`, e os arquivos de config do Vite junto
- Cria: `backend/`, `worker/`, `docker-compose.yml`, `.gitignore` atualizado
- Apaga: landings, assets da dn.ia, resíduo do Lovable

**Interfaces:**
- Produz: a árvore `backend/` + `frontend/` que todas as tarefas seguintes assumem.

- [ ] **Passo 1: preservar a referência antes de apagar**

```bash
cd ~/github/MarketingHS
mkdir -p docs/referencia
git mv src/components/landing/humanoseagentes docs/referencia/humanoseagentes
git mv src/pages/HumanosEAgentes.tsx docs/referencia/HumanosEAgentes.tsx
```

- [ ] **Passo 2: apagar o que é da dn.ia**

```bash
git rm -r --quiet src/components/landing src/assets/clients src/assets/depoimentos \
                  src/assets/local src/assets/tools src/assets/ultima-edicao \
                  .lovable .claude/skills/lovable-workflow public/videos README.md \
                  src/pages/admin/ResetPassword.tsx
# as 26 páginas públicas — mantém só NotFound e a pasta admin/
git rm --quiet $(ls src/pages/*.tsx src/pages/*.css | grep -v NotFound)
```

- [ ] **Passo 3: mover o frontend**

```bash
mkdir -p frontend
git mv src index.html vite.config.ts tsconfig.json tsconfig.app.json \
       tsconfig.node.json tailwind.config.ts postcss.config.js eslint.config.js \
       components.json package.json package-lock.json bun.lock bun.lockb public \
       scripts frontend/
```

- [ ] **Passo 4: `.gitignore`**

```bash
cat >> .gitignore <<'EOF'

# segredos — o .env desta origem estava versionado, com chaves de terceiro
.env
.env.*
!.env.example

# python
__pycache__/
*.pyc
.venv/
.pytest_cache/
EOF
git rm --cached .env
```

- [ ] **Passo 5: esqueleto do backend**

```bash
mkdir -p backend/app/{auth,routers,middleware} backend/migrations backend/tests worker
touch backend/app/__init__.py backend/app/auth/__init__.py \
      backend/app/routers/__init__.py backend/app/middleware/__init__.py
git mv supabase backend/supabase   # as 55 functions viram especificação

cat > backend/requirements.txt <<'EOF'
asyncpg>=0.30.0
bcrypt>=4.0.0
fastapi>=0.115.0
httpx>=0.26.0
pydantic[email]>=2.10.0
pydantic-settings>=2.5.0
PyJWT>=2.9.0
python-dotenv>=1.0.0
python-multipart>=0.0.12
uvicorn[standard]>=0.30.0

# teste — só app/auth/security.py neste lote (ver Restrições globais)
pytest>=8.0.0
EOF
```

- [ ] **Passo 6: `docker-compose.yml`**

```yaml
services:
  backend:
    build: ./backend
    ports: ["8000:8000"]
    env_file: [./backend/.env]
    restart: unless-stopped

  frontend:
    build: ./frontend
    ports: ["8080:80"]
    depends_on: [backend]
    restart: unless-stopped

  # Vazio no lote 0. Ganha corpo no lote 3, junto com o motor de fila.
  worker:
    build: ./backend
    command: python -m app.worker
    env_file: [./backend/.env]
    depends_on: [backend]
    restart: unless-stopped
    profiles: ["worker"]
```

- [ ] **Passo 7: conferir que o frontend ainda sobe**

Rode: `cd frontend && npm install && npm run dev`
Esperado: Vite sobe na porta 8080. O admin ainda vai falhar (fala com o Supabase) — o que
tem que funcionar é o build resolver os imports. Se algum import apontar para landing
apagada, conserte agora.

- [ ] **Passo 8: commit**

```bash
git add -A
git commit -m "refactor: separa backend/frontend e remove o conteúdo da dn.ia

Move src/ para frontend/ e cria o esqueleto do backend. Isso quebra o sync
com o Lovable de propósito: a partir daqui o repositório é a fonte da verdade.

Saem 106 componentes de landing, 26 páginas públicas e 38 MB de asset da
dn.ia; /humanoseagentes fica em docs/referencia/ como molde do fluxo de
captura. As 55 edge functions viram backend/supabase/, especificação e placar.

O .env estava versionado com chaves do Supabase da dn.ia — sai do índice e
entra no .gitignore."
```

---

## Tarefa 2: Extrair e adaptar o schema

**Arquivos:**
- Cria: `backend/migrations/000_compat_supabase.sql`, `001_schema_origem.sql`,
  `002_permissoes.sql`, `scripts/aplicar-migrations.sh`

**Interfaces:**
- Consome: `docs/63cb903c-ece5-4157-8f7f-e7dc4686df2d_260831.backup`
- Produz: o banco `marketinghs` com 36 tabelas, e as funções
  `auth.uid() RETURNS uuid` e `public.has_role(uuid, public.app_role) RETURNS boolean`

- [ ] **Passo 1: extrair o schema bruto do dump**

```bash
cd ~/github/MarketingHS
pg_restore --schema=public --no-owner --no-privileges \
           -f /tmp/schema-bruto.sql docs/63cb903c-*.backup
wc -l /tmp/schema-bruto.sql   # esperado: 5764
```

⚠️ O arquivo gerado usa `\restrict` / `\unrestrict`, recurso do `psql` 18. A máquina
do Erick tem 18.3, mas num servidor com `psql` mais antigo a aplicação quebra — se isso
acontecer, apague as duas linhas (a 5 e a última) antes de aplicar.

- [ ] **Passo 2: `000_compat_supabase.sql`**

```sql
-- Compatibilidade mínima com o que o schema de origem espera do Supabase.
-- As 65 políticas de RLS chamam auth.uid() em 69 lugares; em vez de reescrever
-- todas, a gente entrega a função que elas esperam, alimentada pelo SET LOCAL
-- que app/database.py:sessao() emite a cada transação.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text UNIQUE NOT NULL,
    password_hash text,
    is_active     boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_sign_in_at timestamptz
);

-- Lê o que sessao() gravou. STABLE porque não muda dentro da transação.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_user_id', true), '')::uuid
$$;

-- Os três papéis que o schema de origem referencia (42 + 13 ocorrências).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END $$;
```

- [ ] **Passo 3: gerar `001_schema_origem.sql` a partir do bruto**

O único ajuste necessário é tirar as referências às quatro extensões que não temos. O
`auth.uid()` fica como está — o passo 2 entregou a função.

```bash
python3 - <<'EOF'
import re, pathlib
t = pathlib.Path('/tmp/schema-bruto.sql').read_text()

# 1. As quatro extensões que não existem no nosso Postgres.
for ext in ('pg_cron', 'pg_net', 'pgmq', 'supabase_vault'):
    t = re.sub(rf'^CREATE EXTENSION[^;]*{ext}[^;]*;\n', '', t, flags=re.M)

# 2. As 14 funções que dependem delas. Somem inteiras — viram Python no lote 3.
#    invoke_edge_function some e NÃO volta: é o banco chamando a aplicação por
#    HTTP, indireção que só existe porque o Supabase separa os dois.
#
# ⚠️ A tag de dollar-quote é capturada e reusada por backreference. NÃO troque
# por `^\$\$;` fixo: nem toda função usa `$$` como delimitador, e a versão fixa
# atravessa o fim de uma função e engole as vizinhas. Na primeira execução
# deste plano, `invoke_edge_function` levou junto mais cinco funções do motor
# de jornadas — um vão de 337 linhas — e só não entrou no banco porque o
# implementador testou o resultado antes de aplicar.
mortas = ['email_queue_read', 'email_queue_delete', 'email_queue_send_batch',
          'journey_queue_read', 'journey_queue_delete', 'journey_enqueue_email',
          'fn_contact_event_to_journey_queue', 'requeue_orphan_journey_sends',
          'reset_stuck_campaigns', 'evaluate_automation_on_etiqueta',
          'invoke_edge_function', 'get_integration_secret',
          'set_integration_secret', 'delete_integration_secret']
for f in mortas:
    t = re.sub(rf'^CREATE FUNCTION public\.{f}\(.*?AS (\$[^$]*\$).*?\1;\n',
               '', t, flags=re.M | re.S)

# 3. Os dois triggers que apontavam para funções da lista. CREATE TRIGGER valida
#    a função na hora da criação, então eles têm de sair junto.
for trg in ['trg_automation_on_etiqueta_change', 'trg_contact_event_journey']:
    t = re.sub(rf'^CREATE TRIGGER {trg}.*?;\n', '', t, flags=re.M | re.S)

pathlib.Path('backend/migrations/001_schema_origem.sql').write_text(t)
print('escrito')
EOF
```

- [ ] **Passo 4: verificar que nada sobrou apontando para extensão ausente**

```bash
grep -nE "pgmq\.|net\.http|vault\.|cron\.schedule|CREATE EXTENSION" \
     backend/migrations/001_schema_origem.sql
```

Esperado: **nenhuma linha.** Se sobrar, é função que chama fila e não estava na lista do
passo 3 — some ela também e anote o nome, porque o lote 3 vai precisar reimplementá-la.

Confira também que os três índices únicos sobreviveram, porque eles são a garantia de não
enviar e-mail duplicado (§10 da spec):

```bash
grep -c "uniq_campaign_sends_email_campaign_lead\|uniq_campaign_sends_journey_node\|uniq_journey_runs_open" \
     backend/migrations/001_schema_origem.sql
```

Esperado: **`6`** — o `pg_restore` escreve cada índice duas vezes, o comentário
`-- Name:` e a linha `CREATE UNIQUE INDEX`. Se der 3, um deles sumiu; se der 0, sumiram
todos e a migração não pode seguir.

- [ ] **Passo 5: `002_permissoes.sql`**

```sql
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
```

- [ ] **Passo 6: `scripts/aplicar-migrations.sh`**

O `scripts/` da raiz foi para `frontend/` na tarefa 1 (era do build do Vite), então
recrie o diretório: `mkdir -p scripts`.

O EasyPanel já criou o banco e o superusuário — o script só aplica as migrations e
cria o papel do backend. **Pode ser rodado pelo agente**: as credenciais estão em
`~/marketinghs.env`, que é desta instância e não dos 9 bancos de produção.

```bash
#!/usr/bin/env bash
# Aplica as migrations no Postgres do MarketingHS (serviço próprio no EasyPanel).
#
# ⚠️ NÃO é idempotente. O 001 vem do pg_dump e não usa IF NOT EXISTS nem
# OR REPLACE, então uma segunda execução aborta em "already exists" na primeira
# tabela. A falha é limpa — ON_ERROR_STOP=1 e nenhum DROP — mas para reaplicar
# do zero é preciso recriar o banco. A criação do papel, essa sim, é idempotente.
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
```

- [ ] **Passo 7: rodar e conferir**

```bash
bash scripts/aplicar-migrations.sh
```

Esperado: `tabelas = 36`, `uid_ok = t`, e `marketinghs_app` com **`rolsuper = f`** — se
vier `t`, o RLS estaria decorativo e o lote não pode seguir.

Se as tabelas vierem menos que 36, alguma função do passo 3 levou tabela junto no
`re.sub` — confira o diff antes de seguir.

- [ ] **Passo 8: cadastrar no `bancos`**

Este passo **é do Erick**: o bloco novo vai no `~/.config/bancos/admin.toml`, que o
agente não lê. Peça que ele acrescente `[marketinghs]` com host `62.72.11.28`, porta
`3377`, banco `marketinghs`, e rode `python criar_leitura.py marketinghs`. Confira:

```bash
~/projetos/analises-bancos/.venv/bin/python -c "
import bancos; print(bancos.consultar('marketinghs', 'select count(*) from leads'))"
```

Esperado: `0` — a tabela existe e está vazia.

- [ ] **Passo 9: commit**

```bash
git add backend/migrations scripts/aplicar-migrations.sh
git commit -m "feat(banco): schema de origem portado para o Postgres da HS

000 entrega a compatibilidade mínima que as 65 políticas de RLS esperam do
Supabase: esquema auth, auth.users e auth.uid() lendo o SET LOCAL que a
sessão emite. Assim as 69 chamadas a auth.uid() no schema herdado continuam
valendo sem reescrita.

001 é o dump adaptado — saem as quatro extensões que não temos e as nove
funções que dependiam delas. Nenhum CREATE EXTENSION entra: gen_random_uuid()
é core desde o Postgres 13 e o schema não usa mais nada de pgcrypto. invoke_edge_function some e não volta: era o
banco chamando a aplicação por HTTP, indireção que só existe porque o
Supabase separa os dois.

Os três índices únicos de campaign_sends e journey_runs foram preservados
ao pé da letra: são a garantia, no nível do banco, de não enviar duas vezes."
```

---

## Tarefa 3: Esqueleto do backend

**Arquivos:**
- Cria: `backend/app/config.py`, `backend/app/database.py`, `backend/app/main.py`,
  `backend/Dockerfile`, `backend/.env.example`

**Interfaces:**
- Produz: `settings` (objeto `Settings`), `sessao(role: str, user_id: str | None)` como
  gerenciador de contexto assíncrono devolvendo `asyncpg.Connection`, `init_db()`,
  `close_db()`, e o app FastAPI em `app.main:app`.

- [ ] **Passo 1: `backend/app/config.py`**

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # Postgres da HS. Sem TLS por limitação do servidor — por isso backend e
    # banco moram na mesma máquina (62.72.11.28).
    DATABASE_URL: str = ""

    # Auth própria — substitui supabase.auth
    JWT_SECRET: str = "dev-only-trocar-em-producao"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_HOURS: int = 24

    FRONTEND_URL: str = "http://127.0.0.1:8080"

    # Limite de taxa da borda pública (lead-capture e afins não têm auth).
    LIMITE_PUBLICO_POR_MINUTO: int = 30

    # ⚠️ Toda chave lida do ambiente PRECISA ser declarada aqui, mesmo que outro
    # módulo é que a leia: o pydantic-settings recusa chave desconhecida no .env
    # e derruba o boot inteiro. Isso já derrubou o HS.OS duas vezes.


settings = Settings()
```

- [ ] **Passo 2: `backend/app/database.py`**

```python
import json
import logging
from contextlib import asynccontextmanager
from typing import Optional

import asyncpg

from app.config import settings

logger = logging.getLogger(__name__)

_pool: Optional[asyncpg.Pool] = None


async def _preparar_conexao(conn: asyncpg.Connection) -> None:
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads,
                              schema="pg_catalog")
    await conn.set_type_codec("json", encoder=json.dumps, decoder=json.loads,
                              schema="pg_catalog")


async def init_db() -> None:
    """Sem DATABASE_URL a API sobe mesmo assim e os endpoints de dado respondem
    503. Mantém /health e /docs utilizáveis durante a portagem."""
    global _pool
    if not settings.DATABASE_URL:
        logger.warning("DATABASE_URL vazio — subindo sem banco.")
        return
    try:
        _pool = await asyncpg.create_pool(
            settings.DATABASE_URL, min_size=2, max_size=10, setup=_preparar_conexao
        )
    except Exception as exc:  # noqa: BLE001 — falha de banco não derruba o processo
        logger.error("Falha ao conectar no Postgres: %s", exc)


async def close_db() -> None:
    if _pool:
        await _pool.close()


# SET LOCAL ROLE não aceita parâmetro — o nome vai concatenado na query, então
# nunca pode vir de entrada do usuário. Daí a lista fechada.
PAPEIS = frozenset({"anon", "authenticated", "service_role"})


@asynccontextmanager
async def sessao(role: str = "anon", user_id: str | None = None):
    """Conexão em transação, com o contexto de RLS já aplicado.

    Toda query de dado passa por aqui. O backend conecta como marketinghs_app,
    NOINHERIT e sem privilégio em public: sem o SET LOCAL ROLE a query falha
    com permissão negada em vez de rodar sem contexto de usuário.

    role="service_role" tem BYPASSRLS — só para operação interna (bootstrap,
    job agendado), nunca para request de usuário.
    """
    if role not in PAPEIS:
        raise ValueError(f"papel inválido: {role!r}")
    if _pool is None:
        raise RuntimeError("banco indisponível")

    async with _pool.acquire() as conn:
        async with conn.transaction():
            # is_local=true equivale a SET LOCAL: reverte no fim da transação,
            # então a conexão volta limpa para o pool.
            await conn.execute(
                "SELECT set_config('app.current_user_id', $1, true)", str(user_id or "")
            )
            await conn.execute(f"SET LOCAL ROLE {role}")
            yield conn
```

- [ ] **Passo 3: `backend/app/main.py`**

```python
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import close_db, init_db

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    await init_db()
    yield
    await close_db()


app = FastAPI(title="MarketingHS", lifespan=ciclo_de_vida)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"ok": True}
```

- [ ] **Passo 4: `backend/Dockerfile`**

```dockerfile
FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Passo 5: `backend/.env.example`**

```bash
cat > backend/.env.example <<'EOF'
# Copie para backend/.env e preencha. O .env nunca vai para o git.
# A senha do marketinghs_app é a que aplicar-migrations.sh gerou e gravou
# em ~/marketinghs.env.
DATABASE_URL=postgresql://marketinghs_app:TROCAR@62.72.11.28:5432/marketinghs

# Gere com: python3 -c "import secrets; print(secrets.token_urlsafe(48))"
JWT_SECRET=trocar-em-producao
JWT_EXPIRE_HOURS=24

FRONTEND_URL=http://127.0.0.1:8080
LIMITE_PUBLICO_POR_MINUTO=30
EOF
```

- [ ] **Passo 6: subir e conferir**

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt
cp .env.example .env   # preencha DATABASE_URL com a senha da tarefa 2
.venv/bin/uvicorn app.main:app --reload --port 8000 &
sleep 3 && curl -s localhost:8000/health
```

Esperado: `{"ok":true}` e, no log, **nenhum** aviso de `DATABASE_URL vazio`.

- [ ] **Passo 7: commit**

```bash
git add backend/app backend/Dockerfile backend/.env.example
git commit -m "feat(backend): esqueleto FastAPI com pool e contexto de RLS

sessao() é o único caminho para dado: abre transação, grava
app.current_user_id (que alimenta o auth.uid() da migration 000) e emite
SET LOCAL ROLE. O marketinghs_app é NOINHERIT e não tem privilégio em
public — sem esse SET a query falha, e isso é proposital."
```

---

## Tarefa 4: Autenticação

**Arquivos:**
- Cria: `backend/app/auth/security.py`, `schemas.py`, `router.py`,
  `backend/tests/test_security.py`
- Modifica: `backend/app/main.py` (inclui o router)

**Interfaces:**
- Consome: `sessao()` da tarefa 3
- Produz: `gerar_hash(senha: str) -> str`, `conferir_senha(senha: str, hash: str | None) -> bool`,
  `emitir_token(user_id: str, papel: str, email: str) -> tuple[str, int]`,
  `ler_token(token: str) -> dict`. Rotas `GET /auth/status`,
  `POST /auth/bootstrap-admin`, `POST /auth/login`. (`GET /auth/eu` fica na tarefa 5,
  porque depende de `app.dependencies`.)

- [ ] **Passo 1: escrever o teste que falha**

`backend/tests/test_security.py`:

```python
"""Único teste do lote 0. Justificativa nas Restrições globais: são funções
puras, e expiração de token é o caso em que abrir a tela não prova nada."""
import jwt
import pytest

from app.auth.security import conferir_senha, emitir_token, gerar_hash, ler_token
from app.config import settings


def test_hash_confere_a_senha_certa_e_recusa_a_errada():
    h = gerar_hash("segredo-do-erick")
    assert conferir_senha("segredo-do-erick", h)
    assert not conferir_senha("outra", h)


def test_conta_sem_senha_nunca_autentica():
    # Conta criada por admin e ainda sem senha definida tem hash NULL.
    assert not conferir_senha("qualquer", None)


def test_hash_malformado_no_banco_e_falha_e_nao_excecao():
    assert not conferir_senha("qualquer", "isto-nao-e-um-hash-bcrypt")


def test_token_carrega_identidade_e_papel():
    token, segundos = emitir_token("11111111-1111-1111-1111-111111111111",
                                   "admin", "erick@healthsafety.com.br")
    dados = ler_token(token)
    assert dados["sub"] == "11111111-1111-1111-1111-111111111111"
    assert dados["papel"] == "admin"
    assert dados["email"] == "erick@healthsafety.com.br"
    assert segundos == settings.JWT_EXPIRE_HOURS * 3600


def test_token_expirado_e_recusado():
    original = settings.JWT_EXPIRE_HOURS
    settings.JWT_EXPIRE_HOURS = -1   # já nasce vencido
    try:
        token, _ = emitir_token("22222222-2222-2222-2222-222222222222",
                                "admin", "a@b.c")
        with pytest.raises(jwt.ExpiredSignatureError):
            ler_token(token)
    finally:
        settings.JWT_EXPIRE_HOURS = original


def test_token_assinado_com_outro_segredo_e_recusado():
    token = jwt.encode({"sub": "x"}, "segredo-errado", algorithm="HS256")
    with pytest.raises(jwt.InvalidSignatureError):
        ler_token(token)
```

- [ ] **Passo 2: rodar e ver falhar**

Rode: `cd backend && .venv/bin/pytest tests/test_security.py -v`
Esperado: FALHA com `ModuleNotFoundError: No module named 'app.auth.security'`

- [ ] **Passo 3: `backend/app/auth/security.py`**

```python
"""Hash de senha e emissão/validação de JWT. Substitui o supabase.auth.
Sem dependência externa: bcrypt e PyJWT."""

from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.config import settings

# bcrypt trunca em 72 bytes e o pacote levanta erro acima disso. O limite é
# validado no schema de entrada; aqui só documentamos por que ele existe.
LIMITE_SENHA_BYTES = 72


def gerar_hash(senha: str) -> str:
    return bcrypt.hashpw(senha.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def conferir_senha(senha: str, hash_armazenado: str | None) -> bool:
    """Compara em tempo constante. Conta sem senha nunca autentica."""
    if not hash_armazenado:
        return False
    try:
        return bcrypt.checkpw(senha.encode("utf-8"), hash_armazenado.encode("utf-8"))
    except ValueError:
        # hash malformado no banco: falha, não 500
        return False


def emitir_token(user_id: str, papel: str, email: str) -> tuple[str, int]:
    """Devolve (token, segundos_ate_expirar)."""
    expira_em = timedelta(hours=settings.JWT_EXPIRE_HOURS)
    agora = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "email": email,
        "papel": papel,
        "iat": agora,
        "exp": agora + expira_em,
    }
    token = jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return token, int(expira_em.total_seconds())


def ler_token(token: str) -> dict:
    """Valida assinatura e expiração. Levanta jwt.PyJWTError se inválido."""
    return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
```

- [ ] **Passo 4: rodar e ver passar**

Rode: `cd backend && .venv/bin/pytest tests/test_security.py -v`
Esperado: **6 passed**

- [ ] **Passo 5: `backend/app/auth/schemas.py`**

```python
from pydantic import BaseModel, EmailStr, Field


class LoginIn(BaseModel):
    email: EmailStr
    # 72 bytes é o teto do bcrypt (ver LIMITE_SENHA_BYTES).
    senha: str = Field(min_length=8, max_length=72)


class BootstrapIn(BaseModel):
    email: EmailStr
    senha: str = Field(min_length=8, max_length=72)


class UsuarioOut(BaseModel):
    id: str
    email: str
    papel: str


class TokenOut(BaseModel):
    token: str
    expira_em: int
    usuario: UsuarioOut


class StatusInstalacaoOut(BaseModel):
    precisa_bootstrap: bool
    total_usuarios: int
```

- [ ] **Passo 6: `backend/app/auth/router.py`**

```python
"""Autenticação. Substitui o supabase.auth.

Uma conta é duas linhas em duas tabelas, criadas na mesma transação:
  auth.users        identidade (e-mail, hash da senha)
  public.user_roles papel — o enum public.app_role, cujo valor de admin é 'admin'

Não há recuperação de senha por e-mail: sistema interno, senha definida pelo TI.
"""

import logging

from fastapi import APIRouter, HTTPException, status

from app.auth.schemas import (
    BootstrapIn, LoginIn, StatusInstalacaoOut, TokenOut, UsuarioOut,
)
from app.auth.security import conferir_senha, emitir_token, gerar_hash
from app.database import sessao

# ⚠️ `/auth/eu` NÃO entra aqui: ele depende de app.dependencies, que só nasce
# na tarefa 5. Importá-lo agora quebra o boot com ImportError.

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/status", response_model=StatusInstalacaoOut)
async def status_instalacao():
    """Instalação zerada não tem usuário e não há cadastro público. A tela de
    login usa isto para oferecer a criação do primeiro administrador."""
    async with sessao(role="service_role") as conn:
        total = await conn.fetchval("SELECT count(*) FROM auth.users")
    return StatusInstalacaoOut(precisa_bootstrap=(total == 0), total_usuarios=total)


@router.post("/bootstrap-admin", response_model=TokenOut,
             status_code=status.HTTP_201_CREATED)
async def bootstrap_admin(dados: BootstrapIn):
    """Cria o primeiro administrador. Só funciona com o banco sem usuário."""
    senha_hash = gerar_hash(dados.senha)
    async with sessao(role="service_role") as conn:
        # Trava a tabela para que duas chamadas simultâneas não criem dois
        # "primeiros" admins. A transação da sessão garante a liberação.
        await conn.execute("LOCK TABLE auth.users IN EXCLUSIVE MODE")
        if await conn.fetchval("SELECT count(*) FROM auth.users") > 0:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Esta instalação já tem usuários. Peça acesso a um administrador.",
            )
        user_id = await conn.fetchval(
            """INSERT INTO auth.users (email, password_hash, last_sign_in_at)
               VALUES ($1, $2, now()) RETURNING id""",
            dados.email, senha_hash,
        )
        await conn.execute(
            "INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin')",
            user_id,
        )
    token, expira = emitir_token(str(user_id), "admin", dados.email)
    return TokenOut(token=token, expira_em=expira,
                    usuario=UsuarioOut(id=str(user_id), email=dados.email, papel="admin"))


@router.post("/login", response_model=TokenOut)
async def login(dados: LoginIn):
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            """SELECT u.id::text AS id, u.email, u.password_hash, u.is_active,
                      COALESCE(r.role::text, 'sem_papel') AS papel
                 FROM auth.users u
                 LEFT JOIN public.user_roles r ON r.user_id = u.id
                WHERE lower(u.email) = lower($1)""",
            dados.email,
        )
    # Mensagem única para e-mail inexistente e senha errada: não entregamos a
    # quem tenta a informação de quais e-mails existem.
    if linha is None or not conferir_senha(dados.senha, linha["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "E-mail ou senha incorretos.")
    if not linha["is_active"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Conta desativada.")

    async with sessao(role="service_role") as conn:
        await conn.execute("UPDATE auth.users SET last_sign_in_at = now() WHERE id = $1::uuid",
                           linha["id"])

    token, expira = emitir_token(linha["id"], linha["papel"], linha["email"])
    return TokenOut(token=token, expira_em=expira,
                    usuario=UsuarioOut(id=linha["id"], email=linha["email"],
                                       papel=linha["papel"]))
```

- [ ] **Passo 7: registrar o router em `backend/app/main.py`**

Depois do `add_middleware`, acrescente:

```python
from app.auth.router import router as auth_router

app.include_router(auth_router)
```

- [ ] **Passo 8: conferir ponta a ponta**

```bash
curl -s localhost:8000/auth/status
curl -s -X POST localhost:8000/auth/bootstrap-admin \
     -H 'Content-Type: application/json' \
     -d '{"email":"erick@healthsafety.com.br","senha":"trocar-depois"}'
curl -s -X POST localhost:8000/auth/login -H 'Content-Type: application/json' \
     -d '{"email":"erick@healthsafety.com.br","senha":"errada"}'
```

Esperado, na ordem: `precisa_bootstrap: true` · um token e `papel: "admin"` ·
`401 "E-mail ou senha incorretos."`

- [ ] **Passo 9: commit**

```bash
git add backend/app/auth backend/tests backend/app/main.py
git commit -m "feat(auth): autenticação própria com bcrypt e JWT

Substitui o supabase.auth. Não há recuperação de senha por e-mail: sistema
interno, senha definida pelo TI, admin reseta a de quem esquecer — um
caminho de acesso a menos para manter seguro.

Login devolve a mesma mensagem para e-mail inexistente e senha errada, para
não entregar a quem tenta quais e-mails existem.

security.py leva teste porque são funções puras e expiração de token é o
caso em que abrir a tela não prova nada."
```

---

## Tarefa 5: Autorização

**Arquivos:**
- Cria: `backend/app/dependencies.py`

**Interfaces:**
- Consome: `ler_token()` da tarefa 4, `sessao()` da tarefa 3
- Produz: classe `Usuario(id, email, papel, nome=None)`,
  `usuario_atual() -> Usuario` e `admin_atual() -> Usuario`, ambas dependências FastAPI,
  e a rota `GET /auth/eu`.

- [ ] **Passo 1: `backend/app/dependencies.py`**

```python
"""Aqui mora a autorização da aplicação.

O RLS do banco é a segunda linha, não a primeira: as políticas dependem de
auth.uid(), que só é preenchido porque database.sessao() emite o SET LOCAL.
Endpoint que não depender de usuario_atual roda como anon.

Papéis: tabela public.user_roles, enum public.app_role. O valor de admin é
'admin' — não 'administrador', que é o do HS.OS.
"""

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth.security import ler_token
from app.database import sessao

# auto_error=False: sem header devolvemos a nossa mensagem, em português.
_bearer = HTTPBearer(auto_error=False)


class Usuario:
    def __init__(self, id: str, email: str, papel: str, nome: str | None = None):
        self.id = id
        self.email = email
        self.papel = papel
        self.nome = nome

    def __repr__(self) -> str:
        return f"Usuario({self.email}, papel={self.papel})"


async def usuario_atual(
    cred: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> Usuario:
    if cred is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Autenticação necessária.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        dados = ler_token(cred.credentials)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                            "Sessão expirada. Entre novamente.")
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token inválido.")

    user_id = dados.get("sub")
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                            "Token sem identificação de usuário.")

    # O papel é relido do banco a cada request, não confiado ao token: revogar
    # um administrador precisa valer na hora, sem esperar o token expirar.
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            """SELECT u.id::text AS id, u.email, u.is_active,
                      COALESCE(r.role::text, 'sem_papel') AS papel
                 FROM auth.users u
                 LEFT JOIN public.user_roles r ON r.user_id = u.id
                WHERE u.id = $1::uuid""",
            user_id,
        )
    if linha is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuário não encontrado.")
    if not linha["is_active"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Conta desativada.")

    return Usuario(id=linha["id"], email=linha["email"], papel=linha["papel"])


async def admin_atual(usuario: Usuario = Depends(usuario_atual)) -> Usuario:
    if usuario.papel != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Esta ação exige perfil de administrador.")
    return usuario
```

- [ ] **Passo 2: acrescentar `/auth/eu` em `backend/app/auth/router.py`**

Agora que `app.dependencies` existe, o endpoint pode entrar. No topo do arquivo,
troque a linha de import do FastAPI e acrescente a do dependencies:

```python
from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import Usuario, usuario_atual
```

E no fim do arquivo:

```python
@router.get("/eu", response_model=UsuarioOut)
async def eu(usuario: Usuario = Depends(usuario_atual)):
    return UsuarioOut(id=usuario.id, email=usuario.email, papel=usuario.papel)
```

- [ ] **Passo 3: conferir**

```bash
TOKEN=$(curl -s -X POST localhost:8000/auth/login -H 'Content-Type: application/json' \
        -d '{"email":"erick@healthsafety.com.br","senha":"trocar-depois"}' \
        | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s localhost:8000/auth/eu -H "Authorization: Bearer $TOKEN"
curl -s localhost:8000/auth/eu -H "Authorization: Bearer lixo"
curl -s localhost:8000/auth/eu
```

Esperado: os dados do Erick com `papel: "admin"` · `401 "Token inválido."` ·
`401 "Autenticação necessária."`

- [ ] **Passo 4: commit**

```bash
git add backend/app/dependencies.py backend/app/auth/router.py
git commit -m "feat(auth): dependências de autorização

O papel é relido do banco a cada request e não confiado ao token: revogar um
administrador precisa valer na hora, sem esperar o token expirar."
```

---

## Tarefa 6: Admin de usuários

**Arquivos:**
- Cria: `backend/app/routers/usuarios.py`
- Modifica: `backend/app/main.py`
- Apaga: `backend/supabase/functions/{create-user,delete-user,list-users,update-user-email,update-user-role,reset-user-password}`

**Interfaces:**
- Consome: `admin_atual` da tarefa 5, `gerar_hash` da tarefa 4
- Produz: `GET /usuarios`, `POST /usuarios`, `DELETE /usuarios/{id}`,
  `PATCH /usuarios/{id}/email`, `PATCH /usuarios/{id}/papel`, `POST /usuarios/{id}/senha`

- [ ] **Passo 1: ler as 6 functions de origem antes de escrever**

```bash
for f in create-user delete-user list-users update-user-email update-user-role \
         reset-user-password; do
  echo "===== $f ====="; cat backend/supabase/functions/$f/index.ts
done
```

Elas são a especificação. Se alguma tiver regra que este plano não previu (por exemplo,
impedir que o último admin se auto-remova), **implemente a regra e anote no commit** — o
plano não substitui a leitura.

- [ ] **Passo 2: `backend/app/routers/usuarios.py`**

```python
"""Substitui as 6 edge functions de administração de usuário.

Toda rota exige admin. As duas regras que valem a pena não perder:
  - ninguém remove nem rebaixa a si mesmo (evita instalação sem administrador)
  - o último admin não pode ser removido nem rebaixado
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field

from app.auth.security import gerar_hash
from app.database import sessao
from app.dependencies import Usuario, admin_atual

router = APIRouter(prefix="/usuarios", tags=["usuarios"])


class UsuarioLinha(BaseModel):
    id: str
    email: str
    papel: str
    is_active: bool
    created_at: str
    last_sign_in_at: str | None


class CriarUsuarioIn(BaseModel):
    email: EmailStr
    senha: str = Field(min_length=8, max_length=72)
    papel: str = Field(pattern="^(admin|user)$")


class TrocarEmailIn(BaseModel):
    email: EmailStr


class TrocarPapelIn(BaseModel):
    papel: str = Field(pattern="^(admin|user)$")


class TrocarSenhaIn(BaseModel):
    senha: str = Field(min_length=8, max_length=72)


async def _total_admins(conn) -> int:
    return await conn.fetchval(
        "SELECT count(*) FROM public.user_roles WHERE role = 'admin'"
    )


@router.get("", response_model=list[UsuarioLinha])
async def listar(_: Usuario = Depends(admin_atual)):
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            """SELECT u.id::text AS id, u.email, u.is_active,
                      u.created_at::text, u.last_sign_in_at::text,
                      COALESCE(r.role::text, 'sem_papel') AS papel
                 FROM auth.users u
                 LEFT JOIN public.user_roles r ON r.user_id = u.id
                ORDER BY u.created_at"""
        )
    return [UsuarioLinha(**dict(l)) for l in linhas]


@router.post("", response_model=UsuarioLinha, status_code=status.HTTP_201_CREATED)
async def criar(dados: CriarUsuarioIn, _: Usuario = Depends(admin_atual)):
    async with sessao(role="service_role") as conn:
        if await conn.fetchval("SELECT 1 FROM auth.users WHERE lower(email)=lower($1)",
                               dados.email):
            raise HTTPException(status.HTTP_409_CONFLICT, "Já existe conta com esse e-mail.")
        user_id = await conn.fetchval(
            "INSERT INTO auth.users (email, password_hash) VALUES ($1, $2) RETURNING id",
            dados.email, gerar_hash(dados.senha),
        )
        await conn.execute(
            "INSERT INTO public.user_roles (user_id, role) VALUES ($1, $2::public.app_role)",
            user_id, dados.papel,
        )
        linha = await conn.fetchrow(
            """SELECT u.id::text AS id, u.email, u.is_active, u.created_at::text,
                      u.last_sign_in_at::text, r.role::text AS papel
                 FROM auth.users u JOIN public.user_roles r ON r.user_id = u.id
                WHERE u.id = $1""", user_id)
    return UsuarioLinha(**dict(linha))


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remover(user_id: str, admin: Usuario = Depends(admin_atual)):
    if user_id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Você não pode remover a própria conta.")
    async with sessao(role="service_role") as conn:
        papel = await conn.fetchval(
            "SELECT role::text FROM public.user_roles WHERE user_id = $1::uuid", user_id)
        if papel == "admin" and await _total_admins(conn) <= 1:
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "Não é possível remover o último administrador.")
        removidos = await conn.execute("DELETE FROM auth.users WHERE id = $1::uuid", user_id)
    if removidos.endswith(" 0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuário não encontrado.")


@router.patch("/{user_id}/email", response_model=UsuarioLinha)
async def trocar_email(user_id: str, dados: TrocarEmailIn,
                       _: Usuario = Depends(admin_atual)):
    async with sessao(role="service_role") as conn:
        if await conn.fetchval(
            "SELECT 1 FROM auth.users WHERE lower(email)=lower($1) AND id <> $2::uuid",
            dados.email, user_id,
        ):
            raise HTTPException(status.HTTP_409_CONFLICT, "Já existe conta com esse e-mail.")
        linha = await conn.fetchrow(
            """UPDATE auth.users SET email = $2 WHERE id = $1::uuid
               RETURNING id::text AS id, email, is_active, created_at::text,
                         last_sign_in_at::text""", user_id, dados.email)
        if linha is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuário não encontrado.")
        papel = await conn.fetchval(
            "SELECT COALESCE(role::text,'sem_papel') FROM public.user_roles WHERE user_id=$1::uuid",
            user_id) or "sem_papel"
    return UsuarioLinha(**dict(linha), papel=papel)


@router.patch("/{user_id}/papel", response_model=UsuarioLinha)
async def trocar_papel(user_id: str, dados: TrocarPapelIn,
                       admin: Usuario = Depends(admin_atual)):
    if user_id == admin.id and dados.papel != "admin":
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Você não pode rebaixar a própria conta.")
    async with sessao(role="service_role") as conn:
        atual = await conn.fetchval(
            "SELECT role::text FROM public.user_roles WHERE user_id = $1::uuid", user_id)
        if atual == "admin" and dados.papel != "admin" and await _total_admins(conn) <= 1:
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "Não é possível rebaixar o último administrador.")
        await conn.execute(
            """INSERT INTO public.user_roles (user_id, role)
               VALUES ($1::uuid, $2::public.app_role)
               ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role""",
            user_id, dados.papel)
        linha = await conn.fetchrow(
            """SELECT u.id::text AS id, u.email, u.is_active, u.created_at::text,
                      u.last_sign_in_at::text, r.role::text AS papel
                 FROM auth.users u JOIN public.user_roles r ON r.user_id = u.id
                WHERE u.id = $1::uuid""", user_id)
        if linha is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuário não encontrado.")
    return UsuarioLinha(**dict(linha))


@router.post("/{user_id}/senha", status_code=status.HTTP_204_NO_CONTENT)
async def trocar_senha(user_id: str, dados: TrocarSenhaIn,
                       _: Usuario = Depends(admin_atual)):
    """Reset feito por administrador. Não há autosserviço por e-mail."""
    async with sessao(role="service_role") as conn:
        r = await conn.execute(
            "UPDATE auth.users SET password_hash = $2 WHERE id = $1::uuid",
            user_id, gerar_hash(dados.senha))
    if r.endswith(" 0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuário não encontrado.")
```

⚠️ **`ON CONFLICT (user_id)` exige índice único em `user_roles(user_id)`.** O schema de
origem não tem — ele permite vários papéis por usuário. Confira antes:

```bash
grep -n "user_roles" backend/migrations/001_schema_origem.sql | grep -i unique
```

Se não houver, acrescente `backend/migrations/003_um_papel_por_usuario.sql`:

```sql
-- O MarketingHS trata papel como exclusivo (admin OU user), e a rota
-- PATCH /usuarios/{id}/papel depende disso para fazer upsert.
DELETE FROM public.user_roles a USING public.user_roles b
 WHERE a.user_id = b.user_id AND a.ctid > b.ctid;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_roles_user ON public.user_roles (user_id);
```

- [ ] **Passo 3: registrar o router**

Em `backend/app/main.py`:

```python
from app.routers.usuarios import router as usuarios_router

app.include_router(usuarios_router)
```

- [ ] **Passo 4: conferir cada rota**

```bash
TOKEN=...   # do login, como na tarefa 5
H="Authorization: Bearer $TOKEN"
curl -s localhost:8000/usuarios -H "$H"
curl -s -X POST localhost:8000/usuarios -H "$H" -H 'Content-Type: application/json' \
     -d '{"email":"teste@healthsafety.com.br","senha":"senha-teste","papel":"user"}'
ID=$(curl -s localhost:8000/usuarios -H "$H" | python3 -c \
  'import sys,json;print([u["id"] for u in json.load(sys.stdin) if u["email"].startswith("teste")][0])')
curl -s -X PATCH localhost:8000/usuarios/$ID/papel -H "$H" \
     -H 'Content-Type: application/json' -d '{"papel":"admin"}'
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE localhost:8000/usuarios/$ID -H "$H"
```

Esperado: lista com o Erick · criação 201 · papel vira `admin` · exclusão `204`.
Depois teste as guardas: `DELETE` da própria conta deve dar `400`, e remover o último
admin deve dar `409`.

- [ ] **Passo 5: as functions saem da pasta de especificação**

```bash
git rm -r backend/supabase/functions/{create-user,delete-user,list-users,\
update-user-email,update-user-role,reset-user-password}
```

- [ ] **Passo 6: commit**

```bash
git add backend/app/routers/usuarios.py backend/app/main.py backend/migrations
git commit -m "feat(usuarios): 6 rotas substituem as 6 edge functions de usuário

Duas guardas que a origem tinha e valem manter: ninguém remove nem rebaixa a
própria conta, e o último administrador não sai — as duas evitam instalação
sem ninguém que possa administrá-la.

O reset de senha é sempre por administrador; não há autosserviço por e-mail.

6/48 functions portadas."
```

---

## Tarefa 7: Limite de taxa na borda pública

**Arquivos:**
- Cria: `backend/app/middleware/limite_taxa.py`
- Modifica: `backend/app/main.py`

**Interfaces:**
- Produz: `LimiteTaxaMiddleware(app, por_minuto: int, prefixos: tuple[str, ...])`

- [ ] **Passo 1: `backend/app/middleware/limite_taxa.py`**

```python
"""Limite de taxa da borda pública.

lead-capture, email-unsubscribe, resend-webhook, ab-events e /go são públicos
por desenho — é a landing page chamando, sem autenticação. No Supabase o
gateway fazia alguma contenção; o FastAPI não faz nenhuma. Sem isto, qualquer
um enche a base de leads.

Janela deslizante em memória. É por processo, não distribuído: com uma réplica
basta, e trocar por Redis depois não muda a interface.
"""

import time
from collections import defaultdict, deque

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware


class LimiteTaxaMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, por_minuto: int, prefixos: tuple[str, ...]):
        super().__init__(app)
        self.por_minuto = por_minuto
        self.prefixos = prefixos
        self._historico: dict[str, deque] = defaultdict(deque)

    def _cliente(self, request: Request) -> str:
        # Atrás do nginx da VPS o IP real vem no X-Forwarded-For.
        encaminhado = request.headers.get("x-forwarded-for")
        if encaminhado:
            return encaminhado.split(",")[0].strip()
        return request.client.host if request.client else "desconhecido"

    async def dispatch(self, request: Request, call_next):
        if not request.url.path.startswith(self.prefixos):
            return await call_next(request)

        agora = time.monotonic()
        marcas = self._historico[self._cliente(request)]
        while marcas and agora - marcas[0] > 60:
            marcas.popleft()

        if len(marcas) >= self.por_minuto:
            return JSONResponse(
                {"detail": "Muitas requisições. Tente novamente em um minuto."},
                status_code=429,
                headers={"Retry-After": "60"},
            )

        marcas.append(agora)
        return await call_next(request)
```

- [ ] **Passo 2: registrar em `backend/app/main.py`**

```python
from app.middleware.limite_taxa import LimiteTaxaMiddleware

# Prefixos públicos. Cresce conforme os lotes 3 e 7 trouxerem as rotas de
# captura, descadastro, webhook e A/B.
app.add_middleware(
    LimiteTaxaMiddleware,
    por_minuto=settings.LIMITE_PUBLICO_POR_MINUTO,
    prefixos=("/publico", "/auth/login"),
)
```

- [ ] **Passo 3: conferir**

```bash
for i in $(seq 1 35); do
  curl -s -o /dev/null -w '%{http_code} ' -X POST localhost:8000/auth/login \
       -H 'Content-Type: application/json' -d '{"email":"a@b.c","senha":"12345678"}'
done; echo
```

Esperado: uma sequência de `401` e, a partir da 31ª, `429`.

- [ ] **Passo 4: commit**

```bash
git add backend/app/middleware backend/app/main.py
git commit -m "feat(seguranca): limite de taxa na borda pública

O gateway do Supabase fazia alguma contenção antes das edge functions; o
FastAPI não faz nenhuma, e lead-capture é público por desenho. Entra já,
antes de a rota de captura existir, para não virar dívida no lote 1."
```

---

## Tarefa 8: Frontend contra a API própria

**Arquivos:**
- Cria: `frontend/src/lib/api.ts`
- Modifica: `frontend/src/hooks/useAuth.tsx`,
  `frontend/src/integrations/supabase/client.ts`, `frontend/src/App.tsx`,
  `frontend/vite.config.ts`

**Interfaces:**
- Consome: `/auth/status`, `/auth/login`, `/auth/eu` da tarefa 4
- Produz: `api.get/post/patch/delete(caminho, corpo?)`, `guardarToken`, `lerToken`,
  `limparToken`. O `useAuth()` mantém a mesma forma que o admin já consome —
  `{ user, isAdmin, isLoading, signIn, signOut }` — para não mexer nas telas.

- [ ] **Passo 1: `frontend/src/lib/api.ts`**

```ts
// Cliente HTTP com JWT. Substitui supabase.functions.invoke e, aos poucos,
// supabase.from.
//
// ⚠️ VITE_API_URL é resolvida em BUILD TIME, não em runtime. Trocar a variável
// no servidor sem rebuildar não muda nada — a URL já está dentro do bundle.
// Isso já custou tempo no Grana. Em desenvolvimento o proxy do Vite cobre.
const BASE = import.meta.env.VITE_API_URL ?? '/api';

const CHAVE_TOKEN = 'marketinghs-token';

export function guardarToken(token: string) {
  localStorage.setItem(CHAVE_TOKEN, token);
}

export function lerToken(): string | null {
  return localStorage.getItem(CHAVE_TOKEN);
}

export function limparToken() {
  localStorage.removeItem(CHAVE_TOKEN);
}

export class ErroApi extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function pedir<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  const token = lerToken();
  const resposta = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: {
      ...(corpo ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });

  if (resposta.status === 401) {
    // Sessão morta: limpa e manda para o login em vez de deixar a tela
    // tentando de novo com um token que não vale mais.
    limparToken();
    if (!location.pathname.startsWith('/login')) location.assign('/login');
    throw new ErroApi(401, 'Sessão expirada.');
  }

  if (!resposta.ok) {
    let detalhe = `Erro ${resposta.status}`;
    try {
      detalhe = (await resposta.json()).detail ?? detalhe;
    } catch { /* resposta sem corpo JSON */ }
    throw new ErroApi(resposta.status, detalhe);
  }

  return resposta.status === 204 ? (undefined as T) : resposta.json();
}

export const api = {
  get: <T>(c: string) => pedir<T>('GET', c),
  post: <T>(c: string, corpo?: unknown) => pedir<T>('POST', c, corpo),
  patch: <T>(c: string, corpo?: unknown) => pedir<T>('PATCH', c, corpo),
  delete: <T>(c: string) => pedir<T>('DELETE', c),
};
```

- [ ] **Passo 2: `frontend/src/hooks/useAuth.tsx` reescrito**

```tsx
import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { api, guardarToken, limparToken, lerToken, ErroApi } from '@/lib/api';

interface Usuario {
  id: string;
  email: string;
  papel: string;
}

interface AuthContextType {
  user: Usuario | null;
  isAdmin: boolean;
  isLoading: boolean;
  signIn: (email: string, senha: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Usuario | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // O papel vem do backend, que o relê do banco a cada request. Não há mais
  // cache de papel em sessionStorage: revogar admin passa a valer na hora.
  useEffect(() => {
    if (!lerToken()) { setIsLoading(false); return; }
    api.get<Usuario>('/auth/eu')
      .then(setUser)
      .catch(() => { limparToken(); setUser(null); })
      .finally(() => setIsLoading(false));
  }, []);

  const signIn = useCallback(async (email: string, senha: string) => {
    try {
      const r = await api.post<{ token: string; usuario: Usuario }>(
        '/auth/login', { email, senha });
      guardarToken(r.token);
      setUser(r.usuario);
      return { error: null };
    } catch (e) {
      return { error: e instanceof ErroApi ? new Error(e.message) : (e as Error) };
    }
  }, []);

  const signOut = useCallback(async () => {
    limparToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, isAdmin: user?.papel === 'admin', isLoading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) throw new Error('useAuth precisa estar dentro de AuthProvider');
  return ctx;
}
```

⚠️ O `useAuth` antigo expunha `session`, `isRoleLoading`, `signUp` e `resetPassword`.
Rode `grep -rn "isRoleLoading\|signUp\|resetPassword\|\.session" frontend/src` e ajuste
cada uso: `isRoleLoading` some (o papel vem junto do usuário), `signUp` e `resetPassword`
não existem mais — cadastro é pelo admin de usuários.

- [ ] **Passo 3: o toco barulhento**

`frontend/src/integrations/supabase/client.ts`, inteiro:

```ts
// O Supabase saiu. Este toco existe para que tela ainda não portada estoure
// alto em vez de quebrar em silêncio — a falha característica desta travessia,
// e a que custou caro no HS.OS.
//
// Quando este arquivo puder ser apagado sem quebrar nada, a portagem acabou.

function naoPortado(alvo: string): never {
  throw new Error(
    `[MarketingHS] não portado: ${alvo}. ` +
    `Esta tela ainda fala com o Supabase. Escreva o endpoint no backend e ` +
    `troque por @/lib/api.`
  );
}

export const supabase = new Proxy({} as never, {
  get(_alvo, prop: string) {
    if (prop === 'from') return (tabela: string) => naoPortado(`supabase.from('${tabela}')`);
    if (prop === 'rpc') return (fn: string) => naoPortado(`supabase.rpc('${fn}')`);
    if (prop === 'functions') {
      return { invoke: (nome: string) => naoPortado(`supabase.functions.invoke('${nome}')`) };
    }
    return () => naoPortado(`supabase.${prop}`);
  },
});
```

- [ ] **Passo 4: limpar `App.tsx` e o Vite**

Em `frontend/src/App.tsx`: remova as rotas das landings apagadas e a de
`/reset-password`, mantendo o catch-all `<Route path="*" element={<NotFound />} />`
por último. Preserve o redirecionamento `/leads → /contacts`.

Em `frontend/vite.config.ts`: remova o `lovable-tagger` da cadeia de plugins e acrescente

```ts
server: {
  host: '127.0.0.1',
  port: 8080,
  proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true, rewrite: p => p.replace(/^\/api/, '') } },
},
```

- [ ] **Passo 5: conferir no navegador**

```bash
cd frontend && npm run dev
```

Com Playwright, em `http://127.0.0.1:8080/login`: logue com
`erick@healthsafety.com.br`. Esperado: entra, a sidebar do admin aparece.
As telas de Contacts, Campaigns etc. **vão estourar com `[MarketingHS] não portado: …`** —
isso é o comportamento correto do lote 0, não um defeito.

- [ ] **Passo 6: commit**

```bash
git add frontend/src frontend/vite.config.ts
git commit -m "feat(frontend): auth contra a API própria e toco barulhento no lugar do Supabase

useAuth passa a falar com /auth/*. Sai o cache de papel em sessionStorage: o
backend relê o papel do banco a cada request, então revogar administrador
vale na hora.

O cliente do Supabase vira um Proxy que estoura com 'não portado: <alvo>'.
Quebra silenciosa vira erro alto na primeira vez que alguém abre a tela — é
a segunda metade do portão de pronto, junto com o grep. Quando este arquivo
puder ser apagado sem quebrar nada, a portagem acabou."
```

---

## Tarefa 9: Fechar o lote

**Arquivos:**
- Cria: `docs/ROADMAP.md`, `docs/CONTINUAR-AQUI.md`, `CLAUDE.md` (reescrito)
- Apaga: o `CLAUDE.md` herdado (fala de Lovable, Supabase e de um projeto que não é nosso)

- [ ] **Passo 1: o portão mecânico**

```bash
grep -rn "supabase" frontend/src/hooks/useAuth.tsx \
                    frontend/src/components/admin/ProtectedRoute.tsx \
                    frontend/src/pages/admin/Login.tsx
```

Esperado: **nenhuma linha.** Se aparecer alguma, o lote não fechou.

- [ ] **Passo 2: o placar, contando as duas coisas separadas**

```bash
echo "functions restantes: $(ls backend/supabase/functions | grep -v _shared | wc -l)/48"
echo "arquivos ainda falando com o Supabase: $(grep -rl 'supabase\.' frontend/src | wc -l)"
```

Esperado: `42/48` e um número de arquivos ainda alto — o que é correto, e é
exatamente o número que os lotes 1 a 7 vão derrubar. **Nunca junte os dois num
número só:** foi isso que escondeu tela quebrada no HS.OS.

- [ ] **Passo 3: `CLAUDE.md` novo**

Reescreva do zero. O herdado descreve o Lovable, o Supabase e o produto da dn.ia — manter
qualquer parte dele é convidar a próxima sessão a seguir instrução errada. O novo cobre:
a origem e o que a spec decidiu; a árvore `backend`/`frontend`/`worker`; a amarra do TLS
que obriga backend e banco na mesma máquina; `sessao()` como único caminho para dado; o
valor `'admin'` do enum; o portão de pronto (grep + navegador) e o placar de dois números;
e que `backend/supabase/` é especificação, não código vivo.

- [ ] **Passo 4: `docs/ROADMAP.md` e `docs/CONTINUAR-AQUI.md`**

`ROADMAP.md` recebe a tabela dos 8 lotes da spec, com o 0 marcado como concluído.
`CONTINUAR-AQUI.md` recebe: onde parou, o que está funcionando de verdade (conferido no
navegador), qual o próximo lote e qual o primeiro passo dele.

- [ ] **Passo 5: commit e o push que rompe o sync**

```bash
git add -A
git commit -m "docs: fecha o lote 0 — fundação

Login com usuário do nosso Postgres, admin abrindo, zero Supabase no caminho
da autenticação. 6/48 functions portadas.

CLAUDE.md reescrito do zero: o herdado descrevia o Lovable, o Supabase e o
produto da dn.ia, e manter qualquer parte dele mandaria a próxima sessão
seguir instrução errada."

git push -u origin reconstrucao
```

⚠️ **Este é o push que rompe o sync com o Lovable.** É intencional e está na spec, mas
confirme com o Erick antes de executá-lo.

---

## Definição de pronto do lote 0

- [ ] `curl localhost:8000/health` responde `{"ok":true}` com banco conectado
- [ ] `pytest` passa: 6 testes em `tests/test_security.py`
- [ ] Login no navegador com usuário do banco `marketinghs`, sidebar abre
- [ ] `grep -rn "supabase" frontend/src/hooks/useAuth.tsx` volta vazio
- [ ] As 6 functions de usuário saíram de `backend/supabase/functions/`
- [ ] Tela não portada estoura com `[MarketingHS] não portado: …`
- [ ] `.env` fora do índice do git
- [ ] `marketinghs` cadastrado no `bancos` e respondendo a `bancos.consultar`
- [ ] `marketinghs_app` existe com `rolsuper = f`

## Pendências que atravessam o lote

- [ ] **Trocar a senha do superusuário do Postgres** (hoje igual ao nome de usuário, em
  porta exposta). Pela interface do EasyPanel, não por `ALTER USER`. Decisão do Erick de
  rodar assim durante a construção; **obrigatório antes do lote 5**, que traz os 2.077
  clientes do DataCore para dentro.
- [ ] Preencher `POSTGRES_HOST_INTERNO` em `~/marketinghs.env` — só é necessário no
  deploy, mas o `DATABASE_URL` de produção depende dele.
