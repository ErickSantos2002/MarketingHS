-- Limpa as 2 campanhas "teste de webhook" presas em 'sending' desde 02/09.
-- (Pergunta 7 do CONTINUAR-AQUI; frente backend, 01/10/2026.)
--
-- O ERICK RODA, no Konsole, com o superusuário do container:
--
--   set -a; . ~/marketinghs.env; set +a
--   PGPASSWORD="$POSTGRES_PASSWORD" psql \
--     "postgresql://${POSTGRES_USER}@${POSTGRES_HOST_EXTERNO}:${POSTGRES_PORTA_EXTERNA}/${POSTGRES_DB}" \
--     -v ON_ERROR_STOP=1 -f backend/scripts/2026-10-01-limpar-campanhas-teste-webhook.sql
--
-- O que são: RESÍDUO DA FIXTURE `envio` de backend/tests/conftest.py, não
-- campanha de verdade. A fixture cria a campanha 'teste de webhook' em
-- 'sending' com UM envio já 'sent' e resend_email_id = 're_abc', e COMITA (o
-- webhook passa pelo app, que usa a própria conexão). O teardown desfaz — mas
-- duas rodadas do pytest morreram no meio em 02/09 (13:05 e 14:09 UTC). O
-- contato de teste ('a@b.c') foi apagado pela pré-limpeza da rodada seguinte
-- (por isso lead_id é NULL nos envios); a campanha, não, porque a pré-limpeza
-- só cobre o lead. Nunca passaram pelo enfileirador nem pelo worker.
--
-- Por que não "fechar como enviada": seria registrar no histórico 2 campanhas
-- com 1 envio cada que nunca existiram. Apagar é o certo. O
-- `guard_campaign_delete` recusa apagar em 'sending', então passa por
-- 'failed' antes — o mesmo caminho do teardown da fixture. campaign_sends sai
-- por ON DELETE CASCADE; email_events (0 linhas hoje) ficaria com SET NULL.
--
-- Tolera reaplicação: na segunda vez não acha nada e apaga 0.

BEGIN;

-- Conferência: tem de listar exatamente as 2 (ou 0, se já rodou).
SELECT c.id, c.name, c.status, c.created_at,
       count(cs.id) AS envios,
       count(cs.id) FILTER (WHERE cs.lead_id IS NULL AND cs.resend_email_id = 're_abc') AS da_fixture
  FROM campaigns c
  LEFT JOIN campaign_sends cs ON cs.campaign_id = c.id
 WHERE c.id IN ('f61daee7-26a3-4a5a-97cc-f5fcac8d851d',
                '377c2328-e649-4ea6-a980-2acc48976cb7')
 GROUP BY c.id;

-- A trava: só mexe se a campanha ainda é a da fixture (nome, status, e TODOS
-- os envios com a assinatura dela). Se alguém tiver reaproveitado o id, nada
-- acontece.
CREATE TEMP TABLE alvo ON COMMIT DROP AS
SELECT c.id
  FROM campaigns c
 WHERE c.id IN ('f61daee7-26a3-4a5a-97cc-f5fcac8d851d',
                '377c2328-e649-4ea6-a980-2acc48976cb7')
   AND c.name = 'teste de webhook'
   AND c.status = 'sending'
   AND NOT EXISTS (SELECT 1 FROM campaign_sends cs
                    WHERE cs.campaign_id = c.id
                      AND (cs.lead_id IS NOT NULL OR cs.resend_email_id IS DISTINCT FROM 're_abc'))
   AND NOT EXISTS (SELECT 1 FROM email_send_queue q WHERE q.campaign_id = c.id);

UPDATE campaigns SET status = 'failed' WHERE id IN (SELECT id FROM alvo);
DELETE FROM campaigns WHERE id IN (SELECT id FROM alvo);

-- Tem de dar 0.
SELECT count(*) AS ainda_em_sending FROM campaigns WHERE status = 'sending';

COMMIT;
