# Frente `consertos-urgentes`

Achados do raio-x de 02/10 (substituir o RD, captar lead novo), confirmados em
produção pela coordenadora. Território: os arquivos citados em cada item
(frontend e backend), `frontend/nginx.conf`, testes. Nenhuma migration nesta
frente — se precisar, anota e para o item.

## Backlog (em ordem)

- [ ] **U1 Landing não capta (crítico).** `frontend/src/landing/Formulario.tsx:48`
  faz `fetch("/publico/captura")`; em produção dá **405** (o nginx só repassa
  `/api/`, `/p/`, `/landing/`). Usar o mesmo `BASE='/api'` do `Descadastrar.tsx`.
  Procurar no `src/landing/` e no `ab.js`/redirecionador A/B qualquer outro
  caminho público sem `/api`. Conferir o proxy do Vite também.
- [ ] **U2 Descadastro de um clique (RFC 8058).** `List-Unsubscribe` aponta para
  `FRONTEND_URL/descadastrar?lid&e&t` (`backend/app/email/montagem.py:63`);
  POST lá dá **405**. Criar rota que aceita `POST` com corpo
  `List-Unsubscribe=One-Click` (form-encoded) e `lid/e/t` na query, validando a
  mesma assinatura HMAC, e apontar o cabeçalho para `/api/...` (o link do
  rodapé para a página continua). Teste automatizado do POST de um clique.
- [ ] **U3 Importação não dispara automação.** `POST /contatos/importar`
  (`contatos.py:70`) não marca `sem_automacao` como o recálculo e o DataCore —
  importar a base do RD matricularia todos em jornada e regra. Marcar, com
  teste que prova que não nasce `journey_events`/handoff.
- [ ] **U4 Gatilho de jornada "Lead criado" nunca dispara.**
  `frontend/src/lib/journeys.ts:88-101` oferece `lead_created`; o banco emite
  `form_submitted`. Trocar no seletor (rótulo "Formulário enviado / lead
  criado") e conferir jornadas existentes.
- [ ] **U5 Regra de automação por tag conta mas não dispara** (`automacoes.py:157`
  aceita, o trigger ignora). Tirar `tag` do seletor de regra e da prévia
  (implementar fica para a frente de qualificação).
- [ ] Portão: guarda 0, `tsc` 0, `vite build`, `build:landing`, pytest dos
  arquivos tocados (a suíte inteira uma vez no fim, sozinha, ~33 min; banco é
  PRODUÇÃO com dado real — só apagar o que o teste criou, por id).

## Estado

## Perguntas
