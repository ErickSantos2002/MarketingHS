# Contrato: `POST /integration/cards` no GrowthHS

**Para quem implementa:** este documento é um **pedido ao `hsgrowth-sistema`**.
Nada aqui se implementa dentro do MarketingHS — o MarketingHS é o *chamador*.

**Data:** 2 de setembro de 2026
**Origem:** lote 5A do MarketingHS (`docs/superpowers/specs/2026-08-31-marketinghs-design.md`, seção 8.A)
**Estado:** o lado do MarketingHS está pronto (lote 8D, 22/09/2026; card ampliado e volta do CRM em 21/10/2026, ver "Acréscimos de 21/10"); falta o endpoint no GrowthHS — até lá, o MarketingHS testa o contrato contra um receptor próprio

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

Os itens 1 a 3 entram em **Configurações → GrowthHS** (a chave vai para
`integration_secrets`, nunca para o `.env`). Enquanto não chegarem, o
MarketingHS **enfileira e espera**: regra, nó de jornada e botão "Enviar ao
comercial" gravam o pedido em `crm_handoffs`, e as telas avisam que o GrowthHS
ainda não está configurado. Quando a configuração entra, o worker entrega a
fila. Chave ou `board_id` errado (401/403/404) **pausa** a fila em vez de
falhar pedido a pedido; o estado aparece no card de configuração.

---

## Pedidos acrescentados em 21/09 (lote 8D)

Apareceram ao implementar o lado do MarketingHS. Nenhum bloqueia ligar o
handoff; cada um fecha uma lacuna que hoje falha à vista.

**(a) Rota para mover card de etapa.** A origem tinha regras de automação que
moviam o card no CRM quando a etiqueta do lead mudava. O contrato só cria.
Até existir a rota, salvar regra `move_stage_growthhs` é recusado (400) e a
opção aparece desabilitada no formulário.

**(b) O que fazer com o card quando o contato é excluído no MarketingHS.** A
origem apagava o contato no Nexus. Hoje o card fica — apagar card de vendedor
é decisão do CRM. Precisamos saber se o GrowthHS quer ser avisado (e por qual
rota), ou se o card simplesmente segue.

**(c) Uma rota de leitura autenticada e barata** (ex.: `GET /integration/whoami`).
O "Testar conexão" hoje só confere `GET {base}/health`, que não prova que a
chave vale — testar a chave de verdade exigiria criar um card. Com a rota, o
teste confere a chave e o escopo `cards:create`.

**(d) — reforço, não pedido novo:** a restrição única `(external_source,
external_id)` do contrato é a única coisa que fecha de vez o card duplicado
numa corrida rara (worker desligado entre o 2xx e a gravação). Do nosso lado
há guarda por lead e por pessoa, mas ela depende de a gravação ter acontecido.

---

## Acréscimos de 21/10 (prova de substituição do RD)

A prova (`docs/superpowers/specs/2026-10-21-prova-substituir-rd-design.md`)
acrescenta três coisas ao card e pede uma chamada de volta. **Nada do que já
estava acima muda.**

### (a) Três chaves novas no corpo do card

```json
{
  "...": "o corpo de antes, igual",
  "custom_fields": { "ja_faz_testagem": "sim" },
  "conversion": {
    "page_slug": "phoebus-prova",
    "form_id": null,
    "site_name": null,
    "page_url": null,
    "converted_at": "2026-10-21T13:00:00Z",
    "canal": "pago"
  },
  "consent": {
    "legal_basis": "consentimento",
    "version": "provisoria-2026-10",
    "provisional": true,
    "recorded_at": "2026-10-21T13:00:00Z"
  }
}
```

- `custom_fields`: as respostas dos campos personalizados do formulário
  (`leads.campos_extras`). `{}` quando não há.
- `conversion`: a **última** conversão do lead — página da landing
  (`page_slug`) ou formulário de outro site (`form_id`, `site_name`,
  `page_url`), com o canal (`pago`, `social`, `email`, `organico`,
  `referencia`, `campanha`, `direto`). `null` quando não há.
- `consent`: o **último** registro de consentimento (LGPD). `legal_basis` é
  `consentimento` (a pessoa marcou a caixa na landing) ou
  `legitimo_interesse_pedido_contato` (formulário do site sem caixa: a pessoa
  pediu contato). `provisional: true` enquanto o texto da política não for o
  definitivo. `null` quando não há.

**Podem ser ignoradas — o card nasce sem elas.** Se o GrowthHS valida o corpo
com esquema fechado (`extra = "forbid"`), precisa aceitar as três chaves (ou
descartá-las) para o card não virar 422.

### (b) A volta: "reunião agendada" e "venda fechada"

Quando o card anda no GrowthHS, o MarketingHS quer saber — é o que muda o
estágio do lead aqui e para a nutrição de quem já está no comercial.

```
POST {MarketingHS}/api/publico/evento-de-contato
Header: Authorization: Bearer <chave de API do MarketingHS, escopo write>
Content-Type: application/json
```

⚠️ A chave de API do MarketingHS vai em **`Authorization: Bearer`**, não em
`X-API-Key` (o `X-API-Key` é o do lado de vocês). Ela é criada em
Configurações → Chaves de API, com escopo **escrita**; chave só de leitura
leva 403.

```json
{
  "source_app": "growthhs",
  "event_type": "meeting_scheduled",
  "title": "Reunião agendada no GrowthHS",
  "lead_id": "<external_id do card>",
  "email": "carla@transportadora.com.br",
  "metadata": { "card_id": 4821 }
}
```

- O lead é achado por `lead_id` (o `external_id` que o MarketingHS mandou no
  card), depois `email`, depois `dnia_id` — cada um só é tentado se o
  anterior não achou ninguém: um `lead_id` que não existe mais cai para o
  e-mail. Mande os que tiver. Um dos três é obrigatório (400); nenhum casa →
  **404** (o MarketingHS não cria contato a partir do CRM).
- `occurred_at` (ISO 8601) e `description` são opcionais.

Resposta `200`:

```json
{ "evento_id": "…", "lead_id": "…", "dnia_id": "…",
  "status_anterior": "Lead", "status_atual": "MQL - Reunião agendada",
  "mudou": true }
```

**O estágio só avança.** `meeting_scheduled` leva a "MQL - Reunião agendada";
`deal_won`, a "Venda realizada" — e só se o estágio novo vier depois do atual
na ordem do funil. Uma reunião agendada que chega depois da venda grava o
evento e responde `mudou: false`, sem voltar o estágio. Outro `event_type`
(ex.: `deal_moved`) é só registrado na linha do tempo. Repetir a chamada não
quebra nada: o evento é gravado de novo, o estágio já está lá.

### (c) Quando chamar

- **Reunião agendada** com o contato do card → `meeting_scheduled`.
- **Negócio ganho** → `deal_won`.

As duas, uma vez por acontecimento, logo que acontecem. Não há rota para
"negócio perdido" nesta rodada.

### (d) O receptor de teste do nosso lado

Enquanto o `POST /integration/cards` não existe, o MarketingHS tem um
receptor próprio que implementa **este** contrato
(`backend/app/routers/receptor_growthhs.py`, em
`{MarketingHS}/api/teste/growthhs`): confere `X-API-Key`, valida o corpo
(`source`, `external_id` uuid, `board_id`, `title`, `contact.email` ou
`contact.phone`; senão 422), responde 201 na primeira vez e 200 com o mesmo
`id` na repetição, e guarda o pedido. A fila real de handoff aponta para ele
durante a prova. Fica desligado fora dela (404). É, também, o teste do
contrato do nosso lado: se o corpo que mandamos mudar, ele recusa antes de
vocês.

---

## Notas

O `handoff-to-nexus` original (786 linhas, a maior function do repo herdado)
fazia muito mais do que este contrato: resolvia contato no Nexus por lookup,
revalidava o `nexus_contact_id` guardado contra o remoto, e tinha três modos de
disparo. Boa parte disso existia porque o Nexus era um sistema de terceiro sem
idempotência. Com `(source, external_id)` no banco de vocês, o chamador fica
simples — e essa é a troca que este documento propõe.
