# Frente `painel-limpeza` (R6, parte 1, do `docs/raio-x-rd.md`)

Território: `frontend/src/components/admin/dashboard/**`,
`frontend/src/pages/admin/Analytics.tsx` e `components/admin/analytics/**`,
`hooks/useLeadAnalytics.tsx`, `hooks/useInsightsAnalytics.tsx`,
`hooks/useDashboardFilters.tsx`, `hooks/useGoalSettings.tsx`,
`components/admin/AdminLayout.tsx` (só o que tocar o painel),
`pages/admin/ExperimentDetail.tsx` (só o funil de agendamento),
`backend/app/ia/ferramentas.py` (só tirar `desafios_frequentes`).
**Não tocar** `lib/journeys.ts`, `landing/`, nem `backend/` além do citado.
Sem migration. Sem coluna de banco apagada — só tela.

Contexto: a H&S vende bafômetro B2B; o painel é o do funil de evento da dn.ia.
Objetivo nº 1 é **lead novo**.

## Backlog (em ordem)

- [x] **Remover** da Visão Geral: cartão "Grupo WhatsApp", "Distribuição por
  Modal", filtros Modal, Faturamento, Tema de Desafio e "Só completos".
- [x] **Remover** do Analytics: aba Desafios inteira (e a chamada a
  `/ia/analisar-desafios` que só ela usa), Perfil → Faturamento, Operacional →
  conversão por hora / tempo de campanha / insights de lançamento, Insights →
  Recomendações (não há custo por trás) e heatmap temporal; A/B → "Funil do
  agendamento" (`schedule_step`).
- [x] **"Leads novos" vira o número principal**: cartão principal conta
  `created_at`; reconversões aparecem à parte. A meta de leads e a projeção
  passam a contar leads **novos** (`created_at`), não `last_conversion_date`.
- [x] "Fontes" → "Por landing page". Desfazer o "Mostrar mais detalhes": origem,
  meta e qualificação ficam à vista.
- [x] "Só reconversões" → seletor "Novos / Recorrentes / Todos".
- [x] Tabela de prioridade e qualquer P1–P4 do painel usam o `lead_score`/
  `etiqueta` do banco, não o cálculo do navegador com o perfil da dn.ia. (A
  ficha do contato também mostra P1–P4 — anotar, não tocar: é de outra frente.)
- [x] Insights que dependem de `desafios` (taxa de resposta, grade A, abandono,
  baixa qualidade): remover ou refazer sem `desafios`.
- [x] Completude de dados: medir cargo, empresa, whatsapp (sem faturamento e
  desafios).
- [x] Portão: guarda 0, `tsc` 0, `vite build`, `build:landing`. Passo 4 do
  portão do `CLAUDE.md`: listar no Estado cada capacidade que saiu e por quê
  (tudo que sair tem que estar nesta lista; nada sai por acidente). Sem conta
  admin para conferir tela — anotar as telas a conferir.

## Estado

**Pronto para merge** (02/10/2026) — branch `worktree-agent-a22891dc97978f110`.
Backlog inteiro feito, nesta ordem de commits: `626f01e` (IA), `80991fb`
(filtros), `3919da7` (Visão Geral), `d838020` (Analytics), `7fdf151`
(Insights), `cc2eea3` (A/B), `27f4089` (prioridade), `e2358dd`
(completude) e o ajuste do número principal.

### O que saiu do painel, e por quê (passo 4 do portão)

Tudo abaixo é do funil de evento/mentoria da dn.ia; a H&S vende bafômetro
B2B e não coleta desafio, faturamento nem modal. Cada componente apagado foi
conferido com `grep` antes: nenhuma outra tela o usava.

| Onde | O que saiu | Por quê |
|---|---|---|
| Visão Geral | cartão **Grupo WhatsApp** (`WhatsAppKPICard`, `updateWhatsappGroup`) | contagem manual do grupo de evento da dn.ia. O campo `whatsapp_group` continua no tipo de `useGoalSettings` só para o PUT da meta não apagar o valor gravado |
| Visão Geral | **Distribuição por Modal** (`DistributionPieChart`, `distributionByTipo`) | "modal" é presencial/online do evento |
| Visão Geral | botão **Mostrar mais detalhes** | não saiu capacidade: origem, meta, projeção, volume diário e qualificação ficam sempre à vista |
| Filtros do painel | **Modal**, **Faturamento**, **Só completos** (controles) | dn.ia. Os três continuam no painel de Contatos (outra frente), então os campos ficam no tipo e o painel mostra o **chip** quando vêm ligados de lá |
| Filtros do painel | **Tema de Desafio** (`challengeThemes`, inteiro) | nenhuma tela oferece mais; preferência salva antiga é descartada ao carregar |
| Filtros do painel | interruptor **Só reconversões** | virou o seletor **Novos / Recorrentes / Todos** (`recorrencia`); `onlyReconversions` segue em acordo para Contatos |
| Analytics | aba **Desafios** inteira: KPIs/funil/gráfico de qualidade de resposta, temas, palavras-chave, nuvem, heatmap cargo × tema, tema × qualidade, **AI Insights** (`/ia/analisar-desafios` + histórico `/ia/insights-de-desafios` GET/POST/DELETE), top respostas, lista de leads com desafio | tudo mede o campo `desafios`. `?tab=challenges` antigo cai em Perfil |
| Analytics → Perfil | cartão **Faturamento** (`RevenueDistribution`, `distributionByFaturamento`) | pergunta de qualificação da dn.ia |
| Analytics → Perfil e Tático | completude de **Faturamento** e **Desafios** | trocada por cargo, empresa e **WhatsApp** |
| Analytics → Operacional | **Análise por Horário** e **Melhor Horário por Campanha UTM**, com o insight de horário (`HourlyConversionChart`, `CampaignTimeAnalysis`) | régua de lançamento de evento; li "insights de lançamento" como o insight desse bloco (ver Perguntas) |
| Analytics → Insights | **Taxa de Resposta**, **Campanhas Grade A**, **Alertas Críticos** (stats); alertas **Alto Abandono** e **Horário Crítico**; colunas **Resposta**, **Score** e **Grade** do ranking com a legenda A–F; **Heatmap Temporal**; **Recomendações** | resposta/abandono/nota vinham de `desafios`; recomendações ("aumentar investimento", "pausar") não têm custo por trás |
| Analytics → Insights | alerta **Baixa Qualidade** | **refeito**, não removido: virou "Poucos leads hot", pela etiqueta do banco |
| Analytics → Tático, lista e detalhe do lead | **P1–P4** e **Decisão** calculados no navegador | trocados por `lead_score` e `etiqueta` do banco (`dashboard/pontuacao.ts`) |
| Teste A/B (detalhe) | **Funil do agendamento** (`schedule_step`) | widget de agendamento de mentoria da dn.ia. Os eventos seguem na tabela de análise, filtráveis por tipo |
| Assistente de IA | ferramenta **`desafios_frequentes`** (EXECUTORES + esquema) | o modelo não a oferece mais. A **função** fica em `ferramentas.py` porque `routers/ia.py` (analisar-leads e analisar-desafios) ainda a chama |

### O que mudou de regra (não saiu, mudou o número)

- **Leads novos é o número principal**: o cartão conta `created_at`. Sem filtro
  de data, é o mesmo conjunto filtrado de antes; com filtro de data, aplica
  todos os filtros menos a data e exige cadastro no período. Reconversões
  aparecem à parte no subtítulo e na dica. Antes, com data, o cartão era
  "Conversões no Período" (`last_conversion_date`).
- **Meta, projeção e volume diário** contam leads novos (`created_at`) no
  período da meta, não mais `last_conversion_date`.
- **Insights → Hot** é `etiqueta = 'hotlead'` (Lead Scoring), não o perfil da
  dn.ia (cargo decisor + faturamento ICP).
- "Fontes" virou **Por landing page** (`leads.source` é o slug da página);
  sem página aparece "Sem página" (era "Direto").
- O painel passou a mostrar chip para **Cadastro** e **UTM Content** quando
  ligados em Contatos (antes agiam sem aparecer no painel).

### Portão

`npm run guarda:visual -- src` = 0 · `tsc --noEmit -p tsconfig.app.json` = 0 ·
`vite build` ok · `build:landing` ok · `pytest -q tests/test_ia_ferramentas.py`
16 passed (só esse arquivo, como pedido).

### Telas a conferir (sem conta admin nesta rodada)

- **`/` Visão Geral**, sem filtro e com "Últimos 7 dias": cartão "Leads novos"
  com "+ N reconversões à parte" e a dica (i); sem Grupo WhatsApp nem Modal;
  "Por landing page", Qualificação, Meta, Projeção e Volume diário à vista sem
  clicar em nada; meta mudou de número (agora `created_at`).
- **Faixa de filtros** (em `/` e `/analytics`): sem Modal, Faturamento, Tema de
  Desafio e Só completos; seletor Novos/Recorrentes/Todos com chip "Só novos"
  / "Só recorrentes"; ligar "Só reconversões" em `/contacts` e voltar ao
  painel deve marcar "Recorrentes".
- **`/analytics`** sem a aba Desafios; **`/analytics?tab=challenges`** abre
  Perfil.
- **Perfil**: completude com 3 medidores (Cargo, Empresa, WhatsApp), sem
  Faturamento.
- **Tático**: coluna "Score" (número do banco, cor pela etiqueta), Ações
  Rápidas "Leads hot / Leads warm"; clicar numa linha abre o detalhe com
  "Score N" e os cartões Score/Etiqueta.
- **Operacional**: sem a dupla de horário; o resto igual.
- **Insights**: 3 stats (Leads hot, Hot Rate, Alertas), alertas, ranking com
  Leads/Hot/Hot Rate.
- **`/experiments/:id`**: sem "Funil do agendamento"; Comportamento por
  variante logo após o relatório.

### Fora do território, anotado para a coordenadora

- **Ficha do contato** (`LeadDetailSheet`) e `useLeadQualification` ainda
  mostram/calculam P1–P4 com o perfil da dn.ia — não toquei.
- **`ContactsFilterPanel`** ainda oferece Modal, Faturamento, Só completos e o
  interruptor "Só reconversões". Os filtros são o mesmo estado do painel:
  se o painel ficar em **"Novos"**, a lista de Contatos fica filtrada sem que
  o painel de Contatos mostre isso (ele não conhece `recorrencia`). Mesma
  classe de problema que o Tema de Desafio já tinha. Conserto: o painel de
  Contatos trocar o interruptor pelo mesmo seletor (`recorrencia`).
- **Rotas órfãs no backend**: `POST /ia/analisar-desafios` e
  `GET/POST/DELETE /ia/insights-de-desafios` não têm mais quem chame no
  front; `analisar-leads` ainda manda `amostra_de_desafios` ao modelo. Não
  mexi (fora do território).
- O detalhe do lead no painel (`LeadDetailModal`) ainda **exibe** Faturamento
  e Desafios quando o contato tem — é dado do contato, não métrica; deixei.
- `PriorityLeadsTable` ainda tem ícones para `origem_campanha`
  `reconversao_070226` / `aula_070226` (campanhas da dn.ia) — inofensivo,
  não estava no backlog.

## Perguntas

1. **"Insights de lançamento" no Operacional** — li como o insight do bloco
   "Melhor Horário por Campanha UTM" (horário bom para lançar) e tirei junto
   com a análise por horário. O cartão **"Insights de Canais"** (fonte/medium
   com mais hot, concentração de canal) **ficou**. Opções: (a) ficar assim
   *(assumida — reversível, perde menos)*; (b) tirar também os Insights de
   Canais.
2. **Seletor Novos/Recorrentes vaza para Contatos** — opções: (a) a frente de
   Contatos troca o interruptor pelo mesmo seletor *(assumida como próximo
   passo; nada feito fora do território)*; (b) separar o estado do painel do
   de Contatos.
3. **Rotas `/ia/analisar-desafios` e `/ia/insights-de-desafios`** — apagar no
   backend, ou manter enquanto a tabela `challenge_insights` existir?
   *(assumido: manter, nada apagado.)*
4. **`whatsapp_group` na config `lead_goal`** — o valor segue gravado e é
   preservado no PUT. Apagar a chave fica para o reset do banco *(assumido)*.
