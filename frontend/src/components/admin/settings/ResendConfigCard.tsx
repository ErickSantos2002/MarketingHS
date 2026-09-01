import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CheckCircle2, AlertTriangle, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { gravarConfigResend, lerConfigResend, type ConfigResend } from '@/lib/config';

// Configuração do Resend pela interface.
//
// ⚠️ Este card NUNCA recebe um segredo de volta do servidor: só
// `configurado: true/false` e os últimos quatro caracteres da chave. Devolver o
// valor colocaria a RESEND_API_KEY no HTML de qualquer admin logado, e num log
// de proxy no caminho.
//
// ⚠️ A VERIFICAÇÃO DE DOMÍNIO E O RASTREAMENTO ficaram de fora, de propósito.
// A versão herdada listava domínios, consultava status de DNS e ligava
// open/click tracking — tudo chamando a API do Resend a partir do servidor. É
// trabalho de configuração feito uma vez, e o painel do Resend já o faz melhor.
// Reimplementá-lo aqui seria manter uma segunda interface para a mesma coisa,
// que envelhece junto com a API deles.
export default function ResendConfigCard() {
  const [config, setConfig] = useState<ConfigResend | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const [apiKey, setApiKey] = useState('');
  const [remetente, setRemetente] = useState('');
  const [segredoWebhook, setSegredoWebhook] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const c = await lerConfigResend();
      setConfig(c);
      setRemetente(c.email_from ?? '');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao carregar a configuração');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const salvar = async () => {
    setSalvando(true);
    try {
      // ⚠️ Campo em branco significa "não mexi", não "apague". O servidor
      // ignora vazio: apagar a chave por engano pararia todo envio em silêncio.
      const { gravados } = await gravarConfigResend({
        api_key: apiKey,
        email_from: remetente,
        webhook_secret: segredoWebhook,
      });
      if (gravados.length === 0) {
        toast.info('Nada a salvar — preencha ao menos um campo.');
      } else {
        toast.success('Configuração salva');
        setApiKey('');
        setSegredoWebhook('');
        await carregar();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
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

      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">Chave da API</span>
          {selo(!!config?.resend_api_key.configurado)}
          {config?.resend_api_key.ultimos4 && (
            <code className="text-xs text-muted-foreground">
              …{config.resend_api_key.ultimos4}
            </code>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">Segredo de descadastro</span>
          {selo(!!config?.unsubscribe_secret.configurado)}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">Segredo do webhook</span>
          {selo(!!config?.webhook_secret.configurado)}
        </div>

        {!config?.resend_api_key.configurado && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Sem a chave da API, o worker <strong>não consome a fila</strong> —
              de propósito. Campanha enfileirada fica esperando; nada é perdido
              e nada é enviado.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="resend-key">Chave da API</Label>
          <Input
            id="resend-key"
            type="password"
            autoComplete="off"
            placeholder={config?.resend_api_key.configurado ? 'deixe em branco para manter' : 're_...'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="resend-from">Remetente</Label>
          <Input
            id="resend-from"
            placeholder="Nome <endereco@dominio.com.br>"
            value={remetente}
            onChange={(e) => setRemetente(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            O domínio precisa estar verificado no painel do Resend. A
            verificação de DNS e o rastreamento de abertura são configurados lá.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="resend-webhook">Segredo do webhook</Label>
          <Input
            id="resend-webhook"
            type="password"
            autoComplete="off"
            placeholder={config?.webhook_secret.configurado ? 'deixe em branco para manter' : 'whsec_...'}
            value={segredoWebhook}
            onChange={(e) => setSegredoWebhook(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            É o <em>signing secret</em> que o Resend mostra ao criar o webhook.
            Sem ele, abertura e clique não voltam.
          </p>
        </div>

        <Button onClick={salvar} disabled={salvando} className="gap-2">
          {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
          Salvar
        </Button>
      </CardContent>
    </Card>
  );
}
