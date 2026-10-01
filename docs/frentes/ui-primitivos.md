# Frente `ui-primitivos`

Dívida dos primitivos anotada na Fase 1 (`CONTINUAR-AQUI.md`, bloco "Visual —
Fase 1", seção "Dívida anotada"). `components/ui/` é de dono único: nesta
rodada, a dona é esta frente. **A API dos primitivos não muda** (nenhuma prop
nova, nenhuma variante nova) — o que pedir API nova vira pergunta.

## Backlog (em ordem)

- [x] Aviso do Radix `Missing Description or aria-describedby` no
  `DialogContent` (aparece ao abrir "Nova página", entre outros): achar os
  diálogos sem `DialogDescription` e resolver no uso (descrição real ou
  `aria-describedby={undefined}` explícito), sem mudar o visual.
- [x] Vocabulário das três listas: `select.tsx` (item marcado perdeu o fundo
  `bg-primary/10`), `command.tsx` (`CommandItem` perdeu
  `data-[selected=true]:text-accent-foreground`) e `dropdown-menu.tsx`. Deixar
  as três com o mesmo estado de item marcado/realçado, por token.
- [x] `input.tsx` perdeu as classes `file:*` ao ser reescrito: devolver por
  token (não há uso hoje; é para o primeiro `type="file"` não nascer cru).
- [x] `components/admin/AdminLayout.tsx:~119` devolve `''` para rota não mapeada (rota nova
  nasce com `<h1>` vazio): devolver um título padrão e avisar no console em dev.
- [x] Portão: guarda 0, `tsc` 0, `vite build`, telas com select/command/
  dropdown abertos (abrir lista é visualização, permitido) nos dois temas.

Fica de fora (API nova, vira pergunta): variante de largura do `Dialog`,
prop de card clicável, a mudança do `alert.tsx` default.

## Estado

**Rodada 3 (01/10/2026) — pronto para merge.** Branch
`worktree-agent-a582b1b4ee3c4f06b`, base `1a713a2`. Plano em
`docs/superpowers/plans/2026-10-01-marketinghs-ui-primitivos.md`.

- **Aviso `Missing Description`:** 15 conteúdos de diálogo (13
  `DialogContent`/`SheetContent` de tela + `CommandDialog` + sidebar
  móvel). O parágrafo do "Recalcular score" (`LeadScoringSettings`) virou
  `DialogDescription` (mesmas classes, mesmo pixel); os demais levaram
  `aria-describedby={undefined}`. Medido: o aviso aparece na main (Vite
  8080) ao abrir "Nova Página" e "Novo fluxo" e some aqui (8085), nos dois
  temas. ⚠️ `aria-describedby="<id próprio>"` **não** cala o aviso — o
  Radix confere o id do contexto.
- **Três listas:** realçado = `bg-surface-elevated text-conteudo-heading`
  (faltava no `SubTrigger`); marcado de escolha única = `bg-action-tint
  text-action` (vocabulário do item ativo do `AdminSidebar` e do `toggle`)
  no `SelectItem` e no `DropdownMenuRadioItem`; indicadores em
  `text-action`, 3,5 px. Medido no select de "Novo fluxo": marcado
  `rgb(241,249,254)`/`rgb(26,113,168)` no claro e tinta 15 %/
  `rgb(71,166,225)` no escuro; realçado em `surface-elevated`. Menu da
  linha de `/contacts` com "Editar" realçado em `surface-elevated` nos dois
  temas. O `CommandItem` não tem estado marcado no cmdk; o popover de
  segmentos abriu, mas sem segmento na base não há item para realçar.
- **`input.tsx`:** `file:border-0 file:bg-transparent file:text-sm
  file:font-medium file:text-conteudo` (as do original, cor por token).
- **`AdminLayout`:** rota fora de `TITULOS_ROTA` cai em "MarketingHS" e
  dá `console.warn` uma vez por caminho, só em dev. Hoje todas as rotas do
  `App.tsx` estão mapeadas: o ramo não aparece na tela.
- **Portão:** guarda 0, `tsc` 0 erros, `vite build` ok.

⚠️ **Achado para a coordenadora (fora do território):** ao abrir o menu da
linha de `/contacts` no Vite **8080** (main), a tela quebrou com
`Invalid hook call` / `Cannot read properties of null (reading 'useMemo')`
em `<DropdownMenu>`; no 8085, com o mesmo código, abre normal. Cara de
cache de dependência do Vite: `node_modules` é link para a checkout
principal, então todas as frentes dividem o mesmo `node_modules/.vite`, e
o Vite que sobe depois re-otimiza e deixa o anterior com dois Reacts.
Reiniciar o 8080 (ou dar `cacheDir` por porta no `vite.config.ts`, que é
de dono único) deve resolver.

## Perguntas

1. **`DropdownMenuCheckboxItem` marcado ganha fundo?** Assumido: não — só o
   indicador em `text-action`. Escolha múltipla com várias linhas tingidas
   vira ruído; a tinta fica para escolha única (select, radio). Hoje não há
   nenhum uso de `CheckboxItem` nem `RadioItem` no app.
2. **Título padrão da topbar** para rota não mapeada: assumido
   "MarketingHS" (nome do sistema). Alternativa: o rótulo do item da
   sidebar mais próximo.
