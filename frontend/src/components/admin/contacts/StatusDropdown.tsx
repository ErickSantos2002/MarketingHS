import { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { mudarStatus } from '@/lib/leitura';
import { toast } from 'sonner';
import { TrendingUp } from 'lucide-react';
import { useLeadStatuses } from '@/hooks/useLeadStatuses';
import { estiloDeCorDeDado } from '@/lib/corDeDado';
import { corDoStatus } from './StatusBadge';

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
  const { options } = useLeadStatuses();

  const handleChange = async (newStatus: string) => {
    const previousStatus = value;
    setValue(newStatus);

    try {
      // Status, evento na timeline e o evento específico da transição
      // acontecem numa transação só, no servidor. Antes eram três idas ao
      // banco independentes daqui, e o evento podia não ser gravado sem que
      // nada avisasse.
      await mudarStatus(leadId, newStatus);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao atualizar status');
      setValue(currentStatus || 'Lead');
      return;
    }

    if (newStatus === 'Lead Qualificado') {
      toast('Lead qualificado!', {
        description: 'Notifique o time comercial para iniciar a abordagem',
        icon: <TrendingUp className="h-4 w-4 text-success" />,
        duration: 5000,
        style: { borderLeft: '4px solid var(--color-success-600)' },
      });
    } else {
      toast.success(`Status atualizado para "${newStatus}"`);
    }

    // ⚠️ O avanço do estágio da identidade saiu daqui. O original chamava
    // resolve_or_create_identity com stage='opportunity' ao qualificar; a régua
    // de quais status avançam o estágio é decisão de produto da HS e ainda não
    // existe. Quem decidir isso, decide no servidor.

    // ⚠️ A chamada às automações saiu no lote 4B. Ela avaliava as regras no
    // navegador e chamava `handoff-to-nexus`, function que não existe mais —
    // o toast dizia "Automação executada" enquanto nada saía. A avaliação
    // voltou no lote 8D, no servidor (gatilho da migration 019), junto da
    // ação que ela dispara. Ver AUTOMACAO_COMO_FUNCIONA em lib/automacoes.

    onStatusChange?.(newStatus);
  };

  const color = corDoStatus(value);
  const items = options.length > 0 ? options : [value];

  return (
    <Select value={value} onValueChange={handleChange}>
      <SelectTrigger
        className={`${size === 'sm' ? 'h-7 text-xs px-2 w-[140px]' : 'text-sm'} border text-conteudo-heading`}
        style={estiloDeCorDeDado(color)}
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
                style={{ backgroundColor: corDoStatus(opt) }}
              />
              {opt}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
