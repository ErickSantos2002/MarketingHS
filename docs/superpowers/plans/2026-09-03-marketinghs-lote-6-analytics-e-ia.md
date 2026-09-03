# Lote 6 — Analytics e IA

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para executar tarefa a tarefa.
> Os passos usam caixa de seleção (`- [ ]`) para acompanhamento.

**Objetivo:** tirar a IA do gateway do Lovable e pôr na API da Claude, trocando
o SQL escrito pelo modelo por ferramentas nomeadas — e fechar a porta de
superusuário que o desenho antigo abriu.

**Arquitetura:** o analista de dados deixa de adivinhar por palavra-chave e de
escrever SQL. Ele ganha seis ferramentas parametrizadas, cada uma com schema
estrito e allowlist de campos, executadas pela `sessao()` com o papel de quem
perguntou. O laço de ferramentas é manual, não o `tool_runner` — que é beta e
não expõe o controle de que precisamos. As duas funções de análise viram porte
fiel com saída estruturada.

**Stack:** FastAPI + asyncpg · `anthropic` (Python SDK) · Claude Opus 5 ·
React 18 + TanStack Query · pytest

**Spec:** `docs/superpowers/specs/2026-08-31-marketinghs-design.md` — seção 7
(lote 6) e seção 9 (travas de terceiro, linha do Lovable AI Gateway).

---

## Restrições globais

Valem para **toda** tarefa deste plano.

- **`sessao()` é o único caminho para dado.** O backend conecta como
  `marketinghs_app`, `NOINHERIT`, sem privilégio em `public` por si. Nunca
  conecte como superusuário: **superusuário ignora RLS por definição**, e as 65
  políticas herdadas viram decoração.
- **`role="service_role"` tem `BYPASSRLS`.** Só para operação interna. **Nunca
  para request de usuário** — e as ferramentas da IA são request de usuário.
- **Nenhum endpoint depende do RLS para autorizar.** Cada rota autoriza sozinha,
  por `usuario_atual` / `admin_atual`.
- **O papel é `'admin'`**, não `'administrador'`; o enum é `public.app_role`.
- **Toda chave lida do ambiente precisa estar declarada em `Settings`**
  (`backend/app/config.py`). O pydantic-settings recusa chave desconhecida no
  `.env` e derruba o boot inteiro. `config.py` não tem `extra="ignore"`.
- **`.env` nunca é versionado.** Nenhum segredo no código.
- **Não escreva `CREATE EXTENSION`.**
- **Os três índices únicos parciais são intocáveis:**
  `uniq_campaign_sends_email_campaign_lead`, `uniq_campaign_sends_journey_node`,
  `uniq_journey_runs_open`.
- **Backend na porta 8100** no host (a 8000 é do TaskHS). Frontend em
  `127.0.0.1:8080`.
- **Testes:** `cd backend && ./.venv/bin/pytest -q`. A fixture `conexao`
  (`backend/tests/conftest.py`) abre transação com `SET LOCAL ROLE service_role`
  e **sempre reverte**. ⚠️ Não mate o pytest no meio; se usar timeout, dê folga.
- **Migrations:** ⚠️ **NÃO rode `scripts/aplicar-migrations.sh`.** Ele reaplica
  desde a `001_schema_origem.sql`, que é dump bruto sem `IF NOT EXISTS`, e morre
  em `type "app_role" already exists`. Aplique a migration nova sozinha, por
  `psql`, com as credenciais de `~/marketinghs.env`. Ela ainda precisa tolerar
  rodar duas vezes.
- **O modelo é `claude-opus-5`.** Não troque por Sonnet ou Haiku para economizar:
  a conta estimada é de ~$15/mês e a decisão de modelo é do Erick.

---

## O que este lote NÃO faz

- **Não reescreve o dashboard.** Os 48 componentes das 6 abas já consomem
  `useAdminData` → `useLeads` → `listarContatos`, portado no lote 1B. Eles
  calculam no navegador e continuam calculando.
- **Não constrói agregação no servidor.** Decidido: 2.083 contatos hoje, e
  reescrever 48 componentes por um problema que ainda não existe é o que o YAGNI
  proíbe. O que entra é a **tarja** que mata a parte silenciosa do truncamento.
- **Não mexe em `usePages` nem em `leadConversion.ts`** — lote 7.
- **Não implementa streaming.** Nenhuma das três funções de origem transmite, e
  a tela do chat não espera token a token.

---

## Onde a spec erra, e o que vale no lugar

1. **A spec chama o lote 6 de "Analytics + IA" e diz "Painéis, funil, origem, AI
   Data Analyst".** Os painéis **já estão fora do Supabase** — o dashboard
   inteiro roda sobre dado portado no lote 1B. O que resta de Analytics neste
   lote é a tarja de truncamento; o resto é IA e configuração de painel.
2. **A spec diz, na seção 9, que a troca do Lovable é "troca de provedor, não de
   arquitetura".** Decisão do Erick em 03/09/2026: **é troca de arquitetura no
   chat**. A heurística de palavras-chave é o defeito central, e o SQL escrito
   pelo modelo é um buraco de segurança. As outras duas funções continuam sendo
   troca de provedor só.
3. **A spec conta 4 functions no lote 6.** A `analytics-api` **não tem chamador
   nenhum** e foi **descartada** por decisão do Erick, como Nexus, Ticketia e
   Pingback. A conta vira **47 portáveis + 7 descartadas**.
4. **A spec (seção 9) diz "Microsoft Clarity — projeto próprio, ou remove".**
   Remove: o `useClarity` não tem um único consumidor.

---

## O defeito de segurança que este lote fecha

O analista de IA de origem faz o **modelo escrever SQL**, e executa por uma RPC:

```sql
CREATE FUNCTION public.execute_readonly_query(query_text text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
```

Conferido no banco em 03/09/2026: `prosecdef = true`, dono `administrador`,
**`rolsuper = true`**. O SQL que o modelo escrever roda como **superusuário**.

A defesa é uma **lista negra**: tem de começar com `select`/`with` e não pode
conter `insert|update|delete|drop|alter|create|truncate|grant|revoke`.

O que a lista negra não bloqueia:

```sql
SELECT value FROM integration_secrets
```

Começa com `select`, não tem palavra proibida. E essa tabela tem, hoje, em texto
puro, o `UNSUBSCRIBE_SECRET` e o `RESEND_WEBHOOK_SECRET` — conferido. Vazar o
primeiro é poder forjar descadastro de qualquer contato; o segundo, forjar
evento de entrega e abertura. Quando o Resend e o Meta forem configurados, a
`RESEND_API_KEY` e o `META_ACCESS_TOKEN` caem na mesma tabela. Também alcança
`auth.users` (hashes de senha) e `api_keys`.

⚠️ **Não está explorável hoje** — a tela morre no toco do Supabase antes, e nada
no backend portado chama a RPC. Mas ela está **viva no banco**, e é uma
primitiva de leitura irrestrita como superusuário esperando um chamador. A
Task 1 a apaga.

**O substituto não é uma lista negra melhor.** É não deixar o modelo escrever
SQL: seis ferramentas nomeadas, allowlist de campos, `sessao()` com o papel de
quem perguntou.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `backend/migrations/016_sem_sql_do_modelo.sql` | **criar** — apaga `execute_readonly_query` |
| `backend/app/ia/__init__.py` | **criar** — pacote |
| `backend/app/ia/cliente.py` | **criar** — falar com a API da Claude, só isso |
| `backend/app/ia/ferramentas.py` | **criar** — as 6 ferramentas, allowlists, execução |
| `backend/app/ia/analista.py` | **criar** — o laço manual de ferramentas |
| `backend/app/routers/ia.py` | **criar** — `/ia/chat`, `/ia/analisar-*` |
| `backend/app/routers/painel.py` | **criar** — `dashboard_settings` e agendamentos |
| `backend/app/routers/configuracao.py` | **modificar** — `/config/ia` |
| `backend/app/config.py` | **modificar** — `ANTHROPIC_API_KEY` |
| `backend/app/main.py` | **modificar** — registrar os dois routers novos |
| `backend/tests/test_ia_ferramentas.py` | **criar** — allowlist, limites, números |
| `backend/tests/test_ia_analista.py` | **criar** — o laço, sem rede |
| `frontend/src/hooks/useAIChat.tsx` | **modificar** |
| `frontend/src/hooks/useAIAnalysis.tsx` | **modificar** |
| `frontend/src/components/admin/dashboard/challenges/ChallengesAIInsights.tsx` | **modificar** |
| `frontend/src/hooks/useGoalSettings.tsx` | **modificar** |
| `frontend/src/hooks/useDashboardCardSettings.tsx` | **modificar** |
| `frontend/src/hooks/useAgendamentos.tsx` | **modificar** |
| `frontend/src/hooks/useClarity.tsx` | **apagar** |
| `frontend/src/components/admin/settings/IACard.tsx` | **criar** |
| `frontend/src/hooks/useLeads.tsx` | **modificar** — expor o truncamento |
| `frontend/src/hooks/useAdminData.tsx` | **modificar** — propagar |
| `frontend/src/pages/admin/{Overview,Analytics}.tsx` | **modificar** — a tarja |
| `backend/supabase/functions/{analytics-api,ai-data-analyst,analyze-leads,analyze-challenges}/` | **apagar** — só no fim |

---

### Task 1: A porta de superusuário se fecha

**Arquivos:**
- Criar: `backend/migrations/016_sem_sql_do_modelo.sql`
- Criar: `backend/tests/test_sem_sql_do_modelo.py`

**Interfaces:**
- Consome: nada.
- Produz: a garantia, verificável, de que `execute_readonly_query` não existe.

Esta tarefa é primeiro de propósito: é a única do lote que fecha um buraco de
segurança, e ela não depende de nenhuma outra.

- [ ] **Passo 1: Escrever o teste que falha**

Criar `backend/tests/test_sem_sql_do_modelo.py`:

```python
"""A porta de superusuário está fechada.

`execute_readonly_query` era SECURITY DEFINER com dono superusuário e aceitava
qualquer SELECT que o modelo escrevesse. A defesa era uma lista negra de
palavras — que não bloqueia `SELECT value FROM integration_secrets`, onde moram
o UNSUBSCRIBE_SECRET e o RESEND_WEBHOOK_SECRET em texto puro.

O substituto não é uma lista negra melhor: é o modelo não escrever SQL.
Ver app/ia/ferramentas.py.
"""

import pytest


@pytest.mark.asyncio
async def test_a_funcao_de_sql_livre_nao_existe_mais(conexao):
    n = await conexao.fetchval(
        "SELECT count(*) FROM pg_proc WHERE proname = 'execute_readonly_query'")
    assert n == 0, (
        "execute_readonly_query voltou ao banco. Ela roda SQL arbitrário como "
        "superusuário e alcança integration_secrets. Ver migration 016.")


@pytest.mark.asyncio
async def test_nenhuma_funcao_nova_de_sql_livre_apareceu(conexao):
    """A guarda larga: qualquer SECURITY DEFINER que receba `text` e faça
    EXECUTE do que recebeu é a mesma porta com outro nome."""
    suspeitas = await conexao.fetch(
        """SELECT p.proname
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.prosecdef
              AND pg_get_functiondef(p.oid) ~* 'EXECUTE\\s+(''|\\|\\||format|query|clean)'
              AND p.proname <> 'eleger_contato_canonico'""")
    nomes = sorted(r["proname"] for r in suspeitas)
    assert nomes == [], f"funções que executam SQL montado: {nomes}"
```

⚠️ O segundo teste vai **falhar listando funções herdadas** na primeira rodada.
Isso é informação, não erro: rode, leia a lista, e no Passo 3 acrescente à
exclusão apenas as que você **conferir** que montam SQL de colunas fixas e não
de texto vindo de fora. Se alguma receber `text` e executar, **pare e me
reporte** — é outra porta igual.

- [ ] **Passo 2: Rodar e conferir que falha**

```bash
cd backend && ./.venv/bin/pytest tests/test_sem_sql_do_modelo.py -q
```

Esperado: o primeiro teste falha com `assert 1 == 0`. O segundo lista o que
achou.

- [ ] **Passo 3: Escrever a migration**

Criar `backend/migrations/016_sem_sql_do_modelo.sql`:

```sql
-- 016: o modelo não escreve mais SQL.
--
-- `execute_readonly_query(text)` era o motor do analista de IA de origem: o
-- modelo escrevia a query e esta função executava. Conferido no banco em
-- 03/09/2026: SECURITY DEFINER, dono `administrador`, `rolsuper = true`. Ou
-- seja, o SQL do modelo rodava como SUPERUSUÁRIO — e superusuário ignora RLS
-- por definição, então as 65 políticas herdadas não valiam nada ali dentro.
--
-- A defesa era uma LISTA NEGRA: começar com select/with, e não conter
-- insert|update|delete|drop|alter|create|truncate|grant|revoke.
--
-- O que a lista negra não bloqueia:
--
--     SELECT value FROM integration_secrets
--
-- Começa com `select`, não tem palavra proibida. Essa tabela guarda, em texto
-- puro, o UNSUBSCRIBE_SECRET (a chave do HMAC dos links de descadastro) e o
-- RESEND_WEBHOOK_SECRET. Vazar o primeiro é poder forjar descadastro de
-- qualquer contato; o segundo, forjar evento de entrega e abertura. Quando o
-- Resend e o Meta forem configurados pela tela, RESEND_API_KEY e
-- META_ACCESS_TOKEN entram na mesma tabela. Também alcançava auth.users, onde
-- moram os hashes de senha, e api_keys.
--
-- ⚠️ Não estava explorável no MarketingHS: a tela morre no toco do Supabase
-- antes de chegar aqui, e nenhum código portado chamava a RPC. Mas a função
-- estava viva no banco — uma primitiva de leitura irrestrita como superusuário
-- esperando um chamador.
--
-- O substituto NÃO é uma lista negra melhor. É o modelo não escrever SQL:
-- app/ia/ferramentas.py expõe seis ferramentas nomeadas, com allowlist de
-- campos, executadas pela sessao() com o papel de quem perguntou.
DROP FUNCTION IF EXISTS public.execute_readonly_query(text);
```

- [ ] **Passo 4: Aplicar a migration sozinha**

⚠️ **Não** use `scripts/aplicar-migrations.sh` — ele reaplica desde a `001` e
morre. Aplique só esta:

```bash
set -a; . ~/marketinghs.env; set +a
PGPASSWORD="$POSTGRES_PASSWORD" psql \
  "postgresql://${POSTGRES_USER}@${POSTGRES_HOST_EXTERNO}:${POSTGRES_PORTA_EXTERNA}/${POSTGRES_DB}" \
  -v ON_ERROR_STOP=1 -f backend/migrations/016_sem_sql_do_modelo.sql
```

Esperado: `DROP FUNCTION`. Rode **duas vezes** para provar que tolera
reaplicação; a segunda também sai sem erro, por causa do `IF EXISTS`.

- [ ] **Passo 5: Rodar os testes e conferir que passam**

```bash
cd backend && ./.venv/bin/pytest tests/test_sem_sql_do_modelo.py -q
```

Esperado: 2 passed. Se o segundo ainda listar função, siga o aviso do Passo 1.

- [ ] **Passo 6: Rodar a suíte inteira**

```bash
cd backend && ./.venv/bin/pytest -q
```

Esperado: tudo que passava continua passando.

- [ ] **Passo 7: Commit**

```bash
git add backend/migrations/016_sem_sql_do_modelo.sql backend/tests/test_sem_sql_do_modelo.py
git commit -m "fix(6): o modelo não escreve mais SQL

execute_readonly_query era SECURITY DEFINER com dono superusuário e executava
qualquer SELECT que a IA gerasse. A defesa era lista negra de palavras, que não
bloqueia 'SELECT value FROM integration_secrets' — onde estão, em texto puro, o
UNSUBSCRIBE_SECRET e o RESEND_WEBHOOK_SECRET.

Não estava explorável (a tela morre no toco antes), mas estava viva no banco.
O substituto são ferramentas nomeadas, não uma lista negra melhor."
```

---

### Task 2: O cliente da Claude e a chave

**Arquivos:**
- Criar: `backend/app/ia/__init__.py`
- Criar: `backend/app/ia/cliente.py`
- Modificar: `backend/app/config.py`
- Modificar: `backend/app/routers/configuracao.py`
- Modificar: `backend/requirements.txt`

**Interfaces:**
- Consome: `app.integracoes.{ler_segredo, gravar_segredo, apagar_segredo}`.
- Produz:
  - `MODELO: str = "claude-opus-5"`, `SEGREDO_CHAVE: str = "ANTHROPIC_API_KEY"`
  - `async def cliente() -> anthropic.AsyncAnthropic | None` — `None` se não
    configurada
  - `class IANaoConfigurada(RuntimeError)`
  - `GET /config/ia` → `{"anthropic_api_key": {"configurado": bool, "ultimos4": str|null}, "modelo": str}`
  - `PUT /config/ia` recebe `{"api_key"?: str, "limpar"?: bool}` → `{"gravado": bool, "limpado": bool}`

- [ ] **Passo 1: Acrescentar a dependência**

Em `backend/requirements.txt`, acrescente:

```
anthropic>=1.0.0
```

Instale:

```bash
cd backend && ./.venv/bin/pip install -r requirements.txt
./.venv/bin/python -c "import anthropic; print(anthropic.__version__)"
```

⚠️ O SDK 1.x usa `httpx2`, não `httpx`. O projeto já usa `httpx` no
`app/email/resend.py` — **os dois convivem**, são pacotes diferentes. Não troque
o `resend.py`.

- [ ] **Passo 2: Declarar a chave em `Settings`**

⚠️ Este passo vem antes do código de propósito: `app/config.py` não tem
`extra="ignore"`, então uma `ANTHROPIC_API_KEY` no `.env` sem declaração aqui
derruba o boot inteiro. Já derrubou o HS.OS duas vezes.

Em `backend/app/config.py`, abaixo do bloco do Meta:

```python
    # IA (API da Claude). Como as do Resend e do Meta: o valor de verdade mora
    # em `integration_secrets` e é gravado pela tela; declarar aqui é o que
    # impede o pydantic-settings de derrubar o boot se a chave estiver no .env.
    ANTHROPIC_API_KEY: str = ""
```

⚠️ **Não** acrescente ao `backend/.env.example` — as do Resend e do Meta também
não estão lá, de propósito: o lugar delas é a tela.

- [ ] **Passo 3: Escrever o cliente**

Criar `backend/app/ia/__init__.py` (vazio) e `backend/app/ia/cliente.py`:

```python
"""O cliente da API da Claude. Uma responsabilidade só: falar com a API.

Separado do resto de propósito — é o único ponto do módulo de IA que faz rede
para fora, e é o que um teste precisa substituir para rodar sem gastar token.
Mesmo desenho do `app/email/resend.py`.

⚠️ A chave sai de `integration_secrets`, não do ambiente de produção. Rotacionar
é gravar pela tela; não precisa de deploy.
"""

import anthropic

from app.integracoes import ler_segredo

# O modelo é decisão do Erick (03/09/2026), não do código. Trocar por um mais
# barato é decisão dele também — a conta estimada é de ~$15/mês.
MODELO = "claude-opus-5"

SEGREDO_CHAVE = "ANTHROPIC_API_KEY"

# 120s: uma pergunta de análise com ferramentas encadeia várias idas ao modelo,
# e o padrão do SDK (10 min) é longo demais para um request de tela — quem
# espera é uma pessoa olhando um spinner.
TIMEOUT = 120


class IANaoConfigurada(RuntimeError):
    """Não há chave da Anthropic gravada. Quem chama transforma em 400 com
    mensagem que diz o que fazer, não em 500."""


async def cliente() -> anthropic.AsyncAnthropic | None:
    """O cliente, ou `None` se a chave não estiver configurada.

    ⚠️ Devolve `None` em vez de levantar porque quem chama precisa distinguir
    "não configurado" (400, a tela explica) de "falhou" (502). `ler_segredo`
    nunca levanta.
    """
    chave = await ler_segredo(SEGREDO_CHAVE)
    if not chave:
        return None
    return anthropic.AsyncAnthropic(api_key=chave, timeout=TIMEOUT)


async def exigir_cliente() -> anthropic.AsyncAnthropic:
    """O cliente, ou `IANaoConfigurada`."""
    c = await cliente()
    if c is None:
        raise IANaoConfigurada(
            "A chave da Anthropic não está configurada. "
            "Preencha em Configurações → Integrações → IA.")
    return c
```

- [ ] **Passo 4: Os endpoints de configuração**

Ao fim de `backend/app/routers/configuracao.py`:

```python
# ── Configuração da IA ───────────────────────────────────────────────────────
# Mesmo desenho do Resend e do Meta: o segredo mora em `integration_secrets` e
# a leitura NUNCA devolve o valor.

class IAIn(BaseModel):
    api_key: str | None = None
    limpar: bool = False


@router.get("/config/ia")
async def ler_config_ia(_: Usuario = Depends(admin_atual)):
    """O que está configurado. Nunca a chave.

    O modelo volta porque não é segredo e é o que a pessoa precisa conferir para
    saber o que vai ser cobrado.
    """
    from app.ia import cliente as ia_cliente
    from app.integracoes import ler_segredo

    chave = await ler_segredo(ia_cliente.SEGREDO_CHAVE) or ""
    return {
        "anthropic_api_key": {"configurado": bool(chave),
                              "ultimos4": chave[-4:] if len(chave) >= 4 else None},
        "modelo": ia_cliente.MODELO,
    }


@router.put("/config/ia")
async def gravar_config_ia(dados: IAIn, _: Usuario = Depends(admin_atual)):
    """Grava só o que veio preenchido; apaga só se `limpar` vier verdadeiro."""
    from app.ia import cliente as ia_cliente
    from app.integracoes import apagar_segredo, gravar_segredo

    if dados.limpar:
        await apagar_segredo(ia_cliente.SEGREDO_CHAVE)
        return {"gravado": False, "limpado": True}

    if not dados.api_key or not dados.api_key.strip():
        # String vazia é "não mexi", não "apague" — mesma regra do Resend.
        return {"gravado": False, "limpado": False}

    valor = dados.api_key.strip()
    if not valor.startswith("sk-ant-"):
        # A chave da Anthropic começa com sk-ant-. Colar a do Resend ou o token
        # do Meta aqui faria toda chamada dar 401, e a mensagem da Anthropic não
        # diz que o problema é a chave ser de outro serviço.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            'A chave da Anthropic começa com "sk-ant-". Confira se você não '
            "colou a chave de outro serviço.")
    await gravar_segredo(ia_cliente.SEGREDO_CHAVE, valor)
    return {"gravado": True, "limpado": False}
```

- [ ] **Passo 5: Conferir por HTTP**

Suba o backend e emita um token de admin:

```bash
cd backend && ./.venv/bin/python -m uvicorn app.main:app --port 8100 &
TOKEN=$(cd backend && ./.venv/bin/python -c "
from app.auth.security import emitir_token
print(emitir_token('b6eb4652-1a93-420b-82e6-d2b8f894e2c8', 'admin', 'erick@healthsafety.com.br')[0])")

curl -s http://127.0.0.1:8100/config/ia -H "Authorization: Bearer $TOKEN"
# Esperado: {"anthropic_api_key":{"configurado":false,"ultimos4":null},"modelo":"claude-opus-5"}

curl -s -X PUT http://127.0.0.1:8100/config/ia -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"api_key":"chave-errada"}'
# Esperado: 400 com a mensagem sobre "sk-ant-"

curl -s http://127.0.0.1:8100/config/ia
# Esperado: 401 — a rota é admin_atual
```

⚠️ Se o uvicorn não subir com erro de `pydantic_settings`, o Passo 2 não foi
feito. Derrube o uvicorn no fim.

- [ ] **Passo 6: Rodar a suíte e commitar**

```bash
cd backend && ./.venv/bin/pytest -q
git add backend/requirements.txt backend/app/config.py backend/app/ia/ backend/app/routers/configuracao.py
git commit -m "feat(6): o cliente da API da Claude e a chave pela tela

A chave mora em integration_secrets como as do Resend e do Meta, e a leitura
nunca devolve o valor. Declarada em Settings mesmo sem uso direto: sem isso,
uma ANTHROPIC_API_KEY no .env derruba o boot inteiro."
```

---

### Task 3: As seis ferramentas

**Arquivos:**
- Criar: `backend/app/ia/ferramentas.py`
- Criar: `backend/tests/test_ia_ferramentas.py`

**Interfaces:**
- Consome: `app.database.sessao`.
- Produz, para a Task 4:
  - `ESQUEMAS: list[dict]` — as definições de ferramenta para a API, com
    `strict: True`
  - `async def executar(conn, nome: str, argumentos: dict) -> dict` — despacha
    pelo nome; levanta `FerramentaDesconhecida` ou `ArgumentoRecusado`
  - `class FerramentaDesconhecida(ValueError)`, `class ArgumentoRecusado(ValueError)`
  - `DIMENSOES: dict[str, str]`, `FILTROS: dict[str, str]`, `LIMITE_MAXIMO = 50`

Esta é a tarefa que carrega a promessa do lote: **o modelo não alcança o que não
deve**. Tudo o mais depende dela estar certa.

⚠️ **Nenhum valor vindo do modelo entra numa string de SQL.** Nomes de campo são
**chaves numa allowlist** que mapeiam para fragmentos fixos; valores vão sempre
como parâmetro `$n` do asyncpg. Se você se pegar concatenando algo que veio do
argumento, parou de implementar este plano.

- [ ] **Passo 1: Escrever os testes que falham**

Criar `backend/tests/test_ia_ferramentas.py`:

```python
"""As ferramentas do analista de IA.

⚠️ O ponto destes testes não é que os números estejam certos — é que o MODELO
não alcance o que não deve. A função que estas ferramentas substituem executava
SQL escrito pelo modelo como superusuário (ver migration 016).

Usa a fixture `conexao`, que reverte tudo.
"""

import pytest

from app.ia import ferramentas


async def _lead(conexao, **kw):
    """⚠️ O MARCADOR DOS TESTES É `tipo`, NÃO `etiqueta`.

    `leads` tem um gatilho BEFORE INSERT, `trg_score_lead_on_change`, cuja
    função faz `NEW.etiqueta := v_etiqueta` — ela RECALCULA a etiqueta a partir
    de cargo/faturamento/funcionários e sobrescreve o que você mandou. Usar
    `etiqueta` como marcador de teste faz a linha nascer com NULL ali e o teste
    falhar apontando para a ferramenta, que está certa.

    `tipo` é NOT NULL, texto livre, e o gatilho não encosta nele.
    """
    base = dict(nome="Teste 6", email=None, tipo="teste-6",
                cargo=None, utm_source=None, created_at=None)
    base.update(kw)
    return await conexao.fetchval(
        """INSERT INTO leads (nome, email, tipo, cargo, utm_source, created_at)
           VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()))
           RETURNING id""",
        base["nome"], base["email"], base["tipo"], base["cargo"],
        base["utm_source"], base["created_at"])


# ── A allowlist ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_dimensao_fora_da_allowlist_e_recusada(conexao):
    """Se o nome da dimensão virasse SQL, isto leria qualquer coluna."""
    with pytest.raises(ferramentas.ArgumentoRecusado, match="dimensão"):
        await ferramentas.executar(
            conexao, "distribuir_contatos", {"dimensao": "email"})


@pytest.mark.asyncio
async def test_dimensao_com_injecao_e_recusada(conexao):
    with pytest.raises(ferramentas.ArgumentoRecusado):
        await ferramentas.executar(
            conexao, "distribuir_contatos",
            {"dimensao": "etiqueta) UNION SELECT value FROM integration_secrets --"})


@pytest.mark.asyncio
async def test_filtro_fora_da_allowlist_e_recusado(conexao):
    with pytest.raises(ferramentas.ArgumentoRecusado, match="filtro"):
        await ferramentas.executar(
            conexao, "contar_contatos", {"filtros": {"deleted_by": "x"}})


@pytest.mark.asyncio
async def test_ferramenta_desconhecida_e_recusada(conexao):
    with pytest.raises(ferramentas.FerramentaDesconhecida):
        await ferramentas.executar(conexao, "executar_sql", {"q": "select 1"})


# ── O limite ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_listar_contatos_respeita_o_teto(conexao):
    """Sem teto, uma pergunta inocente joga a base inteira no contexto do
    modelo — e no histórico do chat, que fica gravado."""
    for i in range(5):
        await _lead(conexao, nome=f"Teto {i}", tipo="teto-6")
    r = await ferramentas.executar(
        conexao, "listar_contatos",
        {"filtros": {"tipo": "teto-6"}, "limite": 999})
    assert len(r["contatos"]) <= ferramentas.LIMITE_MAXIMO
    assert r["limite_aplicado"] == ferramentas.LIMITE_MAXIMO


@pytest.mark.asyncio
async def test_listar_contatos_nao_devolve_dado_sensivel(conexao):
    """A amostra é para o modelo raciocinar, não para exportar a base."""
    await _lead(conexao, nome="Sensível", email="sensivel-6@exemplo.invalid",
                tipo="sens-6")
    r = await ferramentas.executar(
        conexao, "listar_contatos", {"filtros": {"tipo": "sens-6"}})
    assert r["contatos"], "o contato de teste não voltou"
    for c in r["contatos"]:
        assert "email" not in c
        assert "whatsapp" not in c
        assert "phone_normalized" not in c


# ── Os números ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_contar_contatos_bate_com_o_sql(conexao):
    """O critério de pronto da spec: os números batem com conferência manual."""
    for i in range(3):
        await _lead(conexao, tipo="conta-6")
    esperado = await conexao.fetchval(
        "SELECT count(*) FROM leads WHERE tipo = 'conta-6' AND deleted_at IS NULL")
    r = await ferramentas.executar(
        conexao, "contar_contatos", {"filtros": {"tipo": "conta-6"}})
    assert r["total"] == esperado == 3


@pytest.mark.asyncio
async def test_contagem_ignora_contato_excluido(conexao):
    """O soft delete do lote 1C. Contar excluído infla todo painel."""
    await _lead(conexao, tipo="morto-6")
    morto = await _lead(conexao, tipo="morto-6")
    await conexao.execute("UPDATE leads SET deleted_at = now() WHERE id = $1", morto)
    r = await ferramentas.executar(
        conexao, "contar_contatos", {"filtros": {"tipo": "morto-6"}})
    assert r["total"] == 1


@pytest.mark.asyncio
async def test_distribuir_contatos_agrupa_certo(conexao):
    await _lead(conexao, tipo="dist-6", cargo="Gerente")
    await _lead(conexao, tipo="dist-6", cargo="Gerente")
    await _lead(conexao, tipo="dist-6", cargo="Analista")
    r = await ferramentas.executar(
        conexao, "distribuir_contatos",
        {"dimensao": "cargo", "filtros": {"tipo": "dist-6"}})
    linhas = {l["valor"]: l["total"] for l in r["distribuicao"]}
    assert linhas["Gerente"] == 2
    assert linhas["Analista"] == 1


@pytest.mark.asyncio
async def test_filtro_de_periodo_recorta(conexao):
    await _lead(conexao, tipo="per-6", created_at="2020-01-15")
    await _lead(conexao, tipo="per-6")
    r = await ferramentas.executar(
        conexao, "contar_contatos",
        {"filtros": {"tipo": "per-6", "desde": "2020-01-01", "ate": "2020-01-31"}})
    assert r["total"] == 1


@pytest.mark.asyncio
async def test_data_invalida_e_recusada_e_nao_vira_sql(conexao):
    with pytest.raises(ferramentas.ArgumentoRecusado, match="data"):
        await ferramentas.executar(
            conexao, "contar_contatos", {"filtros": {"desde": "ontem'; DROP"}})


# ── Os esquemas ──────────────────────────────────────────────────────────────

def test_todo_esquema_e_estrito_e_fechado():
    """`strict` + `additionalProperties: false` é o que garante que o argumento
    que chega é o argumento que o schema descreve."""
    assert ferramentas.ESQUEMAS, "nenhuma ferramenta declarada"
    for e in ferramentas.ESQUEMAS:
        assert e["strict"] is True, e["name"]
        assert e["input_schema"]["additionalProperties"] is False, e["name"]
        assert e["description"].strip(), e["name"]


def test_todo_esquema_tem_executor():
    for e in ferramentas.ESQUEMAS:
        assert e["name"] in ferramentas.EXECUTORES, e["name"]
```

- [ ] **Passo 2: Rodar e conferir que falha**

```bash
cd backend && ./.venv/bin/pytest tests/test_ia_ferramentas.py -q
```

Esperado: erro de coleta — `ModuleNotFoundError: No module named 'app.ia.ferramentas'`.

- [ ] **Passo 3: Escrever as ferramentas**

Criar `backend/app/ia/ferramentas.py`:

```python
"""As ferramentas que o analista de IA pode chamar.

⚠️ O DESENHO INTEIRO existe por um motivo: o analista de origem fazia o MODELO
ESCREVER SQL, e uma RPC `SECURITY DEFINER` de dono superusuário executava
(migration 016). A defesa era lista negra de palavras, que não bloqueia
`SELECT value FROM integration_secrets`.

A regra que substitui a lista negra:

  **Nenhum valor vindo do modelo entra numa string de SQL.**

Nome de campo é CHAVE numa allowlist que mapeia para um fragmento fixo, escrito
aqui. Valor vai sempre como parâmetro `$n` do asyncpg. Se você precisar
concatenar algo que veio do argumento, o desenho está errado — não o contorne.

⚠️ E as ferramentas rodam pela conexão que quem chama abriu, que é a `sessao()`
com o papel do admin que perguntou — nunca `service_role`. O RLS continua
valendo como segunda linha, que é a regra da casa.
"""

import datetime as dt
import re

# ── Allowlists ───────────────────────────────────────────────────────────────
# Chave = o nome que o modelo usa. Valor = o SQL, escrito aqui, nunca vindo dele.

DIMENSOES: dict[str, str] = {
    "etiqueta": "l.etiqueta",
    "tipo": "l.tipo",
    "status": "l.status",
    "cargo": "l.cargo",
    "faturamento": "l.faturamento",
    "funcionarios": "l.funcionarios",
    "origem": "l.utm_source",
    "midia": "l.utm_medium",
    "campanha": "l.utm_campaign",
    "conteudo": "l.utm_content",
    "canal": "l.source",
    "presenca": "l.presenca",
    # O DDD é o mais perto de "região" que a base tem: não existe coluna de
    # estado nem de cidade em `leads` (conferido em 03/09/2026).
    "ddd": "substring(l.phone_normalized from 3 for 2)",
}

FILTROS: dict[str, str] = {
    "etiqueta": "l.etiqueta = {p}",
    "tipo": "l.tipo = {p}",
    "status": "l.status = {p}",
    "cargo": "l.cargo = {p}",
    "faturamento": "l.faturamento = {p}",
    "funcionarios": "l.funcionarios = {p}",
    "origem": "l.utm_source = {p}",
    "midia": "l.utm_medium = {p}",
    "campanha": "l.utm_campaign = {p}",
    "canal": "l.source = {p}",
    "ddd": "substring(l.phone_normalized from 3 for 2) = {p}",
    "tem_email": "(l.email IS NOT NULL) = {p}",
    "tem_desafio": "(l.desafios IS NOT NULL AND l.desafios <> '') = {p}",
    "desde": "l.created_at >= {p}::date",
    "ate": "l.created_at < ({p}::date + 1)",
}

# Os filtros cujo valor é data e por isso passa pela conferência de formato.
FILTROS_DE_DATA = {"desde", "ate"}
# Os filtros cujo valor é booleano.
FILTROS_BOOLEANOS = {"tem_email", "tem_desafio"}

GRANULARIDADES: dict[str, str] = {
    "dia": "day",
    "semana": "week",
    "mes": "month",
}

# 50: o suficiente para o modelo raciocinar sobre exemplos, longe do suficiente
# para exportar a base. ⚠️ O resultado da ferramenta entra no contexto do modelo
# E fica gravado em `ai_chat_messages` — um teto alto aqui é vazamento com
# retenção.
LIMITE_MAXIMO = 50

# 365 dias: recorte máximo de uma série temporal, para uma pergunta ingênua não
# devolver mil pontos que ninguém lê e que enchem o contexto.
PONTOS_MAXIMOS = 365


class FerramentaDesconhecida(ValueError):
    """O modelo pediu uma ferramenta que não existe."""


class ArgumentoRecusado(ValueError):
    """O modelo mandou um campo ou valor fora da allowlist."""


# ── Montagem segura ──────────────────────────────────────────────────────────

_DATA = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _conferir_data(valor: object, campo: str) -> str:
    if not isinstance(valor, str) or not _DATA.match(valor):
        raise ArgumentoRecusado(
            f"O filtro '{campo}' espera uma data no formato AAAA-MM-DD.")
    try:
        dt.date.fromisoformat(valor)
    except ValueError:
        raise ArgumentoRecusado(
            f"O filtro '{campo}' recebeu uma data que não existe: {valor!r}.")
    return valor


def _onde(filtros: dict | None) -> tuple[str, list]:
    """Devolve (fragmento SQL, parâmetros).

    ⚠️ O fragmento é montado SÓ de strings deste arquivo. Os valores saem em
    `parametros` e viram `$1`, `$2`… no asyncpg.
    """
    # O soft delete do lote 1C não é opcional: contar excluído infla o painel.
    partes = ["l.deleted_at IS NULL"]
    parametros: list = []

    for campo, valor in (filtros or {}).items():
        molde = FILTROS.get(campo)
        if molde is None:
            raise ArgumentoRecusado(
                f"Não existe o filtro '{campo}'. "
                f"Os que existem: {', '.join(sorted(FILTROS))}.")
        if campo in FILTROS_DE_DATA:
            valor = _conferir_data(valor, campo)
        elif campo in FILTROS_BOOLEANOS:
            if not isinstance(valor, bool):
                raise ArgumentoRecusado(
                    f"O filtro '{campo}' espera verdadeiro ou falso.")
        elif not isinstance(valor, str):
            raise ArgumentoRecusado(f"O filtro '{campo}' espera texto.")

        parametros.append(valor)
        partes.append(molde.format(p=f"${len(parametros)}"))

    return " AND ".join(partes), parametros


def _dimensao(nome: object) -> str:
    if not isinstance(nome, str) or nome not in DIMENSOES:
        raise ArgumentoRecusado(
            f"Não existe a dimensão {nome!r}. "
            f"As que existem: {', '.join(sorted(DIMENSOES))}.")
    return DIMENSOES[nome]


# ── As ferramentas ───────────────────────────────────────────────────────────

async def contar_contatos(conn, filtros: dict | None = None) -> dict:
    onde, parametros = _onde(filtros)
    total = await conn.fetchval(
        f"SELECT count(*) FROM leads l WHERE {onde}", *parametros)
    return {"total": total, "filtros_aplicados": filtros or {}}


async def distribuir_contatos(conn, dimensao: str,
                              filtros: dict | None = None) -> dict:
    coluna = _dimensao(dimensao)
    onde, parametros = _onde(filtros)
    linhas = await conn.fetch(
        f"""SELECT COALESCE({coluna}::text, '(sem valor)') AS valor,
                   count(*) AS total
              FROM leads l
             WHERE {onde}
             GROUP BY 1
             ORDER BY 2 DESC, 1
             LIMIT 30""", *parametros)
    total = sum(l["total"] for l in linhas)
    return {
        "dimensao": dimensao,
        "distribuicao": [
            {"valor": l["valor"], "total": l["total"],
             "percentual": round(100 * l["total"] / total, 1) if total else 0.0}
            for l in linhas
        ],
    }


async def serie_temporal(conn, granularidade: str = "dia",
                         filtros: dict | None = None) -> dict:
    unidade = GRANULARIDADES.get(granularidade)
    if unidade is None:
        raise ArgumentoRecusado(
            f"Granularidade {granularidade!r} não existe. "
            f"As que existem: {', '.join(sorted(GRANULARIDADES))}.")
    onde, parametros = _onde(filtros)
    linhas = await conn.fetch(
        f"""SELECT date_trunc('{unidade}', l.created_at)::date AS periodo,
                   count(*) AS total
              FROM leads l
             WHERE {onde}
             GROUP BY 1
             ORDER BY 1
             LIMIT {PONTOS_MAXIMOS}""", *parametros)
    return {
        "granularidade": granularidade,
        "pontos": [{"periodo": l["periodo"].isoformat(), "total": l["total"]}
                   for l in linhas],
    }


async def listar_contatos(conn, filtros: dict | None = None,
                          limite: int = 20) -> dict:
    """Uma AMOSTRA, nunca a base.

    ⚠️ Sem e-mail, sem telefone. O resultado desta ferramenta entra no contexto
    do modelo e fica gravado em `ai_chat_messages` — dado de contato aqui é
    vazamento com retenção. O modelo não precisa do e-mail para raciocinar sobre
    perfil.
    """
    if not isinstance(limite, int) or limite < 1:
        raise ArgumentoRecusado("O limite tem de ser um inteiro positivo.")
    limite = min(limite, LIMITE_MAXIMO)
    onde, parametros = _onde(filtros)
    linhas = await conn.fetch(
        f"""SELECT l.nome, l.empresa, l.cargo, l.faturamento, l.funcionarios,
                   l.etiqueta, l.status, l.lead_score, l.utm_source,
                   l.desafios, l.created_at::date AS entrou_em
              FROM leads l
             WHERE {onde}
             ORDER BY l.created_at DESC
             LIMIT {limite}""", *parametros)
    return {
        "contatos": [dict(l) | {"entrou_em": l["entrou_em"].isoformat()}
                     for l in linhas],
        "limite_aplicado": limite,
    }


async def desempenho_de_campanhas(conn, filtros: dict | None = None) -> dict:
    """Envios, aberturas e cliques por campanha.

    ⚠️ Não passa por `_onde`: os filtros de `leads` não se aplicam a campanha.
    Aceita só `desde`/`ate`, conferidos como data.
    """
    parametros: list = []
    partes: list[str] = []
    for campo in ("desde", "ate"):
        valor = (filtros or {}).get(campo)
        if valor is None:
            continue
        _conferir_data(valor, campo)
        parametros.append(valor)
        molde = ("c.created_at >= ${}::date" if campo == "desde"
                 else "c.created_at < (${}::date + 1)")
        partes.append(molde.format(len(parametros)))
    for campo in (filtros or {}):
        if campo not in ("desde", "ate"):
            raise ArgumentoRecusado(
                f"O filtro '{campo}' não vale para campanhas. "
                "Aqui só existem 'desde' e 'ate'.")
    onde = " AND ".join(partes) if partes else "TRUE"

    linhas = await conn.fetch(
        f"""SELECT c.name AS campanha, c.status,
                   count(s.id) AS enviados,
                   count(s.opened_at) AS aberturas,
                   count(s.clicked_at) AS cliques
              FROM campaigns c
              LEFT JOIN campaign_sends s
                     ON s.campaign_id = c.id AND s.status = 'sent'
             WHERE {onde}
             GROUP BY c.id, c.name, c.status
             ORDER BY count(s.id) DESC
             LIMIT 30""", *parametros)
    return {"campanhas": [dict(l) for l in linhas]}


async def desafios_frequentes(conn, filtros: dict | None = None,
                              limite: int = 30) -> dict:
    """Os desafios escritos pelos contatos, para o modelo achar os temas.

    ⚠️ Devolve o texto do desafio, não o autor. O tema é o que interessa.
    """
    if not isinstance(limite, int) or limite < 1:
        raise ArgumentoRecusado("O limite tem de ser um inteiro positivo.")
    limite = min(limite, LIMITE_MAXIMO)
    filtros = dict(filtros or {})
    filtros["tem_desafio"] = True
    onde, parametros = _onde(filtros)
    linhas = await conn.fetch(
        f"""SELECT l.desafios, l.cargo, l.faturamento
              FROM leads l
             WHERE {onde}
             ORDER BY l.created_at DESC
             LIMIT {limite}""", *parametros)
    return {"desafios": [dict(l) for l in linhas], "limite_aplicado": limite}


EXECUTORES = {
    "contar_contatos": contar_contatos,
    "distribuir_contatos": distribuir_contatos,
    "serie_temporal": serie_temporal,
    "listar_contatos": listar_contatos,
    "desempenho_de_campanhas": desempenho_de_campanhas,
    "desafios_frequentes": desafios_frequentes,
}


async def executar(conn, nome: str, argumentos: dict) -> dict:
    """Despacha pelo nome. Levanta se o nome não existir."""
    funcao = EXECUTORES.get(nome)
    if funcao is None:
        raise FerramentaDesconhecida(
            f"Não existe a ferramenta {nome!r}. "
            f"As que existem: {', '.join(sorted(EXECUTORES))}.")
    return await funcao(conn, **(argumentos or {}))


# ── Os esquemas que vão para a API ───────────────────────────────────────────
# ⚠️ `strict: True` + `additionalProperties: False` é o que garante que o
# argumento que chega é o argumento que o schema descreve.

_FILTROS_SCHEMA = {
    "type": "object",
    "description": ("Recortes. Campos aceitos: "
                    + ", ".join(sorted(FILTROS))
                    + ". 'desde' e 'ate' são datas AAAA-MM-DD."),
    "properties": {
        **{c: {"type": "string"} for c in sorted(set(FILTROS) - FILTROS_BOOLEANOS)},
        **{c: {"type": "boolean"} for c in sorted(FILTROS_BOOLEANOS)},
    },
    "required": [],
    "additionalProperties": False,
}

ESQUEMAS: list[dict] = [
    {
        "name": "contar_contatos",
        "description": "Quantos contatos existem, com filtros opcionais.",
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {"filtros": _FILTROS_SCHEMA},
            "required": [],
            "additionalProperties": False,
        },
    },
    {
        "name": "distribuir_contatos",
        "description": ("Contagem agrupada por uma dimensão. Dimensões: "
                        + ", ".join(sorted(DIMENSOES)) + "."),
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {
                "dimensao": {"type": "string", "enum": sorted(DIMENSOES)},
                "filtros": _FILTROS_SCHEMA,
            },
            "required": ["dimensao"],
            "additionalProperties": False,
        },
    },
    {
        "name": "serie_temporal",
        "description": "Volume de contatos ao longo do tempo.",
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {
                "granularidade": {"type": "string", "enum": sorted(GRANULARIDADES)},
                "filtros": _FILTROS_SCHEMA,
            },
            "required": [],
            "additionalProperties": False,
        },
    },
    {
        "name": "listar_contatos",
        "description": (f"Uma amostra de até {LIMITE_MAXIMO} contatos, sem "
                        "e-mail nem telefone. Para examinar exemplos, não para "
                        "exportar a base."),
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {
                "filtros": _FILTROS_SCHEMA,
                "limite": {"type": "integer", "minimum": 1,
                           "maximum": LIMITE_MAXIMO},
            },
            "required": [],
            "additionalProperties": False,
        },
    },
    {
        "name": "desempenho_de_campanhas",
        "description": "Envios, aberturas e cliques por campanha de e-mail.",
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {
                "filtros": {
                    "type": "object",
                    "description": "Só 'desde' e 'ate', datas AAAA-MM-DD.",
                    "properties": {"desde": {"type": "string"},
                                   "ate": {"type": "string"}},
                    "required": [],
                    "additionalProperties": False,
                },
            },
            "required": [],
            "additionalProperties": False,
        },
    },
    {
        "name": "desafios_frequentes",
        "description": ("Os desafios escritos pelos contatos, para identificar "
                        "temas. Devolve o texto, não o autor."),
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {
                "filtros": _FILTROS_SCHEMA,
                "limite": {"type": "integer", "minimum": 1,
                           "maximum": LIMITE_MAXIMO},
            },
            "required": [],
            "additionalProperties": False,
        },
    },
]
```

- [ ] **Passo 4: Rodar e conferir que passam**

```bash
cd backend && ./.venv/bin/pytest tests/test_ia_ferramentas.py -q
```

Esperado: **13 passed**.

- [ ] **Passo 5: Conferir um número contra o banco de verdade**

O critério de pronto da spec é "os números batem com conferência manual no
banco". Prove com a base real, não só com o teste:

```bash
cd backend && ./.venv/bin/python -c "
import asyncio, app.database as db
from app.ia import ferramentas

async def main():
    await db.init_db()
    async with db._pool.acquire() as c:
        await c.execute(\"SET LOCAL ROLE service_role\")
        r = await ferramentas.executar(c, 'distribuir_contatos', {'dimensao': 'tipo'})
        print('ferramenta:', {l['valor']: l['total'] for l in r['distribuicao']})
        sql = await c.fetch('SELECT tipo, count(*) FROM leads WHERE deleted_at IS NULL GROUP BY 1')
        print('sql direto:', {r['tipo']: r['count'] for r in sql})
    await db.close_db()

asyncio.run(main())"
```

Esperado: as duas linhas idênticas. Hoje, `{'datacore': 2080, 'csv_import': 3}`.

- [ ] **Passo 6: Rodar a suíte e commitar**

```bash
cd backend && ./.venv/bin/pytest -q
git add backend/app/ia/ferramentas.py backend/tests/test_ia_ferramentas.py
git commit -m "feat(6): seis ferramentas nomeadas no lugar do SQL do modelo

Nome de campo é chave numa allowlist que mapeia para SQL escrito no arquivo;
valor vai sempre como parâmetro do asyncpg. Nada que vem do modelo entra numa
string de SQL.

listar_contatos não devolve e-mail nem telefone e tem teto de 50: o resultado
entra no contexto do modelo E fica gravado em ai_chat_messages."
```

---

### Task 4: O laço, e o chat

**Arquivos:**
- Criar: `backend/app/ia/analista.py`
- Criar: `backend/app/routers/ia.py`
- Modificar: `backend/app/main.py`
- Criar: `backend/tests/test_ia_analista.py`

**Interfaces:**
- Consome: `app.ia.cliente.{exigir_cliente, MODELO, IANaoConfigurada}`,
  `app.ia.ferramentas.{ESQUEMAS, executar, FerramentaDesconhecida, ArgumentoRecusado}`.
- Produz:
  - `SISTEMA: str` — o prompt de sistema
  - `MAX_VOLTAS = 8`
  - `async def responder(cliente, conn, mensagens: list[dict]) -> dict` →
    `{"texto": str, "ferramentas_usadas": list[str], "voltas": int}`
  - `GET /ia/conversas`, `POST /ia/conversas`, `GET /ia/conversas/{id}`,
    `DELETE /ia/conversas/{id}`, `POST /ia/conversas/{id}/mensagens`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `backend/tests/test_ia_analista.py`:

```python
"""O laço de ferramentas do analista.

⚠️ NENHUM teste aqui faz rede. O cliente da Anthropic é substituído por um
dublê que devolve respostas roteirizadas — o que se prova é o LAÇO: que ele
executa a ferramenta pedida, devolve o resultado ao modelo, e para.
"""

import pytest

from app.ia import analista


class _Bloco:
    def __init__(self, **kw):
        self.__dict__.update(kw)


class _Resposta:
    def __init__(self, content, stop_reason):
        self.content = content
        self.stop_reason = stop_reason


class _MensagensFalsas:
    """Devolve, em ordem, as respostas roteirizadas."""

    def __init__(self, roteiro):
        self.roteiro = list(roteiro)
        self.chamadas = []

    async def create(self, **kw):
        self.chamadas.append(kw)
        return self.roteiro.pop(0)


class _ClienteFalso:
    def __init__(self, roteiro):
        self.messages = _MensagensFalsas(roteiro)


def _texto(t):
    return _Resposta([_Bloco(type="text", text=t)], "end_turn")


def _usa_ferramenta(nome, argumentos, id_="tu_1"):
    return _Resposta(
        [_Bloco(type="tool_use", id=id_, name=nome, input=argumentos)],
        "tool_use")


@pytest.mark.asyncio
async def test_o_laco_executa_a_ferramenta_e_devolve_o_texto(conexao):
    cliente = _ClienteFalso([
        _usa_ferramenta("contar_contatos", {"filtros": {"tipo": "datacore"}}),
        _texto("São 2.080 contatos vindos do ERP."),
    ])
    r = await analista.responder(
        cliente, conexao, [{"role": "user", "content": "quantos vieram do ERP?"}])
    assert r["texto"] == "São 2.080 contatos vindos do ERP."
    assert r["ferramentas_usadas"] == ["contar_contatos"]
    assert r["voltas"] == 2


@pytest.mark.asyncio
async def test_ferramenta_recusada_volta_como_erro_e_nao_derruba(conexao):
    """O modelo tem de poder se corrigir. Levantar aqui viraria 500 na tela
    porque o modelo pediu uma dimensão que não existe — que é falha dele, não
    do sistema."""
    cliente = _ClienteFalso([
        _usa_ferramenta("distribuir_contatos", {"dimensao": "email"}),
        _texto("Não consigo agrupar por e-mail; posso agrupar por cargo."),
    ])
    r = await analista.responder(
        cliente, conexao, [{"role": "user", "content": "agrupe por email"}])
    assert "cargo" in r["texto"]

    # O resultado devolvido ao modelo tem de estar marcado como erro.
    ultima = cliente.messages.chamadas[-1]
    resultado = ultima["messages"][-1]["content"][0]
    assert resultado["type"] == "tool_result"
    assert resultado["is_error"] is True
    assert "dimensão" in resultado["content"]


@pytest.mark.asyncio
async def test_o_laco_tem_teto_de_voltas(conexao):
    """Um modelo que só chama ferramenta para sempre não pode rodar para sempre
    contra o banco."""
    cliente = _ClienteFalso(
        [_usa_ferramenta("contar_contatos", {}, id_=f"tu_{i}")
         for i in range(analista.MAX_VOLTAS + 2)])
    r = await analista.responder(
        cliente, conexao, [{"role": "user", "content": "conte"}])
    assert r["voltas"] == analista.MAX_VOLTAS
    assert "não consegui" in r["texto"].lower()


@pytest.mark.asyncio
async def test_ferramentas_vao_em_toda_chamada(conexao):
    """Mandar as ferramentas só na primeira chamada faz o modelo 'esquecer' que
    pode chamá-las — e ele passa a responder de cabeça."""
    cliente = _ClienteFalso([
        _usa_ferramenta("contar_contatos", {}),
        _texto("pronto"),
    ])
    await analista.responder(cliente, conexao,
                             [{"role": "user", "content": "conte"}])
    for chamada in cliente.messages.chamadas:
        assert chamada["tools"], "chamada sem ferramentas"


@pytest.mark.asyncio
async def test_o_sistema_proibe_inventar_numero(conexao):
    """Regra de negócio no prompt, conferida como qualquer outra."""
    assert "não invente" in analista.SISTEMA.lower()
    assert "ferramenta" in analista.SISTEMA.lower()
```

- [ ] **Passo 2: Rodar e conferir que falha**

```bash
cd backend && ./.venv/bin/pytest tests/test_ia_analista.py -q
```

Esperado: `ModuleNotFoundError: No module named 'app.ia.analista'`.

- [ ] **Passo 3: Escrever o laço**

Criar `backend/app/ia/analista.py`:

```python
"""O laço de ferramentas do analista de dados.

⚠️ Laço MANUAL, não `client.beta.messages.tool_runner`. Três razões, e a
terceira é a que decide:

  1. O runner é beta, e este sistema está sendo reconstruído para durar.
  2. As ferramentas precisam da conexão da `sessao()` do admin que perguntou; o
     runner não expõe onde injetar isso.
  3. Precisamos de TETO de voltas. Um modelo que só chama ferramenta não pode
     rodar para sempre contra o banco.

Não há ferramenta de servidor aqui, então `pause_turn` não acontece — só
`tool_use` e `end_turn`.
"""

import logging

from app.ia import ferramentas
from app.ia.cliente import MODELO

logger = logging.getLogger(__name__)

# 8: fundo o bastante para uma pergunta que precise cruzar três recortes, raso o
# bastante para um modelo em laço não varrer o banco.
MAX_VOLTAS = 8

MAX_TOKENS = 16000

SISTEMA = """\
Você é o analista de dados do MarketingHS, a plataforma de marketing da Health \
& Safety. Responde em português do Brasil, direto, sem enrolação.

Você NÃO tem acesso ao banco de dados. Você tem ferramentas. Para saber \
qualquer número, chame a ferramenta — mesmo que você ache que sabe a resposta.

⚠️ NÃO INVENTE NÚMERO. Se uma ferramenta não devolveu o dado, diga que não \
tem o dado. Um número inventado num painel de marketing vira decisão errada de \
campanha, e ninguém descobre que veio de você.

Se a pergunta for ambígua, chame a ferramenta com o recorte mais provável e \
diga qual recorte você usou. Se uma ferramenta recusar um argumento, leia a \
mensagem: ela lista o que existe.

Ao citar números, diga o recorte junto ("2.080 contatos do tipo datacore"), \
nunca o número sozinho.\
"""


async def responder(cliente, conn, mensagens: list[dict]) -> dict:
    """Conversa com o modelo até ele parar de pedir ferramenta.

    `mensagens` é o histórico no formato da API. Devolve o texto final, quais
    ferramentas foram usadas, e quantas voltas levou.
    """
    historico = list(mensagens)
    usadas: list[str] = []

    for volta in range(1, MAX_VOLTAS + 1):
        resposta = await cliente.messages.create(
            model=MODELO,
            max_tokens=MAX_TOKENS,
            system=SISTEMA,
            # ⚠️ As ferramentas vão em TODA chamada. Mandá-las só na primeira
            # faz o modelo parar de considerá-las e voltar a responder de
            # cabeça — que é o defeito que este lote existe para consertar.
            tools=ferramentas.ESQUEMAS,
            messages=historico,
        )

        blocos_de_ferramenta = [b for b in resposta.content if b.type == "tool_use"]

        if not blocos_de_ferramenta:
            texto = next((b.text for b in resposta.content if b.type == "text"), "")
            return {"texto": texto, "ferramentas_usadas": usadas, "voltas": volta}

        historico.append({"role": "assistant", "content": resposta.content})

        resultados = []
        for bloco in blocos_de_ferramenta:
            usadas.append(bloco.name)
            try:
                saida = await ferramentas.executar(conn, bloco.name, bloco.input)
                conteudo, erro = _json(saida), False
            except (ferramentas.FerramentaDesconhecida,
                    ferramentas.ArgumentoRecusado) as e:
                # ⚠️ Volta como resultado de erro, NÃO como exceção. O modelo
                # pediu algo que não existe — falha dele, e ele consegue se
                # corrigir se a mensagem chegar. Levantar aqui viraria 500 na
                # tela por causa de um argumento errado do modelo.
                conteudo, erro = str(e), True
                logger.info("ferramenta recusada: %s(%s) — %s",
                            bloco.name, bloco.input, e)
            resultados.append({
                "type": "tool_result",
                "tool_use_id": bloco.id,
                "content": conteudo,
                "is_error": erro,
            })

        # ⚠️ TODOS os resultados numa mensagem só. Espalhar em várias ensina o
        # modelo a parar de pedir ferramentas em paralelo.
        historico.append({"role": "user", "content": resultados})

    logger.warning("analista bateu o teto de %s voltas", MAX_VOLTAS)
    return {
        "texto": ("Não consegui chegar a uma resposta: a consulta ficou "
                  "girando. Tente uma pergunta mais específica."),
        "ferramentas_usadas": usadas,
        "voltas": MAX_VOLTAS,
    }


def _json(valor) -> str:
    import json
    return json.dumps(valor, ensure_ascii=False, default=str)
```

- [ ] **Passo 4: Escrever o router do chat**

Criar `backend/app/routers/ia.py`:

```python
"""As rotas de IA. Substituem `ai-data-analyst`, `analyze-leads` e
`analyze-challenges`.

⚠️ Todas exigem `usuario_atual` — e as ferramentas rodam pela MESMA `sessao()`
do request, com o papel de quem perguntou. Nunca `service_role`: o analista lê
dado a pedido de uma pessoa, e isso é request de usuário.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, usuario_atual
from app.ia import analista
from app.ia.cliente import IANaoConfigurada, exigir_cliente

router = APIRouter(prefix="/ia", tags=["ia"])


class MensagemIn(BaseModel):
    conteudo: str = Field(min_length=1, max_length=4000)


@router.get("/conversas")
async def listar_conversas(usuario: Usuario = Depends(usuario_atual)):
    """As conversas de QUEM PERGUNTA, não as de todo mundo."""
    async with sessao(usuario_id=usuario.id) as conn:
        linhas = await conn.fetch(
            """SELECT id::text, title, created_at, updated_at
                 FROM ai_chat_conversations
                WHERE user_id = $1::uuid
                ORDER BY updated_at DESC
                LIMIT 50""", usuario.id)
    return [dict(l) for l in linhas]


@router.post("/conversas", status_code=status.HTTP_201_CREATED)
async def criar_conversa(usuario: Usuario = Depends(usuario_atual)):
    async with sessao(usuario_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            """INSERT INTO ai_chat_conversations (user_id)
               VALUES ($1::uuid)
               RETURNING id::text, title, created_at, updated_at""", usuario.id)
    return dict(linha)


@router.get("/conversas/{conversa_id}")
async def ler_conversa(conversa_id: str, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(usuario_id=usuario.id) as conn:
        dona = await conn.fetchval(
            "SELECT user_id::text FROM ai_chat_conversations WHERE id = $1::uuid",
            conversa_id)
        if dona is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversa não encontrada.")
        if dona != usuario.id:
            # ⚠️ 404, não 403: dizer "existe mas não é sua" já entrega que a
            # conversa existe. A rota autoriza sozinha, sem depender do RLS.
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversa não encontrada.")
        mensagens = await conn.fetch(
            """SELECT role, content, created_at
                 FROM ai_chat_messages
                WHERE conversation_id = $1::uuid
                ORDER BY created_at""", conversa_id)
    return {"id": conversa_id, "mensagens": [dict(m) for m in mensagens]}


@router.delete("/conversas/{conversa_id}", status_code=status.HTTP_204_NO_CONTENT)
async def apagar_conversa(conversa_id: str, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(usuario_id=usuario.id) as conn:
        apagadas = await conn.execute(
            "DELETE FROM ai_chat_conversations WHERE id = $1::uuid AND user_id = $2::uuid",
            conversa_id, usuario.id)
    if apagadas == "DELETE 0":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversa não encontrada.")


@router.post("/conversas/{conversa_id}/mensagens")
async def enviar_mensagem(conversa_id: str, dados: MensagemIn,
                          usuario: Usuario = Depends(usuario_atual)):
    """Grava a pergunta, responde com ferramentas, grava a resposta."""
    try:
        cliente = await exigir_cliente()
    except IANaoConfigurada as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))

    async with sessao(usuario_id=usuario.id) as conn:
        dona = await conn.fetchval(
            "SELECT user_id::text FROM ai_chat_conversations WHERE id = $1::uuid",
            conversa_id)
        if dona != usuario.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversa não encontrada.")

        anteriores = await conn.fetch(
            """SELECT role, content FROM ai_chat_messages
                WHERE conversation_id = $1::uuid ORDER BY created_at
                LIMIT 40""", conversa_id)
        historico = [{"role": m["role"], "content": m["content"]}
                     for m in anteriores]
        historico.append({"role": "user", "content": dados.conteudo})

        await conn.execute(
            """INSERT INTO ai_chat_messages (conversation_id, role, content)
               VALUES ($1::uuid, 'user', $2)""", conversa_id, dados.conteudo)

        try:
            resultado = await analista.responder(cliente, conn, historico)
        except Exception as e:  # noqa: BLE001
            # A pergunta já foi gravada; a resposta não veio. Melhor um 502 com
            # a pergunta salva do que perder a pergunta junto.
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                f"A IA não respondeu: {e}")

        await conn.execute(
            """INSERT INTO ai_chat_messages (conversation_id, role, content)
               VALUES ($1::uuid, 'assistant', $2)""",
            conversa_id, resultado["texto"])
        await conn.execute(
            "UPDATE ai_chat_conversations SET updated_at = now() WHERE id = $1::uuid",
            conversa_id)

    return resultado
```

⚠️ **Confira a assinatura de `sessao()`** em `backend/app/database.py` antes de
escrever. O plano assume `sessao(usuario_id=...)`; se o nome do parâmetro for
outro, use o que existe — e se `sessao()` não aceitar identificar o usuário,
**pare e me reporte**, porque isso muda quem o `auth.uid()` enxerga.

- [ ] **Passo 5: Registrar o router**

Em `backend/app/main.py`, junto dos outros `include_router`:

```python
app.include_router(ia_router)
```

com o import correspondente no topo, no mesmo estilo dos que já estão lá.

- [ ] **Passo 6: Rodar os testes**

```bash
cd backend && ./.venv/bin/pytest tests/test_ia_analista.py -q
cd backend && ./.venv/bin/pytest -q
```

Esperado: 5 passed no arquivo novo; suíte inteira verde.

- [ ] **Passo 7: Conferir que o boot não quebrou**

```bash
cd backend && ./.venv/bin/python -c "from app.main import app; print(len(app.routes), 'rotas')"
```

Esperado: um número maior que antes, sem exceção.

- [ ] **Passo 8: Commit**

```bash
git add backend/app/ia/analista.py backend/app/routers/ia.py backend/app/main.py backend/tests/test_ia_analista.py
git commit -m "feat(6): o analista responde com ferramentas, não com SQL

Laço manual em vez do tool_runner: ele é beta, as ferramentas precisam da
conexão da sessao() de quem perguntou, e é preciso teto de voltas.

Ferramenta recusada volta como tool_result de erro, não como exceção — o modelo
pediu algo que não existe e consegue se corrigir se a mensagem chegar."
```

---

### Task 5: As duas análises, com saída estruturada

**Arquivos:**
- Modificar: `backend/app/routers/ia.py`
- Criar: `backend/tests/test_ia_analises.py`

**Interfaces:**
- Consome: `app.ia.cliente.{exigir_cliente, MODELO}`, `app.ia.ferramentas`.
- Produz:
  - `POST /ia/analisar-leads` → o objeto `AIAnalysisResult` que o frontend já espera
  - `POST /ia/analisar-desafios` → `{"patterns", "copyRecommendations", "contentSuggestions", "gems", "opportunities"}`
  - `GET /ia/insights-de-desafios`, `POST /ia/insights-de-desafios` — a tabela `challenge_insights`

Estas duas são **porte fiel**: mesmo prompt, mesma forma de saída. Só o provedor
muda. A melhoria é a saída estruturada: o prompt de origem **implora** por JSON
válido (`IMPORTANTE: Retorne APENAS um JSON válido, sem markdown`) e torce. Com
`output_config.format` o formato é garantido pela API, não pedido por favor.

- [ ] **Passo 1: Escrever o teste que falha**

Criar `backend/tests/test_ia_analises.py`:

```python
"""As duas análises. Sem rede: o que se prova é o SCHEMA.

O prompt de origem pedia JSON por favor. Aqui o formato é garantido pela API —
e o schema tem de bater exatamente com o que o frontend já lê, senão a tela
quebra em silêncio.
"""

from app.routers import ia


def test_o_schema_de_leads_bate_com_o_que_a_tela_le():
    """Os nomes vêm de frontend/src/hooks/useAIAnalysis.tsx:5-22. Mudar um
    deles aqui quebra a tela sem erro de compilação."""
    props = ia.ESQUEMA_LEADS["properties"]
    assert set(props) == {
        "summary", "demographics", "patterns", "challenges",
        "recommendations", "icp",
    }
    assert set(props["demographics"]["properties"]) == {
        "cargos", "faturamentos", "funcionarios"}
    assert set(props["patterns"]["properties"]) == {
        "bestDays", "bestHours", "conversionInsights"}
    assert set(props["challenges"]["properties"]) == {
        "mainThemes", "opportunities"}
    item = props["demographics"]["properties"]["cargos"]["items"]
    assert set(item["properties"]) == {"name", "count", "percentage"}


def test_o_schema_de_desafios_bate_com_o_que_a_tela_le():
    """Os nomes vêm de ChallengesAIInsights.tsx:44-53."""
    props = ia.ESQUEMA_DESAFIOS["properties"]
    assert set(props) == {
        "patterns", "copyRecommendations", "contentSuggestions",
        "gems", "opportunities",
    }
    assert set(props["gems"]["items"]["properties"]) == {"response", "reason"}


def test_os_schemas_sao_fechados():
    """`additionalProperties: false` em todo nível de objeto — é o que faz a
    API garantir o formato em vez de o prompt pedir."""
    def conferir(no, caminho="raiz"):
        if no.get("type") == "object":
            assert no.get("additionalProperties") is False, caminho
            assert "required" in no, caminho
            for nome, filho in no.get("properties", {}).items():
                conferir(filho, f"{caminho}.{nome}")
        elif no.get("type") == "array":
            conferir(no["items"], f"{caminho}[]")

    conferir(ia.ESQUEMA_LEADS)
    conferir(ia.ESQUEMA_DESAFIOS)
```

- [ ] **Passo 2: Rodar e conferir que falha**

```bash
cd backend && ./.venv/bin/pytest tests/test_ia_analises.py -q
```

Esperado: `AttributeError: module 'app.routers.ia' has no attribute 'ESQUEMA_LEADS'`.

- [ ] **Passo 3: Escrever os esquemas e as rotas**

Acrescente ao fim de `backend/app/routers/ia.py`:

```python
# ── As duas análises ─────────────────────────────────────────────────────────
# ⚠️ Porte FIEL: mesmo prompt, mesma forma de saída. O que muda é que o formato
# passa a ser garantido pela API em vez de pedido no prompt — o original dizia
# "IMPORTANTE: Retorne APENAS um JSON válido, sem markdown" e torcia.
#
# ⚠️ Os nomes de campo são os que o frontend JÁ LÊ. Renomear um deles aqui
# quebra a tela sem erro de compilação. Ver useAIAnalysis.tsx e
# ChallengesAIInsights.tsx.

def _lista_de_texto(descricao: str) -> dict:
    return {"type": "array", "items": {"type": "string"}, "description": descricao}


_CONTAGEM = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "count": {"type": "integer"},
            "percentage": {"type": "number"},
        },
        "required": ["name", "count", "percentage"],
        "additionalProperties": False,
    },
}

ESQUEMA_LEADS = {
    "type": "object",
    "properties": {
        "summary": {"type": "string",
                    "description": "Resumo executivo de 2-3 frases."},
        "demographics": {
            "type": "object",
            "properties": {"cargos": _CONTAGEM, "faturamentos": _CONTAGEM,
                           "funcionarios": _CONTAGEM},
            "required": ["cargos", "faturamentos", "funcionarios"],
            "additionalProperties": False,
        },
        "patterns": {
            "type": "object",
            "properties": {
                "bestDays": _lista_de_texto("Dias da semana com mais conversão."),
                "bestHours": _lista_de_texto("Faixas de horário."),
                "conversionInsights": {"type": "string"},
            },
            "required": ["bestDays", "bestHours", "conversionInsights"],
            "additionalProperties": False,
        },
        "challenges": {
            "type": "object",
            "properties": {
                "mainThemes": _lista_de_texto("Temas principais dos desafios."),
                "opportunities": _lista_de_texto("Oportunidades identificadas."),
            },
            "required": ["mainThemes", "opportunities"],
            "additionalProperties": False,
        },
        "recommendations": _lista_de_texto("3 a 5 recomendações práticas."),
        "icp": {"type": "string",
                "description": "Perfil do cliente ideal, a partir dos dados."},
    },
    "required": ["summary", "demographics", "patterns", "challenges",
                 "recommendations", "icp"],
    "additionalProperties": False,
}

ESQUEMA_DESAFIOS = {
    "type": "object",
    "properties": {
        "patterns": _lista_de_texto("3 a 5 padrões nos desafios."),
        "copyRecommendations": _lista_de_texto("3 a 5 sugestões de copy."),
        "contentSuggestions": _lista_de_texto("3 a 5 ideias de conteúdo."),
        "gems": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "response": {"type": "string",
                                 "description": "Trecho da resposta destacada."},
                    "reason": {"type": "string",
                               "description": "Por que essa resposta é valiosa."},
                },
                "required": ["response", "reason"],
                "additionalProperties": False,
            },
            "description": "2 a 3 respostas excepcionais.",
        },
        "opportunities": _lista_de_texto("3 a 5 oportunidades de produto."),
    },
    "required": ["patterns", "copyRecommendations", "contentSuggestions",
                 "gems", "opportunities"],
    "additionalProperties": False,
}

SISTEMA_LEADS = """\
Você é um analista de marketing especializado em análise de leads B2B da Health \
& Safety. Responda sempre em português do Brasil. Seja específico e prático: \
recomendação que serve para qualquer empresa não serve para nenhuma.\
"""

SISTEMA_DESAFIOS = """\
Você é um analista de marketing especializado em leads B2B. Analise os desafios \
relatados pelos contatos e devolva conclusões acionáveis, em português do \
Brasil. Foque em padrões que dêem para usar em campanha — não em observações \
genéricas.\
"""


async def _analisar(sistema: str, pergunta: str, esquema: dict) -> dict:
    import json

    try:
        cliente = await exigir_cliente()
    except IANaoConfigurada as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))

    from app.ia.cliente import MODELO
    try:
        resposta = await cliente.messages.create(
            model=MODELO,
            max_tokens=16000,
            system=sistema,
            messages=[{"role": "user", "content": pergunta}],
            output_config={"format": {"type": "json_schema", "schema": esquema}},
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"A IA não respondeu: {e}")

    # ⚠️ `output_config.format` garante que o primeiro bloco de texto é JSON
    # válido conforme o schema. Sem isso, este `json.loads` seria uma aposta.
    texto = next((b.text for b in resposta.content if b.type == "text"), "")
    return json.loads(texto)


@router.post("/analisar-leads")
async def analisar_leads(usuario: Usuario = Depends(usuario_atual)):
    """Substitui `analyze-leads`.

    ⚠️ Diferente do original, a tela NÃO manda os leads no corpo. O servidor
    busca pelas mesmas ferramentas do analista — a tela mandar a base inteira
    para o servidor, que a mandava para a IA, era caminho longo e um jeito de o
    navegador vazar dado que ele nem precisava ter.
    """
    from app.ia import ferramentas

    async with sessao(usuario_id=usuario.id) as conn:
        perfil = {
            "total": (await ferramentas.contar_contatos(conn))["total"],
            "cargos": (await ferramentas.distribuir_contatos(conn, "cargo"))["distribuicao"],
            "faturamentos": (await ferramentas.distribuir_contatos(conn, "faturamento"))["distribuicao"],
            "funcionarios": (await ferramentas.distribuir_contatos(conn, "funcionarios"))["distribuicao"],
            "origens": (await ferramentas.distribuir_contatos(conn, "origem"))["distribuicao"],
            "por_dia": (await ferramentas.serie_temporal(conn, "dia"))["pontos"],
            "amostra_de_desafios": (await ferramentas.desafios_frequentes(conn))["desafios"],
        }

    import json
    pergunta = (
        "Analise o perfil abaixo da base de contatos e devolva as conclusões.\n\n"
        + json.dumps(perfil, ensure_ascii=False, default=str))
    return await _analisar(SISTEMA_LEADS, pergunta, ESQUEMA_LEADS)


@router.post("/analisar-desafios")
async def analisar_desafios(usuario: Usuario = Depends(usuario_atual)):
    """Substitui `analyze-challenges`."""
    from app.ia import ferramentas

    async with sessao(usuario_id=usuario.id) as conn:
        amostra = (await ferramentas.desafios_frequentes(conn, limite=50))["desafios"]

    if not amostra:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Nenhum contato preencheu o campo de desafio ainda — não há o que "
            "analisar.")

    linhas = "\n".join(
        f'- "{d["desafios"]}" (Cargo: {d["cargo"] or "N/A"}, '
        f'Faturamento: {d["faturamento"] or "N/A"})' for d in amostra)
    pergunta = (f"Analise os desafios relatados por {len(amostra)} contatos:\n\n"
                f"{linhas}")
    return await _analisar(SISTEMA_DESAFIOS, pergunta, ESQUEMA_DESAFIOS)


@router.get("/insights-de-desafios")
async def listar_insights(usuario: Usuario = Depends(usuario_atual)):
    """O histórico gravado, que a tela mostra sem precisar reanalisar."""
    async with sessao(usuario_id=usuario.id) as conn:
        linhas = await conn.fetch(
            """SELECT id::text, insights, leads_analyzed, created_at
                 FROM challenge_insights
                ORDER BY created_at DESC
                LIMIT 10""")
    return [dict(l) for l in linhas]


class InsightIn(BaseModel):
    insights: dict
    leads_analyzed: int = Field(ge=0)


@router.post("/insights-de-desafios", status_code=status.HTTP_201_CREATED)
async def gravar_insight(dados: InsightIn,
                         usuario: Usuario = Depends(usuario_atual)):
    async with sessao(usuario_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            """INSERT INTO challenge_insights (insights, leads_analyzed, created_by)
               VALUES ($1::jsonb, $2, $3::uuid)
               RETURNING id::text, insights, leads_analyzed, created_at""",
            __import__("json").dumps(dados.insights), dados.leads_analyzed,
            usuario.id)
    return dict(linha)
```

- [ ] **Passo 4: Rodar os testes**

```bash
cd backend && ./.venv/bin/pytest tests/test_ia_analises.py -q
cd backend && ./.venv/bin/pytest -q
```

Esperado: 3 passed no arquivo novo; suíte inteira verde.

- [ ] **Passo 5: Commit**

```bash
git add backend/app/routers/ia.py backend/tests/test_ia_analises.py
git commit -m "feat(6): as duas análises com saída garantida pela API

Porte fiel: mesmo prompt, mesma forma. O que muda é que o formato deixa de ser
pedido no prompt ('Retorne APENAS um JSON válido') e passa a ser garantido por
output_config.format.

analisar-leads não recebe mais a base pelo corpo: o servidor busca pelas mesmas
ferramentas do analista."
```

---

### Task 6: O painel — metas, cartões e agendamentos

**Arquivos:**
- Criar: `backend/app/routers/painel.py`
- Modificar: `backend/app/main.py`
- Modificar: `frontend/src/hooks/useGoalSettings.tsx`
- Modificar: `frontend/src/hooks/useDashboardCardSettings.tsx`
- Modificar: `frontend/src/hooks/useAgendamentos.tsx`
- Apagar: `frontend/src/hooks/useClarity.tsx`

**Interfaces:**
- Consome: `app.database.sessao`, `app.dependencies.usuario_atual`.
- Produz:
  - `GET /painel/config/{chave}` → `{"setting_key": str, "setting_value": any}` ou 404
  - `PUT /painel/config/{chave}` recebe o valor cru → `{"setting_key", "setting_value"}`
  - `GET /painel/agendamentos` → lista de `contact_events` de agendamento

⚠️ **`useGoalSettings` e `useDashboardCardSettings` batem na MESMA tabela**
(`dashboard_settings`, chave/valor em jsonb). Um par de rotas serve os dois — não
escreva dois conjuntos.

- [ ] **Passo 1: Escrever o router**

Criar `backend/app/routers/painel.py`:

```python
"""Configuração do painel e eventos de agendamento.

`dashboard_settings` é uma tabela chave/valor em jsonb, GLOBAL — não por
usuário. É de propósito: meta de leads e escolha de cartões são do painel da
empresa, não da pessoa. Preferência por usuário tem outro caminho
(`/preferencias/{chave}` em configuracao.py, que compõe a chave com o id de quem
está autenticado).
"""

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, status

from app.database import sessao
from app.dependencies import Usuario, usuario_atual

router = APIRouter(prefix="/painel", tags=["painel"])

# Chaves conhecidas. ⚠️ Allowlist, e não texto livre: sem ela a rota vira um
# armazenamento chave/valor arbitrário, escrevível por qualquer usuário
# autenticado, dentro do banco de marketing.
CHAVES = {"lead_goal", "dashboard_cards"}


@router.get("/config/{chave}")
async def ler_config(chave: str, _: Usuario = Depends(usuario_atual)):
    if chave not in CHAVES:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            f"Configuração '{chave}' não existe.")
    async with sessao() as conn:
        valor = await conn.fetchval(
            "SELECT setting_value FROM dashboard_settings WHERE setting_key = $1",
            chave)
    if valor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            f"Configuração '{chave}' ainda não foi definida.")
    return {"setting_key": chave, "setting_value": valor}


@router.put("/config/{chave}")
async def gravar_config(chave: str, valor: Any = Body(...),
                        _: Usuario = Depends(usuario_atual)):
    if chave not in CHAVES:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            f"Configuração '{chave}' não existe.")
    import json
    async with sessao() as conn:
        gravado = await conn.fetchval(
            """INSERT INTO dashboard_settings (setting_key, setting_value)
               VALUES ($1, $2::jsonb)
               ON CONFLICT (setting_key) DO UPDATE
                   SET setting_value = EXCLUDED.setting_value,
                       updated_at = now()
               RETURNING setting_value""",
            chave, json.dumps(valor))
    return {"setting_key": chave, "setting_value": gravado}


@router.get("/agendamentos")
async def listar_agendamentos(_: Usuario = Depends(usuario_atual)):
    """Os eventos de agendamento, que o painel usa para contar reuniões.

    ⚠️ Os dois tipos legados (`scheduling_widget_booked`, `meeting_scheduled`)
    são a mesma regra que o `/enriquecimento` de leitura_contatos.py aplica —
    ver o comentário de lá antes de mexer nesta lista.
    """
    async with sessao() as conn:
        linhas = await conn.fetch(
            """SELECT id::text, lead_id::text, dnia_id::text, event_type,
                      metadata, created_at
                 FROM contact_events
                WHERE event_type IN ('scheduling_widget_booked', 'meeting_scheduled')
                ORDER BY created_at DESC
                LIMIT 500""")
    return [dict(l) for l in linhas]
```

✅ **O `ON CONFLICT (setting_key)` funciona** — conferido no banco em
03/09/2026: existem `dashboard_settings_setting_key_key` e
`dashboard_settings_setting_key_unique`, dois índices únicos na mesma coluna.
(Dois é herança do dump, não defeito deste lote; não mexa neles.)

- [ ] **Passo 2: Registrar o router e conferir por HTTP**

Em `main.py`, `app.include_router(painel_router)` com o import no topo. Depois:

```bash
cd backend && ./.venv/bin/python -m uvicorn app.main:app --port 8100 &
TOKEN=$(cd backend && ./.venv/bin/python -c "
from app.auth.security import emitir_token
print(emitir_token('b6eb4652-1a93-420b-82e6-d2b8f894e2c8', 'admin', 'erick@healthsafety.com.br')[0])")

curl -s -X PUT http://127.0.0.1:8100/painel/config/lead_goal \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"monthly":100}'
curl -s http://127.0.0.1:8100/painel/config/lead_goal -H "Authorization: Bearer $TOKEN"
curl -s http://127.0.0.1:8100/painel/config/qualquer_coisa -H "Authorization: Bearer $TOKEN"
# Esperado: 404 "Configuração 'qualquer_coisa' não existe."
curl -s http://127.0.0.1:8100/painel/agendamentos -H "Authorization: Bearer $TOKEN" | head -c 200
```

⚠️ Derrube o uvicorn no fim. ⚠️ Se a 8100 estiver ocupada por outra sessão do
Erick, **reporte em vez de matar**.

- [ ] **Passo 3: Os três hooks passam a falar por `api.ts`**

Em cada um, troque `import { supabase } from '@/integrations/supabase/client'`
por `import { api, ErroApi } from '@/lib/api'` e as chamadas:

- `useGoalSettings`: leitura vira `api.get('/painel/config/lead_goal')`, gravação
  vira `api.put('/painel/config/lead_goal', valor)`. ⚠️ **O 404 é normal** —
  significa "ainda não definida", e a tela tem de cair no padrão sem mostrar
  erro. Trate `e instanceof ErroApi && e.status === 404` como "sem valor".
- `useDashboardCardSettings`: o mesmo, com a chave `dashboard_cards`.
- `useAgendamentos`: vira `api.get('/painel/agendamentos')`.

Mantenha o formato de retorno de cada hook **idêntico** ao de hoje — sete
componentes consomem o `useDashboardCardSettings` e dois o `useAgendamentos`;
mudar a forma quebra todos sem erro de compilação em alguns casos.

- [ ] **Passo 4: Apagar o `useClarity`**

```bash
grep -rn "useClarity" frontend/src
```

Esperado: só a definição. **Se aparecer qualquer consumidor, PARE e reporte** —
a premissa da tarefa caiu.

```bash
git rm frontend/src/hooks/useClarity.tsx
```

⚠️ **Não** mexa em `PageConfigEditor.tsx`, que grava a configuração do Clarity
por página. Ele é do lote 7, e a configuração continua guardada — o que sai é
só o hook que ninguém chamava.

- [ ] **Passo 5: Conferir que compila e no navegador**

```bash
cd frontend && npx tsc --noEmit
```

Com o backend na 8100 e o Vite em `127.0.0.1:8080`, entre injetando o token
(`localStorage.setItem('marketinghs-token', '<token>')` em `/login`, depois
navegue) e abra **Visão Geral**. Confira: os cartões carregam, o medidor de meta
aparece, e nenhuma chamada vai para `supabase.co` vinda dessas telas.

- [ ] **Passo 6: Commit**

```bash
git add -A
git commit -m "feat(6): metas, cartões e agendamentos saem do Supabase

dashboard_settings é chave/valor e serve os dois hooks — um par de rotas, não
dois. A chave é allowlist: sem ela a rota vira armazenamento arbitrário
escrevível por qualquer autenticado.

useClarity apagado: nenhum consumidor, como o metaTracking do 5C. A configuração
por página continua no PageConfigEditor, que é do lote 7."
```

---

### Task 7: As telas de IA

**Arquivos:**
- Modificar: `frontend/src/hooks/useAIChat.tsx`
- Modificar: `frontend/src/hooks/useAIAnalysis.tsx`
- Modificar: `frontend/src/components/admin/dashboard/challenges/ChallengesAIInsights.tsx`
- Criar: `frontend/src/components/admin/settings/IACard.tsx`
- Modificar: `frontend/src/pages/admin/SettingsPage.tsx`

**Interfaces:**
- Consome: as rotas das tarefas 2, 4 e 5.

- [ ] **Passo 1: O card de configuração da IA**

Criar `IACard.tsx` no molde do `MetaCard.tsx` (leia-o antes): mostra se a chave
está configurada e os últimos 4, campo para gravar, botão de lixeira para
limpar, e o modelo em uso. Fala por `api.get('/config/ia')` e
`api.put('/config/ia', ...)`. Acrescente `<IACard />` ao `SettingsPage.tsx`,
junto do `MetaCard`.

- [ ] **Passo 2: `useAIChat` fala com `/ia/conversas`**

Troque as 8 chamadas ao Supabase pelas rotas da Task 4. O mapa:

| Antes | Agora |
|---|---|
| listar `ai_chat_conversations` | `api.get('/ia/conversas')` |
| criar conversa | `api.post('/ia/conversas')` |
| ler mensagens de uma conversa | `api.get(\`/ia/conversas/${id}\`)` |
| apagar conversa | `api.delete(\`/ia/conversas/${id}\`)` |
| gravar mensagem + chamar a IA | `api.post(\`/ia/conversas/${id}/mensagens\`, { conteudo })` |

⚠️ **A gravação da mensagem e a chamada à IA viraram UMA rota.** No original a
tela gravava a pergunta, chamava a function e gravava a resposta — três idas,
sem transação, e fechar o navegador no meio deixava pergunta sem resposta. Agora
é uma chamada só e o servidor cuida da ordem.

- [ ] **Passo 3: `useAIAnalysis` e `ChallengesAIInsights`**

- `useAIAnalysis.analyzeLeads` vira `api.post('/ia/analisar-leads')` — **sem
  corpo**. ⚠️ A assinatura muda: ela recebia `leads: Lead[]` e não recebe mais,
  porque o servidor busca sozinho. Ajuste `AIAnalysis.tsx`, que a chama.
- `ChallengesAIInsights`: as três chamadas a `challenge_insights` viram
  `api.get('/ia/insights-de-desafios')` e `api.post('/ia/insights-de-desafios', ...)`;
  a análise vira `api.post('/ia/analisar-desafios')`.

Mantenha os tipos `AIAnalysisResult` e `AIInsights` **exatamente como estão** —
os esquemas do backend foram escritos para casar com eles, e há teste no backend
provando isso.

- [ ] **Passo 4: Conferir que compila**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Passo 5: O portão — abrir no navegador**

Com backend na 8100 e Vite em `127.0.0.1:8080`:

1. **Configurações → IA**: mostra "não configurado". Cole uma chave inválida
   (`nao-e-uma-chave`) e salve → o toast tem de mostrar a mensagem sobre
   `sk-ant-`.
2. ⚠️ **Se o Erick tiver dado uma chave real**, grave-a e siga para o 3. **Se
   não houver chave**, os passos 3 a 5 param no 400 "não está configurada" — o
   que é o comportamento certo. Registre isso no relatório e **não marque como
   pronto sem dizer que parou aí**.
3. **Chat (AIDataChat)**: crie uma conversa, pergunte *"quantos contatos vieram
   do DataCore?"*. A resposta tem de citar **2.080** e dizer o recorte.
4. Pergunte em seguida *"e quantos desses têm e-mail?"* — o follow-up **sem
   palavra-chave**, que é justamente o que a heurística antiga errava. Tem de
   responder com dado, não de cabeça.
5. **Desafios (aba Challenges)**: rode a análise e confira que os cinco blocos
   aparecem preenchidos.
6. Na aba Network: nenhuma chamada para `supabase.co` vinda dessas telas.

⚠️ Erros de console vindos de telas ainda não portadas (Páginas, lote 7) são
pré-existentes e não são desta tarefa.

- [ ] **Passo 6: Commit**

```bash
git add -A
git commit -m "feat(6): o chat, as análises e o card de IA saem do Supabase

Gravar a pergunta e chamar a IA viraram uma rota só: no original eram três idas
sem transação, e fechar o navegador no meio deixava pergunta sem resposta."
```

---

### Task 8: A tarja dos dez mil

**Arquivos:**
- Modificar: `frontend/src/hooks/useLeads.tsx`
- Modificar: `frontend/src/hooks/useAdminData.tsx`
- Modificar: `frontend/src/pages/admin/Overview.tsx`
- Modificar: `frontend/src/pages/admin/Analytics.tsx`

**Interfaces:**
- Produz: `useLeads()` passa a devolver também `truncado: boolean` e
  `totalNoServidor: number | null`; `useAdminData()` os repassa.

O `useLeads` para de paginar em `MAX_LEADS = 10000` e o dashboard calcula sobre
o que veio. Hoje são 2.083 contatos, então não morde — mas quando morder,
**todos os números das duas telas ficam errados sem avisar ninguém**. A
sincronização do DataCore trouxe 2.080 de uma vez.

- [ ] **Passo 1: Expor o truncamento no `useLeads`**

Em `frontend/src/hooks/useLeads.tsx`, dentro de `fetchAllLeads`, o laço já sabe
quando parou pelo teto. Guarde num estado e devolva:

```tsx
const [truncado, setTruncado] = useState(false);

// …dentro do laço, ao sair:
// ⚠️ `tem_mais` do servidor + termos batido no teto = truncamos. Se `tem_mais`
// for falso, paramos porque acabou, que é o caso normal.
setTruncado(hasMore && collected.length >= MAX_LEADS);

// …no retorno:
return { leads, allLeads, isLoading, error, refetch, truncado, teto: MAX_LEADS };
```

⚠️ Confira a variável que o laço usa para saber se há mais (`hasMore` e
`resposta.tem_mais`) e adapte — o importante é distinguir **"parei porque
acabou"** de **"parei porque bati no teto"**.

- [ ] **Passo 2: Propagar pelo `useAdminData`**

Em `useAdminData.tsx`, acrescente `truncado` e `teto` à interface do contexto e
ao objeto do `Provider`, tirando-os do `useLeads`.

- [ ] **Passo 3: A tarja nas duas telas**

Em `Overview.tsx` e `Analytics.tsx`, acima do conteúdo:

```tsx
{truncado && (
  <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
    ⚠️ Os números abaixo foram calculados sobre os {teto.toLocaleString('pt-BR')} contatos
    mais recentes, não sobre a base inteira. O painel calcula no navegador e
    esse é o teto que ele aguenta.
  </div>
)}
```

- [ ] **Passo 4: Provar que a tarja aparece**

Não dá para criar 10 mil contatos só para ver a tarja. Prove baixando o teto
temporariamente:

```bash
cd frontend && sed -i 's/const MAX_LEADS = 10000/const MAX_LEADS = 10/' src/hooks/useLeads.tsx
```

Abra **Visão Geral** no navegador: a tarja tem de aparecer dizendo "10
contatos". **Depois desfaça:**

```bash
cd frontend && sed -i 's/const MAX_LEADS = 10/const MAX_LEADS = 10000/' src/hooks/useLeads.tsx
git diff --stat frontend/src/hooks/useLeads.tsx
```

⚠️ Confirme pelo `git diff` que o valor voltou a **10000** antes de commitar.
Deixar 10 aí dentro quebraria o painel inteiro em silêncio, que é exatamente o
defeito que esta tarefa conserta.

- [ ] **Passo 5: Compilar e commitar**

```bash
cd frontend && npx tsc --noEmit
git add -A
git commit -m "feat(6): a tela avisa quando o painel truncou

useLeads para de paginar em MAX_LEADS e o dashboard calcula sobre o que veio.
Hoje são 2.083 contatos e não morde — quando morder, os números das duas telas
ficariam errados sem avisar ninguém. Agora avisam."
```

---

### Task 9: O portão

**Arquivos:**
- Modificar: `frontend/src/components/admin/settings/ApiDocumentation.tsx`
- Modificar: `frontend/public/api/dnmarketing-api.yaml`
- Apagar: `backend/supabase/functions/{analytics-api,ai-data-analyst,analyze-leads,analyze-challenges}/`
- Modificar: `docs/CONTINUAR-AQUI.md`

⚠️ **O passo 2 do portão não é redundante.** Este projeto já pegou documentação
ensinando URL morta **seis vezes**, incluindo no commit em que declarou ter
aprendido a lição.

- [ ] **Passo 1: Conferir o estado antes de apagar nada**

```bash
grep -rn "analytics-api\|ai-data-analyst\|analyze-leads\|analyze-challenges" \
  frontend/src frontend/public backend/app
```

Esperado: só a tela de Documentação e o `dnmarketing-api.yaml`. **Qualquer outra
coisa: pare e reporte** — uma tela ainda chama, e o portão não fecha.

- [ ] **Passo 2: Tirar `/analytics-api` das duas documentações**

Na `ApiDocumentation.tsx`, apague o objeto inteiro do array cujo `id` é
`'analytics-api'` — da `{` que abre até a `},` que fecha, inclusive. ⚠️ A `{`
abre uma linha antes do `id:`; começar pelo `id:` deixa chave órfã.

No `dnmarketing-api.yaml`, apague o bloco `/analytics-api:` inteiro, até a linha
em branco antes do próximo path. Valide depois:

```bash
python3 -c "import yaml; d=yaml.safe_load(open('frontend/public/api/dnmarketing-api.yaml')); print('ok', len(d['paths']), 'paths')"
```

Esperado: `ok 23 paths` (era 24).

- [ ] **Passo 3: As quatro functions saem**

```bash
git rm -r backend/supabase/functions/analytics-api \
          backend/supabase/functions/ai-data-analyst \
          backend/supabase/functions/analyze-leads \
          backend/supabase/functions/analyze-challenges
```

- [ ] **Passo 4: Conferir o placar, os dois números separados**

```bash
ls backend/supabase/functions/ | grep -v '^_shared$' | wc -l
python3 -c "
import pathlib, re
n = sum(len(re.findall(r'supabase\s*\.?\s*\n?\s*\.(from|rpc)\(', f.read_text()))
        for f in pathlib.Path('frontend/src').rglob('*.ts*')
        if 'integrations/supabase' not in str(f))
print(n, 'pontos de acesso direto')"
grep -rn "functions\.invoke" frontend/src --include=*.ts --include=*.tsx | wc -l
```

Esperado: **18** functions restantes (eram 22), e os pontos de acesso direto
caem de 27 para **8** (sobram os do `usePages` e do `leadConversion.ts`, que são
do lote 7).

⚠️ **Os dois números nunca se somam.** A pasta veio com 55 entradas — 54
functions mais o `_shared`. 18 restantes significam **30 portadas + 7
descartadas**.

- [ ] **Passo 5: Abrir a tela de Documentação no navegador**

Configurações → Documentação da API: a lista renderiza inteira, sem
`/analytics-api`, sem vírgula órfã, sem erro de console próprio.

- [ ] **Passo 6: Atualizar o `docs/CONTINUAR-AQUI.md`**

Marque o **lote 6** como concluído em 03/09/2026 e escreva, em prosa curta no
tom do documento:

- **O buraco que o lote fechou:** `execute_readonly_query` era `SECURITY
  DEFINER` de dono superusuário e executava qualquer SELECT que a IA gerasse; a
  defesa era lista negra de palavras, que não bloqueia
  `SELECT value FROM integration_secrets`. Não estava explorável (a tela morria
  no toco antes), mas estava viva no banco. Apagada pela migration 016.
- **O que substituiu:** seis ferramentas nomeadas com allowlist de campos,
  executadas pela `sessao()` de quem perguntou. O modelo não escreve SQL.
- **A lição, para os próximos lotes:** ⚠️ o defeito não era o modelo escrever
  SQL ruim — era a **lista negra**. Toda vez que a defesa for "proibir o que é
  ruim" em vez de "permitir só o que é bom", é o mesmo desenho.
- **Que a spec errava:** os painéis já estavam fora do Supabase desde o lote 1B;
  o lote 6 foi IA e configuração, não Analytics.
- **A tarja dos dez mil**, e que ela é um remendo honesto: a agregação no
  servidor continua não existindo, e o dia que a base passar de 10 mil o painel
  fica lento antes de ficar errado.
- **Que as 12 telas livres para o visual viraram 14** — Visão Geral e Analytics
  saíram da lista de espera. Continuam fora: **Páginas** (lote 7) e
  **Configurações** (falta o `NexusCard`, do 5A, bloqueado).
- Na lista "o que depende do Erick": **a chave da Anthropic** precisa ser gravada
  em Configurações → IA, senão o chat e as duas análises respondem 400. E o
  custo estimado, ~$15/mês, para ele saber o que esperar na fatura.

- [ ] **Passo 7: Rodar tudo e commitar**

```bash
cd backend && ./.venv/bin/pytest -q
cd frontend && npx tsc --noEmit
git add -A
git commit -m "chore(6): o portão fecha — quatro functions saem da pasta

analytics-api descartada (nenhum chamador, como Nexus e Pingback); as três de IA
portadas. O passo 2 do portão pegou de novo a documentação ensinando URL morta —
sétima vez.

Placar: 30 portadas + 7 descartadas · 18 na especificação."
```

---

## Revisão do plano

**Cobertura da spec.** Seção 7, linha do lote 6 ("Painéis, funil, origem, AI
Data Analyst" / "Os números batem com conferência manual no banco") → os painéis
já estavam portados (registrado em "Onde a spec erra"); a conferência manual é o
Passo 5 da Task 3. Seção 9, linha do Lovable AI Gateway ("API da Claude direto")
→ tarefas 2 a 5. Seção 9, linha do Microsoft Clarity ("projeto próprio, ou
remove") → Task 6, passo 4, remove.

**Sem marcadores.** Nenhum "TBD", nenhum "tratar erros adequadamente". O único
ponto em que o plano manda **conferir antes de escrever** é a assinatura de
`sessao()` (Task 4), com instrução explícita de parar e reportar — não é um
buraco, é a única coisa que eu não consegui confirmar sozinho.

**A armadilha do gatilho.** `leads` tem um BEFORE INSERT que faz
`NEW.etiqueta := v_etiqueta`, recalculando a etiqueta e descartando a que veio
no INSERT. O primeiro rascunho destes testes usava `etiqueta` como marcador e
teria falhado apontando para a ferramenta, que estaria certa. O marcador é
`tipo`, e o helper `_lead` explica por quê.

**Consistência de tipos.** `ESQUEMAS`, `executar`, `FerramentaDesconhecida` e
`ArgumentoRecusado` (Task 3) são consumidos com esses nomes exatos na Task 4.
`exigir_cliente`, `IANaoConfigurada` e `MODELO` (Task 2) aparecem com os mesmos
nomes nas tarefas 4 e 5. `ESQUEMA_LEADS` e `ESQUEMA_DESAFIOS` (Task 5) são
testados pelos nomes que o frontend já usa, e a Task 7 manda **não** mexer
nesses tipos.

**Risco conhecido.** As tarefas 4, 5 e 7 dependem de uma chave da Anthropic para
serem provadas de ponta a ponta. Sem ela, o portão da Task 7 para no passo 2 — e
o plano manda registrar isso em vez de marcar como pronto. É a mesma honestidade
do 5C com o pixel do Meta.
