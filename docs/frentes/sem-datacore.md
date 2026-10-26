# Frente `sem-datacore` (pergunta 80)

Aberta em 26/10/2026. Spec:
`docs/superpowers/specs/2026-10-26-sem-datacore-design.md`; plano:
`docs/superpowers/plans/2026-10-26-sem-datacore.md`.

## Estado

✅ Pronta para merge (26/10). Branch `worktree-agent-ae85b721542276bfa`.
**Migration 033** nova (não aplicada em produção).

## O que entrou

- **Sincronização fora:** apagados `routers/datacore.py`,
  `dominio/datacore.py`, `dominio/sincronizacao_datacore.py`, a pool do
  DataCore em `database.py` e o `init/close_datacore` do lifespan (a conexão
  ao ERP não abre mais no boot). `/datacore/*` → 404. Front: aba
  "DataCore (ERP)" e `lib/datacore.ts` fora; `ImportPage` mostra o CSV direto.
- **`DATACORE_URL` e `DATACORE_EMAIL_DE_NOTAS` ficam em `Settings`**, sem
  uso, com comentário — o `.env` de produção ainda as tem.
- **Trava no envio ao CRM** (`crm/entrega.py`: `ORIGENS_RECUSADAS`,
  `origem_recusada`, `ContatoRecusado`, `MOTIVO_ORIGEM`):
  - `enfileirar` recusa contato `source = 'datacore'` (sem caixa/espaço);
  - botão "Enviar ao comercial" → **409** com a frase (o toast mostra);
  - nó de jornada `handoff_growthhs` → passo `skipped` com `motivo`, o
    fluxo segue;
  - regra de automação (gatilho de banco) → **033**: `BEFORE INSERT` em
    `crm_handoffs` descarta o pedido de lead `datacore` (silencioso de
    propósito: erro abortaria o UPDATE do lead);
  - entrega: pedido que já estava na fila falha com o motivo no pedido e
    `crm_handoff_falhou` na linha do tempo; GrowthHS não é chamado.
- Exemplo do prompt da IA (`ia/analista.py`) trocado de `datacore` para
  `csv_import`; docstring de `dominio/automacao.py` atualizada.

## Fora do território (anotado)

- `backend/app/jornadas/executor.py` — 7 linhas no nó `handoff_growthhs`
  para pegar `ContatoRecusado` (sem isso a recusa virava retry do nó).
- `backend/app/routers/crm.py` — o 409 do botão.
- `backend/app/database.py`, `dominio/automacao.py`, `ia/analista.py`,
  `pages/admin/ImportPage.tsx`, `tests/test_automacao_em_massa.py` — listados
  no despacho, não no bloco do README.
- **Não mexi** em `routers/configuracao.py` (`/config/growthhs/reenfileirar`
  devolve à fila falha de contato `datacore`; a entrega recusa de novo — só
  ruído, e some quando os contatos forem apagados) nem nos comentários
  históricos de `contatos.py`, `configuracao.py`, `SegmentFormModal.tsx`,
  `lib/contatos.ts`.

## Testes

- `tests/test_sem_datacore.py` (17) + 1 em `test_crm_entrega.py`: vermelhos
  antes, verdes depois.
- Suíte inteira no Postgres local (5444, com a 033 aplicada 2×):
  **1054 passed, 9 skipped** (7 `base_real` + 2 da 032). Saíram os 3
  arquivos de teste do DataCore e 2 casos de `test_automacao_em_massa.py`.
- `tsc` 0; `guarda:visual src/pages/admin` 0.
- Tela `/import` não conferida no navegador (mudança só de remoção de abas).

## Para a coordenadora

1. Aplicar a 033 (duas vezes, para provar):
   ```bash
   set -a; . ~/marketinghs.env; set +a
   PGPASSWORD="$POSTGRES_PASSWORD" psql \
     "postgresql://${POSTGRES_USER}@${POSTGRES_HOST_EXTERNO}:${POSTGRES_PORTA_EXTERNA}/${POSTGRES_DB}" \
     -v ON_ERROR_STOP=1 -f backend/migrations/033_crm_recusa_datacore.sql
   ```
2. Deploy de api e worker (o worker roda a entrega) e sistema (a aba).
3. Tirar `DATACORE_URL` / `DATACORE_EMAIL_DE_NOTAS` do `.env` da api e do
   worker; **depois** tirá-las de `config.py`.
4. Antes do script que apaga os 2.104: conferir segmento salvo com
   `tipo = datacore` (passa a contar zero) e campanha/jornada que o use.
5. A coluna `ecosystem_identities.datacore_cliente_id` fica sem escritor;
   pode sair numa migration futura se quiserem.
