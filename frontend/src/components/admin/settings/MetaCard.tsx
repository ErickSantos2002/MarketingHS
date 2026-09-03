import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Save, Trash2, Send } from 'lucide-react';
import { api, ErroApi } from '@/lib/api';
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

type ConfigMeta = {
  pixel_id: string | null;
  access_token: { configurado: boolean; ultimos4: string | null };
  test_event_code: string | null;
  configurado: boolean;
};

export default function MetaCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [config, setConfig] = useState<ConfigMeta | null>(null);
  const [inputs, setInputs] = useState<Record<Field, string>>({
    pixel_id: '',
    access_token: '',
    test_event_code: '',
  });

  const loadConfig = async () => {
    setLoading(true);
    try {
      const dados = await api.get<ConfigMeta>('/config/meta');
      setConfig(dados);
      setInputs({ pixel_id: '', access_token: '', test_event_code: '' });
    } catch (e) {
      toast.error('Falha ao carregar configuração do Meta', {
        description: e instanceof ErroApi ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const requiredFields = FIELDS.filter((f) => f.required);
  const configuredCount = [
    Boolean(config?.pixel_id),
    Boolean(config?.access_token?.configurado),
  ].filter(Boolean).length;

  const handleSave = async () => {
    const corpo: Record<string, string> = {};
    for (const f of FIELDS) {
      if (inputs[f.key].trim().length > 0) corpo[f.key] = inputs[f.key].trim();
    }
    if (Object.keys(corpo).length === 0) {
      toast.info('Nenhuma alteração para salvar');
      return;
    }
    setSaving(true);
    try {
      await api.put('/config/meta', corpo);
      await loadConfig();
      toast.success('Credenciais do Meta salvas');
    } catch (e) {
      toast.error('Falha ao salvar', {
        description: e instanceof ErroApi ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async (field: Field) => {
    setSaving(true);
    try {
      await api.put('/config/meta', { limpar: [field] });
      await loadConfig();
      toast.success('Valor removido');
    } catch (e) {
      toast.error('Falha ao remover', {
        description: e instanceof ErroApi ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      await api.post('/config/meta/testar');
      toast.success('Evento de teste enviado', {
        description: 'Confira em Events Manager → Eventos de teste.',
      });
    } catch (e) {
      // ⚠️ A mensagem do backend repassa a do Meta e diz o que fazer (token
      // expirado, pixel inexistente, falta o test event code). Engoli-la
      // deixaria a pessoa sem saber por que não funcionou.
      toast.error('O teste não passou', {
        description: e instanceof ErroApi ? e.message : 'Erro desconhecido',
      });
    } finally {
      setTesting(false);
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
          Credenciais do Meta Conversions API. O disparo é feito pelo servidor, no
          caminho de captura do lead — o navegador não fala com o Meta pelo nosso
          backend. O evento de teste exige o <em>test event code</em> preenchido.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…
          </div>
        ) : (
          <div className="space-y-3">
            {FIELDS.map((f) => {
              const saved =
                f.key === 'access_token'
                  ? Boolean(config?.access_token?.configurado)
                  : Boolean(config?.[f.key as 'pixel_id' | 'test_event_code']);
              const shown =
                f.key === 'access_token'
                  ? config?.access_token?.ultimos4
                    ? `•••• ${config.access_token.ultimos4}`
                    : null
                  : (config?.[f.key as 'pixel_id' | 'test_event_code'] ?? null);
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
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-7 text-xs"
            onClick={handleTest}
            disabled={testing || saving || loading}
          >
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {testing ? 'Enviando…' : 'Enviar evento de teste'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
