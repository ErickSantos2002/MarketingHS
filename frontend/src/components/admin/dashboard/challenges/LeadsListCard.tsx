import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { List, Building2, Briefcase, DollarSign } from 'lucide-react';
import type { Lead } from '@/hooks/useLeads';

interface LeadsListCardProps {
  leads: Lead[];
}

export function LeadsListCard({ leads }: LeadsListCardProps) {
  // Filter leads that have desafios
  const leadsWithChallenges = leads.filter(lead => lead.desafios?.trim());

  return (
    <Card className="bg-gradient-to-br from-card via-card to-primary/10 border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <div className="p-2 rounded-lg bg-primary/20">
            <List className="h-5 w-5 text-primary" />
          </div>
          Lista de Leads com Desafios
          <span className="text-sm font-normal text-muted-foreground ml-2">
            ({leadsWithChallenges.length} leads)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[500px] pr-4">
          <div className="space-y-4">
            {leadsWithChallenges.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                Nenhum lead com desafios registrados
              </div>
            ) : (
              leadsWithChallenges.map((lead) => (
                <div
                  key={lead.id}
                  className="p-4 rounded-xl bg-muted/30 border border-border/30 hover:border-primary/30 transition-colors space-y-3"
                >
                  {/* Header: Nome */}
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-foreground">
                      {lead.nome || 'Nome não informado'}
                    </h4>
                  </div>

                  {/* Desafio */}
                  <p className="text-sm text-muted-foreground leading-relaxed italic">
                    "{lead.desafios}"
                  </p>

                  {/* Meta info */}
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    {lead.cargo && (
                      <div className="flex items-center gap-1.5 bg-background/50 px-2 py-1 rounded-md">
                        <Briefcase className="h-3 w-3 text-primary/70" />
                        <span>{lead.cargo}</span>
                      </div>
                    )}
                    {lead.empresa && (
                      <div className="flex items-center gap-1.5 bg-background/50 px-2 py-1 rounded-md">
                        <Building2 className="h-3 w-3 text-primary/70" />
                        <span>{lead.empresa}</span>
                      </div>
                    )}
                    {lead.faturamento && (
                      <div className="flex items-center gap-1.5 bg-background/50 px-2 py-1 rounded-md">
                        <DollarSign className="h-3 w-3 text-primary/70" />
                        <span>{lead.faturamento}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
