# Frente `growthhs-real`

Spec: `docs/superpowers/specs/2026-10-22-growthhs-real-design.md`. Plano:
`docs/superpowers/plans/2026-10-22-growthhs-real.md`. Autoridade sobre a API
do GrowthHS: `hsgrowth-sistema/docs/integracao-marketinghs.md` §1–§8 (só
leitura). Branch `worktree-agent-a2ad3dda1ef7391df` (subagente com worktree).

## Estado (22/10, noite)

- [x] Tarefa 1 — migration 029 e `Config` novo (`f7bf009`, `6800f06`)
- [x] Tarefa 2 — cliente do GrowthHS pela API normal (`af39ef8`, `37f70dc`)
- [x] Tarefa 3 — entrega: acha a pessoa, atualiza card aberto ou cria (`f08efa2`, `cdf1402`, `cf40b9c`)
- [x] Tarefa 4 — receptor do webhook de volta (`ea5d015`, `536aaa1`)
- [x] Tarefa 5 — rota e tela de configuração (`f07f0a5`, `b43771a`)
- [x] Bloco "substituído" no topo do contrato antigo (`63fef7d`)
- Cada tarefa passou por revisão; quatro rodadas de correção de segurança
  pedidas pela coordenadora entraram (ver abaixo).
- **A 029 NÃO foi aplicada.** Ela precisa entrar ANTES do deploy (ver "Para a
  coordenadora").

## O que entrou

**Cliente (`app/crm/growthhs.py`).** `client-credentials` com token em memória
(chave base_url+client_id+secret, folga de 5 min); 401 numa chamada → token
novo e repete uma vez; 401 no próprio `client-credentials` = configuração
(pausa a fila). Pessoa por e-mail exato (minúsculas) nos quatro campos de
e-mail do GrowthHS; 400 de e-mail repetido → busca de novo. Cards da pessoa em
cada board de `boards_conferidos`. `POST /cards` (todo 2xx é sucesso),
`GET`/`PUT /cards/{id}` (PUT só com `description`), `POST /card-notes`.
Descrição: uma linha por item com valor, `campos_extras` num bloco próprio
"Respostas do formulário:", conversão, consentimento, `Pedido MarketingHS: <id>`
e o link "Ver no MarketingHS". `origin`: `Landing Page <slug>` /
`Captura pelo site [<form_id>]` / `MarketingHS`. `gclid` da visita do mesmo
visitante anterior à conversão.

**Entrega (`app/crm/entrega.py`).** Depois das travas de hoje: pessoa → cards
abertos → (a) aberto criado depois do pedido E assinado com
`Pedido MarketingHS: <id>` = tentativa anterior deste pedido, entregue sem
mexer; (b) senão o aberto mais recente ganha o bloco
`— Nova conversão pelo MarketingHS em dd/mm/aaaa hh:mm (pedido <id>) (dados informados no formulário, não verificados) —`
e uma nota; (c) nenhum aberto → cria. O bloco não se repete no retry (marca no
cabeçalho). A guarda local antiga (`_ja_entregue`) saiu. Contagem do ciclo:
`entregues`, `atualizadas`, `adiadas`, `falhas`, `pausadas`.

**Volta (`app/crm/volta.py`, `POST /publico/growthhs/webhook?evento=`).**
Segredo `GROWTHHS_WEBHOOK_SECRET` (sem ele 503), corpo ≤ 512 KB (413), HMAC
sobre os bytes crus em tempo constante (401). Depois disso sempre 200. O evento
só vale se o corpo assinado bater: `event = card.list_changed` e `card.list_id`
em `listas_reuniao` (reunião) ou `listas_ganho` (venda). Timestamp do corpo a
±10 min; corpo repetido (card, evento, timestamp) ignorado. Lead por
`card.id` (entrega, depois identidade, só se o e-mail da pessoa do card
bate) ou por `card.person.email`. Aplicação = a do `/evento-de-contato`
(`retorno.aplicar_evento`).

**Configuração.** `growthhs_config` ganha `client_id`, `list_id`,
`boards_conferidos`, `listas_reuniao` (padrão `{28}`), `listas_ganho`
(padrão `{32}`); `board_id` fica sem uso. Segredos `GROWTHHS_CLIENT_SECRET` e
`GROWTHHS_WEBHOOK_SECRET` em `integration_secrets`; `GROWTHHS_API_KEY` não é
mais lido pelo cliente. Tela com URL da API/app, client_id, secret, lista de
entrada, boards, listas de reunião e ganho, segredo do webhook e as duas URLs
do receptor para copiar. "Testar" = `client-credentials`.

## Segurança (pedidos da coordenadora, 22/10)

1. **Injeção de linhas na descrição.** Todo valor de fora vira uma linha só
   (controle Unicode, U+2028/2029 → espaço); rótulo de `campos_extras` ≤ 60,
   valor ≤ 500; respostas do formulário num bloco próprio; vale para título e
   nota.
2. **Atualizar card aberto com travas.** Pessoa só por e-mail exato (lead sem
   e-mail cria pessoa e card novos, nunca atualiza); identidade só preenche
   `growthhs_card_id`/`person_id` vazios; bloco e nota rotulados "dados
   informados no formulário, não verificados"; só anexa (PUT só
   `description`). **Risco residual:** quem souber o e-mail de um cliente
   consegue anexar texto ao card dele — mitigado por ser só anexo, rotulado e
   uma linha por item.
3. **Webhook.** `?evento=` amarrado ao corpo assinado pela lista do card;
   replay recusado por janela de ±10 min e deduplicação.
4. **Testar conexão (SSRF com eco).** Erro do GrowthHS vira só
   `"<status>: <mensagem genérica>"` (+ `detail` de JSON, uma linha, ≤ 200) —
   no Testar, em `crm_handoffs.erro`, no evento e no GET. `base_url`/`app_url`
   só http/https, sem credencial nem fragmento. IP interno continua aceito
   (o endereço interno do EasyPanel é legítimo).

## Para a coordenadora

- **Aplicar a 029 antes do deploy** (com o dono do banco — o
  `marketinghs_app` não é dono de `growthhs_config`). Sem as colunas novas,
  `ler_config` cai em "não configurado" inteiro (entrega parada, webhook com
  28/32). Rodar duas vezes para provar.
- **Limite de taxa:** `/publico/growthhs/webhook` cai no balde comum de
  `/publico` (30/min por IP, `main.py`). 429 conta como falha no GrowthHS e 5
  seguidas desligam a automação (que não re-tenta). Sugestão: pôr em
  `isentos` (a assinatura HMAC é a autenticação) ou balde próprio. Fora do
  meu território.
- **Ids velhos do receptor de teste:** `crm_handoffs.card_id/person_id` e
  `ecosystem_identities.growthhs_card_id` gravados na prova (21–22/10) são
  ids inventados que podem colidir com cards reais. A entrega não reusa
  `person_id` e o webhook confere o e-mail, mas o certo é limpar antes de
  ligar.
- **`config_growthhs` do `conftest.py`** ficou sem uso pelos testes de CRM
  (eles usam `tests/growthhs_banco.py`, transação revertida) e só salva e
  restaura `base_url/board_id/app_url` — apagaria as colunas novas. Remover.
- **Texto velho** citando `_ja_entregue`: `app/routers/receptor_growthhs.py:21`.
- **Duplicação aceita:** `publico._evento_do_growthhs` e
  `retorno.aplicar_evento` fazem a mesma aplicação; andam juntas.
- Prova na homologação: configurar `listas_reuniao`/`listas_ganho` com os ids
  de lá (os padrões 28/32 são de produção).

## Perguntas (assumi a mais segura e reversível)

1. **Reconversão pela regra não chega ao card.** O gatilho da 020 não
   reenfileira lead que já tem entrega `entregue`; pelo caminho da regra, a
   mesma pessoa convertendo de novo nunca vira pedido (jornada e manual sim).
   Tirar a guarda traria de volta um bloco a cada mudança de etiqueta.
   **Assumido:** não mexer; a saída provável é enfileirar na conversão.
2. **Teto do corpo do webhook** contra card com descrição longa (cada
   reconversão anexa um bloco). Era 64 KB (spec); a revisão final (M1) subiu
   para **512 KB** — um 413 conta como falha lá e 5 seguidas desligam a
   automação.
3. **`person_id` guardado como atalho** (spec §3): **não** reusado — a pessoa
   é sempre buscada por e-mail (ids do receptor de teste). Exceção: lead sem
   e-mail reusa a pessoa que o próprio pedido criou.
4. **Linha "Indicação"** e faixas fora do padrão como texto cru na descrição:
   mantidas (não perder dado).
5. **Relógio:** a janela de ±10 min do webhook depende de NTP nos dois lados;
   evento fora dela é ignorado com log de aviso, sem erro.
6. **Lead sem e-mail** cuja resposta do `POST /persons` se perde gera pessoa
   duplicada no GrowthHS (telefone não é único lá). Risco baixo.
7. **Nota duplicada** se a resposta do `POST /card-notes` se perder (não é
   idempotente). Aceito.
