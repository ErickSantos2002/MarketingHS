-- 032 — GrowthHS: "Negócio perdido" e "No Show" na volta (pergunta 74).
--
-- Spec: docs/superpowers/specs/2026-10-26-growthhs-perdido-design.md.
--
-- • growthhs_config.listas_perdido / listas_no_show: as listas do GrowthHS
--   que provam, DENTRO do corpo assinado do webhook de volta, que o card foi
--   perdido (`?evento=deal_lost`: 27 no board 6, 33 no board 7 — as listas
--   `is_lost_stage`) ou foi para "Reagendamento" (`?evento=no_show`: 25).
--   Mesmo desenho de `listas_reuniao`/`listas_ganho` (029): o `?evento=` da
--   URL não é assinado, quem prova é a lista. O DEFAULT preenche as linhas
--   que já existem (homologação e produção).
-- • lead_statuses: o status novo "Negócio perdido", fim do funil
--   (sort_order 8, depois de "Venda realizada"). A cor gravada segue as da
--   005 (hexadecimal, vermelho); a tela não a usa — pinta por token
--   (`--color-danger-600`, StatusBadge.tsx).
--   ⚠️ `leads.status` é FK para `lead_statuses(name)` (005): sem esta linha,
--   todo "perdido" seria recusado pelo banco. Não há CHECK em `leads.status`
--   (saiu na 005; nenhuma migration o recria).
--
-- ⚠️ Ordem: aplicar ANTES do deploy do código novo (a tela grava as colunas
-- novas). A leitura da config tolera a 032 ausente.
-- Rodar com o dono das tabelas. Reaplicável: rode duas vezes para provar.

ALTER TABLE public.growthhs_config
    ADD COLUMN IF NOT EXISTS listas_perdido bigint[] NOT NULL DEFAULT '{27,33}',
    ADD COLUMN IF NOT EXISTS listas_no_show bigint[] NOT NULL DEFAULT '{25}';

INSERT INTO public.lead_statuses (name, color, sort_order, is_system) VALUES
  ('Negócio perdido', '#ef4444', 8, true)
ON CONFLICT (lower(name)) DO NOTHING;
