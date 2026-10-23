-- 030 — GrowthHS: homologação e produção salvos lado a lado.
--
-- Spec: docs/superpowers/specs/2026-10-23-growthhs-dois-ambientes-design.md.
--
-- • growthhs_config deixa de ser linha única: uma linha por ambiente
--   ('homologacao' | 'producao'), e no máximo uma com `ativo`. É o ambiente
--   ativo que a fila de entrega e o webhook de volta usam.
--   ⚠️ O índice `growthhs_config_linha_unica` (linha única, `((true))`, da
--   018) SAI — ele recusaria a segunda linha.
--   ⚠️ Linha que já exista sem ambiente (em 23/10 a tabela estava vazia) vira
--   'homologacao' e INATIVA: nada vai para GrowthHS nenhum até alguém
--   escolher o ambiente na tela. É o lado seguro — entregar no ambiente
--   errado não se desfaz.
-- • crm_handoffs.ambiente e ecosystem_identities.growthhs_ambiente: de que
--   GrowthHS é o card_id/person_id gravado. O card 26 da homologação não é o
--   card 26 da produção. NULL = não confiável (as linhas da prova de 21–22/10).
--
-- Os segredos por ambiente (GROWTHHS_CLIENT_SECRET_<AMBIENTE>,
-- GROWTHHS_WEBHOOK_SECRET_<AMBIENTE>) moram em integration_secrets, que não
-- muda de forma.
--
-- ⚠️ Ordem: aplicar ANTES do deploy do código novo — e depois dela o código
-- antigo não grava mais a configuração (o `ON CONFLICT ((true))` dele perde o
-- índice). Rodar com o dono das tabelas.
--
-- ⚠️ Aplicar com `psql -1` (uma transação só): uma falha no meio não deixa
-- metade aplicada. Os CHECK entram `NOT VALID` e são validados em seguida
-- (a validação só pega trava leve). Dentro do `-1` a trava do ALTER dura até
-- o COMMIT de qualquer jeito: `crm_handoffs` e `ecosystem_identities` são
-- pequenas, então é coisa de instantes — mas aplique fora de horário de
-- envio.
--
-- Reaplicável: rode duas vezes para provar.

ALTER TABLE public.growthhs_config
    ADD COLUMN IF NOT EXISTS ambiente text,
    ADD COLUMN IF NOT EXISTS ativo    boolean NOT NULL DEFAULT false;

UPDATE public.growthhs_config SET ambiente = 'homologacao', ativo = false
 WHERE ambiente IS NULL;

ALTER TABLE public.growthhs_config ALTER COLUMN ambiente SET NOT NULL;

ALTER TABLE public.growthhs_config
    DROP CONSTRAINT IF EXISTS growthhs_config_ambiente_valido;
ALTER TABLE public.growthhs_config
    ADD CONSTRAINT growthhs_config_ambiente_valido
    CHECK (ambiente IN ('homologacao', 'producao'));

DROP INDEX IF EXISTS public.growthhs_config_linha_unica;
CREATE UNIQUE INDEX IF NOT EXISTS growthhs_config_um_por_ambiente
    ON public.growthhs_config (ambiente);
CREATE UNIQUE INDEX IF NOT EXISTS growthhs_config_um_ativo
    ON public.growthhs_config ((true)) WHERE ativo;

ALTER TABLE public.crm_handoffs
    ADD COLUMN IF NOT EXISTS ambiente text;
ALTER TABLE public.crm_handoffs
    DROP CONSTRAINT IF EXISTS crm_handoffs_ambiente_valido;
ALTER TABLE public.crm_handoffs
    ADD CONSTRAINT crm_handoffs_ambiente_valido
    CHECK (ambiente IS NULL OR ambiente IN ('homologacao', 'producao')) NOT VALID;
ALTER TABLE public.crm_handoffs VALIDATE CONSTRAINT crm_handoffs_ambiente_valido;

ALTER TABLE public.ecosystem_identities
    ADD COLUMN IF NOT EXISTS growthhs_ambiente text;
ALTER TABLE public.ecosystem_identities
    DROP CONSTRAINT IF EXISTS ecosystem_identities_growthhs_ambiente_valido;
ALTER TABLE public.ecosystem_identities
    ADD CONSTRAINT ecosystem_identities_growthhs_ambiente_valido
    CHECK (growthhs_ambiente IS NULL OR growthhs_ambiente IN ('homologacao', 'producao')) NOT VALID;
ALTER TABLE public.ecosystem_identities
    VALIDATE CONSTRAINT ecosystem_identities_growthhs_ambiente_valido;
