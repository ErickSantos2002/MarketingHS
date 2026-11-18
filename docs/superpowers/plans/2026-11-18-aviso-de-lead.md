# Aviso de lead por e-mail — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a cada conversão de formulário, um e-mail aos endereços de vendas com os dados do lead, pelo Resend, sem atrasar nem recusar a captura.

**Architecture:** `registrar_captura` insere uma linha em `avisos_de_lead` na mesma transação da conversão (só com o aviso ligado). Um laço novo do worker reivindica com `FOR UPDATE SKIP LOCKED`, monta o e-mail e chama `resend.enviar` para cada destinatário, com retentativa crescente. Configuração em dois segredos de `integration_secrets`, editáveis num card de Configurações.

**Tech Stack:** FastAPI + asyncpg, pytest (Postgres local), React 18 + shadcn.

**Spec:** `docs/superpowers/specs/2026-11-18-aviso-de-lead-design.md` (autoridade). Regras do repo: `CLAUDE.md`.

## Global Constraints

- Migration `backend/migrations/038_avisos_de_lead.sql`: reaplicável (`IF NOT EXISTS`, `DROP ... IF EXISTS` antes de `ADD`), sem `CREATE EXTENSION`, sem `CREATE POLICY`, RLS ligado, `GRANT` só ao `service_role`.
- `UNIQUE (conversao_id)`; FK `lead_conversions(id) ON DELETE CASCADE`.
- Status: `'pendente' | 'enviado' | 'falhou'`. `MAX_TENTATIVAS = 8`. Espera: `min(1 min × 2^(t−1), 60 min)`.
- Log fixo ao desistir: `AVISO DE LEAD NÃO ENVIADO`.
- Segredos: `AVISO_LEAD_PARA` (vírgula), `AVISO_LEAD_LIGADO` (`"1"`/`"0"`). Sem segredo: ligado, para `vendas@healthsafetytech.com`.
- Remetente `EMAIL_FROM` (padrão `MarketingHS <noreply@localhost>`); `reply_to` = e-mail do lead.
- Assunto: `Novo lead: <nome> — <empresa>`; reconversão `Lead voltou: …`; agendamento `Reunião agendada: …`. Sem empresa: só `<nome>`; sem nome: o e-mail.
- Todo valor do formulário: `growthhs.uma_linha` + `html.escape`. Nada de consentimento, IP ou user-agent no e-mail.
- Data/hora em `America/Sao_Paulo`. Link do contato: `{FRONTEND_URL}/contacts?contato=<lead_id>` (mesmo formato de `jornadas/saidas.url_da_ficha`).
- Rede nunca dentro de transação. Testes: Resend sempre falso (monkeypatch de `resend.enviar`), nenhum e-mail real.
- Front: cor só de token (sem hex nem cor literal do Tailwind); `npm run guarda:visual -- src/components/admin/settings` limpo. Tipos do bloco em `frontend/src/lib/config.ts` (só o bloco novo).
- Rotas de configuração atrás de `admin_ou_maquina("read"/"write")`, como o bloco do Resend.

## Decisões tomadas aqui (registrar em `docs/frentes/aviso-de-lead.md`)

1. **Lead de teste nunca sai pela passada normal:** a reivindicação sem `somente=` pula lead com `tipo = 'teste'` ou e-mail terminando em `.invalid` (mesma lição de `entrega.LEAD_DE_TESTE`). Com `somente=[ids]` (os testes) sai.
2. **Atraso inicial de 60 s** (`ATRASO_INICIAL`): o aviso nasce com `visivel_em = now() + 60 s`. Um teste que comita uma captura e apaga o lead em segundos leva o aviso junto (CASCADE) antes de qualquer worker ver. Para vendas, um minuto não pesa.
3. **Duplo clique** (o `ON CONFLICT` do `_inserir` que perdeu a corrida): não enfileira — quem venceu já enfileirou, como já acontece com `publicar_conversao`.
4. **Desligado na hora de enviar:** o laço não reivindica; o que estava pendente espera (não é descartado).
5. **Sem `RESEND_API_KEY`:** não reivindica (não gasta tentativa); o worker loga uma vez por ausência.
6. **Vários destinatários:** um envio por endereço; `enviados text[]` guarda quem já recebeu — o retry não repete para quem já recebeu.
7. **Tolerante à ordem do deploy:** sem a tabela (038 não aplicada), a captura segue sem aviso; o INSERT roda num SAVEPOINT e falha nele só loga.
8. **Ritmo:** o laço usa o `_compasso` do worker (`esperar_vez`, `segurar` no 429), mas o `ritmo.SQL_USO` não conta os avisos de lead (fora do território; volume de poucos por dia) — fica como pergunta.

## Review Focus

1. Resend fora por horas → aviso sobrevive e sai depois, sem duplicar para quem já recebeu (teste em Task 3: falha no 2º destinatário, retry manda só a ele).
2. 038 não aplicada em produção com o código novo no ar → captura não pode dar 500 (teste em Task 1: tabela ausente simulada pelo SQL do enfileirar trocado).
3. Valor com `<script>`/quebra de linha no nome/empresa/extras → escapado e numa linha, inclusive no assunto (Task 2).
4. `AVISO_LEAD_PARA` com espaço, vírgula sobrando, endereço inválido → a rota recusa inválido com 400; vazio volta ao padrão (Task 4).
5. Lead de teste da suíte → nunca é reivindicado sem `somente` (Task 3).

---

### Task 1: migration 038 + configuração + enfileirar na captura

**Files:**
- Create: `backend/migrations/038_avisos_de_lead.sql`
- Create: `backend/app/avisos/__init__.py`, `backend/app/avisos/config.py`, `backend/app/avisos/fila.py` (só `enfileirar` nesta task)
- Modify: `backend/app/captura/registro.py` (só o enfileirar no fim de `_registrar`)
- Test: `backend/tests/test_aviso_de_lead_captura.py`

**Interfaces:**
- Produces:
  - tabela `public.avisos_de_lead (id uuid pk default gen_random_uuid(), conversao_id uuid NOT NULL UNIQUE REFERENCES lead_conversions(id) ON DELETE CASCADE, lead_id uuid NOT NULL, status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','enviado','falhou')), contato_novo boolean NOT NULL DEFAULT true, agendamento boolean NOT NULL DEFAULT false, tentativas int NOT NULL DEFAULT 0, visivel_em timestamptz NOT NULL DEFAULT now(), enviados text[] NOT NULL DEFAULT '{}', erro text, resend_id text, enviado_em timestamptz, criado_em timestamptz NOT NULL DEFAULT now(), atualizado_em timestamptz NOT NULL DEFAULT now())`; índice parcial `idx_avisos_de_lead_pendentes ON (visivel_em) WHERE status = 'pendente'`.
  - `app/avisos/config.py`: `PARA_PADRAO = ["vendas@healthsafetytech.com"]`; `@dataclass(frozen=True) class ConfigAviso: ligado: bool; para: list[str]`; `def separar_enderecos(texto: str | None) -> list[str]` (vírgula, strip, sem vazios, sem repetidos case-insensitive); `async def ler_config() -> ConfigAviso` (via `integracoes.ler_segredo`; `AVISO_LEAD_LIGADO == "0"` desliga, qualquer outro valor ou ausente liga; `para` vazio → `PARA_PADRAO`).
  - `app/avisos/fila.py`: `ATRASO_INICIAL = timedelta(seconds=60)`; `SQL_ENFILEIRAR` (constante, para o teste trocar); `async def enfileirar(conn, *, conversao_id: str, lead_id: str, contato_novo: bool, agendamento: bool) -> None` — confere `ler_config().ligado`; INSERT com `ON CONFLICT (conversao_id) DO NOTHING` dentro de `async with conn.transaction()` (SAVEPOINT) e `except Exception` que só loga (`logger.error`). Nunca levanta.
  - `registro._registrar` chama `fila.enfileirar(...)` depois de `gravar_consentimento`, com `contato_novo = (existente era None e o INSERT gravou)`; no caminho da corrida perdida (o `lead_id is None` do `_inserir`) **não** chama. Import tardio dentro da função não é necessário (sem ciclo), mas use `from app.avisos import fila as fila_de_avisos`.

- [ ] **Step 1: testes que falham** (`test_aviso_de_lead_captura.py`):
  - `test_038_reaplicavel` — texto da migration, mesmo molde de `test_migracao_036.py::test_036_reaplicavel` (sem `CREATE EXTENSION`, `CREATE TABLE`/`INDEX` só com `IF NOT EXISTS`, sem `CREATE POLICY`, `ENABLE ROW LEVEL SECURITY` presente, os 3 índices intocáveis não citados).
  - `test_separar_enderecos` — `" a@x.com, ,B@x.com,a@X.com "` → `["a@x.com", "B@x.com"]`.
  - `test_ler_config_padrao` (monkeypatch de `integracoes.ler_segredo` → None) → `ConfigAviso(True, ["vendas@healthsafetytech.com"])`; `"0"` → `ligado False`.
  - `test_captura_da_landing_enfileira`, `test_conversao_do_site_enfileira`, `test_agendamento_confirmado_enfileira` — usam `registrar_captura` direto sobre a fixture `conexao` (transação revertida), com os três jeitos que os chamadores passam (`Origem(page_slug=...)`; `Origem(site_id=..., form_id=...)` com site criado na própria transação e `canal_origem="site"`; `agendamento=True`). Asserção: 1 linha em `avisos_de_lead` para a conversão, `status='pendente'`, `contato_novo` true, `agendamento` conforme, `visivel_em > now() + interval '50 seconds'`.
  - `test_reconversao_enfileira_como_voltou` — segunda captura do mesmo e-mail → 2 avisos, o segundo `contato_novo = false`.
  - `test_desligado_nao_enfileira` — `ler_config` monkeypatchado com `ligado=False` → 0 linhas.
  - `test_falha_no_enfileirar_nao_derruba_captura` — monkeypatch de `fila.SQL_ENFILEIRAR` para uma tabela inexistente; `registrar_captura` devolve o lead_id e a conversão existe.
  - Em todos: monkeypatch de `app.avisos.config.ler_config` (ou de `integracoes.ler_segredo`) — nada de ler segredo real.
- [ ] **Step 2:** rodar e ver falhar: `cd backend && DATABASE_URL=<local> ./.venv/bin/pytest -q tests/test_aviso_de_lead_captura.py`.
- [ ] **Step 3:** escrever a migration e aplicá-la **no Postgres local** duas vezes (`PGPASSWORD=teste-local psql postgresql://postgres@127.0.0.1:5454/marketinghs -v ON_ERROR_STOP=1 -f backend/migrations/038_avisos_de_lead.sql`), depois o código.
- [ ] **Step 4:** testes passam; rodar também `tests/test_captura.py tests/test_prova_site.py tests/test_agendamento_captura.py` sem regressão.
- [ ] **Step 5:** commit `feat(aviso-de-lead): fila avisos_de_lead (038) e enfileirar na captura`.

### Task 2: montagem do e-mail

**Files:**
- Create: `backend/app/avisos/email.py`
- Test: `backend/tests/test_aviso_de_lead_email.py`

**Interfaces:**
- Produces: `def montar_aviso(lead: dict, conversao: dict, *, contato_novo: bool, agendamento: bool, rotulos: dict[str, str] | None = None, nome_do_site: str | None = None, url_contato: str) -> tuple[str, str, str]` → `(assunto, html, texto)`.
  - `lead`: colunas de `leads` (`nome, email, whatsapp, phone_normalized, empresa, cargo, campos_extras`). `conversao`: linha de `lead_conversions` como dict (`page_slug, site_id, form_id, page_url, canal, utm_*, converted_at, dados_informados`).
  - Campos extras: de `conversao["dados_informados"]["campos_extras"]` se houver, senão `lead["campos_extras"]`; cada chave vira `rotulos.get(chave) or chave`. Pula as chaves de controle (`execucao.CHAVES_DE_CONTROLE`).
  - Linhas, só com valor, nesta ordem: Nome, E-mail, WhatsApp (`whatsapp` ou `phone_normalized`), Empresa, Cargo, extras, Onde (`Landing <slug>` ou `Site <nome_do_site>` + ` · formulário <form_id>` se houver), Página (`page_url`), Canal, UTMs (`utm_source / utm_medium / utm_campaign / utm_term / utm_content` só os preenchidos, como `chave=valor`), Quando (`dd/mm/aaaa às HH:MM` em São Paulo), Contato (`Novo` / `Já existia — converteu de novo`), e o link `Abrir o contato no MarketingHS`.
  - HTML simples sem hex? **Exceção da casa: HTML de e-mail pode ter cor literal**; mantenha mínimo (tabela, cinza para rótulo, como `montar_email_vendedor`).

- [ ] **Step 1: testes que falham:**
  - `test_assunto_novo` → `"Novo lead: Ana — ACME"`; `test_assunto_voltou` → começa com `"Lead voltou: "`; `test_assunto_agendamento` → começa com `"Reunião agendada: "`; sem empresa → `"Novo lead: Ana"`; sem nome → usa o e-mail.
  - `test_escapa_e_uma_linha` — nome `"<script>x</script>\nInjetado"` → html contém `&lt;script&gt;`, não contém `<script>`; assunto sem `\n`.
  - `test_extras_com_rotulo` — `dados_informados.campos_extras = {"setor": "Mineração"}`, `rotulos={"setor": "Setor de atuação"}` → html tem `Setor de atuação` e não tem `>setor<`.
  - `test_sem_dado_sensivel` — conversão com chaves `ip`, `user_agent`, `consentimento` → nenhuma aparece no html/texto.
  - `test_onde_site_e_landing`, `test_hora_em_sao_paulo` (`converted_at` 2026-11-18T13:05Z → `18/11/2026 às 10:05`), `test_link_do_contato`.
- [ ] **Step 2:** ver falhar. **Step 3:** implementar. **Step 4:** passar. **Step 5:** commit `feat(aviso-de-lead): montagem do e-mail a vendas`.

### Task 3: envio pela fila + laço do worker

**Files:**
- Modify: `backend/app/avisos/fila.py` (reivindicar/enviar/rodar)
- Modify: `backend/app/worker.py` (só `_laco_avisos` e o `create_task`/espera de parada)
- Test: `backend/tests/test_aviso_de_lead_envio.py`

**Interfaces:**
- Consumes: Task 1 (`ler_config`, tabela), Task 2 (`montar_aviso`), `entrega.rotulos_da_conversao(conn, conversao)`, `resend.enviar`, `resend.LimiteDoResend`, `ritmo.Compasso` (`esperar_vez(por_segundo)`, `segurado()`, `segurar(segundos)`).
- Produces:
  - `MAX_TENTATIVAS = 8`, `LOTE = 20`, `PRAZO_DA_REIVINDICACAO = timedelta(minutes=5)`, `def espera(tentativas: int) -> timedelta`.
  - `LEAD_DE_TESTE` (SQL): `l.tipo = 'teste' OR lower(l.email) LIKE '%.invalid'`.
  - `async def rodar_avisos(*, parar: asyncio.Event | None = None, compasso=None, somente: list[str] | None = None, por_segundo: float = 2.0) -> dict` → `{"enviados", "adiados", "falhos"}` ou `{"desligado": True}` (aviso desligado) ou `{"sem_chave": True}` (sem `RESEND_API_KEY`). Sem chave/desligado/`compasso.segurado()`: não reivindica.
  - Reivindicar: `UPDATE avisos_de_lead SET visivel_em = now() + PRAZO, tentativas = tentativas + 1 … WHERE id IN (SELECT a.id FROM avisos_de_lead a JOIN leads l ON l.id = a.lead_id WHERE a.status='pendente' AND a.visivel_em <= now() AND ($somente IS NULL OR a.id = ANY) AND ($somente IS NOT NULL OR NOT LEAD_DE_TESTE) ORDER BY a.visivel_em LIMIT n FOR UPDATE OF a SKIP LOCKED) RETURNING *`.
  - Por aviso (fora de transação): ler lead + conversão + nome do site + rótulos numa sessão `service_role`; montar; para cada destinatário de `ler_config().para` fora de `enviados`: `compasso.esperar_vez`, `resend.enviar(chave, de, para, assunto, html, texto, cabecalhos={}, responder_para=lead.email)`; após cada sucesso, `array_append` em `enviados` + `resend_id`. Todos → `status='enviado', enviado_em=now()`.
  - Erro comum: `tentativas >= MAX_TENTATIVAS` → `status='falhou', erro=…` e `logger.error("[aviso-de-lead] AVISO DE LEAD NÃO ENVIADO — conversão %s, lead %s: %s", …)`; senão `visivel_em = now() + espera(tentativas)`, `erro=…`.
  - `LimiteDoResend(e)`: o aviso atual e os restantes do lote voltam com `tentativas = tentativas - 1`, `visivel_em = now() + e.espera`; `compasso.segurar(e.espera)`; encerra a passada.
  - `parar` setado no meio: os não tentados voltam (`tentativas - 1`, `visivel_em = now()`).
  - Worker: `AVISOS_INTERVALO = 15`; `_laco_avisos()` no molde de `_laco_agendamentos`, passando `compasso=_compasso`; loga `sem_chave` uma vez por ausência (warning) e o resumo quando houver contagem; entra na lista de tarefas aguardadas no `finally`.

- [ ] **Step 1: testes que falham** (dados COMITADOS — o laço usa `sessao()` própria; fixture local que cria lead + conversão + aviso com `visivel_em = now()` via `db.sessao(role="service_role")` e apaga com `limpeza.apagar_leads` no fim; e-mail `aviso-<hex>@exemplo.invalid`, `tipo='teste'`; monkeypatch de `integracoes.ler_segredo` para `RESEND_API_KEY="re_teste"`, `EMAIL_FROM`, `AVISO_LEAD_PARA="a@hs.invalid,b@hs.invalid"`, e de `fila.resend.enviar` por falso que grava as chamadas):
  - `test_envia_para_cada_destinatario_com_reply_to_do_lead` — `rodar_avisos(somente=[id])` → 2 chamadas, `responder_para` = e-mail do lead, status `enviado`, `enviados` com os 2.
  - `test_lead_de_teste_nao_sai_sem_somente` — `rodar_avisos()` sem `somente` → 0 chamadas, aviso segue `pendente`, `tentativas = 0`.
  - `test_falha_adia_com_espera_crescente` — falso levanta `httpx.HTTPStatusError` 500 → `pendente`, `tentativas = 1`, `visivel_em ≈ now()+1 min`, `erro` preenchido.
  - `test_retry_nao_repete_quem_ja_recebeu` — falso falha só para `b@`; segunda passada (com `visivel_em` forçado a now()) → `a@` recebeu uma vez só no total.
  - `test_limite_do_resend_nao_gasta_tentativa` — falso levanta `LimiteDoResend(30)` → `tentativas = 0`, `visivel_em ≈ now()+30 s`, `compasso.segurado()` true.
  - `test_oitava_falha_vira_falhou_e_loga` — aviso com `tentativas = 7`; falha → `falhou`; `caplog` contém `AVISO DE LEAD NÃO ENVIADO`.
  - `test_sem_chave_nao_reivindica` — `RESEND_API_KEY` None → `{"sem_chave": True}`, `tentativas = 0`.
  - `test_desligado_nao_reivindica` — `AVISO_LEAD_LIGADO="0"` → `{"desligado": True}`.
- [ ] **Step 2:** ver falhar. **Step 3:** implementar `fila.py` e o laço do worker. **Step 4:** passar + `tests/test_worker_aviso.py tests/test_worker_ritmo.py` sem regressão. **Step 5:** commit `feat(aviso-de-lead): laço do worker envia pelo Resend com retentativa`.

### Task 4: rotas de configuração + "Enviar teste"

**Files:**
- Modify: `backend/app/routers/configuracao.py` (só um bloco novo, no fim do bloco do Resend)
- Test: `backend/tests/test_aviso_de_lead_config.py`

**Interfaces:**
- Consumes: `avisos.config` (`ler_config`, `separar_enderecos`, `PARA_PADRAO`), `avisos.email.montar_aviso`, `responder_para_valido` (validar cada endereço), `cliente_resend.enviar`.
- Produces:
  - `GET /config/aviso-lead` (`admin_ou_maquina("read")`) → `{"ligado": bool, "para": list[str], "padrao": bool}` (`padrao` = não há `AVISO_LEAD_PARA` gravado).
  - `PUT /config/aviso-lead` (`admin_ou_maquina("write")`), corpo `{"ligado": bool, "para": str}` (`para` ≤ 2000 chars) → grava `AVISO_LEAD_LIGADO` `"1"/"0"`; `para` vazio apaga `AVISO_LEAD_PARA` (volta ao padrão); qualquer endereço que falhe `responder_para_valido` → 400 com o endereço na mensagem; mais de 10 → 400. Devolve o mesmo formato do GET.
  - `POST /config/aviso-lead/testar` (`admin_ou_maquina("write")`) → monta com `montar_aviso` um lead e conversão de exemplo (nome `Lead de exemplo`, e-mail `exemplo@exemplo.invalid`, empresa `Empresa Exemplo`), assunto prefixado `[TESTE] `, envia para cada endereço configurado (`ler_config().para`) com `EMAIL_FROM`; sem `RESEND_API_KEY` → 400. Devolve `{"enviados": [..], "falhas": [{"para", "erro"}]}`. Não grava nada no banco. Funciona mesmo com o aviso desligado.

- [ ] **Step 1: testes que falham** (fixtures `cliente`, `token_admin`, `chave_de`; segredos gravados pela própria fixture do arquivo com restauração no teardown, como `segredos_resend` em `conftest.py`, ou monkeypatch de `ler_segredo`/`gravar_segredo`/`apagar_segredo` em `app.routers.configuracao` e em `app.integracoes`):
  - `test_sem_credencial_401`, `test_put_recusa_chave_de_api` (401).
  - `test_get_padrao` → `ligado True`, `para ["vendas@healthsafetytech.com"]`, `padrao True`.
  - `test_put_grava_e_le` — `{"ligado": false, "para": "a@hs.com.br, b@hs.com.br"}` → GET devolve os dois e `ligado False`.
  - `test_put_recusa_endereco_invalido` — `"a@hs.com.br, nao-e-email"` → 400 com `nao-e-email` no detalhe; nada gravado.
  - `test_put_para_vazio_volta_ao_padrao`.
  - `test_testar_envia_para_cada_endereco` — falso de `cliente_resend.enviar`; 2 endereços → 2 chamadas, assunto começa com `[TESTE] `, `{"enviados": [...2]}`.
  - `test_testar_sem_chave_400`.
- [ ] **Step 2-4:** falhar, implementar, passar + `tests/test_config_resend.py`. **Step 5:** commit `feat(aviso-de-lead): configuração e envio de teste`.

### Task 5: card "Aviso de lead" em Configurações

**Files:**
- Create: `frontend/src/components/admin/settings/AvisoDeLeadCard.tsx`
- Modify: `frontend/src/lib/config.ts` (só o bloco novo: tipo `ConfigAvisoLead`, `lerConfigAvisoLead`, `gravarConfigAvisoLead`, `testarAvisoLead`)
- Modify: `frontend/src/pages/admin/SettingsPage.tsx` (só montar `<AvisoDeLeadCard />` logo depois do `<ResendConfigCard />`)

**Interfaces:**
- Consumes: as 3 rotas da Task 4.
- Produces: card com ícone `BellRing` (lucide), título "Aviso de lead", descrição "A cada lead que chega por formulário, um e-mail para a equipe de vendas — responder vai direto para o lead."; `Switch` "Enviar aviso" (componente `@/components/ui/switch`, se existir; senão checkbox de `components/ui`); campo "Enviar para" (Input, endereços separados por vírgula, placeholder `vendas@healthsafetytech.com`) com dica "Vazio = vendas@healthsafetytech.com"; botões "Salvar" e "Enviar teste" (o teste avisa no toast para quem foi; com o aviso desligado o botão continua ativo). Erros por `ErroApi` em `toast.error`, como `RoletaReuniaoCard`. Cores só por token.

- [ ] **Step 1:** implementar o card e montar na página.
- [ ] **Step 2:** `cd frontend && npx tsc --noEmit` (0 erro), `npm run guarda:visual -- src/components/admin/settings` (limpo), `npm run build` (ok).
- [ ] **Step 3:** subir backend local na 8134 contra o Postgres local e o Vite na 8114 com `MKT_BACKEND_PORT=8134`; `node scripts/conferir-telas.mjs --porta 8114 --saida <scratchpad>/telas /admin/settings` e olhar os PNG (claro/escuro, larguras). Só lê — nenhum clique em "Enviar teste".
- [ ] **Step 4:** commit `feat(aviso-de-lead): card Aviso de lead em Configurações`.

### Task 6 (coordenação da frente): portão, registro, push

- [ ] Suíte inteira no Postgres local verde (`-rs`), `tsc` 0, guarda limpa, build ok.
- [ ] `git diff --stat main...`, nenhum `.env`/credencial.
- [ ] `docs/frentes/aviso-de-lead.md`: estado, decisões (as 8 acima), números, perguntas, o que falta para produção (aplicar 038 duas vezes, deploy de api/worker/sistema, `AVISO_LEAD_LIGADO=0` no homo e no script de restore do homo).
- [ ] Commit + `git push -u origin aviso-de-lead`.
