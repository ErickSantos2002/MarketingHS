import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSegments, Segment } from '@/hooks/useSegments';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Filter, Plus, Users, Send, MoreHorizontal, Pencil, Copy, Trash2, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { SegmentFormModal } from '@/components/admin/segments/SegmentFormModal';
import { SegmentContactsDrawer } from '@/components/admin/segments/SegmentContactsDrawer';

export default function Segments() {
  const { segments, counts, loading, duplicateSegment, deleteSegment, refetch } = useSegments();
  const navigate = useNavigate();
  const [formOpen, setFormOpen] = useState(false);
  const [editSegment, setEditSegment] = useState<Segment | null>(null);
  const [drawerSegment, setDrawerSegment] = useState<Segment | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Segment | null>(null);

  const handleEdit = (seg: Segment) => {
    setEditSegment(seg);
    setFormOpen(true);
  };

  const handleNew = () => {
    setEditSegment(null);
    setFormOpen(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Segmentos</h1>
        <Button onClick={handleNew} className="gap-2">
          <Plus className="h-4 w-4" /> Novo segmento
        </Button>
      </div>

      {segments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
            <Filter className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium">Nenhum segmento criado</p>
            <p className="text-sm text-muted-foreground mt-1">Crie segmentos para agrupar seus contatos</p>
          </div>
          <Button onClick={handleNew} variant="outline" className="gap-2">
            <Plus className="h-4 w-4" /> Criar primeiro segmento
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {segments.map(seg => (
            <Card key={seg.id} className="flex flex-col">
              <CardContent className="p-5 flex flex-col flex-1">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium truncate">{seg.name}</h3>
                    {seg.description && (
                      <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{seg.description}</p>
                    )}
                  </div>
                  <Badge variant={seg.type === 'dynamic' ? 'default' : 'secondary'} className="shrink-0 text-[10px]">
                    {seg.type === 'dynamic' ? 'Dinâmico' : 'Estático'}
                  </Badge>
                </div>

                <div className="flex items-center gap-3 text-sm text-muted-foreground mt-auto pt-3">
                  <span className="flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    {counts[seg.id] ?? '...'} contatos
                  </span>
                  <span>·</span>
                  <span>{formatDistanceToNow(new Date(seg.created_at), { addSuffix: true, locale: ptBR })}</span>
                </div>

                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/40">
                  <Button variant="outline" size="sm" className="gap-1.5 flex-1" onClick={() => setDrawerSegment(seg)}>
                    <Users className="h-3 w-3" /> Ver contatos
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 flex-1"
                    onClick={() => navigate(`/adnia/campaigns?segment_id=${seg.id}`)}
                  >
                    <Send className="h-3 w-3" /> Enviar campanha
                  </Button>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-40 p-1" align="end">
                      <button className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted rounded-sm" onClick={() => handleEdit(seg)}>
                        <Pencil className="h-3.5 w-3.5" /> Editar
                      </button>
                      <button className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted rounded-sm" onClick={() => duplicateSegment(seg)}>
                        <Copy className="h-3.5 w-3.5" /> Duplicar
                      </button>
                      <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 rounded-sm" onClick={() => setDeleteConfirm(seg)}>
                        <Trash2 className="h-3.5 w-3.5" /> Excluir
                      </button>
                    </PopoverContent>
                  </Popover>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <SegmentFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        segment={editSegment}
        onSaved={refetch}
      />

      <SegmentContactsDrawer
        segment={drawerSegment}
        onClose={() => setDrawerSegment(null)}
      />

      {/* Delete confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir segmento</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir "{deleteConfirm?.name}"? Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => { deleteSegment(deleteConfirm!.id); setDeleteConfirm(null); }}>
              Excluir
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
