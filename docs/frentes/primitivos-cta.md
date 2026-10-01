# Frente `primitivos-cta`

Decisões do Erick de 01/10 (`docs/perguntas-abertas.md`, itens 4 e 10).
Território: `components/ui/button.tsx`, `components/ui/input.tsx` (e
`select`/`textarea` se forem controle de uma linha), os usos de `h-9` manual
em botão/campo **fora** de `contacts/` e `settings/` e dos arquivos da
`cores-decisoes`, `src/landing/padroes.ts`, o editor de página e o ponto da
landing que usa `#1e3a5f`.

## Backlog (em ordem)

- [x] **#4** Botão (tamanho padrão) e campo com `h-9` (36 px) no primitivo.
  Depois, tirar o `h-9` manual que as telas passavam para emparelhar — só onde
  ele era a muleta (botão/campo de tamanho padrão). Medir antes/depois nas
  telas com botão ao lado de campo. Em `contacts/` e `settings/`, só anotar no
  Estado (outras frentes estão lá).
- [x] **#10** Cor padrão do botão das landings: uma constante só, o azul
  primário da marca, em `src/landing/padroes.ts` (`COR_CTA_PADRAO`), lida pelo
  editor **e** pela landing (que hoje cai em `#1e3a5f`). A landing pública é
  exceção da regra de token (hex permitido lá). Páginas já gravadas com cor
  própria não mudam.
- [x] Portão: guarda 0, `tsc` 0, `vite build`, `build:landing`, telas nos dois
  temas e 390 px.

## Estado

**01/10 — pronto para merge.** Branch `worktree-agent-a65fd1de70c679ea7`,
com `origin/main` trazida (merge, sem rebase).

- **#4 (`fd3b643`, `daa4932`).** `ui/button` (tamanho `default`), `ui/input`
  e `ui/select` (`SelectTrigger`) com `h-9`; campo e select em `py-1.5`
  (a linha de 20 px cabe), botão sem `py` (altura fixa + `items-center`).
  `textarea` fica — não é controle de uma linha.
  - **Medida antes → depois** (1440 px, 12 rotas, script próprio):
    botão padrão **38 → 36**, campo **38 → 36**, select **38 → 36**. O
    "35,5 px" do `CONTINUAR-AQUI` não valia mais: o `text-sm` do tamanho
    apaga o `leading-tight` da base no `twMerge`, e o botão já media 38.
    Pares botão×campo lado a lado: `/pages` busca 38 × "Testes A/B" 36 →
    **36 × 36**; `/settings` "Testar chave"/"Gerar" 38 × 38 → **36 × 36**,
    URL pública + copiar 34 × 34 → 36 × 36; `/contacts` busca × "Filtros"
    36 × 36 (inalterado, muleta da contatos). Nenhum controle com conteúdo
    transbordando a altura nova nas 12 rotas.
  - **`h-9` manual tirado** (muleta de campo/select padrão):
    `dashboard/GlobalFilters.tsx` (busca), `segments/SegmentContactsDrawer.tsx`
    (busca), `pages/admin/ExperimentDetail.tsx` (`FilterSelect`).
  - **`h-9` que fica, de propósito:** botão `size="sm"` (30 px) esticado a
    36 para emparelhar — `LeadsExport.tsx:85`, `ColumnSelector.tsx:251`,
    `GlobalFilters.tsx` (5 botões de filtro e "Limpar"). Não é o tamanho
    padrão; ver pergunta 2. Também ficam: `PageConfigEditor.tsx:212` (o
    `<input type="color">` nativo, que agora bate com o `Input` ao lado — antes
    36 × 38), `SettingsPage.tsx:71` (`TabsList`) e os `TableHead`.
  - **Para as outras frentes repassarem** (h-9 agora redundante em campo,
    select ou botão padrão): `contacts/ContactsFilterPanel.tsx:362`
    (`SelectTrigger`), `contacts/StatusDropdown.tsx:70` (ramo não-`sm`),
    `contacts/ContactsToolbar.tsx:50` (busca); `settings/ApiKeysManagement.tsx:273`
    (`Input`), `:288` (`SelectTrigger`), `:323` (`Button` padrão);
    `settings/SuppressionList.tsx:190` e `:325` (`Input`). Os `h-9` em botão
    `sm` da contatos (`ContactsFilterPanel` 105/166/393/440/499,
    `ContactsExport:80`, `ContactsToolbar` 58/84) são o caso da pergunta 2.
- **#10 (`8453984`).** `COR_CTA_PADRAO = '#1a71a8'` (`--action` /
  `primary-600` do DS) em `src/landing/padroes.ts`. O editor já lia a
  constante; a landing passa a ler: o `#1e3a5f` saiu do `landing.css` e o
  `--landing-accent` é posto no `<main class="landing">` por `Landing.tsx` a
  partir da constante. `cta_color` gravada continua por cima (style inline).
  Nada no `backend/` tinha a cor (a casca de `routers/landing.py` só aponta
  para `main.css`/`main.js`). **Prova:** `build:landing` + landing sintética
  servida localmente com a casca do backend (sem banco, sem API): sem cor →
  `rgb(26, 113, 168)`, com `#E41A11` → `rgb(228, 26, 17)`, botão 44 px, 390 px
  sem rolagem. Produção não tem página — o editor foi conferido por código.
- **Item extra da coordenadora (`9412b75`):** `ui/form.tsx` — `FormLabel`
  com erro e `FormMessage` de `text-destructive` para `text-[--on-tint-danger]`
  (decisão 13). Sem opacidade.
- **Portão** (depois do merge da `main`): guarda **0** em `src`, `tsc` **0**,
  `vite build` ok, `build:landing` ok. Telas (`conferir-telas`, claro/escuro,
  1440/390): `/`, `/contacts`, `/pages`, `/segments`, `/settings`, detalhe de
  experimento. `/` (553) e `/contacts` (546) rolam a 390 px — **pré-existente**,
  igual na `main` (553 / 542; a diferença de 4 px é o texto "Colunas (20)" ×
  "(17)"). Console só com os avisos de sempre (React Router, um 404).
  Diálogos não foram abertos.

## Perguntas

1. **Qual azul é "o primário da marca" no CTA?** Assumi `#1a71a8`
   (`--action`, `primary-600`) — o que o botão do app usa — porque texto
   branco em negrito de 16 px sobre `#1f89ca` (`primary-500`,
   `--color-primary`) dá ~3,8:1, abaixo de 4,5. Trocar é uma linha em
   `padroes.ts`.
2. **Botão `size="sm"` emparelhado a campo.** Várias telas usam `sm` (30 px)
   + `h-9` à mão para ficar ao lado de um campo. Assumi não mexer (o `sm` não
   é o tamanho padrão da decisão 4). Opções: (a) deixar; (b) essas telas
   passam a `size="default"` (texto 14 px em vez de 12); (c) `sm` ganha
   altura fixa própria no primitivo.
3. **Acento da landing inteiro mudou, não só o botão.** O foco do campo e o
   destaque da mensagem de confirmação também saíam de `#1e3a5f` e agora são
   o azul da constante. Assumi que é o desejado (uma cor só); se não for,
   é separar `--landing-accent` do CTA.
