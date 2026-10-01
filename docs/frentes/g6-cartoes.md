# Frente `g6-cartoes`

Metade do G6 (Configurações), o último grupo da Fase 2 do visual.
Território: os cartões de `settings/` — `GrowthHSCard` (13), `SuppressionList`
(12), `ResendConfigCard` (9), `LeadScoringSettings` (6), `IACard` (5),
`MetaCard` (5), `SocialLinksSettings` (3), `UserManagement` (0) — e
`pages/admin/SettingsPage.tsx` (2). Nada mais.

## Backlog (em ordem)

- [ ] Escrever o plano no molde do G5 →
  `docs/superpowers/plans/2026-10-01-marketinghs-visual-fase-2-g6-cartoes.md`.
  Regras do "Levar para o G6" no topo do `CONTINUAR-AQUI.md`.
- [ ] `SuppressionList.tsx` sai do guarda, incluindo o "Remover" (`~261`) com
  `bg-danger text-destructive-foreground border border-danger hover:bg-danger/90`.
- [ ] `GrowthHSCard.tsx` e `ResendConfigCard.tsx` saem do guarda.
- [ ] `LeadScoringSettings.tsx` sai do guarda **e** o erro de `tsc` dele some
  (é um dos 4 pré-existentes) — só se o conserto não mudar comportamento; se
  mudar, vira pergunta.
- [ ] `IACard`, `MetaCard`, `SocialLinksSettings`, `SettingsPage` saem do
  guarda; `UserManagement` conferido na tela.
- [ ] Portão: guarda 0 em todo o território, `tsc` sem erro novo, `vite build`,
  capacidade por capacidade, telas no navegador (claro, escuro, 1440 e 390 px),
  sem clicar ação.
- [ ] Revisão final da branch + onda de conserto; push; marcar "pronto para merge".

## Estado

## Perguntas
