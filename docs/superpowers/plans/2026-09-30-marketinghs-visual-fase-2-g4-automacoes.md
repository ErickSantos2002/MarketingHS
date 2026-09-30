# MarketingHS — Visual, Fase 2: G4 (Automações, Jornadas e Segmentos) — Plano

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para executar tarefa a tarefa.
> Os passos usam caixa de seleção (`- [ ]`) para acompanhamento.

**Objetivo:** `/automations` (abas Regras e Fluxos), o construtor de fluxo
(`/automations/fluxos/:id`) e `/segments` saem do guarda com **zero** — toda
cor de token, sem gradiente, sem brilho, sem `backdrop-blur`, sem sombra
estática, sem texto abaixo de 12px, sem título duplicado, nada animando em
laço fora spinner — e as telas fazem **o que faziam**.

**Arquitetura:** tradução arquivo a arquivo pela Tabela do G1, como no G2 e no
G3. O G4 traz dois casos novos: (1) o **modal de segmento**, que é o último
reduto da estética "Aurora" da dn.ia (brilhos desfocados, número em gradiente,
`backdrop-blur-2xl`) — aqui a limpeza **remove marcação decorativa**, não só
troca classe; (2) botões de **ativar fluxo**, que no banco de produção podem
disparar e-mail — a conferência no navegador tem regras mais duras que nos
grupos anteriores.

**Stack:** React 18 · Vite · TypeScript · Tailwind 3.4.17 · shadcn/ui (Radix) · Playwright

**Spec:** `docs/superpowers/specs/2026-09-22-marketinghs-visual-design-system-design.md` (Fase 2, grupo G4)
**Plano anterior (molde e decisões):** `docs/superpowers/plans/2026-09-30-marketinghs-visual-fase-2-g3-campanhas.md`
**Registro:** `docs/CONTINUAR-AQUI.md`, blocos "Visual — Fase 2, G3", "G2" e "preparação e G1".

**Branch:** `visual-fase-2-g4`, a partir da `main` (`20574d6`, que já contém
G1, G2 e G3).

**Escopo medido em 30/09** (guarda, por arquivo):

| Arquivo | Guarda |
|---|---|
| `components/admin/automations/NodeConfigDialog.tsx` | 17 |
| `pages/admin/Automations.tsx` | 12 |
| `components/admin/segments/SegmentFormModal.tsx` | 10 |
| `pages/admin/JourneyBuilder.tsx` | 10 |
| `components/admin/automations/JourneysTab.tsx` | 9 |
| `components/admin/automations/JourneyContactsDrawer.tsx` | 9 |
| `components/admin/automations/AutomationRuleForm.tsx` | 6 |
| `components/admin/automations/JourneyCreateDialog.tsx` | 4 |
| `JourneyNodeCard`, `Segments.tsx`, `SegmentMultiSelect`, `SegmentContactsDrawer` | 0 (mas com `text-[10/11px]`, `<h1>`, `focus:`) |

**Dado real em produção (30/09):** 1 fluxo (em rascunho — não há ativo nem
pausado) e 1 segmento. Estados que não existem se conferem por elemento
sintético; nenhum se cria para conferir.

Placar do app no começo: **247**. Esperado no fim: **247 − 77 = 170**
(`automations` 45 → 0, `segments` 10 → 0, `pages/admin` 44 → 22).

---

## Restrições globais

- ⚠️ **A tela faz o que fazia.** O `git diff` mostra só classe, cor, token e
  marcação de apresentação. **Nenhuma** lógica, rota, chamada de API,
  condição, `useState`, `onClick`, texto de dado ou limiar numérico muda.
  Exceções nomeadas neste plano: a remoção do `<h1>` duplicado (Tarefas 2 e
  5) e a remoção dos `<div>` puramente decorativos do `SegmentFormModal`
  (Tarefa 5). Se um conserto exigir outra mudança de lógica, **pare e relate**.
- ⚠️ **`frontend/src/design-system/` não se edita.**
- **Cor sai de token**, pela Tabela de tradução. Nenhum hexadecimal, cor
  literal do Tailwind (inclusive `white`/`black` e `bg-white/[0.06]`),
  `hsl()`/`rgb()` numérico.
- ⚠️ **Nunca concatenar sufixo de alfa numa cor** (`` `${cor}15` ``). Use
  `` `color-mix(in srgb, ${cor} 12%, transparent)` ``.
- **Nada de gradiente (inclusive `bg-clip-text`), brilho decorativo,
  `backdrop-blur`, `glass`, sombra em superfície estática.** Sombra só em
  modal, lista flutuante, aba ativa, tooltip — que já vêm do primitivo. O
  modal (`DialogContent`) **não** ganha sombra própria: a do primitivo basta.
- **Nada animando em laço fora spinner:** `animate-pulse` em texto sai.
- **Nenhum texto abaixo de 12px:** `text-[9px]`/`text-[10px]`/`text-[11px]` →
  `text-xs`. E **texto pequeno não fica mais claro que o muted**:
  `text-muted-foreground/60` e `/70` → `text-muted-foreground` (o muted do DS
  já é o limite de contraste — defeito conhecido no `ORIGEM.md`).
- **Ícone é componente, nunca emoji** (fora de comentário). Os `⚠️` de
  `AutomationRuleForm.tsx:25,67`, `Automations.tsx:53,83` e
  `SegmentFormModal.tsx:125`, e os `✕` de `SegmentMultiSelect.tsx:70,98`, são
  comentário — ficam.
- **`focus-visible`, nunca `focus:`.** `dark:` sai onde há token.
- **Botão não ganha cor por `className`** quando o primitivo tem a variante:
  `bg-emerald-600 hover:bg-emerald-600/90 text-white` e gradientes saem; o
  `<Button>` padrão já é `--action`.
- ⚠️ **"Excluir" de confirmação** (`AlertDialogAction`, que aplica
  `buttonVariants()` padrão): `className="bg-destructive …"` deixa a borda
  `border-action` e o hover azul. Troque pela string exata da variante
  `destructive` de `components/ui/button.tsx:13`:
  `bg-danger text-destructive-foreground border border-danger hover:bg-danger/90`
  (lição da revisão final do G3).
- **Chip/badge clicável mantém hover visível.**
- **Frontend:** `cd frontend && npx tsc --noEmit -p tsconfig.app.json && npx vite build && npm run build:landing`.
  `tsc` tem **4 erros pré-existentes** (`LeadScoringSettings` ×1,
  `useJourneys` ×3); nenhum novo. ⚠️ Os 3 de `useJourneys` são **deste
  grupo** — não conserte (é lógica); só confira que continuam 3.
- **Guarda:** `npm run -s guarda:visual -- <pasta ou arquivo>` sai 0 no escopo
  da tarefa.
- **Navegador:** Playwright; backend `127.0.0.1:8100`, Vite `127.0.0.1:8080`.
  O banco é o de **produção**. **Subagente não abre arquivo de credencial**
  (`~/.config/marketinghs/*`, `~/marketinghs.env`, `.env`): reaproveita a
  sessão já logada do Playwright; se cair no login, **para e pede**. Ação
  negada pelo controle de permissão não se repete com outra descrição: relata.
- ⚠️ **O que se pode fazer no navegador neste grupo** (mais restrito que o
  G3, porque fluxo ativo **dispara e-mail**):
  - navegar por URL, ler, console (`getComputedStyle`, elemento sintético),
    passar o mouse, trocar de aba (Regras/Fluxos), abrir gaveta de contatos
    do fluxo/segmento por **botão com rótulo de texto**, aplicar filtro de
    estado na gaveta;
  - no construtor de fluxo: abrir o diálogo de um nó pelo ícone de **lápis**
    (`Pencil`) e fechá-lo por **Cancelar** ou X — **nunca** o ícone de
    lixeira do nó, nunca "Salvar" do diálogo que aplica a mudança e depois
    "Salvar" do fluxo; ao sair, navegar por URL (a mudança local se perde);
  - abrir "Nova regra", "Novo fluxo" e "Novo segmento" e **fechar sem
    salvar**; digitar nos campos é permitido;
  - **NUNCA clicar em**: "Ativar", "Pausar", "Arquivar", "Salvar" (de fluxo,
    regra, segmento ou nó), "Criar", "Excluir", "Confirmar", botão de
    confirmação de qualquer `AlertDialog`, `Switch` de ativar regra, nem em
    ícone sem rótulo fora o lápis do nó. Nenhuma escrita no banco.
  - Ids de fluxo/segmento se descobrem por **consulta** (`bancos.consultar`
    em `~/projetos/bancos`, só leitura) ou pelo `href` da lista — nunca
    clicando em ícone.
  - Tema pelo `localStorage` (`marketinghs-tema` = `claro`/`escuro`); deixe
    `claro`.
- **Toda tarefa de tela confere no claro E no escuro, com screenshot "antes"
  tirado ANTES da primeira edição** (o Playwright salva em `.playwright-mcp/`;
  mova para o scratchpad — nada de screenshot no repositório). Se o controle
  de permissão negar screenshot, confira por `getComputedStyle` e diga isso.
- **Comentário, nome e mensagem em português.**

## Tabela de tradução (a mesma do G1–G3)

| Literal de origem | Significado | Texto sobre superfície | Fundo (tinta) | Borda |
|---|---|---|---|---|
| `green-*`, `emerald-*`, `lime-*`, `teal-*` | bom, sucesso, ativo, concluído | `text-[--on-tint-success]` | `bg-[--tint-success]` | `border-success/30` |
| `amber-*`, `yellow-*`, `orange-*` | atenção, pausado, aguardando | `text-[--on-tint-warning]` | `bg-[--tint-warning]` | `border-warning/30` |
| `red-*`, `rose-*` | ruim, erro, apagar | `text-[--on-tint-danger]` | `bg-[--tint-danger]` | `border-danger/30` |
| `blue-*`, `sky-*`, `cyan-*` | informação, em andamento | `text-[--on-tint-info]` | `bg-[--tint-info]` | `border-info/30` |
| `purple-*`, `violet-*`, `indigo-*`, `fuchsia-*`, `pink-*` | destaque | `text-[--on-tint-primary]` | `bg-[--tint-primary]` | `border-primary/30` |
| `slate-*`, `gray-*`, `zinc-*`, `neutral-*` | neutro | `text-conteudo-muted` | `bg-[--tint-neutral]` | `border-borda` |
| `bg-primary/5`, `/10`, `/15`, `/20` como fundo de chip, caixa ou avatar | destaque | `text-[--on-tint-primary]` | `bg-[--tint-primary]` | `border-primary/30` |
| `bg-white/[0.06]`, `border-white/[0.06]` (divisor) | linha | — | `bg-border` | `border-border` |
| `text-white` sobre fundo cheio | texto em cor cheia | `text-primary-foreground` | — | — |

**O aviso âmbar** (7 ocorrências em `NodeConfigDialog`, `Automations.tsx`,
`JourneyBuilder`, `JourneyCreateDialog`, `AutomationRuleForm`) tem uma forma
só:

```tsx
<div className="flex gap-2 text-xs text-[--on-tint-warning] bg-[--tint-warning] border border-warning/30 rounded-md p-2.5">
```

— o ícone `AlertTriangle` dentro dele usa `text-warning`; o `dark:` sai; o
padding e o arredondamento de origem de cada ocorrência ficam como estavam.

**Regras aprendidas no G1–G3 que valem aqui:**

1. Tradução por **significado**, nunca pelo matiz — exceto categoria sem
   significado, que traduz pelo matiz e o relatório lista quem passou a
   dividir cor.
2. Ícone (~16px) pode usar a cor cheia (`text-success`, `text-warning`…);
   **texto** usa `--on-tint-*`.
3. Qualquer opacidade de tinta de origem (`/5`, `/10`, `/15`, `/20`) vira a
   tinta do DS.
4. Cor que vem do banco passa por `src/lib/corDeDado.ts` — não há neste grupo
   (medido em 30/09).
5. Chip clicável mantém hover (`hover:bg-x/20`).
6. Ação principal de um bloco é o `<Button>` padrão (`--action`), não verde —
   decisão 3 do G3 ("Enviar campanha"). Aqui: **"Ativar"** fluxo.
7. O brief autoriza "o que mais for preciso para zerar o guarda nos arquivos
   da tarefa" — nunca além de apresentação.

## Review Focus

1. **Botão "Ativar" perdendo a cara de ação** — "Ativar" (construtor) e o
   "Ativar" da confirmação (`AlertDialogAction`) saem do verde para o
   `--action`; têm de continuar cheios e legíveis nos dois temas, e o diff
   não pode tocar `onClick`, `handleActivateClick` nem a condição de
   `journey.status`. Conferido **olhando** o botão (nunca clicando) num fluxo
   em rascunho, e por leitura do diff. (Tarefas 3 e 4.)
2. **Estado de fluxo e de contato no fluxo se confundindo** — Ativo (sucesso),
   Pausado (atenção), Rascunho e Arquivado (neutros; Arquivado riscado) na
   lista; na gaveta de contatos: Ativo (info), Aguardando (atenção),
   Concluído (sucesso). Distinguíveis nos dois temas; conferido com os fluxos
   reais e por elemento sintético para o estado que não houver. (Tarefa 3.)
3. **Aviso âmbar ilegível** — o aviso de envio para contatos já no fluxo, o de
   "regra só dispara na primeira mudança" e os do diálogo de nó só aparecem
   em certos estados; um `--on-tint-warning` errado só apareceria no dia em
   que alguém ativa um fluxo. Conferido ao vivo onde aparecer e por elemento
   sintético nos dois temas (texto sobre tinta ≥ 4,5:1). (Tarefas 2, 3, 4.)
4. **Modal de segmento perdendo informação junto com o enfeite** — ao tirar os
   brilhos e o gradiente, o número da prévia ("N contatos") e as iniciais dos
   contatos têm de continuar visíveis e legíveis (antes o número era texto
   transparente com gradiente por trás: se o `text-transparent` ficar e o
   gradiente sair, **o número some**). Conferido abrindo "Novo segmento" com
   uma regra que devolva contatos, nos dois temas. (Tarefa 5.)
5. **Ação destrutiva com borda/hover azul** — os "Excluir" de regra
   (`Automations.tsx:278`), de fluxo (`JourneysTab`), de nó
   (`JourneyBuilder.tsx:665`) e os três herdados do G1/G2 ficam vermelhos por
   inteiro, inclusive no hover. Conferido por elemento sintético com a string
   final de classes e pela regra `:hover` no stylesheet. (Tarefas 1-4.)

---

### Tarefa 1: O guarda fecha os pontos cegos; os três "Excluir" azuis do G1/G2

**Arquivos:**
- Modificar: `frontend/scripts/guarda-visual.mjs` (a regex `EFEITO`)
- Modificar: `frontend/src/components/admin/contacts/ContactsBulkBar.tsx:~285`,
  `frontend/src/components/admin/contacts/ContactsTable.tsx:~449`,
  `frontend/src/components/admin/dashboard/challenges/ChallengesAIInsights.tsx:~298`
  — só o `className` do `AlertDialogAction`

**Interfaces:**
- Produz: o guarda contando brilho com desfoque fracionário e com variável
  (`shadow-[0_0_0.5rem…]`, `shadow-[0_0_.5rem…]`, `shadow-[0_0_var(--x)…]`,
  `shadow-[0_0_theme(…)…]`), sem voltar a contar o anel de 1px do sidebar.

- [ ] **Step 1: Medir antes**

```bash
cd /home/ericks/github/MarketingHS/frontend
npm run -s guarda:visual | tail -1                  # esperado: 247 total
npm run -s guarda:visual -- src/components/ui       # esperado: 0
npm run -s guarda:visual -- src/components/admin/segments | tail -1   # 10
```

- [ ] **Step 2: Apertar a regex**

Em `scripts/guarda-visual.mjs`, na constante `EFEITO`, troque
`shadow-\[0_0_[1-9]` por
`shadow-\[0_0_(?:[1-9]|0?\.\d*[1-9]|var\(|theme\()` e substitua a linha de
comentário do anel por:

```js
// `shadow-[0_0_0_1px_…]` (anel de 1px, usado como borda no sidebar) não
// casa: brilho tem desfoque > 0 no terceiro valor — inteiro (`12px`),
// fracionário (`0.5rem`, `.5rem`) ou vindo de variável/tema (`var(--x)`,
// `theme(…)`); anel tem `0`.
```

- [ ] **Step 3: Provar**

```bash
npm run -s guarda:visual | tail -1                  # 247 (nada novo existe hoje)
npm run -s guarda:visual -- src/components/ui       # 0
node -e "const r=/shadow-\[0_0_(?:[1-9]|0?\.\d*[1-9]|var\(|theme\()/g; console.log('shadow-[0_0_0_1px_x] shadow-[0_0_12px_x] shadow-[0_0_0.5rem_x] shadow-[0_0_.5rem_x] shadow-[0_0_var(--g)] shadow-[0_0_theme(x)] shadow-[0_0_0px_x]'.match(r))"
```

Esperado no último: `[ 'shadow-[0_0_1', 'shadow-[0_0_0.5', 'shadow-[0_0_.5', 'shadow-[0_0_var(', 'shadow-[0_0_theme(' ]`
— o anel (`0_0_0_1px`) e o `0px` **não** aparecem.

- [ ] **Step 4: Os três "Excluir"**

Nos três arquivos, o `className` do `AlertDialogAction` de apagar passa de
`"bg-destructive text-destructive-foreground hover:bg-destructive/90"` para
`"bg-danger text-destructive-foreground border border-danger hover:bg-danger/90"`.
Nada mais nesses arquivos. Confirme no console, com um elemento criado com as
classes finais do merge (`buttonVariants()` padrão + as novas — leia o
`className` que o React renderizaria, ou monte a string por tailwind-merge),
que fundo e borda saem vermelhos nos dois temas e que a regra `:hover` do
stylesheet para `hover:bg-danger/90` existe.

- [ ] **Step 5: Portão e commit**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"   # 4
npx vite build
cd /home/ericks/github/MarketingHS
git add frontend/scripts/guarda-visual.mjs frontend/src/components/admin/contacts/ContactsBulkBar.tsx frontend/src/components/admin/contacts/ContactsTable.tsx frontend/src/components/admin/dashboard/challenges/ChallengesAIInsights.tsx
git commit -m "fix(visual): guarda enxerga brilho fracionário e por variável; Excluir do G1/G2 sem azul"
```

---

### Procedimento comum às Tarefas 2-5 (cada tarefa aponta para cá)

- [ ] **A. Antes de editar — medir e fotografar**

```bash
cd /home/ericks/github/MarketingHS/frontend
npm run -s guarda:visual -- <cada arquivo da tarefa>
grep -nE "text-\[(8|9|10|11)px\]|text-muted-foreground/[0-9]|shadow-(sm|md|lg|xl|2xl)|dark:|focus:|animate-pulse|\\\$\{[^}]+\}[0-9]{2}\b" <arquivos> | wc -l
```

Screenshots de cada rota/estado da tarefa, 1440 px, claro e escuro, antes de
tocar em qualquer arquivo. Anote erros de console que já existam.

- [ ] **B. Listar os mapas e ternários de cor**

Todo mapa/ternário que escolhe classe a partir de dado (status de fluxo,
estado do contato no fluxo, lógica E/OU, tipo de segmento): arquivo:linha,
chave, cor de origem → token. As chaves e os rótulos não mudam.

- [ ] **C. Traduzir** pela Tabela, pelo aviso âmbar e pelas regras acima.

- [ ] **D. Guarda e busca complementar**

```bash
npm run -s guarda:visual -- <cada arquivo>        # 0 em todos
grep -nE "text-\[(8|9|10|11)px\]|text-muted-foreground/[0-9]|shadow-(md|lg|xl|2xl)|shadow-primary|dark:|focus:|backdrop-blur|bg-clip-text|text-transparent|animate-pulse|\\\$\{[^}]+\}[0-9]{2}\b" <arquivos>
grep -nP "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]" <arquivos> | grep -v "//\|{/\*"
```

Esperado: **nenhuma linha** nos dois greps (os `✕`/`⚠️` listados nas
restrições estão em comentário). `shadow-sm` só em lista flutuante, tooltip
ou aba ativa — justifique cada um que sobrar.

- [ ] **E. Frontend compila**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"   # 4
npx vite build
```

- [ ] **F. No navegador, nos dois temas** — dentro das regras de navegador
  das restrições globais. Cada rota/estado da tarefa, claro e escuro,
  comparado com o "antes": nenhum botão, aba, badge, passo ou ação sumiu;
  texto legível; zero erro de console novo; `getComputedStyle` de pelo menos
  um elemento de cada token novo resolve cor real (≠ `rgba(0, 0, 0, 0)`).

- [ ] **G. Diff só de apresentação**

```bash
cd /home/ericks/github/MarketingHS
git diff -- <arquivos> | grep -E "^[+-]" | grep -vE "^(\+\+\+|---)" \
  | grep -vE "className|style=|variant=|lucide-react|//|^\s*[+-]\s*$"
git diff -U0 -- <arquivos> | grep -E "^[+-]" | grep -E "onClick|handle[A-Z]|setStatus|disabled=|status ===|status !=="
```

O primeiro: cada linha que sobrar é justificada no relatório (só as exceções
nomeadas: `<h1>`, `<div>` decorativo, fechamento de tag). O segundo tem de
dar **zero linhas** fora de uma linha em que só o `className` mudou (nesse
caso, mostre que o handler ficou byte a byte igual).

- [ ] **H. Commit** — `feat(visual): <área> sai do guarda — …`

---

### Tarefa 2: `/automations` — a página e a aba Regras

**Arquivos:** `frontend/src/pages/admin/Automations.tsx`,
`frontend/src/components/admin/automations/AutomationRuleForm.tsx`.

**Rotas/estados:** `/automations`, aba **Regras** (a página abre na aba
Fluxos — trocar de aba é leitura); o aviso âmbar do topo (linha ~130, se
aparecer); o formulário de **"Nova regra"** aberto (e fechado sem salvar),
com o seletor E/OU visível (adicione duas condições — é estado local) e o
tipo de ação que mostra o aviso âmbar (linha ~392). O diálogo de "Excluir
regra" e o aviso de ~254 **não** se abrem se exigirem clicar em ação:
confira-os por leitura de código e elemento sintético.

**Guarda:** os dois arquivos em 0.

**Tradução exata:**

- **Título duplicado** (`Automations.tsx:110`, exceção nomeada): o
  `<h1>Automações</h1>` sai (a topbar escreve "Automações",
  `AdminLayout.tsx:27`); o `<p>` de descrição logo abaixo **fica**, e o
  `<div>` que envolvia os dois continua envolvendo o `<p>`.
- Avisos âmbar (`Automations.tsx:130-141` e `:254-256`): pela forma única do
  aviso âmbar. O `Card` de ~130 (`border-amber-500/30 bg-amber-500/5`) →
  `border-warning/30 bg-[--tint-warning]`; os textos `text-amber-700
  dark:text-amber-400` e `text-amber-900 dark:text-amber-200` →
  `text-[--on-tint-warning]`; os ícones `text-amber-500`/`text-amber-600` →
  `text-warning`.
- `Automations.tsx:172` badge `P{priority}` `text-[10px]` → `text-xs`.
- `Automations.tsx:278` "Excluir" → a string destrutiva das restrições.
- `AutomationRuleForm.tsx`: os três `h-px bg-white/[0.06]` → `h-px bg-border`;
  `border-t border-white/[0.06]` → `border-t border-border`; todos os
  `text-[9/10/11px]` → `text-xs`; todos os `text-muted-foreground/60` e `/70`
  → `text-muted-foreground`; o aviso de ~392 (`text-[11px] text-amber-700
  dark:text-amber-400`) vira o aviso âmbar (se era só um `<p>` sem caixa,
  ganha a caixa da forma única — é a mesma mensagem, agora legível); o badge
  de ~325 (`text-[9px] … border-primary/30 text-primary/70`) →
  `text-xs border-primary/30 text-[--on-tint-primary]`. O seletor E/OU
  (~301-316) já é `bg-primary text-primary-foreground` no escolhido: só o
  tamanho muda.

Siga o **Procedimento comum**, A a H. Commit:
`feat(visual): automações e regras saem do guarda — sem título duplicado, avisos legíveis`.

---

### Tarefa 3: A aba Fluxos — lista, novo fluxo, contatos no fluxo

**Arquivos:** `frontend/src/components/admin/automations/JourneysTab.tsx`,
`JourneyCreateDialog.tsx`, `JourneyContactsDrawer.tsx`.

**Rotas/estados:** `/automations`, aba Fluxos, com os fluxos reais (liste
antes, por consulta, quantos há por `status`); "Novo fluxo" aberto (fechado
sem salvar), com o aviso âmbar de ~141 se ele aparecer ao escolher um
gatilho; a gaveta de contatos de um fluxo que tenha execuções, com cada
filtro de estado (Todos/Ativo/Aguardando/Concluído — é filtro). **Nunca**
clicar "Ativar"/"Pausar" da linha nem nada do menu de ação da linha além de
abrir a gaveta de contatos.

**Guarda:** os três arquivos em 0.

**Tradução exata:**

- `JourneysTab.tsx` `STATUS_VARIANT` (~15-20):
  - `active` → `bg-[--tint-success] text-[--on-tint-success]`
  - `paused` → `bg-[--tint-warning] text-[--on-tint-warning]`
  - `draft` e `archived` ficam (`archived` continua com `line-through`).
- `JourneysTab.tsx:105-106`: `text-[10px]` → `text-xs` nos dois badges.
- Botões fantasma da linha: "Ativar" `text-emerald-600` →
  `text-[--on-tint-success]`; "Pausar" `text-amber-600` →
  `text-[--on-tint-warning]` (ação de linha mantém o significado; a ação
  principal cheia é só a do construtor — regra 6).
- Confirmação de ativar (~201): sai `className="bg-emerald-600
  hover:bg-emerald-600/90 text-white"` (fica o padrão de ação).
- Confirmação de excluir (~222): `"bg-destructive text-destructive-foreground"`
  → a string destrutiva das restrições.
- `JourneyContactsDrawer.tsx` `STATE_META` (~23-25): `active` →
  `bg-[--tint-info] text-[--on-tint-info]`; `waiting` →
  `bg-[--tint-warning] text-[--on-tint-warning]`; `done` →
  `bg-[--tint-success] text-[--on-tint-success]` (sai todo `dark:`).
- Chips de filtro (~99-103): `text-[11px]` → `text-xs`; o escolhido
  `border-primary bg-primary/10 text-primary` → `border-primary
  bg-[--tint-primary] text-[--on-tint-primary]`; o não escolhido mantém
  `hover:border-border` e ganha `hover:bg-surface-elevated` (regra 5).
- `JourneyContactsDrawer.tsx:127,133`: `text-[11px]`/`text-[10px]` → `text-xs`.
- `JourneyCreateDialog.tsx:90,132` `text-[11px]` → `text-xs`; ~141 → a forma
  única do aviso âmbar.

Siga o **Procedimento comum**, A a H. No F: Review Focus 2 (os estados reais
e os sintéticos dos que faltarem, nos dois temas) e 3 (o aviso de ~141).
Commit: `feat(visual): lista de fluxos sai do guarda — estado por significado, ativar é ação`.

---

### Tarefa 4: O construtor de fluxo (`/automations/fluxos/:id`)

**Arquivos:** `frontend/src/pages/admin/JourneyBuilder.tsx`,
`frontend/src/components/admin/automations/NodeConfigDialog.tsx`,
`frontend/src/components/admin/automations/JourneyNodeCard.tsx`.

**Rotas/estados:** o construtor de **um fluxo em rascunho** (o botão
"Ativar" aparece) e, se houver, de **um fluxo ativo** (aparece "Pausar") —
ids por consulta:

```bash
cd ~/projetos/bancos && ./.venv/bin/python -c "
import bancos; print(bancos.consultar('marketinghs', 'select id, name, status from journeys order by status, created_at').to_string())"
```

Nele: o diálogo de cada **tipo** de nó que existir no fluxo, aberto pelo
lápis e fechado por Cancelar/X (os avisos âmbar de ~306, ~369, ~460, ~492
aparecem conforme o tipo; o seletor E/OU de ~383 aparece com duas regras); a
nota "não ligado" (~375) e os badges Sim/Não/Aconteceu/Tempo esgotado das
ramificações. **Nunca** "Salvar", "Ativar", "Pausar", "Arquivar", lixeira do
nó, "Salvar" do diálogo. Ao terminar, saia por URL.

**Guarda:** os três arquivos em 0 — e, com as Tarefas 2 e 3, a pasta
`src/components/admin/automations` inteira.

**Tradução exata:**

- `JourneyBuilder.tsx:485` — o `<h1>{journey.name}</h1>` **fica** (a topbar
  escreve "Fluxo", o `<h1>` é o nome deste fluxo: não é duplicado).
- `JourneyBuilder.tsx:486` e os badges de ramificação (~424-442):
  `text-[10px]` → `text-xs`.
- "Ativar" (~497): sai `bg-emerald-600 hover:bg-emerald-600/90` do
  `className` (fica `gap-1.5`) — regra 6.
- "Pausar" (~502): `text-amber-600` → `text-[--on-tint-warning]`.
- Confirmação de excluir nó (~665): → a string destrutiva.
- Confirmação de ativar (~716): sai `className="bg-emerald-600
  hover:bg-emerald-600/90 text-white"`.
- Aviso âmbar (~635) → forma única.
- `text-[10px]`/`text-[11px]` (~375, ~398, ~518, ~524, ~626) → `text-xs`.
- `NodeConfigDialog.tsx`: avisos de ~306, ~369, ~460 → forma única; o de
  ~492-494 (`border-amber-500/30 bg-amber-500/5`, ícone `text-amber-500`,
  texto `text-amber-700 dark:text-amber-400`) → `border-warning/30
  bg-[--tint-warning]`, ícone `text-warning`, texto
  `text-[--on-tint-warning]`; o seletor E/OU (~383-384) `text-[10px]` →
  `text-xs` (o escolhido já é `bg-primary text-primary-foreground`); os
  `text-[11px]` (~351, ~452, ~454, ~473) → `text-xs`.
- `JourneyNodeCard.tsx:60` `text-[11px]` → `text-xs`.

Siga o **Procedimento comum**, A a H. No F: Review Focus 1 (o "Ativar" do
fluxo em rascunho olhado nos dois temas, **sem clicar**) e 3 (cada aviso do
diálogo que aparecer ao vivo; os outros por sintético). No G, o segundo grep
tem de mostrar que `handleActivateClick`, `setStatus('paused')` e
`confirmDeleteApply` só aparecem em linhas cujo único delta é o `className`.
Commit: `feat(visual): construtor de fluxo sai do guarda — ativar é ação, avisos legíveis`.

---

### Tarefa 5: Segmentos (`/segments`) e o modal de segmento

**Arquivos:** `frontend/src/pages/admin/Segments.tsx`,
`frontend/src/components/admin/segments/SegmentFormModal.tsx`,
`SegmentMultiSelect.tsx`, `SegmentContactsDrawer.tsx`.

**Rotas/estados:** `/segments` com os segmentos reais; a gaveta de contatos
de um segmento (botão com rótulo); **"Novo segmento"** aberto — tipo
Dinâmico com uma regra que devolva contatos (a prévia calcula por leitura)
e com duas regras para ver o E/OU; tipo Estático com uma busca de contato
digitada (não adicione); fechado por **Cancelar**. O `SegmentMultiSelect`
aparece no assistente de campanha (`/campaigns` → "Nova campanha", passo 1,
fechado pelo X sem salvar) — abra a lista e confira o anel de foco pelo
teclado (Tab).

**Guarda:** os quatro arquivos em 0; a pasta `src/components/admin/segments`
inteira em 0.

**Tradução exata:**

- **Título duplicado** (`Segments.tsx:44`, exceção nomeada): o
  `<h1>Segmentos</h1>` sai (a topbar escreve "Segmentos",
  `AdminLayout.tsx:24`); `justify-between` → `justify-end`.
- `Segments.tsx:75` e `SegmentContactsDrawer.tsx:68,108`: `text-[10px]` →
  `text-xs`.
- `SegmentMultiSelect.tsx:80`: `focus:outline-none focus:ring-2
  focus:ring-ring focus:ring-offset-2` → `focus-visible:outline-none
  focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`;
  `:93` `text-[11px]` → `text-xs`.
- `SegmentFormModal.tsx` — a limpeza da estética "Aurora" (exceção nomeada:
  os `<div>` decorativos saem inteiros):
  - `DialogContent` (~501): ficam só `max-w-[1140px] max-h-[88vh]
    overflow-hidden p-0` — saem `border-border bg-card backdrop-blur-2xl` e o
    `shadow-[0_0_80px…]` (borda, fundo e sombra já vêm do primitivo).
  - Os **três** `<div className="pointer-events-none absolute … blur-[…]" />`
    (~503, ~504, ~725) saem, com os comentários "Aurora glow effects" e
    "Subtle radial glow behind count" logo acima deles. O comentário
    "Right column — Preview with aurora glow" vira "Coluna da direita — prévia".
  - Caixa do ícone do cabeçalho (~508): `bg-gradient-to-br from-primary/20
    to-info/20 border border-border/70` → `bg-[--tint-primary] border
    border-primary/30`.
  - ⚠️ **Número da prévia** (~745 e ~778): `bg-gradient-to-r from-primary
    to-info bg-clip-text text-transparent` → `text-primary`. **Tem de sair o
    `text-transparent` junto**, senão o número some (Review Focus 4).
  - Avatares de iniciais (~756, ~787): `bg-gradient-to-br from-primary/20
    to-info/20 … text-[10px] font-bold text-primary` → `bg-[--tint-primary]
    … text-xs font-bold text-[--on-tint-primary]` (se a letra em `text-xs`
    não couber no círculo `w-6 h-6`, deixe o círculo como está e registre —
    não mexa em tamanho).
  - Badge de etiqueta (~761): `text-[9px] bg-primary/10 border-primary/20` →
    `text-xs` (fica `variant="secondary"`, sem cor extra).
  - Seletor de tipo (~543-562): o comentário "glass pills" vira "seletor de
    tipo"; o fundo `bg-background/60` → `bg-surface-elevated`; o escolhido
    perde `shadow-sm shadow-primary/20` (fica `bg-primary
    text-primary-foreground`).
  - Seletor E/OU (~570-592): `bg-background/60` → `bg-surface-elevated`;
    `text-[11px]` → `text-xs`.
  - `text-[10px]`/`text-[11px]` restantes (~594, ~666, ~696, ~727) → `text-xs`.
  - "Buscando..." (~686): sai `animate-pulse` (regra de laço).
  - Botão "Salvar segmento" (~809): sai o `className` inteiro
    (`bg-gradient-to-r … shadow-lg shadow-primary/10`); fica o padrão.

Siga o **Procedimento comum**, A a H. No F: Review Focus 4 (número da prévia
e iniciais visíveis nos dois temas; `getComputedStyle(numero).color` ≠
`rgba(0, 0, 0, 0)` e o texto do elemento é o número). Commit:
`feat(visual): segmentos saem do guarda — sai a estética Aurora do modal`.

---

### Tarefa 6: Portão do G4 e registro

**Arquivos:** `docs/CONTINUAR-AQUI.md` (bloco novo no topo: "Visual — Fase 2,
G4", e o "Comece por aqui" atualizado); `frontend/src/design-system/ORIGEM.md`
só se aparecer defeito novo do DS.

- [ ] **Step 1: Portão**

```bash
cd /home/ericks/github/MarketingHS/frontend
npm run -s guarda:visual -- src/components/admin/automations       # 0
npm run -s guarda:visual -- src/components/admin/segments          # 0
for f in Automations JourneyBuilder Segments; do npm run -s guarda:visual -- src/pages/admin/$f.tsx | tail -1; done   # 0 em cada
for a in src/components/admin/campaigns src/components/admin/dashboard src/components/admin/contacts src/components/ui src/hooks src/lib; do npm run -s guarda:visual -- $a | tail -1; done   # 0 em cada (G1-G3 não regrediram)
npm run -s guarda:visual | tail -8                                  # esperado: 170 total
grep -rnE '\$\{[^}]+\}[0-9]{2}\b' src --include=*.tsx              # nenhuma linha
grep -rn -A3 "<AlertDialogAction" src | grep "bg-destructive"      # nenhuma linha
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"     # 4
npx vite build && npm run build:landing
cd .. && sha256sum frontend/src/design-system/tokens/*.css frontend/src/design-system/styles.css
```

Hashes batem com o `ORIGEM.md`.

- [ ] **Step 2: Capacidade por capacidade**

```bash
git diff 20574d6 --stat -- frontend
git diff 20574d6 -- frontend/src | grep -E "^[+-]" | grep -vE "^(\+\+\+|---)" \
  | grep -vE "className|style=|variant=|lucide-react|//|^\s*[+-]\s*$"
git diff -U0 20574d6 -- frontend/src | grep -E "^[+-]" | grep -E "onClick|handle[A-Z]|setStatus|disabled=|status ===|status !=="
```

Cada linha que sobrar é justificada no relatório; no registro, uma linha de
resumo.

- [ ] **Step 3: Telas nos dois temas**

`/automations` (aba Regras, aba Fluxos, "Nova regra" e "Novo fluxo" abertos e
fechados sem salvar, gaveta de contatos de um fluxo), o construtor de um
fluxo em rascunho (com um diálogo de nó aberto e fechado), `/segments`
("Novo segmento" com prévia, gaveta de contatos), claro e escuro, 1440 px;
`/automations` e o construtor também a 390 px (anote rolagem horizontal, não
conserte). Zero erro de console novo. **Confira no banco, por consulta, que
nenhum fluxo mudou de status e nenhuma regra/segmento/fluxo foi criado**
(compare contagens por `status` com as do começo da Tarefa 3).

- [ ] **Step 4: Registro**

Bloco novo no topo do `CONTINUAR-AQUI.md`, no molde do bloco do G3: tabela de
commits; placar do guarda antes → depois por pasta; o que cada Review Focus
achou (e o que foi conferido só por elemento sintético — diga); **Decisões
tomadas nesta fase, reversíveis**:

1. "Ativar" fluxo é o botão de ação padrão (como "Enviar campanha" no G3);
   "Ativar"/"Pausar" da linha da lista mantêm sucesso/atenção no texto.
2. Estado do fluxo: Ativo = sucesso, Pausado = atenção, Rascunho/Arquivado
   neutros. Estado do contato no fluxo: Ativo = info, Aguardando = atenção,
   Concluído = sucesso.
3. O aviso âmbar tem uma forma única (tinta de atenção, texto `--on-tint`,
   ícone cheio), sem `dark:`.
4. O modal de segmento perdeu a estética "Aurora" (brilhos, gradiente,
   `backdrop-blur`); o número da prévia virou texto na cor primária.
5. Texto pequeno deixou de ser mais claro que o muted (`/60`, `/70` saem).
6. Fim do `<h1>` duplicado em `/automations` e `/segments`; o do construtor
   fica (é o nome do fluxo).
7. Os três "Excluir" azuis do G1/G2 e os três do G4 ganharam a variante
   destrutiva inteira; não sobra `AlertDialogAction` com `bg-destructive`.

No "Comece por aqui": branch `visual-fase-2-g4` (a partir da `main`),
revisão por tarefa feita, **revisão final pendente** até ela acontecer;
próximo passo G5 (Páginas e Teste A/B — `pages/`, menos o preview, e
`Experiments*`); placar novo por pasta; as decisões pendentes do Erick
mantidas. Não escreva senha nem como ela é obtida.

```bash
git add docs/CONTINUAR-AQUI.md
git commit -m "docs(visual): Fase 2 — G4 (Automações, Jornadas e Segmentos) fechado"
```
