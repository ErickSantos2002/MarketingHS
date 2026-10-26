# Nota do vendedor (pergunta 79) — design

26/10/2026 · frente `nota-do-vendedor` · decidido com o Erick (pergunta 79,
não reabrir).

## Problema

A tela do card no GrowthHS (`hsgrowth-sistema/frontend/src/pages/CardDetails.tsx`)
não renderiza `description`. Tudo o que `growthhs.montar_descricao` põe no card
NOVO — empresa, cargo, faixas, lead score, desafios, respostas do formulário,
conversão, consentimento, "Informou nesta conversão", link da ficha — é
invisível ao vendedor. O que ele vê: os campos próprios do card (título,
`origin`, `utm_source`/`utm_campaign`/`utm_term`/`utm_params`, `gclid` — na
`SummarySection`), os da pessoa, e as **notas** (aba Anotações).

## Decisão

O que é para o vendedor vai em NOTA. A descrição continua sendo escrita igual
— é a engrenagem de idempotência (`card_do_pedido`, `bloco_ja_aplicado`) —,
sem enfeite.

### 1. Nota de abertura no card novo

Depois do 2xx do `POST /cards`, `POST /card-notes` com:

```
Lead enviado pelo MarketingHS (<origem>) em dd/mm/aaaa hh:mm.
<as linhas de montar_descricao, sem a marca "Pedido MarketingHS" e sem o link>
UTMs: utm_source=… · utm_medium=… · utm_campaign=… · utm_term=… · utm_content=…
Ver no MarketingHS: <FRONTEND_URL>/contacts?contato=<lead_id>
```

Por que o corpo inteiro da descrição, e não só origem/UTMs/consentimento/link:
faixa de faturamento, funcionários, lead score, etiqueta, desafios e as
respostas livres do formulário também não têm outro lugar visível no
GrowthHS. Levar só uma parte seria o corte silencioso que o portão da
travessia ensinou a procurar (o substituto nascendo menor). Reusar
`montar_descricao` dá à nota as mesmas travas de texto de fora.

**Quebra de linha:** o `CardNoteCreate` de lá é `str` livre (min 1) e o
`NoteRenderer` mostra texto puro em `<p class="whitespace-pre-wrap">` — o
`\n` aparece como linha. `Cliente.anotar` passa a aceitar uma **lista de
linhas**: cada linha passa por `uma_linha` e elas se juntam com `\n`. A única
quebra é a que nós pomos; um `\n` do lead vira espaço (teste dedicado, como o
da descrição). Texto (`str`) continua achatado como antes.

**HTML:** o `NoteRenderer` trata como HTML (`dangerouslySetInnerHTML` com um
sanitizador por regex que não pega `onerror=` sem aspas) qualquer nota com
`<tag>`. Um nome de lead `<img src=x onerror=…>` viraria script na tela do
vendedor. `anotar` troca todo `<` por `‹` (U+2039) — vale para as duas notas.
Nenhum texto nosso usa `<`. (Fica para o HSGrowth: o sanitizador de lá é
fraco para qualquer nota.)

**Teto:** a nota é cortada em `TETO_DA_NOTA = 20_000` caracteres (o mesmo
teto da descrição) — muitos campos extras não podem gerar um POST sem fim.

### 2. Idempotência e falha da nota de abertura

- **Depois do 2xx do card, `entregue` grava primeiro** (blindado, como hoje),
  ANTES da nota. Antes a gravação vinha logo após o 201; com a nota no meio
  (até 2 × 15 s), uma parada do worker deixaria o pedido pendente com o card
  já criado, e o retry dependeria do reconhecimento — que falha se o vendedor
  ganhar/perder o card no intervalo (vira segundo card). Card duplicado é
  pior que nota faltando.
- **A nota nunca falha nem adia o pedido** (o card já existe). Transitório:
  uma segunda tentativa na hora; se falhar de novo, ou se for definitivo
  (inclusive 401/403/404 — pausar re-tentaria um pedido cujo efeito
  principal já aconteceu), `erro_da_nota` vai no evento `crm_handoff`, como
  no caminho de atualizar.
- **2xx sem `id` legível:** não há card para anotar → `erro_da_nota` = "o
  GrowthHS não devolveu o id do card".
- **Card reconhecido no retry (`card_do_pedido`, 201 perdido):** hoje "nem
  atualiza nem anota". Passa a **postar a nota de abertura**. Esse caminho só
  existe quando a tentativa anterior não chegou à nota (201 perdido, ou o
  worker morreu entre o 201 e o `entregue` — janela agora mínima), então a
  nota quase certamente falta. Se, por acaso, ela já tiver saído, é uma nota
  repetida: ruído aceitável; nota faltando é vendedor sem contexto (mesma
  filosofia do comentário do caminho de atualizar). Pedidos antigos
  recuperados também ganham a nota que nunca tiveram. Mesma política de
  falha: `erro_da_nota`, nunca falha o pedido.
- Não se lê a lista de notas do card para checar duplicata: mais uma rota,
  mais um modo de falhar, para evitar um ruído raro.

### 3. Nota da reconversão (`texto_da_nota`)

Sai "Descrição do card atualizada com dados informados no formulário (não
verificados)." — fala de um campo que ninguém vê. Fica:

```
Lead converteu de novo pelo MarketingHS (<origem>) em dd/mm/aaaa hh:mm.
Informou nesta conversão (não verificado):          ← só se houver divergência
- Rótulo: valor
Ver no MarketingHS: <FRONTEND_URL>/contacts?contato=<lead_id>
```

Em linhas, como a de abertura. O link é novo: o card aberto pode ter nascido
no RD ou à mão, sem link nenhum para a ficha — e o bloco da descrição, que o
levava, não aparece. Valor cortado em `MAX_VALOR_NA_NOTA` (200), como hoje.

### 4. A descrição

Intocada (card novo e bloco do card aberto). Continua sendo a marca de
idempotência.

## Fora do escopo

- Mostrar a descrição na tela do card do GrowthHS (pedido opcional ao
  HSGrowth, pergunta 79).
- Sanitizador de HTML das notas no GrowthHS (anotar para o HSGrowth).

## Testes

- `anotar` com lista: linhas juntas por `\n`, `\n`/`\r`/`\x0b` de dentro de
  uma linha viram espaço, `<` vira `‹`, teto.
- `nota_de_abertura`: cabeçalho, corpo sem a marca, UTMs, link; valor do lead
  com quebra não forja linha ("Pedido MarketingHS", "Ver no MarketingHS",
  "Lead score").
- `texto_da_nota`: sem a frase da descrição; linhas; informados; link.
- Entrega: card novo anota (conteúdo); nota 503 duas vezes / 422 → entregue +
  `erro_da_nota`, sem adiar; 503 uma vez → segunda tentativa anota; 2xx sem
  id → sem nota, `erro_da_nota`; reconhecido no retry → anota; `entregue`
  grava antes da nota; lead sem e-mail anota.
