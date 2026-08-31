import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Plus, Play, Pause, Archive, Save, GitBranch, AlertTriangle } from 'lucide-react';
import { useJourney } from '@/hooks/useJourneys';
import { SegmentMultiSelect } from '@/components/admin/segments/SegmentMultiSelect';
import { useSegmentAudience } from '@/hooks/useSegmentAudience';
import { useSegments } from '@/hooks/useSegments';
import { useTemplates } from '@/hooks/useTemplates';
import {
  NODE_LABELS, STATUS_LABELS, EVENT_OPTIONS, isBranch, newNodeId, readEntrySegments,
  type Journey, type JourneyNode, type JourneyNodeType,
} from '@/lib/journeys';
import { JourneyNodeCard } from '@/components/admin/automations/JourneyNodeCard';
import { NodeConfigDialog } from '@/components/admin/automations/NodeConfigDialog';
import { EmailTemplatePreviewDialog } from '@/components/admin/campaigns/EmailTemplatePreviewDialog';

type BranchKey = 'next' | 'next_false' | 'next_timeout';

// Menu do "+": as 3 condições (branch_*) aparecem como UMA entrada "Condição".
// O subtipo (atributo/segmento/email) é escolhido dentro do NodeConfigDialog;
// branch_attribute é só o tipo padrão com que o diálogo abre.
const ADD_MENU: { label: string; type: JourneyNodeType }[] = [
  { label: NODE_LABELS.send_email, type: 'send_email' },
  { label: NODE_LABELS.delay, type: 'delay' },
  { label: NODE_LABELS.wait_for_event, type: 'wait_for_event' },
  { label: 'Condição', type: 'branch_attribute' },
  { label: NODE_LABELS.apply_tag, type: 'apply_tag' },
  { label: NODE_LABELS.handoff_nexus, type: 'handoff_nexus' },
];

function minutesToLabel(m: number): string {
  if (m > 0 && m % 1440 === 0) return `${m / 1440}d`;
  if (m > 0 && m % 60 === 0) return `${m / 60}h`;
  return `${m}min`;
}

export default function JourneyBuilder() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { journey, metrics, loading, refetch } = useJourney(id);
  const { templates } = useTemplates();
  // Usado só pelo rótulo do nó `branch_segment` (ramificação por um único
  // segmento, que continua sendo pergunta sobre um segmento só). A entrada do
  // fluxo passou a usar SegmentMultiSelect + useSegmentAudience.
  const { segments } = useSegments();

  // Estado local do grafo (editável) -- só é persistido quando o usuário clica
  // em "Salvar". A validação de verdade (ciclo, ponteiro quebrado, config
  // faltando) é do banco; aqui só evitamos os erros óbvios antes de tentar.
  const [nodes, setNodes] = useState<JourneyNode[]>([]);
  const [entryNodeId, setEntryNodeId] = useState<string | null>(null);
  const [entryType, setEntryType] = useState<'segment' | 'event'>('segment');
  const [entrySegmentIds, setEntrySegmentIds] = useState<string[]>([]);
  const [entryExcludedSegmentIds, setEntryExcludedSegmentIds] = useState<string[]>([]);
  const [entryEventType, setEntryEventType] = useState('');
  const [reentry, setReentry] = useState<'once' | 'allowed'>('once');
  // C1: exibido em dias na UI, convertido para reentry_cooldown_hours no PATCH.
  const [reentryCooldownDays, setReentryCooldownDays] = useState(7);
  const [originalNodeIds, setOriginalNodeIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  // I6: "Ativar" mandava só {status:'active'} -- ativava o grafo JÁ SALVO no
  // banco, não o que está na tela. Edições pendentes (nós, entrada, reentrada)
  // eram silenciosamente descartadas. `dirty` rastreia toda mutação de estado
  // local desde o último load/save; ativar fica bloqueado enquanto for true.
  const [dirty, setDirty] = useState(false);

  const [pendingInsert, setPendingInsert] = useState<{ parentId: string | null; branchKey: BranchKey } | null>(null);
  const [addType, setAddType] = useState<JourneyNodeType | null>(null);
  const [editingNode, setEditingNode] = useState<JourneyNode | null>(null);
  const [previewNode, setPreviewNode] = useState<JourneyNode | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ nodeId: string; finalNodes: JourneyNode[]; newEntryId: string | null; prunedLabels: string[] } | null>(null);
  const [confirmActiveEdit, setConfirmActiveEdit] = useState(false);
  const [confirmActivate, setConfirmActivate] = useState(false);
  const [showEntryDialog, setShowEntryDialog] = useState(false);

  useEffect(() => {
    if (!journey) return;
    setNodes(journey.nodes || []);
    setEntryNodeId(journey.entry_node_id ?? null);
    setEntryType(journey.entry_type);
    const entrySegs = readEntrySegments(journey.entry_config);
    setEntrySegmentIds(journey.entry_type === 'segment' ? entrySegs.include : []);
    setEntryExcludedSegmentIds(journey.entry_type === 'segment' ? entrySegs.exclude : []);
    setEntryEventType(journey.entry_type === 'event' ? (journey.entry_config?.event_type || '') : '');
    setReentry(journey.reentry);
    setReentryCooldownDays(Math.max(1, Math.round((journey.reentry_cooldown_hours ?? 168) / 24)));
    setOriginalNodeIds(new Set((journey.nodes || []).map((n) => n.id)));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journey?.id, journey?.updated_at]);

  // Métricas por nó (Task 6.13): enquanto o fluxo estiver ativo, os números
  // mudam a cada envio/abertura/clique -- polling de 60s, mesma convenção dos
  // demais hooks de evento do admin (useAgendamentos: setInterval + flag
  // `cancelled` no cleanup). Sem isso o admin só veria números frescos ao
  // recarregar a página manualmente.
  useEffect(() => {
    if (journey?.status !== 'active') return;
    let cancelled = false;
    const interval = setInterval(() => {
      if (!cancelled) refetch();
    }, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [journey?.status, refetch]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const sendEmailNodes = useMemo(
    () => nodes.filter((n) => n.type === 'send_email').map((n) => ({
      id: n.id,
      label: n.config?.subject ? `"${n.config.subject}"` : NODE_LABELS.send_email,
    })),
    [nodes],
  );

  const summaryFor = (node: JourneyNode): string => {
    switch (node.type) {
      case 'send_email': {
        const t = templates.find((t) => t.id === node.config.template_id);
        return `${t?.name || 'template'} — "${node.config.subject || ''}"`;
      }
      case 'delay':
        return `Esperar ${minutesToLabel(node.config.minutes || 0)}`;
      case 'wait_for_event': {
        const label = EVENT_OPTIONS.find((e) => e.value === node.config.event_type)?.label || node.config.event_type;
        const src = node.config.source_node_id
          ? ` (${nodes.find((n) => n.id === node.config.source_node_id)?.config?.subject ? `"${nodes.find((n) => n.id === node.config.source_node_id)?.config?.subject}"` : 'email específico'})`
          : '';
        return `${label}${src} · timeout ${minutesToLabel(node.config.timeout_minutes || 0)}`;
      }
      case 'branch_attribute': {
        const rules = node.config.rules || [];
        const sep = node.config.logic === 'or' ? ' OU ' : ' E ';
        return rules.map((r: any) => `${r.field} ${r.operator} ${r.value}`).join(sep) || 'sem condições';
      }
      case 'branch_segment': {
        const s = segments.find((s: any) => s.id === node.config.segment_id);
        return s?.name || 'segmento';
      }
      case 'branch_email_event': {
        const verb = node.config.check === 'clicked' ? 'Clicou' : node.config.check === 'opened' ? 'Abriu' : 'Recebeu';
        const srcSubject = nodes.find((n) => n.id === node.config.source_node_id)?.config?.subject;
        return `${verb} ${srcSubject ? `"${srcSubject}"` : 'o email'}`;
      }
      case 'apply_tag':
        return `Tag "${node.config.tag_name}"`;
      case 'handoff_nexus':
        return node.config.stage_name || 'estágio do Nexus';
      default:
        return '';
    }
  };

  const openAddMenu = (parentId: string | null, branchKey: BranchKey, type: JourneyNodeType) => {
    setPendingInsert({ parentId, branchKey });
    setAddType(type);
  };

  const handleCreateNode = (config: Record<string, any>, resolvedType?: JourneyNodeType) => {
    if (!pendingInsert || !addType) return;
    setDirty(true);
    const id = newNodeId();
    const { parentId, branchKey } = pendingInsert;
    // resolvedType = subtipo real quando o nó é uma "Condição" (escolhido no diálogo).
    const newNode: JourneyNode = { id, type: resolvedType ?? addType, config, next: null };

    if (parentId === null) {
      newNode.next = entryNodeId;
      setEntryNodeId(id);
      setNodes((prev) => [...prev, newNode]);
    } else {
      setNodes((prev) => {
        const parent = prev.find((n) => n.id === parentId);
        const currentTarget = parent ? ((parent as any)[branchKey] ?? null) : null;
        newNode.next = currentTarget;
        return [...prev.map((n) => (n.id === parentId ? { ...n, [branchKey]: id } : n)), newNode];
      });
    }
    setPendingInsert(null);
    setAddType(null);
  };

  const handleEditSave = (config: Record<string, any>, resolvedType?: JourneyNodeType) => {
    if (!editingNode) return;
    // resolvedType permite trocar o subtipo de uma Condição na edição (ex.: de
    // atributo para email); os ponteiros next/next_false (ramos Sim/Não) ficam.
    setNodes((prev) => prev.map((n) => (n.id === editingNode.id ? { ...n, type: resolvedType ?? n.type, config } : n)));
    setEditingNode(null);
    setDirty(true);
  };

  const computePruned = (afterNodes: JourneyNode[], afterEntryId: string | null): string[] => {
    const map = new Map(afterNodes.map((n) => [n.id, n]));
    const seen = new Set<string>();
    const queue: (string | null | undefined)[] = [afterEntryId];
    while (queue.length) {
      const cur = queue.shift();
      if (!cur || seen.has(cur) || !map.has(cur)) continue;
      seen.add(cur);
      const n = map.get(cur)!;
      queue.push(n.next, n.next_false, n.next_timeout);
    }
    return afterNodes.filter((n) => !seen.has(n.id)).map((n) => n.id);
  };

  const requestDeleteNode = (nodeId: string) => {
    const target = nodes.find((n) => n.id === nodeId);
    if (!target) return;
    const fallback = target.next ?? null;
    const repointed = nodes
      .map((n) => {
        const patch: Partial<JourneyNode> = {};
        if (n.next === nodeId) patch.next = fallback;
        if (n.next_false === nodeId) patch.next_false = fallback;
        if (n.next_timeout === nodeId) patch.next_timeout = fallback;
        return Object.keys(patch).length ? { ...n, ...patch } : n;
      })
      .filter((n) => n.id !== nodeId);
    const newEntryId = entryNodeId === nodeId ? fallback : entryNodeId;
    const prunedIds = computePruned(repointed, newEntryId);
    const finalNodes = repointed.filter((n) => !prunedIds.includes(n.id));

    if (prunedIds.length > 0) {
      const prunedLabels = prunedIds.map((pid) => {
        const n = nodes.find((x) => x.id === pid);
        return n ? NODE_LABELS[n.type] : pid;
      });
      setConfirmDelete({ nodeId, finalNodes, newEntryId, prunedLabels });
    } else {
      setNodes(finalNodes);
      setEntryNodeId(newEntryId);
      setDirty(true);
    }
  };

  const confirmDeleteApply = () => {
    if (!confirmDelete) return;
    setNodes(confirmDelete.finalNodes);
    setEntryNodeId(confirmDelete.newEntryId);
    setConfirmDelete(null);
    setDirty(true);
  };

  const savePatch = async (patch: Record<string, any>): Promise<boolean> => {
    const { data, error } = await supabase.functions.invoke(`journeys-api?id=${id}`, {
      method: 'PATCH', body: patch,
    });
    if (error || data?.error) {
      // A mensagem do banco (grafo cíclico, nó sem config, fluxo sem nós) é a
      // mensagem útil para o usuário -- mostrar, não mascarar.
      toast.error(data?.error || 'Erro ao salvar fluxo');
      return false;
    }
    return true;
  };

  const doSaveGraph = async () => {
    setSaving(true);
    const ok = await savePatch({
      nodes,
      entry_node_id: entryNodeId,
      entry_type: entryType,
      entry_config: entryType === 'segment'
        ? { segment_ids: entrySegmentIds, excluded_segment_ids: entryExcludedSegmentIds }
        : { event_type: entryEventType },
      reentry,
      reentry_cooldown_hours: Math.max(1, Math.round(reentryCooldownDays * 24)),
    });
    setSaving(false);
    if (ok) {
      toast.success('Fluxo salvo');
      setConfirmActiveEdit(false);
      setDirty(false);
      await refetch();
    }
  };

  const handleSaveClick = () => {
    const currentIds = new Set(nodes.map((n) => n.id));
    const deletedSomething = [...originalNodeIds].some((oid) => !currentIds.has(oid));
    if (journey?.status === 'active' && deletedSomething) {
      setConfirmActiveEdit(true);
      return;
    }
    doSaveGraph();
  };

  const setStatus = async (status: Journey['status']) => {
    const ok = await savePatch({ status });
    if (ok) {
      toast.success(status === 'active' ? 'Fluxo ativado' : status === 'paused' ? 'Fluxo pausado' : 'Fluxo arquivado');
      await refetch();
    }
  };

  const handleActivateClick = () => {
    // I6: "Ativar" só envia {status:'active'} -- ativaria o grafo JÁ SALVO,
    // não o que está na tela. Bloqueia em vez de ativar uma versão que o
    // usuário não pretendia (salvar automaticamente aqui poderia disparar o
    // fluxo de confirmação de exclusão de passos de um fluxo ativo por
    // engano). A mensagem diz exatamente o que fazer.
    if (dirty) {
      toast.error('Você tem alterações não salvas. Clique em "Salvar" antes de ativar.');
      return;
    }
    if (nodes.length === 0 || !entryNodeId) {
      toast.error('Adicione ao menos um passo antes de ativar');
      return;
    }
    if (entryType === 'segment') {
      if (entrySegmentIds.length === 0) {
        toast.error('Selecione ao menos um segmento de entrada');
        return;
      }
      setConfirmActivate(true);
      return;
    }
    setStatus('active');
  };

  // A contagem de ativação precisa refletir união menos exclusão -- somar as
  // contagens individuais dos segmentos contaria duas vezes quem está em dois
  // deles e ignoraria as exclusões.
  const { count: activateSegmentCount } = useSegmentAudience(
    entrySegmentIds,
    entryExcludedSegmentIds,
    entryType === 'segment',
  );

  // ---- Render recursivo em coluna vertical, com ramos em duas colunas ----
  const AddButton = ({ parentId, branchKey }: { parentId: string | null; branchKey: BranchKey }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="w-7 h-7 rounded-full border border-dashed border-border/60 hover:border-primary hover:text-primary flex items-center justify-center text-muted-foreground transition-colors my-1">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center">
        {ADD_MENU.map((item) => (
          <DropdownMenuItem key={item.label} onClick={() => openAddMenu(parentId, branchKey, item.type)}>
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const renderChain = (
    startId: string | null,
    renderedIds: Set<string>,
    parentForInsert: string | null,
    branchKeyForInsert: BranchKey,
  ): JSX.Element => {
    const items: JSX.Element[] = [];
    items.push(<AddButton key={`add-${parentForInsert}-${branchKeyForInsert}-head`} parentId={parentForInsert} branchKey={branchKeyForInsert} />);

    let currentId = startId;
    while (currentId) {
      if (renderedIds.has(currentId)) {
        const n = byId.get(currentId);
        items.push(
          <div key={`ref-${currentId}`} className="text-[11px] text-muted-foreground italic border border-dashed border-border/50 rounded-md px-3 py-1.5">
            → continua em "{n ? NODE_LABELS[n.type] : currentId}"
          </div>,
        );
        break;
      }
      const node = byId.get(currentId);
      if (!node) break;
      renderedIds.add(currentId);

      items.push(
        <JourneyNodeCard
          key={node.id}
          node={node}
          summary={summaryFor(node)}
          metrics={metrics[node.id]}
          onPreview={node.type === 'send_email' && node.config?.template_id ? () => setPreviewNode(node) : undefined}
          onEdit={() => setEditingNode(node)}
          onDelete={() => requestDeleteNode(node.id)}
        />,
      );

      if (isBranch(node.type)) {
        items.push(
          <div key={`branches-${node.id}`} className="flex gap-8 items-start justify-center w-full">
            <div className="flex-1 flex flex-col items-center min-w-0">
              <Badge variant="secondary" className="text-[10px] mb-1">Sim</Badge>
              {renderChain(node.next ?? null, renderedIds, node.id, 'next')}
            </div>
            <div className="flex-1 flex flex-col items-center min-w-0">
              <Badge variant="secondary" className="text-[10px] mb-1">Não</Badge>
              {renderChain(node.next_false ?? null, renderedIds, node.id, 'next_false')}
            </div>
          </div>,
        );
        currentId = null;
      } else if (node.type === 'wait_for_event') {
        items.push(
          <div key={`branches-${node.id}`} className="flex gap-8 items-start justify-center w-full">
            <div className="flex-1 flex flex-col items-center min-w-0">
              <Badge variant="secondary" className="text-[10px] mb-1">Aconteceu</Badge>
              {renderChain(node.next ?? null, renderedIds, node.id, 'next')}
            </div>
            <div className="flex-1 flex flex-col items-center min-w-0">
              <Badge variant="secondary" className="text-[10px] mb-1">Tempo esgotado</Badge>
              {renderChain(node.next_timeout ?? null, renderedIds, node.id, 'next_timeout')}
            </div>
          </div>,
        );
        currentId = null;
      } else {
        items.push(<AddButton key={`add-${node.id}`} parentId={node.id} branchKey="next" />);
        currentId = node.next ?? null;
      }
    }

    return <div className="flex flex-col items-center gap-1.5">{items}</div>;
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full max-w-md mx-auto" />
        <Skeleton className="h-24 w-full max-w-md mx-auto" />
      </div>
    );
  }

  if (!journey) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
        <p>Fluxo não encontrado.</p>
        <Button variant="ghost" className="mt-3" onClick={() => navigate('/automations')}>Voltar</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-16">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => navigate('/automations')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">{journey.name}</h1>
              <Badge className="text-[10px]">{STATUS_LABELS[journey.status]}</Badge>
            </div>
            {journey.description && <p className="text-sm text-muted-foreground">{journey.description}</p>}
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleSaveClick} disabled={saving}>
            <Save className="h-3.5 w-3.5" /> Salvar
          </Button>
          {journey.status !== 'active' && journey.status !== 'archived' && (
            <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-600/90" onClick={handleActivateClick}>
              <Play className="h-3.5 w-3.5" /> Ativar
            </Button>
          )}
          {journey.status === 'active' && (
            <Button size="sm" variant="outline" className="gap-1.5 text-amber-600" onClick={() => setStatus('paused')}>
              <Pause className="h-3.5 w-3.5" /> Pausar
            </Button>
          )}
          {journey.status !== 'archived' && journey.status !== 'draft' && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setStatus('archived')}>
              <Archive className="h-3.5 w-3.5" /> Arquivar
            </Button>
          )}
        </div>
      </div>

      {/* Card de entrada -- somente leitura, editável pelo diálogo próprio */}
      <Card className="max-w-md mx-auto border-primary/30 bg-primary/[0.03]">
        <CardContent className="py-3 px-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Entrada</p>
            <p className="text-sm font-medium truncate">
              {entryType === 'segment'
                ? `Segmentos: ${entrySegmentIds.length === 0 ? '(selecione)' : entrySegmentIds.length}${entryExcludedSegmentIds.length > 0 ? ` — exceto ${entryExcludedSegmentIds.length}` : ''}`
                : `Evento: ${EVENT_OPTIONS.find((e) => e.value === entryEventType)?.label || '(selecione)'}`}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Reentrada: {reentry === 'once' ? 'uma vez por contato' : `pode entrar de novo (mín. ${reentryCooldownDays}d)`}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setShowEntryDialog(true)}>Editar</Button>
        </CardContent>
      </Card>

      <div className="overflow-x-auto pt-2">
        <div className="flex justify-center min-w-fit px-4">
          {renderChain(entryNodeId, new Set(), null, 'next')}
        </div>
      </div>

      {nodes.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <GitBranch className="h-10 w-10 mb-2 opacity-30" />
          <p className="text-sm">Clique no "+" acima para adicionar o primeiro passo</p>
        </div>
      )}

      {/* Diálogo de criação/edição de nó */}
      <NodeConfigDialog
        open={!!addType}
        onOpenChange={(o) => { if (!o) { setAddType(null); setPendingInsert(null); } }}
        type={addType}
        initialConfig={{}}
        sendEmailNodes={sendEmailNodes}
        onSave={handleCreateNode}
      />
      <NodeConfigDialog
        open={!!editingNode}
        onOpenChange={(o) => { if (!o) setEditingNode(null); }}
        type={editingNode?.type ?? null}
        initialConfig={editingNode?.config ?? {}}
        sendEmailNodes={sendEmailNodes}
        onSave={handleEditSave}
      />

      {/* Visualização do email do nó (olho no card). O template sai da lista já
          carregada por useTemplates -- o select('*') traz o html junto. */}
      <EmailTemplatePreviewDialog
        open={!!previewNode}
        onOpenChange={(o) => { if (!o) setPreviewNode(null); }}
        template={templates.find((t) => t.id === previewNode?.config?.template_id) ?? null}
        subject={previewNode?.config?.subject}
      />

      {/* Editar entrada */}
      <Dialog open={showEntryDialog} onOpenChange={setShowEntryDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Entrada do fluxo</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Select value={entryType} onValueChange={(v) => { setEntryType(v as 'segment' | 'event'); setDirty(true); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="segment">Quando entra em um segmento</SelectItem>
                <SelectItem value="event">Quando acontece um evento</SelectItem>
              </SelectContent>
            </Select>
            {entryType === 'segment' ? (
              <div className="space-y-2">
                <SegmentMultiSelect
                  value={entrySegmentIds}
                  onChange={(ids) => { setEntrySegmentIds(ids); setDirty(true); }}
                  placeholder="Segmentos de entrada"
                  disabledIds={entryExcludedSegmentIds}
                />
                <SegmentMultiSelect
                  value={entryExcludedSegmentIds}
                  onChange={(ids) => { setEntryExcludedSegmentIds(ids); setDirty(true); }}
                  placeholder="Não inscrever quem estiver em (opcional)"
                  disabledIds={entrySegmentIds}
                />
              </div>
            ) : (
              <Select value={entryEventType} onValueChange={(v) => { setEntryEventType(v); setDirty(true); }}>
                <SelectTrigger><SelectValue placeholder="Evento" /></SelectTrigger>
                <SelectContent>
                  {EVENT_OPTIONS.map((e) => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Select value={reentry} onValueChange={(v) => { setReentry(v as 'once' | 'allowed'); setDirty(true); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="once">Uma vez por contato</SelectItem>
                <SelectItem value="allowed">Pode entrar de novo</SelectItem>
              </SelectContent>
            </Select>

            {reentry === 'allowed' && (
              <div className="space-y-1.5">
                <Label className="text-xs">Intervalo mínimo antes de reentrar</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number" min={1} className="w-24"
                    value={reentryCooldownDays}
                    onChange={(e) => { setReentryCooldownDays(Math.max(1, Number(e.target.value))); setDirty(true); }}
                  />
                  <span className="text-sm text-muted-foreground">dia(s)</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Depois que o contato terminar o fluxo, ele só entra de novo depois desse tempo — mesmo continuando
                  no critério de entrada. Sem esse intervalo, o mesmo contato reentraria a cada verificação (até a
                  cada 1 minuto) e receberia os mesmos emails repetidamente.
                </p>
              </div>
            )}

            {entryType === 'segment' && reentry === 'allowed' && (
              <div className="flex gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md p-2.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <p>
                  Este fluxo entra por <strong>segmento</strong> e permite <strong>reentrada</strong>. Se o segmento
                  for permanente (ex.: "etiqueta = hotlead"), contatos que continuam atendendo à regra voltarão a
                  entrar no fluxo — e a receber os mesmos emails — a cada intervalo configurado acima,
                  indefinidamente.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setShowEntryDialog(false)}>Concluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Aviso: excluir este passo descarta o ramo "Não"/timeout que só existia
          por causa dele -- exatamente a regra descrita no plano da Fase 6. */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este passo?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso também removerá {confirmDelete?.prunedLabels.length} passo(s) que só existiam a partir daqui: {confirmDelete?.prunedLabels.join(', ')}.
              Essa parte do fluxo será perdida.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={confirmDeleteApply}>
              Excluir mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Aviso obrigatório: editar o grafo de um fluxo ATIVO com passos
          excluídos tira do fluxo os contatos que estavam parados exatamente
          nesses passos (decisão documentada no plano da Fase 6). */}
      <AlertDialog open={confirmActiveEdit} onOpenChange={(o) => !o && setConfirmActiveEdit(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Este fluxo está ativo</AlertDialogTitle>
            <AlertDialogDescription>
              Você removeu passo(s) de um fluxo que já está rodando. Contatos que estiverem parados exatamente
              nesses passos no momento do salvamento saem do fluxo (não são movidos para outro lugar). Contatos em
              outros passos não são afetados. Deseja salvar mesmo assim?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={saving} onClick={doSaveGraph}>
              {saving ? 'Salvando...' : 'Salvar mesmo assim'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Aviso obrigatório antes de ativar um fluxo de entrada por segmento:
          mostra a contagem exata de contatos que serão inscritos de imediato. */}
      <AlertDialog open={confirmActivate} onOpenChange={(o) => !o && setConfirmActivate(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ativar "{journey.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Este fluxo entra por{' '}
              <strong>
                {entrySegmentIds.length === 1 ? 'o segmento selecionado' : `${entrySegmentIds.length} segmentos`}
              </strong>
              {entryExcludedSegmentIds.length > 0 && (
                <>, excluindo <strong>{entryExcludedSegmentIds.length}</strong></>
              )}
              . Ao ativar, <strong>{activateSegmentCount}</strong> contato{activateSegmentCount === 1 ? '' : 's'} que já{' '}
              {activateSegmentCount === 1 ? 'atende' : 'atendem'} às regras{' '}
              {activateSegmentCount === 1 ? 'será inscrito' : 'serão inscritos'} imediatamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 hover:bg-emerald-600/90 text-white"
              onClick={() => { setConfirmActivate(false); setStatus('active'); }}
            >
              Ativar e inscrever {activateSegmentCount}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
