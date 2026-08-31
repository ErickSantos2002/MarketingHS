import { useState, useEffect, useMemo } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, Download, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useSegments, type Segment } from '@/hooks/useSegments';
import { StatusBadge } from '@/components/admin/contacts/StatusBadge';

const PAGE_SIZE = 20;

interface Props {
  segment: Segment | null;
  onClose: () => void;
}

export function SegmentContactsDrawer({ segment, onClose }: Props) {
  const { getSegmentContacts } = useSegments();
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (!segment) return;
    setLoading(true);
    setPage(0);
    setSearch('');
    getSegmentContacts(segment.id, segment.type).then(data => {
      setContacts(data);
      setLoading(false);
    });
  }, [segment]);

  const filtered = useMemo(() => {
    if (!search) return contacts;
    const q = search.toLowerCase();
    return contacts.filter(c =>
      (c.nome || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q)
    );
  }, [contacts, search]);

  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  const handleExport = () => {
    const headers = ['Nome', 'Email', 'Cargo', 'Etiqueta', 'Status'];
    const rows = filtered.map(c => [
      c.nome || '', c.email || '', c.cargo || '', c.etiqueta || '', c.status || 'Lead',
    ]);
    const csv = [headers.join(';'), ...rows.map(r => r.map(v => `"${v}"`).join(';'))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `segmento_${segment?.name?.replace(/\s/g, '_')}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <Sheet open={!!segment} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent className="w-full sm:max-w-[600px] p-0 flex flex-col">
        <SheetHeader className="p-6 pb-4 border-b">
          <div className="flex items-center gap-2">
            <SheetTitle className="flex-1">{segment?.name}</SheetTitle>
            <Badge variant={segment?.type === 'dynamic' ? 'default' : 'secondary'} className="text-[10px]">
              {segment?.type === 'dynamic' ? 'Dinâmico' : 'Estático'}
            </Badge>
            <span className="text-sm text-muted-foreground">{filtered.length} contatos</span>
          </div>
        </SheetHeader>

        <div className="flex items-center gap-2 px-6 py-3 border-b">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="Buscar..." className="pl-9 h-9" />
          </div>
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5">
            <Download className="h-3 w-3" /> CSV
          </Button>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-20">Nenhum contato encontrado</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Cargo</TableHead>
                  <TableHead>Etiqueta</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.nome || c.email || '—'}</TableCell>
                    <TableCell className="text-sm">{c.cargo || '—'}</TableCell>
                    <TableCell>
                      {c.etiqueta && <Badge variant="secondary" className="text-[10px]">{c.etiqueta}</Badge>}
                    </TableCell>
                    <TableCell><StatusBadge status={c.status || 'Lead'} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t text-sm">
            <span className="text-muted-foreground">Página {page + 1} de {totalPages}</span>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8" disabled={page === 0} onClick={() => setPage(page - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
