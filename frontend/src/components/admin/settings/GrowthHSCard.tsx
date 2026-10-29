import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Loader2, Wifi, WifiOff, CheckCircle2, Eye, EyeOff, Save, PauseCircle, RotateCcw, Copy,
  AlertTriangle, ArrowRightLeft, CalendarX,
} from 'lucide-react';
import { api, ErroApi } from '@/lib/api';
import { toast } from 'sonner';

type ConnectionStatus = 'idle' | 'testing' | 'connected' | 'error' | 'unconfigured';

type Falha = { lead_id: string; erro: string; atualizado_em: string };

// M5 (agendamento): reunião que o lead viu "confirmado" e não ficou pronta.
// O backend nunca manda o token nem o e-mail do lead — como a fila acima.
type ReuniaoPendente = {
  id: string;
  page_slug: string;
  inicio: string;
  vendedor_id: number | null;
  vendedor_nome: string | null;
  card_id: number | null;
  erro: string | null;
  alerta_em: string | null;
  atualizado_em: string;
};

// A reunião é marcada no horário de Brasília (a agenda do vendedor e o
// convite falam nele), qualquer que seja o fuso de quem abre a tela.
const quandoEmBrasilia = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

// Desde a migration 030 (23/10) o GrowthHS tem DOIS ambientes salvos lado a
// lado — homologação e produção —, e só o ATIVO recebe lead.
type Ambiente = 'homologacao' | 'producao';
const AMBIENTES: Ambiente[] = ['homologacao', 'producao'];
const NOME: Record<Ambiente, string> = { homologacao: 'Homologação', producao: 'Produção' };

// Tipos locais de propósito: `src/lib/api*` tem dono único (docs/frentes/README.md).
type EstadoAmbiente = {
  ambiente: Ambiente;
  ativo: boolean;
  base_url: string | null;
  app_url: string | null;
  client_id: string | null;
  list_id: number | null;
  boards_conferidos: number[];
  listas_reuniao: number[];
  listas_ganho: number[];
  listas_perdido: number[];
  listas_no_show: number[];
  // Nenhum segredo volta do backend: do client_secret, só os 4 últimos.
  client_secret: { configurado: boolean; ultimos4: string | null };
  webhook_secret: { configurado: boolean };
  // Tem o que a entrega precisa — é o que "Usar este ambiente" exige.
  completo: boolean;
  faltando: string[];
  webhook_urls: { meeting_scheduled: string; deal_won: string; deal_lost: string; no_show: string };
};

type EstadoGrowthHS = {
  ativo: Ambiente | null;
  // A fila anda: há ambiente ativo E ele está completo.
  configurado: boolean;
  ambientes: Record<Ambiente, EstadoAmbiente>;
  fila: {
    pendentes: number;
    falhas: number;
    ultimas_falhas: Falha[];
    // Revisão final do 8D (I3): o GrowthHS recusou a configuração
    // (401/403/404) — a fila inteira espera, sem gastar tentativa.
    pausada: { motivo: string; desde: string } | null;
  };
  // Falhas das últimas reservas (7 dias), `ultimas` = as 5 mais recentes.
  agendamentos?: { falhas: number; sem_alerta: number; ultimas: ReuniaoPendente[] };
};

type RespostaTeste =
  | { valido: true }
  | { valido: false; status: number | null; detalhe: string };

// Mesmos limites do `GrowthHSIn` do backend — conferir aqui só poupa a ida.
const MAX_IDS = 10;
const MIN_SEGREDO_WEBHOOK = 16;

/** "6, 7" → [6, 7]. Devolve a mensagem de erro em vez da lista quando o texto
 *  não é uma lista de ids válida (número > 0, sem repetido, até 10). */
function lerIds(texto: string, exigir = false): number[] | string {
  const partes = texto.split(/[\s,;]+/).filter(Boolean);
  // Listas de reunião/ganho/perdido/no show vazias fariam o webhook de volta ignorar todo
  // evento em silêncio — o backend recusa (422); aqui só se avisa antes.
  if (exigir && partes.length === 0) return 'Informe ao menos uma lista.';
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

const badgeMap: Record<ConnectionStatus, { label: string; variant: 'secondary' | 'destructive' | 'success' }> = {
  idle: { label: 'Não testado', variant: 'secondary' },
  testing: { label: 'Testando...', variant: 'secondary' },
  connected: { label: 'Conectado', variant: 'success' },
  error: { label: 'Erro de conexão', variant: 'destructive' },
  unconfigured: { label: 'Incompleto', variant: 'secondary' },
};

type PropsAmbiente = {
  dados: EstadoAmbiente;
  ativoAtual: Ambiente | null;
  onEstado: (e: EstadoGrowthHS) => void;
};

/** Um ambiente: os campos, o próprio "Testar", o próprio webhook e, se não é
 *  o ativo, o "Usar este ambiente". */
function AmbienteGrowthHS({ dados, ativoAtual, onEstado }: PropsAmbiente) {
  const ambiente = dados.ambiente;
  const prefixo = `growthhs-${ambiente}`;
  const [status, setStatus] = useState<ConnectionStatus>(dados.completo ? 'idle' : 'unconfigured');
  const [saving, setSaving] = useState(false);
  const [ativando, setAtivando] = useState(false);
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
  const [perdidoInput, setPerdidoInput] = useState('');
  const [noShowInput, setNoShowInput] = useState('');
  const [webhookSecretInput, setWebhookSecretInput] = useState('');
  const [showWebhookSecret, setShowWebhookSecret] = useState(false);
  // O salvo: base de "há mudança" e de "não salvo". Só muda quando ESTE
  // ambiente é carregado ou salvo — salvar o outro não apaga o que se digitou
  // aqui.
  const [salvo, setSalvo] = useState<EstadoAmbiente>(dados);

  const aplicar = (c: EstadoAmbiente) => {
    setSalvo(c);
    setBaseUrlInput(c.base_url || '');
    setAppUrlInput(c.app_url || '');
    setClientIdInput(c.client_id || '');
    setListIdInput(c.list_id != null ? String(c.list_id) : '');
    setBoardsInput(idsComoTexto(c.boards_conferidos));
    setReuniaoInput(idsComoTexto(c.listas_reuniao));
    setGanhoInput(idsComoTexto(c.listas_ganho));
    setPerdidoInput(idsComoTexto(c.listas_perdido));
    setNoShowInput(idsComoTexto(c.listas_no_show));
    setClientSecretInput('');
    setWebhookSecretInput('');
  };

  useEffect(() => {
    aplicar(dados);
    // Só na montagem: depois, `aplicar` roda no salvar deste ambiente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTest = async () => {
    setStatus('testing');
    setErrorMsg('');
    try {
      const resposta = await api.post<RespostaTeste>(`/config/growthhs/${ambiente}/testar`);
      if ('status' in resposta) {
        setStatus('error');
        setErrorMsg(
          resposta.status != null
            ? `O GrowthHS recusou as credenciais (status ${resposta.status}).`
            : 'O GrowthHS recusou as credenciais.',
        );
      } else {
        setStatus('connected');
      }
    } catch (e) {
      setStatus('error');
      setErrorMsg(e instanceof ErroApi ? e.message : 'Falha ao conectar ao GrowthHS.');
    }
  };

  const boards = lerIds(boardsInput);
  const reuniao = lerIds(reuniaoInput, true);
  const ganho = lerIds(ganhoInput, true);
  const perdido = lerIds(perdidoInput, true);
  const noShow = lerIds(noShowInput, true);
  const webhookCurto =
    webhookSecretInput.trim().length > 0 && webhookSecretInput.trim().length < MIN_SEGREDO_WEBHOOK;
  const listaInvalida =
    typeof boards === 'string' ||
    typeof reuniao === 'string' ||
    typeof ganho === 'string' ||
    typeof perdido === 'string' ||
    typeof noShow === 'string';

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
        listas_perdido: perdido,
        listas_no_show: noShow,
      };
      if (listIdInput.trim().length > 0) corpo.list_id = Number(listIdInput.trim());
      // Segredo em branco = manter o salvo. O `trim()` importa: o GrowthHS faz
      // strip do segredo dele, e um espaço colado aqui seria 401 para sempre.
      if (clientSecretInput.trim().length > 0) corpo.client_secret = clientSecretInput.trim();
      if (webhookSecretInput.trim().length > 0) corpo.webhook_secret = webhookSecretInput.trim();

      const estado = await api.put<EstadoGrowthHS>(`/config/growthhs/${ambiente}`, corpo);
      const c = estado.ambientes[ambiente];
      aplicar(c);
      onEstado(estado);
      toast.success(`${NOME[ambiente]} do GrowthHS salva`);

      // Testa automaticamente após salvar, se ficou tudo preenchido.
      if (c.completo) {
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

  const handleAtivar = async () => {
    setAtivando(true);
    try {
      const estado = await api.post<EstadoGrowthHS>('/config/growthhs/ativar', { ambiente });
      onEstado(estado);
      toast.success(`Os leads agora vão para a ${NOME[ambiente]} do GrowthHS`);
    } catch (e) {
      // 400 = incompleto; a mensagem do backend diz o que falta.
      toast.error(`Não foi possível usar a ${NOME[ambiente]}`, {
        description: e instanceof ErroApi ? e.message : undefined,
      });
    } finally {
      setAtivando(false);
    }
  };

  const badge = badgeMap[status];
  // M4 (revisão final do 8D): o teste usa a credencial SALVA — testar com
  // endereço ou Client ID digitados e não salvos daria um "Conectado" que não
  // é da configuração que a fila usa.
  const enderecoMudou = baseUrlInput.trim().replace(/\/+$/, '') !== (salvo.base_url || '');
  const clientIdMudou = clientIdInput.trim() !== (salvo.client_id || '');
  const naoSalvo = enderecoMudou || clientIdMudou || clientSecretInput.trim().length > 0;
  const canTest =
    !!salvo.base_url && !!salvo.client_id && salvo.client_secret.configurado && !naoSalvo;
  const hasChanges =
    baseUrlInput !== (salvo.base_url || '') ||
    appUrlInput !== (salvo.app_url || '') ||
    clientIdInput !== (salvo.client_id || '') ||
    listIdInput !== (salvo.list_id != null ? String(salvo.list_id) : '') ||
    boardsInput !== idsComoTexto(salvo.boards_conferidos) ||
    reuniaoInput !== idsComoTexto(salvo.listas_reuniao) ||
    ganhoInput !== idsComoTexto(salvo.listas_ganho) ||
    perdidoInput !== idsComoTexto(salvo.listas_perdido) ||
    noShowInput !== idsComoTexto(salvo.listas_no_show) ||
    clientSecretInput.trim().length > 0 ||
    webhookSecretInput.trim().length > 0;
  const outro = ativoAtual && ativoAtual !== ambiente ? ativoAtual : null;

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {dados.ativo ? (
            <Badge variant="success">Ativo — recebe os leads</Badge>
          ) : (
            <Badge variant="outline">Salvo, não ativo</Badge>
          )}
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
        {!dados.ativo && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 h-7 text-xs"
                disabled={!dados.completo || ativando || hasChanges}
              >
                {ativando ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                )}
                Usar este ambiente
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Usar a {NOME[ambiente]} do GrowthHS?</AlertDialogTitle>
                <AlertDialogDescription>
                  Os leads passam a ir para a {NOME[ambiente]} do GrowthHS, e só o webhook da{' '}
                  {NOME[ambiente]} passa a valer.
                  {outro
                    ? ` O que já foi entregue na ${NOME[outro]} fica lá — nada é reenviado.`
                    : ' Nada do que já foi entregue é reenviado.'}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={handleAtivar}>
                  Usar a {NOME[ambiente]}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {!dados.ativo && !dados.completo && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          Para usar este ambiente, preencha e salve: {dados.faltando.join(', ')}.
        </p>
      )}
      {!dados.ativo && dados.completo && hasChanges && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          Salve as alterações antes de usar este ambiente.
        </p>
      )}
      {dados.ativo && !dados.completo && (
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-[--tint-warning] p-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-warning" />
          <p className="text-xs leading-relaxed text-[--on-tint-warning]">
            Este é o ambiente ativo, mas está incompleto — a fila espera, nenhum lead sai. Falta:{' '}
            {dados.faltando.join(', ')}.
          </p>
        </div>
      )}

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${prefixo}-base-url`} className="text-xs">URL da API</Label>
          <Input
            id={`${prefixo}-base-url`}
            value={baseUrlInput}
            onChange={(e) => setBaseUrlInput(e.target.value)}
            placeholder="https://api.growthhs.exemplo.com"
            className="h-8 text-xs"
            autoComplete="off"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${prefixo}-app-url`} className="text-xs">
            URL do app <span className="text-muted-foreground font-normal">— opcional, para o link "Ver no GrowthHS"</span>
          </Label>
          <Input
            id={`${prefixo}-app-url`}
            value={appUrlInput}
            onChange={(e) => setAppUrlInput(e.target.value)}
            placeholder="https://growthhs.exemplo.com"
            className="h-8 text-xs"
            autoComplete="off"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${prefixo}-client-id`} className="text-xs">Client ID</Label>
          <Input
            id={`${prefixo}-client-id`}
            value={clientIdInput}
            onChange={(e) => setClientIdInput(e.target.value)}
            placeholder="hsg_…"
            className="h-8 text-xs"
            autoComplete="off"
            maxLength={200}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${prefixo}-client-secret`} className="text-xs">Client secret</Label>
          <div className="relative">
            <Input
              id={`${prefixo}-client-secret`}
              type={showSecret ? 'text' : 'password'}
              value={clientSecretInput}
              onChange={(e) => setClientSecretInput(e.target.value)}
              placeholder={
                salvo.client_secret.configurado
                  ? `•••• ${salvo.client_secret.ultimos4 || ''}`
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
          {salvo.client_secret.configurado && !clientSecretInput && (
            <p className="text-xs text-muted-foreground">
              Um secret já está salvo. Deixe em branco para mantê-lo.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${prefixo}-list-id`} className="text-xs">Lista de entrada</Label>
          <Input
            id={`${prefixo}-list-id`}
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
          `${prefixo}-boards`, 'Boards conferidos',
          'Funis onde se procura card aberto da pessoa antes de criar outro.',
          boardsInput, setBoardsInput, boards, '6, 7',
        )}
        {campoIds(
          `${prefixo}-listas-reuniao`, 'Listas de reunião',
          'Listas que contam como reunião agendada (produção: 28).',
          reuniaoInput, setReuniaoInput, reuniao, '28',
        )}
        {campoIds(
          `${prefixo}-listas-ganho`, 'Listas de ganho',
          'Listas de negócio ganho (produção: 32).',
          ganhoInput, setGanhoInput, ganho, '32',
        )}
        {campoIds(
          `${prefixo}-listas-perdido`, 'Listas de perdido',
          'Listas de negócio perdido (produção: 27, 33).',
          perdidoInput, setPerdidoInput, perdido, '27, 33',
        )}
        {campoIds(
          `${prefixo}-listas-no-show`, 'Listas de No Show',
          'Listas que contam como No Show (produção: 25, Reagendamento).',
          noShowInput, setNoShowInput, noShow, '25',
        )}
      </div>

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

      {naoSalvo && (
        <p className="text-xs text-[--on-tint-warning] leading-relaxed">
          O endereço ou a credencial digitados ainda não foram salvos — salve antes de testar.
        </p>
      )}

      <p className="text-xs text-muted-foreground leading-relaxed">
        Testar conexão pede um token a este GrowthHS com a credencial salva: confere o Client ID e o
        Client secret. Testa mesmo sem ser o ambiente ativo.
      </p>

      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          className="gap-1.5 h-7 text-xs"
          onClick={handleSave}
          disabled={saving || !hasChanges || listaInvalida || webhookCurto}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {saving ? 'Salvando…' : `Salvar ${NOME[ambiente]}`}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 h-7 text-xs"
          onClick={handleTest}
          disabled={status === 'testing' || !canTest}
        >
          {status === 'testing' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Wifi className="h-3.5 w-3.5" />
          )}
          {status === 'testing' ? 'Testando…' : 'Testar conexão'}
        </Button>
      </div>

      <div className="pt-2 border-t border-border/30 space-y-3">
        <div>
          <p className="text-xs font-medium">Volta do GrowthHS (webhook) — {NOME[ambiente]}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            No GrowthHS da {NOME[ambiente]}, cadastre uma automação para cada URL abaixo, com o
            segredo deste ambiente. É por ela que reunião agendada, negócio ganho, negócio perdido e
            No Show voltam para o contato — e só valem enquanto este for o ambiente ativo.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${prefixo}-webhook-secret`} className="text-xs">Segredo do webhook</Label>
          <div className="relative">
            <Input
              id={`${prefixo}-webhook-secret`}
              type={showWebhookSecret ? 'text' : 'password'}
              value={webhookSecretInput}
              onChange={(e) => setWebhookSecretInput(e.target.value)}
              placeholder={
                salvo.webhook_secret.configurado
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
              {salvo.webhook_secret.configurado
                ? 'Um segredo já está salvo.'
                : 'Sem segredo, o GrowthHS não consegue avisar de volta.'}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          {([
            ['Reunião agendada', dados.webhook_urls.meeting_scheduled],
            ['Negócio ganho', dados.webhook_urls.deal_won],
            ['Negócio perdido', dados.webhook_urls.deal_lost],
            ['No Show', dados.webhook_urls.no_show],
          ] as const).map(([rotulo, url]) => (
            <div key={rotulo} className="flex items-center gap-2 text-xs min-w-0">
              <span className="text-muted-foreground shrink-0">{rotulo}:</span>
              <code className="truncate min-w-0 flex-1">{url}</code>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0"
                onClick={() => copiar(url)}
                aria-label={`Copiar a URL de ${rotulo.toLowerCase()} da ${NOME[ambiente]}`}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          ))}
          <p className="text-xs text-muted-foreground leading-relaxed">
            Gatilho de cada automação: reunião e ganho, card movido para a lista; perdido, card
            perdido; No Show, card movido para a lista de reagendamento. A ação é sempre enviar
            webhook.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function GrowthHSCard() {
  const [loading, setLoading] = useState(true);
  const [estado, setEstado] = useState<EstadoGrowthHS | null>(null);
  const [aba, setAba] = useState<Ambiente>('homologacao');
  const [reenfileirando, setReenfileirando] = useState(false);

  const loadConfig = async (abrirAtivo = false) => {
    setLoading(true);
    try {
      const e = await api.get<EstadoGrowthHS>('/config/growthhs');
      setEstado(e);
      if (abrirAtivo && e.ativo) setAba(e.ativo);
    } catch (e) {
      toast.error('Falha ao carregar configuração do GrowthHS', {
        description: e instanceof ErroApi ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig(true);
  }, []);

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
      // Só a fila muda: o formulário de cada ambiente não é recarregado.
      const e = await api.get<EstadoGrowthHS>('/config/growthhs');
      setEstado((atual) => (atual ? { ...atual, fila: e.fila } : e));
    } catch (e) {
      toast.error('Falha ao reenfileirar', {
        description: e instanceof ErroApi ? e.message : undefined,
      });
    } finally {
      setReenfileirando(false);
    }
  };

  const ativo = estado?.ativo ?? null;

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
        {estado && (
          <Badge variant={ativo ? (estado.configurado ? 'success' : 'warning') : 'secondary'}>
            {ativo ? `${NOME[ativo]} ativa` : 'Nenhum ambiente ativo'}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Handoff automático: leads que atingem as condições das Automações viram card no funil do
          GrowthHS. Se a pessoa já tem card aberto, ele é atualizado em vez de duplicado.
          Homologação e Produção ficam salvas lado a lado; só o ambiente ativo recebe os leads.
        </p>

        {loading && !estado ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…
          </div>
        ) : estado ? (
          <>
            {ativo ? (
              <div className="flex items-start gap-2 rounded-md border border-success/30 bg-[--tint-success] p-2">
                <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-[--on-tint-success]" />
                <p className="text-xs leading-relaxed text-[--on-tint-success]">
                  <span className="font-medium">Os leads vão para a {NOME[ativo]} do GrowthHS.</span>{' '}
                  Para trocar, abra a aba do outro ambiente e use "Usar este ambiente".
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-[--tint-warning] p-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-warning" />
                <p className="text-xs leading-relaxed text-[--on-tint-warning]">
                  <span className="font-medium">Nenhum ambiente ativo — nenhum lead vai para o GrowthHS.</span>{' '}
                  Os pedidos ficam na fila. Preencha um ambiente, salve e use "Usar este ambiente".
                </p>
              </div>
            )}

            <Tabs value={aba} onValueChange={(v) => setAba(v as Ambiente)}>
              <TabsList>
                {AMBIENTES.map((a) => (
                  <TabsTrigger key={a} value={a} className="gap-1.5">
                    {NOME[a]}
                    {a === ativo && <span className="text-[--on-tint-success]">· ativo</span>}
                  </TabsTrigger>
                ))}
              </TabsList>
              {AMBIENTES.map((a) => (
                // `forceMount`: trocar de aba não perde o que foi digitado na outra.
                <TabsContent
                  key={a}
                  value={a}
                  forceMount
                  className="pt-3 data-[state=inactive]:hidden"
                >
                  <AmbienteGrowthHS
                    dados={estado.ambientes[a]}
                    ativoAtual={ativo}
                    onEstado={setEstado}
                  />
                </TabsContent>
              ))}
            </Tabs>

            <div className="pt-2 border-t border-border/30 space-y-2">
              {estado.fila.pausada && (
                <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-[--tint-warning] p-2">
                  <PauseCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-warning" />
                  <div className="text-xs leading-relaxed text-[--on-tint-warning]">
                    <p className="font-medium">
                      Fila pausada desde {new Date(estado.fila.pausada.desde).toLocaleString('pt-BR')}
                    </p>
                    <p>{estado.fila.pausada.motivo}</p>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {estado.fila.pendentes} aguardando entrega · {estado.fila.falhas} falharam
                  {ativo ? ` · os pendentes vão para a ${NOME[ativo]}` : ''}
                </p>
                {estado.fila.falhas > 0 && (
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
              {estado.fila.ultimas_falhas.length > 0 && (
                <ul className="space-y-1">
                  {estado.fila.ultimas_falhas.map((f) => (
                    <li key={f.lead_id} className="text-xs text-[--on-tint-danger] leading-relaxed">
                      Contato {f.lead_id.slice(0, 8)} — {f.erro}
                    </li>
                  ))}
                </ul>
              )}
              {estado.agendamentos && estado.agendamentos.falhas > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-[--tint-danger] p-2">
                  <CalendarX className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-[--on-tint-danger]" />
                  <div className="text-xs leading-relaxed text-[--on-tint-danger] space-y-1">
                    <p className="font-medium">
                      Reuniões agendadas que não ficaram prontas: {estado.agendamentos.falhas}
                      {estado.agendamentos.sem_alerta > 0 &&
                        ` · ${estado.agendamentos.sem_alerta} sem alerta por e-mail`}
                    </p>
                    <p>
                      O lead viu "confirmado" e o horário segue reservado para o vendedor. Confira
                      no GrowthHS e fale com o lead.
                    </p>
                    <ul className="space-y-1">
                      {estado.agendamentos.ultimas.map((a) => (
                        <li key={a.id}>
                          {quandoEmBrasilia(a.inicio)} (Brasília) · página {a.page_slug} ·{' '}
                          {a.vendedor_nome ?? `vendedor ${a.vendedor_id ?? '?'}`} —{' '}
                          {a.erro ?? 'falha sem motivo registrado'}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
