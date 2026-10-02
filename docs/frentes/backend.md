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

- [ ] **Rodada 4 (decisões do Erick, 01/10):**
  1. **#6** Recálculo de pontuação e sync do DataCore **não disparam**
     automação (atualizam score/dado; só evento individual dispara). Teste.
  2. **#7** A/B: peso 0 = sem tráfego (onde a escolha de variante acontece —
     achar todos os lugares). Teste.
  3. **#23+#24** Fusão de contatos: escrever a migration 022 (UPDATE admin em
     `lead_conversions`, reaplicável) **e parar** — a coordenadora mostra ao
     Erick e aplica. Em paralelo, a reatribuição de histórico na fusão
     (`journey_runs` respeitando `uniq_journey_runs_open`, `crm_handoffs`,
     `email_events`, `email_suppressions`, `journey_step_log`), com teste.
     Converter a fusão para `authenticated` só depois da 022 aplicada.
  4. **#27** Suítes inteiras em paralelo: `pg_advisory_lock` nas fixtures que
     trocam configuração global (`segredo`, `segredos_resend`, `config_ab`,
     `config_growthhs`) e e-mail único nos leads de teste fixos. Prova: duas
     suítes inteiras juntas, verdes.

- [x] **Rodada 5 (01/10):**
  1. A 022 foi APLICADA: converter a fusão de contatos para
     `sessao(role="authenticated", user_id=...)` e trocar o teste-sentinela
     `test_fusao_continua_service_role_enquanto_nao_houver_a_022` (hoje
     vermelho, de propósito) por teste que prova a fusão completa sob
     `authenticated` (todas as 15 tabelas reatribuídas, nada zerado calado).
  2. A 023 foi APLICADA: os testes de massa já rodam (17 passed em
     `test_automacao_em_massa.py` + `test_fusao_historico.py` + `test_fila.py`).
  3. `test_captura.py::pagina_sonda` limpa a identidade que cria.
  4. **Frontend, liberado para esta frente:** em
     `frontend/src/pages/admin/Experiments.tsx:~116` a variante nova nasce com
     o mesmo peso das outras (dividir igual), em vez de 0. Guarda 0, `tsc` 0,
     `vite build`.

### Rodada 6 (02/10)

- [x] **#38 (a)** Eventos órfãos: cada fixture que comita e apaga lead passa a
  apagar antes os `contact_events` e `journey_events` daquele lead. Medir
  `count(*) WHERE lead_id IS NULL` nas duas tabelas antes e depois de uma
  suíte inteira: **não pode crescer**. Não apagar órfão existente (fica para o
  reset).
- [x] Trocar o `sleep` fixo de
  `test_crm_entrega.py::test_cancelar_depois_do_2xx_ainda_grava_entregue`
  por espera com prazo (instável contra o banco remoto).

## Estado

**02/10/2026 — rodada 6.** Branch `worktree-agent-ae7504f99435361e6`
(sobre a `main` `f59e55c`). **Pronto para merge** — três commits, só em
`backend/tests/`; nenhuma migration, nenhuma escrita no banco fora do pytest.
Suíte inteira: **414 passed** (32 min 06 s, sozinha).

Contagens (leitura, `bancos`), antes → depois da suíte inteira:

| | antes | depois da suíte | depois do 3º commit |
|---|---|---|---|
| `contact_events` com `lead_id` NULL | 1.516 | **1.516** | 1.516 |
| `journey_events` com `lead_id` NULL | 0 | **0** | 0 |
| `journey_events` sem lead (`lead_id` que não existe) | 1.333 | 1.334 (+1) | 1.334 (o 3º commit fecha o vazamento; o +1 fica para o reset) |

⚠️ `journey_events.lead_id` nunca é NULL: a coluna não tem FK, então o órfão
dela é o que aponta para lead apagado — por isso a terceira linha. A rodada 5
media ~24 novos por suíte (a maior parte da fixture `envio`).

- [x] **#38 (a)** `tests/limpeza.py::apagar_leads(conn, ids)` apaga
  `journey_events` e `contact_events` do lead e depois o lead. Usado onde a
  limpeza ainda apagava só o lead: fixture `envio` (`conftest.py`, pré-limpeza
  e teardown — era ela que deixava `form_submitted` + `email_sent` +
  `email_opened/bounced/complained` a cada teste do webhook) e `chamador`
  (`test_conversao.py`). As outras fixtures que comitam (`test_ab_costura`,
  `test_api_contato`, `test_config_growthhs`, `test_crm_*`, `test_captura`,
  `_apagar_leads_de_escrita`) já levavam os eventos; `test_contato_canonico`
  roda em transação revertida. O +1 da suíte era da **fusão pela rota**
  (`test_fusao_pela_rota_sob_authenticated_leva_o_historico`): a fusão move os
  `contact_events` do descartado, mas não a cópia em `journey_events`; o teste
  agora a apaga num `finally` (rodado sozinho depois: 1.334 → 1.334). Ver a
  pergunta 10.
- [x] **Teste instável do I5.** A espera *depois* do cancelamento já sondava
  com prazo desde a rodada 3; sobrava o `sleep(0.1)` fixo *antes* do
  `cancel()` (e um laço sem teto esperando a chamada HTTP). Agora um
  `asyncio.Event` marca a entrada na gravação blindada e o teste espera por ele
  com `wait_for(..., 30)`: o cancelamento cai dentro do `shield` sem aposta de
  tempo. 30 passed em `test_crm_entrega.py` + `test_conversao.py`.

**01/10/2026 — rodada 5.** Branch `worktree-agent-a28feaefa626c683f`.
Testes: main 1c4246d tinha 1 vermelho de propósito (o sentinela da 022) →
**414 passed, 0 skipped** (31 min 54 s, sozinha; +3 testes: 2 da fusão
nos dois papéis, 1 de leitura do código da rota; o sentinela saiu; os 2 que
ficavam pulados até a 023 agora rodam).
Fim (leitura): 0 usuários `@exemplo.invalid`, 0 leads, identidades,
campanhas, etiquetas, segmentos, páginas e testes A/B de teste, 0 pedidos ao
comercial órfãos, 0 travas. Eventos órfãos: 1.492 → **1.516** com esta
suíte (+24, de outras fixtures — Perguntas 9).
**Pronto para merge** (a branch inteira; um commit por item, cada um com o
teste dele).

- [x] **1. Fusão de contatos → `authenticated`.** `fundir_contatos` abre a
  sessão como o admin que chamou (`sessao(role="authenticated",
  user_id=admin.id)`), nos três casos. Conferido antes no banco (leitura):
  as 16 tabelas que a fusão toca têm RLS ligado, GRANT a `authenticated` e
  política admin para o que ela faz (SELECT/UPDATE, DELETE em `leads`,
  `lead_tags`, `segment_contacts`, `crm_handoffs`); `merge_identities` é
  SECURITY DEFINER e executável por `authenticated`.
  **Testes:** `test_fusao_historico.py` roda nos dois papéis (4, eram 2) —
  sob `authenticated` com um admin real de `user_roles`, voltando a
  `service_role` para conferir. A semeadura passou a cobrir as **15** tabelas
  (+ etiqueta, segmento e nota, com uma repetida de cada) e o teste exige
  `movidos[t] >= 1` em cada uma — sob `authenticated`, 0 ali é a política
  que falta, não ausência de histórico; e `len(runs) == 4` (o CASCADE não
  levou nenhum). Prova de que morde: com um `user_id` sem papel admin, os
  dois testes `authenticated` ficam vermelhos. O sentinela
  `test_fusao_continua_service_role_enquanto_nao_houver_a_022` saiu; no lugar,
  `test_fusao_pela_rota_sob_authenticated_leva_o_historico` (pela rota,
  comitando: nota, conversão e pedido ao comercial — este nasce `entregue`,
  que o worker de produção não pega — chegam ao mantido) e
  `test_fusao_roda_como_authenticated` (lê o código: o primeiro passaria
  também sob `service_role`).
- [x] **2. Testes de massa com a 023.** Já rodavam (17 passed). O que
  mudou: o `skip` "023 não aplicada" virou **asserção** — com a 023 no
  banco, um pulo calado esconderia um banco recriado sem ela ou uma função de
  gatilho reescrita por cima. Os três arquivos: 19 passed (17 + 2 da fusão
  nos dois papéis). Docstring de `app/dominio/automacao.py` atualizada.
- [x] **3. `pagina_sonda` limpa o que cria.** O `limpar()` (antes e depois)
  leva, além de lead/página/tag, a **identidade** (pelo e-mail da sonda, ou
  pelo telefone inventado `+5585999991234` sem e-mail de fora de
  `exemplo.invalid`), os `contact_events` do lead e da identidade (ON DELETE
  SET NULL: ficavam órfãos) e a cópia em `journey_events` (sem FK). Mesmo
  molde de `_apagar_leads_de_escrita`. ⚠️ A identidade de 21/09 era **a
  mesma** que a captura reaproveita pelo telefone, então ela saiu na primeira
  rodada, com os 20 eventos órfãos dela — a pergunta 37 dizia "fica para o
  reset", mas não há como o teste limpar o que cria sem levá-la.
  23 passed em `test_captura.py`.
- [x] **4. Variante nova divide igual** (`frontend/src/pages/admin/Experiments.tsx`).
  `dividirIgual(n)`: pesos iguais somando 100, o resto nas primeiras
  (2 → 50/50, 3 → 34/33/33, 6 → 17/17/17/17/16/16 — conferido executando a
  função extraída do arquivo, de 2 a 6). Ao acrescentar, TODAS as variantes
  passam a esse peso (inclusive um 70/30 que o admin tinha posto —
  "dividir igual" é isso). Remover não mexe (peso é relativo). Sem
  navegador (o diálogo é ação). Guarda `src` **0**, `tsc` **0**,
  `vite build` ok. Sem teste unitário: o frontend não tem executor de teste
  (`package.json` não é desta frente).

**01/10/2026 — rodada 4.** Branch `worktree-agent-ac6eb5bc3dba1b0d4`.
Testes: **397 passed** antes (main 6a4d3fa, sozinha, 29 min) → **409 passed,
2 skipped** depois (+14 testes: 7 da decisão 6, dos quais 2 pulados até a
023; 2 da fusão; 5 do A/B — 3 pela rota, 3 de domínio no lugar do que fixava
"0 vale 1"). **Prova da decisão
27: duas suítes INTEIRAS ao mesmo tempo, cada uma com log próprio — as duas
409 passed, 2 skipped** (57 min 54 s e 58 min 02 s; durante a rodada, em
`pg_locks`, uma trava concedida e a outra esperando). Elas andam quase em
série — a maior parte dos testes comita —, então juntas não são mais rápidas
que uma depois da outra: o ganho é não derrubar uma à outra.
Fim (leitura): 0 usuários `@exemplo.invalid`, 0 leads de teste, 0 campanhas,
regras, pedidos ao comercial, testes A/B, eventos de e-mail e supressões de
teste, 0 travas abertas. Restos ANTIGOS, não desta rodada: 1 identidade
`sonda-captura` (21/09, Perguntas 8) e 2 chaves de API `teste 8B
leitura/escrita` (23/09).
**Pronto para merge** (a branch inteira). **O Erick roda:** a 022 e a 023
(cada uma duas vezes). Depois da 022, a fusão vai para `authenticated` (não
feito: sem aviso de que foi aplicada).

- [x] **#6 Operação em massa não dispara automação.** Os caminhos achados:
  1. recálculo (`UPDATE leads SET cargo = cargo`) → `trg_score_lead_on_change`
     muda etiqueta/pontuação → `trg_automation_on_etiqueta_change` → INSERT
     em `crm_handoffs` (regra);
  2. sincronização do DataCore, UPDATE em lote (`source = 'datacore'`) → o
     mesmo par de gatilhos;
  3. sincronização do DataCore, INSERT de lead novo → o gatilho de automação
     (todo INSERT avalia) **e** `fn_lead_insert_event` → `contact_events`
     `form_submitted` → `trg_contact_event_journey` → `journey_events` →
     matrícula em fluxo que entra por evento (com nó `handoff_growthhs`, é
     entrega ao comercial também).

  A automação mora em gatilho do banco, então a exceção também: a transação
  em massa se marca com `SET LOCAL marketinghs.sem_automacao = 'on'`
  (`app/dominio/automacao.py`, chamado só por `contatos.recalcular` e
  `sincronizacao_datacore.sincronizar` — um teste lê o código e quebra se
  outro lugar marcar) e as duas funções de gatilho saem cedo com a marca:
  **`backend/migrations/023_operacao_em_massa_nao_dispara_automacao.sql`,
  NÃO aplicada** — o Erick roda (duas vezes, para provar a reaplicação). As
  funções são as do banco (conferido: o corpo vivo é o da 020), cada uma com
  uma guarda a mais e nada mais. `contact_events` continua gravado — a linha
  do tempo não perde o "capturado via datacore"; só a cópia para a fila de
  jornada não é feita. Antes da 023 a marca é inerte (nenhum risco agora:
  0 regras de automação em produção).
  **Testes** (`tests/test_automacao_em_massa.py`): captura e mudança manual
  de status continuam enfileirando (verde hoje); recálculo e sincronização
  não enfileiram nem matriculam (**pulados até a 023**, com o motivo). Prova
  de que o teste morde: sem o `skip`, os dois ficam vermelhos hoje
  (`assert 1 == 0` — o pedido nasce). Também: a marca morre com a
  transação (conexão volta limpa ao pool).
  ⚠️ **Não muda:** a matrícula por SEGMENTO (bloco A do worker) olha o estado
  do contato, não o evento — contato que o recálculo põe num segmento entra
  no fluxo dele no próximo tick, como se tivesse sido editado à mão (ver
  Perguntas 7). A importação de CSV e o status **em lote** continuam
  disparando: são manuais (decisão diz "mudança manual de status").

- [x] **#7 A/B: peso 0 = sem tráfego.** Onde a variante é escolhida: **só**
  `backend/app/ab/dominio.py` (`sortear`), chamado só por
  `backend/app/routers/ab_publico.py` (`_decidir`, o `/publico/ab/go`). Fora
  do `backend/` ninguém sorteia: `frontend/public/ab.js` só coleta evento;
  `Experiments.tsx`/`ExperimentDetail.tsx`/`abStats.ts` editam e mostram peso,
  não escolhem. Regras: peso numérico ≤ 0 → nunca sai no sorteio; peso
  ausente ou não numérico continua valendo 1 (variante gravada antes do
  campo; não pediu zero); **todas zeradas → controle** (como no pausado);
  visitante com **cookie de variante zerada é sorteado de novo** (zerar no
  meio do teste tira o tráfego de quem já passou lá; o `ab_assignments`
  guarda o first-touch, ON CONFLICT DO NOTHING). Testes: `test_ab_dominio.py`
  (3, troca o que fixava "0 vale 1") e `test_ab_publico.py` (3, pela rota).
  ⚠️ Para a coordenadora (frontend, não mexido): a variante NOVA nasce com
  peso 0 em `frontend/src/pages/admin/Experiments.tsx:116` — agora isso quer
  dizer "sem tráfego até alguém pôr peso". Antes recebia como peso 1.

- [x] **#23+24 Fusão leva todo o histórico.** `fundir_contatos` (caso 1)
  virou `fundir_leads(conn, manter, descartar)` e `_TABELAS_FILHAS` cresceu de
  6 para 15: + `journey_runs`, `journey_step_log`, `crm_handoffs`,
  `email_events`, `email_suppressions`, `email_send_queue` (o link de
  descadastro sai do `lead_id` dela), `email_send_dead`, `ab_events`,
  `ab_identities`. **Regra das colisões — o mantido ganha** (`_preparar_unicos`):
  - `uniq_journey_runs_open`: run ABERTO do descartado num fluxo em que o
    mantido também está aberto é **encerrado** (`exited`, contexto
    `encerrado_por: fusao`, lease limpo) e depois reatribuído. Nada se apaga;
    o contato não anda duas vezes no mesmo fluxo nem recebe o e-mail do mesmo
    nó duas vezes; o run do mantido segue intacto.
  - `uniq_crm_handoffs_pendente`: o PENDENTE do descartado sai quando o
    mantido já tem pendente da mesma ação (é o mesmo pedido; o gatilho faz o
    mesmo com ON CONFLICT DO NOTHING). Entregue/falhou vão inteiros.
  - **Defeito achado e consertado:** `uniq_campaign_sends_email_campaign_lead`
    (intocável) derrubava a fusão com **500** quando os dois tinham recebido a
    mesma campanha — o caso comum de cadastro duplicado. Agora o envio do
    descartado nessa campanha não é movido e fica com `lead_id` NULL pelo
    ON DELETE SET NULL; o resto vai.
  - Fora, de propósito: `journey_events` (fila de trânsito, consumida a cada
    tick, sem GRANT a `authenticated`).
  Testes: `tests/test_fusao_historico.py` (2, em transação revertida, chamando
  o mesmo `fundir_leads`). Com a lista antiga de 6 tabelas o teste fica
  vermelho (conferido). Resposta da rota: `movidos` continua; ganhou
  `resolvidos` (o frontend só lê `caso`).

  **Migration 022 — `backend/migrations/022_fusao_de_contatos_admin.sql`,
  NÃO aplicada** (a coordenadora mostra ao Erick). Não é só
  `lead_conversions`: com o histórico inteiro, a fusão sob `authenticated`
  precisa de política de UPDATE admin em `lead_conversions`, `journey_runs`,
  `journey_step_log`, `email_events` (RLS sem política de UPDATE = 0 linhas
  calado) e, nas três tabelas de máquina sem GRANT nenhum a `authenticated`
  (`crm_handoffs`, `email_send_queue`, `email_send_dead`), **RLS ligado +
  política admin + GRANT** (SELECT/UPDATE; DELETE só em `crm_handoffs`). O RLS
  vem antes do GRANT para não abrir a tabela a qualquer logado. Não afeta
  `service_role` nem `leitura` (BYPASSRLS) nem os gatilhos (SECURITY DEFINER
  de dono superusuário). Reaplicável.
  **A conversão da fusão para `authenticated` NÃO foi feita** — espera a 022
  aplicada. O sentinela `test_fusao_continua_service_role_enquanto_nao_houver_a_022`
  quebra quando ela estiver: aí troca o papel na rota e roda
  `test_fusao_historico.py` sob `authenticated`.

- [x] **#27 Duas suítes inteiras ao mesmo tempo.** Antes de mexer, um
  levantamento (subagente, só leitura) de tudo o que uma rodada comita e a
  outra vê achou bem mais que as 4 fixtures: limpeza por prefixo (`limpar_ab`
  `teste-8c%`, tags `api-teste-8b%`, campanhas/segmentos/fluxos
  `teste-conversao-authenticated%`), contagem da tabela inteira
  (`test_conversao_authenticated`: templates, regras, campanhas, prévia de
  segmento, recálculo), o `reenfileirar` de TODAS as falhas
  (`test_config_growthhs`), página/slug/tag fixos (`test_captura`), o
  `_algum_admin` que pegaria o admin efêmero da outra rodada. E-mail único
  sozinho não cobre isso. Por isso a trava ficou **mais larga que as 4
  fixtures** (as 4 estão dentro):
  - `tests/conftest.py`: `pg_advisory_lock(7270010027)` numa conexão própria
    (thread + laço próprios, uma por processo), tomada por fixture autouse
    **antes de qualquer outra** e solta depois da última. Trava o teste que
    usa fixture que comita (`cliente`, `envio`, `segredo`, `segredos_resend`,
    `config_ab`, `config_growthhs`, `limpar_ab`, `chave_de`, `token_admin`,
    `token_usuario`, em cadeia), todo teste assíncrono sem `conexao` (pode
    comitar por `db.sessao` direto — `lead_8d`, `pagina_sonda`…) e o marcado
    `@pytest.mark.trava_global` (usa só `conexao` mas lê estado comitado:
    `test_fila.py` inteiro, `test_acha_por_telefone_normalizado`,
    `test_nexus_config_saiu…`, o recálculo da decisão 6). O que só usa
    `conexao` anda livre. Processo morto solta a trava junto com a conexão.
  - **E-mail único** (`tests/rodada.py`, molde do `lead_real`): `lead_8d` e
    `gemeo` (`test_crm_entrega.py`), `EMAILS_ESCRITA`, `EMAIL_E2E`,
    `EMAIL_AB` (`test_ab_costura.py`) e o contato da `envio` (era `a@b.c`;
    os corpos do webhook usam `rodada.ENVIO`). Limpeza: o desta rodada, o
    fixo antigo, e o de rodada morta (forma exata + > 2 h).
  - **Defeito achado (consertado):** o teardown da `envio` fazia
    `DELETE FROM email_events WHERE svix_id LIKE 'msg_%'` — o Svix de verdade
    também usa `msg_`: em produção ele apagaria os eventos reais de e-mail.
    Agora só os dos testes (`resend_email_id` `re_abc`/`re_x`, inventados).
  - Resíduo antigo achado na leitura, não mexido: 1 identidade
    `sonda-captura@exemplo.invalid` (+5585999991234), de 21/09 — a
    `pagina_sonda` de `test_captura.py` cria a identidade pelo telefone e
    nunca a apaga (ver Perguntas 8).

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
7. **(rodada 4) Recálculo que põe contato num SEGMENTO de jornada.** A
   decisão 6 cala regra e fluxo por evento; o fluxo que entra por segmento
   olha o estado, e o recálculo muda o estado. Calar também esse caminho
   exigiria marcar o contato ("mudou por recálculo") e o segmento ignorar a
   marca — invasivo e com pergunta própria (até quando vale a marca?).
   **Assumido: não mexido.** Hoje (leitura, 01/10): 1 fluxo por segmento,
   em rascunho; nenhum ativo — o caso não acontece ainda.
8. **(rodada 4) A `pagina_sonda` (`test_captura.py`) vaza identidade.** A
   captura cria `ecosystem_identities` pelo telefone fixo, e a fixture não a
   apaga: há uma de 21/09 no banco. Apagar a identidade no teardown (e a
   que está lá) é escrita de limpeza — **assumido: não feito nesta rodada**
   (fora do backlog; a trava já impede que ela atrapalhe a outra rodada).
9. **(rodada 5) Eventos órfãos de teste em produção.** Medido em 01/10
   (leitura): **1.492** `contact_events` com `lead_id` NULL (`form_submitted`
   626, `email_sent` 475, `email_opened` 196, `email_bounced` 129,
   `email_complained` 64…, de 01/09 a hoje) e **1.307** `journey_events` sem
   lead (1.516 depois da suíte final: cada rodada inteira deixa ~24). É o padrão que a `pagina_sonda` tinha (rodada 5) espalhado por
   outras fixtures que comitam: apagam o lead e o evento fica (ON DELETE SET
   NULL; `journey_events` sem FK). Contam no painel/linha do tempo? A
   timeline é por lead, então não aparecem lá; contagens globais de evento,
   sim. **Assumido: não mexido** — fora do backlog, e apagar por `lead_id IS
   NULL` levaria evento real de contato apagado. Opções: (a) cada fixture
   leva os eventos do lead antes de apagá-lo (molde de
   `_apagar_leads_de_escrita`); (b) deixar para o reset do banco.
   *Rodada 6 (02/10): feito (a) — ver Estado. Os órfãos existentes ficam.*
10. **(rodada 6) A fusão não move a cópia em `journey_events`.** Em
    produção, fundir dois contatos deixa o `journey_events` do descartado
    apontando para lead apagado (sem FK). Se o worker de jornada pegar esse
    evento ainda pendente, ele roda para lead nenhum (ou falha). Opções:
    (a) a fusão apaga o `journey_events` do descartado; (b) a fusão o move
    para o mantido — mas aí o mantido pode disparar automação pelo evento do
    outro (ex.: `form_submitted` de novo); (c) deixar. **Assumido: (c), só o
    teste limpa** — mudar a fusão é decisão de produto, e (a) é a mais
    segura se o Erick quiser.
