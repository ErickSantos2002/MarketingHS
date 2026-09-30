// Cor inicial do seletor "Cor do CTA" no editor de página. É dado da landing
// pública (Decisão 6 do spec), não cor da tela do admin — por isso mora aqui,
// na área isenta do guarda, e não no editor.
// ⚠️ Diverge do que a landing usa quando a página não tem cor: o botão cai
// no `--landing-accent` (#1e3a5f, landing.css). Qual das duas vale é
// decisão pendente do Erick ("cor do botão das landings"); o valor aqui
// não muda até lá.
export const COR_CTA_PADRAO = '#E41A11';
