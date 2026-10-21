// Números das páginas e dos formulários de site: visitas, visitantes únicos,
// conversões e taxa, por canal (prova de substituição do RD, Tarefa 5).
//
// ⚠️ A agregação é no servidor. A tela não soma nem divide: a taxa vem pronta
// (conversões ÷ visitantes únicos) e `null` quer dizer "sem visitante no
// período" — que é diferente de 0%.
import { api } from '@/lib/api';

export type NumerosPorCanal = {
  canal: string;
  visitas?: number;
  visitantes: number;
  conversoes: number;
  taxa: number | null;
};

export type NumerosDaPagina = {
  slug: string;
  nome: string;
  visitas: number;
  visitantes: number;
  conversoes: number;
  taxa: number | null;
  por_canal: NumerosPorCanal[];
};

export type NumerosDoFormulario = {
  site_id: string;
  site_nome: string;
  form_id: string;
  page_path: string;
  visitantes: number;
  conversoes: number;
  taxa: number | null;
  por_canal: NumerosPorCanal[];
};

export type NumerosDoPeriodo = {
  de: string;
  ate: string;
  paginas: NumerosDaPagina[];
  formularios: NumerosDoFormulario[];
};

export const lerNumeros = (de: string, ate: string) =>
  api.get<NumerosDoPeriodo>(
    `/paginas/numeros?de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`);

/** `0.5` → "50,0%"; `null` → "—" (sem visitante no período). */
export function formatarTaxa(taxa: number | null): string {
  if (taxa === null || taxa === undefined || !Number.isFinite(taxa)) return '—';
  return `${(taxa * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

const NOME_DO_CANAL: Record<string, string> = {
  pago: 'Pago',
  social: 'Social',
  email: 'E-mail',
  organico: 'Orgânico',
  referencia: 'Referência',
  direto: 'Direto',
  desconhecido: 'Desconhecido',
};

export const nomeDoCanal = (canal: string) => NOME_DO_CANAL[canal] ?? canal;

/** Dia civil de Brasília (`AAAA-MM-DD`) — é a régua do servidor. */
function diaEmBrasilia(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/** Os últimos `dias` dias, hoje incluído: `ate` é inclusivo no servidor. */
export function periodoDosUltimos(dias: number, agora: Date = new Date()): { de: string; ate: string } {
  const ate = diaEmBrasilia(agora);
  const [a, m, d] = ate.split('-').map(Number);
  const inicio = new Date(Date.UTC(a, m - 1, d - (dias - 1)));
  return { de: inicio.toISOString().slice(0, 10), ate };
}

/** `2026-10-21` → `21/10/2026`. */
export function formatarDia(dia: string): string {
  const [a, m, d] = dia.split('-');
  return a && m && d ? `${d}/${m}/${a}` : dia;
}
