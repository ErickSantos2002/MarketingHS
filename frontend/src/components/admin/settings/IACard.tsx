import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Save, Trash2 } from 'lucide-react';
import { api, ErroApi } from '@/lib/api';
import { toast } from 'sonner';

type ConfigIA = {
  anthropic_api_key: { configurado: boolean; ultimos4: string | null };
  modelo: string;
};

export default function IACard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<ConfigIA | null>(null);
  const [input, setInput] = useState('');

  const loadConfig = async () => {
    setLoading(true);
    try {
      const dados = await api.get<ConfigIA>('/config/ia');
      setConfig(dados);
      setInput('');
    } catch (e) {
      toast.error('Falha ao carregar configuração da IA', {
        description: e instanceof ErroApi ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const configurado = Boolean(config?.anthropic_api_key?.configurado);

  const handleSave = async () => {
    if (input.trim().length === 0) {
      toast.info('Nenhuma alteração para salvar');
      return;
    }
    setSaving(true);
    try {
      await api.put('/config/ia', { api_key: input.trim() });
      await loadConfig();
      toast.success('Chave da Anthropic salva');
    } catch (e) {
      toast.error('Falha ao salvar', {
        description: e instanceof ErroApi ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await api.put('/config/ia', { limpar: true });
      await loadConfig();
      toast.success('Chave removida');
    } catch (e) {
      toast.error('Falha ao remover', {
        description: e instanceof ErroApi ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-border/40">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-md flex items-center justify-center text-white font-bold text-sm"
            style={{ backgroundColor: '#D97757' }}
          >
            IA
          </div>
          <div>
            <CardTitle className="text-base">Inteligência Artificial</CardTitle>
            <CardDescription className="text-xs">Chave da Anthropic (Claude), usada pelo chat e pelas análises</CardDescription>
          </div>
        </div>
        <Badge
          variant={configurado ? 'default' : 'secondary'}
          className={`text-[10px] ${
            configurado ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20' : ''
          }`}
        >
          {configurado ? 'configurado' : 'não configurado'}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          A chave alimenta o chat de dados e as análises de leads e de desafios.
          O disparo é feito pelo servidor — o navegador não fala com a Anthropic
          diretamente.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ia-api-key" className="text-xs">
                Anthropic API key <span className="text-muted-foreground font-normal">— console.anthropic.com</span>
              </Label>
              <div className="flex gap-2">
                <Input
                  id="ia-api-key"
                  type="password"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={
                    configurado
                      ? config?.anthropic_api_key.ultimos4
                        ? `•••• ${config.anthropic_api_key.ultimos4}`
                        : '•••• configurado'
                      : 'sk-ant-…'
                  }
                  className="h-8 text-xs font-mono"
                  autoComplete="off"
                />
                {configurado && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 flex-shrink-0"
                    onClick={handleClear}
                    disabled={saving}
                    title="Remover chave salva"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              {configurado && !input && (
                <p className="text-[10px] text-muted-foreground">
                  Já salva. Deixe em branco para manter.
                </p>
              )}
            </div>

            <p className="text-[10px] text-muted-foreground">
              Modelo em uso: <code className="bg-muted/50 px-1 py-0.5 rounded">{config?.modelo}</code>
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            className="gap-1.5 h-7 text-xs"
            onClick={handleSave}
            disabled={saving || loading || input.trim().length === 0}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
