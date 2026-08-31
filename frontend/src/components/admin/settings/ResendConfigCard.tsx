import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  Copy,
  Check,
  KeyRound,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

// UI de configuração do Resend PELA INTERFACE -- consome a Edge Function
// resend-config (supabase/functions/resend-config/index.ts), que é quem de
// fato valida a chave e grava os segredos no Vault. Este card NUNCA recebe um
// segredo de volta do servidor: só `configured: true/false` e os últimos 4
// dígitos da API key.
//
// Descoberta que molda o fluxo de teste (doc oficial do Resend): um 401 com
// `restricted_api_key` é uma chave VÁLIDA (só não lista domínios -- chave
// "sending only"). Tratar isso como erro reprovaria uma chave perfeitamente
// funcional.

// A LISTAGEM (GET /domains) não garante trazer open_tracking/click_tracking --
// por isso esta interface não os declara. O estado do tracking vem SEMPRE da
// action 'domain_info' (GET /domains/:id), que é quem garante esses campos.
interface ResendDomain {
  id: string;
  name: string;
  status: string;
  capabilities?: { sending?: string; receiving?: string } | null;
}

interface TrackingDnsRecord {
  record: string;
  name: string;
  type: string;
  value: string;
  ttl?: string;
  status?: string;
}

// Resposta da action 'domain_info' (GET /domains/:id no Resend). `available:
// false` NÃO é erro: é o caso da chave sending-only (que não pode ler
// domínios) ou de um domínio que sumiu da conta.
type TrackingInfo =
  | {
      available: true;
      open_tracking: boolean;
      click_tracking: boolean;
      tracking_subdomain: string | null;
      status: string | null;
      records: TrackingDnsRecord[];
    }
  | { available: false; reason: string };

// O CNAME de tracking só começa a funcionar depois que o Resend verifica o
// registro. Qualquer status diferente de "verified" (not_started, pending,
// failed) significa que o pixel/redirect AINDA não funciona — mesmo com
// open_tracking/click_tracking ligados na conta.
function isRecordVerified(rec: TrackingDnsRecord): boolean {
  return rec.status === 'verified';
}

interface SavedFrom {
  from: string;
  name: string;
  prefix: string;
  domain: string;
}

type TestState = 'idle' | 'testing' | 'valid' | 'invalid';
type Scope = 'full' | 'sending_only' | null;

const REASON_LABEL: Record<string, string> = {
  invalid_api_key: 'Chave inválida ou revogada.',
  network: 'Não foi possível conectar à API do Resend. Tente novamente.',
  unknown: 'Resposta inesperada da API do Resend.',
};

function isDomainVerified(domain: ResendDomain): boolean {
  if (domain.status === 'verified') return true;
  return !!domain.status?.startsWith('partially_') && domain.capabilities?.sending === 'enabled';
}

// crypto.getRandomValues, NUNCA Math.random -- Math.random não é
// criptograficamente seguro e não deve gerar segredos usados para assinar
// links de descadastro.
function generateSecret(length = 48): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

// I1 (review): `supabase.functions.invoke` LANÇA FunctionsHttpError em
// qualquer resposta não-2xx -- o `error` de negócio que a Edge Function
// escreve no corpo (`{ error: "..." }`, via o helper `error()` de
// _shared/auth.ts) nunca chega ao catch como `e.message`; sem ler
// `e.context`, todo mundo vira o genérico "Edge Function returned a non-2xx
// status code". Lê o corpo real quando existir; retorna null se não for um
// FunctionsHttpError ou o corpo não tiver mensagem.
//
// O gateway do Supabase responde 404 com `{code:"NOT_FOUND", message:"..."}` --
// campo `message`, não `error`. Sem tratar esse caso, uma function AINDA NÃO
// DEPLOYADA caía no fallback e o card dizia "Não foi possível conectar à API do
// Resend", culpando a chave do usuário por um problema de deploy. A mensagem
// tem que apontar a causa real.
async function getFunctionErrorMessage(e: unknown): Promise<string | null> {
  if (e instanceof FunctionsHttpError) {
    const body = await e.context.json().catch(() => null);
    if (body?.code === 'NOT_FOUND') {
      return 'A função resend-config ainda não foi deployada no Supabase. Faça o deploy das Edge Functions e da migration antes de configurar.';
    }
    if (typeof body?.error === 'string' && body.error.length > 0) return body.error;
    if (typeof body?.message === 'string' && body.message.length > 0) return body.message;
  }
  return null;
}

export default function ResendConfigCard() {
  const [loading, setLoading] = useState(true);

  // API key
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [apiKeyLast4, setApiKeyLast4] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [testState, setTestState] = useState<TestState>('idle');
  const [testReason, setTestReason] = useState<string | null>(null);
  // Mensagem literal vinda do servidor (ex.: function não deployada). Tem
  // precedência sobre o REASON_LABEL, que é genérico por natureza.
  const [testError, setTestError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>(null);
  const [domains, setDomains] = useState<ResendDomain[]>([]);
  const [testing, setTesting] = useState(false);

  // Remetente
  const [fromName, setFromName] = useState('');
  const [fromPrefix, setFromPrefix] = useState('');
  const [fromDomain, setFromDomain] = useState('');
  const [savedFrom, setSavedFrom] = useState<SavedFrom | null>(null);

  // Descadastro
  const [unsubscribeConfigured, setUnsubscribeConfigured] = useState(false);
  const [unsubscribeInput, setUnsubscribeInput] = useState('');

  // Webhook
  const [webhookSecretConfigured, setWebhookSecretConfigured] = useState(false);
  const [webhookSecretInput, setWebhookSecretInput] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Tracking de abertura/clique (por domínio). O estado REAL vem da action
  // 'domain_info' -> GET /domains/:id do Resend, que é a única resposta que
  // garante open_tracking/click_tracking/tracking_subdomain/records (a
  // LISTAGEM de domínios não garante). Sem consultar isso, o card não teria
  // como avisar o caso mais traiçoeiro: o usuário ativa o tracking, esquece o
  // CNAME no DNS, e nenhuma abertura nunca chega — sem nenhum sinal de erro.
  const [trackingSubdomain, setTrackingSubdomain] = useState('links');
  const [enablingTracking, setEnablingTracking] = useState(false);
  const [trackingInfo, setTrackingInfo] = useState<TrackingInfo | null>(null);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [copiedRecordIndex, setCopiedRecordIndex] = useState<number | null>(null);

  const loadState = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('resend-config', { method: 'GET' });
      if (error) throw error;

      setApiKeyConfigured(!!data?.resend_api_key?.configured);
      setApiKeyLast4(data?.resend_api_key?.last4 ?? null);
      const gotScope: Scope = data?.resend_api_key?.scope ?? null;
      setScope(gotScope);
      setDomains(Array.isArray(data?.domains) ? data.domains : []);

      // A chave salva já foi testada pelo servidor durante o GET (é o que
      // preenche `scope`/`domains`). Se veio com escopo, tratamos como
      // "teste passou" sem exigir novo clique -- só uma chave NOVA (colada
      // agora) precisa ser testada explicitamente.
      if (data?.resend_api_key?.configured && gotScope) {
        setTestState('valid');
      } else if (data?.resend_api_key?.configured && !gotScope) {
        setTestState('invalid');
        setTestReason('stored_key_check_failed');
      } else {
        setTestState('idle');
      }

      const savedFromValue: SavedFrom | null = data?.from ?? null;
      setSavedFrom(savedFromValue);
      if (savedFromValue) {
        setFromName(savedFromValue.name || '');
        setFromPrefix(savedFromValue.prefix || '');
        setFromDomain(savedFromValue.domain || '');
      } else if (Array.isArray(data?.domains) && data.domains.length > 0) {
        const firstVerified = (data.domains as ResendDomain[]).find(isDomainVerified);
        setFromDomain(firstVerified?.name || data.domains[0].name || '');
      }

      setUnsubscribeConfigured(!!data?.unsubscribe_secret?.configured);
      setWebhookSecretConfigured(!!data?.webhook_secret?.configured);
      setWebhookUrl(data?.webhook_url || '');
    } catch (e) {
      toast.error('Não foi possível carregar a configuração do Resend.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadState();
  }, []);

  // Estado real do tracking do domínio selecionado. Roda quando o card carrega
  // com um domínio já salvo e quando o usuário troca o domínio no select --
  // sempre que a chave for 'full' (a sending-only nem consegue ler o domínio).
  // O resultado anterior é descartado antes de buscar: mostrar o tracking do
  // domínio antigo enquanto carrega o novo seria pior que não mostrar nada.
  useEffect(() => {
    const domainId = domains.find((d) => d.name === fromDomain)?.id;
    if (scope !== 'full' || !fromDomain.trim() || !domainId) {
      setTrackingInfo(null);
      return;
    }

    let cancelled = false;
    setTrackingInfo(null);
    setTrackingLoading(true);

    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('resend-config', {
          body: { action: 'domain_info', domain_id: domainId },
        });
        if (error) throw error;
        if (cancelled) return;

        if (data?.available) {
          const info: TrackingInfo = {
            available: true,
            open_tracking: !!data.open_tracking,
            click_tracking: !!data.click_tracking,
            tracking_subdomain: data.tracking_subdomain ?? null,
            status: data.status ?? null,
            records: Array.isArray(data.records) ? data.records : [],
          };
          setTrackingInfo(info);
          // Pré-preenche o input com o subdomínio já configurado no Resend --
          // digitar outro aqui reconfiguraria o CNAME à toa.
          if (info.tracking_subdomain) setTrackingSubdomain(info.tracking_subdomain);
        } else {
          setTrackingInfo({ available: false, reason: data?.reason ?? 'unknown' });
        }
      } catch {
        if (!cancelled) setTrackingInfo({ available: false, reason: 'network' });
      } finally {
        if (!cancelled) setTrackingLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fromDomain, domains, scope]);

  const handleStartChangeKey = () => {
    setEditingKey(true);
    setApiKeyInput('');
    setTestState('idle');
    setTestReason(null);
    setTestError(null);
  };

  const handleTest = async () => {
    const key = apiKeyInput.trim();
    if (!key) {
      toast.error('Cole a API key do Resend antes de testar.');
      return;
    }
    setTesting(true);
    setTestState('testing');
    setTestReason(null);
    setTestError(null);
    try {
      const { data, error } = await supabase.functions.invoke('resend-config', {
        body: { action: 'test', api_key: key },
      });
      if (error) throw error;

      if (data?.valid) {
        setTestState('valid');
        setScope(data.scope);
        setDomains(Array.isArray(data.domains) ? data.domains : []);
        if (data.scope === 'full' && Array.isArray(data.domains) && data.domains.length > 0) {
          const firstVerified = (data.domains as ResendDomain[]).find(isDomainVerified);
          setFromDomain((prev) => prev || firstVerified?.name || data.domains[0].name || '');
        }
      } else {
        setTestState('invalid');
        setTestReason(data?.reason ?? 'unknown');
      }
    } catch (e) {
      setTestState('invalid');
      const serverMsg = await getFunctionErrorMessage(e);
      if (serverMsg) {
        // Mostra a causa real no lugar do rótulo genérico (ex.: function não
        // deployada) — senão o card culpa a chave do usuário por um erro que
        // não é dela.
        setTestError(serverMsg);
        setTestReason(null);
        toast.error(serverMsg);
      } else {
        setTestError(null);
        setTestReason('network');
      }
    } finally {
      setTesting(false);
    }
  };

  const handleGenerateUnsubscribeSecret = () => {
    setUnsubscribeInput(generateSecret(48));
  };

  const handleCopyWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      toast.success('URL copiada!');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Erro ao copiar');
    }
  };

  const selectedDomainObj = domains.find((d) => d.name === fromDomain) ?? null;

  const trackingReadable = trackingInfo?.available === true ? trackingInfo : null;
  // Ligado na CONTA do Resend (open + click). Isso sozinho NÃO significa que o
  // tracking funciona -- falta o DNS (ver trackingDnsPending).
  const trackingEnabled = !!trackingReadable && trackingReadable.open_tracking && trackingReadable.click_tracking;
  const pendingRecords = trackingReadable ? trackingReadable.records.filter((r) => !isRecordVerified(r)) : [];
  // O caso traiçoeiro: ativado na conta, mas o CNAME nunca foi adicionado (ou
  // ainda não propagou). O Resend não avisa; o card precisa avisar.
  const trackingDnsPending = trackingEnabled && pendingRecords.length > 0;
  const trackingWorking = trackingEnabled && !trackingDnsPending;

  const handleEnableTracking = async () => {
    if (!selectedDomainObj?.id) {
      toast.error('Selecione um domínio verificado antes de ativar o tracking.');
      return;
    }
    setEnablingTracking(true);
    try {
      const { data, error } = await supabase.functions.invoke('resend-config', {
        body: {
          action: 'enable_tracking',
          domain_id: selectedDomainObj.id,
          tracking_subdomain: trackingSubdomain.trim() || 'links',
          open_tracking: true,
          click_tracking: true,
        },
      });
      if (error) throw error;

      if (!data?.success) {
        toast.error(data?.error || 'Não foi possível ativar o tracking.');
        return;
      }

      setTrackingInfo({
        available: true,
        open_tracking: !!data.open_tracking,
        click_tracking: !!data.click_tracking,
        tracking_subdomain: data.tracking_subdomain ?? trackingSubdomain,
        status: data.status ?? null,
        records: Array.isArray(data.records) ? data.records : [],
      });
      toast.success('Tracking ativado no Resend. Falta adicionar o registro DNS abaixo para ele passar a funcionar.');
    } catch (e) {
      const serverMsg = await getFunctionErrorMessage(e);
      toast.error(serverMsg ?? (e instanceof Error ? e.message : 'Erro ao ativar o tracking do Resend.'));
    } finally {
      setEnablingTracking(false);
    }
  };

  const handleCopyRecordValue = async (value: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedRecordIndex(idx);
      toast.success('Valor copiado!');
      setTimeout(() => setCopiedRecordIndex((cur) => (cur === idx ? null : cur)), 2000);
    } catch {
      toast.error('Erro ao copiar');
    }
  };

  const webhookSecretFormatValid = webhookSecretInput.length === 0 || webhookSecretInput.startsWith('whsec_');
  // O segredo de descadastro é obrigatório: sem ele o worker envia o email sem
  // link de descadastro e sem o header List-Unsubscribe (exigência do
  // Gmail/Yahoo). Se já existe um configurado, não precisa reenviar — só se
  // quiser trocar. O servidor impõe a mesma regra (a UI sozinha não basta).
  const unsubscribeOk = unsubscribeConfigured
    ? unsubscribeInput.length === 0 || unsubscribeInput.length >= 32 // trocar é opcional
    : unsubscribeInput.length >= 32; // primeira configuração: obrigatório

  const canSave =
    testState === 'valid' &&
    fromName.trim().length > 0 &&
    fromPrefix.trim().length > 0 &&
    fromDomain.trim().length > 0 &&
    webhookSecretFormatValid &&
    unsubscribeOk;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        action: 'save',
        from_name: fromName.trim(),
        from_prefix: fromPrefix.trim(),
        from_domain: fromDomain.trim(),
      };
      // C1 (review): `editingKey` só vira true pelo botão "Trocar chave", que só
      // aparece quando já existe uma chave salva. Na configuração INICIAL
      // (Vault vazio) o input de api_key some pelo ramo `else` do JSX com
      // `editingKey` ainda false -- exigir a flag aqui descartava a chave em
      // silêncio no primeiro save. O input só existe/tem valor quando está
      // renderizado, então checar o valor já é suficiente.
      if (apiKeyInput.trim()) body.api_key = apiKeyInput.trim();
      if (unsubscribeInput.length > 0) body.unsubscribe_secret = unsubscribeInput;
      if (webhookSecretInput.length > 0) body.webhook_secret = webhookSecretInput;

      const { data, error } = await supabase.functions.invoke('resend-config', { body });
      if (error) throw error;

      if (!data?.success) {
        toast.error(data?.error || 'Não foi possível salvar a configuração do Resend.');
        return;
      }

      toast.success(`Configuração salva. Remetente: ${data.from}`);
      if (data.warning) toast.warning(data.warning);

      setEditingKey(false);
      setApiKeyInput('');
      setUnsubscribeInput('');
      setWebhookSecretInput('');
      await loadState();
    } catch (e) {
      const serverMsg = await getFunctionErrorMessage(e);
      toast.error(serverMsg ?? (e instanceof Error ? e.message : 'Erro ao salvar a configuração do Resend.'));
    } finally {
      setSaving(false);
    }
  };

  const fromPreview =
    fromName.trim() && fromPrefix.trim() && fromDomain.trim()
      ? `${fromName.trim()} <${fromPrefix.trim()}@${fromDomain.trim()}>`
      : null;

  const overallBadge = (() => {
    if (loading) return { label: 'Carregando...', variant: 'secondary' as const, className: '' };
    if (apiKeyConfigured && savedFrom) {
      return { label: 'Configurado', variant: 'default' as const, className: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20' };
    }
    if (apiKeyConfigured && !savedFrom) {
      return { label: 'Remetente pendente', variant: 'secondary' as const, className: 'bg-amber-500/15 text-amber-500 border-amber-500/20' };
    }
    return { label: 'Não configurado', variant: 'secondary' as const, className: '' };
  })();

  return (
    <Card className="border-border/40">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md flex items-center justify-center text-white font-bold text-sm" style={{ backgroundColor: '#000000' }}>
            R
          </div>
          <div>
            <CardTitle className="text-base">Resend (Email)</CardTitle>
            <CardDescription className="text-xs">Envio de emails de campanhas e automações</CardDescription>
          </div>
        </div>
        <Badge variant={overallBadge.variant} className={`text-[10px] ${overallBadge.className}`}>
          {overallBadge.label}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando configuração...
          </div>
        ) : (
          <>
            {/* API key */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">API key</Label>
              {apiKeyConfigured && !editingKey ? (
                <div className="flex items-center gap-2">
                  <Input readOnly value={`re_${'•'.repeat(8)}${apiKeyLast4 ?? ''}`} className="text-xs font-mono bg-muted/30" />
                  <Button variant="outline" size="sm" className="h-9 flex-shrink-0 gap-1.5 text-xs" onClick={handleStartChangeKey}>
                    <KeyRound className="h-3.5 w-3.5" /> Trocar chave
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    type="password"
                    placeholder="re_..."
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    className="text-xs font-mono"
                  />
                  <Button variant="outline" size="sm" className="h-9 flex-shrink-0 gap-1.5 text-xs" onClick={handleTest} disabled={testing}>
                    {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    {testing ? 'Testando...' : 'Testar chave'}
                  </Button>
                </div>
              )}

              {testState === 'valid' && scope === 'full' && (
                <div className="flex items-center gap-2 text-xs text-emerald-500">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Chave válida (acesso completo, {domains.length} domínio{domains.length !== 1 ? 's' : ''} encontrado{domains.length !== 1 ? 's' : ''}).
                </div>
              )}
              {testState === 'valid' && scope === 'sending_only' && (
                <div className="flex items-start gap-2 text-xs text-emerald-500">
                  <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <span>Chave válida, do tipo <strong>somente envio</strong> — a API do Resend não permite listar domínios com esse tipo de chave. Isso não é um erro.</span>
                </div>
              )}
              {testState === 'invalid' && testReason === 'stored_key_check_failed' && (
                <Alert className="py-2 border-amber-500/40 bg-amber-500/10">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  <AlertDescription className="text-xs text-amber-600 dark:text-amber-400">
                    Não foi possível confirmar agora a chave salva junto ao Resend. Clique em "Trocar chave" e teste novamente.
                  </AlertDescription>
                </Alert>
              )}
              {testState === 'invalid' && testReason !== 'stored_key_check_failed' && (
                <Alert variant="destructive" className="py-2">
                  <XCircle className="h-3.5 w-3.5" />
                  <AlertDescription className="text-xs">
                    {testError || (testReason && REASON_LABEL[testReason]) || 'Chave inválida.'}
                  </AlertDescription>
                </Alert>
              )}
            </div>

            {/* Remetente */}
            <div className={`space-y-3 rounded-lg border border-border/30 p-3 ${testState !== 'valid' ? 'opacity-50 pointer-events-none' : ''}`}>
              <Label className="text-xs font-medium">Remetente</Label>

              {scope === 'full' ? (
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Domínio verificado</Label>
                  <Select value={fromDomain} onValueChange={setFromDomain} disabled={testState !== 'valid'}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Selecione um domínio" />
                    </SelectTrigger>
                    <SelectContent>
                      {domains.map((domain) => {
                        const verified = isDomainVerified(domain);
                        return (
                          <SelectItem key={domain.name} value={domain.name} disabled={!verified} className="text-xs">
                            {domain.name} {!verified ? `(${domain.status})` : ''}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {domains.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">Nenhum domínio encontrado na conta Resend. Verifique um domínio em resend.com/domains.</p>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Domínio</Label>
                  <Input
                    value={fromDomain}
                    onChange={(e) => setFromDomain(e.target.value)}
                    placeholder="dnia.ai"
                    className="h-9 text-xs"
                    disabled={testState !== 'valid'}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Chave somente envio: não é possível confirmar por aqui se o domínio está verificado. Confira em resend.com/domains.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Nome de exibição</Label>
                  <Input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="DN.IA" className="h-9 text-xs" disabled={testState !== 'valid'} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Prefixo</Label>
                  <Input value={fromPrefix} onChange={(e) => setFromPrefix(e.target.value)} placeholder="noreply" className="h-9 text-xs" disabled={testState !== 'valid'} />
                </div>
              </div>

              {fromPreview && <p className="text-[11px] text-muted-foreground">Preview: <code className="bg-muted/50 px-1 py-0.5 rounded">{fromPreview}</code></p>}
            </div>

            {/* Rastreamento de abertura e clique -- desligado por padrão no
                Resend, por domínio. É por isso que o webhook recebe
                email.sent/email.delivered mas nunca email.opened/clicked
                mesmo com tudo mais certo. */}
            {testState === 'valid' && fromDomain.trim() && (
              <div className="space-y-2 rounded-lg border border-border/30 p-3">
                <Label className="text-xs font-medium">Rastreamento de abertura e clique</Label>

                {scope === 'sending_only' ? (
                  <Alert className="py-2 border-amber-500/40 bg-amber-500/10">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    <AlertDescription className="text-xs text-amber-600 dark:text-amber-400">
                      Essa API key é do tipo <strong>somente envio</strong> e o Resend não permite alterar domínios com
                      ela — não é possível ativar o tracking por aqui. Gere uma chave de acesso completo em{' '}
                      <strong>resend.com/api-keys</strong>, salve-a acima e volte nesta seção, ou ative diretamente em{' '}
                      <strong>resend.com/domains</strong>.
                    </AlertDescription>
                  </Alert>
                ) : trackingLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Consultando o estado do rastreamento...
                  </div>
                ) : (
                  <>
                    {/* Caso 1 — ligado e DNS verificado: funcionando de verdade. */}
                    {trackingWorking && (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs text-emerald-500">
                          <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
                          <span>
                            Abertura e clique <strong>ativos</strong> em {fromDomain}
                            {trackingReadable?.tracking_subdomain
                              ? <> (subdomínio <code className="bg-emerald-500/10 px-1 py-0.5 rounded">{trackingReadable.tracking_subdomain}.{fromDomain}</code>)</>
                              : null}
                            , com o DNS verificado.
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Caso 2 — ligado na conta, mas o CNAME não está verificado.
                        O Resend não avisa: o usuário acha que ativou e nenhuma
                        abertura chega nunca. É o estado mais confuso de todos. */}
                    {trackingDnsPending && (
                      <Alert variant="destructive" className="py-2">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        <AlertDescription className="text-xs">
                          Abertura e clique estão ligados na conta do Resend, mas o{' '}
                          <strong>DNS ainda não foi verificado</strong> — enquanto isso o rastreamento{' '}
                          <strong>não funciona</strong> e nenhum evento de abertura ou clique é gerado. Adicione o
                          registro abaixo no DNS de {fromDomain}.
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Caso 3 — desligado (ou parcialmente ligado). */}
                    {trackingReadable && !trackingEnabled && (
                      <Alert className="py-2 border-amber-500/40 bg-amber-500/10">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                        <AlertDescription className="text-xs text-amber-600 dark:text-amber-400">
                          Estado atual em {fromDomain}: abertura{' '}
                          <strong>{trackingReadable.open_tracking ? 'ativada' : 'desativada'}</strong>, clique{' '}
                          <strong>{trackingReadable.click_tracking ? 'ativado' : 'desativado'}</strong>. O Resend vem com
                          os dois <strong>desligados por padrão</strong>, por domínio — e sem eles o Resend nem gera os
                          eventos <code className="bg-amber-500/15 px-1 py-0.5 rounded">email.opened</code> /{' '}
                          <code className="bg-amber-500/15 px-1 py-0.5 rounded">email.clicked</code>: o webhook continua
                          correto e mesmo assim nenhuma abertura ou clique aparece.
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Não deu para ler o estado (rede, domínio sumiu da conta...). */}
                    {trackingInfo && trackingInfo.available === false && (
                      <Alert className="py-2 border-amber-500/40 bg-amber-500/10">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                        <AlertDescription className="text-xs text-amber-600 dark:text-amber-400">
                          {trackingInfo.reason === 'not_found'
                            ? `O domínio ${fromDomain} não foi encontrado na conta Resend.`
                            : 'Não foi possível consultar o estado do rastreamento no Resend agora. Recarregue a página.'}
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Ativação — só quando não está ligado. */}
                    {!trackingEnabled && (
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">Subdomínio de rastreamento</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            value={trackingSubdomain}
                            onChange={(e) => setTrackingSubdomain(e.target.value)}
                            placeholder="links"
                            className="h-9 text-xs font-mono"
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-9 flex-shrink-0 gap-1.5 text-xs"
                            onClick={handleEnableTracking}
                            disabled={enablingTracking || !selectedDomainObj?.id}
                          >
                            {enablingTracking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                            {enablingTracking ? 'Ativando...' : 'Ativar rastreamento'}
                          </Button>
                        </div>
                        {!selectedDomainObj?.id && (
                          <p className="text-[11px] text-muted-foreground">
                            Escolha um domínio verificado da lista acima para ativar o tracking.
                          </p>
                        )}
                      </div>
                    )}

                    {/* Registros DNS pendentes — o que falta adicionar agora. */}
                    {pendingRecords.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[11px] text-muted-foreground">
                          Adicione {pendingRecords.length === 1 ? 'este registro' : 'estes registros'} no DNS de{' '}
                          <strong>{fromDomain}</strong>. O rastreamento só passa a funcionar depois que o DNS propagar e
                          o Resend confirmar a verificação — pode levar de minutos a algumas horas.
                        </p>
                        <div className="overflow-x-auto rounded border border-border/30">
                          <table className="w-full text-[11px]">
                            <thead>
                              <tr className="bg-muted/30 text-left">
                                <th className="px-2 py-1.5 font-medium">Tipo</th>
                                <th className="px-2 py-1.5 font-medium">Nome</th>
                                <th className="px-2 py-1.5 font-medium">Valor</th>
                                <th className="px-2 py-1.5 font-medium">Status</th>
                                <th className="px-2 py-1.5 font-medium" />
                              </tr>
                            </thead>
                            <tbody>
                              {pendingRecords.map((rec, idx) => (
                                <tr key={`${rec.name}-${idx}`} className="border-t border-border/20">
                                  <td className="px-2 py-1.5 font-mono">{rec.type}</td>
                                  <td className="px-2 py-1.5 font-mono break-all">{rec.name}</td>
                                  <td className="px-2 py-1.5 font-mono break-all">{rec.value}</td>
                                  <td className="px-2 py-1.5 text-muted-foreground">{rec.status ?? '—'}</td>
                                  <td className="px-2 py-1.5">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 w-6 p-0"
                                      onClick={() => handleCopyRecordValue(rec.value, idx)}
                                    >
                                      {copiedRecordIndex === idx ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    <Alert className="py-2 border-border/40 bg-muted/20">
                      <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
                      <AlertDescription className="text-xs text-muted-foreground">
                        Abertura é um sinal fraco: o Apple Mail Privacy Protection pré-carrega imagens e infla
                        artificialmente as aberturas. Para decisões críticas nos fluxos (qualificação, régua de
                        automação), ramifique por <strong>clique</strong>, não por abertura.
                      </AlertDescription>
                    </Alert>

                    <p className="text-[11px] text-muted-foreground">
                      Emails já enviados <strong>não retroagem</strong> — o pixel de abertura e os links de clique só são
                      injetados nos envios feitos depois que o tracking estiver ativo e o DNS verificado.
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Descadastro */}
            <div className="space-y-2 rounded-lg border border-border/30 p-3">
              <Label className="text-xs font-medium">Descadastro (obrigatório)</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="password"
                  placeholder={unsubscribeConfigured ? 'Configurado — digite para trocar' : 'Gere ou cole um valor com 32+ caracteres'}
                  value={unsubscribeInput}
                  onChange={(e) => setUnsubscribeInput(e.target.value)}
                  className="text-xs font-mono"
                />
                <Button variant="outline" size="sm" className="h-9 flex-shrink-0 gap-1.5 text-xs" onClick={handleGenerateUnsubscribeSecret}>
                  <Wand2 className="h-3.5 w-3.5" /> Gerar
                </Button>
              </div>

              {/* Já configurado: informa e deixa claro que trocar é opcional (e o preço de trocar) */}
              {unsubscribeConfigured && unsubscribeInput.length === 0 && (
                <Alert className="py-2 border-emerald-500/40 bg-emerald-500/10">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  <AlertDescription className="text-xs text-emerald-600 dark:text-emerald-400">
                    Já configurado — não precisa preencher de novo. Só digite algo aqui se quiser{' '}
                    <strong>trocar</strong> o segredo (o que invalida os links de descadastro já enviados).
                  </AlertDescription>
                </Alert>
              )}

              {/* Ainda não configurado: é obrigatório para salvar */}
              {!unsubscribeConfigured && (
                <Alert variant="destructive" className="py-2">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <AlertDescription className="text-xs">
                    <strong>Obrigatório para salvar.</strong> Sem esse segredo, os emails saem{' '}
                    <strong>sem link de descadastro</strong> e sem o header{' '}
                    <code className="bg-destructive/15 px-1 py-0.5 rounded">List-Unsubscribe</code>, violando a exigência de
                    descadastro em um clique do Gmail e do Yahoo para remetentes em volume.
                  </AlertDescription>
                </Alert>
              )}

              {/* Trocando um segredo existente: o preço é alto, avisa de novo */}
              {unsubscribeConfigured && unsubscribeInput.length > 0 && (
                <Alert className="py-2 border-amber-500/40 bg-amber-500/10">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  <AlertDescription className="text-xs text-amber-600 dark:text-amber-400">
                    Trocar este segredo <strong>invalida todos os links de descadastro já enviados</strong> — quem clicar num
                    link antigo vai receber erro e provavelmente marcará seu email como spam.
                  </AlertDescription>
                </Alert>
              )}
              {unsubscribeInput.length > 0 && unsubscribeInput.length < 32 && (
                <p className="text-[11px] text-destructive">Precisa ter pelo menos 32 caracteres.</p>
              )}
            </div>

            {/* Webhook */}
            <div className="space-y-2 rounded-lg border border-border/30 p-3">
              <Label className="text-xs font-medium">Webhook (obrigatório para tracking)</Label>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">URL do webhook</Label>
                <div className="flex items-center gap-2">
                  <Input readOnly value={webhookUrl} className="text-xs font-mono bg-muted/30" />
                  <Button variant="outline" size="sm" className="h-9 flex-shrink-0" onClick={handleCopyWebhookUrl}>
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Crie o webhook em resend.com/webhooks com essa URL, marque todos os eventos de email, e cole aqui o
                  signing secret.
                </p>
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Signing secret</Label>
                <Input
                  type="password"
                  placeholder={webhookSecretConfigured ? 'Configurado — digite para trocar' : 'whsec_...'}
                  value={webhookSecretInput}
                  onChange={(e) => setWebhookSecretInput(e.target.value)}
                  className="text-xs font-mono"
                />
                {!webhookSecretFormatValid && (
                  <p className="text-[11px] text-destructive">O signing secret do Resend começa com "whsec_".</p>
                )}
              </div>

              {!webhookSecretConfigured && (
                <Alert variant="destructive" className="py-2">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <AlertDescription className="text-xs">
                    Sem o webhook configurado: nenhum tracking de abertura/clique, nenhuma supressão automática de bounce
                    ou reclamação (o Resend encerra contas acima de 4% de bounce), e o sweeper de recuperação de envios
                    fica sem a prova que impede reenviar um email já entregue.
                  </AlertDescription>
                </Alert>
              )}
            </div>

            <div className="flex items-center gap-3 pt-1">
              <Button size="sm" className="h-9 text-xs" onClick={handleSave} disabled={!canSave || saving}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                {saving ? 'Salvando...' : 'Salvar'}
              </Button>
              {/* Dizer POR QUE está bloqueado — um botão cinza sem explicação é um beco sem saída */}
              {testState !== 'valid' ? (
                <span className="text-[11px] text-muted-foreground">Teste a API key para habilitar o salvamento.</span>
              ) : !unsubscribeOk ? (
                <span className="text-[11px] text-destructive">
                  Informe o segredo de descadastro (32+ caracteres) para salvar.
                </span>
              ) : null}
            </div>

            <Collapsible open={instructionsOpen} onOpenChange={setInstructionsOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5 h-7 text-xs px-0 text-muted-foreground">
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${instructionsOpen ? 'rotate-180' : ''}`} />
                  Como funciona
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <ol className="space-y-1.5 text-xs text-muted-foreground leading-relaxed list-decimal list-inside">
                  <li>Cole a API key criada em resend.com/api-keys e clique em "Testar chave".</li>
                  <li>Uma chave "somente envio" é válida, só não permite listar domínios por aqui — confirme a verificação em resend.com/domains.</li>
                  <li>Escolha o domínio, o nome de exibição e o prefixo do remetente.</li>
                  <li>Gere o segredo de descadastro (obrigatório) e configure o webhook (obrigatório para tracking).</li>
                  <li>Clique em Salvar. A API key e os segredos vão para o Vault criptografado — nunca aparecem novamente na tela.</li>
                </ol>
              </CollapsibleContent>
            </Collapsible>
          </>
        )}
      </CardContent>
    </Card>
  );
}
