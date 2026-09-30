# MarketingHS — Visual, Fase 2: G5 (Páginas e Teste A/B) — Plano

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para executar tarefa a tarefa.
> Os passos usam caixa de seleção (`- [ ]`) para acompanhamento.

**Objetivo:** `/pages`, o editor de página (`/pages/:slug/edit`) e as três
telas de Teste A/B (`/experiments`, `/experiments/setup`, `/experiments/:id`)
saem do guarda com **zero** — toda cor de token, sem emoji, sem texto abaixo
de 12px, sem título duplicado — e as telas fazem **o que faziam**. De
quebra, os dois avisos de "números truncados" do G1 (`Overview.tsx`,
`Analytics.tsx`), que ficaram para trás, saem também.

**Arquitetura:** tradução arquivo a arquivo pela Tabela do G1, como no G2–G4.
Dois casos novos: (1) **componentes órfãos** — `PagesTable`,
`PageStatusBadge`, `PageTypeIcon` e `PageFormDialog` não têm importador
(conferido em 30/09) e somam 11 dos 26 pontos de `components/admin/pages`;
eles **saem**, em vez de serem traduzidos; (2) a **cor padrão do CTA da
landing** (`#E41A11`) aparece no editor como valor inicial do seletor de cor
— é dado da landing pública (Decisão 6), não cor da tela: o valor **não
muda**, só passa a morar num módulo da landing, que o guarda já isenta.

**Stack:** React 18 · Vite · TypeScript · Tailwind 3.4.17 · shadcn/ui (Radix) · Playwright

**Spec:** `docs/superpowers/specs/2026-09-22-marketinghs-visual-design-system-design.md` (Fase 2, grupo G5; Decisão 6)
**Plano anterior (molde e decisões):** `docs/superpowers/plans/2026-09-30-marketinghs-visual-fase-2-g4-automacoes.md`
**Registro:** `docs/CONTINUAR-AQUI.md`, blocos "Visual — Fase 2, G4", "G3", "G2" e "preparação e G1".

**Branch:** `visual-fase-2-g5`, a partir da `main` (`e707b5a`, que já contém
G1–G4).

**Escopo medido em 30/09** (guarda, por arquivo):

| Arquivo | Guarda | Destino |
|---|---|---|
| `pages/admin/ExperimentDetail.tsx` | 8 | Tarefa 4 |
| `components/admin/pages/PageConfigEditor.tsx` | 8 | Tarefa 3 |
| `components/admin/pages/PagesManagement.tsx` | 6 | Tarefa 2 |
| `components/admin/pages/PageStatusBadge.tsx` | 5 | Tarefa 2 (órfão, sai) |
| `pages/admin/Analytics.tsx` | 4 | Tarefa 1 |
| `components/admin/pages/PageTypeIcon.tsx` | 4 | Tarefa 2 (órfão, sai) |
| `pages/admin/Overview.tsx` | 4 | Tarefa 1 |
| `pages/admin/Experiments.tsx` | 2 | Tarefa 4 |
| `pages/admin/ExperimentsSetup.tsx` | 2 | Tarefa 4 |
| `components/admin/pages/PagesTable.tsx` | 2 | Tarefa 2 (órfão, sai) |
| `components/admin/pages/NewPageDialog.tsx` | 1 | Tarefa 2 |
| `PageFormDialog.tsx` (órfão, 0), `UTMPresetsModal.tsx` (0, com `text-[10px]`) | 0 | Tarefa 2 |

`pages/admin/SettingsPage.tsx` (2) é do G6 e **não** entra.

**Dado real em produção (30/09):** **nenhuma** página (`pages` vazia) e
**nenhum** teste A/B (`ab_tests` vazia). A lista de páginas, o editor e o
detalhe do teste **não têm o que abrir ao vivo** — conferem-se por leitura de
código e por elemento sintético; nenhuma página ou teste se cria para
conferir. O que dá para ver ao vivo: `/pages` vazia e os diálogos "Nova
página" e "Presets de UTM"; `/experiments` vazia e seus diálogos de criação;
`/experiments/setup`; `/` e `/analytics` (o aviso de truncamento só aparece
se a base passar do teto — senão, sintético).

Placar do app no começo: **170**. Esperado no fim: **170 − 46 = 124**
(`components/admin/pages` 26 → 0, `pages/admin` 22 → 2 — sobra o
`SettingsPage.tsx` do G6).

---

## Restrições globais

- ⚠️ **A tela faz o que fazia.** O `git diff` mostra só classe, cor, token e
  marcação de apresentação. **Nenhuma** lógica, rota, chamada de API,
  condição, `useState`, `onClick`, texto de dado ou limiar numérico muda.
  Exceções nomeadas neste plano: a remoção do `<h1>` duplicado (Tarefa 4), a
  remoção dos quatro arquivos órfãos (Tarefa 2), a constante da cor do CTA
  movida para `src/landing/` (Tarefa 3), o `className` condicional do
  "Confirmar" de `PagesManagement` (Tarefa 2) e a troca de emoji por ícone
  (Tarefas 1 e 4). Se um conserto exigir outra mudança de lógica, **pare e
  relate**.
- ⚠️ **`frontend/src/design-system/` não se edita.** ⚠️ **`src/landing/` só
  ganha o arquivo novo da Tarefa 3** — nada mais nele muda (é a landing
  pública, Decisão 6).
- **Cor sai de token**, pela Tabela de tradução. Nenhum hexadecimal, cor
  literal do Tailwind (inclusive `white`/`black`), `hsl()`/`rgb()` numérico.
- **Nada de gradiente, brilho, `backdrop-blur`, sombra em superfície estática.**
- **Nenhum texto abaixo de 12px** (`text-[10px]`/`[11px]` → `text-xs`), e
  **texto** não fica mais claro que o muted (`text-muted-foreground/60`,
  `/70` → `text-muted-foreground`; em **ícone** decorativo, `/40` pode ficar).
- **Ícone é componente, nunca emoji** — os `⚠️`/`⚠` **dentro do JSX** de
  `Overview.tsx:11`, `Analytics.tsx:29` e `Experiments.tsx:472` viram
  `<AlertTriangle />`. Os `⚠️` em **comentário** (`PageConfigEditor.tsx:48,270`,
  `ExperimentsSetup.tsx:14`, `UTMPresetsModal.tsx:45`) ficam.
- **`focus-visible`, nunca `focus:`.** `dark:` sai onde há token.
- **Botão não ganha cor por `className`** quando o primitivo tem a variante;
  **badge com significado usa a variante do `Badge`** (`variant="success"`,
  `"warning"`, `"info"`, `"destructive"`, `"secondary"`) em vez de pintar
  fundo/texto por classe — é a lição da revisão final do G4 (badge pintado
  por classe fica com a borda azul da variante padrão).
- ⚠️ **"Excluir" de confirmação** (`AlertDialogAction`) usa a string exata da
  variante destrutiva: `bg-danger text-destructive-foreground border border-danger hover:bg-danger/90`.
- **Chip/badge clicável mantém hover visível**: neutro →
  `hover:bg-surface-elevated`.
- **O aviso âmbar tem uma forma** (a do G4):
  `flex gap-2 text-xs text-[--on-tint-warning] bg-[--tint-warning] border border-warning/30 rounded-md p-2.5`,
  ícone `AlertTriangle` com `h-3.5 w-3.5 shrink-0 mt-0.5 text-warning`, sem
  `dark:`. Onde o aviso de origem tem outro padding/tamanho de texto, **o
  padding e o tamanho de origem ficam** — muda só a cor e o ícone.
- **Frontend:** `cd frontend && npx tsc --noEmit -p tsconfig.app.json && npx vite build && npm run build:landing`.
  `tsc` tem **4 erros pré-existentes** (`LeadScoringSettings` ×1,
  `useJourneys` ×3); nenhum novo.
- **Guarda:** `npm run -s guarda:visual -- <pasta ou arquivo>` sai 0 no escopo
  da tarefa.
- **Navegador:** Playwright; backend `127.0.0.1:8100`, Vite `127.0.0.1:8080`.
  O banco é o de **produção**. **Subagente não abre arquivo de credencial**
  (`~/.config/marketinghs/*`, `~/marketinghs.env`, `.env`): reaproveita a
  sessão já logada do Playwright; se cair no login, **para e pede**. Ação
  negada pelo controle de permissão não se repete com outra descrição: relata.
- ⚠️ **O que se pode fazer no navegador neste grupo:** navegar por URL, ler,
  console (`getComputedStyle`, elemento sintético), passar o mouse, trocar de
  aba, abrir "Nova página", "Presets de UTM" e o diálogo de criar teste A/B
  e **fechar sem salvar** (digitar nos campos é permitido). **NUNCA clicar
  em**: "Criar", "Salvar", "Publicar", "Ativar", "Desativar", "Finalizar",
  "Duplicar", "Excluir", "Confirmar", qualquer confirmação de `AlertDialog`,
  "Adicionar preset", lixeira de preset, nem ícone sem rótulo. Nenhuma
  escrita no banco. Tema pelo `localStorage` (`marketinghs-tema` =
  `claro`/`escuro`); deixe `claro`.
- **Toda tarefa de tela confere no claro E no escuro, com screenshot "antes"
  tirado ANTES da primeira edição** (o Playwright salva em `.playwright-mcp/`
  ou na raiz do repositório — mova para o scratchpad; nada de screenshot no
  repositório). Se o controle de permissão negar screenshot, confira por
  `getComputedStyle` e diga isso.
- **Comentário, nome e mensagem em português.**

## Tabela de tradução (a mesma do G1–G4)

| Literal de origem | Significado | Texto sobre superfície | Fundo (tinta) | Borda | Badge |
|---|---|---|---|---|---|
| `green-*`, `emerald-*` | bom, ativo, salvo, Hot | `text-[--on-tint-success]` | `bg-[--tint-success]` | `border-success/30` | `variant="success"` |
| `amber-*`, `yellow-*`, `orange-*` | atenção, prévia | `text-[--on-tint-warning]` | `bg-[--tint-warning]` | `border-warning/30` | `variant="warning"` |
| `red-*`, `rose-*` | ruim, erro, apagar | `text-[--on-tint-danger]` | `bg-[--tint-danger]` | `border-danger/30` | `variant="destructive"` |
| `blue-*`, `sky-*`, `cyan-*` | informação | `text-[--on-tint-info]` | `bg-[--tint-info]` | `border-info/30` | `variant="info"` |
| `purple-*`, `violet-*`, `indigo-*` | destaque | `text-[--on-tint-primary]` | `bg-[--tint-primary]` | `border-primary/30` | `variant="default"` |
| `bg-primary/10`, `/15` em caixa, círculo ou avatar | destaque | `text-[--on-tint-primary]` | `bg-[--tint-primary]` | `border-primary/30` | — |
| `text-white`/`text-black` sobre fundo cheio | texto em cor cheia | pela variante | — | — | — |

Ícone (~16px) pode usar a cor cheia (`text-success`, `text-warning`,
`text-danger`, `text-info`, `text-primary`). **Hot = sucesso** (decisão do
G1): o `Flame` de hot leads usa `text-success`, não laranja.

Antes de usar `variant="success" | "warning" | "info"`, confira que a
variante existe em `frontend/src/components/ui/badge.tsx` (um grep).

## Review Focus

1. **Tela sem dado escondendo defeito** — produção não tem página nem teste
   A/B: a lista de páginas, os cartões de número, o editor e o detalhe do
   teste só são vistos por código e sintético. Um token errado ali só
   apareceria no dia da primeira página. Conferido por elemento sintético com
   as classes finais de cada badge/número/aviso, nos dois temas, com
   contraste medido (texto ≥ 4,5:1). (Tarefas 2, 3, 4.)
2. **Órfão que não era órfão** — apagar `PagesTable`, `PageStatusBadge`,
   `PageTypeIcon` ou `PageFormDialog` quebraria quem os importa. Conferido por
   `grep` de importador **antes** de apagar, `tsc` e `vite build` depois, e
   `/pages` abrindo sem erro de console. (Tarefa 2.)
3. **Cor do CTA mudando sem querer** — o valor inicial do seletor de cor do
   editor continua `#E41A11` (é decisão pendente do Erick se ele deveria ser
   o `#1e3a5f` que a landing usa quando não há cor). Conferido pelo diff: o
   literal sai do editor e aparece, igual, em `src/landing/`. (Tarefa 3.)
4. **"Confirmar" de desativar virando vermelho, ou o de excluir ficando azul** —
   em `PagesManagement` o mesmo `AlertDialogAction` confirma "desativar" e
   "excluir"; só o de excluir fica destrutivo. Conferido por leitura do
   `className` condicional e elemento sintético das duas strings. (Tarefa 2.)
5. **Aviso de truncamento sem o sinal de alerta** — trocar `⚠️` por ícone não
   pode tirar a frase nem o número do teto. Conferido pelo diff (o texto fica
   igual, só sai o `⚠️`) e por sintético nos dois temas. (Tarefa 1.)

---

### Tarefa 1: Os avisos de truncamento do G1 (`/` e `/analytics`)

**Arquivos:** `frontend/src/pages/admin/Overview.tsx:~10-14`,
`frontend/src/pages/admin/Analytics.tsx:~28-32`.

**Tradução exata** (igual nos dois): o `<div>` do aviso passa de
`mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400`
para
`mb-4 flex gap-2 rounded-md border border-warning/30 bg-[--tint-warning] px-3 py-2 text-xs text-[--on-tint-warning]`;
o `⚠️ ` do começo do texto sai e entra, como primeiro filho do `<div>`,
`<AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-warning" />`
seguido do texto envolvido num `<span>` (o texto, o `{teto.toLocaleString('pt-BR')}`
e a condição `truncado &&` não mudam). Importe `AlertTriangle` de
`lucide-react` (confira se já não está importado).

- [ ] **Step 1: Antes** — `npm run -s guarda:visual -- src/pages/admin/Overview.tsx`
  e `… Analytics.tsx` (4 cada). Em `/` e `/analytics`, veja se o aviso aparece
  ao vivo (só aparece se a base passar do teto); anote.
- [ ] **Step 2: Traduzir** como acima.
- [ ] **Step 3: Provar**

```bash
cd /home/ericks/github/MarketingHS/frontend
npm run -s guarda:visual -- src/pages/admin/Overview.tsx      # 0
npm run -s guarda:visual -- src/pages/admin/Analytics.tsx     # 0
grep -nP "[\x{2600}-\x{27BF}]" src/pages/admin/Overview.tsx src/pages/admin/Analytics.tsx   # nenhuma linha
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"   # 4
npx vite build
cd .. && git diff -- frontend/src/pages/admin/Overview.tsx frontend/src/pages/admin/Analytics.tsx
```

No diff: a frase e o `{teto…}` iguais (Review Focus 5). No navegador, ao
vivo se o aviso aparecer, senão sintético com as classes finais, nos dois
temas: fundo ≠ `rgba(0, 0, 0, 0)`, texto/fundo ≥ 4,5:1 (se der 4,32–4,47 no
claro, é o defeito do DS já registrado no `ORIGEM.md` — anote, não mexa).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/admin/Overview.tsx frontend/src/pages/admin/Analytics.tsx
git commit -m "fix(visual): aviso de truncamento do G1 sai do guarda — ícone no lugar do emoji"
```

---

### Procedimento comum às Tarefas 2-4 (cada tarefa aponta para cá)

- [ ] **A. Antes de editar — medir e fotografar**

```bash
cd /home/ericks/github/MarketingHS/frontend
npm run -s guarda:visual -- <cada arquivo da tarefa>
grep -nE "text-\[(8|9|10|11)px\]|text-muted-foreground/[0-9]|shadow-(sm|md|lg|xl|2xl)|dark:|focus:|\\\$\{[^}]+\}[0-9]{2}\b" <arquivos> | wc -l
```

Screenshots de cada rota/estado da tarefa que exista ao vivo, 1440 px, claro
e escuro, antes de tocar em qualquer arquivo.

- [ ] **B. Listar os mapas e ternários de cor** — arquivo:linha, chave, cor
  de origem → token/variante. Chaves e rótulos não mudam.

- [ ] **C. Traduzir** pela Tabela e pelas restrições.

- [ ] **D. Guarda e busca complementar**

```bash
npm run -s guarda:visual -- <cada arquivo>        # 0 em todos
grep -nE "text-\[(8|9|10|11)px\]|text-muted-foreground/(60|70)|shadow-(md|lg|xl|2xl)|dark:|focus:|backdrop-blur|bg-clip-text|\\\$\{[^}]+\}[0-9]{2}\b" <arquivos>
grep -nP "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]" <arquivos> | grep -v "//\|{/\*"
```

Esperado: **nenhuma linha** nos dois greps.

- [ ] **E. Frontend compila**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"   # 4
npx vite build
```

- [ ] **F. No navegador, nos dois temas** — dentro das regras de navegador.
  O que existir ao vivo, comparado com o "antes"; o que não existir (sem
  página, sem teste), por elemento sintético com as classes finais —
  **diga, no relatório, o que foi ao vivo e o que foi sintético**. Contraste
  medido de todo texto sobre tinta (≥ 4,5:1).

- [ ] **G. Diff só de apresentação**

```bash
cd /home/ericks/github/MarketingHS
git diff -- <arquivos> | grep -E "^[+-]" | grep -vE "^(\+\+\+|---)" \
  | grep -vE "className|style=|variant=|lucide-react|//|^\s*[+-]\s*$"
git diff -U0 -- <arquivos> | grep -E "^[+-]" | grep -E "onClick|handle[A-Z]|mutate|disabled=|status ===|status !=="
```

O primeiro: cada linha que sobrar é justificada (só as exceções nomeadas). O
segundo: zero linhas fora de uma linha em que só o `className`/`variant`
mudou — mostre que o handler ficou byte a byte igual.

- [ ] **H. Commit** — `feat(visual): <área> sai do guarda — …`

---

### Tarefa 2: `/pages` — a lista, os diálogos e os órfãos

**Arquivos:**
- Modificar: `frontend/src/components/admin/pages/PagesManagement.tsx`,
  `NewPageDialog.tsx`, `UTMPresetsModal.tsx`
- Apagar: `frontend/src/components/admin/pages/PagesTable.tsx`,
  `PageStatusBadge.tsx`, `PageTypeIcon.tsx`, `PageFormDialog.tsx`

**Rotas/estados:** `/pages` (vazia em produção — veja o estado vazio);
"Nova página" aberto (os badges de ~102/~106 aparecem conforme a slug
digitada: "em uso"/"disponível" — digitar é leitura) e fechado sem criar;
"Presets de UTM" aberto e fechado sem adicionar. Cartões de número, a linha
da página, o badge de status e o menu da linha: sintético/código.

**Guarda:** a pasta `src/components/admin/pages` inteira em **0**, exceto
`PageConfigEditor.tsx` (Tarefa 3): rode o guarda nos arquivos desta tarefa e
confira que a pasta dá exatamente os 8 do editor.

**Os órfãos (exceção nomeada):**

```bash
cd /home/ericks/github/MarketingHS/frontend
for n in PagesTable PageStatusBadge PageTypeIcon PageFormDialog; do echo "== $n"; grep -rn "$n" src --include=*.ts --include=*.tsx | grep -v "src/components/admin/pages/$n.tsx"; done
```

Esperado: `PageStatusBadge` e `PageTypeIcon` só aparecem em `PagesTable.tsx`
(que também sai); `PagesTable` e `PageFormDialog` em nenhum lugar. **Se
aparecer qualquer outro importador, pare e relate** (Review Focus 2). Depois,
`git rm` dos quatro. O relatório lista o que cada um fazia, para o registro.

**Tradução exata:**

- `PagesManagement.tsx`:
  - cartões de número (~114-127): `text-green-500` (Páginas ativas) →
    `text-[--on-tint-success]`; `text-blue-500` (Total de leads) →
    `text-[--on-tint-info]`; `text-purple-500` (Melhor página) →
    `text-[--on-tint-primary]` (categorias de número, pelo matiz — registre).
  - badge de status da linha (~157): `variant={page.status === 'active' ?
    'default' : 'secondary'} className={page.status === 'active' ?
    'bg-green-600 hover:bg-green-700' : ''}` → `variant={page.status ===
    'active' ? 'success' : 'secondary'}`, **sem** `className` (a condição é a
    mesma, só a variante muda).
  - `Flame` de hot leads (~184): `text-orange-500` → `text-success`.
  - `text-muted-foreground/70` do headline (~171) → `text-muted-foreground`;
    `text-[10px]` (~179, ~186, ~194) → `text-xs`.
  - "Confirmar" do diálogo (~273, exceção nomeada): o mesmo
    `AlertDialogAction` confirma "desativar" e "excluir". Acrescente
    `className={confirmDialog?.action === 'delete' ? 'bg-danger text-destructive-foreground border border-danger hover:bg-danger/90' : undefined}`
    — `onClick={handleConfirm}` e o texto não mudam.
- `NewPageDialog.tsx`: badge de ~102 (`variant="destructive"
  className="text-[10px] gap-1"`) → `className="text-xs gap-1"`; badge de
  ~106 (`className="bg-green-600 text-[10px] gap-1"`) → `variant="success"
  className="text-xs gap-1"`.
- `UTMPresetsModal.tsx`: `text-[10px]` (~101) → `text-xs`; badge clicável de
  ~120 `hover:bg-primary/10` → `hover:bg-surface-elevated`; o botão de
  lixeira (~108, `text-destructive hover:text-destructive`) fica.

Siga o **Procedimento comum**, A a H. Commit:
`feat(visual): páginas saem do guarda — status é variante, órfãos saem`.

---

### Tarefa 3: O editor de página (`/pages/:slug/edit`)

**Arquivos:**
- Criar: `frontend/src/landing/padroes.ts`
- Modificar: `frontend/src/components/admin/pages/PageConfigEditor.tsx`

**Rotas/estados:** não há página em produção — o editor não abre ao vivo
(a rota com uma slug inexistente mostra o que o código mostrar para "não
encontrada": abra `/pages/nao-existe/edit` só para ver esse estado). Todo o
resto por leitura de código e elemento sintético.

**Guarda:** `PageConfigEditor.tsx` em 0 — e, com a Tarefa 2, a pasta
`src/components/admin/pages` inteira em 0. `src/landing/` é isenta; confira
que `npm run -s guarda:visual -- src/landing` continua dizendo que a área é
isenta/zero.

**O módulo da landing (exceção nomeada):** `frontend/src/landing/padroes.ts`:

```ts
// Cor inicial do seletor "Cor do CTA" no editor de página. É dado da landing
// pública (Decisão 6 do spec), não cor da tela do admin — por isso mora aqui,
// na área isenta do guarda, e não no editor.
// ⚠️ Diverge do que a landing usa quando a página não tem cor: o botão cai
// no `--landing-accent` (#1e3a5f, landing.css). Qual das duas vale é
// decisão pendente do Erick ("cor do botão das landings"); o valor aqui
// não muda até lá.
export const COR_CTA_PADRAO = '#E41A11';
```

**Tradução exata** (`PageConfigEditor.tsx`):

- os dois `config.cta_color || '#E41A11'` (~209, ~214) →
  `config.cta_color || COR_CTA_PADRAO`, com
  `import { COR_CTA_PADRAO } from '@/landing/padroes';` (confira o alias `@/`
  nos outros imports do arquivo). O valor é o mesmo (Review Focus 3).
- badge "Salvo" (~167): `variant="secondary" className="gap-1 text-green-600"`
  → `variant="success" className="gap-1"`.
- badge "PREVIEW" (~343): `className="absolute top-2 left-2 z-10 bg-yellow-500
  text-black hover:bg-yellow-600"` → `variant="warning" className="absolute
  top-2 left-2 z-10"` (é a moldura do admin sobre a prévia; a prévia em si
  — o `iframe`/conteúdo da landing — não se toca).
- botão de publicar (~371): sai `className={page.status !== 'active' ?
  'bg-green-600 hover:bg-green-700' : ''}` inteiro (fica o padrão de ação;
  a condição que escolhia a cor some junto — é só apresentação).
- `text-[10px]` (~239) e `text-[11px]` (~314, ~319) → `text-xs`; o de ~314
  (`text-destructive`) → `text-xs text-[--on-tint-danger]`.
- badge clicável de ~260 (`hover:bg-primary/10`) → `hover:bg-surface-elevated`.
- `text-muted-foreground/40` no ícone `Layout` (~354) fica (ícone decorativo).
- "Confirmar" de publicar (~394) fica (ação, não destrutiva).

Siga o **Procedimento comum**, A a H. No G, a linha do import de
`COR_CTA_PADRAO` e as duas linhas do `cta_color` são as exceções nomeadas.
Commit: `feat(visual): editor de página sai do guarda — cor do CTA mora na landing`.

---

### Tarefa 4: Teste A/B (`/experiments`, `/experiments/setup`, `/experiments/:id`)

**Arquivos:** `frontend/src/pages/admin/Experiments.tsx`,
`ExperimentsSetup.tsx`, `ExperimentDetail.tsx`.

**Rotas/estados:** `/experiments` (vazia) e o diálogo de criar teste aberto
e fechado sem criar — o aviso de ~385 e o de amostra longa (~472, aparece
com `sample.days > 60`) se veem ao vivo se o diálogo os mostrar ao digitar
parâmetros; `/experiments/setup`. O detalhe (`/experiments/:id`) não existe
em produção — sintético e código.

**Guarda:** os três arquivos em 0; `src/pages/admin` inteira com só os 2 do
`SettingsPage.tsx` (G6).

**Tradução exata:**

- **Título duplicado** (`Experiments.tsx:~265`, exceção nomeada): o `<h1>`
  "Testes A/B" sai (a topbar escreve "Testes A/B", `AdminLayout.tsx:33`); o
  `<p>` de descrição logo abaixo fica, no mesmo `<div>`.
- **Título duplicado** (`ExperimentsSetup.tsx:~156`, exceção nomeada): o
  `<h1>` "Configuração & Instruções — Teste A/B" sai (a topbar escreve
  "Configurar teste A/B", `AdminLayout.tsx:31`); o `<p>` fica.
- O `<h1>{test.name}</h1>` de `ExperimentDetail.tsx:~186` **fica** (é o nome
  do teste; a topbar escreve "Teste A/B").
- `Experiments.tsx:~385` `text-xs text-amber-600` → `text-xs
  text-[--on-tint-warning]`.
- `Experiments.tsx:~472`: `<span className="text-amber-600"> ⚠ Muito longo —
  teste diferenças maiores.</span>` → `<span className="inline-flex
  items-center gap-1 text-[--on-tint-warning]"> <AlertTriangle
  className="h-3.5 w-3.5 text-warning" /> Muito longo — teste diferenças
  maiores.</span>` (a frase fica; a condição `sample.days > 60 &&` não muda).
- `ExperimentsSetup.tsx:~224` `text-amber-600` → `text-[--on-tint-warning]`
  (se houver ícone dentro, `text-warning`); `~249` `ShieldAlert` `text-amber-600`
  → `text-warning`; `~83` círculo de passo `bg-primary/15 text-primary` →
  `bg-[--tint-primary] text-[--on-tint-primary]`.
- `ExperimentDetail.tsx`: `~194` `text-amber-600` → `text-[--on-tint-warning]`;
  avisos de `~204` e `~353` (`border-amber-500/40 bg-amber-500/10 …
  text-amber-700`) → `border-warning/30 bg-[--tint-warning] …
  text-[--on-tint-warning]` (padding e tamanho de origem ficam; ícone dentro,
  se houver, `text-warning`); `~265` `text-red-600 font-semibold` →
  `text-[--on-tint-danger] font-semibold` (a condição `guardWorse ?` fica);
  `~222` caixa `border-primary/40 bg-primary/10` → `border-primary/30
  bg-[--tint-primary]`; `~254` `text-[10px]` → `text-xs`.

Siga o **Procedimento comum**, A a H. Commit:
`feat(visual): teste A/B sai do guarda — sem título duplicado, avisos legíveis`.

---

### Tarefa 5: Portão do G5 e registro

**Arquivos:** `docs/CONTINUAR-AQUI.md` (bloco novo no topo: "Visual — Fase 2,
G5", e o "Comece por aqui" atualizado).

- [ ] **Step 1: Portão**

```bash
cd /home/ericks/github/MarketingHS/frontend
npm run -s guarda:visual -- src/components/admin/pages             # 0
for f in Overview Analytics Experiments ExperimentsSetup ExperimentDetail; do npm run -s guarda:visual -- src/pages/admin/$f.tsx | tail -1; done   # 0 em cada
npm run -s guarda:visual -- src/pages/admin | tail -1              # 2 (SettingsPage, G6)
for a in src/components/admin/automations src/components/admin/segments src/components/admin/campaigns src/components/admin/dashboard src/components/admin/contacts src/components/ui src/hooks src/lib; do npm run -s guarda:visual -- $a | tail -1; done   # 0 em cada
npm run -s guarda:visual | tail -6                                  # esperado: 124 total
grep -rnE '\$\{[^}]+\}[0-9]{2}\b' src --include=*.tsx              # nenhuma linha
grep -rn -A3 "<AlertDialogAction" src | grep "bg-destructive"      # nenhuma linha
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"     # 4
npx vite build && npm run build:landing
cd .. && sha256sum frontend/src/design-system/tokens/*.css frontend/src/design-system/styles.css
git diff e707b5a --stat -- frontend/src/landing                    # só padroes.ts
```

Hashes batem com o `ORIGEM.md`.

- [ ] **Step 2: Capacidade por capacidade**

```bash
git diff e707b5a --stat -- frontend
git diff e707b5a -- frontend/src | grep -E "^[+-]" | grep -vE "^(\+\+\+|---)" \
  | grep -vE "className|style=|variant=|lucide-react|//|^\s*[+-]\s*$"
git diff -U0 e707b5a -- frontend/src | grep -E "^[+-]" | grep -E "onClick|handle[A-Z]|mutate|disabled=|status ===|status !=="
```

(Os quatro órfãos apagados aparecem inteiros como `-` — resuma-os numa
linha, não os justifique linha a linha.)

- [ ] **Step 3: Telas nos dois temas** — `/pages` (vazia; "Nova página" e
  "Presets de UTM" abertos e fechados), `/pages/nao-existe/edit`,
  `/experiments` (vazia; diálogo de criar aberto e fechado),
  `/experiments/setup`, `/` e `/analytics`, claro e escuro, 1440 px;
  `/pages` e `/experiments` também a 390 px (anote rolagem horizontal, não
  conserte). Zero erro de console novo. **Confira no banco, por consulta,
  que continua sem página e sem teste A/B** (`select count(*) from pages`,
  `… from ab_tests`, `… from ab_config` — compare com o começo).

- [ ] **Step 4: Registro** — bloco novo no topo do `CONTINUAR-AQUI.md`, no
  molde do bloco do G4: tabela de commits; placar antes → depois por pasta;
  o que cada Review Focus achou (e o que foi só sintético — **quase tudo,
  porque produção não tem página nem teste**; diga isso logo no começo do
  bloco); **Decisões tomadas nesta fase, reversíveis**:

1. Quatro componentes órfãos de `components/admin/pages` saíram
   (`PagesTable`, `PageStatusBadge`, `PageTypeIcon`, `PageFormDialog`) —
   estão no histórico do git.
2. A cor inicial do seletor de CTA (`#E41A11`) mora em `src/landing/padroes.ts`;
   o valor não mudou e a divergência com o `#1e3a5f` da landing continua
   pergunta ao Erick.
3. Status de página usa `variant="success"` (não pinta por classe); "Salvo" e
   "PREVIEW" também viraram variante.
4. Cartões de número de `/pages` pelo matiz (ativas = sucesso, leads = info,
   melhor página = primária); `Flame` de hot = sucesso.
5. "Confirmar" de `PagesManagement` é destrutivo só quando a ação é excluir.
6. Fim do `<h1>` duplicado em `/experiments` e `/experiments/setup`; o do
   detalhe fica (é o nome do teste).
7. Os avisos de truncamento do G1 ganharam ícone no lugar do emoji.

No "Comece por aqui": branch `visual-fase-2-g5` (a partir da `main`),
revisão por tarefa feita, **revisão final pendente** até ela acontecer;
próximo passo **G6 (Configurações — `settings/`, o último grupo)**, que leva
também o `SettingsPage.tsx` e o "Remover" azul do `SuppressionList.tsx:~261`;
placar novo por pasta; decisões pendentes do Erick mantidas. Não escreva
senha nem como ela é obtida.

```bash
git add docs/CONTINUAR-AQUI.md
git commit -m "docs(visual): Fase 2 — G5 (Páginas e Teste A/B) fechado"
```
