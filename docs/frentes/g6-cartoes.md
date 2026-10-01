# Frente `g6-cartoes`

Metade do G6 (Configurações), o último grupo da Fase 2 do visual.
Território: os cartões de `settings/` — `GrowthHSCard` (13), `SuppressionList`
(12), `ResendConfigCard` (9), `LeadScoringSettings` (6), `IACard` (5),
`MetaCard` (5), `SocialLinksSettings` (3), `UserManagement` (0) — e
`pages/admin/SettingsPage.tsx` (2). Nada mais.

## Backlog (em ordem)

- [x] Escrever o plano no molde do G5 →
  `docs/superpowers/plans/2026-10-01-marketinghs-visual-fase-2-g6-cartoes.md`.
  Regras do "Levar para o G6" no topo do `CONTINUAR-AQUI.md`.
- [x] `SuppressionList.tsx` sai do guarda, incluindo o "Remover" (`~261`) com
  `bg-danger text-destructive-foreground border border-danger hover:bg-danger/90`.
- [x] `GrowthHSCard.tsx` e `ResendConfigCard.tsx` saem do guarda.
- [x] `LeadScoringSettings.tsx` sai do guarda **e** o erro de `tsc` dele some
  (é um dos 4 pré-existentes) — só se o conserto não mudar comportamento; se
  mudar, vira pergunta.
- [x] `IACard`, `MetaCard`, `SocialLinksSettings`, `SettingsPage` saem do
  guarda; `UserManagement` conferido na tela.
- [x] Portão: guarda 0 em todo o território, `tsc` sem erro novo, `vite build`,
  capacidade por capacidade, telas no navegador (claro, escuro, 1440 e 390 px),
  sem clicar ação.
- [x] Revisão final da branch + onda de conserto; push; marcar "pronto para merge".

## Estado

**Pronto para merge (01/10/2026).** Branch `worktree-agent-a94a5d3583fd2a548`
(a partir da `main` em `a6f2e87`), com push. Plano:
`docs/superpowers/plans/2026-10-01-marketinghs-visual-fase-2-g6-cartoes.md`.

| Commit | O que entrou |
|---|---|
| `7c39da9` | Plano |
| `9e7b72f` | `SuppressionList` — motivo é variante do `Badge` (Bounce `destructive`, Marcou spam `warning`, Descadastrou `secondary`, Manual `info`); "Remover" do `AlertDialogAction` com a string destrutiva; `text-[10px]/[11px]` → `text-xs` |
| `6aebf09` | `GrowthHSCard` e `ResendConfigCard` — quadrado de marca por token, "Conectado" = `success`, avisos âmbar e fila pausada por `--tint-warning`, `Alert` âmbar com `[&>svg]:text-warning` |
| `6d82221` | `LeadScoringSettings` — barra Warm = atenção, Hotlead = sucesso; `⚠` vira `AlertTriangle`; `result.updated` → `result.atualizados` (some o erro de `tsc`) |
| `6bc5b65` | `IACard`, `MetaCard`, `SocialLinksSettings`, `UserManagement`, `SettingsPage` — sem `<h1>` duplicado da topbar, badges `success`, prévia do e-mail em `--color-white` |

**Placar do guarda (antes → depois):** GrowthHSCard 13 → 0 · SuppressionList
12 → 0 · ResendConfigCard 9 → 0 · LeadScoringSettings 6 → 0 · IACard 5 → 0 ·
MetaCard 5 → 0 · SocialLinksSettings 3 → 0 · UserManagement 0 → 0 (2
`text-[10px]` saíram) · SettingsPage 2 → 0. **Território 55 → 0.**

**Portão:** `tsc --noEmit -p tsconfig.app.json` com **3** erros (os 3 do
`useJourneys`; o do `LeadScoringSettings` sumiu); `vite build` passa.
Capacidade por capacidade (`git diff a6f2e87 -- frontend/src`, 9 arquivos,
+65/−82): fora de `className`/`variant`/import, só sobram as exceções
nomeadas do plano — o tipo do `badgeMap` (perdeu `className`, ganhou
`'success'`), o `result.atualizados`, o `<span>` do aviso de total, o
`AlertDialogAction` reformatado (mesmo `onClick`) e o `<h1>` removido.
Nenhum `onClick`, `disabled`, condição ou chamada de API mudou.

**O que foi visto na tela** (`/settings` pelo `conferir-telas.mjs` e as abas
por script próprio que só clica em aba; claro/escuro, 1440/390; antes e
depois no scratchpad): Integrações (todos os cartões "não configurado" em
produção — os estados Conectado, configurado, fila pausada, falhas, teste de
chave e diagnóstico **só por código**), Lead Scoring (barra Raw/Warm/Hotlead
ao vivo, legível nos dois temas), Usuários (2 admins; o botão de papel **não
foi clicado** — ele troca o papel), Supressão de Email (**vazia** em
produção: badges de motivo e o diálogo "Remover" só por código; as variantes
são as do `Badge`, já medidas nos grupos anteriores), Redes sociais (sem rede
configurada: a prévia branca e o erro de URL só por código). Console: só os 2
avisos de futuro do React Router, iguais ao "antes". Contraste do quadrado de
marca: branco sobre info-700 6,7:1; sobre warning-700 5,0:1 (o `#D97757` de
antes dava 3,1:1).

**Revisão final da branch** (diff inteiro relido): sem Critical nem
Important; nenhum conserto necessário — os pontos menores viraram resíduo.

**Resíduos (anotados, não consertados):**
- A 390 px a página inteira rola na horizontal (`scrollWidth` 973, igual no
  "antes"): a `TabsList` de 7 abas não quebra nem rola sozinha. Leiaute, fora
  do escopo de cor; conserto sugerido: `overflow-x-auto` no wrapper da lista
  (em `SettingsPage.tsx`).
- `text-destructive` solto continua em linhas não tocadas (erro do GrowthHS,
  falha do teste de chave e do diagnóstico do Resend, número do total do
  Lead Scoring) — não conta no guarda; as linhas tocadas foram para
  `text-[--on-tint-danger]`.
- `[&>svg]:h-5 [&>svg]:w-5` da base do `Alert` vence o `h-3.5 w-3.5` do ícone
  do aviso âmbar do Resend — herdado, não muda com este grupo.
- `frontend/src/design-system/adocao.md`, citado no despacho, não existe na
  árvore (o spec o cita como `guidelines/adocao.md` do DS oficial); a Tabela
  de tradução do G5 bastou.

## Perguntas

1. **Cor do quadrado de marca** (`G` do GrowthHS, `M` do Meta, `IA`). Assumi a
   leitura pelo matiz da origem: os dois azuis `#185FA5` → `--color-info-700`,
   o laranja `#D97757` → `--color-warning-700`. Alternativa: o GrowthHS usar
   `--color-success-700`, como a pílula do GrowthHS em Contatos (decisão 3 do
   G2). Reversível numa classe.
2. **"Descadastrou" na lista de supressão** ficou neutro (`secondary`), como
   era na origem; no G3 "Descadastrado" da campanha é atenção. Unificar é
   trocar a variante.
3. **`result.updated` → `result.atualizados`** (Lead Scoring): o toast de
   "Recalcular agora" dizia "Score recalculado para undefined leads!" porque a
   API responde `{ atualizados }`. Tratei como conserto sem mudança de
   comportamento (mesma chamada, mesmo fluxo; só o número aparece). Se não
   deve entrar num lote visual, é revert de uma linha.
4. **Hotlead da barra de faixas mudou de vermelho para verde** (Hot =
   sucesso, decisão do G1/G2) — aplicado; registrado aqui por ser a mudança
   mais visível do lote.
