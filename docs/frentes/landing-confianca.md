# Frente `landing-confianca`

Branch `landing-confianca` · n 23 · backend 8123 · Vite 8103. Território:
linha "Estado em 27/10" do `README.md`.

Por quê: a página do Leão (contatos.healthsafety.com.br) ganha da nossa em
confiança — logo no topo, selos, depoimentos com nome, vídeo e rodapé. A
nossa ganha em formulário, oferta e conteúdo. Esta frente fecha a diferença
sem redesenhar o que a `landing-visual` fez (mesma paleta, fonte e regras).

## Estado

- [x] Cabeçalho (logo + WhatsApp), rodapé da casa
- [x] Tipos `certificacoes`, `depoimentos`, `video` — leitura, desenho,
      editor, régua do servidor, testes
- [x] Topo enquadrado para `topo-catraca.jpg` (paisagem 16:9)
- [x] Conferência: landing em 390/768/1024/1440 (três rodadas), página sem
      WhatsApp, página antiga, editor claro/escuro 1440/390
- [x] Portão e revisão de código

## O que entrou

- **Cabeçalho** (`Landing.tsx`, `.cabecalho`): logo horizontal branco à
  esquerda; com `config.whatsapp.numero`, botão "Falar no WhatsApp" à direita
  (o mesmo link de `linkDoWhatsapp` + `urlSegura`). No celular o logo cai
  para 30 px e o botão vira "WhatsApp". Botão contornado, ícone verde: o
  convite principal da dobra continua sendo o formulário azul.
- **WhatsApp flutuante** some (`visibility: hidden`, sai do Tab) enquanto o
  botão do cabeçalho está na tela (`IntersectionObserver`); volta ao rolar.
- **Rodapé** (`Rodape` + `casa.ts`): logo empilhado branco, endereço,
  telefones (`tel:`), Instagram, site, © e a política de privacidade quando
  `config.consentimento.link` existe (por `urlSegura`). Marinho-noite
  (`#05172a`), um passo abaixo da chamada.
- **Só na página rica.** A página antiga (cartão único, sem foto/corpo/seções)
  não ganhou cabeçalho nem rodapé — fica idêntica.
- **`certificacoes`**: `texto?` + `itens {imagem_url, nome}`; selo sem
  imagem sai. Texto à esquerda, selos à direita (136 px; encolhem entre 900
  e ~1300 px para não deixar o terceiro sozinho).
- **`depoimentos`**: `itens {texto, nome, empresa?, cargo?, logo_url?}`;
  sem texto ou sem nome, sai; aspas coladas em volta saem (a página põe as
  tipográficas, penduradas na margem). O primeiro em corpo grande, de ponta
  a ponta; os outros em colunas com fio em cima; nome forte, "cargo,
  empresa" abaixo, logo pequeno depois de um fio (altura pela proporção, a
  mesma conta da seção de logos). Aguenta "Antônio, VIX" sem cargo.
- **`video`**: `url` + `texto?` + `formato?` (`horizontal` | `vertical`).
  `idDoYoutube` (cliente) e `id_do_youtube` (servidor) aceitam só
  youtube.com|www|m `/watch?v=`, `/shorts/`, `/embed/` e youtu.be, http(s),
  sem usuário/porta, id `^[A-Za-z0-9_-]{11}$`. Fachada: miniatura
  `maxresdefault` (cai no `hqdefault` no erro ou no cinza de 120×90 que o
  YouTube devolve com 200), botão de play com `aria-label`; o `<iframe>` de
  `youtube-nocookie.com/embed/<id>?autoplay=1&rel=0` só nasce no clique, e o
  foco vai para ele. Conferido: nenhum host do YouTube carrega antes do
  clique (só a miniatura de i.ytimg.com, e só quando a seção chega perto).
- **Servidor** (`urls.py`): `logo_url` entrou na caminhada (seção e item,
  qualquer tipo) — recusa ao salvar com o caminho, descarta ao servir; a
  `url` do tipo `video` que não é YouTube é recusada ao salvar
  (`secoes.N.url`) e sai ao servir. Vazio passa (o salvamento é automático).
- **Editor**: os três tipos em "Adicionar seção"; selos e logos de
  depoimento com o `CampoDeImagem`; vídeo com aviso de link não aceito e o
  seletor de formato.
- **Topo**: foto nova enquadrada (paisagem). Desktop: recorte em pé do meio
  da foto, dissolvido nos dois lados e no alto; tablet e celular: faixa
  centrada, um pouco mais alta no celular para aproximar a pessoa; título e
  formulário sobem 32 px no desktop (o cabeçalho já dá o respiro).

## Testes

- node: `node --test frontend/scripts/*.test.mjs` → **94 pass** (10 novos em
  `landing-confianca.test.mjs`; `landing-secoes.test.mjs` passou a usar a
  fixture v3 e "carrossel" como tipo desconhecido).
- pytest (Postgres local 5445): `test_landing_confianca.py` (novo, 50 casos
  com os parametrizados) + `test_landing_secoes.py` + `test_prova_numeros.py`
  + `test_prova_captura.py` → **100 passed**.
- `tsc -p frontend/tsconfig.app.json` 0; `guarda:visual` em
  `components/admin/pages` 0; `build:landing` ok.

## Conferência

PNG em `/tmp/claude-1000/-home-ericks-github-MarketingHS/93476dee-9304-4f99-bdad-9221a68acd86/scratchpad/confianca-final/`
(pasta temporária da sessão): `dobra-`, `inteira-`, `fim-`, `video-`,
`depoimentos-`, `certificacoes-`, `rodape-` × 390/768/1024/1440,
`video-tocando-1440.png`, `resumo.json`; `sem-whatsapp/`, `antiga/`,
`editor/`. Sem rolagem lateral em nenhuma largura; nenhuma imagem quebrada.
O único erro de console é o 404 do `/rastreio.js` (no ar quem serve é o
nginx). O player no print aparece preto: o Chrome sem tela e o bloqueio de
POST do script de conferência; o `src` e o foco no iframe foram conferidos.

Config do Phoebus conferida (as 9 seções do 5434 + as 3 novas, foto nova do
topo): `/tmp/claude-1000/-home-ericks-github-MarketingHS/93476dee-9304-4f99-bdad-9221a68acd86/scratchpad/config-phoebus-v3.json`
(e cópia em `frontend/scripts/landing-phoebus.json`, a fixture). Ordem:
números, comparativo, como funciona, **vídeo**, onde instalar, plataforma,
calibração, quem já usa, **depoimentos**, perguntas, **certificações**,
chamada.

## Revisão de código (diff da branch)

Nada crítico (sem XSS, nenhuma URL escapa da régua). Consertado:
- **Vídeo em pé sem texto** ficava com ~1100 px de largura no desktop — a
  largura cheia agora só vale com texto ao lado; sem texto, centrado.
- **Réguas do YouTube divergiam** em `:443`, `https:/` (uma barra), `/../`
  e `?v=&v=ID` (o `URL` do navegador conserta, o servidor não). O cliente
  agora exige o texto cru começando pelo host do YouTube, sem porta nem
  ponto no caminho; o servidor pega o primeiro `v` mesmo vazio. Os quatro
  casos entraram nos testes das duas réguas.
- **Fachada guardava o estado** ao trocar o link — `key` pelo id do vídeo.
- `aria-hidden` saiu do flutuante (o `visibility: hidden` já o tira da
  árvore de acessibilidade e do Tab).
- De fora do diff: `headline`/`subheadline` passavam crus — um objeto pela
  API derrubava a página; agora por `textoDaConfig`.

Ficou: `youtube.com/live/<id>` é recusado nas duas réguas (o brief lista
quatro formas; ampliar é uma linha em cada lado).

## Decisões tomadas

1. **Logo do cabeçalho: o horizontal, recolorido para branco — num arquivo
   derivado, não por `filter`.** O empilhado a 30–40 px de altura deixa
   "Health & Safety" ilegível (letra de ~5 px); o horizontal lê. Mas o "&"
   do original é branco sobre o azul: `brightness(0) invert(1)` pintaria
   tudo de branco e o "&" sumiria ("HS"). O arquivo derivado vaza o "&"
   (fica a cor do fundo, como no empilhado oficial). O empilhado branco
   oficial ficou para o rodapé, onde há altura.
2. **Os logos são data URI dentro do `main.js`, não arquivos com hash.** O
   `vite.landing.config.ts` (fora do meu território) fixa
   `assetFileNames: "main.[ext]"` — dois PNG sairiam `main.png` e
   `main2.png`, sem hash. Os derivados só têm alfa (16 níveis), pesam 3 KB
   cada e ficam abaixo do limite de inline do Vite: sem arquivo a mais, sem
   requisição a mais. Se quiser arquivo com hash, ver "Para a coordenadora".
3. **Vídeo em pé (`formato: "vertical"`)** — não estava no brief. O vídeo do
   Phoebus é vertical: no quadro 16:9 a miniatura vinha com duas tarjas
   borradas e o player teria o mesmo. Em pé, o quadro é 9:16 (300–340 px),
   ao lado do texto. Padrão `horizontal`; reversível.
4. **Cabeçalho e rodapé só na página rica**; a página antiga fica igual.
5. **Depoimento precisa de texto e nome; selo precisa de imagem; vídeo
   precisa de id válido** — o que falta descarta (a regra das outras seções).
6. O logo da empresa no depoimento tem `alt=""`: a empresa já está escrita.
7. A `url` só é lida no tipo `video`; em outro tipo o servidor não a julga.
8. Textos que escrevi para a config (o Erick pode trocar no editor): título
   do vídeo "Veja o Phoebus em ação" + "Identificação, teste e registro em
   menos de 10 segundos, sem ninguém para aplicar."; depoimentos "Na
   palavra de quem usa"; certificações "Qualidade certificada" com os dois
   textos do brief; selos "ISO 9001", "ISO/IEC 27001", "DOT/NHTSA".

## Para a coordenadora

- **CSP:** não há cabeçalho de segurança no backend (`main.py`,
  `middleware/`) nem no `frontend/nginx.conf` — nada barra `i.ytimg.com` ou
  `youtube-nocookie.com`. Se um dia entrar CSP na landing, precisa de
  `img-src https://i.ytimg.com` e `frame-src https://www.youtube-nocookie.com`.
- **Hash dos ativos da landing** (se preferir arquivo a data URI): uma linha
  no `vite.landing.config.ts` — `assetFileNames: (a) =>
  a.name?.endsWith(".css") ? "main.[ext]" : "[name]-[hash][extname]"`.
- **A config do Phoebus não tem `whatsapp` nem `consentimento`.** Sem
  número, o cabeçalho mostra só o logo; sem consentimento, o rodapé não tem
  o link da política. Conferi os dois com uma página de teste (número
  fictício, política em https://www.healthsafety.com.br/politica.cfm, a
  mesma da página do Leão). Ligar na página real é decisão do Erick
  (o consentimento põe a caixa no formulário).
- Imagens da config apontam para `http://127.0.0.1:8131/`: na publicação,
  subir pelo editor (selos, logos de depoimento, foto do topo).
- Sem migration, sem `package.json`, sem `components/ui/`, sem `lib/api*`.
