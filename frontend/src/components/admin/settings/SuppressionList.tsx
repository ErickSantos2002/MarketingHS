import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MailX, Plus, Loader2, Search, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

type SuppressionReason = 'bounce' | 'complaint' | 'unsubscribe' | 'manual';

type Suppression = {
  id: string;
  email: string;
  reason: SuppressionReason;
  source: string | null;
  lead_id: string | null;
  created_at: string;
};

const PAGE_SIZE = 20;

// Regex simples para validação básica de formato de email no formulário manual
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ReasonBadge({ reason }: { reason: SuppressionReason }) {
  if (reason === 'bounce') {
    return <Badge className="bg-red-500/15 text-red-400 border-red-500/30 text-[10px]" variant="outline">Bounce</Badge>;
  }
  if (reason === 'complaint') {
    return <Badge className="bg-orange-500/15 text-orange-400 border-orange-500/30 text-[10px]" variant="outline">Marcou spam</Badge>;
  }
  if (reason === 'unsubscribe') {
    return <Badge className="bg-muted/50 text-muted-foreground border-border/30 text-[10px]" variant="outline">Descadastrou</Badge>;
  }
  return <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/30 text-[10px]" variant="outline">Manual</Badge>;
}

export default function SuppressionList() {
  const [items, setItems] = useState<Suppression[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  const [addOpen, setAddOpen] = useState(false);
  const [addEmail, setAddEmail] = useState('');
  const [adding, setAdding] = useState(false);

  const [removing, setRemoving] = useState<string | null>(null);

  // Incrementado após inserir/remover para forçar um refetch pelo effect abaixo,
  // mantendo TODO o fetching (e seus guards) em um único lugar.
  const [reloadKey, setReloadKey] = useState(0);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  useEffect(() => {
    let cancelled = false;

    const fetchSuppressions = async () => {
      setLoading(true);
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      // Tipos de 'email_suppressions' ainda não estão em types.ts (auto-gerado);
      // serão regenerados após o deploy da migration — mesmo padrão de useCampaigns.tsx.
      let query = supabase
        .from('email_suppressions' as any)
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

      if (search.trim()) {
        query = query.ilike('email', `%${search.trim()}%`);
      }

      const { data, error, count } = await query;

      // Descarta respostas de requisições superadas (troca rápida de página/busca)
      if (cancelled) return;

      if (error) {
        console.error('Error fetching email suppressions:', error);
        toast.error('Erro ao carregar lista de supressão');
        setItems([]);
        setTotalCount(0);
        setLoading(false);
        return;
      }

      // Se a página atual deixou de existir (ex.: removeu o último item da última
      // página), volta para a última página válida — o effect refaz o fetch.
      const newTotalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
      if (page > newTotalPages) {
        setTotalCount(count ?? 0);
        setPage(newTotalPages);
        return;
      }

      setItems((data as unknown as Suppression[]) || []);
      setTotalCount(count ?? 0);
      setLoading(false);
    };

    fetchSuppressions();

    return () => { cancelled = true; };
  }, [page, search, reloadKey]);

  const refetch = () => setReloadKey((k) => k + 1);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
  };

  const handleAdd = async () => {
    const email = addEmail.toLowerCase().trim();
    if (!EMAIL_REGEX.test(email)) {
      toast.error('Informe um email válido');
      return;
    }
    setAdding(true);
    try {
      const { error } = await supabase
        .from('email_suppressions' as any)
        .insert({ email, reason: 'manual', source: 'admin' } as any);

      if (error) {
        if (error.code === '23505') {
          toast.info('Este email já está na lista de supressão');
        } else {
          throw error;
        }
      } else {
        toast.success('Email suprimido com sucesso');
      }
      setAddOpen(false);
      setAddEmail('');
      setPage(1);
      refetch();
    } catch (err) {
      console.error('Error adding suppression:', err);
      toast.error('Erro ao suprimir email');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (id: string) => {
    setRemoving(id);
    try {
      const { error } = await supabase
        .from('email_suppressions' as any)
        .delete()
        .eq('id', id);
      if (error) throw error;
      toast.success('Email removido da lista de supressão');
      refetch();
    } catch (err) {
      console.error('Error removing suppression:', err);
      toast.error('Erro ao remover email');
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">Supressão de Email</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Emails que não devem receber campanhas (bounce, spam, descadastro ou bloqueio manual)
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          Suprimir email
        </Button>
      </div>

      {/* Search */}
      <form onSubmit={handleSearchSubmit} className="flex gap-2 max-w-sm">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Buscar por email..."
          className="text-xs h-9"
        />
        <Button type="submit" variant="outline" size="sm" className="flex-shrink-0">
          <Search className="h-3.5 w-3.5" />
        </Button>
      </form>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center mb-3">
            <MailX className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">Nenhum email suprimido</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs">
            {search
              ? 'Nenhum resultado para essa busca.'
              : 'Emails com bounce, reclamação de spam, descadastro ou bloqueio manual aparecerão aqui.'}
          </p>
        </div>
      ) : (
        <div className="border border-border/30 rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/30 hover:bg-transparent">
                <TableHead className="text-[11px] h-9">Email</TableHead>
                <TableHead className="text-[11px] h-9">Motivo</TableHead>
                <TableHead className="text-[11px] h-9">Origem</TableHead>
                <TableHead className="text-[11px] h-9">Data</TableHead>
                <TableHead className="text-[11px] h-9 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id} className="border-b border-border/20">
                  <TableCell className="py-2.5 text-xs font-medium">{item.email}</TableCell>
                  <TableCell className="py-2.5"><ReasonBadge reason={item.reason} /></TableCell>
                  <TableCell className="py-2.5 text-xs text-muted-foreground">{item.source || '—'}</TableCell>
                  <TableCell className="py-2.5 text-xs text-muted-foreground">
                    {format(new Date(item.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })}
                  </TableCell>
                  <TableCell className="py-2.5 text-right">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] text-muted-foreground hover:text-red-400 hover:bg-red-500/10 px-2 gap-1"
                          disabled={removing === item.id}
                        >
                          {removing === item.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                          Remover
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remover da lista de supressão?</AlertDialogTitle>
                          <AlertDialogDescription>
                            O email "{item.email}" voltará a poder receber campanhas. Esta ação não pode ser desfeita.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleRemove(item.id)}>
                            Remover
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination — renderizada sempre que houver mais de uma página, mesmo se a
          página atual vier vazia, para que nunca exista um beco sem saída */}
      {!loading && totalCount > PAGE_SIZE && (
        <div className="flex items-center justify-between px-1">
          <p className="text-xs text-muted-foreground">
            Página {page} de {totalPages} · {totalCount} {totalCount === 1 ? 'email suprimido' : 'emails suprimidos'}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Add Modal */}
      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) setAddEmail(''); }}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="text-base">Suprimir email manualmente</DialogTitle>
            <DialogDescription className="text-xs">
              O email deixará de receber campanhas de email imediatamente
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Email <span className="text-red-400">*</span></Label>
              <Input
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                placeholder="exemplo@dominio.com"
                type="email"
                className="text-xs h-9"
                onKeyDown={(e) => { if (e.key === 'Enter' && !adding) handleAdd(); }}
              />
            </div>
            <Button className="w-full" onClick={handleAdd} disabled={adding || !addEmail.trim()}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <MailX className="h-4 w-4 mr-2" />}
              Suprimir email
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
