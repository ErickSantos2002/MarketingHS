# Landing com seções — plano (26/10/2026)

> Spec: `docs/superpowers/specs/2026-10-26-landing-secoes-design.md` (a autoridade).
> Frente `landing-secoes` (n 21 · Vite 8101 · backend 8121 · Postgres local 5445).
> Execução inline pela própria frente (ela já é o subagente da coordenadora),
> TDD tarefa a tarefa, revisão de código do diff da branch no fim.

**Objetivo:** a landing pública ganha `config.secoes` (8 tipos) depois do
topo de hoje, com leitura defensiva, régua de URL no servidor e editor no
admin. Sem migration, sem vídeo.

**Base medida antes de começar (53b81af):** `tsc` 0 erros (`-p frontend` e
`-p frontend/tsconfig.app.json`), guarda 0 em `components/admin/pages`, testes
node da landing 20 pass + 1 skip.

## Tarefa 1 — `secoesDaConfig` (lógica pura, node)

Arquivos: `frontend/src/landing/secoes.ts` (novo), `frontend/src/landing/campos.ts`
(ganha `enderecoDaImagem`), `frontend/scripts/landing-secoes.test.mjs` (novo),
`frontend/scripts/landing-phoebus.json` (fixture, o texto v1 do Phoebus em 8 seções).

1. Teste primeiro (`landing-secoes.test.mjs`), vermelho:
   - cada um dos 8 tipos válido sai normalizado (texto aparado, `id`, `titulo`, `subtitulo`);
   - tipo desconhecido, seção que não é objeto, `secoes` que não é lista → descartados, sem lançar;
   - item que não é objeto, número no lugar de texto, item todo vazio → descartados;
   - seção sem item aproveitável → descartada (seção vazia parece página quebrada);
   - `javascript:`/`data:` em `imagem_url` → imagem `null` (cartão fica, logo sem nome sai);
   - `/publico/imagem/<id>` ganha o prefixo da API (`enderecoDaImagem`);
   - limites: 20 seções, 30 itens, 12 linhas do comparativo, 6 números;
   - `texto_imagem.texto` passa pelo `paragrafosDoCorpo`; `lado` inválido vira `direita`;
   - `chamada` sem botão cai no `cta_text` da página e depois num padrão;
   - id ausente/repetido ganha id estável derivado da posição (a `key` do React);
   - a fixture do Phoebus monta as 8 seções.
2. `secoes.ts`: tipos `TipoDeSecao`, `Secao` (normalizada), `SecaoDaConfig`
   (crua, a do editor), `TIPOS_DE_SECAO`, limites, `secoesDaConfig(config, origem, base)`,
   `secaoVazia(tipo, id)` (nasce com um item vazio, usada pelo editor).
   Só sintaxe apagável; importa `./campos.ts` (allowImportingTsExtensions).
3. `enderecoDaImagem(url, base)` sai do `Landing.tsx` e do `PageConfigEditor.tsx`
   para `campos.ts` (lugar compartilhado, sem `import.meta`).
4. Verde: `node --test frontend/scripts/landing-*.test.mjs`.

## Tarefa 2 — régua de URL no servidor

Arquivos: `backend/app/captura/urls.py`, `backend/tests/test_landing_secoes.py` (novo).

1. Teste primeiro: `urls_invalidas` devolve `secoes.3.imagem_url` e
   `secoes.0.itens.1.imagem_url`; segura passa; vazio não conta; config sem
   `secoes` igual a antes; `recusar_urls_inseguras` (paginas.py) dá 400 com o
   caminho no detalhe; `config_com_urls_seguras` tira a URL ruim da seção/item
   sem mexer na original (cache) e corta as seções/itens acima dos limites;
   `montar_casca` não embute a URL ruim.
2. `urls.py`: os caminhos fixos ficam; soma-se a caminhada de `secoes`
   (o `imagem_url` da seção e o de cada item de `itens`, qualquer tipo).
   `secoes` que não é lista é ignorada (o cliente descarta).
3. Verde no Postgres local (`banco-teste-local.sh marketinghs-teste-21 5445`):
   `test_landing_secoes.py` + `test_prova_captura.py` (o vizinho da régua).

## Tarefa 3 — renderizador e CSS

Arquivos: `frontend/src/landing/Secoes.tsx` (novo), `Landing.tsx`, `landing.css`.

- `Landing.tsx`: com seções, `main.landing-com-secoes` (coluna, sem centralizar
  na altura); topo num `div.landing-topo`; `id="formulario"` no cartão do
  formulário (nos dois leiautes). Sem seções, o DOM do topo é o de hoje.
- `Secoes.tsx`: um componente por tipo, texto puro, nenhum `innerHTML`.
  Botão da `chamada` é `<a href="#formulario">` que rola e foca o primeiro
  campo de verdade (nunca a isca).
- CSS: seções com respiro, fundo alternado (`--landing-bg` / `--landing-surface`,
  que é o branco que o cartão já usa, agora com nome), números grandes no
  acento, comparativo em tabela no desktop e em cartões no celular
  (`data-rotulo` + `::before`), passos numerados, cartões em grade
  `auto-fit`, logos em cinza alinhados (nome em texto quando ainda não há
  imagem), FAQ com `<details>`, chamada em faixa do acento.
- Conferir: `npm run build:landing`.

## Tarefa 4 — editor no admin

Arquivos: `PageConfigEditor.tsx`, novos `CampoDeImagem.tsx`, `SecoesEditor.tsx`,
`EditoresDeSecao.tsx` em `components/admin/pages/`.

- `CampoDeImagem`: URL + "Subir imagem" + "Tirar" + prévia — o upload do topo
  passa a usá-lo (reaproveitar, não copiar); avisa URL que a página recusaria.
- `SecoesEditor`: "Adicionar seção" abre a lista dos 8 tipos (nome + uma
  linha); cartão recolhível por seção com tipo e título; subir, descer,
  remover com confirmação na própria tela (sem `window.confirm`); limites
  desligam o botão de adicionar.
- `EditoresDeSecao`: um editor por tipo; itens com adicionar, remover,
  subir/descer.
- Cor só por token; `npm run guarda:visual -- src/components/admin/pages` limpo.

## Tarefa 5 — conferência e portão

- Postgres local 5445; backend na 8121 com `DATABASE_URL` local; uma página
  ativa `phoebus-teste` com a fixture inserida SÓ no banco local; Vite 8101
  com `MKT_BACKEND_PORT=8121`; `conferir-telas.mjs` em `/p/phoebus-teste?previa=1`
  (1440 e 390). Editor: se o login do script não existir no banco local,
  fica para a coordenadora.
- Portão: `tsc`, guarda, `build:landing`, node, pytest dos tocados,
  `git diff --stat` sem `.env`.
- Revisão de código do diff da branch; consertar o que for real; push da branch.
