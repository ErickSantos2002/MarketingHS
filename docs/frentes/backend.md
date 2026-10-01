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

- [x] **Rodada 2:** pré-limpeza da fixture `envio` passa a apagar também a
  campanha 'teste de webhook' que ela deixa quando o pytest morre (as 2 de
  produção já foram apagadas pelo Erick em 01/10). E, se a migration 021 for
  aplicada, `escrita_contatos.py` e `contatos.py` para `authenticated`.

- [x] **Rodada 3:** `test_cancelar_depois_do_2xx_ainda_grava_entregue` troca o
  `sleep` fixo por espera com prazo (falhou 1 vez com a suíte inteira, 5/5 sozinho).

- [x] **Rodada 3:** fixtures com e-mail fixo (`token_admin`, `token_usuario`)
  passam a usar e-mail único por rodada, para duas suítes poderem rodar ao
  mesmo tempo sem se derrubar — limpando o que criam, inclusive se a rodada morrer.

## Estado

**01/10/2026 — rodada 3.** Branch `worktree-agent-a220f72652ed89988`.
Testes: 396 passed + 1 failed antes (rodada 2) → **397 passed** depois (29 min 27 s, sozinha; o I5 verde). Fim: 0 usuários, 0 leads e 0 campanhas de teste no banco (leitura).
**Pronto para merge** (a branch inteira; só `backend/tests/` muda).

- [x] **Espera com prazo no I5** (`test_crm_entrega.py`). O `sleep(0.6)` fixo
  virou sondagem do pedido a cada 0,1 s até `'entregue'` ou 10 s; a asserção
  final não mudou. 3/3 verde sozinho (~9 s cada). Prova de que não afrouxou:
  com a gravação removida do `lento` (cópia temporária do arquivo, apagada),
  o teste fica vermelho depois do teto.
- [x] **E-mail único por rodada.** `token_admin` e `token_usuario` criam
  `<prefixo>-<12 hex>@exemplo.invalid` (prefixos `admin-teste-8a` /
  `usuario-teste-8c`) e apagam só o seu no teardown (`try/finally`). A
  pré-limpeza leva o que rodada morta deixou: regex ancorada nessa forma
  **e** `created_at` com mais de 2 h (nunca o usuário de uma rodada viva), mais
  os dois e-mails fixos antigos pelo nome exato. Nada fora de
  `@exemplo.invalid` casa — os admins reais e a conta do Claude não são
  alcançáveis. `_uid_admin` (`test_conversao_authenticated.py`) lê o e-mail
  do próprio token. O `lead_real` de `test_crm_caminhos.py` ganhou o mesmo
  molde: com só o conftest consertado, a prova em paralelo trocou o 401 por
  `UniqueViolation` em `leads_email_unique` (o lead comitado de uma rodada
  colide com o `_lead` da outra).
  **Prova:** `test_crm_caminhos.py` em dois processos ao mesmo tempo —
  15/15 e 15/15, duas vezes seguidas. Depois, por leitura: 0 usuários
  `@exemplo.invalid`, 0 leads de teste.

⚠️ **Duas suítes INTEIRAS ao mesmo tempo ainda não são seguras.** O que
sobrou não é e-mail de usuário (ver pergunta 6):
- fixtures que trocam **configuração global de produção** e devolvem no
  teardown — `segredo`, `segredos_resend`, `config_ab`, `config_growthhs`:
  a devolução de uma rodada apaga o estado que a outra acabou de pôr;
- a `envio` (`a@b.c`, `re_abc`, e o teardown apaga `email_events` por
  `svix_id LIKE 'msg_%'`) — presa à `segredo` de qualquer forma;
- leads de teste com e-mail fixo e COMMIT fora do conftest:
  `test_crm_entrega.py` (`lead_8d`), `test_conversao_authenticated.py`
  (`EMAILS_ESCRITA`), `test_conversao.py` (`EMAIL_E2E`), `test_ab_costura.py`.
Arquivos que só usam `conexao` (transação revertida) + `token_*` podem rodar
em paralelo.

**01/10/2026 — rodada 2.** Branch `worktree-agent-abdba54f9f6c6f44f`.
Testes: 387 antes (main, 426aab2) → **396 passed, 1 failed** depois (397 testes; 29 min, sozinha) (+1 em `test_webhook.py`,
+9 em `test_conversao_authenticated.py`). **Pronto para merge** (a branch
inteira; cada commit leva o teste dele).

- [x] **Pré-limpeza da fixture `envio`** — apaga a campanha 'teste de
  webhook' que a rodada morta deixa, com a trava do script de 01/10 (nome,
  `sending`, ≥1 envio e TODOS com `lead_id IS NULL` e `re_abc`, nada na fila;
  `failed` antes do DELETE). Roda depois do DELETE do lead `a@b.c`, que é o
  que deixa `lead_id` NULL. Teste semeia uma órfã (some) e uma de mesmo nome
  com outro `resend_email_id` (fica).
- [x] **`escrita_contatos.py` → `authenticated`** (5 de 6). Status
  individual/em lote, tags em lote, edição e exclusão; as quatro que eram
  `usuario_atual` viraram `admin_atual`. Testes conferem no banco (sob
  `service_role`) que a escrita afetou as linhas, inclusive os eventos da
  timeline, e que não-admin leva 403 nas 6 rotas.
  **`fundir_contatos` fica `service_role`:** `lead_conversions` não tem
  política de UPDATE — a reatribuição afetaria 0 linhas calada e o DELETE do
  descartado levaria as conversões pelo CASCADE. Um teste olha `pg_policies`
  e quebra quando a política existir (ver Perguntas).
- [x] **`contatos.py` → `authenticated`** (3 de 3): importação, recálculo,
  tag avulsa. O recálculo é provado numa transação revertida
  (`SQL_RECALCULO` sob `authenticated` afeta o mesmo total que
  `service_role` vê) — rodar a rota reescreveria a base de produção.
  **Defeito achado e consertado:** a importação não tinha SAVEPOINT por
  linha. Uma linha recusada pelo banco abortava a transação, as seguintes
  caíam em "current transaction is aborted" e o COMMIT virava ROLLBACK calado:
  200 e nada gravado. Reproduzido no código da `main` (NUL no nome: 0 criados,
  2 erros, a linha boa perdida) e verde com o conserto. Os contadores agora
  sobem só depois da escrita, e UPDATE que afeta 0 linhas vira erro da linha.

⚠️ **O 1 vermelho é flaky de tempo, não regressão:**
`test_crm_entrega.py::test_cancelar_depois_do_2xx_ainda_grava_entregue`
espera a gravação blindada (`sleep 0.3` + idas ao banco remoto) terminar num
`sleep(0.6)` fixo; sob a carga da suíte inteira não deu tempo (`pendente`).
Sozinho: 5/5 verde; o arquivo inteiro: 18/18. A rodada 2 não toca
`app/crm/` (o diff em `app/` é só `contatos.py` e `escrita_contatos.py`), e
o teste usa `service_role` direto, sem passar pelas rotas convertidas. Fica
como candidato a trocar o sleep fixo por espera com prazo (sondar o status
até ~5 s) — não mexido aqui.

Medição: **68 × 91** nos routers (`service_role` × `authenticated`).

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
- ⚠️ **Nunca duas rodadas de pytest ao mesmo tempo** contra o banco
  (*rodada 3: o 401 falso dos usuários acabou; o resto do risco está no
  Estado da rodada 3*). As
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

1. ✅ *Resolvida em 01/10: a 021 foi aplicada e os dois routers converteram
   na rodada 2.* **Política de escrita em `leads` para o admin** (migration 021). Sem ela, `escrita_contatos.py` e `contatos.py` não podem ir
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
3. ✅ *Resolvida na rodada 2 (as 2 de produção já tinham sido apagadas).*
   **Fixture `envio` deixa campanha para trás se o pytest morre.** A
   pré-limpeza cobre o contato e não a campanha. Acrescentar a campanha à
   pré-limpeza apagaria as 2 de produção na próxima rodada — escrita em
   produção por efeito colateral de teste. **Assumido: não mexer** até o
   script da limpeza rodar; depois disso, acrescentar é seguro.
4. **(rodada 2) Política de UPDATE admin em `lead_conversions`?** É o que
   falta para `fundir_contatos` ir para `authenticated`. Seria a migration
   022 (pequena, mesmo molde da 021). **Assumido: não escrever** — a rota já
   autoriza sozinha (`admin_atual`) e a tabela está vazia em produção; ganho
   pequeno por uma migration a mais para o Erick rodar.
5. **(rodada 2) Achado lateral, não mexido:** a fusão não reatribui
   `journey_runs` nem `crm_handoffs` (ambas ON DELETE CASCADE para `leads`) —
   apagar o descartado leva junto o histórico de jornada e de entrega ao
   comercial dele. Também `email_events`, `email_suppressions` e
   `journey_step_log` ficam com `lead_id` NULL. É anterior à conversão.
   Acrescentar as tabelas a `_TABELAS_FILHAS`? (cuidado com o índice
   `uniq_journey_runs_open`: dois runs abertos da mesma jornada colidem).
6. **(rodada 3) Serializar as fixtures de configuração global?** Para duas
   suítes inteiras rodarem juntas, `segredo`, `segredos_resend`, `config_ab`,
   `config_growthhs` (e a `envio`, que depende da `segredo`) teriam de
   segurar um `pg_advisory_lock` numa conexão própria enquanto o teste roda:
   a segunda rodada espera em vez de pisar. E os leads de e-mail fixo fora
   do conftest ganhariam o molde do `lead_real`. **Assumido: não feito** —
   fora do pedido da rodada; a regra continua "uma suíte inteira por vez".
