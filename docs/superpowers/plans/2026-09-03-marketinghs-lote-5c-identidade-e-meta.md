# Lote 5C — Identidade unificada e Meta CAPI

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para executar tarefa a tarefa.
> Os passos usam caixa de seleção (`- [ ]`) para acompanhamento.

**Objetivo:** fechar o elo identidade→contato de modo que ele não possa mais
arrebentar, e portar o Meta CAPI parametrizado, sem expor endpoint público de
evento.

**Arquitetura:** o vínculo canônico passa a ser garantido por gatilho no banco
(com `FK` e backfill), em vez de por cada escritor lembrar de preenchê-lo — que é
como ele quebrou duas vezes. O Meta CAPI vira um módulo de domínio em Python com
as credenciais em `integration_secrets`, no mesmo desenho do Resend; **nenhum
endpoint de evento é exposto** — o disparo nasce no lote 7, do lado do servidor.

**Stack:** FastAPI + asyncpg · PL/pgSQL · React 18 + TanStack Query · httpx · pytest

**Spec:** `docs/superpowers/specs/2026-08-31-marketinghs-design.md` — seções 8.C
(identidade unificada) e 9 (travas de terceiro).

---

## Restrições globais

Valem para **toda** tarefa deste plano.

- **`sessao()` é o único caminho para dado.** O backend conecta como
  `marketinghs_app`, `NOINHERIT`, sem privilégio em `public`. Sem o
  `SET LOCAL ROLE` que a `sessao()` emite, a query falha com permissão negada —
  é proposital. Nunca conecte como superusuário.
- **`role="service_role"` tem `BYPASSRLS`.** Só para operação interna. Nunca
  para request de usuário.
- **Nenhum endpoint depende do RLS para autorizar.** Cada rota autoriza sozinha,
  por `usuario_atual` / `admin_atual`.
- **O papel é `'admin'`**, não `'administrador'`.
- **Toda chave lida do ambiente precisa estar declarada em `Settings`.** O
  `pydantic-settings` recusa chave desconhecida no `.env` e derruba o boot
  inteiro. `app/config.py:5` não tem `extra="ignore"` — conferido.
- **`.env` nunca é versionado.**
- **Não escreva `CREATE EXTENSION`.** `gen_random_uuid()` é core desde o
  Postgres 13.
- **Os três índices únicos parciais de envio são intocáveis:**
  `uniq_campaign_sends_email_campaign_lead`, `uniq_campaign_sends_journey_node`,
  `uniq_journey_runs_open`.
- **Backend na porta 8100** no host (a 8000 é do TaskHS nesta máquina).
  Frontend em `127.0.0.1:8080`.
- **Testes:** `cd backend && ./.venv/bin/pytest -q`. A fixture `conexao`
  (`backend/tests/conftest.py`) abre transação com `SET LOCAL ROLE service_role`
  e **sempre reverte** — nenhum teste deixa linha para trás.
  ⚠️ Matar o pytest no meio vaza dado; deixe a rodada terminar.
- **Migrations:** `bash scripts/aplicar-migrations.sh`. Não é idempotente por
  natureza — cada arquivo precisa ser escrito para poder rodar duas vezes
  (`IF NOT EXISTS`, `DROP ... IF EXISTS` antes de `ADD`).

---

## O que este lote NÃO faz

Escrito aqui porque cada um destes já foi confundido com trabalho do 5C:

- **Não religa o disparo do Meta.** Hoje `metaCapi.ts` e `metaTracking.ts` não
  têm um único chamador — quem chamava eram as landing pages da dn.ia. Quem
  religa é o **lote 7**, do lado do servidor.
- **Não mexe em `apply-lead-tag`, `contact-update`, `contact-status-update` nem
  `contact-tags-sync`.** Elas continuam na pasta por causa do
  `frontend/src/lib/leadConversion.ts`, que é caminho de conversão de landing
  page — **lote 7**.
- **Não destrava o 5A.** O handoff → GrowthHS depende de um endpoint que o
  `hsgrowth-sistema` ainda não tem
  (`docs/contratos/2026-09-02-endpoint-card-comercial-growthhs.md`).
- **Não reimplementa `merge_identities`.** Ela é PL/pgSQL, sobreviveu à portagem
  e já é chamada pelo `leitura_contatos.py:162` e pelo
  `escrita_contatos.py:279`. Reescrevê-la em Python seria refazer uma transação
  que já está certa.

---

## Onde a spec erra, e o que vale no lugar

Como no 5B, a spec erra e o banco decide. Registrado aqui para quem executa não
tentar obedecer aos dois:

1. **A spec (8.C) descreve casamento de identidade como trabalho a fazer.** Ele
   já existe: `resolve_or_create_identity` (migration 007) casa por telefone
   normalizado e por e-mail, detecta cruzamento e **chama `merge_identities`
   sozinha**. O que falta não é casar — é fechar o elo de volta.
2. **A spec fala em `cpf_cnpj` como chave de casamento com o DataCore.** Ele já
   é a chave, guardado em `ecosystem_identities.datacore_cliente_id` desde a
   migration 013, com índice único parcial.
3. **A spec (seção 9) deixa em aberto "se a HS faz anúncio no Meta".** Continua
   em aberto — decisão do Erick, ainda a perguntar (03/09/2026). Por isso este
   lote porta **parametrizado**: a credencial vira configuração, não código.
4. **`meta_config` é tabela morta.** Veio no dump, tem **0 linhas**, e ter dois
   lugares de segredo é justamente o defeito que o `app/integracoes.py` foi
   escrito para acabar. Os segredos do Meta vão para `integration_secrets`, como
   os do Resend.

---

## O defeito que este lote conserta

Conferido no banco em 03/09/2026:

```
identidades ........................................ 2.083
  com datacore_cliente_id .......................... 2.080
  que apontam de volta para o contato .................. 3
leads com dnia_id cuja identidade não aponta de volta  2.080
leads sem identidade ..................................... 0
```

`app/dominio/sincronizacao_datacore.py` insere a identidade (linha 144), depois
insere o lead com o `dnia_id` (linha 179) — e **nunca volta para carimbar o
`dndash_lead_id`**. A migration 007 já tinha feito esse backfill uma vez, para o
lote 1A; o 5B reabriu o buraco por outro caminho, dois meses depois.

**Consequência:** `publico.py:94` e `publico.py:361` percorrem o
`dndash_lead_id`. A visão 360° externa de **todos os 2.080 clientes do ERP**
volta vazia hoje.

### Por que não basta um `UNIQUE` em `leads.dnia_id`

Foi a primeira ideia, e o próprio código a derruba. `escrita_contatos.py:284`
diz, no caso 3 do `fundir_contatos`:

> *"`leads.dnia_id` não tem índice único (auditado na origem), então este UPDATE
> não colide."*

Ele **deliberadamente** liga um segundo contato à mesma identidade sem apagar
ninguém. E `merge_identities` faz `UPDATE leads SET dnia_id = p_keep WHERE
dnia_id = p_discard`, que junta dois contatos sob uma identidade só. **N contatos
por identidade é decisão tomada no lote 1C.** Um `UNIQUE` quebraria os dois.

Logo, `dndash_lead_id` **não é cópia redundante**: é *qual dos contatos é o
canônico* da identidade. Isso nunca esteve escrito em lugar nenhum — e é por
isso que dois lotes seguidos esqueceram de preenchê-lo.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `backend/migrations/015_contato_canonico.sql` | **criar** — backfill, `FK`, função e gatilho de eleição |
| `backend/tests/test_contato_canonico.py` | **criar** — prova as seis regras do gatilho |
| `backend/tests/test_sincronizacao_datacore.py` | **modificar** — a asserção que faltava em 02/09 |
| `backend/app/dominio/meta_capi.py` | **criar** — hash, normalização, montagem e a chamada ao Graph |
| `backend/tests/test_meta_capi.py` | **criar** — as funções puras, sem rede |
| `backend/app/integracoes.py` | **modificar** — `apagar_segredo()` |
| `backend/app/config.py` | **modificar** — declarar as três chaves do Meta |
| `backend/app/routers/configuracao.py` | **modificar** — `/config/meta` GET/PUT e `/config/meta/testar` |
| `frontend/src/components/admin/settings/MetaCard.tsx` | **modificar** — passa a falar por `api.ts` |
| `frontend/src/lib/metaCapi.ts` | **apagar** |
| `frontend/src/lib/metaTracking.ts` | **apagar** |
| `frontend/src/components/admin/settings/ApiDocumentation.tsx` | **modificar** — tirar `/merge-identities` |
| `frontend/public/api/dnmarketing-api.yaml` | **modificar** — tirar `/merge-identities` |
| `backend/supabase/functions/{merge-identities,meta-config,send-to-meta-capi}/` | **apagar** — só no fim |

---

### Task 1: O contato canônico para de arrebentar

**Arquivos:**
- Criar: `backend/migrations/015_contato_canonico.sql`
- Criar: `backend/tests/test_contato_canonico.py`

**Interfaces:**
- Consome: nada.
- Produz: a função `public.eleger_contato_canonico()` e o gatilho
  `trg_leads_contato_canonico` em `public.leads`. A partir daqui, **toda** tarefa
  pode assumir que `ecosystem_identities.dndash_lead_id` está preenchido sempre
  que a identidade tiver ao menos um contato.

⚠️ **Ordem entre gatilhos, que é o ponto sutil desta tarefa.** A `FK` com
`ON DELETE SET NULL` é implementada pelo Postgres como um gatilho interno na
tabela **referenciada** (`leads`), chamado `RI_ConstraintTrigger_a_<oid>`.
Gatilhos `AFTER` do mesmo evento disparam em **ordem alfabética de nome**, e
`RI_…` (maiúsculo `R`, 0x52) vem antes de `trg_…` (minúsculo `t`, 0x74). Então o
`SET NULL` acontece **primeiro** e o nosso gatilho já encontra o campo nulo. O
`WHERE` abaixo aceita as duas ordens de propósito, para não depender disso.

- [ ] **Passo 1: Escrever o teste que falha**

Criar `backend/tests/test_contato_canonico.py`:

```python
"""O elo identidade→contato.

⚠️ Usa a fixture `conexao` do conftest, que reverte tudo. Estes testes escrevem
em `leads` e `ecosystem_identities`, as duas tabelas mais importantes do
sistema — nenhuma linha pode ficar para trás.

O que se prova aqui é a regra que faltava em 02/09: `dndash_lead_id` não é cópia
do vínculo, é QUAL dos contatos é o canônico da identidade. N contatos por
identidade é permitido de propósito (ver escrita_contatos.py:284).
"""

import pytest


async def _identidade(conexao, nome="Identidade de teste"):
    return await conexao.fetchval(
        "INSERT INTO ecosystem_identities (nome, stage) VALUES ($1, 'lead') "
        "RETURNING dnia_id", nome)


async def _lead(conexao, dnia_id, email):
    # ⚠️ `tipo` é NOT NULL sem default em `leads`. Omiti-lo derruba o teste com
    # NotNullViolationError, apontando para o lugar errado.
    return await conexao.fetchval(
        "INSERT INTO leads (nome, email, tipo, dnia_id) "
        "VALUES ('Teste 5C', $1, 'teste', $2) RETURNING id", email, dnia_id)


async def _canonico(conexao, dnia_id):
    return await conexao.fetchval(
        "SELECT dndash_lead_id FROM ecosystem_identities WHERE dnia_id = $1",
        dnia_id)


@pytest.mark.asyncio
async def test_contato_novo_vira_o_canonico(conexao):
    """O caso que o lote 5B errou 2.080 vezes."""
    ident = await _identidade(conexao)
    lead = await _lead(conexao, ident, "canonico-5c-1@exemplo.invalid")
    assert await _canonico(conexao, ident) == lead


@pytest.mark.asyncio
async def test_segundo_contato_nao_rouba_o_canonico(conexao):
    """A guarda `IS NULL`. Sem ela, o caso 3 do fundir_contatos
    (escrita_contatos.py:284) trocaria o canônico pelo recém-vinculado."""
    ident = await _identidade(conexao)
    primeiro = await _lead(conexao, ident, "canonico-5c-2a@exemplo.invalid")
    await _lead(conexao, ident, "canonico-5c-2b@exemplo.invalid")
    assert await _canonico(conexao, ident) == primeiro


@pytest.mark.asyncio
async def test_repontar_o_dnia_id_elege_na_identidade_destino(conexao):
    """É o que `merge_identities` faz: UPDATE leads SET dnia_id = p_keep."""
    origem = await _identidade(conexao, "origem")
    destino = await _identidade(conexao, "destino")
    lead = await _lead(conexao, origem, "canonico-5c-3@exemplo.invalid")
    assert await _canonico(conexao, destino) is None

    await conexao.execute("UPDATE leads SET dnia_id = $1 WHERE id = $2",
                          destino, lead)
    assert await _canonico(conexao, destino) == lead


@pytest.mark.asyncio
async def test_apagar_o_canonico_elege_o_que_sobrou(conexao):
    """Sem este braço, o ON DELETE SET NULL reabre o buraco em silêncio."""
    ident = await _identidade(conexao)
    primeiro = await _lead(conexao, ident, "canonico-5c-4a@exemplo.invalid")
    segundo = await _lead(conexao, ident, "canonico-5c-4b@exemplo.invalid")
    assert await _canonico(conexao, ident) == primeiro

    await conexao.execute("DELETE FROM leads WHERE id = $1", primeiro)
    assert await _canonico(conexao, ident) == segundo


@pytest.mark.asyncio
async def test_apagar_o_unico_contato_deixa_nulo_sem_erro(conexao):
    """A FK é ON DELETE SET NULL. RESTRICT impediria apagar contato pela tela."""
    ident = await _identidade(conexao)
    lead = await _lead(conexao, ident, "canonico-5c-5@exemplo.invalid")
    await conexao.execute("DELETE FROM leads WHERE id = $1", lead)
    assert await _canonico(conexao, ident) is None


@pytest.mark.asyncio
async def test_fk_recusa_ponteiro_para_contato_inexistente(conexao):
    """Hoje não há FK nenhuma: apagar contato deixava ponteiro pendurado."""
    import asyncpg
    ident = await _identidade(conexao)
    with pytest.raises(asyncpg.ForeignKeyViolationError):
        await conexao.execute(
            "UPDATE ecosystem_identities SET dndash_lead_id = gen_random_uuid() "
            "WHERE dnia_id = $1", ident)
```

- [ ] **Passo 2: Rodar e conferir que falha**

```bash
cd backend && ./.venv/bin/pytest tests/test_contato_canonico.py -q
```

Esperado: **6 falhas**. As cinco primeiras por `dndash_lead_id` vir `None` (ou o
valor antigo); a última por `asyncpg.ForeignKeyViolationError` nunca ser
levantada — não existe `FK`.

- [ ] **Passo 3: Escrever a migration**

Criar `backend/migrations/015_contato_canonico.sql`:

```sql
-- 015: o elo identidade→contato para de arrebentar.
--
-- `ecosystem_identities.dndash_lead_id` NÃO é cópia redundante do vínculo. Ele
-- é QUAL dos contatos é o canônico da identidade — e isso importa porque N
-- contatos por identidade é permitido DE PROPÓSITO:
--
--   * escrita_contatos.py:284 (caso 3 do fundir_contatos) liga um segundo
--     contato à mesma identidade sem apagar ninguém, e comenta que faz isso
--     porque `leads.dnia_id` não tem índice único;
--   * merge_identities faz `UPDATE leads SET dnia_id = p_keep`, juntando dois
--     contatos sob uma identidade só.
--
-- Por isso NÃO se cria UNIQUE em leads.dnia_id: quebraria os dois caminhos.
--
-- O campo já foi esquecido DUAS VEZES por escritores diferentes: pela
-- importação do lote 1A (consertada pela migration 007) e pela sincronização do
-- DataCore do lote 5B (2.080 identidades, conferido em 03/09/2026). Um backfill
-- que precisa ser repetido a cada lote não é conserto — daí o gatilho.

-- ── 1. Backfill ──────────────────────────────────────────────────────────────
-- Determinístico: `dnia_id` é PK de ecosystem_identities e nenhum lead repete
-- dnia_id (conferido em 03/09/2026). Mesmo UPDATE da migration 007.
UPDATE public.ecosystem_identities ei
   SET dndash_lead_id = l.id
  FROM public.leads l
 WHERE l.dnia_id = ei.dnia_id
   AND ei.dndash_lead_id IS NULL;

-- ── 2. A FK que faltava ──────────────────────────────────────────────────────
-- Sem ela, apagar um contato deixa a identidade apontando para um id morto, e a
-- API pública devolve vazio ou 500 conforme o caminho. Zero pendurados hoje.
--
-- ⚠️ ON DELETE SET NULL, não RESTRICT: RESTRICT impediria apagar contato pela
-- tela, que é função do lote 1C.
ALTER TABLE public.ecosystem_identities
    DROP CONSTRAINT IF EXISTS ecosystem_identities_dndash_lead_id_fkey;
ALTER TABLE public.ecosystem_identities
    ADD CONSTRAINT ecosystem_identities_dndash_lead_id_fkey
    FOREIGN KEY (dndash_lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;

-- ── 3. A eleição do canônico ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.eleger_contato_canonico() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- O canônico morreu. Se sobrou outro contato na mesma identidade, ele
    -- assume; senão o campo fica nulo, que é o estado honesto.
    --
    -- ⚠️ O `WHERE` aceita as DUAS ordens possíveis de gatilho de propósito. A
    -- ação ON DELETE SET NULL é um gatilho interno em `leads` chamado
    -- RI_ConstraintTrigger_a_<oid>, e gatilhos AFTER do mesmo evento disparam
    -- em ordem alfabética de nome: `RI_` (0x52) vem antes de `trg_` (0x74), ou
    -- seja, o campo já chega nulo aqui. Depender dessa ordem seria frágil.
    IF OLD.dnia_id IS NOT NULL THEN
      UPDATE ecosystem_identities e
         SET dndash_lead_id = (
               SELECT l.id FROM leads l
                WHERE l.dnia_id = e.dnia_id AND l.id <> OLD.id
                ORDER BY l.created_at, l.id
                LIMIT 1)
       WHERE e.dnia_id = OLD.dnia_id
         AND (e.dndash_lead_id IS NULL OR e.dndash_lead_id = OLD.id);
    END IF;
    RETURN OLD;
  END IF;

  -- INSERT, ou UPDATE que mudou o dnia_id (é o que merge_identities dispara).
  --
  -- ⚠️ A guarda `dndash_lead_id IS NULL` é o ponto. Sem ela, o caso 3 do
  -- fundir_contatos roubaria o canônico para o contato recém-vinculado, e a
  -- ficha 360° passaria a mostrar o contato errado — em silêncio.
  IF NEW.dnia_id IS NOT NULL THEN
    UPDATE ecosystem_identities
       SET dndash_lead_id = NEW.id
     WHERE dnia_id = NEW.dnia_id
       AND dndash_lead_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.eleger_contato_canonico() IS
    'Mantém ecosystem_identities.dndash_lead_id apontando para um contato vivo. '
    'Ver migrations 007 e 015.';

DROP TRIGGER IF EXISTS trg_leads_contato_canonico ON public.leads;
CREATE TRIGGER trg_leads_contato_canonico
    AFTER INSERT OR DELETE OR UPDATE OF dnia_id ON public.leads
    FOR EACH ROW EXECUTE FUNCTION public.eleger_contato_canonico();

COMMENT ON COLUMN public.ecosystem_identities.dndash_lead_id IS
    'O contato CANÔNICO da identidade — não uma cópia do vínculo. Uma '
    'identidade pode ter vários contatos (ver escrita_contatos.py caso 3 e '
    'merge_identities); este campo diz qual deles a visão 360° mostra. '
    'Mantido pelo gatilho trg_leads_contato_canonico.';
```

- [ ] **Passo 4: Aplicar a migration**

```bash
bash scripts/aplicar-migrations.sh
```

Esperado: a saída lista todos os arquivos e termina em `015_contato_canonico.sql`
sem erro. ⚠️ O script reaplica as anteriores; elas são escritas para tolerar
isso. Se alguma falhar, **pare e leia o erro** — não é esta tarefa.

- [ ] **Passo 5: Rodar os testes e conferir que passam**

```bash
cd backend && ./.venv/bin/pytest tests/test_contato_canonico.py -q
```

Esperado: **6 passed**.

- [ ] **Passo 6: Conferir que o backfill consertou os 2.080 de verdade**

```bash
PYTHONPATH=/home/ericks/projetos/bancos \
  /home/ericks/projetos/bancos/.venv/bin/python -c "
import bancos
print(bancos.consultar('marketinghs', '''
 select count(*) filter (where dndash_lead_id is not null) com_canonico,
        count(*) total
   from ecosystem_identities''').to_string(index=False))"
```

Esperado: `com_canonico` = `total` = **2083**. Era 3 de 2.083 antes.

- [ ] **Passo 7: Rodar a suíte inteira**

```bash
cd backend && ./.venv/bin/pytest -q
```

Esperado: tudo que passava antes continua passando, mais os 6 novos.
⚠️ Preste atenção em `test_sincronizacao_datacore.py` e `test_importacao.py` —
são os que escrevem em `leads` e agora disparam o gatilho novo.

- [ ] **Passo 8: Commit**

```bash
git add backend/migrations/015_contato_canonico.sql backend/tests/test_contato_canonico.py
git commit -m "fix(5C): o contato canônico da identidade para de arrebentar

O dndash_lead_id foi esquecido por dois escritores diferentes — a importação
do 1A (consertada pela 007) e a sincronização do 5B, 2.080 identidades. Um
backfill por lote não é conserto: agora um gatilho elege o canônico em INSERT,
repontamento e DELETE, e uma FK ON DELETE SET NULL impede ponteiro pendurado.

Sem UNIQUE em leads.dnia_id de propósito: N contatos por identidade é decisão
do lote 1C (escrita_contatos.py:284)."
```

---

### Task 2: A sincronização do DataCore prova o elo

**Arquivos:**
- Modificar: `backend/tests/test_sincronizacao_datacore.py`

**Interfaces:**
- Consome: o gatilho `trg_leads_contato_canonico` da Task 1.
- Produz: nada que outra tarefa use.

Esta tarefa **não muda código de produção**. Ela existe porque o defeito nasceu
num caminho que já tinha teste — e o teste não perguntava a coisa certa. Sem esta
asserção, a Task 1 conserta o dado de hoje e nada impede o lote 6 de reabrir o
buraco por um terceiro caminho.

- [ ] **Passo 1: Escrever o teste que faltava**

Acrescentar ao fim de `backend/tests/test_sincronizacao_datacore.py`:

```python
@pytest.mark.asyncio
async def test_identidade_aponta_de_volta_para_o_contato(conexao):
    """A asserção que faltava em 02/09/2026.

    A sincronização insere a identidade e depois o lead com o `dnia_id`, e nunca
    volta para carimbar o `dndash_lead_id`. Ela continua não carimbando — quem
    carimba é o gatilho da migration 015. O que este teste prova é o RESULTADO,
    não o mecanismo: quem sincroniza não precisa lembrar de nada.

    Sem isto, `/publico/identidade` e `/publico/contato` (publico.py:94 e :361)
    devolvem a visão 360° vazia — foi o que aconteceu com os 2.080 clientes do
    ERP.
    """
    c = _cliente(cpf_cnpj="55444333000122", email="volta-5c@exemplo.invalid")
    r = await sincronizar(conexao, [c])
    assert r.criados == 1, r.erros

    linha = await conexao.fetchrow(
        """SELECT l.id AS lead_id, i.dndash_lead_id
             FROM ecosystem_identities i
             JOIN leads l ON l.dnia_id = i.dnia_id
            WHERE i.datacore_cliente_id = $1""", c.cpf_cnpj)
    assert linha["dndash_lead_id"] == linha["lead_id"]


@pytest.mark.asyncio
async def test_cliente_sem_email_tambem_aponta_de_volta(conexao):
    """~91% da base do ERP não tem e-mail. Se o elo dependesse do e-mail, o
    conserto valeria para 185 dos 2.080 — e ninguém perceberia a diferença."""
    c = _cliente(cpf_cnpj="55444333000133", email=None)
    r = await sincronizar(conexao, [c])
    assert r.criados == 1, r.erros

    canonico = await conexao.fetchval(
        """SELECT i.dndash_lead_id FROM ecosystem_identities i
            WHERE i.datacore_cliente_id = $1""", c.cpf_cnpj)
    assert canonico is not None
```

- [ ] **Passo 2: Rodar e conferir que passam**

```bash
cd backend && ./.venv/bin/pytest tests/test_sincronizacao_datacore.py -q
```

Esperado: todos passam, incluindo os 2 novos.

⚠️ **Se falharem**, a Task 1 não está aplicada no banco que os testes usam —
rode `bash scripts/aplicar-migrations.sh` antes de investigar qualquer outra
coisa.

- [ ] **Passo 3: Provar que o teste teria pegado o defeito**

Este passo é o que dá valor ao teste. Desabilite o gatilho numa transação e
confirme que o teste falha:

```bash
cd backend && ./.venv/bin/python -c "
import asyncio, app.database as db

async def main():
    await db.init_db()
    async with db._pool.acquire() as c:
        tr = c.transaction(); await tr.start()
        await c.execute('SET LOCAL ROLE service_role')
        await c.execute('ALTER TABLE leads DISABLE TRIGGER trg_leads_contato_canonico')
        i = await c.fetchval(\"INSERT INTO ecosystem_identities (nome, stage) VALUES ('x','lead') RETURNING dnia_id\")
        await c.fetchval(\"INSERT INTO leads (nome, email, tipo, dnia_id) VALUES ('x', 'prova-5c@exemplo.invalid', 'teste', \$1) RETURNING id\", i)
        print('sem gatilho, canonico =', await c.fetchval('SELECT dndash_lead_id FROM ecosystem_identities WHERE dnia_id = \$1', i))
        await tr.rollback()
    await db.close_db()

asyncio.run(main())"
```

Esperado: `sem gatilho, canonico = None` — exatamente o estado dos 2.080.
⚠️ Tudo dentro de transação revertida; o `ALTER TABLE ... DISABLE TRIGGER` não
sobrevive ao rollback.

- [ ] **Passo 4: Commit**

```bash
git add backend/tests/test_sincronizacao_datacore.py
git commit -m "test(5C): a sincronização do DataCore prova o elo de volta

O defeito do 5B nasceu num caminho que já tinha teste — o teste não perguntava
se a identidade apontava de volta. Agora pergunta, com e sem e-mail (91% da
base do ERP não tem)."
```

---

### Task 3: O módulo do Meta CAPI

**Arquivos:**
- Criar: `backend/app/dominio/meta_capi.py`
- Criar: `backend/tests/test_meta_capi.py`

**Interfaces:**
- Consome: `app.integracoes.ler_segredo` (já existe).
- Produz, para a Task 4:
  - `async def credenciais() -> Credenciais` — dataclass
    `Credenciais(pixel_id: str | None, access_token: str | None, test_event_code: str | None)`
    com propriedade `configurado: bool` (pixel e token presentes).
  - `def montar_evento(event_name: str, *, event_id: str | None = None, email: str | None = None, phone: str | None = None, first_name: str | None = None, last_name: str | None = None, external_id: str | None = None, client_ip_address: str | None = None, client_user_agent: str | None = None, event_source_url: str | None = None, fbc: str | None = None, fbp: str | None = None, custom_data: dict | None = None) -> dict`
  - `async def enviar(eventos: list[dict], *, creds: Credenciais, test_event_code: str | None = None) -> dict` — levanta `httpx.HTTPStatusError` em falha.

⚠️ **Por que `montar_evento` é função pura e separada de `enviar`:** é a parte
que erra em silêncio. E-mail não normalizado antes do hash, telefone sem o `55`,
`fn` como lista quando o Meta espera escalar — nada disso dá erro; o Meta aceita
o evento e o descarta na atribuição. Testar a montagem sem rede é o único jeito
de provar que ela está certa.

- [ ] **Passo 1: Escrever o teste que falha**

Criar `backend/tests/test_meta_capi.py`:

```python
"""A montagem do evento do Meta CAPI.

⚠️ Nenhum teste aqui faz rede. O que se prova é a montagem, que é a parte que
erra CALADA: o Meta aceita evento com hash errado e simplesmente não atribui a
conversão. Um teste que só verificasse "respondeu 200" não provaria nada.
"""

import hashlib

import pytest

from app.dominio import meta_capi


def _sha(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def test_email_e_normalizado_antes_do_hash():
    """Maiúscula e espaço mudam o hash. O Meta compara hash com hash: um
    '  Erick@HS.com ' não bate com o cadastro dele e a conversão se perde."""
    evento = meta_capi.montar_evento("Lead", email="  Erick@HS.COM ")
    assert evento["user_data"]["em"] == [_sha("erick@hs.com")]


def test_telefone_brasileiro_ganha_o_55():
    """Sem o código do país o número não casa com nada na base do Meta."""
    evento = meta_capi.montar_evento("Lead", phone="(81) 99999-8888")
    assert evento["user_data"]["ph"] == [_sha("5581999998888")]


def test_telefone_que_ja_tem_codigo_do_pais_nao_ganha_outro():
    evento = meta_capi.montar_evento("Lead", phone="+55 81 99999-8888")
    assert evento["user_data"]["ph"] == [_sha("5581999998888")]


def test_campo_ausente_nao_vira_hash_de_string_vazia():
    """Mandar sha256('') é pior que não mandar: o Meta trata como identificador
    e ele bate com todo mundo que também mandou vazio."""
    evento = meta_capi.montar_evento("Lead", email="a@b.com")
    assert "ph" not in evento["user_data"]
    assert "fn" not in evento["user_data"]
    assert "external_id" not in evento["user_data"]


def test_fbc_e_fbp_vao_crus():
    """São identificadores do próprio Meta. Hashear quebra a atribuição."""
    evento = meta_capi.montar_evento("Lead", fbc="fb.1.123.abc", fbp="fb.1.456.def")
    assert evento["user_data"]["fbc"] == "fb.1.123.abc"
    assert evento["user_data"]["fbp"] == "fb.1.456.def"


def test_ip_e_user_agent_vao_crus():
    evento = meta_capi.montar_evento(
        "Lead", client_ip_address="200.1.2.3", client_user_agent="Mozilla/5.0")
    assert evento["user_data"]["client_ip_address"] == "200.1.2.3"
    assert evento["user_data"]["client_user_agent"] == "Mozilla/5.0"


def test_o_event_id_e_o_que_deduplica_com_o_pixel():
    """O Pixel do navegador e o CAPI mandam o MESMO evento. Sem event_id igual
    nos dois, o Meta conta duas conversões para um lead só."""
    evento = meta_capi.montar_evento("Lead", event_id="abc-123", email="a@b.com")
    assert evento["event_id"] == "abc-123"


def test_sem_event_id_o_campo_nao_aparece():
    evento = meta_capi.montar_evento("Lead", email="a@b.com")
    assert "event_id" not in evento


def test_o_evento_carrega_hora_e_origem():
    evento = meta_capi.montar_evento("Lead", email="a@b.com")
    assert evento["event_name"] == "Lead"
    assert evento["action_source"] == "website"
    assert isinstance(evento["event_time"], int)


def test_evento_sem_nenhum_identificador_e_recusado_aqui():
    """error_subcode 2804050 — 'insufficient customer parameters'. O Meta
    recusa, mas só depois da viagem. Recusar aqui poupa a rede e dá uma
    mensagem que diz o que fazer.

    ⚠️ É por isto que o ClickCTA da dn.ia era Pixel-only: evento sem PII não
    tem o que mandar ao CAPI. O Pixel do navegador carrega fbp/fbc/ip/UA
    sozinho e não precisa do servidor."""
    with pytest.raises(ValueError, match="identificador"):
        meta_capi.montar_evento("ClickCTA", custom_data={"cta": "topo"})


def test_custom_data_passa_inteiro():
    evento = meta_capi.montar_evento(
        "Lead", email="a@b.com", custom_data={"lead_type": "gratuito"})
    assert evento["custom_data"] == {"lead_type": "gratuito"}


@pytest.mark.asyncio
async def test_credenciais_ausentes_nao_levantam():
    """`ler_segredo` nunca levanta, e isto também não pode. Falhar em contar uma
    conversão jamais pode derrubar a captura de um lead."""
    creds = await meta_capi.credenciais()
    assert isinstance(creds.configurado, bool)
```

- [ ] **Passo 2: Rodar e conferir que falha**

```bash
cd backend && ./.venv/bin/pytest tests/test_meta_capi.py -q
```

Esperado: erro de coleta — `ModuleNotFoundError: No module named 'app.dominio.meta_capi'`.

- [ ] **Passo 3: Escrever o módulo**

Criar `backend/app/dominio/meta_capi.py`:

```python
"""O Meta Conversions API. Uma responsabilidade só: montar e mandar o evento.

Portado de `supabase/functions/send-to-meta-capi`, com duas mudanças
deliberadas:

  1. **A function original não tinha autenticação nenhuma** —
     `Access-Control-Allow-Origin: *` e zero verificação. Qualquer um na
     internet postava conversão no pixel da HS. Aqui não há endpoint público de
     evento: quem dispara é o servidor, no caminho de captura do lead (lote 7).
  2. As credenciais saem de `integration_secrets` (app/integracoes.py), não da
     tabela `meta_config` do dump — que está com 0 linhas e seria um segundo
     lugar de segredo.

⚠️ A HS ainda não decidiu se faz anúncio no Meta (spec, seção 9, 03/09/2026).
Por isso este módulo nasce parametrizado e DESLIGADO: sem credencial gravada,
`credenciais().configurado` é falso e quem chama não manda nada.
"""

import hashlib
import logging
import re
import time
from dataclasses import dataclass

import httpx

from app.integracoes import ler_segredo

logger = logging.getLogger(__name__)

# A versão fica fixa e visível de propósito: subir de versão é decisão, não
# efeito colateral de um deploy. A original usava v18.0.
VERSAO_API = "v18.0"
TIMEOUT = 15

SEGREDO_PIXEL = "META_PIXEL_ID"
SEGREDO_TOKEN = "META_ACCESS_TOKEN"
SEGREDO_TESTE = "META_TEST_EVENT_CODE"

# Os campos que o Meta espera como LISTA de hashes, e não como escalar.
_LISTA = {"em", "ph", "external_id"}


@dataclass(frozen=True)
class Credenciais:
    pixel_id: str | None
    access_token: str | None
    test_event_code: str | None

    @property
    def configurado(self) -> bool:
        return bool(self.pixel_id and self.access_token)


async def credenciais() -> Credenciais:
    """Nunca levanta — `ler_segredo` degrada para o ambiente e devolve None."""
    return Credenciais(
        pixel_id=await ler_segredo(SEGREDO_PIXEL),
        access_token=await ler_segredo(SEGREDO_TOKEN),
        test_event_code=await ler_segredo(SEGREDO_TESTE),
    )


def _hash(valor: str) -> str:
    """SHA-256 do valor normalizado. Minúscula e sem espaço nas pontas — é o que
    o Meta faz do lado dele antes de comparar."""
    return hashlib.sha256(valor.strip().lower().encode()).hexdigest()


def _telefone(bruto: str) -> str:
    """Só dígitos, com o 55 na frente.

    ⚠️ 10 ou 11 dígitos é número brasileiro sem código de país (fixo e celular).
    Já com 12 ou 13 o código está lá e acrescentar outro produziria um número
    que não existe — e o Meta não reclama, só não atribui.
    """
    digitos = re.sub(r"\D", "", bruto)
    if len(digitos) in (10, 11):
        return "55" + digitos
    return digitos


def montar_evento(
    event_name: str,
    *,
    event_id: str | None = None,
    email: str | None = None,
    phone: str | None = None,
    first_name: str | None = None,
    last_name: str | None = None,
    external_id: str | None = None,
    client_ip_address: str | None = None,
    client_user_agent: str | None = None,
    event_source_url: str | None = None,
    fbc: str | None = None,
    fbp: str | None = None,
    custom_data: dict | None = None,
) -> dict:
    """Um evento pronto para o Graph.

    ⚠️ Campo ausente NÃO entra. Mandar `sha256("")` é pior que omitir: o Meta o
    trata como identificador válido, e ele bate com todo mundo que também mandou
    vazio.
    """
    user_data: dict = {}
    for chave, valor in (("em", email), ("ph", phone), ("fn", first_name),
                         ("ln", last_name), ("external_id", external_id)):
        if not valor or not str(valor).strip():
            continue
        bruto = _telefone(valor) if chave == "ph" else str(valor)
        digest = _hash(bruto)
        user_data[chave] = [digest] if chave in _LISTA else digest

    # Crus de propósito: são identificadores do próprio Meta e do transporte.
    # Hashear qualquer um deles quebra a atribuição em silêncio.
    for chave, valor in (("client_ip_address", client_ip_address),
                         ("client_user_agent", client_user_agent),
                         ("fbc", fbc), ("fbp", fbp)):
        if valor:
            user_data[chave] = valor

    if not user_data:
        raise ValueError(
            f"Evento '{event_name}' não tem nenhum identificador de pessoa. O "
            "Meta recusaria com error_subcode 2804050 (insufficient customer "
            "parameters). Evento sem PII é Pixel-only, não vai ao CAPI.")

    evento = {
        "event_name": event_name,
        "event_time": int(time.time()),
        "action_source": "website",
        "user_data": user_data,
        "custom_data": custom_data or {},
    }
    if event_source_url:
        evento["event_source_url"] = event_source_url
    # ⚠️ O event_id é o que deduplica com o Pixel do navegador. Ele só existe se
    # quem chama gerou UM id e usou nos dois lados; por isso é parâmetro, e não
    # gerado aqui dentro.
    if event_id:
        evento["event_id"] = event_id
    return evento


async def enviar(eventos: list[dict], *, creds: Credenciais,
                 test_event_code: str | None = None) -> dict:
    """Manda os eventos ao Graph e devolve a resposta. Levanta em falha.

    ⚠️ Levantar é o certo AQUI, no cliente. Quem chama é que decide engolir —
    e no caminho de captura de lead ele deve engolir: perder a contagem de uma
    conversão é ruim; perder o lead é pior.
    """
    if not creds.configurado:
        raise RuntimeError(
            "Meta não configurado: falta pixel_id ou access_token em "
            "integration_secrets (Configurações → Integrações → Meta).")

    corpo: dict = {"data": eventos}
    codigo = test_event_code or creds.test_event_code
    if codigo:
        corpo["test_event_code"] = codigo

    url = f"https://graph.facebook.com/{VERSAO_API}/{creds.pixel_id}/events"
    async with httpx.AsyncClient(timeout=TIMEOUT) as cliente:
        resposta = await cliente.post(
            url, params={"access_token": creds.access_token}, json=corpo)
    resposta.raise_for_status()
    return resposta.json()
```

- [ ] **Passo 4: Rodar e conferir que passam**

```bash
cd backend && ./.venv/bin/pytest tests/test_meta_capi.py -q
```

Esperado: **12 passed**.

- [ ] **Passo 5: Commit**

```bash
git add backend/app/dominio/meta_capi.py backend/tests/test_meta_capi.py
git commit -m "feat(5C): o Meta CAPI vira módulo de domínio em Python

Porta send-to-meta-capi com duas mudanças: a function não tinha autenticação
nenhuma (CORS aberto, zero verificação) e aqui não há endpoint público de
evento — quem dispara é o servidor, no lote 7. E as credenciais saem de
integration_secrets, não da tabela meta_config, que tem 0 linhas.

Os 12 testes cobrem a montagem, que é a parte que erra calada: o Meta aceita
hash errado e só não atribui a conversão."
```

---

### Task 4: A configuração do Meta pela API própria

**Arquivos:**
- Modificar: `backend/app/integracoes.py` (acrescentar `apagar_segredo`)
- Modificar: `backend/app/config.py:29-32` (declarar as três chaves)
- Modificar: `backend/app/routers/configuracao.py` (acrescentar ao fim)

**Interfaces:**
- Consome: `app.dominio.meta_capi.{credenciais, montar_evento, enviar, Credenciais}` da Task 3.
- Produz, para a Task 5:
  - `GET /config/meta` → `{"pixel_id": str|null, "access_token": {"configurado": bool, "ultimos4": str|null}, "test_event_code": str|null}`
  - `PUT /config/meta` body `{"pixel_id"?: str, "access_token"?: str, "test_event_code"?: str, "limpar"?: str[]}` → `{"gravados": str[], "limpados": str[]}`
  - `POST /config/meta/testar` → `{"enviado": true, "resposta": {...}}` ou 400 com `detail`

- [ ] **Passo 1: Declarar as chaves em `Settings`**

⚠️ **Este passo primeiro, e não por acaso.** `app/config.py:5` não tem
`extra="ignore"`: uma `META_PIXEL_ID` no `.env` sem declaração aqui derruba o
boot inteiro. É a regra do `CLAUDE.md` — "isso já derrubou o HS.OS duas vezes".

Em `backend/app/config.py`, logo abaixo do bloco do Resend (linhas 29-32):

```python
    # Meta (Conversions API). Como os do Resend: o valor de verdade mora em
    # `integration_secrets` e é gravado pela tela; declarar aqui é o que impede
    # o pydantic-settings de derrubar o boot se alguém puser a chave no .env.
    META_PIXEL_ID: str = ""
    META_ACCESS_TOKEN: str = ""
    META_TEST_EVENT_CODE: str = ""
```

⚠️ **Não** acrescente estas chaves em `backend/.env.example` — as do Resend
também não estão lá, de propósito: o lugar delas é a tela.

- [ ] **Passo 2: Acrescentar `apagar_segredo` a `integracoes.py`**

O `MetaCard` tem botão de lixeira por campo. Sem isto ele não tem como apagar.

Ao fim de `backend/app/integracoes.py`:

```python
async def apagar_segredo(nome: str) -> bool:
    """Remove o segredo e invalida o cache. Devolve se havia algo para remover.

    ⚠️ Apagar do banco NÃO garante que o segredo sumiu: `ler_segredo` cai para
    `os.environ` em seguida. É o comportamento certo — a instalação que ainda
    usa ambiente continua funcionando — mas quem chama precisa saber, para não
    dizer ao usuário que removeu quando o valor do ambiente segue valendo.
    """
    async with sessao(role="service_role") as conn:
        resultado = await conn.execute(
            "DELETE FROM public.integration_secrets WHERE name = $1", nome)
    esquecer(nome)
    return resultado != "DELETE 0"
```

- [ ] **Passo 3: Escrever os três endpoints**

Ao fim de `backend/app/routers/configuracao.py`:

```python
# ── Configuração do Meta ─────────────────────────────────────────────────────
# Mesmo desenho do Resend: os segredos moram em `integration_secrets`, e a
# leitura NUNCA devolve o valor.
#
# ⚠️ A tabela `meta_config` do dump não é usada. Ela tem 0 linhas e ter dois
# lugares de segredo é o defeito que o app/integracoes.py existe para acabar.

class MetaIn(BaseModel):
    # Opcionais, como no Resend: campo ausente ou vazio é "não mexi", nunca
    # "apague". Para apagar existe `limpar`.
    pixel_id: str | None = None
    access_token: str | None = None
    test_event_code: str | None = None
    limpar: list[str] = []


SEGREDOS_META = {
    "pixel_id": "META_PIXEL_ID",
    "access_token": "META_ACCESS_TOKEN",
    "test_event_code": "META_TEST_EVENT_CODE",
}


@router.get("/config/meta")
async def ler_config_meta(_: Usuario = Depends(admin_atual)):
    """O que está configurado.

    ⚠️ `access_token` NUNCA volta inteiro — é ele que autoriza postar conversão
    no pixel da HS. `pixel_id` e `test_event_code` voltam: o pixel id aparece no
    HTML de qualquer página que carrega o Pixel, e o código de teste só vale no
    Events Manager. Esconder os dois só atrapalharia quem confere.
    """
    from app.dominio import meta_capi

    creds = await meta_capi.credenciais()
    token = creds.access_token or ""
    return {
        "pixel_id": creds.pixel_id,
        "access_token": {"configurado": bool(token),
                         "ultimos4": token[-4:] if len(token) >= 4 else None},
        "test_event_code": creds.test_event_code,
        "configurado": creds.configurado,
    }


@router.put("/config/meta")
async def gravar_config_meta(dados: MetaIn, _: Usuario = Depends(admin_atual)):
    """Grava só o que veio preenchido; apaga só o que veio em `limpar`."""
    from app.integracoes import apagar_segredo, gravar_segredo

    if dados.pixel_id and dados.pixel_id.strip():
        if not re.fullmatch(r"\d{6,25}", dados.pixel_id.strip()):
            # O pixel id é numérico. Colar a URL do Events Manager inteira, ou o
            # nome do dataset, faz todo evento ser recusado por 404 no Graph —
            # e a mensagem do Meta não diz que o problema é o id.
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "O Pixel ID é só números (6 a 25 dígitos), como aparece em "
                "Events Manager → Fontes de dados.")

    desconhecidos = [c for c in dados.limpar if c not in SEGREDOS_META]
    if desconhecidos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Campos desconhecidos: {', '.join(desconhecidos)}")

    gravados, limpados = [], []
    for campo, nome in SEGREDOS_META.items():
        if campo in dados.limpar:
            await apagar_segredo(nome)
            limpados.append(campo)
            continue
        valor = getattr(dados, campo)
        if valor and valor.strip():
            await gravar_segredo(nome, valor.strip())
            gravados.append(campo)
    return {"gravados": gravados, "limpados": limpados}


@router.post("/config/meta/testar")
async def testar_config_meta(_: Usuario = Depends(admin_atual)):
    """Manda um evento de teste ao Events Manager.

    ⚠️ EXIGE `test_event_code`. Sem ele o evento entraria na conta de verdade e
    contaria como conversão — um lead que não existe, na base de otimização de
    campanha. Recusar é o certo.
    """
    from app.dominio import meta_capi

    creds = await meta_capi.credenciais()
    if not creds.configurado:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Preencha o Pixel ID e o access token antes de testar.")
    if not creds.test_event_code:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Preencha o test event code. Sem ele o evento de teste entraria na "
            "conta de verdade e contaria como conversão.")

    evento = meta_capi.montar_evento(
        "Lead",
        email="teste-marketinghs@exemplo.invalid",
        custom_data={"origem": "teste de configuração do MarketingHS"})
    try:
        resposta = await meta_capi.enviar([evento], creds=creds)
    except httpx.HTTPStatusError as e:
        # A mensagem do Meta é específica e útil (token expirado, pixel
        # inexistente, permissão faltando). Repassá-la poupa uma ida ao log.
        detalhe = e.response.text[:500]
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"O Meta recusou o evento ({e.response.status_code}): {detalhe}")
    except httpx.HTTPError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                            f"Não foi possível falar com o Meta: {e}")
    return {"enviado": True, "resposta": resposta}
```

⚠️ **Acrescente `import re` e `import httpx`** ao topo de `configuracao.py`,
junto aos outros imports — conferido em 03/09/2026: **nenhum dos dois está lá**.
Sem eles o módulo importa e só quebra quando alguém salva ou testa, com
`NameError` dentro do endpoint.

- [ ] **Passo 4: Subir o backend e conferir as três rotas**

```bash
cd backend && ./.venv/bin/python -m uvicorn app.main:app --port 8100 --reload
```

Noutro terminal, com um token de admin:

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:8100/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<admin do banco>","senha":"<senha>"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

curl -s http://127.0.0.1:8100/config/meta -H "Authorization: Bearer $TOKEN"
# Esperado: {"pixel_id":null,"access_token":{"configurado":false,"ultimos4":null},"test_event_code":null,"configurado":false}

curl -s -X PUT http://127.0.0.1:8100/config/meta -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"pixel_id":"não-é-número"}'
# Esperado: 400 com a mensagem sobre "só números (6 a 25 dígitos)"

curl -s -X POST http://127.0.0.1:8100/config/meta/testar -H "Authorization: Bearer $TOKEN"
# Esperado: 400 "Preencha o Pixel ID e o access token antes de testar."

curl -s http://127.0.0.1:8100/config/meta
# Esperado: 401 — a rota é admin_atual, não anônima
```

⚠️ **Confira o boot.** Se o uvicorn não subir com erro de `pydantic_settings`,
o Passo 1 não foi feito.

- [ ] **Passo 5: Rodar a suíte inteira**

```bash
cd backend && ./.venv/bin/pytest -q
```

Esperado: tudo passa. O `test_meta_capi.py` continua verde.

- [ ] **Passo 6: Commit**

```bash
git add backend/app/config.py backend/app/integracoes.py backend/app/routers/configuracao.py
git commit -m "feat(5C): a configuração do Meta sai do Supabase

/config/meta GET/PUT e /config/meta/testar, no mesmo desenho do Resend: o
segredo mora em integration_secrets e a leitura nunca devolve o access token.

O teste exige test_event_code de propósito — sem ele o evento entraria na conta
de verdade e contaria como conversão.

As três chaves entram em Settings mesmo sem uso direto: sem declaração, uma
META_PIXEL_ID no .env derruba o boot inteiro."
```

---

### Task 5: O MetaCard fala com a API própria

**Arquivos:**
- Modificar: `frontend/src/components/admin/settings/MetaCard.tsx`
- Apagar: `frontend/src/lib/metaCapi.ts`
- Apagar: `frontend/src/lib/metaTracking.ts`

**Interfaces:**
- Consome: os três endpoints da Task 4 e `api` de `frontend/src/lib/api.ts`.
- Produz: nada que outra tarefa use.

- [ ] **Passo 1: Trocar as três chamadas e acrescentar o botão de teste**

Em `MetaCard.tsx`:

1. Trocar `import { supabase } from '@/integrations/supabase/client';` por
   `import { api, ErroApi } from '@/lib/api';`.
2. Acrescentar `import { Send } from 'lucide-react';` à lista do `lucide-react`.
3. Substituir os corpos de `loadConfig`, `handleSave` e `handleClear`:

```tsx
type ConfigMeta = {
  pixel_id: string | null;
  access_token: { configurado: boolean; ultimos4: string | null };
  test_event_code: string | null;
  configurado: boolean;
};

const loadConfig = async () => {
  setLoading(true);
  try {
    const dados = await api.get<ConfigMeta>('/config/meta');
    setConfig(dados);
    setInputs({ pixel_id: '', access_token: '', test_event_code: '' });
  } catch (e) {
    toast.error('Falha ao carregar configuração do Meta', {
      description: e instanceof ErroApi ? e.message : undefined,
    });
  } finally {
    setLoading(false);
  }
};

const handleSave = async () => {
  const corpo: Record<string, string> = {};
  for (const f of FIELDS) {
    if (inputs[f.key].trim().length > 0) corpo[f.key] = inputs[f.key].trim();
  }
  if (Object.keys(corpo).length === 0) {
    toast.info('Nenhuma alteração para salvar');
    return;
  }
  setSaving(true);
  try {
    await api.put('/config/meta', corpo);
    await loadConfig();
    toast.success('Credenciais do Meta salvas');
  } catch (e) {
    toast.error('Falha ao salvar', {
      description: e instanceof ErroApi ? e.message : undefined,
    });
  } finally {
    setSaving(false);
  }
};

const handleClear = async (field: Field) => {
  setSaving(true);
  try {
    await api.put('/config/meta', { limpar: [field] });
    await loadConfig();
    toast.success('Valor removido');
  } catch (e) {
    toast.error('Falha ao remover', {
      description: e instanceof ErroApi ? e.message : undefined,
    });
  } finally {
    setSaving(false);
  }
};

const handleTest = async () => {
  setTesting(true);
  try {
    await api.post('/config/meta/testar');
    toast.success('Evento de teste enviado', {
      description: 'Confira em Events Manager → Eventos de teste.',
    });
  } catch (e) {
    // ⚠️ A mensagem do backend repassa a do Meta e diz o que fazer (token
    // expirado, pixel inexistente, falta o test event code). Engoli-la
    // deixaria a pessoa sem saber por que não funcionou.
    toast.error('O teste não passou', {
      description: e instanceof ErroApi ? e.message : 'Erro desconhecido',
    });
  } finally {
    setTesting(false);
  }
};
```

4. Acrescentar o estado `const [testing, setTesting] = useState(false);` junto
   aos outros `useState`.
5. Trocar o cálculo de `configuredCount`, porque o formato da resposta mudou —
   o `has_<campo>` da function não existe mais:

```tsx
const configuredCount = [
  Boolean(config?.pixel_id),
  Boolean(config?.access_token?.configurado),
].filter(Boolean).length;
```

6. No `FIELDS.map`, trocar `const saved = Boolean(config?.[\`has_${f.key}\`]);` e
   o `shown` por:

```tsx
const saved =
  f.key === 'access_token'
    ? Boolean(config?.access_token?.configurado)
    : Boolean(config?.[f.key as 'pixel_id' | 'test_event_code']);
const shown =
  f.key === 'access_token'
    ? config?.access_token?.ultimos4
      ? `•••• ${config.access_token.ultimos4}`
      : null
    : (config?.[f.key as 'pixel_id' | 'test_event_code'] ?? null);
```

7. Acrescentar o botão de teste ao lado do Salvar:

```tsx
<Button
  size="sm"
  variant="outline"
  className="gap-1.5 h-7 text-xs"
  onClick={handleTest}
  disabled={testing || saving || loading}
>
  {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
  {testing ? 'Enviando…' : 'Enviar evento de teste'}
</Button>
```

8. Trocar o texto que cita a function morta:

```tsx
<p className="text-xs text-muted-foreground leading-relaxed">
  Credenciais do Meta Conversions API. O disparo é feito pelo servidor, no
  caminho de captura do lead — o navegador não fala com o Meta pelo nosso
  backend. O evento de teste exige o <em>test event code</em> preenchido.
</p>
```

- [ ] **Passo 2: Apagar o código morto**

```bash
git rm frontend/src/lib/metaCapi.ts frontend/src/lib/metaTracking.ts
```

⚠️ **Confira que ninguém importava:**

```bash
grep -rn "metaCapi\|metaTracking\|sendMetaConversion\|trackLeadDedup\|trackCtaClick\|trackCompleteRegistration" frontend/src
```

Esperado: **nenhuma linha**. (Conferido em 03/09/2026: os dois arquivos já não
tinham um único chamador — quem chamava eram as landing pages da dn.ia.)

O que valia guardar deles está registrado no teste
`test_evento_sem_nenhum_identificador_e_recusado_aqui` (Task 3) e aqui, para o
lote 7: **`ClickCTA` é Pixel-only.** Evento sem PII o Meta recusa com
`error_subcode 2804050`, e o Pixel do navegador já carrega `fbp`/`fbc`/IP/UA
sozinho. O `event_id` compartilhado entre Pixel e CAPI é o que evita contar a
mesma conversão duas vezes.

- [ ] **Passo 3: Conferir que compila**

```bash
cd frontend && npx tsc --noEmit
```

Esperado: sem erro. ⚠️ Se acusar `has_pixel_id` ou `ConfigState`, o passo 1 ficou
pela metade.

- [ ] **Passo 4: O portão — abrir no navegador**

```bash
cd backend && ./.venv/bin/python -m uvicorn app.main:app --port 8100 --reload
cd frontend && npx vite --port 8080
```

Com o Playwright, em `http://127.0.0.1:8080`:

1. Entrar com usuário admin do banco `marketinghs`.
2. Ir em **Configurações**, achar o card **Meta**.
3. Conferir que mostra **0/2 configurados** e nenhum erro no console.
4. Digitar `não-é-número` no Pixel ID e **Salvar** → o toast tem de mostrar a
   mensagem "só números (6 a 25 dígitos)".
5. Digitar `1234567890123456` no Pixel ID e `EAAGteste123` no access token, e
   **Salvar** → toast de sucesso, o card passa a **2/2 configurados**, o campo
   do token mostra `•••• e123` e **não** mostra o token inteiro.
6. Recarregar a página → continua 2/2. (Prova que gravou em
   `integration_secrets`, não no estado da tela.)
7. Clicar em **Enviar evento de teste** → toast de erro dizendo que falta o
   *test event code*. É o comportamento certo.
8. Clicar na lixeira do access token → toast "Valor removido", card volta a 1/2.
9. Conferir a aba Network: as chamadas vão para `/config/meta`, e **nenhuma**
   para `supabase.co`.

⚠️ **Passo 5 é o que fecha o portão de verdade.** No lote 1D a tela de chaves
ficou pendente porque um overlay de outra aba bloqueou o clique e o portão exige
o clique. Se algo bloquear aqui, **não marque a tarefa como pronta** — registre
o que bloqueou.

⚠️ Sem pixel real (a HS ainda não decidiu se anuncia no Meta), o passo 7 é o
mais longe que dá para ir. Isso é honesto e está previsto: o lote porta
parametrizado.

- [ ] **Passo 5: Commit**

```bash
git add frontend/src/components/admin/settings/MetaCard.tsx
git commit -m "feat(5C): o card do Meta sai do Supabase

Fala por api.ts, ganha botão de evento de teste e para de citar a function
send-to-meta-capi. metaCapi.ts e metaTracking.ts vão embora: não tinham um
único chamador desde que as landing pages da dn.ia saíram. Quem religa o
disparo é o lote 7, do lado do servidor.

Conferido no navegador: 0/2 → recusa pixel id não numérico → 2/2 com o token
mascarado → sobrevive ao reload → o teste recusa sem test event code."
```

---

### Task 6: O portão — a documentação e as três functions

**Arquivos:**
- Modificar: `frontend/src/components/admin/settings/ApiDocumentation.tsx:295-319`
- Modificar: `frontend/public/api/dnmarketing-api.yaml:555-606`
- Apagar: `backend/supabase/functions/merge-identities/`
- Apagar: `backend/supabase/functions/meta-config/`
- Apagar: `backend/supabase/functions/send-to-meta-capi/`
- Modificar: `docs/CONTINUAR-AQUI.md`

**Interfaces:**
- Consome: tudo das tarefas 1 a 5.
- Produz: nada.

⚠️ **Esta tarefa é o passo 2 do portão, e ele não é redundante.** As três
functions só saem da pasta quando **ninguém mais as chama — inclusive de outra
tela**. `merge-identities` já não é chamada por tela nenhuma desde o lote 1C
(a RPC é chamada direto pelo `leitura_contatos.py:162` e pelo
`escrita_contatos.py:279`), mas **duas superfícies de documentação ainda a
ensinam a integradores**. Pela quarta vez neste projeto a documentação ficou
para trás — o lote 2 e o lote 3 tiveram o mesmo achado.

**A fusão de identidade não vira endpoint público.** É operação destrutiva
(apaga uma identidade e repõe leads, eventos e envios), não existe integrador
externo hoje, e a tela de **Contatos → Duplicatas** já faz isso autenticada por
`POST /duplicatas/fundir`. Expor seria abrir superfície sem demanda.

- [ ] **Passo 1: Conferir o estado do portão antes de apagar nada**

```bash
grep -rn "merge-identities\|meta-config\|send-to-meta-capi" frontend/src frontend/public backend/app
```

Esperado: exatamente **duas** superfícies —
`ApiDocumentation.tsx` e `frontend/public/api/dnmarketing-api.yaml`.
Se aparecer qualquer outra coisa, **pare**: uma tela ainda chama a function e o
portão não fecha.

- [ ] **Passo 2: Tirar `/merge-identities` da tela de Documentação da API**

Em `ApiDocumentation.tsx`, apagar o objeto inteiro do array que começa em
`id: 'merge-identities',` — **linhas 295 a 319**, da `{` da linha 295 até a
`},` da linha 319, inclusive. ⚠️ A `{` abre uma linha ANTES do `id:`; começar a
apagar pelo `id:` deixa uma chave órfã.

- [ ] **Passo 3: Tirar `/merge-identities` da especificação OpenAPI**

Em `frontend/public/api/dnmarketing-api.yaml`, apagar o bloco `/merge-identities:`
inteiro — **linhas 555 a 606**, da linha `  /merge-identities:` (555) até a linha
em branco que precede `  /contacts-list:` (607), inclusive.

- [ ] **Passo 4: Conferir que a documentação não ensina mais URL morta**

```bash
grep -rn "merge-identities" frontend/
```

Esperado: **nenhuma linha**.

```bash
cd frontend && npx tsc --noEmit
```

Esperado: sem erro.

- [ ] **Passo 5: Abrir a tela de Documentação no navegador**

Com o Vite em `127.0.0.1:8080`, ir em **Configurações → Documentação da API** e
conferir que a lista de endpoints carrega, que `/merge-identities` não aparece
mais, e que nenhum erro sobe no console. ⚠️ Apagar um item no meio de um array
literal é onde se deixa vírgula sobrando — o `tsc` pega, mas a tela é quem
prova.

- [ ] **Passo 6: As três functions saem da especificação**

```bash
git rm -r backend/supabase/functions/merge-identities \
          backend/supabase/functions/meta-config \
          backend/supabase/functions/send-to-meta-capi
```

- [ ] **Passo 7: Conferir o placar, os dois números separados**

```bash
# functions que restam na especificação
ls backend/supabase/functions/ | grep -v '^_shared$' | wc -l

# pontos de acesso direto ao banco, contando as chamadas quebradas em linhas
python3 -c "
import pathlib, re
n = sum(len(re.findall(r'supabase\s*\.?\s*\n?\s*\.(from|rpc)\(', f.read_text()))
        for f in pathlib.Path('frontend/src').rglob('*.ts*')
        if 'integrations/supabase' not in str(f))
print(n, 'pontos de acesso direto')"

# invocações de edge function que restam
grep -rn "functions\.invoke" frontend/src --include=*.ts --include=*.tsx | wc -l
```

Esperado: **22** functions restantes (eram 25), **27** pontos de acesso direto
(inalterado — o 5C não mexe em `.from()`), e **as invocações do MetaCard já não
aparecem**.

⚠️ **Os dois números nunca se somam.** Foi juntá-los que escondeu tela quebrada
no HS.OS.

- [ ] **Passo 8: Atualizar o `CONTINUAR-AQUI.md`**

Na tabela do lote 5, marcar o **5C** como concluído em 03/09/2026. Acrescentar
uma seção **"O que o 5C entregou"** com:

- o defeito dos 2.080 e como foi fechado (gatilho, não backfill);
- que `dndash_lead_id` é o **contato canônico**, não cópia — e que N contatos por
  identidade é decisão do lote 1C;
- que o Meta nasce **parametrizado e desligado**, e que a pergunta "a HS faz
  anúncio no Meta?" continua na lista do que depende do Erick;
- que a tela de **Configurações** agora só espera o `NexusCard` (5A, bloqueado)
  para liberar o trabalho de visual.

Na lista "Antes de continuar, o que depende do Erick", acrescentar:
**"Decidir se a HS faz anúncio no Meta — sem isso o CAPI fica configurado e
desligado, que é um estado válido."**

- [ ] **Passo 9: Rodar tudo uma última vez**

```bash
cd backend && ./.venv/bin/pytest -q
cd frontend && npx tsc --noEmit
```

Esperado: suíte verde, sem erro de tipo.

- [ ] **Passo 10: Commit**

```bash
git add -A
git commit -m "chore(5C): o portão fecha — as três functions saem da pasta

merge-identities, meta-config e send-to-meta-capi. Antes de apagar, o passo 2
do portão pegou de novo o mesmo padrão: a tela de Documentação da API E o
dnmarketing-api.yaml ainda ensinavam POST /merge-identities a integradores.
Quarta vez neste projeto.

A fusão de identidade NÃO vira endpoint público: é destrutiva, não há
integrador externo, e Contatos → Duplicatas já faz isso autenticada.

Placar: 51 functions portadas + 6 descartadas · 22 na especificação."
```

---

## Revisão do plano

**Cobertura da spec.** Seção 8.C (identidade unificada) → tarefas 1 e 2; o
casamento por e-mail/telefone/`cpf_cnpj` que a spec pede já existia (007 e 013) e
está registrado em "Onde a spec erra". Seção 9, linha do Meta CAPI ("pixel +
token → pixel da HS, e a resposta se a HS faz anúncio no Meta") → tarefas 3, 4 e
5, portadas parametrizadas, com a pergunta devolvida ao Erick na Task 6 passo 8.
A linha "Microsoft Clarity" da mesma seção **não** é deste lote — `useClarity`
está no bloco do lote 6.

**Sem marcadores.** Nenhum "TBD", nenhum "tratar erros adequadamente", nenhum
"parecido com a Task N". Todo passo de código tem o código.

**Consistência de tipos.** `Credenciais` (Task 3) é consumida em
`ler_config_meta` e `testar_config_meta` (Task 4) pelos mesmos nomes de campo —
`pixel_id`, `access_token`, `test_event_code`, `configurado`. O corpo devolvido
por `GET /config/meta` (Task 4) é o `ConfigMeta` que o `MetaCard` declara (Task
5), campo a campo. `SEGREDOS_META` usa as mesmas três chaves de
`meta_capi.SEGREDO_*`. `montar_evento` é chamada em `testar_config_meta` só com
parâmetros nomeados que existem na assinatura.

**Risco conhecido, e por que se aceita.** A Task 1 muda comportamento de escrita
nas duas tabelas mais importantes do sistema. Ela entra primeiro de propósito:
se o gatilho quebrar algo, quebra com a suíte inteira rodando atrás (Task 1,
passo 7) e antes de qualquer trabalho de Meta estar em cima. O ponto mais sutil
— a ordem entre o gatilho da `FK` e o nosso — está coberto por
`test_apagar_o_canonico_elege_o_que_sobrou` e o `WHERE` aceita as duas ordens.
