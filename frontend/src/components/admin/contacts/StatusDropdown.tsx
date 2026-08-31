import { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { TrendingUp } from 'lucide-react';
import { useLeadStatuses } from '@/hooks/useLeadStatuses';

interface StatusDropdownProps {
  leadId: string;
  currentStatus: string | null;
  onStatusChange?: (newStatus: string) => void;
  size?: 'sm' | 'default';
  leadEmail?: string | null;
  leadWhatsapp?: string | null;
  leadDniaId?: string | null;
}

export function StatusDropdown({ leadId, currentStatus, onStatusChange, size = 'sm', leadEmail, leadWhatsapp, leadDniaId }: StatusDropdownProps) {
  const [value, setValue] = useState(currentStatus || 'Lead');
  const { options, getColor } = useLeadStatuses();

  const handleChange = async (newStatus: string) => {
    const previousStatus = value;
    setValue(newStatus);
    const { error } = await supabase
      .from('leads')
      .update({ status: newStatus } as any)
      .eq('id', leadId);

    if (error) {
      toast.error('Erro ao atualizar status');
      setValue(currentStatus || 'Lead');
      return;
    }

    if (newStatus === 'Lead Qualificado') {
      // Handoff: advance stage to opportunity
      try {
        await supabase.rpc('resolve_or_create_identity', {
          p_phone: leadWhatsapp || null,
          p_email: leadEmail || null,
          p_source_app: 'dndash',
          p_local_id: leadId,
          p_stage: 'opportunity',
        });
      } catch (e) {
        console.error('Failed to advance stage:', e);
      }

      // Register timeline event
      try {
        await supabase.from('contact_events').insert({
          lead_id: leadId,
          dnia_id: leadDniaId || null,
          source_app: 'dnmarketing',
          event_type: 'lead_qualified',
          title: 'Lead qualificado para o Nexus',
          description: 'Pronto para abordagem comercial',
          metadata: { qualified_by: 'manual', status_anterior: previousStatus },
        });
      } catch (e) {
        console.error('Failed to register qualification event:', e);
      }

      toast('Lead qualificado!', {
        description: 'Notifique o time comercial para iniciar a abordagem',
        icon: <TrendingUp className="h-4 w-4 text-emerald-500" />,
        duration: 5000,
        style: { borderLeft: '4px solid #3B6D11' },
      });
    } else {
      toast.success(`Status atualizado para "${newStatus}"`);
    }

    // Fire-and-forget: evaluate automation rules
    import('@/lib/automationEngine').then(async ({ evaluateAndExecute }) => {
      try {
        const { data: freshLead } = await supabase.from('leads').select('id, status, etiqueta, lead_score, dnia_id').eq('id', leadId).single();
        if (freshLead) {
          const ruleName = await evaluateAndExecute(freshLead);
          if (ruleName) toast.success(`Automação executada: ${ruleName}`);
        }
      } catch (e) {
        console.error('Automation evaluation failed:', e);
      }
    }).catch(() => {});

    onStatusChange?.(newStatus);
  };

  const color = getColor(value);
  const items = options.length > 0 ? options : [value];

  return (
    <Select value={value} onValueChange={handleChange}>
      <SelectTrigger
        className={`${size === 'sm' ? 'h-7 text-xs px-2 w-[140px]' : 'h-9 text-sm'} border`}
        style={{ borderColor: `${color}60`, color }}
        onClick={(e) => e.stopPropagation()}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map(opt => (
          <SelectItem key={opt} value={opt}>
            <div className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: getColor(opt) }}
              />
              {opt}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
