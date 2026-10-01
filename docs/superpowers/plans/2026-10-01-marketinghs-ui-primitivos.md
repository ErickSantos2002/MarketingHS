# Frente `ui-primitivos` — plano (01/10/2026)

Backlog em `docs/frentes/ui-primitivos.md`. API dos primitivos não muda.

1. **Aviso `Missing Description` do Radix.** 15 conteúdos de diálogo sem
   descrição (`DialogContent` e `SheetContent`, que é o mesmo
   `Dialog.Content` do Radix). Onde já existe um parágrafo que *é* a
   descrição com as mesmas classes do `DialogDescription`
   (`text-sm text-muted-foreground`), ele vira `DialogDescription` — mesmo
   pixel, descrição real. Nos demais, `aria-describedby={undefined}`
   explícito (o opt-out documentado do Radix), sem texto novo.
   Atenção: `aria-describedby="<id próprio>"` **não** cala o aviso — o Radix
   confere o id do contexto, não o do atributo.
2. **Item marcado/realçado nas três listas**, por token:
   - realçado (teclado/mouse): `bg-surface-elevated text-conteudo-heading`
     — já unificado no `a4f5cbf`; completar no `SubTrigger` do menu.
   - marcado (escolha única): `bg-action-tint text-action`, o vocabulário
     do item ativo do `AdminSidebar` e do `toggle`. Devolve ao `SelectItem`
     o fundo que o `bg-primary/10` dava; vale também para o `RadioItem` do
     menu. O marcado vence o realçado (variante `data-*` vem depois de
     `focus:` no CSS), como o item ativo do menu lateral.
   - marcado múltiplo (`CheckboxItem`): só o indicador em `text-action`
     (pergunta registrada).
   - indicadores (`Check`, `Circle`): `text-action` nas três.
   - `CommandItem`: o cmdk não tem estado marcado; realçado já está.
3. **`input.tsx`** — `file:` de volta, por token.
4. **`AdminLayout`** — título padrão para rota não mapeada + `console.warn`
   em dev.
5. **Portão** — guarda 0, `tsc` sem erro novo, `vite build`, telas com as
   listas abertas nos dois temas, console sem o aviso.
