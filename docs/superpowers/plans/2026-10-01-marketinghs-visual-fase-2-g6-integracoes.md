# MarketingHS — Visual, Fase 2: G6, metade "integrações" — Plano

> **Para quem executa:** frente paralela `g6-integracoes` (ver
> `docs/frentes/README.md`), no modo autônomo do `CLAUDE.md`. Execução
> inline pela própria frente, tarefa a tarefa; revisão crítica do diff
> inteiro no fim. Os passos usam caixa de seleção (`- [ ]`).

**Objetivo:** as abas **API Keys** e **Documentação da API** de `/settings`
saem do guarda com **zero** — toda cor de token, sem texto abaixo de 12px,
sem emoji no JSX — e fazem **o que faziam**. Em `ApiDocumentation.tsx`,
**só classe**: URL, rota, `curl`, exemplo de resposta e o texto das notas não
mudam (`ApiDocumentation.tsx` já ensinou URL morta oito vezes).

**Arquitetura:** tradução arquivo a arquivo pela Tabela do G1, como no G2–G5.
Um caso novo: o **bloco de código escuro** (`#1E1E2E`/`#A9B1D6`, tema de
editor herdado da dn.ia) existe nos dois arquivos. Ele vira o bloco de código
que a casa já usa (`ExperimentsSetup.tsx`, `AIDataChat.tsx`): fundo
`bg-muted/50`, borda `border-border`, texto `text-foreground`; o realce dos
marcadores `[PROJECT_ID]`/`[WEBHOOK_SECRET]` (`#EF9F27`, âmbar) vira
`text-[--on-tint-warning]` — "preencha aqui" é atenção.

**Stack:** React 18 · Vite · TypeScript · Tailwind 3.4.17 · shadcn/ui (Radix)

**Spec:** `docs/superpowers/specs/2026-09-22-marketinghs-visual-design-system-design.md` (Fase 2, grupo G6)
**Plano anterior (molde e decisões):** `docs/superpowers/plans/2026-09-30-marketinghs-visual-fase-2-g5-paginas-ab.md`

**Branch:** `worktree-agent-a382818731724ccc3` (worktree da frente), a partir
da `main` em `a6f2e87`.

**Escopo medido em 01/10** (guarda, por arquivo):

| Arquivo | Guarda | Destino |
|---|---|---|
| `components/admin/settings/ApiDocumentation.tsx` | 38 | Tarefa 2 |
| `components/admin/settings/ApiKeysManagement.tsx` | 31 | Tarefa 1 |

O resto de `settings/` e o `SettingsPage.tsx` são da frente `g6-cartoes`.

**Dado real em produção (01/10):** 5 chaves, todas **ativas**, permissões
"Leitura" e "Escrita" — esses badges se veem ao vivo. "Leitura + Escrita",
"Revogada", "Expirada", a confirmação "Revogar esta chave?", o diálogo "Nova
API Key" e o diálogo da chave revelada **não** se veem sem ação: conferência
por elemento sintético com as classes finais. A Documentação é estática:
tudo ao vivo.

---

## Restrições globais

- ⚠️ **A tela faz o que fazia.** O `git diff` mostra só classe, cor, token e
  marcação de apresentação. **Nenhuma** lógica, rota, chamada de API,
  condição, `useState`, `onClick`, URL, `curl`, payload ou texto muda.
  Exceções nomeadas: (1) `MethodBadge` passa a escolher **variante** em vez
  de string de classe (a mesma cadeia de `method === …`); (2) o `✓` de
  "Copiado ✓" sai (o ícone `Check` já está ao lado — ícone é componente,
  nunca emoji); (3) o `style={{ … }}` com hexadecimal do bloco de código
  vira `className`.
- ⚠️ **`frontend/src/design-system/` não se edita.**
- **Cor sai de token**, pela Tabela de tradução do G5. Nenhum hexadecimal,
  cor literal do Tailwind (inclusive `white`/`black`), `hsl()`/`rgb()`.
- **Nenhum texto abaixo de 12px** (`text-[9px]`/`[10px]`/`[11px]` → `text-xs`).
- **Badge com significado usa a variante do `Badge`**; `variant="outline"`
  + classe de cor sai.
- **Botão não ganha cor por `className`** quando o primitivo tem a variante
  (o "Copiar" do bloco de código fica `ghost` sem cor; o "Gerenciar API
  Keys →" fica `link` sem `text-primary`). Exceção do G5 mantida: o gatilho
  "Revogar" é `ghost` com texto de perigo (não existe variante
  ghost-destrutiva), traduzido para `text-[--on-tint-danger]
  hover:text-[--on-tint-danger] hover:bg-[--tint-danger]`.
- **O aviso âmbar tem uma forma** (a do G4): fundo `bg-[--tint-warning]`,
  borda `border-warning/30`, texto `text-[--on-tint-warning]`, ícone
  `text-warning`, sem `dark:`; padding de origem fica.
- **A nota azul de endpoint** é o mesmo molde em informação:
  `bg-[--tint-info] border border-info/30`, ícone `text-info`, texto
  `text-xs text-[--on-tint-info]`.
- `bg-white/[0.03] border-white/[0.08]` (cartão sutil da dn.ia) →
  `bg-surface border-border` (como os campos da Fase 1).
- **`focus-visible`, nunca `focus:`.** `dark:` sai onde há token.
- **Frontend:** `cd frontend && npx tsc --noEmit -p tsconfig.app.json && npx vite build`.
  `tsc` tem **4 erros pré-existentes** (`LeadScoringSettings` ×1,
  `useJourneys` ×3); nenhum novo.
- **Navegador:** `node scripts/conferir-telas.mjs --porta 8081 …` e um script
  da frente no scratchpad que reusa o token salvo; troca de aba é permitida;
  **nenhum clique** em "Nova chave", "Criar chave", "Revogar", "Sim",
  "Copiar", "Swagger UI", "OpenAPI YAML" nem "Gerenciar API Keys →".

## Tabela de tradução

A mesma do G5 (verde = sucesso, âmbar/amarelo/laranja = atenção,
vermelho = perigo, azul = informação, roxo/`primary/15` = destaque).

Mapas desta metade:

| Onde | Chave | Origem | Destino |
|---|---|---|---|
| `ApiKeysManagement` `PermissionBadge` | `read` | azul | `variant="info"` |
| | `write` | amarelo | `variant="warning"` |
| | outro (`read_write`) | esmeralda | `variant="success"` |
| `ApiKeysManagement` `StatusBadge` | revogada | `muted` | `variant="secondary"` |
| | expirada | vermelho | `variant="destructive"` |
| | ativa | esmeralda | `variant="success"` |
| `ApiDocumentation` `MethodBadge` | `GET` | esmeralda | `variant="success"` |
| | `PATCH` | âmbar | `variant="warning"` |
| | `DELETE` | vermelho | `variant="destructive"` |
| | outro (`POST`, `PUT`, `PATCH / POST`…) | azul | `variant="info"` |
| `ApiDocumentation` `RESPONSE_CODES` | 200 | esmeralda | `text-[--on-tint-success]` |
| | 400 | amarelo | `text-[--on-tint-warning]` |
| | 401, 500 | vermelho | `text-[--on-tint-danger]` |
| | 404, 422 | laranja | `text-[--on-tint-warning]` |
| `ApiDocumentation` badge "Interno" | — | `bg-primary/15 text-primary border-0` | `variant` padrão (tinta primária) |
| `ApiDocumentation` badge "Recomendado" | — | esmeralda | `variant="success"` |
| `ApiDocumentation` `KeyRound` da chave 2 | — | `text-emerald-500` | `text-success` (ícone) |
| `ApiDocumentation` item ativo do menu lateral | — | `bg-primary/10 text-primary` | `bg-[--tint-primary] text-[--on-tint-primary]` |

## Review Focus

1. **URL, rota ou payload mudando sem querer** em `ApiDocumentation.tsx`.
   Conferido pelo `git diff`: fora de `className`/`variant`/`style`, nenhuma
   linha; `BASE_URL`, `href`, `path`, `curl`, `response`, `notes` intactos.
2. **Badge sem dado ao vivo** — "Leitura + Escrita", "Revogada",
   "Expirada" e os diálogos só por sintético, nos dois temas, com contraste
   medido (texto ≥ 4,5:1; abaixo disso, se for defeito do DS já registrado
   no `ORIGEM.md`, anota).
3. **Bloco de código perdendo legibilidade** — o fundo escuro fixo some;
   texto e marcadores precisam ler nos dois temas.
4. **Revogar** — o gatilho, o "Sim" destrutivo e o "Não" mantêm `onClick`
   e `disabled` byte a byte.

---

### Tarefa 1: `ApiKeysManagement.tsx` (aba API Keys)

- [ ] A. Antes: guarda (31) e fotos claro/escuro, 1440/390 (feito em 01/10,
  `g6int/antes-*` no scratchpad).
- [ ] B. Traduzir pela tabela e pelas restrições: os dois badges; `text-[10px]`
  e `text-[11px]` → `text-xs` (cabeçalhos da tabela, descrição, prefixo,
  "—", botões "Sim"/"Não"/"Revogar", "Copiar", `Authorization`); "Revogar
  esta chave?" → `text-[--on-tint-danger]`; asterisco do "Nome" →
  `text-[--on-tint-danger]`; aviso âmbar da chave revelada; bloco de código
  da chave; cartão `white/[0.03]` → `bg-surface border-border`.
- [ ] C. Guarda 0, greps complementares sem linha, `tsc` 4, `vite build`.
- [ ] D. Tela: ao vivo a lista; sintético dos badges que faltam, do aviso
  e do bloco de código, nos dois temas.
- [ ] E. Diff só de apresentação (G do procedimento do G5).
- [ ] F. Commit `feat(visual): API Keys sai do guarda — permissão e status são variante`.

### Tarefa 2: `ApiDocumentation.tsx` (aba Documentação da API)

- [ ] A. Antes: guarda (38) e fotos por seção (feito).
- [ ] B. Traduzir: `CodeBlock`, `MethodBadge`, badge "Sim" da tabela de
  parâmetros (`text-[9px] h-4` → `text-xs h-4`, como em `EventsTimeline`),
  `code` dos tipos de evento, `RESPONSE_CODES`, rótulo de seção do menu,
  item ativo do menu (+ `focus-visible`), badges do cabeçalho, os dois
  cartões de autenticação, a nota azul, `text-[11px]` restantes.
- [ ] C–E como na Tarefa 1; no diff, Review Focus 1 com
  `git diff -U0 | grep -E "BASE_URL|href|path:|curl|response:|notes:"` → zero.
- [ ] F. Commit `feat(visual): Documentação da API sai do guarda — só classe`.

### Tarefa 3: Portão, revisão final e registro

- [ ] Guarda 0 nos dois; `npm run -s guarda:visual -- src/components/admin/settings`
  baixa exatamente 69 em relação à `main`.
- [ ] `tsc` 4, `vite build`.
- [ ] Capacidade por capacidade (`git diff a6f2e87 -- <os dois>`).
- [ ] Telas: `/settings` e as duas abas, claro/escuro, 1440/390.
- [ ] Revisão crítica do diff inteiro; onda de conserto.
- [ ] Estado e "pronto para merge" em `docs/frentes/g6-integracoes.md`; push.
