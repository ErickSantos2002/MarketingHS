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

- [ ] **Remover** da Visão Geral: cartão "Grupo WhatsApp", "Distribuição por
  Modal", filtros Modal, Faturamento, Tema de Desafio e "Só completos".
- [ ] **Remover** do Analytics: aba Desafios inteira (e a chamada a
  `/ia/analisar-desafios` que só ela usa), Perfil → Faturamento, Operacional →
  conversão por hora / tempo de campanha / insights de lançamento, Insights →
  Recomendações (não há custo por trás) e heatmap temporal; A/B → "Funil do
  agendamento" (`schedule_step`).
- [ ] **"Leads novos" vira o número principal**: cartão principal conta
  `created_at`; reconversões aparecem à parte. A meta de leads e a projeção
  passam a contar leads **novos** (`created_at`), não `last_conversion_date`.
- [ ] "Fontes" → "Por landing page". Desfazer o "Mostrar mais detalhes": origem,
  meta e qualificação ficam à vista.
- [ ] "Só reconversões" → seletor "Novos / Recorrentes / Todos".
- [ ] Tabela de prioridade e qualquer P1–P4 do painel usam o `lead_score`/
  `etiqueta` do banco, não o cálculo do navegador com o perfil da dn.ia. (A
  ficha do contato também mostra P1–P4 — anotar, não tocar: é de outra frente.)
- [ ] Insights que dependem de `desafios` (taxa de resposta, grade A, abandono,
  baixa qualidade): remover ou refazer sem `desafios`.
- [ ] Completude de dados: medir cargo, empresa, whatsapp (sem faturamento e
  desafios).
- [ ] Portão: guarda 0, `tsc` 0, `vite build`, `build:landing`. Passo 4 do
  portão do `CLAUDE.md`: listar no Estado cada capacidade que saiu e por quê
  (tudo que sair tem que estar nesta lista; nada sai por acidente). Sem conta
  admin para conferir tela — anotar as telas a conferir.

## Estado

## Perguntas
