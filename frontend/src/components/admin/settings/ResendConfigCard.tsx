import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CheckCircle2, AlertTriangle, KeyRound, Copy, Wand2, Activity } from 'lucide-react';
import { toast } from 'sonner';
import {
  gravarConfigResend, lerConfigResend, lerDiagnosticoResend, lerDominioResend,
  ligarRastreamentoResend, testarChaveResend,
  type ConfigResend, type DiagnosticoResend, type DominioResend, type InfoDominio,
  type TesteDeChave,
} from '@/lib/config';

// Configuração do Resend pela interface — restaurada por inteiro no lote 8A.
//
// ⚠️ Este card NUNCA recebe um segredo de volta do servidor: só
// `configurado: true/false` e os últimos quatro caracteres da chave.
//
// ⚠️ O 3C tinha tirado domínios, rastreamento e teste de chave, e com eles o
// campo do segredo de descadastro — sem o qual o worker não consome a fila. O
// Erick decidiu em 10/09/2026 restaurar tudo. A referência de comportamento é
// o card original: `git show 817d15c:<este arquivo>`.

const MINIMO_DESCADASTRO = 32;

// crypto.getRandomValues, NUNCA Math.random: Math.random não é criptográfico, e
// este segredo assina todo link de descadastro.
function gerarSegredo(tamanho = 48): string {
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(tamanho);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join('');
}

async function copiar(texto: string) {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success('Copiado');
  } catch {
    toast.error('Erro ao copiar');
  }
}

export default function ResendConfigCard() {
  const [config, setConfig] = useState<ConfigResend | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const [apiKey, setApiKey] = useState('');
  const [teste, setTeste] = useState<TesteDeChave | null>(null);
  const [testando, setTestando] = useState(false);

  const [nome, setNome] = useState('');
  const [prefixo, setPrefixo] = useState('');
  const [dominio, setDominio] = useState('');

  const [descadastro, setDescadastro] = useState('');
  const [segredoWebhook, setSegredoWebhook] = useState('');

  const [info, setInfo] = useState<InfoDominio | null>(null);
  const [lendoInfo, setLendoInfo] = useState(false);
  const [subdominio, setSubdominio] = useState('links');
  const [ativando, setAtivando] = useState(false);

  const [diagnostico, setDiagnostico] = useState<DiagnosticoResend | null>(null);
  const [diagnosticando, setDiagnosticando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const c = await lerConfigResend();
      setConfig(c);
      if (c.remetente) {
        setNome(c.remetente.nome);
        setPrefixo(c.remetente.prefixo);
        setDominio(c.remetente.dominio);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao carregar a configuração');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // O escopo e os domínios vêm do teste da chave nova, se houve; senão, da
  // chave gravada.
  const escopo = teste?.valida ? teste.escopo : config?.resend_api_key.escopo ?? null;
  const dominios: DominioResend[] = teste?.valida ? teste.dominios : config?.dominios ?? [];
  const dominioEscolhido = useMemo(
    () => dominios.find((d) => d.name.toLowerCase() === dominio.trim().toLowerCase()),
    [dominios, dominio]);

  // O estado REAL do rastreamento, só com chave completa e domínio da lista.
  useEffect(() => {
    if (escopo !== 'full' || !dominioEscolhido?.id || !config?.resend_api_key.configurado) {
      setInfo(null);
      return;
    }
    let cancelado = false;
    setLendoInfo(true);
    lerDominioResend(dominioEscolhido.id)
      .then((i) => {
        if (cancelado) return;
        setInfo(i);
        // O subdomínio já configurado vence: digitar outro reconfiguraria o
        // CNAME à toa.
        if (i.tracking_subdomain) setSubdominio(i.tracking_subdomain);
      })
      .catch(() => { if (!cancelado) setInfo({ disponivel: false, motivo: 'network' }); })
      .finally(() => { if (!cancelado) setLendoInfo(false); });
    return () => { cancelado = true; };
  }, [escopo, dominioEscolhido?.id, config?.resend_api_key.configurado]);

  const testar = async () => {
    if (!apiKey.trim()) return;
    setTestando(true);
    try {
      const r = await testarChaveResend(apiKey.trim());
      setTeste(r);
      if (r.valida && r.escopo === 'full' && r.dominios.length > 0 && !dominio) {
        setDominio(r.dominios[0].name);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao testar a chave');
    } finally {
      setTestando(false);
    }
  };

  const descadastroConfigurado = !!config?.unsubscribe_secret.configurado;
  const descadastroOk = descadastroConfigurado
    ? descadastro.length === 0 || descadastro.length >= MINIMO_DESCADASTRO
    : descadastro.length >= MINIMO_DESCADASTRO;

  const salvar = async () => {
    setSalvando(true);
    try {
      const r = await gravarConfigResend({
        from_name: nome.trim(),
        from_prefix: prefixo.trim(),
        from_domain: dominio.trim(),
        api_key: apiKey,
        unsubscribe_secret: descadastro,
        webhook_secret: segredoWebhook,
      });
      toast.success(`Configuração salva — remetente: ${r.email_from}`);
      if (r.aviso) toast.warning(r.aviso);
      setApiKey('');
      setDescadastro('');
      setSegredoWebhook('');
      setTeste(null);
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  };

  const ativarRastreamento = async () => {
    if (!dominioEscolhido?.id) return;
    setAtivando(true);
    try {
      const r = await ligarRastreamentoResend(dominioEscolhido.id, subdominio.trim() || 'links');
      setInfo({ ...r, disponivel: true });
      toast.success('Rastreamento ativado no Resend. Falta adicionar o registro DNS abaixo.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao ativar o rastreamento');
    } finally {
      setAtivando(false);
    }
  };

  const diagnosticar = async () => {
    setDiagnosticando(true);
    try {
      setDiagnostico(await lerDiagnosticoResend());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro no diagnóstico');
    } finally {
      setDiagnosticando(false);
    }
  };

  const selo = (ok: boolean) =>
    ok ? <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" /> configurado</Badge>
       : <Badge variant="outline">não configurado</Badge>;

  if (carregando) {
    return (
      <Card>
        <CardContent className="py-10 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const rastreamentoPendente = info?.disponivel
    && (info.open_tracking || info.click_tracking)
    && (info.records ?? []).some((r) => (r.status ?? '').toLowerCase() !== 'verified');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4" /> Resend
        </CardTitle>
        <CardDescription>
          O serviço que entrega os e-mails de campanha. Os segredos ficam no
          banco, nunca no repositório — e nunca voltam para esta tela.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Estado */}
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-muted-foreground">Chave da API</span>
            {selo(!!config?.resend_api_key.configurado)}
            {config?.resend_api_key.ultimos4 && (
              <code className="text-xs text-muted-foreground">…{config.resend_api_key.ultimos4}</code>
            )}
            {escopo === 'full' && <Badge variant="secondary">acesso completo</Badge>}
            {escopo === 'sending_only' && <Badge variant="outline">somente envio</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-muted-foreground">Segredo de descadastro</span>
            {selo(descadastroConfigurado)}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-muted-foreground">Segredo do webhook</span>
            {selo(!!config?.webhook_secret.configurado)}
          </div>
        </div>

        {(!config?.resend_api_key.configurado || !descadastroConfigurado) && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Sem a chave da API <strong>e</strong> o segredo de descadastro, o
              worker <strong>não consome a fila</strong> — de propósito. Campanha
              enfileirada fica esperando; nada é perdido e nada é enviado.
            </AlertDescription>
          </Alert>
        )}

        {/* Chave */}
        <div className="space-y-2">
          <Label htmlFor="resend-key">Chave da API</Label>
          <div className="flex gap-2">
            <Input
              id="resend-key" type="password" autoComplete="off"
              placeholder={config?.resend_api_key.configurado ? 'deixe em branco para manter' : 're_...'}
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setTeste(null); }}
            />
            <Button variant="outline" onClick={testar} disabled={testando || !apiKey.trim()}>
              {testando ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Testar chave'}
            </Button>
          </div>
          {teste?.valida && teste.escopo === 'full' && (
            <p className="text-xs text-green-600">Chave válida, acesso completo — {teste.dominios.length} domínio(s) na conta.</p>
          )}
          {teste?.valida && teste.escopo === 'sending_only' && (
            <p className="text-xs text-amber-600">
              Chave válida, <strong>somente envio</strong>: ela não lista domínios nem liga o
              rastreamento. Digite o domínio à mão e confira a verificação em resend.com/domains.
            </p>
          )}
          {teste && !teste.valida && (
            <p className="text-xs text-destructive">
              {teste.motivo === 'network' ? 'Não foi possível falar com o Resend.' : 'Chave inválida.'}
            </p>
          )}
        </div>

        {/* Remetente */}
        <div className="space-y-2">
          <Label>Remetente</Label>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
            <Input placeholder="Nome (ex: Health & Safety)" value={nome}
                   onChange={(e) => setNome(e.target.value)} />
            <span className="hidden sm:inline text-muted-foreground">&lt;</span>
            <Input placeholder="prefixo (ex: contato)" value={prefixo}
                   onChange={(e) => setPrefixo(e.target.value)} />
            <span className="hidden sm:inline text-muted-foreground">@</span>
            {escopo === 'full' && dominios.length > 0 ? (
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={dominioEscolhido?.name ?? ''}
                onChange={(e) => setDominio(e.target.value)}
              >
                <option value="" disabled>escolha o domínio</option>
                {dominios.map((d) => (
                  <option key={d.id} value={d.name}>{d.name} — {d.status}</option>
                ))}
              </select>
            ) : (
              <Input placeholder="dominio.com.br" value={dominio}
                     onChange={(e) => setDominio(e.target.value)} />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Com chave de acesso completo, o domínio precisa estar verificado na conta do Resend.
          </p>
        </div>

        {/* Segredo de descadastro */}
        <div className="space-y-2">
          <Label htmlFor="resend-descadastro">Segredo de descadastro</Label>
          <div className="flex gap-2">
            <Input
              id="resend-descadastro" type="password" autoComplete="off"
              placeholder={descadastroConfigurado ? 'configurado — digite só para trocar'
                                                  : `gere ou cole um valor com ${MINIMO_DESCADASTRO}+ caracteres`}
              value={descadastro}
              onChange={(e) => setDescadastro(e.target.value)}
            />
            <Button variant="outline" className="gap-1" onClick={() => setDescadastro(gerarSegredo(48))}>
              <Wand2 className="h-3.5 w-3.5" /> Gerar
            </Button>
          </div>
          {descadastro.length > 0 && descadastro.length < MINIMO_DESCADASTRO && (
            <p className="text-xs text-destructive">Precisa de pelo menos {MINIMO_DESCADASTRO} caracteres.</p>
          )}
          {descadastroConfigurado && descadastro.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Trocar este segredo <strong>invalida todos os links de descadastro já enviados</strong> —
                quem clicar num e-mail antigo vai receber erro em vez de sair da lista.
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Webhook */}
        <div className="space-y-2">
          <Label htmlFor="resend-webhook">Segredo do webhook</Label>
          <Input
            id="resend-webhook" type="password" autoComplete="off"
            placeholder={config?.webhook_secret.configurado ? 'deixe em branco para manter' : 'whsec_...'}
            value={segredoWebhook}
            onChange={(e) => setSegredoWebhook(e.target.value)}
          />
          {config?.webhook_url && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">URL para cadastrar no Resend:</span>
              <code className="truncate">{config.webhook_url}</code>
              <Button size="icon" variant="ghost" className="h-6 w-6"
                      onClick={() => copiar(config.webhook_url)}>
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>

        <Button onClick={salvar}
                disabled={salvando || !nome.trim() || !prefixo.trim() || !dominio.trim() || !descadastroOk}
                className="gap-2">
          {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
          Salvar
        </Button>

        {/* Rastreamento */}
        {escopo === 'full' && dominioEscolhido && (
          <div className="space-y-3 border-t pt-4">
            <h4 className="text-sm font-medium">Rastreamento de abertura e clique</h4>
            {lendoInfo && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {info && !info.disponivel && (
              <p className="text-xs text-muted-foreground">
                Não foi possível consultar o domínio por aqui ({info.motivo}).
              </p>
            )}
            {info?.disponivel && !(info.open_tracking || info.click_tracking) && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Desligado neste domínio — por isso aberturas e cliques não voltam pelo webhook.
                </p>
                <div className="flex gap-2 items-center">
                  <Input className="w-40" value={subdominio}
                         onChange={(e) => setSubdominio(e.target.value)} />
                  <span className="text-xs text-muted-foreground">.{dominioEscolhido.name}</span>
                  <Button variant="outline" onClick={ativarRastreamento} disabled={ativando}>
                    {ativando ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Ativar rastreamento'}
                  </Button>
                </div>
              </div>
            )}
            {info?.disponivel && (info.open_tracking || info.click_tracking) && (
              <p className="text-xs">
                Abertura: <strong>{info.open_tracking ? 'ligada' : 'desligada'}</strong> ·
                Clique: <strong>{info.click_tracking ? 'ligado' : 'desligado'}</strong>
              </p>
            )}
            {rastreamentoPendente && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Ligado na conta, mas o registro DNS abaixo ainda não foi verificado.
                  Até ele existir, nenhuma abertura chega — e nada avisa.
                </AlertDescription>
              </Alert>
            )}
            {info?.disponivel && (info.records ?? []).length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="pr-2">Tipo</th><th className="pr-2">Nome</th>
                      <th className="pr-2">Valor</th><th className="pr-2">Status</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {(info.records ?? []).map((r) => (
                      <tr key={`${r.type}-${r.name}`}>
                        <td className="pr-2">{r.type}</td>
                        <td className="pr-2 font-mono">{r.name}</td>
                        <td className="pr-2 font-mono break-all">{r.value}</td>
                        <td className="pr-2">{r.status ?? '—'}</td>
                        <td>
                          <Button size="icon" variant="ghost" className="h-6 w-6"
                                  onClick={() => copiar(r.value)}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Diagnóstico */}
        <div className="space-y-2 border-t pt-4">
          <Button variant="outline" className="gap-2" onClick={diagnosticar} disabled={diagnosticando}>
            {diagnosticando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
            Verificar conexão
          </Button>
          {diagnostico && (
            <div className="text-xs space-y-1">
              {diagnostico.ok
                ? <p className="text-green-600">Conectado. Remetente: {diagnostico.remetente}</p>
                : <p className="text-destructive">
                    {diagnostico.erro_api ?? `Faltando: ${diagnostico.faltando.join(', ')}`}
                  </p>}
              {diagnostico.segredo_descadastro_faltando && (
                <p className="text-amber-600">
                  Sem segredo de descadastro: o worker não envia nada.
                </p>
              )}
              {(diagnostico.dominios ?? []).map((d) => (
                <p key={d.name}>{d.name} — {d.status}</p>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
