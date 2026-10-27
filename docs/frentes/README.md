# Frentes paralelas — plano em vigor (01/10/2026)

As regras gerais (modo autônomo, dono único, portas, quem faz merge) estão no
`CLAUDE.md`, seções "Modo autônomo" e "Frentes paralelas com worktree". Este
arquivo diz **quem faz o quê agora**. Só a coordenadora edita este arquivo.

> **Por que estas frentes e não as da conversa de 30/09.** A lista daquela
> conversa (redesign das 12 telas, lotes 5C, 6 e 7) estava velha: todos os
> lotes fecharam e o visual foi até o G5. O que resta de paralelizável é o
> G6 (último grupo do visual, 124 no guarda) — partido em dois por arquivo —,
> os resíduos visuais anotados nos G1–G5, e uma frente de backend que não
> encosta em `frontend/`.

## As frentes

**Estado em 27/10 (4):** aberta também `jornada-rd` (n 27): espera em dias úteis no nó `delay` e saída da jornada por status do contato (a Nutrição do RD só envia em dia útil e sai quando vira Venda). Dona de: `backend/app/jornadas/executor.py`, `backend/app/routers/jornadas*.py` (só validação de `entry_config`/nós), `frontend/src/components/admin/automations/NodeConfigDialog.tsx`, `JourneyCreateDialog.tsx`, `frontend/src/pages/admin/JourneyBuilder.tsx` (só o necessário), testes de jornada e `docs/frentes/jornada-rd.md`. NÃO toca `jornadas/saidas.py` (é da `responder-para`). Sem migration (as opções moram em `entry_config` e na config do nó).

**Estado em 27/10 (3):** `primeiro-nome` e `icone-landing` ✅ mergeadas (`ffed129`; portão local 1123 passed, node 94, `tsc` 0); templates do RD aplicados em produção (25 + 15 arquivos). Aberta `responder-para` (n 26): endereço de resposta (reply-to) dos e-mails, configurável ao lado do remetente. Dona de: `backend/app/email/resend.py`, `backend/app/worker.py` (só a chamada do envio), `backend/app/jornadas/saidas.py` (só a chamada do envio), `backend/app/routers/envio.py`, `backend/app/routers/configuracao.py` (só o bloco do remetente/Resend), `frontend/src/components/admin/settings/ResendConfigCard.tsx`, `frontend/src/lib/config.ts` (só o tipo desse bloco), testes de envio/Resend/configuração e `docs/frentes/responder-para.md`. Sem migration (segredo novo em `integration_secrets`).

**Estado em 27/10 (2):** `landing-confianca` ✅ mergeada (`2365fc3`). Virada do GrowthHS para produção feita (automação 18 de vendedor, 19–23 da volta, segredo de produção, "Usar este ambiente", jornada `Phoebus — lead para o comercial`). Templates do RD gerados (`~/marketinghs-templates-rd.sql`, ainda NÃO aplicado). Aberta `primeiro-nome` (n 24): variável `{{primeiro_nome}}` nos e-mails (os do RD usam `*|PRIMEIRO_NOME|*`). Dona de: `backend/app/email/montagem.py`, `backend/app/routers/envio.py` (só a amostra), `backend/tests/test_montagem.py`, `frontend/src/components/admin/campaigns/emailEditorConfig.ts` (só a lista de variáveis) e `docs/frentes/primeiro-nome.md`.

**Estado em 27/10:** `landing-visual` ✅ mergeada (`7508b11`). Aberta `landing-confianca` (n 23 · backend 8123 · lê o Postgres local 5434): cabeçalho com logo da H&S, rodapé da casa e três tipos de seção novos — `certificacoes`, `depoimentos`, `video` (YouTube com fachada) — para alcançar a página do Leão (contatos.healthsafety.com.br). Dona de: `frontend/src/landing/**`, `frontend/scripts/landing-*.test.mjs`, `frontend/src/components/admin/pages/SecoesEditor.tsx` e `EditoresDeSecao.tsx`, `backend/app/captura/urls.py`, `backend/app/routers/landing.py` (só a casca), `backend/tests/test_landing_*.py` e `docs/frentes/landing-confianca.md`.

**Estado em 26/10 (10):** `landing-secoes` ✅ mergeada (`29bec5d`; portão local 1064 passed, 9 skipped, node 84, `tsc` 0). Aberta `landing-visual` (n 22 · backend 8122 · lê o Postgres local 5434 da coordenadora, que tem a página `phoebus`): o Erick reprovou o visual da prévia ("dá para fazer melhor") e a 1020 px a página caía numa coluna de 375 px. Dona de: `frontend/src/landing/**`, `frontend/scripts/landing-*.test.mjs`, `backend/app/routers/landing.py` (só a casca: fonte/preconnect) e `docs/frentes/landing-visual.md`. Não mexe no editor nem no backend além disso.

**Estado em 26/10 (9):** aberta `landing-secoes` (n 21 · Vite 8101 · backend 8121 · Postgres local 5445) — spec `docs/superpowers/specs/2026-10-26-landing-secoes-design.md`: a landing ganha `secoes` (8 tipos) e o editor, para a landing do Phoebus. Dona de: `frontend/src/landing/**`, `frontend/scripts/landing-*.test.mjs`, `frontend/src/components/admin/pages/PageConfigEditor.tsx` + componentes novos de seção na mesma pasta, `backend/app/captura/urls.py`, testes de URL/landing em `backend/tests/`, o plano `docs/superpowers/plans/2026-10-26-landing-secoes.md` e `docs/frentes/landing-secoes.md`. Sem migration; não mexe em `package.json`, `components/ui/`, `lib/api*`. Não roda a suíte inteira.

**Estado em 26/10 (8):** `sem-datacore` ✅ mergeada (`67cf33b`); portão local **1054 passed, 9 skipped**, `tsc` 0. 033 NÃO aplicada; deploy de api, worker e sistema pendente. Depois: tirar `DATACORE_URL`/`DATACORE_EMAIL_DE_NOTAS` do `.env` de api e worker, e só então de `config.py`. Nenhuma frente aberta.

**Estado em 26/10 (7):** aberta `sem-datacore` (pergunta 80) — tirar a sincronização com o DataCore (rota, tela, worker se houver) e travar o envio ao CRM para `source = 'datacore'`. Dona de: `backend/app/routers/datacore.py`, `backend/app/dominio/sincronizacao_datacore.py`, `backend/app/main.py` (só o include do router), `backend/app/config.py` (só chaves DATACORE_*, se precisar), `backend/app/crm/` (só a trava), os componentes de front que chamam o DataCore, testes do DataCore/CRM e `docs/frentes/sem-datacore.md`. Testa no Postgres local (porta 5444).

**Estado em 26/10 (6):** `nota-do-vendedor` ✅ mergeada (`653c81e`); portão local **1056 passed, 9 skipped**, `tsc` 0. Sem migration; falta deploy de api e worker. Achado de segurança no HSGrowth (XSS nas notas) → `docs/pedido-hsgrowth-2026-10-26.md`. Nenhuma frente aberta.

**Estado em 26/10 (5):** aberta `nota-do-vendedor` (pergunta 79). Dona de: `backend/app/crm/entrega.py`, `backend/app/crm/growthhs.py` (montagem de descrição/bloco/nota), testes de CRM/entrega/reconversão e `docs/frentes/nota-do-vendedor.md`. Testa no Postgres local (porta 5443); não roda a suíte em produção.

**Estado em 26/10 (4):** `reconversao-dados` ✅ mergeada (`bdc428c`). Portão do integrado no Postgres local: **1038 passed, 9 skipped** (7 `base_real` + 2 da 032 já aplicada), `tsc` 0, guarda 0. 031 e 032 NÃO aplicadas em produção; deploy pendente. Nenhuma frente aberta.

**Estado em 26/10 (3):** `growthhs-perdido` ✅ mergeada (`f298f32`); portão no Postgres local: **1012 passed, 9 skipped** (7 `base_real` + 2 só sem a 032), `tsc` 0. 032 NÃO aplicada. `reconversao-dados` segue aberta.

**Estado em 26/10 (2):** aberta também `growthhs-perdido` (pergunta 74) — eventos `deal_lost` (listas 27/33, status novo "Negócio perdido") e `no_show` (lista 25, só evento) na volta do GrowthHS. Dona de: `backend/app/crm/volta.py`, `backend/app/crm/retorno.py`, a parte de `Config`/`ler_config` de `backend/app/crm/growthhs.py` (o bloco e a nota são da `reconversao-dados`), `backend/app/routers/configuracao.py` (bloco GrowthHS), `backend/app/routers/publico.py` (só o webhook), `backend/app/dominio/importacao.py` e `sincronizacao_datacore.py` (só a lista de status), `backend/app/routers/escrita_contatos.py` e `painel.py` (só o mapa de status), `backend/migrations/032_*.sql`, `frontend/src/components/admin/settings/GrowthHSCard.tsx`, `contacts/StatusBadge.tsx`, `automations/AutomationRuleForm.tsx`, `settings/ApiDocumentation.tsx` (só a lista de status), testes de volta/retorno e `docs/frentes/growthhs-perdido.md`. Não roda a suíte inteira; não aplica a 032.

**Estado em 26/10:** aberta `reconversao-dados` (pergunta 73) — guardar os campos que vieram em cada conversão e mostrá-los no card do GrowthHS e na linha do tempo, sem sobrescrever o contato. Dona de: `backend/app/captura/`, `backend/app/crm/`, `backend/migrations/031_*.sql`, `frontend/src/components/admin/contacts/EventsTimeline.tsx` (+ `frontend/src/lib/api*` se precisar de tipo), testes de captura e CRM e `docs/frentes/reconversao-dados.md`. Não roda a suíte inteira; não aplica a 031.

**Estado em 23/10 (noite):** `growthhs-ambientes` ✅ mergeada (`3b785b8`); 030 aplicada pelo Erick (2×, 4 colunas). Testes de CRM/GrowthHS + os 2 de fora que a 030 tocava: **294 passed**, banco limpo; `tsc` 0. ⚠️ **Suíte inteira NÃO rodou** (decisão do Erick, falta de tempo) — rodar antes da virada para produção. Pergunta 72 aberta. Nenhuma frente aberta.

**Estado em 23/10:** aberta `growthhs-ambientes` — spec `docs/superpowers/specs/2026-10-23-growthhs-dois-ambientes-design.md`. Dona de: `backend/app/crm/`, `backend/app/routers/publico.py` (rota do webhook), `backend/app/routers/configuracao.py` (bloco GrowthHS), `backend/app/routers/leitura_contatos.py` e `backend/app/routers/automacoes.py` (só a leitura do card id), `backend/app/main.py` (só a isenção do webhook), `backend/migrations/030_growthhs_ambientes.sql`, `frontend/src/components/admin/settings/GrowthHSCard.tsx` (+ `frontend/src/lib/api*` se precisar de tipo), testes de CRM/GrowthHS e `docs/frentes/growthhs-ambientes.md`. Não roda a suíte inteira.

**Estado em 22/10 (madrugada):** `growthhs-real` ✅ mergeada (`4a994ed`) + dois consertos da coordenadora (`b2b90ba`: webhook da volta fora do limite por IP; `05eee18`: trocar o endereço sem secret apaga o secret, descrição do card com teto de 20.000). Migration 029 aplicada. Suíte do integrado **950 passed**, banco limpo; `tsc` 0; push. Worktree da frente removida. Falta: deploy de api, worker e sistema → limpar o card 26 da prova (`~/marketinghs-growthhs-limpar-ids-da-prova.sh`) → configurar apontando para a homologação → automações da volta → prova curta. Nenhuma frente aberta.

**Estado em 22/10 (noite):** aberta `growthhs-real` — spec `docs/superpowers/specs/2026-10-22-growthhs-real-design.md`. Dona de: `backend/app/crm/`, `backend/app/routers/publico.py` (só a rota nova do webhook), um router novo se preferir, `backend/app/routers/configuracao.py` (bloco GrowthHS), `backend/migrations/029_growthhs_real.sql`, `frontend/src/components/admin/settings/GrowthHSCard.tsx`, testes de CRM, `docs/contratos/2026-09-02-…` (bloco do topo) e `docs/frentes/growthhs-real.md`. Não roda a suíte inteira (só os arquivos de teste de CRM/GrowthHS); não mexe em `config.py`.

**Estado em 22/10 (fim do dia):** `ajustes-prova` ✅ mergeada e no ar (`6550ab8`, deploy de api, worker e sistema; migration 028 aplicada). A primeira suíte deu 3 falhas: o **worker de produção reivindicava as linhas de teste** de `journey_saidas`, que os testes gravam fora da transação revertida. Consertado com `saidas.NO_DE_TESTE`, que a passada sem `somente=` nunca pega. Depois do deploy: **804 passed**, banco limpo. Nenhuma frente aberta.

**Estado em 22/10 (tarde, depois da prova):** aberta `ajustes-prova` (sobras da prova; dona da migration 028). A suíte inteira é da coordenadora.

**Estado em 22/10 (noite):** `prova-jornadas`, `prova-captura-f2` e `prova-roteiro` ✅ mergeadas; suíte única do integrado 786 passed (com `systemd-inhibit` — a máquina suspendeu à noite e congelou duas suítes paralelas por 13 h; **suíte só uma por vez e com inibidor**). Nenhuma frente aberta. Próximo: deploy + roteiro (`docs/prova-rd/roteiro.md`).

**Estado em 22/10 (tarde):** `prova-captura` Fase 1 ✅ mergeada (`e270f13`; suíte 653 passed / 0 skipped, leads 2.107 antes e depois; revisão: pode mergear). Sobras baratas para depois do merge da `prova-jornadas`: ordem de busca do lead no retorno do CRM (contrato diz lead_id→e-mail→dnia_id), `dnia_id` mal formado dá 500, lead excluído não filtrado, teto de 16 KB pelo `Content-Length`, `primeiro_toque` da visita filtrado. `prova-jornadas` em correção da revisão.

**Estado em 22/10:** `prova-telas` ✅ mergeada (T13–17 + `ErroApi` legível + tipo `allowed_emails`; revisão: pode mergear; portão depois do merge: 55 testes node, `tsc` 0, guarda 0, builds ok). ⚠️ **Não fazer deploy do `marketinghs-sistema` antes de `prova-jornadas` e `prova-captura-f1` entrarem na `main`:** sem elas o backend descarta `allowed_emails` (fluxo salvo sem modo teste, em silêncio) e a `key` do segmento por campo personalizado. Item para depois: login perde `?contato=` (`ProtectedRoute.tsx:28`).

**Estado em 21/10 (fim da noite):** `prova-captura` Fase 0 ✅ mergeada (migration 027; funções recriadas conferidas contra 026/006/001 — só as mudanças do plano; suíte 530 passed / 18 skipped, leads 2.107 antes e depois). ✅ **027 aplicada em produção pelo Erick (21/10, três provas `true`).** Próximo: Fase 1 — `prova-captura` (T2–6), `prova-jornadas` (T7–9), `prova-telas` (T13–17).

**Estado em 21/10 (noite):** `prova-landing` ✅ mergeada (Tarefas 10–12 + 2 correções de segurança + 5 da revisão; portão depois do merge: 43 testes node, `tsc` 0, guarda 0, builds ok, `dist/` sem `prova/`). `prova-captura` na Fase 0.

**Estado em 21/10 — prova de substituição do RD:** plano em
`docs/superpowers/plans/2026-10-21-prova-substituir-rd.md` (spec
`docs/superpowers/specs/2026-10-21-prova-substituir-rd-design.md`). A tabela
de frentes e territórios **é a do plano** (seção "Frentes"): `prova-captura`
(n 17, dona da migration 027), `prova-jornadas` (18), `prova-landing` (19),
`prova-telas` (14). Abertas agora: `prova-captura` (Fase 0, Tarefa 1) e
`prova-landing` (Tarefas 10–12, não depende da 027). `prova-jornadas` e
`prova-telas` abrem depois do merge da 027.

**Estado em 07/10 (noite, depois):** `conferencia-telas` ✅ mergeada; conserto do foco da ficha (CT-1) ✅ mergeado; nenhuma frente aberta.

**Estado em 07/10 (noite):** aberta `conferencia-telas` (URL do webhook do Resend na tela, Contatos no celular, `conferir-telas.mjs` abrindo painéis de leitura). Conta do Claude recriada, permanente.

**Estado em 07/10 (fim):** `faxina-r5` ✅ mergeada; nenhuma frente aberta.

**Estado em 07/10 (tarde):** aberta `faxina-r5` (sobras de R1/R5: jornada, tag sem caixa, tela do ritmo de envio, texto da documentação da API, pequenos do front).

**Estado em 07/10:** `r5-contatos` e `r5-jornadas` ✅ mergeadas; nenhuma frente aberta. Migration 026 pendente de aplicar.

**Estado em 05/10:** abertas `r5-jornadas` (backend + automações: nós mudar status/remover tag, conversão por página, `/publico/conversao` sem sobrescrever UTMs) e `r5-contatos` (pontuação única, enviar ao comercial para qualquer etiqueta, seletor Novos/Recorrentes, campo-isca da landing). Acesso ao RD e conversa com o Nicholson ainda pendentes.

**Estado em 02/10 (fim da tarde):** `consertos-urgentes` (R0), `proteger-envio` (R1) e `painel-limpeza` (R6 parte 1) mergeadas e em produção; **nenhuma frente aberta**. Próxima: "R5 sem decisão" (ver topo do `CONTINUAR-AQUI.md`).

**Estado em 02/10 (tarde) — raio-x RD:** abertas `consertos-urgentes` (R0, front+back nos arquivos dela), `proteger-envio` (R1, backend + tela de campanha; dona de migration a partir da 026), `painel-limpeza` (R6 parte 1, só painel/analytics). Plano em `docs/raio-x-rd.md`.

**Estado em 02/10 (fim do dia):** rodadas 6 e 7 mergeadas e em produção; nenhuma frente aberta. ⚠️ Sem conta admin do Claude — `conferir-telas.mjs` não loga até criar outra.

**Estado em 02/10 (manhã):** rodada 6 aberta — `decisoes-0210` (front: itens 28+29, 30, 39) e `backend` rodada 6 (item 38 + teste instável).

**Estado em 01/10:** `g6-integracoes`, `g6-cartoes` e `residuos-visuais` ✅ mergeadas (Fase 2 do visual fechada, guarda 0, `tsc` 0). `backend` rodadas 1 e 2 ✅ mergeadas; rodada 3 e `ui-primitivos` em andamento (01/10). Antes: rodada 1 ✅ mergeada (`c019839`); a rodada 2 (`escrita_contatos`, `contatos`) espera a migration 021.

| Frente | n | Vite | Backend | Território (escreve só aqui + `docs/frentes/<frente>.md`) | Quando abrir |
|---|---|---|---|---|---|
| `coordenadora` | 0 | 8080 | 8100 | `docs/frentes/README.md`, `docs/CONTINUAR-AQUI.md`, `docs/perguntas-abertas.md`, `CLAUDE.md`, merge na `main` | já (raiz do repo) |
| `g6-integracoes` | 1 | 8081 | usa a 8100 | `settings/ApiDocumentation.tsx` (38), `settings/ApiKeysManagement.tsx` (31) | já |
| `g6-cartoes` | 2 | 8082 | usa a 8100 | `settings/GrowthHSCard.tsx` (13), `SuppressionList.tsx` (12), `ResendConfigCard.tsx` (9), `LeadScoringSettings.tsx` (6), `IACard.tsx` (5), `MetaCard.tsx` (5), `SocialLinksSettings.tsx` (3), `UserManagement.tsx` (0, só conferir), `pages/admin/SettingsPage.tsx` (2) | já |
| `backend` | 4 | 8084 | **8104** | `backend/**` inteiro (é a única dona de migration, `config.py`, routers e testes) | já |
| `residuos-visuais` | 3 | 8083 | usa a 8100 | os arquivos listados no backlog dela, todos fora de `settings/` | quando uma das duas do G6 fechar |
| `ui-primitivos` | 5 | 8085 | usa a 8100 | `components/ui/` (dona única nesta rodada), os usos de `DialogContent` sem descrição, `components/admin/AdminLayout.tsx` | 01/10, rodada 3 |
| `cores-decisoes` | 6 | 8086 | usa a 8100 | ver `cores-decisoes.md` | 01/10, rodada 4 |
| `contatos-decisoes` | 7 | 8087 | usa a 8100 | `components/admin/contacts/` e a ficha | 01/10, rodada 4 |
| `primitivos-cta` | 8 | 8088 | usa a 8100 | `ui/button`, `ui/input`, `h-9` manual, CTA das landings | 01/10, rodada 4 |
| `consertos-urgentes` | 10 | 8090 | usa a 8100 | ver `consertos-urgentes.md` | 02/10, R0 |
| `proteger-envio` | 11 | 8091 | **8111** | ver `proteger-envio.md` | 02/10, R1 |
| `painel-limpeza` | 12 | 8092 | usa a 8100 | ver `painel-limpeza.md` | 02/10, R6 |
| `conferencia-telas` | 16 | 8096 | usa a 8100 | ver `conferencia-telas.md` | 07/10 |
| `faxina-r5` | 15 | 8095 | **8115** | ver `faxina-r5.md` (`backend/**` + arquivos listados) | 07/10 |
| `r5-jornadas` | 13 | 8093 | **8113** | ver `r5-jornadas.md` (`backend/**`, automações) | 05/10, R5 |
| `r5-contatos` | 14 | 8094 | usa a 8100 | ver `r5-contatos.md` (contatos, ficha, landing) | 05/10, R5 |
| `decisoes-0210` | 9 | 8089 | usa a 8100 | ver `decisoes-0210.md` (ficha, modal, filtros do painel, `Experiments.tsx`) | 02/10, rodada 6 |

Os números entre parênteses são o guarda de 01/10 (`npm run guarda:visual -- <arquivo>`).
`settings/` = `frontend/src/components/admin/settings/`.

**Quatro frentes de uma vez, no máximo.** Acima disso o merge come o ganho.
Começar com três (`g6-integracoes`, `g6-cartoes`, `backend`) e abrir a
`residuos-visuais` no lugar da primeira que fechar.

## Como uma frente roda

A coordenadora despacha cada frente como **subagente em segundo plano com
worktree própria** — sem Konsole, sem comando do Erick. A frente roda
`bash scripts/preparar-worktree.sh`, sobe o próprio Vite na porta da tabela,
trabalha o backlog do `docs/frentes/<frente>.md` em ordem, no modo autônomo do
`CLAUDE.md`, e devolve à coordenadora o nome da branch e o estado.

Abrir à mão continua possível: `claude --worktree <frente>` e pedir para ler
este arquivo e o da frente.

## Navegador

Cada frente confere tela com `scripts/conferir-telas.mjs` (Chrome próprio,
login com a conta admin do Claude feito pelo script, token reaproveitado por
1 h por causa do limite de taxa do login). O Playwright MCP fica com a
coordenadora. Regra de só leitura em produção vale em todas: nenhum clique em
ação.

## O ciclo de merge (coordenadora)

1. A frente fecha um lote (revisão final feita), faz push de `worktree-<frente>`
   e marca **"pronto para merge"** no arquivo dela.
2. A coordenadora: `git fetch && git merge --no-ff worktree-<frente>` na `main`.
3. Portão depois do merge: `npm run guarda:visual -- src` (não pode subir),
   `tsc --noEmit -p tsconfig.app.json` (sem erro novo além dos 4 conhecidos),
   `vite build` e `build:landing`; `pytest -q` se o merge tocou `backend/`.
4. Push da `main`; bloco novo no `CONTINUAR-AQUI.md`; perguntas da frente
   copiadas para `docs/perguntas-abertas.md`.
5. As outras frentes trazem a `main` com `git merge main` (nunca rebase —
   a branch já foi pushada).

**O fim do G6 é marco:** quando `g6-integracoes` e `g6-cartoes` estiverem as
duas na `main`, o guarda do app tem que dar **0**. A coordenadora roda a
revisão final do G6 inteiro (as duas metades juntas) e fecha a Fase 2.

## Riscos conhecidos deste arranjo

- **`LeadScoringSettings.tsx` tem 1 dos 4 erros de `tsc` pré-existentes**: é da
  `g6-cartoes`. Os 3 do `useJourneys` são da `residuos-visuais`.
- **Testes de backend batem no banco de produção**, em transação revertida —
  liberado pelo Erick em 01/10 (sem uso real; o banco será resetado).
- **`node_modules` e `.venv` são links para a checkout principal.** Nenhuma
  frente instala dependência; se precisar, anota e a coordenadora instala.
- `ApiDocumentation.tsx` já ensinou URL morta oito vezes: a frente mexe em
  classe, nunca em URL nem em exemplo de payload.
