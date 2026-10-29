# Frente `agendamento-painel` (29/10/2026)

n 34 · Vite 8114 · backend local 8134 (só para a conferência) · Postgres
local 5454 (`marketinghs-teste-34`). Fecha as duas sobras da
`agendamento-robustez`: o aviso no painel (M5) e a saída das rotas antigas
(M6). GrowthHS e Resend só os falsos dos testes; nada em produção.

## Estado

| Item | Estado | Commit |
|---|---|---|
| 1 Faixa "Reuniões agendadas que não ficaram prontas" no card do GrowthHS | feito | `376c01a` |
| 2 Rotas antigas com token no caminho removidas | feito | `107f365` |

### 1 — como ficou

- `routers/configuracao.py::_estado_growthhs` soma
  `"agendamentos": await execucao.pendencias()` (`{falhas, sem_alerta,
  ultimas[5]}`). Vale para as três rotas que devolvem esse estado (GET,
  PUT, ativar), todas `admin_atual`.
- **Papel `leitura` não vê:** `/config/growthhs` está em `GETS_SO_ADMIN`
  (`tests/test_papel_leitura.py`), já coberto — leva 403, como a fila.
- `execucao.pendencias()` ganhou `vendedor_nome` (já gravado na reserva) para a
  faixa mostrar o nome em vez do id. Continua sem token e sem e-mail do lead.
- `GrowthHSCard.tsx`: faixa abaixo da fila de entrega, no molde da "Fila
  pausada" (caixa com borda e tinta), em `--tint-danger`/`--on-tint-danger`
  como a lista `ultimas_falhas`. Título com o total e "N sem alerta por
  e-mail" quando houver; uma linha de orientação ("o lead viu confirmado…");
  as últimas 5 como `sex., 30/10, 14:00 (Brasília) · página <slug> ·
  <vendedor> — <motivo>`. Dia/hora em `America/Sao_Paulo`, qualquer que seja
  o fuso do navegador. Sem pendência (ou backend antigo sem o campo), nada
  aparece.
- **Dado pessoal:** a faixa da fila mostra só o prefixo do id do contato; a
  nova segue a mesma linha — nem e-mail nem nome do lead. O nome do vendedor
  é de funcionário, não do lead.
- Guarda visual 0 em `src/components/admin/settings`.

### 2 — como ficou

- Saíram os quatro `*_antiga` (`/{token}/empresa`, `GET /horarios/{token}`,
  `/{token}/confirmar`, `/{token}/ligar`) e o
  `test_m6_rotas_antigas_ainda_aceitas`. Deploy das novas às 10:11 de 29/10;
  rascunho vive 30 min, as abas antigas já expiraram.
- grep em `frontend/src`, `frontend/scripts`, `backend/app` e `scripts`:
  nenhum caminho antigo. O modal (`landing/agendamento.ts`) só chama
  `/dados`, `/empresa`, `/horarios/consultar`, `/confirmar`, `/ligar`.
- Teste novo `test_m6_rotas_antigas_com_token_no_caminho_sairam`: com token
  **válido** (404 com token inventado não provaria nada — a antiga também
  dava 404), as quatro dão 404/405; nenhuma rota do router tem `{token}`; o
  rascunho continua utilizável pela rota nova.

## Conferência no navegador (Postgres local)

Não usei o `conferir-telas.mjs`: ele loga com a conta real do Claude (que não
existe no banco local) e guardaria o token na `.ferramentas/token` comum das
frentes. Script descartável no scratchpad, Chrome próprio, só GET/HEAD para a
API (o resto bloqueado; só caiu o `POST /api/ia/conversas` do layout). Backend
local na 8134 com `JWT_SECRET` descartável; admin descartável semeado no
container local; duas reservas `falhou` (uma sem alerta, uma sem
`vendedor_nome`).

Resultado em `/settings` → Integrações, claro/escuro, 1440 e 390 px: faixa
"Reuniões agendadas que não ficaram prontas: 2 · 1 sem alerta por e-mail",
datas certas em Brasília, "vendedor 13" quando falta o nome, sem rolagem
horizontal, sem erro de página, nem e-mail nem token no HTML.

## Portão (Postgres local, 29/10)

pytest **1367 passed, 0 failed, 9 skipped** (7 `base_real` + 2 da 032; banco
recriado antes da suíte; a robustez fechou com 1366 — saiu 1 teste das
antigas, entraram 2); `tsc --noEmit` 0 (`frontend` e `tsconfig.app.json`);
`node --test scripts/landing-*.test.mjs` 70/70; `npm run build` e
`npm run build:landing` ok; `guarda:visual` 0 em
`src/components/admin/settings`.
