import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Copy, Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { PageStat } from '@/hooks/usePages';

const QUICK_PRESETS: Record<string, { source: string; medium: string }> = {
  'Instagram Feed': { source: 'instagram', medium: 'feed' },
  'Instagram Stories': { source: 'instagram', medium: 'stories' },
  'WhatsApp': { source: 'whatsapp', medium: 'direct' },
  'Email': { source: 'email', medium: 'newsletter' },
  'Google Ads': { source: 'google', medium: 'cpc' },
  'YouTube': { source: 'youtube', medium: 'video' },
};

interface UTMPresetsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  page: PageStat;
  onUpdateConfig: (config: Record<string, any>) => void;
}

export function UTMPresetsModal({ open, onOpenChange, page, onUpdateConfig }: UTMPresetsModalProps) {
  const presets: Array<{ name: string; source: string; medium: string; campaign: string; content?: string }> = 
    (page.config?.utm_presets as any[]) || [];

  const [name, setName] = useState('');
  const [source, setSource] = useState('');
  const [medium, setMedium] = useState('');
  const [campaign, setCampaign] = useState('');
  const [content, setContent] = useState('');

  const baseUrl = `https://dnia.ai/${page.slug}`;

  const buildUrl = (s: string, m: string, c: string, ct?: string) => {
    const params = new URLSearchParams();
    if (s) params.set('utm_source', s);
    if (m) params.set('utm_medium', m);
    if (c) params.set('utm_campaign', c);
    if (ct) params.set('utm_content', ct);
    return `${baseUrl}?${params.toString()}`;
  };

  const currentUrl = buildUrl(source, medium, campaign, content);

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success('Link copiado!');
  };

  const savePreset = () => {
    if (!name || !source || !medium) return;
    const newPreset = { name, source, medium, campaign, content };
    const updated = [...presets, newPreset];
    onUpdateConfig({ ...page.config, utm_presets: updated });
    toast.success('Preset salvo');
    setName(''); setSource(''); setMedium(''); setCampaign(''); setContent('');
  };

  const deletePreset = (idx: number) => {
    const updated = presets.filter((_, i) => i !== idx);
    onUpdateConfig({ ...page.config, utm_presets: updated });
    toast.success('Preset removido');
  };

  const applyQuickPreset = (label: string) => {
    const p = QUICK_PRESETS[label];
    setSource(p.source);
    setMedium(p.medium);
    if (!name) setName(label);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Links rastreados — {page.name}</DialogTitle>
        </DialogHeader>

        {presets.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Presets salvos</Label>
            {presets.map((preset, i) => (
              <div key={i} className="flex items-center gap-2 border rounded-md p-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{preset.name}</div>
                  <code className="text-[10px] text-muted-foreground truncate block">
                    {buildUrl(preset.source, preset.medium, preset.campaign, preset.content)}
                  </code>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => copyUrl(buildUrl(preset.source, preset.medium, preset.campaign, preset.content))}>
                  <Copy className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive hover:text-destructive" onClick={() => deletePreset(i)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Presets rápidos</Label>
          <div className="flex flex-wrap gap-1">
            {Object.keys(QUICK_PRESETS).map((label) => (
              <Badge key={label} variant="outline" className="cursor-pointer hover:bg-primary/10" onClick={() => applyQuickPreset(label)}>
                {label}
              </Badge>
            ))}
          </div>
        </div>

        <div className="space-y-3 border-t pt-3">
          <Label className="text-xs text-muted-foreground">Criar novo preset</Label>
          <Input placeholder="Nome do preset" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="utm_source" value={source} onChange={(e) => setSource(e.target.value)} />
            <Input placeholder="utm_medium" value={medium} onChange={(e) => setMedium(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="utm_campaign" value={campaign} onChange={(e) => setCampaign(e.target.value)} />
            <Input placeholder="utm_content (opcional)" value={content} onChange={(e) => setContent(e.target.value)} />
          </div>

          {source && (
            <div className="border rounded-md p-3 bg-muted/30">
              <code className="text-xs break-all">{currentUrl}</code>
              <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => copyUrl(currentUrl)}>
                <Copy className="h-3 w-3 mr-2" /> Copiar link
              </Button>
            </div>
          )}

          <Button onClick={savePreset} disabled={!name || !source || !medium} className="w-full" size="sm">
            <Plus className="h-4 w-4 mr-2" /> Salvar preset
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
