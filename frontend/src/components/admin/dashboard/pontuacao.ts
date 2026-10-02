// A prioridade do painel vem do banco desde 02/10/2026 (raio-x RD, R6).
//
// Antes, a tabela de prioridade, a lista de leads e o detalhe mostravam P1–P4
// calculados no navegador com o perfil da dn.ia (faturamento ICP, cargo
// decisor, temas do campo desafio). Agora valem `lead_score` e `etiqueta`, que
// o banco grava pela pontuação configurada em Configurações → Lead Scoring.
//
// ⚠️ A ficha do contato (LeadDetailSheet) e o `useLeadQualification` ainda
// carregam o P1–P4 antigo: são de outra frente, ficaram anotados.

import type { Lead } from '@/hooks/useLeads';

export function pontuacaoDoBanco(lead: Pick<Lead, 'lead_score'>): number {
  return lead.lead_score ?? 0;
}

export function rotuloDaEtiqueta(etiqueta: string | null | undefined): string {
  if (etiqueta === 'hotlead') return 'Hot';
  if (etiqueta === 'warm') return 'Warm';
  return 'Raw';
}

export function corDaEtiqueta(etiqueta: string | null | undefined): string {
  if (etiqueta === 'hotlead') return 'bg-[--tint-success] text-[--on-tint-success] border-success/30';
  if (etiqueta === 'warm') return 'bg-[--tint-warning] text-[--on-tint-warning] border-warning/30';
  return 'bg-[--tint-neutral] text-conteudo-muted border-borda';
}
