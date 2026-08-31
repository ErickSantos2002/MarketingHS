import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import { useTemplates } from '@/hooks/useTemplates';

interface SaveAsTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  // Chamado no momento da confirmação — o caller decide como extrair
  // html/design do SEU editor (CampaignWizard usa exportHtml+saveDesign do
  // ref do Unlayer que já mantém).
  getContent: () => Promise<{ html: string; design: any }>;
}

export function SaveAsTemplateDialog({ open, onClose, getContent }: SaveAsTemplateDialogProps) {
  const { createTemplate } = useTemplates();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const { html, design } = await getContent();
    const created = await createTemplate({
      name: name.trim(),
      description: description.trim() || null,
      category: category.trim() || null,
      design,
      html,
    });
    setSaving(false);
    if (created) {
      setName('');
      setDescription('');
      setCategory('');
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Salvar como template</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Nome *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Newsletter mensal" />
          </div>
          <div>
            <Label>Categoria</Label>
            <Input value={category} onChange={e => setCategory(e.target.value)} placeholder="Ex: Newsletter, Promoção, Evento" />
          </div>
          <div>
            <Label>Descrição</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Quando usar este template" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
