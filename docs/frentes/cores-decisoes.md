# Frente `cores-decisoes`

Decisões do Erick de 01/10 (`docs/perguntas-abertas.md`, itens 13, 15, 16, 19).
Território: o que cada item nomeia. **Não toca** em `components/admin/contacts/`
(da `contatos-decisoes`) nem em `components/ui/` (da `primitivos-cta`).

## Backlog (em ordem)

- [ ] **#13** Texto destrutivo `text-destructive` → `text-[--on-tint-danger]` no
  app inteiro (menus "Excluir", mensagens de erro, gatilhos), **fora** de
  `contacts/` e `ui/`. Botão destrutivo cheio (`variant="destructive"`,
  `bg-danger`) não muda. Liste no Estado os de `contacts/` que ficaram, para a
  coordenadora repassar.
- [ ] **#15** Quadrado de marca do GrowthHS (`settings/GrowthHSCard.tsx`) em
  `--color-success-700`, como a pílula do GrowthHS em Contatos.
- [ ] **#16** "Descadastrou" da supressão (`settings/SuppressionList.tsx`) vira
  atenção (variante `warning`), igual ao "Descadastrado" de Campanhas.
- [ ] **#19** Permissão de API Key (`settings/ApiKeysManagement.tsx`): Leitura
  neutra (`secondary`), Escrita e Leitura + Escrita em `warning`.
- [ ] Portão: guarda 0, `tsc` 0, `vite build`, telas nos dois temas.

## Estado

## Perguntas
