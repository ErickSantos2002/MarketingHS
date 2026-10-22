-- Semente da prova de substituição do RD (Tarefa 18, 22/10/2026).
--
-- O ERICK RODA, pelo `~/marketinghs-prova-rd.sh semear <dominio> <emails>`.
-- Nenhum agente roda isto no banco de produção.
--
-- Variáveis (psql -v), nunca fixas aqui:
--   emails   — a lista do modo teste, separada por vírgula ('a@x,b@y'; aceita
--              também '{a@x,b@y}'). Obrigatória, 1 a 50 endereços.
--   dominio  — o domínio da página de teste (serviço estático de `prova-site/`),
--              sem esquema nem caminho. Obrigatório. Não pode ser o do sistema.
--   aviso    — opcional: quem recebe o aviso ao comercial. Padrão: o 1º da
--              lista. Tem de estar na lista (com o modo teste ligado o aviso
--              só vai para e-mails da lista — e a rota recusaria o contrário).
--   whatsapp — opcional: número do botão de WhatsApp da landing, só dígitos,
--              com DDI (ex.: 5531999999999). Vazio = página sem o botão.
--
-- O que cria (tudo marcado como da prova):
--   - a página `phoebus-prova` (landing, ativa, config completa do contrato);
--   - o site "Site de teste da prova" (domínio da página de teste, tag prova-rd);
--   - 4 templates curtos: Boas-vindas, Nutrição 1, Nutrição 2, Ficha técnica
--     (com o marcador {{LINK_DO_PDF}}, que o Erick troca depois do upload);
--   - 3 jornadas ATIVAS em MODO TESTE, só por `form_submitted` filtrado pela
--     página/formulário da prova — nenhuma por segmento.
--
-- Reaplicável: rodar de novo devolve página, site e jornadas ao estado da
-- semente (inclusive depois da limpeza: reativa tudo) e troca a lista do modo
-- teste pela nova. NUNCA troca o token do site (o link da página de teste
-- continua valendo) e NUNCA reescreve um template que já existe (o link do PDF
-- que o Erick pôs na Ficha técnica fica). Tudo numa transação: ou entra
-- inteiro, ou nada.

\set ON_ERROR_STOP on

\if :{?emails}
\else
  \echo 'falta -v emails=a@x,b@y'
  \quit 3
\endif
\if :{?dominio}
\else
  \echo 'falta -v dominio=teste.exemplo.com'
  \quit 3
\endif
\if :{?aviso}
\else
  \set aviso ''
\endif
\if :{?whatsapp}
\else
  \set whatsapp ''
\endif

BEGIN;

-- 0. Parâmetros, normalizados e conferidos -----------------------------------
CREATE TEMP TABLE prova_param ON COMMIT DROP AS
SELECT
  (SELECT array_agg(DISTINCT e ORDER BY e)
     FROM (SELECT lower(btrim(x)) AS e
             FROM unnest(string_to_array(translate(:'emails', '{}', ''), ',')) x) s
    WHERE e <> '') AS emails,
  regexp_replace(regexp_replace(lower(btrim(:'dominio')), '^[a-z][a-z0-9+.-]*://', ''),
                 '/.*$', '') AS dominio,
  nullif(lower(btrim(:'aviso')), '') AS aviso_bruto,
  nullif(regexp_replace(:'whatsapp', '[^0-9]', '', 'g'), '') AS whatsapp,
  -- A ordem original da lista: o aviso padrão é o PRIMEIRO que o Erick digitou.
  (SELECT lower(btrim(x))
     FROM unnest(string_to_array(translate(:'emails', '{}', ''), ',')) WITH ORDINALITY u(x, n)
    WHERE btrim(x) <> '' ORDER BY n LIMIT 1) AS primeiro;

DO $$
DECLARE
  p prova_param;
  v_ruim text;
BEGIN
  SELECT * INTO p FROM prova_param;
  IF p.emails IS NULL OR cardinality(p.emails) = 0 THEN
    RAISE EXCEPTION 'lista de e-mails vazia';
  END IF;
  IF cardinality(p.emails) > 50 THEN
    RAISE EXCEPTION 'a lista do modo teste aceita no máximo 50 e-mails (veio %)', cardinality(p.emails);
  END IF;
  SELECT string_agg(e, ', ') INTO v_ruim FROM unnest(p.emails) e
   WHERE e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
  IF v_ruim IS NOT NULL THEN
    RAISE EXCEPTION 'não parece e-mail: %', v_ruim;
  END IF;
  IF p.dominio !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[0-9]{1,5})?$' THEN
    RAISE EXCEPTION 'domínio inválido: %', p.dominio;
  END IF;
  -- A página de teste é OUTRA origem por definição; e o README de prova-site/
  -- proíbe servi-la do mesmo serviço do admin (o script do RD rodaria ao lado
  -- da sessão do admin).
  IF p.dominio = 'marketinghs.healthsafetytech.com'
     OR p.dominio LIKE '%.marketinghs.healthsafetytech.com' THEN
    RAISE EXCEPTION 'o domínio da página de teste não pode ser o do sistema';
  END IF;
  IF coalesce(p.aviso_bruto, p.primeiro) <> ALL (p.emails) THEN
    RAISE EXCEPTION 'o aviso (%) precisa estar na lista do modo teste', p.aviso_bruto;
  END IF;
  IF p.whatsapp IS NOT NULL AND length(p.whatsapp) NOT BETWEEN 12 AND 13 THEN
    RAISE EXCEPTION 'whatsapp: só dígitos com DDI, ex.: 5531999999999 (veio %)', p.whatsapp;
  END IF;
END $$;


-- 1. A página phoebus-prova ---------------------------------------------------
-- Config pelo contrato do plano (`pages.config`). Imagem: opcional, fica de
-- fora — o Erick sobe pelo editor se quiser.
INSERT INTO public.pages AS pg
       (name, slug, component_name, page_type, status, description,
        meta_title, meta_description, config)
SELECT 'Prova RD — Phoebus', 'phoebus-prova', 'phoebus-prova', 'landing', 'active',
       'Landing da prova de substituição do RD (Tarefa 18). Só para e-mails nossos; sai na limpeza.',
       'Bafômetro Phoebus — Health & Safety',
       'Peça uma cotação do bafômetro Phoebus para a sua empresa.',
       jsonb_strip_nulls(jsonb_build_object(
         'headline', 'Bafômetro Phoebus para a sua empresa',
         'subheadline', 'Testagem de álcool rápida e confiável. Peça uma cotação e um especialista fala com você.',
         'cta_text', 'Quero uma cotação',
         'campos', jsonb_build_array(
           jsonb_build_object('chave', 'nome', 'rotulo', 'Nome', 'tipo', 'texto', 'obrigatorio', true),
           jsonb_build_object('chave', 'email', 'rotulo', 'E-mail', 'tipo', 'email', 'obrigatorio', true),
           jsonb_build_object('chave', 'whatsapp', 'rotulo', 'Celular', 'tipo', 'telefone', 'obrigatorio', true),
           jsonb_build_object('chave', 'empresa', 'rotulo', 'Empresa', 'tipo', 'texto', 'obrigatorio', true),
           jsonb_build_object('chave', 'ja_faz_testagem', 'rotulo', 'Já faz testagem na sua empresa?',
                              'tipo', 'sim_nao', 'obrigatorio', false)),
         'corpo', E'O Phoebus é o bafômetro da Health & Safety para quem precisa testar equipes com segurança e registro.\n\n- Resultado em segundos\n- Uso simples no dia a dia da operação\n- Suporte e calibração com a Health & Safety\n\nPreencha o formulário e receba a cotação.',
         'mensagem_obrigado', 'Recebemos o seu pedido. Um especialista da Health & Safety vai falar com você em breve.',
         'consentimento', jsonb_build_object(
           'texto', 'Li e aceito a política de privacidade da Health & Safety e autorizo o contato sobre a minha cotação.',
           'link', 'https://www.healthsafety.com.br/privacidade.cfm',
           'versao', 'provisoria-2026-10',
           'provisoria', true,
           'obrigatorio', true),
         'whatsapp', CASE WHEN p.whatsapp IS NULL THEN NULL
                          ELSE jsonb_build_object('numero', p.whatsapp,
                                 'mensagem', 'Olá! Quero saber mais sobre o bafômetro Phoebus.') END,
         'noindex', true,
         'tags', jsonb_build_array('prova-rd')))
  FROM prova_param p
ON CONFLICT (slug) DO UPDATE
   SET name = EXCLUDED.name,
       component_name = EXCLUDED.component_name,
       page_type = 'landing',
       status = 'active',
       description = EXCLUDED.description,
       meta_title = EXCLUDED.meta_title,
       meta_description = EXCLUDED.meta_description,
       config = EXCLUDED.config,
       updated_at = now();


-- 2. O site de teste ----------------------------------------------------------
-- Achado pelo nome + tag (a tabela não tem nome único). Token `pub_` + 32
-- caracteres, como o `_novo_token` da rota (o `rastreio.py` exige o formato
-- exato); criado UMA vez e nunca trocado aqui. Mapa vazio = o padrão do site
-- da H&S (pnome/pemail/pwhatsapp/pmensagem/passunto).
UPDATE public.sites s
   SET dominios = ARRAY[p.dominio], tags = ARRAY['prova-rd'], mapa_campos = '{}'::jsonb,
       ativo = true, atualizado_em = now()
  FROM prova_param p
 WHERE s.nome = 'Site de teste da prova' AND s.tags @> ARRAY['prova-rd'];

INSERT INTO public.sites (nome, dominios, token, mapa_campos, tags, ativo)
SELECT 'Site de teste da prova', ARRAY[p.dominio],
       'pub_' || replace(gen_random_uuid()::text, '-', ''),
       '{}'::jsonb, ARRAY['prova-rd'], true
  FROM prova_param p
 WHERE NOT EXISTS (SELECT 1 FROM public.sites
                    WHERE nome = 'Site de teste da prova' AND tags @> ARRAY['prova-rd']);


-- 3. Os 4 templates -----------------------------------------------------------
-- Só cria o que falta (pelo nome). HTML de e-mail: cor literal é a exceção da
-- casa. {{nome}} e {{unsubscribe_url}} são as merge tags do worker; o rodapé
-- já traz o descadastro (o worker não injeta um segundo).
INSERT INTO public.email_templates (name, description, category, html)
SELECT t.nome, t.descricao, 'prova-rd',
       '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937">'
       || '<p style="font-size:13px;color:#1a71a8;font-weight:bold;margin:0 0 16px">HEALTH &amp; SAFETY</p>'
       || t.corpo
       || '<p style="font-size:12px;color:#6b7280;margin-top:24px">Health &amp; Safety · '
       || '<a href="{{unsubscribe_url}}" style="color:#6b7280">Não quero mais receber estes e-mails</a></p></div>'
  FROM (VALUES
    ('Prova RD — Boas-vindas',
     'Prova do RD: 1º e-mail da jornada de boas-vindas.',
     '<h2 style="color:#1a71a8">Olá, {{nome}}!</h2>'
     || '<p>Recebemos o seu pedido de cotação do bafômetro Phoebus. Um especialista vai falar com você em breve.</p>'
     || '<p>Enquanto isso, nos próximos dias vamos mandar dois e-mails curtos sobre testagem de álcool nas empresas.</p>'),
    ('Prova RD — Nutrição 1',
     'Prova do RD: 2º e-mail (nutrição).',
     '<h2 style="color:#1a71a8">Por que testar a equipe?</h2>'
     || '<p>{{nome}}, a testagem de álcool reduz acidentes e protege quem trabalha e quem responde pela operação.</p>'
     || '<p>No próximo e-mail: como colocar a testagem na rotina sem travar o turno.</p>'),
    ('Prova RD — Nutrição 2',
     'Prova do RD: 3º e-mail (nutrição).',
     '<h2 style="color:#1a71a8">Testagem na rotina</h2>'
     || '<p>{{nome}}, com o Phoebus o teste leva segundos e o resultado fica registrado.</p>'
     || '<p>Quer conversar sobre a sua operação? É só responder este e-mail.</p>'),
    ('Prova RD — Ficha técnica',
     'Prova do RD: e-mail da ficha técnica. TROQUE {{LINK_DO_PDF}} pelo link do PDF (Templates → Arquivos).',
     '<h2 style="color:#1a71a8">A ficha técnica do Phoebus</h2>'
     || '<p>Olá, {{nome}}. Aqui está a ficha técnica que você pediu:</p>'
     || '<p><a href="{{LINK_DO_PDF}}" style="background:#1a71a8;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Abrir a ficha técnica (PDF)</a></p>')
  ) AS t(nome, descricao, corpo)
 WHERE NOT EXISTS (SELECT 1 FROM public.email_templates e WHERE e.name = t.nome);


-- 4. As 3 jornadas ------------------------------------------------------------
-- Todas: entrada por evento `form_submitted` FILTRADO (página e/ou formulário
-- da prova), modo teste com a lista, ativas. Nenhuma por segmento — a
-- antimeta nº 1 do plano.
CREATE TEMP TABLE prova_jornadas ON COMMIT DROP AS
SELECT j.nome, j.descricao, j.entry_config, j.reentry, j.cooldown, j.entry_node_id, j.nodes
  FROM prova_param p,
  LATERAL (SELECT id FROM public.email_templates WHERE name = 'Prova RD — Boas-vindas' ORDER BY created_at LIMIT 1) t_bv,
  LATERAL (SELECT id FROM public.email_templates WHERE name = 'Prova RD — Nutrição 1'  ORDER BY created_at LIMIT 1) t_n1,
  LATERAL (SELECT id FROM public.email_templates WHERE name = 'Prova RD — Nutrição 2'  ORDER BY created_at LIMIT 1) t_n2,
  LATERAL (SELECT id FROM public.email_templates WHERE name = 'Prova RD — Ficha técnica' ORDER BY created_at LIMIT 1) t_ft,
  LATERAL (VALUES
    -- 4a. Boas-vindas + nutrição: landing OU o form de cotação do site de
    --     teste. `once`: o mesmo contato não recebe a sequência duas vezes.
    ('Prova RD — Boas-vindas e nutrição',
     'Prova do RD: e-mail de boas-vindas e duas nutrições, 10 min entre elas.',
     jsonb_build_object('event_type', 'form_submitted', 'page_slug', 'phoebus-prova',
                        'form_ids', jsonb_build_array('prova_cap_phoebus')),
     'once', 168, 'bv',
     jsonb_build_array(
       jsonb_build_object('id', 'bv', 'type', 'send_email', 'next', 'espera1',
         'config', jsonb_build_object('template_id', t_bv.id::text,
                                      'subject', 'Recebemos o seu pedido, {{nome}}')),
       jsonb_build_object('id', 'espera1', 'type', 'delay', 'next', 'n1',
         'config', jsonb_build_object('minutes', 10)),
       jsonb_build_object('id', 'n1', 'type', 'send_email', 'next', 'espera2',
         'config', jsonb_build_object('template_id', t_n1.id::text,
                                      'subject', 'Por que testar a equipe?')),
       jsonb_build_object('id', 'espera2', 'type', 'delay', 'next', 'n2',
         'config', jsonb_build_object('minutes', 10)),
       jsonb_build_object('id', 'n2', 'type', 'send_email', 'next', NULL,
         'config', jsonb_build_object('template_id', t_n2.id::text,
                                      'subject', 'Testagem na rotina')))),
    -- 4b. Ficha técnica: o segundo formulário da página de teste.
    ('Prova RD — Ficha técnica',
     'Prova do RD: e-mail com o link do PDF da ficha técnica.',
     jsonb_build_object('event_type', 'form_submitted',
                        'form_ids', jsonb_build_array('prova_ficha_phoebus')),
     'allowed', 1, 'ficha',
     jsonb_build_array(
       jsonb_build_object('id', 'ficha', 'type', 'send_email', 'next', NULL,
         'config', jsonb_build_object('template_id', t_ft.id::text,
                                      'subject', 'A ficha técnica do Phoebus')))),
    -- 4c. Aviso ao comercial: as mesmas conversões. Aviso interno para
    --     `aviso` (que está na lista) e o card ao GrowthHS — que na prova é o
    --     receptor de teste (`receptor.sql`).
    ('Prova RD — Aviso ao comercial',
     'Prova do RD: aviso interno por e-mail e card no GrowthHS (receptor de teste na prova).',
     jsonb_build_object('event_type', 'form_submitted', 'page_slug', 'phoebus-prova',
                        'form_ids', jsonb_build_array('prova_cap_phoebus', 'prova_ficha_phoebus')),
     'allowed', 1, 'aviso',
     jsonb_build_array(
       jsonb_build_object('id', 'aviso', 'type', 'notify_email', 'next', 'crm',
         'config', jsonb_build_object('emails', jsonb_build_array(coalesce(p.aviso_bruto, p.primeiro)),
                                      'assunto', '[Prova RD] Lead novo do Phoebus')),
       jsonb_build_object('id', 'crm', 'type', 'handoff_growthhs', 'next', NULL,
         'config', '{}'::jsonb)))
  ) AS j(nome, descricao, entry_config, reentry, cooldown, entry_node_id, nodes);

UPDATE public.journeys jr
   SET description = j.descricao,
       entry_type = 'event',
       entry_config = j.entry_config,
       reentry = j.reentry,
       reentry_cooldown_hours = j.cooldown,
       entry_node_id = j.entry_node_id,
       nodes = j.nodes,
       allowed_emails = p.emails,
       status = 'active',
       updated_at = now()
  FROM prova_jornadas j, prova_param p
 WHERE jr.name = j.nome;

INSERT INTO public.journeys
       (name, description, status, entry_type, entry_config, reentry,
        reentry_cooldown_hours, entry_node_id, nodes, allowed_emails)
SELECT j.nome, j.descricao, 'active', 'event', j.entry_config, j.reentry,
       j.cooldown, j.entry_node_id, j.nodes, p.emails
  FROM prova_jornadas j, prova_param p
 WHERE NOT EXISTS (SELECT 1 FROM public.journeys jr WHERE jr.name = j.nome);


-- 5. Conferência antes do COMMIT ----------------------------------------------
DO $$
DECLARE
  v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.journeys
   WHERE name LIKE 'Prova RD — %' AND status = 'active' AND entry_type = 'event'
     AND entry_config->>'event_type' = 'form_submitted'
     AND allowed_emails IS NOT NULL AND cardinality(allowed_emails) > 0
     AND (coalesce(entry_config->>'page_slug', '') <> ''
          OR jsonb_array_length(coalesce(entry_config->'form_ids', '[]'::jsonb)) > 0);
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'esperava 3 jornadas da prova ativas, filtradas e em modo teste; achei %', v_n;
  END IF;
  -- Templates com conteúdo: o nó de e-mail sem template viraria `failed`.
  SELECT count(*) INTO v_n FROM public.journeys j,
         jsonb_array_elements(j.nodes) n
   WHERE j.name LIKE 'Prova RD — %' AND n->>'type' = 'send_email'
     AND NOT EXISTS (SELECT 1 FROM public.email_templates t
                      WHERE t.id::text = n#>>'{config,template_id}'
                        AND coalesce(btrim(t.html), '') <> '');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% nó(s) de e-mail sem template com conteúdo', v_n;
  END IF;
END $$;

COMMIT;

-- 6. O que o Erick precisa ver ------------------------------------------------
\echo
\echo '==> página, site e jornadas da prova:'
SELECT slug, status, config->'tags' AS tags, config->>'noindex' AS noindex FROM public.pages WHERE slug = 'phoebus-prova';
SELECT name, status, entry_config, reentry, allowed_emails FROM public.journeys WHERE name LIKE 'Prova RD — %' ORDER BY name;
SELECT name, (html LIKE '%{{LINK_DO_PDF}}%') AS falta_link_do_pdf FROM public.email_templates WHERE name LIKE 'Prova RD — %' ORDER BY name;
\echo '==> o site (token e link da página de teste):'
SELECT nome, dominios, ativo, token,
       'https://' || dominios[1] || '/site-teste.html?token=' || token AS link_da_pagina_de_teste
  FROM public.sites WHERE nome = 'Site de teste da prova' AND tags @> ARRAY['prova-rd'];
