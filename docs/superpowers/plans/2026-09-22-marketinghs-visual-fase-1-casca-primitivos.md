# MarketingHS — Visual, Fase 1: Casca, login, primitivos e gráficos — Plano

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para executar tarefa a tarefa.
> Os passos usam caixa de seleção (`- [ ]`) para acompanhamento.

**Objetivo:** os componentes de `frontend/src/components/ui/`, a casca do app e a
tela de login passam a ter as medidas, os estados e as cores do Design System da
Health & Safety; os 14 gráficos passam a sair de um tema único. A API de cada
componente e o comportamento de cada tela ficam **iguais**.

**Arquitetura:** a Fase 0 instalou os tokens e a ponte (`bg-primary`,
`text-muted-foreground` etc. já apontam para o Design System). Esta fase muda o
**desenho** dos primitivos locais — sem trocar o Radix por baixo, sem mudar
nome de prop nem de variante — e reconstrói a casca (sidebar 256/72px, topbar de
64px com a chave de tema). O tema de gráfico nasce como variáveis próprias
(`--grafico-1…6`), derivadas dos tokens e trocadas no escuro, consumidas por um
`lib/chartTheme.ts`.

**Stack:** React 18 · Vite · TypeScript · Tailwind 3.4.17 · shadcn/ui (Radix) · recharts · Playwright

**Spec:** `docs/superpowers/specs/2026-09-22-marketinghs-visual-design-system-design.md` (Fase 1)
**Fase anterior:** `docs/superpowers/plans/2026-09-22-marketinghs-visual-fase-0-fundacao.md`

---

## Restrições globais

- ⚠️ **A API não muda.** Nome de componente, de prop, de variante e de tamanho
  ficam como estão. Nenhuma tela é editada para acompanhar um primitivo —
  se um primitivo exigir isso, **pare e relate**.
- ⚠️ **Os arquivos de `frontend/src/design-system/` não se editam.** São cópia
  byte a byte do projeto oficial (`ef9f35f6-3af0-4651-9dee-45d08884432a`).
  Defeito do Design System vira linha em `ORIGEM.md` e pergunta ao Erick.
- **Cor sai de token.** Nenhum hexadecimal, nenhuma cor literal do Tailwind
  (`bg-blue-600`), nenhum `hsl()`/`rgb()` numérico nos arquivos tocados. O
  vocabulário é o da ponte (`bg-primary`, `bg-card`, `text-muted-foreground`,
  `border-border`…) e o do `adocao.md` (`bg-action`, `bg-surface`,
  `bg-surface-elevated`, `border-borda`, `text-conteudo`, `text-conteudo-muted`,
  `text-conteudo-faint`, `bg-primary-50…900`, `text-info`, `text-danger`,
  `text-warning`). Tinta de significado: `bg-[--tint-success]` com
  `text-[--on-tint-success]` (e os pares `info`, `warning`, `danger`,
  `primary`, `neutral`).
- **Nada de sombra em superfície estática.** Sombra só em modal (`shadow-xl`),
  lista flutuante (`shadow-lg`), aba ativa (`shadow-sm`) e tooltip
  (`shadow-lg`). Card não tem sombra.
- **`focus-visible` com anel de 2px** em tudo que recebe foco; nunca `focus:`.
- **Nada encolhe ao clique** (`active:scale-*` sai).
- **Nada anima em laço** fora spinner.
- **Landing pública fora:** `src/landing/` não é tocada.
- **Frontend:** `cd frontend && npx tsc --noEmit -p tsconfig.app.json && npx vite build && npm run build:landing`.
  `tsc` tem **4 erros pré-existentes** (LeadScoringSettings ×1, useJourneys ×3);
  nenhum novo.
- **Guarda:** `npm run guarda:visual -- <pasta>` na pasta tocada. Placar de
  partida (22/09): **929** no app, `ui` 8, `admin` (raiz) 35, `dashboard/*` 436
  somando as subpastas, `pages/admin` 66.
- **Comentário, nome e mensagem em português.**
- **Navegador:** Playwright; backend 8100 e Vite `127.0.0.1:8080`; login com a
  conta admin do Claude (`~/.config/marketinghs/claude-admin.env`); **só
  navegar por URL, ler, usar o console e abrir diálogos/menus de
  visualização — nunca clicar em botão de ação** (salvar, arquivar, excluir,
  ativar, enviar, ícones sem rótulo em listas). Nenhuma escrita no banco. Tema
  pelo `localStorage` (`marketinghs-tema` = `claro`/`escuro`); deixe `claro`.
- **Toda tarefa confere no claro E no escuro.**

## As medidas oficiais (copiadas dos componentes do projeto)

Servem de contrato para as Tarefas 1-4. Vieram de `components/**/*.jsx` do
projeto oficial, lidos em 22/09/2026.

| Peça | Medida oficial |
|---|---|
| **Botão** | raio `--radius-lg` (8px); `gap-2`; peso 500; `leading-tight`; hover escurece (primário `--action`→`--action-hover`; secundário e fantasma ganham `--surface-elevated`); desabilitado opacidade 0.5 + `cursor-not-allowed`; tamanhos: sm `py-1.5 px-3 text-xs`, md `py-2 px-4 text-sm`, lg `py-3 px-6 text-base` |
| **Variantes de botão** | primário: fundo `--action`, texto `--text-on-primary`, borda da mesma cor · secundário: fundo `--surface`, texto `--text-body`, borda `--border-color` · perigo: fundo `--color-danger-500`, texto branco · sucesso: fundo `--color-success-500`, texto branco · fantasma: transparente, texto `--text-muted`, borda transparente |
| **Card** | raio `--radius-xl` (12px), borda 1px `--border-color`, fundo `--surface`, padding md = 16px (`sm` 12, `lg` 24), **sem sombra**; clicável: no hover a **borda** vira `--action` |
| **CardTitle** | 16px, peso 600, `--text-heading` |
| **Badge** | pílula, borda 1px da cor a 30%, fundo `--tint-*`, texto `--on-tint-*`, `py-0.5 px-2.5`, 12px, peso 500 |
| **Campo (input/textarea/select)** | raio 8px, borda `--border-color`, fundo `--surface`, `py-2 px-3`, 14px, texto `--text-body`; foco: borda `--action` + anel de 2px; erro: borda `--color-danger-500` e mensagem em `--on-tint-danger` 12px; desabilitado 0.5 |
| **Caixa de seleção** | 16×16, raio `--radius-sm` (4px), borda `--border-strong`; marcada: fundo e borda `--action`, tique branco |
| **Interruptor** | trilho 48×28 (sm 44×24), raio pílula; ligado: fundo e borda `--action`; botão branco 20px com `--shadow-sm`, desloca 20px em 150ms |
| **Modal** | raio 12px, borda 1px, fundo `--surface`, `--shadow-xl`; fundo escurecido `--overlay` com `blur(4px)`; entra com `hs-modal-in` em 150ms; cabeçalho `py-4 px-6` com borda embaixo, título 16px peso 600; corpo `py-4 px-6`; larguras sm 384 · md 448 · lg 512 · xl 672 · 2xl 768 |
| **Tabela** | 14px; `thead` com borda embaixo `--border-color` e **sem fundo**; `th` `py-3 px-4`, 12px, peso 600, caixa alta, `tracking-wider`, `--text-muted`; `td` `py-3 px-4`; linha com borda embaixo `--border-muted`, hover `--surface-elevated` |
| **Abas** | trilho `inline-flex gap-1` raio 8px fundo `--surface-elevated` padding 4px; aba ativa: fundo `--surface`, raio `--radius-md` (6px), `--shadow-sm`, texto `--text-heading`; inativa `--text-muted`; `py-1.5 px-4`, 14px, peso 500 |
| **Tooltip** | fundo `--color-slate-900`, texto branco, raio 8px, `py-1.5 px-2.5`, 12px peso 500, `--shadow-lg` |
| **Aviso (Alert)** | raio 8px, borda 1px da cor a 30%, fundo `--tint-*`, texto `--on-tint-*`, padding 16px, 14px, ícone 20px à esquerda |
| **Casca** | sidebar 256px / 72px recolhida, fundo `--surface`, borda à direita; cabeçalho da sidebar com a altura da topbar (64px), logo 28px de altura; grupo: rótulo 10px caixa alta `tracking-[0.1em]` peso 600 `--text-faint`; item: `gap-3 py-2 px-3` raio 8px, 14px peso 500, borda esquerda de 2px (`--action` no ativo, transparente no resto), ativo com fundo `--action-tint` e texto `--action`, inativo `--text-muted`; recolhido: ícone centrado, `py-2.5`; rodapé com borda em cima, produto e `© 2026 Health & Safety Tech` |
| **Topbar** | 64px, fundo `--surface`, borda embaixo, `px-6`, título 16px peso 600 `--text-heading` à esquerda, ações à direita com `gap-4` |

---

### Tarefa 1: Primitivos de base

**Arquivos (`frontend/src/components/ui/`):** `button.tsx`, `card.tsx`,
`badge.tsx`, `label.tsx`, `alert.tsx`, `progress.tsx`, `skeleton.tsx`,
`separator.tsx`

**Interfaces:**
- Produz: os mesmos componentes, com a mesma API, já no desenho oficial. As
  Tarefas 2-6 e as telas herdam.

- [ ] **Step 1: Ler antes de mudar**

Para cada arquivo, leia as variantes existentes (`cva`) e anote no relatório a
lista atual (nomes de variante e de tamanho). **Nenhum nome muda.** Anote
também quantos arquivos usam cada variante:

```bash
cd /home/ericks/github/MarketingHS/frontend
grep -rho 'variant="[a-z]*"' src --include=*.tsx | sort | uniq -c | sort -rn
grep -rho 'size="[a-z]*"' src --include=*.tsx | sort | uniq -c | sort -rn
```

- [ ] **Step 2: `button.tsx`**

Mapeie as variantes existentes para as oficiais, sem renomear:
`default` → primário · `destructive` → perigo · `outline` e `secondary` →
secundário · `ghost` → fantasma · `link` → texto `--text-link`, sublinhado no
hover, sem fundo. Tamanhos: `sm` → `py-1.5 px-3 text-xs`; `default` →
`py-2 px-4 text-sm`; `lg` → `py-3 px-6 text-base`; `icon` → quadrado de 36px
(`h-9 w-9 p-0`). Base: `inline-flex items-center justify-center gap-2
rounded-lg font-medium leading-tight transition-colors
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
focus-visible:ring-offset-2 disabled:opacity-50
disabled:cursor-not-allowed`. **Saem** `active:scale-*`, `shadow-*`, gradiente
e qualquer `transition-all`. Altura fixa (`h-10`, `h-9`, `h-11`) sai: quem
manda é o padding.

- [ ] **Step 3: `card.tsx`**

`Card`: `rounded-xl border border-border bg-card text-card-foreground` —
**sem** `shadow-*`. `CardHeader`: `flex flex-col gap-1.5 p-4`. `CardTitle`:
`text-base font-semibold leading-tight text-conteudo-heading`.
`CardDescription`: `text-sm text-muted-foreground`. `CardContent`:
`p-4 pt-0`. `CardFooter`: `flex items-center p-4 pt-0`. Onde houver `ds-card`,
`glass`, `backdrop-blur` ou sombra, saem.

- [ ] **Step 4: `badge.tsx`**

Base: `inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5
text-xs font-medium whitespace-nowrap transition-colors
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`.
Variantes, pela tinta: `default` → `bg-[--tint-primary]
text-[--on-tint-primary] border-[rgb(31_137_202_/_0.3)]`; `secondary` →
`bg-[--tint-neutral] text-[--on-tint-neutral] border-border`; `destructive` →
tinta `danger`; `outline` → `bg-transparent text-conteudo border-border`. Se o
arquivo já tiver `success`/`warning`/`info`, use as tintas correspondentes.

- [ ] **Step 5: `alert.tsx`, `progress.tsx`, `skeleton.tsx`, `separator.tsx`, `label.tsx`**

- `alert.tsx`: `rounded-lg border p-4 text-sm`, variantes pela tinta
  (`default` → `info`); título `font-semibold mb-0.5`.
- `progress.tsx`: trilho `bg-surface-elevated`, indicador `bg-action`, raio
  pílula, altura como está.
- `skeleton.tsx`: `bg-surface-elevated` (sai qualquer cor literal); mantém o
  `animate-pulse`.
- `separator.tsx`: `bg-border`.
- `label.tsx`: `text-sm font-medium text-conteudo`.

- [ ] **Step 6: Verificar**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.app.json; npx vite build
npm run guarda:visual -- src/components/ui
```

No navegador, nos dois temas: `/` (cards e botões), `/contacts` (badges),
`/settings` (botões, rótulos), `/campaigns` (avisos, se houver). Zero erro de
console. Compare com o screenshot da Fase 0 e descreva no relatório o que
mudou de tamanho.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ui
git commit -m "feat(visual): primitivos de base no desenho do Design System"
```

---

### Tarefa 2: Campos de formulário

**Arquivos:** `input.tsx`, `textarea.tsx`, `select.tsx`, `checkbox.tsx`,
`radio-group.tsx`, `switch.tsx`, `toggle.tsx`, `toggle-group.tsx`,
`calendar.tsx`, `scroll-area.tsx`

**Interfaces:**
- Consome: o anel de foco e o vocabulário de cor da Tarefa 1.
- Produz: campos com a mesma API.

- [ ] **Step 1: Campo de texto**

`input.tsx` e `textarea.tsx`: `w-full rounded-lg border border-input bg-surface
px-3 py-2 text-sm text-conteudo placeholder:text-conteudo-faint
transition-colors focus-visible:outline-none focus-visible:border-primary
focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0
disabled:opacity-50 disabled:cursor-not-allowed`. Altura fixa sai. Mantenha
`aria-invalid:border-danger` se já existir.

- [ ] **Step 2: `select.tsx`**

Gatilho igual ao campo de texto (mesma altura e raio). Conteúdo:
`rounded-lg border border-border bg-popover text-conteudo shadow-lg`; item:
`rounded-md px-2 py-1.5 text-sm focus:bg-surface-elevated
data-[state=checked]:text-action`.

- [ ] **Step 3: `checkbox.tsx`, `radio-group.tsx`**

Caixa 16×16, `rounded-sm border border-borda-strong bg-surface`; marcada:
`data-[state=checked]:bg-action data-[state=checked]:border-action
data-[state=checked]:text-white`; rádio igual, com raio pílula e ponto branco
de 8px; anel de 2px em `focus-visible`.

- [ ] **Step 4: `switch.tsx`**

Trilho `h-7 w-12` (sm `h-6 w-11`), pílula, `bg-surface-elevated border
border-border`; ligado: `data-[state=checked]:bg-action
data-[state=checked]:border-action`; botão branco de 20px com `shadow-sm`,
`transition-transform duration-150`.

- [ ] **Step 5: `toggle.tsx`, `toggle-group.tsx`, `calendar.tsx`, `scroll-area.tsx`**

Só troca de cor e raio para o vocabulário de token: fundo de item ativo
`bg-surface-elevated`/`bg-action-tint` com texto `text-action`, bordas
`border-border`, dia selecionado do calendário `bg-action text-white`, barra da
`scroll-area` `bg-borda-strong`. Não mexa na estrutura.

- [ ] **Step 6: Verificar e commitar**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.app.json; npx vite build
npm run guarda:visual -- src/components/ui
git add frontend/src/components/ui && git commit -m "feat(visual): campos de formulário no desenho do Design System"
```

No navegador, nos dois temas: `/segments` (modal de segmento, só abrir),
`/settings` (campos, interruptores), `/contacts` (busca, filtros, caixas de
seleção). Zero erro de console.

---

### Tarefa 3: Sobreposições, tabela e abas

**Arquivos:** `dialog.tsx`, `alert-dialog.tsx`, `sheet.tsx`, `popover.tsx`,
`dropdown-menu.tsx`, `tooltip.tsx`, `toast.tsx`, `toaster.tsx`, `sonner.tsx`,
`table.tsx`, `tabs.tsx`, `command.tsx`, `collapsible.tsx`

- [ ] **Step 1: Modais e gavetas**

`dialog.tsx`, `alert-dialog.tsx`, `sheet.tsx`: fundo escurecido
`bg-[--overlay] backdrop-blur-[4px]`; conteúdo `rounded-xl border border-border
bg-card shadow-xl`; entrada `data-[state=open]:animate-in
data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 duration-150` (a
gaveta desliza em 300ms, como já faz); cabeçalho com borda embaixo, título
`text-base font-semibold`, corpo `px-6 py-4`. Botão de fechar: `rounded-lg
text-conteudo-muted hover:text-conteudo focus-visible:ring-2`.

- [ ] **Step 2: Listas flutuantes**

`popover.tsx`, `dropdown-menu.tsx`, `command.tsx`: `rounded-lg border
border-border bg-popover text-conteudo shadow-lg p-1`; item `rounded-md px-2
py-1.5 text-sm focus:bg-surface-elevated`; separador `bg-border`; atalho
`text-conteudo-faint`.

- [ ] **Step 3: `tooltip.tsx`**

`rounded-lg bg-[--color-slate-900] px-2.5 py-1.5 text-xs font-medium
text-white shadow-lg`. Vale nos dois temas (é o padrão oficial).

- [ ] **Step 4: Avisos temporários**

`sonner.tsx` / `toast.tsx` / `toaster.tsx`: fundo `--toast-bg`, texto
`--toast-color`, borda `--toast-border`, raio 12px, `shadow-lg`. Confira qual
dos dois o app monta (`grep -rn "Toaster" src/App.tsx`) e ajuste só o que está
em uso; o outro fica como está e é anotado.

- [ ] **Step 5: `table.tsx` e `tabs.tsx`**

Tabela, conforme a tabela de medidas: `thead` com `border-b border-border` e
**sem fundo**; `th` `h-auto px-4 py-3 text-xs font-semibold uppercase
tracking-wider text-conteudo-muted`; `td` `px-4 py-3`; `tr`
`border-b border-borda-muted transition-colors hover:bg-surface-elevated`.
Abas: trilho `inline-flex gap-1 rounded-lg bg-surface-elevated p-1`; gatilho
`rounded-md px-4 py-1.5 text-sm font-medium text-conteudo-muted
data-[state=active]:bg-surface data-[state=active]:text-conteudo-heading
data-[state=active]:shadow-sm`.

- [ ] **Step 6: Verificar e commitar**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.app.json; npx vite build
npm run guarda:visual -- src/components/ui
git add frontend/src/components/ui && git commit -m "feat(visual): sobreposições, tabela e abas no desenho do Design System"
```

No navegador, nos dois temas: `/contacts` (tabela, ficha em gaveta, menu de
colunas, tooltip da sidebar), `/analytics` (abas), um diálogo de confirmação
(abrir sem confirmar). Zero erro de console.

---

### Tarefa 4: A casca

**Arquivos:** `src/components/admin/AdminSidebar.tsx`,
`src/components/admin/AdminLayout.tsx`, `src/components/admin/AIDataChat.tsx`,
`src/components/admin/dashboard/GlobalFilters.tsx` (só a faixa), e um novo
`src/components/admin/ChaveDeTema.tsx`

**Interfaces:**
- Consome: `lerTema`, `aplicarTema`, `alternarTema` de `@/lib/tema` (Fase 0).
- Produz: `<ChaveDeTema />` (botão de 36px, ícone sol/lua do `lucide-react`,
  `aria-label` "Mudar para o tema escuro"/"Mudar para o tema claro").

- [ ] **Step 1: Sidebar**

- Largura: `w-64` aberta (hoje `w-[220px]`), `w-[4.5rem]` recolhida (hoje
  `w-16`); transição de 300ms.
- Chave do armazenamento: `marketinghs-sidebar-collapsed`, **lendo uma vez** a
  antiga (`dnmarketing-sidebar-collapsed`) para não perder a preferência de
  quem já usa; depois de ler, a antiga é apagada.
- Fundo `bg-surface`, borda `border-r border-border` (hoje `border-border/50`).
- Cabeçalho da sidebar com `h-16` e `px-5`, logo com `h-7`; recolhido, só o
  logo centrado.
- Item: `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium
  border-l-2 border-transparent text-conteudo-muted transition-colors
  hover:bg-surface-elevated`; ativo: `border-action bg-action-tint text-action`;
  ícone 20px, `text-action` quando ativo. Recolhido: `justify-center py-2.5`,
  sem borda esquerda, com tooltip.
- Rótulo de grupo ("Principal", "Sistema"): `px-3 text-2xs font-semibold
  uppercase tracking-[0.1em] text-conteudo-faint`.
- Rodapé: `border-t border-border px-5 py-4 text-center`, com
  `MarketingHS` (`text-xs font-medium text-conteudo-muted`) e
  `© 2026 Health & Safety Tech` (`text-[11px] text-conteudo-faint`).
  ⚠️ O e-mail do usuário e o botão **Sair** saem daqui e vão para a topbar
  (Step 2) — a capacidade continua, muda de lugar.
- Submenu de Analytics: mantém o comportamento; o filete vira
  `border-l border-border`.

- [ ] **Step 2: Topbar**

Nova, em `AdminLayout.tsx`, acima do conteúdo e da faixa de filtros:
`flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border
bg-surface px-6`.

- Esquerda: no celular, o botão de menu (que hoje é fixo no canto) entra aqui;
  depois, o **título da tela** em `text-base font-semibold text-conteudo-heading`.
  O título sai de um mapa rota → título no próprio `AdminLayout`, com os
  rótulos que a sidebar já usa, mais: `/templates/new` "Novo template",
  `/templates/:id/edit` "Editar template", `/automations/fluxos/:id` "Fluxo",
  `/experiments/setup` "Configurar teste A/B", `/experiments/:id` "Teste A/B",
  `/pages/:slug/edit` "Editar página", `/import` "Importar".
- Direita, com `gap-4`: `<ChaveDeTema />`, o e-mail do usuário
  (`text-sm text-conteudo`, escondido abaixo de `sm`) e o botão **Sair**
  (`variant="ghost" size="icon"`, ícone `LogOut`, `aria-label="Sair"`).

⚠️ As telas têm título próprio no corpo. A duplicação é esperada nesta fase: o
título do corpo sai tela a tela na Fase 2. Registre no relatório as telas em
que os dois títulos aparecem.

- [ ] **Step 3: Faixa de filtros e assistente**

- Faixa de filtros globais: sai o `backdrop-blur-sm` e o `bg-card/50`; fica
  `border-b border-border bg-surface px-6 py-3`.
- `AIDataChat`: o botão flutuante passa a `bg-action text-white shadow-lg
  hover:bg-action-hover`, sem gradiente nem glow; o cabeçalho do painel passa a
  `bg-surface border-b border-border` com texto `text-conteudo-heading`. A
  conversa em si não muda nesta tarefa (é da Fase 2).

- [ ] **Step 4: `ChaveDeTema.tsx`**

```tsx
// Botão da topbar que alterna claro/escuro. O estado vive na classe `dark` do
// <html> e no localStorage — ver src/lib/tema.ts.
import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { alternarTema, lerTema, type Tema } from '@/lib/tema';

export function ChaveDeTema() {
  const [tema, setTema] = useState<Tema>(() => lerTema());
  const escuro = tema === 'escuro';
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTema(alternarTema())}
      aria-label={escuro ? 'Mudar para o tema claro' : 'Mudar para o tema escuro'}
      title={escuro ? 'Tema claro' : 'Tema escuro'}
    >
      {escuro ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
```

- [ ] **Step 5: Verificar e commitar**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.app.json; npx vite build
npm run guarda:visual -- src/components/admin
git add frontend/src && git commit -m "feat(visual): casca no padrão do Design System — sidebar, topbar e chave de tema"
```

No navegador, nos dois temas: sidebar aberta e recolhida (a chave de recolher
continua funcionando e a preferência sobrevive ao recarregar); a chave de tema
alterna e sobrevive ao recarregar; o menu do celular abre (largura de 390px);
o item ativo muda ao navegar; Sair aparece (**não clique**). Zero erro de
console.

---

### Tarefa 5: Login e as duas telas de fora

**Arquivos:** `src/pages/admin/Login.tsx`, e o que as buscas do Step 2
apontarem para `/descadastrar` e `/templates/:id/preview`

- [ ] **Step 1: Login**

Card centrado sobre `bg-background`: `w-full max-w-sm rounded-xl border
border-border bg-card p-6`. Dentro: logo (`h-10 mx-auto mb-6`), título
`text-base font-semibold text-conteudo-heading`, campos da Tarefa 2, botão
primário `w-full`, e a mensagem de erro em `text-sm text-danger`. Sem
gradiente, sem glow, sem `backdrop-blur`. **Nada do comportamento muda** — não
existe "esqueci a senha" e não se acrescenta.

- [ ] **Step 2: As duas telas que ficaram fora do portão da Fase 0**

```bash
cd /home/ericks/github/MarketingHS/frontend
grep -rn "descadastrar" src --include=*.tsx | head
grep -rn "templates/:id/preview\|TemplatePreview" src/App.tsx src/pages -r | head
```

Abra as duas no navegador nos dois temas (a de descadastro é pública; a de
preview precisa de um template — se não houver nenhum no banco, registre "sem
dado" e siga). Ajuste **só cor, raio e tipografia** para o vocabulário de
token. Se alguma delas for casca própria (fora do `AdminLayout`), trate como o
login.

- [ ] **Step 3: Verificar e commitar**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.app.json; npx vite build
npm run guarda:visual -- src/pages/admin
git add frontend/src && git commit -m "feat(visual): login e telas públicas no padrão do Design System"
```

---

### Tarefa 6: O tema dos gráficos

**Arquivos:** `src/index.css` (variáveis novas), novo `src/lib/chartTheme.ts`,
e os 14 arquivos com `recharts`: `admin/LeadsChart.tsx`,
`dashboard/overview/{LeadGoalGauge,SourceBarChart,LeadsLineChart,DistributionPieChart}.tsx`,
`dashboard/operational/{MediumDistributionChart,SourceQualificationChart,HourlyConversionChart}.tsx`,
`dashboard/challenges/{ResponseQualityChart,ChallengeThemesChart,TopKeywordsChart}.tsx`,
`dashboard/profile/{RoleDistribution,RevenueDistribution,SectorDistribution}.tsx`

**Interfaces:**
- Produz: `SERIES` (array de cores de série), `eixo`, `grade`, `tooltip` e
  `legenda` — objetos de props prontos para o `recharts`.

- [ ] **Step 1: As variáveis de série**

No `index.css`, junto da ponte (bloco `@layer base`), seis cores de série
derivadas dos tokens, com o escuro trocando o que precisa:

```css
  /* Gráfico: as séries precisam ser distinguíveis ENTRE SI, o que é um
     problema diferente do contraste de texto. O Design System oficial não
     tem paleta de gráfico; estas seis saem da rampa da marca e das
     semânticas, e o escuro troca as que somem no navy. */
  :root {
    --grafico-1: var(--color-primary-500);
    --grafico-2: var(--color-warning-500);
    --grafico-3: var(--color-success-500);
    --grafico-4: var(--color-danger-500);
    --grafico-5: var(--color-primary-800);
    --grafico-6: var(--color-slate-400);
  }
  .dark {
    --grafico-1: var(--color-primary-400);
    --grafico-5: var(--color-primary-200);
    --grafico-6: var(--color-slate-500);
  }
```

- [ ] **Step 2: `lib/chartTheme.ts`**

```ts
// Tema único dos gráficos. Antes, cada gráfico escolhia a própria cor — foi
// assim que o painel acumulou hexadecimal solto. Tudo aqui sai de token, e as
// cores trocam sozinhas com o tema porque são var() lidas pelo SVG.
export const SERIES = [
  'var(--grafico-1)', 'var(--grafico-2)', 'var(--grafico-3)',
  'var(--grafico-4)', 'var(--grafico-5)', 'var(--grafico-6)',
] as const;

export const serie = (i: number) => SERIES[i % SERIES.length];

export const eixo = {
  stroke: 'var(--border-color)',
  tick: { fill: 'var(--text-muted)', fontSize: 12 },
  tickLine: { stroke: 'var(--border-color)' },
  axisLine: { stroke: 'var(--border-color)' },
} as const;

export const grade = {
  stroke: 'var(--border-muted)',
  strokeDasharray: '3 3',
} as const;

export const tooltip = {
  contentStyle: {
    background: 'var(--surface)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-lg)',
    color: 'var(--text-body)',
    fontSize: 12,
  },
  labelStyle: { color: 'var(--text-heading)', fontWeight: 600 },
  cursor: { fill: 'var(--surface-elevated)' },
} as const;

export const legenda = {
  wrapperStyle: { fontSize: 12, color: 'var(--text-muted)' },
} as const;
```

- [ ] **Step 3: Aplicar nos 14 arquivos**

Em cada um: `CartesianGrid` recebe `{...grade}`; `XAxis`/`YAxis` recebem
`stroke`, `tick`, `tickLine` e `axisLine` de `eixo`; `Tooltip` recebe
`{...tooltip}`; `Legend` recebe `{...legenda}`; toda cor de série (array de
hexadecimais, `var(--color-info-500)` que veio da correção da Fase 0, ou cor
literal) passa a sair de `SERIES`/`serie(i)`. Onde a cor **significa** algo
(sucesso, aviso, perigo — ex. o medidor de meta), mantenha o token semântico
em vez de `serie(i)`, e diga no relatório onde fez isso.

- [ ] **Step 4: Verificar e commitar**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.app.json; npx vite build
npm run guarda:visual -- src/components/admin/dashboard
git add frontend/src && git commit -m "feat(visual): tema único de gráfico derivado dos tokens"
```

No navegador, nos dois temas: `/` e `/analytics` em todas as abas (Perfil,
Desafios, Tático, Operacional, Insights). **Cada gráfico com mais de uma série
tem de ter séries distinguíveis** — anote no relatório qualquer par que fique
parecido (é pergunta ao Erick, não conserto local). Zero erro de console.

---

### Tarefa 7: O portão da Fase 1 e o registro

- [ ] **Step 1: Buscas e builds**

```bash
cd /home/ericks/github/MarketingHS/frontend
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"   # 4
npx vite build && npm run build:landing
npm run guarda:visual
npm run guarda:visual -- src/components/ui        # esperado: 0
grep -rn "active:scale\|backdrop-blur" src --include=*.tsx | grep -v "dialog\|alert-dialog\|sheet"
grep -rn "shadow-" src/components/ui/card.tsx
(cd src/design-system && sha256sum styles.css tokens/*.css)        # os 7 hashes da Fase 0
```

- [ ] **Step 2: As telas nos dois temas**

As 15 telas da Fase 0 (lista no plano da Fase 0), nos dois temas, com
screenshot em `.../scratchpad/visual-f1/{claro,escuro}/` na **mesma largura**
usada na Fase 0 (1440). Para cada uma: abre sem erro; a casca está no padrão;
nenhuma capacidade sumiu (menu, filtros, exportação, paginação, modais
abrem). Anote a dívida que sobra para a Fase 2 — ela é o insumo do plano
seguinte.

- [ ] **Step 3: Capacidade por capacidade**

```bash
git diff main --stat -- frontend/src
git diff main -- frontend/src/components/ui | grep "^[-+]" | grep -v "^[-+][-+]"
```

Toda linha tem de ser classe, cor, medida ou comentário. Qualquer mudança de
API (nome de prop, de variante, de export), de estrutura de componente Radix
ou de lógica é defeito — registre e não conserte sozinho.

- [ ] **Step 4: Registro**

- `docs/CONTINUAR-AQUI.md`: bloco novo da Fase 1 no topo (o que entrou, placar
  do guarda antes/depois, telas com título duplicado, dívida anotada, pares de
  série parecidos). Corrija no bloco da Fase 0 a frase "aguardando o merge com
  o Erick" — a Fase 0 **foi mergeada** em 22/09 (`2e39aae`) e está no
  `origin/main`.
- `CLAUDE.md`: na seção "Visual", uma linha dizendo que os primitivos de
  `components/ui/` seguem as medidas do Design System e que mudança de medida
  se faz lá, não na tela.
- `frontend/src/design-system/ORIGEM.md`: se a Tarefa 6 achou par de série
  indistinguível ou outro defeito do oficial, acrescente à lista.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/CONTINUAR-AQUI.md frontend/src/design-system/ORIGEM.md
git commit -m "docs(visual): Fase 1 fechada — casca, primitivos e gráficos"
```
