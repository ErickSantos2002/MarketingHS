import type { CSSProperties } from 'react';

// Cor que vem do banco (lead_statuses.color, tags.color) é DADO: quem
// escolhe é o usuário, em Configurações. A tela não a troca por token —
// só a apresenta de um jeito legível nos dois temas: a cor vai na borda,
// no ponto e num fundo de 12%; o texto fica na cor de título.

// Nomes que o sistema grava em vez de hexadecimal (tags.color = 'purple').
// O DS não tem roxo nem verde-azulado: roxo vira primária, teal vira
// sucesso escuro — as mesmas decisões do G1.
const PALETA_NOMEADA: Record<string, string> = {
  purple: 'var(--color-primary-600)',
  blue: 'var(--color-info-600)',
  green: 'var(--color-success-600)',
  amber: 'var(--color-warning-600)',
  red: 'var(--color-danger-600)',
  teal: 'var(--color-success-700)',
};

export const COR_DE_DADO_PADRAO = 'var(--color-slate-400)';

export function resolverCorDeDado(cor?: string | null): string {
  if (!cor) return COR_DE_DADO_PADRAO;
  return PALETA_NOMEADA[cor] ?? cor;
}

// Nunca `${cor}15`: sufixo de alfa só funciona com hexadecimal e quebra em
// silêncio com var(--…). color-mix aceita os dois.
export function estiloDeCorDeDado(cor?: string | null): CSSProperties {
  const c = resolverCorDeDado(cor);
  return {
    borderColor: c,
    backgroundColor: `color-mix(in srgb, ${c} 12%, transparent)`,
  };
}
