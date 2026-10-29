# Frente `video-proprio` (29/10/2026)

n 35 · Vite 8115 · backend local 8135 (só para a conferência) · Postgres
local 5455 (`marketinghs-teste-35`). Branch `video-proprio`. Pedido do Erick:
o player "fechado" do YouTube ainda mostra ~3 s de título/"Mais vídeos"/logo
e não foi provado no iPhone — hospedar o MP4 no nosso domínio e tocar num
`<video>` nosso (pergunta 1 de `landing-nicholson.md`). Nada em produção.

## Estado

| Item | Estado | Commit |
|---|---|---|
| 1 Upload pelo editor (MP4/WebM, admin, 60 MB, bytes conferidos) | feito | `dc7b7c4`, `65cedec` |
| 2 Armazenamento: bytea `STORAGE EXTERNAL` (migration 037) | feito | `dc7b7c4` |
| 3 `GET/HEAD /publico/video/{id}` com Range (200/206/416/304) | feito | `dc7b7c4` |
| 4 Player `<video>` na landing, mesmos controles + tela cheia | feito | `65cedec` |
| 5 Teste com o MP4 real (Postgres local) | feito | — |
| Registro no `main.py` + balde próprio + nginx 64M (fora do território) | feito, **coordenadora decide** | `478b61f` |

## Como ficou

**Config da seção `video`** (nada some; página antiga não muda):
- `arquivo_url` (novo) = `/publico/video/<uuid>` — o que o upload devolve.
  A régua do cliente (`secoes.ts::idDoVideoHospedado`) aceita SÓ esse
  caminho com uuid e monta o endereço a partir do id (como o id do YouTube).
- `imagem_url` = a capa (poster). Já passa pela caminhada de imagens do
  servidor (`urls.py`), sem mudança lá.
- `url` (YouTube) continua. **Com arquivo, o arquivo vence**; tirou o
  arquivo, volta o YouTube (o link fica guardado).

**Backend** (`app/routers/videos.py`, novo):
- `POST /videos` — `admin_atual` (comum e `leitura` levam 403; sem token,
  401). Tipo declarado em `video/mp4`, `video/webm`,
  `application/octet-stream` ou vazio; **quem decide são os bytes**: `ftyp`
  nos bytes 4–8 (MP4) ou EBML `1A45DFA3` + DocType `webm` nos 64 primeiros
  (Matroska puro e HTML/PNG com tipo de vídeo são recusados). O tipo
  gravado é o dos bytes. Teto 60 MB (lê limite+1 e para).
- `GET`/`HEAD /publico/video/{id}` — público. `Accept-Ranges: bytes`;
  `Range: bytes=a-b`, `a-` e `-n` → `206` + `Content-Range`; fim além do
  arquivo é cortado; começo no fim/depois, `b<a`, sintaxe ruim e vários
  trechos → `416` com `Content-Range: bytes */N`. `ETag` = id, `If-None-Match`
  → `304`; `Cache-Control: public, max-age=31536000, immutable`; `nosniff`.
  O corpo sai em pedaços de 1 MB (`substring(bytes FROM a FOR n)`), cada um
  numa sessão curta — nem o banco nem o processo carregam o arquivo todo
  para servir um trecho, e nenhuma conexão do pool fica presa a um celular
  lento.

**Landing** (`Secoes.tsx::VideoHospedado`): `<video playsinline
preload="metadata" poster>` sem `controls` e sem autoplay; a fachada é o
mesmo botão de play por cima da capa. Depois do clique, os controles do
player fechado (mesmas classes: barra, ±10 s, play/pausa, tempo) + **tela
cheia** — o palco inteiro (quadro + controles) onde o navegador deixa; no
iPhone, `webkitEnterFullscreen` (a do sistema). Clique no quadro =
play/pausa; botão direito sem menu; fim → "Assistir de novo"; erro de
carga → "Não foi possível carregar o vídeo agora." + "Tentar de novo".
`prefers-reduced-motion`: o anel de carregando já para (regra existente).
CSS novo no `landing.css` só com `var(--marinho-fundo)`.

**Editor** (`EditoresDeSecao.tsx::CampoDeVideo`): "Subir vídeo" (XHR com
porcentagem), recusa >60 MB antes de subir, prévia com `<video controls>`,
"Trocar vídeo"/"Tirar"; com arquivo aparece "Capa do vídeo (opcional)"
(o `CampoDeImagem` de sempre) e o rótulo do YouTube diz que não é usado.

## Decisões

1. **Armazenamento: bytea no Postgres**, tabela própria `landing_videos`
   (não `email_assets`: lá a rota de imagem serviria o vídeo). Mesma razão
   da 014: sem infraestrutura nova no EasyPanel e o dump leva o vídeo junto.
   A coluna é `STORAGE EXTERNAL` (fora da linha, sem compressão): é o que
   faz o `substring` ler só os pedaços TOAST do trecho (conferido:
   `pg_column_compression` nulo, `pg_column_size` = tamanho). Custo: o dump
   cresce o tamanho de cada vídeo. Se um dia forem muitos, vira volume ou
   armazenamento de objeto — a rota não muda de forma.
2. **Limite 60 MB.** Vídeo de produto de 1–3 min em 1080p H.264 cabe.
3. **nginx** (`frontend/nginx.conf`, arquivo do sistema): o `server` tem
   `client_max_body_size 20M` — o upload morreria em 413 no nginx. Subi
   para 64M **só** em `location = /api/videos`; o resto continua em 20M.
   `nginx -t` ok (container `nginx:alpine`). Precisa de rebuild do serviço
   `sistema` no deploy.
4. **Limite de taxa** (`main.py`, fora do território): `/publico/video/`
   isento do balde comum (30/min, o mesmo do `/publico/captura`) e com balde
   próprio de 600/min (`videos.LIMITE_POR_MINUTO`, sem chave nova em
   `Settings`). Sem isso, quem assiste (o Safari pede dezenas de trechos)
   levaria 429 ao mandar o formulário. Commit separado (`478b61f`) para a
   coordenadora poder decidir sem mexer no resto.

## Testes

- `backend/tests/test_videos.py` (40 casos): migration reaplicável e com
  `STORAGE EXTERNAL`; `intervalo()` (7 válidos, 9 inválidos); upload MP4,
  WebM, tipo pelos bytes, 5 recusas, vazio, teto (413), 403 comum, 403
  `leitura`, 401; 200 com cabeçalhos, 200 em vários pedaços, 206 (sonda
  `0-1`, `a-`, `a-b`, `-n`), 416 (3 formas), HEAD 200/206 sem corpo, 304,
  404 de id ruim; o balde próprio e a isenção no `main.py`.
- `frontend/scripts/landing-video.test.mjs` (7): régua do caminho, arquivo
  vence YouTube, arquivo ruim cai no YouTube, capa insegura sai, página só
  YouTube igual, seção nova vazia não aparece, `alvoNoArquivo`.

## Conferência (Chrome próprio, Postgres local 5455)

Script descartável no scratchpad (não usei o `conferir-telas.mjs`: a conta do
Claude não existe no banco local). Admin descartável no container (apagado
depois), backend 8135 com `JWT_SECRET` descartável, Vite 8115. MP4 real
(`VID-COM-010 - Phoebus Pro`, 4,4 MB, H.264 848×480 com rotação, 28,4 s)
subido pelo backend local; capa = um quadro do próprio vídeo (ffmpeg).
Páginas `video-35` (config da phoebus + arquivo + capa) e `video-35-so`.

- **curl pelo proxy do Vite** (`/api/publico/video/<id>`): 200 com 4.585.427
  bytes **idênticos** ao arquivo (`cmp`); `0-1` → 206 `bytes 0-1/4585427`;
  `4585000-` → 206 de 427; `-100` → 206 dos últimos 100; `1000000-1999999`
  idêntico ao trecho do arquivo; `4585427-` → 416 `bytes */4585427`; HEAD
  200 com `Content-Length` e `video/mp4`.
- **Landing 1440 e 390**: `<video>` com poster, `preload=metadata`,
  `playsinline`, sem autoplay, sem `controls`, **0 iframes**, nenhum pedido
  ao YouTube. Clique no play: **tocou** (`currentTime` 2,39 → 3,40 s em 1 s;
  `paused=false`; duração 28,4), foco no "Pausar". O Chrome pediu
  `bytes=0-`, `bytes=294912-`, `bytes=4489216-` — **todas 206**. +10 s →
  13,9 s; pausa; End na barra + play → `ended`, "Assistir de novo". Sem
  rolagem lateral, sem erro de página.
- **Editor claro/escuro, 1440/390** (`/pages/video-35-so/edit`, seção
  Vídeo aberta): upload do MP4 pela tela (`setInputFiles`) → "Vídeo
  subido.", prévia do vídeo, salvamento automático (`PATCH /api/paginas/…`
  local). Sem rolagem lateral, sem erro. Escritas bloqueadas fora do upload
  e do salvamento (só caiu o `POST /api/ia/conversas` do layout e o `POST
  /publico/site/visita` da landing).
- PNG: `/tmp/claude-1000/-home-ericks-github-MarketingHS/d0ad6f20-2d2e-46a0-a353-191b2ad332b2/scratchpad/conferencia/`
  (`landing-{antes,tocando,pausado,fim}-{1440,390}.png`,
  `editor-{claro,escuro}-{1440,390}.png`, `editor-claro-1440-subido.png`,
  `resumo.json`) — pasta temporária da sessão.
- **iPhone de verdade: não conferido** (não há aparelho aqui). O que o
  Safari exige está provado no servidor (sonda `0-1` → 206, `Content-Range`,
  `Accept-Ranges`, HEAD) e o `<video>` tem `playsinline`.

## Portão (Postgres local 5455, 29/10)

pytest **1407 passed, 0 failed, 9 skipped** (7 `base_real` + 2 da 032);
`tsc` 0 erros (app e raiz); `node --test scripts/landing-*.test.mjs`
77/77; `npm run build` e `npm run build:landing` ok; `guarda:visual` em
`components/admin/pages` 0. Uma rodada intermediária deu 4 falhas em
`test_agendamento_execucao.py` (alerta contado 2×): causa era o admin
descartável da conferência, que virou um segundo destinatário do alerta —
apagado o admin, 37/37 no arquivo e a suíte inteira verde.

## Migration em produção (NÃO aplicada — a coordenadora roda)

```bash
set -a; . ~/marketinghs.env; set +a
PGPASSWORD="$POSTGRES_PASSWORD" psql \
  "postgresql://${POSTGRES_USER}@${POSTGRES_HOST_EXTERNO}:${POSTGRES_PORTA_EXTERNA}/${POSTGRES_DB}" \
  -v ON_ERROR_STOP=1 -f backend/migrations/037_videos_da_landing.sql
```

Aditiva e reaplicável (rodada duas vezes no local: a segunda só dá NOTICE de
"already exists"). O código novo só lê `landing_videos` quando alguém sobe
vídeo; antes da 037, o upload dá 500 e nada mais muda.

## Depois do deploy: trocar o vídeo da phoebus (passo a passo do Erick)

1. Coordenadora: migration 037 em produção (acima) e deploy de **api** e
   **sistema** (o nginx mudou).
2. No admin: **Páginas → phoebus → Editar → Seções da página → Vídeo**.
3. **Subir vídeo** → escolher `VID-COM-010 - Phoebus Pro - C3 - Rev 01.mp4`
   → esperar a porcentagem e "Vídeo subido." (aparece a prévia).
4. (Opcional) **Capa do vídeo → Subir imagem** — um quadro do vídeo ou a
   foto do produto. Sem capa, o Chrome mostra o primeiro quadro; o iPhone
   fica escuro até o play.
5. O formato fica "Em pé (celular, Shorts)" (é o da phoebus). O salvamento
   é automático; abrir a landing, dar play — **e conferir no iPhone**.
6. Para voltar ao YouTube: **Tirar** no vídeo (o link continua lá).

## Para a coordenadora (fora do território)

- **`main.py`** (`478b61f`): `include_router(videos_router)`, `/publico/video/`
  nos `isentos` do balde comum e um balde próprio (600/min). Ver decisão 4.
- **`frontend/nginx.conf`** (`478b61f`): `location = /api/videos` com 64M.
- **Régua do servidor para `arquivo_url`** (`app/captura/urls.py`): hoje só
  o cliente julga (aceita só `/publico/video/<uuid>`). Segunda linha
  sugerida, no molde de `_videos_ruins`: recusar ao salvar
  (`secoes.N.arquivo_url`) e descartar ao servir o que não casar com
  `^/publico/video/<uuid>$`.
- **`SecoesEditor.tsx` linha 22**: a descrição do tipo ainda diz "Vídeo do
  YouTube, que só carrega quando a pessoa clica." — sugerido "Vídeo subido
  aqui ou do YouTube; só carrega quando a pessoa clica."
- ⚠️ **Achado, a conferir**: `/publico/imagem/` também está no balde comum
  de 30/min (o mesmo do `/publico/captura`), e a página da phoebus carrega
  dezenas de imagens por ali (logos, selos, fotos). Numa primeira visita
  sem cache, a pessoa pode gastar a cota antes de mandar o formulário.
  Não medi em produção; se confirmar, o mesmo remédio do vídeo serve.
- Sem rota para apagar vídeo: trocar no editor deixa o anterior no banco
  (e no dump). Se pesar, uma `DELETE /videos/{id}` (admin) ou faxina dos
  que nenhuma página referencia.

## Perguntas

1. **Codec.** O servidor confere que é MP4/WebM, não que é H.264: um MP4
   em HEVC (iPhone grava assim) sobe e não toca no Chrome/Firefox. Assumi:
   aviso no editor ("MP4 (H.264, o padrão de exportação)"); conferir o
   codec exigiria ler a caixa `moov`, que pode estar no fim do arquivo.
2. **Capa para o YouTube também?** Hoje `imagem_url` só vale com arquivo.
   Assumi: não (o YouTube tem miniatura própria).
