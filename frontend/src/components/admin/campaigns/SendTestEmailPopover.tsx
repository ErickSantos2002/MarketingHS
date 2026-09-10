import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Send, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { enviarEmailDeTeste } from '@/lib/campanhas';
import { ErroApi } from '@/lib/api';

// Botao + popover de "Enviar teste" de um template de email. Extraido de
// /templates/:id/preview para ser reusado no modal de visualizacao aberto pelo
// builder de fluxos. Funciona aninhado dentro de um Dialog do Radix.

// Checagem de formato apenas. NAO trocar pela validacao da captura de lead
// (POST /publico/validar-email): aquela tambem rejeita dominios descartaveis,
// e o destinatario de um email de teste e escolha do admin -- inclusive um
// endereco temporario, de proposito.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
  templateId: string;
  templateName?: string;
}

export function SendTestEmailPopover({ templateId, templateName }: Props) {
  const { user } = useAuth();

  const [open, setOpen] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [sending, setSending] = useState(false);

  // Pre-preenche com o email do admin logado: o caso de uso dominante e "quero
  // ver como isso chega na minha caixa de entrada".
  useEffect(() => {
    if (user?.email) setTestEmail(user.email);
  }, [user?.email]);

  const handleSendTest = async () => {
    const to = testEmail.trim();
    if (!EMAIL_RE.test(to)) {
      toast.error('Informe um email válido');
      return;
    }

    setSending(true);
    try {
      await enviarEmailDeTeste(templateId, to);
    } catch (e) {
      // ⚠️ A mensagem do servidor é a útil e precisa aparecer inteira: sem a
      // chave do Resend vem um 503 explicando que o envio ainda não está
      // configurado, e isso é decisão em aberto, não defeito. Um genérico
      // mandaria o usuário caçar bug onde não há.
      toast.error(e instanceof ErroApi ? e.message
                  : 'Não foi possível enviar o email de teste');
      return;
    } finally {
      setSending(false);
    }

    toast.success(`Email de teste enviado para ${to}`);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Send className="h-4 w-4" /> Enviar teste
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="test-email">Enviar email de teste para</Label>
          <Input
            id="test-email"
            type="email"
            value={testEmail}
            onChange={e => setTestEmail(e.target.value)}
            placeholder="voce@empresa.com"
            onKeyDown={e => { if (e.key === 'Enter' && !sending) handleSendTest(); }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          O assunto será "[Teste] {templateName}" e as merge tags saem com valores de exemplo.
        </p>
        <Button onClick={handleSendTest} disabled={sending} className="w-full gap-1.5">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Enviar
        </Button>
      </PopoverContent>
    </Popover>
  );
}
