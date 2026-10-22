import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Loader2, Wifi, WifiOff, CheckCircle2, Eye, EyeOff, Save, PauseCircle, RotateCcw, Copy,
} from 'lucide-react';
import { api, ErroApi } from '@/lib/api';
import { toast } from 'sonner';

type ConnectionStatus = 'idle' | 'testing' | 'connected' | 'error' | 'unconfigured';

type Falha = { lead_id: string; erro: string; atualizado_em: string };

// Tipo local de propósito: `src/lib/api*` tem dono único (docs/frentes/README.md).
type ConfigGrowthHS = {
  base_url: string | null;
  app_url: string | null;
  client_id: string | null;
  list_id: number | null;
  boards_conferidos: number[];
  listas_reuniao: number[];
  listas_ganho: number[];
  // Nenhum segredo volta do backend: do client_secret, só os 4 últimos.
  client_secret: { configurado: boolean; ultimos4: string | null };
  webhook_secret: { configurado: boolean };
  configurado: boolean;
  webhook_urls: { meeting_scheduled: string; deal_won: string };
  fila: {
    pendentes: number;
    falhas: number;
    ultimas_falhas: Falha[];
    // Revisão final do 8D (I3): o GrowthHS recusou a configuração
    // (401/403/404) — a fila inteira espera, sem gastar tentativa.
    pausada: { motivo: string; desde: string } | null;
  };
};

type RespostaTeste =
  | { valido: true }
  | { valido: false; status: number | null; detalhe: string };

// Mesmos limites do `GrowthHSIn` do backend — conferir aqui só poupa a ida.
const MAX_IDS = 10;
const MIN_SEGREDO_WEBHOOK = 16;

/** "6, 7" → [6, 7]. Devolve a mensagem de erro em vez da lista quando o texto
 *  não é uma lista de ids válida (número > 0, sem repetido, até 10). */
function lerIds(texto: string): number[] | string {
  const partes = texto.split(/[\s,;]+/).filter(Boolean);
  if (partes.some((p) => !/^\d+$/.test(p) || Number(p) <= 0)) {
    return 'Use números maiores que zero, separados por vírgula.';
  }
  const ids = partes.map(Number);
  if (new Set(ids).size !== ids.length) return 'Há número repetido.';
  if (ids.length > MAX_IDS) return `No máximo ${MAX_IDS} números.`;
  return ids;
}

const idsComoTexto = (ids: number[] | undefined) => (ids ?? []).join(', ');

async function copiar(texto: string) {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success('Copiado');
  } catch {
    toast.error('Erro ao copiar');
  }
}

export default function GrowthHSCard() {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<ConfigGrowthHS | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [baseUrlInput, setBaseUrlInput] = useState('');
  const [appUrlInput, setAppUrlInput] = useState('');
  const [clientIdInput, setClientIdInput] = useState('');
  const [clientSecretInput, setClientSecretInput] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [listIdInput, setListIdInput] = useState('');
  const [boardsInput, setBoardsInput] = useState('');
  const [reuniaoInput, setReuniaoInput] = useState('');
  const [ganhoInput, setGanhoInput] = useState('');
  const [webhookSecretInput, setWebhookSecretInput] = useState('');
  const [showWebhookSecret, setShowWebhookSecret] = useState(false);
  const [reenfileirando, setReenfileirando] = useState(false);

  const aplicar = (c: ConfigGrowthHS) => {
    setConfig(c);
    setBaseUrlInput(c.base_url || '');
    setAppUrlInput(c.app_url || '');
    setClientIdInput(c.client_id || '');
    setListIdInput(c.list_id != null ? String(c.list_id) : '');
    setBoardsInput(idsComoTexto(c.boards_conferidos));
    setReuniaoInput(idsComoTexto(c.listas_reuniao));
    setGanhoInput(idsComoTexto(c.listas_ganho));
    setClientSecretInput('');
    setWebhookSecretInput('');
  };

  const loadConfig = async () => {
    setLoading(true);
    try {
      const c = await api.get<ConfigGrowthHS>('/config/growthhs');
      aplicar(c);
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
      const resposta = await api.post<RespostaTeste>('/config/growthhs/testar');
      if (resposta.valido) {
        setStatus('connected');
      } else {
        setStatus('error');
        setErrorMsg(
          resposta.status != null
            ? `O GrowthHS recusou as credenciais (status ${resposta.status}).`
            : 'O GrowthHS recusou as credenciais.',
        );
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

  const boards = lerIds(boardsInput);
  const reuniao = lerIds(reuniaoInput);
  const ganho = lerIds(ganhoInput);
  const webhookCurto =
    webhookSecretInput.trim().length > 0 && webhookSecretInput.trim().length < MIN_SEGREDO_WEBHOOK;
  const listaInvalida =
    typeof boards === 'string' || typeof reuniao === 'string' || typeof ganho === 'string';

  const handleSave = async () => {
    if (listaInvalida || webhookCurto) return;
    setSaving(true);
    setErrorMsg('');
    try {
      const corpo: Record<string, unknown> = {
        base_url: baseUrlInput.trim(),
        app_url: appUrlInput.trim(),
        client_id: clientIdInput.trim(),
        boards_conferidos: boards,
        listas_reuniao: reuniao,
        listas_ganho: ganho,
      };
      if (listIdInput.trim().length > 0) corpo.list_id = Number(listIdInput.trim());
      // Segredo em branco = manter o salvo. O `trim()` importa: o GrowthHS faz
      // strip do segredo dele, e um espaço colado aqui seria 401 para sempre.
      if (clientSecretInput.trim().length > 0) corpo.client_secret = clientSecretInput.trim();
      if (webhookSecretInput.trim().length > 0) corpo.webhook_secret = webhookSecretInput.trim();

      const c = await api.put<ConfigGrowthHS>('/config/growthhs', corpo);
      aplicar(c);
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

  const badgeMap: Record<ConnectionStatus, { label: string; variant: 'secondary' | 'destructive' | 'success' }> = {
    idle: { label: 'Não testado', variant: 'secondary' },
    testing: { label: 'Testando...', variant: 'secondary' },
    connected: { label: 'Conectado', variant: 'success' },
    error: { label: 'Erro de conexão', variant: 'destructive' },
    unconfigured: { label: 'Não configurado', variant: 'secondary' },
  };

  const badge = badgeMap[status];
  // M4 (revisão final do 8D): o teste usa a credencial SALVA — testar com
  // endereço ou Client ID digitados e não salvos daria um "Conectado" que não
  // é da configuração que a fila usa.
  const enderecoMudou = !!config && baseUrlInput.trim().replace(/\/+$/, '') !== (config.base_url || '');
  const clientIdMudou = !!config && clientIdInput.trim() !== (config.client_id || '');
  const naoSalvo = enderecoMudou || clientIdMudou || clientSecretInput.trim().length > 0;
  const canTest =
    !!config?.base_url &&
    !!config.client_id &&
    config.client_secret.configurado &&
    !loading &&
    !naoSalvo;
  const hasChanges =
    !!config &&
    (baseUrlInput !== (config.base_url || '') ||
      appUrlInput !== (config.app_url || '') ||
      clientIdInput !== (config.client_id || '') ||
      listIdInput !== (config.list_id != null ? String(config.list_id) : '') ||
      boardsInput !== idsComoTexto(config.boards_conferidos) ||
      reuniaoInput !== idsComoTexto(config.listas_reuniao) ||
      ganhoInput !== idsComoTexto(config.listas_ganho) ||
      clientSecretInput.trim().length > 0 ||
      webhookSecretInput.trim().length > 0);

  const campoIds = (
    id: string,
    rotulo: string,
    ajuda: string,
    valor: string,
    setValor: (v: string) => void,
    lido: number[] | string,
    exemplo: string,
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">{rotulo}</Label>
      <Input
        id={id}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        placeholder={exemplo}
        className="h-8 text-xs"
        autoComplete="off"
        inputMode="numeric"
      />
      {typeof lido === 'string' ? (
        <p className="text-xs text-[--on-tint-danger]">{lido}</p>
      ) : (
        <p className="text-xs text-muted-foreground">{ajuda}</p>
      )}
    </div>
  );

  return (
    <Card className="border-border/40">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md flex items-center justify-center bg-[--color-success-700] text-[--color-white] font-bold text-sm">
            G
          </div>
          <div>
            <CardTitle className="text-base">GrowthHS</CardTitle>
            <CardDescription className="text-xs">CRM de vendas</CardDescription>
          </div>
        </div>
        <Badge variant={badge.variant}>
          {badge.label}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Handoff automático: leads que atingem as condições das Automações viram card no funil do
          GrowthHS. Se a pessoa já tem card aberto, ele é atualizado em vez de duplicado.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="growthhs-base-url" className="text-xs">URL da API</Label>
              <Input
                id="growthhs-base-url"
                value={baseUrlInput}
                onChange={(e) => setBaseUrlInput(e.target.value)}
                placeholder="https://api.growthhs.exemplo.com"
                className="h-8 text-xs"
                autoComplete="off"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="growthhs-app-url" className="text-xs">
                URL do app <span className="text-muted-foreground font-normal">— opcional, para o link "Ver no GrowthHS"</span>
              </Label>
              <Input
                id="growthhs-app-url"
                value={appUrlInput}
                onChange={(e) => setAppUrlInput(e.target.value)}
                placeholder="https://growthhs.exemplo.com"
                className="h-8 text-xs"
                autoComplete="off"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="growthhs-client-id" className="text-xs">Client ID</Label>
              <Input
                id="growthhs-client-id"
                value={clientIdInput}
                onChange={(e) => setClientIdInput(e.target.value)}
                placeholder="hsg_…"
                className="h-8 text-xs"
                autoComplete="off"
                maxLength={200}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="growthhs-client-secret" className="text-xs">Client secret</Label>
              <div className="relative">
                <Input
                  id="growthhs-client-secret"
                  type={showSecret ? 'text' : 'password'}
                  value={clientSecretInput}
                  onChange={(e) => setClientSecretInput(e.target.value)}
                  placeholder={
                    config?.client_secret.configurado
                      ? `•••• ${config.client_secret.ultimos4 || ''}`
                      : 'Cole o client secret do GrowthHS'
                  }
                  className="h-8 text-xs pr-8"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                  aria-label={showSecret ? 'Esconder o client secret' : 'Mostrar o client secret'}
                >
                  {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              {config?.client_secret.configurado && !clientSecretInput && (
                <p className="text-xs text-muted-foreground">
                  Um secret já está salvo. Deixe em branco para mantê-lo.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="growthhs-list-id" className="text-xs">Lista de entrada</Label>
              <Input
                id="growthhs-list-id"
                type="number"
                min={1}
                value={listIdInput}
                onChange={(e) => setListIdInput(e.target.value)}
                placeholder="Ex: 22"
                className="h-8 text-xs"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">A etapa do funil onde o card novo nasce.</p>
            </div>

            {campoIds(
              'growthhs-boards', 'Boards conferidos',
              'Funis onde se procura card aberto da pessoa antes de criar outro.',
              boardsInput, setBoardsInput, boards, '6, 7',
            )}
            {campoIds(
              'growthhs-listas-reuniao', 'Listas de reunião',
              'Listas que contam como reunião agendada (produção: 28).',
              reuniaoInput, setReuniaoInput, reuniao, '28',
            )}
            {campoIds(
              'growthhs-listas-ganho', 'Listas de ganho',
              'Listas de negócio ganho (produção: 32).',
              ganhoInput, setGanhoInput, ganho, '32',
            )}
          </div>
        )}

        {status === 'connected' && (
          <div className="flex items-center gap-2 text-xs text-[--on-tint-success]">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Credenciais aceitas pelo GrowthHS.
          </div>
        )}

        {status === 'error' && (
          <div className="flex items-start gap-2 text-xs text-[--on-tint-danger]">
            <WifiOff className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {!loading && naoSalvo && (
          <p className="text-xs text-[--on-tint-warning] leading-relaxed">
            O endereço ou a credencial digitados ainda não foram salvos — salve antes de testar.
          </p>
        )}

        <p className="text-xs text-muted-foreground leading-relaxed">
          Testar conexão pede um token ao GrowthHS com a credencial salva: confere o Client ID e o
          Client secret.
        </p>

        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            className="gap-1.5 h-7 text-xs"
            onClick={handleSave}
            disabled={saving || loading || !hasChanges || listaInvalida || webhookCurto}
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
          <div className="pt-2 border-t border-border/30 space-y-3">
            <div>
              <p className="text-xs font-medium">Volta do GrowthHS (webhook)</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Cadastre uma automação no GrowthHS para cada URL abaixo, com o mesmo segredo. É por
                ela que reunião agendada e negócio ganho voltam para o contato.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="growthhs-webhook-secret" className="text-xs">Segredo do webhook</Label>
              <div className="relative">
                <Input
                  id="growthhs-webhook-secret"
                  type={showWebhookSecret ? 'text' : 'password'}
                  value={webhookSecretInput}
                  onChange={(e) => setWebhookSecretInput(e.target.value)}
                  placeholder={
                    config.webhook_secret.configurado
                      ? 'deixe em branco para manter'
                      : `pelo menos ${MIN_SEGREDO_WEBHOOK} caracteres`
                  }
                  className="h-8 text-xs pr-8"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowWebhookSecret((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                  aria-label={showWebhookSecret ? 'Esconder o segredo' : 'Mostrar o segredo'}
                >
                  {showWebhookSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              {webhookCurto ? (
                <p className="text-xs text-[--on-tint-danger]">
                  O segredo precisa de pelo menos {MIN_SEGREDO_WEBHOOK} caracteres.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {config.webhook_secret.configurado
                    ? 'Um segredo já está salvo.'
                    : 'Sem segredo, o GrowthHS não consegue avisar de volta.'}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              {([
                ['Reunião agendada', config.webhook_urls.meeting_scheduled],
                ['Negócio ganho', config.webhook_urls.deal_won],
              ] as const).map(([rotulo, url]) => (
                <div key={rotulo} className="flex items-center gap-2 text-xs min-w-0">
                  <span className="text-muted-foreground shrink-0">{rotulo}:</span>
                  <code className="truncate min-w-0 flex-1">{url}</code>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 shrink-0"
                    onClick={() => copiar(url)}
                    aria-label={`Copiar a URL de ${rotulo.toLowerCase()}`}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && config && (
          <div className="pt-2 border-t border-border/30 space-y-2">
            {config.fila.pausada && (
              <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-[--tint-warning] p-2">
                <PauseCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-warning" />
                <div className="text-xs leading-relaxed text-[--on-tint-warning]">
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
                  className="gap-1.5 h-6 text-xs"
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
                  <li key={f.lead_id} className="text-xs text-[--on-tint-danger] leading-relaxed">
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
