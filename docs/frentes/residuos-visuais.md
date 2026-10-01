# Frente `residuos-visuais`

Resíduos e dívidas anotados nos blocos da Fase 1 e do G1–G5 do
`CONTINUAR-AQUI.md`, todos fora de `settings/`. Aberta em 01/10, com o G6 já na `main`. Território: só os arquivos nomeados abaixo.

## Backlog (em ordem)

- [x] `/settings` rola na horizontal a 390 px (`scrollWidth` 973): a
  `TabsList` de 7 abas de `pages/admin/SettingsPage.tsx` não quebra nem rola.
  Sugestão das frentes do G6: `overflow-x-auto` no wrapper da lista.
- [x] Chave revelada em `settings/ApiKeysManagement.tsx`: o `<pre>` usa
  `break-all` sem `whitespace-pre-wrap` e, a 390 px, passa por baixo do "Copiar".
- [x] `/experiments` rola na horizontal a 390 px (`scrollWidth` 424): a linha
  de botões do cabeçalho (`flex gap-2` sem quebra) em `pages/admin/Experiments.tsx`.
- [x] `SendTestEmailPopover.tsx:73` — popover com formulário a 4 px de respiro
  desde que o primitivo foi para `p-1`. Opção segura: `p-4` **no uso**, sem
  mexer no primitivo.
- [x] `AIDataChat.tsx:128` — gradiente banido no botão de enviar
  (`bg-gradient-to-r from-primary to-info`) → cor de ação sólida.
- [x] `LeadsChart.tsx` é código morto e o único consumidor de `ui/chart.tsx`
  (os 5 falso-positivos do guarda). Conferir importador com busca que não
  prende aspa; sem importador, os dois saem (ficam no git).
- [x] Os 3 erros de `tsc` pré-existentes do `useJourneys` — só se o conserto
  for de tipo, sem mudar comportamento.
- [x] Aviso de console `Function components cannot be given refs` (`Badge`
  sem `forwardRef` dentro de `TooltipTrigger asChild`): `forwardRef` em
  `ui/badge.tsx` sem mudar nenhuma medida — `ui/` é de dono único, então
  **pedir à coordenadora antes** (anotar em Perguntas e pular se não houver resposta).
- [x] Itens da revisão final do G6 (pedidos pela coordenadora em 01/10):
  lixeira do `UserManagement.tsx` em `on-tint-danger` como o "Revogar";
  `text-destructive` → `text-[--on-tint-danger]` em `ResendConfigCard.tsx`
  (3), `GrowthHSCard.tsx`, `LeadScoringSettings.tsx`; `ApiDocumentation.tsx`
  sem `h-4`/`text-xs` nos 3 `<Badge>`.
- [x] Portão: guarda não sobe, `tsc` com menos erros, `vite build`, telas no
  navegador; push; "pronto para merge".

## Estado

**Pronto para merge** (01/10). Branch `worktree-agent-aee8d7b216692e6da`,
com `origin/main` (524ef74) já mergeada.

Commits:
- `7a69b8d` — `/settings` e `/experiments` sem rolagem horizontal a 390 px;
  chave revelada quebra linha.
- `dee0d54` — os 3 erros de `tsc` do `useJourneys` (só tipo).
- `0e712b1` — resíduos da revisão final do G6.

O que foi feito, item a item:
- `/settings`: eram **duas** causas, não uma. A `TabsList` foi para um
  wrapper `overflow-x-auto` (973 → 461), e a grade das integrações
  (`grid gap-4`) tinha track `auto`, que toma o min-content do cartão mais
  largo — virou `grid grid-cols-1` (`minmax(0,1fr)`): 461 → **390**. As 7 abas
  medidas a 390 px: todas em 390, nenhum elemento passando da janela.
- `ApiKeysManagement`: `whitespace-pre-wrap` no `<pre>`. **Não visto no
  navegador**: o diálogo só abre ao criar uma chave, que é ação. É o mesmo
  par `whitespace-pre-wrap break-all` com o `pr-20` que já existia.
- `/experiments`: `flex-wrap` na linha de botões: 424 → **390**.
- Popover de teste (`p-4` no uso), botão do `AIDataChat` sólido, `LeadsChart` e
  `ui/chart.tsx` apagados, `forwardRef` no `Badge`: **já estavam na `main`**
  (commits `a4f5cbf`, `6eaeef7`, `f614aa2`, `08b0cb2`). Nada a fazer; conferido
  no código.
- `useJourneys`: cast via `unknown` em criar/editar e `runs` como
  `Partial<ContagemDeExecucoes>` (o consumidor, `JourneyBuilder`, não lê
  `runs`). Nenhuma linha que executa mudou.

Portão: guarda `src` **0**; `tsc` **3 → 0** neste checkout (o erro do
`LeadScoringSettings` já não existia na base); `vite build` ok. Telas vistas
com `conferir-telas.mjs` e com um script de medida só de leitura
(`/settings` nas 7 abas a 390 px; aba Documentação a 1440 px com os badges).

Resíduo: a lixeira do `UserManagement` não apareceu na captura (lista ainda
carregando); a classe é a mesma string do "Revogar" das API Keys.

## Perguntas
