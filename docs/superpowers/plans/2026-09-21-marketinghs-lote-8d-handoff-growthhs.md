# MarketingHS — Lote 8D: Handoff para o GrowthHS — Plano

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para executar tarefa a tarefa.
> Os passos usam caixa de seleção (`- [ ]`) para acompanhamento.

**Objetivo:** o lead qualificado volta a virar card no CRM sozinho — agora no
GrowthHS, pela API dele — pelos três caminhos que a origem tinha: a **regra de
automação**, o **nó de jornada** e o **botão manual**. Sai o `handoff-to-nexus`,
o `nexus-config`, o `get-nexus-stages` e o `NexusCard`.

**Arquitetura:** uma fila só de entrega, `crm_handoffs`, alimentada pelos três
caminhos e drenada pelo worker (o mesmo processo que já drena e-mail e roda
jornadas). O cliente HTTP do GrowthHS (`app/crm/growthhs.py`) monta o corpo do
contrato e classifica o erro em definitivo × transitório; a entrega
(`app/crm/entrega.py`) reivindica com `FOR UPDATE SKIP LOCKED`, re-tenta o
transitório com espera crescente e falha à vista o definitivo. A avaliação das
regras volta como gatilho no banco — o `evaluate_automation_on_etiqueta` da
origem, que chamava o handoff por HTTP, passa a **enfileirar**. A configuração
fica em `growthhs_config` (base, funil, link) + a chave em `integration_secrets`.

**Stack:** FastAPI + asyncpg · httpx · pytest · React 18 + TanStack Query

**Spec:** `docs/superpowers/specs/2026-08-31-marketinghs-design.md` (§8.A)
**Contrato:** `docs/contratos/2026-09-02-endpoint-card-comercial-growthhs.md`
**Documento-mãe:** `docs/superpowers/plans/2026-09-10-marketinghs-lote-8-fechamento.md`

---

## Restrições globais

- **`sessao()` é o único caminho para dado.** Nunca superusuário.
- **Rota de admin:** `Depends(admin_atual)`. As rotas de configuração seguem o
  padrão de `configuracao.py` (`sessao(role="service_role")` + `admin_atual`);
  a tabela nova não tem política RLS para `authenticated`, então a autorização
  é a da rota.
- **Rota pública:** nenhuma neste lote (decisão 2).
- **Nenhum endpoint depende do RLS para autorizar.** O papel é `'admin'`.
- **Toda chave lida do ambiente precisa estar declarada em `Settings`.** Este
  plano não lê chave nova do `.env`: a chave do GrowthHS mora em
  `integration_secrets` (`app/integracoes.py`), como a do Resend e a do Meta.
- **Colunas de INSERT/UPDATE vêm de lista fechada no código.**
- **Comentário, nome e mensagem em português.** O corpo mandado ao GrowthHS usa
  as chaves do contrato (em inglês) — é a API dele.
- ⚠️ **Rede nunca dentro de transação.** A chamada ao GrowthHS acontece entre
  duas sessões curtas (reivindicar → chamar → gravar), nunca com uma transação
  aberta esperando HTTP.
- ⚠️ **`contact_events` alimenta as jornadas** (gatilho copia para
  `journey_events`, sem FK). Teste que grava evento de contato apaga o
  `journey_events` correspondente.
- ⚠️ **Os testes gravam no banco real.** Fixture limpa antes e depois. Nunca
  mate o pytest no meio. Tabelas singleton de produção (`growthhs_config`) são
  guardadas e devolvidas pela fixture.
- ⚠️ **Nenhum teste chama o GrowthHS de verdade.** O cliente recebe
  `transport=httpx.MockTransport(...)`; a entrega recebe o transporte por
  parâmetro.
- **Migration reaplicável, aplicada duas vezes** (comando do `CLAUDE.md`). Não
  use `aplicar-migrations.sh`.
- ⚠️ **"Nexus" são dois produtos.** O CRM da dn.ia (o que sai aqui) e o
  agendamento "dn.nexus", que usa o MESMO `source_app = 'nexus'` e escreve
  `ecosystem_identities.nexus_contact_id` via `resolve_or_create_identity`.
  **Não toque em `source_app 'nexus'`, em `nexus_contact_id` nem nas pílulas
  "Nexus" das telas de contato** — são do agendamento.
- **Frontend:** `cd frontend && npx tsc --noEmit -p tsconfig.app.json && npx vite build`
  — o `tsc` tem 6 erros **pré-existentes** (LeadScoringSettings, NexusCard×3,
  useJourneys×2); nenhum novo. Os 3 do `NexusCard` somem quando ele sai.

---

## O que a leitura achou (21/09/2026)

1. **O endpoint `POST /api/v1/integration/cards` ainda não existe no
   `hsgrowth-sistema`** (conferido só lendo, em 21/09). Pela regra do Erick de
   10/09, porta-se contra o contrato; funciona quando o GrowthHS implementar.
   Sem configuração, o worker **não reivindica** a fila e diz por quê — o mesmo
   comportamento do Resend sem chave.
2. **As regras de automação não disparam desde o lote 0.** Na origem, o
   gatilho `trg_automation_on_etiqueta_change` avaliava as regras e chamava o
   handoff por `net.http_post`; o `StatusDropdown` avaliava de novo no
   navegador quando o status mudava. Os dois saíram (lote 0 e lote 4B). O
   Erick decidiu em 21/09: **o avaliador volta, no servidor, dentro do 8D.**
3. **O nó de jornada `handoff_nexus` falha de propósito** (`executor.py:203`),
   e a tela nem deixa salvá-lo (`NodeConfigDialog.tsx:187`).
4. **O `NexusCard` está quebrado hoje** — chama `supabase.functions.invoke`, e
   o cliente é um toco que sempre lança.
5. **Todas as tabelas envolvidas estão vazias:** `automation_rules` (0),
   `nexus_config` (0), `ecosystem_identities.nexus_contact_id` preenchido (0).
   Trocar o vocabulário não migra dado.
6. **O GrowthHS devolve ids inteiros** (`id`, `person_id`); `nexus_contact_id`
   é uuid. As colunas novas são `bigint`.
7. **A regra da origem só avaliava quando a ETIQUETA mudava** (o gatilho
   saía cedo em qualquer outro UPDATE), e o navegador cobria a mudança de
   status. Um gatilho que avalia em mudança de `etiqueta`, `status` **ou**
   `lead_score` cobre as duas coisas num lugar só — e cobre também a mudança
   de status pela API externa (8B), que a origem cobria pelo mesmo gatilho.
8. **Um valor mal formado numa regra derrubava a escrita do lead** na origem
   (`'abc'::int` dentro do gatilho aborta o UPDATE). Aqui cada regra é avaliada
   num bloco com `EXCEPTION`: regra quebrada vira aviso no log, o lead grava.

---

## Decisões tomadas neste plano

| # | Decisão | Motivo |
|---|---|---|
| 1 | **O avaliador de regras volta como gatilho no banco**, porte quase literal do `evaluate_automation_on_etiqueta`, trocando o `net.http_post` por um `INSERT` na fila. | Decisão do Erick (21/09). Gatilho pega todo caminho de escrita (admin, API do 8B, captura, pontuação) sem cada rota lembrar de chamar. |
| 2 | **O modo público `direct_stage` é descartado.** | Decisão do Erick (21/09): era a landing da dn.ia criando card anônimo numa etapa cravada no código. O lead da landing chega ao CRM pela regra ou pela jornada. |
| 3 | **Uma fila só (`crm_handoffs`) para os três caminhos**; o botão manual também enfileira. | Um caminho de entrega, uma política de re-tentativa, um lugar para ver falha. O worker drena em segundos. |
| 4 | **Guarda do nosso lado contra card duplicado:** antes de chamar, se o lead já tem entrega `entregue`, não chama de novo. Índice único parcial impede dois pedidos pendentes do mesmo lead. | A constraint `(external_source, external_id)` no GrowthHS é pedido do contrato, ainda não existe. Continuamos mandando o `external_id` para quando existir. |
| 5 | **Erro definitivo (4xx) falha na hora; transitório (5xx, 429, rede) re-tenta** com espera 1, 2, 4, 8, 16 min, até 6 tentativas. Falha vira evento na linha do tempo do contato (`crm_handoff_falhou`). | Contrato, tabela "Erros que o MarketingHS sabe tratar". Falha silenciosa é o defeito que este projeto mais teve. |
| 6 | **`move_stage` fica no vocabulário e falha à vista** ("o GrowthHS ainda não tem rota para mover card"). O pedido entra no contrato. | O contrato não tem rota de mover. Portar a regra e fingir que moveu seria pior que falhar. |
| 7 | **Vocabulário novo:** ações `create_in_growthhs`, `move_stage_growthhs`, `block_growthhs`; nó `handoff_growthhs` (sem `config.stage_id` — o card entra na etapa de entrada do funil configurado). | Contrato: `list_id` nulo = etapa de entrada; qual é a entrada é decisão do CRM. As tabelas estão vazias. |
| 8 | **Sem valor de oportunidade.** O `value: 30000` cravado da origem não vai. | O contrato não tem o campo; era o preço do produto da dn.ia. |
| 9 | **`growthhs_config` (base da API, funil, endereço do app) + chave em `integration_secrets`.** `nexus_config` é apagada. | Spec §8.A ("tabela, não código") + padrão da casa para segredo (Resend, Meta). |
| 10 | **"Testar conexão" só confere que a API responde** (`GET {base}/health`). | O contrato não tem rota de leitura autenticada; testar a chave exigiria criar card. A tela diz isso. |
| 11 | **A pílula "Nexus" das telas de contato não muda** (é o agendamento); entra ao lado a presença no GrowthHS, e o link "Ver no Nexus" (CRM antigo, `nexus.dnia.ai` cravado) vira "Ver no GrowthHS". | "Nexus" são dois produtos — restrição global. |
| 12 | **Excluir contato não apaga o card no GrowthHS.** | A origem apagava no Nexus; o contrato não tem rota de exclusão, e apagar card de vendedor é decisão do CRM. Registrado no contrato como pergunta. |

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `backend/migrations/018_handoff_growthhs.sql` (novo) | `growthhs_config`, colunas `growthhs_*` na identidade, fila `crm_handoffs`, vocabulário novo, `nexus_config` sai |
| `backend/migrations/019_regras_de_automacao.sql` (novo) | o gatilho que avalia as regras e enfileira |
| `backend/app/crm/__init__.py`, `growthhs.py` (novos) | cliente do GrowthHS: config, corpo do contrato, chamada, classificação de erro |
| `backend/app/crm/entrega.py` (novo) | a fila: enfileirar, reivindicar, entregar, re-tentar |
| `backend/app/routers/configuracao.py` | `GET|PUT /config/growthhs`, `POST /config/growthhs/testar` |
| `backend/app/routers/crm.py` (novo) | `POST /crm/enviar/{lead_id}` (botão manual) |
| `backend/app/worker.py` | drena a fila |
| `backend/app/jornadas/executor.py` | nó `handoff_growthhs` enfileira |
| `backend/app/routers/automacoes.py`, `leitura_contatos.py`, `api_contato.py`, `escrita_contatos.py` | prévia, presença no GrowthHS, docstrings |
| `frontend/src/components/admin/settings/GrowthHSCard.tsx` (novo) | substitui o `NexusCard` |
| frontend de automações, jornadas e contatos | vocabulário, botões manuais, link do GrowthHS |

---

### Tarefa 1: O banco — migration 018

**Files:**
- Create: `backend/migrations/018_handoff_growthhs.sql`
- Create: `backend/tests/test_handoff_banco.py`
- Modify: `backend/tests/conftest.py` (fixture `config_growthhs`)

**Interfaces:**
- Produces: tabela `growthhs_config(id, base_url, board_id bigint, app_url, updated_at, updated_by)`, linha única (índice em `(true)`);
  colunas `ecosystem_identities.growthhs_card_id bigint`, `growthhs_person_id bigint`;
  tabela `crm_handoffs(id bigserial, lead_id uuid, acao 'criar'|'mover', origem 'regra'|'jornada'|'manual', rule_id uuid, journey_run_id uuid, status 'pendente'|'entregue'|'falhou', tentativas int, visivel_em timestamptz, erro text, card_id bigint, person_id bigint, criado_em, atualizado_em)`
  com índice único parcial `uniq_crm_handoffs_pendente (lead_id, acao) WHERE status = 'pendente'`;
  vocabulário: `action_type IN ('create_in_growthhs','move_stage_growthhs','block_growthhs')`; nó `handoff_growthhs` sem `config.stage_id`.
- Produces (conftest): `config_growthhs` — fábrica `await config_growthhs(base_url, board_id, app_url=None)`; `config_growthhs(None, None)` esvazia; devolve a linha original no teardown.

- [ ] **Step 1: Escrever os testes do banco**

`backend/tests/test_handoff_banco.py`:

```python
"""O banco do handoff — o que o gatilho de validação aceita e a fila garante.

O modo de falhar é um pedido de card duplicado (dois pendentes para o mesmo
lead) ou um vocabulário que a tela manda e o banco recusa. Os dois aparecem só
quando alguém tenta salvar ou quando o vendedor vê o mesmo contato duas vezes.
"""

import asyncpg
import pytest

GRAFO_OK = [{"id": "n1", "type": "handoff_growthhs", "config": {}, "next": None}]


async def _lead(conexao) -> str:
    return str(await conexao.fetchval(
        "INSERT INTO leads (nome, email, tipo) VALUES ('Handoff 8D', "
        "'handoff-8d-banco@exemplo.invalid', 'teste') RETURNING id"))


async def test_regra_aceita_o_vocabulario_novo_e_recusa_o_do_nexus(conexao):
    await conexao.execute(
        """INSERT INTO automation_rules (name, condition_type, condition_operator,
                                         condition_value, action_type)
           VALUES ('8D', 'etiqueta', 'is', 'hotlead', 'create_in_growthhs')""")
    with pytest.raises(asyncpg.RaiseError, match="Invalid action_type"):
        async with conexao.transaction():
            await conexao.execute(
                """INSERT INTO automation_rules (name, condition_type, condition_operator,
                                                 condition_value, action_type)
                   VALUES ('8D', 'etiqueta', 'is', 'hotlead', 'create_in_nexus')""")


async def test_no_de_jornada_growthhs_sem_etapa_e_nexus_recusado(conexao):
    await conexao.execute("SELECT validate_journey_graph($1::jsonb, 'n1')", GRAFO_OK)
    velho = [{"id": "n1", "type": "handoff_nexus", "config": {"stage_id": "x"}, "next": None}]
    with pytest.raises(asyncpg.RaiseError, match="tipo de no invalido"):
        async with conexao.transaction():
            await conexao.execute("SELECT validate_journey_graph($1::jsonb, 'n1')", velho)


async def test_fila_nao_aceita_dois_pendentes_do_mesmo_lead(conexao):
    lead = await _lead(conexao)
    await conexao.execute(
        "INSERT INTO crm_handoffs (lead_id, origem) VALUES ($1::uuid, 'manual')", lead)
    with pytest.raises(asyncpg.UniqueViolationError):
        async with conexao.transaction():
            await conexao.execute(
                "INSERT INTO crm_handoffs (lead_id, origem) VALUES ($1::uuid, 'regra')", lead)
    # Depois de entregue, um novo pedido pode entrar (e a entrega decide).
    await conexao.execute("UPDATE crm_handoffs SET status = 'entregue' WHERE lead_id = $1::uuid",
                          lead)
    await conexao.execute(
        "INSERT INTO crm_handoffs (lead_id, origem) VALUES ($1::uuid, 'regra')", lead)


async def test_identidade_tem_as_colunas_inteiras_do_growthhs(conexao):
    tipos = dict(await conexao.fetch(
        """SELECT column_name, data_type FROM information_schema.columns
            WHERE table_name = 'ecosystem_identities'
              AND column_name IN ('growthhs_card_id', 'growthhs_person_id')"""))
    assert tipos == {"growthhs_card_id": "bigint", "growthhs_person_id": "bigint"}


async def test_nexus_config_saiu_e_growthhs_config_e_linha_unica(conexao):
    assert await conexao.fetchval("SELECT to_regclass('public.nexus_config')") is None
    await conexao.execute("DELETE FROM growthhs_config")
    await conexao.execute("INSERT INTO growthhs_config (board_id) VALUES (1)")
    with pytest.raises(asyncpg.UniqueViolationError):
        async with conexao.transaction():
            await conexao.execute("INSERT INTO growthhs_config (board_id) VALUES (2)")
```

(A fixture `conexao` roda em `service_role` numa transação sempre desfeita.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_handoff_banco.py`
Esperado: FAIL — `crm_handoffs`/`growthhs_config` não existem; o vocabulário novo é recusado.

- [ ] **Step 3: Escrever a migration**

`backend/migrations/018_handoff_growthhs.sql` — cabeçalho explicando o lote e,
nesta ordem:

```sql
-- 018 — O handoff para o GrowthHS: configuração, fila e vocabulário.
--
-- Sai o Nexus (CRM da dn.ia), entra o GrowthHS, chamado pela API dele
-- (POST /api/v1/integration/cards — docs/contratos/2026-09-02-...). Tudo o que
-- esta migration troca estava VAZIO em 21/09/2026: automation_rules (0 linhas),
-- nexus_config (0), nenhum nexus_contact_id preenchido.
--
-- ⚠️ `nexus_contact_id` FICA: ele é escrito pelo agendamento "dn.nexus"
-- (resolve_or_create_identity, source_app = 'nexus'), que é outro produto.
--
-- Reaplicável: rode duas vezes para provar.

-- 1. A configuração. A chave NÃO mora aqui: vai em integration_secrets
--    (GROWTHHS_API_KEY), como a do Resend e a do Meta.
CREATE TABLE IF NOT EXISTS public.growthhs_config (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    base_url   text,
    board_id   bigint,
    app_url    text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS growthhs_config_linha_unica
    ON public.growthhs_config ((true));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.growthhs_config TO service_role;

DROP TABLE IF EXISTS public.nexus_config;

-- 2. O vínculo do contato com o card. Inteiros: o GrowthHS devolve id numérico.
ALTER TABLE public.ecosystem_identities
    ADD COLUMN IF NOT EXISTS growthhs_card_id bigint,
    ADD COLUMN IF NOT EXISTS growthhs_person_id bigint;

-- 3. A fila de entrega. Um pedido por lead e ação enquanto pendente — é o que
--    impede o mesmo lead de virar dois cards por dois caminhos ao mesmo tempo
--    (regra + jornada + botão).
CREATE TABLE IF NOT EXISTS public.crm_handoffs (
    id             bigserial PRIMARY KEY,
    lead_id        uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
    acao           text NOT NULL DEFAULT 'criar' CHECK (acao IN ('criar', 'mover')),
    origem         text NOT NULL CHECK (origem IN ('regra', 'jornada', 'manual')),
    rule_id        uuid,
    journey_run_id uuid,
    status         text NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente', 'entregue', 'falhou')),
    tentativas     integer NOT NULL DEFAULT 0,
    visivel_em     timestamptz NOT NULL DEFAULT now(),
    erro           text,
    card_id        bigint,
    person_id      bigint,
    criado_em      timestamptz NOT NULL DEFAULT now(),
    atualizado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_crm_handoffs_pendente
    ON public.crm_handoffs (lead_id, acao) WHERE status = 'pendente';
CREATE INDEX IF NOT EXISTS idx_crm_handoffs_a_entregar
    ON public.crm_handoffs (visivel_em) WHERE status = 'pendente';
CREATE INDEX IF NOT EXISTS idx_crm_handoffs_lead
    ON public.crm_handoffs (lead_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_handoffs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.crm_handoffs_id_seq TO service_role;
```

4. O vocabulário das regras: `CREATE OR REPLACE FUNCTION public.validate_automation_rule_fields()`
   copiando **inteira** a definição de `001_schema_origem.sql:2029-2066`, com
   UMA mudança — a última verificação passa a ser:

```sql
  IF NEW.action_type NOT IN ('create_in_growthhs','move_stage_growthhs','block_growthhs') THEN
    RAISE EXCEPTION 'Invalid action_type: %', NEW.action_type;
  END IF;
```

5. O nó de jornada: `CREATE OR REPLACE FUNCTION public.validate_journey_graph(p_nodes jsonb, p_entry_node_id text)`
   copiando **inteira** a definição de `001_schema_origem.sql:2171-2312`
   (mesmo cabeçalho `RETURNS void`, mesma linguagem e `SET`), com DUAS mudanças:
   - na lista de tipos válidos, `'handoff_nexus'` vira `'handoff_growthhs'`;
   - o bloco `WHEN 'handoff_nexus' THEN IF coalesce(v_node#>>'{config,stage_id}', '') = '' THEN RAISE EXCEPTION ...; END IF;`
     **sai inteiro** (o nó não tem configuração obrigatória — decisão 7).

   Confira depois de escrever: `grep -c "handoff_nexus" backend/migrations/018_handoff_growthhs.sql`
   só pode achar o comentário, nunca código.

- [ ] **Step 4: Aplicar duas vezes**

```bash
cd /home/ericks/github/MarketingHS
set -a; . ~/marketinghs.env; set +a
for i in 1 2; do PGPASSWORD="$POSTGRES_PASSWORD" psql \
  "postgresql://${POSTGRES_USER}@${POSTGRES_HOST_EXTERNO}:${POSTGRES_PORTA_EXTERNA}/${POSTGRES_DB}" \
  -v ON_ERROR_STOP=1 -f backend/migrations/018_handoff_growthhs.sql; done
```

- [ ] **Step 5: A fixture da configuração**

No fim de `backend/tests/conftest.py`:

```python
@pytest_asyncio.fixture
async def config_growthhs():
    """Põe `growthhs_config` num estado conhecido e devolve o que havia.

    ⚠️ Linha única, de PRODUÇÃO — a que diz para onde vão os cards. A chave
    (`GROWTHHS_API_KEY`) não passa por aqui: quem precisa grava e apaga com
    `integracoes`, e devolve o que havia.
    """
    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")
    async with db.sessao(role="service_role") as conn:
        antes = await conn.fetchrow(
            "SELECT base_url, board_id, app_url FROM growthhs_config LIMIT 1")

    async def gravar(base_url, board_id, app_url=None):
        async with db.sessao(role="service_role") as conn:
            await conn.execute("DELETE FROM growthhs_config")
            if base_url is not None or board_id is not None or app_url is not None:
                await conn.execute(
                    "INSERT INTO growthhs_config (base_url, board_id, app_url) "
                    "VALUES ($1, $2, $3)", base_url, board_id, app_url)

    yield gravar
    if antes:
        await gravar(antes["base_url"], antes["board_id"], antes["app_url"])
    else:
        await gravar(None, None)
```

- [ ] **Step 6: Rodar e ver passar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_handoff_banco.py tests/test_ab_admin.py`
Esperado: `5 passed` no primeiro arquivo; o segundo continua passando (ele não
mexe em nada disto, é só a prova de que a migration não quebrou o vizinho).

- [ ] **Step 7: Commit**

```bash
git add backend/migrations/018_handoff_growthhs.sql backend/tests/test_handoff_banco.py \
        backend/tests/conftest.py
git commit -m "feat(8D): o banco do handoff — growthhs_config, fila crm_handoffs, vocabulário do GrowthHS"
```

---

### Tarefa 2: O cliente do GrowthHS

**Files:**
- Create: `backend/app/crm/__init__.py`, `backend/app/crm/growthhs.py`
- Test: `backend/tests/test_growthhs_cliente.py`

**Interfaces:**
- Produces:
  - `SEGREDO_CHAVE = "GROWTHHS_API_KEY"`
  - `Config(base_url, board_id, app_url, api_key)` com `.configurado -> bool` e `.url_do_card(card_id) -> str | None`
  - `async ler_config() -> Config` (nunca levanta)
  - `normalizar_faturamento(v) -> str | None`, `normalizar_funcionarios(v) -> str | None`
  - `montar_card(lead: dict, board_id: int) -> dict` (o corpo do contrato)
  - `class ErroDefinitivo(Exception)`, `class ErroTransitorio(Exception)`
  - `async criar_card(cfg, corpo, *, transporte=None) -> dict` (devolve o JSON da resposta 200/201)
  - `async testar(cfg, *, transporte=None) -> int` (status do `GET {base}/health`; levanta `ErroTransitorio` sem resposta)
  - `lead: dict` precisa das chaves: `id, nome, email, whatsapp, phone_normalized, empresa, cargo, faturamento, funcionarios, desafios, indicacao, utm_source, utm_medium, utm_campaign, utm_term, utm_content, lead_score, etiqueta`.

- [ ] **Step 1: Escrever os testes**

`backend/tests/test_growthhs_cliente.py`:

```python
"""O cliente do GrowthHS — o corpo do contrato e a leitura do erro.

O modo de falhar é o card nascer com origem errada (o painel do comercial
conta "Orgânico" onde houve anúncio pago), faixa de faturamento que o CRM não
reconhece, ou um 5xx tratado como definitivo (o lead nunca chega) — e um 4xx
tratado como transitório (a fila re-tenta para sempre uma chave errada).
"""

import httpx
import pytest

from app.crm import growthhs
from app.crm.growthhs import (Config, ErroDefinitivo, ErroTransitorio, criar_card,
                              montar_card, normalizar_faturamento,
                              normalizar_funcionarios)

LEAD = {"id": "c351c124-0000-0000-0000-000000000001", "nome": "Carla Menezes",
        "email": "carla@transportadora.com.br", "whatsapp": "81999999999",
        "phone_normalized": "+5581999999999", "empresa": "Transportadora XYZ",
        "cargo": "Gerente de SESMT", "faturamento": "Entre R$ 100 mil e R$ 500 mil",
        "funcionarios": "11-50", "desafios": "controle de jornada", "indicacao": None,
        "utm_source": "google", "utm_medium": "cpc", "utm_campaign": "black-friday",
        "utm_term": None, "utm_content": None, "lead_score": 60, "etiqueta": "hotlead"}
CFG = Config(base_url="https://growthhs.exemplo.invalid", board_id=3,
             app_url="https://app.growthhs.exemplo.invalid", api_key="chave-8d")


@pytest.mark.parametrize("entrada, saida", [
    ("Até R$ 100 mil", "Ate 100k/mes"),
    ("Entre R$ 100 mil e R$ 500 mil", "Entre 100k e 500k/mes"),
    ("Entre 500 mil e 1 milhão", "Entre 500k e 1MM/mes"),
    ("Entre 1 milhão e 3 milhões", "Entre 1MM e 3MM/mes"),
    ("Entre 3 milhões e 5 milhões", "Entre 3MM e 5MM/mes"),
    ("Acima de 5 milhões", "Acima de 5MM/mes"),
    ("não sei", None), (None, None),
])
def test_faturamento_nas_faixas_da_origem(entrada, saida):
    assert normalizar_faturamento(entrada) == saida


@pytest.mark.parametrize("entrada, saida", [
    ("Individual", "Eu S.A."), ("1-10", "1-10 funcionarios"), ("2 - 10", "1-10 funcionarios"),
    ("11-50", "11-50 funcionarios"), ("26-49", "11-50 funcionarios"),
    ("51-200", "51-200 funcionarios"), ("acima de 50", "51-200 funcionarios"),
    ("mais de 200", "+200 funcionarios"), ("", None), (None, None),
])
def test_funcionarios_nas_faixas_da_origem(entrada, saida):
    assert normalizar_funcionarios(entrada) == saida


def test_corpo_do_contrato():
    corpo = montar_card(LEAD, 3)
    assert corpo["source"] == "marketinghs" and corpo["external_id"] == LEAD["id"]
    assert corpo["board_id"] == 3 and corpo["list_id"] is None
    assert corpo["title"] == "Carla Menezes — Transportadora XYZ"
    assert corpo["description"] == ("Campanha: black-friday\nDesafios: controle de jornada"
                                    "\nIndicação: —")
    assert corpo["contact"] == {"name": "Carla Menezes", "email": "carla@transportadora.com.br",
                                "phone": "+5581999999999", "company": "Transportadora XYZ",
                                "job_title": "Gerente de SESMT"}
    assert corpo["origin"] == "Tráfego pago" and corpo["acquisition_channel"] == "Inbound"
    assert corpo["utm_params"] == "utm_source=google&utm_medium=cpc&utm_campaign=black-friday"
    assert corpo["business_info"] == {"faturamento": "Entre 100k e 500k/mes",
                                      "funcionarios": "11-50 funcionarios",
                                      "lead_score": 60, "etiqueta": "hotlead"}


def test_sem_utm_e_organico_e_sem_nome_usa_o_email():
    lead = {**LEAD, "nome": None, "empresa": None, "utm_source": None, "utm_medium": None,
            "utm_campaign": None}
    corpo = montar_card(lead, 3)
    assert corpo["origin"] == "Orgânico" and corpo["utm_params"] is None
    assert corpo["title"] == "carla@transportadora.com.br"


def _transporte(status, corpo=None, registro=None):
    def responder(request):
        if registro is not None:
            registro.append(request)
        return httpx.Response(status, json=corpo if corpo is not None else {"detail": "x"})
    return httpx.MockTransport(responder)


async def test_criar_card_manda_a_chave_e_devolve_a_resposta():
    pedidos = []
    resposta = {"id": 4821, "person_id": 1180, "created": True}
    devolvido = await criar_card(CFG, montar_card(LEAD, 3),
                                 transporte=_transporte(201, resposta, pedidos))
    assert devolvido == resposta
    assert str(pedidos[0].url) == "https://growthhs.exemplo.invalid/api/v1/integration/cards"
    assert pedidos[0].headers["x-api-key"] == "chave-8d"


@pytest.mark.parametrize("codigo, erro", [(401, ErroDefinitivo), (403, ErroDefinitivo),
                                          (404, ErroDefinitivo), (422, ErroDefinitivo),
                                          (429, ErroTransitorio), (500, ErroTransitorio),
                                          (503, ErroTransitorio)])
async def test_classifica_o_erro_como_o_contrato_manda(codigo, erro):
    with pytest.raises(erro):
        await criar_card(CFG, montar_card(LEAD, 3), transporte=_transporte(codigo))


async def test_sem_resposta_e_transitorio():
    def cair(request):
        raise httpx.ConnectError("fora do ar")
    with pytest.raises(ErroTransitorio):
        await criar_card(CFG, montar_card(LEAD, 3), transporte=httpx.MockTransport(cair))


def test_configurado_e_link_do_card():
    assert CFG.configurado
    assert CFG.url_do_card(4821) == "https://app.growthhs.exemplo.invalid/cards/4821"
    assert not Config(base_url=None, board_id=3, app_url=None, api_key="k").configurado
    assert Config(base_url="x", board_id=3, app_url=None, api_key="k").url_do_card(1) is None
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_growthhs_cliente.py`
Esperado: FAIL — `ModuleNotFoundError: No module named 'app.crm'`.

- [ ] **Step 3: Escrever o cliente**

`backend/app/crm/__init__.py`:

```python
"""A entrega do lead qualificado ao comercial — o que era o handoff-to-nexus."""
```

`backend/app/crm/growthhs.py`:

```python
"""O cliente do GrowthHS. Uma responsabilidade: montar o card do contrato e
mandar.

Contrato: `docs/contratos/2026-09-02-endpoint-card-comercial-growthhs.md`
(`POST /api/v1/integration/cards`, `X-API-Key`, escopo `cards:create`).
⚠️ Em 21/09/2026 o endpoint ainda NÃO existe no `hsgrowth-sistema`. Este módulo
nasce parametrizado e desligado: sem configuração, `Config.configurado` é falso
e a fila não é drenada (ver `app/crm/entrega.py`).

As regras de negócio que viajam no corpo são as do `handoff-to-nexus` de
origem, portadas literalmente: origem por UTM e as faixas de faturamento e de
funcionários do Nexus antigo (o contrato pede ao GrowthHS que diga se usa
outras).
"""

import logging
import re
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx

from app.database import sessao
from app.integracoes import ler_segredo

logger = logging.getLogger(__name__)

SEGREDO_CHAVE = "GROWTHHS_API_KEY"
TIMEOUT = 15
CAMINHO_CARDS = "/api/v1/integration/cards"
UTMS = ("utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content")


@dataclass(frozen=True)
class Config:
    base_url: str | None
    board_id: int | None
    app_url: str | None
    api_key: str | None

    @property
    def configurado(self) -> bool:
        return bool(self.base_url and self.board_id and self.api_key)

    def url_do_card(self, card_id) -> str | None:
        """O link "Ver no GrowthHS" (rota `/cards/:cardId` do app dele)."""
        if not self.app_url or card_id is None:
            return None
        return f"{self.app_url.rstrip('/')}/cards/{card_id}"


async def ler_config() -> Config:
    """Nunca levanta: banco fora vira "não configurado", e a fila espera."""
    try:
        async with sessao(role="service_role") as conn:
            linha = await conn.fetchrow(
                "SELECT base_url, board_id, app_url FROM growthhs_config LIMIT 1")
    except Exception:
        logger.exception("[growthhs] não foi possível ler growthhs_config")
        linha = None
    return Config(base_url=linha["base_url"] if linha else None,
                  board_id=linha["board_id"] if linha else None,
                  app_url=linha["app_url"] if linha else None,
                  api_key=await ler_segredo(SEGREDO_CHAVE))


def normalizar_faturamento(valor: str | None) -> str | None:
    """`mapRevenue` do handoff-to-nexus, literal (inclusive a ordem)."""
    if not valor:
        return None
    s = valor.lower()
    # ⚠️ `and "500" not in s` é a ÚNICA diferença da origem: lá, "Entre R$ 100
    # mil e R$ 500 mil" contém "100 mil" e caía em "Ate 100k/mes" — a primeira
    # faixa engolia a segunda. Correção deliberada (plano do 8D, Tarefa 2).
    if ("100 mil" in s or "100k" in s or "até 100" in s or "ate 100" in s) and "500" not in s:
        return "Ate 100k/mes"
    if ("100" in s and "500" in s) or "100k e 500k" in s:
        return "Entre 100k e 500k/mes"
    if ("500" in s and ("1 milh" in s or "1mm" in s)) or "500k e 1mm" in s:
        return "Entre 500k e 1MM/mes"
    if ("1 milh" in s and "3 milh" in s) or "1mm e 3mm" in s:
        return "Entre 1MM e 3MM/mes"
    if ("3 milh" in s and "5 milh" in s) or "3mm e 5mm" in s:
        return "Entre 3MM e 5MM/mes"
    if "acima" in s and ("5 milh" in s or "5mm" in s):
        return "Acima de 5MM/mes"
    return None
```

⚠️ **Pare e confira antes de seguir.** O `mapRevenue` da origem
(`backend/supabase/functions/handoff-to-nexus/index.ts:11-20`) testa a primeira
condição SEM a exceção do "500" — ou seja, na origem, "Entre R$ 100 mil e R$ 500
mil" virava **"Ate 100k/mes"** (defeito da origem: a primeira faixa engole a
segunda). O teste acima espera "Entre 100k e 500k/mes". Registre no relatório
como **correção deliberada de defeito da origem**, e mantenha o resto literal.
Se preferir expressar a correção de outro jeito (reordenar), o teste é quem
decide.

Continue o módulo:

```python
def normalizar_funcionarios(valor: str | None) -> str | None:
    """`mapEmployeeCount` do handoff-to-nexus, literal."""
    if not valor:
        return None
    s = valor.lower().strip()
    if "individual" in s or "eu s" in s:
        return "Eu S.A."
    if "1-10" in s or re.fullmatch(r"2\s*-\s*10", s) or "1 a 10" in s:
        return "1-10 funcionarios"
    if "11-50" in s or re.search(r"11\s*-\s*(25|50)", s) or re.search(r"26\s*-\s*(49|50)", s):
        return "11-50 funcionarios"
    if "51-200" in s or re.search(r"51\s*-\s*200", s) or "acima de 50" in s:
        return "51-200 funcionarios"
    if "+200" in s or "acima de 200" in s or "mais de 200" in s:
        return "+200 funcionarios"
    return None


def _ou_traco(valor) -> str:
    texto = str(valor).strip() if valor is not None else ""
    return texto or "—"


def montar_card(lead: dict, board_id: int) -> dict:
    """O corpo do contrato. `list_id` nulo = etapa de entrada do funil —
    qual é a entrada é decisão do CRM (decisão 7 do plano do 8D).

    Origem: "Tráfego pago" se houver QUALQUER UTM, senão "Orgânico" — regra
    global da origem; o `source` do lead é ignorado de propósito, para não
    haver dois dialetos de origem.
    """
    utms = {c: lead.get(c) for c in UTMS if lead.get(c)}
    nome = lead.get("nome") or lead.get("email") or "Sem nome"
    titulo = f"{nome} — {lead['empresa']}" if lead.get("empresa") else nome
    return {
        "source": "marketinghs",
        "external_id": str(lead["id"]),
        "board_id": board_id,
        "list_id": None,
        "title": titulo,
        "description": (f"Campanha: {_ou_traco(lead.get('utm_campaign'))}\n"
                        f"Desafios: {_ou_traco((lead.get('desafios') or '')[:500])}\n"
                        f"Indicação: {_ou_traco(lead.get('indicacao'))}"),
        "contact": {"name": nome, "email": lead.get("email"),
                    "phone": lead.get("phone_normalized") or lead.get("whatsapp"),
                    "company": lead.get("empresa"), "job_title": lead.get("cargo")},
        "origin": "Tráfego pago" if utms else "Orgânico",
        "acquisition_channel": "Inbound",
        "utm_source": lead.get("utm_source"),
        "utm_campaign": lead.get("utm_campaign"),
        "utm_term": lead.get("utm_term"),
        "utm_params": urlencode(utms) if utms else None,
        "business_info": {"faturamento": normalizar_faturamento(lead.get("faturamento")),
                          "funcionarios": normalizar_funcionarios(lead.get("funcionarios")),
                          "lead_score": lead.get("lead_score"),
                          "etiqueta": lead.get("etiqueta")},
    }


class ErroDefinitivo(Exception):
    """4xx: configuração ou corpo — re-tentar não muda nada."""


class ErroTransitorio(Exception):
    """5xx, 429 ou sem resposta — a fila re-tenta."""


async def criar_card(cfg: Config, corpo: dict, *,
                     transporte: httpx.AsyncBaseTransport | None = None) -> dict:
    url = cfg.base_url.rstrip("/") + CAMINHO_CARDS
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, transport=transporte) as cliente:
            resposta = await cliente.post(url, json=corpo,
                                          headers={"X-API-Key": cfg.api_key})
    except httpx.HTTPError as erro:
        raise ErroTransitorio(f"sem resposta do GrowthHS: {erro}") from erro
    if resposta.status_code in (200, 201):
        return resposta.json()
    detalhe = f"{resposta.status_code}: {resposta.text[:400]}"
    if resposta.status_code >= 500 or resposta.status_code == 429:
        raise ErroTransitorio(detalhe)
    raise ErroDefinitivo(detalhe)


async def testar(cfg: Config, *,
                 transporte: httpx.AsyncBaseTransport | None = None) -> int:
    """Só confere que a API responde (decisão 10): o contrato não tem rota de
    leitura autenticada, e testar a chave exigiria criar um card."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, transport=transporte) as cliente:
            resposta = await cliente.get(cfg.base_url.rstrip("/") + "/health")
    except httpx.HTTPError as erro:
        raise ErroTransitorio(f"sem resposta do GrowthHS: {erro}") from erro
    return resposta.status_code
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_growthhs_cliente.py`
Esperado: todos passam (não tocam o banco).

- [ ] **Step 5: Commit**

```bash
git add backend/app/crm backend/tests/test_growthhs_cliente.py
git commit -m "feat(8D): o cliente do GrowthHS — o card do contrato e a leitura do erro"
```

---

### Tarefa 3: A configuração — rotas e o card da tela

**Files:**
- Modify: `backend/app/routers/configuracao.py`
- Create: `frontend/src/components/admin/settings/GrowthHSCard.tsx`
- Modify: `frontend/src/components/admin/SettingsPage.tsx` (troca `NexusCard` por `GrowthHSCard`) — confira o caminho com `grep -rn "NexusCard" frontend/src`
- Delete: `frontend/src/components/admin/settings/NexusCard.tsx`
- Test: `backend/tests/test_config_growthhs.py`

**Interfaces:**
- Consumes: `growthhs.ler_config`, `growthhs.testar`, `growthhs.SEGREDO_CHAVE`, `ErroTransitorio` (Tarefa 2); fixtures `config_growthhs` (T1), `token_admin`, `token_usuario`, `cliente`.
- Produces:
  - `GET /config/growthhs` → `{"base_url", "board_id", "app_url", "api_key": {"configurado", "ultimos4"}, "configurado", "fila": {"pendentes", "falhas", "ultimas_falhas": [{"lead_id", "erro", "atualizado_em"}]}}`
  - `PUT /config/growthhs` corpo `{"base_url"?, "board_id"?, "app_url"?, "api_key"?, "limpar": ["api_key"]?}` → mesmo formato do GET
  - `POST /config/growthhs/testar` → `{"alcancavel": true, "status": int}`; 400 sem `base_url`; 502 sem resposta.

- [ ] **Step 1: Testes**

`backend/tests/test_config_growthhs.py`:

```python
"""A configuração do GrowthHS. O modo de falhar é a chave voltar inteira na
resposta (é ela que cria card no funil de vendas) ou um usuário comum mudar
para onde vão os leads."""

import app.database as db
from app import integracoes
from app.crm import growthhs

ROTA = "/config/growthhs"


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _sem_chave():
    anterior = await integracoes.ler_segredo(growthhs.SEGREDO_CHAVE)
    await integracoes.apagar_segredo(growthhs.SEGREDO_CHAVE)
    return anterior


async def test_config_exige_admin(cliente, token_usuario):
    for metodo, corpo in (("GET", None), ("PUT", {"board_id": 1})):
        r = await cliente.request(metodo, ROTA, json=corpo, headers=_auth(token_usuario))
        assert r.status_code == 403
    r = await cliente.post(f"{ROTA}/testar", headers=_auth(token_usuario))
    assert r.status_code == 403


async def test_grava_parcial_e_nunca_devolve_a_chave(cliente, token_admin, config_growthhs):
    await config_growthhs(None, None)
    anterior = await _sem_chave()
    try:
        r = await cliente.put(ROTA, headers=_auth(token_admin), json={
            "base_url": "https://growthhs.exemplo.invalid/", "board_id": 3,
            "api_key": "chave-secreta-8d-1234"})
        assert r.status_code == 200, r.text
        corpo = r.json()
        assert corpo["base_url"] == "https://growthhs.exemplo.invalid"
        assert corpo["board_id"] == 3 and corpo["configurado"] is True
        assert corpo["api_key"] == {"configurado": True, "ultimos4": "1234"}
        assert "chave-secreta" not in r.text

        # Só o endereço do app: o resto fica.
        r = await cliente.put(ROTA, headers=_auth(token_admin),
                              json={"app_url": "https://app.exemplo.invalid"})
        assert r.json()["board_id"] == 3
        assert r.json()["app_url"] == "https://app.exemplo.invalid"

        r = await cliente.put(ROTA, headers=_auth(token_admin), json={"limpar": ["api_key"]})
        assert r.json()["api_key"]["configurado"] is False
        assert r.json()["configurado"] is False
    finally:
        # Devolve exatamente o que havia — inclusive "nada": a chave de teste
        # não pode ficar gravada se o teste quebrar no meio.
        if anterior:
            await integracoes.gravar_segredo(growthhs.SEGREDO_CHAVE, anterior)
        else:
            await integracoes.apagar_segredo(growthhs.SEGREDO_CHAVE)
        integracoes.esquecer(growthhs.SEGREDO_CHAVE)


async def test_recusa_endereco_sem_protocolo_e_funil_invalido(cliente, token_admin,
                                                             config_growthhs):
    await config_growthhs(None, None)
    r = await cliente.put(ROTA, headers=_auth(token_admin),
                          json={"base_url": "growthhs.exemplo.invalid"})
    assert r.status_code == 422
    r = await cliente.put(ROTA, headers=_auth(token_admin), json={"board_id": 0})
    assert r.status_code == 422


async def test_mostra_a_fila_com_as_falhas(cliente, token_admin, config_growthhs):
    await config_growthhs(None, None)
    async with db.sessao(role="service_role") as conn:
        lead = await conn.fetchval(
            "INSERT INTO leads (nome, email, tipo) VALUES ('Fila 8D', "
            "'fila-8d@exemplo.invalid', 'teste') RETURNING id::text")
        await conn.execute(
            "INSERT INTO crm_handoffs (lead_id, origem, status, erro) "
            "VALUES ($1::uuid, 'manual', 'falhou', '401: chave inválida')", lead)
    try:
        fila = (await cliente.get(ROTA, headers=_auth(token_admin))).json()["fila"]
        assert fila["falhas"] >= 1
        assert any(f["lead_id"] == lead and f["erro"] == "401: chave inválida"
                   for f in fila["ultimas_falhas"])
    finally:
        # `fn_lead_insert_event` grava um contact_event (e o gatilho das
        # jornadas, um journey_event) em todo INSERT de lead — sem FK.
        async with db.sessao(role="service_role") as conn:
            await conn.execute("DELETE FROM journey_events WHERE lead_id = $1::uuid", lead)
            await conn.execute("DELETE FROM contact_events WHERE lead_id = $1::uuid", lead)
            await conn.execute("DELETE FROM leads WHERE id = $1::uuid", lead)


async def test_testar_sem_endereco_e_400(cliente, token_admin, config_growthhs):
    await config_growthhs(None, None)
    r = await cliente.post(f"{ROTA}/testar", headers=_auth(token_admin))
    assert r.status_code == 400
```

- [ ] **Step 2: Rodar e ver falhar** — `cd backend && ./.venv/bin/pytest -q tests/test_config_growthhs.py` → 404/405.

- [ ] **Step 3: As rotas**, em `backend/app/routers/configuracao.py`, junto das
  do Meta (siga os imports e o estilo que o arquivo já tem — `re`, `httpx`,
  `HTTPException`, `status`, `BaseModel`, `admin_atual`, `sessao`):

```python
# ============================================================================
# GrowthHS — para onde vai o lead qualificado (lote 8D)
# ============================================================================

class GrowthHSIn(BaseModel):
    base_url: str | None = None
    board_id: int | None = Field(default=None, gt=0, le=2147483647)
    app_url: str | None = None
    api_key: str | None = None
    limpar: list[str] = Field(default_factory=list)

    @field_validator("base_url", "app_url")
    @classmethod
    def _endereco(cls, valor):
        if valor is None or not valor.strip():
            return None
        valor = valor.strip().rstrip("/")
        if not re.match(r"^https?://[^/\s]+", valor, re.I):
            raise ValueError("use o endereço completo, com https://")
        return valor


async def _estado_growthhs() -> dict:
    from app.crm import growthhs

    cfg = await growthhs.ler_config()
    chave = cfg.api_key or ""
    async with sessao(role="service_role") as conn:
        pendentes = await conn.fetchval(
            "SELECT count(*) FROM crm_handoffs WHERE status = 'pendente'")
        falhas = await conn.fetchval(
            "SELECT count(*) FROM crm_handoffs WHERE status = 'falhou'")
        ultimas = await conn.fetch(
            """SELECT lead_id::text, erro, atualizado_em::text FROM crm_handoffs
                WHERE status = 'falhou' ORDER BY atualizado_em DESC LIMIT 5""")
    return {
        "base_url": cfg.base_url, "board_id": cfg.board_id, "app_url": cfg.app_url,
        "api_key": {"configurado": bool(chave),
                    "ultimos4": chave[-4:] if len(chave) >= 4 else None},
        "configurado": cfg.configurado,
        "fila": {"pendentes": pendentes, "falhas": falhas,
                 "ultimas_falhas": [dict(l) for l in ultimas]},
    }


@router.get("/config/growthhs")
async def ler_config_growthhs(_: Usuario = Depends(admin_atual)):
    """O que está configurado, e como anda a fila de entrega.

    ⚠️ A chave NUNCA volta inteira — ela cria card no funil de vendas. As
    falhas aparecem aqui porque falha de entrega é o tipo de coisa que ninguém
    vê: o lead "foi para o comercial" e não foi."""
    return await _estado_growthhs()


@router.put("/config/growthhs")
async def gravar_config_growthhs(dados: GrowthHSIn, admin: Usuario = Depends(admin_atual)):
    """Grava só o que veio; `limpar: ["api_key"]` apaga a chave."""
    from app.crm import growthhs
    from app.integracoes import apagar_segredo, gravar_segredo

    desconhecidos = [c for c in dados.limpar if c != "api_key"]
    if desconhecidos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Campos desconhecidos: {', '.join(desconhecidos)}")
    if "api_key" in dados.limpar:
        await apagar_segredo(growthhs.SEGREDO_CHAVE)
    elif dados.api_key and dados.api_key.strip():
        await gravar_segredo(growthhs.SEGREDO_CHAVE, dados.api_key.strip())

    campos = {c: v for c, v in dados.model_dump(exclude_unset=True).items()
              if c in ("base_url", "board_id", "app_url")}
    if campos:
        async with sessao(role="service_role") as conn:
            await conn.execute(
                """INSERT INTO growthhs_config (base_url, board_id, app_url, updated_by)
                   VALUES ($1, $2, $3, $7::uuid)
                   ON CONFLICT ((true)) DO UPDATE SET
                     base_url   = CASE WHEN $4 THEN EXCLUDED.base_url ELSE growthhs_config.base_url END,
                     board_id   = CASE WHEN $5 THEN EXCLUDED.board_id ELSE growthhs_config.board_id END,
                     app_url    = CASE WHEN $6 THEN EXCLUDED.app_url ELSE growthhs_config.app_url END,
                     updated_by = EXCLUDED.updated_by,
                     updated_at = now()""",
                campos.get("base_url"), campos.get("board_id"), campos.get("app_url"),
                "base_url" in campos, "board_id" in campos, "app_url" in campos, admin.id)
    return await _estado_growthhs()


@router.post("/config/growthhs/testar")
async def testar_config_growthhs(_: Usuario = Depends(admin_atual)):
    """Confere que a API do GrowthHS responde. ⚠️ NÃO confere a chave
    (decisão 10 do plano do 8D) — a tela diz isso."""
    from app.crm import growthhs

    cfg = await growthhs.ler_config()
    if not cfg.base_url:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Preencha o endereço da API do GrowthHS antes de testar.")
    try:
        codigo = await growthhs.testar(cfg)
    except growthhs.ErroTransitorio as erro:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(erro))
    return {"alcancavel": codigo < 500, "status": codigo}
```

(Garanta os imports `Field` e `field_validator` de `pydantic` no topo, se o
arquivo ainda não os tiver.)

- [ ] **Step 4: Rodar e ver passar** — `cd backend && ./.venv/bin/pytest -q tests/test_config_growthhs.py` → `5 passed`.

- [ ] **Step 5: O card da tela**

Leia o `NexusCard.tsx` inteiro antes: o `GrowthHSCard` mantém **todas** as
capacidades dele (chave mascarada com mostrar/ocultar e "vazio mantém a
atual"; campos; Salvar habilitado só com mudança; Testar conexão; selo de
estado `idle|testing|connected|error|unconfigured`; carregar ao abrir; testar
sozinho depois de salvar completo) e troca os campos: **Endereço da API**
(`base_url`), **ID do funil** (`board_id`, número), **Endereço do app**
(`app_url`, opcional — "para o link Ver no GrowthHS"), **Chave de API**. Mostra
ainda, abaixo, a **fila**: "N aguardando entrega · N falharam" e a lista das
últimas falhas (contato + erro), quando houver. Texto fixo no card:
"Testar conexão confere que a API do GrowthHS responde; não confere a chave —
isso só se vê na primeira entrega." Fala com a API por `api` de `@/lib/api`
(`get('/config/growthhs')`, `put('/config/growthhs', ...)`,
`post('/config/growthhs/testar')`), sem nada de `supabase`.

Troque o `NexusCard` pelo `GrowthHSCard` onde ele é montado e apague o
`NexusCard.tsx` (`git rm`).

Aceite:

```bash
grep -rn "NexusCard\|nexus-config\|get-nexus-stages" frontend/src   # vazio
cd frontend && npx tsc --noEmit -p tsconfig.app.json && npx vite build
```

O `tsc` deve cair de 6 para 3 erros pré-existentes (os 3 do `NexusCard` somem).

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/configuracao.py backend/tests/test_config_growthhs.py frontend/src
git commit -m "feat(8D): configuração do GrowthHS — rotas e o card no lugar do NexusCard"
```

---

### Tarefa 4: A entrega — a fila e o worker

**Files:**
- Create: `backend/app/crm/entrega.py`
- Modify: `backend/app/worker.py`
- Test: `backend/tests/test_crm_entrega.py`

**Interfaces:**
- Consumes: `growthhs.Config`, `ler_config`, `montar_card`, `criar_card`, `ErroDefinitivo`, `ErroTransitorio` (T2); tabela `crm_handoffs` (T1).
- Produces:
  - `async enfileirar(conn, lead_id: str, origem: str, *, acao: str = "criar", rule_id: str | None = None, journey_run_id: str | None = None) -> int | None` — id do pedido, ou `None` se já havia um pendente
  - `async rodar_entregas(*, limite: int = 20, cfg: Config | None = None, transporte=None, somente_lead: str | None = None) -> dict` — os testes SEMPRE passam `somente_lead` — `{"desligado": True}` sem configuração; senão `{"entregues", "ja_entregues", "adiadas", "falhas"}`
  - `MAX_TENTATIVAS = 6`; eventos de contato `crm_handoff` e `crm_handoff_falhou` (source_app `marketinghs`).

- [ ] **Step 1: Testes**

`backend/tests/test_crm_entrega.py`:

```python
"""A fila de entrega ao GrowthHS.

O modo de falhar: o lead "vai para o comercial" e não vai (falha silenciosa),
vira dois cards (entrega repetida), ou uma chave errada é re-tentada para
sempre. Nenhum aparece em tela; o vendedor descobre.
"""

import httpx
import pytest_asyncio

import app.database as db
from app.crm import entrega
from app.crm.growthhs import Config

EMAIL = "entrega-8d@exemplo.invalid"
CFG = Config(base_url="https://growthhs.exemplo.invalid", board_id=3,
             app_url="https://app.exemplo.invalid", api_key="chave-8d")


def _transporte(status, corpo=None, contagem=None):
    def responder(request):
        if contagem is not None:
            contagem.append(request)
        return httpx.Response(status, json=corpo or {"detail": "x"})
    return httpx.MockTransport(responder)


@pytest_asyncio.fixture
async def lead_8d():
    """Um lead com identidade, apagado com tudo o que a entrega grava."""
    await db.init_db()

    async def limpar():
        async with db.sessao(role="service_role") as conn:
            ids = [r["id"] for r in await conn.fetch(
                "SELECT id FROM leads WHERE email = $1", EMAIL)]
            await conn.execute("DELETE FROM journey_events WHERE lead_id = ANY($1::uuid[])", ids)
            await conn.execute("DELETE FROM contact_events WHERE lead_id = ANY($1::uuid[])", ids)
            await conn.execute("DELETE FROM leads WHERE id = ANY($1::uuid[])", ids)
            await conn.execute("DELETE FROM ecosystem_identities WHERE email = $1", EMAIL)

    await limpar()
    async with db.sessao(role="service_role") as conn:
        dnia = await conn.fetchval(
            "INSERT INTO ecosystem_identities (email) VALUES ($1) RETURNING dnia_id::text", EMAIL)
        lead = await conn.fetchval(
            """INSERT INTO leads (nome, email, tipo, dnia_id, utm_source)
               VALUES ('Entrega 8D', $1, 'teste', $2::uuid, 'google') RETURNING id::text""",
            EMAIL, dnia)
    yield {"lead_id": lead, "dnia_id": dnia}
    await limpar()


async def _pedido(lead_id):
    async with db.sessao(role="service_role") as conn:
        return await conn.fetchrow(
            "SELECT * FROM crm_handoffs WHERE lead_id = $1::uuid ORDER BY id DESC LIMIT 1",
            lead_id)


async def _eventos(lead_id, tipo):
    async with db.sessao(role="service_role") as conn:
        return await conn.fetch(
            "SELECT metadata FROM contact_events WHERE lead_id = $1::uuid AND event_type = $2",
            lead_id, tipo)


async def test_enfileirar_nao_duplica_pendente(lead_8d):
    async with db.sessao(role="service_role") as conn:
        primeiro = await entrega.enfileirar(conn, lead_8d["lead_id"], "manual")
        segundo = await entrega.enfileirar(conn, lead_8d["lead_id"], "regra")
    assert primeiro is not None and segundo is None


async def test_sem_configuracao_nao_reivindica_nada(lead_8d):
    async with db.sessao(role="service_role") as conn:
        await entrega.enfileirar(conn, lead_8d["lead_id"], "manual")
    vazio = Config(base_url=None, board_id=None, app_url=None, api_key=None)
    assert await entrega.rodar_entregas(cfg=vazio, somente_lead=lead_8d["lead_id"]) == {"desligado": True}
    assert (await _pedido(lead_8d["lead_id"]))["status"] == "pendente"


async def test_entrega_grava_o_card_na_fila_na_identidade_e_na_linha_do_tempo(lead_8d):
    async with db.sessao(role="service_role") as conn:
        await entrega.enfileirar(conn, lead_8d["lead_id"], "manual")
    resultado = await entrega.rodar_entregas(somente_lead=lead_8d["lead_id"], cfg=CFG, transporte=_transporte(201, {"id": 4821, "person_id": 1180, "created": True}))
    assert resultado["entregues"] == 1

    pedido = await _pedido(lead_8d["lead_id"])
    assert pedido["status"] == "entregue" and pedido["card_id"] == 4821
    async with db.sessao(role="service_role") as conn:
        ident = await conn.fetchrow(
            "SELECT growthhs_card_id, growthhs_person_id FROM ecosystem_identities "
            "WHERE dnia_id = $1::uuid", lead_8d["dnia_id"])
    assert (ident["growthhs_card_id"], ident["growthhs_person_id"]) == (4821, 1180)
    eventos = await _eventos(lead_8d["lead_id"], "crm_handoff")
    assert eventos[0]["metadata"]["card_id"] == 4821
    assert eventos[0]["metadata"]["origem"] == "manual"


async def test_lead_ja_entregue_nao_chama_de_novo(lead_8d):
    chamadas = []
    corpo = {"id": 4821, "person_id": 1180, "created": True}
    for _ in range(2):
        async with db.sessao(role="service_role") as conn:
            await entrega.enfileirar(conn, lead_8d["lead_id"], "regra")
        await entrega.rodar_entregas(somente_lead=lead_8d["lead_id"], cfg=CFG, transporte=_transporte(201, corpo, chamadas))
    assert len(chamadas) == 1
    assert (await _pedido(lead_8d["lead_id"]))["card_id"] == 4821


async def test_erro_definitivo_falha_na_hora_e_aparece(lead_8d):
    async with db.sessao(role="service_role") as conn:
        await entrega.enfileirar(conn, lead_8d["lead_id"], "manual")
    resultado = await entrega.rodar_entregas(somente_lead=lead_8d["lead_id"], cfg=CFG, transporte=_transporte(401))
    assert resultado["falhas"] == 1
    pedido = await _pedido(lead_8d["lead_id"])
    assert pedido["status"] == "falhou" and pedido["erro"].startswith("401")
    assert len(await _eventos(lead_8d["lead_id"], "crm_handoff_falhou")) == 1


async def test_erro_transitorio_adia_e_esgota(lead_8d, monkeypatch):
    async with db.sessao(role="service_role") as conn:
        await entrega.enfileirar(conn, lead_8d["lead_id"], "manual")
    assert (await entrega.rodar_entregas(somente_lead=lead_8d["lead_id"], cfg=CFG, transporte=_transporte(503)))["adiadas"] == 1
    pedido = await _pedido(lead_8d["lead_id"])
    assert pedido["status"] == "pendente" and pedido["tentativas"] == 1

    # Esgotar: com o pedido já visível e o teto em 2, a próxima falha é final.
    monkeypatch.setattr(entrega, "MAX_TENTATIVAS", 2)
    async with db.sessao(role="service_role") as conn:
        await conn.execute("UPDATE crm_handoffs SET visivel_em = now() WHERE id = $1",
                           pedido["id"])
    assert (await entrega.rodar_entregas(somente_lead=lead_8d["lead_id"], cfg=CFG, transporte=_transporte(503)))["falhas"] == 1
    assert (await _pedido(lead_8d["lead_id"]))["status"] == "falhou"


async def test_mover_etapa_falha_a_vista(lead_8d):
    async with db.sessao(role="service_role") as conn:
        await entrega.enfileirar(conn, lead_8d["lead_id"], "regra", acao="mover")
    chamadas = []
    await entrega.rodar_entregas(somente_lead=lead_8d["lead_id"], cfg=CFG, transporte=_transporte(201, {"id": 1}, chamadas))
    pedido = await _pedido(lead_8d["lead_id"])
    assert pedido["status"] == "falhou" and "mover" in pedido["erro"]
    assert chamadas == []
```

- [ ] **Step 2: Rodar e ver falhar** — `cd backend && ./.venv/bin/pytest -q tests/test_crm_entrega.py` → `ImportError`.

- [ ] **Step 3: `backend/app/crm/entrega.py`**

```python
"""A fila de entrega ao GrowthHS — o que era o handoff-to-nexus, sem o Nexus.

Três caminhos enfileiram (a regra de automação pelo gatilho do banco, o nó de
jornada, o botão manual) e o worker drena. Um caminho de entrega, uma política
de re-tentativa, um lugar para ver falha (`GET /config/growthhs`).

⚠️ A rede nunca roda dentro de transação: reivindica (sessão curta, com
prazo de 5 min), chama, grava o resultado (outra sessão curta). Se o worker
morrer entre a chamada e a gravação, o pedido volta depois do prazo e é
mandado de novo — e é por isso que o `external_id` vai no corpo: o contrato
pede ao GrowthHS a restrição `(external_source, external_id)` que torna o
reenvio inofensivo.

⚠️ Guarda do nosso lado (decisão 4): lead que já tem entrega `entregue` não
é mandado de novo — a restrição do GrowthHS ainda não existe.
"""

import logging
from datetime import timedelta

from app.crm import growthhs
from app.database import sessao

logger = logging.getLogger(__name__)

MAX_TENTATIVAS = 6
ESPERA_BASE = timedelta(minutes=1)          # 1, 2, 4, 8, 16 min
PRAZO_DA_REIVINDICACAO = timedelta(minutes=5)
MOTIVO_MOVER = ("O GrowthHS ainda não tem rota para mover card de etapa — "
                "pedido registrado no contrato (docs/contratos/"
                "2026-09-02-endpoint-card-comercial-growthhs.md).")

_COLUNAS_LEAD = """id::text AS id, nome, email, whatsapp, phone_normalized, empresa,
    cargo, faturamento, funcionarios, desafios, indicacao, utm_source, utm_medium,
    utm_campaign, utm_term, utm_content, lead_score, etiqueta,
    dnia_id::text AS dnia_id, deleted_at"""


async def enfileirar(conn, lead_id: str, origem: str, *, acao: str = "criar",
                     rule_id: str | None = None,
                     journey_run_id: str | None = None) -> int | None:
    """Um pedido por lead e ação enquanto pendente; o segundo é absorvido."""
    return await conn.fetchval(
        """INSERT INTO crm_handoffs (lead_id, acao, origem, rule_id, journey_run_id)
           VALUES ($1::uuid, $2, $3, $4::uuid, $5::uuid)
           ON CONFLICT (lead_id, acao) WHERE status = 'pendente' DO NOTHING
           RETURNING id""",
        lead_id, acao, origem, rule_id, journey_run_id)


async def _reivindicar(limite: int, somente_lead: str | None) -> list[dict]:
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            """UPDATE crm_handoffs SET visivel_em = now() + $2::interval,
                      tentativas = tentativas + 1, atualizado_em = now()
                WHERE id IN (SELECT id FROM crm_handoffs
                              WHERE status = 'pendente' AND visivel_em <= now()
                                AND ($3::uuid IS NULL OR lead_id = $3::uuid)
                              ORDER BY visivel_em LIMIT $1
                              FOR UPDATE SKIP LOCKED)
            RETURNING id, lead_id::text AS lead_id, acao, origem, rule_id::text AS rule_id,
                      journey_run_id::text AS journey_run_id, tentativas""",
            limite, PRAZO_DA_REIVINDICACAO, somente_lead)
    return [dict(l) for l in linhas]


async def _registrar_evento(conn, lead: dict, tipo: str, titulo: str, metadata: dict) -> None:
    await conn.execute(
        """INSERT INTO contact_events (dnia_id, lead_id, source_app, event_type, title, metadata)
           VALUES ($1::uuid, $2::uuid, 'marketinghs', $3, $4, $5::jsonb)""",
        lead.get("dnia_id"), lead["id"], tipo, titulo, metadata)


async def _falhar(pedido: dict, lead: dict | None, erro: str) -> None:
    async with sessao(role="service_role") as conn:
        await conn.execute(
            """UPDATE crm_handoffs SET status = 'falhou', erro = $2, atualizado_em = now()
                WHERE id = $1""", pedido["id"], erro[:1000])
        if lead:
            await _registrar_evento(conn, lead, "crm_handoff_falhou",
                                    "Não foi possível enviar ao comercial (GrowthHS)",
                                    {"origem": pedido["origem"], "rule_id": pedido["rule_id"],
                                     "erro": erro[:400]})


async def _entregar(pedido: dict, cfg: growthhs.Config, transporte) -> str:
    async with sessao(role="service_role") as conn:
        lead = await conn.fetchrow(
            f"SELECT {_COLUNAS_LEAD} FROM leads WHERE id = $1::uuid", pedido["lead_id"])
        anterior = await conn.fetchrow(
            """SELECT card_id, person_id FROM crm_handoffs
                WHERE lead_id = $1::uuid AND acao = 'criar' AND status = 'entregue'
                ORDER BY id LIMIT 1""", pedido["lead_id"])
    lead = dict(lead) if lead else None

    if lead is None or lead["deleted_at"] is not None:
        await _falhar(pedido, None, "O contato foi excluído antes da entrega.")
        return "falhas"
    if pedido["acao"] == "mover":
        await _falhar(pedido, lead, MOTIVO_MOVER)
        return "falhas"
    if anterior:
        async with sessao(role="service_role") as conn:
            await conn.execute(
                """UPDATE crm_handoffs SET status = 'entregue', card_id = $2, person_id = $3,
                          erro = 'já estava no GrowthHS', atualizado_em = now()
                    WHERE id = $1""", pedido["id"], anterior["card_id"], anterior["person_id"])
        return "ja_entregues"

    try:
        resposta = await growthhs.criar_card(cfg, growthhs.montar_card(lead, cfg.board_id),
                                             transporte=transporte)
    except growthhs.ErroDefinitivo as erro:
        await _falhar(pedido, lead, str(erro))
        return "falhas"
    except growthhs.ErroTransitorio as erro:
        if pedido["tentativas"] >= MAX_TENTATIVAS:
            await _falhar(pedido, lead, f"{erro} (desistiu após {pedido['tentativas']} tentativas)")
            return "falhas"
        espera = ESPERA_BASE * (2 ** (pedido["tentativas"] - 1))
        async with sessao(role="service_role") as conn:
            await conn.execute(
                """UPDATE crm_handoffs SET visivel_em = now() + $2::interval, erro = $3,
                          atualizado_em = now() WHERE id = $1""",
                pedido["id"], espera, str(erro)[:1000])
        return "adiadas"

    card_id, person_id = resposta.get("id"), resposta.get("person_id")
    async with sessao(role="service_role") as conn:
        await conn.execute(
            """UPDATE crm_handoffs SET status = 'entregue', card_id = $2, person_id = $3,
                      erro = NULL, atualizado_em = now() WHERE id = $1""",
            pedido["id"], card_id, person_id)
        if lead["dnia_id"]:
            await conn.execute(
                """UPDATE ecosystem_identities SET growthhs_card_id = $2,
                          growthhs_person_id = coalesce($3, growthhs_person_id)
                    WHERE dnia_id = $1::uuid""", lead["dnia_id"], card_id, person_id)
        await _registrar_evento(conn, lead, "crm_handoff", "Enviado ao comercial (GrowthHS)",
                                {"origem": pedido["origem"], "rule_id": pedido["rule_id"],
                                 "card_id": card_id, "created": resposta.get("created")})
    return "entregues"


async def rodar_entregas(*, limite: int = 20, cfg: growthhs.Config | None = None,
                         transporte=None, somente_lead: str | None = None) -> dict:
    """Um ciclo do worker. Sem configuração, NÃO reivindica — o pedido fica
    pendente, e quem configurar vê a fila andar (mesmo desenho do Resend).

    ⚠️ `somente_lead` existe para os testes: eles rodam contra o banco de
    produção, e um ciclo sem filtro reivindicaria os pedidos REAIS e os
    "entregaria" ao transporte falso do teste, com card inventado."""
    cfg = cfg or await growthhs.ler_config()
    if not cfg.configurado:
        return {"desligado": True}
    contagem = {"entregues": 0, "ja_entregues": 0, "adiadas": 0, "falhas": 0}
    for pedido in await _reivindicar(limite, somente_lead):
        try:
            contagem[await _entregar(pedido, cfg, transporte)] += 1
        except Exception:
            # Defeito nosso (não do GrowthHS): o prazo da reivindicação vence
            # e o pedido volta. Logar é o mínimo — não engolir calado.
            logger.exception("[crm] pedido %s quebrou na entrega", pedido["id"])
    return contagem
```

- [ ] **Step 4: O worker**

Em `backend/app/worker.py`, no mesmo ritmo das jornadas: leia `principal()` e
`_rodar_jornadas()` e acrescente uma chamada a `entrega.rodar_entregas()` no
mesmo bloco temporizado das jornadas (a cada `JORNADAS_INTERVALO`), com o
mesmo tratamento de exceção que o bloco já usa, logando o resultado quando
houver entrega/falha e, **uma vez por processo**, avisando `"[crm] GrowthHS
não configurado — a fila de entrega espera"` quando vier `{"desligado": True}`.
Atualize o docstring do módulo ("drena a fila de e-mail, promove campanhas,
roda as jornadas **e entrega os leads ao GrowthHS**"). Import: `from app.crm import entrega`.

- [ ] **Step 5: Rodar e ver passar** — `cd backend && ./.venv/bin/pytest -q tests/test_crm_entrega.py` → `7 passed`.
  Rode também `tests/test_fila.py` (o worker é o mesmo módulo; nada pode quebrar).

- [ ] **Step 6: Commit**

```bash
git add backend/app/crm/entrega.py backend/app/worker.py backend/tests/test_crm_entrega.py
git commit -m "feat(8D): a fila de entrega ao GrowthHS e o worker que a drena"
```

---

### Tarefa 5: Os três caminhos — regra, jornada e botão

**Files:**
- Create: `backend/migrations/019_regras_de_automacao.sql`
- Create: `backend/app/routers/crm.py`
- Modify: `backend/app/main.py` (registrar `crm.router`)
- Modify: `backend/app/jornadas/executor.py`
- Modify: `backend/app/routers/automacoes.py` (docstring do topo; prévia), `api_contato.py` (docstring de `atualizar_status`), `escrita_contatos.py` (comentário de `excluir_contato`)
- Test: `backend/tests/test_crm_caminhos.py`

**Interfaces:**
- Consumes: `entrega.enfileirar` (T4); tabela `crm_handoffs`, vocabulário novo (T1).
- Produces: gatilho `trg_automation_on_etiqueta_change` (AFTER INSERT OR UPDATE OF etiqueta, status, lead_score ON leads); `POST /crm/enviar/{lead_id}` (admin) → `{"handoff_id": int | None, "ja_na_fila": bool}`; nó `handoff_growthhs` enfileira e avança.

- [ ] **Step 1: Testes**

`backend/tests/test_crm_caminhos.py`:

```python
"""Os três caminhos até a fila de entrega.

O modo de falhar é o da origem que este lote conserta: regra cadastrada que
nunca dispara, e ninguém percebe, porque a tela de automações mostra a regra
"ativa". E o inverso: uma regra mal preenchida derrubando a gravação do lead.
"""

import pytest_asyncio

import app.database as db
from app.jornadas import executor

EMAIL = "caminhos-8d@exemplo.invalid"


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _regra(conexao, condicoes, acao="create_in_growthhs", prioridade=0, logica="and"):
    return str(await conexao.fetchval(
        """INSERT INTO automation_rules (name, priority, condition_type, condition_operator,
                                         condition_value, conditions, condition_logic, action_type)
           VALUES ('8D', $1, 'etiqueta', 'is', 'x', $2::jsonb, $3, $4) RETURNING id""",
        prioridade, condicoes, logica, acao))


async def _lead(conexao, **campos) -> str:
    campos = {"nome": "Caminhos 8D", "email": EMAIL, "tipo": "teste", **campos}
    nomes = ", ".join(campos)
    marcas = ", ".join(f"${i}" for i in range(1, len(campos) + 1))
    return str(await conexao.fetchval(
        f"INSERT INTO leads ({nomes}) VALUES ({marcas}) RETURNING id", *campos.values()))


async def _pedidos(conexao, lead):
    return await conexao.fetch(
        "SELECT acao, origem, rule_id::text FROM crm_handoffs WHERE lead_id = $1::uuid", lead)


async def test_regra_de_etiqueta_enfileira_ao_mudar(conexao):
    regra = await _regra(conexao, [{"type": "etiqueta", "operator": "is", "value": "hotlead"}])
    lead = await _lead(conexao)
    assert await _pedidos(conexao, lead) == []
    await conexao.execute("UPDATE leads SET etiqueta = 'hotlead' WHERE id = $1::uuid", lead)
    assert [dict(p) for p in await _pedidos(conexao, lead)] == [
        {"acao": "criar", "origem": "regra", "rule_id": regra}]


async def test_regra_de_status_tambem_dispara(conexao):
    """A origem só avaliava na mudança de ETIQUETA (achado 7). ⚠️ `leads.status`
    tem FK para `lead_statuses` (8B): o valor tem de existir lá."""
    lead = await _lead(conexao)
    atual = await conexao.fetchval("SELECT status FROM leads WHERE id = $1::uuid", lead)
    alvo = await conexao.fetchval(
        "SELECT name FROM lead_statuses WHERE name IS DISTINCT FROM $1 "
        "ORDER BY sort_order DESC LIMIT 1", atual)
    await _regra(conexao, [{"type": "status", "operator": "is", "value": alvo}])
    await conexao.execute("UPDATE leads SET status = $2 WHERE id = $1::uuid", lead, alvo)
    assert len(await _pedidos(conexao, lead)) == 1


async def test_bloqueio_de_prioridade_maior_para_a_avaliacao(conexao):
    await _regra(conexao, [{"type": "etiqueta", "operator": "is", "value": "hotlead"}],
                 acao="block_growthhs", prioridade=10)
    await _regra(conexao, [{"type": "etiqueta", "operator": "is", "value": "hotlead"}],
                 prioridade=1)
    lead = await _lead(conexao, etiqueta="hotlead")
    assert await _pedidos(conexao, lead) == []


async def test_regra_mal_formada_nao_derruba_a_gravacao_do_lead(conexao):
    """`'abc'::int` estoura dentro do gatilho — na origem, abortava o INSERT do
    lead. (O `lead_score` é recalculado por `trg_score_lead_on_change`; o valor
    não importa aqui, o cast falha antes da comparação.)"""
    await _regra(conexao, [{"type": "score", "operator": "greater_than", "value": "abc"}])
    lead = await _lead(conexao)
    assert await conexao.fetchval("SELECT count(*) FROM leads WHERE id = $1::uuid", lead) == 1


async def test_mover_etapa_enfileira_como_mover(conexao):
    await _regra(conexao, [{"type": "etiqueta", "operator": "is", "value": "hotlead"}],
                 acao="move_stage_growthhs")
    lead = await _lead(conexao, etiqueta="hotlead")
    assert [p["acao"] for p in await _pedidos(conexao, lead)] == ["mover"]


async def test_no_de_jornada_enfileira_e_avanca(conexao, monkeypatch):
    lead = await _lead(conexao)
    passos = []

    async def registrar(conn, run, no, resultado, detalhe=None):
        passos.append((resultado, detalhe))
    monkeypatch.setattr(executor, "registrar_passo", registrar)

    run = {"run_id": "00000000-0000-0000-0000-0000000000a1", "lead_id": lead,
           "journey_id": "00000000-0000-0000-0000-0000000000b1", "context": {}}
    no = {"id": "n1", "type": "handoff_growthhs", "config": {}, "next": "n2"}
    saida = await executor.executar_no(conexao, run, no)
    assert saida == {"tipo": "avancar", "proximo": "n2"}
    assert [p["origem"] for p in await _pedidos(conexao, lead)] == ["jornada"]
    assert passos[0][0] == "enqueued"


@pytest_asyncio.fixture
async def lead_real():
    await db.init_db()

    async def limpar():
        # `fn_lead_insert_event` grava contact_event (e journey_event) sem FK.
        async with db.sessao(role="service_role") as conn:
            ids = [r["id"] for r in await conn.fetch(
                "SELECT id FROM leads WHERE email = $1", EMAIL)]
            await conn.execute("DELETE FROM journey_events WHERE lead_id = ANY($1::uuid[])", ids)
            await conn.execute("DELETE FROM contact_events WHERE lead_id = ANY($1::uuid[])", ids)
            await conn.execute("DELETE FROM leads WHERE id = ANY($1::uuid[])", ids)
    await limpar()
    async with db.sessao(role="service_role") as conn:
        lead = await conn.fetchval(
            "INSERT INTO leads (nome, email, tipo) VALUES ('Botão 8D', $1, 'teste') "
            "RETURNING id::text", EMAIL)
    yield lead
    await limpar()


async def test_botao_manual_exige_admin_e_enfileira_uma_vez(cliente, token_admin,
                                                            token_usuario, lead_real):
    r = await cliente.post(f"/crm/enviar/{lead_real}", headers=_auth(token_usuario))
    assert r.status_code == 403
    r = await cliente.post(f"/crm/enviar/{lead_real}", headers=_auth(token_admin))
    assert r.status_code == 202 and r.json()["ja_na_fila"] is False
    r = await cliente.post(f"/crm/enviar/{lead_real}", headers=_auth(token_admin))
    assert r.json() == {"handoff_id": None, "ja_na_fila": True}
    r = await cliente.post("/crm/enviar/00000000-0000-0000-0000-000000000000",
                           headers=_auth(token_admin))
    assert r.status_code == 404
```

⚠️ `journey_run_id` do teste do nó é um uuid qualquer — `crm_handoffs.journey_run_id`
não tem FK, de propósito (o run pode ser apagado; o pedido fica como histórico).

- [ ] **Step 2: Rodar e ver falhar** — `cd backend && ./.venv/bin/pytest -q tests/test_crm_caminhos.py`.

- [ ] **Step 3: A migration 019 — o avaliador**

`backend/migrations/019_regras_de_automacao.sql`: `CREATE OR REPLACE FUNCTION public.evaluate_automation_on_etiqueta()` + o gatilho. O corpo é o da origem
(extraia com `pg_restore -f - docs/63cb903c-ece5-4157-8f7f-e7dc4686df2d_260831.backup | awk '/CREATE FUNCTION public.evaluate_automation_on_etiqueta/,/^\$\$;/'`),
com estas mudanças, e **só** estas:

1. `RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'` (igual à origem).
2. Saída cedo: `IF TG_OP = 'UPDATE' AND OLD.etiqueta IS NOT DISTINCT FROM NEW.etiqueta AND OLD.status IS NOT DISTINCT FROM NEW.status AND OLD.lead_score IS NOT DISTINCT FROM NEW.lead_score THEN RETURN NEW; END IF;` (achado 7 — a origem só olhava a etiqueta, e o navegador cobria o status).
3. Cada iteração do laço de regras vira um bloco `BEGIN ... EXCEPTION WHEN others THEN RAISE WARNING 'regra de automação % ignorada: %', v_rule.id, SQLERRM; END;` envolvendo a avaliação (achado 8). O `v_final_matched` é zerado no início de cada iteração.
4. As declarações `v_url` e `v_anon_key`, o `current_setting('app.settings.supabase_url')`, o JWT anônimo cravado e o `PERFORM net.http_post(...)` **saem inteiros**.
5. No lugar deles, quando a regra casa:

```sql
    IF v_final_matched THEN
      IF v_rule.action_type = 'block_growthhs' THEN
        RETURN NEW;
      END IF;
      INSERT INTO public.crm_handoffs (lead_id, acao, origem, rule_id)
      VALUES (NEW.id,
              CASE WHEN v_rule.action_type = 'move_stage_growthhs' THEN 'mover' ELSE 'criar' END,
              'regra', v_rule.id)
      ON CONFLICT (lead_id, acao) WHERE status = 'pendente' DO NOTHING;
      RETURN NEW;
    END IF;
```

6. O gatilho:

```sql
DROP TRIGGER IF EXISTS trg_automation_on_etiqueta_change ON public.leads;
CREATE TRIGGER trg_automation_on_etiqueta_change
    AFTER INSERT OR UPDATE OF etiqueta, status, lead_score ON public.leads
    FOR EACH ROW EXECUTE FUNCTION public.evaluate_automation_on_etiqueta();
```

Cabeçalho da migration: de onde vem o corpo, as seis mudanças e por quê,
"primeira regra que casa, por prioridade, decide — como na origem", e
"reaplicável". Aplique duas vezes (comando da Tarefa 1).

- [ ] **Step 4: O nó de jornada**

Em `backend/app/jornadas/executor.py`, troque o ramo `if tipo == "handoff_nexus":` por:

```python
    if tipo == "handoff_growthhs":
        # Enfileira e segue: quem entrega é o worker (app/crm/entrega.py), com
        # re-tentativa e falha à vista na linha do tempo do contato. O fluxo
        # não espera o GrowthHS — um CRM fora do ar não pode parar as jornadas.
        from app.crm.entrega import enfileirar

        pedido = await enfileirar(conn, str(run["lead_id"]), "jornada",
                                  journey_run_id=str(run["run_id"]))
        await registrar_passo(conn, run, no, "enqueued",
                              {"handoff_id": pedido, "ja_na_fila": pedido is None})
        return {"tipo": "avancar", "proximo": no.get("next")}
```

- [ ] **Step 5: O botão manual**

`backend/app/routers/crm.py`:

```python
"""O botão "Enviar ao comercial" do contato — o modo `manual` do
handoff-to-nexus. Enfileira; quem entrega é o worker (decisão 3 do 8D)."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.crm.entrega import enfileirar
from app.database import sessao
from app.dependencies import Usuario, admin_atual

router = APIRouter(prefix="/crm", tags=["crm"])


@router.post("/enviar/{lead_id}", status_code=status.HTTP_202_ACCEPTED)
async def enviar_ao_comercial(lead_id: UUID, _: Usuario = Depends(admin_atual)):
    """⚠️ `admin_atual`: a origem exigia chamador privilegiado para o modo
    manual. `service_role` porque a fila não tem política para `authenticated`
    — quem autoriza é a rota."""
    async with sessao(role="service_role") as conn:
        existe = await conn.fetchval(
            "SELECT 1 FROM leads WHERE id = $1::uuid AND deleted_at IS NULL", str(lead_id))
        if not existe:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Contato não encontrado.")
        pedido = await enfileirar(conn, str(lead_id), "manual")
    return {"handoff_id": pedido, "ja_na_fila": pedido is None}
```

Registre em `main.py` (`from app.routers.crm import router as crm_router` e
`app.include_router(crm_router)` junto dos outros).

- [ ] **Step 6: A prévia e os comentários**

- `automacoes.py`: reescreva o docstring do topo (as ações agora são do
  GrowthHS, o gatilho `trg_automation_on_etiqueta_change` avalia e enfileira —
  migration 019 —, o worker entrega). Na prévia, `ei.nexus_contact_id IS NOT NULL`
  vira `ei.growthhs_card_id IS NOT NULL` (quem já está no GrowthHS não conta)
  — atualize o comentário ao redor.
- `api_contato.py`, docstring de `atualizar_status`: o handoff agora é
  disparado pelo gatilho das regras em QUALQUER mudança de status, inclusive
  por esta rota; o estágio da identidade continua não avançando.
- `escrita_contatos.py`, comentário de `excluir_contato`: excluir não apaga o
  card no GrowthHS (decisão 12 do 8D — o contrato não tem rota de exclusão).

- [ ] **Step 7: Rodar e ver passar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_crm_caminhos.py tests/test_crm_entrega.py tests/test_api_contato.py`
Esperado: `7 passed` no primeiro; os outros continuam passando.

⚠️ Se `test_api_contato.py` ou outro teste de escrita de lead passar a deixar
linha em `crm_handoffs`: não é vazamento — a FK é `ON DELETE CASCADE`, e a
limpeza das fixtures apaga o lead.

- [ ] **Step 8: Commit**

```bash
git add backend/migrations/019_regras_de_automacao.sql backend/app/routers/crm.py \
        backend/app/main.py backend/app/jornadas/executor.py backend/app/routers/automacoes.py \
        backend/app/routers/api_contato.py backend/app/routers/escrita_contatos.py \
        backend/tests/test_crm_caminhos.py
git commit -m "feat(8D): regra, jornada e botão levam o lead à fila do GrowthHS"
```

---

### Tarefa 6: As telas de automação, jornada e o botão

**Files (confira cada caminho com `grep -rln` antes):**
- `frontend/src/lib/automacoes.ts`, `frontend/src/components/admin/automations/AutomationRuleForm.tsx`, `frontend/src/pages/admin/Automations.tsx`
- `frontend/src/lib/journeys.ts`, `NodeConfigDialog.tsx`, `JourneyBuilder.tsx`
- `LeadDetailSheet.tsx`, `QualifiedBanner.tsx`, `StatusDropdown.tsx` (só o comentário)
- `DetailSections.tsx` / `EventsTimeline.tsx` — rótulos dos eventos novos

**Interfaces:**
- Consumes: vocabulário `create_in_growthhs` | `move_stage_growthhs` | `block_growthhs`, nó `handoff_growthhs` (T1); `POST /crm/enviar/{lead_id}` → 202 `{handoff_id, ja_na_fila}` (T5); eventos `crm_handoff` e `crm_handoff_falhou` (T4).

- [ ] **Step 1: Automações.** `ACTION_TYPES` com os três valores novos e rótulos
  "Criar card no GrowthHS", "Mover etapa no GrowthHS", "Não enviar ao GrowthHS
  (bloquear)". `AUTOMACAO_NAO_LIGADA` deixa de valer para criar/bloquear; fica
  **só** para `move_stage_growthhs`, com o texto: "O GrowthHS ainda não tem
  como mover card de etapa. Uma regra destas é registrada e falha na entrega,
  à vista — ela passa a funcionar quando o GrowthHS ganhar a rota." O campo
  "Estágio do pipeline" (`action_value`) some para criar/bloquear (o card entra
  na etapa de entrada do funil configurado); para mover, fica como texto. Os
  banners/textos de "nada dispara" da tela de Automações e do topo de
  `lib/automacoes.ts` passam a dizer o que acontece agora: "Quando um contato
  muda de etiqueta, status ou pontuação, a primeira regra ativa que casar
  (por prioridade) envia o contato ao GrowthHS. A entrega aparece na linha do
  tempo do contato; falhas, em Configurações → GrowthHS."
- [ ] **Step 2: Jornadas.** Em `lib/journeys.ts`, o tipo `handoff_nexus` vira
  `handoff_growthhs` (tipo TS, `NODE_LABELS` → "Enviar ao GrowthHS"); sai do
  `NODE_NAO_LIGADO`. `NodeConfigDialog.tsx`: o nó é válido sem configuração;
  no lugar do aviso, o texto "O contato entra na etapa de entrada do funil
  configurado em Configurações → GrowthHS. A entrega acontece em segundo
  plano; o fluxo segue sem esperar." `JourneyBuilder.tsx`: rótulo sem
  `stage_name`.
- [ ] **Step 3: O botão.** Em `LeadDetailSheet.tsx` e `QualifiedBanner.tsx`,
  "Enviar para Nexus" vira **"Enviar ao comercial"**, habilitado para admin
  (use o mesmo critério de papel que a tela já usa em outros botões de admin —
  procure por `isAdmin`/`papel` no arquivo ou em `useAuth`), chamando
  `api.post(\`/crm/enviar/${leadId}\`)`: toast "Enviado para a fila do
  comercial" (ou "Já estava na fila" quando `ja_na_fila`); erro → toast com a
  mensagem da API. Em `StatusDropdown.tsx`, atualize o comentário que diz que a
  avaliação volta "no lote 5": ela voltou, no servidor (migration 019).
- [ ] **Step 4: Linha do tempo.** Rótulos para `crm_handoff` ("Enviado ao
  comercial (GrowthHS)") e `crm_handoff_falhou` ("Falha ao enviar ao
  comercial" + `metadata.erro`) onde a tela mapeia `event_type` para rótulo
  (hoje há `direct_nexus_send`/`manual_nexus_send` — deixe-os, são histórico).
- [ ] **Step 5: Aceite**

```bash
grep -rn "create_in_nexus\|move_stage_nexus\|block_nexus\|handoff_nexus" frontend/src   # vazio
grep -rn "Enviar para Nexus" frontend/src                                              # vazio
cd frontend && npx tsc --noEmit -p tsconfig.app.json && npx vite build
```

Nenhum erro de `tsc` novo (os 3 pré-existentes que sobraram depois da T3 ficam).

- [ ] **Step 6: Commit** — `git commit -m "feat(8D): automações, jornadas e o botão falam GrowthHS"` (com os arquivos tocados).

---

### Tarefa 7: As telas de contato mostram o GrowthHS

**Files:**
- Modify: `backend/app/routers/leitura_contatos.py` (`/contatos/enriquecimento`)
- Modify: `frontend/src/hooks/useContactsEnriched.tsx`, `frontend/src/lib/leitura.ts` (tipos), `ContactsTable.tsx`, `DetailSections.tsx` (e onde mais o `grep` abaixo achar o link do CRM antigo)
- Test: `backend/tests/test_leitura_growthhs.py`

**Interfaces:**
- Consumes: `growthhs.ler_config()` e `Config.url_do_card` (T2); `ecosystem_identities.growthhs_card_id` (T1).
- Produces: cada item de `/contatos/enriquecimento` ganha `growthhs_card_id: int | None` e `growthhs_card_url: str | None` (o link pronto — o frontend comum não lê a configuração, que é de admin).

- [ ] **Step 1: Teste** — `backend/tests/test_leitura_growthhs.py`: com
  `config_growthhs("https://api.exemplo.invalid", 3, "https://app.exemplo.invalid")`,
  uma identidade com `growthhs_card_id = 4821` aparece no enriquecimento com
  `growthhs_card_url == "https://app.exemplo.invalid/cards/4821"`; sem
  `app_url`, `growthhs_card_url` é `None` e o `growthhs_card_id` continua.
  Siga o jeito de chamar a rota que `tests/` já usa para `/contatos/enriquecimento`
  (procure com `grep -rn enriquecimento backend/tests`; se não houver, use o
  `cliente` com `token_admin` e `POST /contatos/enriquecimento` com
  `{"dnia_ids": [...]}`). Crie e apague a identidade no próprio teste.
- [ ] **Step 2: Backend** — a consulta de identidades passa a trazer
  `growthhs_card_id`; `cfg = await growthhs.ler_config()` uma vez por request;
  cada item recebe `growthhs_card_id` e `growthhs_card_url = cfg.url_do_card(...)`.
  Os campos `nexus_*` ficam (agendamento).
- [ ] **Step 3: Frontend** — tipos novos no enriquecimento; onde a tela monta
  `https://nexus.dnia.ai/crm/contacts/{id}` ("Ver no Nexus", link do **CRM**
  antigo), passa a mostrar **"Ver no GrowthHS"** com `growthhs_card_url`
  (só quando existir); ao lado das pílulas existentes, uma pílula "GrowthHS"
  quando `growthhs_card_id` existir. As pílulas "Nexus" **não mudam**
  (restrição global).
- [ ] **Step 4: Aceite**

```bash
grep -rn "nexus.dnia.ai/crm" frontend/src          # vazio
cd backend && ./.venv/bin/pytest -q tests/test_leitura_growthhs.py
cd ../frontend && npx tsc --noEmit -p tsconfig.app.json && npx vite build
```

- [ ] **Step 5: Commit** — `git commit -m "feat(8D): contato mostra o card no GrowthHS no lugar do link do CRM antigo"`.

---

### Tarefa 8: O portão

- [ ] **Step 1: Buscas**

```bash
cd /home/ericks/github/MarketingHS
grep -rn "handoff-to-nexus\|nexus-config\|get-nexus-stages" frontend/src frontend/public backend/app
grep -rln "integrations/supabase" frontend/src      # só LimiteDeErro.tsx
grep -rn "supabase" frontend/src --include=*.ts --include=*.tsx | grep -v "integrations/supabase\|LimiteDeErro"
```

Esperado: a primeira vazia (fora comentários de linhagem em `backend/app` —
liste-os); a segunda só `LimiteDeErro.tsx` — **é o critério do 8E**; a terceira,
só comentários.

- [ ] **Step 2: A suíte inteira** — `cd backend && ./.venv/bin/pytest -q`,
  primeiro plano (ou em segundo plano com `timeout 1700` e esperando), nunca
  interromper. Anote o número.

- [ ] **Step 3: No navegador** (conta admin do Claude, `~/.config/marketinghs/claude-admin.env`;
  Vite em `127.0.0.1:8080`, backend na 8100; conferir as portas antes):
  1. Configurações → GrowthHS: gravar endereço `https://growthhs.exemplo.invalid`,
     funil `3`, chave qualquer; recarregar e ver voltar (chave mascarada);
     "Testar conexão" mostra o erro de rede sem quebrar a tela; limpar a chave.
  2. Automações: criar uma regra "etiqueta é hotlead → Criar card no GrowthHS";
     o aviso de "não ligado" só aparece para "Mover etapa".
  3. Jornadas: um nó "Enviar ao GrowthHS" salva sem configuração.
  4. Contato: "Enviar ao comercial" → toast; segunda vez → "Já estava na
     fila"; a fila aparece em Configurações → GrowthHS como "1 aguardando".
  5. Zero erro de console.
  6. **Limpar tudo**: regra, jornada, pedidos em `crm_handoffs`, e
     `growthhs_config` + a chave de volta ao que eram (hoje: vazias).

- [ ] **Step 4: Capacidade por capacidade** contra a origem:

```bash
git show 883727b:backend/supabase/functions/handoff-to-nexus/index.ts
git show 883727b:backend/supabase/functions/nexus-config/index.ts
git show 883727b:backend/supabase/functions/get-nexus-stages/index.ts
git show 883727b:backend/supabase/functions/_shared/nexusConfig.ts
git show 883727b:frontend/src/components/admin/settings/NexusCard.tsx
```

Cada capacidade: onde mora agora, ou qual decisão do plano a mudou. Em
especial: os três modos (A descartado — dec. 2; B → botão; C → gatilho), a
revalidação/busca de contato do Nexus (substituída pela idempotência do
contrato + guarda da dec. 4), o `value: 30000` (dec. 8), o mover etapa (dec.
6), a lista de etapas (`get-nexus-stages` — sem equivalente no contrato; o
card entra na etapa de entrada, dec. 7), o cache de 30 s sem invalidação (o
`integracoes` tem o próprio cache de 60 s e o `gravar_segredo` invalida),
os eventos `direct_nexus_send`/`manual_nexus_send`/`automation_executed` (→
`crm_handoff` com `metadata.origem`).

- [ ] **Step 5: As functions saem**

```bash
git rm -r backend/supabase/functions/handoff-to-nexus backend/supabase/functions/nexus-config \
          backend/supabase/functions/get-nexus-stages backend/supabase/functions/_shared/nexusConfig.ts
ls backend/supabase/functions/     # só _shared (o 8E apaga a pasta)
```

- [ ] **Step 6: Contrato e registro**

- `docs/contratos/2026-09-02-endpoint-card-comercial-growthhs.md`: seção
  "Pedidos acrescentados em 21/09 (lote 8D)" — (a) rota para **mover card de
  etapa** (a regra `move_stage_growthhs` falha à vista até existir); (b) o que
  fazer com o card quando o contato é **excluído** no MarketingHS; (c) uma rota
  de leitura autenticada barata (para o "Testar conexão" conferir a chave).
  Estado do documento: "o lado do MarketingHS está pronto (lote 8D); falta o
  endpoint".
- `docs/CONTINUAR-AQUI.md`: bloco do 8D no topo (o que entrou, decisões do
  Erick de 21/09, número da suíte, o que falta para ligar: chave, funil, URL —
  itens 1-3 da seção "O que o MarketingHS precisa receber de volta" do
  contrato).
- Placar (documento-mãe e CONTINUAR): **47 portadas, 7 descartadas, restam 0**
  (anote que o modo público `direct_stage` foi descartado *dentro* de uma
  function portada — não muda a contagem de functions). O 8E é o próximo.

- [ ] **Step 7: Commit** — `git add -A docs/ backend/supabase/functions/ && git commit -m "chore(8D): o portão fecha — handoff-to-nexus, nexus-config e get-nexus-stages saem"`.

---

## Autorrevisão deste plano

**Cobertura (documento-mãe §8D e spec §8.A):** `handoff-to-nexus` → T2
(corpo/erro), T4 (entrega), T5 (os caminhos); `nexus-config` → T3;
`get-nexus-stages` → sem equivalente (dec. 7, conferido na T8);
`NexusCard` → T3; idempotência → dec. 4 (guarda + `external_id`);
`growthhs_config` → T1; `ecosystem_identities.growthhs_*` → T1/T4/T7;
`Automations.tsx:38-40` → T6; `StatusDropdown`/`DetailSections` → T6/T7.
Decisão do Erick de 21/09 (avaliador) → T5; modo público descartado → dec. 2.

**Nomes entre tarefas:** `Config`, `ler_config`, `montar_card`, `criar_card`,
`testar`, `ErroDefinitivo`, `ErroTransitorio`, `SEGREDO_CHAVE`,
`Config.url_do_card` (T2) → T3, T4, T7. `enfileirar`, `rodar_entregas`,
`MAX_TENTATIVAS` (T4) → T5 e worker. Vocabulário (T1) → gatilho (T5) e telas
(T6). Eventos `crm_handoff`/`crm_handoff_falhou` (T4) → T6.

**Riscos conhecidos:**
- O gatilho da 019 roda em TODA escrita de lead que mexe em etiqueta, status
  ou pontuação — inclusive nos testes de outros arquivos. Com `automation_rules`
  vazia (hoje), é um laço vazio. Um teste que crie regra ativa tem de apagá-la.
- A faixa "Entre 100k e 500k" era engolida pela primeira faixa na origem; a
  T2 corrige de propósito e o relatório tem de dizer isso.
- `rodar_entregas` só faz sentido com o endpoint no ar. Até lá, a fila
  acumula pedidos pendentes (visíveis em Configurações). Quando o GrowthHS
  ligar, o primeiro ciclo entrega o acumulado — 20 por ciclo de 20 s.
