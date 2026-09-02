# Contrato: `POST /integration/cards` no GrowthHS

**Para quem implementa:** este documento é um **pedido ao `hsgrowth-sistema`**.
Nada aqui se implementa dentro do MarketingHS — o MarketingHS é o *chamador*.

**Data:** 2 de setembro de 2026
**Origem:** lote 5A do MarketingHS (`docs/superpowers/specs/2026-08-31-marketinghs-design.md`, seção 8.A)
**Estado:** especificado, não implementado

---

## Por que este documento existe

A spec do MarketingHS dizia, em letras miúdas:

> ⚠️ **A confirmar na implementação:** se o endpoint de criação de card já existe
> na API do GrowthHS ou se precisa ser escrito no `hsgrowth-sistema`.

**Confirmado: precisa ser escrito.** O que existe hoje é
`POST /integration/service-cards`, que cria card de **serviço**, em board de
serviço, com o `source` travado num `Literal` de três valores do GestorHS
(`gestorhs.os`, `gestorhs.calibracao`, `gestorhs.atrasados`). O MarketingHS
precisa de card **comercial**, no funil de vendas. O endpoint existente não
serve, e alargar o `Literal` dele seria pior: são entidades diferentes
(`ServiceCard` × `Card`), em boards diferentes, com serviços diferentes.

A boa notícia é que **quase tudo já está pronto do lado de vocês** — o desenho a
copiar é o do próprio `integration_card_service.py`.

---

## O que já existe e se reusa (não reescrever)

| Peça | Onde | Serve para |
|---|---|---|
| `require_api_scope("...")` | `app/api/deps.py:339` | autenticação por `X-API-Key` via `integration_clients`, com escopo |
| `IntegrationClient.scopes` | `app/models/integration_client.py:29` | lista JSON livre — **`cards:create` não precisa de migration de enum** |
| `CardService` | `app/services/card_service.py` | criação de card comercial que **já** dispara automações, gamificação, `card_list_history` e notificações |
| `ExternalClientRef(source, external_id, client_id)` | `app/models/external_client_ref.py` | vínculo de **cliente** externo (não de card) |
| `IntegrationCardService.create_or_return` | `app/services/integration_card_service.py:49` | **o molde**: create-or-return, resolução de cliente/pessoa, tratamento de `IntegrityError` na corrida |

⚠️ **Usem o `CardService`, não um `INSERT` cru.** É o ponto que a spec do
MarketingHS levanta: `cards` tem 38 colunas e o GrowthHS pendura nela
`card_list_history`, `automations`, `automation_executions`,
`gamification_points` e `notifications`. Um insert direto cria um card que o
próprio sistema não sabe que nasceu.

---

## O buraco que precisa ser tapado primeiro

**O card comercial não tem chave de idempotência.**

```
service_cards :  external_source + external_id + UniqueConstraint   ✅
cards         :  nenhum dos dois                                     ❌
```

Sem isso, um retry do MarketingHS (timeout, 502, worker reiniciando no meio)
cria um **segundo card para o mesmo lead**, e quem descobre é o vendedor com dois
cards do mesmo contato no funil.

**Pedido:** uma migration que acrescente a `cards`, espelhando `service_cards`:

```python
external_source = Column(String(50), nullable=True, index=True)
external_id     = Column(String(100), nullable=True, index=True)
UniqueConstraint("external_source", "external_id", name="unique_card_external_ref")
```

### Por que no banco de vocês e não só no nosso

O MarketingHS **vai** guardar o `growthhs_card_id` em `ecosystem_identities` —
está na spec e vai acontecer de qualquer jeito. Mas isso é uma trava do lado do
chamador: ela protege contra o caminho feliz repetido, não contra a corrida
(duas execuções do worker ao mesmo tempo) nem contra a escrita perdida (card
criado, resposta perdida, `growthhs_card_id` nunca gravado — e no próximo tick
tentamos de novo).

A restrição no banco é a única que não depende do chamador estar são. E o
`integration_card_service.py` **já mostra como tratá-la**, com o
`except IntegrityError` que devolve o vencedor da corrida em vez de estourar.

---

## O contrato

### Rota

```
POST /api/v1/integration/cards
Header: X-API-Key: <chave do integration_client do MarketingHS>
Escopo: cards:create
```

Registrada no mesmo router de `integration.py`, que já tem o prefixo
`/integration` e a tag "Integração Externa".

### Corpo (o que o MarketingHS manda)

```json
{
  "source": "marketinghs",
  "external_id": "<uuid do lead no MarketingHS>",
  "board_id": 3,
  "list_id": null,
  "title": "Carla Menezes — Transportadora XYZ",
  "description": "Campanha: black-friday\nDesafios: controle de jornada\nIndicação: —",

  "contact": {
    "name": "Carla Menezes",
    "email": "carla@transportadora.com.br",
    "phone": "+5581999999999",
    "company": "Transportadora XYZ",
    "job_title": "Gerente de SESMT"
  },

  "origin": "Tráfego pago",
  "acquisition_channel": "Inbound",
  "utm_source": "google",
  "utm_campaign": "black-friday",
  "utm_term": "controle de jornada",
  "utm_params": "utm_source=google&utm_medium=cpc&utm_campaign=black-friday",

  "business_info": {
    "faturamento": "Entre 100k e 500k/mes",
    "funcionarios": "11-50 funcionarios",
    "lead_score": 60,
    "etiqueta": "hotlead"
  }
}
```

**`external_id` é o `leads.id` do MarketingHS** (uuid). Com
`source = "marketinghs"`, o par nunca colide com os três `gestorhs.*`.

⚠️ **`list_id` nulo significa "etapa de entrada do board"**, do mesmo jeito que
`find_entry_list(board_id)` resolve hoje para o card de serviço. O MarketingHS
manda `board_id` e deixa a etapa por conta de vocês — qual lista é a de entrada
é decisão do CRM, não do marketing.

### Resposta

Igual à do `service-cards`, e pelo mesmo motivo:

- **`201`** — card criado agora.
- **`200`** — já existia; **nada foi alterado**. Depois que o card nasce, quem
  manda é o vendedor; reenviar o mesmo par devolve o existente intacto.

```json
{ "id": 4821, "list_id": 12, "title": "...", "external_source": "marketinghs",
  "external_id": "c351c124-...", "client_id": 903, "person_id": 1180,
  "created": true }
```

O MarketingHS grava `id` como `growthhs_card_id` e `person_id` como
`growthhs_person_id` em `ecosystem_identities`.

### Erros que o MarketingHS sabe tratar

| Código | Quando | O que fazemos |
|---|---|---|
| `401` | chave ausente ou inválida | para e alerta — é configuração, não se re-tenta |
| `403` | chave sem `cards:create`, ou `impersonate_user_id` inválido | idem |
| `404` | `board_id` não existe ou não tem etapa de entrada | idem |
| `422` | corpo inválido | idem |
| `5xx` / timeout | GrowthHS fora do ar | **re-tentamos**, e é por isso que a idempotência importa |

---

## Regras de negócio que viajam junto

Estas nascem no MarketingHS e o endpoint só recebe prontas — estão aqui para
vocês entenderem o que chega, não para reimplementar:

**Origem = "Tráfego pago" se houver QUALQUER UTM, senão "Orgânico".** Regra
global do lado do marketing, aplicada a todas as landing pages. O `source` do
corpo original é ignorado de propósito, para não haver dois dialetos de origem.
⚠️ Os valores precisam bater **exatamente** com o que o GrowthHS aceita em
`origin` (maiúsculas e acentos incluídos). **Se o GrowthHS normaliza ou valida
`origin` contra uma lista, nos digam qual** — hoje mandamos a string do Nexus
antigo e não temos como conferir daqui.

**`faturamento` e `funcionarios` chegam normalizados** para as faixas fixas
(`Ate 100k/mes`, `Entre 100k e 500k/mes`, …, `1-10 funcionarios`,
`11-50 funcionarios`, …). São as faixas do Nexus antigo. Se o GrowthHS usa
outras, digam quais e a normalização muda do nosso lado.

---

## Gotcha que achamos lendo o código de vocês

`require_api_scope` commita a sessão para gravar `last_used_at`, e o comentário
no próprio arquivo avisa:

> Efeito colateral: esse commit fecha a transação do request neste ponto. Não
> componha esta dependency com outras que empilhem writes antes dela.

O endpoint novo herda isso. Vale conferir na implementação que a criação do card
abre a transação **depois** da dependency, e não conta com nada escrito antes.

---

## O que o MarketingHS precisa receber de volta

Para fechar o lote 5A do nosso lado:

1. **A chave de API** do `integration_client` do MarketingHS, com escopo
   `cards:create` e um `impersonate_user_id` válido — o usuário que vai aparecer
   como autor dos cards criados pelo marketing.
2. **O `board_id`** do funil onde o lead qualificado entra.
3. **A URL base** da API do GrowthHS a usar (interna, já que os dois vivem no
   mesmo servidor, ou externa).
4. Confirmação de como o GrowthHS trata `origin` (lista fechada ou texto livre).

Enquanto não chegar, o MarketingHS mantém o handoff **desligado e dizendo que
está desligado** — `NODE_NAO_LIGADO` em `frontend/src/lib/journeys.ts` e
`AUTOMACAO_NAO_LIGADA` em `frontend/src/lib/automacoes.ts`. Apagar a entrada de
cada um religa a interface.

---

## Notas

O `handoff-to-nexus` original (786 linhas, a maior function do repo herdado)
fazia muito mais do que este contrato: resolvia contato no Nexus por lookup,
revalidava o `nexus_contact_id` guardado contra o remoto, e tinha três modos de
disparo. Boa parte disso existia porque o Nexus era um sistema de terceiro sem
idempotência. Com `(source, external_id)` no banco de vocês, o chamador fica
simples — e essa é a troca que este documento propõe.
