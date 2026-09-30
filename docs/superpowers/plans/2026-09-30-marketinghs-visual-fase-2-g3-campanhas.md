# MarketingHS — Visual, Fase 2: G3 (Campanhas e Templates) — Plano

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para executar tarefa a tarefa.
> Os passos usam caixa de seleção (`- [ ]`) para acompanhamento.

**Objetivo:** `/campaigns` (lista, detalhe e assistente de criação) e
`/templates` (lista, editor, visualização) saem do guarda com **zero** — toda
cor de token, sem sombra estática, sem texto abaixo de 12px, sem título
duplicado — e as telas fazem **o que faziam**.

**Arquitetura:** tradução pasta a pasta pela Tabela do G1, como no G2. O G3 traz
um caso que os anteriores não tiveram: a **tela do admin que mostra o
conteúdo do e-mail**. O HTML do e-mail é exceção da Decisão 6 (já isento no
guarda: `emailEditorConfig.ts`), mas a **moldura** em volta dele é tela do
admin — e ela tem de continuar **branca nos dois temas**, porque o e-mail foi
desenhado sobre branco. Para isso existe token: `--color-white`
(`bg-[--color-white]`), que não troca com o tema. Os dois mapas de status de
campanha, hoje duplicados e idênticos, viram um módulo só.

**Stack:** React 18 · Vite · TypeScript · Tailwind 3.4.17 · shadcn/ui (Radix) · Playwright

**Spec:** `docs/superpowers/specs/2026-09-22-marketinghs-visual-design-system-design.md` (Fase 2, grupo G3; Decisão 6)
**Plano anterior (molde e decisões):** `docs/superpowers/plans/2026-09-24-marketinghs-visual-fase-2-g2-contatos.md`
**Registro:** `docs/CONTINUAR-AQUI.md`, blocos "Visual — Fase 2, G2" e "preparação e G1".

**Branch:** `visual-fase-2-g3`, a partir de `visual-fase-1` (`ced78af`, que já
contém G1 e G2).

**Escopo medido em 30/09** (guarda, por arquivo):

| Arquivo | Guarda |
|---|---|
| `components/admin/campaigns/CampaignDetail.tsx` | 48 |
| `pages/admin/Campaigns.tsx` | 23 |
| `components/admin/campaigns/CampaignWizard.tsx` | 16 |
| `components/admin/campaigns/EmailTemplateFrame.tsx` | 1 |
| `pages/admin/Templates.tsx` | 1 |
| `components/ui/sidebar.tsx` (falso positivo do guarda) | 2 |
| `TemplateEditor`, `TemplatePreview`, `EmailTemplatePreviewDialog`, `SaveAsTemplateDialog`, `SendTestEmailPopover` | 0 |

Placar do app no começo: **338**. Esperado no fim: **338 − 91 = 247**
(`campaigns` 65 → 0, `pages/admin` 68 → 44, `ui` 2 → 0).

---

## Restrições globais

- ⚠️ **A tela faz o que fazia.** O `git diff` mostra só classe, cor, token e
  marcação de apresentação. **Nenhuma** lógica, rota, chamada de API,
  condição, `useState`, `onClick`, texto de dado ou limiar numérico muda.
  Exceções nomeadas neste plano: a remoção do `<h1>` duplicado (Tarefa 2) e a
  mudança dos mapas de status para um módulo (Tarefa 2). Se um conserto
  exigir outra mudança de lógica, **pare e relate**.
- ⚠️ **`frontend/src/design-system/` não se edita.** ⚠️ **`emailEditorConfig.ts`
  não se edita** — é o HTML do e-mail (Decisão 6).
- **Cor sai de token**, pela Tabela de tradução. Nenhum hexadecimal, cor
  literal do Tailwind (inclusive `white`/`black`), `hsl()`/`rgb()` numérico.
  Em `style={{}}`/SVG o token entra como string (`'var(--color-success-700)'`).
- ⚠️ **Nunca concatenar sufixo de alfa numa cor** (`` `${cor}15` ``): quebra em
  silêncio com `var(--…)`. Use `` `color-mix(in srgb, ${cor} 12%, transparent)` ``.
- **Nada de gradiente, brilho decorativo, `backdrop-blur`, `glass`, sombra em
  superfície estática.** Sombra só em modal, lista flutuante, aba ativa,
  tooltip — que já vêm do primitivo.
- **Nenhum texto abaixo de 12px:** `text-[10px]`/`text-[11px]` → `text-xs`.
- **Ícone é componente, nunca emoji** (fora de comentário). O `⚠️` de
  `SendTestEmailPopover.tsx:51` é comentário — fica.
- **`focus-visible`, nunca `focus:`.** `dark:` sai onde há token.
- **Botão não ganha cor por `className`** quando o primitivo já tem a
  variante: `className="bg-primary hover:bg-primary/90"` e `bg-green-600`
  saem; o `<Button>` padrão já é `--action` com hover de um passo.
- **Chip/badge clicável mantém hover visível** (`hover:bg-x/20`).
- **Moldura de e-mail é branca nos dois temas:** `bg-[--color-white]`, nunca
  `bg-surface`/`bg-card` (que ficam escuros no tema escuro e deixam o texto do
  e-mail preto sobre preto quando o HTML não pinta o próprio fundo).
- **Frontend:** `cd frontend && npx tsc --noEmit -p tsconfig.app.json && npx vite build && npm run build:landing`.
  `tsc` tem **4 erros pré-existentes** (`LeadScoringSettings` ×1,
  `useJourneys` ×3); nenhum novo.
- **Guarda:** `npm run -s guarda:visual -- <pasta ou arquivo>` sai 0 no escopo
  da tarefa.
- **Navegador:** Playwright; backend `127.0.0.1:8100`, Vite `127.0.0.1:8080`.
  O banco é o de **produção**. **Subagente não abre o arquivo de credencial**:
  reaproveita a sessão já logada do navegador do Playwright; se não houver
  sessão, **para e pede** ao controlador. Ação negada pelo controle de
  permissão não se repete com outra descrição: relata.
- **O que se pode fazer no navegador:** navegar por URL, ler, usar o console,
  passar o mouse, abrir diálogo/menu/popover/gaveta, trocar de aba e de passo
  no assistente **em modo consulta** ("Ver campanha" de uma campanha
  enviada), e — só num assistente de campanha **nova** — digitar nos campos,
  escolher canal e usar "Próximo"/"Voltar". **Nunca clicar** em: "Enviar
  campanha", "Agendar campanha", "Salvar alterações", "Confirmar envio",
  "Confirmar agendamento", "Duplicar", "Editar" (de campanha agendada ou
  rascunho), "Cancelar agendamento", "Excluir", "Salvar template", "Salvar
  como template", "Enviar teste", "Aplicar" template. Ao terminar um
  assistente novo, feche pelo X **sem salvar**. Nenhuma escrita no banco.
  Tema pelo `localStorage` (`marketinghs-tema` = `claro`/`escuro`); deixe
  `claro`.
- **Toda tarefa de tela confere no claro E no escuro, com screenshot "antes"
  tirado ANTES da primeira edição.**
- **Comentário, nome e mensagem em português.**

## Tabela de tradução (a mesma do G1 e do G2)

| Literal de origem | Significado | Texto sobre superfície | Fundo (tinta) | Borda |
|---|---|---|---|---|
| `green-*`, `emerald-*`, `lime-*`, `teal-*` | bom, sucesso | `text-[--on-tint-success]` | `bg-[--tint-success]` | `border-success/30` |
| `amber-*`, `yellow-*`, `orange-*` | atenção | `text-[--on-tint-warning]` | `bg-[--tint-warning]` | `border-warning/30` |
| `red-*`, `rose-*` | ruim, erro, apagar | `text-[--on-tint-danger]` | `bg-[--tint-danger]` | `border-danger/30` |
| `blue-*`, `sky-*`, `cyan-*` | informação, em andamento | `text-[--on-tint-info]` | `bg-[--tint-info]` | `border-info/30` |
| `purple-*`, `violet-*`, `indigo-*`, `fuchsia-*`, `pink-*` | destaque (o DS não tem roxo) | `text-[--on-tint-primary]` | `bg-[--tint-primary]` | `border-primary/30` |
| `slate-*`, `gray-*`, `zinc-*`, `neutral-*` | neutro | `text-conteudo-muted` | `bg-[--tint-neutral]` | `border-borda` |
| `text-white` sobre fundo cheio | texto em cor cheia | `text-primary-foreground` | — | — |
| texto sobre `warning` cheio ou cinza claro | texto em cor clara | `text-[--color-slate-900]` | — | — |
| `bg-white` de **superfície do admin** | superfície | `bg-surface` | — | — |
| `bg-white` de **moldura de e-mail / maquete** | papel, fixo | `bg-[--color-white]` | — | — |

**Regras aprendidas no G1/G2 que valem aqui** (texto completo no
`CONTINUAR-AQUI.md`):

1. Tradução por **significado**, nunca pelo matiz — exceto categoria sem
   significado (canal, tipo), que traduz pelo matiz e o relatório lista quem
   passou a dividir cor.
2. Ícone (~16px) pode usar a cor cheia (`text-success`, `text-info`…);
   **texto** usa `--on-tint-*`.
3. Qualquer opacidade de tinta de origem (`/5`, `/10`, `/15`) vira a tinta do
   DS.
4. Cor que vem do banco passa por `src/lib/corDeDado.ts` — **não há** cor de
   banco neste grupo (medido em 30/09); se aparecer, use o auxiliar.
5. Chip clicável mantém hover (`hover:bg-x/20`).
6. **O brief autoriza "o que mais for preciso para zerar o guarda nos
   arquivos da tarefa"** — mas nunca além de apresentação.

## Review Focus

1. **Moldura de e-mail escura no tema escuro** — se a moldura do preview
   (`EmailTemplateFrame`, preview do passo 3 do assistente, miniatura de
   `/templates`) virar `bg-surface`, o e-mail cujo HTML não pinta o próprio
   fundo aparece preto sobre preto. Conferido no escuro, em cada uma das três,
   pelo `getComputedStyle(...).backgroundColor === 'rgb(255, 255, 255)'` e a
   olho. (Tarefas 2 e 4.)
2. **Status de campanha e de envio se confundindo** — "Agendada" (primária),
   "Enviando..." (info), "Enviada" (sucesso), "Pausada" (atenção), "Falhou"
   (perigo), "Rascunho" (neutro) têm de continuar distinguíveis nos dois
   temas; no detalhe, "Suprimido" (neutro) tem de continuar diferente de
   "Falhou"/"Bounce" (perigo) — o comentário no código diz que é de
   propósito. Conferido com as campanhas reais da lista e por elemento
   sintético para os status que não houver no banco. (Tarefas 2 e 3.)
3. **O botão de envio perdendo a cara de ação principal** — "Enviar
   campanha"/"Agendar campanha" e "Confirmar envio" saem do verde fixo para o
   `--action`; têm de continuar cheios, legíveis e com estado desabilitado
   visível ("Agendar" sem data). E o `e.preventDefault()` do
   `AlertDialogAction` **não pode** sair do diff — ele impede campanha
   duplicada (comentário longo no código). Conferido por leitura do diff e,
   no navegador, só olhando o botão (sem clicar). (Tarefa 4.)
4. **Card "Enviando pela fila" que ninguém vê** — só aparece com campanha no
   meio do envio; um token errado nele só apareceria no dia do disparo.
   Conferido por `getComputedStyle` sobre elemento com as mesmas classes
   criado no console, nos dois temas: fundo ≠ `rgba(0, 0, 0, 0)`, texto com
   contraste. (Tarefa 3.)
5. **Ação destrutiva perdendo a cor de perigo** — "Excluir" nos menus de
   `/campaigns` e `/templates` (`text-destructive`) e o `AlertDialogAction
   className="bg-destructive"` de `Templates.tsx:106` continuam vermelhos.
   Conferido abrindo o menu (abrir é leitura; não clicar no item) e lendo o
   código do diálogo. (Tarefa 2.)

---

### Tarefa 1: O guarda deixa de contar o anel de 1px

**Arquivos:**
- Modificar: `frontend/scripts/guarda-visual.mjs` (a regex `EFEITO`)

**Interfaces:**
- Produz: o guarda sem o falso positivo de `ui/sidebar.tsx:421`
  (`shadow-[0_0_0_1px_…]` é anel de borda, não brilho). As Tarefas 2-4 e o
  placar dependem disso.

- [ ] **Step 1: Medir antes**

```bash
cd /home/ericks/github/MarketingHS/frontend
npm run -s guarda:visual | tail -1                  # esperado: 338 total
npm run -s guarda:visual -- src/components/ui       # esperado: 2
```

- [ ] **Step 2: Apertar a regex**

Em `scripts/guarda-visual.mjs`, na constante `EFEITO`, troque
`shadow-\[0_0_` por `shadow-\[0_0_[1-9]` e acrescente ao comentário acima
dela:

```js
// `shadow-[0_0_0_1px_…]` (anel de 1px, usado como borda no sidebar) não
// casa: brilho tem desfoque ≥ 1 no terceiro valor; anel tem 0.
```

- [ ] **Step 3: Provar**

```bash
npm run -s guarda:visual | tail -1                  # esperado: 336 total
npm run -s guarda:visual -- src/components/ui       # esperado: 0
node -e "const r=/shadow-\[0_0_[1-9]/g; console.log('shadow-[0_0_0_1px_x] shadow-[0_0_12px_x] shadow-[0_0_4px]'.match(r))"
```

Esperado no último: `[ 'shadow-[0_0_1', 'shadow-[0_0_4' ]`. Os brilhos de
verdade (`0_0_12px`, `0_0_4px`) continuam contando; o anel (`0_0_0_1px`) sai.
Confira também que `src/components/admin/segments` continua **10** (os
brilhos do `SegmentFormModal` são `0_0_Npx` com N ≥ 1 e não podem sumir).

- [ ] **Step 4: Commit**

```bash
cd /home/ericks/github/MarketingHS
git add frontend/scripts/guarda-visual.mjs
git commit -m "fix(visual): guarda não conta o anel de 1px do sidebar como brilho"
```

---

### Procedimento comum às Tarefas 2-4 (cada tarefa aponta para cá)

- [ ] **A. Antes de editar — medir e fotografar**

```bash
cd /home/ericks/github/MarketingHS/frontend
npm run -s guarda:visual -- <cada arquivo da tarefa>
grep -nE "text-\[(8|9|10|11)px\]|shadow-(sm|md|lg|xl|2xl)|dark:|focus:|\\\$\{[^}]+\}[0-9]{2}\b" <arquivos> | wc -l
```

Screenshots de página inteira de cada rota/estado da tarefa, 1440 px, claro e
escuro, antes de tocar em qualquer arquivo. Anote erros de console que já
existam.

- [ ] **B. Listar os mapas e ternários de cor**

Todo mapa/ternário que escolhe classe a partir de dado (status da campanha,
status do envio, canal): arquivo:linha, chave, cor de origem → token. As
chaves e os rótulos não mudam.

- [ ] **C. Traduzir** pela Tabela e pelas regras acima.

- [ ] **D. Guarda e busca complementar**

```bash
npm run -s guarda:visual -- <cada arquivo>        # 0 em todos
grep -nE "text-\[(8|9|10|11)px\]|shadow-(md|lg|xl|2xl)|dark:|focus:|backdrop-blur|glass|bg-clip-text|\\\$\{[^}]+\}[0-9]{2}\b" <arquivos>
grep -nP "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]" <arquivos> | grep -v "//\|{/\*"
```

Esperado nos dois greps: **nenhuma linha**. `shadow-sm` só em lista
flutuante, tooltip ou aba ativa — justifique cada um que sobrar.

- [ ] **E. Frontend compila**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"   # 4
npx vite build
```

- [ ] **F. No navegador, nos dois temas**

Cada rota/estado da tarefa, claro e escuro, comparado com o "antes": nenhum
botão, coluna, badge, passo ou ação sumiu; texto legível; zero erro de
console novo; `getComputedStyle` de pelo menos um elemento de cada token
novo resolve cor real (≠ `rgba(0, 0, 0, 0)`).

- [ ] **G. Diff só de apresentação**

```bash
cd /home/ericks/github/MarketingHS
git diff -- <arquivos> | grep -E "^[+-]" | grep -vE "^(\+\+\+|---)" \
  | grep -vE "className|style=|variant=|lucide-react|//|^\s*[+-]\s*$"
```

Cada linha que sobrar é justificada no relatório: só as exceções nomeadas
(`<h1>`, módulo de status), ícone no lugar de emoji, import.

- [ ] **H. Commit** — `feat(visual): <área> sai do guarda — …`

---

### Tarefa 2: A lista de campanhas (`/campaigns`) e a de templates (`/templates`)

**Arquivos:**
- Criar: `frontend/src/components/admin/campaigns/statusDeCampanha.ts`
- Modificar: `frontend/src/pages/admin/Campaigns.tsx`,
  `frontend/src/pages/admin/Templates.tsx`

**Interfaces:**
- Produz (exato, a Tarefa 3 usa):
  `export const STATUS_DE_CAMPANHA: Record<string, { label: string; className: string }>`
  em `@/components/admin/campaigns/statusDeCampanha`.
- `Campaigns.tsx` passa a importá-lo no lugar do seu `statusConfig` local;
  o uso (`statusConfig[c.status] || statusConfig.draft`) vira
  `STATUS_DE_CAMPANHA[c.status] || STATUS_DE_CAMPANHA.draft` — mesma
  expressão, outro nome.

**Por que um módulo:** `Campaigns.tsx:15-22` e `CampaignDetail.tsx:20-27` são
hoje o mesmo mapa, copiado (conferido com `diff` em 30/09: iguais). Traduzir
os dois à mão é o caminho para eles divergirem — que é o que aconteceu com a
cor de status dos contatos no G2. Mover o mapa não é lógica: chave, rótulo e
fallback ficam idênticos.

**Rotas/estados:** `/campaigns` com a lista (campanhas de status diferentes,
se houver); o menu `⋯` de uma linha **aberto** (não clicar nos itens);
`/templates` com as miniaturas; o menu `⋯` de um template aberto. Estado
vazio não se provoca (exigiria apagar) — confira por leitura de código.

**Guarda:** `Campaigns.tsx`, `Templates.tsx` e `statusDeCampanha.ts` em 0.

- [ ] **Step 1:** Procedimento comum A e B.

- [ ] **Step 2: O módulo de status**

`frontend/src/components/admin/campaigns/statusDeCampanha.ts`:

```ts
// Status da campanha → rótulo e cor. Era um mapa copiado em Campaigns.tsx e
// CampaignDetail.tsx; um só lugar evita que as duas telas pintem o mesmo
// status de cores diferentes. Tradução por significado: agendada é destaque
// (o DS não tem roxo), enviando é informação em andamento.
export const STATUS_DE_CAMPANHA: Record<string, { label: string; className: string }> = {
  draft: { label: 'Rascunho', className: 'bg-muted text-muted-foreground' },
  scheduled: { label: 'Agendada', className: 'bg-[--tint-primary] text-[--on-tint-primary] border-primary/30' },
  sending: { label: 'Enviando...', className: 'bg-[--tint-info] text-[--on-tint-info] border-info/30' },
  sent: { label: 'Enviada', className: 'bg-[--tint-success] text-[--on-tint-success] border-success/30' },
  paused: { label: 'Pausada', className: 'bg-[--tint-warning] text-[--on-tint-warning] border-warning/30' },
  failed: { label: 'Falhou', className: 'bg-[--tint-danger] text-[--on-tint-danger] border-danger/30' },
};
```

- [ ] **Step 3: `Campaigns.tsx`**

- Apaga o `statusConfig` local (linhas 15-22); importa
  `STATUS_DE_CAMPANHA`; troca os dois usos da linha ~150.
- **Título duplicado** (linha 72, exceção nomeada): `<h1>Campanhas</h1>` sai
  (a topbar escreve "Campanhas"); o `div` pai passa de `justify-between` a
  `justify-end`, para o botão ficar à direita.
- Botão "Nova campanha": sai `className="bg-primary hover:bg-primary/90"`.
- Ícones dos quatro cartões de número (linhas 83, 92, 101, 110) são
  **categoria** (regra 1): o primeiro já é `bg-primary/10` → `bg-[--tint-primary]`;
  `Users` azul → `bg-[--tint-info]` + `text-info`; `BarChart2` verde →
  `bg-[--tint-success]` + `text-success`; `MousePointerClick` laranja →
  `bg-[--tint-warning]` + `text-warning`. Registre no relatório que é leitura
  pelo matiz (clique não é "atenção").
- Badge de canal WhatsApp (linha ~165): `border-green-500/30 text-green-400`
  → `bg-[--tint-success] border-success/30 text-[--on-tint-success]`
  (canal = categoria; WhatsApp = sucesso, e a Tarefa 4 usa o mesmo par no
  seletor de canal).

- [ ] **Step 4: `Templates.tsx`**

- **Título duplicado** (linha 19): `<h1>Templates de email</h1>` sai;
  `justify-between` → `justify-end`. A topbar escreve "Templates"
  (`AdminLayout.tsx:30`, conferido em 30/09); o "de email" some junto — a
  sidebar e a própria grade de miniaturas já dizem que são de e-mail.
- Botão "Novo template": sai `className="bg-primary hover:bg-primary/90"`.
- Miniatura (linha 46): `bg-white` → `bg-[--color-white]` (moldura de e-mail;
  Review Focus 1).
- `AlertDialogAction className="bg-destructive"` (linha 106): **fica** —
  é token.

- [ ] **Step 5:** Procedimento comum D, E, F e G. No F, em `/templates` no
  escuro: `getComputedStyle` da miniatura dá `rgb(255, 255, 255)`; e os
  status reais da lista de campanhas legíveis nos dois temas (Review Focus 2);
  "Excluir" vermelho nos dois menus (Review Focus 5).

- [ ] **Step 6: Commit**

```bash
cd /home/ericks/github/MarketingHS
git add frontend/src/components/admin/campaigns/statusDeCampanha.ts frontend/src/pages/admin/Campaigns.tsx frontend/src/pages/admin/Templates.tsx
git commit -m "feat(visual): listas de campanhas e templates saem do guarda — status num módulo só, sem título duplicado"
```

---

### Tarefa 3: O detalhe da campanha (`CampaignDetail`)

**Arquivos:** `frontend/src/components/admin/campaigns/CampaignDetail.tsx`

**Interfaces:**
- Consome: `STATUS_DE_CAMPANHA` de `./statusDeCampanha` (Tarefa 2). O
  `statusConfig` local (linhas 20-27) sai; `statusConfig[liveStatus] ||
  statusConfig.draft` vira `STATUS_DE_CAMPANHA[liveStatus] ||
  STATUS_DE_CAMPANHA.draft`.

**Rotas/estados:** a gaveta aberta a partir de `/campaigns` (clicar na
**linha** abre — é leitura), para uma campanha de e-mail enviada (funil,
tabela de envios com status) e, se houver, uma de WhatsApp. O card "Enviando
pela fila" e os status de envio que não aparecerem ao vivo: elemento
sintético no console (Review Focus 2 e 4).

**Guarda:** `CampaignDetail.tsx` em 0 — e, com a Tarefa 4, a pasta
`src/components/admin/campaigns` inteira.

**Tradução exata:**

- `sendStatusBadge` (linhas 29-42):
  - `sent` azul → `bg-[--tint-info] text-[--on-tint-info]`
  - `delivered` verde e `opened` esmeralda → os dois
    `bg-[--tint-success] text-[--on-tint-success]` (**passam a dividir
    cor** — registre; o rótulo os distingue)
  - `clicked` `bg-primary/15 text-primary` → `bg-[--tint-primary] text-[--on-tint-primary]`
  - `bounced`, `failed` → `bg-[--tint-danger] text-[--on-tint-danger]`
  - `complained`, `unsubscribed` → `bg-[--tint-warning] text-[--on-tint-warning]`
  - `suppressed` → `bg-[--tint-neutral] text-conteudo-muted` (o comentário
    acima dele fica)
  - `pending` fica.
- Card "Enviando pela fila" (linhas 179-182): `border-blue-500/30
  bg-blue-500/5` → `border-info/30 bg-[--tint-info]`; o texto
  `text-blue-400` → `text-[--on-tint-info]`.
- Ícones do funil (linhas 203-249): `Send` azul → `text-info`; `Mail` verde e
  `Eye` esmeralda → `text-success`; `MousePointerClick` já é `text-primary`;
  no bloco WhatsApp, `Send` verde → `text-success`, `AlertCircle` vermelho →
  `text-danger`.
- Badges de Bounce/Marcou spam/Suprimidos (linhas 229-239): mesmos pares do
  `sendStatusBadge` (perigo, atenção, neutro), com a borda `border-x/30`
  (neutro: `border-borda`).
- `text-[10px]` dos seis rótulos do funil → `text-xs`. Se isso quebrar o
  rótulo "Entregues (NN%)" em duas linhas no `min-w-[100px]`, deixe quebrar
  e registre — não mexa em largura.

- [ ] **Step 1:** Procedimento comum A e B (o B lista o mapa acima como está
  no código, antes).
- [ ] **Step 2:** Traduzir exatamente como acima.
- [ ] **Step 3:** Procedimento comum D, E, F e G. No F: elemento sintético com
  as classes do card "Enviando" e de cada um dos 10 status de envio, nos dois
  temas — fundo ≠ `rgba(0, 0, 0, 0)`, e "Suprimido" com fundo diferente de
  "Falhou".
- [ ] **Step 4: Commit**

```bash
cd /home/ericks/github/MarketingHS
git add frontend/src/components/admin/campaigns/CampaignDetail.tsx
git commit -m "feat(visual): detalhe da campanha sai do guarda — status de envio por significado"
```

---

### Tarefa 4: O assistente de campanha (`CampaignWizard`) e a moldura do e-mail

**Arquivos:** `frontend/src/components/admin/campaigns/CampaignWizard.tsx`,
`frontend/src/components/admin/campaigns/EmailTemplateFrame.tsx`.

**Rotas/estados:**
- Assistente em **consulta**: em `/campaigns`, menu `⋯` de uma campanha
  **enviada** → "Ver campanha"; percorrer os três passos (é só leitura, o
  assistente está `isReadOnly`).
- Assistente **novo** ("Nova campanha"): passo 1 com o canal WhatsApp
  escolhido (o seletor verde), passo 2 do WhatsApp com texto digitado (a
  maquete do celular e o aviso amarelo), passo 3 de revisão (o botão de
  envio **olhado, não clicado**). Feche pelo X sem salvar.
- A moldura do e-mail: `/templates/<id>/preview` (ou o diálogo de
  visualização de `/templates`) e o passo 3 de uma campanha de e-mail em
  consulta.

**Guarda:** `CampaignWizard.tsx` e `EmailTemplateFrame.tsx` em 0; a pasta
`src/components/admin/campaigns` inteira em 0.

**Tradução exata:**

- **Seletor de canal** (linha 391): WhatsApp escolhido
  `border-green-500 bg-green-500/10 text-green-400` →
  `border-success bg-[--tint-success] text-[--on-tint-success]`. O de e-mail
  (`border-primary bg-primary/10 text-primary`) → `border-primary
  bg-[--tint-primary] text-[--on-tint-primary]`.
- **Aviso de opt-in do WhatsApp** (linha 639): `bg-yellow-500/10
  border-yellow-500/30 text-yellow-300` → `bg-[--tint-warning]
  border-warning/30 text-[--on-tint-warning]`; o `AlertTriangle` ganha
  `text-warning`. (O `text-yellow-300` era ilegível no claro — conferir no
  "antes".)
- **Maquete do WhatsApp** (linhas 647-652) — é uma **maquete**, não o
  WhatsApp: a cor sai de token e o desenho fica.
  - `style={{ backgroundColor: '#075E54' }}` → `className` com
    `bg-[--color-success-700]` (sai o `style`);
  - balão `bg-white` → `bg-[--color-white]` (papel fixo, nos dois temas);
  - texto `text-gray-800` → `text-[--color-slate-900]`;
  - hora `text-[10px] text-gray-400` → `text-xs text-[--color-slate-500]`;
  - tiques `text-blue-500` → `text-info`.
- **Preview do e-mail no passo 3** (linha 718): `bg-white` →
  `bg-[--color-white]`.
- **Botão "Enviar/Agendar campanha"** (linha 761): sai
  `className="w-full bg-green-600 hover:bg-green-700 text-white"` → fica
  `className="w-full"`; o primitivo padrão é `--action`. (Decisão: é a ação
  principal do passo, não "sucesso".)
- **`AlertDialogAction` de confirmação** (linha 832): sai
  `className="bg-green-600"`. ⚠️ O `onClick={(e) => { e.preventDefault();
  handleSend(); }}` e o `disabled={sending}` **não mudam** — confira que o
  diff não toca essas linhas (Review Focus 3).
- **`EmailTemplateFrame.tsx:56`**: `bg-white` → `bg-[--color-white]`; sai o
  `shadow-sm` (superfície estática). O `transition-[max-width]` fica (é a
  troca de largura desktop/celular, não laço).

- [ ] **Step 1:** Procedimento comum A e B.
- [ ] **Step 2:** Traduzir exatamente como acima.
- [ ] **Step 3:** Procedimento comum D, E, F e G. No F, no escuro:
  `getComputedStyle` do balão do WhatsApp e das duas molduras de e-mail dá
  `rgb(255, 255, 255)` (Review Focus 1); o botão de envio no passo 3 é cheio
  na cor de ação, e desabilitado com "Agendar" ligado e sem data (ligar o
  interruptor de agendamento num assistente novo é estado local — permitido;
  não clicar no botão). No G: nenhuma linha com `preventDefault`,
  `handleSend` ou `disabled=` no diff.
- [ ] **Step 4: Commit**

```bash
cd /home/ericks/github/MarketingHS
git add frontend/src/components/admin/campaigns/CampaignWizard.tsx frontend/src/components/admin/campaigns/EmailTemplateFrame.tsx
git commit -m "feat(visual): assistente de campanha sai do guarda — envio é ação, moldura do e-mail fica branca"
```

---

### Tarefa 5: Portão do G3 e registro

**Arquivos:** `docs/CONTINUAR-AQUI.md` (bloco novo no topo: "Visual — Fase 2,
G3"); `frontend/src/design-system/ORIGEM.md` só se aparecer defeito novo do
DS.

- [ ] **Step 1: Portão**

```bash
cd /home/ericks/github/MarketingHS/frontend
npm run -s guarda:visual -- src/components/admin/campaigns         # 0
npm run -s guarda:visual -- src/pages/admin/Campaigns.tsx          # 0
npm run -s guarda:visual -- src/pages/admin/Templates.tsx          # 0
npm run -s guarda:visual -- src/components/ui                      # 0
for a in src/components/admin/dashboard src/components/admin/contacts src/hooks src/lib; do npm run -s guarda:visual -- $a | tail -1; done   # 0 em cada (G1/G2 não regrediram)
npm run -s guarda:visual | tail -8                                  # esperado: 247 total
grep -rnE '\$\{[^}]+\}[0-9]{2}\b' src --include=*.tsx              # nenhuma linha
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"     # 4
npx vite build && npm run build:landing
cd .. && sha256sum frontend/src/design-system/tokens/*.css frontend/src/design-system/styles.css
git diff ced78af --stat -- frontend/src/components/admin/campaigns/emailEditorConfig.ts   # vazio
```

Hashes batem com o `ORIGEM.md`; `emailEditorConfig.ts` intocado.

- [ ] **Step 2: Capacidade por capacidade**

```bash
git diff ced78af --stat -- frontend
git diff ced78af -- frontend/src | grep -E "^[+-]" | grep -vE "^(\+\+\+|---)" \
  | grep -vE "className|style=|variant=|lucide-react|//|^\s*[+-]\s*$"
```

Cada linha que sobrar é justificada no relatório; no registro, uma linha de
resumo.

- [ ] **Step 3: Telas nos dois temas**

`/campaigns` (lista, menu aberto, detalhe de uma enviada, assistente em
consulta nos três passos, assistente novo com WhatsApp), `/templates`,
`/templates/new` (o editor carrega — não salvar), a visualização de um
template, claro e escuro, 1440 px; `/campaigns` também a 390 px (anote
rolagem horizontal, não conserte). Zero erro de console novo.

- [ ] **Step 4: Registro**

Bloco novo no topo do `CONTINUAR-AQUI.md`, no molde do bloco do G2: tabela de
commits; placar do guarda antes → depois por pasta (com a nota de que a
Tarefa 1 tirou 2 falsos positivos de `ui`); o que cada Review Focus achou;
**Decisões tomadas nesta fase, reversíveis**:

1. Moldura de e-mail (preview, miniatura, maquete do WhatsApp) usa
   `--color-white`: papel branco fixo nos dois temas.
2. Status da campanha num módulo só (`statusDeCampanha.ts`), por
   significado: agendada = primária, enviando = info.
3. "Enviar/Agendar campanha" e "Confirmar envio" viraram o botão de ação
   padrão, não verde.
4. WhatsApp = sucesso (canal é categoria, leitura pelo matiz), no badge e no
   seletor.
5. Categorias que passaram a dividir cor: "Entregue" e "Aberto" (sucesso);
   "Bounce" e "Falhou" (perigo, já dividiam); "Marcou spam" e
   "Descadastrado" (atenção, já dividiam); ícones dos cartões de número
   pelo matiz.
6. Fim do `<h1>` duplicado em `/campaigns` e `/templates`.

Perguntas novas para o Erick, se aparecerem. Próximo passo: G4 (Automações,
Jornadas e Segmentos).

```bash
git add docs/CONTINUAR-AQUI.md
git commit -m "docs(visual): Fase 2 — G3 (Campanhas e Templates) fechado"
```
