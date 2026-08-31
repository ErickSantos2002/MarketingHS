import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Building2, User, Flame } from 'lucide-react';
import type { EnrichedLead } from '@/hooks/useLeadQualification';
import { getPriorityColor, getQualificationColor } from '@/hooks/useLeadQualification';
import { LeadDetailModal } from './LeadDetailModal';

interface LeadsListSheetProps {
  leads: EnrichedLead[];
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LeadsListSheet({ leads, title, open, onOpenChange }: LeadsListSheetProps) {
  const [selectedLead, setSelectedLead] = useState<EnrichedLead | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const handleLeadClick = (lead: EnrichedLead) => {
    setSelectedLead(lead);
    setModalOpen(true);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-md p-0 gap-0 bg-gradient-to-br from-card via-card to-primary/5 border-border/50">
          <SheetHeader className="p-6 pb-4 border-b border-border/50">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-lg font-bold flex items-center gap-2">
                <Flame className="h-5 w-5 text-primary" />
                {title}
              </SheetTitle>
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                {leads.length} leads
              </Badge>
            </div>
          </SheetHeader>

          <ScrollArea className="h-[calc(100vh-100px)]">
            <div className="p-4 space-y-3">
              {leads.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <User className="h-12 w-12 mx-auto mb-4 opacity-30" />
                  <p>Nenhum lead encontrado</p>
                </div>
              ) : (
                leads.map((lead) => (
                  <button
                    key={lead.id}
                    onClick={() => handleLeadClick(lead)}
                    className="w-full text-left p-4 rounded-lg bg-muted/30 border border-border/30 hover:bg-muted/50 hover:border-primary/30 transition-all duration-200 group cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-foreground truncate group-hover:text-primary transition-colors">
                          {lead.nome || 'Sem nome'}
                        </div>
                        {lead.empresa && (
                          <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1">
                            <Building2 className="h-3.5 w-3.5 flex-shrink-0" />
                            <span className="truncate">{lead.empresa}</span>
                          </div>
                        )}
                        {lead.cargo && (
                          <div className="text-xs text-muted-foreground mt-1 truncate">
                            {lead.cargo}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                        <Badge 
                          variant="outline" 
                          className={`${getPriorityColor(lead.priorityLevel)} text-xs font-bold`}
                        >
                          {lead.priorityLevel}
                        </Badge>
                        <Badge 
                          variant="outline" 
                          className={`${getQualificationColor(lead.qualification)} text-xs capitalize`}
                        >
                          {lead.qualification}
                        </Badge>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <LeadDetailModal
        lead={selectedLead}
        open={modalOpen}
        onOpenChange={setModalOpen}
      />
    </>
  );
}
