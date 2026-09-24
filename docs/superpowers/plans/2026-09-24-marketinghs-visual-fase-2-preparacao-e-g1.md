# MarketingHS — Visual, Fase 2: preparação e G1 (Visão geral e Analytics) — Plano

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para executar tarefa a tarefa.
> Os passos usam caixa de seleção (`- [ ]`) para acompanhamento.

**Objetivo:** o guarda visual passa a enxergar `white`/`black`, o código morto
de gráfico sai, o `Badge` ganha as tintas que faltam, e as telas `/` e
`/analytics` (as cinco abas) saem do guarda com **zero** — toda cor de token,
sem gradiente, sem brilho decorativo, sem sombra em superfície estática, sem
emoji. O comportamento de cada tela fica **igual**.

**Arquitetura:** a Fase 1 deixou primitivos e casca no desenho oficial; as
telas ainda carregam a cor da dn.ia escrita à mão (`text-emerald-500`,
`bg-amber-500/10`, `from-[#25D366]`). Esta fase troca cada cor literal por um
token **pelo significado**, seguindo uma tabela única de tradução (abaixo),
pasta a pasta de `components/admin/dashboard/`. A única mudança de API é
**aditiva**: três variantes novas no `Badge`.

**Stack:** React 18 · Vite · TypeScript · Tailwind 3.4.17 · shadcn/ui (Radix) · recharts · Playwright

**Spec:** `docs/superpowers/specs/2026-09-22-marketinghs-visual-design-system-design.md` (Fase 2, grupo G1)
**Fase anterior:** `docs/superpowers/plans/2026-09-22-marketinghs-visual-fase-1-casca-primitivos.md`
**Dívida herdada:** `docs/CONTINUAR-AQUI.md`, bloco "Visual — Fase 1", seções
"Dívida anotada" e "Fica para a Fase 2".

**Branch:** `visual-fase-2`, criada a partir de `visual-fase-1` (que ainda não
foi mergeada — o merge é decisão do Erick). Se a `visual-fase-1` for mergeada
no meio do caminho, `git rebase main` na `visual-fase-2`.

---

## Restrições globais

- ⚠️ **A tela faz o que fazia.** O `git diff` de cada tarefa mostra só classe,
  cor, token e marcação de apresentação. **Nenhuma** lógica, rota, chamada de
  API, condição, `useState`, `onClick`, texto de dado ou limiar numérico muda.
  Se um conserto visual exigir mudar lógica, **pare e relate**.
- ⚠️ **Os arquivos de `frontend/src/design-system/` não se editam.** Defeito do
  Design System vira linha em `ORIGEM.md` e pergunta ao Erick.
- **Cor sai de token**, pela tabela de tradução abaixo. Nenhum hexadecimal,
  cor literal do Tailwind (inclusive `white`/`black`), `hsl()`/`rgb()`
  numérico. Em SVG e em `style={{}}` (onde classe não chega), o token entra
  como string: `'var(--color-success-500)'`, `'var(--text-muted)'`,
  `'var(--surface)'`, ou `serie(i)` de `@/lib/chartTheme`.
- **Nada de gradiente** (`bg-gradient-*`, `from-*`, `via-*`, `to-*`,
  `bg-clip-text text-transparent`): vira cor chapada — o tom de partida do
  gradiente, traduzido pela tabela.
- **Nada de brilho decorativo:** `div` absoluto com `blur-*` e `opacity-*`
  só para enfeite sai inteiro. `backdrop-blur` e `glass` saem (o DS só
  permite blur no fundo do modal, que já está no primitivo).
- **Nada de sombra em superfície estática.** `shadow-*` sai de `Card` e de
  `div` de conteúdo. Sombra só em modal, lista flutuante, aba ativa e tooltip —
  e esses já vêm do primitivo.
- **Nenhum texto abaixo de 12px:** `text-[10px]`, `text-[11px]` → `text-xs`.
- **Ícone é componente, nunca emoji.** Emoji decorativo no fim de frase sai
  (a frase fica). Emoji que carrega sentido (⚠️, 💎) vira ícone
  `lucide-react` (`AlertTriangle`, `Gem`) de `h-3.5 w-3.5`, inline, com a cor
  do texto em volta. Nenhuma outra palavra da frase muda.
- **`animate-spin` e `animate-fade-in` ficam** (spinner e entrada única). Nada
  anima em laço fora spinner.
- **`focus-visible`, nunca `focus:`**.
- **Comentário, nome e mensagem em português.**
- **Frontend:** `cd frontend && npx tsc --noEmit -p tsconfig.app.json && npx vite build && npm run build:landing`.
  `tsc` tem **4 erros pré-existentes** (`LeadScoringSettings` ×1,
  `useJourneys` ×3); nenhum novo.
- **Guarda:** `npm run guarda:visual -- <pasta>` sai 0 na pasta da tarefa.
- **Navegador:** Playwright; backend 8100 e Vite `127.0.0.1:8080`; login com a
  conta admin do Claude (`~/.config/marketinghs/claude-admin.env`); **só
  navegar por URL, ler, usar o console e abrir diálogos/menus de
  visualização — nunca clicar em botão de ação** (salvar, arquivar, excluir,
  ativar, enviar, lápis de edição, ícones sem rótulo). Nenhuma escrita no
  banco. Tema pelo `localStorage` (`marketinghs-tema` = `claro`/`escuro`);
  deixe `claro` no fim.
- **Toda tarefa de tela confere no claro E no escuro, com screenshot "antes"
  tirado ANTES da primeira edição** (em `/tmp/…/scratchpad` da sessão, não no
  repositório).

## Tabela de tradução (contrato das Tarefas 3-7)

A cor da dn.ia é traduzida **pelo que ela significa na tela**, não pelo
matiz. Leia o contexto (o limiar, o rótulo, o ícone) antes de trocar.

| Literal de origem | Significado | Texto sobre superfície | Fundo (tinta) | Borda |
|---|---|---|---|---|
| `green-*`, `emerald-*`, `lime-*`, `teal-*`, `#10B981`, `#25D366`, `#128C7E` | bom, meta, Hot, sucesso, WhatsApp | `text-[--on-tint-success]` | `bg-[--tint-success]` | `border-success/30` |
| `amber-*`, `yellow-*`, `orange-*` | atenção, Warm, médio | `text-[--on-tint-warning]` | `bg-[--tint-warning]` | `border-warning/30` |
| `red-*`, `rose-*` | ruim, alerta, erro | `text-[--on-tint-danger]` | `bg-[--tint-danger]` | `border-danger/30` |
| `blue-*`, `sky-*`, `cyan-*` | informação, neutro-positivo | `text-[--on-tint-info]` | `bg-[--tint-info]` | `border-info/30` |
| `purple-*`, `violet-*`, `indigo-*`, `fuchsia-*`, `pink-*` | destaque, IA, "especial" (o DS não tem roxo) | `text-[--on-tint-primary]` | `bg-[--tint-primary]` | `border-primary/30` |
| `slate-*`, `gray-*`, `zinc-*`, `neutral-*` | neutro, Raw, sem dado | `text-conteudo-muted` | `bg-[--tint-neutral]` | `border-borda` |
| `text-white` sobre fundo de ação/cor cheia | texto em cor cheia | `text-primary-foreground` | — | — |
| `bg-white`, `bg-black/…` | superfície / véu | `bg-surface` / `bg-[--overlay]` | — | — |

Regras de uso da tabela:

- **Por que `--on-tint-*` e não `text-success`** para texto solto: o
  `-500` sobre fundo claro não passa contraste AA; o `--on-tint-*` é o `-700`
  no claro e o `-400` no escuro, e o próprio DS o troca por tema.
- **Qualquer opacidade de tinta de origem (`/10`, `/15`, `/20`) vira a tinta
  do DS** (`--tint-*` já é 15%). Não preservar `/10` contra `/20`.
- **Rampa de intensidade** (heatmap, barra com `/40`, `/60`, `/80`) é
  **ordinal**: preserve a ordem com a cor cheia do token e a mesma opacidade —
  `bg-amber-500/60` → `bg-warning/60`, `bg-green-500/80` → `bg-success/80`,
  `bg-purple-500/40` → `bg-primary/40`. (`warning`, `success`, `danger`,
  `info` e `primary` aceitam `/NN` pela ponte `color-mix` do
  `tailwind.config.ts`.)
- **Barra de progresso / preenchimento cheio** (`bg-green-500`,
  `from-amber-500 to-yellow-400`) → `bg-success`, `bg-warning` etc., chapado.
- **Hot/Warm/Raw** seguem o que a Fase 1 fixou em
  `operational/SourceQualificationChart.tsx` (`COR_HOT`, `COR_WARM`,
  `COR_RAW`): leia as três constantes e use as mesmas.
- **`dark:`** onde há token equivalente sai: o token já troca por tema.
- **Card com `bg-gradient-to-br from-card … to-primary/10 border-border/50
  shadow-lg`** → só `<Card>` sem `className` de cor/sombra (o primitivo já é
  `bg-card border-border` sem sombra). Classes de layout (`overflow-hidden`,
  `h-full`) ficam.
- Hexadecimal de **marca de terceiro** (WhatsApp) **não** é exceção: vira
  sucesso. Decisão desta fase, reversível; registrada no fim.

## Review Focus

1. **Sentido invertido na tradução** — um valor ruim que sai verde ou um bom
   que sai vermelho porque a cor foi traduzida pelo matiz sem ler o limiar.
   Cada tarefa lista, no relatório, toda função que escolhe cor por limiar
   (`getColor`, `getStatus…`, ternários de classe) com os limiares e o token
   de cada faixa, e confere no navegador pelo menos uma faixa de cada.
2. **Texto ilegível no escuro** — tinta de 15% com texto `-500` herdado, ou
   texto `text-primary-foreground` fora de fundo cheio. Screenshot no escuro de
   cada card tocado; texto sobre tinta usa sempre o `--on-tint-*` do mesmo par.
3. **Rampa que perdeu a ordem** — heatmap (`TemporalHeatmap`,
   `ThemeQualityHeatmap`) em que duas faixas vizinhas passaram a ter a mesma
   cor. Conferido abrindo o heatmap nos dois temas e listando no relatório a
   escala antes → depois.
4. **Classe que não existe** — token escrito com nome errado
   (`text-[--on-tint-sucess]`, `text-chart-2`) não quebra o build: só some a
   cor. Conferido pelo passo de `getComputedStyle` de cada tarefa e pelo grep
   de `-chart-[0-9]`.
5. **Filtro global quebrado** — `GlobalFilters.tsx` (Tarefa 3) é usado em quase
   toda rota pela casca. Conferido abrindo `/`, `/analytics` e `/contacts` com
   o popover de datas e o seletor de origem abertos (abrir é permitido;
   aplicar filtro também — é leitura), nos dois temas.

---

### Tarefa 1: O guarda enxerga `white` e `black`

**Arquivos:**
- Modificar: `frontend/scripts/guarda-visual.mjs:36-37`
- Modificar: `docs/CONTINUAR-AQUI.md` (placar de partida da Fase 2)

**Interfaces:**
- Produz: `npm run guarda:visual` contando também `bg-white`, `text-black/80`
  etc. As Tarefas 3-7 dependem de o zero ser verdadeiro.

- [ ] **Step 1: Medir o que o guarda não vê hoje**

```bash
cd /home/ericks/github/MarketingHS/frontend
npm run -s guarda:visual | tail -1          # esperado: 825 total
grep -rnoE "\b(bg|text|border|ring|from|via|to|fill|stroke|outline|divide|placeholder|decoration|shadow|accent|caret)-(white|black)(/[0-9]+)?\b" src --include=*.ts --include=*.tsx \
  | grep -v "src/landing/\|src/design-system/\|emailEditorConfig" | wc -l
```

Esperado: **63** (medido em 24/09; o bloco da Fase 1 dizia 43 porque o grep
manual só olhava `bg/text/border`). Anote o número exato.

- [ ] **Step 2: Estender a regex**

Troque `LITERAL` por:

```js
// `white` e `black` não têm número (bg-white, text-black/80) — antes ficavam
// fora da conta, e o "0" do guarda não provava ausência de cor literal.
const LITERAL =
  /\b(?:bg|text|border|ring|from|via|to|fill|stroke|outline|divide|placeholder|decoration|shadow|accent|caret)-(?:(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}|white|black)\b/g;
```

- [ ] **Step 3: Provar que subiu exatamente o que devia**

```bash
npm run -s guarda:visual | tail -1
```

Esperado: `825 + <número do Step 1>` (888 se o Step 1 deu 63). Se não bater,
a diferença é um prefixo que um regex tem e o outro não — conserte antes de
seguir. Confira também que a regex **não** pega `bg-white-ish` inventado nem
`text-whitespace` (o `\b` depois de `white` garante; `whitespace-nowrap` não
tem prefixo de cor):

```bash
node -e "const r=/\b(?:bg|text)-(?:white|black)\b/g; console.log('whitespace-nowrap text-white/80 bg-black'.match(r))"
```

Esperado: `[ 'text-white', 'bg-black' ]`.

- [ ] **Step 4: Registrar e commitar**

No `docs/CONTINUAR-AQUI.md`, na "Dívida anotada" da Fase 1, marque o ponto
cego como resolvido com o novo placar de partida (total e
`src/components/admin/dashboard`).

```bash
cd /home/ericks/github/MarketingHS
git add frontend/scripts/guarda-visual.mjs docs/CONTINUAR-AQUI.md
git commit -m "fix(visual): guarda passa a contar white e black"
```

---

### Tarefa 2: Código morto de gráfico sai; `Badge` ganha as tintas que faltam

**Arquivos:**
- Apagar: `frontend/src/components/admin/LeadsChart.tsx`
- Apagar: `frontend/src/components/ui/chart.tsx`
- Modificar: `frontend/src/components/ui/badge.tsx` (bloco `variants`)

**Interfaces:**
- Produz: `<Badge variant="success" | "warning" | "info">`, além das quatro que
  já existem (`default`, `secondary`, `destructive`, `outline`, que **não
  mudam**). As Tarefas 3-7 usam essas variantes em vez de repetir
  `bg-[--tint-*] text-[--on-tint-*]` em cada `Badge`.

- [ ] **Step 1: Provar que ninguém importa os dois arquivos**

```bash
cd /home/ericks/github/MarketingHS/frontend
grep -rn "LeadsChart\b" src --include=*.ts --include=*.tsx | grep -v "^src/components/admin/LeadsChart.tsx"
grep -rn "ui/chart['\"]\|ui/chart\b" src --include=*.ts --include=*.tsx | grep -v "^src/components/admin/LeadsChart.tsx"
grep -rn "ChartContainer\|ChartTooltipContent\|ChartLegendContent" src --include=*.tsx | grep -v "^src/components/ui/chart.tsx\|^src/components/admin/LeadsChart.tsx"
```

Esperado: **nenhuma linha** nos três. Se aparecer qualquer uma, **pare e
relate** — não apague.

- [ ] **Step 2: Apagar**

```bash
git rm src/components/admin/LeadsChart.tsx src/components/ui/chart.tsx
```

- [ ] **Step 3: Variantes novas do `Badge`**

No objeto `variant` de `badge.tsx`, **depois** de `outline`, acrescente
(mesmo desenho das existentes: tinta, texto na tinta, borda da cor a 30%):

```ts
        success: "bg-[--tint-success] text-[--on-tint-success] border-success/30",
        warning: "bg-[--tint-warning] text-[--on-tint-warning] border-warning/30",
        info: "bg-[--tint-info] text-[--on-tint-info] border-info/30",
```

Nada mais no arquivo muda (o `forwardRef` que falta é dívida registrada, não
desta tarefa).

- [ ] **Step 4: Portão**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"   # esperado: 4
npx vite build && npm run build:landing
npm run -s guarda:visual -- src/components/ui                        # esperado: 1 (drawer.tsx bg-black/80)
```

O guarda de `ui` cai de 5 para 0 pelos seletores de `chart.tsx` e sobe 1 pelo
`bg-black/80` do `drawer.tsx`, que a Tarefa 1 passou a enxergar. Troque-o
agora por `bg-[--overlay]` (o fundo de modal oficial; o `dialog.tsx` já usa o
mesmo) e rode de novo: esperado **0**.

- [ ] **Step 5: Commit**

```bash
cd /home/ericks/github/MarketingHS
git add -A frontend/src/components/ui frontend/src/components/admin/LeadsChart.tsx
git commit -m "refactor(visual): tira chart.tsx e LeadsChart órfãos; Badge ganha success, warning e info"
```

---

### Procedimento comum às Tarefas 3-7 (cada tarefa aponta para cá)

Cada tarefa de tela segue estes passos, na ordem. A tarefa diz **quais
arquivos**, **quais rotas** e **o que é peculiar** a ela.

- [ ] **A. Antes de editar — medir e fotografar**

```bash
cd /home/ericks/github/MarketingHS/frontend
npm run -s guarda:visual -- <pasta>        # anote o número
grep -rnE "bg-gradient|from-|backdrop-blur|glass|blur-(sm|md|lg|xl|2xl|3xl)|shadow-(sm|md|lg|xl|2xl)|text-\[(8|9|10|11)px\]|dark:|-chart-[0-9]" <arquivos> | wc -l
```

No navegador, abra cada rota da tarefa, a 1440 px, e tire screenshot de
página inteira no **claro** e no **escuro** antes de tocar em qualquer
arquivo. Anote qualquer erro de console que já exista.

- [ ] **B. Listar as funções de cor por limiar**

Para cada arquivo, liste no relatório toda função ou ternário que escolhe
classe/cor a partir de dado (`getColor`, `getStatusColor`, `value >= 80 ? …`),
com o limiar e a cor de origem de cada faixa. É daqui que sai a tradução por
significado (Review Focus 1). **O limiar não muda; só a classe.**

- [ ] **C. Traduzir**

Arquivo por arquivo, aplique a **Tabela de tradução** e as restrições
globais. Onde houver `<Badge className="bg-emerald-500/20 text-emerald-400
…">`, prefira `<Badge variant="success">` e tire as classes de cor
redundantes (as de layout ficam).

- [ ] **D. Guarda e busca complementar**

```bash
npm run -s guarda:visual -- <pasta>        # esperado: 0 (sai 1 se não for)
grep -rnE "bg-gradient|from-\[|to-\[|backdrop-blur|glass|shadow-(md|lg|xl|2xl)|text-\[(8|9|10|11)px\]|-chart-[0-9]|bg-clip-text" <arquivos>
```

Esperado no grep: **nenhuma linha**. `shadow-sm` e `shadow-lg` só se forem
de aba ativa, tooltip ou lista flutuante — se sobrar algum, justifique no
relatório.

```bash
grep -nP "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]" <arquivos> | grep -v "^\S*:\s*//"
```

Esperado: **nenhuma linha** fora de comentário.

- [ ] **E. Frontend compila**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"   # esperado: 4
npx vite build
```

- [ ] **F. No navegador, nos dois temas**

Abra cada rota da tarefa no claro e no escuro, screenshot de página inteira,
e compare com o "antes":
- nenhum card, número, gráfico, botão ou badge sumiu (**a tela faz o que
  fazia**; conte os elementos por card se houver dúvida);
- nenhum texto ilegível (Review Focus 2);
- zero erro de console novo;
- para pelo menos um elemento de cada token novo usado, confira que a cor
  existe de fato (Review Focus 4):

```js
// no console do Playwright (browser_evaluate), trocando o seletor
getComputedStyle(document.querySelector('<seletor>')).color
```

Esperado: uma cor resolvida, não `rgb(0, 0, 0)` herdado nem vazio onde se
esperava tinta.

- [ ] **G. Diff só de apresentação**

```bash
cd /home/ericks/github/MarketingHS
git diff -- <arquivos> | grep -E "^[+-]" | grep -vE "^(\+\+\+|---)" \
  | grep -vE "className|class=|style=|stroke=|fill=|color:|variant=|<(div|span|Card|Badge)|^\s*[+-]\s*$|lucide-react|//"
```

Leia cada linha que sobrar: tem de ser marcação de apresentação (ícone novo,
emoji tirado de string, `div` de brilho removido). Se for lógica, condição,
texto de dado ou limiar, **desfaça**.

- [ ] **H. Commit**

```bash
git add <arquivos>
git commit -m "feat(visual): <área> sai do guarda — cor de token, sem gradiente nem brilho"
```

---

### Tarefa 3: Filtros globais, ficha do lead e Visão geral (`/`)

**Arquivos (`frontend/src/components/admin/dashboard/`):**
- `GlobalFilters.tsx`, `LeadDetailModal.tsx` (raiz: 38 no guarda)
- `overview/KPICards.tsx`, `overview/DailyVolumeCard.tsx`,
  `overview/ForecastCard.tsx`, `overview/QualificationGauge.tsx`,
  `overview/OverviewTab.tsx`, `overview/LeadGoalGauge.tsx` e o que mais o
  guarda apontar em `overview/` (61 no guarda, antes da Tarefa 1)

**Rotas:** `/` · `/analytics` e `/contacts` (só para o filtro global) · a
ficha do lead (`LeadDetailModal`) — descubra por leitura de código de onde
ela abre e abra por um caminho de visualização (clicar num nome/linha de
lista que só abre a ficha é permitido; ícone sem rótulo, não).

**Pasta do guarda:** rode `-- src/components/admin/dashboard/overview` e
confira a raiz com
`npm run -s guarda:visual -- src/components/admin/dashboard | grep -E "dashboard$"`
(esperado: nenhuma linha com a raiz, ou `0`).

**Peculiar a esta tarefa:**
- `KPICards.tsx` — o card "Grupo WhatsApp": o `div` de brilho absoluto
  (`-top-10 -right-10 … blur-2xl`) **sai inteiro**; a caixa do ícone
  (`bg-gradient-to-br from-[#25D366] to-[#128C7E]`) vira
  `bg-[--tint-success]` com o ícone `text-[--on-tint-success]` (não
  `text-white`); o `text-[#25D366]` do percentual vira
  `text-[--on-tint-success]`. Os mesmos brilhos nos outros KPIs, se houver,
  saem igual. O lápis de edição **não se clica** no navegador.
- `KPICards.tsx` e `LeadGoalGauge.tsx` — `text-chart-2` (4 ocorrências no
  app, todas aqui) é classe **morta**: `chart-*` não existe mais no
  `tailwind.config.ts`, então o ícone de confirmar está sem cor hoje.
  `text-chart-2 hover:text-chart-2/80` → `text-success hover:text-success/80`.
  É a única exceção à regra do `--on-tint-*`: o `--on-tint-*` é variável crua
  e não aceita `/80`, e aqui é ícone de ação de 16 px sobre superfície
  (contraste de elemento gráfico, 3:1, que o `-500` passa). Mesma troca nas
  outras 3 ocorrências.
- `QualificationGauge.tsx` — o ponteiro SVG em `hsl(0, 0%, 100%)` e o trilho
  em `hsl(0, 0%, 20%)` viram `'var(--surface)'` e `'var(--border-strong)'`;
  o `getColor()` segue a Tabela pelo significado (Passo B).
- `ForecastCard.tsx` e `DailyVolumeCard.tsx` — emoji no fim das frases
  (`'No ritmo! 🎯'`, `'Quase lá ⚡'`, `'Acelerar! 🚀'`, `'Meta batida! 🎉'`)
  sai; a frase fica (`'No ritmo!'`…).
- `OverviewTab.tsx:450` — o `⚠️` da nota de teto de agendamentos vira
  `<AlertTriangle className="inline h-3.5 w-3.5" />` antes da frase.
- `LeadDetailModal.tsx` — o `DialogContent` com gradiente fica só com as
  classes de layout (`max-w-2xl max-h-[90vh] p-0 gap-0`); os três blocos de
  métrica (`from-emerald-500/10`, `from-blue-500/10`, `from-purple-500/10`)
  viram `bg-[--tint-success]`, `bg-[--tint-info]`, `bg-[--tint-primary]` com a
  borda do mesmo par.

Siga o **Procedimento comum**, passos A a H. Commit:
`feat(visual): Visão geral e filtros globais saem do guarda`.

---

### Tarefa 4: Analytics — Perfil e Tático (`/analytics?tab=profile`, `?tab=tactical`)

**Arquivos (`frontend/src/components/admin/dashboard/`):**
- `profile/` inteira (7 no guarda) — `DataCompletenessGauges.tsx` e o que o
  guarda apontar
- `tactical/` inteira (27 + 1 `white`/`black`) — `DuplicationCard.tsx`,
  `PriorityLeadsTable.tsx`, `TacticalTab.tsx`, `SalesReadinessFunnel.tsx` e o
  que o guarda apontar

**Rotas:** `/analytics?tab=profile`, `/analytics?tab=tactical`.

**Pasta do guarda:** `src/components/admin/dashboard/profile` e
`src/components/admin/dashboard/tactical`, as duas em 0.

**Peculiar a esta tarefa:**
- `DataCompletenessGauges.tsx:80` e `SalesReadinessFunnel.tsx:36` — `color:
  '#10B981'` num objeto de dado vira `'var(--color-success-500)'` (vai para
  `style`/SVG, onde classe não chega). As outras cores do mesmo array seguem
  a Tabela, na mesma forma `var(--color-<família>-500)`, e a cor neutra vira
  `'var(--color-slate-400)'`.
- `DataCompletenessGauges.tsx:85` — o `Card` com gradiente e `shadow-lg`
  segue a regra do "Card com gradiente" da Tabela.
- `PriorityLeadsTable.tsx` — se houver badge de prioridade/score, use as
  variantes da Tarefa 2.

Siga o **Procedimento comum**, passos A a H. Commit:
`feat(visual): abas Perfil e Tático do Analytics saem do guarda`.

---

### Tarefa 5: Analytics — Operacional (`/analytics?tab=operational`)

**Arquivos:** `frontend/src/components/admin/dashboard/operational/` inteira
(46 no guarda) — `CampaignTimeAnalysis.tsx`, `SourcePerformanceTable.tsx`,
`ChannelInsights.tsx`, `ChannelKPICards.tsx`,
`CampaignPerformanceTable.tsx` e o que o guarda apontar.

**Rota:** `/analytics?tab=operational`.

**Pasta do guarda:** `src/components/admin/dashboard/operational` em 0.

**Peculiar a esta tarefa:**
- É aqui que moram `COR_HOT`, `COR_WARM` e `COR_RAW`
  (`SourceQualificationChart.tsx`) — a referência de Hot/Warm/Raw que as outras
  tarefas copiam. **Não as mude.**
- `MediumDistributionChart.tsx:38` já usa `'var(--color-success-500)'` em
  `style`; é o padrão para os outros tooltips que escreverem cor em `style`.
- Tabelas de desempenho (`SourcePerformanceTable`,
  `CampaignPerformanceTable`) costumam colorir célula por limiar — Passo B é
  obrigatório aqui, com os limiares copiados para o relatório.

Siga o **Procedimento comum**, passos A a H. Commit:
`feat(visual): aba Operacional do Analytics sai do guarda`.

---

### Tarefa 6: Analytics — Desafios (`/analytics?tab=challenges`)

**Arquivos:** `frontend/src/components/admin/dashboard/challenges/` inteira
(115 no guarda, a maior pasta do G1) — `TopResponsesCard.tsx` (40),
`ChallengesAIInsights.tsx`, `ThemeQualityHeatmap.tsx`,
`ResponseQualityFunnel.tsx`, `WordCloudChart.tsx`,
`ResponseQualityCards.tsx`, `TopKeywordsChart.tsx` e o que o guarda apontar.

**Rota:** `/analytics?tab=challenges` (as subdivisões internas da aba, se
houver, abertas uma a uma).

**Pasta do guarda:** `src/components/admin/dashboard/challenges` em 0.

**Peculiar a esta tarefa:**
- `ResponseQualityFunnel.tsx:18-45` — as quatro etapas têm gradiente
  (`from-slate-500 to-slate-400`, `from-blue-500 to-blue-400`,
  `from-emerald-500 to-emerald-400`, `from-amber-500 to-yellow-400`) numa
  propriedade `color` que entra por interpolação na linha 85. Troque o
  **valor** da propriedade por `'bg-conteudo-faint'`, `'bg-info'`,
  `'bg-success'`, `'bg-warning'` e tire `bg-gradient-to-r` da linha 85. É
  classe em string literal dentro do arquivo, e o Tailwind a enxerga.
- Os títulos com `bg-gradient-to-r from-primary to-primary/70 bg-clip-text
  text-transparent` (aqui e em `ChallengesAIInsights.tsx:197`) viram
  `text-conteudo-heading`.
- `ThemeQualityHeatmap.tsx` — rampa ordinal (Review Focus 3): escala antes →
  depois no relatório.
- `ChallengesAIInsights.tsx:419` — `💎 {gem.reason}` vira
  `<Gem className="inline h-3.5 w-3.5" /> {gem.reason}`.
- `ChallengeThemesChart.tsx` já passou pela Fase 1 (cores de série); não
  mexa nas séries — a colisão 9×6 é pergunta ao Erick, não tarefa.

Siga o **Procedimento comum**, passos A a H. Commit:
`feat(visual): aba Desafios do Analytics sai do guarda`.

---

### Tarefa 7: Analytics — Insights (`/analytics?tab=insights`)

**Arquivos:** `frontend/src/components/admin/dashboard/insights/` inteira
(95 no guarda) — `CampaignRankingTable.tsx` (31),
`RecommendationsSection.tsx`, `AlertsSection.tsx`, `TemporalHeatmap.tsx`,
`InsightsTab.tsx` e o que o guarda apontar.

**Rota:** `/analytics?tab=insights`.

**Pasta do guarda:** `src/components/admin/dashboard/insights` em 0 — e,
como é a última pasta do G1, **`src/components/admin/dashboard` inteira em
0**.

**Peculiar a esta tarefa:**
- `CampaignRankingTable.tsx:104-105` — a legenda
  `<span className="text-red-400">⚠️ Vermelho na Resposta:</span>`: o `⚠️`
  vira `<AlertTriangle className="inline h-3.5 w-3.5" />`, a cor segue a
  Tabela (`text-[--on-tint-danger]`, `text-[--on-tint-warning]`). **As
  palavras "Vermelho" e "Amarelo" ficam** — o texto descreve a cor que a
  tabela mostra, e a tradução mantém vermelho = perigo, amarelo = atenção.
  Confira no navegador que a célula colorida continua batendo com a legenda.
- `AlertsSection.tsx` e `RecommendationsSection.tsx` — cada alerta tem
  severidade; use `<Alert>`/`Badge` com a variante do significado quando o
  componente for esse, senão a Tabela.
- `TemporalHeatmap.tsx` — rampa ordinal (Review Focus 3).

Siga o **Procedimento comum**, passos A a H, e depois:

```bash
npm run -s guarda:visual -- src/components/admin/dashboard   # esperado: 0 total
```

Commit: `feat(visual): aba Insights sai do guarda — dashboard inteiro em zero`.

---

### Tarefa 8: Portão do G1 e registro

**Arquivos:**
- Modificar: `docs/CONTINUAR-AQUI.md` (bloco novo no topo: "Visual — Fase 2,
  preparação e G1")
- Modificar: `frontend/src/design-system/ORIGEM.md` só se um defeito novo do
  DS tiver aparecido nas Tarefas 3-7

- [ ] **Step 1: Portão do spec, item a item**

```bash
cd /home/ericks/github/MarketingHS/frontend
npm run -s guarda:visual -- src/components/admin/dashboard          # 0
npm run -s guarda:visual | tail -1                                   # novo total do app
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"      # 4
npx vite build && npm run build:landing
cd .. && for f in frontend/src/design-system/tokens/*.css frontend/src/design-system/styles.css; do sha256sum "$f"; done
```

Os hashes batem com os do `ORIGEM.md`.

- [ ] **Step 2: Capacidade por capacidade**

```bash
git diff visual-fase-1 --stat -- frontend/src
git diff visual-fase-1 -- frontend/src/components/admin/dashboard | grep -E "^[+-]" \
  | grep -vE "^(\+\+\+|---)" | grep -vE "className|style=|stroke=|fill=|color|variant=|lucide-react|//|^\s*[+-]\s*$"
```

Cada linha que sobrar é lida e justificada no registro. Nenhuma pode ser
lógica, rota, chamada de API, condição ou limiar.

- [ ] **Step 3: As sete telas nos dois temas**

`/` e `/analytics` com as cinco abas (`profile`, `challenges`, `tactical`,
`operational`, `insights`), mais a ficha do lead, a 1440 px, claro e escuro,
zero erro de console novo. Uma olhada a 390 px em `/` e
`/analytics?tab=insights` (a tabela de ranking é a mais larga) para ver que
nenhuma troca de classe criou rolagem horizontal nova.

- [ ] **Step 4: Registro**

Bloco novo no topo do `CONTINUAR-AQUI.md`, no molde do da Fase 1: tabela de
commits, placar do guarda (antes → depois, por pasta), o que cada Review
Focus achou, e a seção **"Decisões tomadas nesta fase, reversíveis"**:

1. Roxo/violeta/índigo da dn.ia → tinta primária (o DS não tem roxo).
2. Verde do WhatsApp (`#25D366`) → tinta de sucesso; não é exceção de marca.
3. Emoji de fim de frase removido; emoji com sentido virou ícone lucide.
4. `Badge` ganhou `success`, `warning`, `info` (aditivo; nenhuma variante
   existente mudou).
5. Texto colorido solto usa `--on-tint-*`, não o `-500`.

E a lista do que **continua** esperando o Erick (as decisões 1-2 da Fase 1 e
as seis de 23/09), com o próximo passo: G2 (Contatos, ficha, Importação), que
é onde estão 26 dos 63 `white`/`black`.

```bash
git add docs/CONTINUAR-AQUI.md frontend/src/design-system/ORIGEM.md
git commit -m "docs(visual): Fase 2 — preparação e G1 fechados"
```
