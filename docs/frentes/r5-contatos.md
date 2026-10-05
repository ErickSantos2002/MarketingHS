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

(vazio)

## Perguntas

(dúvida de produto: opções + a assumida, a mais segura e reversível)
