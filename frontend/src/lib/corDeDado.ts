import type { CSSProperties } from 'react';

// Cor de etiqueta (tags.color) é DADO: quem escolhe é o usuário, na ficha.
// A tela a apresenta de um jeito legível nos dois temas: a cor vai na borda,
// no ponto e num fundo de 12%; o texto fica na cor de título. (Status não
// passa mais pelo banco: é o mapa fixo `corDoStatus`, desde 01/10/2026.)

// Nomes que o sistema grava em vez de hexadecimal (tags.color = 'purple').
// Só quatro se distinguem depois da tradução para token (decisão do Erick,
// 01/10/2026, pergunta 3): o seletor de etiqueta oferece só estas.
export const CORES_DE_ETIQUETA = ['blue', 'green', 'amber', 'red'] as const;

const PALETA_NOMEADA: Record<string, string> = {
  blue: 'var(--color-info-600)',
  green: 'var(--color-success-600)',
  amber: 'var(--color-warning-600)',
  red: 'var(--color-danger-600)',
};

// Nomes antigos, ainda gravados no banco, que saíram do seletor: roxo era
// indistinguível do azul e verde-azulado do verde. O remapeamento é só na
// tela — o banco continua dizendo 'purple'/'teal', ninguém reescreve.
const NOME_ANTIGO: Record<string, (typeof CORES_DE_ETIQUETA)[number]> = {
  purple: 'blue',
  teal: 'green',
};

export const COR_DE_DADO_PADRAO = 'var(--color-slate-400)';

export function resolverCorDeDado(cor?: string | null): string {
  if (!cor) return COR_DE_DADO_PADRAO;
  return PALETA_NOMEADA[NOME_ANTIGO[cor] ?? cor] ?? cor;
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
