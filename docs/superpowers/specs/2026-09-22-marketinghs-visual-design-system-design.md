# MarketingHS — adoção do Design System da Health & Safety

Data: 22/09/2026 · Autor: Erick Santos (com Claude Code)

## Contexto

A travessia acabou no lote 8E (22/09/2026): o MarketingHS não carrega mais
Supabase, Lovable nem marca dn.ia visível. O que ficou de propósito para depois
foi o **visual** — o painel ainda veste o tema escuro "Aurora / Mission Control"
da dn.ia, com vermelho `#de1a11` e azul `#3d61ff`, fontes Blinker/Rajdhani/Outfit,
glass, glow e gradiente.

A Health & Safety tem um design system próprio, publicado no Claude Design:
projeto **"Health & Safety Design System"**, `ef9f35f6-3af0-4651-9dee-45d08884432a`.
Ele define tokens, primitivos, fundamentos de conteúdo e visual, e um guia de
adoção (`guidelines/adocao.md`) para os sistemas da casa convergirem. O
MarketingHS não aparece na tabela do guia — é o nono sistema, mais novo que o
documento.

## Objetivo

Deixar o MarketingHS no padrão do Design System da H&S — tokens, fonte, tema,
casca, primitivos e telas — sem mudar o comportamento de nenhuma tela.

## Não-objetivos

- **Não** é redesenho de produto. Layout e fluxo de cada tela permanecem.
- **Não** mexe no backend.
- **Não** mexe nas landing pages públicas (`/p/{slug}`), que têm o visual de
  cada página.
- **Não** usa as emendas E1–E16-b que existem só na cópia do HelpHS (decisão do
  Erick, 22/09 — ver Decisão 1).
- **Não** edita o design system. Defeito achado nele vira pergunta ao Erick,
  para corrigir no projeto oficial.

## Estado atual (medido em 22/09/2026)

`frontend/`: React 18 + Vite + TypeScript + **Tailwind 3.4.17** + shadcn/ui
(Radix). 211 arquivos `.tsx`, 16 páginas em `src/pages/admin/`, 50 componentes
em `src/components/ui/`.

| Sintoma | Número |
|---|---|
| Usos de token do shadcn (`bg-primary`, `text-muted-foreground`…) | 1.541 |
| … dos quais com modificador de opacidade (`bg-primary/20`, `bg-muted/30`…) | 583 |
| Cor literal do Tailwind (`text-green-500`, `bg-blue-600`…) | 702 |
| Hexadecimal cravado em `.ts`/`.tsx` | 129 |
| Hexadecimal arbitrário em classe (`bg-[#…]`) | 8 |
| Prefixo `dark:` | 28 |
| Classes de efeito da dn.ia (`glass-card`, `card-glow`, `text-gradient-dnia`, glow) | 9 |
| Arquivos com `recharts` | 15 |
| `src/index.css` | 885 linhas, 3 temas da dn.ia |

Onde mora a dívida (cor literal + hexadecimal), por pasta de componentes:
`dashboard/` 399 · `settings/` 108 · `contacts/` 76 · `campaigns/` 64 ·
`automations/` 40 · `pages/` 24 · `segments/` 0. Nas páginas, o máximo é
`Campaigns.tsx` com 23.

Achados que decidem o desenho:

1. **Só existe tema escuro.** As variáveis do shadcn estão cravadas no `:root`
   em HSL escuro; a classe `.dark` repete os mesmos valores. Não há alternância.
2. **O `AdminLayout` põe `theme-dnmarketing` no `<body>`** para os portais do
   Radix (Dialog, Select, Sheet…) herdarem a cor — sem isso saíam vermelhos.
   A ponte de tokens (Decisão 3) torna esse remendo desnecessário.
3. **Não há topbar.** A casca é sidebar + a faixa de filtros globais (com
   `backdrop-blur`).
4. **A chave da sidebar recolhida se chama `dnmarketing-sidebar-collapsed`.**
5. **Tailwind 3.4 aceita `<alpha-value>` em qualquer função de cor** — é o que
   permite a ponte preservar os 583 modificadores de opacidade sobre tokens em
   hexadecimal.

## Decisões

**1 · A fonte é o projeto oficial no Claude Design, tal como está.**
Conferido em 22/09: o `tokens/colors.css` oficial é igual à cópia do
DataCoreHS (sync de 25/08); a cópia do HelpHS carrega emendas (E1–E16-b:
contraste de `--text-muted`, `--border-control`, degraus de botão semântico,
paleta de gráfico) que nunca subiram. Decisão do Erick: **só o oficial**. Os
defeitos conhecidos do oficial ficam registrados no `ORIGEM.md` como
pergunta ao Erick, não corrigidos aqui.

**2 · Abordagem A do brainstorming: ponte + primitivos locais ajustados.**
É o que o `adocao.md` manda para um sistema com biblioteca própria ("ajuste o
`components/ui/` local para bater com eles — mesmos nomes de variante, mesmos
tamanhos, mesmos estados"). Descartadas: **B**, portar os primitivos do DS e
aposentar o shadcn (reescreve boa parte das telas e troca a acessibilidade
pronta do Radix por código novo — o DataCoreHS fez assim porque não tinha
biblioteca); **C**, só a ponte (deixa 702 cores literais e os efeitos da
dn.ia — visual pela metade, que o checklist reprova).

**3 · Ponte do shadcn para os tokens.** As variáveis do shadcn viram aliases
dos tokens oficiais, e o `tailwind.config.ts` as consome com `color-mix`, que
preserva o modificador de opacidade:

```ts
// ex.: primary
primary: {
  DEFAULT: "color-mix(in srgb, var(--primary) calc(<alpha-value> * 100%), transparent)",
  foreground: "color-mix(in srgb, var(--primary-foreground) calc(<alpha-value> * 100%), transparent)",
},
```

| Variável do shadcn | Token oficial |
|---|---|
| `--background` | `--bg-base` |
| `--foreground` | `--text-body` |
| `--card`, `--popover` | `--surface` |
| `--card-foreground`, `--popover-foreground` | `--text-body` |
| `--muted`, `--secondary`, `--accent` | `--surface-elevated` |
| `--muted-foreground` | `--text-muted` |
| `--secondary-foreground`, `--accent-foreground` | `--text-heading` |
| `--primary`, `--ring` | `--action` |
| `--primary-foreground` | `--text-on-primary` |
| `--border`, `--input` | `--border-color` |
| `--destructive` | `--color-danger-600` |
| `--success` | `--color-success-600` |
| `--destructive-foreground`, `--success-foreground` | `--color-white` |

As variáveis que só a dn.ia usava (`--primary-glow`, `--glass`,
`--glass-border`, `--background-secondary`, `--background-tertiary`,
`--text-secondary`) saem; quem as consome é migrado na mesma fase. Entram
também as classes do bloco `theme.extend` do `adocao.md` (`bg-action`,
`bg-surface`, `bg-surface-base`, `bg-surface-elevated`, `border-borda`,
`text-conteudo`, `text-conteudo-heading`, `text-conteudo-muted`, a rampa
`primary-50…900` como `primary-<n>`) — são o vocabulário das telas migradas.
Onde uma classe do `adocao.md` colide com uma do shadcn (`primary`), vale a do
shadcn apontando para `--action`, e a rampa fica acessível como
`primary-50…900`.

**4 · Tema claro por padrão, com alternância para o escuro.** Decisão do Erick.
Classe `dark` no `<html>`, como o DS define; chave na topbar; escolha salva em
`localStorage`; script mínimo no `index.html` aplica a classe antes do React
montar, para não piscar. Sem preferência salva, o claro — não
`prefers-color-scheme` (o DS diz que o claro é o de trabalho).

**5 · Tokens copiados verbatim; primitivos ajustados no lugar.** `styles.css` e
`tokens/*.css` entram byte a byte, com hash registrado. Os componentes de
`components/ui/` mantêm nome, API e o Radix por baixo; muda medida, cor e
estado, usando o `.d.ts` e o `.prompt.md` de cada primitivo oficial como
especificação.

**6 · Duas exceções à regra "nenhum hexadecimal no JSX"**, declaradas por nome:
- **conteúdo de e-mail** — `emailEditorConfig.ts` e o que monta HTML de e-mail:
  o cliente de e-mail não enxerga variável CSS;
- **preview de landing page** — é a página pública de verdade, com o visual
  dela.

**7 · Migração por área, não por componente** (regra do `adocao.md`). Uma
tela inteira com seus componentes é verificável; um componente convertido no
meio de telas antigas gera divergência pior que a de hoje.

**8 · Uma branch por fase, com o portão de sempre.** Nada entra na `main` sem o
Erick.

## Arquitetura alvo

```
frontend/src/
  design-system/        fronteira fechada — nada aqui importa do app
    styles.css          cópia verbatim do oficial
    tokens/             colors · typography · spacing · shape · motion · base
    ORIGEM.md           projectId, data do sync, hashes, defeitos conhecidos
  components/ui/        shadcn local, ajustado às medidas e estados oficiais
  lib/chartTheme.ts     tema único de recharts derivado dos tokens
  lib/tema.ts           claro/escuro: ler, aplicar, salvar
  index.css             importa design-system/styles.css + ponte shadcn → tokens
```

---

## Fase 0 — Fundação

Nenhuma tela é reescrita por dentro. A cor da marca, a fonte e os dois temas
mudam em tudo.

1. `src/design-system/` com `styles.css` e `tokens/` baixados do projeto
   oficial (DesignSync, só leitura), mais `ORIGEM.md` — projectId, data,
   SHA-256 de cada arquivo, a regra "não se edita aqui", e os defeitos
   conhecidos (contraste de `--text-muted` e `--text-faint`, ausência de
   `--border-control` e de paleta de gráfico).
2. `index.css` importa `design-system/styles.css` **antes** de `@tailwind`.
3. **Ponte** (Decisão 3) no `index.css` e no `tailwind.config.ts`.
4. **Tema** (Decisão 4): `lib/tema.ts`, script anti-piscada no `index.html`.
   A chave visual entra na Fase 1, com a topbar; até lá o tema se troca pelo
   `localStorage`, para conferência.
5. **Fonte:** Plus Jakarta Sans (Google Fonts, 300–800) e a pilha mono do DS
   no `tailwind.config.ts`. Saem Blinker, Rajdhani, Outfit e JetBrains Mono do
   `index.html` e do config.
6. **Limpeza da dn.ia no `index.css`:** saem `theme-dnmarketing`,
   `theme-fev2425`, "Aurora / Mission Control", `glass-card`, `card-glow`,
   `text-gradient*`, animações de glow e as variáveis da Decisão 3 que só a
   dn.ia usava. As 9 ocorrências dessas classes nas telas saem junto, e o
   `classList.add('theme-dnmarketing')` do `AdminLayout` e do `Login` também.
7. **Guarda visual:** `scripts/guarda-visual.mjs` + `npm run guarda:visual`,
   contando hexadecimal e cor literal do Tailwind em `src/`, por pasta, fora
   das exceções da Decisão 6. Nesta fase ele só mede (o número de partida vai
   para o registro); a cada grupo da Fase 2, a área migrada tem de dar zero.

**Pronto quando:** build ok, `tsc` sem erro novo (hoje: 4 pré-existentes), as
16 telas abrem nos dois temas sem erro de console, e há screenshots
antes/depois de cada tela nos dois temas.

---

## Fase 1 — Casca, login, primitivos e gráficos

**Casca (padrão do `AppShell` oficial):**
- sidebar 256px, 72px recolhida, estado salvo — a chave passa a
  `marketinghs-sidebar-collapsed` (lendo a antiga uma vez, para ninguém perder
  a preferência);
- item ativo: fundo `--action-tint`, texto `--action`, barra de 2px à esquerda;
- topo da sidebar: logo H&S + "MarketingHS";
- **topbar nova de 64px** com o título da tela e a chave de tema;
- filtros globais continuam abaixo da topbar, nas mesmas rotas; sai o
  `backdrop-blur` (o DS só permite blur no fundo do modal);
- botão flutuante do assistente restilizado, no mesmo lugar.

**Login:** card sobre `--bg-base`, logo, campos, botão primário; os dois temas;
sem "esqueci a senha" (regra do `CLAUDE.md`).

**Primitivos** (`components/ui/`, API e Radix intactos):

| Componente | Alvo |
|---|---|
| `button` | variantes primário (`--action`), secundário (borda), fantasma, perigo; raio 8px; hover escurece um passo; sem escala ao clique; anel 2px em `focus-visible`; desabilitado 50% |
| `card` | borda 1px `--border-color`, raio 12px, padding 16px, sem sombra |
| `badge` | pílula, fundo `--tint-*`, texto `--on-tint-*` |
| `input`, `textarea`, `select`, `checkbox`, `radio-group`, `switch` | raio 8px, borda do DS, anel 2px em `focus-visible`, desabilitado 50% |
| `dialog`, `alert-dialog`, `sheet` | raio 12px, sombra xl, fundo `--overlay` com blur 4px, entrada fade + zoom 95% em 150ms |
| `table` | cabeçalho `--surface-elevated`, mono caixa alta 12px, hover de linha |
| `tabs`, `tooltip`, `toast`/`sonner`, `alert`, `progress`, `pagination` | cores e medidas oficiais |

`glowing-effect.tsx` sai (efeito da dn.ia) e quem o usa deixa de usar.
Componentes de `ui/` sem nenhum importador não são restilizados — o uso é
conferido antes, e os órfãos são listados no registro.

**`lib/chartTheme.ts`:** eixos, grade, tooltip e legenda a partir dos tokens;
séries pela rampa primária e pelas semânticas oficiais. Aplicado nos 15
arquivos com `recharts`. Série que ficar indistinguível vira pergunta ao
Erick (o oficial não tem paleta de gráfico — Decisão 1).

**Pronto quando:** casca, login e primitivos passam o checklist do
`adocao.md` nos dois temas, conferidos no navegador; as telas herdam os
primitivos sem mudar de comportamento.

---

## Fase 2 — As telas, por área

| Grupo | Telas e componentes |
|---|---|
| G1 | Visão geral e Analytics — `components/admin/dashboard/` |
| G2 | Contatos, ficha do contato, Importação — `contacts/`, `LeadDetailSheet`, `LeadsImport` |
| G3 | Campanhas e Templates — `campaigns/` (menos o conteúdo de e-mail, Decisão 6) |
| G4 | Automações, Jornadas e Segmentos — `automations/`, `segments/`, `JourneyBuilder` |
| G5 | Páginas e Teste A/B — `pages/` (menos o preview, Decisão 6), `Experiments*` |
| G6 | Configurações — `settings/` |

**Checklist por tela** (`adocao.md`, passo 4):
- nenhum hexadecimal nem cor literal — tudo de token; cor com significado vira
  `--tint-*` + `--on-tint-*`;
- nenhum `dark:` onde há token equivalente;
- ação é `--action`; um botão primário por bloco de decisão;
- nenhum texto abaixo de 12px;
- ícone é componente (`lucide-react`), nunca emoji;
- estado vazio com frase completa e ação, quando existe uma;
- contagem de paginação em frase ("Mostrando 1 a 10 de 84 contatos");
- `focus-visible` com anel de 2px;
- nada animando em laço fora spinner.

Nenhum texto é reescrito além do que o checklist pede.

**Portão de cada grupo:**
1. `npm run guarda:visual` dá zero na área do grupo;
2. `tsc` sem erro novo; build ok;
3. cada tela no navegador nos dois temas, screenshot contra o "antes", zero
   erro de console;
4. **a tela faz o que fazia** — `git diff` do grupo mostra só classe, cor e
   componente de apresentação; nenhuma lógica, rota, chamada de API, texto de
   dado ou condição muda.

**Pronto quando:** os seis grupos passaram o portão e o guarda dá zero no app
inteiro, fora as exceções da Decisão 6.

---

## Registro

- `CLAUDE.md`: regra "nenhum hexadecimal no JSX — cor sai de token" com as duas
  exceções, e ponteiro para `frontend/src/design-system/ORIGEM.md`.
- `docs/CONTINUAR-AQUI.md`: bloco por fase.
- Defeitos do design system oficial achados no caminho: lista no `ORIGEM.md` e
  pergunta ao Erick.

## Riscos

| Risco | Mitigação |
|---|---|
| `color-mix` não suportado | Chrome 111+, Firefox 113+, Safari 16.2+ (2023); o painel é interno. Conferido no navegador na Fase 0. |
| A ponte muda contraste de telas antigas (texto claro pensado para fundo escuro) | A Fase 0 confere as 16 telas nos dois temas; texto ilegível numa tela ainda não migrada é anotado e vira item do grupo dela, não remendo na ponte. |
| `base.css` do DS colide com regras antigas do `index.css` (body, scrollbar, links) | A limpeza da Fase 0 remove as regras antigas; o que sobrar em conflito é decisão da casca (Fase 1), registrada. |
| Primitivo restilizado quebra uma tela que dependia de classe interna | O portão de cada grupo confere a tela; a API do componente não muda. |
| Defeito de contraste do DS oficial (`--text-muted` 4,34:1 sobre `--surface-elevated`) | Aceito por decisão do Erick; registrado no `ORIGEM.md`; nenhuma correção local. |

## Referências

- Projeto oficial: Claude Design `ef9f35f6-3af0-4651-9dee-45d08884432a` —
  `readme.md`, `guidelines/adocao.md`, `components/**`.
- Precedente: `~/github/DataCoreHS/docs/superpowers/specs/2026-08-25-datacorehs-design-system-design.md`.
