# MarketingHS — Lote 3C: O retorno — Plano

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — `superpowers:subagent-driven-development`
> ou `superpowers:executing-plans`. Os passos usam caixa (`- [ ]`).

**Objetivo:** o que acontece com o e-mail depois de sair volta para dentro —
abertura, clique, bounce e reclamação viram status e métrica. Mais o
agendamento, a configuração do Resend pela tela, e a metade pública que o 3A
descobriu faltando.

**Arquitetura:** um endpoint público autenticado por assinatura Svix recebe os
eventos; um laço no worker promove campanhas agendadas, substituindo o
`promote_scheduled_campaigns` que está quebrado.

**Stack:** FastAPI, asyncpg · `asyncio` no worker · React 18

**Spec:** `docs/superpowers/specs/2026-08-31-marketinghs-design.md`
**Lotes anteriores:** `…-lote-3a-campanhas-e-templates`, `…-lote-3b-motor`

---

## Onde este lote fica

O 3A entregou campanhas e templates sem envio; o 3B, o motor. Este fecha o lote
3. **Pronto quando:** a abertura de um e-mail aparece na timeline do contato.

⚠️ **O envio real está adiado por decisão** (01/09/2026) — o sistema ainda não
tem usuário e a chave do Resend não foi configurada. Isso **não bloqueia** este
lote: a assinatura Svix se testa localmente calculando o HMAC com o mesmo
segredo, exatamente como o HMAC do descadastro foi testado no 3B. O que não dá
para conferir sem a chave é um evento vindo do Resend de verdade — e isso fica
explícito na definição de pronto.

---

## O que você precisa saber antes de começar

### ⚠️ O worker do 3B NÃO manda as tags — e o webhook depende delas

`resend-webhook` correlaciona o evento ao envio por três caminhos, nesta ordem:

1. `tags.send_id` — **exato**
2. `tags.campaign_id` + `tags.lead_id` — compatibilidade
3. `resend_email_id` — último recurso

O worker do 3B grava `resend_email_id` em `campaign_sends`, então o caminho (3)
funciona. Mas ele **não anexa tag nenhuma** ao enviar, o que joga toda
correlação no fallback — mais lento e frágil, e sem nenhum caminho quando o
`resend_email_id` não tiver sido gravado (envio que falhou entre o POST ao
Resend e o UPDATE).

**A tarefa 1 conserta isso**, e ela vem primeiro de propósito: sem as tags, o
webhook da tarefa 2 nasce dependendo do caminho mais fraco.

### A escada de degradação, e por que ela existe

`email_events.campaign_id` e `email_events.lead_id` são FK com `ON DELETE SET
NULL` (✅ verificado: `confdeltype = 'n'` nas três). Mas `SET NULL` só protege
linha que **já existia** no instante do DELETE. Um evento que chega **depois** da
campanha (ou do contato) ter sido excluída tenta INSERIR um id que não existe
mais — e isso viola a FK (**23503**, não 23505).

Sem tratar, o endpoint devolve 500 e o Svix reentrega o MESMO evento por até
10 horas (5s, 5min, 30min, 2h, 5h, 10h) sem nunca conseguir: o registro
excluído não volta.

São **duas portas para o mesmo laço**, e as duas precisam estar fechadas:
campanha excluída → 23503 no `campaign_id`; contato excluído → 23503 no
`lead_id`. Tratar só a primeira deixa a segunda em laço.

A escada tem três degraus, cada um removendo o vínculo que pode não existir
mais. ⚠️ **Um degrau só entra se o vínculo que ele zera estava presente nas
tags** — um degrau que reinsere exatamente a mesma linha repetiria o mesmo
23503, virando ruído no log e uma ida ao banco à toa.

### O avanço de status é monotônico, e com CAS

Sem garantia de ordem de entrega: `opened` pode chegar antes de `delivered`.
Duas regras, as duas necessárias:

- **nunca rebaixar** (`STATUS_RANK`: pending 0, sent 1, delivered 2, opened 3,
  clicked 4)
- **terminal nunca é sobrescrito** (`bounced`, `complained`, `failed`,
  `unsubscribed`, `suppressed`)

⚠️ E o UPDATE é condicionado ao status lido (CAS otimista, até 3 tentativas):
duas entregas simultâneas podem ler o mesmo status defasado, e a mais lenta
rebaixaria o valor da mais rápida.

⚠️ `fn_campaign_send_event` é um trigger em `campaign_sends` que já propaga a
mudança de status para `contact_events`. **Não duplicar esse insert.**

### A assinatura Svix, extraída do verificador original

```
assinatura = base64( HMAC_SHA256( chave, f"{svix-id}.{svix-timestamp}.{corpo}" ) )
chave      = base64_decode( RESEND_WEBHOOK_SECRET sem o prefixo "whsec_" )
```

O cabeçalho `svix-signature` traz uma ou mais assinaturas `v1,<base64>`
separadas por espaço (rotação de segredo) — **aceitar se QUALQUER uma casar**.
Janela anti-replay: **5 minutos**.

⚠️ O corpo tem de ser o **texto cru**, byte a byte. Reserializar o JSON depois
de fazer parse muda espaços e ordem de chaves, e a assinatura não bate mais.

### `promote_scheduled_campaigns` está quebrada, e o defeito é latente

Ela chama `public.invoke_edge_function`, que o lote 0 apagou. Devolve `0` sem
erro hoje porque o laço não roda com a tabela sem campanha agendada; estoura com
`UndefinedFunctionError` **no instante em que uma campanha vence**. ✅ Provado
por execução, com uma campanha vencida numa transação revertida.

O conserto **não é reescrever a função** — é o agendador Python fazer a seleção
e chamar o enfileirador direto. É isso que apaga a indireção em vez de portá-la,
e é a decisão nº 4 da spec.

---

## Restrições globais

- **`sessao()` é o único caminho para dado.**
- **`role="service_role"` + autorização explícita na rota.**
- **O webhook NÃO autentica por chave de API** — é assinatura Svix, e por isso
  não usa `chave_api`. Ele fica sob `/publico` porque é esse prefixo que o
  limite de taxa cobre.
- **O portão tem TRÊS partes**, e a terceira inclui a documentação pública.
- **Nenhum e-mail sai neste lote** — ele trata o que volta.
- **Comentário e nome de módulo em português.**
- Chave nova de ambiente **precisa** estar em `Settings`.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `backend/app/email/resend.py` (modificar) | aceitar e enviar `tags` |
| `backend/app/worker.py` (modificar) | mandar as tags; e o laço do agendador |
| `backend/app/routers/webhook.py` (novo) | `/publico/webhook/resend` |
| `backend/tests/test_webhook.py` (novo) | assinatura, dedupe, escada, monotonia |
| `backend/app/routers/publico.py` (modificar) | metade pública de campanhas e templates |
| `backend/app/routers/configuracao.py` (modificar) | segredos do Resend pela tela |
| `frontend/src/components/admin/settings/ResendConfigCard.tsx` (modificar) | 6 invokes |
| `frontend/src/components/admin/settings/SuppressionList.tsx` (modificar) | 3 pontos |
| `backend/migrations/009_promotor_de_agendadas.sql` (novo) | conserta a função quebrada |

---

## Tarefa 1: As tags no envio

**Arquivos:** modifica `backend/app/email/resend.py` e `backend/app/worker.py`

**Interfaces produzidas:** `resend.enviar(..., tags: list[dict])`

- [ ] **Passo 1: o cliente aceita tags**

```python
async def enviar(chave: str, de: str, para: str, assunto: str,
                 html: str, texto: str, cabecalhos: dict,
                 tags: list[dict] | None = None) -> str:
    corpo = {"from": de, "to": [para], "subject": assunto, "html": html,
             "headers": cabecalhos}
    if texto:
        corpo["text"] = texto
    if tags:
        # ⚠️ O Resend só aceita [a-zA-Z0-9_-] em nome e valor de tag. UUID passa;
        # qualquer coisa com ponto ou arroba, não — e a API recusa o envio
        # inteiro, não a tag.
        corpo["tags"] = tags
```

- [ ] **Passo 2: o worker manda as três**

```python
        tags=[{"name": "send_id", "value": m.send_id},
              {"name": "campaign_id", "value": m.campaign_id},
              {"name": "lead_id", "value": m.lead_id}],
```

⚠️ São exatamente estes três nomes. O webhook os procura por nome; qualquer
outro deixa a correlação no fallback do `resend_email_id`.

- [ ] **Passo 3: conferir** com o ensaio do 3B (o Resend substituído) que as
  três tags chegam ao cliente, com os ids certos.

- [ ] **Passo 4: commit**

---

## Tarefa 2: O webhook

**Arquivos:** cria `backend/app/routers/webhook.py` e
`backend/tests/test_webhook.py`; modifica `app/main.py`

**Interfaces produzidas:** `POST /publico/webhook/resend`

- [ ] **Passo 1: o teste da assinatura, antes de tudo**

```python
"""O webhook do Resend. A assinatura é testada localmente, calculando o HMAC
com o mesmo segredo — o mesmo método que provou o HMAC do descadastro no 3B."""

import base64, hashlib, hmac, json, time


def _assinar(corpo: str, svix_id: str, ts: str, segredo_whsec: str) -> str:
    chave = base64.b64decode(segredo_whsec.removeprefix("whsec_"))
    mac = hmac.new(chave, f"{svix_id}.{ts}.{corpo}".encode(), hashlib.sha256).digest()
    return "v1," + base64.b64encode(mac).decode()


async def test_assinatura_invalida_devolve_401(cliente, segredo):
    corpo = json.dumps({"type": "email.opened"})
    r = await cliente.post("/publico/webhook/resend", content=corpo,
                           headers={"svix-id": "msg_1",
                                    "svix-timestamp": str(int(time.time())),
                                    "svix-signature": "v1,QUJD"})
    assert r.status_code == 401


async def test_timestamp_velho_devolve_401(cliente, segredo):
    """Janela anti-replay de 5 minutos: um evento capturado e reenviado depois
    não pode ser aceito."""
    velho = str(int(time.time()) - 3600)
    corpo = json.dumps({"type": "email.opened"})
    r = await cliente.post("/publico/webhook/resend", content=corpo,
                           headers={"svix-id": "msg_2", "svix-timestamp": velho,
                                    "svix-signature": _assinar(corpo, "msg_2", velho, segredo)})
    assert r.status_code == 401


async def test_qualquer_uma_das_assinaturas_serve(cliente, segredo):
    """O cabeçalho traz várias durante uma rotação de segredo."""
    ts = str(int(time.time()))
    corpo = json.dumps({"type": "email.opened"})
    boa = _assinar(corpo, "msg_3", ts, segredo)
    r = await cliente.post("/publico/webhook/resend", content=corpo,
                           headers={"svix-id": "msg_3", "svix-timestamp": ts,
                                    "svix-signature": f"v1,QUJD {boa}"})
    assert r.status_code == 200
```

- [ ] **Passo 2: o teste do dedupe e da monotonia**

```python
async def _evento(cliente, segredo, svix_id, tipo, send_id, **extra):
    """Monta e assina um evento, como o Resend o mandaria."""
    ts = str(int(time.time()))
    corpo = json.dumps({
        "type": tipo,
        "created_at": "2026-09-01T12:00:00.000Z",
        "data": {"email_id": "re_abc", "to": ["a@b.c"],
                 "tags": [{"name": "send_id", "value": send_id}], **extra},
    })
    return await cliente.post(
        "/publico/webhook/resend", content=corpo,
        headers={"svix-id": svix_id, "svix-timestamp": ts,
                 "svix-signature": _assinar(corpo, svix_id, ts, segredo)})


async def test_evento_repetido_devolve_200_sem_duplicar(cliente, conexao, segredo, envio):
    """Svix entrega at-least-once. `svix_id` UNIQUE é a barreira de
    idempotência, e o segundo POST tem de devolver 200 — 500 faria o Svix
    reentregar o mesmo evento por 10 horas."""
    r1 = await _evento(cliente, segredo, "msg_dup", "email.opened", envio)
    r2 = await _evento(cliente, segredo, "msg_dup", "email.opened", envio)
    assert r1.status_code == 200 and r2.status_code == 200
    assert await conexao.fetchval(
        "SELECT count(*) FROM email_events WHERE svix_id = 'msg_dup'") == 1


async def test_status_nunca_rebaixa(cliente, conexao, segredo, envio):
    """`delivered` chegando DEPOIS de `opened` não pode rebaixar o envio.
    Não há garantia de ordem de entrega."""
    await _evento(cliente, segredo, "msg_o", "email.opened", envio)
    await _evento(cliente, segredo, "msg_d", "email.delivered", envio)
    assert await conexao.fetchval(
        "SELECT status FROM campaign_sends WHERE id = $1::uuid", envio) == "opened"


async def test_terminal_nao_e_sobrescrito(cliente, conexao, segredo, envio):
    """Um `opened` tardio não pode apagar um `bounced` — o motivo real da
    falha se perderia, e o envio pareceria ter chegado."""
    await _evento(cliente, segredo, "msg_b", "email.bounced", envio,
                  bounce={"type": "Permanent"})
    await _evento(cliente, segredo, "msg_o2", "email.opened", envio)
    assert await conexao.fetchval(
        "SELECT status FROM campaign_sends WHERE id = $1::uuid", envio) == "bounced"


async def test_hard_bounce_suprime_e_transiente_nao(cliente, conexao, segredo, envio):
    """⚠️ Só hard bounce suprime. `bounce.type == 'Transient'` é caixa cheia ou
    servidor fora do ar — suprimir aí queimaria um contato bom para sempre."""
    await _evento(cliente, segredo, "msg_t", "email.bounced", envio,
                  bounce={"type": "Transient"})
    assert await conexao.fetchval(
        "SELECT count(*) FROM email_suppressions WHERE email = 'a@b.c'") == 0

    await _evento(cliente, segredo, "msg_p", "email.bounced", envio,
                  bounce={"type": "Permanent"})
    assert await conexao.fetchval(
        "SELECT reason FROM email_suppressions WHERE email = 'a@b.c'") == "bounce"


async def test_evento_de_campanha_excluida_nao_entra_em_laco(
        cliente, conexao, segredo):
    """A escada de degradação. Evento que chega DEPOIS da exclusão tenta
    inserir um id que não existe mais — 23503, não 23505. Sem a escada o
    endpoint devolve 500 e o Svix reentrega por 10 horas sem nunca conseguir."""
    ts = str(int(time.time()))
    corpo = json.dumps({
        "type": "email.opened", "created_at": "2026-09-01T12:00:00.000Z",
        "data": {"email_id": "re_x", "to": ["a@b.c"], "tags": [
            {"name": "campaign_id", "value": "00000000-0000-0000-0000-000000000000"},
            {"name": "lead_id", "value": "00000000-0000-0000-0000-000000000001"}]},
    })
    r = await cliente.post(
        "/publico/webhook/resend", content=corpo,
        headers={"svix-id": "msg_orfao", "svix-timestamp": ts,
                 "svix-signature": _assinar(corpo, "msg_orfao", ts, segredo)})
    assert r.status_code == 200
    linha = await conexao.fetchrow(
        "SELECT campaign_id, lead_id, payload FROM email_events "
        "WHERE svix_id = 'msg_orfao'")
    # Os vínculos caem, mas o evento é guardado: o payload bruto ainda tem as
    # tags originais com os ids. É o que o ON DELETE SET NULL teria feito se o
    # evento tivesse chegado antes da exclusão.
    assert linha["campaign_id"] is None and linha["lead_id"] is None
    assert linha["payload"] is not None
```

- [ ] **Passo 3: rodar e ver falhar**, depois escrever o router.

Pontos que o router tem de respeitar:

```python
@router.post("/webhook/resend")
async def resend_webhook(request: Request):
    """⚠️ O corpo é lido CRU (`await request.body()`), não pelo modelo do
    pydantic. A assinatura é calculada sobre os bytes exatos que chegaram;
    reserializar o JSON depois do parse muda espaços e ordem de chaves, e a
    assinatura deixa de bater.
    """
```

- [ ] **Passo 4: commit**

---

## Tarefa 3: O agendador

**Arquivos:** cria `backend/migrations/009_promotor_de_agendadas.sql`;
modifica `backend/app/worker.py`

- [ ] **Passo 1: a migration que conserta a função**

```sql
-- 009: conserta promote_scheduled_campaigns.
--
-- ⚠️ A versão herdada chama public.invoke_edge_function, que o lote 0 apagou
-- de propósito (era o banco chamando a aplicação por HTTP, indireção que só
-- existia porque o Supabase separa os dois). Ela devolve 0 sem erro enquanto
-- não há campanha agendada — o laço não roda — e estoura com
-- UndefinedFunctionError no instante em que uma vence. Defeito latente.
--
-- A função passa a SÓ SELECIONAR. Quem dispara é o agendador Python, que chama
-- o enfileirador direto. É a decisão nº 4 da spec: apagar a indireção em vez de
-- portá-la.
CREATE OR REPLACE FUNCTION public.promote_scheduled_campaigns()
RETURNS TABLE(id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT c.id FROM public.campaigns c
   WHERE c.status = 'scheduled'
     AND c.scheduled_at IS NOT NULL
     AND c.scheduled_at <= now()
   ORDER BY c.scheduled_at
   LIMIT 20
$$;
```

⚠️ **O tipo de retorno muda de `integer` para `TABLE(uuid)`.** `CREATE OR
REPLACE` **não** aceita trocar o tipo de retorno — é preciso `DROP FUNCTION`
antes. Confira se algo mais a chama antes de derrubar:

```bash
grep -rn "promote_scheduled_campaigns" backend/ frontend/
```

- [ ] **Passo 2: o laço no worker**

O agendador entra no mesmo processo do worker, num intervalo próprio (60s — não
adianta varrer campanha agendada a cada 2 segundos).

⚠️ **Não duplicar o claim.** O enfileirador já faz CAS de `scheduled` para
`sending`; o agendador só chama. Duas instâncias do worker chamando a mesma
campanha resultam numa 409 na perdedora, que é o comportamento certo.

- [ ] **Passo 3: destravar o agendamento na tela.** O 3A deixou o wizard
  avisando que o agendamento não dispara. Agora dispara: a campanha nasce
  `scheduled` quando há data, e o agendador a promove.

⚠️ Isso muda o `criar` do 3A, que força `draft` sempre. O status continua **não
vindo do corpo** — o servidor deriva: com `scheduled_at` no futuro, nasce
`scheduled`; sem, nasce `draft`. Deixar o cliente mandar `sending` continua
proibido.

- [ ] **Passo 4: conferir** com uma campanha agendada para daqui a um minuto,
  com o worker de pé: ela é promovida, enfileirada, e (sem chave do Resend) fica
  esperando na fila. **Apague os dados de teste.**

- [ ] **Passo 5: commit**

---

## Tarefa 4: A metade pública de campanhas e templates

**Arquivos:** modifica `backend/app/routers/publico.py`,
`frontend/src/components/admin/settings/ApiDocumentation.tsx`,
`frontend/public/api/dnmarketing-api.yaml`

O 3A descobriu que `campaigns-api` e `templates-api` **também aceitam chave de
API** — servem integrador externo — e por isso não puderam sair da pasta.

- [ ] **Passo 1: `/publico/campanhas`** (lista e ficha) e
  `/publico/templates` (lista e ficha), com `Depends(chave_api('read'))`.
  Espelhe a forma de `/publico/segmentos` do lote 2: `data` + `pagination`.

- [ ] **Passo 2: `POST /publico/campanhas/{id}/enviar`** com
  `Depends(chave_api('write'))` — é o `?action=send` da `campaigns-api`.
  ⚠️ Reusa o mesmo enfileirador do 3B; não escreva um segundo.

- [ ] **Passo 3: a documentação.** No lote 2 o portão pegou duas chamadas
  mortas que nenhuma tela fazia — a tela de Documentação da API e o
  `dnmarketing-api.yaml`. Atualize as duas para as rotas novas.

- [ ] **Passo 4: o portão, e só então `git rm`** de `campaigns-api` e
  `templates-api`.

- [ ] **Passo 5: commit**

---

## Tarefa 5: As telas de configuração

**Arquivos:** modifica `backend/app/routers/configuracao.py`,
`ResendConfigCard.tsx` (6 invokes), `SuppressionList.tsx` (3 pontos)

- [ ] **Passo 1: os endpoints de segredo**

```python
# ⚠️ NUNCA devolva o valor de um segredo. A tela só precisa saber se ele
# EXISTE — devolver o valor colocaria a RESEND_API_KEY no HTML de qualquer
# admin logado, e num log de proxy no caminho.
{"resend_api_key": {"configurado": True}, ...}
```

⚠️ `resend-config` tem 568 linhas e faz mais que guardar segredo: valida
domínio no Resend e liga rastreamento. **Porte só o que a tela usa**, e deixe
registrado o que ficou de fora.

- [ ] **Passo 2: a lista de supressão** — leitura, busca e remoção manual.

- [ ] **Passo 3: conferir as duas no navegador**

- [ ] **Passo 4: commit**

---

## Tarefa 6: Fechar o lote 3

- [ ] **Passo 1: o portão, as três partes** — documentação incluída.
- [ ] **Passo 2: o placar.** Meça, não herde.
- [ ] **Passo 3: `ROADMAP.md` e `CONTINUAR-AQUI.md`.** O lote 3 fecha aqui —
  diga isso, e diga o que continua dependendo da chave do Resend.
- [ ] **Passo 4: commit**

---

## Definição de pronto do 3C

- [ ] Assinatura Svix inválida devolve **401**; válida, 200
- [ ] Timestamp fora da janela de 5 min devolve **401**
- [ ] Qualquer uma das assinaturas do cabeçalho serve (rotação)
- [ ] Evento repetido devolve **200**, não 500 — senão o Svix reentrega por 10h
- [ ] Evento de campanha excluída **não** entra em laço (escada de degradação)
- [ ] `delivered` tardio **não** rebaixa um `opened`
- [ ] `opened` tardio **não** sobrescreve um `bounced`
- [ ] Hard bounce suprime; `Transient` **não**
- [ ] Campanha agendada é promovida e enfileirada pelo worker
- [ ] `promote_scheduled_campaigns` não chama mais `invoke_edge_function`
- [ ] `campaigns-api` e `templates-api` saem da pasta, documentação incluída
- [ ] Nenhum endpoint devolve o valor de um segredo
- [ ] `pytest` inteiro continua passando

## O que continua fora, e por quê

**Um evento vindo do Resend de verdade.** Depende da chave e do domínio
verificado, adiados por decisão. A assinatura é provada localmente com o mesmo
segredo — o mesmo método que provou o HMAC do descadastro no 3B —, mas isso não
substitui ver um `email.opened` real chegar.
