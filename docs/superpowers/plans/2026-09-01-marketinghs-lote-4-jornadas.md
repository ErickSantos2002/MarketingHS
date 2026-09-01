# MarketingHS — Lote 4: Jornadas — Plano

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — `superpowers:subagent-driven-development`
> ou `superpowers:executing-plans`. Os passos usam caixa (`- [ ]`).

**Objetivo:** um fluxo de dois passos com condicional roda de ponta a ponta —
contato entra, espera, o e-mail sai pela fila do lote 3B, e o ramo certo é
seguido.

**Arquitetura:** o executor de nós vira Python no worker que já existe. A fila
de eventos do `pgmq` vira tabela comum, como a de e-mail. As funções de jornada
que sobreviveram ao port **não são reimplementadas** — elas fazem o trabalho
pesado e estão em produção há meses.

**Stack:** FastAPI, asyncpg · `asyncio` no worker · React 18

**Spec:** `docs/superpowers/specs/2026-08-31-marketinghs-design.md`
**Lote anterior:** `docs/superpowers/plans/2026-09-01-marketinghs-lote-3c-retorno.md`

---

## O que você precisa saber antes de começar

### O banco já faz quase tudo. Confira antes de escrever.

✅ **Verificadas como presentes:**

| Função | O que faz |
|---|---|
| `journey_claim_due_runs(limit, lease)` | **reivindica** os runs vencidos com lease e `FOR UPDATE SKIP LOCKED`, e devolve os nós da jornada junto |
| `journey_wake_on_event(lead, tipo, quando, meta)` | acorda quem esperava aquele evento; devolve `{woken, deferred}` |
| `journey_enroll_event(lead, tipo)` | matricula quem entra por evento |
| `journey_enroll_segment(journey, limit)` | matricula quem entra por segmento |
| `journey_node_metrics(journey)` | as métricas por nó, para o board |
| `validate_journey_graph(nodes, entry)` | valida o grafo |
| `evaluate_rules_for_lead(lead, rules, logic)` | o `branch_attribute` |
| `evaluate_segment_for_lead(lead, segment)` | o `branch_segment` |
| `guard_journey_delete()` / `fn_journeys_validate()` | triggers |
| `recover_lost_journey_sends()` | varredura de envios órfãos |

⚠️ **`journey_claim_due_runs` já é o motor de reivindicação.** Diferente do
e-mail, a jornada **não precisa de tabela de fila para os runs** — o claim sai
direto de `journey_runs`, com `lock_token` e `locked_until`. Não crie uma fila
para isso.

**Falta uma só:** `journey_enqueue_email(run_id, node_id, journey_id, lead_id)`.
Ela foi removida no lote 0 por depender do `pgmq`.

### O que a fila de eventos faz, e por que ela é diferente

O trigger `fn_contact_event_to_journey_queue` (removido) publicava no `pgmq` a
cada `contact_events` novo, e o worker lia para (a) acordar quem esperava e (b)
matricular quem entra por evento.

Isso **precisa** de uma fila: o trigger roda dentro da transação de quem grava o
evento, e chamar `journey_wake_on_event` ali seria fazer trabalho pesado
segurando a transação de quem só quis registrar uma abertura de e-mail.

⚠️ **Mas o trigger não pode publicar `pgmq.send()`** — vira `INSERT` numa tabela
comum. A spec diz literalmente: *"Fica mais simples do que está."*

### Os oito tipos de nó, e onde cada um se resolve

| Tipo | Como resolver |
|---|---|
| `send_email` | `journey_enqueue_email` (a criar) → a fila do 3B faz o resto |
| `delay` | grava `wakeup_at` e devolve o run para o banco |
| `wait_for_event` | grava `waiting_event` + `wakeup_at` (o timeout) |
| `branch_attribute` | `evaluate_rules_for_lead` |
| `branch_segment` | `evaluate_segment_for_lead` |
| `branch_email_event` | consulta direta em `campaign_sends` por `(journey_run_id, journey_node_id)` |
| `apply_tag` | insere em `lead_tags`, criando a tag se não existir |
| `handoff_nexus` | ⚠️ **é do lote 5** — falhe explicitamente |

⚠️ **`handoff_nexus` não se implementa aqui.** Ele entrega o contato ao
GrowthHS, e a integração é o lote 5. Um nó desse tipo tem de registrar
`failed` com a razão, **não** ser tratado como sucesso: um fluxo que "entregou
ao comercial" sem entregar nada é pior que um que falhou visivelmente.

### O índice único é o que torna a reexecução segura

```
uniq_campaign_sends_journey_node (journey_run_id, journey_node_id)
    WHERE journey_run_id IS NOT NULL
```

Um lease que expira faz o run ser reivindicado de novo e o nó `send_email`
reexecutado. O segundo `INSERT` bate no índice — **nenhum segundo e-mail é
criado**. É o mesmo desenho do lote 3B, e é o que permite o lease ser curto.

### `writeRun` é um CAS, e tem de continuar sendo

O worker só grava o run se o `lock_token` ainda for o dele. Um lease expirado
com outro worker já trabalhando no mesmo run: quem perdeu descobre porque o
UPDATE afeta zero linhas, e para. **Sem isso, dois workers avançam o mesmo
contato por caminhos diferentes do fluxo.**

---

## Restrições globais

- **`sessao()` é o único caminho para dado.**
- **`role="service_role"` + autorização explícita na rota.**
- **Não reimplemente as funções de jornada que sobreviveram.** A lista está
  acima; confira com `\df` antes de escrever qualquer coisa parecida.
- **O portão tem TRÊS partes**, e a documentação conta — ela pegou defeito em
  todos os lotes até aqui.
- **Comentário e nome de módulo em português.**

---

## Tarefa 1: `journey_enqueue_email` e a fila de eventos

**Arquivos:** cria `backend/migrations/010_jornadas.sql`

- [ ] **Passo 1: a tabela da fila de eventos**

```sql
-- 010: a fila de eventos de jornada e o enfileirador de e-mail do fluxo.
--
-- ⚠️ Diferente do e-mail, a jornada NÃO tem fila para os runs:
-- journey_claim_due_runs já reivindica direto de journey_runs, com lock_token e
-- locked_until. Esta fila é só para os EVENTOS — o trigger roda dentro da
-- transação de quem grava o contact_event, e fazer o trabalho de acordar fluxos
-- ali seguraria a transação de quem só quis registrar uma abertura de e-mail.

CREATE TABLE IF NOT EXISTS public.journey_events (
    id          bigserial PRIMARY KEY,
    lead_id     uuid NOT NULL,
    event_type  text NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
    visivel_em  timestamptz NOT NULL DEFAULT now(),
    tentativas  integer NOT NULL DEFAULT 0,
    criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_journey_events_pronta
    ON public.journey_events (visivel_em, id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.journey_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.journey_events_id_seq TO service_role;
```

- [ ] **Passo 2: o trigger que alimenta a fila**

```sql
-- Substitui fn_contact_event_to_journey_queue, que fazia pgmq.send().
-- ⚠️ Só INSERT, e nada mais: o que roda aqui roda dentro da transação de quem
-- gravou o evento.
CREATE OR REPLACE FUNCTION public.fn_contact_event_to_journey_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    INSERT INTO public.journey_events (lead_id, event_type, occurred_at, metadata)
    VALUES (NEW.lead_id, NEW.event_type,
            COALESCE(NEW.occurred_at, now()), COALESCE(NEW.metadata, '{}'::jsonb));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_contact_event_journey ON public.contact_events;
CREATE TRIGGER trg_contact_event_journey
  AFTER INSERT ON public.contact_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_contact_event_to_journey_queue();
```

✅ **Colunas de `contact_events` verificadas:** `id, dnia_id, lead_id,
source_app, event_type, title, description, metadata, occurred_at`. As quatro
que o trigger usa existem, e `lead_id`, `metadata` e `occurred_at` são
nuláveis — daí o `IF NEW.lead_id IS NOT NULL` e os `COALESCE`.

⚠️ Errar um nome de coluna aqui quebraria a inserção de QUALQUER evento de
contato, não só a jornada: o trigger roda em toda linha de `contact_events`.

- [ ] **Passo 3: `journey_enqueue_email`**

```sql
-- Cria a linha de campaign_sends do nó e a põe na fila de e-mail do lote 3B.
--
-- ⚠️ O índice uniq_campaign_sends_journey_node é o que torna a reexecução
-- inofensiva: lease expirado faz o nó rodar de novo, e o segundo INSERT bate no
-- índice. Devolve 'duplicate' em vez de criar um segundo e-mail.
CREATE OR REPLACE FUNCTION public.journey_enqueue_email(
    p_run_id uuid, p_node_id text, p_journey_id uuid, p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_send_id uuid;
BEGIN
  INSERT INTO public.campaign_sends
      (lead_id, channel, status, journey_run_id, journey_node_id)
  VALUES (p_lead_id, 'email', 'pending', p_run_id, p_node_id)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_send_id;

  IF v_send_id IS NULL THEN
    RETURN jsonb_build_object('status', 'duplicate');
  END IF;

  INSERT INTO public.email_send_queue (send_id, campaign_id, lead_id)
  VALUES (v_send_id, NULL, p_lead_id)
  ON CONFLICT (send_id) DO NOTHING;

  RETURN jsonb_build_object('status', 'enqueued', 'send_id', v_send_id);
END $$;
```

✅ **Verificado: `email_send_queue.campaign_id` É `NOT NULL`** (assim como
`send_id` e `lead_id`). E-mail de fluxo não tem campanha, então a coluna precisa
aceitar nulo. A alternativa — uma coluna de origem na fila — é maior e não
compra nada: `campaign_id` nulo já significa "não é de campanha".

```sql
ALTER TABLE public.email_send_queue ALTER COLUMN campaign_id DROP NOT NULL;
```

⚠️ E o worker do 3B **assume campanha**: ele lê `c.status` da campanha e recusa
o envio se ela não estiver em `sending`. Com `campaign_id` nulo esse caminho
precisa mudar — está na tarefa 3.

- [ ] **Passo 4: aplicar e conferir** que o trigger não quebra a inserção de um
  `contact_event` comum. **Teste inserindo um evento de verdade e conferindo que
  ele aparece nas duas tabelas.**

- [ ] **Passo 5: commit**

---

## Tarefa 2: A API de jornadas

**Arquivos:** cria `backend/app/routers/jornadas.py`; modifica `app/main.py`

**Interfaces produzidas:** `GET /jornadas`, `GET /jornadas/{id}`,
`POST /jornadas`, `PATCH /jornadas/{id}`, `DELETE /jornadas/{id}`,
`GET /jornadas/{id}/execucoes`

- [ ] **Passo 1: leia `journeys-api/index.ts`** (159 linhas). Ele agrega a
  contagem de runs por estado em cada jornada — e faz isso buscando TODOS os
  runs e contando no cliente. Uma subconsulta lateral resolve, no mesmo padrão
  que o lote 3A usou nas campanhas.

- [ ] **Passo 2: as métricas do board** saem de `journey_node_metrics(journey)`,
  que já existe. **Não recalcule por nó no Python.**

- [ ] **Passo 3: a exclusão** preserva a mensagem de `guard_journey_delete` como
  **409**, igual ao que os lotes 2 e 3A fizeram com segmento e campanha.
  ✅ **Corpo da guarda já lido** — não presuma, está aqui:

  ```
  IF OLD.status IS DISTINCT FROM 'draft' -> 'fluxo % nao pode ser excluido (status %)'
  IF EXISTS (journey_runs do fluxo)      -> 'fluxo % ja possui execucoes'
  ```

  Ou seja: **só fluxo em `draft` e sem nenhuma execução pode ser apagado.** É
  mais restritivo que a guarda de campanha. No 3A o plano descreveu errado a de
  campanha e o teste teria falhado — por isso esta veio lida.

- [ ] **Passo 4: conferir por HTTP e commitar**

---

## Tarefa 3: O executor de nós

**Arquivos:** cria `backend/app/jornadas/executor.py`; modifica `app/worker.py`

- [ ] **Passo 1: leia `journey-worker/index.ts`** (655 linhas). Os comentários
  explicam decisões que não se deduzem do código — especialmente no
  `wait_for_event`, que distingue "acordou porque o evento chegou" de "acordou
  porque o timeout venceu".

- [ ] **Passo 2: `writeRun` como CAS**

```python
async def gravar_run(conn, run, patch: dict) -> bool:
    """Grava o run SÓ se o lock_token ainda for o nosso.

    ⚠️ Devolve False quando o lease expirou e outro worker já assumiu. Quem
    perdeu para de trabalhar naquele run — sem isso, dois workers avançam o
    mesmo contato por caminhos diferentes do fluxo, e o contato recebe os dois.
    """
```

- [ ] **Passo 3: os sete tipos de nó** (todos menos `handoff_nexus`), cada um
  como no original. Para `handoff_nexus`:

```python
        case "handoff_nexus":
            # ⚠️ A entrega ao GrowthHS é o lote 5. Falhar explicitamente é o
            # certo: um fluxo que diz ter entregado ao comercial sem entregar
            # nada é pior que um que falhou visivelmente — ninguém vai
            # procurar o lead que "já foi".
            await registrar_passo(conn, run, no, "failed",
                                  {"motivo": "handoff é do lote 5"})
            return {"tipo": "parar"}
```

- [ ] **Passo 4: o worker do 3B precisa aceitar e-mail SEM campanha**

⚠️ Hoje ele lê `c.status` da campanha e recusa se não for `sending`. E-mail de
fluxo não tem campanha. O `JOIN` vira `LEFT JOIN`, e a regra passa a ser: **se
há campanha, ela tem de estar em `sending`; se não há, segue.**

Sem isso, todo e-mail de fluxo é marcado `failed` com "campanha não está em
envio" — e o fluxo parece funcionar, porque o nó avança.

- [ ] **Passo 5: o laço no worker** — três blocos, na ordem do original:
  A) matrícula por segmento, B) a fila de eventos, C) os runs vencidos.

- [ ] **Passo 6: conferir** um fluxo de dois passos com condicional, de ponta a
  ponta. **Sem chave do Resend o e-mail fica na fila** — e é isso que se
  confere: a linha de `campaign_sends` do nó existe, com `journey_run_id`
  preenchido, e o run avançou.

- [ ] **Passo 7: commit**

---

## Tarefa 4: As telas

**Arquivos:** `useJourneys` (5 invokes), `useJourneyRuns` (1 ponto),
`JourneyBuilder` (1 invoke, 711 linhas), `NodeConfigDialog` (1+1),
`useAutomationRules` (5 pontos), `AutomationRuleForm` (1+1)

- [ ] **Passo 1: o cliente** `frontend/src/lib/jornadas.ts`, no molde de
  `lib/segmentos.ts` e `lib/campanhas.ts`.

- [ ] **Passo 2: os hooks e o construtor.** ⚠️ `JourneyBuilder` tem 711 linhas e
  é o editor visual do grafo — **não o reescreva**, troque só os pontos.

- [ ] **Passo 3: as regras de automação.** ⚠️ `evaluate_automation_on_etiqueta`
  e o trigger `trg_automation_on_etiqueta_change` foram removidos no lote 0. Se
  a tela permite criar regra que dependa deles, **ou** a regra volta como
  trigger, **ou** a tela diz que aquele gatilho não está ligado. Não deixe a
  tela oferecer o que não roda.

- [ ] **Passo 4: conferir no navegador** — criar um fluxo de dois passos, ativar,
  e ver a execução aparecer.

- [ ] **Passo 5: commit**

---

## Tarefa 5: Fechar

- [ ] **Passo 1: o portão, as três partes** — documentação incluída.
- [ ] **Passo 2: o placar.** Meça.
- [ ] **Passo 3: `ROADMAP.md` e `CONTINUAR-AQUI.md`.**
- [ ] **Passo 4: commit**

---

## Definição de pronto

- [ ] Um fluxo de dois passos com condicional roda de ponta a ponta
- [ ] Nó `send_email` cria a linha com `journey_run_id` e enfileira
- [ ] Reexecutar o mesmo nó **não** cria um segundo e-mail (índice único)
- [ ] `writeRun` recusa gravar quando o lease expirou
- [ ] `delay` e `wait_for_event` devolvem o run com `wakeup_at` correto
- [ ] Evento de contato entra na fila de jornada pelo trigger
- [ ] `handoff_nexus` falha **visivelmente**, não em silêncio
- [ ] E-mail de fluxo (sem campanha) não é recusado pelo worker do 3B
- [ ] `pytest` continua passando

## O que fica fora

O `handoff_nexus` (lote 5) e o envio real (adiado por decisão). Um fluxo com nó
de e-mail vai deixar a mensagem na fila, esperando a chave do Resend — que é o
comportamento correto e o mesmo do lote 3.
