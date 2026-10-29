-- 037 — Vídeo hospedado na landing (frente video-proprio, 29/10/2026).
--
-- A landing `phoebus` tocava o vídeo num player "fechado" do YouTube, que
-- ainda mostra ~3 s de título/"Mais vídeos"/logo e não foi provado no
-- iPhone. Agora o editor sobe o MP4 (ou WebM) e a página toca num `<video>`
-- nosso, servido por `GET /publico/video/{id}` com Range (o Safari do iPhone
-- não toca vídeo sem 206).
--
-- Reaplicável: CREATE TABLE / INDEX IF NOT EXISTS, ALTER ... SET STORAGE e
-- GRANT (os dois são idempotentes). Rode duas vezes para provar. Nenhuma
-- extensão. Rodar com o dono das tabelas. ADITIVA: nada existente muda.
--
-- Por que bytea no Postgres (e não volume ou bucket) — a mesma escolha de
-- `email_assets` (014): não exige infraestrutura nova no EasyPanel e o dump
-- do banco leva o vídeo junto. Custo: o dump cresce o tamanho de cada vídeo
-- (teto de 60 MB por arquivo, na rota). São poucos vídeos, de landing.
--
-- ⚠️ `STORAGE EXTERNAL`: fora da linha e SEM compressão. É o que faz o
-- `substring(bytes FROM a FOR n)` da rota ler só os pedaços TOAST daquele
-- trecho; com o padrão (EXTENDED, comprimível), um pedido de 64 KB poderia
-- descomprimir o arquivo inteiro. MP4/WebM já vêm comprimidos — a compressão
-- do Postgres não ganharia nada. Vale para as linhas gravadas DEPOIS do
-- ALTER (a tabela nasce com ele).
--
-- Tabela só de máquina (molde da 036): RLS ligado, nenhuma política, GRANT
-- só ao `service_role` (BYPASSRLS). O upload é `admin_atual` e grava como
-- `service_role`; a leitura é pública por desenho, como a de imagem.

CREATE TABLE IF NOT EXISTS public.landing_videos (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome       text NOT NULL,
    tipo       text NOT NULL CHECK (tipo IN ('video/mp4', 'video/webm')),
    tamanho    integer NOT NULL CHECK (tamanho > 0),
    bytes      bytea NOT NULL,
    criado_por uuid,
    criado_em  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.landing_videos ALTER COLUMN bytes SET STORAGE EXTERNAL;

CREATE INDEX IF NOT EXISTS idx_landing_videos_criado_em
    ON public.landing_videos (criado_em DESC);

ALTER TABLE public.landing_videos ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON public.landing_videos TO service_role;

COMMENT ON TABLE public.landing_videos IS
    'Vídeos das landing pages. Servidos sem autenticação, com Range, por /publico/video/{id}. bytes em STORAGE EXTERNAL para o substring ler só o trecho pedido.';
