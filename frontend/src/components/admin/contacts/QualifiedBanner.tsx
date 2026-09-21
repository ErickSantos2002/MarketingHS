import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';

interface Props {
  status: string | null;
  leadId: string;
  onSent?: () => void;
}

export function QualifiedBanner({ status, leadId, onSent }: Props) {
  const { isAdmin } = useAuth();
  const [enviando, setEnviando] = useState(false);

  if (status !== 'Lead Qualificado') return null;

  const handleEnviar = async () => {
    setEnviando(true);
    try {
      const { ja_na_fila } = await api.post<{ handoff_id: number | null; ja_na_fila: boolean }>(
        `/crm/enviar/${leadId}`,
      );
      toast.success(ja_na_fila ? 'Já estava na fila' : 'Enviado para a fila do comercial');
      onSent?.();
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao enviar ao comercial');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="mx-6 mt-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-between gap-3">
      <p className="text-sm text-blue-400 font-medium">
        Este lead está pronto para o comercial
      </p>
      {isAdmin && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1 border-blue-500/30 text-blue-400"
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
