import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Wifi, WifiOff, CheckCircle2, Eye, EyeOff, Save } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type ConnectionStatus = 'idle' | 'testing' | 'connected' | 'error' | 'unconfigured';

type ConfigState = {
  workspace_id: string;
  base_url: string;
  has_api_key: boolean;
  api_key_masked: string | null;
};

export default function NexusCard() {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [stageCount, setStageCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<ConfigState | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [workspaceInput, setWorkspaceInput] = useState('');
  const [baseUrlInput, setBaseUrlInput] = useState('');
  const [showKey, setShowKey] = useState(false);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('nexus-config', { method: 'GET' });
      if (error) throw error;
      const c = data as ConfigState;
      setConfig(c);
      setWorkspaceInput(c.workspace_id || '');
      setBaseUrlInput(c.base_url || '');
      setApiKeyInput('');
      if (!c.has_api_key || !c.workspace_id) {
        setStatus('unconfigured');
      } else {
        setStatus('idle');
      }
    } catch (e: any) {
      toast.error('Falha ao carregar configuração', { description: e?.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setErrorMsg('');
    try {
      const body: Record<string, unknown> = {
        workspace_id: workspaceInput,
        base_url: baseUrlInput,
      };
      if (apiKeyInput.trim().length > 0) body.api_key = apiKeyInput.trim();

      const { data, error } = await supabase.functions.invoke('nexus-config', {
        method: 'PUT',
        body,
      });
      if (error) throw error;

      const c = data as ConfigState;
      setConfig(c);
      setApiKeyInput('');
      toast.success('Credenciais salvas');

      // Testa automaticamente após salvar, se estiver configurado.
      if (c.has_api_key && c.workspace_id) {
        await handleTest();
      } else {
        setStatus('unconfigured');
      }
    } catch (e: any) {
      toast.error('Falha ao salvar', { description: e?.message });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setStatus('testing');
    setErrorMsg('');
    try {
      const { data, error } = await supabase.functions.invoke('get-nexus-stages');
      if (error) throw error;

      const stages = data?.stages || [];
      if (data?.error && stages.length === 0) {
        throw new Error(data.error);
      }

      setStageCount(stages.length);
      setStatus('connected');
    } catch (e: any) {
      setStatus('error');
      setErrorMsg(e?.message || 'Falha ao conectar. Verifique a API Key e o Workspace ID.');
    }
  };

  const badgeMap: Record<ConnectionStatus, { label: string; variant: 'secondary' | 'destructive' | 'default'; className?: string }> = {
    idle: { label: 'Não testado', variant: 'secondary' },
    testing: { label: 'Testando...', variant: 'secondary' },
    connected: { label: 'Conectado', variant: 'default', className: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20' },
    error: { label: 'Erro de conexão', variant: 'destructive' },
    unconfigured: { label: 'Não configurado', variant: 'secondary' },
  };

  const badge = badgeMap[status];
  const canTest = Boolean(config?.has_api_key && config?.workspace_id);
  const hasChanges =
    !!config &&
    (workspaceInput !== (config.workspace_id || '') ||
      baseUrlInput !== (config.base_url || '') ||
      apiKeyInput.trim().length > 0);

  return (
    <Card className="border-border/40">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-md flex items-center justify-center text-white font-bold text-sm"
            style={{ backgroundColor: '#185FA5' }}
          >
            N
          </div>
          <div>
            <CardTitle className="text-base">Nexus</CardTitle>
            <CardDescription className="text-xs">CRM de vendas</CardDescription>
          </div>
        </div>
        <Badge variant={badge.variant} className={`text-[10px] ${badge.className || ''}`}>
          {badge.label}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Handoff automático: leads que atingem as condições das Automações são enviados para o pipeline do Nexus.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="nexus-api-key" className="text-xs">API Key</Label>
              <div className="relative">
                <Input
                  id="nexus-api-key"
                  type={showKey ? 'text' : 'password'}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder={config?.has_api_key ? (config.api_key_masked || '••••••••') : 'Cole a API Key do Nexus'}
                  className="h-8 text-xs pr-8"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              {config?.has_api_key && !apiKeyInput && (
                <p className="text-[10px] text-muted-foreground">
                  Uma chave já está salva. Deixe em branco para mantê-la.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="nexus-workspace" className="text-xs">Workspace ID</Label>
              <Input
                id="nexus-workspace"
                value={workspaceInput}
                onChange={(e) => setWorkspaceInput(e.target.value)}
                placeholder="Ex: 8f3e…"
                className="h-8 text-xs"
                autoComplete="off"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="nexus-base-url" className="text-xs">Base URL (opcional)</Label>
              <Input
                id="nexus-base-url"
                value={baseUrlInput}
                onChange={(e) => setBaseUrlInput(e.target.value)}
                placeholder="https://…/api-gateway (deixe em branco para usar o padrão)"
                className="h-8 text-xs"
                autoComplete="off"
              />
            </div>
          </div>
        )}

        {status === 'connected' && stageCount > 0 && (
          <div className="flex items-center gap-2 text-xs text-emerald-500">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {stageCount} estágio{stageCount !== 1 ? 's' : ''} encontrado{stageCount !== 1 ? 's' : ''} no pipeline
          </div>
        )}

        {status === 'error' && (
          <div className="flex items-start gap-2 text-xs text-destructive">
            <WifiOff className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <span>{errorMsg}</span>
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
            variant="outline"
            size="sm"
            className="gap-1.5 h-7 text-xs"
            onClick={handleTest}
            disabled={status === 'testing' || !canTest || loading}
          >
            {status === 'testing' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wifi className="h-3.5 w-3.5" />
            )}
            {status === 'testing' ? 'Testando…' : 'Testar conexão'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
