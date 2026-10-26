-- 033 — Contato de origem DataCore nunca vira pedido de entrega ao comercial
-- (pergunta 80, Erick, 26/10/2026).
--
-- A COORDENADORA/O ERICK APLICA (não se aplica sozinha; ver CLAUDE.md,
-- "Migration nova se aplica sozinha"). Reaplicável: CREATE OR REPLACE
-- FUNCTION + DROP TRIGGER IF EXISTS antes do CREATE TRIGGER. Rode duas vezes.
--
-- Decisão: nada que veio do DataCore (ERP Tiny, a base de clientes) vai ao
-- CRM; só vai o que veio de landing, formulário de site ou import manual. A
-- sincronização saiu da tela e da API e os contatos `source = 'datacore'` são
-- apagados por script à parte. Isto é a SEGUNDA linha.
--
-- Por que no banco: dos caminhos que criam pedido em `crm_handoffs`, a regra
-- de automação é gatilho (`evaluate_automation_on_etiqueta`, 019/020/023) e
-- não passa pela aplicação. O botão e o nó de jornada já recusam em
-- `app/crm/entrega.py` (`enfileirar`), com a mensagem; a entrega também
-- recusa o pedido que já estava na fila.
--
-- Por que um gatilho NA FILA e não uma linha a mais na função de regra:
-- aquela função tem 220 linhas e já foi recriada três vezes (019, 020, 023);
-- recriá-la por uma condição é o risco de regressão. O gatilho aqui é pequeno
-- e pega TODO caminho de escrita na fila, inclusive um que ainda não existe.
--
-- ⚠️ Silencioso de propósito (RETURN NULL descarta a linha, sem erro): um
-- RAISE aqui abortaria o UPDATE do lead que disparou a regra. O barulho fica
-- na aplicação — 409 no botão, passo `skipped` no nó, falha na linha do tempo
-- na entrega. `INSERT ... RETURNING id` devolve nada, como o pendente
-- absorvido.
--
-- Comparação sem caixa e sem espaço: a mesma de `entrega.origem_recusada`.

CREATE OR REPLACE FUNCTION public.fn_crm_handoff_recusa_origem() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.leads
              WHERE id = NEW.lead_id
                AND lower(btrim(coalesce(source, ''))) = 'datacore') THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_crm_handoff_recusa_origem() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_crm_handoff_recusa_origem ON public.crm_handoffs;
CREATE TRIGGER trg_crm_handoff_recusa_origem
    BEFORE INSERT ON public.crm_handoffs
    FOR EACH ROW EXECUTE FUNCTION public.fn_crm_handoff_recusa_origem();
