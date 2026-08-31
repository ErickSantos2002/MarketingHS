import { useState, useEffect, useCallback, useRef } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Mail, MessageCircle, Send, Eye, MousePointerClick, AlertCircle, Loader2, ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react';
import type { Campaign, CampaignSend, CampaignLiveStats } from '@/hooks/useCampaigns';
import { useCampaigns } from '@/hooks/useCampaigns';
import { supabase } from '@/integrations/supabase/client';

interface CampaignDetailProps {
  campaign: Campaign;
  open: boolean;
  onClose: () => void;
}

const statusConfig: Record<string, { label: string; className: string }> = {
  draft: { label: 'Rascunho', className: 'bg-muted text-muted-foreground' },
  scheduled: { label: 'Agendada', className: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
  sending: { label: 'Enviando...', className: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  sent: { label: 'Enviada', className: 'bg-green-500/15 text-green-400 border-green-500/30' },
  paused: { label: 'Pausada', className: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
  failed: { label: 'Falhou', className: 'bg-red-500/15 text-red-400 border-red-500/30' },
};

const sendStatusBadge: Record<string, { label: string; className: string }> = {
  pending: { label: 'Pendente', className: 'bg-muted text-muted-foreground' },
  sent: { label: 'Enviado', className: 'bg-blue-500/15 text-blue-400' },
  delivered: { label: 'Entregue', className: 'bg-green-500/15 text-green-400' },
  opened: { label: 'Aberto', className: 'bg-emerald-500/15 text-emerald-400' },
  clicked: { label: 'Clicado', className: 'bg-primary/15 text-primary' },
  bounced: { label: 'Bounce', className: 'bg-red-500/15 text-red-400' },
  complained: { label: 'Marcou spam', className: 'bg-orange-500/15 text-orange-400' },
  failed: { label: 'Falhou', className: 'bg-red-500/15 text-red-400' },
  unsubscribed: { label: 'Descadastrado', className: 'bg-orange-500/15 text-orange-400' },
  // Neutro/cinza de propósito: supressão não é um erro de envio, é um envio
  // deliberadamente pulado (descadastro/bounce/complaint anterior).
  suppressed: { label: 'Suprimido', className: 'bg-slate-500/15 text-slate-400' },
};

function formatDate(d: string | null) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const ITEMS_PER_PAGE = 20;

export function CampaignDetail({ campaign, open, onClose }: CampaignDetailProps) {
  const { getCampaignSends, getCampaignStats } = useCampaigns();
  const [sends, setSends] = useState<CampaignSend[]>([]);
  const [liveStats, setLiveStats] = useState<CampaignLiveStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [liveStatus, setLiveStatus] = useState<string>(campaign.status);
  // Trava contra requisições empilhadas: se um tick anterior ainda estiver em voo
  // (banco lento, audiência grande), o tick seguinte é descartado em vez de somar
  // mais 11 queries por cima das que já estão rodando.
  const runningRef = useRef(false);

  // Carga única: sends + stats + o status REAL no banco. O status não pode vir da
  // prop `campaign` (é um snapshot da lista, congelado enquanto o Sheet está aberto):
  // enquanto a fila drena, ele muda de 'sending' para 'sent' sem que a lista recarregue.
  // `isCancelled` é passado pelo efeito chamador (convenção de flag do projeto).
  const load = useCallback(async (isCancelled: () => boolean) => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      const [sendsData, statsData] = await Promise.all([
        getCampaignSends(campaign.id),
        getCampaignStats(campaign.id),
      ]);
      const { data: fresh } = await supabase
        .from('campaigns' as any)
        .select('status')
        .eq('id', campaign.id)
        .maybeSingle();
      if (isCancelled()) return;
      setSends(sendsData);
      setLiveStats(statsData);
      setLiveStatus(((fresh as any)?.status as string) ?? campaign.status);
      setLoading(false);
    } catch (e) {
      // Sem este catch, uma falha de rede numa das 11 queries deixaria o spinner
      // preso para sempre (o setLoading(false) do try nunca seria alcançado).
      // console.* some no build de prod (Terser drop_console) — é só para debug.
      console.error('[CampaignDetail] falha ao carregar dados da campanha', e);
      if (!isCancelled()) setLoading(false);
    } finally {
      runningRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign.id, campaign.status]);

  // Carga inicial: roda uma vez ao abrir o Sheet (ou ao trocar de campanha).
  // Não cria intervalo — abrir o detalhe de uma campanha 'draft'/'sent'/'failed'
  // não deve iniciar polling nenhum, porque o estado dela não muda mais.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    setLoading(true);
    setLiveStats(null);
    setLiveStatus(campaign.status);
    load(() => cancelled);

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, campaign.id]);

  // Polling APENAS nos estados que ainda vão mudar sozinhos (padrão do projeto:
  // setInterval + flag de cancelamento, sem realtime). 10s em vez dos 60s convencionais
  // porque um envio em curso muda de estado rápido demais para o intervalo padrão.
  //
  // Dois estados armam o intervalo:
  //   - 'sending': a fila está drenando, as stats mudam a cada tick.
  //   - 'scheduled': o promote-scheduled-campaigns (pg_cron, roda a cada minuto) pode
  //     promover a campanha a qualquer momento. Sem pollar aqui, o admin que abre o
  //     detalhe de uma campanha agendada no horário do envio veria "Agendada" para
  //     sempre (o status só muda via load(), e load() só se repete pelo intervalo).
  // 'draft'/'sent'/'paused'/'failed' NÃO armam nada: são estados que só mudam por ação
  // do próprio admin, que remonta o Sheet.
  //
  // Ciclo de vida: quando uma carga observa o status fora desses dois (a campanha
  // agendada virou 'sending', ou a fila drenou e virou 'sent'/'failed'), a dep
  // `liveStatus` muda, este efeito roda de novo, o cleanup limpa o intervalo e ele só
  // é rearmado se o novo status também for pollável. Ou seja: 'scheduled' → 'sending'
  // mantém o polling (e a barra de progresso aparece), 'sending' → 'sent' o encerra.
  // Fechar o Sheet (`open` = false) e desmontar também caem no cleanup.
  useEffect(() => {
    if (!open || (liveStatus !== 'sending' && liveStatus !== 'scheduled')) return;
    let cancelled = false;

    const id = setInterval(() => {
      if (!cancelled) load(() => cancelled);
    }, 10_000);

    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, campaign.id, liveStatus]);

  const sc = statusConfig[liveStatus] || statusConfig.draft;
  // Prefere as stats ao vivo (campaign_sends); cai no JSONB legado enquanto carrega
  const stats: CampaignLiveStats = liveStats ?? {
    total: 0, pending: 0, bounced: 0, complained: 0, unsubscribed: 0, suppressed: 0, ...campaign.stats,
  };
  const isEmail = campaign.channel === 'email';

  const filtered = statusFilter === 'all' ? sends : sends.filter(s => s.status === statusFilter);
  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  const deliveredPct = stats.sent > 0 ? Math.round((stats.delivered / stats.sent) * 100) : 0;
  const openedPct = stats.sent > 0 ? Math.round((stats.opened / stats.sent) * 100) : 0;
  const clickedPct = stats.sent > 0 ? Math.round((stats.clicked / stats.sent) * 100) : 0;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 flex-wrap">
            {campaign.name}
            <Badge variant="outline" className={sc.className}>{sc.label}</Badge>
            <Badge variant="outline" className="gap-1">
              {isEmail ? <><Mail className="h-3 w-3" /> Email</> : <><MessageCircle className="h-3 w-3" /> WhatsApp</>}
            </Badge>
          </SheetTitle>
          <p className="text-sm text-muted-foreground">
            Enviada em {formatDate(campaign.sent_at)}
          </p>
        </SheetHeader>

        {liveStatus === 'sending' && stats.total > 0 && (
          <Card className="border-blue-500/30 bg-blue-500/5 mt-4">
            <CardContent className="py-4 px-5 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 font-medium text-blue-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Enviando pela fila...
                </span>
                <span className="text-muted-foreground">
                  {stats.total - stats.pending} de {stats.total} processados
                </span>
              </div>
              <Progress value={Math.round(((stats.total - stats.pending) / stats.total) * 100)} />
              <p className="text-xs text-muted-foreground">
                {stats.pending} na fila. A tela atualiza sozinha a cada 10 segundos.
              </p>
            </CardContent>
          </Card>
        )}

        <div className="space-y-6 mt-6">
          {/* Performance Funnel */}
          {isEmail ? (
            <>
            <div className="flex items-center gap-2 overflow-x-auto pb-2">
              <Card className="flex-1 min-w-[100px]"><CardContent className="py-3 px-4 text-center">
                <Send className="h-4 w-4 mx-auto text-blue-400 mb-1" />
                <p className="text-lg font-bold">{stats.sent}</p>
                <p className="text-[10px] text-muted-foreground">Enviados</p>
              </CardContent></Card>
              <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
              <Card className="flex-1 min-w-[100px]"><CardContent className="py-3 px-4 text-center">
                <Mail className="h-4 w-4 mx-auto text-green-400 mb-1" />
                <p className="text-lg font-bold">{stats.delivered}</p>
                <p className="text-[10px] text-muted-foreground">Entregues ({deliveredPct}%)</p>
              </CardContent></Card>
              <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
              <Card className="flex-1 min-w-[100px]"><CardContent className="py-3 px-4 text-center">
                <Eye className="h-4 w-4 mx-auto text-emerald-400 mb-1" />
                <p className="text-lg font-bold">{stats.opened}</p>
                <p className="text-[10px] text-muted-foreground">Abertos ({openedPct}%)</p>
              </CardContent></Card>
              <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
              <Card className="flex-1 min-w-[100px]"><CardContent className="py-3 px-4 text-center">
                <MousePointerClick className="h-4 w-4 mx-auto text-primary mb-1" />
                <p className="text-lg font-bold">{stats.clicked}</p>
                <p className="text-[10px] text-muted-foreground">Clicados ({clickedPct}%)</p>
              </CardContent></Card>
            </div>
            {(stats.bounced > 0 || stats.complained > 0 || stats.suppressed > 0) && (
              <div className="flex items-center gap-2 flex-wrap">
                {stats.bounced > 0 && (
                  <Badge variant="outline" className="bg-red-500/15 text-red-400 border-red-500/30">
                    Bounce: {stats.bounced}
                  </Badge>
                )}
                {stats.complained > 0 && (
                  <Badge variant="outline" className="bg-orange-500/15 text-orange-400 border-orange-500/30">
                    Marcou spam: {stats.complained}
                  </Badge>
                )}
                {stats.suppressed > 0 && (
                  <Badge variant="outline" className="bg-slate-500/15 text-slate-400 border-slate-500/30">
                    Suprimidos: {stats.suppressed}
                  </Badge>
                )}
              </div>
            )}
            </>
          ) : (
            <div className="flex gap-4">
              <Card className="flex-1"><CardContent className="py-3 px-4 text-center">
                <Send className="h-4 w-4 mx-auto text-green-400 mb-1" />
                <p className="text-lg font-bold">{stats.sent}</p>
                <p className="text-[10px] text-muted-foreground">Enviados</p>
              </CardContent></Card>
              <Card className="flex-1"><CardContent className="py-3 px-4 text-center">
                <AlertCircle className="h-4 w-4 mx-auto text-red-400 mb-1" />
                <p className="text-lg font-bold">{stats.failed}</p>
                <p className="text-[10px] text-muted-foreground">Falhos</p>
              </CardContent></Card>
            </div>
          )}

          {/* Filter */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Filtrar:</span>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos ({sends.length})</SelectItem>
                <SelectItem value="sent">Enviados</SelectItem>
                {isEmail && <SelectItem value="opened">Abertos</SelectItem>}
                {isEmail && <SelectItem value="clicked">Clicados</SelectItem>}
                <SelectItem value="failed">Falhados</SelectItem>
                {isEmail && <SelectItem value="suppressed">Suprimidos</SelectItem>}
              </SelectContent>
            </Select>
          </div>

          {/* Sends Table */}
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : (
            <>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>{isEmail ? 'Email' : 'Telefone'}</TableHead>
                      <TableHead className="w-[110px]">Status</TableHead>
                      <TableHead className="w-[130px]">Enviado em</TableHead>
                      {isEmail && <TableHead className="w-[130px]">Aberto em</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginated.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Nenhum envio encontrado</TableCell></TableRow>
                    ) : paginated.map(s => {
                      const sb = sendStatusBadge[s.status] || sendStatusBadge.pending;
                      return (
                        <TableRow key={s.id}>
                          <TableCell className="font-medium">{s.lead_name}</TableCell>
                          <TableCell className="text-sm">{isEmail ? s.lead_email : s.lead_phone}</TableCell>
                          <TableCell><Badge variant="outline" className={sb.className}>{sb.label}</Badge></TableCell>
                          <TableCell className="text-xs text-muted-foreground">{formatDate(s.sent_at)}</TableCell>
                          {isEmail && <TableCell className="text-xs text-muted-foreground">{formatDate(s.opened_at)}</TableCell>}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{filtered.length} envios</span>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span>Página {page} de {totalPages}</span>
                    <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
