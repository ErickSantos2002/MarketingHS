import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Monitor, Smartphone, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTemplates, type EmailTemplate } from '@/hooks/useTemplates';
import { EmailTemplateFrame, type Viewport } from '@/components/admin/campaigns/EmailTemplateFrame';
import { SendTestEmailPopover } from '@/components/admin/campaigns/SendTestEmailPopover';

// Pagina de visualizacao de template, aberta em NOVA ABA pelo menu de contexto
// em /templates. Fica FORA do AdminLayout de proposito (ver a rota irma em
// App.tsx): a aba nova deve mostrar so o email, sem a sidebar do admin.
//
// O iframe e o envio de teste vivem em componentes compartilhados com o modal
// de visualizacao do builder de fluxos (EmailTemplatePreviewDialog).

export default function TemplatePreview() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getTemplate } = useTemplates();

  const [template, setTemplate] = useState<EmailTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewport, setViewport] = useState<Viewport>('desktop');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      const t = await getTemplate(id);
      if (cancelled) return;
      if (!t) {
        toast.error('Template não encontrado');
        navigate('/templates', { replace: true });
        return;
      }
      setTemplate(t);
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // A aba foi aberta com window.open, entao window.close() funciona. O fallback
  // cobre quem chegou pela URL direta (navegador bloqueia close() nesse caso).
  const handleClose = () => {
    window.close();
    navigate('/templates');
  };

  if (loading) {
    return (
      <div className="h-screen flex flex-col gap-4 p-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="flex-1 w-full" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-muted/30">
      <header className="shrink-0 border-b bg-background px-4 py-3 flex items-center gap-3 flex-wrap">
        <div className="min-w-0 flex-1 flex items-center gap-2">
          <p className="font-medium truncate">{template?.name}</p>
          {template?.category && <Badge variant="outline" className="text-xs shrink-0">{template.category}</Badge>}
        </div>

        <ToggleGroup
          type="single"
          value={viewport}
          onValueChange={(v) => v && setViewport(v as Viewport)}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="desktop" aria-label="Visualizar em desktop">
            <Monitor className="h-4 w-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="mobile" aria-label="Visualizar em mobile">
            <Smartphone className="h-4 w-4" />
          </ToggleGroupItem>
        </ToggleGroup>

        {id && <SendTestEmailPopover templateId={id} templateName={template?.name} />}

        <Button variant="outline" size="sm" onClick={() => navigate(`/templates/${id}/edit`)} className="gap-1.5">
          <Pencil className="h-4 w-4" /> Editar template
        </Button>

        <Button variant="ghost" size="icon" onClick={handleClose} aria-label="Fechar visualização">
          <X className="h-4 w-4" />
        </Button>
      </header>

      <main className="flex-1 min-h-0 flex justify-center p-4">
        <EmailTemplateFrame
          html={template?.html}
          title={template?.name}
          viewport={viewport}
          onEdit={() => navigate(`/templates/${id}/edit`)}
        />
      </main>
    </div>
  );
}
