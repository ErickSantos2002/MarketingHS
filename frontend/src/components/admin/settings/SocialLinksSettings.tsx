import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Save, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { useSocialLinks } from '@/hooks/useSocialLinks';
import {
  SOCIAL_ICON_TYPES,
  SOCIAL_NETWORKS,
  isValidSocialUrl,
  socialIconPreviewUrl,
  type SocialIconType,
} from '@/lib/socialLinks';

const ICON_TYPE_LABELS: Record<SocialIconType, string> = {
  circle: 'Círculo colorido',
  'circle-black': 'Círculo preto',
  'circle-white': 'Círculo branco',
  rounded: 'Arredondado colorido',
  'rounded-black': 'Arredondado preto',
  squared: 'Quadrado colorido',
  'squared-black': 'Quadrado preto',
};

export default function SocialLinksSettings() {
  const { config, loading, save } = useSocialLinks();
  const [iconType, setIconType] = useState<SocialIconType>(config.iconType);
  const [links, setLinks] = useState<Record<string, string>>(config.links);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setIconType(config.iconType);
    setLinks(config.links);
  }, [config]);

  const invalidKeys = SOCIAL_NETWORKS
    .filter(n => !isValidSocialUrl(links[n.key] || ''))
    .map(n => n.key);

  const filled = SOCIAL_NETWORKS.filter(n => (links[n.key] || '').trim());

  const handleSave = async () => {
    if (invalidKeys.length > 0) {
      toast.error('Corrija as URLs inválidas antes de salvar');
      return;
    }
    setSaving(true);
    const trimmed = Object.fromEntries(
      SOCIAL_NETWORKS.map(n => [n.key, (links[n.key] || '').trim()]),
    );
    const ok = await save({ iconType, links: trimmed });
    setSaving(false);
    toast[ok ? 'success' : 'error'](ok ? 'Redes sociais salvas' : 'Falha ao salvar');
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <Card className="border-border/40">
      <CardHeader>
        <div className="flex items-center gap-3">
          <Share2 className="h-6 w-6 text-primary" />
          <div>
            <CardTitle className="text-base">Redes sociais</CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Ao arrastar o bloco "Social" no editor de email, os ícones já vêm com estes links.
              Redes sem URL não aparecem no email.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="max-w-xs">
          <Label className="text-xs text-muted-foreground">Estilo dos ícones</Label>
          <Select value={iconType} onValueChange={v => setIconType(v as SocialIconType)}>
            <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SOCIAL_ICON_TYPES.map(t => (
                <SelectItem key={t} value={t}>{ICON_TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {SOCIAL_NETWORKS.map(network => {
            const invalid = invalidKeys.includes(network.key);
            return (
              <div key={network.key}>
                <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <img
                    src={socialIconPreviewUrl(network, iconType)}
                    alt=""
                    width={16}
                    height={16}
                    className="rounded-sm"
                  />
                  {network.name}
                </Label>
                <Input
                  value={links[network.key] || ''}
                  onChange={e => setLinks(prev => ({ ...prev, [network.key]: e.target.value }))}
                  placeholder={network.placeholder}
                  className={`mt-1.5 text-xs ${invalid ? 'border-red-500' : ''}`}
                />
                {invalid && (
                  <p className="text-[10px] text-red-500 mt-1">
                    Informe uma URL completa (começando com https://) ou deixe em branco
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div className="pt-3 border-t border-border/30 space-y-3">
          <div>
            <p className="text-xs text-muted-foreground mb-2">
              {filled.length > 0
                ? 'Prévia do bloco no email:'
                : 'Nenhuma rede configurada — o bloco "Social" continua disponível no editor, porém vazio.'}
            </p>
            {filled.length > 0 && (
              <div className="flex items-center gap-2 rounded-md bg-white p-3 w-fit">
                {filled.map(network => (
                  <img
                    key={network.key}
                    src={socialIconPreviewUrl(network, iconType)}
                    alt={network.name}
                    title={network.name}
                    width={32}
                    height={32}
                  />
                ))}
              </div>
            )}
          </div>

          <Button onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
