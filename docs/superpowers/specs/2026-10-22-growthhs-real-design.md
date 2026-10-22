# Integração real com o GrowthHS (22/10/2026)

Substitui, do lado do MarketingHS, o contrato `POST /integration/cards` (que o
GrowthHS **não vai ter**) pela API normal do CRM, e liga a volta pelo webhook
de automação dele. Fonte do lado de lá:
`~/github/hsgrowth-sistema/docs/integracao-marketinghs.md` (§1–§8, 22/10) —
é a autoridade sobre rotas, campos e erros do GrowthHS; esta spec não repete
o que está lá.

## Por que agora

A prova do RD passou com um **receptor de teste** no lugar do GrowthHS (passo
5). O item que falta para o lead cair no comercial de verdade é este. Régua do
Nicholson: nada pode depender da agência — o roteamento ao comercial é nosso.

## Decisões do Erick (22/10)

1. **Prova interna na homologação do GrowthHS** (`homo-growthhsapi`), banco
   próprio. O Erick provisiona lá usuário de integração + integration client
   e passa `client_id`, `list_id` e os boards; o `client_secret` vai direto na
   tela. Virar para produção = trocar a configuração + duplicar a automação 14
   do GrowthHS com o usuário 28 (o "interruptor" de distribuir vendedor).
2. **`origin` do card:** `Landing Page <page_slug>` para landing;
   `Captura pelo site [<form_id>]` para formulário de site de fora.
   Lead sem conversão (envio manual, regra sobre base importada) →
   `MarketingHS` (suposição minha, pergunta 70).
3. **Pessoa que já tem card ABERTO:** não cria outro — **atualiza o card com
   as informações e deixa um aviso dizendo que foi atualizado.**

## O que muda

### 1. Cliente do GrowthHS (`app/crm/growthhs.py`, reescrito)

- **Autenticação:** `POST /api/v1/auth/client-credentials` com `client_id` +
  `client_secret` → `access_token`, guardado em memória do processo até
  `expires_in` (com folga de 5 min). Resposta 401 em qualquer chamada → pede
  token novo e repete **uma vez**. 401 no próprio `client-credentials` =
  configuração (pausa a fila, como o 401 de hoje).
- **Pessoa:** `GET /persons?search=<email>` e **conferir o e-mail exato**
  (minúsculas) em `email`, `email_commercial`, `email_personal`,
  `email_alternative`; achou → usa o `id`. Senão `POST /persons` (`name`,
  `email`, `phone`/`phone_whatsapp` em E.164 quando houver, `position`). Um 400
  de e-mail repetido no POST (corrida) → buscar de novo e usar o achado.
  Lead sem e-mail e sem telefone → falha o pedido (o CRM daria 422).
- **Cards da pessoa:** `GET /cards?board_id=<b>&person_id=<id>&page_size=100`
  para **cada board de `boards_conferidos`** (6 e 7 em produção).
  "Aberto" = `is_won` e `is_lost` falsos.
- **Criar:** `POST /cards` com `list_id`, `title`, `description`, `person_id`,
  `origin`, `acquisition_channel = "Inbound"`, UTMs, `utm_params`, `gclid`.
  Sem `client_id`/organização (§5 de lá). Limites de tamanho de §3 de lá
  aplicados (cortar, nunca 422 por tamanho).
- **Atualizar (card aberto):** `PUT /cards/{id}` só com `description` = a
  descrição atual + um bloco novo no fim
  (`— Atualizado pelo MarketingHS em dd/mm/aaaa hh:mm —` + os dados atuais do
  lead e da conversão). **Nunca** apaga o que o vendedor escreveu e não mexe
  em título, valor, responsável ou lista. Depois
  `POST /card-notes` (`card_id`, `content`) com o aviso: "Lead converteu de
  novo pelo MarketingHS (<origem>) em <data>. Descrição do card atualizada."
  A nota é o "aviso" (o GrowthHS não manda push de nota — fica no histórico
  do card; anotado em perguntas-abertas).
- **Testar conexão:** só o `client-credentials` (200 com token = válido).
- Erros: os da tabela de §3 de lá, com a política de hoje — 401/403/404 de
  configuração pausam a fila; 422 falha o pedido; 5xx/429/timeout re-tentam.

### 2. Descrição do card

Texto simples, uma linha por item, só os que têm valor: Empresa, Cargo,
Faturamento, Funcionários (faixas de hoje), Lead score, Etiqueta, Campanha,
Desafios (≤ 500), cada `campos_extras` (`chave: valor`), a última conversão
(página ou formulário + site + URL + canal + data) e o consentimento (base
legal, versão, provisório, data), e o link "Ver no MarketingHS"
(`FRONTEND_URL/contacts?contato=<lead_id>`). `title` = `Nome — Empresa`.

### 3. A entrega (`app/crm/entrega.py`)

Ordem por pedido, depois das travas de hoje (excluído, modo teste, `mover`):

1. Achar/criar a pessoa.
2. Listar os cards da pessoa nos boards conferidos.
3. **Algum aberto** →
   - se foi criado **depois** de `crm_handoffs.criado_em` deste pedido, é o
     card que uma tentativa anterior deste mesmo pedido criou (timeout depois
     do 201): marca `entregue` com ele, **sem** atualizar nem anotar — é a
     defesa contra duplicata do §6 de lá;
   - senão, atualiza + nota (§1), marca `entregue` com aquele `card_id`, evento
     na linha do tempo "Card atualizado no comercial (GrowthHS)" com
     `ja_entregue: true, atualizado: true`.
4. **Nenhum aberto** (inclusive pessoa só com cards ganhos/perdidos) → cria.

A guarda local de hoje (`_ja_entregue` → "Já estava no comercial") deixa de
encerrar o pedido: o card anotado aqui pode ter sido fechado lá. Ela passa a
servir só de atalho para o `person_id` (evita a busca) quando existe.

Um worker por vez (já é). O `asyncio.shield` do `entregue` continua.

### 4. A volta: receptor do webhook (`POST /api/publico/growthhs/webhook`)

- Query `?evento=meeting_scheduled` ou `?evento=deal_won` (outro valor → 200
  ignorado, para não derrubar a automação).
- **Assinatura:** `X-HSGrowth-Signature: sha256=<hex>` = HMAC-SHA256 dos
  **bytes crus** do corpo com o segredo `GROWTHHS_WEBHOOK_SECRET`
  (`integration_secrets`). Sem segredo configurado → 503 (a rota não liga
  sem segredo). Assinatura ausente/errada → 401 (só um GrowthHS
  desconfigurado erra isso; 5 seguidas desligam a automação lá, e isso é
  visível). Comparação em tempo constante. Corpo > 64 KB → 413.
- **Lead:** pelo `card.id` (o `card_id` de `crm_handoffs` entregue, depois
  `ecosystem_identities.growthhs_card_id`), senão por `card.person.email`
  (exato, lead não excluído). Não achou → **200** `{"ignorado": true}` —
  a automação dispara para todo card do board, não só os nossos.
- Achou → a mesma aplicação de `app/crm/retorno.py` do
  `/publico/evento-de-contato` (estágio só avança, evento na linha do tempo,
  `source_app = growthhs`, `metadata.card_id`). É uma transação curta — roda
  na hora (o envio de lá é síncrono e tem 10 s; não há fila nova).
- Responde 200 em tudo que não for assinatura/tamanho. Erro nosso
  inesperado → loga e responde 200 com `{"erro": true}` (um 5xx nosso
  derrubaria a automação de lá; o evento perdido aparece no log).
- O `/publico/evento-de-contato` continua como está.

### 5. Configuração (`growthhs_config` + Configurações → GrowthHS)

- Migration **029**: `growthhs_config` ganha `client_id text`,
  `list_id bigint`, `boards_conferidos bigint[]`. `board_id` fica (sem uso,
  reversível). Reaplicável.
- Segredos em `integration_secrets`: `GROWTHHS_CLIENT_SECRET` e
  `GROWTHHS_WEBHOOK_SECRET`. `GROWTHHS_API_KEY` deixa de ser lido.
- `Config.configurado` = `base_url` + `client_id` + `client_secret` +
  `list_id` + `boards_conferidos` não vazio.
- Tela (`GrowthHSCard.tsx`): URL da API, URL do app (link "Ver no GrowthHS"),
  `client_id`, `client_secret` (só escrita, como a chave de hoje), lista de
  entrada, boards conferidos (ex.: `6, 7`), segredo do webhook (só escrita) e,
  só leitura, a URL do receptor para colar na automação de lá
  (`<API pública>/api/publico/growthhs/webhook?evento=…`, as duas). "Testar"
  chama o `client-credentials`.

### 6. O que sai

- O receptor de teste (`receptor_growthhs.py`) implementa o contrato morto:
  **fica desligado como está** (a flag `PROVA_RECEPTOR_TESTE` continua
  declarada em `Settings` — tirá-la derrubaria o boot de quem ainda tem a
  variável). Remoção numa limpeza futura.
- O contrato `docs/contratos/2026-09-02-…` ganha um bloco no topo: "substituído
  por `hsgrowth-sistema/docs/integracao-marketinghs.md` em 22/10".

## Prova (roteiro curto, na homologação)

1. Erick provisiona na homologação do GrowthHS: usuário de integração, client,
   e as duas automações de volta no board equivalente ao 7 (com o segredo).
2. Script de configuração aponta `growthhs_config` para a homologação
   (externo `https://homo-growthhsapi.healthsafetytech.com` — o interno é de
   outro projeto do EasyPanel e não é garantido) e o Erick cola os segredos na
   tela.
3. Conversão com e-mail interno → card nasce na lista de entrada, com origem
   e descrição certas.
4. A mesma pessoa converte de novo → **o mesmo card** ganha o bloco na
   descrição e a nota; nenhum card novo.
5. Mover o card para "Reunião Agendada" → status do lead vira "MQL - Reunião
   agendada"; ganhar → "Venda realizada".
6. Card de outra pessoa movido → receptor responde 200 ignorado; a automação
   continua ligada.
7. Limpeza: cards da prova apagados lá, status dos leads de volta (script).

## Fora desta rodada

- Mover card de etapa a partir do MarketingHS (pedido (a) do contrato antigo).
- Avisar o GrowthHS quando o contato é excluído aqui.
- Virar para produção (é configuração + automação 14, sem código).
