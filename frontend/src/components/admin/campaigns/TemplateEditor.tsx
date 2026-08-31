import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import EmailEditor, { type EditorRef } from 'react-email-editor';
import { toast } from 'sonner';
import { useTemplates } from '@/hooks/useTemplates';
import { useSocialLinks } from '@/hooks/useSocialLinks';
import { BASE_EMAIL_DESIGN, buildEmailEditorOptions, registerEmailImageUpload } from './emailEditorConfig';

export default function TemplateEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = !id;
  const { getTemplate, createTemplate, updateTemplate, refetch } = useTemplates();
  // Ver buildEmailEditorOptions: o pre-preenchimento do bloco social so vale se
  // as options ja estiverem prontas quando o editor inicializa.
  const { config: socialConfig, loading: socialLoading } = useSocialLinks();
  const editorOptions = useMemo(() => buildEmailEditorOptions(socialConfig), [socialConfig]);

  const emailEditorRef = useRef<EditorRef>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [editorLoading, setEditorLoading] = useState(true);
  const [initialDesign, setInitialDesign] = useState<any>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');

  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    (async () => {
      const t = await getTemplate(id!);
      if (cancelled) return;
      if (!t) {
        toast.error('Template não encontrado');
        navigate('/templates');
        return;
      }
      setName(t.name);
      setDescription(t.description || '');
      setCategory(t.category || '');
      setInitialDesign(t.design || BASE_EMAIL_DESIGN);
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // O editor só é montado depois que `loading` vira false (ver JSX abaixo),
  // então quando onEditorReady dispara `initialDesign` já está resolvido —
  // sem essa guarda haveria uma corrida entre o fetch do template e o
  // primeiro loadDesign() do Unlayer.
  const onEditorReady = useCallback((unlayer: any) => {
    setEditorReady(true);
    setEditorLoading(false);
    registerEmailImageUpload(unlayer, 'templates');
    unlayer.loadDesign(initialDesign || BASE_EMAIL_DESIGN);
  }, [initialDesign]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Dê um nome ao template');
      return;
    }
    const editor = emailEditorRef.current?.editor;
    if (!editor) return;

    setSaving(true);
    editor.exportHtml(async (htmlData: any) => {
      editor.saveDesign(async (design: any) => {
        const payload = {
          name: name.trim(),
          description: description.trim() || null,
          category: category.trim() || null,
          design,
          html: htmlData.html,
        };

        if (isNew) {
          const created = await createTemplate(payload);
          setSaving(false);
          if (created) {
            toast.success('Template criado');
            navigate(`/templates/${created.id}/edit`, { replace: true });
          }
        } else {
          const success = await updateTemplate(id!, payload);
          setSaving(false);
          if (success) {
            // updateTemplate não refaz o fetch da lista (ver hook useTemplates)
            // — sem este refetch(), a lista em /templates ficaria com o
            // preview/nome antigo até um reload manual da página.
            await refetch();
            toast.success('Template salvo');
          }
        }
      });
    });
  };

  if (loading || socialLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[600px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <Button variant="ghost" onClick={() => navigate('/templates')} className="gap-1.5 shrink-0">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Button>
        <Button onClick={handleSave} disabled={saving || !editorReady} className="gap-1.5 shrink-0">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar template
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <Label>Nome *</Label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Newsletter mensal" />
        </div>
        <div>
          <Label>Categoria</Label>
          <Input value={category} onChange={e => setCategory(e.target.value)} placeholder="Ex: Newsletter, Promoção" />
        </div>
        <div>
          <Label>Descrição</Label>
          <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Quando usar este template" />
        </div>
      </div>

      <div className="relative">
        {editorLoading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/80 rounded-lg">
            <Skeleton className="w-full h-[600px] rounded-lg" />
            <p className="text-sm text-muted-foreground">Carregando editor...</p>
          </div>
        )}
        <div className="rounded-lg border overflow-hidden" style={{ minHeight: 600 }}>
          <EmailEditor
            ref={emailEditorRef}
            minHeight="600px"
            onReady={onEditorReady}
            options={editorOptions}
          />
        </div>
      </div>
    </div>
  );
}
