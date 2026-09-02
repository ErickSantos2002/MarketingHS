-- 013: a chave do DataCore em ecosystem_identities.
--
-- É por ela que a sincronização com o ERP é idempotente: rodar duas vezes não
-- cria dois contatos para o mesmo cliente. Conferido em 02/09/2026: são 2.081
-- clientes em tiny.clientes e 2.081 cpf_cnpj distintos — a chave natural é boa.
--
-- ⚠️ Guardamos o `cpf_cnpj`, não o `id` do Tiny. O id é do banco espelho e muda
-- se o espelho for reconstruído; o cpf_cnpj é do mundo.
--
-- ⚠️ Índice PARCIAL. `datacore_cliente_id` é nulo em todo contato que não veio
-- do ERP — que é a maioria —, e um índice único comum aceitaria vários nulos
-- mas ocuparia espaço à toa. O `WHERE` também é o que o `ON CONFLICT ... WHERE`
-- da sincronização casa: sem ele, o INSERT falha com "no unique or exclusion
-- constraint matching the ON CONFLICT specification", que é uma mensagem que
-- não aponta para cá.
ALTER TABLE public.ecosystem_identities
    ADD COLUMN IF NOT EXISTS datacore_cliente_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_ecosystem_datacore_cliente
    ON public.ecosystem_identities (datacore_cliente_id)
 WHERE datacore_cliente_id IS NOT NULL;

COMMENT ON COLUMN public.ecosystem_identities.datacore_cliente_id IS
    'cpf_cnpj do cliente em tiny.clientes. Chave da sincronização de mão única com o DataCore.';
