# Frente `g6-integracoes`

Metade do G6 (Configurações), o último grupo da Fase 2 do visual.
Território: `settings/ApiDocumentation.tsx` (38 no guarda) e
`settings/ApiKeysManagement.tsx` (31). Nada mais.

## Backlog (em ordem)

- [x] Escrever o plano no molde de
  `docs/superpowers/plans/2026-09-30-marketinghs-visual-fase-2-g5-paginas-ab.md`
  → `docs/superpowers/plans/2026-10-01-marketinghs-visual-fase-2-g6-integracoes.md`.
  Regras do "Levar para o G6" no topo do `CONTINUAR-AQUI.md`.
- [x] `ApiKeysManagement.tsx` sai do guarda.
- [x] `ApiDocumentation.tsx` sai do guarda — **só classe**; URL, rota e
  exemplo de payload não mudam (`git diff` prova).
- [x] Portão: guarda 0 nos dois arquivos, `tsc` sem erro novo, `vite build`,
  capacidade por capacidade no `git diff`, telas no navegador (claro, escuro,
  1440 e 390 px), sem clicar ação.
- [x] Revisão final da branch + onda de conserto; push; marcar "pronto para merge".

## Estado

**✅ Pronto para merge (01/10/2026).** Branch
`worktree-agent-a382818731724ccc3`, a partir da `main` em `a6f2e87`.

| Commit | O que entrou |
|---|---|
| `9293270` | Plano da frente |
| `a1d4e3b` | API Keys sai do guarda — permissão e status são variante |
| `b5aa7f6` | Documentação da API sai do guarda — só classe |

**Placar do guarda:** `ApiKeysManagement.tsx` **31 → 0**,
`ApiDocumentation.tsx` **38 → 0**; `settings/` 122 → **53**; app inteiro
124 → **55** (`settings` 53 + `pages/admin` 2 — o resto é da `g6-cartoes`).

**Portão (01/10):** `tsc --noEmit -p tsconfig.app.json` com os mesmos **4**
erros (`LeadScoringSettings` ×1, `useJourneys` ×3); `vite build` passando;
`frontend/src/design-system/` sem diff; grep de alfa concatenada nos dois
arquivos — zero. **Capacidade por capacidade** (`git diff a6f2e87 -U0`):
fora de `className`/`variant`, só sobram as exceções nomeadas do plano — o
`MethodBadge` escolhendo variante pela **mesma** cadeia `method === …`, os
6 valores de cor do `RESPONSE_CODES`, o item ativo do menu, o `<Badge>Interno</Badge>`
sem classe e o `✓` que saiu de "Copiado" (o ícone `Check` já estava ao lado).
`BASE_URL`, `href`, `path`, `curl`, `response`, `notes`, `onClick`,
`disabled`, `handle*` e `querySelector`: **zero linhas** no diff.

**O que se viu na tela** (`/settings` pelo `conferir-telas.mjs` e as duas
abas por script próprio que reusa o token; claro/escuro, 1440/390; nenhum
clique em ação — só troca de aba e da aba interna "Exemplo"):
- **API Keys, ao vivo:** 5 chaves em produção, todas ativas — "Leitura"
  (info), "Escrita" (warning), "Ativa" (success) e o gatilho "Revogar" em
  texto de perigo. **Sintético** (classes finais injetadas na aba):
  "Leitura + Escrita", "Revogada", "Expirada", "Revogar esta chave?" + "Sim"/"Não",
  asterisco do "Nome", aviso âmbar, bloco da chave e cartão do
  `Authorization` — o diálogo "Nova API Key" e o da chave revelada não foram
  abertos (abrir exigiria "Nova chave"/"Criar chave").
- **Documentação, ao vivo inteira:** cabeçalho, autenticação, códigos de
  resposta, endpoints com aba "Exemplo" (marcador `[WEBHOOK_SECRET]` em âmbar),
  notas azuis, variáveis de ambiente.
- **Contraste medido** (texto sobre fundo composto): tudo ≥ 4,5:1 nos dois
  temas, **exceto** os defeitos do DS já registrados no `ORIGEM.md` — badge
  `secondary` ("Revogada") 4,34 e `--on-tint-warning` ("Escrita", aviso
  âmbar) 4,30 no claro; "Sim" destrutivo é o branco sobre `danger-500`.
- Console: só os 2 avisos de futuro do React Router, os mesmos do "antes".

**Revisão final da branch (01/10):** revisão crítica do diff inteiro pela
própria frente — sem Critical nem Important; onda de conserto vazia.

**Resíduos (não consertados, fora do território ou fora de "só classe"):**
1. A 390 px a página estoura para 973 px de largura — é a lista de abas do
   `SettingsPage.tsx` (da `g6-cartoes`), igual no "antes".
2. O `<pre>` da chave revelada usa `break-all` sem `whitespace-pre-wrap`:
   a 390 px a chave não quebra e passa por baixo do "Copiar". Comportamento
   de origem, sem mudança de classe de cor; consertar é mexer em layout.
3. A nota do `POST /publico/captura` começa com `⚠️` **no texto** (dado da
   documentação). Fica: a regra desta frente é só classe.
4. O "Copiar" do bloco de código é `ghost` sobre `bg-muted/50`; o hover
   (`surface-elevated`) muda pouco sobre esse fundo.

## Perguntas

1. **Bloco de código: claro (token) ou escuro de editor?** O bloco de código
   dos dois arquivos era um tema de editor escuro fixo da dn.ia (`#1E1E2E`,
   texto `#A9B1D6`, marcador `#EF9F27`), nos dois temas da tela. Opções:
   (a) o bloco de código que a casa já usa (`bg-muted/50`, borda, texto
   `foreground`, marcador em `--on-tint-warning`) — segue o tema da tela;
   (b) pedir ao Design System oficial um token de "superfície de código"
   escura. **Assumida: (a)**, a mesma de `ExperimentsSetup.tsx` — só classe,
   volta com um commit.
