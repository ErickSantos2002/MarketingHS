import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Save, CheckCircle, Loader2, Layout, Eye, EyeOff, Ticket, Activity } from 'lucide-react';
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
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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

  // Known routes in the React Router
  const KNOWN_SLUGS = useMemo(() => new Set([
    '', 'convidado', 'obrigadoconvidado', 'obrigado', 'obrigado-recuperacao',
    'gratuito', 'obrigadogratuito', 'obrigadointeresse', 'oportunidade',
    'linkaula', 'pesquisa', 'p1g', '24-25fev', 'v2_2425fev', 'v3_2425fev',
    'programadeiaficacao', 'eventoia', 'eventoia130526', 'eventoia140426',
  ]), []);
  const hasRoute = slug ? KNOWN_SLUGS.has(slug) : false;
  
  const [config, setConfig] = useState<Record<string, any>>({});
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [publishDialog, setPublishDialog] = useState<'publish' | 'unpublish' | null>(null);
  const [showEventKey, setShowEventKey] = useState(false);
  const [showUserKey, setShowUserKey] = useState(false);
  const [testingTicketia, setTestingTicketia] = useState(false);
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
    toggleStatus.mutate({ id: page.id, currentStatus: page.status });
    setPublishDialog(null);
  };

  const ticketia = config.ticketia || {};
  const updateTicketia = (key: string, value: any) => {
    updateField('ticketia', { ...ticketia, [key]: value });
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

  const handleTestTicketia = async () => {
    if (!ticketia.event_id || !ticketia.event_api_key || !ticketia.user_api_key) {
      toast.error('Preencha todos os campos do dn.ticket antes de testar');
      return;
    }
    setTestingTicketia(true);
    try {
      // ensure latest config is saved
      if (debounceRef.current) clearTimeout(debounceRef.current);
      await saveConfig(config);
      const { data, error } = await supabase.functions.invoke('send-to-ticketia', {
        body: { slug: page!.slug, test: true },
      });
      if (error) throw error;
      if (data?.success) {
        toast.success(`dn.ticket respondeu OK (status ${data.status})`);
      } else if (data?.skipped) {
        toast.warning('Integração desativada — ative o toggle para enviar novos leads ao dn.ticket');
      } else {
        const detail = data?.error || (data?.body ? JSON.stringify(data.body).slice(0, 200) : JSON.stringify(data).slice(0, 200));
        toast.error(`Falha dn.ticket${data?.status ? ` (status ${data.status})` : ''} — ${detail}`);
      }
    } catch (e: any) {
      toast.error(`Erro ao testar: ${e.message || e}`);
    } finally {
      setTestingTicketia(false);
    }
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
            <Badge variant="secondary" className="gap-1 text-green-600">
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
                  value={config.cta_color || '#E41A11'}
                  onChange={(e) => updateField('cta_color', e.target.value)}
                  className="h-9 w-12 rounded border cursor-pointer"
                />
                <Input
                  value={config.cta_color || '#E41A11'}
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
                  {f.required && <span className="text-[10px] text-muted-foreground">(obrigatório)</span>}
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
                    className="cursor-pointer hover:bg-primary/10 text-xs"
                    onClick={() => updateField('redirect_url', chip.value)}
                  >
                    {chip.label}
                  </Badge>
                ))}
              </div>
            </div>
          </section>

          {/* Integração Ticket.ia */}
          <section className="border rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-sm flex items-center gap-2">
                <Ticket className="h-4 w-4" />
                Integração{' '}
                <a
                  href="https://dnticket.dnia.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  &lt;dn.ticket&gt;
                </a>
              </h3>
              <div className="flex items-center gap-2">
                <Label htmlFor="ticketia-enabled" className="text-xs text-muted-foreground">
                  {ticketia.enabled ? 'Ativada' : 'Desativada'}
                </Label>
                <Switch
                  id="ticketia-enabled"
                  checked={!!ticketia.enabled}
                  onCheckedChange={(v) => updateTicketia('enabled', v)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Cada novo lead capturado será cadastrado automaticamente como participante no evento dn.ticket.
            </p>
            <div className="space-y-2">
              <Label className="text-xs">ID do evento</Label>
              <Input
                value={ticketia.event_id || ''}
                onChange={(e) => updateTicketia('event_id', e.target.value)}
                placeholder="UUID do evento dn.ticket"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">API key do evento</Label>
              <div className="flex gap-2">
                <Input
                  type={showEventKey ? 'text' : 'password'}
                  value={ticketia.event_api_key || ''}
                  onChange={(e) => updateTicketia('event_api_key', e.target.value)}
                  placeholder="x-event-api-key"
                  className="font-mono text-xs"
                />
                <Button type="button" variant="outline" size="icon" onClick={() => setShowEventKey((v) => !v)}>
                  {showEventKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">API key do usuário</Label>
              <div className="flex gap-2">
                <Input
                  type={showUserKey ? 'text' : 'password'}
                  value={ticketia.user_api_key || ''}
                  onChange={(e) => updateTicketia('user_api_key', e.target.value)}
                  placeholder="x-user-api-key"
                  className="font-mono text-xs"
                />
                <Button type="button" variant="outline" size="icon" onClick={() => setShowUserKey((v) => !v)}>
                  {showUserKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTestTicketia}
              disabled={testingTicketia || !ticketia.event_id || !ticketia.event_api_key || !ticketia.user_api_key}
            >
              {testingTicketia ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Ticket className="h-4 w-4 mr-1" />}
              Testar conexão
            </Button>
          </section>

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
                <p className="text-[11px] text-destructive">
                  Código inválido. Use entre 6 e 20 caracteres alfanuméricos.
                </p>
              )}
              {!clarityIdValid && !(clarity.project_id || '').length && (
                <p className="text-[11px] text-muted-foreground">
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
            <Badge className="absolute top-2 left-2 z-10 bg-yellow-500 text-black hover:bg-yellow-600">PREVIEW</Badge>
            {hasRoute ? (
              <iframe
                ref={iframeRef}
                src={`/${page.slug}?preview=true`}
                className="w-full border-0"
                style={{ height: '520px' }}
                title="Preview"
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-center px-6" style={{ height: '520px' }}>
                <Layout className="h-12 w-12 text-muted-foreground/40 mb-3" />
                <p className="text-sm font-medium">Preview indisponível</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Esta página é baseada em <code className="bg-muted px-1 rounded">/{page.template_base || '...'}</code>.
                  O preview será exibido quando houver uma rota registrada para <code className="bg-muted px-1 rounded">/{page.slug}</code>.
                </p>
                {page.template_base && (
                  <Button variant="outline" size="sm" className="mt-4" onClick={() => window.open(`/${page.template_base}?preview=true`, '_blank')}>
                    <ExternalLink className="h-4 w-4 mr-1" /> Ver página base
                  </Button>
                )}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => window.open(`/${page.slug}`, '_blank')}>
              <ExternalLink className="h-4 w-4 mr-1" /> Abrir em nova aba
            </Button>
            <Button
              variant={page.status === 'active' ? 'destructive' : 'default'}
              size="sm"
              onClick={handlePublishToggle}
              className={page.status !== 'active' ? 'bg-green-600 hover:bg-green-700' : ''}
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
