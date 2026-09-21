-- 017 — `ab_config` deixa de apontar para a dn.ia e guarda o redirecionador.
--
-- ⚠️ O DEFAULT 'dnia.ai' de `production_domain` veio da origem: com ele, a
-- primeira linha criada sem domínio validaria as variantes dos testes contra
-- o domínio de outra empresa. Sem default e sem NOT NULL, "não configurado" é
-- NULL, e a tela manda configurar.
--
-- `redirector_base` morava no localStorage de cada navegador (chave
-- `ab-redirector-base`, padrão https://go.dnia.ai): cada admin podia ver um
-- link de distribuição diferente. Vira coluna, compartilhada pelo time.
--
-- O índice em `(true)` faz da tabela uma linha só, e é o alvo do ON CONFLICT
-- de `PUT /ab/config`. A tabela estava vazia em 21/09/2026, então criá-lo não
-- esbarra em linha duplicada.
--
-- Reaplicável: rode duas vezes para provar.

ALTER TABLE public.ab_config ALTER COLUMN production_domain DROP DEFAULT;
ALTER TABLE public.ab_config ALTER COLUMN production_domain DROP NOT NULL;
ALTER TABLE public.ab_config ADD COLUMN IF NOT EXISTS redirector_base text;
CREATE UNIQUE INDEX IF NOT EXISTS ab_config_linha_unica ON public.ab_config ((true));
