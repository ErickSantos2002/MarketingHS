import { useState, useRef, useCallback, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Mail, MessageCircle, ChevronRight, ChevronLeft, Send, Clock, AlertTriangle, Loader2, Check, Pencil } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { SegmentMultiSelect } from '@/components/admin/segments/SegmentMultiSelect';
import { useSegmentAudience } from '@/hooks/useSegmentAudience';
import { useCampaigns, type Campaign } from '@/hooks/useCampaigns';
import { includeSegmentIds, excludeSegmentIds } from '@/lib/campaignAudience';
import { useTemplates, type EmailTemplate } from '@/hooks/useTemplates';
import { BRASILIA_TIMEZONE } from '@/hooks/useLeadAnalytics';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import EmailEditor, { type EditorRef } from 'react-email-editor';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { BASE_EMAIL_DESIGN, buildEmailEditorOptions, registerEmailImageUpload } from './emailEditorConfig';
import { useSocialLinks } from '@/hooks/useSocialLinks';
import { SaveAsTemplateDialog } from './SaveAsTemplateDialog';
import { EmailTemplateFrame } from './EmailTemplateFrame';

interface CampaignWizardProps {
  open: boolean;
  onClose: () => void;
  // Presente = modo edição. Só campanhas em 'draft'/'scheduled' devem ser passadas
  // aqui; o updateCampaign reconfirma isso no servidor de qualquer forma.
  campaign?: Campaign;
  // Com `campaign`, abre o mesmo wizard em modo consulta: mesmos 3 steps, tudo
  // desabilitado e nenhum caminho de escrita. É como campanhas já em envio (que
  // não podem mais ser editadas) expõem a configuração e o conteúdo enviados.
  readOnly?: boolean;
}

const STEPS = ['Configuração', 'Conteúdo', 'Revisão'];
const WA_VARIABLES = ['{{nome}}', '{{email}}', '{{empresa}}'];

// Piso rígido de antecedência, validado no submit. O `min` do input sugere 30min (UX);
// este é o limite mínimo real, com folga suficiente para o tick do pg_cron (1min) não
// transformar um agendamento "logo ali" num envio efetivamente imediato.
const MIN_SCHEDULE_LEAD_MS = 5 * 60 * 1000;

// O <input type="datetime-local"> devolve "yyyy-MM-ddTHH:mm" sem timezone — é o horário
// de parede que o usuário digitou pensando em Brasília. Formatamos direto por string
// (sem passar por `new Date()`) para nunca depender do fuso horário do navegador do admin.
function formatScheduleInput(v: string) {
  const [datePart, timePart] = v.split('T');
  if (!datePart || !timePart) return v;
  const [y, m, d] = datePart.split('-');
  return `${d}/${m}/${y} às ${timePart}`;
}

// Converte o horário de parede (assumido Brasília) para o instante UTC absoluto que
// vai para o banco. `fromZonedTime` interpreta a string naive como sendo no fuso
// informado — independente do fuso da máquina do admin.
function scheduleInputToIso(v: string) {
  return fromZonedTime(v, BRASILIA_TIMEZONE).toISOString();
}

export function CampaignWizard({ open, onClose, campaign, readOnly }: CampaignWizardProps) {
  // Campaigns.tsx monta o wizard dentro de `{aberto && (...)}`, ou seja, ele é
  // remontado a cada abertura -- por isso inicializar o estado direto no useState
  // basta, sem useEffect de sincronização.
  const isReadOnly = !!readOnly && !!campaign;
  // Os dois modos são mutuamente exclusivos: `isEditing` liga os textos e o botão
  // de salvar, que não podem aparecer em consulta.
  const isEditing = !!campaign && !isReadOnly;

  const [step, setStep] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);

  // Step 1
  const [name, setName] = useState(campaign?.name ?? '');
  const [channel, setChannel] = useState<'email' | 'whatsapp'>(campaign?.channel ?? 'email');
  // Lista vazia = todos os contatos (mesma semântica de segment_id NULL no banco).
  const [segmentIds, setSegmentIds] = useState<string[]>(campaign ? includeSegmentIds(campaign) : []);
  const [excludedSegmentIds, setExcludedSegmentIds] = useState<string[]>(campaign ? excludeSegmentIds(campaign) : []);
  const [scheduleType, setScheduleType] = useState<'now' | 'later'>(campaign?.scheduled_at ? 'later' : 'now');
  // datetime-local espera "yyyy-MM-ddTHH:mm" em horário de PAREDE de Brasília --
  // o inverso exato do scheduleInputToIso usado na gravação.
  const [scheduledAt, setScheduledAt] = useState(
    campaign?.scheduled_at
      ? formatInTimeZone(new Date(campaign.scheduled_at), BRASILIA_TIMEZONE, "yyyy-MM-dd'T'HH:mm")
      : '',
  );

  // Step 2 - Email (Unlayer)
  const emailEditorRef = useRef<EditorRef>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [editorLoading, setEditorLoading] = useState(true);
  const [emailHtml, setEmailHtml] = useState(campaign?.channel === 'email' ? (campaign.body ?? '') : '');
  const [emailDesign, setEmailDesign] = useState<any>((campaign as any)?.design ?? null);
  const [subject, setSubject] = useState(campaign?.channel === 'email' ? (campaign.subject ?? '') : '');
  const { templates } = useTemplates();
  // O bloco social so nasce pre-preenchido se as options existirem na
  // inicializacao do Unlayer -- por isso o editor abaixo so e montado depois
  // que a config das redes chega do banco (ver buildEmailEditorOptions).
  const { config: socialConfig, loading: socialLoading } = useSocialLinks();
  const editorOptions = useMemo(() => buildEmailEditorOptions(socialConfig), [socialConfig]);
  const [templateId, setTemplateId] = useState<string>('none');
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  // Template escolhido no seletor mas ainda pendente de confirmação de sobrescrita.
  const [pendingTemplate, setPendingTemplate] = useState<EmailTemplate | null>(null);

  // Step 2 - WhatsApp
  const [waBody, setWaBody] = useState(campaign?.channel === 'whatsapp' ? (campaign.body ?? '') : '');

  const { createCampaign, updateCampaign } = useCampaigns();

  // Contagem e amostra vêm das MESMAS RPCs que o send-campaign usa para montar a
  // audiência -- antes, o número exibido vinha de `counts[segmentId]` (client) e o
  // envio resolvia por conta própria na Edge Function, dois caminhos que podiam
  // discordar.
  //
  // Em consulta o hook fica desligado: recalcular os segmentos de uma campanha já
  // enviada responde "quantos contatos eles têm HOJE", que não é quem recebeu --
  // além de gastar duas varreduras em `leads` para exibir um número errado.
  const { count: contactCount, previewNames, loading: audienceLoading } =
    useSegmentAudience(segmentIds, excludedSegmentIds, !isReadOnly);

  // Número exibido nos steps: o realmente enviado quando em consulta (já vem
  // calculado ao vivo em fetchCampaigns), a projeção dos segmentos quando não.
  const audienceCount = isReadOnly ? (campaign?.stats.sent ?? 0) : contactCount;

  // Quando o envio aconteceu de fato. Cai no scheduled_at para campanhas que ainda
  // não terminaram (status 'sending'), onde sent_at ainda é null.
  const sentAtInstant = campaign?.sent_at || campaign?.scheduled_at;
  const sentAtLabel = sentAtInstant
    ? formatInTimeZone(new Date(sentAtInstant), BRASILIA_TIMEZONE, "dd/MM/yyyy 'às' HH:mm")
    : 'Imediato';

  const onEditorReady = useCallback((unlayer: any) => {
    setEditorReady(true);
    setEditorLoading(false);

    registerEmailImageUpload(unlayer, 'campaigns');

    // Load design
    if (emailDesign) {
      unlayer.loadDesign(emailDesign);
    } else {
      unlayer.loadDesign(BASE_EMAIL_DESIGN);
    }
  }, [emailDesign]);

  const exportFromEditor = (): Promise<{ html: string; design: any }> => {
    return new Promise((resolve) => {
      const editor = emailEditorRef.current?.editor;
      if (!editor) {
        resolve({ html: '', design: null });
        return;
      }
      editor.exportHtml((htmlData: any) => {
        editor.saveDesign((design: any) => {
          resolve({ html: htmlData.html, design });
        });
      });
    });
  };

  // Cópia POR VALOR: o design do template é carregado no editor e copiado para o
  // estado local da campanha. A campanha nunca guarda o id do template, então
  // editar o template depois não altera campanhas já criadas a partir dele.
  const applyTemplate = (t: EmailTemplate) => {
    setTemplateId(t.id);
    const editor = emailEditorRef.current?.editor;
    if (editor) {
      editor.loadDesign(t.design);
      setEmailDesign(t.design);
    }
  };

  const isScheduled = scheduleType === 'later';

  const canNext = () => {
    // Em consulta nada é validado: não há o que corrigir, e `editorReady` nunca
    // fica true porque o Unlayer não chega a ser montado.
    if (isReadOnly) return true;
    if (step === 0) return name.trim().length > 0;
    if (step === 1) {
      if (channel === 'email') return subject.trim().length > 0 && editorReady;
      return waBody.trim().length > 0;
    }
    return true;
  };

  const handleNext = async () => {
    // Sem editor montado em consulta, exportFromEditor devolveria html vazio e
    // apagaria o `emailHtml` que veio do banco -- justamente o que o step 3 exibe.
    if (step === 1 && channel === 'email' && !isReadOnly) {
      const { html, design } = await exportFromEditor();
      setEmailHtml(html);
      setEmailDesign(design);
    }
    setStep(step + 1);
  };

  const handleSend = async () => {
    // Consulta não escreve nada. Nenhum botão da UI chega aqui nesse modo -- a
    // guarda existe para que isso continue verdade se algum caminho novo surgir.
    if (isReadOnly) return;

    // Guarda de reentrância: o AlertDialog agora fica aberto durante o trabalho
    // (ver preventDefault no AlertDialogAction), então um duplo-clique rápido
    // chegaria aqui duas vezes antes do primeiro setSending(true) renderizar --
    // e cada passada cria uma campanha. Ler o estado direto barra isso.
    if (sending) return;

    const scheduledIso = isScheduled && scheduledAt ? scheduleInputToIso(scheduledAt) : null;
    if (isScheduled && !scheduledIso) {
      toast.error('Escolha a data e a hora do agendamento');
      return;
    }

    // O atributo `min` do <input type="datetime-local"> é só uma dica do navegador — sem
    // reportValidity() um horário passado digitado no teclado passa direto. E o
    // promote_scheduled_campaigns dispara tudo que tem scheduled_at <= now(), então um
    // horário no passado transformaria "Agendar" num envio imediato, sem a confirmação
    // que o admin acha que ainda vai acontecer. Barramos aqui, no submit.
    if (scheduledIso && new Date(scheduledIso).getTime() < Date.now() + MIN_SCHEDULE_LEAD_MS) {
      toast.error('O agendamento precisa ser para pelo menos 5 minutos no futuro');
      return;
    }

    // ---- Modo edição: salva e sai, sem disparar envio ----------------------
    // Editar NUNCA envia. Uma campanha 'scheduled' continua agendada (o cron a
    // promove no horário); uma 'draft' continua rascunho. Quem envia é o botão de
    // envio da campanha já criada -- misturar as duas coisas aqui faria "salvar
    // uma correção de texto" virar um disparo para a base inteira.
    if (isEditing && campaign) {
      setSending(true);
      const okSaved = await updateCampaign(campaign.id, {
        name,
        segment_ids: segmentIds,
        excluded_segment_ids: excludedSegmentIds,
        subject: channel === 'email' ? subject : null,
        body: channel === 'email' ? emailHtml : waBody,
        design: channel === 'email' ? emailDesign : null,
        scheduled_at: scheduledIso,
        status: isScheduled ? 'scheduled' : 'draft',
      });
      setSending(false);
      setConfirmOpen(false);
      if (okSaved) onClose();
      return;
    }

    setSending(true);
    const body = channel === 'email' ? emailHtml : waBody;
    // `created`, e não `campaign`: a prop `campaign` (modo edição) já ocupa esse
    // nome no escopo do componente.
    const created = await createCampaign({
      name,
      channel,
      segment_ids: segmentIds,
      excluded_segment_ids: excludedSegmentIds,
      subject: channel === 'email' ? subject : null,
      body,
      scheduled_at: scheduledIso,
      // 'scheduled': o job pg_cron promote-scheduled-campaigns promove para 'sending' no horário.
      // 'draft': a transição draft -> sending é feita pelo CAS atômico dentro da Edge Function
      // send-campaign. Criar já como 'sending' faria o enfileirador rejeitar a campanha
      // (409, status fora de STARTABLE).
      status: isScheduled ? 'scheduled' : 'draft',
    });

    // createCampaign devolve null quando a criação falha (ele já exibe o toast de erro).
    // Antes, o fluxo caía direto no onClose() do fim e o wizard fechava mesmo assim --
    // o admin perdia o email inteiro que tinha acabado de compor, sem campanha nenhuma
    // criada. Agora fechamos só o diálogo de confirmação e deixamos o wizard aberto,
    // com o conteúdo intacto, para ele tentar de novo.
    if (!created) {
      setSending(false);
      setConfirmOpen(false);
      return;
    }

    {
      // Save design JSON
      if (channel === 'email' && emailDesign) {
        await supabase
          .from('campaigns' as any)
          .update({ design: emailDesign } as any)
          .eq('id', created.id);
      }

      if (isScheduled) {
        // Nada a invocar: o job pg_cron promote-scheduled-campaigns dispara no horário
        // (status='scheduled' AND scheduled_at <= now()) e chama o send-campaign sozinho.
        toast.success(`Campanha agendada para ${formatScheduleInput(scheduledAt)}`);
      } else {
        try {
          // functions.invoke NÃO lança em respostas 4xx/5xx — é obrigatório checar
          // `error` e o corpo da resposta, senão um 409/500 exibiria "sucesso".
          const { data, error } = await supabase.functions.invoke<{ error?: string }>(
            'send-campaign',
            { body: { campaign_id: created.id } },
          );

          if (error || data?.error) {
            const detail = data?.error || error?.message;
            toast.error(
              detail
                ? `Erro ao iniciar envio da campanha: ${detail}`
                : 'Erro ao iniciar envio da campanha',
            );
          } else {
            toast.success('Campanha em envio — acompanhe o progresso na lista');
          }
        } catch {
          toast.error('Erro ao iniciar envio da campanha');
        }
      }
    }
    setSending(false);
    setConfirmOpen(false);
    onClose();
  };

  const previewWaText = (text: string) => {
    const nome = previewNames[0] || 'João Silva';
    return text
      .replace(/\{\{nome\}\}/g, nome)
      .replace(/\{\{email\}\}/g, 'joao@empresa.com')
      .replace(/\{\{empresa\}\}/g, 'Empresa XYZ');
  };

  // `!sending`: não deixa fechar o wizard no meio da criação da campanha. Na prática o
  // AlertDialog modal já cobre a janela, mas depender disso é frágil -- a guarda aqui
  // é o que garante que o estado não some com a operação em voo.
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !sending) onClose(); }}>

      <DialogContent className="max-w-5xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isReadOnly ? 'Visualizar campanha' : isEditing ? 'Editar campanha' : 'Nova campanha'}
          </DialogTitle>
        </DialogHeader>

        {/* Progress */}
        <div className="flex items-center gap-2 mb-4">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                i === step ? 'bg-primary text-primary-foreground' :
                i < step ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
              )}>
                {i < step ? <Check className="h-3 w-3" /> : <span>{i + 1}</span>}
                <span className="hidden sm:inline">{s}</span>
              </div>
              {i < STEPS.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </div>
          ))}
        </div>

        {/* Step 1 - Config */}
        {step === 0 && (
          <div className="space-y-5">
            <div>
              <Label>Nome da campanha *</Label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Ex: Lançamento do curso"
                disabled={isReadOnly}
              />
            </div>

            <div>
              <Label>Canal</Label>
              <div className="flex gap-3 mt-1.5">
                <button
                  onClick={() => setChannel('email')}
                  disabled={isReadOnly}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border-2 transition-colors disabled:cursor-not-allowed',
                    channel === 'email' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground',
                    !isReadOnly && channel !== 'email' && 'hover:border-muted-foreground/50',
                    isReadOnly && channel !== 'email' && 'opacity-50'
                  )}
                >
                  <Mail className="h-5 w-5" /> Email
                </button>
                <button
                  onClick={() => setChannel('whatsapp')}
                  disabled={isReadOnly}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border-2 transition-colors disabled:cursor-not-allowed',
                    channel === 'whatsapp' ? 'border-green-500 bg-green-500/10 text-green-400' : 'border-border text-muted-foreground',
                    !isReadOnly && channel !== 'whatsapp' && 'hover:border-muted-foreground/50',
                    isReadOnly && channel !== 'whatsapp' && 'opacity-50'
                  )}
                >
                  <MessageCircle className="h-5 w-5" /> WhatsApp
                </button>
              </div>
            </div>

            <div>
              <Label>Segmentos de destino</Label>
              <div className="mt-1.5">
                <SegmentMultiSelect
                  value={segmentIds}
                  onChange={setSegmentIds}
                  placeholder="Todos os contatos"
                  disabledIds={excludedSegmentIds}
                  disabled={isReadOnly}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                Somados, sem repetição. Vazio = todos os contatos.
              </p>
            </div>

            <div>
              <Label>Excluir contatos de (opcional)</Label>
              <div className="mt-1.5">
                <SegmentMultiSelect
                  value={excludedSegmentIds}
                  onChange={setExcludedSegmentIds}
                  placeholder="Nenhuma exclusão"
                  disabledIds={segmentIds}
                  disabled={isReadOnly}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                Quem estiver aqui não recebe, mesmo estando nos segmentos de destino.
              </p>
            </div>

            <Card>
              <CardContent className="py-3 px-4">
                {isReadOnly ? (
                  <>
                    <p className="text-sm font-medium">
                      {audienceCount} {audienceCount === 1 ? 'contato recebeu' : 'contatos receberam'} esta campanha
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Número real de envios. Os segmentos acima são os que foram configurados —
                      a composição deles pode ter mudado desde então.
                    </p>
                  </>
                ) : audienceLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-56" />
                    <Skeleton className="h-3 w-72" />
                  </div>
                ) : (
                  <>
                    <p className="text-sm font-medium">
                      {contactCount} {contactCount === 1 ? 'contato receberá' : 'contatos receberão'} esta campanha
                    </p>
                    {previewNames.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {previewNames.join(', ')}
                        {contactCount > previewNames.length && ` e mais ${contactCount - previewNames.length}`}
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            <div>
              <Label>Agendamento</Label>
              <div className="flex gap-3 mt-1.5">
                <button
                  onClick={() => setScheduleType('now')}
                  disabled={isReadOnly}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-lg border-2 text-sm disabled:cursor-not-allowed',
                    scheduleType === 'now' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground',
                    isReadOnly && scheduleType !== 'now' && 'opacity-50'
                  )}
                >
                  <Send className="h-4 w-4" /> {isReadOnly ? 'Envio imediato' : 'Enviar agora'}
                </button>
                <button
                  onClick={() => setScheduleType('later')}
                  disabled={isReadOnly}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-lg border-2 text-sm disabled:cursor-not-allowed',
                    scheduleType === 'later' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground',
                    isReadOnly && scheduleType !== 'later' && 'opacity-50'
                  )}
                >
                  <Clock className="h-4 w-4" /> Agendar
                </button>
              </div>
              {scheduleType === 'later' && (
                <Input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={e => setScheduledAt(e.target.value)}
                  disabled={isReadOnly}
                  className="mt-2"
                  // O valor digitado é lido como horário de Brasília (sem timezone), então o
                  // mínimo também precisa estar em Brasília — senão fica até 3h deslocado do
                  // "agora + 30min" real quando o navegador do admin não está em UTC-3.
                  min={formatInTimeZone(new Date(Date.now() + 30 * 60000), BRASILIA_TIMEZONE, "yyyy-MM-dd'T'HH:mm")}
                />
              )}
            </div>
          </div>
        )}

        {/* Step 2 - Content */}
        {step === 1 && (
          <div className="space-y-4">
            {channel === 'email' ? (
              <>
                {!isReadOnly && (
                <div>
                  <Label>Começar de um template</Label>
                  <Select
                    value={templateId}
                    onValueChange={(value) => {
                      if (value === 'none') {
                        setTemplateId(value);
                        return;
                      }
                      const t = templates.find(t => t.id === value);
                      if (!t || !t.design) {
                        setTemplateId(value);
                        return;
                      }
                      // Aplicar um template SEMPRE substitui todo o conteúdo do editor
                      // (loadDesign troca o design inteiro). Não dá para inferir se o
                      // admin já escreveu algo — o corpo do email vive dentro do iframe
                      // do Unlayer, e ele pode ter montado o email antes de preencher o
                      // assunto. Então confirmamos sempre que houver um editor vivo.
                      if (editorReady) {
                        setPendingTemplate(t);
                        return;
                      }
                      applyTemplate(t);
                    }}
                  >
                    <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhum (começar do zero)</SelectItem>
                      {templates.map(t => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                )}

                <div>
                  <div className="flex items-center justify-between">
                    <Label>Assunto do email {isReadOnly ? '' : '*'}</Label>
                    {!isReadOnly && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setSaveTemplateOpen(true)}
                        disabled={!editorReady}
                      >
                        Salvar como template
                      </Button>
                    )}
                  </div>
                  <Input
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                    placeholder="Ex: {{nome}}, confira esta novidade!"
                    className="mt-1"
                    disabled={isReadOnly}
                  />
                  {!isReadOnly && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Use {'{{nome}}'}, {'{{email}}'}, {'{{empresa}}'} como variáveis dinâmicas
                    </p>
                  )}
                </div>

                {/* Em consulta o Unlayer nem é montado: carregá-lo só para travá-lo
                    seria caro e ainda daria a impressão de que dá para editar. O que
                    interessa é o HTML que de fato foi enviado -- o mesmo visualizador
                    usado em /templates/:id/preview. */}
                {isReadOnly ? (
                  <div className="rounded-lg border bg-muted/20 p-4 flex justify-center" style={{ height: 520 }}>
                    <EmailTemplateFrame
                      html={emailHtml}
                      title="Conteúdo enviado"
                      viewport="desktop"
                      emptyLabel="Esta campanha não tem conteúdo salvo"
                    />
                  </div>
                ) : (
                  <div className="relative">
                    {editorLoading && (
                      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/80 rounded-lg">
                        <Skeleton className="w-full h-[520px] rounded-lg" />
                        <p className="text-sm text-muted-foreground">Carregando editor...</p>
                      </div>
                    )}
                    <div className="rounded-lg border overflow-hidden" style={{ minHeight: 520 }}>
                      {!socialLoading && (
                        <EmailEditor
                          ref={emailEditorRef}
                          minHeight="520px"
                          onReady={onEditorReady}
                          options={editorOptions}
                        />
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* WhatsApp editor - unchanged */
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  {!isReadOnly && (
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className="text-xs text-muted-foreground">Variáveis:</span>
                      {WA_VARIABLES.map(v => (
                        <Badge key={v} variant="outline" className="cursor-pointer hover:bg-primary/10" onClick={() => setWaBody(prev => prev + v)}>
                          {v}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <Label>{isReadOnly ? 'Mensagem' : `Mensagem * (${waBody.length}/1024)`}</Label>
                  <Textarea
                    value={waBody}
                    onChange={e => e.target.value.length <= 1024 && setWaBody(e.target.value)}
                    placeholder="Sua mensagem via WhatsApp"
                    className="min-h-[200px]"
                    readOnly={isReadOnly}
                  />
                  {!isReadOnly && (
                    <div className="mt-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-sm text-yellow-300 flex gap-2">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>Envie apenas para contatos que optaram por receber mensagens via WhatsApp. Mensagens não solicitadas podem resultar no bloqueio do número.</span>
                    </div>
                  )}
                </div>
                <div>
                  <Label>Preview</Label>
                  <div className="mt-1.5 rounded-xl p-4" style={{ backgroundColor: '#075E54' }}>
                    <div className="bg-white rounded-lg p-3 max-w-[80%] ml-auto relative">
                      <p className="text-sm text-gray-800 whitespace-pre-wrap">{previewWaText(waBody) || 'Mensagem...'}</p>
                      <div className="flex items-center justify-end gap-1 mt-1">
                        <span className="text-[10px] text-gray-400">{new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                        <svg className="h-3 w-3 text-blue-500" viewBox="0 0 16 15" fill="currentColor">
                          <path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.88 5.8 6.683a.365.365 0 0 0-.526-.033l-.423.39a.364.364 0 0 0-.034.526l3.533 3.886a.365.365 0 0 0 .543-.006l6.082-7.603a.364.364 0 0 0-.063-.51z" />
                          <path d="M12.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L5.666 9.88 2.8 6.683a.365.365 0 0 0-.526-.033l-.423.39a.364.364 0 0 0-.034.526l3.533 3.886a.365.365 0 0 0 .543-.006l6.082-7.603a.364.364 0 0 0-.063-.51z" />
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3 - Review */}
        {step === 2 && (
          <div className="space-y-4">
            <Card>
              <CardContent className="py-4 px-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Campanha</span>
                  <span className="font-medium">{name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Canal</span>
                  <Badge variant="outline" className="gap-1">
                    {channel === 'email' ? <><Mail className="h-3 w-3" /> Email</> : <><MessageCircle className="h-3 w-3" /> WhatsApp</>}
                  </Badge>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <span className="text-sm text-muted-foreground shrink-0">Segmentos</span>
                  <span className="font-medium text-right">
                    {segmentIds.length === 0 ? 'Todos os contatos' : `${segmentIds.length} de destino`}
                    {excludedSegmentIds.length > 0 && ` — exceto ${excludedSegmentIds.length}`}
                    {` (${audienceCount})`}
                  </span>
                </div>
                {channel === 'email' && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Assunto</span>
                    <span className="font-medium truncate max-w-[250px]">{subject}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Envio</span>
                  <span className="font-medium">
                    {isReadOnly
                      ? sentAtLabel
                      : isScheduled
                        ? (scheduledAt ? formatScheduleInput(scheduledAt) : 'Escolha data e hora')
                        : 'Agora'}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Email HTML Preview */}
            {channel === 'email' && emailHtml && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Badge variant="secondary">Preview do email</Badge>
                  {!isReadOnly && (
                    <Button variant="ghost" size="sm" onClick={() => setStep(1)} className="gap-1.5">
                      <Pencil className="h-3 w-3" /> Editar conteúdo
                    </Button>
                  )}
                </div>
                <div className="rounded-lg border bg-white overflow-hidden">
                  <iframe
                    srcDoc={emailHtml}
                    title="Email Preview"
                    className="w-full border-0"
                    style={{ height: 400 }}
                    sandbox="allow-same-origin"
                  />
                </div>
              </div>
            )}

            {/* WhatsApp Preview */}
            {channel === 'whatsapp' && (
              <div className="p-3 rounded-lg bg-muted/30 text-sm">
                <p className="text-muted-foreground">{waBody.slice(0, 100)}{waBody.length > 100 ? '...' : ''}</p>
              </div>
            )}

            <div className="p-4 rounded-lg bg-primary/5 border border-primary/20 text-sm">
              {isReadOnly ? (
                <p className="font-medium">
                  Esta campanha foi enviada para <span className="text-primary">{audienceCount} contatos</span>
                  {sentAtInstant && <> em <span className="text-primary">{sentAtLabel}</span></>}
                </p>
              ) : (
                <>
                  <p className="font-medium">
                    Esta campanha será enviada para <span className="text-primary">{contactCount} contatos</span>
                    {isScheduled && scheduledAt && (
                      <> em <span className="text-primary">{formatScheduleInput(scheduledAt)}</span></>
                    )}
                  </p>
                  {channel === 'email' && contactCount > 0 && (
                    <p className="text-muted-foreground mt-1">Tempo estimado: ~{Math.max(1, Math.ceil(contactCount / 60))} minutos</p>
                  )}
                </>
              )}
            </div>

            {!isReadOnly && (
              <Button
                size="lg"
                className="w-full bg-green-600 hover:bg-green-700 text-white"
                onClick={() => setConfirmOpen(true)}
                disabled={isScheduled && !scheduledAt}
              >
                {isEditing
                  ? <><Check className="h-4 w-4 mr-2" /> Salvar alterações</>
                  : isScheduled
                    ? <><Clock className="h-4 w-4 mr-2" /> Agendar campanha</>
                    : <><Send className="h-4 w-4 mr-2" /> Enviar campanha</>}
              </Button>
            )}
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between mt-4 pt-4 border-t">
          {step > 0 ? (
            <Button variant="outline" onClick={() => setStep(step - 1)}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Voltar
            </Button>
          ) : <div />}
          {step < 2 ? (
            <Button onClick={handleNext} disabled={!canNext()}>
              Próximo <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : isReadOnly ? (
            // Em consulta o botão verde de ação não existe, então o último step
            // ficaria sem nenhuma saída visível além do X do diálogo.
            <Button variant="outline" onClick={onClose}>Fechar</Button>
          ) : null}
        </div>

        {/* Confirm Dialog */}
        {/* Enquanto `sending`, ESC e clique-fora não fecham: fechar aqui devolveria o
            wizard atrás ao estado interativo no meio da criação da campanha -- o mesmo
            bug que o preventDefault abaixo corrige. Quem fecha é o handleSend. */}
        <AlertDialog open={confirmOpen} onOpenChange={(o) => { if (!sending) setConfirmOpen(o); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {isEditing ? 'Salvar alterações' : isScheduled ? 'Confirmar agendamento' : 'Confirmar envio'}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {isEditing
                  ? (isScheduled
                      ? `A campanha continua agendada e será enviada para ${contactCount} contatos em ${scheduledAt ? formatScheduleInput(scheduledAt) : ''}.`
                      : `A campanha continua como rascunho, com ${contactCount} contatos na audiência. Nada será enviado agora.`)
                  : isScheduled
                    ? `A campanha será enviada automaticamente para ${contactCount} contatos em ${scheduledAt ? formatScheduleInput(scheduledAt) : ''}. Você pode cancelar o agendamento até lá.`
                    : `Confirmar envio para ${contactCount} contatos via ${channel === 'email' ? 'email' : 'WhatsApp'}? Esta ação não pode ser desfeita.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={sending}>Cancelar</AlertDialogCancel>
              {/*
                e.preventDefault() é OBRIGATÓRIO aqui. AlertDialogAction é um primitivo
                de FECHAMENTO do Radix: sem preventDefault ele desmonta o AlertDialog no
                clique, enquanto handleSend (async) ainda está criando a campanha. O
                wizard, que estava atrás, virava a janela do topo e ficava interativo por
                vários segundos -- dava para clicar em "Agendar campanha" de novo e criar
                uma campanha DUPLICADA. E o spinner de `sending` abaixo nunca aparecia,
                porque o diálogo que o contém já tinha sumido.

                Com preventDefault o AlertDialog (modal) fica no ar durante todo o
                trabalho, bloqueando o wizard atrás dele e mostrando o progresso. Quem
                fecha os dois é o próprio handleSend, no fim -- inclusive em caso de erro,
                para o admin não perder o email que compôs.
              */}
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); handleSend(); }}
                disabled={sending}
                className="bg-green-600"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : (isScheduled ? <Clock className="h-4 w-4 mr-2" /> : <Send className="h-4 w-4 mr-2" />)}
                {sending
                  ? (isEditing ? 'Salvando…' : isScheduled ? 'Agendando…' : 'Enviando…')
                  : (isEditing ? 'Salvar alterações' : isScheduled ? 'Confirmar agendamento' : 'Confirmar envio')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Confirmação de sobrescrita do editor ao aplicar um template */}
        <AlertDialog open={!!pendingTemplate} onOpenChange={(o) => !o && setPendingTemplate(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Aplicar template?</AlertDialogTitle>
              <AlertDialogDescription>
                Aplicar este template vai substituir todo o conteúdo atual do editor. Deseja continuar?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => {
                if (pendingTemplate) applyTemplate(pendingTemplate);
                setPendingTemplate(null);
              }}>
                Aplicar template
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <SaveAsTemplateDialog
          open={saveTemplateOpen}
          onClose={() => setSaveTemplateOpen(false)}
          getContent={exportFromEditor}
        />
      </DialogContent>
    </Dialog>
  );
}
