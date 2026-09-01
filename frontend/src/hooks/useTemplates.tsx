import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
  criarTemplate,
  editarTemplate,
  excluirTemplate,
  lerTemplate,
  listarTemplates,
  type EmailTemplate,
  type EmailTemplateInput,
} from '@/lib/templates';

export type { EmailTemplate, EmailTemplateInput };

export function useTemplates() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      setTemplates(await listarTemplates());
    } catch {
      toast.error('Erro ao carregar templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const getTemplate = async (id: string): Promise<EmailTemplate | null> => {
    try {
      return await lerTemplate(id);
    } catch {
      return null;
    }
  };

  const createTemplate = async (data: EmailTemplateInput): Promise<EmailTemplate | null> => {
    try {
      return await criarTemplate(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao criar template');
      return null;
    }
  };

  const updateTemplate = async (id: string, data: Partial<EmailTemplateInput>): Promise<boolean> => {
    try {
      await editarTemplate(id, data);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar template');
      return false;
    }
  };

  const duplicateTemplate = async (template: EmailTemplate) => {
    const created = await createTemplate({
      name: template.name + ' (cópia)',
      description: template.description,
      category: template.category,
      design: template.design,
      html: template.html || '',
    });
    if (created) {
      toast.success('Template duplicado');
      fetchTemplates();
    }
  };

  const deleteTemplate = async (id: string) => {
    try {
      await excluirTemplate(id);
      toast.success('Template excluído');
      fetchTemplates();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao excluir template');
    }
  };

  return {
    templates,
    loading,
    refetch: fetchTemplates,
    getTemplate,
    createTemplate,
    updateTemplate,
    duplicateTemplate,
    deleteTemplate,
  };
}
