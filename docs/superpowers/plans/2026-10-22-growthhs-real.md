# GrowthHS real — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** trocar o contrato morto `POST /integration/cards` pela API normal do GrowthHS (client-credentials → pessoa → card, com "atualiza + nota" para card aberto) e ligar a volta pelo webhook de automação dele.

**Architecture:** `app/crm/growthhs.py` vira um cliente HTTP com token em memória e re-tentativa única no 401; `app/crm/entrega.py` passa a orquestrar pessoa → cards da pessoa → criar ou atualizar; um módulo novo `app/crm/volta.py` traduz o webhook do GrowthHS para a mesma aplicação de estágio de `retorno.py`, servido por uma rota nova em `publico.py`. Configuração em `growthhs_config` (migration 029) + `integration_secrets`.

**Tech Stack:** FastAPI + asyncpg, httpx (`MockTransport` nos testes), React 18 + shadcn.

**Spec:** `docs/superpowers/specs/2026-10-22-growthhs-real-design.md`. Autoridade sobre a API do GrowthHS: `~/github/hsgrowth-sistema/docs/integracao-marketinghs.md` §1–§8 (só leitura).

## Global Constraints

- Território (ver `docs/frentes/README.md`, 22/10 noite): `backend/app/crm/`, rota nova em `publico.py`, bloco GrowthHS de `configuracao.py`, `backend/migrations/029_growthhs_real.sql`, `GrowthHSCard.tsx`, testes de CRM, bloco do topo de `docs/contratos/2026-09-02-…`, `docs/frentes/growthhs-real.md`. Nada em `config.py`, `main.py`, `conftest.py`.
- Segredos só em `integration_secrets`: `GROWTHHS_CLIENT_SECRET`, `GROWTHHS_WEBHOOK_SECRET`. `GROWTHHS_API_KEY` deixa de ser lido pelo cliente (o `receptor_growthhs.py` desligado continua lendo, intocado).
- Nenhum teste fala com a rede (`httpx.MockTransport`). Testes de config e de webhook rodam em **transação revertida** (fixture `banco_growthhs`, Tarefa 1) — nada se grava em `growthhs_config`/`integration_secrets` reais. Testes de entrega seguem o padrão `somente_lead` (o worker de produção roda a main com `growthhs_config` vazio).
- `origin` ≤ 200, UTMs ≤ 200, `gclid` ≤ 500, `utm_params` ≤ 500, `title` ≤ 500, `name` da pessoa ≤ 200, telefone ≤ 50 — cortar, nunca 422 por tamanho.
- `acquisition_channel = "Inbound"`; sem `client_id`/organização.
- Datas mostradas ao vendedor em `America/Sao_Paulo`, `dd/mm/aaaa hh:mm`.
- Comentários no estilo da casa (⚠️ com o porquê). Cores só de token no front.

## Review Focus

1. **Retry depois de um PUT que deu certo e cuja resposta se perdeu** → não pode empilhar dois blocos "Atualizado pelo MarketingHS" no mesmo card. O cabeçalho do bloco leva `(pedido <id>)`; se a descrição atual já o contém, o PUT é pulado (teste na Tarefa 3).
2. **`card_id`/`person_id` velhos do receptor de teste** (ids inventados que podem colidir com cards reais) → a entrega nunca reusa `person_id` guardado sem buscar (Tarefa 3); o webhook só aceita o lead achado por `card.id` se o e-mail da pessoa do card bate com o do lead (ou um dos dois é vazio) — senão cai para o e-mail (teste na Tarefa 4).
3. **Card `created_at` sem fuso** (o GrowthHS grava `datetime.utcnow`, serializa sem `Z`) → tratar ingênuo como UTC ao comparar com `crm_handoffs.criado_em` (teste na Tarefa 2).
4. **Webhook com JSON inválido mas assinatura certa, ou sem `card`** → 200 `{"ignorado": true}`, nunca 4xx/5xx (5 falhas desligam a automação lá) (teste na Tarefa 4).
5. **Busca parcial de pessoa** (`ana@x.com` traz `joana@x.com`) e e-mail em maiúsculas → só casa e-mail exato, minúsculas, nos quatro campos (teste na Tarefa 2).

---

### Tarefa 1: migration 029, `Config` novo e o banco de teste em transação

**Files:**
- Create: `backend/migrations/029_growthhs_real.sql`
- Create: `backend/tests/growthhs_banco.py` (fixture `banco_growthhs`, importada pelos testes)
- Modify: `backend/app/crm/growthhs.py` (só `Config`, `ler_config`, constantes de segredo)
- Test: `backend/tests/test_growthhs_config_029.py`

**Interfaces — Produces:**
- `growthhs.SEGREDO_CLIENTE = "GROWTHHS_CLIENT_SECRET"`, `growthhs.SEGREDO_WEBHOOK = "GROWTHHS_WEBHOOK_SECRET"`.
- `@dataclass(frozen=True) class Config: base_url: str|None; client_id: str|None; client_secret: str|None; list_id: int|None; boards_conferidos: tuple[int, ...]; app_url: str|None` com `configurado` (= base_url + client_id + client_secret + list_id + boards não vazio) e `url_do_card(card_id)` (igual ao de hoje).
- `async def ler_config() -> Config` — nunca levanta.
- Fixture `banco_growthhs(cliente, conexao, monkeypatch)` → devolve `conexao`. Aplica o SQL da 029 na transação **só se** `growthhs_config.client_id` não existir (information_schema), troca `sessao` por um falso (savepoint em `conexao`, ignora `role`) em `app.crm.growthhs`, `app.integracoes`, `app.routers.configuracao`, `app.routers.publico`, `app.routers.leitura_contatos`, `app.crm.volta` (se importável), e chama `integracoes.esquecer` para os dois segredos antes e depois. ⚠️ Pede `cliente` ANTES de `conexao`, para a pool não fechar com a conexão emprestada.

- [ ] **Passo 1:** testes que falham (`test_growthhs_config_029.py`):
  - `test_029_reaplicavel(conexao)`: executa o arquivo duas vezes na transação; `client_id` text, `list_id` bigint, `boards_conferidos` bigint[] existem; `board_id` continua.
  - `test_ler_config_le_colunas_novas_e_segredo(banco_growthhs)`: insere linha com `client_id='hsg_x'`, `list_id=22`, `boards_conferidos='{6,7}'`, grava `GROWTHHS_CLIENT_SECRET` em `integration_secrets` na transação → `Config(..., list_id=22, boards_conferidos=(6, 7), client_secret=...)`, `configurado is True`.
  - `test_configurado_exige_tudo()`: puro — falta qualquer um (inclusive `boards_conferidos=()`) → `False`.
- [ ] **Passo 2:** `cd backend && ./.venv/bin/pytest -q -p no:cacheprovider tests/test_growthhs_config_029.py` → FAIL.
- [ ] **Passo 3:** migration (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` ×3, `boards_conferidos bigint[] NOT NULL DEFAULT '{}'`, cabeçalho explicando a troca de contrato e que `board_id` fica), `Config`/`ler_config`, fixture.
- [ ] **Passo 4:** rodar → PASS.
- [ ] **Passo 5:** commit `feat(crm): migration 029 e configuração do GrowthHS real`.

### Tarefa 2: o cliente do GrowthHS

**Files:**
- Modify: `backend/app/crm/growthhs.py` (reescrito, mantendo `normalizar_faturamento`/`normalizar_funcionarios`, `ErroDefinitivo(detalhe, status)`, `ErroTransitorio`, `TIMEOUT`)
- Modify: `backend/app/crm/entrega.py` (só `origem_do_card`: acrescenta `gclid` — o da visita mais recente com `gclid` do `visitor_id` da conversão)
- Test: `backend/tests/test_growthhs_cliente.py` (reescrito), `backend/tests/test_prova_crm.py` (os testes do receptor de teste passam a montar o corpo antigo à mão; sai `test_criar_card_ponta_a_ponta_pelo_receptor` e o `test_card_leva_...` vira teste da descrição)

**Interfaces — Produces:**
- `def origem_do_card_texto(conversao: dict|None) -> str` — `Landing Page <page_slug>` / `Captura pelo site [<form_id>]` / `MarketingHS`, ≤ 200.
- `def montar_descricao(lead: dict, *, conversao, consentimento, frontend_url: str) -> str` — linhas só com valor, na ordem da spec §2; `Desafios` ≤ 500; última linha `Ver no MarketingHS: <frontend_url>/contacts?contato=<lead_id>`.
- `def montar_card(lead, cfg: Config, *, conversao=None, consentimento=None, person_id: int, frontend_url: str) -> dict` — `list_id`, `title` (`Nome — Empresa`), `description`, `person_id`, `origin`, `acquisition_channel`, `utm_source/utm_campaign/utm_term`, `utm_params`, `gclid` (de `conversao.get("gclid")`).
- `def bloco_de_atualizacao(lead, *, conversao, consentimento, frontend_url, pedido_id: int, quando: datetime) -> str` — `\n\n— Atualizado pelo MarketingHS em dd/mm/aaaa hh:mm (pedido <id>) —\n` + descrição.
- `def marca_do_pedido(pedido_id) -> str` = `"(pedido <id>)"`.
- `def criado_em_utc(card: dict) -> datetime|None` — ISO com ou sem fuso; ingênuo = UTC.
- `class Cliente` (async context manager): `Cliente(cfg, transporte=None)`; métodos `achar_ou_criar_pessoa(lead) -> int`, `cards_da_pessoa(person_id) -> list[dict]` (todos os `boards_conferidos`, `page_size=100`), `criar_card(corpo) -> dict` (todo 2xx é sucesso, corpo torto vira `{}` — regra I1/M1 de hoje), `ler_card(card_id) -> dict`, `atualizar_descricao(card_id, descricao) -> None` (PUT só com `description`), `anotar(card_id, texto) -> None` (`POST /api/v1/card-notes`).
- `async def testar(cfg, *, transporte=None) -> None` — só `client-credentials`; levanta `ErroDefinitivo`/`ErroTransitorio`.
- Token: cache de módulo `{(base_url, client_id, client_secret): (token, expira_monotonic)}`, folga 5 min; `limpar_tokens()` para testes. 401 numa chamada → token novo e repete **uma vez**; 401 no `client-credentials` → `ErroDefinitivo(status=401)`. 5xx/429/sem resposta → `ErroTransitorio`; outros 4xx → `ErroDefinitivo(status)`.
- Pessoa: e-mail → `GET /persons?search=<email>&page_size=100`, casa exato (minúsculas) em `email`, `email_commercial`, `email_personal`, `email_alternative`; sem e-mail e com telefone → busca pelo `phone_normalized` e casa exato em `phone`/`phone_whatsapp`/`phone_commercial`; não achou → `POST /persons` (`name` ≤ 200, `email`, `phone`/`phone_whatsapp` = `phone_normalized` ≤ 50, `position`); 400 no POST com e-mail → busca de novo e usa o achado (senão `ErroDefinitivo(400)`); sem e-mail e sem telefone → `ErroDefinitivo(status=422)` sem chamar nada.

- [ ] **Passo 1:** testes (todos com `MockTransport` roteando por método+caminho):
  - `test_token_e_reusado_e_renovado_no_401`: 2 chamadas → 1 `client-credentials`; a API responde 401 uma vez → novo token e repete; dois 401 seguidos → `ErroDefinitivo` status 401.
  - `test_client_credentials_401_e_definitivo` (status 401) e `test_client_credentials_manda_grant_type` (corpo tem `grant_type: "client_credentials"`).
  - `test_pessoa_casa_email_exato`: busca devolve `joana@x.com` (id 1) e `ANA@x.com` em `email_commercial` (id 2) para lead `ana@x.com` → 2, sem POST.
  - `test_pessoa_nao_achada_e_criada_com_e164`: corpo do POST = `{"name": ..., "email": ..., "phone": "+5581999999999", "phone_whatsapp": "+5581999999999", "position": "Gerente de SESMT"}`.
  - `test_pessoa_corrida_400_busca_de_novo`; `test_pessoa_sem_email_nem_telefone_e_422_sem_rede`.
  - `test_cards_da_pessoa_nos_boards_conferidos`: duas chamadas `GET /cards` com `board_id=6` e `7`, `person_id`, `page_size=100`; junta os dois `cards`.
  - `test_criado_em_utc`: `"2026-10-22T13:00:00"` → 13:00 UTC; `"2026-10-22T10:00:00-03:00"` → 13:00 UTC; ausente → `None`.
  - `test_origem`: landing / formulário / sem conversão / slug de 300 chars cortado em 200.
  - `test_descricao_e_card`: lead completo da spec → `title == "Carla Menezes — Transportadora XYZ"`, linhas `Empresa: Transportadora XYZ`, `Faturamento: Entre 100k e 500k/mes`, `Funcionários: 11-50 funcionarios`, `Lead score: 60`, `ja_faz_testagem: sim`, `Ver no MarketingHS: https://mkt.exemplo.invalid/contacts?contato=<id>`; sem chaves `source`, `external_id`, `contact`, `client_id`; `acquisition_channel == "Inbound"`; `utm_params == "utm_source=google&utm_medium=cpc&utm_campaign=black-friday"`. Lead mínimo → nenhuma linha "—" vazia.
  - `test_bloco_de_atualizacao`: começa com `— Atualizado pelo MarketingHS em 22/10/2026 10:00 (pedido 7) —` para `quando=13:00Z`.
  - `test_classifica_erros` (401 após retry/403/404/422 → definitivo com status; 429/500/503/sem resposta → transitório) e `test_todo_2xx_e_sucesso` (200/201/202/204 no `criar_card`).
  - `test_testar_so_chama_client_credentials`.
  - Em `test_prova_crm.py`: `_card()` passa a montar à mão o corpo do contrato antigo (o receptor desligado continua testado); `test_card_leva_...` vira `test_descricao_leva_conversao_consentimento_e_campos_extras`; `test_entrega_le_ultima_conversao_e_consentimento` também confere `gclid` da visita.
- [ ] **Passo 2:** rodar `tests/test_growthhs_cliente.py` → FAIL.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** rodar `tests/test_growthhs_cliente.py` e depois `tests/test_prova_crm.py` → PASS (um pytest por vez).
- [ ] **Passo 5:** commit `feat(crm): cliente do GrowthHS pela API normal (client-credentials, pessoa, card, nota)`.

### Tarefa 3: a entrega nova

**Files:**
- Modify: `backend/app/crm/entrega.py`
- Test: `backend/tests/test_crm_entrega.py` (adaptado: `CFG` novo; transporte falso que simula o GrowthHS inteiro)

**Interfaces — Consumes:** Tarefa 2 (`Cliente`, `montar_card`, `bloco_de_atualizacao`, `marca_do_pedido`, `criado_em_utc`, `Config`). **Produces:** `rodar_entregas(...)` com a mesma assinatura; contagem ganha a chave `"atualizadas"` (as `ja_entregues` deixam de existir).

Ordem em `_entregar` (depois das travas de hoje: excluído, modo teste, `mover`): `achar_ou_criar_pessoa` → `cards_da_pessoa` → abertos (`not is_won and not is_lost`):
- algum aberto com `criado_em_utc(card) >= pedido.criado_em` (o de `crm_handoffs`; `_reivindicar` passa a devolver `criado_em`) → marca `entregue` com ele, sem PUT nem nota, evento "Enviado ao comercial (GrowthHS)" com `recuperado: true` → `"entregues"`;
- senão, o aberto mais recente: `ler_card` → se a descrição já tem `marca_do_pedido`, pula o PUT; senão PUT com descrição atual + bloco; depois `anotar` com `Lead converteu de novo pelo MarketingHS (<origem>) em <dd/mm/aaaa hh:mm>. Descrição do card atualizada.`; `entregue` (blindado) com aquele `card_id`/`person_id`; evento `crm_handoff` "Card atualizado no comercial (GrowthHS)" com `ja_entregue: true, atualizado: true` → `"atualizadas"`;
- nenhum aberto → `criar_card` → caminho de sucesso de hoje (shield, identidade, evento), `person_id` = o achado.
`_ja_entregue` sai (não reusa `person_id` velho — ver Review Focus 2). Erros: mesma política (401/403/404 pausam, 422/400 falham o pedido, transitório adia). `frontend_url` = `settings.FRONTEND_URL`.

- [ ] **Passo 1:** testes (fake do GrowthHS em memória: pessoas, cards, notas, contadores de chamada):
  - `test_entrega_cria_pessoa_e_card` (card na `list_id` da config, `person_id` gravado no pedido e na identidade, evento com `card_id`).
  - `test_pessoa_com_card_aberto_atualiza_e_anota_sem_criar` (descrição = antiga + bloco; 1 nota; 0 POST /cards; `card_id` do aberto; evento com `atualizado: true`; resultado `atualizadas == 1`).
  - `test_so_cards_ganhos_ou_perdidos_cria_novo`.
  - `test_card_aberto_criado_depois_do_pedido_e_o_nosso` (sem PUT, sem nota, sem POST).
  - `test_retry_nao_empilha_bloco` (descrição já com `(pedido <id>)` → sem PUT, com nota).
  - `test_mesma_pessoa_em_dois_leads_um_card` (segundo lead → atualiza o card do primeiro).
  - Mantidos/adaptados: sem config não reivindica; 422 falha; 401/403/404 pausam sem gastar tentativa; transitório adia e esgota; `mover` falha à vista; 2xx com corpo inválido entrega e não repete; falha depois do 2xx não reenvia; parada do worker; cancelar depois do 2xx grava `entregue`; modo teste (fora/dentro da lista).
  - Saem: `test_lead_ja_entregue_nao_chama_de_novo`, `test_identidade_com_card_conta_como_entregue`, `test_ja_entregue_preenche_a_identidade_vazia` (o comportamento mudou de propósito — spec §3).
- [ ] **Passo 2:** rodar `tests/test_crm_entrega.py` → FAIL.
- [ ] **Passo 3:** implementar; atualizar a docstring do módulo (a guarda local saiu, por quê).
- [ ] **Passo 4:** rodar `tests/test_crm_entrega.py`, depois `tests/test_crm_caminhos.py` → PASS.
- [ ] **Passo 5:** commit `feat(crm): entrega acha a pessoa, atualiza card aberto ou cria`.

### Tarefa 4: o receptor do webhook

**Files:**
- Create: `backend/app/crm/volta.py`
- Modify: `backend/app/crm/retorno.py` (função `aplicar_evento` nova; `avancar_status` intocada)
- Modify: `backend/app/routers/publico.py` (só a rota nova, no fim do bloco do GrowthHS)
- Test: `backend/tests/test_growthhs_webhook.py`

**Interfaces — Produces:**
- `retorno.aplicar_evento(conn, lead: dict, *, event_type, title, metadata, description=None) -> dict` — grava `contact_events` (`source_app='growthhs'`), avança estágio por `ESTAGIO_POR_EVENTO`, costura A/B + conversão `agendamento` para `meeting_scheduled`; devolve `{evento_id, lead_id, dnia_id, status_anterior, status_atual, mudou}`.
- `volta.EVENTOS = {"meeting_scheduled": "Reunião agendada no GrowthHS", "deal_won": "Venda fechada no GrowthHS"}`, `volta.CORPO_MAXIMO = 64 * 1024`.
- `volta.assinatura_confere(corpo: bytes, segredo: str, cabecalho: str|None) -> bool` (`sha256=<hex>`, `hmac.compare_digest`).
- `async def volta.lead_do_card(conn, card: dict) -> dict|None` — `card.id` em `crm_handoffs` entregue (mais recente), depois `ecosystem_identities.growthhs_card_id` (lead canônico); aceito só se lead não excluído e o e-mail da pessoa do card bate (minúsculas) ou um dos dois é vazio; senão `card.person.email` exato, não excluído.
- `async def volta.aplicar(conn, evento: str, payload: dict) -> dict`.
- Rota `POST /publico/growthhs/webhook?evento=...` → sem segredo 503; corpo > 64 KB (Content-Length ou leitura em pedaços) 413; assinatura ausente/errada 401; evento fora de `EVENTOS`, JSON inválido, sem `card` ou lead não achado → 200 `{"ignorado": true}`; exceção nossa → `logger.exception` + 200 `{"erro": true}`.

- [ ] **Passo 1:** testes (tudo em `banco_growthhs`, transação revertida; lead e `crm_handoffs` entregue com `card_id=4821` criados em `conexao`; segredo gravado na transação):
  - `test_sem_segredo_503`, `test_assinatura_errada_ou_ausente_401`, `test_corpo_grande_413`.
  - `test_reuniao_pelo_card_id_avanca_para_mql` (status `MQL - Reunião agendada`, evento `meeting_scheduled` com `source_app='growthhs'` e `metadata.card_id == 4821`, um `contact_updated`).
  - `test_venda_pelo_email_da_pessoa` (sem handoff; `card.person.email` em maiúsculas).
  - `test_estagio_nao_volta`.
  - `test_card_desconhecido_200_ignorado`, `test_evento_desconhecido_200_ignorado`, `test_json_invalido_assinado_200_ignorado`.
  - `test_card_id_com_email_diferente_cai_para_o_email` (Review Focus 2).
  - `test_lead_excluido_ignorado`.
  - `test_erro_nosso_responde_200` (monkeypatch `volta.aplicar` levantando).
  - `test_assinatura_sobre_bytes_crus` (corpo com espaços/acentos não re-serializado).
- [ ] **Passo 2:** rodar → FAIL. **Passo 3:** implementar. **Passo 4:** rodar `tests/test_growthhs_webhook.py`, depois `tests/test_prova_crm.py` → PASS.
- [ ] **Passo 5:** commit `feat(crm): receptor do webhook de volta do GrowthHS`.

### Tarefa 5: configuração (rota + tela)

**Files:**
- Modify: `backend/app/routers/configuracao.py` (bloco GrowthHS)
- Modify: `frontend/src/components/admin/settings/GrowthHSCard.tsx`
- Test: `backend/tests/test_config_growthhs.py` (reescrito sobre `banco_growthhs`), `backend/tests/test_leitura_growthhs.py` (passa a usar `banco_growthhs`)

**Interfaces — Produces (API):**
- `GrowthHSIn`: `base_url`, `app_url` (validador de hoje), `client_id: str|None` (≤ 200), `client_secret: str|None`, `list_id: int|None (gt=0)`, `boards_conferidos: list[int]|None` (cada > 0, sem repetidos, ≤ 10), `webhook_secret: str|None` (≥ 16 caracteres quando vier), `limpar: list[Literal["client_secret", "webhook_secret"]]`.
- `GET /config/growthhs` → `{base_url, app_url, client_id, list_id, boards_conferidos: [..], client_secret: {configurado, ultimos4}, webhook_secret: {configurado}, configurado, webhook_urls: {meeting_scheduled, deal_won}, fila: {...igual}}`. URL = `settings.FRONTEND_URL.rstrip('/') + "/api/publico/growthhs/webhook?evento=<e>"`. Nenhum segredo volta.
- `POST /config/growthhs/testar` → faltando base_url/client_id/secret: 400; `ErroDefinitivo` → `{"valido": false, "status": n, "detalhe": ...}`; transitório → 502; ok → `{"valido": true}`.
- Tela: campos URL da API, URL do app, Client ID, Client secret (só escrita, olho), Lista de entrada (número), Boards conferidos (texto `6, 7` → lista), Segredo do webhook (só escrita), bloco só leitura com as duas URLs e botão copiar; "Testar" diz "Credenciais aceitas pelo GrowthHS" / "O GrowthHS recusou as credenciais (status n)". Texto antigo "não confere a chave" sai.

- [ ] **Passo 1:** testes: exige admin (GET/PUT/testar/reenfileirar → 403 para usuário); `test_grava_parcial_e_nunca_devolve_segredos` (secret `...1234` → `ultimos4 "1234"`, texto do segredo ausente da resposta; `boards_conferidos [6, 7]`; `configurado` true; PUT só `app_url` mantém o resto; `limpar` apaga); `test_recusa_entradas_invalidas` (sem protocolo, `list_id 0`, board 0, segredo do webhook curto → 422); `test_mostra_urls_do_webhook`; `test_testar_valido`/`_recusado`/`_sem_config_400` (monkeypatch de `growthhs.testar`); fila/pausa/reenfileirar (mantidos, em `banco_growthhs`); leitura: link "Ver no GrowthHS".
- [ ] **Passo 2:** rodar → FAIL. **Passo 3:** implementar backend; tela.
- [ ] **Passo 4:** `tests/test_config_growthhs.py`, `tests/test_leitura_growthhs.py` → PASS; `cd frontend && npx tsc --noEmit` sem erro novo; `npm run guarda:visual -- src/components/admin/settings` limpo; `node scripts/conferir-telas.mjs --porta <8080+n> --saida <scratchpad> /settings` (só leitura).
- [ ] **Passo 5:** commit `feat(config): tela e rota do GrowthHS real`.

### Tarefa 6: fechamento

- [ ] Bloco no topo de `docs/contratos/2026-09-02-endpoint-card-comercial-growthhs.md`: "Substituído por `hsgrowth-sistema/docs/integracao-marketinghs.md` em 22/10".
- [ ] `docs/frentes/growthhs-real.md`: estado, feito, perguntas (origem `MarketingHS` = pergunta 70; nota como "aviso"; isenção do limite de taxa; limpeza de `card_id` do receptor de teste; `config_growthhs` do conftest sem uso).
- [ ] Revisão final da branch; varredura (`git diff --stat`, sem `.env`); push da branch.
