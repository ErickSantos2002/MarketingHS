# Landing com seções — design (26/10/2026)

## Por quê

A primeira landing real é a do **Phoebus** (texto em
`~/projetos/landing-phoebus/texto-v1.md`, fora do repositório). O editor de
hoje tem uma seção só — título, subtítulo, corpo, imagem e formulário — e o
material pede oito: números, comparativo, passo a passo, onde instalar,
plataforma, calibração, clientes, perguntas frequentes e a chamada final. A
landing não pode nascer menor que o material.

Decidido com o Erick (26/10): **sem vídeo por enquanto** (os vídeos não
estão no YouTube; ele resolve depois). O resto entra.

## O modelo

A config da página (`pages.config`, JSON) ganha **`secoes`**: lista ordenada.
**Não há migration** — é mais uma chave no JSON que já existe.

O topo de hoje (headline, subheadline, imagem, corpo e o cartão com o
formulário) **não muda** e continua sendo a primeira dobra. As seções vêm
depois dele, na ordem da lista. Página sem `secoes` renderiza exatamente
como hoje.

Toda seção tem:

```ts
{ id: string;            // estável, gerado no editor (crypto.randomUUID)
  tipo: TipoDeSecao;
  titulo?: string;       // h2 da seção
  subtitulo?: string; }  // linha de apoio abaixo do h2
```

Os oito tipos e os campos próprios de cada um:

| tipo | campos | uso no Phoebus |
|---|---|---|
| `numeros` | `itens: {valor, rotulo}[]` (até 6) | 23 milhões+ / 165 mil+ / 770+ |
| `comparativo` | `colunas: {a, b}` (rótulos; **b é a destacada**), `linhas: {criterio, a, b}[]` | processo manual × Phoebus |
| `passos` | `itens: {titulo, texto}[]` — numerados na tela | identifica / testa / decide |
| `cartoes` | `itens: {titulo, texto, imagem_url?}[]` | onde instalar; plataforma |
| `texto_imagem` | `texto` (mesma regra do `corpo`: parágrafos e lista com `- `), `imagem_url?`, `lado: "esquerda" \| "direita"` | calibração |
| `logos` | `itens: {imagem_url, nome}[]` — `nome` vira o `alt` | clientes |
| `perguntas` | `itens: {pergunta, resposta}[]` — `<details>`/`<summary>`, sem JS | FAQ |
| `chamada` | `texto?`, `itens?: string[]` (lista com ✓), `nota?` (letra miúda), `botao` (texto) | "Teste 30 dias grátis" |

O botão da `chamada` **rola até o formulário do topo** (âncora
`#formulario` no cartão; foco no primeiro campo). Não há segundo
formulário na página.

Limites (cliente e servidor iguais): até 20 seções, até 30 itens por
seção, até 12 linhas no comparativo. Texto puro em todo campo.

## Regras que não se quebram

- **Nada de HTML vindo da config.** Mesma regra do `Landing.tsx`: texto
  puro, nunca `dangerouslySetInnerHTML`. O `texto` de `texto_imagem` passa
  pelo `paragrafosDoCorpo` que já existe.
- **Config é JSON editável — a página não pode cair.** Todo campo passa por
  `textoDaConfig` antes de `.trim()`; seção de `tipo` desconhecido, item
  que não é objeto, lista que não é lista: **descarta e segue**. O bundle da
  landing não tem ErrorBoundary. A leitura defensiva fica numa função pura
  (`secoesDaConfig(config)` em `src/landing/secoes.ts`), testada em node
  como o `campos.ts`.
- **URL de imagem é URL que chega à página pública.** Todo `imagem_url` de
  seção passa por `urlSegura` no cliente e entra na régua do servidor
  (`backend/app/captura/urls.py`): **recusa ao salvar** (400 com o caminho,
  ex. `secoes.3.itens.0.imagem_url`) e **descarta ao servir** o que já
  estiver gravado. `URLS_DA_CONFIG` hoje é lista fixa de caminhos; as seções
  pedem caminhar a lista — mantenha os caminhos fixos como estão e some a
  caminhada de `secoes`.
- **Imagem do upload** (`/publico/imagem/<id>`) ganha o prefixo da API pelo
  `enderecoDaImagem` que já existe — tire-o do `Landing.tsx` para um lugar
  compartilhado em vez de copiar.
- **Cor:** a landing pública é a exceção da regra de cor (não carrega o
  Design System). Use o `--landing-accent` e as variáveis que o
  `landing.css` já tem; nada de paleta nova. O destaque da coluna `b` do
  comparativo e os números usam o acento.
- **Editor (admin):** regra de cor normal — token, nunca hexadecimal;
  primitivos de `components/ui/`. `npm run guarda:visual` limpo na pasta.

## O editor

Em `PageConfigEditor.tsx`, depois do bloco atual, um bloco **"Seções da
página"**, num componente novo (`SecoesEditor.tsx` +
um editor por tipo, na mesma pasta `components/admin/pages/`):

- **Adicionar seção**: escolhe o tipo numa lista (nome em português e uma
  linha do que é); nasce com um item vazio.
- Cada seção num cartão recolhível com o tipo e o título; **subir**,
  **descer**, **remover** (remover pede confirmação na própria tela —
  nada de `window.confirm`, que trava a automação do navegador).
- Itens dentro da seção: adicionar, remover, subir/descer.
- Imagem: o mesmo upload que o `imagem_url` do topo já usa (reaproveitar,
  não copiar), mais o campo de URL.
- Gravar continua sendo o botão que já existe (a config inteira vai
  junto). A prévia (`/p/<slug>?previa=1`) mostra as seções.

## Fora do escopo

- Vídeo (decisão do Erick).
- Segundo formulário na página, temas por página, seções no meio do topo.
- A chave do campo extra aparecendo no lugar do rótulo na nota do
  GrowthHS (sobra (a) de 26/10) — é do `backend/app/crm/`, outra frente.

## Como saber que ficou pronto

1. Teste node de `secoesDaConfig`: cada tipo válido; tipo desconhecido,
   item quebrado, número no lugar de texto, `javascript:` na imagem —
   descartados sem lançar.
2. Teste pytest da régua de URL: `imagem_url` insegura em seção e em item
   recusada ao salvar (caminho no detalhe) e descartada ao servir; segura
   passa; config sem `secoes` igual a antes.
3. Uma config com as oito seções do Phoebus (fixture no teste node) monta
   sem erro.
4. Conferência no navegador (`scripts/conferir-telas.mjs`) da prévia de uma
   página com as oito seções, claro e escuro onde houver, 375 px e 1280 px;
   e do editor.
5. `tsc` sem erro novo, `guarda:visual` limpo em `components/admin/pages`,
   `npm run build:landing` ok, pytest dos arquivos tocados verde.
