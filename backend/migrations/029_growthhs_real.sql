-- 029 — GrowthHS real: a configuração do contrato novo.
--
-- O contrato da 018 (`POST /api/v1/integration/cards`, X-API-Key) nunca
-- existiu no GrowthHS. O que existe é a API normal dele: client-credentials
-- (client_id + client_secret) -> pessoa -> card. Esta migration troca a
-- configuração para esse desenho.
--
-- • client_id: o identificador do client-credentials. O client_secret NÃO mora
--   aqui — vai em integration_secrets (GROWTHHS_CLIENT_SECRET), como o resto.
-- • list_id: a etapa (lista) de entrada onde o card nasce.
-- • boards_conferidos: os funis onde se procura card aberto da pessoa antes de
--   criar outro (card aberto é atualizado, não duplicado).
--
-- ⚠️ `board_id` FICA. O receptor desligado e o worker de produção (código da
-- main) ainda o leem; tirar a coluna derrubaria a leitura da config.
--
-- Reaplicável: rode duas vezes para provar.

ALTER TABLE public.growthhs_config
    ADD COLUMN IF NOT EXISTS client_id         text,
    ADD COLUMN IF NOT EXISTS list_id           bigint,
    ADD COLUMN IF NOT EXISTS boards_conferidos bigint[] NOT NULL DEFAULT '{}';
