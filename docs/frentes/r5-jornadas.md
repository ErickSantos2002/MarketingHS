# Frente `r5-jornadas` ("R5 sem decisão", parte backend + automações)

Origem: `docs/raio-x-rd.md` (R5) e perguntas 50 do `docs/perguntas-abertas.md`.
Só o que **não depende** de D1 (funil) nem do R4 (campos B2B).

Território: `backend/**` inteiro (dona única de migration, `config.py`,
routers e testes nesta rodada), `frontend/src/lib/journeys.ts`,
`frontend/src/components/admin/automations/`, `frontend/src/hooks/useJourneys*`.
**Não tocar:** `components/admin/contacts/`, `LeadDetailSheet.tsx`,
`hooks/useLeadQualification.tsx`, `components/admin/dashboard/`,
`frontend/src/landing/` — são da `r5-contatos`.
Migration: só se indispensável (numerar a partir da próxima livre,
idempotente, rodar duas vezes para provar, **NÃO aplicar em produção**;
montar `~/marketinghs-migration-0NN.sh` no molde do
`~/marketinghs-migration-025.sh` e anotar no Estado).
Portas: Vite 8093, backend 8113.

## Backlog (em ordem)

- [ ] **Nó de jornada "mudar status".** Configura um status de
  `lead_statuses`; o motor grava em `leads.status` (e registra evento, como os
  outros nós). Construtor: tipo novo no `journeys.ts`, rótulo, ícone e
  configuração no `NodeConfigDialog`. Teste do motor.
- [ ] **Nó de jornada "remover tag".** Espelho do `apply_tag`. Remover tag que
  o contato não tem não é erro. Teste.
- [ ] **Evento de conversão por página.** "Pediu demonstração" tem que poder
  disparar jornada **na hora** da conversão numa página específica: o gatilho
  `form_submitted` ganha filtro opcional por página (`page_slug`/id), e o
  evento publicado pela captura carrega a página. Sem filtro = qualquer página
  (comportamento de hoje). Construtor: seletor de página no gatilho. Teste:
  conversão na página A dispara a jornada filtrada por A e não a filtrada por B.
- [ ] **`POST /publico/conversao` não sobrescreve UTMs** (pergunta 50): mesmo
  bloco da captura (`routers/captura.py::_atualizar`, R1) — com qualquer
  `utm_*` já gravado, nenhum é tocado; sem nenhum, entra o bloco. Campos de
  perfil só preenchem o vazio. Teste.
- [ ] Portão: `tsc` sem erro novo, guarda 0 em `src`, `vite build`; pytest
  dos arquivos tocados com `-x` e depois a suíte inteira **uma vez, sozinha,
  com `timeout 3600`** (~35 min). ⚠️ Banco é **PRODUÇÃO com dado real**: só
  apagar o que o teste criou, por id; `count(*) FROM leads` igual antes e
  depois (anotar os dois números). Nunca duas suítes ao mesmo tempo — a
  `r5-contatos` não roda pytest.

## Estado

**05/10 — ✅ Pronto para merge** (branch `worktree-agent-a1720b4ffa0bb83cf`).
Commits: `1ad5365` (feature), `8a1ef37` (revisão), mais o deste registro.

- [x] **Nó "mudar status"** (`change_status`, `config.status`): o executor
  reusa `_resolver_status` e `_registrar_mudanca` do painel — grava
  `leads.status`, o `contact_updated` (com `source: "jornada"`,
  `journey_id`, `journey_run_id`) e o evento específico (`lead_qualified`
  etc.). Já no status = nada gravado, passo `skipped`. Status inexistente =
  `ValueError` → run `failed` com o motivo (depois das 3 tentativas).
- [x] **Nó "remover tag"** (`remove_tag`, `config.tag_name`): mesma
  normalização do `apply_tag`, comparação por `lower(name)`. Contato sem a tag
  não é erro (`removida: false` no passo). A tag fica em `tags`.
- [x] **Evento de conversão por página.** `entry_config.page_slug` opcional no
  gatilho `form_submitted`; sem ele, qualquer página. A captura marca a página
  antes do INSERT do lead novo (`fn_lead_insert_event` a põe no evento) e, para
  contato que já existia, publica `form_submitted` com `page_slug` e
  `reconversao: true` (`app/captura/evento.py`). `POST /publico/conversao`
  publica o mesmo — só sem `converted_at` (carga de histórico não matricula).
  **Reconversão só entra em fluxo FILTRADO**; fluxo sem filtro segue só com
  lead novo, como antes. Worker chama `journey_enroll_event(uuid,text,jsonb)`
  e recua para a de 2 argumentos se a 026 não existir.
- [x] **`POST /publico/conversao` não sobrescreve UTMs** (pergunta 50): bloco
  como na captura; `source` só no vazio (`_carimbar_lead`). `tipo` mantido.
- [x] Construtor: dois nós no menu "+", ícones, configuração no
  `NodeConfigDialog`, seletor de página (`EntryPageSelect`) no gatilho, na
  criação e na edição do fluxo.

**Migration 026 — PENDENTE, o Erick roda: `bash ~/marketinghs-migration-026.sh`
ANTES do deploy da API/worker.** `026_jornada_status_tag_pagina.sql`: só
`CREATE OR REPLACE FUNCTION` + `GRANT`. Provada num Postgres 17 local
descartável com as 26 migrations, aplicada duas vezes. Sem ela: o construtor
deixa montar os nós novos e o banco recusa ao salvar (erro à vista); o filtro
de página fica desligado (o worker avisa no log).

**Portão:**
- pytest do arquivo novo: 19 passed no Postgres local com a 026; no banco de
  produção 11 passed + 6 skipped (os que exigem a 026, pulados com o motivo).
- arquivos tocados (`test_captura`, `test_conversao`, `test_crm_caminhos`) com
  `-x`: 57 passed.
- suíte inteira (sozinha, `timeout -s KILL 3600`, `faulthandler_timeout=300`,
  07/10): **487 passed, 7 skipped** (os 7 da 026), 35 min 43 s, exit 0. A
  primeira tentativa (05/10) parou depois de 10 testes e ficou 47 h parada;
  o `timeout 3600` não disparou e a coordenadora matou o processo. O
  timestamp do arquivo de saída indica que a máquina estava suspensa nesse
  intervalo. Ao reabrir não havia advisory lock nem pytest concorrente. A
  rodada com diagnóstico não travou, então o faulthandler não despejou
  nenhum traceback.
- `count(*) FROM leads`: **2107 antes, 2107 depois** (as duas rodadas).
- `tsc --noEmit -p tsconfig.app.json`: 0 erros. Guarda `src`: 0.
  `vite build` e `build:landing`: ok. `journeys-eventos.test.mjs`: 2 pass.

**Fora do território (anotado para a coordenadora):**
`frontend/src/pages/admin/JourneyBuilder.tsx` — o menu "+", o resumo dos nós
e o diálogo "Entrada do fluxo" moram nele; mudança aditiva, nenhuma outra
frente o reivindica. `ApiDocumentation.tsx` (não tocado) ainda não diz que a
conversão pela API não troca a origem e publica `form_submitted`.

**Telas a conferir** (sem conta admin do Claude desde 02/10 — não conferi no
navegador): `/automations` → Novo fluxo com "Quando acontece um evento" →
"Formulário enviado" (seletor de página aparece); construtor de um fluxo →
"+" → "Remover tag" e "Mudar status"; card de entrada mostra "— página X".

**Ficou para depois (revisão, menor):** status inexistente re-tenta 3× antes
de `failed` (erro que não se cura sozinho); nó `change_status` não olha
`deleted_at`; `_aplicar_tag` (antigo) compara tag sem `lower()` e pode criar
"vip" ao lado de "VIP"; duplo envio da API sem `converted_at` grava dois
eventos na linha do tempo (a reentrada segura a matrícula).

## Perguntas

- **R5J-1. Reconversão × fluxo sem filtro de página.** Opções: (a) contato que
  já existia e converte de novo só entra em fluxo filtrado por página; (b)
  entra também no fluxo sem filtro ("Formulário enviado" de qualquer página);
  (c) opção por fluxo. **Assumido (a)** — é o comportamento de antes para os
  fluxos que já existirem (nenhum hoje) e não dispara "boas-vindas" para a base.
  Reversível numa linha da `journey_enroll_event`.
- **R5J-2. `tipo` em `POST /publico/conversao`.** Continua sobrescrito pelo
  `tipo` da conversão (comportamento de antes), embora a captura não o toque
  em contato existente. Opções: manter; só preencher o vazio. **Assumido:
  manter** — a rota exige chave `write`, e mudar seria corte de capacidade.
- **R5J-3. Conversão pela API com `converted_at`** (registro de histórico) não
  publica `form_submitted` — não matricula em jornada. Alternativa: publicar
  sempre. **Assumido: não publicar** (carga do RD não pode virar envio em massa).
- **R5J-4. Filtro por slug, não por id.** Trocar o slug da página faz o fluxo
  filtrado parar de disparar até reescolher (a tela avisa). Alternativa: guardar
  o id e resolver o slug na matrícula (exige join com `pages`). **Assumido: slug**
  — é o que o evento e `lead_conversions` carregam.
- **R5J-5. Fluxo esperando `form_submitted` (nó "Aguardar evento")** agora
  acorda também com a reconversão — antes isso nunca acontecia para quem já
  era contato. Assumido como desejado ("aguardar o formulário").
