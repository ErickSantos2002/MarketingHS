# Frente `primitivos-cta`

Decisões do Erick de 01/10 (`docs/perguntas-abertas.md`, itens 4 e 10).
Território: `components/ui/button.tsx`, `components/ui/input.tsx` (e
`select`/`textarea` se forem controle de uma linha), os usos de `h-9` manual
em botão/campo **fora** de `contacts/` e `settings/` e dos arquivos da
`cores-decisoes`, `src/landing/padroes.ts`, o editor de página e o ponto da
landing que usa `#1e3a5f`.

## Backlog (em ordem)

- [ ] **#4** Botão (tamanho padrão) e campo com `h-9` (36 px) no primitivo.
  Depois, tirar o `h-9` manual que as telas passavam para emparelhar — só onde
  ele era a muleta (botão/campo de tamanho padrão). Medir antes/depois nas
  telas com botão ao lado de campo. Em `contacts/` e `settings/`, só anotar no
  Estado (outras frentes estão lá).
- [ ] **#10** Cor padrão do botão das landings: uma constante só, o azul
  primário da marca, em `src/landing/padroes.ts` (`COR_CTA_PADRAO`), lida pelo
  editor **e** pela landing (que hoje cai em `#1e3a5f`). A landing pública é
  exceção da regra de token (hex permitido lá). Páginas já gravadas com cor
  própria não mudam.
- [ ] Portão: guarda 0, `tsc` 0, `vite build`, `build:landing`, telas nos dois
  temas e 390 px.

## Estado

## Perguntas
