import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Monitor, Smartphone, Pencil, LayoutTemplate } from 'lucide-react';
import type { EmailTemplate } from '@/hooks/useTemplates';
import { EmailTemplateFrame, type Viewport } from './EmailTemplateFrame';
import { SendTestEmailPopover } from './SendTestEmailPopover';

// Modal de visualizacao de um template de email. Usado pelo bloco "Enviar
// email" do builder de fluxos, onde sair da pagina para ver o email custaria as
// edicoes nao salvas do grafo -- por isso e um modal, e por isso "Editar
// template" abre em OUTRA aba em vez de navegar.
//
// Recebe o EmailTemplate ja resolvido (nao o id): quem abre o modal ja tem a
// lista de useTemplates(), cujo select('*') traz o html. Assim o modal nao faz
// query nenhuma nem precisa de estado de loading.

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: EmailTemplate | null;
  /** Assunto do email. Vive no no do fluxo (config.subject), nao no template. */
  subject?: string;
}

export function EmailTemplatePreviewDialog({ open, onOpenChange, template, subject }: Props) {
  const [viewport, setViewport] = useState<Viewport>('desktop');

  const openEditor = () => {
    if (!template) return;
    window.open(`/templates/${template.id}/edit`, '_blank', 'noopener');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[85vh] p-0 gap-0 flex flex-col overflow-hidden">
        {/* pr-12: o DialogContent do projeto ja renderiza um X proprio em
            absolute right-4 top-4 (ver components/ui/dialog.tsx) -- sem a folga
            o botao "Editar template" fica embaixo dele. Nao adicionar um 2o X. */}
        <header className="shrink-0 border-b px-4 py-3 pr-12">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="min-w-0 flex-1 flex items-center gap-2">
              <DialogTitle className="text-sm font-medium truncate">
                {template?.name || 'Template não encontrado'}
              </DialogTitle>
              {template?.category && (
                <Badge variant="outline" className="text-xs shrink-0">{template.category}</Badge>
              )}
            </div>

            {template && (
              <>
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

                <SendTestEmailPopover templateId={template.id} templateName={template.name} />

                <Button variant="outline" size="sm" onClick={openEditor} className="gap-1.5">
                  <Pencil className="h-4 w-4" /> Editar template
                </Button>
              </>
            )}
          </div>

          {subject && (
            <p className="text-xs text-muted-foreground mt-1 truncate">Assunto: "{subject}"</p>
          )}

          <DialogDescription className="sr-only">
            Visualização do email como o contato vai receber, com as merge tags substituídas por
            valores de exemplo.
          </DialogDescription>
        </header>

        <main className="flex-1 min-h-0 flex justify-center p-4 bg-muted/30">
          {template ? (
            <EmailTemplateFrame
              html={template.html}
              title={template.name}
              viewport={viewport}
              onEdit={openEditor}
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <LayoutTemplate className="h-10 w-10 opacity-40" />
              <p>Template não encontrado</p>
            </div>
          )}
        </main>
      </DialogContent>
    </Dialog>
  );
}
