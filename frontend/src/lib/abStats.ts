// ============================================================================
// Motor estatístico do Teste A/B — bayesiano (Beta-Binomial) como padrão, por ser
// mais legível e robusto em baixo volume (< 10k/mês). Tudo client-side e puro.
//
//  - probabilityToBeBest: P(variante ser a melhor) via Monte Carlo, + intervalo
//    de credibilidade e uplift esperado vs. controle.
//  - requiredSamplePerVariant / estimateDurationDays: dimensionamento de amostra
//    para o formulário de criação (sinaliza quando o resultado é "preliminar").
// ============================================================================

function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Amostra de Gamma(k, 1) — Marsaglia-Tsang.
function gammaSample(k: number): number {
  if (k < 1) return gammaSample(1 + k) * Math.pow(Math.random(), 1 / k);
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = gaussian();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function betaSample(a: number, b: number): number {
  const x = gammaSample(a);
  const y = gammaSample(b);
  return x / (x + y);
}

export interface VariantInput {
  key: string;
  conversions: number;
  exposures: number;
}

export interface VariantVerdict {
  key: string;
  conversions: number;
  exposures: number;
  rate: number; // taxa observada
  ciLow: number; // intervalo de credibilidade 95% (percentil 2.5)
  ciHigh: number; // percentil 97.5
  probBest: number; // P(ser a melhor)
  upliftVsControl: number | null; // lift relativo médio vs. controle
}

// Prior Beta(1,1) (uniforme). iterations = amostras Monte Carlo.
export function analyzeVariants(
  variants: VariantInput[],
  controlKey?: string,
  iterations = 4000,
): VariantVerdict[] {
  const n = variants.length;
  if (n === 0) return [];

  const wins = new Array(n).fill(0);
  const samples: number[][] = variants.map(() => []);

  for (let it = 0; it < iterations; it++) {
    let bestIdx = 0;
    let bestVal = -1;
    for (let i = 0; i < n; i++) {
      const a = 1 + variants[i].conversions;
      const b = 1 + Math.max(0, variants[i].exposures - variants[i].conversions);
      const s = betaSample(a, b);
      samples[i].push(s);
      if (s > bestVal) {
        bestVal = s;
        bestIdx = i;
      }
    }
    wins[bestIdx]++;
  }

  const controlIdx = controlKey ? variants.findIndex((v) => v.key === controlKey) : 0;
  const controlMean =
    controlIdx >= 0 && samples[controlIdx].length
      ? samples[controlIdx].reduce((x, y) => x + y, 0) / samples[controlIdx].length
      : null;

  return variants.map((v, i) => {
    const sorted = samples[i].slice().sort((x, y) => x - y);
    const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] || 0;
    const mean = sorted.length ? sorted.reduce((x, y) => x + y, 0) / sorted.length : 0;
    return {
      key: v.key,
      conversions: v.conversions,
      exposures: v.exposures,
      rate: v.exposures > 0 ? v.conversions / v.exposures : 0,
      ciLow: pct(0.025),
      ciHigh: pct(0.975),
      probBest: wins[i] / iterations,
      upliftVsControl:
        controlMean && controlMean > 0 && i !== controlIdx ? (mean - controlMean) / controlMean : null,
    };
  });
}

// Amostra necessária por variante (teste de proporções, 2 lados).
// baseline: taxa base (0-1). mde: efeito mínimo detectável RELATIVO (ex.: 0.2 = +20%).
export function requiredSamplePerVariant(
  baseline: number,
  mde: number,
  alpha = 0.05,
  power = 0.8,
): number {
  if (baseline <= 0 || baseline >= 1 || mde <= 0) return 0;
  const p1 = baseline;
  const p2 = Math.min(0.9999, baseline * (1 + mde));
  const zAlpha = alpha <= 0.01 ? 2.576 : alpha <= 0.05 ? 1.96 : 1.645;
  const zBeta = power >= 0.9 ? 1.282 : power >= 0.8 ? 0.842 : 0.674;
  const pBar = (p1 + p2) / 2;
  const num = zAlpha * Math.sqrt(2 * pBar * (1 - pBar)) + zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
  const denom = Math.abs(p2 - p1);
  return Math.ceil((num * num) / (denom * denom));
}

// Duração estimada (dias) dado tráfego diário total e nº de variantes.
export function estimateDurationDays(
  samplePerVariant: number,
  dailyTrafficTotal: number,
  numVariants: number,
): number {
  if (dailyTrafficTotal <= 0 || numVariants <= 0) return 0;
  const perVariantPerDay = dailyTrafficTotal / numVariants;
  if (perVariantPerDay <= 0) return 0;
  return Math.ceil(samplePerVariant / perVariantPerDay);
}
