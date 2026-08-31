import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  User, Building2, Briefcase, DollarSign, Users, MessageSquare, 
  Globe, Link, Calendar, Copy, Check, Mail, Phone,
  Target, Flame, TrendingUp
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { EnrichedLead } from '@/hooks/useLeadQualification';
import { getPriorityColor, getQualificationColor } from '@/hooks/useLeadQualification';

interface LeadDetailModalProps {
  lead: EnrichedLead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LeadDetailModal({ lead, open, onOpenChange }: LeadDetailModalProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  if (!lead) return null;

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
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] p-0 gap-0 bg-gradient-to-br from-card via-card to-primary/5 border-border/50">
        <DialogHeader className="p-6 pb-4 border-b border-border/50">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-xl font-bold truncate">
                {lead.nome || 'Sem nome'}
              </DialogTitle>
              {lead.empresa && (
                <p className="text-muted-foreground mt-1 truncate">{lead.empresa}</p>
              )}
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Badge 
                variant="outline" 
                className={`${getPriorityColor(lead.priorityLevel)} text-sm font-bold px-3 py-1`}
              >
                {lead.priorityLevel}
              </Badge>
              <Badge 
                variant="outline" 
                className={`${getQualificationColor(lead.qualification)} text-sm capitalize px-3 py-1`}
              >
                {lead.qualification}
              </Badge>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(90vh-120px)]">
          <div className="p-6 space-y-6">
            {/* Contact Info */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                <User className="h-4 w-4" />
                Contato
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {lead.email && (
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/30">
                    <div className="flex items-center gap-2 min-w-0">
                      <Mail className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="truncate text-sm">{lead.email}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 flex-shrink-0"
                      onClick={() => handleCopy(lead.email!, 'email')}
                    >
                      {copiedField === 'email' ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                )}
                {lead.whatsapp && (
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/30">
                    <div className="flex items-center gap-2 min-w-0">
                      <Phone className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="truncate text-sm">{lead.whatsapp}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 flex-shrink-0"
                      onClick={() => handleCopy(lead.whatsapp!, 'whatsapp')}
                    >
                      {copiedField === 'whatsapp' ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </section>

            {/* Qualification Metrics */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                <Target className="h-4 w-4" />
                Qualificação
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="p-4 rounded-lg bg-gradient-to-br from-emerald-500/10 to-transparent border border-emerald-500/20 text-center">
                  <Flame className="h-5 w-5 text-emerald-400 mx-auto mb-1" />
                  <div className="text-2xl font-bold text-foreground">{Math.round(lead.priorityScore)}</div>
                  <div className="text-xs text-muted-foreground">Score</div>
                </div>
                <div className="p-4 rounded-lg bg-gradient-to-br from-blue-500/10 to-transparent border border-blue-500/20 text-center">
                  <TrendingUp className="h-5 w-5 text-blue-400 mx-auto mb-1" />
                  <div className="text-lg font-bold text-foreground">{lead.priorityLevel}</div>
                  <div className="text-xs text-muted-foreground">Prioridade</div>
                </div>
                <div className="p-4 rounded-lg bg-gradient-to-br from-purple-500/10 to-transparent border border-purple-500/20 text-center">
                  <Users className="h-5 w-5 text-purple-400 mx-auto mb-1" />
                  <div className="text-sm font-bold text-foreground truncate">{lead.decisionPower}</div>
                  <div className="text-xs text-muted-foreground">Decisão</div>
                </div>
              </div>
            </section>

            {/* Company Info */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Empresa
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <InfoCard icon={Building2} label="Empresa" value={lead.empresa} />
                <InfoCard icon={Briefcase} label="Cargo" value={lead.cargo} />
                <InfoCard icon={DollarSign} label="Faturamento" value={lead.faturamento} />
                <InfoCard icon={Users} label="Funcionários" value={lead.funcionarios} />
              </div>
            </section>

            {/* Challenges */}
            {lead.desafios && (
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Desafios
                </h3>
                <div className="p-4 rounded-lg bg-muted/30 border border-border/30">
                  <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                    {lead.desafios}
                  </p>
                </div>
              </section>
            )}

            {/* Source & UTMs */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                <Globe className="h-4 w-4" />
                Origem
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <InfoCard icon={Link} label="Tipo" value={lead.tipo} />
                <InfoCard icon={Globe} label="Source" value={lead.source} />
                <InfoCard icon={Link} label="UTM Source" value={lead.utm_source} />
                <InfoCard icon={Link} label="UTM Medium" value={lead.utm_medium} />
                <InfoCard icon={Link} label="UTM Campaign" value={lead.utm_campaign} />
                <InfoCard icon={Link} label="UTM Term" value={lead.utm_term} />
              </div>
            </section>

            {/* Metadata */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Metadados
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <InfoCard icon={Calendar} label="Criado em" value={formatDate(lead.created_at)} />
                <InfoCard icon={User} label="Tipo Participante" value={lead.tipo_participante} />
              </div>
            </section>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

interface InfoCardProps {
  icon: React.ElementType;
  label: string;
  value: string | null | undefined;
}

function InfoCard({ icon: Icon, label, value }: InfoCardProps) {
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
