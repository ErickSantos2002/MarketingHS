# MarketingHS — Visual, Fase 2: G6 (Configurações, metade "cartões") — Plano

> **Para quem executa:** frente paralela `g6-cartoes` (ver `docs/frentes/README.md`),
> modo autônomo do `CLAUDE.md`. Execução inline pela própria frente, tarefa a
> tarefa, com revisão crítica do diff ao fim de cada uma e revisão final da
> branch. Os passos usam caixa de seleção (`- [ ]`).

**Objetivo:** os cartões de `/settings` (aba Integrações), as abas Lead
Scoring, Usuários, Supressão de Email e Redes sociais, e a casca
`SettingsPage.tsx` saem do guarda com **zero** — toda cor de token, sem emoji
no JSX, sem texto abaixo de 12px, sem `<h1>` duplicado da topbar — e fazem
**o que faziam**. A outra metade do G6 (`ApiDocumentation`,
`ApiKeysManagement`) é da frente `g6-integracoes` e **não** entra.

**Arquitetura:** tradução arquivo a arquivo pela Tabela do G1–G5 (copiada do
plano do G5, abaixo). Casos novos deste grupo:

1. **Quadrado de marca com letra** (`G` do GrowthHS, `M` do Meta, `IA` da
   Anthropic) pintado por `style={{ backgroundColor: '#…' }}` com
   `text-white`. Vira classe de token pela leitura do matiz, na cor **cheia**
   escura (é marca dentro de um quadrado de 32 px, como as `EcosystemPills`
   do G2), com `text-[--color-white]`:
   `#185FA5` (azul) → `bg-[--color-info-700]`; `#D97757` (laranja) →
   `bg-[--color-warning-700]`. Branco sobre info-700 ≈ 6,7:1; sobre
   warning-700 ≈ 5,0:1.
2. **Prévia do bloco "Social" do e-mail** (`SocialLinksSettings`,
   `bg-white`) é moldura de e-mail → `bg-[--color-white]` (decisão 1 do G3:
   papel branco fixo nos dois temas).
3. **`Alert` âmbar** (`ResendConfigCard:~284`): o `Alert` não tem variante
   `warning`; a cor vai por classe, incluindo `[&>svg]:text-warning` — a
   variante padrão pinta o ícone com `[&>svg]:text-[--on-tint-info]`, que
   tem especificidade maior que a classe do próprio ícone (conferido com
   `twMerge`: a classe da tela substitui a da variante).

**Spec:** `docs/superpowers/specs/2026-09-22-marketinghs-visual-design-system-design.md` (Fase 2, G6)
**Plano anterior (molde):** `docs/superpowers/plans/2026-09-30-marketinghs-visual-fase-2-g5-paginas-ab.md`

**Branch:** a da worktree da frente (a partir da `main` em `a6f2e87`).

**Escopo medido em 01/10** (guarda, por arquivo):

| Arquivo | Guarda | Tarefa |
|---|---|---|
| `settings/GrowthHSCard.tsx` | 13 | 2 |
| `settings/SuppressionList.tsx` | 12 | 1 |
| `settings/ResendConfigCard.tsx` | 9 | 2 |
| `settings/LeadScoringSettings.tsx` | 6 | 3 |
| `settings/IACard.tsx` | 5 | 4 |
| `settings/MetaCard.tsx` | 5 | 4 |
| `settings/SocialLinksSettings.tsx` | 3 | 4 |
| `settings/UserManagement.tsx` | 0 (2 × `text-[10px]`) | 4 |
| `pages/admin/SettingsPage.tsx` | 2 | 4 |

Total do território: **55 → 0**.

**Dado real em produção (01/10):** nenhuma integração configurada (GrowthHS
"Não configurado", Resend sem chave, Meta 0/2, IA "não configurado"). Os
estados "Conectado", "configurado", fila pausada, falhas da fila, resultado de
teste de chave/diagnóstico e o resultado do teste de webhook **não aparecem
ao vivo** — só por código. A lista de supressão e os usuários existem ao vivo
se houver linha no banco.

---

## Restrições globais (as do G5, mais as do "Levar para o G6")

- ⚠️ **A tela faz o que fazia.** Diff só de classe, cor, token e marcação de
  apresentação. Exceções nomeadas: o `<h1>` duplicado de `SettingsPage`
  (Tarefa 4), o `⚠` do aviso de total virando ícone e o `result.updated`
  (Tarefa 3), o `style` de cor do quadrado de marca virando classe (Tarefas 2
  e 4). Outra mudança de lógica: **pare e registre como pergunta**.
- ⚠️ `ApiDocumentation.tsx` e `ApiKeysManagement.tsx` **não se tocam** (outra
  frente). `design-system/` não se edita.
- Cor sai de token pela Tabela; nenhum hexadecimal, literal do Tailwind
  (inclusive `white`/`black`), `hsl()`/`rgb()` numérico.
- Nenhum texto abaixo de 12px: `text-[10px]`/`[11px]` → `text-xs`; em
  `Badge`, o `text-[10px]` só sai (a base do `Badge` já é `text-xs`).
- Ícone é componente, nunca emoji no JSX. `focus-visible`, nunca `focus:`.
  `dark:` sai onde há token.
- Badge com significado usa variante (`success`, `warning`, `info`,
  `destructive`, `secondary`), não classe.
- "Excluir"/"Remover" de confirmação: `bg-danger text-destructive-foreground border border-danger hover:bg-danger/90`.
- Aviso âmbar: `text-[--on-tint-warning] bg-[--tint-warning] border-warning/30`,
  ícone `text-warning`; padding e tamanho de origem ficam.
- Texto colorido solto usa `--on-tint-*` (contraste AA nos dois temas).
- `border-border/40`, `bg-muted/50`, `border-border/30` **ficam** — são token
  com alfa, não cor literal; os grupos anteriores os mantiveram.
- **Navegador:** `node scripts/conferir-telas.mjs --porta 8082` e um script no
  scratchpad que reaproveita o token e clica só em **aba**. Nunca em Salvar,
  Testar, Gerar, Verificar, Enviar evento de teste, Suprimir, Remover,
  Novo Usuário, nem no botão de papel da linha de usuário (ele **troca o
  papel**), nem nos ícones de linha.
- Antes de cada commit: guarda do arquivo = 0, `tsc` (4 pré-existentes, nenhum
  novo — 3 depois da Tarefa 3), `vite build`.

## Tabela de tradução (a mesma do G1–G5)

| Literal de origem | Significado | Texto | Fundo | Borda | Badge |
|---|---|---|---|---|---|
| `green-*`, `emerald-*` | bom, ativo, salvo, Hot | `text-[--on-tint-success]` | `bg-[--tint-success]` | `border-success/30` | `success` |
| `amber-*`, `yellow-*`, `orange-*` | atenção | `text-[--on-tint-warning]` | `bg-[--tint-warning]` | `border-warning/30` | `warning` |
| `red-*`, `rose-*` | ruim, erro | `text-[--on-tint-danger]` | `bg-[--tint-danger]` | `border-danger/30` | `destructive` |
| `blue-*`, `sky-*` | informação | `text-[--on-tint-info]` | `bg-[--tint-info]` | `border-info/30` | `info` |

Ícone pode usar a cor cheia (`text-success`, `text-warning`, `text-danger`).
**Hot = sucesso, Warm = atenção** (G1/G2).

---

### Tarefa 1: `SuppressionList.tsx` (aba Supressão de Email)

- `ReasonBadge`: Bounce → `variant="destructive"`; Marcou spam →
  `variant="warning"`; Descadastrou → `variant="secondary"`; Manual →
  `variant="info"` — sem `className` de cor nem `text-[10px]` (mesma leitura
  do G3: "Bounce"/"Falhou" perigo, "Marcou spam"/"Descadastrado" atenção — aqui
  "Descadastrou" fica neutro como era na origem).
- `TableHead` `text-[11px]` (×5) → `text-xs`.
- Gatilho "Remover" da linha: `text-[10px] … hover:text-red-400 hover:bg-red-500/10`
  → `text-xs … hover:text-[--on-tint-danger] hover:bg-[--tint-danger]`.
- `AlertDialogAction` "Remover" (~261): ganha
  `className="bg-danger text-destructive-foreground border border-danger hover:bg-danger/90"`;
  `onClick` igual.
- Asterisco obrigatório `text-red-400` → `text-[--on-tint-danger]`.

### Tarefa 2: `GrowthHSCard.tsx` e `ResendConfigCard.tsx`

GrowthHS:
- quadrado `G`: `style` sai, `bg-[--color-info-700] text-[--color-white]`.
- `badgeMap.connected`: `variant: 'success'`, sem `className`; o tipo do
  mapa ganha `'success'`; o `Badge` perde o `text-[10px]` e mantém
  `className={badge.className}` (fica sem uso; sai junto do campo).
- "A API do GrowthHS respondeu." `text-emerald-500` → `text-[--on-tint-success]`.
- aviso "endereço diferente" `text-[10px] text-amber-600 dark:text-amber-400`
  → `text-xs text-[--on-tint-warning]`.
- fila pausada: caixa `border-amber-500/30 bg-amber-500/5` →
  `border-warning/30 bg-[--tint-warning]`; ícone `text-amber-500` →
  `text-warning`; texto `text-[10px] … text-amber-700 dark:text-amber-400` →
  `text-xs … text-[--on-tint-warning]`.
- demais `text-[10px]` → `text-xs`; a falha da fila
  (`text-[10px] text-destructive`) → `text-xs text-[--on-tint-danger]`.

Resend:
- "Chave válida, acesso completo" e "Conectado. Remetente" `text-green-600` →
  `text-[--on-tint-success]`; "somente envio" e "Sem segredo de descadastro"
  `text-amber-600` → `text-[--on-tint-warning]`.
- `Alert` âmbar (~284): `py-2 border-warning/30 bg-[--tint-warning] text-[--on-tint-warning] [&>svg]:text-warning`;
  ícone fica só com tamanho; `AlertDescription` `text-xs text-[--on-tint-warning]`.
- tabela de DNS `text-[11px]` → `text-xs`.

### Tarefa 3: `LeadScoringSettings.tsx` (aba Lead Scoring)

- `text-[10px]` (rótulos, mapeamentos) → `text-xs`; badge `{points} pts`
  perde o `text-[10px]`.
- barra de faixas: `text-[10px]` → `text-xs`; Warm
  `bg-amber-500/30 text-amber-700 dark:text-amber-400` →
  `bg-[--tint-warning] text-[--on-tint-warning]`; Hotlead
  `bg-red-500/30 text-red-700 dark:text-red-400` →
  `bg-[--tint-success] text-[--on-tint-success]` (**Hot = sucesso**, decisão
  do G1); Raw fica `bg-muted`.
- `⚠ O total excede…` → `flex gap-1` com `<AlertTriangle>` (`text-danger`),
  frase igual; o `<p>` passa a `text-[--on-tint-danger]`.
- **Erro de `tsc`** (`result.updated` × tipo `{ atualizados: number }`):
  o backend responde `RecalculoOut(atualizados=…)`, então o toast de hoje
  diz "Score recalculado para undefined leads!". `result.updated` →
  `result.atualizados` corrige só a interpolação do número na mensagem: a
  chamada, a ordem e o tratamento de erro não mudam. Registrado no Estado.

### Tarefa 4: `IACard`, `MetaCard`, `SocialLinksSettings`, `UserManagement`, `SettingsPage`

- IA: quadrado `IA` → `bg-[--color-warning-700] text-[--color-white]`, sem
  `style`; badge `configurado ? 'success' : 'secondary'`, sem `className`;
  `text-[10px]` → `text-xs`.
- Meta: quadrado `M` → `bg-[--color-info-700] text-[--color-white]`; badge
  `completo ? 'success' : 'secondary'`, sem `className`; `text-[10px]` →
  `text-xs`.
- Redes sociais: `border-red-500` → `border-danger`; erro `text-[10px]
  text-red-500` → `text-xs text-[--on-tint-danger]`; prévia `bg-white` →
  `bg-[--color-white]`.
- Usuários: botão de papel `text-[10px]` → `text-xs`; badge perde
  `text-[10px]`. Conferir na tela.
- `SettingsPage`: `<h1>Configurações</h1>` sai (a topbar escreve
  "Configurações", `AdminLayout.tsx:23`); resultado do teste de webhook
  `text-emerald-500`/`text-red-500` → `text-[--on-tint-success]`/
  `text-[--on-tint-danger]` (condição igual); `text-[10px]` → `text-xs`.

### Tarefa 5: Portão

```bash
cd frontend
# guarda 0 em cada arquivo do território (scratchpad/guarda.sh)
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"   # 3 (sai o do LeadScoring)
npx vite build
git diff a6f2e87 -- <território> | grep -E "^[+-]" | grep -vE "^(\+\+\+|---)" \
  | grep -vE "className|style=|variant=|lucide-react|//|^\s*[+-]\s*$"
git diff -U0 a6f2e87 -- <território> | grep -E "^[+-]" | grep -E "onClick|handle[A-Z]|mutate|disabled=|status ==="
```

Telas: `/settings` (Integrações) e as abas Lead Scoring, Usuários, Supressão
de Email, Redes sociais; claro/escuro; 1440/390; sem clicar ação. A rolagem
horizontal a 390 px (a `TabsList` de 7 abas, `scrollWidth` 973 já no "antes")
é **anotada, não consertada** (leiaute, fora do escopo de cor).

### Tarefa 6: revisão final da branch, onda de conserto, registro em `docs/frentes/g6-cartoes.md`, push.
