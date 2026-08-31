import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// `email_templates` ainda não está em src/integrations/supabase/types.ts
// (migration nova, ver Task 4.1 passo 3) — `.from('email_templates' as any)`
// é o workaround já sancionado no projeto para esse cenário (mesmo usado
// para `campaigns`, `campaign_sends` etc. em useCampaigns.tsx).

export interface EmailTemplate {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  design: any;
  html: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailTemplateInput {
  name: string;
  description: string | null;
  category: string | null;
  design: any;
  html: string;
}

export function useTemplates() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('email_templates' as any)
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      toast.error('Erro ao carregar templates');
      setLoading(false);
      return;
    }

    setTemplates((data || []) as any as EmailTemplate[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const getTemplate = async (id: string): Promise<EmailTemplate | null> => {
    const { data, error } = await supabase
      .from('email_templates' as any)
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !data) return null;
    return data as any as EmailTemplate;
  };

  const createTemplate = async (data: EmailTemplateInput): Promise<EmailTemplate | null> => {
    const { data: result, error } = await supabase
      .from('email_templates' as any)
      .insert(data as any)
      .select()
      .single();

    if (error) {
      toast.error('Erro ao criar template');
      return null;
    }
    return result as any as EmailTemplate;
  };

  const updateTemplate = async (id: string, data: Partial<EmailTemplateInput>): Promise<boolean> => {
    const { error } = await supabase
      .from('email_templates' as any)
      .update(data as any)
      .eq('id', id);

    if (error) {
      toast.error('Erro ao salvar template');
      return false;
    }
    return true;
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
    const { error } = await supabase
      .from('email_templates' as any)
      .delete()
      .eq('id', id);

    if (error) {
      toast.error('Erro ao excluir template');
      return;
    }
    toast.success('Template excluído');
    fetchTemplates();
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
