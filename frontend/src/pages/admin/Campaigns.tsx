import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus, Send, Mail, MessageCircle, MoreHorizontal, Copy, Trash2, Eye, Loader2, Users, BarChart2, MousePointerClick, CalendarX, Pencil, FileText } from 'lucide-react';
import { useCampaigns, type Campaign } from '@/hooks/useCampaigns';
import { BRASILIA_TIMEZONE } from '@/hooks/useLeadAnalytics';
import { CampaignWizard } from '@/components/admin/campaigns/CampaignWizard';
import { CampaignDetail } from '@/components/admin/campaigns/CampaignDetail';
import { formatInTimeZone } from 'date-fns-tz';

const statusConfig: Record<string, { label: string; className: string }> = {
  draft: { label: 'Rascunho', className: 'bg-muted text-muted-foreground' },
  scheduled: { label: 'Agendada', className: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
  sending: { label: 'Enviando...', className: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  sent: { label: 'Enviada', className: 'bg-green-500/15 text-green-400 border-green-500/30' },
  paused: { label: 'Pausada', className: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
  failed: { label: 'Falhou', className: 'bg-red-500/15 text-red-400 border-red-500/30' },
};

// Exibe sempre em Brasília: o wizard agenda em horário de Brasília, então a lista
// precisa falar a mesma língua — com toLocaleDateString o admin veria o horário
// deslocado para o fuso do próprio navegador e não bateria com o que ele agendou.
function formatDate(d: string | null) {
  if (!d) return '-';
  return formatInTimeZone(new Date(d), BRASILIA_TIMEZONE, 'dd/MM/yyyy HH:mm');
}

export default function Campaigns() {
  const { campaigns, loading, stats, refetch, duplicateCampaign, deleteCampaign, cancelSchedule, getCampaignStats } = useCampaigns();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [detailCampaign, setDetailCampaign] = useState<Campaign | null>(null);
  const [editCampaign, setEditCampaign] = useState<Campaign | null>(null);
  // Mesmo wizard do editCampaign, porém em modo consulta — para campanhas que já
  // saíram de draft/scheduled e não podem mais ser editadas.
  const [viewCampaign, setViewCampaign] = useState<Campaign | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);
  // Contagem real de campaign_sends da campanha-alvo, buscada ao abrir o diálogo —
  // é o que torna o aviso concreto ("apaga N registros") em vez de um genérico
  // "tem certeza?". null enquanto carrega (ou quando não há alvo).
  const [deleteSendsCount, setDeleteSendsCount] = useState<number | null>(null);
  const [deleteSendsLoading, setDeleteSendsLoading] = useState(false);

  useEffect(() => {
    if (!deleteTarget) {
      setDeleteSendsCount(null);
      return;
    }
    let cancelled = false;
    setDeleteSendsLoading(true);
    getCampaignStats(deleteTarget.id).then(s => {
      if (!cancelled) {
        setDeleteSendsCount(s.total);
        setDeleteSendsLoading(false);
      }
    });
    return () => { cancelled = true; };
    // getCampaignStats deliberadamente fora do array de dependências: useCampaigns
    // não a envolve em useCallback, então é uma closure nova a cada render — incluí-la
    // faria este efeito rodar em todo render (não só quando o alvo da exclusão muda),
    // criando um loop (setDeleteSendsLoading dispara re-render → nova closure → efeito
    // de novo). deleteTarget?.id já é o único gatilho que importa aqui.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteTarget?.id]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Campanhas</h1>
        <Button onClick={() => setWizardOpen(true)} className="bg-primary hover:bg-primary/90">
          <Plus className="h-4 w-4 mr-2" />
          Nova campanha
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10"><Send className="h-4 w-4 text-primary" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Campanhas enviadas</p>
              <p className="text-xl font-bold">{stats.totalCampaigns}</p>
            </div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10"><Users className="h-4 w-4 text-blue-400" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Contatos alcançados</p>
              <p className="text-xl font-bold">{stats.totalReached}</p>
            </div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/10"><BarChart2 className="h-4 w-4 text-green-400" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Taxa de abertura</p>
              <p className="text-xl font-bold">{stats.avgOpenRate}%</p>
            </div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-orange-500/10"><MousePointerClick className="h-4 w-4 text-orange-400" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Taxa de clique</p>
              <p className="text-xl font-bold">{stats.avgClickRate}%</p>
            </div>
          </div>
        </CardContent></Card>
      </div>

      {/* Campaign Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : campaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <Send className="h-10 w-10 opacity-40" />
          <p>Nenhuma campanha criada</p>
          <Button variant="outline" onClick={() => setWizardOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> Criar primeira campanha
          </Button>
        </div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead className="w-[100px]">Canal</TableHead>
                <TableHead>Segmento</TableHead>
                <TableHead className="w-[120px]">Status</TableHead>
                <TableHead className="w-[80px] text-right">Enviados</TableHead>
                <TableHead className="w-[80px] text-right">Abertura</TableHead>
                <TableHead className="w-[80px] text-right">Clique</TableHead>
                <TableHead className="w-[140px]">Data envio</TableHead>
                <TableHead className="w-[50px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map(c => {
                const sc = statusConfig[c.status] || statusConfig.draft;
                const openRate = c.channel === 'email' && c.stats.sent > 0
                  ? Math.round((c.stats.opened / c.stats.sent) * 1000) / 10
                  : null;
                const clickRate = c.channel === 'email' && c.stats.sent > 0
                  ? Math.round((c.stats.clicked / c.stats.sent) * 1000) / 10
                  : null;

                return (
                  <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setDetailCampaign(c)}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>
                      {c.channel === 'email' ? (
                        <Badge variant="outline" className="gap-1"><Mail className="h-3 w-3" /> Email</Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 border-green-500/30 text-green-400"><MessageCircle className="h-3 w-3" /> WhatsApp</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.segment_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`${sc.className} gap-1`}>
                        {c.status === 'sending' && <Loader2 className="h-3 w-3 animate-spin" />}
                        {sc.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{c.stats.sent}</TableCell>
                    <TableCell className="text-right">{openRate !== null ? `${openRate}%` : '-'}</TableCell>
                    <TableCell className="text-right">{clickRate !== null ? `${clickRate}%` : '-'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(c.sent_at || c.scheduled_at)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setDetailCampaign(c); }}>
                            <Eye className="h-4 w-4 mr-2" /> Ver detalhes
                          </DropdownMenuItem>
                          {/* Editar e Ver campanha são complementares: um dos dois
                              sempre aparece, nunca os dois. */}
                          {(c.status === 'draft' || c.status === 'scheduled') ? (
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setEditCampaign(c); }}>
                              <Pencil className="h-4 w-4 mr-2" /> Editar
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setViewCampaign(c); }}>
                              <FileText className="h-4 w-4 mr-2" /> Ver campanha
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); duplicateCampaign(c); }}>
                            <Copy className="h-4 w-4 mr-2" /> Duplicar
                          </DropdownMenuItem>
                          {c.status === 'scheduled' && (
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); cancelSchedule(c.id); }}>
                              <CalendarX className="h-4 w-4 mr-2" /> Cancelar agendamento
                            </DropdownMenuItem>
                          )}
                          {c.status !== 'sending' && (
                            <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteTarget(c); }}>
                              <Trash2 className="h-4 w-4 mr-2" /> Excluir
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {wizardOpen && (
        <CampaignWizard
          open={wizardOpen}
          onClose={() => { setWizardOpen(false); refetch(); }}
        />
      )}

      {editCampaign && (
        <CampaignWizard
          open={!!editCampaign}
          campaign={editCampaign}
          onClose={() => { setEditCampaign(null); refetch(); }}
        />
      )}

      {/* Sem refetch no onClose: o modo consulta não altera nada. */}
      {viewCampaign && (
        <CampaignWizard
          open={!!viewCampaign}
          campaign={viewCampaign}
          readOnly
          onClose={() => setViewCampaign(null)}
        />
      )}

      {detailCampaign && (
        <CampaignDetail
          campaign={detailCampaign}
          open={!!detailCampaign}
          onClose={() => setDetailCampaign(null)}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir campanha?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  A campanha "{deleteTarget?.name}" será excluída permanentemente. Esta ação não pode ser desfeita.
                </p>
                {deleteSendsLoading ? (
                  <p className="flex items-center gap-2 text-sm">
                    <Loader2 className="h-3 w-3 animate-spin" /> Verificando envios já realizados...
                  </p>
                ) : !!deleteSendsCount && deleteSendsCount > 0 ? (
                  <p className="text-sm font-medium text-destructive">
                    Isso apaga permanentemente os {deleteSendsCount} registro{deleteSendsCount === 1 ? '' : 's'} de envio desta campanha
                    (quem recebeu, aberturas, cliques, bounces). Os eventos na timeline de cada contato são preservados.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Esta campanha ainda não teve nenhum envio registrado.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteSendsLoading}
              onClick={() => { if (deleteTarget) { deleteCampaign(deleteTarget.id); setDeleteTarget(null); } }}
              className="bg-destructive"
            >
              Excluir permanentemente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
