import { supabase } from '@/integrations/supabase/client';

export interface ScoringCriteria {
  cargo_decisor: { enabled: boolean; points: number; cargos?: string[] };
  faturamento: { enabled: boolean; points: number; min_value?: number };
  funcionarios: { enabled: boolean; points: number; min_value?: number };
  tem_desafios: { enabled: boolean; points: number };
  origem: { enabled: boolean; points: number; sources?: string[] };
  reconversao: { enabled: boolean; points: number };
  tem_whatsapp: { enabled: boolean; points: number };
}

export interface ScoringThresholds {
  hotlead: number;
  warm: number;
}

export interface ScoringConfig {
  id: string;
  criteria: ScoringCriteria;
  thresholds: ScoringThresholds;
  updated_at: string;
}

export interface ScoreBreakdown {
  total: number;
  details: { label: string; points: number; met: boolean }[];
}

const FAT_MAP: Record<string, number> = {
  'até 10k': 10000,
  '10k-50k': 10000,
  '50k-100k': 50000,
  '100k-500k': 100000,
  '500k-1M': 500000,
  'acima de 1M': 1000000,
  'entre 100k e 500k': 100000,
  'entre 500k e 1mm': 500000,
  'entre 1mm e 3mm': 1000000,
  'entre 3mm e 5mm': 3000000,
  'acima de 5mm': 5000000,
  'acima de 1mm': 1000000,
  'acima de 3mm': 3000000,
  'de r$ 1 milhão a r$ 5 milhões': 1000000,
  'de r$ 5 milhões a r$ 10 milhões': 5000000,
  'acima de r$ 10 milhões': 10000000,
  'acima de r$ 50 milhões': 50000000,
  'mais de 1 milhão': 1000000,
  'mais de 5 milhões': 5000000,
  // Novas opções com "R$ X mil/milhão/milhões por mês"
  'até r$ 100 mil por mês': 100000,
  'entre r$ 100 mil e r$ 500 mil por mês': 100000,
  'entre r$ 500 mil e r$ 1 milhão por mês': 500000,
  'entre r$ 1 milhão e r$ 3 milhões por mês': 1000000,
  'entre r$ 3 milhões e r$ 5 milhões por mês': 3000000,
  'acima de r$ 5 milhões por mês': 5000000,
};

function parseFaturamento(fat: string | null): number {
  if (!fat) return 0;
  const lower = fat.toLowerCase().trim();
  // Direct match
  if (FAT_MAP[lower] !== undefined) return FAT_MAP[lower];
  // Partial match
  for (const [key, val] of Object.entries(FAT_MAP)) {
    if (lower.includes(key)) return val;
  }
  return 0;
}

const FUNC_MAP: Record<string, number> = {
  'individual': 1,
  '2 - 10': 2,
  '11 - 25': 11,
  '26 - 49': 26,
  'acima de 50': 50,
};

function parseFuncionarios(func: string | null): number {
  if (!func) return 0;
  const lower = func.toLowerCase().trim();
  if (FUNC_MAP[lower] !== undefined) return FUNC_MAP[lower];
  for (const [key, val] of Object.entries(FUNC_MAP)) {
    if (lower.includes(key.toLowerCase())) return val;
  }
  const num = parseInt(func, 10);
  return isNaN(num) ? 0 : num;
}

export interface LeadForScoring {
  id: string;
  cargo: string | null;
  faturamento: string | null;
  funcionarios: string | null;
  desafios: string | null;
  utm_source: string | null;
  source: string | null;
  whatsapp: string | null;
}

export async function calculateLeadScore(
  lead: LeadForScoring,
  config: ScoringConfig
): Promise<ScoreBreakdown> {
  let total = 0;
  const details: ScoreBreakdown['details'] = [];
  const c = config.criteria;

  // 1. Cargo decisor
  if (c.cargo_decisor.enabled) {
    const cargos = c.cargo_decisor.cargos || [
      'CEO', 'Fundador', 'Founder', 'Diretor', 'Sócio',
      'COO', 'CFO', 'CTO', 'Proprietário', 'Dono', 'Partner',
    ];
    const cargo = lead.cargo?.toLowerCase() || '';
    const met = cargos.some(c => cargo.includes(c.toLowerCase()));
    if (met) total += c.cargo_decisor.points;
    details.push({ label: 'Cargo decisor', points: c.cargo_decisor.points, met });
  }

  // 2. Faturamento
  if (c.faturamento.enabled) {
    const fatValue = parseFaturamento(lead.faturamento);
    const met = fatValue >= (c.faturamento.min_value || 100000);
    if (met) total += c.faturamento.points;
    details.push({ label: 'Faturamento', points: c.faturamento.points, met });
  }

  // 2.5. Funcionários
  if (c.funcionarios?.enabled) {
    const funcValue = parseFuncionarios(lead.funcionarios);
    const met = funcValue >= (c.funcionarios.min_value || 10);
    if (met) total += c.funcionarios.points;
    details.push({ label: 'Nº de funcionários', points: c.funcionarios.points, met });
  }

  // 3. Desafios
  if (c.tem_desafios.enabled) {
    const met = (lead.desafios || '').length >= 20;
    if (met) total += c.tem_desafios.points;
    details.push({ label: 'Respondeu desafios', points: c.tem_desafios.points, met });
  }

  // 4. Origem qualificada
  if (c.origem.enabled && c.origem.sources && c.origem.sources.length > 0) {
    const sources = c.origem.sources.map(s => s.toLowerCase().trim());
    const leadSource = (lead.utm_source || lead.source || '').toLowerCase();
    const met = sources.some(s => leadSource.includes(s));
    if (met) total += c.origem.points;
    details.push({ label: 'Origem qualificada', points: c.origem.points, met });
  } else if (c.origem.enabled) {
    details.push({ label: 'Origem qualificada', points: c.origem.points, met: false });
  }

  // 5. Reconversão
  if (c.reconversao.enabled) {
    const { count } = await supabase
      .from('lead_conversions')
      .select('*', { count: 'exact', head: true })
      .eq('lead_id', lead.id);
    const met = (count || 0) > 1;
    if (met) total += c.reconversao.points;
    details.push({ label: 'Reconversão', points: c.reconversao.points, met });
  }

  // 6. WhatsApp
  if (c.tem_whatsapp.enabled) {
    const met = !!(lead.whatsapp && lead.whatsapp.trim() !== '');
    if (met) total += c.tem_whatsapp.points;
    details.push({ label: 'WhatsApp preenchido', points: c.tem_whatsapp.points, met });
  }

  return { total: Math.min(100, Math.max(0, total)), details };
}

export function scoreToEtiqueta(
  score: number,
  thresholds: ScoringThresholds
): string | null {
  if (score >= thresholds.hotlead) return 'hotlead';
  if (score >= thresholds.warm) return 'warm';
  return null;
}

export async function fetchScoringConfig(): Promise<ScoringConfig | null> {
  const { data, error } = await supabase
    .from('scoring_config')
    .select('*')
    .limit(1)
    .single();
  if (error || !data) return null;
  return {
    id: data.id,
    criteria: data.criteria as unknown as ScoringCriteria,
    thresholds: data.thresholds as unknown as ScoringThresholds,
    updated_at: data.updated_at,
  };
}

export async function scoreAndUpdateLead(leadId: string, lead?: LeadForScoring): Promise<void> {
  const config = await fetchScoringConfig();
  if (!config) return;

  let leadData = lead;
  if (!leadData) {
    const { data } = await supabase
      .from('leads')
      .select('id, cargo, faturamento, funcionarios, desafios, utm_source, source, whatsapp')
      .eq('id', leadId)
      .single();
    if (!data) return;
    leadData = data as LeadForScoring;
  }

  const { total } = await calculateLeadScore(leadData, config);
  const etiqueta = scoreToEtiqueta(total, config.thresholds);

  await supabase.from('leads').update({
    lead_score: total,
    etiqueta,
  }).eq('id', leadId);
}
