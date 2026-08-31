import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { LayoutTemplate, Pencil } from 'lucide-react';
import { applySampleMergeTags } from '@/lib/emailPreview';

// Area de visualizacao do HTML de um template de email. Extraido de
// /templates/:id/preview para ser reusado tambem no modal aberto pelo bloco
// "Enviar email" do builder de fluxos -- os dois precisam do mesmo iframe,
// mesmas larguras de viewport e mesmo empty state.

export type Viewport = 'desktop' | 'mobile';

const VIEWPORT_WIDTH: Record<Viewport, string> = {
  desktop: '700px',
  mobile: '375px',
};

interface Props {
  html: string | null | undefined;
  title?: string;
  viewport: Viewport;
  /** Quando passado, o empty state ganha um botao "Editar template". */
  onEdit?: () => void;
  /** Texto do empty state. O default fala em template; quem exibe outra coisa
   *  (o wizard de campanhas, por exemplo) passa a sua propria frase. */
  emptyLabel?: string;
}

export function EmailTemplateFrame({
  html,
  title,
  viewport,
  onEdit,
  emptyLabel = 'Este template ainda não tem conteúdo',
}: Props) {
  // As merge tags sao trocadas pelos samples so na exibicao (ver emailPreview.ts)
  // -- o HTML salvo no banco continua com {{nome}} etc. intactos.
  const previewHtml = useMemo(() => (html ? applySampleMergeTags(html) : ''), [html]);

  if (!previewHtml) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <LayoutTemplate className="h-10 w-10 opacity-40" />
        <p>{emptyLabel}</p>
        {onEdit && (
          <Button variant="outline" onClick={onEdit}>
            <Pencil className="h-4 w-4 mr-2" /> Editar template
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      className="w-full h-full bg-white rounded-lg border overflow-hidden shadow-sm transition-[max-width] duration-200"
      style={{ maxWidth: VIEWPORT_WIDTH[viewport] }}
    >
      {/* Altura 100% do container: o proprio iframe rola por dentro, sem
          precisar medir o conteudo. sandbox="allow-same-origin" e o padrao
          ja usado em Templates.tsx/CampaignWizard.tsx e, sem
          allow-top-navigation, impede que links do email naveguem a aba. */}
      <iframe
        srcDoc={previewHtml}
        title={title || 'Visualização do template'}
        className="w-full h-full border-0"
        sandbox="allow-same-origin"
      />
    </div>
  );
}
