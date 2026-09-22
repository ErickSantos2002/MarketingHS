import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Wifi, WifiOff, CheckCircle2, Eye, EyeOff, Save, PauseCircle, RotateCcw } from 'lucide-react';
import { api, ErroApi } from '@/lib/api';
import { toast } from 'sonner';

type ConnectionStatus = 'idle' | 'testing' | 'connected' | 'error' | 'unconfigured';

type Falha = { lead_id: string; erro: string; atualizado_em: string };

type ConfigGrowthHS = {
  base_url: string | null;
  board_id: number | null;
  app_url: string | null;
  api_key: { configurado: boolean; ultimos4: string | null };
  configurado: boolean;
  fila: {
    pendentes: number;
    falhas: number;
    ultimas_falhas: Falha[];
    // Revisão final do 8D (I3): o GrowthHS recusou a configuração
    // (401/403/404) — a fila inteira espera, sem gastar tentativa.
    pausada: { motivo: string; desde: string } | null;
  };
};

export default function GrowthHSCard() {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<ConfigGrowthHS | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [baseUrlInput, setBaseUrlInput] = useState('');
  const [boardIdInput, setBoardIdInput] = useState('');
  const [appUrlInput, setAppUrlInput] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [reenfileirando, setReenfileirando] = useState(false);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const c = await api.get<ConfigGrowthHS>('/config/growthhs');
      setConfig(c);
      setBaseUrlInput(c.base_url || '');
      setBoardIdInput(c.board_id != null ? String(c.board_id) : '');
      setAppUrlInput(c.app_url || '');
      setApiKeyInput('');
      setStatus(c.configurado ? 'idle' : 'unconfigured');
    } catch (e) {
      toast.error('Falha ao carregar configuração do GrowthHS', {
        description: e instanceof ErroApi ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const handleTest = async () => {
    setStatus('testing');
    setErrorMsg('');
    try {
      const resposta = await api.post<{ alcancavel: boolean; status: number }>(
        '/config/growthhs/testar',
      );
      if (resposta.alcancavel) {
        setStatus('connected');
      } else {
        setStatus('error');
        setErrorMsg(`O GrowthHS respondeu com status ${resposta.status}.`);
      }
    } catch (e) {
      setStatus('error');
      setErrorMsg(e instanceof ErroApi ? e.message : 'Falha ao conectar ao GrowthHS.');
    }
  };

  const handleReenfileirar = async () => {
    setReenfileirando(true);
    try {
      const { reenfileirados } = await api.post<{ reenfileirados: number }>(
        '/config/growthhs/reenfileirar',
      );
      toast.success(
        reenfileirados === 1
          ? '1 contato voltou para a fila'
          : `${reenfileirados} contatos voltaram para a fila`,
      );
      await loadConfig();
    } catch (e) {
      toast.error('Falha ao reenfileirar', {
        description: e instanceof ErroApi ? e.message : undefined,
      });
    } finally {
      setReenfileirando(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setErrorMsg('');
    try {
      const corpo: Record<string, unknown> = {
        base_url: baseUrlInput.trim(),
        app_url: appUrlInput.trim(),
      };
      if (boardIdInput.trim().length > 0) corpo.board_id = Number(boardIdInput.trim());
      if (apiKeyInput.trim().length > 0) corpo.api_key = apiKeyInput.trim();

      const c = await api.put<ConfigGrowthHS>('/config/growthhs', corpo);
      setConfig(c);
      setBaseUrlInput(c.base_url || '');
      setBoardIdInput(c.board_id != null ? String(c.board_id) : '');
      setAppUrlInput(c.app_url || '');
      setApiKeyInput('');
      toast.success('Configuração do GrowthHS salva');

      // Testa automaticamente após salvar, se ficou tudo configurado.
      if (c.configurado) {
        await handleTest();
      } else {
        setStatus('unconfigured');
      }
    } catch (e) {
      toast.error('Falha ao salvar', {
        description: e instanceof ErroApi ? e.message : undefined,
      });
    } finally {
      setSaving(false);
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
  // M4 (revisão final do 8D): o teste usa o endereço SALVO — testar com outro
  // digitado na tela daria um "Conectado" que não é do endereço que se vê.
  const enderecoMudou = !!config && baseUrlInput.trim().replace(/\/+$/, '') !== (config.base_url || '');
  const canTest = Boolean(baseUrlInput.trim()) && !loading && !enderecoMudou;
  const hasChanges =
    !!config &&
    (baseUrlInput !== (config.base_url || '') ||
      boardIdInput !== (config.board_id != null ? String(config.board_id) : '') ||
      appUrlInput !== (config.app_url || '') ||
      apiKeyInput.trim().length > 0);

  return (
    <Card className="border-border/40">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-md flex items-center justify-center text-white font-bold text-sm"
            style={{ backgroundColor: '#185FA5' }}
          >
            G
          </div>
          <div>
            <CardTitle className="text-base">GrowthHS</CardTitle>
            <CardDescription className="text-xs">CRM de vendas</CardDescription>
          </div>
        </div>
        <Badge variant={badge.variant} className={`text-[10px] ${badge.className || ''}`}>
          {badge.label}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Handoff automático: leads que atingem as condições das Automações são enviados para o
          funil do GrowthHS.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="growthhs-base-url" className="text-xs">Endereço da API</Label>
              <Input
                id="growthhs-base-url"
                value={baseUrlInput}
                onChange={(e) => setBaseUrlInput(e.target.value)}
                placeholder="https://growthhs.exemplo.com"
                className="h-8 text-xs"
                autoComplete="off"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="growthhs-board-id" className="text-xs">ID do funil</Label>
              <Input
                id="growthhs-board-id"
                type="number"
                min={1}
                value={boardIdInput}
                onChange={(e) => setBoardIdInput(e.target.value)}
                placeholder="Ex: 3"
                className="h-8 text-xs"
                autoComplete="off"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="growthhs-app-url" className="text-xs">
                Endereço do app <span className="text-muted-foreground font-normal">— opcional, para o link "Ver no GrowthHS"</span>
              </Label>
              <Input
                id="growthhs-app-url"
                value={appUrlInput}
                onChange={(e) => setAppUrlInput(e.target.value)}
                placeholder="https://app.growthhs.exemplo.com"
                className="h-8 text-xs"
                autoComplete="off"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="growthhs-api-key" className="text-xs">Chave de API</Label>
              <div className="relative">
                <Input
                  id="growthhs-api-key"
                  type={showKey ? 'text' : 'password'}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder={
                    config?.api_key.configurado
                      ? `•••• ${config.api_key.ultimos4 || ''}`
                      : 'Cole a chave de API do GrowthHS'
                  }
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
              {config?.api_key.configurado && !apiKeyInput && (
                <p className="text-[10px] text-muted-foreground">
                  Uma chave já está salva. Deixe em branco para mantê-la.
                </p>
              )}
            </div>
          </div>
        )}

        {status === 'connected' && (
          <div className="flex items-center gap-2 text-xs text-emerald-500">
            <CheckCircle2 className="h-3.5 w-3.5" />
            A API do GrowthHS respondeu.
          </div>
        )}

        {status === 'error' && (
          <div className="flex items-start gap-2 text-xs text-destructive">
            <WifiOff className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {enderecoMudou && baseUrlInput.trim() && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-relaxed">
            O endereço digitado é diferente do salvo — salve antes de testar.
          </p>
        )}

        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Testar conexão confere que a API do GrowthHS responde; não confere a chave — isso só se
          vê na primeira entrega.
        </p>

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

        {!loading && config && (
          <div className="pt-2 border-t border-border/30 space-y-2">
            {config.fila.pausada && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
                <PauseCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-amber-500" />
                <div className="text-[10px] leading-relaxed text-amber-700 dark:text-amber-400">
                  <p className="font-medium">
                    Fila pausada desde {new Date(config.fila.pausada.desde).toLocaleString('pt-BR')}
                  </p>
                  <p>{config.fila.pausada.motivo}</p>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {config.fila.pendentes} aguardando entrega · {config.fila.falhas} falharam
              </p>
              {config.fila.falhas > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-6 text-[10px]"
                  onClick={handleReenfileirar}
                  disabled={reenfileirando}
                >
                  {reenfileirando ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3 w-3" />
                  )}
                  Reenfileirar falhas
                </Button>
              )}
            </div>
            {config.fila.ultimas_falhas.length > 0 && (
              <ul className="space-y-1">
                {config.fila.ultimas_falhas.map((f) => (
                  <li key={f.lead_id} className="text-[10px] text-destructive leading-relaxed">
                    Contato {f.lead_id.slice(0, 8)} — {f.erro}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
