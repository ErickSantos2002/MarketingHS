# Frente `nota-do-vendedor` (pergunta 79)

Aberta em 26/10/2026. Spec:
`docs/superpowers/specs/2026-10-26-nota-do-vendedor-design.md`; plano:
`docs/superpowers/plans/2026-10-26-nota-do-vendedor.md`.

## Estado

✅ Pronta para merge (26/10). Branch `worktree-agent-a1cb51a46d2d74640`.
Sem migration. Só backend (`app/crm/entrega.py`, `app/crm/growthhs.py`).

## O que entrou

- **Nota de abertura no card novo** (`growthhs.nota_de_abertura`): cabeçalho
  "Lead enviado pelo MarketingHS (<origem>) em <data>." + o corpo inteiro de
  `montar_descricao` (sem a marca `Pedido MarketingHS` e sem o link) + linha
  `UTMs:` + `Ver no MarketingHS: <ficha>`. O corpo inteiro, não só
  origem/UTMs/consentimento: faixas, score, desafios e respostas livres
  também não têm outro lugar visível lá (seria corte silencioso).
- **`Cliente.anotar` aceita lista de linhas** (`growthhs.conteudo_da_nota`):
  cada item passa por `uma_linha` e eles se juntam com `\n` — a tela de lá
  é `whitespace-pre-wrap`. Quebra só a nossa; a do lead vira espaço (testes
  de forja com `\n`, `\r\n`, `\x0b`, U+2028). `str` continua achatado.
- **`<` vira `‹` em toda nota.** O `NoteRenderer` do GrowthHS renderiza como
  HTML (`dangerouslySetInnerHTML`, sanitizador por regex que não pega
  `onerror=` sem aspas) qualquer nota com `<tag>` — um nome de lead
  `<img src=x onerror=…>` rodaria script na tela do vendedor. Valia já para
  a nota da reconversão. Teto da nota: 20.000.
- **Ordem no card novo:** 2xx do `POST /cards` → `entregue` gravado
  (blindado) → nota de abertura → evento. A nota nunca falha, pausa nem adia
  o pedido: transitório tenta 2× na hora; o resto vai em
  `metadata.erro_da_nota` do `crm_handoff`. 2xx sem id → sem nota,
  `erro_da_nota`.
- **Card reconhecido no retry** (`card_do_pedido`, 201 perdido) agora posta
  a nota de abertura (antes: "nem atualiza nem anota"). Nota repetida é o
  pior caso, raro.
- **Nota da reconversão** (`texto_da_nota`, agora `list[str]`): sem
  "Descrição do card atualizada…"; origem + data; "Informou nesta conversão
  (não verificado):" com "- Rótulo: valor" por linha; link da ficha no fim
  (novo — o card aberto pode ter nascido no RD, sem link).
- A descrição continua igual (engrenagem de idempotência).

## Testes

Postgres local (`marketinghs-teste-nota`, 5443):
- CRM (`test_crm_entrega`, `test_reconversao_dados`, `test_growthhs_cliente`,
  `test_crm_caminhos`, `test_prova_crm`): 205 → 223 passed.
- **Suíte inteira: 1056 passed, 9 skipped** (7 `base_real` + 2 da 032 já
  aplicada).

## Para a coordenadora

- Sem migration, sem `config.py`, sem front. Deploy de api + worker basta.
- Comportamento novo visível em produção: todo card novo ganha uma nota; o
  card recuperado de 201 perdido também.
- **Pedido ao HSGrowth (anotar lá, não é deste repo):** (1) a pergunta 79 já
  lista "mostrar a descrição na tela do card"; (2) o `sanitizeHTML` do
  `NoteRenderer.tsx` é fraco (regex; `onerror=x` sem aspas passa) — qualquer
  nota com HTML de qualquer origem é XSS na tela do card. Do nosso lado o
  `<` já sai neutralizado.

## Perguntas

Nenhuma nova. Suposições registradas na spec (nota com o corpo inteiro da
descrição; link da ficha na nota da reconversão; nota de abertura no card
reconhecido).
