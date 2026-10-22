-- Aponta a entrega ao GrowthHS para o RECEPTOR DE TESTE (Tarefa 18, 22/10/2026).
--
-- O ERICK RODA, pelo `~/marketinghs-prova-rd.sh receptor`, depois do deploy
-- com `PROVA_RECEPTOR_TESTE=true` no ambiente da API (sem a chave o receptor
-- responde 404 e o handoff falha à vista — nada sai para fora).
--
-- O que faz:
--   1. guarda a linha atual de `growthhs_config` (ou "não havia") em
--      `integration_secrets`, nome `PROVA_RD_GROWTHHS_ANTERIOR` — só na
--      PRIMEIRA vez: rodar de novo não troca o original pelo valor do receptor;
--   2. `growthhs_config` → `base_url` do receptor (o serviço da API pela rede
--      interna do EasyPanel; a fila soma `/api/v1/integration/cards`),
--      `board_id = 1`; `app_url` fica como estava;
--   3. `GROWTHHS_API_KEY` em `integration_secrets` só se não existir — gerada
--      aqui (2 uuid v4 = 244 bits do gerador do Postgres, sem extensão), nunca
--      impressa. O receptor confere a MESMA chave que a fila manda. Se foi
--      criada aqui, a limpeza apaga.
--
-- Variável opcional: -v base_url=... (padrão abaixo).
-- Reaplicável. A volta é o `limpeza.sql`.

\set ON_ERROR_STOP on
\if :{?base_url}
\else
  \set base_url 'http://erick_marketinghs-api:8000/teste/growthhs'
\endif

BEGIN;

-- 1. O valor anterior, uma vez só.
INSERT INTO public.integration_secrets (name, value)
SELECT 'PROVA_RD_GROWTHHS_ANTERIOR',
       jsonb_build_object(
         'existia', g.id IS NOT NULL,
         'base_url', g.base_url,
         'board_id', g.board_id,
         'app_url', g.app_url,
         'chave_criada_pela_prova',
           NOT EXISTS (SELECT 1 FROM public.integration_secrets WHERE name = 'GROWTHHS_API_KEY'),
         'guardado_em', now())::text
  FROM (SELECT 1) um
  LEFT JOIN LATERAL (SELECT id, base_url, board_id, app_url
                       FROM public.growthhs_config LIMIT 1) g ON true
ON CONFLICT (name) DO NOTHING;

-- 2. O receptor (a tabela tem uma linha só: índice único em (true)).
UPDATE public.growthhs_config
   SET base_url = :'base_url', board_id = 1, updated_at = now();
INSERT INTO public.growthhs_config (base_url, board_id)
SELECT :'base_url', 1
 WHERE NOT EXISTS (SELECT 1 FROM public.growthhs_config);

-- 3. A chave, só se faltar.
INSERT INTO public.integration_secrets (name, value)
VALUES ('GROWTHHS_API_KEY',
        replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (name) DO NOTHING;

COMMIT;

\echo
\echo '==> growthhs_config agora (a chave nunca aparece aqui):'
SELECT base_url, board_id, app_url FROM public.growthhs_config;
SELECT name, (name = 'GROWTHHS_API_KEY') AS chave_presente
  FROM public.integration_secrets WHERE name = 'GROWTHHS_API_KEY';
SELECT (value::jsonb - 'guardado_em') AS valor_anterior_guardado
  FROM public.integration_secrets WHERE name = 'PROVA_RD_GROWTHHS_ANTERIOR';
