-- 031 — O que o lead digitou em CADA conversão.
--
-- Spec: docs/superpowers/specs/2026-10-26-reconversao-dados-design.md
-- (pergunta 73).
--
-- • lead_conversions.dados_informados: os campos de contato que vieram NESTA
--   conversão (nome, empresa, cargo, whatsapp, faturamento, funcionarios,
--   desafios, indicacao e os extras em `campos_extras`), já higienizados e
--   cortados pela captura (`app/captura/informados.py`). Nada de status/tipo
--   nem UTM (os UTMs já são colunas da conversão).
--   É o histórico que a captura NÃO grava no contato (R1, 02/10: a rota é
--   anônima e não sobrescreve) — e que o card do GrowthHS e a linha do tempo
--   mostram como "Informou nesta conversão (não verificado)".
--   NULL = conversão de antes da 031, ou sem nenhum campo de contato.
--
-- ⚠️ Ordem: tanto faz. O código tolera a coluna ausente (a captura só grava
-- se ela existe; a entrega a lê por `to_jsonb(lc)`). Aplicada a 031, as
-- conversões seguintes passam a guardar o que veio.
--
-- Coluna nula, sem default: `ADD COLUMN` só mexe no catálogo (nada de
-- reescrever a tabela), a trava é de instantes. Sem índice: ninguém filtra
-- por ela. Sem extensão. Herda GRANT e políticas da tabela.
--
-- Reaplicável: rode duas vezes para provar.

ALTER TABLE public.lead_conversions
    ADD COLUMN IF NOT EXISTS dados_informados jsonb;

COMMENT ON COLUMN public.lead_conversions.dados_informados IS
    'Campos de contato informados nesta conversão (higienizados; não verificados). '
    'O contato não é sobrescrito pela captura anônima (R1). Migration 031.';
