import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Send, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

// Botao + popover de "Enviar teste" de um template de email. Extraido de
// /templates/:id/preview para ser reusado no modal de visualizacao aberto pelo
// builder de fluxos. Funciona aninhado dentro de um Dialog do Radix.

// Checagem de formato apenas. NAO reusar validateEmailFormat de
// lib/emailValidation.ts aqui: aquela funcao tambem rejeita dominios
// descartaveis (higiene de captura de LEAD), e o destinatario de um email de
// teste e escolha do admin -- inclusive um endereco temporario, de proposito.
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
    const { data, error } = await supabase.functions.invoke('send-test-email', {
      body: { template_id: templateId, to },
    });
    setSending(false);

    // supabase.functions.invoke devolve `error` generico (FunctionsHttpError) em
    // qualquer status >= 400 e joga o corpo real em error.context -- sem ler esse
    // corpo, o usuario so veria "Edge Function returned a non-2xx status code" e
    // nunca a causa ("RESEND_API_KEY nao configurada", supressao, etc.).
    if (error) {
      let message = 'Não foi possível enviar o email de teste';
      try {
        const context = (error as { context?: Response }).context;
        const body = await context?.json?.();
        if (body?.error) message = String(body.error);
      } catch {
        // corpo ilegivel: fica a mensagem generica acima
      }
      toast.error(message);
      return;
    }
    if (data?.error) {
      toast.error(String(data.error));
      return;
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
