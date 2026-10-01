// Cor padrão do botão (CTA) das landings — a única fonte dela. O editor de
// página mostra esta cor no seletor quando a página não tem `cta_color`, e a
// landing pública pinta o botão com ela no mesmo caso (vira o
// `--landing-accent`, ver Landing.tsx). Decisão 10 do Erick (01/10/2026):
// azul primário da marca, uma constante para os dois.
//
// É o `--action` do Design System (`--color-primary-600`), não o
// `--color-primary-500` (#1f89ca): texto branco em negrito de 16 px sobre o
// 500 dá ~3,8:1, abaixo de 4,5; sobre o 600 dá ~5,3:1. Hex aqui e não token
// porque a landing pública não carrega o Design System (exceção da regra de
// cor) — se o azul da marca mudar lá, muda aqui à mão.
//
// Página já gravada com cor própria não muda: a constante só vale quando
// `cta_color` está vazio.
export const COR_CTA_PADRAO = '#1a71a8';
