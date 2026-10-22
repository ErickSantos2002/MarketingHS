-- Conferência da prova de substituição do RD (Tarefa 18) — SÓ LEITURA.
--
-- O ERICK RODA, pelo `~/marketinghs-prova-rd.sh conferir [emails]`, quantas
-- vezes quiser: um bloco por passo do `docs/prova-rd/roteiro.md`, e no fim a
-- conferência da antimeta (nenhum envio do dia para fora da lista).
--
-- A sessão é READ ONLY: nada aqui escreve (nem tabela temporária). Funciona
-- antes da semente, durante a prova e depois da limpeza (aí os leads aparecem
-- com `excluido = t`).
--
-- Variável opcional: -v emails=a@x,b@y — a lista da prova. Sem ela, a lista é
-- lida das jornadas da prova (o modo teste + os destinatários do aviso).
-- "Do dia" = desde 0h de hoje no horário de Brasília.

\set ON_ERROR_STOP on
\pset null '·'
SET default_transaction_read_only = on;

\if :{?emails}
SELECT set_config('prova.lista', coalesce((
         SELECT string_agg(DISTINCT e, ',')
           FROM (SELECT lower(btrim(x)) AS e
                   FROM unnest(string_to_array(translate(:'emails', '{}', ''), ',')) x) s
          WHERE e <> ''), ''), false) AS lista_da_prova_pela_variavel;
\else
SELECT set_config('prova.lista', coalesce((
         SELECT string_agg(DISTINCT e, ',')
           FROM (SELECT lower(btrim(x)) AS e
                   FROM public.journeys j, unnest(j.allowed_emails) x
                  WHERE j.name LIKE 'Prova RD — %'
                 UNION
                 SELECT lower(btrim(x))
                   FROM public.journeys j, jsonb_array_elements(j.nodes) n,
                        jsonb_array_elements_text(coalesce(n#>'{config,emails}', '[]'::jsonb)) x
                  WHERE j.name LIKE 'Prova RD — %' AND n->>'type' = 'notify_email') s
          WHERE e <> ''), ''), false) AS lista_da_prova_pelas_jornadas;
\endif
SELECT set_config('prova.hoje',
         (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')
            AT TIME ZONE 'America/Sao_Paulo')::text, false) AS do_dia_desde;

-- Pedaços reusados (psql interpola :VAR sem aspas dentro do SQL).
\set LISTA '(string_to_array(current_setting(''prova.lista''), '',''))'
\set HOJE '(current_setting(''prova.hoje'')::timestamptz)'
-- Os leads da prova: com a tag `prova-rd` ou com e-mail da lista.
\set LEADS 'SELECT l.* FROM public.leads l WHERE EXISTS (SELECT 1 FROM public.lead_tags lt JOIN public.tags t ON t.id = lt.tag_id WHERE lt.lead_id = l.id AND lower(t.name) = ''prova-rd'') OR lower(btrim(l.email)) = ANY (string_to_array(current_setting(''prova.lista''), '',''))'
\set JORNADAS '(SELECT id FROM public.journeys WHERE name LIKE ''Prova RD — %'')'

\echo
\echo '=== Antes: página, site, jornadas, templates, GrowthHS ==='
SELECT slug, status, config->'tags' AS tags, config->>'noindex' AS noindex,
       jsonb_array_length(coalesce(config->'campos', '[]'::jsonb)) AS campos,
       config#>>'{consentimento,versao}' AS versao_consentimento
  FROM public.pages WHERE slug = 'phoebus-prova';
SELECT nome, dominios, tags, ativo FROM public.sites WHERE nome = 'Site de teste da prova';
SELECT name, status, entry_type, entry_config, reentry, allowed_emails
  FROM public.journeys WHERE name LIKE 'Prova RD — %' ORDER BY name;
SELECT name, (html LIKE '%{{LINK_DO_PDF}}%') AS falta_trocar_link_do_pdf
  FROM public.email_templates WHERE name LIKE 'Prova RD — %' ORDER BY name;
SELECT base_url, board_id,
       EXISTS (SELECT 1 FROM public.integration_secrets WHERE name = 'GROWTHHS_API_KEY') AS chave_presente,
       EXISTS (SELECT 1 FROM public.integration_secrets WHERE name = 'PROVA_RD_GROWTHHS_ANTERIOR') AS anterior_guardado
  FROM (SELECT 1) um LEFT JOIN public.growthhs_config ON true;

\echo
\echo '=== Passo 1 e 11: números da página (mesma conta do GET /paginas/numeros, do dia) ==='
WITH v AS (SELECT visitor_id, canal FROM public.visitas
            WHERE page_slug = 'phoebus-prova' AND criado_em >= :HOJE),
     c AS (SELECT coalesce(lc.canal, 'desconhecido') AS canal
             FROM public.lead_conversions lc JOIN public.leads l ON l.id = lc.lead_id
            WHERE l.deleted_at IS NULL AND lc.page_slug = 'phoebus-prova'
              AND lc.converted_at >= :HOJE)
SELECT (SELECT count(*) FROM v) AS visitas,
       (SELECT count(DISTINCT visitor_id) FROM v) AS visitantes,
       (SELECT count(*) FROM c) AS conversoes,
       round((SELECT count(*) FROM c)::numeric
             / nullif((SELECT count(DISTINCT visitor_id) FROM v), 0), 4) AS taxa;
\echo '--- por canal (landing):'
SELECT canal, sum(visitas) AS visitas, sum(visitantes) AS visitantes, sum(conversoes) AS conversoes
  FROM (SELECT canal, count(*) AS visitas, count(DISTINCT visitor_id) AS visitantes, 0 AS conversoes
          FROM public.visitas WHERE page_slug = 'phoebus-prova' AND criado_em >= :HOJE GROUP BY canal
        UNION ALL
        SELECT coalesce(lc.canal, 'desconhecido'), 0, 0, count(*)
          FROM public.lead_conversions lc JOIN public.leads l ON l.id = lc.lead_id
         WHERE l.deleted_at IS NULL AND lc.page_slug = 'phoebus-prova' AND lc.converted_at >= :HOJE
         GROUP BY 1) x
 GROUP BY canal ORDER BY canal;
\echo '--- site de teste, por formulário:'
WITH c AS (SELECT lc.site_id, lc.form_id, coalesce(lc.page_path, '') AS page_path
             FROM public.lead_conversions lc JOIN public.leads l ON l.id = lc.lead_id
            WHERE l.deleted_at IS NULL AND lc.site_id IS NOT NULL AND lc.converted_at >= :HOJE)
SELECT s.nome AS site, c.form_id, c.page_path, count(*) AS conversoes,
       (SELECT count(DISTINCT v.visitor_id) FROM public.visitas v
         WHERE v.site_id = c.site_id AND coalesce(v.path, '') = c.page_path
           AND v.criado_em >= :HOJE) AS visitantes
  FROM c JOIN public.sites s ON s.id = c.site_id
 WHERE s.nome = 'Site de teste da prova'
 GROUP BY s.nome, c.site_id, c.form_id, c.page_path
 ORDER BY c.form_id;

\echo
\echo '=== Passo 2: leads da prova (tags, UTMs, campos extras) ==='
WITH pl AS (:LEADS)
SELECT pl.email, pl.nome, pl.whatsapp, pl.empresa, pl.campos_extras,
       pl.utm_source, pl.utm_medium, pl.utm_campaign, pl.status,
       array(SELECT t.name FROM public.lead_tags lt JOIN public.tags t ON t.id = lt.tag_id
              WHERE lt.lead_id = pl.id ORDER BY t.name) AS tags,
       pl.created_at, pl.deleted_at IS NOT NULL AS excluido
  FROM pl ORDER BY pl.created_at;
\echo '--- consentimentos (texto, versão, IP):'
WITH pl AS (:LEADS)
SELECT pl.email, c.base_legal, c.versao, c.provisoria, c.ip, c.origem_tipo,
       c.page_slug, c.form_id, left(c.texto, 60) AS texto, c.criado_em
  FROM public.lead_consents c JOIN pl ON pl.id = c.lead_id
 ORDER BY c.criado_em;

\echo
\echo '=== Passos 3, 6 e 10: e-mails das jornadas da prova ==='
SELECT l.email, j.name AS jornada, cs.journey_node_id AS no, cs.status, cs.error,
       cs.created_at, cs.sent_at, cs.opened_at, cs.clicked_at
  FROM public.campaign_sends cs
  JOIN public.journey_runs r ON r.id = cs.journey_run_id
  JOIN public.journeys j ON j.id = r.journey_id
  JOIN public.leads l ON l.id = cs.lead_id
 WHERE j.id IN :JORNADAS
 ORDER BY cs.created_at;
\echo '--- runs e passos (skipped = modo teste ou contato excluído):'
SELECT l.email, j.name AS jornada, r.state, r.current_node_id, r.wakeup_at,
       r.context->>'form_id' AS form_id, r.context->>'page_slug' AS page_slug, r.entered_at
  FROM public.journey_runs r
  JOIN public.journeys j ON j.id = r.journey_id
  JOIN public.leads l ON l.id = r.lead_id
 WHERE j.id IN :JORNADAS
 ORDER BY r.entered_at;
SELECT l.email, j.name AS jornada, s.node_id, s.node_type, s.result,
       s.detail->>'motivo' AS motivo, s.occurred_at
  FROM public.journey_step_log s
  JOIN public.journeys j ON j.id = s.journey_id
  LEFT JOIN public.leads l ON l.id = s.lead_id
 WHERE j.id IN :JORNADAS
 ORDER BY s.occurred_at;
\echo '--- passo 10: descadastros da lista:'
SELECT email, reason, source, created_at FROM public.email_suppressions
 WHERE email = ANY :LISTA ORDER BY created_at;

\echo
\echo '=== Passo 4: aviso interno (caixa de saída) ==='
SELECT l.email AS contato, s.destino, s.status, s.tentativas, s.erro,
       s.payload->'enviados' AS enviados, s.payload->'pulados' AS pulados,
       s.payload->>'assunto' AS assunto, s.criado_em, s.enviado_em
  FROM public.journey_saidas s
  LEFT JOIN public.leads l ON l.id = s.lead_id
 WHERE s.journey_id IN :JORNADAS
 ORDER BY s.criado_em;

\echo
\echo '=== Passo 5: card no receptor de teste (GrowthHS: pendente do endpoint) ==='
WITH pl AS (:LEADS)
SELECT pl.email, h.origem, h.status, h.tentativas, h.erro, h.card_id, h.criado_em
  FROM public.crm_handoffs h JOIN pl ON pl.id = h.lead_id
 ORDER BY h.criado_em;
WITH pl AS (:LEADS)
SELECT p.external_id, p.corpo->>'title' AS titulo, p.corpo#>>'{contact,email}' AS email,
       p.corpo->'custom_fields' AS custom_fields, p.corpo#>>'{conversion,page_slug}' AS page_slug,
       p.corpo#>>'{conversion,form_id}' AS form_id, p.corpo#>>'{consent,version}' AS consent_version,
       p.vezes, p.recebido_em
  FROM public.growthhs_receptor_pedidos p
  JOIN pl ON pl.id::text = p.external_id
 ORDER BY p.recebido_em;

\echo
\echo '=== Passos 7 e 8: conversões (landing e site de teste) ==='
WITH pl AS (:LEADS)
SELECT pl.email, lc.converted_at, lc.page_slug, lc.form_id, s.nome AS site,
       lc.page_url, lc.canal, lc.utm_source, lc.utm_campaign
  FROM public.lead_conversions lc
  JOIN pl ON pl.id = lc.lead_id
  LEFT JOIN public.sites s ON s.id = lc.site_id
 ORDER BY lc.converted_at;
\echo '--- passo 8: um lead por e-mail (duplicado = linha aqui):'
WITH pl AS (:LEADS)
SELECT lower(btrim(email)) AS email, count(*) AS leads
  FROM pl WHERE deleted_at IS NULL GROUP BY 1 HAVING count(*) > 1;
WITH pl AS (:LEADS)
SELECT pl.email, count(lc.id) AS conversoes
  FROM pl LEFT JOIN public.lead_conversions lc ON lc.lead_id = pl.id
 GROUP BY pl.email ORDER BY pl.email;

\echo
\echo '=== Passo 9: volta do CRM (estágio e eventos growthhs) ==='
WITH pl AS (:LEADS)
SELECT pl.email, ce.event_type, ce.title, ce.metadata->>'status_atual' AS status_atual,
       ce.metadata->>'source' AS source, ce.occurred_at
  FROM public.contact_events ce JOIN pl ON pl.id = ce.lead_id
 WHERE ce.source_app = 'growthhs'
    OR (ce.event_type = 'contact_updated' AND ce.metadata->>'source' = 'crm')
 ORDER BY ce.occurred_at;
WITH pl AS (:LEADS)
SELECT email, status FROM pl ORDER BY email;

\echo
\echo '=== Passo 12: ANTIMETA — envios do dia para FORA da lista (tem que dar 0 linhas) ==='
-- E-mails (campanha ou jornada) que saíram ou ainda podem sair.
SELECT 'campaign_sends' AS origem, cs.id::text, lower(btrim(l.email)) AS destinatario,
       cs.status, cs.journey_run_id IS NOT NULL AS de_jornada, cs.created_at
  FROM public.campaign_sends cs JOIN public.leads l ON l.id = cs.lead_id
 WHERE cs.created_at >= :HOJE
   AND cs.status NOT IN ('failed', 'suppressed')
   AND NOT (lower(btrim(l.email)) = ANY :LISTA)
UNION ALL
-- Avisos: quem já recebeu (`enviados`) e quem ainda vai receber (pendente).
SELECT 'journey_saidas', s.id::text, d.e, s.status, true, s.criado_em
  FROM public.journey_saidas s
  CROSS JOIN LATERAL (
        SELECT lower(btrim(x)) AS e
          FROM jsonb_array_elements_text(coalesce(s.payload->'enviados', '[]'::jsonb)) x
        UNION
        SELECT lower(btrim(x))
          FROM unnest(string_to_array(s.destino, ',')) x
         WHERE s.status = 'pendente'
           AND NOT (coalesce(s.payload->'pulados', '[]'::jsonb) ? lower(btrim(x)))) d
 WHERE s.tipo = 'aviso_email' AND s.criado_em >= :HOJE
   AND NOT (d.e = ANY :LISTA)
UNION ALL
-- Aviso ou webhook SOBRE um contato fora da lista (o modo teste barra no nó).
SELECT 'journey_saidas (contato)', s.id::text, lower(btrim(l.email)), s.status, true, s.criado_em
  FROM public.journey_saidas s JOIN public.leads l ON l.id = s.lead_id
 WHERE s.criado_em >= :HOJE AND s.status <> 'falhou'
   AND s.journey_id IN :JORNADAS
   AND NOT (lower(btrim(l.email)) = ANY :LISTA)
UNION ALL
-- Card ao GrowthHS de contato fora da lista, pelas jornadas da prova.
SELECT 'crm_handoffs', h.id::text, lower(btrim(l.email)), h.status, true, h.criado_em
  FROM public.crm_handoffs h
  JOIN public.leads l ON l.id = h.lead_id
  JOIN public.journey_runs r ON r.id = h.journey_run_id
 WHERE h.criado_em >= :HOJE AND h.status <> 'falhou'
   AND r.journey_id IN :JORNADAS
   AND NOT (lower(btrim(l.email)) = ANY :LISTA)
 ORDER BY 6;
\echo '--- barrados pelo modo teste no dia (informativo: é a trava funcionando):'
SELECT count(*) FILTER (WHERE s.detail->>'motivo' LIKE 'modo teste%') AS passos_pulados,
       (SELECT count(*) FROM public.campaign_sends
         WHERE created_at >= :HOJE AND error LIKE 'modo teste%') AS envios_barrados_no_worker
  FROM public.journey_step_log s WHERE s.occurred_at >= :HOJE;

\echo
\echo '=== Depois da limpeza (passo 12) ==='
WITH pl AS (:LEADS)
SELECT count(*) FILTER (WHERE deleted_at IS NULL) AS leads_da_prova_ativos,
       count(*) FILTER (WHERE deleted_at IS NOT NULL) AS leads_da_prova_excluidos
  FROM pl;
SELECT name, status,
       (SELECT count(*) FROM public.journey_runs r
         WHERE r.journey_id = j.id AND r.state IN ('active', 'waiting')) AS runs_abertos
  FROM public.journeys j WHERE name LIKE 'Prova RD — %' ORDER BY name;
