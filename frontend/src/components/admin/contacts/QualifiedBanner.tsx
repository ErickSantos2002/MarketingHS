import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { enviarAoComercial, GROWTHHS_NAO_CONFIGURADO, useCrmEstado } from '@/lib/crm';

interface Props {
  status: string | null;
  leadId: string;
  /** O contato já tem card no GrowthHS (`ecosystem.growthhs_card_id`) — o
   *  botão some, como o do cabeçalho da ficha (revisão final do 8D, M5). */
  jaNoGrowthHS?: boolean;
  onSent?: () => void;
}

export function QualifiedBanner({ status, leadId, jaNoGrowthHS = false, onSent }: Props) {
  const { isAdmin } = useAuth();
  const { configurado } = useCrmEstado();
  const [enviando, setEnviando] = useState(false);

  if (status !== 'Lead Qualificado') return null;

  const handleEnviar = async () => {
    setEnviando(true);
    try {
      const { ja_na_fila } = await enviarAoComercial(leadId);
      const titulo = ja_na_fila ? 'Já estava na fila' : 'Enviado para a fila do comercial';
      // I6: sem o GrowthHS ligado, o pedido só espera — o aviso diz isso.
      if (configurado === false) {
        toast.warning(titulo, { description: GROWTHHS_NAO_CONFIGURADO });
      } else {
        toast.success(titulo);
      }
      onSent?.();
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao enviar ao comercial');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="mx-6 mt-2 p-3 rounded-lg bg-[--tint-info] border border-info/30 flex items-center justify-between gap-3">
      <p className="text-sm text-[--on-tint-info] font-medium">
        Este lead está pronto para o comercial
      </p>
      {isAdmin && !jaNoGrowthHS && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1 border-info/30 text-[--on-tint-info]"
          disabled={enviando}
          onClick={handleEnviar}
        >
          {enviando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          Enviar ao comercial
        </Button>
      )}
    </div>
  );
}
