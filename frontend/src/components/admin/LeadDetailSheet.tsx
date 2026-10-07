import { useEffect, useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import {
  User, Building2, Briefcase, DollarSign, Users, MessageSquare,
  Globe, Link, Calendar, Copy, Check, Mail, Phone,
  Target, Flame, TrendingUp, Clock, ArrowDownCircle, Tag, RefreshCw,
  StickyNote, History, Send, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { enviarAoComercial, GROWTHHS_NAO_CONFIGURADO, useCrmEstado } from '@/lib/crm';
import { useAuth } from '@/hooks/useAuth';
import type { Lead } from '@/hooks/useLeads';
import type { EnrichedLead, TagInfo } from '@/hooks/useContactsEnriched';
import {
  enrichLeadWithQualification,
  getQualificationColor,
} from '@/hooks/useLeadQualification';
import { pontuacaoDoBanco, rotuloDaEtiqueta } from './dashboard/pontuacao';
import { conversoesDoContato } from '@/lib/leitura';
import { DniaIdChip, GrowthHSLink, StatusTagsSection, NotesSection } from './contacts/DetailSections';
import { EventsTimeline } from './contacts/EventsTimeline';
import { EcosystemPills } from './contacts/EcosystemPills';
import { QualifiedBanner } from './contacts/QualifiedBanner';
import { calculateLeadScore, fetchScoringConfig, type ScoreBreakdown, type ScoringConfig } from '@/lib/leadScoring';

interface LeadDetailSheetProps {
  lead: Lead | EnrichedLead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allTags?: TagInfo[];
  onDataChanged?: () => void;
}

interface Conversion {
  id: string;
  lead_id: string;
  tipo: string | null;
  converted_at: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  page_slug: string | null;
  session_id: string | null;
}

interface TimelineEventData {
  id: string;
  date: string;
  tipo: string | null;
  isFirstEvent: boolean;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  page_slug: string | null;
}

export function LeadDetailSheet({ lead, open, onOpenChange, allTags = [], onDataChanged }: LeadDetailSheetProps) {
  const { isAdmin } = useAuth();
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [conversions, setConversions] = useState<Conversion[]>([]);
  const [loadingConversions, setLoadingConversions] = useState(false);
  const [scoreBreakdown, setScoreBreakdown] = useState<ScoreBreakdown | null>(null);
  const [enviandoAoComercial, setEnviandoAoComercial] = useState(false);
  const { configurado: crmConfigurado } = useCrmEstado();

  // Cast to enriched if available
  const enrichedLead = lead ? {
    ...lead,
    dnia_id: (lead as any).dnia_id ?? null,
    phone_normalized: (lead as any).phone_normalized ?? null,
    status: (lead as any).status ?? 'Lead',
    ecosystem: (lead as any).ecosystem,
    tags: (lead as any).tags ?? [],
  } as EnrichedLead : null;

  const refreshScore = async () => {
    if (!lead) return;
    const config = await fetchScoringConfig();
    if (config) {
      const bd = await calculateLeadScore({
        id: lead.id,
        cargo: lead.cargo ?? null,
        faturamento: lead.faturamento ?? null,
        funcionarios: (lead as any).funcionarios ?? null,
        desafios: lead.desafios ?? null,
        utm_source: lead.utm_source ?? null,
        source: lead.source ?? null,
        whatsapp: lead.whatsapp ?? null,
      }, config);
      setScoreBreakdown(bd);
    }
  };

  useEffect(() => {
    if (open && lead) {
      fetchConversions(lead.id);
      refreshScore();
    }
    if (!open) {
      setConversions([]);
      setScoreBreakdown(null);
    }
  }, [open, lead?.id]);

  const fetchConversions = async (leadId: string) => {
    setLoadingConversions(true);
    try {
      const data = await conversoesDoContato(leadId);
      setConversions(data as never[]);
    } catch {
      toast.error('Erro ao carregar histórico');
    } finally {
      setLoadingConversions(false);
    }
  };

  const timelineEvents = useMemo((): TimelineEventData[] => {
    if (!lead) return [];

    const events: TimelineEventData[] = [];
    const createdTime = lead.created_at ? new Date(lead.created_at).getTime() : 0;

    for (const conv of conversions) {
      const convTime = new Date(conv.converted_at).getTime();
      const isDuplicate = Math.abs(convTime - createdTime) < 60000;
      if (isDuplicate) continue;

      events.push({
        id: conv.id,
        date: conv.converted_at,
        tipo: conv.tipo,
        isFirstEvent: false,
        utm_source: conv.utm_source,
        utm_medium: conv.utm_medium,
        utm_campaign: conv.utm_campaign,
        utm_term: conv.utm_term,
        utm_content: conv.utm_content,
        page_slug: conv.page_slug,
      });
    }

    events.push({
      id: 'created',
      date: lead.created_at || '',
      tipo: lead.tipo,
      isFirstEvent: true,
      utm_source: lead.utm_source,
      utm_medium: lead.utm_medium,
      utm_campaign: lead.utm_campaign,
      utm_term: lead.utm_term,
      utm_content: lead.utm_content || null,
      page_slug: null,
    });

    return events.sort((a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }, [conversions, lead]);

  const isReconverted = timelineEvents.length > 1;

  if (!lead || !enrichedLead) return null;

  const enriched = enrichLeadWithQualification(lead);

  const handleCopy = async (value: string, field: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      toast.success('Copiado!');
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast.error('Erro ao copiar');
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-w-2xl max-h-[90vh] p-0 gap-0">
        {/* Header */}
        <DialogHeader className="p-6 pb-4 border-b border-border/50">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-xl font-bold truncate">
                {lead.nome || 'Sem nome'}
              </DialogTitle>
              {lead.empresa && (
                <p className="text-muted-foreground mt-1 truncate">{lead.empresa}</p>
              )}
              {/* ID do contato + Ecosystem pills + GrowthHS link */}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <DniaIdChip dniaId={enrichedLead.dnia_id} />
                <EcosystemPills
                  hasGrowthHS={!!enrichedLead.ecosystem?.growthhs_card_id}
                  size={12}
                />
                <GrowthHSLink growthhsCardUrl={enrichedLead.ecosystem?.growthhs_card_url ?? null} />
                {/* Botão manual, admin-only (POST /crm/enviar/{lead_id} — a
                    rota é `Depends(admin_atual)`). Vale para QUALQUER contato,
                    seja qual for a etiqueta (R5, 05/10/2026): antes só aparecia
                    para `hotlead`, mas o backend nunca restringiu e o comercial
                    pode querer um lead que a pontuação ainda não marcou. O
                    `QualifiedBanner` continua como destaque do qualificado. Entra na mesma fila que a
                    regra e a jornada usam (crm_handoffs); o backend responde
                    `ja_na_fila` quando o lead já está lá, e a entrega
                    acontece em segundo plano pelo worker.
                    ⚠️ A visibilidade é "ainda não está no GrowthHS"
                    (`!growthhs_card_id`), não mais "sem agendamento no Nexus"
                    (`!nexus_contact_id`) — `nexus_contact_id` é do PRODUTO de
                    agendamento (dn.nexus) e escondia o botão de quem já tinha
                    marcado reunião mas nunca foi ao CRM. */}
                {/* Apagado não: o backend devolve 404 (`deleted_at IS NULL`). */}
                {isAdmin && !lead.deleted_at && !enrichedLead.ecosystem?.growthhs_card_id && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10"
                    disabled={enviandoAoComercial}
                    onClick={async () => {
                      setEnviandoAoComercial(true);
                      try {
                        const { ja_na_fila } = await enviarAoComercial(lead.id);
                        const titulo = ja_na_fila ? 'Já estava na fila' : 'Enviado para a fila do comercial';
                        // I6 (revisão final do 8D): sem o GrowthHS ligado,
                        // o pedido só espera na fila — o aviso diz isso.
                        if (crmConfigurado === false) {
                          toast.warning(titulo, { description: GROWTHHS_NAO_CONFIGURADO });
                        } else {
                          toast.success(titulo);
                        }
                        onDataChanged?.();
                      } catch (err: any) {
                        toast.error(err?.message || 'Erro ao enviar ao comercial');
                      } finally {
                        setEnviandoAoComercial(false);
                      }
                    }}
                  >
                    {enviandoAoComercial ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                    Enviar ao comercial
                  </Button>
                )}
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0 flex-wrap justify-end items-center">
              {/* Score circle.
                  ⚠️ Guardado por `lead`, não por `scoreBreakdown`: o número é
                  do banco, e não pode depender de o cálculo do cliente ter dado
                  certo. Antes a bolinha sumia quando o detalhamento falhava —
                  escondendo o dado verdadeiro por causa do acessório. */}
              {lead && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      {/* ⚠️ O número e a etiqueta vêm do BANCO, não da conta
                          do navegador. Antes esta bolinha mostrava o total
                          recalculado em TypeScript, que discordava do valor
                          gravado: a ficha da Carla exibia 60 no cabeçalho e 22
                          aqui, ao mesmo tempo. O detalhamento abaixo continua
                          útil para dizer QUAIS critérios bateram, mas não
                          reivindica mais o total. */}
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border-2 cursor-default ${
                        lead.etiqueta === 'hotlead'
                          ? 'border-success/30 text-[--on-tint-success] bg-[--tint-success]'
                          : lead.etiqueta === 'warm'
                          ? 'border-warning/30 text-[--on-tint-warning] bg-[--tint-warning]'
                          : 'border-muted-foreground/40 text-muted-foreground bg-muted/30'
                      }`}>
                        {lead.lead_score ?? 0}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="max-w-xs">
                      <div className="space-y-1 text-xs">
                        {(scoreBreakdown?.details ?? []).map((d, i) => (
                          <div key={i} className="flex justify-between gap-4">
                            <span className={d.met ? 'text-foreground' : 'text-muted-foreground line-through'}>{d.label}</span>
                            <span className={d.met ? 'text-success font-medium' : 'text-muted-foreground'}>
                              {d.met ? `+${d.points}pts` : `${d.points}pts`}
                            </span>
                          </div>
                        ))}
                        <div className="border-t border-border/50 pt-1 mt-1 flex justify-between font-medium">
                          <span>Total (banco)</span>
                          <span>{lead.lead_score ?? 0}pts → {
                            lead.etiqueta === 'hotlead' ? 'Hotlead'
                              : lead.etiqueta === 'warm' ? 'Warm' : 'Raw'
                          }</span>
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {isReconverted && (
                <Badge variant="info" className="gap-1">
                  <RefreshCw className="h-3 w-3" />
                  Reconverteu {timelineEvents.length}x
                </Badge>
              )}
              <Badge
                variant="outline"
                className={`${getQualificationColor(enriched.qualification)} text-sm capitalize px-3 py-1`}
              >
                {enriched.qualification}
              </Badge>
            </div>
          </div>
        </DialogHeader>

        <QualifiedBanner
          status={enrichedLead.status}
          jaNoGrowthHS={!!enrichedLead.ecosystem?.growthhs_card_id}
        />

        <ScrollArea className="max-h-[calc(90vh-120px)]">
          <div className="p-6 space-y-6">
            {/* Contact */}
            <Section icon={User} title="Contato">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {lead.email && (
                  <CopyableField icon={Mail} value={lead.email} field="email" copiedField={copiedField} onCopy={handleCopy} />
                )}
                {lead.whatsapp && (
                  <CopyableField icon={Phone} value={lead.whatsapp} field="whatsapp" copiedField={copiedField} onCopy={handleCopy} />
                )}
              </div>
            </Section>

            {/* Qualification */}
            <Section icon={Target} title="Qualificação">
              <div className="grid grid-cols-3 gap-3">
                {/* Uma pontuação só (R5, 05/10/2026): aqui ficavam a
                    "Prioridade (pontos)" e a faixa P1–P4, calculadas no
                    navegador com o perfil da dn.ia — um segundo número que
                    discordava do `lead_score` (a ficha da Carla mostrava 60 na
                    bolinha e 22 aqui). Agora os dois cartões são o que o
                    banco grava pela pontuação de Configurações → Lead Scoring. */}
                <MetricCard icon={Flame} value={String(pontuacaoDoBanco(lead))} label="Pontuação" color="emerald" />
                <MetricCard icon={TrendingUp} value={rotuloDaEtiqueta(lead.etiqueta)} label="Etiqueta" color="blue" />
                <MetricCard icon={Users} value={enriched.decisionPower} label="Decisão" color="purple" small />
              </div>
            </Section>

            {/* Status & Tags - NEW */}
            <Section icon={Tag} title="Status & Tags">
              <StatusTagsSection
                lead={enrichedLead}
                allTags={allTags}
                onTagsChanged={() => {
                  onDataChanged?.();
                  // Refresh score after a short delay to let DB update
                  setTimeout(refreshScore, 500);
                }}
              />
            </Section>

            {/* Company */}
            <Section icon={Building2} title="Empresa">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <InfoCard icon={Building2} label="Empresa" value={lead.empresa} />
                <InfoCard icon={Briefcase} label="Cargo" value={lead.cargo} />
                <InfoCard icon={DollarSign} label="Faturamento" value={lead.faturamento} />
                <InfoCard icon={Users} label="Funcionários" value={lead.funcionarios} />
              </div>
            </Section>

            {/* Challenges */}
            {lead.desafios && (
              <Section icon={MessageSquare} title="Desafios">
                <div className="p-4 rounded-lg bg-muted/30 border border-border/30">
                  <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                    {lead.desafios}
                  </p>
                </div>
              </Section>
            )}

            {/* Notes - NEW */}
            <Section icon={StickyNote} title="Notas">
              <NotesSection leadId={lead.id} />
            </Section>

            {/* Interaction Timeline (existing conversions) */}
            <Section
              icon={Clock}
              title="Timeline de Conversões"
              badge={
                !loadingConversions
                  ? `${timelineEvents.length} interaç${timelineEvents.length === 1 ? 'ão' : 'ões'}`
                  : undefined
              }
            >
              {loadingConversions ? (
                <div className="space-y-4">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="flex gap-3">
                      <Skeleton className="h-4 w-4 rounded-full flex-shrink-0 mt-1" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-48" />
                        <Skeleton className="h-3 w-40" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="relative">
                  {timelineEvents.map((evt, idx) => (
                    <ConversionTimelineEvent
                      key={evt.id}
                      event={evt}
                      isLastItem={idx === timelineEvents.length - 1}
                      formatDate={formatDate}
                    />
                  ))}
                </div>
              )}

              {!loadingConversions && timelineEvents.length > 1 && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-3 pt-3 border-t border-border/30">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-primary ring-2 ring-primary/20" />
                    <span>Primeiro cadastro</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-muted-foreground/40 ring-1 ring-muted-foreground/10" />
                    <span>Reconversão</span>
                  </div>
                </div>
              )}
            </Section>

            {/* Contact Events Timeline - NEW */}
            <Section icon={History} title="Histórico de Interações">
              <EventsTimeline
                leadId={lead.id}
                dniaId={enrichedLead.dnia_id}
              />
            </Section>

            {/* Current Source / UTMs */}
            <Section icon={Globe} title="Origem Atual">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <InfoCard icon={Tag} label="Tipo" value={lead.tipo} />
                <InfoCard icon={Globe} label="Source" value={lead.source} />
                <InfoCard icon={Link} label="UTM Source" value={lead.utm_source} />
                <InfoCard icon={Link} label="UTM Medium" value={lead.utm_medium} />
                <InfoCard icon={Link} label="UTM Campaign" value={lead.utm_campaign} />
                <InfoCard icon={Link} label="UTM Term" value={lead.utm_term} />
                <InfoCard icon={Link} label="UTM Content" value={lead.utm_content} />
              </div>
            </Section>

            {/* Metadata */}
            <Section icon={Calendar} title="Metadados">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <InfoCard icon={Calendar} label="Criado em" value={formatDate(lead.created_at)} />
                {lead.etiqueta && <InfoCard icon={Tag} label="Etiqueta" value={lead.etiqueta} />}
              </div>
            </Section>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Sub-components ─── */

function Section({
  icon: Icon,
  title,
  badge,
  children,
}: {
  icon: React.ElementType;
  title: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <Icon className="h-4 w-4" />
          {title}
        </h3>
        {badge && (
          <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">
            {badge}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function InfoCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;
  return (
    <div className="p-3 rounded-lg bg-muted/20 border border-border/20">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="text-sm font-medium text-foreground truncate" title={value}>
        {value}
      </div>
    </div>
  );
}

function CopyableField({
  icon: Icon,
  value,
  field,
  copiedField,
  onCopy,
}: {
  icon: React.ElementType;
  value: string;
  field: string;
  copiedField: string | null;
  onCopy: (value: string, field: string) => void;
}) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/30">
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <span className="truncate text-sm">{value}</span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 flex-shrink-0"
        onClick={() => onCopy(value, field)}
      >
        {copiedField === field ? (
          <Check className="h-3.5 w-3.5 text-success" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  value,
  label,
  color,
  small,
}: {
  icon: React.ElementType;
  value: string;
  label: string;
  color: 'emerald' | 'blue' | 'purple';
  small?: boolean;
}) {
  // Sem gradiente: cartão de tinta lisa (Decisão 4 do G1 — a cor carrega o
  // tipo da métrica). Ícone (~20px) fica na cor cheia, dentro do que a
  // Decisão 1 permite para ícone.
  const colorMap: Record<'emerald' | 'blue' | 'purple', { card: string; icon: string }> = {
    emerald: { card: 'bg-[--tint-success] border-success/30', icon: 'text-success' },
    blue: { card: 'bg-[--tint-info] border-info/30', icon: 'text-info' },
    purple: { card: 'bg-[--tint-primary] border-primary/30', icon: 'text-primary' },
  };
  return (
    <div className={`p-4 rounded-lg border text-center ${colorMap[color].card}`}>
      <Icon className={`h-5 w-5 ${colorMap[color].icon} mx-auto mb-1`} />
      <div className={`${small ? 'text-sm' : 'text-2xl'} font-bold text-foreground ${small ? 'truncate' : ''}`}>
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

const PAGE_SLUG_LABELS: Record<string, string> = {
  "convidado": "Modal Evento 24-25fev",
  "modal-evento-24-25fev": "Modal Evento 24-25fev",
  "gratuito": "Modal Gratuito",
  "modal-gratuito-24-25fev": "Modal Gratuito 24-25fev",
  "linkaula": "Link Aula",
};

function getPageSlugLabel(slug: string): string {
  return PAGE_SLUG_LABELS[slug] || slug;
}

function ConversionTimelineEvent({
  event,
  isLastItem,
  formatDate,
}: {
  event: TimelineEventData;
  isLastItem: boolean;
  formatDate: (d: string | null) => string;
}) {
  const utmParts = [
    event.utm_campaign && `Campaign: ${event.utm_campaign}`,
    event.utm_source && `Source: ${event.utm_source}`,
    event.utm_medium && `Medium: ${event.utm_medium}`,
    event.utm_term && `Term: ${event.utm_term}`,
    event.utm_content && `Content: ${event.utm_content}`,
  ].filter(Boolean);

  return (
    <div className="flex gap-3 pb-4 last:pb-0">
      <div className="flex flex-col items-center">
        <div
          className={`w-3 h-3 rounded-full flex-shrink-0 mt-1.5 ${
            event.isFirstEvent
              ? 'bg-primary ring-4 ring-primary/20'
              : 'bg-muted-foreground/40 ring-2 ring-muted-foreground/10'
          }`}
        />
        {!isLastItem && <div className="w-px flex-1 bg-border/50 mt-1" />}
      </div>

      <div className="flex-1 min-w-0 pb-2">
        <div className="text-sm font-medium text-foreground">
          {formatDate(event.date)}
        </div>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <Badge variant="outline" className="text-xs">
            {event.isFirstEvent ? 'Primeiro cadastro' : 'Reconversão'}
          </Badge>
          {event.tipo && (
            <Badge variant="secondary" className="text-xs">
              {event.tipo}
            </Badge>
          )}
          {event.page_slug && (
            <Badge variant="outline" className="text-xs bg-muted/30">
              <ArrowDownCircle className="h-3 w-3 mr-1" />
              {getPageSlugLabel(event.page_slug)}
            </Badge>
          )}
        </div>
        {utmParts.length > 0 && (
          <div className="text-xs text-muted-foreground mt-1.5 space-x-2">
            {utmParts.map((part, i) => (
              <span key={i}>{part}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
