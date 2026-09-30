import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Save, CheckCircle, Loader2, Layout, Eye, EyeOff, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
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
import { usePages } from '@/hooks/usePages';
import { caminhoDaLanding } from '@/lib/landing';
import { toast } from 'sonner';
import { COR_CTA_PADRAO } from '@/landing/padroes';

const FORM_FIELDS = [
  { key: 'nome', label: 'Nome', required: false },
  { key: 'email', label: 'Email', required: true },
  { key: 'whatsapp', label: 'WhatsApp', required: false },
  { key: 'cargo', label: 'Cargo', required: false },
  { key: 'faturamento', label: 'Faturamento', required: false },
  { key: 'funcionarios', label: 'Funcionários', required: false },
];

const REDIRECT_CHIPS = [
  { label: 'WhatsApp', value: 'https://wa.me/5531...' },
  { label: 'Obrigado padrão', value: '/obrigado' },
  { label: 'Hotmart', value: 'https://hotmart.com/...' },
];

export default function PageConfigEditor() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { pages, updatePage, toggleStatus } = usePages();

  const page = pages.find((p) => p.slug === slug);

  // ⚠️ O remix decidia a prévia por uma lista fixa de slugs — as rotas das
  // landings da dn.ia dentro deste SPA, apagadas no lote 0. Aqui toda página
  // tem landing em `/p/{slug}` (o motor de template do subprojeto A), e a
  // casca só serve página ATIVA: rascunho e inativa dão 404. Por isso a regra
  // da prévia é a mesma da casca, não uma lista.
  const hasRoute = page?.status === 'active';
  
  const [config, setConfig] = useState<Record<string, any>>({});
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [publishDialog, setPublishDialog] = useState<'publish' | 'unpublish' | null>(null);
  const [showEventKey, setShowEventKey] = useState(false);
  const [showUserKey, setShowUserKey] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (page) {
      setConfig((page as any).config || {});
    }
  }, [page?.id]);

  const saveConfig = useCallback(async (newConfig: Record<string, any>) => {
    if (!page) return;
    setSaveState('saving');
    try {
      await updatePage.mutateAsync({ id: page.id, data: { config: newConfig } as any });
      setSaveState('saved');
      // Refresh iframe after save
      setTimeout(() => {
        if (iframeRef.current) {
          iframeRef.current.src = iframeRef.current.src;
        }
      }, 1500);
    } catch {
      setSaveState('unsaved');
      toast.error('Erro ao salvar configurações');
    }
  }, [page, updatePage]);

  const updateField = useCallback((key: string, value: any) => {
    setConfig((prev) => {
      const next = { ...prev, [key]: value };
      setSaveState('unsaved');
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => saveConfig(next), 1200);
      return next;
    });
  }, [saveConfig]);

  const handleManualSave = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    saveConfig(config);
  };

  const handlePublishToggle = () => {
    if (!page) return;
    if (page.status === 'active') {
      setPublishDialog('unpublish');
    } else {
      setPublishDialog('publish');
    }
  };

  const confirmPublish = () => {
    if (!page) return;
    toggleStatus.mutate(page.id);
    setPublishDialog(null);
  };


  const clarity = config.clarity || {};
  const clarityIdValid = /^[a-z0-9]{6,20}$/i.test((clarity.project_id || '').trim());
  const updateClarity = (key: string, value: any) => {
    const next = { ...clarity, [key]: value };
    // Se limpou o código, força desativar
    if (key === 'project_id' && !/^[a-z0-9]{6,20}$/i.test((value || '').trim())) {
      next.enabled = false;
    }
    updateField('clarity', next);
  };

  const visibleFields = config.visible_fields || ['nome', 'email', 'whatsapp', 'cargo', 'faturamento'];

  if (!page && pages.length > 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Página não encontrada
        <Button variant="link" onClick={() => navigate('/pages')}>Voltar</Button>
      </div>
    );
  }

  if (!page) {
    return (
      <div className="p-8 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/pages')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-lg font-semibold">{page.name}</h2>
            <code className="text-xs text-muted-foreground font-mono">/{page.slug}</code>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saveState === 'saved' && (
            <Badge variant="success" className="gap-1">
              <CheckCircle className="h-3 w-3" /> Salvo
            </Badge>
          )}
          {saveState === 'saving' && (
            <Badge variant="secondary" className="gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Salvando...
            </Badge>
          )}
          {saveState === 'unsaved' && (
            <Badge variant="outline" className="gap-1">Alterações pendentes</Badge>
          )}
          <Button variant="outline" size="sm" onClick={handleManualSave}>
            <Save className="h-4 w-4 mr-1" /> Salvar
          </Button>
        </div>
      </div>

      {/* Two Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-[55%_45%] gap-6">
        {/* Left - Form */}
        <div className="space-y-6">
          {/* Conteúdo principal */}
          <section className="border rounded-lg p-4 space-y-4">
            <h3 className="font-medium text-sm">Conteúdo principal</h3>
            <div className="space-y-2">
              <Label>Headline</Label>
              <Textarea rows={2} value={config.headline || ''} onChange={(e) => updateField('headline', e.target.value)} placeholder="Texto principal da página" />
            </div>
            <div className="space-y-2">
              <Label>Subheadline</Label>
              <Textarea rows={2} value={config.subheadline || ''} onChange={(e) => updateField('subheadline', e.target.value)} placeholder="Texto secundário" />
            </div>
            <div className="space-y-2">
              <Label>Texto do CTA</Label>
              <Input value={config.cta_text || ''} onChange={(e) => updateField('cta_text', e.target.value)} placeholder="QUERO PARTICIPAR" />
            </div>
            <div className="space-y-2">
              <Label>Cor do CTA</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={config.cta_color || COR_CTA_PADRAO}
                  onChange={(e) => updateField('cta_color', e.target.value)}
                  className="h-9 w-12 rounded border cursor-pointer"
                />
                <Input
                  value={config.cta_color || COR_CTA_PADRAO}
                  onChange={(e) => updateField('cta_color', e.target.value)}
                  className="w-28 font-mono text-sm"
                />
              </div>
            </div>
          </section>

          {/* Formulário */}
          <section className="border rounded-lg p-4 space-y-4">
            <h3 className="font-medium text-sm">Campos do formulário</h3>
            <div className="grid grid-cols-2 gap-3">
              {FORM_FIELDS.map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={visibleFields.includes(f.key)}
                    disabled={f.required}
                    onCheckedChange={(checked) => {
                      const next = checked
                        ? [...visibleFields, f.key]
                        : visibleFields.filter((k: string) => k !== f.key);
                      updateField('visible_fields', next);
                    }}
                  />
                  {f.label}
                  {f.required && <span className="text-xs text-muted-foreground">(obrigatório)</span>}
                </label>
              ))}
            </div>
          </section>

          {/* Redirecionamento */}
          <section className="border rounded-lg p-4 space-y-4">
            <h3 className="font-medium text-sm">Redirecionamento</h3>
            <div className="space-y-2">
              <Label>URL de redirect após conversão</Label>
              <Input
                value={config.redirect_url || ''}
                onChange={(e) => updateField('redirect_url', e.target.value)}
                placeholder="https://wa.me/5531..."
              />
              <div className="flex gap-1">
                {REDIRECT_CHIPS.map((chip) => (
                  <Badge
                    key={chip.label}
                    variant="outline"
                    className="cursor-pointer hover:bg-surface-elevated text-xs"
                    onClick={() => updateField('redirect_url', chip.value)}
                  >
                    {chip.label}
                  </Badge>
                ))}
              </div>
            </div>
          </section>

          {/* ⚠️ A seção do dn.ticket saiu no lote 5D. Ticketia é o sistema de
              ingresso da dn.ia e a spec o DESCARTA (seção 9, travas de
              terceiro) — a HS não tem equivalente. A tela oferecia configurar e
              "Testar conexão" numa integração que não existe mais: campo para
              preencher, botão para clicar, e uma function morta do outro lado. */}
          {/* Integração Microsoft Clarity */}
          <section className="border rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-sm flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Integração{' '}
                <a
                  href="https://clarity.microsoft.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Microsoft Clarity
                </a>
              </h3>
              <div className="flex items-center gap-2">
                <Label htmlFor="clarity-enabled" className="text-xs text-muted-foreground">
                  {clarity.enabled ? 'Ativada' : 'Desativada'}
                </Label>
                <Switch
                  id="clarity-enabled"
                  checked={!!clarity.enabled}
                  disabled={!clarityIdValid}
                  onCheckedChange={(v) => updateClarity('enabled', v)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Quando ativa, o script oficial do Clarity é injetado automaticamente no <code className="bg-muted px-1 rounded">&lt;head&gt;</code> desta página, usando o código informado abaixo. Encontre o código no painel do Clarity em <em>Settings → Setup</em>.
            </p>
            <div className="space-y-2">
              <Label className="text-xs">Project ID (código personalizado)</Label>
              <Input
                value={clarity.project_id || ''}
                onChange={(e) => updateClarity('project_id', e.target.value.trim())}
                placeholder="wq39c9c11g"
                className="font-mono text-xs"
              />
              {!clarityIdValid && (clarity.project_id || '').length > 0 && (
                <p className="text-xs text-[--on-tint-danger]">
                  Código inválido. Use entre 6 e 20 caracteres alfanuméricos.
                </p>
              )}
              {!clarityIdValid && !(clarity.project_id || '').length && (
                <p className="text-xs text-muted-foreground">
                  Informe um código válido para poder ativar a integração.
                </p>
              )}
            </div>
          </section>

          {/* SEO */}
          <section className="border rounded-lg p-4 space-y-4">
            <h3 className="font-medium text-sm">SEO</h3>
            <div className="space-y-2">
              <Label>Meta title</Label>
              <Input value={config.meta_title || ''} onChange={(e) => updateField('meta_title', e.target.value)} placeholder="Título para SEO" />
            </div>
            <div className="space-y-2">
              <Label>Meta description</Label>
              <Textarea rows={2} value={config.meta_description || ''} onChange={(e) => updateField('meta_description', e.target.value)} placeholder="Descrição para SEO" />
            </div>
          </section>
        </div>

        {/* Right - Preview */}
        <div className="space-y-3 lg:sticky lg:top-4">
          <div className="relative border rounded-lg overflow-hidden bg-muted/20">
            <Badge variant="warning" className="absolute top-2 left-2 z-10">PREVIEW</Badge>
            {hasRoute ? (
              <iframe
                ref={iframeRef}
                src={caminhoDaLanding(page.slug)}
                className="w-full border-0"
                style={{ height: '520px' }}
                title="Preview"
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-center px-6" style={{ height: '520px' }}>
                <Layout className="h-12 w-12 text-muted-foreground/40 mb-3" />
                <p className="text-sm font-medium">Preview indisponível</p>
                <p className="text-xs text-muted-foreground mt-1">
                  A landing <code className="bg-muted px-1 rounded">{caminhoDaLanding(page.slug)}</code> só
                  é servida com a página ativa. Publique para ver o preview.
                </p>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => window.open(caminhoDaLanding(page.slug), '_blank')}>
              <ExternalLink className="h-4 w-4 mr-1" /> Abrir em nova aba
            </Button>
            <Button
              variant={page.status === 'active' ? 'destructive' : 'default'}
              size="sm"
              onClick={handlePublishToggle}
            >
              {page.status === 'active' ? 'Despublicar' : 'Publicar'}
            </Button>
          </div>
        </div>
      </div>

      {/* Publish/Unpublish Dialog */}
      <AlertDialog open={!!publishDialog} onOpenChange={() => setPublishDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {publishDialog === 'publish' ? 'Publicar página?' : 'Despublicar página?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {publishDialog === 'publish'
                ? 'A página ficará acessível publicamente.'
                : 'A página será removida do ar.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPublish}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
