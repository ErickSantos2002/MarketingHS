# Frente `prova-captura`

Plano: `docs/superpowers/plans/2026-10-21-prova-substituir-rd.md` — Tarefas
1 (Fase 0) e 2–6 (Fase 1). Território: linha `prova-captura` da seção
"Frentes" do plano. n 17 · Vite 8097 · backend 8117. Branch `prova-captura`.

## Estado
- [x] Fase 0 — Tarefa 1 (migration 027 + `~/marketinghs-migration-027.sh`) — **pronto para merge** (21/10)
- [ ] Fase 1 — Tarefas 2–6 (abrem depois do merge da 027)

**Para o Erick, depois do merge:** `bash ~/marketinghs-migration-027.sh`
(aditiva; pode ir antes de qualquer deploy). Aplica duas vezes e imprime três
`true`. Sem ela, os 18 testes de banco de `test_migracao_027.py` pulam.

## Tarefa 1 — migration 027

Arquivos: `backend/migrations/027_prova_substituir_rd.sql`,
`backend/tests/test_migracao_027.py`, `~/marketinghs-migration-027.sh` (fora
do repositório, molde da 026).

**Prova local (21/10).** Postgres 17.11 descartável em container
(`docker run --rm`, porta 55427, papel `marketinghs_app` criado antes),
`000`…`027` em ordem num banco vazio e a `027` de novo: **as duas aplicações
passaram sem erro** (a segunda só com os NOTICE de "already exists,
skipping"). Feito em dois containers do zero — o segundo com o arquivo final.
As três provas do script deram `true` no local. Container derrubado no fim.

**Testes.**
- `test_migracao_027.py` no Postgres local com a 027: **19 passed**; junto
  com `test_r5_jornadas.py` (a 026, cujas funções a 027 recria): **38 passed**.
- No banco de produção (sem a 027): **1 passed, 18 skipped** com o motivo
  "migration 027 ainda não aplicada neste banco".
- Suíte inteira no local, com e sem a 027 (dois containers, 000…026 contra
  000…027): **o mesmo conjunto de 21 falhas** nos dois — são do banco vazio
  (sem admin, sem dado, limite de taxa), não da 027 — e com a 027 passam 18 a
  mais (os pulados). Nenhuma regressão das funções recriadas.
- Suíte inteira no banco de produção: ver "Portão" abaixo.

**Decisões tomadas (a mais segura e reversível):**
1. `form_ids` que **não é lista** (texto, objeto) conta como filtro que não
   casa com nada — um erro de forma não vira "qualquer origem". Lista vazia
   (`[]`) = sem filtro de formulário.
2. `campo_extra` sem `value` vale como texto vazio: `quote_literal(NULL)` é
   NULL, e condição NULL é **descartada** pelo `evaluate_rules_for_lead` — a
   regra sumiria do AND e alargaria o público. Operador desconhecido e chave
   fora do padrão viram `FALSE` (inclusive em `is_not`).
3. `webhook` exige `https://` **com host** (`https://` sozinho é recusado).
4. `journey_saidas` sem FK para `journey_runs`/`leads`, como o plano descreve
   (a saída é registro de envio; o (run, nó) único é a garantia).
5. `growthhs_receptor_pedidos` tem RLS ligado e **nenhuma** política: só o
   `service_role` (BYPASSRLS) lê e grava.
6. GRANT a `authenticated` exatamente como o plano: ALL em `sites`, SELECT em
   `lead_consents` e `visitas`. `journey_saidas` tem a política de SELECT do
   admin mas **não** tem GRANT a `authenticated` — se a Tarefa 15 precisar ler
   a caixa de saída sob `authenticated`, o GRANT entra numa migration nova.

## Perguntas / fora do território

- (achado, não mexido) Na `validate_journey_graph`, o ramo `branch_attribute`
  usa `jsonb_typeof(...) <> 'array'` sem `coalesce`: nó sem `config.rules`
  dá NULL e passa calado. Vem da 018/026; a 027 copiou fiel. Os nós novos da
  027 usam `coalesce`. Corrigir é uma linha, mas muda o que o banco aceita
  hoje — fica para decisão.

## Portão (Tarefa 1)

- Suíte inteira no banco de produção (sozinha, `timeout -s KILL 3600`, 21/10):
  **530 passed, 18 skipped** (os 18 da 027), 36 min 50 s, exit 0.
- `count(*) FROM leads` no banco de produção: **2107 antes, 2107 depois**.
- `git diff --stat`: só os três arquivos da Tarefa 1; nenhum `.env` nem
  credencial no diff. Sem mudança de front (tsc/guarda/build não se aplicam).
