import { useState } from 'react';
import { Plus, RefreshCw, Layout, ExternalLink, Edit, Trash2, Link2, Users, Copy, MoreHorizontal, Flame } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { usePages, type Page, type PageFormData, type PageStat } from '@/hooks/usePages';
import { NewPageDialog } from './NewPageDialog';
import { UTMPresetsModal } from './UTMPresetsModal';

export function PagesManagement() {
  const { pages, pageStats, isLoading, refetch, createPage, updatePage, deletePage, toggleStatus, updatePageConfig } = usePages();
  const navigate = useNavigate();
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; pageId: string; pageName: string; action: 'deactivate' | 'delete' } | null>(null);
  const [utmModal, setUtmModal] = useState<{ open: boolean; page: PageStat } | null>(null);

  const filteredStats = pageStats.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.slug.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalLeads = pageStats.reduce((sum, p) => sum + (p.total_leads || 0), 0);
  const bestPage = pageStats.length > 0 
    ? pageStats.reduce((best, p) => (p.total_leads || 0) > (best.total_leads || 0) ? p : best, pageStats[0])
    : null;

  const handleToggle = (page: PageStat) => {
    if (page.status === 'active') {
      setConfirmDialog({ open: true, pageId: page.id, pageName: page.name, action: 'deactivate' });
    } else {
      toggleStatus.mutate({ id: page.id, currentStatus: page.status || 'inactive' });
    }
  };

  const handleDelete = (page: PageStat) => {
    if ((page.total_leads || 0) > 0) return;
    setConfirmDialog({ open: true, pageId: page.id, pageName: page.name, action: 'delete' });
  };

  const handleConfirm = () => {
    if (!confirmDialog) return;
    if (confirmDialog.action === 'deactivate') {
      toggleStatus.mutate({ id: confirmDialog.pageId, currentStatus: 'active' });
    } else {
      deletePage.mutate(confirmDialog.pageId);
    }
    setConfirmDialog(null);
  };

  const handleDuplicate = (page: PageStat) => {
    const sourceConfig = page.config || {};
    createPage.mutate({
      name: `${page.name} (cópia)`,
      slug: `${page.slug}-copia`,
      component_name: page.slug,
      page_type: page.page_type as any,
      status: 'draft',
      config: sourceConfig,
      template_base: page.slug,
    });
  };

  const handleViewLeads = (slug: string) => {
    navigate(`/contacts?page_slug=${encodeURIComponent(slug)}`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Páginas</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()} disabled={isLoading} size="sm">
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
          <Button onClick={() => setNewDialogOpen(true)} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Nova Página
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-card border rounded-lg p-4">
          <div className="text-2xl font-bold">{pageStats.length}</div>
          <div className="text-sm text-muted-foreground">Total de Páginas</div>
        </div>
        <div className="bg-card border rounded-lg p-4">
          <div className="text-2xl font-bold text-green-500">
            {pageStats.filter((p) => p.status === 'active').length}
          </div>
          <div className="text-sm text-muted-foreground">Páginas Ativas</div>
        </div>
        <div className="bg-card border rounded-lg p-4">
          <div className="text-2xl font-bold text-blue-500">{totalLeads}</div>
          <div className="text-sm text-muted-foreground">Total de Leads</div>
        </div>
        <div className="bg-card border rounded-lg p-4">
          <div className="text-2xl font-bold text-purple-500 truncate text-base">
            {bestPage && (bestPage.total_leads || 0) > 0 ? `/${bestPage.slug}` : '—'}
          </div>
          <div className="text-sm text-muted-foreground">Melhor Página</div>
        </div>
      </div>

      {/* Search */}
      <Input
        placeholder="Buscar por nome ou slug..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="max-w-sm"
      />

      {/* Grid de Cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-52 w-full rounded-lg" />
          ))}
        </div>
      ) : filteredStats.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Layout className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p>Nenhuma página cadastrada</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredStats.map((page) => (
            <div key={page.id} className="group border rounded-lg bg-card hover:border-primary/30 transition-colors">
              {/* Card Header */}
              <div className="flex items-center justify-between p-4 pb-2">
                <Badge variant={page.status === 'active' ? 'default' : 'secondary'} className={page.status === 'active' ? 'bg-green-600 hover:bg-green-700' : ''}>
                  {page.status === 'active' ? 'Ativa' : 'Rascunho'}
                </Badge>
                <Switch
                  checked={page.status === 'active'}
                  onCheckedChange={() => handleToggle(page)}
                />
              </div>

              {/* Card Body */}
              <div className="px-4 pb-2">
                <h3 className="font-medium truncate">{page.name}</h3>
                <code className="text-xs text-muted-foreground font-mono">/{page.slug}</code>
                {page.config?.headline && (
                  <p className="text-xs text-muted-foreground/70 truncate mt-1">{page.config.headline}</p>
                )}
              </div>

              {/* Metrics */}
              <div className="px-4 py-3 border-t grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-sm font-semibold">{page.total_leads || 0}</div>
                  <div className="text-[10px] text-muted-foreground">leads</div>
                </div>
                <div>
                  <div className="text-sm font-semibold flex items-center justify-center gap-1">
                    {page.hot_leads || 0}
                    {(page.hot_leads || 0) > 0 && <Flame className="h-3 w-3 text-orange-500" />}
                  </div>
                  <div className="text-[10px] text-muted-foreground">hot leads</div>
                </div>
                <div>
                  <div className="text-sm font-semibold truncate">
                    {page.last_lead_at 
                      ? formatDistanceToNow(new Date(page.last_lead_at), { addSuffix: false, locale: ptBR })
                      : '—'}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {page.last_lead_at ? 'último' : 'sem leads'}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="px-4 py-2 border-t flex items-center justify-end">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => navigate(`/pages/${page.slug.replace(/^\/+/, '')}/edit`)}>
                      <Edit className="h-4 w-4 mr-2" /> Editar
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setUtmModal({ open: true, page })}>
                      <Link2 className="h-4 w-4 mr-2" /> Gerar link
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleViewLeads(page.slug.replace(/^\/+/, ''))}>
                      <Users className="h-4 w-4 mr-2" /> Ver leads
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDuplicate(page)}>
                      <Copy className="h-4 w-4 mr-2" /> Duplicar
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => window.open(`/${page.slug.replace(/^\/+/, '')}`, '_blank')}>
                      <ExternalLink className="h-4 w-4 mr-2" /> Abrir página
                    </DropdownMenuItem>
                    {(page.total_leads || 0) === 0 && (
                      <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(page)}>
                        <Trash2 className="h-4 w-4 mr-2" /> Excluir
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Page Dialog */}
      <NewPageDialog
        open={newDialogOpen}
        onOpenChange={setNewDialogOpen}
        pages={pages}
        onCreated={(slug) => {
          setNewDialogOpen(false);
          navigate(`/pages/${slug}/edit`);
        }}
      />

      {/* UTM Modal */}
      {utmModal && (
        <UTMPresetsModal
          open={utmModal.open}
          onOpenChange={(open) => setUtmModal(open ? utmModal : null)}
          page={utmModal.page}
          onUpdateConfig={(config) => updatePageConfig.mutate({ slug: utmModal.page.slug, config })}
        />
      )}

      {/* Confirm Dialog */}
      <AlertDialog open={!!confirmDialog?.open} onOpenChange={() => setConfirmDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDialog?.action === 'deactivate' ? 'Desativar página?' : 'Excluir página?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog?.action === 'deactivate'
                ? `Desativar "${confirmDialog.pageName}" vai tirar esta página do ar. Confirmar?`
                : `Tem certeza que deseja excluir "${confirmDialog?.pageName}"? Esta ação não pode ser desfeita.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
