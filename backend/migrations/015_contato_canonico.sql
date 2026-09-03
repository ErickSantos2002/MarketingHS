-- 015: o elo identidade→contato para de arrebentar.
--
-- `ecosystem_identities.dndash_lead_id` NÃO é cópia redundante do vínculo. Ele
-- é QUAL dos contatos é o canônico da identidade — e isso importa porque N
-- contatos por identidade é permitido DE PROPÓSITO:
--
--   * escrita_contatos.py:284 (caso 3 do fundir_contatos) liga um segundo
--     contato à mesma identidade sem apagar ninguém, e comenta que faz isso
--     porque `leads.dnia_id` não tem índice único;
--   * merge_identities faz `UPDATE leads SET dnia_id = p_keep`, juntando dois
--     contatos sob uma identidade só.
--
-- Por isso NÃO se cria UNIQUE em leads.dnia_id: quebraria os dois caminhos.
--
-- O campo já foi esquecido DUAS VEZES por escritores diferentes: pela
-- importação do lote 1A (consertada pela migration 007) e pela sincronização do
-- DataCore do lote 5B (2.080 identidades, conferido em 03/09/2026). Um backfill
-- que precisa ser repetido a cada lote não é conserto — daí o gatilho.

-- ── 1. Backfill ──────────────────────────────────────────────────────────────
-- Determinístico: `dnia_id` é PK de ecosystem_identities e nenhum lead repete
-- dnia_id (conferido em 03/09/2026). Mesmo UPDATE da migration 007.
UPDATE public.ecosystem_identities ei
   SET dndash_lead_id = l.id
  FROM public.leads l
 WHERE l.dnia_id = ei.dnia_id
   AND ei.dndash_lead_id IS NULL;

-- ── 2. A FK que faltava ──────────────────────────────────────────────────────
-- Sem ela, apagar um contato deixa a identidade apontando para um id morto, e a
-- API pública devolve vazio ou 500 conforme o caminho. Zero pendurados hoje.
--
-- ⚠️ ON DELETE SET NULL, não RESTRICT: RESTRICT impediria apagar contato pela
-- tela, que é função do lote 1C.
ALTER TABLE public.ecosystem_identities
    DROP CONSTRAINT IF EXISTS ecosystem_identities_dndash_lead_id_fkey;
ALTER TABLE public.ecosystem_identities
    ADD CONSTRAINT ecosystem_identities_dndash_lead_id_fkey
    FOREIGN KEY (dndash_lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;

-- ── 3. A eleição do canônico ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.eleger_contato_canonico() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- O canônico morreu. Se sobrou outro contato na mesma identidade, ele
    -- assume; senão o campo fica nulo, que é o estado honesto.
    --
    -- ⚠️ O `WHERE` aceita as DUAS ordens possíveis de gatilho de propósito. A
    -- ação ON DELETE SET NULL é um gatilho interno em `leads` chamado
    -- RI_ConstraintTrigger_a_<oid>, e gatilhos AFTER do mesmo evento disparam
    -- em ordem alfabética de nome: `RI_` (0x52) vem antes de `trg_` (0x74), ou
    -- seja, o campo já chega nulo aqui. Depender dessa ordem seria frágil.
    IF OLD.dnia_id IS NOT NULL THEN
      UPDATE ecosystem_identities e
         SET dndash_lead_id = (
               SELECT l.id FROM leads l
                WHERE l.dnia_id = e.dnia_id AND l.id <> OLD.id
                ORDER BY l.created_at, l.id
                LIMIT 1)
       WHERE e.dnia_id = OLD.dnia_id
         AND (e.dndash_lead_id IS NULL OR e.dndash_lead_id = OLD.id);
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE que TIROU o lead de uma identidade: se ele era o canônico de lá, a
  -- origem fica apontando para um contato que já não é dela — e a ficha 360°
  -- daquela identidade passa a mostrar a pessoa errada.
  --
  -- ⚠️ Não aparece dentro de `merge_identities` porque lá a origem é apagada
  -- logo depois. Mas o caminho existe fora dela, e um UPDATE manual em
  -- `leads.dnia_id` é exatamente o que o caso 3 do fundir_contatos faz.
  IF TG_OP = 'UPDATE' AND OLD.dnia_id IS NOT NULL
     AND OLD.dnia_id IS DISTINCT FROM NEW.dnia_id THEN
    UPDATE ecosystem_identities e
       SET dndash_lead_id = (
             SELECT l.id FROM leads l
              WHERE l.dnia_id = e.dnia_id
              ORDER BY l.created_at, l.id
              LIMIT 1)
     WHERE e.dnia_id = OLD.dnia_id
       AND e.dndash_lead_id = NEW.id;
  END IF;

  -- INSERT, ou UPDATE que mudou o dnia_id (é o que merge_identities dispara).
  --
  -- ⚠️ A guarda `dndash_lead_id IS NULL` é o ponto. Sem ela, o caso 3 do
  -- fundir_contatos roubaria o canônico para o contato recém-vinculado, e a
  -- ficha 360° passaria a mostrar o contato errado — em silêncio.
  IF NEW.dnia_id IS NOT NULL THEN
    UPDATE ecosystem_identities
       SET dndash_lead_id = NEW.id
     WHERE dnia_id = NEW.dnia_id
       AND dndash_lead_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.eleger_contato_canonico() IS
    'Mantém ecosystem_identities.dndash_lead_id apontando para um contato vivo. '
    'Ver migrations 007 e 015.';

DROP TRIGGER IF EXISTS trg_leads_contato_canonico ON public.leads;
CREATE TRIGGER trg_leads_contato_canonico
    AFTER INSERT OR DELETE OR UPDATE OF dnia_id ON public.leads
    FOR EACH ROW EXECUTE FUNCTION public.eleger_contato_canonico();

COMMENT ON COLUMN public.ecosystem_identities.dndash_lead_id IS
    'O contato CANÔNICO da identidade — não uma cópia do vínculo. Uma '
    'identidade pode ter vários contatos (ver escrita_contatos.py caso 3 e '
    'merge_identities); este campo diz qual deles a visão 360° mostra. '
    'Mantido pelo gatilho trg_leads_contato_canonico.';
