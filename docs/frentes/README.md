# Frentes paralelas — plano em vigor (01/10/2026)

As regras gerais (modo autônomo, dono único, portas, quem faz merge) estão no
`CLAUDE.md`, seções "Modo autônomo" e "Frentes paralelas com worktree". Este
arquivo diz **quem faz o quê agora**. Só a coordenadora edita este arquivo.

> **Por que estas frentes e não as da conversa de 30/09.** A lista daquela
> conversa (redesign das 12 telas, lotes 5C, 6 e 7) estava velha: todos os
> lotes fecharam e o visual foi até o G5. O que resta de paralelizável é o
> G6 (último grupo do visual, 124 no guarda) — partido em dois por arquivo —,
> os resíduos visuais anotados nos G1–G5, e uma frente de backend que não
> encosta em `frontend/`.

## As frentes

**Estado em 01/10:** `g6-integracoes`, `g6-cartoes` e `residuos-visuais` ✅ mergeadas (Fase 2 do visual fechada, guarda 0, `tsc` 0). `backend` rodadas 1 e 2 ✅ mergeadas; rodada 3 e `ui-primitivos` em andamento (01/10). Antes: rodada 1 ✅ mergeada (`c019839`); a rodada 2 (`escrita_contatos`, `contatos`) espera a migration 021.

| Frente | n | Vite | Backend | Território (escreve só aqui + `docs/frentes/<frente>.md`) | Quando abrir |
|---|---|---|---|---|---|
| `coordenadora` | 0 | 8080 | 8100 | `docs/frentes/README.md`, `docs/CONTINUAR-AQUI.md`, `docs/perguntas-abertas.md`, `CLAUDE.md`, merge na `main` | já (raiz do repo) |
| `g6-integracoes` | 1 | 8081 | usa a 8100 | `settings/ApiDocumentation.tsx` (38), `settings/ApiKeysManagement.tsx` (31) | já |
| `g6-cartoes` | 2 | 8082 | usa a 8100 | `settings/GrowthHSCard.tsx` (13), `SuppressionList.tsx` (12), `ResendConfigCard.tsx` (9), `LeadScoringSettings.tsx` (6), `IACard.tsx` (5), `MetaCard.tsx` (5), `SocialLinksSettings.tsx` (3), `UserManagement.tsx` (0, só conferir), `pages/admin/SettingsPage.tsx` (2) | já |
| `backend` | 4 | 8084 | **8104** | `backend/**` inteiro (é a única dona de migration, `config.py`, routers e testes) | já |
| `residuos-visuais` | 3 | 8083 | usa a 8100 | os arquivos listados no backlog dela, todos fora de `settings/` | quando uma das duas do G6 fechar |
| `ui-primitivos` | 5 | 8085 | usa a 8100 | `components/ui/` (dona única nesta rodada), os usos de `DialogContent` sem descrição, `components/admin/AdminLayout.tsx` | 01/10, rodada 3 |
| `cores-decisoes` | 6 | 8086 | usa a 8100 | ver `cores-decisoes.md` | 01/10, rodada 4 |
| `contatos-decisoes` | 7 | 8087 | usa a 8100 | `components/admin/contacts/` e a ficha | 01/10, rodada 4 |
| `primitivos-cta` | 8 | 8088 | usa a 8100 | `ui/button`, `ui/input`, `h-9` manual, CTA das landings | 01/10, rodada 4 |

Os números entre parênteses são o guarda de 01/10 (`npm run guarda:visual -- <arquivo>`).
`settings/` = `frontend/src/components/admin/settings/`.

**Quatro frentes de uma vez, no máximo.** Acima disso o merge come o ganho.
Começar com três (`g6-integracoes`, `g6-cartoes`, `backend`) e abrir a
`residuos-visuais` no lugar da primeira que fechar.

## Como uma frente roda

A coordenadora despacha cada frente como **subagente em segundo plano com
worktree própria** — sem Konsole, sem comando do Erick. A frente roda
`bash scripts/preparar-worktree.sh`, sobe o próprio Vite na porta da tabela,
trabalha o backlog do `docs/frentes/<frente>.md` em ordem, no modo autônomo do
`CLAUDE.md`, e devolve à coordenadora o nome da branch e o estado.

Abrir à mão continua possível: `claude --worktree <frente>` e pedir para ler
este arquivo e o da frente.

## Navegador

Cada frente confere tela com `scripts/conferir-telas.mjs` (Chrome próprio,
login com a conta admin do Claude feito pelo script, token reaproveitado por
1 h por causa do limite de taxa do login). O Playwright MCP fica com a
coordenadora. Regra de só leitura em produção vale em todas: nenhum clique em
ação.

## O ciclo de merge (coordenadora)

1. A frente fecha um lote (revisão final feita), faz push de `worktree-<frente>`
   e marca **"pronto para merge"** no arquivo dela.
2. A coordenadora: `git fetch && git merge --no-ff worktree-<frente>` na `main`.
3. Portão depois do merge: `npm run guarda:visual -- src` (não pode subir),
   `tsc --noEmit -p tsconfig.app.json` (sem erro novo além dos 4 conhecidos),
   `vite build` e `build:landing`; `pytest -q` se o merge tocou `backend/`.
4. Push da `main`; bloco novo no `CONTINUAR-AQUI.md`; perguntas da frente
   copiadas para `docs/perguntas-abertas.md`.
5. As outras frentes trazem a `main` com `git merge main` (nunca rebase —
   a branch já foi pushada).

**O fim do G6 é marco:** quando `g6-integracoes` e `g6-cartoes` estiverem as
duas na `main`, o guarda do app tem que dar **0**. A coordenadora roda a
revisão final do G6 inteiro (as duas metades juntas) e fecha a Fase 2.

## Riscos conhecidos deste arranjo

- **`LeadScoringSettings.tsx` tem 1 dos 4 erros de `tsc` pré-existentes**: é da
  `g6-cartoes`. Os 3 do `useJourneys` são da `residuos-visuais`.
- **Testes de backend batem no banco de produção**, em transação revertida —
  liberado pelo Erick em 01/10 (sem uso real; o banco será resetado).
- **`node_modules` e `.venv` são links para a checkout principal.** Nenhuma
  frente instala dependência; se precisar, anota e a coordenadora instala.
- `ApiDocumentation.tsx` já ensinou URL morta oito vezes: a frente mexe em
  classe, nunca em URL nem em exemplo de payload.
