// Status da campanha → rótulo e cor. Era um mapa copiado em Campaigns.tsx e
// CampaignDetail.tsx; um só lugar evita que as duas telas pintem o mesmo
// status de cores diferentes. Tradução por significado: agendada é destaque
// (o DS não tem roxo), enviando é informação em andamento.
export const STATUS_DE_CAMPANHA: Record<string, { label: string; className: string }> = {
  draft: { label: 'Rascunho', className: 'bg-muted text-muted-foreground' },
  scheduled: { label: 'Agendada', className: 'bg-[--tint-primary] text-[--on-tint-primary] border-primary/30' },
  sending: { label: 'Enviando...', className: 'bg-[--tint-info] text-[--on-tint-info] border-info/30' },
  sent: { label: 'Enviada', className: 'bg-[--tint-success] text-[--on-tint-success] border-success/30' },
  paused: { label: 'Pausada', className: 'bg-[--tint-warning] text-[--on-tint-warning] border-warning/30' },
  failed: { label: 'Falhou', className: 'bg-[--tint-danger] text-[--on-tint-danger] border-danger/30' },
};
