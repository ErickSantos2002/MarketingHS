# Frente `decisoes-0210`

Decisões do Erick de 02/10 (`docs/perguntas-abertas.md`, itens 28+29, 30 e 39).
Território: `components/admin/LeadDetailSheet.tsx`,
`components/admin/dashboard/LeadDetailModal.tsx`,
`components/admin/ColumnSelector.tsx`, `components/admin/dashboard/GlobalFilters.tsx`,
`hooks/useDashboardFilters.tsx`, `components/admin/LeadsExport.tsx` (apagar),
`pages/admin/Experiments.tsx`.

## Backlog (em ordem)

- [x] **#28+29** Funil da dn.ia: **tirar tudo** da tela. Os cartões "Tipo
  Participante" e "Presença" saem da ficha (`LeadDetailSheet`) e do modal do
  painel (`LeadDetailModal`). Conferir se `ColumnSelector`, `GlobalFilters` e
  `useDashboardFilters` ainda expõem campo do mesmo funil (participante,
  presença, tipo de participante) e tirar também. Só tela — **não** mexer em
  coluna do banco nem em rota.
- [x] **#30** Apagar `LeadsExport.tsx` (confirmar com `grep` que ninguém importa).
- [x] **#39** A/B, adicionar variante: a nova entra com a parte igual
  (`100/n`) e as existentes **encolhem na proporção** entre si — 70/30 → 47/20/33
  (arredondar e fechar a soma em 100). Variante com peso 0 continua 0
  (decisão 7). Hoje está em `Experiments.tsx` (rodada 5 da `backend`).
- [x] Portão: guarda 0, `tsc` 0, `vite build`, `build:landing`; telas tocadas
  conferidas com `scripts/conferir-telas.mjs` nos dois temas e em 390 px.
  Passo 4 do portão do `CLAUDE.md`: a ficha e o modal ainda fazem tudo o que
  faziam, menos os dois cartões. **A conferência de tela ficou pendente**
  (ver Estado).

## Estado

**Pronto para merge** — branch `worktree-agent-a8bf7fa449f86a6a5` (02/10).

- `fed6075`, #28+29 e #30: saem os cartões "Tipo Participante" (da ficha e
  do modal) e "Presença" (da ficha; o modal não tinha esse cartão). Na barra
  global saem os filtros **Presença** e **Interesse** (MTIA/Formação). Os dois
  são do mesmo funil da dn.ia que a pergunta 9 já tirou da tabela. Uma
  preferência salva (`dashboard-filters-v2`) com `presencas` ou
  `interesseEcossistema` é descartada ao carregar: um filtro ativo sem controle
  na tela esconderia contato em silêncio. O `ColumnSelector` já estava limpo
  desde a pergunta 9. `LeadsExport.tsx` foi apagado: ninguém o importava.
  Banco, rotas, `useLeads` e captura ficaram intactos.
- `b1bc1c5`, #39: `pesosComVariantNova` em `Experiments.tsx`. Casos
  conferidos: 70/30 → 47/20/33; 50/50 → 34/33/33; 100 → 50/50;
  0/100 → 0/67/33; 70/0/30 → 53/0/22/25; 99/1 → 66/1/33. A soma dá 100 em
  todos.
- Passo 4: o diff da ficha e do modal só remove as 3 linhas dos cartões; o
  resto do que as duas telas faziam continua igual.
- Portão: guarda `src` = **0**; `tsc -p tsconfig.app.json` = **0 erros**;
  `vite build` e `build:landing` ok.
- ⚠️ **A conferência de tela não foi feita.** O `conferir-telas.mjs` falhou
  no login (HTTP 500) porque não havia backend na 8100, e a frente não sobe
  backend próprio. Além disso, a ficha, o modal e o "Adicionar variante" só
  abrem por clique, então o script não os alcança nem com backend no ar. A
  conferência fica com a coordenadora depois do merge: `/` (barra de filtros
  sem Presença e Interesse), a ficha de um contato em `/contacts` e
  `/experiments/setup`.

**Fora do território (para a coordenadora):**
- `components/admin/AdminLayout.tsx:121` ainda passa `availablePresencas`
  ao `GlobalFilters`. A prop ficou opcional e é ignorada; falta apagar a linha.
- `components/admin/dashboard/overview/OverviewTab.tsx:96` ainda aplica o
  filtro `interesseEcossistema`, que agora é sempre `null` e não filtra nada.
  Falta apagar esse bloco e, depois, o campo de `DashboardFilters` e o tipo
  `InteresseFilter`.

## Perguntas

- **O filtro Interesse (MTIA/Formação) também saiu.** O backlog citava
  participante e presença, mas o Interesse é do mesmo funil: o comentário da
  pergunta 9 no `ColumnSelector` o lista junto. Assumi "tirar tudo" ao pé da
  letra. Para voltar atrás, basta reverter essa parte de `GlobalFilters.tsx`.
- **A/B com todas as variantes existentes em peso 0.** Nesse caso não há
  proporção a manter. Assumi que a nova fica com 100 e as outras continuam em
  0 (decisão 7). A alternativa seria dividir igual entre todas. Esse estado só
  aparece por edição manual dos pesos.
