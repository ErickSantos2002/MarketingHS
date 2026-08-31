import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus, MoreHorizontal, Eye, Pencil, Copy, Trash2, Loader2, LayoutTemplate } from 'lucide-react';
import { useTemplates, type EmailTemplate } from '@/hooks/useTemplates';

export default function Templates() {
  const navigate = useNavigate();
  const { templates, loading, duplicateTemplate, deleteTemplate } = useTemplates();
  const [deleteTarget, setDeleteTarget] = useState<EmailTemplate | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Templates de email</h1>
        <Button onClick={() => navigate('/templates/new')} className="bg-primary hover:bg-primary/90">
          <Plus className="h-4 w-4 mr-2" />
          Novo template
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <LayoutTemplate className="h-10 w-10 opacity-40" />
          <p>Nenhum template criado</p>
          <Button variant="outline" onClick={() => navigate('/templates/new')}>
            <Plus className="h-4 w-4 mr-2" /> Criar primeiro template
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map(t => (
            <Card
              key={t.id}
              className="overflow-hidden cursor-pointer hover:border-primary/40 transition-colors"
              onClick={() => navigate(`/templates/${t.id}/edit`)}
            >
              <div className="h-48 bg-white overflow-hidden border-b relative">
                {t.html ? (
                  <iframe
                    srcDoc={t.html}
                    title={t.name}
                    className="w-full border-0"
                    style={{ height: 480, pointerEvents: 'none' }}
                    sandbox="allow-same-origin"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground/40">
                    <LayoutTemplate className="h-8 w-8" />
                  </div>
                )}
              </div>
              <CardContent className="py-3 px-4 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium truncate">{t.name}</p>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {/* stopPropagation obrigatorio em todos os itens: o Card inteiro
                          tem onClick que navega para o editor. */}
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); window.open(`/templates/${t.id}/preview`, '_blank', 'noopener'); }}>
                        <Eye className="h-4 w-4 mr-2" /> Visualizar
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); navigate(`/templates/${t.id}/edit`); }}>
                        <Pencil className="h-4 w-4 mr-2" /> Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); duplicateTemplate(t); }}>
                        <Copy className="h-4 w-4 mr-2" /> Duplicar
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteTarget(t); }}>
                        <Trash2 className="h-4 w-4 mr-2" /> Excluir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {t.category && <Badge variant="outline" className="text-xs">{t.category}</Badge>}
                {t.description && <p className="text-xs text-muted-foreground truncate">{t.description}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir template?</AlertDialogTitle>
            <AlertDialogDescription>
              O template "{deleteTarget?.name}" será excluído permanentemente. Campanhas já criadas a partir dele não são afetadas — o conteúdo delas é uma cópia independente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (deleteTarget) { deleteTemplate(deleteTarget.id); setDeleteTarget(null); } }} className="bg-destructive">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
