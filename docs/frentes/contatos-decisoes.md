# Frente `contatos-decisoes`

Decisões do Erick de 01/10 (`docs/perguntas-abertas.md`, itens 2, 3, 9).
Território: `components/admin/contacts/`, `pages/admin/` da tela de Contatos e
a ficha, os hooks/libs de status e etiqueta que só elas usam. **Não toca** em
`components/ui/` nem em `settings/`.

## Backlog (em ordem)

- [ ] **#2** Status com uma cor só: a ficha (`StatusBadge`, que hoje lê
  `getColor()` do banco) passa a usar o mesmo mapa por token da lista
  (`STATUS_COLORS`). Nenhuma escrita no banco; o hex gravado fica ignorado.
- [ ] **#3** Etiquetas: o seletor oferece só as 4 cores distinguíveis; as
  etiquetas já gravadas com roxo/verde-azulado são **mapeadas na renderização**
  para a mais próxima (sem escrever no banco). Conferir quantas existem em
  produção por leitura.
- [ ] **#9** Remover da tela de Contatos as colunas de funil herdadas da dn.ia
  (o dado fica no banco). Identificar quais são pelo `CONTINUAR-AQUI.md`
  (pergunta "Colunas de funil da dn.ia", 8E) e pelo código.
- [ ] **#13 na sua área:** `text-destructive` → `text-[--on-tint-danger]` em
  `contacts/` (o resto do app é da `cores-decisoes`).
- [ ] Portão: guarda 0, `tsc` 0, `vite build`, `/contacts` e a ficha nos dois
  temas, sem clicar ação; capacidade por capacidade no diff.

## Estado

## Perguntas
