# Frente `landing-secoes`

Spec: `docs/superpowers/specs/2026-10-26-landing-secoes-design.md`.
Plano: `docs/superpowers/plans/2026-10-26-landing-secoes.md`.
n 21 · Vite 8101 · backend 8121 · Postgres local 5445
(`bash scripts/banco-teste-local.sh marketinghs-teste-21 5445`).
Branch `landing-secoes`. Território: linha de 26/10 (9) do `README.md`.

## Estado

- [x] Plano escrito
- [x] Execução (3 commits de feature + 1 da revisão)
- [x] Conferência no navegador (landing e editor, no Postgres local)
- [x] Portão (testes, `tsc`, guarda, build da landing)

## O que entrou

- `frontend/src/landing/secoes.ts` — tipos, limites (20 seções, 30 itens,
  12 linhas, 6 números), `secoesDaConfig(config, origem, base)` (leitura
  defensiva: descarta e segue) e `secaoVazia(tipo, id)` para o editor.
- `enderecoDaImagem(url, base)` saiu do `Landing.tsx` e do
  `PageConfigEditor.tsx` para `campos.ts` (um lugar só).
- `frontend/src/landing/Secoes.tsx` + CSS em `landing.css` — os 8 tipos.
  Botão da `chamada` é âncora `#formulario` (o cartão do formulário ganhou
  o id) que rola e foca o primeiro campo de verdade (nunca a isca).
- `backend/app/captura/urls.py` — caminhada de `secoes`: `imagem_url` de
  seção e de item (qualquer tipo) recusado ao salvar com o caminho
  (`secoes.3.itens.0.imagem_url`) e descartado ao servir; ao servir também
  sai seção de tipo desconhecido e corta-se nos limites.
- Editor: `SecoesEditor.tsx`, `EditoresDeSecao.tsx`, `CampoDeImagem.tsx`
  (o upload do topo passou a usar o mesmo componente).
- Fixture do Phoebus: `frontend/scripts/landing-phoebus.json` (9 seções,
  os 8 tipos), usada pelo teste node e na conferência.

## Testes

- node: `node --test frontend/scripts/*.test.mjs` → **84 pass** (15 novos
  em `landing-secoes.test.mjs`; os da landing eram 20 + 1 skip, o skip era
  o bundle não construído).
- pytest (Postgres local 5445): `tests/test_landing_secoes.py` (9, novo) +
  `tests/test_prova_captura.py` (vizinho da régua) → **35 passed**
  (10 + 25).
- `tsc` 0 (`-p frontend` e `-p frontend/tsconfig.app.json`), guarda 0 em
  `components/admin/pages`, `build:landing` e `build` ok.

## Conferência

PNG em `/tmp/claude-1000/-home-ericks-github-MarketingHS/93476dee-9304-4f99-bdad-9221a68acd86/scratchpad/conferencia-final/`
(pasta temporária da sessão)
(landing `p_phoebus_teste_previa_1-{light,dark}-{1440,390,375}.png`; editor
`editor-{claro,escuro}-{1440,390}.png`; `resumo.json`, `resumo-editor.json`).
Sem rolagem horizontal em nenhuma largura; botão da chamada rola e foca
`campo-nome`; página antiga (sem seções) idêntica.

⚠️ Não usei o `conferir-telas.mjs`: ele loga com a conta do Claude, que não
existe no banco local (e mandaria a credencial real para um backend local).
Em vez dele, dois scripts descartáveis no scratchpad, no mesmo molde (Chrome
próprio, só GET para a API): a landing é anônima; o editor logou com o admin
semeado pelo `banco-teste-local.sh`, com e-mail e senha de teste postos só
no container local. Nenhuma credencial real lida.

## Revisão de código (diff da branch)

Consertado:
- **500 na landing** com `tipo` de seção lista/objeto (`TypeError` no
  `frozenset`) — `urls.py` confere `str` antes; teste novo.
- **Upload de imagem gravava a lista de seções velha** (o `onChange` da
  renderização do clique, segundos depois) — `CampoDeImagem` chama o
  `onChange` mais recente por ref.
- Régua de URL do editor alinhada à do servidor (espaço comum aceito; host
  obrigatório) e o toast do erro de salvar agora mostra o detalhe do 400
  (com o caminho `secoes.N...`).
- `overflow-wrap: anywhere` nas seções (palavra longa não rola a página).
- Chave do editor sem repetição com `id` duplicado vindo da API.

Ficou como está (anotado): o corte de limites do servidor é sobre a lista
crua, o do cliente conta os aceitos — só diverge em config vinda pela API;
`id="formulario"` novo no topo das páginas sem seções (sem efeito visual);
mover/remover um item DURANTE o upload da imagem dele pode pôr a imagem no
item vizinho (itens não têm id próprio).

## Decisões tomadas

1. **Landing sem tema escuro.** A landing pública nunca teve escuro e a spec
   proíbe paleta nova; os PNG "dark" mostram a página clara (esperado).
2. **Logo sem imagem aparece com o nome em texto** (ladrilho neutro). O
   Phoebus tem a lista de clientes e ainda não tem os arquivos; sem nome e
   sem imagem, o logo sai. Reversível: é uma linha em `secoes.ts`.
3. **Seção sem conteúdo não aparece** (ex.: recém-criada, número sem valor,
   pergunta sem resposta). Seção vazia parece página quebrada.
4. **Comparativo sem rótulos de coluna** usa "Hoje" / "Com a Health & Safety";
   **chamada sem botão** usa o `cta_text` da página e depois "Quero falar com
   um especialista" (o mesmo padrão do formulário).
5. **Limites no servidor só ao servir** (corta), não ao salvar: recusar ao
   salvar exigiria mexer em `routers/paginas.py`, fora do território. O
   editor já não deixa passar dos limites.
6. **Grade sem órfão:** cartões e logos escolhem no desktop o número de
   colunas que divide a quantidade (4 cartões = 2×2, 8 logos = 4×2).
7. Execução inline pela própria frente (ela já é subagente da
   coordenadora), com revisão de código do diff no fim.

## Perguntas

Nenhuma que pare o trabalho.

## Para a coordenadora

- **Recusa de limites ao salvar**: se quiser 400 também para mais de 20
  seções / 30 itens vindos pela chave de API, é uma checagem em
  `routers/paginas.py::recusar_urls_inseguras` (fora do meu território).
- **Conferência do editor com a conta do Claude**: feita só no banco local
  com admin de teste; se quiser o `conferir-telas.mjs` oficial, rodar em
  `/pages/<slug>/edit` no Homo depois do deploy.
- Imagens do Phoebus (foto do topo, logos dos clientes) ainda não existem;
  a página nasce com os nomes em texto.
- Sem migration, sem `package.json`, sem `components/ui/`, sem `lib/api*`.
