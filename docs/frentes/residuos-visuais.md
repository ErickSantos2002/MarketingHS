# Frente `residuos-visuais`

Resíduos e dívidas anotados nos blocos da Fase 1 e do G1–G5 do
`CONTINUAR-AQUI.md`, todos fora de `settings/`. Aberta em 01/10, com o G6 já na `main`. Território: só os arquivos nomeados abaixo.

## Backlog (em ordem)

- [ ] `/settings` rola na horizontal a 390 px (`scrollWidth` 973): a
  `TabsList` de 7 abas de `pages/admin/SettingsPage.tsx` não quebra nem rola.
  Sugestão das frentes do G6: `overflow-x-auto` no wrapper da lista.
- [ ] Chave revelada em `settings/ApiKeysManagement.tsx`: o `<pre>` usa
  `break-all` sem `whitespace-pre-wrap` e, a 390 px, passa por baixo do "Copiar".
- [ ] `/experiments` rola na horizontal a 390 px (`scrollWidth` 424): a linha
  de botões do cabeçalho (`flex gap-2` sem quebra) em `pages/admin/Experiments.tsx`.
- [ ] `SendTestEmailPopover.tsx:73` — popover com formulário a 4 px de respiro
  desde que o primitivo foi para `p-1`. Opção segura: `p-4` **no uso**, sem
  mexer no primitivo.
- [ ] `AIDataChat.tsx:128` — gradiente banido no botão de enviar
  (`bg-gradient-to-r from-primary to-info`) → cor de ação sólida.
- [ ] `LeadsChart.tsx` é código morto e o único consumidor de `ui/chart.tsx`
  (os 5 falso-positivos do guarda). Conferir importador com busca que não
  prende aspa; sem importador, os dois saem (ficam no git).
- [ ] Os 3 erros de `tsc` pré-existentes do `useJourneys` — só se o conserto
  for de tipo, sem mudar comportamento.
- [ ] Aviso de console `Function components cannot be given refs` (`Badge`
  sem `forwardRef` dentro de `TooltipTrigger asChild`): `forwardRef` em
  `ui/badge.tsx` sem mudar nenhuma medida — `ui/` é de dono único, então
  **pedir à coordenadora antes** (anotar em Perguntas e pular se não houver resposta).
- [ ] Portão: guarda não sobe, `tsc` com menos erros, `vite build`, telas no
  navegador; push; "pronto para merge".

## Estado

## Perguntas
