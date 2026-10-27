# Frente `landing-nicholson`

Branch `worktree-agent-a5954b98e66cf89d9` · n 29 · Vite 8109 · backend 8129 ·
Postgres local 5449. Território: linha "Estado em 27/10 (6)" do `README.md`.

Por quê: o Nicholson (CEO) pediu três ajustes na landing do Phoebus.

## Backlog

- [x] 1. Telefones do rodapé como no site oficial
- [x] 2. Player de vídeo fechado
- [x] 3. "Quem já usa" em 4 colunas no desktop
- [x] Conferência visual (375/1280, horizontal e vertical, movimento reduzido),
      portão, revisão

## O que entrou

- **Rodapé** (`casa.ts`, `Landing.tsx`): `4007-1507*` · "Capitais e regiões
  metropolitanas" (`tel:40071507`, sem DDD nem +55) e `(81) 98177-1177`
  (`tel:+5581981771177`), na ordem do site oficial. A nota do asterisco, com
  o texto do site palavra por palavra, vai em letra miúda entre o contato e o
  pé (no desktop, alinhada à direita, debaixo das colunas).
- **Player fechado** (`player.ts` + `Video` no `Secoes.tsx`): a fachada
  continua (nada do YouTube carrega antes do clique — conferido: 0 pedidos
  fora a miniatura). No clique, a IFrame API monta o player youtube-nocookie
  com `controls=0, disablekb=1, fs=0, rel=0, iv_load_policy=3,
  playsinline=1`. O iframe fica numa caixa `inert` + `aria-hidden` +
  `pointer-events: none`, debaixo de um escudo transparente que recebe todo
  clique (vira play/pausa; o botão direito não abre o menu do YouTube).
  Controles nossos embaixo do quadro: voltar 10 s, play/pausa, avançar 10 s,
  barra de tempo (`<input type="range">`, setas/Home/End) e tempo. Pausado,
  carregando ou no fim, a miniatura cobre o iframe. O vídeo para 1,5 s antes
  do fim e volta a fachada com "Assistir de novo".
  - ⚠️ **Por que 1,5 s e não 0,5 s:** o `getDuration()` da API arredonda para
    cima — o sByexR1w9vw a API diz 30 s e o vídeo acaba em 29,00 s. Com meio
    segundo, o player chegava ao `ENDED` (e à grade de recomendações) antes.
    Medido: com 1,5 s, para em 28,7 s e o YouTube nunca entra em
    `ended-mode`.
- **Logos**: 4 colunas a partir de 900 px (`--colunas` = mín(n, 4)), 3 entre
  600 e 899, 2 no celular. Antes, `colunas(14, 6)` dava **2** colunas no
  desktop (o maior divisor de 14 até 6).
- **Casca** (`landing.py`): `<meta name="referrer"
  content="strict-origin-when-cross-origin">` — o embed do YouTube recusa
  tocar sem Referer ("Erro 153"). Não há CSP na casca nem no nginx de
  produção (conferido em 27/10); `test_landing_player.py` cobra que, se uma
  CSP entrar, ela libere `www.youtube.com` (script) e
  `www.youtube-nocookie.com` (frame).

## O que o player NÃO consegue bloquear (limites do YouTube)

- **O "cromo" do YouTube aparece por ~3 s** no começo e a cada retomada:
  título do vídeo, avatar do canal, "Mais vídeos", ícone de link e o logo
  do YouTube. Fica **visível mas não clicável** (o clique cai no escudo e só
  pausa). Com `controls=0` o YouTube não deixa desligar isso; esconder
  exigiria cortar faixas do vídeo.
- **Legendas automáticas** aparecem se o vídeo as tiver ligadas por padrão.
- **O id do vídeo está no HTML** (config embutida, URL do iframe): quem abrir
  o código-fonte chega ao YouTube. Nenhum player embutido evita isso.
- **iPhone (Safari)**: não testado em aparelho. O WebKit pode recusar o
  `playVideo()` que vem da nossa página (o gesto foi fora do iframe). Para
  isso existe o **furo**: se em 2,5 s o vídeo não tocou, o escudo abre um
  quadrado no meio e o toque ali chega ao iframe — onde, com `controls=0`,
  só há o play vermelho do próprio YouTube. No primeiro PLAYING o furo
  fecha e o iframe volta a ser inerte. Conferido no Chrome forçando a
  recusa (print `furo-aberto.png`); no iPhone de verdade, falta olhar.
- **Política do YouTube**: os termos da API pedem para não cobrir o player
  com sobreposições. O escudo transparente e a capa na pausa ficam numa área
  cinzenta.
- A saída de verdade para tudo isso é hospedar o MP4 e tocar num `<video>`
  nosso (ver perguntas).

## Robustez (revisão de código, 27/10)

- Prazo: sem `onReady` em 15 s (ou sem a API em 12 s — o `iframe_api` puxa
  outro script, que bloqueador de anúncio pode barrar), a tela vira "Não
  foi possível carregar o vídeo agora." com "Tentar de novo" (e o foco
  vai para ele). Um `onReady` atrasado depois do erro é ignorado.
- Intenção da pessoa num ref (`querTocar`): clique duplo rápido não se
  perde, e um PLAYING atrasado depois de "pausar" vira `pauseVideo()` em vez
  de tirar a capa.
- Arrastando a barra, `seekTo(t, false)`; ao soltar, `seekTo(t, true)`; o
  relógio não mexe no botão durante o arraste.
- Logos entre 600 e 899 px: 3 colunas ou menos (`--colunas-meio`).

## Roteiro da conferência (Chrome próprio, backend 8129, Postgres 5449)

Páginas `nicholson-h` e `nicholson-v` (config pública da phoebus com
imagens de produção e o vídeo sByexR1w9vw, horizontal e em pé), em 1280 e
375 (uma com movimento reduzido): 0 pedidos ao YouTube antes do clique;
tocou sozinho; foco no play; caixa `inert`; `elementFromPoint` em seis
pontos do quadro (cantos do título, do logo, centro) = escudo; clique no
canto do título pausa; +10 +10 −10 pelo teclado (3→23→13 s); End na barra
para em 28 s; seek a 6 s do fim; play; para em 28,7 s de 29,00 sem
`ended-mode` no player (debaixo da capa: o último quadro, logo da H&S, sem
grade de recomendações); "Assistir de novo" volta ao começo; 0 popups, 0
navegações; sem rolagem horizontal; logos 4 colunas (1280) e 2 (375).
Mais: duplo clique rápido (play/pausa e pausa/play) termina no estado
pedido; autoplay recusado abre o furo e o toque no meio toca.

## Perguntas

1. **Hospedar o vídeo em vez do YouTube?** Um `<video>` com o MP4 servido
   pelo nosso domínio tira o cromo, as legendas, o id, o risco no iPhone e a
   questão de termos de uma vez — custo: banda nossa e um arquivo para subir.
   Assumi: fica no YouTube fechado (pedido como veio).
2. **Tela cheia nossa?** Não pus (o pedido lista só play/pausa/avançar/
   voltar). Uma tela cheia do próprio quadro (com o escudo junto) seria
   segura. Assumi: sem tela cheia.
3. **Ordem dos telefones**: segui o site oficial (4007 primeiro); o pedido
   listou o (81) primeiro. Trocar é uma linha em `casa.ts`.

## Estado

**Pronto para merge.** Revisão de código feita (com correções: prazo,
furo para o Safari, intenção em ref, seek no arraste, foco no erro, logos
no meio). Node 99/99, `tsc` 0, `build:landing` ok, pytest dos arquivos de
landing + captura 96 passed (Postgres local 5449).
