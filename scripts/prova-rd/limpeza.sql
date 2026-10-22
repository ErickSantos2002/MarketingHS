-- Limpeza da prova de substituição do RD (Tarefa 18, passo 12 do roteiro).
--
-- O ERICK RODA, pelo `~/marketinghs-prova-rd.sh limpar`, DEPOIS do
-- `conferir` (a antimeta se confere antes de arquivar).
--
-- O que faz — tudo reversível, nada se apaga de verdade:
--   1. leads com a tag `prova-rd` CRIADOS durante a prova (depois da semente da
--      página) → `deleted_at = now()`, a exclusão lógica da casa (spec 9.4).
--      ⚠️ Contato que JÁ EXISTIA na base antes da prova e converteu nela não é
--      excluído — só é listado no fim, para o Erick decidir na tela.
--   2. as 3 jornadas da prova → `archived`; runs ainda abertos → `exited`;
--      e-mail, aviso e card ainda PENDENTES da prova → falhos, com o motivo
--      "limpeza da prova" (o worker não manda nada depois da limpeza);
--   3. `growthhs_config` volta ao que era antes do `receptor.sql` (se não
--      havia linha, a linha sai); `GROWTHHS_API_KEY` sai só se foi a prova
--      que criou;
--   4. a página `phoebus-prova` → `inactive`; o site da prova → `ativo = false`.
--
-- Reaplicável: rodar de novo não acha mais nada para mudar. Não precisa de
-- variável.

\set ON_ERROR_STOP on

BEGIN;
-- Operação em lote: só atualiza dado, não dispara regra nem jornada (023).
SET LOCAL marketinghs.sem_automacao = 'on';

CREATE TEMP TABLE prova_limpeza ON COMMIT DROP AS
SELECT
  (SELECT created_at FROM public.pages WHERE slug = 'phoebus-prova') AS inicio,
  ARRAY(SELECT id FROM public.journeys WHERE name LIKE 'Prova RD — %') AS jornadas;

-- 1. Leads da prova.
CREATE TEMP TABLE prova_leads ON COMMIT DROP AS
SELECT l.id, l.email, l.created_at, l.deleted_at,
       (l.created_at >= p.inicio) AS criado_na_prova
  FROM public.leads l, prova_limpeza p
 WHERE EXISTS (SELECT 1 FROM public.lead_tags lt JOIN public.tags t ON t.id = lt.tag_id
                WHERE lt.lead_id = l.id AND lower(t.name) = 'prova-rd');

UPDATE public.leads l
   SET deleted_at = now()
  FROM prova_leads pl
 WHERE l.id = pl.id AND pl.criado_na_prova AND l.deleted_at IS NULL;

-- 2. Jornadas, runs e o que ainda estava para sair.
UPDATE public.journeys
   SET status = 'archived', updated_at = now()
 WHERE id IN (SELECT unnest(jornadas) FROM prova_limpeza) AND status <> 'archived';

UPDATE public.journey_runs
   SET state = 'exited', lock_token = NULL, locked_until = NULL, updated_at = now(),
       context = context || jsonb_build_object('saida', 'limpeza da prova')
 WHERE journey_id IN (SELECT unnest(jornadas) FROM prova_limpeza)
   AND state IN ('active', 'waiting');

UPDATE public.campaign_sends
   SET status = 'failed', sent_at = now(), error = 'limpeza da prova'
 WHERE status = 'pending'
   AND journey_run_id IN (SELECT id FROM public.journey_runs
                           WHERE journey_id IN (SELECT unnest(jornadas) FROM prova_limpeza));

UPDATE public.journey_saidas
   SET status = 'falhou', erro = 'limpeza da prova', atualizado_em = now()
 WHERE status = 'pendente'
   AND journey_id IN (SELECT unnest(jornadas) FROM prova_limpeza);

UPDATE public.crm_handoffs
   SET status = 'falhou', erro = 'limpeza da prova', atualizado_em = now()
 WHERE status = 'pendente'
   AND lead_id IN (SELECT id FROM prova_leads WHERE criado_na_prova);

-- 3. growthhs_config de volta (só se o receptor.sql guardou o anterior).
DO $$
DECLARE
  v jsonb;
BEGIN
  SELECT value::jsonb INTO v FROM public.integration_secrets
   WHERE name = 'PROVA_RD_GROWTHHS_ANTERIOR';
  IF v IS NULL THEN
    RAISE NOTICE 'growthhs_config: nada guardado pelo receptor.sql — fica como está';
    RETURN;
  END IF;
  IF (v->>'existia')::boolean THEN
    UPDATE public.growthhs_config
       SET base_url = v->>'base_url',
           board_id = (v->>'board_id')::bigint,
           app_url  = v->>'app_url',
           updated_at = now();
  ELSE
    DELETE FROM public.growthhs_config;
  END IF;
  IF coalesce((v->>'chave_criada_pela_prova')::boolean, false) THEN
    DELETE FROM public.integration_secrets WHERE name = 'GROWTHHS_API_KEY';
  END IF;
  DELETE FROM public.integration_secrets WHERE name = 'PROVA_RD_GROWTHHS_ANTERIOR';
  RAISE NOTICE 'growthhs_config devolvido (existia antes: %)', v->>'existia';
END $$;

-- 4. Página e site.
UPDATE public.pages SET status = 'inactive', updated_at = now()
 WHERE slug = 'phoebus-prova' AND status <> 'inactive';
UPDATE public.sites SET ativo = false, atualizado_em = now()
 WHERE nome = 'Site de teste da prova' AND tags @> ARRAY['prova-rd'] AND ativo;

\echo
\echo '==> contatos com a tag prova-rd (criado_na_prova = f: já existia, NÃO foi excluído):'
SELECT pl.email, pl.created_at, pl.criado_na_prova, l.deleted_at IS NOT NULL AS excluido
  FROM prova_leads pl JOIN public.leads l ON l.id = pl.id
 ORDER BY pl.created_at;

COMMIT;

\echo '==> estado depois da limpeza:'
SELECT name, status,
       (SELECT count(*) FROM public.journey_runs r
         WHERE r.journey_id = j.id AND r.state IN ('active', 'waiting')) AS runs_abertos
  FROM public.journeys j WHERE name LIKE 'Prova RD — %' ORDER BY name;
SELECT slug, status FROM public.pages WHERE slug = 'phoebus-prova';
SELECT nome, ativo FROM public.sites WHERE nome = 'Site de teste da prova';
SELECT base_url, board_id FROM public.growthhs_config;
