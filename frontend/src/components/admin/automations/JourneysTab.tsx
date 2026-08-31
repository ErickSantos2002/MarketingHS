import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { GitBranch, Plus, Pencil, Trash2, Play, Pause, Archive, ArchiveRestore, Copy, Users } from 'lucide-react';
import { useJourneys } from '@/hooks/useJourneys';
import { JourneyCreateDialog } from './JourneyCreateDialog';
import { JourneyContactsDrawer } from './JourneyContactsDrawer';
import { STATUS_LABELS, readEntrySegments, type Journey } from '@/lib/journeys';
import { useSegmentAudience } from '@/hooks/useSegmentAudience';

const STATUS_VARIANT: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  active: 'bg-emerald-500/15 text-emerald-600',
  paused: 'bg-amber-500/15 text-amber-600',
  archived: 'bg-muted text-muted-foreground line-through',
};

export function JourneysTab() {
  const { journeys, loading, createJourney, updateJourney, deleteJourney } = useJourneys();
  const [showCreate, setShowCreate] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [contactsFor, setContactsFor] = useState<Journey | null>(null);
  const [confirmActivate, setConfirmActivate] = useState<Journey | null>(null);
  const [activating, setActivating] = useState(false);
  const navigate = useNavigate();

  const setStatus = (j: Journey, status: Journey['status']) => updateJourney(j.id, { status });

  const handleClone = async (j: Journey) => {
    const clone = await createJourney({
      name: `${j.name} (cópia)`,
      description: j.description ?? null,
      entry_type: j.entry_type,
      entry_config: j.entry_config ?? {},
      reentry: j.reentry,
      reentry_cooldown_hours: j.reentry_cooldown_hours,
      entry_node_id: j.entry_node_id ?? null,
      nodes: Array.isArray(j.nodes) ? j.nodes : [],
    } as Partial<Journey>);
    if (clone) navigate(`/automations/fluxos/${clone.id}`);
  };

  const handleActivateClick = (j: Journey) => {
    if (j.entry_type === 'segment') {
      setConfirmActivate(j);
      return;
    }
    setStatus(j, 'active');
  };

  const confirmSegments = confirmActivate?.entry_type === 'segment'
    ? readEntrySegments(confirmActivate.entry_config)
    : { include: [], exclude: [] };
  // Avisa, ANTES de ativar um fluxo de entrada por segmento, quantos contatos
  // serão inscritos de uma vez (um segmento amplo ativado sem aviso enfileira o
  // fluxo inteiro para toda a base — tradeoff aceito e documentado no plano da
  // Fase 6). Mesma RPC do wizard e do envio: união menos exclusão, sem contagem
  // dupla de quem está em dois segmentos.
  const { count: confirmCount } = useSegmentAudience(
    confirmSegments.include,
    confirmSegments.exclude,
    !!confirmActivate,
  );

  const handleConfirmActivate = async () => {
    if (!confirmActivate) return;
    setActivating(true);
    await setStatus(confirmActivate, 'active');
    setActivating(false);
    setConfirmActivate(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Sequências automáticas de email, espera e ramificação — os emails saem pela mesma fila das campanhas
          (supressão e descadastro valem igual).
        </p>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Novo fluxo
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}</div>
      ) : journeys.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <GitBranch className="h-12 w-12 mb-3 opacity-30" />
          <p className="text-sm font-medium">Nenhum fluxo criado</p>
          <p className="text-xs mt-1">Clique em "Novo fluxo" para começar</p>
        </div>
      ) : (
        <div className="space-y-3">
          {journeys.map((j) => (
            <Card key={j.id} className="border-border/40">
              <CardContent className="py-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold">{j.name}</span>
                    <Badge className={`text-[10px] ${STATUS_VARIANT[j.status]}`}>{STATUS_LABELS[j.status]}</Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {j.entry_type === 'segment' ? 'Entrada: segmento' : 'Entrada: evento'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {j.nodes?.length ?? 0} passo(s) · {j.runs?.active ?? 0} ativo(s) ·{' '}
                    {j.runs?.waiting ?? 0} aguardando · {j.runs?.done ?? 0} concluído(s)
                    {(j.runs?.failed ?? 0) > 0 && <span className="text-destructive"> · {j.runs?.failed} com erro</span>}
                  </p>
                </div>

                <div className="flex gap-1 flex-shrink-0">
                  <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={() => setContactsFor(j)}>
                    <Users className="h-3.5 w-3.5" /> Ver contatos
                  </Button>
                  {j.status !== 'active' && j.status !== 'archived' && (
                    <Button variant="ghost" size="sm" className="h-7 gap-1 text-emerald-600" onClick={() => handleActivateClick(j)}>
                      <Play className="h-3.5 w-3.5" /> Ativar
                    </Button>
                  )}
                  {j.status === 'active' && (
                    <Button variant="ghost" size="sm" className="h-7 gap-1 text-amber-600" onClick={() => setStatus(j, 'paused')}>
                      <Pause className="h-3.5 w-3.5" /> Pausar
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={() => handleClone(j)}>
                    <Copy className="h-3.5 w-3.5" /> Clonar
                  </Button>
                  {j.status === 'archived' && (
                    <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={() => setStatus(j, 'draft')}>
                      <ArchiveRestore className="h-3.5 w-3.5" /> Desarquivar
                    </Button>
                  )}
                  {j.status !== 'archived' && j.status !== 'draft' && (
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setStatus(j, 'archived')}>
                      <Archive className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => navigate(`/automations/fluxos/${j.id}`)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  {j.status === 'draft' && (
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => setDeleteId(j.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <JourneyCreateDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreate={createJourney}
        onCreated={(j) => navigate(`/automations/fluxos/${j.id}`)}
      />

      <JourneyContactsDrawer
        journey={contactsFor}
        open={!!contactsFor}
        onOpenChange={(o) => !o && setContactsFor(null)}
      />

      {/* Aviso obrigatório antes de ativar um fluxo com entrada por segmento:
          a ativação varre o segmento inteiro e inscreve TODOS os contatos que
          já casam com as regras — não só os que entrarem dali para frente. */}
      <AlertDialog open={!!confirmActivate} onOpenChange={(o) => !o && !activating && setConfirmActivate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ativar "{confirmActivate?.name}"?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Este fluxo entra por{' '}
                  <span className="font-medium text-foreground">
                    {confirmSegments.include.length === 1 ? 'o segmento configurado' : `${confirmSegments.include.length} segmentos`}
                  </span>
                  {confirmSegments.exclude.length > 0 && (
                    <>, excluindo <span className="font-medium text-foreground">{confirmSegments.exclude.length}</span></>
                  )}
                  . Ao ativar, <span className="font-semibold text-foreground">{confirmCount}</span>{' '}
                  contato{confirmCount === 1 ? '' : 's'} que já {confirmCount === 1 ? 'atende' : 'atendem'} às regras
                  {confirmCount === 1 ? ' será inscrito' : ' serão inscritos'} imediatamente — não é uma
                  entrada gradual, é a base inteira de uma vez.
                </p>
                <p>Confirme que é isso mesmo antes de continuar.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={activating}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 hover:bg-emerald-600/90 text-white"
              disabled={activating}
              onClick={handleConfirmActivate}
            >
              {activating ? 'Ativando...' : `Ativar e inscrever ${confirmCount}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir fluxo?</AlertDialogTitle>
            <AlertDialogDescription>
              Só rascunhos sem execuções podem ser excluídos. Fluxos que já rodaram devem ser arquivados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={async () => { if (deleteId) await deleteJourney(deleteId); setDeleteId(null); }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
