import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePages, type Page } from '@/hooks/usePages';
import { CheckCircle, XCircle } from 'lucide-react';

interface NewPageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pages: Page[];
  onCreated: (slug: string) => void;
}

export function NewPageDialog({ open, onOpenChange, pages, onCreated }: NewPageDialogProps) {
  const { createPage } = usePages();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManual, setSlugManual] = useState(false);
  const [cloneFrom, setCloneFrom] = useState('');

  useEffect(() => {
    if (!open) {
      setName('');
      setSlug('');
      setSlugManual(false);
      setCloneFrom('');
    }
  }, [open]);

  useEffect(() => {
    if (!slugManual) {
      setSlug(
        name
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '')
      );
    }
  }, [name, slugManual]);

  const slugValid = useMemo(() => /^[a-z0-9][a-z0-9_-]*$/.test(slug), [slug]);
  const slugExists = useMemo(() => pages.some((p) => p.slug === slug), [pages, slug]);

  const isValid = name.trim() && slug.trim() && slugValid && !slugExists && cloneFrom;

  const handleSubmit = async () => {
    if (!isValid) return;
    const basePage = pages.find((p) => p.id === cloneFrom);
    const baseConfig = (basePage as any)?.config || {};

    await createPage.mutateAsync({
      name,
      slug,
      component_name: basePage?.component_name || slug,
      page_type: basePage?.page_type || 'landing',
      status: 'draft',
      config: baseConfig,
      template_base: basePage?.slug,
    });
    onCreated(slug);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Nova Página</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Nome da página</Label>
            <Input
              placeholder="Evento Abril 2026"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Slug</Label>
            <Input
              placeholder="evento-abril-2026"
              value={slug}
              onChange={(e) => {
                setSlugManual(true);
                setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
              }}
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-mono">dnia.ai/{slug}</span>
              {slug && (
                slugExists ? (
                  <Badge variant="destructive" className="text-[10px] gap-1">
                    <XCircle className="h-3 w-3" /> Já existe
                  </Badge>
                ) : (
                  <Badge className="bg-green-600 text-[10px] gap-1">
                    <CheckCircle className="h-3 w-3" /> Disponível
                  </Badge>
                )
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Clonar de qual página?</Label>
            <Select value={cloneFrom} onValueChange={setCloneFrom}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione uma página base" />
              </SelectTrigger>
              <SelectContent>
                {pages.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({p.slug})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {cloneFrom && (
              <Badge variant="secondary" className="text-xs">
                Baseado em: {pages.find((p) => p.id === cloneFrom)?.slug}
              </Badge>
            )}
            <p className="text-xs text-muted-foreground">
              A nova página começa com as mesmas configurações da página selecionada.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={!isValid || createPage.isPending}>
              {createPage.isPending ? 'Criando...' : 'Criar página'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
