# Frente `r5-contatos` ("R5 sem decisão", parte contatos, ficha e landing)

Origem: `docs/raio-x-rd.md` (R5), perguntas 42 e 50 do
`docs/perguntas-abertas.md`. Só o que **não depende** de D1 nem do R4.

Território: `frontend/src/components/admin/contacts/`,
`components/admin/LeadDetailSheet.tsx`, `hooks/useLeadQualification.tsx` e
quem o importa em `components/admin/dashboard/` (só o necessário para tirar o
P1–P4), `pages/admin/` de Contatos, `frontend/src/landing/`.
**Não tocar:** `backend/**`, `lib/journeys.ts`, `components/admin/automations/`
(são da `r5-jornadas`), `components/ui/`, `lib/api*`, `vite.config.ts`,
`package.json`. Precisou de rota nova ou mudança de backend: anota no Estado
e a coordenadora decide. **Não roda pytest** (a `r5-jornadas` roda a suíte).
Porta: Vite 8094, usa o backend 8100.

## Backlog (em ordem)

- [ ] **Uma pontuação só.** Sai a heurística P1–P4 calculada no navegador
  (`useLeadQualification`, ficha `LeadDetailSheet`, filtros de Contatos que
  usam `QualificationSegment`). Fica a pontuação que o banco já guarda
  (`leads.score`/a que o painel passou a usar no R6 parte 1 —
  conferir `components/admin/dashboard/pontuacao.ts`). Nada de dois números
  para a mesma coisa em tela nenhuma. Cuidado com o passo 4 do portão do
  `CLAUDE.md`: comparar capacidade por capacidade (`git diff` antes/depois) —
  filtro, ordenação ou coluna que dependia do P1–P4 passa a usar a pontuação
  do banco, não some.
- [ ] **"Enviar ao comercial" para qualquer etiqueta.** Hoje o
  `QualifiedBanner` só aparece com status `Lead Qualificado`; o backend
  (`POST /crm/enviar/{id}`) não restringe. O botão da ficha passa a valer para
  qualquer contato; o banner continua como destaque do qualificado.
- [ ] **Seletor Novos/Recorrentes em Contatos** (pergunta 42): trocar o
  interruptor antigo pelo mesmo seletor do painel (R6 parte 1 — ver
  `components/admin/dashboard/` e `useDashboardFilters`), mesma semântica.
- [ ] **Campo-isca no formulário da landing** (pergunta 50):
  `<input name="website">` escondido por CSS (não `type=hidden`),
  `tabindex=-1`, `autocomplete=off`, `aria-hidden`, mandado em
  `fields.website`. O servidor já descarta (R1).
- [ ] Portão: `tsc --noEmit -p tsconfig.app.json` sem erro novo, guarda 0 em
  `src`, `vite build` e `npm run build:landing`.

## Estado

**05/10 — os 4 itens feitos** (branch `worktree-agent-aba0951463642aeeb`).

Capacidade por capacidade (passo 4 do portão):

- **Uma pontuação só.** `useLeadQualification` perdeu P1–P4, "prioridade
  (pontos)", ICP por faturamento/cargo e temas do desafio (`getPriority*`,
  `getQualificationScore`, `getRevenueScore`, `getRelevantThemeScore`,
  `isICPRevenue`, `isDecisionMaker`, `priorityCounts`, `meetsICP`,
  `icpScore`). Nenhum consumidor fora da ficha os lia (conferido por grep em
  `frontend/src` e `backend/app`). Hot/Warm/Raw (`getQualificationSegment`)
  é só a `etiqueta` do banco — o fallback heurístico para `etiqueta`
  indefinida saiu (na prática nunca disparava: `etiqueta` está na lista de
  colunas do `useLeads`). Ficou `getDecisionPowerLevel` (rótulo do cargo, usado
  pelo `RoleDistribution` e pelo cartão "Decisão" da ficha).
  - Ficha: sai o badge P1–P4 do cabeçalho; os cartões "Prioridade (pontos)" e
    "Faixa" viram **"Pontuação"** (`lead_score`) e **"Etiqueta"** (Hot/Warm/Raw
    do banco), pelos helpers de `dashboard/pontuacao.ts`. A bolinha e o badge
    Hot/Warm/Raw já eram do banco e ficam.
  - Contatos: o filtro de qualificação já usava `etiqueta` (`applyFilters`);
    coluna e ordenação por `lead_score` já existiam. Nada dependia do P1–P4.
    Tooltip da chama "Hot Lead (ICP + Decisor)" → "(pela pontuação do banco)".
- **Enviar ao comercial para qualquer etiqueta.** O botão do cabeçalho da ficha
  aparece para todo contato (admin, sem card no GrowthHS) — antes só `hotlead`.
  O `QualifiedBanner` virou destaque sem botão (o mesmo botão duas vezes na
  mesma tela seria ruído); o texto aponta para o botão do topo, ou diz que já
  está no GrowthHS. Capacidade de enviar não some: está no cabeçalho.
- **Novos/Recorrentes em Contatos.** "Só reconversões" (checkbox) → seletor
  Todos/Novos/Recorrentes, igual ao `GlobalFilters`, gravando `recorrencia`
  (o `alinharRecorrencia` mantém `onlyReconversions` em espelho). O chip
  ativo mostra "Só novos"/"Só recorrentes". O ícone de recorrente da linha da
  tabela passou a usar `ehRecorrente` (mesma régua, agora uma função só).
  Ganho de capacidade: dá para filtrar só os novos.
- **Campo-isca.** `<input name="website">` dentro de `div.captura-isca`
  (`aria-hidden`, fora da tela por CSS, `tabIndex=-1`, `autoComplete=off`),
  mandado como `fields.website` por último no objeto (nada sobrescreve).

**Revisão final (requesting-code-review):** nenhum crítico. Corrigidos os dois
importantes — seletor com `flex-wrap` (a coluna "Opções" é 1/4 do painel e os
três itens passariam da borda em notebook) e a dica do banner só para admin (o
botão é admin-only) — e dois menores: botão escondido para contato apagado (o
backend dá 404), regra `.captura` única no CSS. Ficou de fora, por escolha: a
ficha mostra `lead_score` na bolinha e no cartão "Pontuação" (mesmo número,
mesma fonte — redundante, não contraditório).

**Fora do território (para a coordenadora):**
- `components/admin/dashboard/pontuacao.ts`, linhas 8–9: o comentário diz que
  a ficha e o `useLeadQualification` "ainda carregam o P1–P4" — deixou de ser
  verdade. Não editei (não importa o hook).
- `hooks/useDashboardFilters.tsx` (linhas ~38–44 e ~229–241): o espelho
  `onlyReconversions` diz que Contatos ainda o escreve; nenhuma tela escreve
  mais. Pode sair (mantendo a migração do localStorage antigo em
  `deserializeFilters`) ou só ter o comentário atualizado.
- `hooks/useLeads.tsx`: o tipo `Lead` não declara `deleted_at`, embora a coluna
  venha na leitura — a ficha usa um cast local.
- Backend (anotação, não pedido): isca preenchida por gerenciador de senha
  descarta lead real com resposta de sucesso e só um log `info`.

**Portão (05/10):** `tsc --noEmit -p tsconfig.app.json` **0 erros**; guarda
**0** em `src`; `vite build` ✅; `build:landing` ✅;
`node --test scripts/landing-caminhos.test.mjs` 3/3. pytest não rodado (regra
da frente).

✅ **Pronto para merge.**

**Telas a conferir** (sem conta admin do Claude, não conferidas no navegador):
- `/admin/contacts`: painel de filtros (seletor no bloco "Opções", largura em
  `md`), chip "Só novos"/"Só recorrentes", ícone de recorrente na linha.
- Ficha do contato (abrir um contato não `hotlead`): botão "Enviar ao
  comercial" no cabeçalho; sem badge P1–P4; cartões Pontuação/Etiqueta/Decisão;
  contato com status "Lead Qualificado" mostra o banner sem botão.
- Landing pública `/p/<slug>`: formulário sem campo visível novo, Tab pula a
  isca, envio normal grava; envio com `website` preenchido não grava.

## Perguntas

- **R5-C1 — Banner do qualificado sem botão.** Opções: (a) banner só destaque,
  botão só no cabeçalho; (b) manter o botão nos dois lugares; (c) esconder o
  do cabeçalho quando o banner aparece. **Assumida: (a)** — um botão, um lugar;
  reverter é devolver o bloco do botão ao `QualifiedBanner`.
