import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Save, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type Field = 'pixel_id' | 'access_token' | 'test_event_code';

const FIELDS: { key: Field; label: string; hint: string; placeholder: string; required: boolean }[] = [
  {
    key: 'pixel_id',
    label: 'Pixel ID',
    hint: 'Events Manager → Fontes de dados',
    placeholder: '1234567890123456',
    required: true,
  },
  {
    key: 'access_token',
    label: 'Access token (CAPI)',
    hint: 'Gerado na aba Conversions API do pixel',
    placeholder: 'EAAG…',
    required: true,
  },
  {
    key: 'test_event_code',
    label: 'Test event code',
    hint: 'Opcional — só para testes no Events Manager',
    placeholder: 'TEST12345',
    required: false,
  },
];

type ConfigState = Record<string, unknown> & { updated_at?: string };

export default function MetaCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<ConfigState | null>(null);
  const [inputs, setInputs] = useState<Record<Field, string>>({
    pixel_id: '',
    access_token: '',
    test_event_code: '',
  });

  const loadConfig = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('meta-config', { method: 'GET' });
      if (error) throw error;
      setConfig(data as ConfigState);
      setInputs({ pixel_id: '', access_token: '', test_event_code: '' });
    } catch (e: any) {
      toast.error('Falha ao carregar configuração do Meta', { description: e?.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const requiredFields = FIELDS.filter((f) => f.required);
  const configuredCount = requiredFields.filter((f) => config?.[`has_${f.key}`]).length;

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      for (const f of FIELDS) {
        if (inputs[f.key].trim().length > 0) body[f.key] = inputs[f.key].trim();
      }
      if (Object.keys(body).length === 0) {
        toast.info('Nenhuma alteração para salvar');
        return;
      }
      const { data, error } = await supabase.functions.invoke('meta-config', { method: 'PUT', body });
      if (error) throw error;
      setConfig(data as ConfigState);
      setInputs({ pixel_id: '', access_token: '', test_event_code: '' });
      toast.success('Credenciais do Meta salvas');
    } catch (e: any) {
      toast.error('Falha ao salvar', { description: e?.message });
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async (field: Field) => {
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('meta-config', {
        method: 'PUT',
        body: { clear: { [field]: true } },
      });
      if (error) throw error;
      setConfig(data as ConfigState);
      toast.success('Valor removido');
    } catch (e: any) {
      toast.error('Falha ao remover', { description: e?.message });
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = FIELDS.some((f) => inputs[f.key].trim().length > 0);

  return (
    <Card className="border-border/40">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-md flex items-center justify-center text-white font-bold text-sm"
            style={{ backgroundColor: '#185FA5' }}
          >
            M
          </div>
          <div>
            <CardTitle className="text-base">Meta</CardTitle>
            <CardDescription className="text-xs">Conversions API (CAPI) e Pixel</CardDescription>
          </div>
        </div>
        <Badge
          variant={configuredCount === requiredFields.length ? 'default' : 'secondary'}
          className={`text-[10px] ${
            configuredCount === requiredFields.length
              ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20'
              : ''
          }`}
        >
          {configuredCount}/{requiredFields.length} configurados
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Credenciais usadas pela função <code className="font-mono">send-to-meta-capi</code> para
          enviar os eventos de conversão server-side. Enquanto um campo estiver vazio, o sistema
          continua usando o valor configurado no ambiente.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…
          </div>
        ) : (
          <div className="space-y-3">
            {FIELDS.map((f) => {
              const saved = Boolean(config?.[`has_${f.key}`]);
              const shown =
                f.key === 'access_token'
                  ? (config?.access_token_masked as string | null)
                  : (config?.[f.key] as string | null);
              return (
                <div key={f.key} className="space-y-1.5">
                  <Label htmlFor={`meta-${f.key}`} className="text-xs">
                    {f.label} <span className="text-muted-foreground font-normal">— {f.hint}</span>
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id={`meta-${f.key}`}
                      value={inputs[f.key]}
                      onChange={(e) => setInputs((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={saved ? shown || '•••• configurado' : f.placeholder}
                      className="h-8 text-xs font-mono"
                      autoComplete="off"
                    />
                    {saved && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-2 flex-shrink-0"
                        onClick={() => handleClear(f.key)}
                        disabled={saving}
                        title="Remover valor salvo"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  {saved && !inputs[f.key] && (
                    <p className="text-[10px] text-muted-foreground">
                      Já salvo. Deixe em branco para manter.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            className="gap-1.5 h-7 text-xs"
            onClick={handleSave}
            disabled={saving || loading || !hasChanges}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
