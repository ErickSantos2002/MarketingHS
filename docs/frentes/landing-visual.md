# Frente `landing-visual`

Branch `landing-visual` · n 22 · backend 8122 (lendo o Postgres local 5434
da coordenadora, página `phoebus`). Território: linha "Estado em 26/10 (10)"
do `README.md`.

Por quê: o Erick reprovou a prévia do Phoebus ("dá para fazer melhor") —
visual de template e, numa janela de ~1020 px, a página presa numa coluna
de ~375 px.

## Estado

- [x] Plano de design e revisão contra o brief
- [x] Topo novo + 8 seções redesenhadas (`landing.css` reescrito)
- [x] Fonte Plus Jakarta Sans na casca (`landing.py`)
- [x] Conferência em 375, 390, 768, 1020, 1024, 1100, 1239, 1240, 1280,
      1366 e 1440 (Phoebus) e nas duas páginas antigas — várias rodadas
- [x] Portão: node 84/84, `tsc` 0, `build:landing` ok, pytest da casca e
      das seções 25 passed (Postgres local 5445)

## O bug da coluna de 375 px

Não reproduziu na página: a 1020 px a versão anterior já ocupava a
largura. O mais provável é que o Erick tenha aberto o PNG
`previa-v1-celular.png` (375 px de largura) numa janela de ~1020 px. De
qualquer forma o topo e as seções foram refeitos e conferidos em toda
largura de 375 a 1440 sem rolagem lateral (`resumo.json`, `sw == cw`).

## Plano de design

**Cor** (hex no topo do `landing.css`, a landing é exceção da regra):
marinho `#0c2a44` / `#081e33` (topo e chamada; mesmo matiz do azul de
ação), azul de ação `#1a71a8` (o `COR_CTA_PADRAO`, botões), claro frio
`#edf2f7` (alternância das seções), tinta `#0f1e2e`, apagada `#566676`,
LED verde `#3ad07f` (sobre o marinho) / `#12804a` (sobre claro) e LED
vermelho `#c9302c`, celeste `#7cc4ef` só para marcador sobre o marinho.

**Tipo:** Plus Jakarta Sans 400–800. Título do topo 800, 34→58 px,
entrelinha 1,04, `-0.03em`; h2 800, 28→44 px; corpo 16–17 px / 1,6.
Carregada por `<link>` + `preconnect` na casca (e não `@import` no CSS:
o `@import` só é descoberto depois que o `main.css` baixa).

**Layout:**

```
desktop ≥1240                          tablet 768–1239          celular
[marinho ─────────────────────────]    [   foto à dir., some ]  [foto faixa]
 Título        foto     ┌form─┐         Título    ┌form─┐       Título
 subtítulo   (dissolve) │     │         sub       │     │       sub
 — fatos                │     │         fatos     │     │       fatos
[─────────────────── ]  │     │        [──────]   │     │      ┌form──┐
 23 mi | 165 mil | 770+ └─────┘         números   └─────┘      └──────┘
                                                                números
```

Seções alinhadas à esquerda, alternando claro frio e branco; a chamada
final no marinho.

**Princípios:** a foto do sopro é o elemento memorável e o resto é
quieto; verde/vermelho só onde querem dizer aprovado/reprovado; raio com
hierarquia (cartão 18, foto 14, botão 10, campo 8); uma sombra só (o
cartão que desce da borda); a única animação é o ícone das perguntas.

## O que mudou do brief na revisão (e por quê)

1. **Foto do topo não sangra na largura toda no desktop.** O arquivo tem
   648×648: esticado a 1440 px fica 2,2× ampliado (borrado), e o cartão
   do formulário à direita cobriria a boca e o aparelho. No desktop ela
   sangra em cima e embaixo, perto do tamanho natural, entre o texto e o
   formulário, dissolvida no marinho dos dois lados (máscara). No tablet
   fica à direita da faixa do alto; o título sobe para a parte dissolvida.
2. **Breakpoint do topo em três zonas: 1240 px.** A 1100 o texto caía para
   ~250 px de largura. Abaixo de 1240 vale o desenho do tablet.
3. **A faixa de números entra no topo** (quando é a primeira seção e não
   tem título): fica na faixa branca ao lado do formulário que desce,
   em vez de abrir uma seção só para ela. Com título ou em outra posição,
   é uma seção normal com o mesmo desenho de faixa.
4. **Passo final:** o marcador tem a borda metade verde, metade vermelha
   (as duas saídas da decisão). Fundo dividido parecia bandeira.
5. **Logos:** altura pela proporção do arquivo (raiz quadrada, 34–76 px)
   em vez de altura fixa — com altura fixa o CCR (quadrado) sumia ao lado
   da Mineração Caraíba (4:1). `mix-blend-mode: multiply` apaga o fundo
   branco dos JPG/PNG sem mexer na cor.
6. **Botão da chamada branco** (texto marinho), não azul: azul de ação
   sobre o marinho fica abaixo de 3:1.
7. Halo de sombra no texto do botão do formulário só quando a página tem
   `cta_color` própria (antes valia sempre e sujava o azul padrão).

## Arquivos

- `frontend/src/landing/landing.css` — reescrito.
- `frontend/src/landing/Landing.tsx` — topo novo (`header.topo`: fundo,
  foto, texto, `#formulario`, números); página sem imagem, corpo e seções
  continua no cartão único (`.hero`), mesmo DOM.
- `frontend/src/landing/Secoes.tsx` — `Numeros` exportado; cartões com
  foto até 4 por linha (`cartoes-com-foto`); chamada em dois blocos
  (texto | ação); altura de logo pela proporção.
- `backend/app/routers/landing.py` — `FONTE` na casca.

## Decisões

- Foto do topo com `alt=""` (antes era o próprio h1, que o leitor de tela
  repetia).
- Página com corpo ou imagem mas sem seções também usa o topo novo; o
  resto da janela fica no claro frio (`landing-sem-secoes`).
- Mudou o DOM da página "completa" (`landing-grade`, `landing-cartao`,
  `landing-topo`, `landing-completa` saíram); nenhum teste dependia.

## Pendências (fora do meu território ou do código)

- **Foto do topo maior** (≥ 1600 px de largura) deixaria o topo nítido em
  tela retina; a atual é 648 px.
- **Logos com sobra:** `rumo.png` e `intercement.png` são quadrados com a
  marca pequena no meio; recortados ficariam do tamanho dos outros.
- **Foto do Phoebus Pro** (`instalacao-veiculos-pro.jpg`) mostra o rosto do
  motorista, não o braço mecânico que a legenda descreve.
- Subtítulo e corpo do topo repetem "30 dias, sem custo" — texto, não
  visual; fica para o Erick.
- PNG finais: `/tmp/claude-1000/-home-ericks-github-MarketingHS/93476dee-9304-4f99-bdad-9221a68acd86/scratchpad/visual-final/`
  (pasta temporária da sessão).
