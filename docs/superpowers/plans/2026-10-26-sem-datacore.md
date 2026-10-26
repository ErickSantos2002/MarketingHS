# Plano — sem DataCore (pergunta 80)

Spec: `docs/superpowers/specs/2026-10-26-sem-datacore-design.md`. Execução
inline pela própria frente (escopo pequeno, um arquivo de teste), TDD.

1. **Testes vermelhos** — `backend/tests/test_sem_datacore.py` (rotas 404,
   pool fora do lifespan, `enfileirar` recusa, botão 409, nó `skipped`,
   regra e INSERT direto sem pedido) e o caso da entrega em
   `test_crm_entrega.py`. Rodar no Postgres local: falham.
2. **Trava no código** — `crm/entrega.py`: `ORIGENS_RECUSADAS`,
   `MOTIVO_ORIGEM`, `ContatoRecusado`; `enfileirar` confere a origem;
   `_entregar` falha o pedido de origem recusada. `routers/crm.py`: 409.
   `jornadas/executor.py` (fora do território, 4 linhas — anotado): pega
   `ContatoRecusado`, passo `skipped`, avança.
3. **Migration 033** — gatilho `BEFORE INSERT` em `crm_handoffs`.
   Reaplicável; provar aplicando duas vezes no banco local.
4. **Sincronização sai** — apagar router, domínio, pool, testes do
   DataCore; ajustar `main.py`, `database.py`, `config.py` (comentário),
   `automacao.py`, `ia/analista.py`, `test_automacao_em_massa.py`;
   front: `ImportPage.tsx` sem abas, apagar `DatacoreImport.tsx` e
   `lib/datacore.ts`.
5. **Portão** — arquivos novos verdes; suíte inteira no Postgres local;
   `tsc --noEmit`; `guarda:visual` em `src/pages/admin`; `git diff --stat`;
   commit + push da branch; `docs/frentes/sem-datacore.md`.
