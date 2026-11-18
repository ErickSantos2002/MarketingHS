-- 038 — Aviso de lead por e-mail (frente aviso-de-lead, 18/11/2026).
--
-- Spec: docs/superpowers/specs/2026-11-18-aviso-de-lead-design.md.
-- Plano: docs/superpowers/plans/ (aviso-de-lead), Task 1.
--
-- Reaplicável: CREATE TABLE / INDEX IF NOT EXISTS, GRANT. Rode duas vezes para
-- provar. Nenhuma extensão. Rodar com o dono das tabelas. ADITIVA: o código de
-- hoje não lê nada daqui.
--
-- Os três índices únicos que impedem e-mail duplicado (CLAUDE.md, "Banco") NÃO
-- são tocados — nem citados por nome.
--
-- O que faz: `avisos_de_lead`, a fila do e-mail que avisa o comercial de que
-- uma conversão aconteceu. Uma linha por conversão (`conversao_id` único: a
-- captura reenviada nunca avisa duas vezes). O worker espera `visivel_em`
-- (60 s depois da captura, para o enriquecimento e o agendamento terminarem)
-- e então envia; `enviados` guarda os destinatários já atendidos, para o
-- reenvio de uma falha parcial não repetir e-mail a quem já recebeu.

CREATE TABLE IF NOT EXISTS public.avisos_de_lead (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversao_id  uuid NOT NULL UNIQUE REFERENCES public.lead_conversions(id) ON DELETE CASCADE,
    lead_id       uuid NOT NULL,
    status        text NOT NULL DEFAULT 'pendente'
                  CHECK (status IN ('pendente', 'enviado', 'falhou')),
    contato_novo  boolean NOT NULL DEFAULT true,
    agendamento   boolean NOT NULL DEFAULT false,
    tentativas    integer NOT NULL DEFAULT 0,
    visivel_em    timestamptz NOT NULL DEFAULT now(),
    enviados      text[] NOT NULL DEFAULT '{}',
    erro          text,
    resend_id     text,
    enviado_em    timestamptz,
    criado_em     timestamptz NOT NULL DEFAULT now(),
    atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_avisos_de_lead_pendentes
    ON public.avisos_de_lead (visivel_em)
    WHERE status = 'pendente';

-- Tabela só de máquina (molde 036): RLS ligado, nenhuma política, GRANT só ao
-- `service_role` (que tem BYPASSRLS).
ALTER TABLE public.avisos_de_lead ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.avisos_de_lead TO service_role;
