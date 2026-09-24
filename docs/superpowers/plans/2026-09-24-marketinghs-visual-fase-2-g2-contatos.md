# MarketingHS — Visual, Fase 2: G2 (Contatos, ficha do contato, Importação) — Plano

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para executar tarefa a tarefa.
> Os passos usam caixa de seleção (`- [ ]`) para acompanhamento.

**Objetivo:** `/contacts`, a ficha do contato (`LeadDetailSheet`) e `/import`
saem do guarda com **zero** — toda cor de token, sem gradiente, sem brilho,
sem sombra estática, sem emoji, sem texto abaixo de 12px, paginação em frase,
sem título duplicado — e as telas fazem **o que faziam**.

**Arquitetura:** o G1 fixou a tradução de cor por significado (tabela abaixo,
repetida do plano do G1) e as decisões de 24/09. O G2 traz um caso que o G1
não teve: **cor que vem do banco** (`lead_statuses.color`, `tags.color`), que
é dado escolhido pelo usuário e não pode virar token. Para ela nasce um
auxiliar único, `src/lib/corDeDado.ts`, que a apresenta de forma legível nos
dois temas. O resto é tradução pasta a pasta, como no G1.

**Stack:** React 18 · Vite · TypeScript · Tailwind 3.4.17 · shadcn/ui (Radix) · Playwright

**Spec:** `docs/superpowers/specs/2026-09-22-marketinghs-visual-design-system-design.md` (Fase 2, grupo G2)
**Plano anterior (molde e decisões):** `docs/superpowers/plans/2026-09-24-marketinghs-visual-fase-2-preparacao-e-g1.md`
**Registro:** `docs/CONTINUAR-AQUI.md`, bloco "Visual — Fase 2, preparação e G1".

**Branch:** `visual-fase-2-g2`, a partir de `visual-fase-1` (`d4007e6`, que já
contém o G1).

---

## Restrições globais

- ⚠️ **A tela faz o que fazia.** O `git diff` mostra só classe, cor, token e
  marcação de apresentação. **Nenhuma** lógica, rota, chamada de API,
  condição, `useState`, `onClick`, texto de dado ou limiar numérico muda.
  Exceções nomeadas neste plano: a frase de paginação (Tarefa 3) e a remoção
  do `<h1>` duplicado (Tarefas 3 e 5), que o checklist do spec pede. Se um
  conserto exigir outra mudança de lógica, **pare e relate**.
- ⚠️ **`frontend/src/design-system/` não se edita.**
- **Cor sai de token**, pela Tabela de tradução. Nenhum hexadecimal, cor
  literal do Tailwind (inclusive `white`/`black`), `hsl()`/`rgb()` numérico.
  Em `style={{}}`/SVG o token entra como string (`'var(--color-success-500)'`).
- ⚠️ **Nunca concatenar sufixo de alfa numa cor** (`` `${cor}15` ``,
  `` `${cor}20` ``): só funciona com hexadecimal e quebra em silêncio com
  `var(--…)` — foi assim que o selo do medidor do G1 perdeu o fundo. Use
  `` `color-mix(in srgb, ${cor} 12%, transparent)` ``.
- **Nada de gradiente, brilho decorativo (`blur-*` de enfeite, `drop-shadow`
  de halo), `backdrop-blur`, `glass`, sombra em superfície estática.** Sombra
  só em modal, lista flutuante, aba ativa, tooltip — que já vêm do primitivo.
- **Nenhum texto abaixo de 12px:** `text-[10px]`/`text-[11px]` → `text-xs`.
  Exceção: a letra dentro das pílulas de ecossistema (`EcosystemPills`,
  quadrado de 14px) é marca, não texto corrido — fica.
- **Ícone é componente, nunca emoji** (fora de comentário).
- **`focus-visible`, nunca `focus:`.** `dark:` sai onde há token.
- **Chip/badge clicável mantém hover visível**: `hover:bg-x/20` do seu par
  (neutro: `hover:bg-surface-elevated`). É o padrão da casa até existir um
  estado interativo no `Badge`.
- **Frontend:** `cd frontend && npx tsc --noEmit -p tsconfig.app.json && npx vite build && npm run build:landing`.
  `tsc` tem **4 erros pré-existentes** (`LeadScoringSettings` ×1,
  `useJourneys` ×3); nenhum novo.
- **Guarda:** `npm run -s guarda:visual -- <pasta ou arquivo>` sai 0 no escopo
  da tarefa.
- **Navegador:** Playwright; backend `127.0.0.1:8100`, Vite `127.0.0.1:8080`;
  login com a conta admin do Claude (`~/.config/marketinghs/claude-admin.env`,
  nunca imprimir a senha). **Só navegar por URL, ler, usar o console, passar o
  mouse, abrir diálogo/menu/popover/gaveta de visualização e aplicar filtro.
  Nunca clicar em botão de ação** (salvar, apagar, arquivar, importar, enviar,
  mudar status, marcar como qualificado, selecionar linhas para ação em
  massa, "Sincronizar"/"Importar" do DataCore, lápis de edição). Nenhuma
  escrita no banco. Tema pelo `localStorage` (`marketinghs-tema` =
  `claro`/`escuro`); deixe `claro`.
- **Toda tarefa de tela confere no claro E no escuro, com screenshot "antes"
  tirado ANTES da primeira edição.**
- **Comentário, nome e mensagem em português.**

## Tabela de tradução (a mesma do G1)

| Literal de origem | Significado | Texto sobre superfície | Fundo (tinta) | Borda |
|---|---|---|---|---|
| `green-*`, `emerald-*`, `lime-*`, `teal-*` | bom, sucesso, Hot | `text-[--on-tint-success]` | `bg-[--tint-success]` | `border-success/30` |
| `amber-*`, `yellow-*`, `orange-*` | atenção, Warm | `text-[--on-tint-warning]` | `bg-[--tint-warning]` | `border-warning/30` |
| `red-*`, `rose-*` | ruim, erro, apagar | `text-[--on-tint-danger]` | `bg-[--tint-danger]` | `border-danger/30` |
| `blue-*`, `sky-*`, `cyan-*` | informação | `text-[--on-tint-info]` | `bg-[--tint-info]` | `border-info/30` |
| `purple-*`, `violet-*`, `indigo-*`, `fuchsia-*`, `pink-*` | destaque (o DS não tem roxo) | `text-[--on-tint-primary]` | `bg-[--tint-primary]` | `border-primary/30` |
| `slate-*`, `gray-*`, `zinc-*`, `neutral-*` | neutro, Raw | `text-conteudo-muted` | `bg-[--tint-neutral]` | `border-borda` |
| `text-white` sobre fundo cheio de ação/success/info/primary/danger | texto em cor cheia | `text-primary-foreground` | — | — |
| texto sobre `warning` cheio ou cinza claro | texto em cor clara | `text-[--color-slate-900]` | — | — |
| `bg-white`, `bg-black/…` | superfície / véu | `bg-surface` / `bg-[--overlay]` | — | — |

**Decisões do G1 que valem aqui** (texto completo no `CONTINUAR-AQUI.md`):

1. Ícone (~16px) pode usar a cor cheia (`text-success`, `text-warning`,
   `text-danger`, `text-info`, `text-primary`); **texto** usa `--on-tint-*`.
2. Qualquer opacidade de tinta de origem (`/10`, `/15`, `/20`) vira a tinta
   do DS. Rampa ordinal preserva a ordem com `bg-x/NN`, crescendo com a piora.
3. Hot = success, Warm = warning, Raw = neutro; P1 success, P2 e P3 warning,
   P4 neutro — já em `src/hooks/useLeadQualification.tsx`, **não mexa**.
4. Card só decorativo vira `<Card>` puro; card cuja cor carrega status
   mantém a tinta do status.
5. Badge com significado: `<Badge variant="success" | "warning" | "info" |
   "destructive" | "secondary" | "default">`.
6. Categoria sem significado (tipo de evento, origem): chip que escreve o
   nome traduz pelo matiz e o relatório lista quais categorias passaram a
   dividir cor. Não inventar bom/ruim.
7. Par base/hover da mesma cor: base `bg-[--tint-x]`, hover `hover:bg-x/20`.

## Review Focus

1. **Cor do banco perdida ou ilegível** — um status ou etiqueta cuja cor
   escolhida pelo usuário sumiu (virou cinza) ou ficou ilegível no escuro
   (ex.: `#eab308` como texto sobre fundo claro). Conferido nas Tarefas 2 e 3
   com os 7 status reais do banco e as etiquetas reais, nos dois temas.
2. **Alfa concatenado em `var()`** — `` `${cor}15` `` que quebra em silêncio.
   Conferido por grep em toda tarefa (`\$\{[^}]+\}[0-9]{2}\b`) e pelo
   `getComputedStyle` do fundo, que tem de sair diferente de
   `rgba(0, 0, 0, 0)`.
3. **Ação destrutiva perdendo a cor de perigo** — "Apagar contato",
   "Apagar selecionados", "Excluir" na barra em massa e no menu da linha têm
   de continuar vermelhos (`text-[--on-tint-danger]`/`variant="destructive"`).
   Conferido abrindo o menu da linha (abrir é leitura) e lendo a barra em
   massa pelo código (selecionar linhas é proibido).
4. **Paginação dizendo número errado** — a frase nova tem de bater com a
   página real no primeiro, no meio e no último bloco, e sumir junto com a
   paginação quando há uma página só. Conferido navegando as páginas (o
   botão de página é navegação, permitido).
5. **Aviso de erro/indisponibilidade que ninguém vê** — os avisos âmbar do
   `DatacoreImport` e o `LimiteDeErro` quase nunca aparecem; um token errado
   neles só apareceria no dia ruim. Conferido por `getComputedStyle` sobre
   elemento com as mesmas classes criado no console, nos dois temas.

---

### Tarefa 1: O guarda enxerga efeito; o selo do medidor do G1 volta a ter fundo

**Arquivos:**
- Modificar: `frontend/scripts/guarda-visual.mjs`
- Modificar: `frontend/src/components/admin/dashboard/overview/QualificationGauge.tsx:94`

**Interfaces:**
- Produz: o guarda contando também gradiente e brilho escritos com token. As
  Tarefas 2-5 dependem do zero incluir isso.

- [ ] **Step 1: Medir antes**

```bash
cd /home/ericks/github/MarketingHS/frontend
npm run -s guarda:visual | tail -1          # esperado: 463 total
grep -rnoE "bg-gradient-|drop-shadow\(0 0|(^|[^-])\bblur-(sm|md|lg|xl|2xl|3xl)\b" src --include=*.ts --include=*.tsx \
  | grep -v "src/landing/\|src/design-system/\|emailEditorConfig" | wc -l
```

Anote o número do grep.

- [ ] **Step 2: Estender o guarda**

Em `scripts/guarda-visual.mjs`, depois de `NUMERICA`, acrescente:

```js
// Efeito proibido escrito com token (bg-gradient-to-br from-card to-primary/5,
// drop-shadow de halo, blur de enfeite): a cor é token, então HEX/LITERAL não
// o viam — foi assim que o gradiente do LeadsListSheet passou pelo G1.
// `backdrop-blur-[4px]` (fundo de modal, permitido) não casa: exige
// tamanho nomeado e não aceita o prefixo `backdrop-`.
const EFEITO = /\bbg-gradient-|drop-shadow\(0 0|(?<!backdrop-)\bblur-(?:sm|md|lg|xl|2xl|3xl)\b/g;
```

e some `(texto.match(EFEITO)?.length ?? 0)` ao `n` do laço, junto dos outros
três.

- [ ] **Step 3: Provar**

```bash
npm run -s guarda:visual | tail -1                              # 463 + <número do Step 1>
npm run -s guarda:visual -- src/components/admin/dashboard     # esperado: 0 (o G1 já tirou tudo)
node -e "const r=/\bbg-gradient-|drop-shadow\(0 0|(?<!backdrop-)\bblur-(?:sm|md|lg|xl|2xl|3xl)\b/g; console.log('backdrop-blur-[4px] backdrop-blur-sm blur-2xl bg-gradient-to-r drop-shadow(0 0 4px)'.match(r))"
```

Esperado no último: `[ 'blur-2xl', 'bg-gradient-', 'drop-shadow(0 0' ]`. Se o
`dashboard` não der 0, **pare e relate** (é regressão do G1).

- [ ] **Step 4: Selo do medidor**

`QualificationGauge.tsx:94` faz `` `${getColor()}20` ``, e `getColor()`
devolve `'var(--color-…-500)'` desde o G1 — o resultado
(`var(--color-success-500)20`) é CSS inválido e o selo "Excelente/Bom/Baixo"
ficou sem fundo. Troque por:

```tsx
              backgroundColor: `color-mix(in srgb, ${getColor()} 15%, transparent)`,
```

e a cor do texto do selo (`color: getColor()`) pelo par legível do mesmo
significado — `getColor()` não muda; no `style`, use
`color: 'var(--text-heading)'`. No navegador, em `/`, confira com
`getComputedStyle` que o `backgroundColor` do selo não é `rgba(0, 0, 0, 0)`,
nos dois temas.

- [ ] **Step 5: Portão e commit**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"   # 4
npx vite build
cd /home/ericks/github/MarketingHS
git add frontend/scripts/guarda-visual.mjs frontend/src/components/admin/dashboard/overview/QualificationGauge.tsx
git commit -m "fix(visual): guarda conta gradiente e brilho com token; selo do medidor volta a ter fundo"
```

---

### Tarefa 2: Cor de dado — status e etiquetas

**Arquivos:**
- Criar: `frontend/src/lib/corDeDado.ts`
- Modificar: `frontend/src/hooks/useLeadStatuses.ts` (o `FALLBACK_COLOR`)
- Modificar: `frontend/src/components/admin/contacts/StatusBadge.tsx`,
  `StatusDropdown.tsx`, `TagsCell.tsx`, `EcosystemPills.tsx`
- Modificar: os usos de `` `${getTagColor(…)}15` `` em
  `contacts/DetailSections.tsx:189` e dos pontos de status em
  `ContactsBulkBar.tsx:170` e `ContactsFiltersBar.tsx:63` — **só a linha de
  cor**; o resto desses arquivos é das Tarefas 3 e 4

**Interfaces:**
- Produz (exatos, as Tarefas 3-4 usam):
  - `resolverCorDeDado(cor?: string | null): string`
  - `estiloDeCorDeDado(cor?: string | null): React.CSSProperties`
  - `COR_DE_DADO_PADRAO: string`
- `getTagColor(color: string): string` (de `TagsCell.tsx`) e `STATUS_COLORS`/
  `STATUS_OPTIONS` (de `StatusBadge.tsx`) **continuam exportados com o mesmo
  nome e tipo**.

**Por que é diferente do resto:** `lead_statuses.color` e `tags.color` são
escolhidos pelo usuário (medido em 24/09: os 7 status têm `#94a3b8`,
`#a78bfa`, `#38bdf8`, `#22c55e`, `#eab308`, `#f97316`, `#10b981`; as etiquetas
têm `purple` ×3 e `#3b82f6` ×1). Cor escolhida pelo usuário é **dado** — a
tela não a troca por token, só a apresenta de forma legível: a cor vai na
borda, no ponto e num fundo de 12%, e o texto fica na cor de título. O
hexadecimal que sobra é o que o banco manda em tempo de execução; no código,
nenhum.

- [ ] **Step 1: Antes**

Screenshots de `/contacts` (claro e escuro), com a coluna de status e de
etiquetas visíveis, e da ficha de um contato que tenha etiqueta (abra
clicando no **nome** da linha — é leitura). Anote no relatório a cor que cada
um dos 7 status mostra hoje.

- [ ] **Step 2: O auxiliar**

`frontend/src/lib/corDeDado.ts`:

```ts
import type { CSSProperties } from 'react';

// Cor que vem do banco (lead_statuses.color, tags.color) é DADO: quem
// escolhe é o usuário, em Configurações. A tela não a troca por token —
// só a apresenta de um jeito legível nos dois temas: a cor vai na borda,
// no ponto e num fundo de 12%; o texto fica na cor de título.

// Nomes que o sistema grava em vez de hexadecimal (tags.color = 'purple').
// O DS não tem roxo nem verde-azulado: roxo vira primária, teal vira
// sucesso escuro — as mesmas decisões do G1.
const PALETA_NOMEADA: Record<string, string> = {
  purple: 'var(--color-primary-600)',
  blue: 'var(--color-info-600)',
  green: 'var(--color-success-600)',
  amber: 'var(--color-warning-600)',
  red: 'var(--color-danger-600)',
  teal: 'var(--color-success-700)',
};

export const COR_DE_DADO_PADRAO = 'var(--color-slate-400)';

export function resolverCorDeDado(cor?: string | null): string {
  if (!cor) return COR_DE_DADO_PADRAO;
  return PALETA_NOMEADA[cor] ?? cor;
}

// Nunca `${cor}15`: sufixo de alfa só funciona com hexadecimal e quebra em
// silêncio com var(--…). color-mix aceita os dois.
export function estiloDeCorDeDado(cor?: string | null): CSSProperties {
  const c = resolverCorDeDado(cor);
  return {
    borderColor: c,
    backgroundColor: `color-mix(in srgb, ${c} 12%, transparent)`,
  };
}
```

- [ ] **Step 3: Os consumidores**

- `useLeadStatuses.ts`: `const FALLBACK_COLOR = '#888780';` →
  `import { COR_DE_DADO_PADRAO } from '@/lib/corDeDado';` e
  `const FALLBACK_COLOR = COR_DE_DADO_PADRAO;`. Nada mais muda.
- `StatusBadge.tsx`: o `style` do `Badge` vira `estiloDeCorDeDado(color)` e o
  `className` ganha `text-conteudo-heading` (sai o `color: color`). O
  fallback `'#888780'` da linha do `const color` vira `COR_DE_DADO_PADRAO`.
  `STATUS_COLORS` continua exportado, com os valores trocados por token pelo
  lugar do status no funil (é a cor de reserva quando o banco não responde):
  `'Lead'` → `'var(--color-slate-400)'`, `'Lead Qualificado'` →
  `'var(--color-info-600)'`, `'MQL - Reunião agendada'` →
  `'var(--color-primary-600)'`, `'SQL - Em negociação'` →
  `'var(--color-warning-600)'`, `'Venda realizada'` →
  `'var(--color-success-600)'`, `'Em contrato'` →
  `'var(--color-success-700)'`, `'Iniciado'` → `'var(--color-primary-800)'`.
- `TagsCell.tsx`: `TAG_COLORS` sai; `getTagColor` continua exportado e
  passa a devolver `resolverCorDeDado(color)`. O `style` do `Badge` vira
  `estiloDeCorDeDado(tag.color)`, o `className` troca `text-[10px]` por
  `text-xs` e ganha `text-conteudo-heading`. O badge `+N` também `text-xs`.
- `DetailSections.tsx:189` (só esse `style`): mesmo tratamento do
  `TagsCell`.
- `StatusDropdown.tsx`: onde a cor pinta um ponto
  (`style={{ backgroundColor: getColor(opt) }}`), fica — ponto cheio na cor
  do dado é legível. Onde pinta texto ou fundo com alfa concatenado, use
  `estiloDeCorDeDado` + `text-conteudo-heading`.
- `ContactsBulkBar.tsx:170` e `ContactsFiltersBar.tsx:63`: os pontos usam
  `STATUS_COLORS[s]` — ficam como estão (agora token pelo Step 3).
- `EcosystemPills.tsx`: MarketingHS `'#534AB7'` → `'var(--color-primary-600)'`,
  GrowthHS `'#15803D'` → `'var(--color-success-700)'`, `color: '#fff'` →
  `color: 'var(--text-on-primary)'`.

- [ ] **Step 4: Provar**

```bash
cd /home/ericks/github/MarketingHS/frontend
npm run -s guarda:visual -- src/lib/corDeDado.ts                          # 0
npm run -s guarda:visual -- src/hooks                                     # 0
for f in StatusBadge StatusDropdown TagsCell EcosystemPills; do npm run -s guarda:visual -- src/components/admin/contacts/$f.tsx | tail -1; done   # 0 em cada
grep -rnE '\$\{[^}]+\}[0-9]{2}\b' src --include=*.tsx                    # nenhuma linha
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"           # 4
```

No navegador, `/contacts` e a ficha, claro e escuro: os 7 status continuam
com a **cor do banco** na borda e no fundo (compare com o "antes" e com a
lista do Step 1), o texto legível nos dois temas (Review Focus 1), e o
`backgroundColor` de um `StatusBadge` e de um badge de etiqueta ≠
`rgba(0, 0, 0, 0)` pelo `getComputedStyle`.

- [ ] **Step 5: Commit**

```bash
cd /home/ericks/github/MarketingHS
git add frontend/src/lib/corDeDado.ts frontend/src/hooks/useLeadStatuses.ts frontend/src/components/admin/contacts/{StatusBadge,StatusDropdown,TagsCell,EcosystemPills,DetailSections}.tsx
git commit -m "feat(visual): cor de status e etiqueta é dado — apresentada por corDeDado, sem hex no código"
```

(Se `DetailSections.tsx` ou `StatusDropdown.tsx` não mudaram, tire-os do
`git add`.)

---

### Procedimento comum às Tarefas 3-5 (cada tarefa aponta para cá)

- [ ] **A. Antes de editar — medir e fotografar**

```bash
cd /home/ericks/github/MarketingHS/frontend
npm run -s guarda:visual -- <cada arquivo da tarefa>
grep -nE "text-\[(8|9|10|11)px\]|shadow-(sm|md|lg|xl|2xl)|dark:|focus:|\\\$\{[^}]+\}[0-9]{2}\b" <arquivos> | wc -l
```

Screenshots de página inteira de cada rota/estado da tarefa, 1440 px, claro e
escuro, antes de tocar em qualquer arquivo. Anote erros de console que já
existam.

- [ ] **B. Listar as funções de cor por limiar ou por tipo**

Toda função/ternário/mapa que escolhe classe a partir de dado (score,
qualificação, tipo de evento, origem, resultado da importação): arquivo:linha,
faixa ou chave, cor de origem → token. O limiar e as chaves não mudam.

- [ ] **C. Traduzir**

Pela Tabela e pelas decisões do G1. `<Badge className="bg-emerald-500/20 …">`
vira `<Badge variant="success">`. Cor que vem do banco passa por
`estiloDeCorDeDado`/`resolverCorDeDado` (`@/lib/corDeDado`).

- [ ] **D. Guarda e busca complementar**

```bash
npm run -s guarda:visual -- <cada arquivo>        # 0 em todos
grep -nE "text-\[(8|9|10|11)px\]|shadow-(md|lg|xl|2xl)|dark:|focus:|backdrop-blur|glass|bg-clip-text|\\\$\{[^}]+\}[0-9]{2}\b" <arquivos>
grep -nP "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]" <arquivos> | grep -v "//\|{/\*"
```

Esperado nos dois greps: **nenhuma linha** (a letra das `EcosystemPills` é a
única exceção de tamanho, e não está nestes arquivos). `shadow-sm`/`shadow-lg`
só em lista flutuante, tooltip ou aba ativa — justifique cada um que sobrar.

- [ ] **E. Frontend compila**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"   # 4
npx vite build
```

- [ ] **F. No navegador, nos dois temas**

Cada rota/estado da tarefa, claro e escuro, comparado com o "antes": nenhum
botão, coluna, filtro, badge ou ação sumiu; texto legível; zero erro de
console novo; `getComputedStyle` de pelo menos um elemento de cada token
novo resolve cor real. Chip clicável: passe o mouse e confira que o fundo
muda.

- [ ] **G. Diff só de apresentação**

```bash
cd /home/ericks/github/MarketingHS
git diff -- <arquivos> | grep -E "^[+-]" | grep -vE "^(\+\+\+|---)" \
  | grep -vE "className|style=|variant=|lucide-react|//|^\s*[+-]\s*$"
```

Cada linha que sobrar é justificada no relatório: só as exceções nomeadas
(paginação, `<h1>`), ícone no lugar de emoji, import de `corDeDado`.

- [ ] **H. Commit** — `feat(visual): <área> sai do guarda — …`

---

### Tarefa 3: A lista de contatos (`/contacts`)

**Arquivos (`frontend/src/components/admin/contacts/`):**
`ContactsTable.tsx`, `ContactsBulkBar.tsx`, `ContactsToolbar.tsx`,
`ContactsFilterPanel.tsx`, `ContactsFiltersBar.tsx`, `QualifiedBanner.tsx`,
`DuplicatesPanel.tsx`, `ContactsExport.tsx` — e
`frontend/src/pages/admin/Contacts.tsx`.

**Rotas/estados:** `/contacts`; o painel de filtros aberto; a barra de
filtros com um filtro aplicado; o menu `⋯` de uma linha **aberto** (abrir é
leitura; não clicar nos itens); o painel de duplicatas; a visão "incluindo
apagados" (é filtro); a página 2 e a última da paginação. A barra de ação
em massa (`ContactsBulkBar`) **não** se abre (exige selecionar linhas):
confira-a por leitura de código e por `getComputedStyle` em elemento com as
mesmas classes criado no console.

**Guarda:** `src/components/admin/contacts` inteira em **0** ao fim desta
tarefa (a Tarefa 2 já zerou StatusBadge, StatusDropdown, TagsCell,
EcosystemPills; a Tarefa 4 cuida de `DetailSections` e `EventsTimeline` —
se eles ainda contarem aqui, rode o guarda só nos arquivos desta tarefa e
deixe a pasta inteira para o portão da Tarefa 6).

**Peculiar a esta tarefa:**
- **Paginação em frase** (`ContactsTable.tsx:401`, exceção nomeada): troque
  `Página {currentPage} de {totalPages}` por
  `Mostrando {startIndex + 1} a {startIndex + paginatedLeads.length} de {leads.length} contatos`
  (as três variáveis já existem nas linhas 163-170). O bloco continua dentro
  do mesmo `{totalPages > 1 && (…)}`. Confira na página 1, numa do meio e na
  última (Review Focus 4).
- **Título duplicado** (`pages/admin/Contacts.tsx:107`, exceção nomeada): o
  `<h1>Contatos</h1>` sai (a topbar já escreve "Contatos"). O `<span>` de
  "Exibindo apenas apagados"/"Incluindo apagados" **fica**, no mesmo lugar; o
  `div` pai passa a `flex items-center justify-end gap-3` para ele não pular
  para a esquerda, e o `div` inteiro só renderiza quando o `span` renderiza
  (mesma condição que já existe: `deletedView !== 'active'`) — **não** crie
  condição nova: mova a condição existente para envolver o `div`.
- `QualifiedBanner.tsx:44-52` — o azul vira o par `info` da Tabela; o botão
  `variant="outline"` com `border-blue-500/30 text-blue-400` vira
  `border-info/30 text-[--on-tint-info]`.
- `DuplicatesPanel.tsx:117` — `Nenhuma duplicata encontrada ✓` vira
  `<Check className="inline h-3.5 w-3.5" /> Nenhuma duplicata encontrada`
  (ícone antes, frase igual sem o `✓`).
- Ações destrutivas (Review Focus 3): "Apagar contato" do menu da linha e
  "Apagar"/"Excluir" da barra em massa mantêm a cor de perigo pela Tabela.
- As 35 ocorrências de `text-[10px]`/`text-[11px]` do G2 estão quase todas
  aqui: viram `text-xs`. Se isso estourar a altura de uma linha da tabela
  (`h-5`/`h-6` fixo em badge), tire a altura fixa e deixe o `py-0.5` do
  primitivo mandar — e registre no relatório.

Siga o **Procedimento comum**, A a H. Commit:
`feat(visual): lista de contatos sai do guarda — paginação em frase, sem título duplicado`.

---

### Tarefa 4: A ficha do contato (`LeadDetailSheet`)

**Arquivos:** `frontend/src/components/admin/LeadDetailSheet.tsx`,
`frontend/src/components/admin/contacts/DetailSections.tsx`,
`frontend/src/components/admin/contacts/EventsTimeline.tsx`,
`frontend/src/components/ui/badge.tsx` (só o `forwardRef`, abaixo).

**Rotas/estados:** a ficha aberta a partir de `/contacts` (clicar no **nome**
de uma linha abre a gaveta — é leitura), para dois contatos: um com
etiqueta, eventos e pontuação; outro "Hot" ou qualificado, se houver.
Todas as seções da ficha expandidas (expandir seção é leitura). **Não**
clicar em "Marcar como qualificado", "Enviar ao GrowthHS", mudar status,
apagar, nem no lápis.

**Guarda:** `LeadDetailSheet.tsx`, `DetailSections.tsx`, `EventsTimeline.tsx`
em 0.

**Peculiar a esta tarefa:**
- `LeadDetailSheet.tsx` tem gradiente/brilho (o grep da Tarefa 1 o aponta):
  o `SheetContent` fica só com as classes de layout, como o `LeadsListSheet`
  do G1.
- Os `⚠️` de `LeadDetailSheet.tsx:220,259,267,355` estão em **comentário** —
  ficam.
- `EventsTimeline.tsx` — tipo de evento é **categoria** (decisão 6 do G1):
  traduza pelo matiz, liste no relatório quais tipos passaram a dividir cor.
  Ícone do evento pode usar a cor cheia (decisão 1).
- **`Badge` sem `forwardRef`** (dívida da Fase 1): o aviso de console
  `Function components cannot be given refs` sai de `DetailSections.tsx`
  (`Badge` dentro de `TooltipTrigger asChild`). Em `ui/badge.tsx`, embrulhe o
  componente em `React.forwardRef<HTMLDivElement, BadgeProps>` e passe o
  `ref` ao `div`, com `Badge.displayName = "Badge"`. Nome, props, variantes e
  `badgeVariants` **não mudam** — é a mesma API, agora aceitando `ref`.
  Confira que o aviso sumiu do console ao abrir a ficha.

Siga o **Procedimento comum**, A a H. Commit:
`feat(visual): ficha do contato sai do guarda — Badge ganha forwardRef`.

---

### Tarefa 5: A importação (`/import`) e o limite de erro

**Arquivos:** `frontend/src/components/admin/LeadsImport.tsx`,
`frontend/src/components/admin/DatacoreImport.tsx`,
`frontend/src/pages/admin/ImportPage.tsx`,
`frontend/src/components/admin/LimiteDeErro.tsx`.

**Rotas/estados:** `/import`, aba "Arquivo CSV" e aba "DataCore (ERP)"
(trocar de aba é leitura). **Não** escolher arquivo, não importar, não
sincronizar. Os estados de pré-visualização/resultado do CSV e os avisos do
DataCore que não aparecerem ao vivo são conferidos por leitura de código e
por `getComputedStyle` em elemento criado no console com as mesmas classes
(Review Focus 5).

**Guarda:** os quatro arquivos em 0 — e, com eles, a raiz
`src/components/admin` (que era 31: 20 da ficha, 10 do DataCore, 1 do
limite de erro):
`npm run -s guarda:visual -- src/components/admin | grep -E " src/components/admin$"` sem linha.

**Peculiar a esta tarefa:**
- `DatacoreImport.tsx:58-60,79-81` — aviso âmbar com
  `text-amber-900 dark:text-amber-200`: vira `bg-[--tint-warning]
  border-warning/30`, ícone `text-warning`, texto `text-[--on-tint-warning]`
  e **sai o `dark:`** (o `--on-tint-*` já troca de tom). Se o componente for
  um aviso de verdade, prefira `<Alert>` com a classe de tinta — mas só se
  não mudar a estrutura além disso.
- `LimiteDeErro.tsx:31` — ícone `text-amber-500` → `text-warning`.
- **Título duplicado** (`ImportPage.tsx:8`, exceção nomeada): o
  `<h1>Importar</h1>` sai; a topbar escreve "Importar".
- `LeadsImport.tsx` não conta no guarda, mas passe o grep do passo D — ele
  pode ter `text-[10px]`, sombra ou emoji.

Siga o **Procedimento comum**, A a H. Commit:
`feat(visual): importação e limite de erro saem do guarda`.

---

### Tarefa 6: Portão do G2 e registro

**Arquivos:** `docs/CONTINUAR-AQUI.md` (bloco novo no topo: "Visual — Fase 2,
G2"); `frontend/src/design-system/ORIGEM.md` só se aparecer defeito novo
do DS.

- [ ] **Step 1: Portão**

```bash
cd /home/ericks/github/MarketingHS/frontend
npm run -s guarda:visual -- src/components/admin/contacts          # 0
npm run -s guarda:visual -- src/components/admin/dashboard         # 0 (o G1 não regrediu)
npm run -s guarda:visual -- src/hooks                              # 0
npm run -s guarda:visual -- src/lib                                # 0
npm run -s guarda:visual | tail -12                                 # placar do app, por pasta
grep -rnE '\$\{[^}]+\}[0-9]{2}\b' src --include=*.tsx              # nenhuma linha
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"     # 4
npx vite build && npm run build:landing
cd .. && sha256sum frontend/src/design-system/tokens/*.css frontend/src/design-system/styles.css
```

Hashes batem com o `ORIGEM.md`.

- [ ] **Step 2: Capacidade por capacidade**

```bash
git diff d4007e6 --stat -- frontend/src
git diff d4007e6 -- frontend/src | grep -E "^[+-]" | grep -vE "^(\+\+\+|---)" \
  | grep -vE "className|style=|variant=|lucide-react|//|^\s*[+-]\s*$"
```

Cada linha que sobrar é justificada no relatório; no registro, uma linha de
resumo.

- [ ] **Step 3: Telas nos dois temas**

`/contacts` (com filtro, com menu da linha aberto, página 2), a ficha do
contato, `/import` nas duas abas, e `/` (o selo do medidor da Tarefa 1),
claro e escuro, 1440 px; `/contacts` também a 390 px (anote rolagem
horizontal, não conserte). Zero erro de console novo — e o aviso de `ref`
do `Badge` **sumido**.

- [ ] **Step 4: Registro**

Bloco novo no topo do `CONTINUAR-AQUI.md`, no molde do bloco do G1: tabela de
commits; placar do guarda antes → depois por pasta (com a nota de que o
guarda passou a contar efeito na Tarefa 1, e quanto isso somou); o que cada
Review Focus achou; o conserto do selo do medidor (regressão do G1 que as
revisões não viram — a lição: nunca `` `${cor}NN` ``); **Decisões tomadas
nesta fase, reversíveis**:

1. Cor de status e etiqueta é dado do banco: fica a cor escolhida, na borda,
   no ponto e num fundo de 12%; o texto passa para a cor de título.
2. `STATUS_COLORS` (reserva quando o banco não responde) e as cores nomeadas
   de etiqueta viraram token pelo lugar no funil / pelo matiz.
3. Pílulas de ecossistema: MarketingHS = primária, GrowthHS = sucesso
   escuro; a letra de 9px fica (é marca).
4. `Badge` ganhou `forwardRef` (mesma API).
5. Paginação em frase e fim do `<h1>` duplicado em `/contacts` e `/import`.

E as perguntas novas para o Erick, se aparecerem — em especial: **os pontos de
status da barra em massa e da barra de filtros usam `STATUS_COLORS` fixo, não
a cor do banco** (herança da dn.ia); unificar é mudança de lógica, fora do
visual. Próximo passo: G3 (Campanhas e Templates).

```bash
git add docs/CONTINUAR-AQUI.md
git commit -m "docs(visual): Fase 2 — G2 (Contatos, ficha, Importação) fechado"
```
