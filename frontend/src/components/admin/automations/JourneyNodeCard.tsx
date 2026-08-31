import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Mail, Clock, Hourglass, GitBranch, Users, Tag, Building2, MailCheck, Eye, Pencil, Trash2 } from 'lucide-react';
import { NODE_LABELS, type JourneyNode, type JourneyNodeMetrics, type JourneyNodeType } from '@/lib/journeys';

const NODE_ICONS: Record<JourneyNodeType, typeof Mail> = {
  send_email: Mail,
  delay: Clock,
  wait_for_event: Hourglass,
  branch_attribute: GitBranch,
  branch_segment: Users,
  branch_email_event: MailCheck,
  apply_tag: Tag,
  handoff_nexus: Building2,
};

interface Props {
  node: JourneyNode;
  summary: string;
  metrics?: JourneyNodeMetrics;
  /** Só é passado nos nós que têm o que visualizar (email com template escolhido). */
  onPreview?: () => void;
  onEdit: () => void;
  onDelete: () => void;
  canDelete?: boolean;
}

export function JourneyNodeCard({ node, summary, metrics, onPreview, onEdit, onDelete, canDelete = true }: Props) {
  const Icon = NODE_ICONS[node.type];

  return (
    <Card className="border-border/40 w-full max-w-md">
      <CardContent className="py-3 px-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">{NODE_LABELS[node.type]}</p>
            <p className="text-xs text-muted-foreground mt-0.5 break-words">{summary}</p>
          </div>
          <div className="flex gap-0.5 shrink-0">
            {onPreview && (
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onPreview} title="Visualizar email" aria-label="Visualizar email">
                <Eye className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            {canDelete && (
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={onDelete}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {metrics && (metrics.entered > 0 || metrics.emails.enqueued > 0) && (
          <div className="mt-2.5 pt-2.5 border-t border-border/30 text-[11px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
            <span>{metrics.entered} contato{metrics.entered === 1 ? '' : 's'} passou{metrics.entered === 1 ? '' : 'ram'} por aqui</span>
            {node.type === 'send_email' && metrics.emails.enqueued > 0 && (
              <span>
                {metrics.emails.sent} enviado{metrics.emails.sent === 1 ? '' : 's'} · {metrics.emails.opened} aberto{metrics.emails.opened === 1 ? '' : 's'} ·{' '}
                {metrics.emails.clicked} clique{metrics.emails.clicked === 1 ? '' : 's'}
                {metrics.emails.failed > 0 && <span className="text-destructive"> · {metrics.emails.failed} falha{metrics.emails.failed === 1 ? '' : 's'}</span>}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
