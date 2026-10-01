# Frente `backend`

Dona única de `backend/**`: migrations, `config.py`, routers, worker, testes.
Não encosta em `frontend/`. Backend próprio na **8104**; o worker de fila
**nunca** sobe nesta frente.

## Backlog (em ordem)

- [ ] **Campanhas presas em "Enviando..."** (pergunta 7 do `CONTINUAR-AQUI`).
  As 2 de produção ("teste de webhook", 02/09) estão em `sending` sem
  `sent_at`, 1 envio cada, 0 pendentes. Diagnosticar por leitura (código do
  worker + `SELECT`) por que a campanha não fecha quando a fila drena; teste
  que reproduz; conserto no código. A correção **do dado** é script SQL que o
  Erick roda no Konsole — a frente escreve o script e para ali.
- [ ] Docstring de `backend/app/routers/landing.py:~52-57` ainda cita
  `PageFormDialog.tsx`, apagado no G5.
- [ ] **`service_role` → `authenticated` em request de usuário**, router por
  router (a regra do `CLAUDE.md`; 128 × 16 em 04/09). Primeiro medir de novo
  e escrever o plano com a ordem. Para cada rota convertida, teste que prova
  que **não zerou**: a contagem sob `authenticated` com o usuário admin bate
  com a de antes. Política admin-only → rota `admin_atual`. Rota que zera e
  não tem conserto óbvio vira pergunta, não conversão.
- [ ] Ao fim de cada router: `pytest -q`, push, marcar "pronto para merge"
  (merge por router, não no fim de tudo).

- [ ] **Rodada 2:** pré-limpeza da fixture `envio` passa a apagar também a
  campanha 'teste de webhook' que ela deixa quando o pytest morre (as 2 de
  produção já foram apagadas pelo Erick em 01/10). E, se a migration 021 for
  aplicada, `escrita_contatos.py` e `contatos.py` para `authenticated`.

## Estado

**01/10/2026 — rodada 1.** Branch `worktree-agent-a955e097afd0091b3`.
Testes: 360 antes → 387 depois (2 em `test_fila.py`, 25 em
`test_conversao_authenticated.py`).

- [x] **Campanhas presas em "Enviando..."** — *pronto para merge*.
  **Diagnóstico:** as 2 de produção NÃO são defeito do worker: são resíduo da
  fixture `envio` (`tests/conftest.py`), que cria a campanha "teste de
  webhook" em `sending` com 1 envio `sent`/`re_abc` e COMITA; duas rodadas do
  pytest morreram no meio em 02/09 (13:05 e 14:09 UTC). A pré-limpeza da
  fixture apagou o contato `a@b.c` na rodada seguinte (por isso `lead_id` é
  NULL nos envios), mas não a campanha. Nunca passaram pela fila.
  **Defeito real achado na leitura:** o `_tick` só chama o finalize para as
  campanhas do lote que processou; se o worker morre entre o commit do último
  envio e o finalize, a campanha fica em `sending` para sempre (e o
  `guard_campaign_delete` não deixa apagá-la). Conserto:
  `fila.fechar_campanhas_drenadas`, chamada pelo worker no ritmo do agendador,
  com 2 testes em `test_fila.py`.
  **O Erick roda** (Konsole, comando no cabeçalho):
  `backend/scripts/2026-10-01-limpar-campanhas-teste-webhook.sql` — apaga as 2.
  ⚠️ Rodar ANTES de subir o worker com este código: senão a varredura as fecha
  como `sent` (1 envio cada) em vez de sumirem.
- [x] **Docstring de `landing.py`** — *pronto para merge*. Não cita mais o
  `PageFormDialog` como vivo.
- [ ] **`service_role` → `authenticated`** — plano em
  `docs/superpowers/plans/2026-10-01-backend-service-role-para-authenticated.md`
  (medição 01/10: 128 × 33 nos routers). Testes em
  `backend/tests/test_conversao_authenticated.py`. Convertidos, cada um
  *pronto para merge*:
  - `templates.py` (5) — `usuario_atual` → `admin_atual`
  - `chaves.py` (4)
  - `automacoes.py` (5) — `listar` → `admin_atual`; a escrita compartilhada
    com `/publico` continua máquina quando não há usuário
  - `segmentos.py` (9) — `usuario_atual` → `admin_atual`
  - `campanhas.py` (10) — `usuario_atual` → `admin_atual`
  - `jornadas.py` (6) — leituras → `admin_atual`
  - `leitura_contatos.py` (13) — `usuario_atual` → `admin_atual`

  ⚠️ Os testes de segmentos → leitura de contatos estão num commit só, o
  último (`test(conversao): …`). Fatiar o merge antes dele leva o router sem a
  prova: o corte seguro é até o commit de chaves, até o de automações (+ o fix
  da prévia), ou a branch inteira.

  **Defeito achado no caminho (consertado):** `POST /automacoes/previa` com
  condição `created_at` (`after`, `before`, `between`) respondia **500** — o
  valor ia como texto para `$n::date`/`::timestamptz` e o asyncpg recusa. A
  tela de regras com filtro de data nunca mostrou a prévia.
  `lead_conversions` está vazia em produção: as rotas de conversão da ficha só
  provam que respondem (semear teria efeito colateral no lead real).

  **Onde parou:** os 7 acima convertidos. Faltam `escrita_contatos.py` e
  `contatos.py`, que esperam a migration 021 (ver Perguntas). O resto fica
  `service_role` por desenho (tabela sem GRANT a `authenticated`, ou rota
  sem usuário) — a tabela do plano diz por quê, router por router.

**O Erick roda:**
1. `backend/scripts/2026-10-01-limpar-campanhas-teste-webhook.sql`
2. (se aprovar a pergunta 1) `backend/migrations/021_leads_escrita_admin.sql`,
   duas vezes para provar a reaplicação.

**Achados de processo:**
- ⚠️ **Nunca duas rodadas de pytest ao mesmo tempo** contra o banco. As
  fixtures `token_admin`/`token_usuario` usam e-mail fixo e apagam o usuário
  no setup: uma rodada derruba a outra com 401. Medido hoje: 4 falsos
  vermelhos em `test_crm_caminhos.py` com outra rodada em paralelo, 23/23 verde
  sozinha. Vale também entre frentes.
- A suíte inteira leva ~28 min contra o banco remoto. **387 passed** em
  01/10 (rodada final, sozinha).
- **Travamento da suíte (achado pela coordenadora, consertado):** uma rodada
  parou 17 min em `test_automacoes_admin_cria_lista_edita_e_apaga`, em
  ep_poll, com 22 conexões abertas. Causa: `init_db()` criava pool nova a cada
  fixture e largava a anterior aberta; o pytest-asyncio abre um laço por
  teste, e pool de laço morto ficava pendurada. Conserto em
  `app/database.py`: `init_db` idempotente no mesmo laço (pool de outro laço é
  terminada e trocada) e `close_db` zera a global. Depois disso a pytest
  segura 2 conexões e a suíte fechou 387/387. Não reproduziu isolado
  (`test_conversao*.py` sozinhos passam), então é intermitente; não dá para
  afirmar se já travava na `main` — o vazamento, sim, já existia lá.
  `pytest.ini` ganhou `faulthandler_timeout = 300` (despeja a pilha se um
  teste passar de 5 min; não mata).

## Perguntas

1. **Política de escrita em `leads` para o admin** (migration 021, pronta e
   não aplicada). Sem ela, `escrita_contatos.py` e `contatos.py` não podem ir
   para `authenticated`: o UPDATE de lead afetaria 0 linhas calado. Opções:
   (a) aplicar a 021 e converter os dois routers; (b) deixá-los em
   `service_role` com `admin_atual` (como estão — seguro hoje, porque a rota
   autoriza sozinha). **Assumido: (b) até o Erick aplicar a 021.**
2. **`usuario_atual` → `admin_atual`** nas rotas convertidas. Hoje os 2
   usuários reais são admin, então ninguém perde acesso; um futuro usuário
   não-admin passa a levar 403 onde antes levava tela vazia (ou, sob
   `service_role`, a base inteira). **Assumido: `admin_atual`** — é a regra
   do `CLAUDE.md` para tabela admin-only. Se algum dia houver papel de
   leitura, é política nova no banco, não `usuario_atual`.
3. **Fixture `envio` deixa campanha para trás se o pytest morre.** A
   pré-limpeza cobre o contato e não a campanha. Acrescentar a campanha à
   pré-limpeza apagaria as 2 de produção na próxima rodada — escrita em
   produção por efeito colateral de teste. **Assumido: não mexer** até o
   script da limpeza rodar; depois disso, acrescentar é seguro.
