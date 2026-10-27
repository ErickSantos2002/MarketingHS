-- 035 — o leitor não vê contato EXCLUÍDO (frente papel-leitura, 27/10/2026)
--
-- A 034 deu ao papel `leitura` a visão do admin dentro de transação READ
-- ONLY. Mas o admin vê contato excluído (`leads.deleted_at IS NOT NULL`) —
-- a lixeira é dele — e o leitor é de agência externa: quem foi apagado
-- (inclusive a pedido, LGPD) não deve sair para fora. Filtrar rota a rota
-- deixaria a próxima rota esquecida vazando; aqui o banco esconde, numa
-- política RESTRITIVA de SELECT que só morde o leitor em transação READ ONLY:
--
--   - `leads`: some o excluído (a ficha por id vira 404);
--   - toda tabela com `lead_id`: some a linha de lead excluído;
--   - tabela com `dnia_id` (eventos, envios, A/B, identidades): some a linha
--     cujo dnia_id é de um lead excluído e de nenhum lead ativo.
--
-- Admin, worker e service_role não mudam: `eh_leitor_somente_leitura()` é
-- falso para eles (e service_role tem BYPASSRLS). RESTRICTIVE só corta; o
-- que o leitor vê continua vindo das políticas permissivas de admin (034).
--
-- ⚠️ Funções SECURITY DEFINER (evaluate_segment_rules, journey_node_metrics,
-- mql_reuniao_agendada_today…) ignoram RLS. As que devolvem ids passam por um
-- JOIN em `leads` na rota, que aqui já filtra; `journey_node_metrics` devolve
-- só contagens (agregado, sem identificar ninguém).
--
-- Reaplicável: CREATE OR REPLACE + DROP POLICY IF EXISTS antes do CREATE.
-- Desfazer: DROP POLICY leitor_sem_excluidos em cada tabela + DROP FUNCTION.

CREATE OR REPLACE FUNCTION public.eh_leitor_somente_leitura()
    RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT current_setting('transaction_read_only') = 'on'
     AND EXISTS (SELECT 1 FROM public.user_roles
                  WHERE user_id = auth.uid() AND role::text = 'leitura')
$$;

-- Linha ligada a lead (por id e/ou por dnia_id) de contato NÃO excluído.
-- ⚠️ Não confere quem pergunta: a política chama `eh_leitor_somente_leitura()`
-- dentro de `(SELECT ...)`, que vira InitPlan — avaliado UMA vez por query,
-- não por linha. Sem isso, toda leitura do admin em contact_events pagaria
-- uma consulta a user_roles por linha.
-- `_dnia_id` é TEXT porque `ab_events`/`ab_identities` guardam o dnia_id como
-- texto; o que não for uuid não casa com lead nenhum (e não derruba a query).
DROP FUNCTION IF EXISTS public.leitor_ve(uuid, uuid);
CREATE OR REPLACE FUNCTION public.leitor_ve(_lead_id uuid, _dnia_id text DEFAULT NULL)
    RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH d AS (
    SELECT CASE WHEN _dnia_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN _dnia_id::uuid END AS v
  )
  SELECT (
           (_lead_id IS NULL
            OR EXISTS (SELECT 1 FROM public.leads
                        WHERE id = _lead_id AND deleted_at IS NULL))
           AND
           ((SELECT v FROM d) IS NULL
            OR EXISTS (SELECT 1 FROM public.leads
                        WHERE dnia_id = (SELECT v FROM d) AND deleted_at IS NULL)
            OR NOT EXISTS (SELECT 1 FROM public.leads
                            WHERE dnia_id = (SELECT v FROM d) AND deleted_at IS NOT NULL))
         )
$$;

REVOKE ALL ON FUNCTION public.eh_leitor_somente_leitura() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.leitor_ve(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eh_leitor_somente_leitura() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.leitor_ve(uuid, text) TO authenticated, service_role;

-- leads: o próprio registro.
DROP POLICY IF EXISTS leitor_sem_excluidos ON public.leads;
CREATE POLICY leitor_sem_excluidos ON public.leads AS RESTRICTIVE FOR SELECT
    TO authenticated
    USING (deleted_at IS NULL OR (SELECT NOT public.eh_leitor_somente_leitura()));

-- Tabelas com lead_id (e dnia_id, quando têm).
DO $$
DECLARE
    t record;
BEGIN
    FOR t IN
        SELECT * FROM (VALUES
            ('ab_events',          'lead_id',        'dnia_id'),
            ('ab_identities',      'lead_id',        'dnia_id'),
            ('campaign_sends',     'lead_id',        'dnia_id'),
            ('contact_events',     'lead_id',        'dnia_id'),
            ('ecosystem_identities','dndash_lead_id','dnia_id'),
            ('crm_handoffs',       'lead_id',        NULL),
            ('email_events',       'lead_id',        NULL),
            ('email_send_dead',    'lead_id',        NULL),
            ('email_send_queue',   'lead_id',        NULL),
            ('email_suppressions', 'lead_id',        NULL),
            ('journey_runs',       'lead_id',        NULL),
            ('journey_saidas',     'lead_id',        NULL),
            ('journey_step_log',   'lead_id',        NULL),
            ('lead_consents',      'lead_id',        NULL),
            ('lead_conversions',   'lead_id',        NULL),
            ('lead_notes',         'lead_id',        NULL),
            ('lead_tags',          'lead_id',        NULL),
            ('segment_contacts',   'lead_id',        NULL)
        ) AS v(tabela, col_lead, col_dnia)
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS leitor_sem_excluidos ON public.%I', t.tabela);
        EXECUTE format(
            'CREATE POLICY leitor_sem_excluidos ON public.%I AS RESTRICTIVE FOR SELECT '
            'TO authenticated USING ((SELECT NOT public.eh_leitor_somente_leitura()) '
            'OR public.leitor_ve(%I, %s))',
            t.tabela, t.col_lead,
            CASE WHEN t.col_dnia IS NULL THEN 'NULL::text' ELSE quote_ident(t.col_dnia) || '::text' END);
    END LOOP;
END $$;
