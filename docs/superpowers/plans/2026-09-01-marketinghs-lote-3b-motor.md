# MarketingHS — Lote 3B: O motor e o primeiro envio — Plano

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — `superpowers:subagent-driven-development`
> ou `superpowers:executing-plans`. Os passos usam caixa (`- [ ]`).

**Objetivo:** uma campanha de e-mail sai de verdade — enfileirada por um endpoint
próprio, drenada por um worker Python, entregue pelo Resend, com descadastro
assinado e supressão respeitada.

**Arquitetura:** as duas filas do `pgmq` viram tabela comum com
`SELECT … FOR UPDATE SKIP LOCKED`. O `pg_cron` vira laço `asyncio` no worker. O
`invoke_edge_function` **não volta**: o worker chama a função Python direto. O
`supabase_vault` vira a tabela `integration_secrets`, portada do `integracoes.py`
do HS.OS.

**Stack:** FastAPI, asyncpg, httpx · Python `asyncio` no worker · Resend

**Spec:** `docs/superpowers/specs/2026-08-31-marketinghs-design.md` (§6 e §10)
**Lote anterior:** `docs/superpowers/plans/2026-09-01-marketinghs-lote-3a-campanhas-e-templates.md`

---

## Onde este lote fica

O lote 3 foi partido em 3A/3B/3C. O 3A entregou campanhas e templates **sem
envio**. Este é o 3B: **o motor**. O 3C fecha com webhook do Resend, métricas e
agendamento.

**Pronto quando:** uma campanha de teste, disparada pela tela, chega numa caixa
de entrada de verdade — e o link de descadastro dela funciona.

⚠️ **Este é o único lote do projeto que nasce com `pytest`.** A spec é explícita:
*"reimplementar visibility timeout, retentativa e fila-morta é onde mora bug de
sistema de envio"*. Um e-mail enviado duas vezes para a base inteira queima o
domínio.

---

## O que você precisa saber antes de começar

### ⚠️ A função de referência NÃO EXISTE. Derive-a de quem a verifica.

`process-email-queue` é o worker que fazia o envio por destinatário. Sete
arquivos a citam pelo nome e **ela não está no repositório nem no histórico do
git**:

```bash
grep -rln "process-email-queue" backend/supabase/functions   # 7 arquivos
ls backend/supabase/functions/process-email-queue            # não existe
git log --all --diff-filter=D --name-only | grep process-email-queue  # vazio
```

A regra do projeto era "função herdada se copia do banco, não se lembra". Esta
não está em lugar nenhum — então **se deriva da contraparte**, e as contrapartes
existem:

| O que reconstruir | De onde tirar, com certeza |
|---|---|
| assinatura do token de descadastro | `email-unsubscribe/index.ts::computeToken` — ele **verifica** o mesmo HMAC |
| codificação do e-mail na URL | `email-unsubscribe/index.ts::b64urlDecode` — inverta |
| ordem de resolução do segredo | `_shared/secrets.ts` |
| credenciais e remetente do Resend | `send-test-email/index.ts` (mesma ordem, de propósito) |
| merge tags | `frontend/src/components/admin/campaigns/emailEditorConfig.ts::EMAIL_MERGE_TAGS` |
| parte `text/plain` | `_shared/htmlToText.ts` |
| status que o webhook escreve | `resend-webhook/index.ts::EVENT_TO_STATUS` |

**Não invente nenhuma dessas.** Cada uma tem uma contraparte que já está no
repositório, e divergir de qualquer uma quebra em silêncio — o descadastro
passa a dar 401, ou a parte texto não espelha o que foi enviado.

### O HMAC do descadastro, extraído do verificador

```
token = base64url_sem_padding( HMAC_SHA256( segredo, f"{lead_id}:{email}" ) )
e     = base64url_sem_padding( utf8_bytes(email) )
url   = {FRONTEND_URL}/descadastrar?lid={lead_id}&e={e}&t={token}
```

O `email` é **minúsculo e sem espaços nas pontas** antes de assinar — é assim
que o verificador o normaliza (`b64urlDecode(e).toLowerCase().trim()`), e
assinar o valor não normalizado daria 401 em todo endereço com maiúscula.

⚠️ **As duas pontas precisam ler o MESMO `UNSUBSCRIBE_SECRET`**, pela mesma
ordem de resolução. Se uma lesse do banco e a outra do ambiente, todo
descadastro passaria a dar 401 — e ninguém perceberia até um contato reclamar.

### O que sobreviveu no banco, e que você NÃO reimplementa

| Função | Papel no 3B |
|---|---|
| `finalize_campaign_if_drained(uuid)` | fecha a campanha quando `pending` chega a zero. O worker chama a cada mensagem processada. |
| `resolve_segment_audience(uuid[], uuid[], int)` | o público. A MESMA que o card mostra. |
| `validate_campaign_send_status()` | trigger: `pending, sent, delivered, opened, clicked, failed, unsubscribed, bounced, complained, suppressed` |
| `validate_campaign_status()` | trigger: `draft, scheduled, sending, sent, paused, failed` |
| `fn_campaign_send_event()` | trigger que joga o envio na timeline do contato |
| `normalize_suppression_email()` | trigger que normaliza o e-mail na supressão |

**Faltam e são deste lote:** `email_queue_read`, `email_queue_delete`,
`email_queue_send_batch`, `reset_stuck_campaigns`, `get_integration_secret`,
`set_integration_secret`, `delete_integration_secret`.

⚠️ As **quatro** de jornada (`journey_queue_read`, `journey_queue_delete`,
`journey_enqueue_email`, `fn_contact_event_to_journey_queue`) e a
`evaluate_automation_on_etiqueta` **são do lote 4**. Não as escreva aqui.
`invoke_edge_function` **não volta nunca**.

### Os três índices únicos são a garantia, e mudam a política de retentativa

```
uniq_campaign_sends_email_campaign_lead (campaign_id, lead_id)
    WHERE channel='email' AND lead_id IS NOT NULL AND campaign_id IS NOT NULL
```

A garantia de não enviar duas vezes **não depende de o worker acertar** — é
constraint. O worker pode reprocessar a mesma mensagem à vontade: a segunda
passagem encontra a linha já não-`pending` e pula. **Não relaxe o índice**, e
não escreva lógica que tente substituí-lo.

### As tabelas de fila não existem

Não há `email_send_queue` no banco. É a tarefa 1 criá-la.

---

## Restrições globais

- **`sessao()` é o único caminho para dado**, e é ela que abre a transação.
- **`role="service_role"` + autorização explícita na rota** — padrão dos lotes 0 a 3A.
- **Nenhum e-mail sai sem `RESEND_API_KEY`.** Sem a chave, o worker registra e
  para; nunca finge que enviou.
- **Toda chave nova de ambiente PRECISA estar em `Settings`** (`app/config.py`),
  ou o boot inteiro cai. Isso já derrubou o HS.OS duas vezes.
- **O portão tem TRÊS partes**, e a terceira inclui a documentação pública —
  ela pegou duas chamadas mortas no lote 2 e uma expectativa errada no 3A.
- **Backend na 8100 no host**; o worker roda como processo separado.
- **Comentário e nome de módulo em português.**

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `backend/migrations/008_fila_e_segredos.sql` (novo) | `email_send_queue`, `integration_secrets` |
| `backend/app/integracoes.py` (novo) | leitura de segredo, banco → ambiente, cache 60s |
| `backend/app/fila.py` (novo) | publicar, reivindicar com `SKIP LOCKED`, concluir, devolver |
| `backend/app/texto.py` (novo) | `html_para_texto` — a parte `text/plain` |
| `backend/app/email/montagem.py` (novo) | merge tags, rodapé, URL de descadastro, cabeçalhos |
| `backend/app/email/resend.py` (novo) | o cliente HTTP do Resend, e só isso |
| `backend/app/routers/envio.py` (novo) | `POST /campanhas/{id}/enviar` — o enfileirador |
| `backend/app/worker.py` (novo) | o laço `asyncio` que drena a fila |
| `backend/app/routers/publico.py` (modificar) | `/publico/descadastro` |
| `backend/tests/test_fila.py` (novo) | reivindicação, timeout, retentativa, fila-morta |
| `backend/tests/test_montagem.py` (novo) | merge tags, rodapé, token de descadastro |

---

## Tarefa 1: A fila e os segredos, no banco

**Arquivos:** cria `backend/migrations/008_fila_e_segredos.sql`

- [ ] **Passo 1: a migration**

```sql
-- 008: a fila de e-mail e os segredos de integração.
--
-- As duas substituem extensões do Supabase que não temos:
--   pgmq            -> email_send_queue, tabela comum + FOR UPDATE SKIP LOCKED
--   supabase_vault  -> integration_secrets, portado do integracoes.py do HS.OS
--
-- ⚠️ A fila de JORNADA (journey_events) NÃO entra aqui. É do lote 4, e criá-la
-- agora deixaria uma tabela sem ninguém escrevendo nem lendo.

CREATE TABLE IF NOT EXISTS public.email_send_queue (
    id           bigserial PRIMARY KEY,
    send_id      uuid NOT NULL,
    campaign_id  uuid NOT NULL,
    lead_id      uuid NOT NULL,
    -- Quantas vezes a mensagem já foi reivindicada. É o que separa "falhou uma
    -- vez" de "falha sempre" — e o que alimenta a fila-morta.
    tentativas   integer NOT NULL DEFAULT 0,
    -- Enquanto `visivel_em` estiver no futuro, a mensagem não é reivindicável.
    -- É o visibility timeout do pgmq, e é o que evita dois workers pegando a
    -- mesma mensagem: quem reivindica empurra este campo para frente na MESMA
    -- transação do SELECT ... FOR UPDATE SKIP LOCKED.
    visivel_em   timestamptz NOT NULL DEFAULT now(),
    ultimo_erro  text,
    criado_em    timestamptz NOT NULL DEFAULT now()
);

-- O índice que a reivindicação usa. Sem ele, cada tick do worker varre a fila
-- inteira — e uma fila de campanha tem dezenas de milhares de linhas.
CREATE INDEX IF NOT EXISTS idx_email_send_queue_pronta
    ON public.email_send_queue (visivel_em, id);

-- ⚠️ Um send_id só pode estar na fila uma vez. O enfileirador republica órfãos
-- de uma execução que morreu no meio (é o caminho de recuperação), e sem esta
-- restrição a republicação criaria uma segunda mensagem para o mesmo envio.
-- O envio duplicado ainda seria barrado pelo índice único de campaign_sends,
-- mas o worker faria o trabalho duas vezes e o erro ficaria invisível.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_email_send_queue_send
    ON public.email_send_queue (send_id);

-- A fila-morta. Mensagem que estourou o teto de tentativas sai da fila viva e
-- vem para cá — some da fila, mas NÃO some do mundo. Apagar direto esconderia
-- exatamente o caso que precisa ser investigado.
CREATE TABLE IF NOT EXISTS public.email_send_dead (
    id           bigserial PRIMARY KEY,
    send_id      uuid NOT NULL,
    campaign_id  uuid NOT NULL,
    lead_id      uuid NOT NULL,
    tentativas   integer NOT NULL,
    ultimo_erro  text,
    morto_em     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.integration_secrets (
    name       text PRIMARY KEY,
    value      text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- As três roles que a sessao() emite. `anon` NÃO recebe nada: segredo de
-- integração e fila não têm o que fazer numa requisição não autenticada.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_send_queue,
      public.email_send_dead, public.integration_secrets TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.email_send_queue_id_seq,
      public.email_send_dead_id_seq TO service_role;
```

- [ ] **Passo 2: aplicar e conferir**

```bash
bash scripts/aplicar-migrations.sh    # leia o cabeçalho: NÃO é idempotente
```

Confira que as três tabelas existem e que o índice único de `send_id` está lá.

- [ ] **Passo 3: commit**

---

## Tarefa 2: A leitura de segredo

**Arquivos:** cria `backend/app/integracoes.py`; modifica `app/config.py`

**Interfaces produzidas:** `async def ler_segredo(nome: str) -> str | None`

**Consome:** a tabela `integration_secrets` da tarefa 1.

- [ ] **Passo 1: o módulo**

⚠️ **Leia `~/github/HS.OS/backend/app/integracoes.py` antes de escrever.** Ele é
o mesmo port, do mesmo `_shared/integration-secret.ts`, já em produção. Copie a
ordem de resolução e o cache; não reinvente.

```python
"""Segredos de integração — o que o `supabase_vault` guardava.

Portado de `_shared/secrets.ts`, com a mesma ordem de leitura: **banco
primeiro, ambiente como rede de segurança**. O banco vem primeiro porque é a
fonte que dá para rotacionar sem mexer em deploy.

⚠️ NUNCA levanta. Falha de leitura no banco cai para o ambiente. Se esta função
lançasse, uma indisponibilidade momentânea do banco derrubaria o envio inteiro
— e, no caso do UNSUBSCRIBE_SECRET, faria todo descadastro dar 401 em silêncio.

⚠️ As duas pontas do HMAC de descadastro (o worker que assina e o endpoint que
verifica) TÊM de passar por aqui. Ler de fontes diferentes é o defeito que o
comentário do `_shared/secrets.ts` descreve em detalhe.
"""

import logging
import os
import time

from app.database import sessao

logger = logging.getLogger(__name__)

# 60s: curto o bastante para uma rotação aparecer rápido, longo o bastante para
# não consultar o banco a cada destinatário de uma campanha de 5.000.
_TTL = 60
_cache: dict[str, tuple[str | None, float]] = {}


async def ler_segredo(nome: str) -> str | None:
    agora = time.monotonic()
    guardado = _cache.get(nome)
    if guardado and agora - guardado[1] < _TTL:
        return guardado[0]

    valor: str | None = None
    try:
        async with sessao(role="service_role") as conn:
            valor = await conn.fetchval(
                "SELECT value FROM public.integration_secrets WHERE name = $1", nome)
    except Exception as e:  # noqa: BLE001 — degradar, não interromper
        logger.warning("Não foi possível ler o segredo %s do banco: %s", nome, e)

    if not valor:
        valor = os.environ.get(nome) or None

    _cache[nome] = (valor, agora)
    return valor


def esquecer(nome: str) -> None:
    """Descarta o cache de um segredo. Chamado depois de gravar um valor novo,
    para a rotação valer na hora em vez de esperar o TTL."""
    _cache.pop(nome, None)
```

- [ ] **Passo 2: declarar as chaves em `Settings`**

⚠️ O pydantic-settings **recusa chave desconhecida no `.env` e derruba o boot**.
Acrescente em `backend/app/config.py`:

```python
    # Envio de e-mail (lote 3B). Os valores podem vir daqui OU da tabela
    # integration_secrets — ver app/integracoes.py, que lê o banco primeiro.
    RESEND_API_KEY: str = ""
    EMAIL_FROM: str = ""
    UNSUBSCRIBE_SECRET: str = ""
    RESEND_WEBHOOK_SECRET: str = ""

    # Worker: quanto tempo uma mensagem fica invisível depois de reivindicada, e
    # quantas tentativas antes da fila-morta.
    FILA_VISIBILIDADE_SEGUNDOS: int = 120
    FILA_MAX_TENTATIVAS: int = 5
    FILA_LOTE: int = 20
    WORKER_INTERVALO_SEGUNDOS: float = 2.0
```

- [ ] **Passo 3: conferir** que `ler_segredo` devolve o valor do banco quando
  existe, o do ambiente quando não existe no banco, e `None` quando não existe
  em lugar nenhum — **sem levantar** em nenhum dos três casos.

- [ ] **Passo 4: commit**

---

## Tarefa 3: A fila, e o `pytest` que a spec exige

**Arquivos:** cria `backend/app/fila.py` e `backend/tests/test_fila.py`

**Interfaces produzidas:**
- `async def publicar(conn, mensagens: list[dict]) -> int`
- `async def reivindicar(conn, limite: int, visibilidade: int) -> list[Mensagem]`
- `async def concluir(conn, fila_id: int) -> None`
- `async def devolver(conn, fila_id: int, erro: str, max_tentativas: int) -> str`

- [ ] **Passo 1: escrever o teste ANTES do módulo**

A spec manda `pytest` exatamente aqui — retentativa, visibility timeout,
fila-morta e reprocessamento. Escreva estes quatro primeiro e veja-os falhar.

```python
"""O motor de fila. É o único lugar do projeto que nasce com teste automatizado.

⚠️ Estes testes usam o banco de verdade, numa transação que é SEMPRE revertida.
Nenhum deles pode deixar linha para trás — uma mensagem esquecida na fila viraria
e-mail enviado na próxima vez que o worker subir.
"""

import pytest

from app import fila


@pytest.mark.asyncio
async def test_reivindicar_esconde_a_mensagem_dos_outros(conexao, semear):
    """Duas reivindicações seguidas não podem devolver a mesma mensagem.

    É o visibility timeout: quem reivindica empurra `visivel_em` para frente na
    MESMA transação do SELECT. Sem isso, dois workers enviariam o mesmo e-mail —
    o índice único de campaign_sends barraria o segundo, mas o trabalho seria
    feito duas vezes e o erro ficaria invisível.
    """
    await semear(quantidade=1)
    primeira = await fila.reivindicar(conexao, limite=10, visibilidade=120)
    segunda = await fila.reivindicar(conexao, limite=10, visibilidade=120)
    assert len(primeira) == 1
    assert segunda == []


@pytest.mark.asyncio
async def test_mensagem_devolvida_volta_a_ficar_visivel(conexao, semear):
    """Devolver com tentativas abaixo do teto reagenda em vez de matar."""
    await semear(quantidade=1)
    [m] = await fila.reivindicar(conexao, limite=10, visibilidade=120)
    destino = await fila.devolver(conexao, m.fila_id, "erro de rede", max_tentativas=5)
    assert destino == "reagendada"
    # visivel_em no futuro: ainda não pode ser reivindicada de novo
    assert await fila.reivindicar(conexao, limite=10, visibilidade=120) == []


@pytest.mark.asyncio
async def test_estourar_o_teto_manda_para_a_fila_morta(conexao, semear):
    """A mensagem sai da fila viva, mas NÃO some do mundo.

    Apagar direto esconderia justamente o caso que precisa ser investigado.
    """
    await semear(quantidade=1)
    for _ in range(5):
        [m] = await fila.reivindicar(conexao, limite=10, visibilidade=0)
        destino = await fila.devolver(conexao, m.fila_id, "sempre falha", max_tentativas=5)
        # ⚠️ `devolver` empurra `visivel_em` para frente com recuo progressivo
        # (1min, 2min, 4min...). Sem trazer a mensagem de volta ao presente, a
        # segunda volta do laço não reivindicaria nada e o teste passaria por
        # engano, sem nunca chegar ao teto. O recuo tem teste próprio abaixo;
        # aqui o que se mede é o limite de tentativas.
        await conexao.execute(
            "UPDATE email_send_queue SET visivel_em = now() WHERE id = $1", m.fila_id)
    assert destino == "morta"
    assert await conexao.fetchval("SELECT count(*) FROM email_send_queue") == 0
    assert await conexao.fetchval("SELECT count(*) FROM email_send_dead") == 1


@pytest.mark.asyncio
async def test_o_recuo_cresce_a_cada_tentativa(conexao, semear):
    """Um erro de rede que dura dois minutos não pode consumir as cinco
    tentativas em dez segundos. O recuo é 1min, 2min, 4min..."""
    await semear(quantidade=1)
    esperas = []
    for _ in range(3):
        [m] = await fila.reivindicar(conexao, limite=10, visibilidade=0)
        await fila.devolver(conexao, m.fila_id, "erro", max_tentativas=99)
        esperas.append(await conexao.fetchval(
            "SELECT visivel_em - now() FROM email_send_queue WHERE id = $1", m.fila_id))
        await conexao.execute(
            "UPDATE email_send_queue SET visivel_em = now() WHERE id = $1", m.fila_id)
    assert esperas[0] < esperas[1] < esperas[2]


@pytest.mark.asyncio
async def test_publicar_o_mesmo_envio_duas_vezes_nao_duplica(conexao, semear):
    """A republicação de órfão é um caminho de recuperação, e tem de ser segura.

    O enfileirador republica mensagens de uma execução que morreu no meio. Sem
    a restrição única em send_id, a segunda publicação criaria uma mensagem
    irmã e o worker faria o trabalho duas vezes.
    """
    ids = await semear(quantidade=1)
    n = await fila.publicar(conexao, [ids[0]])
    assert n == 0
    assert await conexao.fetchval("SELECT count(*) FROM email_send_queue") == 1
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
cd backend && ./.venv/bin/pytest tests/test_fila.py -q
```
Esperado: **FAIL** — `app.fila` não existe.

- [ ] **Passo 3: as fixtures**

⚠️ `backend/tests/` hoje só tem `test_security.py`, que não toca o banco. Estas
fixtures são novas. A transação revertida é obrigatória — ver o aviso no topo
do arquivo de teste.

```python
# backend/tests/conftest.py
import asyncio
import pytest
import pytest_asyncio

import app.database as db


@pytest_asyncio.fixture
async def conexao():
    """Conexão em transação SEMPRE revertida, com o papel já aplicado.

    Nada que um teste escreve sobrevive. Uma mensagem esquecida na fila viraria
    e-mail enviado de verdade na próxima vez que o worker subisse.
    """
    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL — teste de fila exige banco")
    async with db._pool.acquire() as conn:
        tr = conn.transaction()
        await tr.start()
        await conn.execute("SET LOCAL ROLE service_role")
        try:
            yield conn
        finally:
            await tr.rollback()
    await db.close_db()


@pytest_asyncio.fixture
async def semear(conexao):
    """Cria campanha, contato e linhas de campaign_sends 'pending' na fila."""
    async def _semear(quantidade: int = 1):
        campanha = await conexao.fetchval(
            "INSERT INTO campaigns (name, channel, status) "
            "VALUES ('teste de fila', 'email', 'sending') RETURNING id")
        mensagens = []
        for i in range(quantidade):
            lead = await conexao.fetchval(
                "INSERT INTO leads (nome, email) VALUES ($1, $2) RETURNING id",
                f"Teste {i}", f"teste{i}@exemplo.invalid")
            send = await conexao.fetchval(
                "INSERT INTO campaign_sends (campaign_id, lead_id, channel, status) "
                "VALUES ($1, $2, 'email', 'pending') RETURNING id", campanha, lead)
            mensagens.append({"send_id": str(send), "campaign_id": str(campanha),
                              "lead_id": str(lead)})
        from app import fila
        await fila.publicar(conexao, mensagens)
        return mensagens
    return _semear
```

⚠️ `pytest-asyncio` pode não estar instalado. Confira antes:
`./.venv/bin/pip show pytest-asyncio` — se faltar, instale e acrescente ao
`requirements.txt`.

- [ ] **Passo 4: o módulo da fila**

```python
"""A fila de envio. É o que o `pgmq` fazia, escrito à mão.

O pgmq é, por dentro, uma tabela com `SELECT ... FOR UPDATE SKIP LOCKED` e um
campo de visibilidade. Reimplementá-lo é o custo honesto de não instalar uma
extensão em Rust num Postgres que serve os bancos da empresa.
"""

import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Mensagem:
    fila_id: int
    send_id: str
    campaign_id: str
    lead_id: str
    tentativas: int


async def publicar(conn, mensagens: list[dict]) -> int:
    """Põe mensagens na fila. Devolve quantas ENTRARAM de fato.

    ⚠️ `ON CONFLICT DO NOTHING` no `send_id`: republicar um órfão é o caminho de
    recuperação do enfileirador, e tem de ser inofensivo. O retorno menor que o
    enviado não é erro — é a restrição fazendo o trabalho dela.
    """
    if not mensagens:
        return 0
    linhas = await conn.fetch(
        """INSERT INTO email_send_queue (send_id, campaign_id, lead_id)
           SELECT (m->>'send_id')::uuid, (m->>'campaign_id')::uuid,
                  (m->>'lead_id')::uuid
             FROM jsonb_array_elements($1::jsonb) AS m
           ON CONFLICT (send_id) DO NOTHING
           RETURNING id""",
        mensagens)
    return len(linhas)


async def reivindicar(conn, limite: int, visibilidade: int) -> list[Mensagem]:
    """Pega até `limite` mensagens prontas e as esconde por `visibilidade` s.

    ⚠️ O UPDATE e o SELECT são a MESMA instrução. Separá-los abriria uma janela
    em que dois workers veem a mesma linha — e o `SKIP LOCKED` sozinho não
    fecha essa janela depois que a transação do primeiro termina.
    """
    linhas = await conn.fetch(
        """UPDATE email_send_queue q
              SET visivel_em = now() + make_interval(secs => $2),
                  tentativas = q.tentativas + 1
            WHERE q.id IN (
                SELECT id FROM email_send_queue
                 WHERE visivel_em <= now()
                 ORDER BY id
                 LIMIT $1
                 FOR UPDATE SKIP LOCKED
            )
          RETURNING q.id, q.send_id::text, q.campaign_id::text,
                    q.lead_id::text, q.tentativas""",
        limite, visibilidade)
    return [Mensagem(fila_id=l["id"], send_id=l["send_id"],
                     campaign_id=l["campaign_id"], lead_id=l["lead_id"],
                     tentativas=l["tentativas"]) for l in linhas]


async def concluir(conn, fila_id: int) -> None:
    """Tira a mensagem da fila. Só depois do envio confirmado."""
    await conn.execute("DELETE FROM email_send_queue WHERE id = $1", fila_id)


async def devolver(conn, fila_id: int, erro: str, max_tentativas: int) -> str:
    """Reagenda a mensagem, ou a manda para a fila-morta se estourou o teto.

    Devolve 'reagendada' ou 'morta'. ⚠️ A fila-morta não é descarte: a mensagem
    sai da fila viva e continua registrada, com o último erro. Apagar direto
    esconderia justamente o caso que precisa ser investigado.
    """
    linha = await conn.fetchrow(
        "SELECT tentativas FROM email_send_queue WHERE id = $1", fila_id)
    if linha is None:
        return "reagendada"

    if linha["tentativas"] >= max_tentativas:
        await conn.execute(
            """INSERT INTO email_send_dead
                   (send_id, campaign_id, lead_id, tentativas, ultimo_erro)
               SELECT send_id, campaign_id, lead_id, tentativas, $2
                 FROM email_send_queue WHERE id = $1""",
            fila_id, erro)
        await conn.execute("DELETE FROM email_send_queue WHERE id = $1", fila_id)
        return "morta"

    # Recuo progressivo: 1min, 2min, 4min... Um erro de rede que dura dois
    # minutos não deve consumir as cinco tentativas em dez segundos.
    await conn.execute(
        """UPDATE email_send_queue
              SET visivel_em = now() + make_interval(secs => 60 * power(2, tentativas - 1)),
                  ultimo_erro = $2
            WHERE id = $1""",
        fila_id, erro)
    return "reagendada"
```

- [ ] **Passo 5: rodar os testes e vê-los passar**

```bash
cd backend && ./.venv/bin/pytest tests/test_fila.py -q
```
Esperado: **5 passed**. E `pytest -q` inteiro continua verde.

- [ ] **Passo 6: commit**

---

## Tarefa 4: A parte `text/plain`

**Arquivos:** cria `backend/app/texto.py` e `backend/tests/test_texto.py`

**Interfaces produzidas:** `def html_para_texto(html: str) -> str`

- [ ] **Passo 1: leia o original antes de escrever**

`backend/supabase/functions/_shared/htmlToText.ts`, 161 linhas. **Não é um
parser** — é uma sequência de substituições calibrada para o HTML que o Unlayer
exporta: tabelas aninhadas, comentários condicionais do Outlook (`<!--[if mso]>`),
`<style>` no `<head>` e entidades HTML.

Em Python isso encolhe: `html.unescape` da biblioteca padrão resolve a tabela de
entidades Latin-1 inteira, que no TypeScript teve de ser construída à mão. **Não
porte a tabela.**

⚠️ O que NÃO encolhe e tem de vir junto:
- `<style>`, `<script>` e os condicionais do Outlook saem **com o conteúdo**
- `<br>` e o fim de bloco viram quebra de linha
- espaços que não quebram (`&nbsp;`, `U+00A0`, `U+2007`, `U+202F`) viram espaço
  **comum**, senão o colapso de espaços não os pega e o texto sai com espaços
  duplos espalhados
- codepoints invisíveis (`U+200B`, `U+FEFF`, `U+00AD`, o `&#847;` do preheader)
  viram vazio
- **nunca levanta**: uma exceção aqui derrubaria o envio de um destinatário

- [ ] **Passo 2: o teste, antes**

```python
from app.texto import html_para_texto


def test_tira_style_e_condicional_do_outlook_com_o_conteudo():
    html = ("<style>.a{color:red}</style><!--[if mso]><td>lixo</td><![endif]-->"
            "<p>Olá</p>")
    assert html_para_texto(html) == "Olá"


def test_entidades_e_espaco_que_nao_quebra():
    # &nbsp; tem de virar espaço COMUM, ou o colapso não o pega
    assert html_para_texto("<p>Ol&aacute;&nbsp;&nbsp;mundo</p>") == "Olá mundo"


def test_quebra_de_linha_em_br_e_fim_de_bloco():
    assert html_para_texto("<p>um</p><p>dois<br>três</p>") == "um\n\ndois\ntrês"


def test_codepoint_invisivel_some():
    assert html_para_texto("<p>a&#8203;b&#847;</p>") == "ab"


def test_nunca_levanta():
    # Entrada absurda não pode derrubar o envio de um destinatário
    assert isinstance(html_para_texto("<p>&#xFFFFFFFF;<<<"), str)
```

- [ ] **Passo 3: rodar e ver falhar**, depois escrever `app/texto.py` até passar.

- [ ] **Passo 4: commit**

---

## Tarefa 5: A montagem do e-mail, por destinatário

**Arquivos:** cria `backend/app/email/__init__.py` e `backend/app/email/montagem.py`;
cria `backend/tests/test_montagem.py`

**Interfaces produzidas:**
- `def url_de_descadastro(base: str, lead_id: str, email: str, segredo: str) -> str`
- `def aplicar_merge_tags(html: str, contato: dict, url_descadastro: str) -> str`
- `def garantir_rodape(html: str, url_descadastro: str) -> str`
- `def cabecalhos_rfc8058(url_descadastro: str) -> dict[str, str]`

**Consome:** `app.texto.html_para_texto` (tarefa 4), `app.integracoes.ler_segredo`
(tarefa 2).

⚠️ **Esta é a tarefa cuja referência não existe.** Cada função abaixo se deriva
de uma contraparte que está no repositório — a tabela no topo deste plano diz
qual. Escrever de memória é o erro que a memória do projeto registra como "quase
perdeu os UTMs do `fn_lead_insert_event`".

- [ ] **Passo 1: o teste do token, casado com o verificador**

```python
import base64, hashlib, hmac

from app.email.montagem import url_de_descadastro


def _token_como_o_verificador_calcula(lead_id: str, email: str, segredo: str) -> str:
    """Cópia literal de email-unsubscribe/index.ts::computeToken.

    Se este teste passar, as duas pontas concordam. Se divergirem, todo o
    descadastro passa a dar 401 — e ninguém percebe até um contato reclamar.
    """
    mac = hmac.new(segredo.encode(), f"{lead_id}:{email}".encode(), hashlib.sha256).digest()
    return base64.b64encode(mac).decode().replace("+", "-").replace("/", "_").rstrip("=")


def test_token_bate_com_o_verificador():
    url = url_de_descadastro("https://x.test", "abc-123", "Joao@Empresa.com ", "s3cr3t")
    from urllib.parse import parse_qs, urlparse
    q = parse_qs(urlparse(url).query)
    # ⚠️ o verificador normaliza com .toLowerCase().trim() ANTES de conferir:
    # assinar o valor cru daria 401 em todo endereço com maiúscula
    assert q["t"][0] == _token_como_o_verificador_calcula("abc-123", "joao@empresa.com", "s3cr3t")


def test_email_vai_em_base64url_dos_bytes_utf8():
    url = url_de_descadastro("https://x.test", "abc-123", "joão@empresa.com", "s3cr3t")
    from urllib.parse import parse_qs, urlparse
    e = parse_qs(urlparse(url).query)["e"][0]
    pad = "=" * (-len(e) % 4)
    assert base64.urlsafe_b64decode(e + pad).decode() == "joão@empresa.com"
```

- [ ] **Passo 2: o teste do rodapé e das merge tags**

```python
from app.email.montagem import aplicar_merge_tags, garantir_rodape


def test_merge_tags_do_contato():
    html = "<p>Olá {{nome}}, da {{empresa}} ({{email}})</p>"
    saida = aplicar_merge_tags(html, {"nome": "Carla", "empresa": "HS",
                                      "email": "c@hs.com"}, "https://x.test/u")
    assert saida == "<p>Olá Carla, da HS (c@hs.com)</p>"


def test_campo_vazio_vira_string_vazia_nao_a_tag_crua():
    # Deixar "{{nome}}" no corpo é pior que deixar em branco: o contato vê o
    # esqueleto do template.
    saida = aplicar_merge_tags("<p>Olá {{nome}}</p>", {"nome": None}, "https://x.test/u")
    assert "{{nome}}" not in saida


def test_unsubscribe_url_substituida_quando_o_template_a_declara():
    saida = aplicar_merge_tags('<a href="{{unsubscribe_url}}">sair</a>', {}, "https://x.test/u")
    assert 'href="https://x.test/u"' in saida


def test_rodape_so_entra_quando_o_link_nao_existe():
    com_link = '<a href="https://x.test/u">sair</a>'
    assert garantir_rodape(com_link, "https://x.test/u") == com_link
    sem_link = "<p>corpo</p>"
    assert "https://x.test/u" in garantir_rodape(sem_link, "https://x.test/u")
```

- [ ] **Passo 3: rodar e ver falhar**, depois escrever `montagem.py`.

⚠️ Pontos que o módulo tem de respeitar, e que só aparecem lendo as contrapartes:

- as merge tags são `{{nome}}`, `{{empresa}}`, `{{email}}` e `{{unsubscribe_url}}`
  — exatamente as de `emailEditorConfig.ts::EMAIL_MERGE_TAGS`
- o rodapé automático **só entra se o HTML final não tiver o link** — o template
  pode declarar `{{unsubscribe_url}}` para controlar posição e estilo
- `cabecalhos_rfc8058` devolve
  `List-Unsubscribe: <url>` e `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
  ⚠️ O `List-Unsubscribe-Post` é o que faz Gmail e Yahoo mostrarem o botão nativo
  — e é por isso que o endpoint de descadastro precisa aceitar **POST**
- a parte texto sai de `html_para_texto(html_final)`, **depois** das merge tags e
  do rodapé: é o que faz o texto espelhar o que foi enviado

- [ ] **Passo 4: commit**

---

## Tarefa 6: O enfileirador

**Arquivos:** cria `backend/app/routers/envio.py`; modifica `app/main.py`

**Interfaces produzidas:** `POST /campanhas/{id}/enviar` → `{queued: int}`

**Consome:** `app.fila.publicar` (tarefa 3).

⚠️ **Leia `send-campaign/index.ts` inteiro antes.** São 500 linhas densamente
comentadas, e os comentários explicam decisões que não se deduzem do código.
Este passo é um **port**, não uma reescrita.

- [ ] **Passo 1: o claim atômico**

```python
@router.post("/{campanha_id}/enviar")
async def enviar(campanha_id: str, _: Usuario = Depends(admin_atual)):
    """Enfileira a campanha. Devolve na hora; quem envia é o worker.

    ⚠️ `admin_atual`, não `usuario_atual`. A function de origem rodava com
    `verify_jwt=false` e SEM checagem no corpo: qualquer pessoa que descobrisse
    o UUID de uma campanha forçava o envio para até 5.000 contatos com um POST
    anônimo. Foi corrigido lá e não se reintroduz aqui.
    """
```

O núcleo, portado:

```python
# Status a partir dos quais uma campanha pode ser (re)enfileirada.
# 'sending' e 'sent' ficam de fora: é o que impede enfileiramento duplo.
INICIAVEL = ("draft", "scheduled", "failed", "paused")

# ⚠️ CLAIM ATÔMICO, antes de qualquer trabalho pesado. Duas chamadas
# concorrentes disputam este UPDATE; a perdedora recebe 0 linhas e aborta. É
# isto que garante que uma campanha nunca é enfileirada duas vezes.
r = await conn.execute(
    """UPDATE campaigns SET status = 'sending', updated_at = now()
        WHERE id = $1::uuid AND status = $2""",
    campanha_id, estado_observado)
if r.endswith(" 0"):
    raise HTTPException(status.HTTP_409_CONFLICT,
                        "Esta campanha já está em envio.")
```

- [ ] **Passo 2: a audiência, e as duas passadas**

⚠️ Três coisas que o original documenta e que se perdem se você reescrever:

1. **A audiência sai de `resolve_segment_audience`** — a MESMA RPC que o card
   mostra. Duas implementações divergiriam, e a divergência apareceria como "o
   card dizia 500 e saíram 480".
2. **Teto de 5.000 SÓ no caminho "todos os contatos"** (sem segmento de
   inclusão). Com segmentos não há teto — é o comportamento anterior, e o
   endpoint de audiência do 3A já devolve `teto_aplicado` avisando disso.
3. **Duas passadas, nesta ordem:** primeiro inserir `campaign_sends` `pending`,
   só depois publicar na fila. E o reenfileiramento trata as linhas existentes
   em **dois casos separados**:
   - linha **não-`pending`** → o contato já foi processado: exclui da audiência
   - linha **`pending`** → órfã de uma execução que morreu antes de publicar:
     **não re-inserir** (o índice único barra), mas **republicar** o `send_id`.
     É isto que faz de um re-run um caminho de recuperação real.

   Tratá-las igual encalha a órfã para sempre: não pode ser re-inserida nem
   seria republicada, e a campanha ficaria presa em `sending` com `pending > 0`
   impedindo o `finalize`.

- [ ] **Passo 3: a regra de quando NÃO desfazer o claim**

```python
# ⚠️ Só é seguro devolver a campanha ao status anterior se NENHUMA mensagem
# chegou à fila. Depois da primeira publicação bem-sucedida, reverter faria:
#   (a) o worker ver status != 'sending' e falhar TERMINALMENTE cada envio já
#       publicado;
#   (b) um re-run posterior excluir esses leads da audiência (status 'failed'
#       não é 'pending') — os contatos nunca mais receberiam, em silêncio.
# Preferimos deixar a campanha em 'sending': o worker drena o que foi publicado.
publicou_alguma = False
```

- [ ] **Passo 4: trocar o aviso do wizard pela chamada de verdade**

No `CampaignWizard.tsx`, onde o 3A deixou o `toast.info` dizendo que o envio
chega no próximo lote. Agora chega. ⚠️ **Não** reintroduza
`supabase.functions.invoke` — a Edge Function não volta.

- [ ] **Passo 5: conferir por HTTP**, com uma campanha de 2 contatos:
  enfileirar devolve `{queued: 2}`; enfileirar de novo devolve **409**; a
  campanha fica em `sending` e há 2 linhas em `email_send_queue`.
  **Sem worker rodando ainda — nada é enviado.**

- [ ] **Passo 6: commit**

---

## Tarefa 7: O worker

**Arquivos:** cria `backend/app/worker.py` e `backend/app/email/resend.py`

**Consome:** tudo das tarefas 2 a 5.

- [ ] **Passo 1: o cliente do Resend, e só isso**

```python
"""O cliente HTTP do Resend. Uma responsabilidade só: falar com a API.

Separado do worker de propósito — é o único ponto do sistema que faz rede para
fora, e é o que um teste precisa substituir para rodar sem enviar nada.
"""

import httpx

API = "https://api.resend.com/emails"


async def enviar(chave: str, de: str, para: str, assunto: str,
                 html: str, texto: str, cabecalhos: dict) -> str:
    """Devolve o id do e-mail no Resend. Levanta em qualquer falha.

    ⚠️ Levantar é o certo aqui: quem chama é o worker, que sabe transformar
    exceção em retentativa. Engolir o erro e devolver None faria a mensagem sair
    da fila como se tivesse sido enviada.
    """
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(API, headers={"Authorization": f"Bearer {chave}"},
                         json={"from": de, "to": [para], "subject": assunto,
                               "html": html, "text": texto, "headers": cabecalhos})
    r.raise_for_status()
    return r.json().get("id", "")
```

- [ ] **Passo 2: o laço**

```python
"""O worker: drena a fila de e-mail e roda o agendador.

Substitui o `pg_cron` por um laço `asyncio`, no padrão do `guardiao_crons.py`
do HS.OS. Roda como processo separado (`python -m app.worker`) porque
reiniciar a API não pode pausar um disparo em andamento, e uma exceção no envio
não pode derrubar o admin.
"""
```

⚠️ A ordem dentro de cada mensagem importa, e cada passo tem um porquê:

1. **Reivindicar** um lote (`fila.reivindicar`).
2. Para cada mensagem, numa transação:
   a. reler o `campaign_sends` — **se não estiver `pending`, pular e concluir**.
      É o que torna o reprocessamento inofensivo: outra passagem já enviou.
   b. reler o status da campanha — se não estiver `sending`, marcar o envio
      como `failed` e concluir. Campanha cancelada não deve continuar saindo.
   c. **conferir a supressão** (`email_suppressions`). Suprimido vira
      `status='suppressed'`, **não** `failed`: não é erro, é a lista de
      descadastro funcionando, e o `finalize` conta os dois separados.
   d. montar o e-mail (tarefa 5) e enviar (`resend.enviar`).
   e. marcar `sent` com `resend_email_id` e `sent_at`, e **concluir** a mensagem.
3. Erro em (d) → `fila.devolver`, que reagenda ou manda para a fila-morta.
4. Depois do lote, chamar `finalize_campaign_if_drained` para cada campanha
   tocada.

⚠️ **Sem `RESEND_API_KEY`, o worker registra e NÃO reivindica nada.** Fingir que
enviou seria o pior comportamento possível: as linhas sairiam de `pending`, a
campanha fecharia como enviada, e ninguém receberia nada.

- [ ] **Passo 3: conferir com a fila cheia e sem chave**

Suba o worker sem `RESEND_API_KEY` e confirme que ele **não** consome a fila e
diz por quê no log. Este é o teste que garante que o modo degradado não mente.

- [ ] **Passo 4: o primeiro envio de verdade**

⚠️ **Este passo precisa do Erick.** Ele exige uma `RESEND_API_KEY` real e um
domínio verificado. Monte o script, não o execute sozinho:

```bash
# grava o segredo no banco (não no repositório)
# ⚠️ pede a chave do Resend e o remetente do domínio verificado
```

Envie para **um endereço de teste do próprio Erick**, com uma campanha de UM
contato. Confira: o e-mail chega, o corpo tem as merge tags trocadas, existe
link de descadastro, e a parte texto espelha o HTML.

- [ ] **Passo 5: commit**

---

## Tarefa 8: O descadastro

**Arquivos:** modifica `backend/app/routers/publico.py`

**Interfaces produzidas:** `GET /publico/descadastro` e `POST /publico/descadastro`

- [ ] **Passo 1: portar `email-unsubscribe/index.ts`**

⚠️ **GET e POST fazem coisas diferentes, e a diferença é a RFC 8058:**

- **GET só valida o token e devolve o e-mail.** Nenhuma escrita. O link clicável
  do corpo é pré-carregado por muitos clientes de e-mail — se o GET
  descadastrasse, o contato sairia da lista sem ter clicado em nada.
- **POST descadastra de fato.** É o que o botão nativo do Gmail/Yahoo chama
  (one-click) e o que a página de confirmação do app chama.

- [ ] **Passo 2: a comparação do token em tempo constante**

`hmac.compare_digest`, nunca `==`. ⚠️ E compare **bytes ou str, dos dois lados
igual** — a pegadinha do `compare_digest` com tipos misturados já mordeu no
GestorHS (ver `project-gestorhs-sso-microsoft`).

- [ ] **Passo 3: a supressão é o efeito que precisa dar certo**

```python
# ⚠️ Se a supressão falhar, responda 500. O provedor (Gmail/Yahoo) re-tenta o
# POST one-click, e é isso que queremos: a lista de descadastro é a fonte da
# verdade de compliance. Um 200 com a gravação falhada perderia o pedido.
```

- [ ] **Passo 4: conferir** que o token do worker é aceito pelo endpoint —
  gere uma URL com `url_de_descadastro` e chame o endpoint com ela. Este é o
  teste que prova que as duas pontas leem o mesmo segredo.

- [ ] **Passo 5: commit**

---

## Tarefa 9: Fechar o lote

- [ ] **Passo 1: o portão, as três partes.** ⚠️ E lembre do que o 3A ensinou:
  uma function com **dupla face** (chave de API além do JWT) não fica órfã só
  porque a tela foi portada.

```bash
grep -rn "send-campaign\|process-email-queue\|email-unsubscribe" frontend/src frontend/public backend/app
```

`send-campaign` e `email-unsubscribe` podem sair **se** a metade pública tiver
substituto. `send-test-email`, `resend-*` e o restante continuam — são do 3C.

- [ ] **Passo 2: o placar.** Meça, não herde.

- [ ] **Passo 3: `ROADMAP.md` e `CONTINUAR-AQUI.md`.**

- [ ] **Passo 4: commit**

---

## Definição de pronto do 3B

- [ ] `pytest` cobre reivindicação, visibility timeout, retentativa e fila-morta
- [ ] Reivindicar duas vezes seguidas **não** devolve a mesma mensagem
- [ ] Mensagem que estoura o teto vai para `email_send_dead`, não é apagada
- [ ] Republicar um `send_id` já na fila **não** cria uma segunda mensagem
- [ ] Enfileirar a mesma campanha duas vezes devolve **409** na segunda
- [ ] Sem `RESEND_API_KEY`, o worker **não** consome a fila e diz por quê
- [ ] Contato na lista de supressão vira `suppressed`, não `failed`
- [ ] O token que o worker assina é aceito pelo endpoint de descadastro
- [ ] GET no link de descadastro **não** descadastra; POST descadasta
- [ ] **Uma campanha de teste chega numa caixa de entrada de verdade**
- [ ] `pytest` inteiro continua passando

## O que este lote NÃO entrega

Webhook do Resend (abertura e clique não voltam), métricas de entrega,
agendamento (`promote_scheduled_campaigns` continua quebrada), a tela de
configuração do Resend, a lista de supressão na interface, e a metade pública de
`campaigns-api` / `templates-api`. Tudo isso é **3C**.
