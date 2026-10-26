# Plano — GrowthHS perdido e no show (frente `growthhs-perdido`)

Spec: `docs/superpowers/specs/2026-10-26-growthhs-perdido-design.md`.
Execução inline com TDD (lote pequeno, um só dono de cada arquivo).

1. **Migration 032** (`backend/migrations/032_growthhs_perdido.sql`):
   `ADD COLUMN IF NOT EXISTS listas_perdido bigint[] NOT NULL DEFAULT '{27,33}'`,
   `listas_no_show ... DEFAULT '{25}'`; `INSERT INTO lead_statuses ...
   ON CONFLICT (lower(name)) DO NOTHING`. Teste: aplicada 2× numa cópia
   temporária, linhas existentes ganham o padrão, status existe 1×.
2. **Config** (`growthhs.py`: `Config`, `_config_da_linha`, leitura com
   `SELECT *` tolerante à 032 ausente). Teste: `ler_config` lê as listas; sem
   as colunas, padrões.
3. **Volta + retorno** (`volta.EVENTOS`, `_listas_do_evento`;
   `retorno.ESTAGIO_POR_EVENTO`, `avancar_status` com as regras do perdido).
   Testes de webhook: deal_lost muda + evento; venda não rebaixa; perdido →
   reunião volta ao funil; no_show só evento; lista errada ignorada;
   no_show + reagendamento.
4. **Config da tela no backend** (`configuracao.py`): campos, validação,
   interseção entre as 4, URLs, estado. Testes de PUT/GET.
5. **Listas de status**: `importacao.STATUS_VALIDOS`,
   `escrita_contatos._EVENTO_POR_STATUS`; front `StatusBadge`,
   `AutomationRuleForm`, `ApiDocumentation`.
6. **Tela** `GrowthHSCard.tsx`: dois campos + duas URLs. `tsc`, guarda
   visual, `conferir-telas` em `/admin/settings`.
7. Testes tocados (sem a suíte inteira), `docs/frentes/growthhs-perdido.md`,
   commit + push da branch.
