import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Save, CheckCircle, Loader2, Layout, Eye, EyeOff, Activity, ImageUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { usePages } from '@/hooks/usePages';
import { caminhoDaLanding } from '@/lib/landing';
import { toast } from 'sonner';
import { COR_CTA_PADRAO } from '@/landing/padroes';
import {
  camposDaConfig, camposParaGravar, textoDoConsentimentoParaGravar,
  type CampoDaPagina, type ConsentimentoDaPagina,
} from '@/landing/campos';
import { BASE, ErroApi } from '@/lib/api';
import { subirImagemDeEmail } from '@/lib/config';
import { CamposEditor } from './CamposEditor';

// ⚠️ O chip "Obrigado padrão" (/obrigado) saiu em 21/10: essa rota não
// existe, e a página caía no 404 depois de captar. Sem redirect, a landing
// mostra a mensagem de obrigado na própria página (bloco abaixo).
const REDIRECT_CHIPS = [
  { label: 'WhatsApp', value: 'https://wa.me/5531...' },
  { label: 'Hotmart', value: 'https://hotmart.com/...' },
];

// O bloco que nasce quando se liga o consentimento — os valores da prova de
// substituição do RD (plano, Global Constraints). Versão provisória enquanto
// o D3 (texto jurídico) não fecha.
const CONSENTIMENTO_PADRAO: ConsentimentoDaPagina = {
  texto: 'Concordo em receber contato da Health & Safety sobre este pedido e com o tratamento dos meus dados conforme a Política de Privacidade.',
  link: 'https://www.healthsafety.com.br/privacidade.cfm',
  versao: 'provisoria-2026-10',
  provisoria: true,
  obrigatorio: true,
};

// O upload devolve o caminho do backend (/publico/imagem/<id>); no navegador
// do admin ele só existe atrás de /api, como na landing.
const enderecoDaImagem = (url: string) => (url.startsWith('/publico/') ? `${BASE}${url}` : url);

// O texto do consentimento nunca é gravado vazio: com a caixa apagada, a
// config fica com o texto anterior (ou o padrão) até a pessoa digitar outro.
// O rascunho fica local para a caixa poder ficar vazia enquanto se digita.
function TextoDoConsentimento({ texto, onChange }: { texto: string; onChange: (t: string) => void }) {
  const [rascunho, setRascunho] = useState(texto);
  useEffect(() => {
    if (rascunho.trim() && rascunho !== texto) setRascunho(texto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);
  return (
    <>
      <Textarea
        id="consentimento-texto"
        rows={3}
        value={rascunho}
        onChange={(e) => {
          setRascunho(e.target.value);
          const gravar = textoDoConsentimentoParaGravar(e.target.value, texto);
          if (gravar !== texto) onChange(gravar);
        }}
      />
      {!rascunho.trim() && (
        <p className="text-xs text-[--on-tint-danger]">
          Texto vazio não é gravado: a página segue com “{texto}”.
        </p>
      )}
    </>
  );
}

// Tags separadas por vírgula. O texto cru fica local para a vírgula recém
// digitada não sumir; o que vai para a config é a lista aparada.
function CampoDeTags({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [texto, setTexto] = useState(tags.join(', '));
  useEffect(() => {
    const atual = texto.split(',').map((t) => t.trim()).filter(Boolean);
    if (atual.join(',') !== tags.join(',')) setTexto(tags.join(', '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tags.join(',')]);
  return (
    <Input
      id="pagina-tags"
      value={texto}
      onChange={(e) => {
        setTexto(e.target.value);
        onChange(Array.from(new Set(e.target.value.split(',').map((t) => t.trim()).filter(Boolean))));
      }}
      placeholder="prova-rd, phoebus"
    />
  );
}

export default function PageConfigEditor() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { pages, updatePage, toggleStatus } = usePages();

  const page = pages.find((p) => p.slug === slug);

  // ⚠️ O remix decidia a prévia por uma lista fixa de slugs — as rotas das
  // landings da dn.ia dentro deste SPA, apagadas no lote 0. Aqui toda página
  // tem landing em `/p/{slug}` (o motor de template do subprojeto A), e a
  // casca só serve página ATIVA: rascunho e inativa dão 404. Por isso a regra
  // da prévia é a mesma da casca, não uma lista.
  const hasRoute = page?.status === 'active';
  
  const [config, setConfig] = useState<Record<string, any>>({});
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [publishDialog, setPublishDialog] = useState<'publish' | 'unpublish' | null>(null);
  const [showEventKey, setShowEventKey] = useState(false);
  const [showUserKey, setShowUserKey] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (page) {
      setConfig((page as any).config || {});
    }
  }, [page?.id]);

  const saveConfig = useCallback(async (newConfig: Record<string, any>) => {
    if (!page) return;
    setSaveState('saving');
    try {
      await updatePage.mutateAsync({ id: page.id, data: { config: newConfig } as any });
      setSaveState('saved');
      // Refresh iframe after save
      setTimeout(() => {
        if (iframeRef.current) {
          iframeRef.current.src = iframeRef.current.src;
        }
      }, 1500);
    } catch {
      setSaveState('unsaved');
      toast.error('Erro ao salvar configurações');
    }
  }, [page, updatePage]);

  const updateField = useCallback((key: string, value: any) => {
    setConfig((prev) => {
      const next = { ...prev, [key]: value };
      setSaveState('unsaved');
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => saveConfig(next), 1200);
      return next;
    });
  }, [saveConfig]);

  const handleManualSave = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    saveConfig(config);
  };

  const handlePublishToggle = () => {
    if (!page) return;
    if (page.status === 'active') {
      setPublishDialog('unpublish');
    } else {
      setPublishDialog('publish');
    }
  };

  const confirmPublish = () => {
    if (!page) return;
    toggleStatus.mutate(page.id);
    setPublishDialog(null);
  };


  const clarity = config.clarity || {};
  const clarityIdValid = /^[a-z0-9]{6,20}$/i.test((clarity.project_id || '').trim());
  const updateClarity = (key: string, value: any) => {
    const next = { ...clarity, [key]: value };
    // Se limpou o código, força desativar
    if (key === 'project_id' && !/^[a-z0-9]{6,20}$/i.test((value || '').trim())) {
      next.enabled = false;
    }
    updateField('clarity', next);
  };

  // Página antiga (só `visible_fields`) aparece convertida; a conversão só é
  // gravada na primeira edição dos campos. Com `campos` gravado, o editor
  // mostra a lista crua — inclusive a linha que ainda está sendo preenchida,
  // que `camposDaConfig` descartaria.
  const campos: CampoDaPagina[] = Array.isArray(config.campos) && config.campos.length
    ? config.campos
    : camposDaConfig(config);
  // Bloco gravado com texto vazio (de antes desta regra) aparece com o padrão,
  // que é o que a landing mostra nesse caso.
  const consentimento: ConsentimentoDaPagina | null = config.consentimento
    ? { ...config.consentimento, texto: textoDoConsentimentoParaGravar(config.consentimento.texto, '') }
    : null;
  const updateConsentimento = (parcial: Partial<ConsentimentoDaPagina>) =>
    updateField('consentimento', { ...CONSENTIMENTO_PADRAO, ...(consentimento ?? {}), ...parcial });
  const whatsapp = config.whatsapp || { numero: '', mensagem: '' };
  const [subindoImagem, setSubindoImagem] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);

  const subirImagem = async (arquivo: File) => {
    setSubindoImagem(true);
    try {
      const { url } = await subirImagemDeEmail(arquivo, 'campaigns');
      updateField('imagem_url', url);
    } catch (e) {
      toast.error(e instanceof ErroApi ? e.message : 'Erro ao subir a imagem');
    } finally {
      setSubindoImagem(false);
      if (arquivoRef.current) arquivoRef.current.value = '';
    }
  };

  if (!page && pages.length > 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Página não encontrada
        <Button variant="link" onClick={() => navigate('/pages')}>Voltar</Button>
      </div>
    );
  }

  if (!page) {
    return (
      <div className="p-8 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/pages')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-lg font-semibold">{page.name}</h2>
            <code className="text-xs text-muted-foreground font-mono">/{page.slug}</code>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saveState === 'saved' && (
            <Badge variant="success" className="gap-1">
              <CheckCircle className="h-3 w-3" /> Salvo
            </Badge>
          )}
          {saveState === 'saving' && (
            <Badge variant="secondary" className="gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Salvando...
            </Badge>
          )}
          {saveState === 'unsaved' && (
            <Badge variant="outline" className="gap-1">Alterações pendentes</Badge>
          )}
          <Button variant="outline" size="sm" onClick={handleManualSave}>
            <Save className="h-4 w-4 mr-1" /> Salvar
          </Button>
        </div>
      </div>

      {/* Two Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-[55%_45%] gap-6">
        {/* Left - Form */}
        <div className="space-y-6">
          {/* Conteúdo principal */}
          <section className="border rounded-lg p-4 space-y-4">
            <h3 className="font-medium text-sm">Conteúdo principal</h3>
            <div className="space-y-2">
              <Label>Headline</Label>
              <Textarea rows={2} value={config.headline || ''} onChange={(e) => updateField('headline', e.target.value)} placeholder="Texto principal da página" />
            </div>
            <div className="space-y-2">
              <Label>Subheadline</Label>
              <Textarea rows={2} value={config.subheadline || ''} onChange={(e) => updateField('subheadline', e.target.value)} placeholder="Texto secundário" />
            </div>
            <div className="space-y-2">
              <Label>Texto do CTA</Label>
              <Input value={config.cta_text || ''} onChange={(e) => updateField('cta_text', e.target.value)} placeholder="QUERO PARTICIPAR" />
            </div>
            <div className="space-y-2">
              <Label>Cor do CTA</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={config.cta_color || COR_CTA_PADRAO}
                  onChange={(e) => updateField('cta_color', e.target.value)}
                  className="h-9 w-12 rounded border cursor-pointer"
                />
                <Input
                  value={config.cta_color || COR_CTA_PADRAO}
                  onChange={(e) => updateField('cta_color', e.target.value)}
                  className="w-28 font-mono text-sm"
                />
              </div>
            </div>
          </section>

          {/* Corpo e imagem */}
          <section className="border rounded-lg p-4 space-y-4">
            <h3 className="font-medium text-sm">Texto e imagem</h3>
            <div className="space-y-2">
              <Label htmlFor="pagina-corpo">Texto da página</Label>
              <Textarea
                id="pagina-corpo"
                rows={6}
                value={config.corpo || ''}
                onChange={(e) => updateField('corpo', e.target.value)}
                placeholder={'Um parágrafo por bloco, separados por linha em branco.\n\n- Linha começando com "- " vira item de lista'}
              />
              <p className="text-xs text-muted-foreground">
                Texto puro: parágrafos separados por linha em branco; linha que começa com
                “- ” vira item de lista. HTML não é interpretado.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pagina-imagem">Imagem de destaque</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="pagina-imagem"
                  value={config.imagem_url || ''}
                  onChange={(e) => updateField('imagem_url', e.target.value)}
                  placeholder="https://… ou suba um arquivo"
                  className="flex-1 min-w-48"
                />
                <input
                  ref={arquivoRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) subirImagem(f); }}
                />
                <Button type="button" variant="outline" size="sm" disabled={subindoImagem}
                        onClick={() => arquivoRef.current?.click()}>
                  {subindoImagem ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ImageUp className="h-4 w-4 mr-1" />}
                  Subir imagem
                </Button>
                {config.imagem_url && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => updateField('imagem_url', '')}>
                    Tirar
                  </Button>
                )}
              </div>
              {config.imagem_url && (
                <img
                  src={enderecoDaImagem(config.imagem_url)}
                  alt="Prévia da imagem de destaque"
                  className="max-h-40 rounded-lg border border-borda object-contain"
                />
              )}
              <p className="text-xs text-muted-foreground">
                O texto alternativo da imagem é a headline. PNG, JPEG, GIF ou WebP.
              </p>
            </div>
          </section>

          {/* Formulário */}
          <section className="border rounded-lg p-4 space-y-4">
            <div>
              <h3 className="font-medium text-sm">Campos do formulário</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Campo personalizado vai para os dados personalizados do contato e pode ser usado
                em segmento e em condição de jornada. O servidor valida obrigatório e formato.
              </p>
            </div>
            <CamposEditor campos={campos} onChange={(c) => updateField('campos', camposParaGravar(c))} />
          </section>

          {/* Consentimento */}
          <section className="border rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-medium text-sm">Consentimento (LGPD)</h3>
              <div className="flex items-center gap-2">
                <Label htmlFor="consentimento-ligado" className="text-xs text-muted-foreground">
                  {consentimento ? 'Pedido no formulário' : 'Não pedido'}
                </Label>
                <Switch
                  id="consentimento-ligado"
                  checked={!!consentimento}
                  onCheckedChange={(v) => updateField('consentimento', v ? { ...CONSENTIMENTO_PADRAO } : undefined)}
                />
              </div>
            </div>
            {consentimento ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="consentimento-texto">Texto ao lado da caixa</Label>
                  <TextoDoConsentimento
                    texto={consentimento.texto}
                    onChange={(t) => updateConsentimento({ texto: t })}
                  />
                  <p className="text-xs text-muted-foreground">
                    A caixa nasce desmarcada. É este texto, com a versão, que fica gravado em cada
                    conversão — o navegador só diz se a pessoa aceitou.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="consentimento-link">Link da política</Label>
                    <Input id="consentimento-link" value={consentimento.link}
                           onChange={(e) => updateConsentimento({ link: e.target.value })}
                           placeholder="https://…" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="consentimento-versao">Versão do texto</Label>
                    <Input id="consentimento-versao" value={consentimento.versao}
                           onChange={(e) => updateConsentimento({ versao: e.target.value })}
                           className="font-mono text-xs" />
                  </div>
                </div>
                <div className="flex flex-wrap gap-6">
                  <div className="flex items-center gap-2">
                    <Switch id="consentimento-obrigatorio" checked={consentimento.obrigatorio !== false}
                            onCheckedChange={(v) => updateConsentimento({ obrigatorio: v })} />
                    <Label htmlFor="consentimento-obrigatorio" className="text-xs">Obrigatório para enviar</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id="consentimento-provisoria" checked={!!consentimento.provisoria}
                            onCheckedChange={(v) => updateConsentimento({ provisoria: v })} />
                    <Label htmlFor="consentimento-provisoria" className="text-xs">Texto provisório</Label>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Sem consentimento, o formulário capta sem caixa de aceite e nada é registrado como
                consentimento.
              </p>
            )}
          </section>

          {/* Depois do envio */}
          <section className="border rounded-lg p-4 space-y-4">
            <h3 className="font-medium text-sm">Depois do envio</h3>
            <div className="space-y-2">
              <Label htmlFor="pagina-obrigado">Mensagem de obrigado</Label>
              <Textarea
                id="pagina-obrigado"
                rows={3}
                value={config.mensagem_obrigado || ''}
                onChange={(e) => updateField('mensagem_obrigado', e.target.value)}
                placeholder="Recebemos seus dados. Em breve alguém da Health & Safety entra em contato."
              />
              <p className="text-xs text-muted-foreground">
                Mostrada na própria página quando não há URL de redirect.
              </p>
            </div>
          </section>

          {/* Redirecionamento */}
          <section className="border rounded-lg p-4 space-y-4">
            <h3 className="font-medium text-sm">Redirecionamento</h3>
            <div className="space-y-2">
              <Label>URL de redirect após conversão</Label>
              <Input
                value={config.redirect_url || ''}
                onChange={(e) => updateField('redirect_url', e.target.value)}
                placeholder="https://wa.me/5531..."
              />
              <div className="flex gap-1">
                {REDIRECT_CHIPS.map((chip) => (
                  <Badge
                    key={chip.label}
                    variant="outline"
                    className="cursor-pointer hover:bg-surface-elevated text-xs"
                    onClick={() => updateField('redirect_url', chip.value)}
                  >
                    {chip.label}
                  </Badge>
                ))}
              </div>
            </div>
          </section>

          {/* ⚠️ A seção do dn.ticket saiu no lote 5D. Ticketia é o sistema de
              ingresso da dn.ia e a spec o DESCARTA (seção 9, travas de
              terceiro) — a HS não tem equivalente. A tela oferecia configurar e
              "Testar conexão" numa integração que não existe mais: campo para
              preencher, botão para clicar, e uma function morta do outro lado. */}
          {/* Integração Microsoft Clarity */}
          <section className="border rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-sm flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Integração{' '}
                <a
                  href="https://clarity.microsoft.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Microsoft Clarity
                </a>
              </h3>
              <div className="flex items-center gap-2">
                <Label htmlFor="clarity-enabled" className="text-xs text-muted-foreground">
                  {clarity.enabled ? 'Ativada' : 'Desativada'}
                </Label>
                <Switch
                  id="clarity-enabled"
                  checked={!!clarity.enabled}
                  disabled={!clarityIdValid}
                  onCheckedChange={(v) => updateClarity('enabled', v)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Quando ativa, o script oficial do Clarity é injetado automaticamente no <code className="bg-muted px-1 rounded">&lt;head&gt;</code> desta página, usando o código informado abaixo. Encontre o código no painel do Clarity em <em>Settings → Setup</em>.
            </p>
            <div className="space-y-2">
              <Label className="text-xs">Project ID (código personalizado)</Label>
              <Input
                value={clarity.project_id || ''}
                onChange={(e) => updateClarity('project_id', e.target.value.trim())}
                placeholder="wq39c9c11g"
                className="font-mono text-xs"
              />
              {!clarityIdValid && (clarity.project_id || '').length > 0 && (
                <p className="text-xs text-[--on-tint-danger]">
                  Código inválido. Use entre 6 e 20 caracteres alfanuméricos.
                </p>
              )}
              {!clarityIdValid && !(clarity.project_id || '').length && (
                <p className="text-xs text-muted-foreground">
                  Informe um código válido para poder ativar a integração.
                </p>
              )}
            </div>
          </section>

          {/* SEO */}
          <section className="border rounded-lg p-4 space-y-4">
            <h3 className="font-medium text-sm">SEO</h3>
            <div className="space-y-2">
              <Label>Meta title</Label>
              <Input value={config.meta_title || ''} onChange={(e) => updateField('meta_title', e.target.value)} placeholder="Título para SEO" />
            </div>
            <div className="space-y-2">
              <Label>Meta description</Label>
              <Textarea rows={2} value={config.meta_description || ''} onChange={(e) => updateField('meta_description', e.target.value)} placeholder="Descrição para SEO" />
            </div>
            <div className="flex items-center gap-2">
              <Switch id="pagina-noindex" checked={!!config.noindex}
                      onCheckedChange={(v) => updateField('noindex', v)} />
              <Label htmlFor="pagina-noindex" className="text-sm">Esconder dos buscadores (noindex)</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              noindex tira a página do Google, mas não impede acesso: quem tem o link abre.
            </p>
          </section>

          {/* WhatsApp */}
          <section className="border rounded-lg p-4 space-y-4">
            <h3 className="font-medium text-sm">Botão de WhatsApp</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="whatsapp-numero">Número (com DDI e DDD)</Label>
                <Input
                  id="whatsapp-numero"
                  inputMode="tel"
                  value={whatsapp.numero || ''}
                  onChange={(e) => updateField('whatsapp', { ...whatsapp, numero: e.target.value.replace(/\D/g, '') })}
                  placeholder="5531999999999"
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="whatsapp-mensagem">Mensagem inicial</Label>
                <Input
                  id="whatsapp-mensagem"
                  value={whatsapp.mensagem || ''}
                  onChange={(e) => updateField('whatsapp', { ...whatsapp, mensagem: e.target.value })}
                  placeholder="Olá! Quero saber do Phoebus."
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Sem número, o botão flutuante não aparece.
            </p>
          </section>

          {/* Tags */}
          <section className="border rounded-lg p-4 space-y-4">
            <h3 className="font-medium text-sm">Tags na captura</h3>
            <div className="space-y-2">
              <Label htmlFor="pagina-tags">Tags aplicadas a quem converte (separadas por vírgula)</Label>
              <CampoDeTags tags={Array.isArray(config.tags) ? config.tags : []}
                           onChange={(t) => updateField('tags', t)} />
              <p className="text-xs text-muted-foreground">
                Além da tag do slug, que toda captura já recebe.
              </p>
            </div>
          </section>
        </div>

        {/* Right - Preview */}
        <div className="space-y-3 lg:sticky lg:top-4">
          <div className="relative border rounded-lg overflow-hidden bg-muted/20">
            <Badge variant="warning" className="absolute top-2 left-2 z-10">PREVIEW</Badge>
            {hasRoute ? (
              <iframe
                ref={iframeRef}
                src={`${caminhoDaLanding(page.slug)}?previa=1`}
                className="w-full border-0"
                style={{ height: '520px' }}
                title="Preview"
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-center px-6" style={{ height: '520px' }}>
                <Layout className="h-12 w-12 text-muted-foreground/40 mb-3" />
                <p className="text-sm font-medium">Preview indisponível</p>
                <p className="text-xs text-muted-foreground mt-1">
                  A landing <code className="bg-muted px-1 rounded">{caminhoDaLanding(page.slug)}</code> só
                  é servida com a página ativa. Publique para ver o preview.
                </p>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => window.open(caminhoDaLanding(page.slug), '_blank')}>
              <ExternalLink className="h-4 w-4 mr-1" /> Abrir em nova aba
            </Button>
            <Button
              variant={page.status === 'active' ? 'destructive' : 'default'}
              size="sm"
              onClick={handlePublishToggle}
            >
              {page.status === 'active' ? 'Despublicar' : 'Publicar'}
            </Button>
          </div>
        </div>
      </div>

      {/* Publish/Unpublish Dialog */}
      <AlertDialog open={!!publishDialog} onOpenChange={() => setPublishDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {publishDialog === 'publish' ? 'Publicar página?' : 'Despublicar página?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {publishDialog === 'publish'
                ? 'A página ficará acessível publicamente.'
                : 'A página será removida do ar.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPublish}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
