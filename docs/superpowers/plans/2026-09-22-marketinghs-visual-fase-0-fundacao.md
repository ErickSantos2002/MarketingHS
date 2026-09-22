# MarketingHS — Visual, Fase 0: Fundação — Plano

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para executar tarefa a tarefa.
> Os passos usam caixa de seleção (`- [ ]`) para acompanhamento.

**Objetivo:** o painel inteiro passa a vestir o Design System da Health &
Safety — cor da marca, superfícies, fonte Plus Jakarta Sans, tema claro por
padrão e escuro navy por classe — sem que nenhuma tela seja reescrita por
dentro e sem que nenhum layout se mova.

**Arquitetura:** os tokens oficiais entram copiados byte a byte em
`frontend/src/design-system/`. As variáveis do shadcn (`--primary`, `--card`,
`--border`…) viram apelidos desses tokens, e o `tailwind.config.ts` as consome
com `color-mix`, o que preserva os 583 modificadores de opacidade
(`bg-primary/20`). Como os tokens trocam de valor sob `.dark` no `<html>`, a
ponte serve aos dois temas. A limpeza tira do `index.css` os três temas e os
efeitos da dn.ia. Um guarda (`npm run guarda:visual`) mede a dívida visual que
sobra para as fases 1 e 2.

**Stack:** React 18 · Vite · TypeScript · Tailwind 3.4.17 · shadcn/ui (Radix) · Playwright (conferência)

**Spec:** `docs/superpowers/specs/2026-09-22-marketinghs-visual-design-system-design.md` (Fase 0)

---

## Restrições globais

- ⚠️ **Os arquivos de `frontend/src/design-system/` não se editam.** São cópia
  byte a byte do projeto oficial no Claude Design
  (`ef9f35f6-3af0-4651-9dee-45d08884432a`), baixada em 22/09/2026 e conferida:
  os sete arquivos são idênticos, por SHA-256, à cópia do DataCoreHS
  (`~/github/DataCoreHS/src/design-system/`). **Nunca** use a cópia do HelpHS
  nem as emendas dela (decisão do Erick).
- **Nenhuma tela muda de comportamento.** Só CSS, config do Tailwind, o
  `index.html`, o mecanismo de tema e as classes de efeito da dn.ia. Nenhuma
  lógica, rota, chamada de API, texto ou condição.
- **Nenhum layout se move** nesta fase. Casca (topbar, sidebar), login e
  primitivos são da Fase 1; cores literais nas telas são da Fase 2.
- **Landing pública fora:** `src/landing/` (bundle separado, `landing.css`
  próprio, sem Tailwind) e o preview de landing não são tocados.
- **A classe `dark` vai no `<html>`**, nunca no `<body>`: a ponte depende de
  `:root` e `.dark` estarem no mesmo elemento.
- **Frontend:** `cd frontend && npx tsc --noEmit -p tsconfig.app.json && npx vite build`.
  O `tsc` tem **4 erros pré-existentes** (LeadScoringSettings ×1, useJourneys
  ×3); nenhum novo. O `npm run build:landing` também tem de continuar passando.
- **Comentário, nome e mensagem em português.**
- Existem outras sessões Claude na máquina em outros repositórios: leia de
  `~/github/DataCoreHS`, nunca edite lá.
- **Navegador:** Playwright; backend na 8100 e Vite em `127.0.0.1:8080`
  (comandos no `CLAUDE.md`); login com a conta admin do Claude
  (`~/.config/marketinghs/claude-admin.env`). Nenhuma escrita no banco.

## As 16 telas da conferência

`/login`, `/`, `/analytics`, `/contacts` (e a ficha de um contato aberta),
`/import`, `/pages`, `/segments`, `/campaigns`, `/templates`,
`/templates/new` (sem salvar), `/automations`, `/automations/fluxos/<id de um
fluxo existente>`, `/experiments`, `/experiments/setup`, `/settings`, e
`/pages/<slug>/edit` de uma página existente. Tela com `<id>` sem dado no
banco é anotada como "sem dado" e pulada.

Screenshots em
`/tmp/claude-1000/-home-ericks-github-MarketingHS/82732417-1d1f-4eac-89ae-4a0a1d208031/scratchpad/visual-f0/{antes,depois-claro,depois-escuro}/`,
um PNG por tela, nome = rota com `/` trocado por `_`.

---

### Tarefa 1: O "antes" e a cópia do Design System

**Arquivos:**
- Criar: `frontend/src/design-system/styles.css`
- Criar: `frontend/src/design-system/tokens/{colors,typography,spacing,shape,motion,base}.css`
- Criar: `frontend/src/design-system/ORIGEM.md`

**Interfaces:**
- Produz: `@/design-system/styles.css` (ponto de entrada, só `@import`s) e as
  custom properties oficiais (`--action`, `--bg-base`, `--surface`,
  `--surface-elevated`, `--border-color`, `--text-*`, `--tint-*`,
  `--on-tint-*`, `--radius-*`, `--shadow-*`, `--font-sans`, `--font-mono`…)
  que a Tarefa 2 consome.

- [ ] **Step 1: Screenshots do "antes"**

Com o `main` atual (antes de qualquer mudança), suba backend e Vite, entre
com a conta admin do Claude e tire screenshot de página inteira das 16 telas
em `.../scratchpad/visual-f0/antes/`. Hoje só existe o tema escuro da dn.ia.

- [ ] **Step 2: Copiar os sete arquivos**

A cópia oficial já está baixada e conferida em
`/tmp/claude-1000/-home-ericks-github-MarketingHS/82732417-1d1f-4eac-89ae-4a0a1d208031/scratchpad/ds-oficial/`
(com `hashes.txt`). Copie de lá, preservando bytes:

```bash
cd /home/ericks/github/MarketingHS/frontend
S=/tmp/claude-1000/-home-ericks-github-MarketingHS/82732417-1d1f-4eac-89ae-4a0a1d208031/scratchpad/ds-oficial
mkdir -p src/design-system/tokens
cp $S/styles.css src/design-system/styles.css
cp $S/tokens/*.css src/design-system/tokens/
(cd src/design-system && sha256sum styles.css tokens/*.css)
```

Esperado — exatamente estes hashes:

```
1ef6324844aa066488f0d8a015b39e3ca0756c629512fce4e1bd95ca8b93b9b2  styles.css
bdd047ce432e74b33fa7f752da08cf025419e83ea18485bd947c889c0ac1c221  tokens/base.css
63d960841590a2cb4df3819e2cb4a55439c893578abfe68c00927a7aba0f307d  tokens/colors.css
c70d51a982ae0b91bd53ece150d8d16e0e70bef9ca59586541a9a7177228478e  tokens/motion.css
7bcfbbc585d3ea8c7f689a27eeb3ae13de0c2a9dcc3c6cc0c8f41d440d193f7d  tokens/shape.css
c093b261c6893a893a418cdf64798555326d4586a8adb37cc7eca457fabae420  tokens/spacing.css
99d1a02b92b120c78000c0bc016c616680effb3e13b512e914f3f4f578ca916a  tokens/typography.css
```

Se a pasta do scratchpad não existir mais, copie de
`~/github/DataCoreHS/src/design-system/` (mesmos bytes) e confira os mesmos
hashes. Qualquer hash diferente: pare e relate.

- [ ] **Step 3: `ORIGEM.md`**

```markdown
# Origem destes arquivos

Cópia fiel do design system publicado no Claude Design.

- **Projeto:** Health & Safety Design System
- **projectId:** `ef9f35f6-3af0-4651-9dee-45d08884432a`
- **Baixado em:** 22/09/2026, pelo DesignSync (só leitura)
- **Arquivos:** `styles.css` e `tokens/{colors,typography,spacing,shape,motion,base}.css`
- **Conferência:** idênticos, por SHA-256, à cópia do DataCoreHS (sync de 25/08/2026)

## Regras

Estes arquivos **não se editam aqui**. Mudança de token acontece no projeto do
Claude Design e desce por novo download. Editar localmente é o caminho
conhecido para os sistemas da H&S divergirem — foi assim que a casa chegou a
quatro azuis diferentes.

Só a versão oficial vale. A cópia do HelpHS carrega emendas (E1–E16-b) que
nunca subiram para o projeto oficial; por decisão do Erick (22/09/2026), o
MarketingHS não as usa.

## Hashes (SHA-256)

<a saída do sha256sum do Step 2>

## Defeitos conhecidos do oficial

Registrados para o Erick decidir no projeto oficial — **não** se corrigem aqui.

- `--text-muted` (slate-500) dá 4,34:1 sobre `--surface-elevated` no tema
  claro — abaixo do AA de 4,5:1.
- `--text-faint` reprova o AA nos dois temas (2,34–2,56:1 no claro).
- Não há `--border-control`: a borda de campo (`--border-color`) fica entre
  1,13:1 e 1,48:1 contra as superfícies, abaixo dos 3:1 da WCAG 1.4.11.
- Não há paleta de gráfico: as séries do `chartTheme.ts` (Fase 1) saem da
  rampa primária e das semânticas.
- `tokens/typography.css` carrega a fonte por `@import url(...)` externo
  dentro de um arquivo que é importado depois de outras regras — ver o que a
  Tarefa 2 mediu sobre a fonte chegar ou não ao navegador.

## O que o MarketingHS faz com eles

`src/index.css` importa `styles.css` antes do `@tailwind` e define a ponte das
variáveis do shadcn para estes tokens. Ver o spec
`docs/superpowers/specs/2026-09-22-marketinghs-visual-design-system-design.md`.
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/design-system
git commit -m "feat(visual): Design System da H&S copiado do projeto oficial, com ORIGEM.md"
```

---

### Tarefa 2: A ponte, a fonte e a limpeza da dn.ia no CSS

**Arquivos:**
- Reescrever: `frontend/src/index.css`
- Modificar: `frontend/tailwind.config.ts`
- Modificar: `frontend/index.html` (carregador de fonte)
- Modificar: `frontend/src/components/admin/AdminLayout.tsx` (classe `theme-dnmarketing`)
- Modificar: `frontend/src/pages/admin/Login.tsx` (classe `theme-dnmarketing`)
- Modificar: `frontend/src/components/ui/card.tsx` (`ds-card`)
- Modificar: os arquivos com `glass-card` (9 ocorrências — `GlobalFilters.tsx`,
  `KPICards.tsx`, `DistributionPieChart.tsx`, `QualificationGauge.tsx` e os
  demais que `grep -rn "glass-card" src` mostrar)

**Interfaces:**
- Consome: os tokens da Tarefa 1.
- Produz: as classes do Tailwind que as fases seguintes usam — as do shadcn
  (`bg-primary`, `bg-card`, `text-muted-foreground`, `border-border`… com
  opacidade funcionando) e as do `adocao.md` (`bg-action`, `bg-action-hover`,
  `bg-action-tint`, `bg-surface`, `bg-surface-base`, `bg-surface-elevated`,
  `border-borda`, `border-borda-muted`, `border-borda-strong`, `text-conteudo`,
  `text-conteudo-heading`, `text-conteudo-muted`, `text-conteudo-faint`,
  `bg-primary-50`…`bg-primary-900`, `rounded-lg` = 8px, `rounded-xl` = 12px,
  `rounded-2xl` = 16px, `font-sans` = Plus Jakarta Sans, `font-mono` = pilha
  do DS).

- [ ] **Step 1: Mapear antes de apagar**

```bash
cd /home/ericks/github/MarketingHS/frontend
for c in section-container section-padding glass-card card-glow mesh-texture rim-light spotlight bottom-glow code-texture concrete-texture section-bg- dot-pattern diagonal-pattern text-gradient animate-fade-in animate-slide-up animate-glow-pulse animate-scroll particle-float light-streak glow-effect-secondary animate-hero-glow ds-card main-grid grid-box theme-dnmarketing theme-fev2425; do
  n=$(grep -rhoE "\b$c[a-z0-9-]*" src --include=*.tsx --include=*.ts | wc -l); echo "$n $c"; done
grep -rhoE "\b(bg|text|border)-(text-secondary|text-muted|overlay|glass|glass-border|background-secondary|background-tertiary|primary-glow)\b" src --include=*.tsx | sort | uniq -c
grep -rhoE "font-(display|blinker)\b" src --include=*.tsx | sort | uniq -c
```

Medido em 22/09: usados no app só `glass-card` (9), `animate-fade-in` (9, que
também existe como animação no `tailwind.config.ts`), `ds-card` (1, em
`card.tsx`) e `theme-dnmarketing` (`AdminLayout.tsx`, `Login.tsx`); nenhuma
classe das variáveis só da dn.ia, nenhum `font-display`/`font-blinker`. Se o
seu mapeamento der diferente, relate antes de apagar.

- [ ] **Step 2: `index.css` novo**

O arquivo inteiro passa a ser (de 885 linhas para isto):

```css
/* Tokens do Design System da Health & Safety — cópia fiel, não se edita.
 * Ver src/design-system/ORIGEM.md. Precisa vir antes do @tailwind. */
@import "./design-system/styles.css";

@tailwind base;
@tailwind components;
@tailwind utilities;

/* Ponte: as variáveis que os componentes shadcn leem viram apelidos dos
 * tokens oficiais. Como os tokens trocam de valor sob `.dark` no <html>, a
 * ponte serve aos dois temas sem regra separada. O Tailwind consome estas
 * variáveis com color-mix (tailwind.config.ts), o que mantém `bg-primary/20`
 * funcionando sobre um token em hexadecimal. */
@layer base {
  :root {
    --background: var(--bg-base);
    --foreground: var(--text-body);

    --card: var(--surface);
    --card-foreground: var(--text-body);
    --popover: var(--surface);
    --popover-foreground: var(--text-body);

    --primary: var(--action);
    --primary-foreground: var(--text-on-primary);

    --secondary: var(--surface-elevated);
    --secondary-foreground: var(--text-heading);
    --muted: var(--surface-elevated);
    --muted-foreground: var(--text-muted);
    --accent: var(--surface-elevated);
    --accent-foreground: var(--text-heading);

    --destructive: var(--color-danger-600);
    --destructive-foreground: var(--color-white);
    --success: var(--color-success-600);
    --success-foreground: var(--color-white);

    --border: var(--border-color);
    --input: var(--border-color);
    --ring: var(--action);

    --radius: var(--radius-lg);
  }

  * {
    @apply border-border;
  }

  body {
    @apply bg-background text-foreground antialiased font-sans;
  }
}
```

Regras que **não** voltam: os blocos `:root`/`.dark` em HSL da dn.ia, os
`@layer components`/`utilities` de efeito (glass, glow, mesh, rim-light,
spotlight, texturas, padrões, gradientes, partículas, streaks, animações de
scroll e glow), `.theme-fev2425`, `.theme-dnmarketing`, o bloco "Mobile
Performance Optimizations" e o "Animated Grid" (`.main-grid`, `.grid-box-*`,
`@keyframes box-*`). `html { scroll-behavior: smooth }` também sai — o DS não
o tem e ele anima posição.

- [ ] **Step 3: `tailwind.config.ts`**

Troque o bloco `theme.extend.colors`, `borderRadius` e `fontFamily` por este
(mantenha `container`, `keyframes`, `animation`, `darkMode: ["class"]`,
`content`, `plugins`):

```ts
// Uma cor de token com suporte a modificador de opacidade (bg-primary/20).
// O token é hexadecimal; color-mix aplica o alfa sem precisar de canais HSL.
const cor = (variavel: string) =>
  `color-mix(in srgb, var(${variavel}) calc(<alpha-value> * 100%), transparent)`;

// ...

      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      colors: {
        // shadcn — apelidos definidos em src/index.css
        border: cor("--border"),
        input: cor("--input"),
        ring: cor("--ring"),
        background: cor("--background"),
        foreground: cor("--foreground"),
        primary: {
          DEFAULT: cor("--primary"),
          foreground: cor("--primary-foreground"),
          50: cor("--color-primary-50"),
          100: cor("--color-primary-100"),
          200: cor("--color-primary-200"),
          300: cor("--color-primary-300"),
          400: cor("--color-primary-400"),
          500: cor("--color-primary-500"),
          600: cor("--color-primary-600"),
          700: cor("--color-primary-700"),
          800: cor("--color-primary-800"),
          900: cor("--color-primary-900"),
        },
        secondary: { DEFAULT: cor("--secondary"), foreground: cor("--secondary-foreground") },
        destructive: { DEFAULT: cor("--destructive"), foreground: cor("--destructive-foreground") },
        success: { DEFAULT: cor("--success"), foreground: cor("--success-foreground") },
        muted: { DEFAULT: cor("--muted"), foreground: cor("--muted-foreground") },
        accent: { DEFAULT: cor("--accent"), foreground: cor("--accent-foreground") },
        popover: { DEFAULT: cor("--popover"), foreground: cor("--popover-foreground") },
        card: { DEFAULT: cor("--card"), foreground: cor("--card-foreground") },
        // Design System — vocabulário do adocao.md, para as telas migradas
        action: { DEFAULT: cor("--action"), hover: cor("--action-hover"), tint: cor("--action-tint") },
        surface: { DEFAULT: cor("--surface"), base: cor("--bg-base"), elevated: cor("--surface-elevated") },
        borda: { DEFAULT: cor("--border-color"), muted: cor("--border-muted"), strong: cor("--border-strong") },
        conteudo: {
          DEFAULT: cor("--text-body"),
          heading: cor("--text-heading"),
          muted: cor("--text-muted"),
          faint: cor("--text-faint"),
        },
        danger: cor("--color-danger-500"),
        warning: cor("--color-warning-500"),
        info: cor("--color-info-500"),
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        "2xl": "var(--radius-2xl)",
      },
```

Saem as cores `background-secondary`, `background-tertiary`, `primary.glow`,
`text-secondary`, `text-muted`, `overlay`, `glass`, `glass-border` (sem uso —
Step 1) e as famílias `blinker` e `display`.

⚠️ `success` do adocao é `var(--color-success-500)` sem `foreground`; aqui
fica o objeto do shadcn (`DEFAULT` + `foreground`) porque `bg-success` e
`text-success-foreground` já são usados. O mesmo vale para `primary`, que
junta o `DEFAULT` do shadcn (→ `--action`) com a rampa do adocao — Decisão 3
do spec.

- [ ] **Step 4: Fonte**

No `index.html`, sai o `<script>` do carregador de Blinker/Rajdhani/Inter/
JetBrains Mono e o `<noscript>` correspondente; os dois `preconnect` ficam.

Depois do build, **confira no navegador que a Plus Jakarta Sans chega**:
`document.fonts.check('14px "Plus Jakarta Sans"')` deve dar `true` e a
requisição a `fonts.googleapis.com/css2?family=Plus+Jakarta+Sans` deve
aparecer na rede. O `tokens/typography.css` a carrega por `@import url(...)`
externo; se o Vite/PostCSS deixar esse `@import` depois de outras regras, o
navegador o ignora. **Se a fonte não chegar**, não edite o token: acrescente
no `index.html`

```html
<!-- Plus Jakarta Sans, a fonte do Design System. O @import de
     design-system/tokens/typography.css não sobrevive ao bundle — ver ORIGEM.md. -->
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" />
```

e registre o achado no `ORIGEM.md` (seção de defeitos conhecidos, último item
— troque o texto provisório pelo que mediu).

- [ ] **Step 5: Tirar as classes da dn.ia das telas**

- `AdminLayout.tsx`: sai o `useEffect` que põe `theme-dnmarketing` no
  `document.body` (e o comentário sobre portais — a ponte agora mora no
  `:root`, que os portais do Radix herdam) e a classe `theme-dnmarketing` do
  `<div>` raiz.
- `Login.tsx`: sai `theme-dnmarketing` do `<div>` raiz.
- `card.tsx`: sai `ds-card` do `className` base.
- `glass-card` (9 ocorrências): a classe sai. Onde ela era a única pele do
  elemento (sem `bg-*`/`border`), troque por `bg-card border rounded-xl` —
  o card do DS. Onde o elemento já é um `<Card>`, só remova a classe.
- `animate-fade-in` **fica**: é a animação `fade-in` do `tailwind.config.ts`,
  entrada única, não laço. (A duplicata em `index.css` saiu no Step 2.)
- Se o `AdminLayout` tiver `backdrop-blur-sm` na faixa de filtros, **fica** por
  enquanto — é casca, Fase 1.

- [ ] **Step 6: Build**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.app.json; npx vite build && npm run build:landing
grep -rn "theme-dnmarketing\|theme-fev2425\|glass-card\|ds-card\|text-gradient\|Blinker\|Rajdhani" src index.html tailwind.config.ts
```

Esperado: 4 erros de `tsc` (os de sempre); os dois builds ok; o `grep` vazio.

- [ ] **Step 7: Conferência rápida**

Abra `/`, `/contacts` e um diálogo qualquer (ex.: filtros de contatos): fundo
`#F8FAFC`, cards brancos com borda, botão primário `#1A71A8`, fonte Plus
Jakarta Sans, o diálogo (portal) com as mesmas cores. Console sem erro.

- [ ] **Step 8: Commit**

```bash
git add -A frontend
git commit -m "feat(visual): ponte shadcn → tokens do Design System; sai o tema da dn.ia"
```

---

### Tarefa 3: Tema claro e escuro

**Arquivos:**
- Criar: `frontend/src/lib/tema.ts`
- Modificar: `frontend/index.html` (script antes do React)
- Modificar: `frontend/src/main.tsx` (sincronizar ao montar)

**Interfaces:**
- Produz (a Fase 1 usa na chave da topbar):
  - `type Tema = 'claro' | 'escuro'`
  - `lerTema(): Tema`
  - `aplicarTema(tema: Tema): void`
  - `alternarTema(): Tema`
  - `CHAVE_TEMA = 'marketinghs-tema'`

- [ ] **Step 1: `lib/tema.ts`**

```ts
// Tema claro (padrão do Design System) ou escuro (navy), pela classe `dark`
// no <html>. Tem de ser no <html>: a ponte do index.css e os tokens do DS
// estão no :root, e o .dark precisa cair no mesmo elemento.
//
// Sem escolha salva, o claro — não prefers-color-scheme: o DS define o claro
// como o tema de trabalho.

export type Tema = 'claro' | 'escuro';

export const CHAVE_TEMA = 'marketinghs-tema';

export function lerTema(): Tema {
  try {
    return localStorage.getItem(CHAVE_TEMA) === 'escuro' ? 'escuro' : 'claro';
  } catch {
    return 'claro';
  }
}

export function aplicarTema(tema: Tema): void {
  document.documentElement.classList.toggle('dark', tema === 'escuro');
  try {
    localStorage.setItem(CHAVE_TEMA, tema);
  } catch {
    // navegação privada ou armazenamento bloqueado: o tema vale só nesta aba
  }
}

export function alternarTema(): Tema {
  const novo: Tema = lerTema() === 'escuro' ? 'claro' : 'escuro';
  aplicarTema(novo);
  return novo;
}
```

- [ ] **Step 2: Script anti-piscada no `index.html`**

No `<head>`, antes de qualquer `<link>` de estilo:

```html
<!-- Aplica o tema salvo antes do React montar, para a tela não piscar
     branca no tema escuro. Mesma chave de src/lib/tema.ts. -->
<script>
  try {
    if (localStorage.getItem('marketinghs-tema') === 'escuro') {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
</script>
```

- [ ] **Step 3: `main.tsx`**

Antes do `createRoot(...)`, `aplicarTema(lerTema())` — garante que classe e
armazenamento concordam mesmo se o script do `index.html` falhar.

- [ ] **Step 4: Conferir os dois temas**

No navegador, em `/`: sem chave salva → claro. No console,
`localStorage.setItem('marketinghs-tema','escuro')` e recarregue → navy
(`#0D1B2A` de fundo, cards `#132238`, ação `#47A6E1`), sem clarão branco ao
recarregar. Abra um diálogo no escuro: navy também. Volte para `claro`.

- [ ] **Step 5: Build e commit**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.app.json; npx vite build
git add frontend/src/lib/tema.ts frontend/index.html frontend/src/main.tsx
git commit -m "feat(visual): tema claro por padrão e escuro navy pela classe dark no html"
```

---

### Tarefa 4: O guarda visual

**Arquivos:**
- Criar: `frontend/scripts/guarda-visual.mjs`
- Modificar: `frontend/package.json` (script `guarda:visual`)

**Interfaces:**
- Produz: `npm run guarda:visual [-- <pasta>]` — imprime a contagem por pasta e
  o total; com `<pasta>`, só aquela área, e **sai com código 1 se a contagem
  da área não for zero**. As Fases 1 e 2 usam no portão.

- [ ] **Step 1: Achar as exceções**

A Decisão 6 do spec isenta o conteúdo de e-mail e o preview de landing.
Encontre os arquivos exatos:

```bash
cd /home/ericks/github/MarketingHS/frontend
grep -rln "BASE_EMAIL_DESIGN\|<table\|bgcolor\|email.*html\|html.*email" src --include=*.ts --include=*.tsx
grep -rln "Landing\b\|from ['\"]@/landing\|landing/" src --include=*.tsx | grep -v "^src/landing/"
```

Inclua na lista **só** arquivos cujo hexadecimal acaba em HTML de e-mail ou
na landing pública — não telas do admin que por acaso falam de e-mail. Cada
exceção leva um comentário no script dizendo por quê. `src/landing/` inteira é
exceção (bundle público, `landing.css` próprio).

- [ ] **Step 2: O script**

```js
#!/usr/bin/env node
// Guarda visual do MarketingHS — conta cor fora de token no admin.
//
// Conta, por pasta, (1) hexadecimal de 3 ou 6 dígitos e (2) cor literal do
// Tailwind (bg-blue-600, text-emerald-500…) em src/**/*.ts(x). A regra do
// Design System é "nenhum hexadecimal no JSX — cor sai de token".
//
// Uso:  npm run guarda:visual                 → relatório do app inteiro
//       npm run guarda:visual -- src/components/admin/dashboard
//                                              → só a área; sai 1 se não for zero
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const RAIZ = new URL('..', import.meta.url).pathname;
const SRC = join(RAIZ, 'src');

// Exceções da Decisão 6 do spec — cada uma com o motivo.
const EXCECOES = [
  'src/landing/', // bundle público da landing, com landing.css próprio
  'src/design-system/', // os tokens oficiais são, por definição, os hexadecimais
  // <arquivos achados no Step 1, um por linha, com o motivo em comentário>
];

const HEX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;
const LITERAL =
  /\b(?:bg|text|border|ring|from|via|to|fill|stroke|outline|divide|placeholder|decoration|shadow|accent|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;

function* arquivos(dir) {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) yield* arquivos(caminho);
    else if (/\.(ts|tsx)$/.test(nome)) yield caminho;
  }
}

const rel = (p) => relative(RAIZ, p).split(sep).join('/');
const isento = (p) => EXCECOES.some((e) => rel(p).startsWith(e));

const area = process.argv[2]?.replace(/\/$/, '');
const porPasta = new Map();
let total = 0;

for (const arquivo of arquivos(SRC)) {
  const r = rel(arquivo);
  if (isento(arquivo)) continue;
  if (area && !r.startsWith(area)) continue;
  const texto = readFileSync(arquivo, 'utf8');
  const n = (texto.match(HEX)?.length ?? 0) + (texto.match(LITERAL)?.length ?? 0);
  if (n === 0) continue;
  const pasta = r.split('/').slice(0, -1).join('/');
  porPasta.set(pasta, (porPasta.get(pasta) ?? 0) + n);
  total += n;
}

for (const [pasta, n] of [...porPasta].sort((a, b) => b[1] - a[1])) {
  console.log(String(n).padStart(5), pasta);
}
console.log(String(total).padStart(5), area ? `total em ${area}` : 'total');

if (area && total > 0) process.exit(1);
```

Ajuste o regex só se o Step 3 mostrar falso positivo real (ex.: `#fff` dentro
de texto que não é cor) — e registre.

- [ ] **Step 3: Rodar e anotar o ponto de partida**

```bash
cd frontend
npm pkg set scripts.guarda:visual="node scripts/guarda-visual.mjs"
npm run guarda:visual
npm run guarda:visual -- src/components/admin/segments; echo "saída: $?"
```

O relatório inteiro vai para o relatório da tarefa — é o placar de partida das
Fases 1 e 2. `segments/` tinha 0 em 22/09: a segunda linha deve sair com
código 0. Rode também numa pasta com dívida (`src/components/admin/dashboard`)
e confira o código 1.

- [ ] **Step 4: Commit**

```bash
git add frontend/scripts/guarda-visual.mjs frontend/package.json
git commit -m "feat(visual): guarda que conta cor fora de token, por área"
```

---

### Tarefa 5: O portão da Fase 0 e o registro

**Arquivos:**
- Modificar: `CLAUDE.md`
- Modificar: `docs/CONTINUAR-AQUI.md`

- [ ] **Step 1: Buscas e builds**

```bash
cd /home/ericks/github/MarketingHS/frontend
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"   # 4
npx vite build && npm run build:landing
(cd src/design-system && sha256sum styles.css tokens/*.css)        # os 7 hashes da Tarefa 1
git diff main --stat -- src/design-system                           # só arquivos novos
grep -rn "theme-dnmarketing\|theme-fev2425\|glass-card\|Blinker\|Rajdhani\|Outfit" src index.html tailwind.config.ts
npm run guarda:visual
```

- [ ] **Step 2: As 16 telas nos dois temas**

Screenshots em `.../visual-f0/depois-claro/` e `.../visual-f0/depois-escuro/`.
Para cada tela: abre sem erro de console; nenhum layout se moveu em relação ao
"antes" (mesmos blocos nos mesmos lugares — muda cor e fonte, não posição);
diálogos, selects e sheets (portais) seguem o tema.

Anote, por tela, **o que ficou ilegível ou estranho** (ex.: texto claro que
era pensado para o fundo escuro da dn.ia, cor literal gritando no fundo
branco). **Não corrija** — é dívida da Fase 1 ou 2, e a lista vira insumo do
plano delas. Só é defeito desta fase o que a ponte, o tema ou a limpeza
quebraram (ex.: componente sem cor por `color-mix`, portal com tema errado,
fonte ausente).

- [ ] **Step 3: A tela faz o que fazia**

```bash
git diff main -- src ':!src/design-system' ':!src/index.css' | grep "^[-+]" | grep -v "^[-+][-+]"
```

Toda linha tem de ser classe, `useEffect` de tema do `AdminLayout`, import ou
comentário. Qualquer mudança de lógica, rota, API ou texto é defeito.

- [ ] **Step 4: `CLAUDE.md`**

Acrescente uma seção curta, depois de "As regras que não se quebram":

```markdown
## Visual

O visual vem do **Design System da Health & Safety** (projeto
`ef9f35f6-3af0-4651-9dee-45d08884432a` no Claude Design), copiado em
`frontend/src/design-system/` — **não se edita ali**; ver `ORIGEM.md`. Só a
versão oficial vale, nunca a cópia do HelpHS.

**Nenhum hexadecimal nem cor literal do Tailwind no JSX — cor sai de token.**
As classes do shadcn (`bg-primary`, `text-muted-foreground`…) já apontam para
os tokens pela ponte do `index.css`; para o resto, o vocabulário do
`adocao.md` (`bg-action`, `bg-surface`, `text-conteudo-muted`,
`border-borda`…). Exceções: HTML de e-mail e a landing pública.
`npm run guarda:visual -- <pasta>` diz se uma área está limpa.

Tema: claro por padrão; escuro pela classe `dark` no `<html>`
(`src/lib/tema.ts`) — nunca no `<body>`.
```

- [ ] **Step 5: `CONTINUAR-AQUI.md`**

Bloco novo no topo: `> ## ✅ Visual — Fase 0 (fundação), <data>` com o que
entrou, o placar do guarda (total e por pasta), o resultado da fonte (Tarefa
2, Step 4), a lista de telas com dívida visual anotada no Step 2, e o próximo
passo: Fase 1 (casca, login, primitivos, `chartTheme`). Branch
`visual-fase-0`, aguardando merge com o Erick.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/CONTINUAR-AQUI.md
git commit -m "docs(visual): Fase 0 fechada — Design System instalado, ponte e tema"
```
