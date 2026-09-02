-- 014: as imagens do editor de e-mail.
--
-- ⚠️ O editor subia imagem para `supabase.storage`, bucket `email-assets`. Não
-- há Supabase — ou seja, TODO upload de imagem no editor falha hoje, e a tela
-- só diz "Erro ao fazer upload da imagem".
--
-- ⚠️ A imagem precisa de URL PÚBLICA. Ela vai dentro de um e-mail que chega na
-- caixa de outra pessoa, e o cliente de e-mail busca a imagem de fora, sem
-- sessão. Por isso a rota de leitura não é autenticada.
--
-- Guardar no Postgres (e não em volume ou bucket) é decisão consciente: não
-- exige infraestrutura nova, e o backup do banco leva as imagens junto. Imagem
-- de e-mail é pequena e são poucas. ⚠️ Se um dia forem muitas, isto vira
-- migração para armazenamento de objeto — está registrado no ROADMAP.

CREATE TABLE IF NOT EXISTS public.email_assets (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome       text NOT NULL,
    tipo       text NOT NULL,
    bytes      bytea NOT NULL,
    tamanho    integer NOT NULL,
    pasta      text NOT NULL DEFAULT 'campaigns',
    criado_por uuid,
    criado_em  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_assets_criado_em
    ON public.email_assets (criado_em DESC);

GRANT SELECT, INSERT, DELETE ON public.email_assets TO service_role;

COMMENT ON TABLE public.email_assets IS
    'Imagens do editor de e-mail. Servidas sem autenticação por /publico/imagem/{id} — o cliente de e-mail de quem recebe precisa buscá-las.';
