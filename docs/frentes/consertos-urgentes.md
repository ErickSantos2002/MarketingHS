# Frente `consertos-urgentes`

Achados do raio-x de 02/10 (substituir o RD, captar lead novo), confirmados em
produção pela coordenadora. Território: os arquivos citados em cada item
(frontend e backend), `frontend/nginx.conf`, testes. Nenhuma migration nesta
frente — se precisar, anota e para o item.

## Backlog (em ordem)

- [x] **U1 Landing não capta (crítico).** `frontend/src/landing/Formulario.tsx:48`
  faz `fetch("/publico/captura")`; em produção dá **405** (o nginx só repassa
  `/api/`, `/p/`, `/landing/`). Usar o mesmo `BASE='/api'` do `Descadastrar.tsx`.
  Procurar no `src/landing/` e no `ab.js`/redirecionador A/B qualquer outro
  caminho público sem `/api`. Conferir o proxy do Vite também.
- [x] **U2 Descadastro de um clique (RFC 8058).** `List-Unsubscribe` aponta para
  `FRONTEND_URL/descadastrar?lid&e&t` (`backend/app/email/montagem.py:63`);
  POST lá dá **405**. Criar rota que aceita `POST` com corpo
  `List-Unsubscribe=One-Click` (form-encoded) e `lid/e/t` na query, validando a
  mesma assinatura HMAC, e apontar o cabeçalho para `/api/...` (o link do
  rodapé para a página continua). Teste automatizado do POST de um clique.
- [x] **U3 Importação não dispara automação.** `POST /contatos/importar`
  (`contatos.py:70`) não marca `sem_automacao` como o recálculo e o DataCore —
  importar a base do RD matricularia todos em jornada e regra. Marcar, com
  teste que prova que não nasce `journey_events`/handoff.
- [x] **U4 Gatilho de jornada "Lead criado" nunca dispara.**
  `frontend/src/lib/journeys.ts:88-101` oferece `lead_created`; o banco emite
  `form_submitted`. Trocar no seletor (rótulo "Formulário enviado / lead
  criado") e conferir jornadas existentes.
- [x] **U5 Regra de automação por tag conta mas não dispara** (`automacoes.py:157`
  aceita, o trigger ignora). Tirar `tag` do seletor de regra e da prévia
  (implementar fica para a frente de qualificação).
- [x] Portão: guarda 0, `tsc` 0, `vite build`, `build:landing`, pytest dos
  arquivos tocados (a suíte inteira uma vez no fim, sozinha, ~33 min; banco é
  PRODUÇÃO com dado real — só apagar o que o teste criou, por id).

## Estado

**02/10 — pronto para merge.** Branch `worktree-agent-adff6c288dcd30e3f`.

- **U1** `Formulario.tsx` posta em `${BASE}/publico/captura`, com
  `BASE = VITE_API_URL ?? "/api"` (o do `Descadastrar.tsx`). Nada mais em
  `src/landing/` chama `/publico` sem `/api`; `ab.js` usa `data-endpoint`
  (redirecionador) e o Worker do A/B já usa `${API_URL}` — limpos. Proxy do
  Vite já tinha `/api`. Prova: `node --test scripts/landing-caminhos.test.mjs`
  (fonte + `dist-landing/main.js`; no bundle sai `fetch(`${Od}/publico/captura`)`
  com `Od="/api"`).
- **U2** Rota nova `POST /publico/descadastro/um-clique?lid&e&t` (mesmo HMAC,
  corpo form não conferido, sem GET). `cabecalhos_rfc8058(base, lead_id, email,
  segredo)` monta ela mesma `FRONTEND_URL/api/publico/descadastro/um-clique?...`;
  o rodapé continua em `/descadastrar`. `worker.py` mudou só na chamada.
  Testes: `test_descadastro_um_clique.py` (POST 200 + supressão, idempotente,
  token errado 401, GET 405) e `test_montagem.py`.
- **U3** Corpo da importação virou `importar_linhas(conn, dados)` e marca
  `sem_automacao` na transação. Teste em `test_automacao_em_massa.py` (regra
  ativa casando, cria e atualiza: 0 handoff, 0 `journey_events`,
  `form_submitted` na timeline); a lista de quem marca ganhou `importar_linhas`.
- **U4** `EVENT_OPTIONS`: `lead_created` → `form_submitted`, rótulo
  "Formulário enviado / lead criado". Produção: 0 jornadas (leitura 02/10),
  nada a migrar. `scripts/journeys-eventos.test.mjs` confere que todo evento
  oferecido tem emissor no backend.
- **U5** O seletor já não tinha tag (8D) e o salvar recusava; a prévia
  (`/automacoes/previa`) contava. Agora recusa com `MSG_TAG`, `_condicao_sql`
  perdeu o ramo `tag`, e o formulário perdeu operadores/carga de tags.
  Produção: 0 regras. Testes: `test_regra_sem_tag.py`,
  `scripts/regra-sem-tag.test.mjs`.
- **Portão:** guarda 0, `tsc` 0, `vite build` ok, `build:landing` ok, node
  tests 7/7, pytest inteiro 428 passed (38 min, sozinha). `leads`: 2107 antes,
  2107 depois.

## Perguntas

1. **Limite de taxa no um clique.** `/publico/descadastro/um-clique` cai no
   `LimiteTaxaMiddleware` (30/min por IP). O POST vem dos servidores do
   Gmail/Yahoo — poucos IPs; numa campanha grande pode estourar e levar 429
   (o provedor re-tenta). Assumido: deixar como está (não é meu território,
   `main.py`). Opção: isentar a rota como o webhook (ela se autentica por HMAC).
2. **Sobreposição com `proteger-envio`:** mexi em `backend/app/worker.py`
   (só a chamada de `cabecalhos_rfc8058`, 2 linhas) e em
   `backend/app/routers/automacoes.py` (U5). Conflito no merge, se houver, é
   trivial.
3. `bancos` não roda no `.venv` do backend (falta `psycopg`); medi com o
   `.venv` do próprio `~/projetos/bancos`, usuário de leitura.
