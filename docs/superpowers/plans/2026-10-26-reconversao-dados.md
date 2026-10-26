# Plano — reconversão com dados diferentes

Spec: `docs/superpowers/specs/2026-10-26-reconversao-dados-design.md`.
Execução inline com TDD (lote pequeno, um território só).

1. **031** — `backend/migrations/031_dados_informados.sql`; teste
   `tests/test_reconversao_dados.py::test_031_reaplicavel` (cópia temporária,
   duas vezes).
2. **`captura/informados.py`** — `dados_informados`, `divergencias`; testes
   puros no mesmo arquivo.
3. **Registro** — `registrar_captura` grava `dados_informados` (se a coluna
   existir) e passa `informados_diferentes` ao `publicar_conversao`;
   comentário do `_atualizar` corrigido. Testes de banco com `conexao` e
   `lead_conversions` temporária (o `pg_temp` vem primeiro no `search_path`).
4. **CRM** — `origem_do_card` lê `to_jsonb(lc)->'dados_informados'`;
   `montar_descricao` e `texto_da_nota` mostram a divergência; testes puros e
   um de entrega com `origem_do_card` substituído.
5. **Linha do tempo** — `EventsTimeline.tsx`; `tsc` e `guarda:visual`.
6. **Rodar** os arquivos de captura e CRM/GrowthHS (um pytest por vez),
   registro em `docs/frentes/reconversao-dados.md`, commit + push da branch.
