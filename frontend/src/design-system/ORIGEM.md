# Origem destes arquivos

Cópia fiel do design system publicado no Claude Design.

- **Projeto:** Health & Safety Design System
- **projectId:** `ef9f35f6-3af0-4651-9dee-45d08884432a`
- **Baixado em:** 22/09/2026, pelo DesignSync (só leitura)
- **Arquivos:** `styles.css` e `tokens/{colors,typography,spacing,shape,motion,base}.css`
- **Conferência:** idênticos, por SHA-256, à cópia do DataCoreHS (sync de 25/08/2026)

## Regras

Estes arquivos **não se editam aqui**. Mudança de token acontece no projeto do
Claude Design e desce por novo download. Editar localmente é o caminho
conhecido para os sistemas da H&S divergirem — foi assim que a casa chegou a
quatro azuis diferentes.

Só a versão oficial vale. A cópia do HelpHS carrega emendas (E1–E16-b) que
nunca subiram para o projeto oficial; por decisão do Erick (22/09/2026), o
MarketingHS não as usa.

## Hashes (SHA-256)

```
1ef6324844aa066488f0d8a015b39e3ca0756c629512fce4e1bd95ca8b93b9b2  styles.css
bdd047ce432e74b33fa7f752da08cf025419e83ea18485bd947c889c0ac1c221  tokens/base.css
63d960841590a2cb4df3819e2cb4a55439c893578abfe68c00927a7aba0f307d  tokens/colors.css
c70d51a982ae0b91bd53ece150d8d16e0e70bef9ca59586541a9a7177228478e  tokens/motion.css
7bcfbbc585d3ea8c7f689a27eeb3ae13de0c2a9dcc3c6cc0c8f41d440d193f7d  tokens/shape.css
c093b261c6893a893a418cdf64798555326d4586a8adb37cc7eca457fabae420  tokens/spacing.css
99d1a02b92b120c78000c0bc016c616680effb3e13b512e914f3f4f578ca916a  tokens/typography.css
```

## Defeitos conhecidos do oficial

Registrados para o Erick decidir no projeto oficial — **não** se corrigem aqui.

- `--text-muted` (slate-500) dá 4,34:1 sobre `--surface-elevated` no tema
  claro — abaixo do AA de 4,5:1.
- `--text-faint` reprova o AA nos dois temas (2,34–2,56:1 no claro).
- Não há `--border-control`: a borda de campo (`--border-color`) fica entre
  1,13:1 e 1,48:1 contra as superfícies, abaixo dos 3:1 da WCAG 1.4.11.
- Não há paleta de gráfico: as séries do `chartTheme.ts` (Fase 1) saem da
  rampa primária e das semânticas.
- **Seis cores de série não cobrem nove categorias.** Como não há paleta
  oficial, o `chartTheme.ts` tem seis (`--grafico-1..6`) e `serie(i)` usa
  `i % 6` — da sétima categoria em diante a cor repete. Medido com
  `getComputedStyle` nos dois temas na Tarefa 6 (23/09/2026), duas telas
  colidem hoje: **`ChallengeThemesChart`** (9 temas — IA/Automação =
  Estratégia, Conhecimento = Equipe, Ferramentas = Outros) e
  **`SectorDistribution`** (até 9 setores — Outros = Consultoria, Tecnologia
  = Educação, Indústria = 2º Outros; os nomes dependem da ordem do dado em
  runtime, a colisão não). Duas fatias de significados diferentes saem com o
  mesmo pixel. A decisão é do projeto oficial: uma paleta de gráfico com mais
  séries, ou aceitar a repetição.
- Menor, na mesma família: no tema escuro, `serie(4)` (`--grafico-5`,
  `primary-200`, `rgb(184,221,245)`) e `serie(5)` (`--grafico-6`,
  `slate-500`, `rgb(100,116,139)`) ficam próximos em luminosidade — matizes
  diferentes, distinguíveis, mas com menos contraste que no claro
  (`Cargos` e `Setores Identificados`).
- `--primary-foreground` (branco) sobre `--action` do tema escuro
  (`--color-primary-400`, `#47a6e1`) dá ~2,7:1 — abaixo do AA de 4,5:1. É o
  par oficial do DS (branco sobre o botão primário); não se corrige aqui.
  Achado na revisão final da Fase 0 (item M4, 22/09/2026).

## A fonte por `@import`

`tokens/typography.css` carrega a Plus Jakarta Sans por `@import url(...)`
externo, dentro de um arquivo importado depois de outras regras — não é um
defeito, é só um ponto que parecia arriscado até ser medido. Medido na
Tarefa 2 (22/09/2026): o `@import` sobrevive ao bundle do Vite/PostCSS sem
precisar de `<link>` manual no `index.html`.
`document.fonts.check('14px "Plus Jakarta Sans"')` dá `true` e a requisição a
`fonts.googleapis.com` aparece na rede. Nenhum ajuste foi necessário.

## O que o MarketingHS faz com eles

`src/index.css` importa `styles.css` antes do `@tailwind` e define a ponte das
variáveis do shadcn para estes tokens. Ver o spec
`docs/superpowers/specs/2026-09-22-marketinghs-visual-design-system-design.md`.
