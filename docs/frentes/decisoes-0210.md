# Frente `decisoes-0210`

Decisões do Erick de 02/10 (`docs/perguntas-abertas.md`, itens 28+29, 30 e 39).
Território: `components/admin/LeadDetailSheet.tsx`,
`components/admin/dashboard/LeadDetailModal.tsx`,
`components/admin/ColumnSelector.tsx`, `components/admin/dashboard/GlobalFilters.tsx`,
`hooks/useDashboardFilters.tsx`, `components/admin/LeadsExport.tsx` (apagar),
`pages/admin/Experiments.tsx`.

## Backlog (em ordem)

- [ ] **#28+29** Funil da dn.ia: **tirar tudo** da tela. Os cartões "Tipo
  Participante" e "Presença" saem da ficha (`LeadDetailSheet`) e do modal do
  painel (`LeadDetailModal`). Conferir se `ColumnSelector`, `GlobalFilters` e
  `useDashboardFilters` ainda expõem campo do mesmo funil (participante,
  presença, tipo de participante) e tirar também. Só tela — **não** mexer em
  coluna do banco nem em rota.
- [ ] **#30** Apagar `LeadsExport.tsx` (confirmar com `grep` que ninguém importa).
- [ ] **#39** A/B, adicionar variante: a nova entra com a parte igual
  (`100/n`) e as existentes **encolhem na proporção** entre si — 70/30 → 47/20/33
  (arredondar e fechar a soma em 100). Variante com peso 0 continua 0
  (decisão 7). Hoje está em `Experiments.tsx` (rodada 5 da `backend`).
- [ ] Portão: guarda 0, `tsc` 0, `vite build`, `build:landing`; telas tocadas
  conferidas com `scripts/conferir-telas.mjs` nos dois temas e em 390 px.
  Passo 4 do portão do `CLAUDE.md`: a ficha e o modal ainda fazem tudo o que
  faziam, menos os dois cartões.

## Estado

## Perguntas
