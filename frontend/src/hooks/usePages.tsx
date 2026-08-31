import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface PageStat {
  id: string;
  name: string;
  slug: string;
  status: string | null;
  page_type: string;
  config: Record<string, any>;
  template_base: string | null;
  created_at: string | null;
  updated_at: string | null;
  total_leads: number;
  hot_leads: number;
  last_lead_at: string | null;
}

export interface Page {
  id: string;
  name: string;
  slug: string;
  component_name: string;
  page_type: 'landing' | 'thankyou' | 'form' | 'admin';
  status: 'active' | 'draft' | 'inactive';
  description: string | null;
  webhook_url: string | null;
  whatsapp_group_url: string | null;
  meta_title: string | null;
  meta_description: string | null;
  config: Record<string, any>;
  template_base: string | null;
  created_at: string;
  updated_at: string;
}

export interface PageFormData {
  name: string;
  slug: string;
  component_name: string;
  page_type: 'landing' | 'thankyou' | 'form' | 'admin';
  status: 'active' | 'draft' | 'inactive';
  description?: string;
  webhook_url?: string;
  whatsapp_group_url?: string;
  meta_title?: string;
  meta_description?: string;
  config?: Record<string, any>;
  template_base?: string;
}

export function usePages() {
  const queryClient = useQueryClient();

  const { data: pages = [], isLoading, refetch } = useQuery({
    queryKey: ['pages'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pages')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data as Page[];
    },
  });

  // Page stats from the view (via RPC since views aren't in types)
  const { data: pageStats = [] } = useQuery({
    queryKey: ['page-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('execute_readonly_query', {
          query_text: `SELECT id, slug, name, status, config, template_base, page_type, created_at, updated_at, total_leads, hot_leads, last_lead_at FROM page_stats ORDER BY created_at ASC`
        });
      if (error) throw error;
      return (data as unknown as PageStat[] | null) || [];
    },
  });

  const createPage = useMutation({
    mutationFn: async (pageData: PageFormData) => {
      const { data, error } = await supabase
        .from('pages')
        .insert([pageData])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pages'] });
      queryClient.invalidateQueries({ queryKey: ['page-stats'] });
      toast.success('Página criada com sucesso!');
    },
    onError: (error: Error) => {
      toast.error(`Erro ao criar página: ${error.message}`);
    },
  });

  const updatePage = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<PageFormData> }) => {
      const { data: result, error } = await supabase
        .from('pages')
        .update(data)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pages'] });
      queryClient.invalidateQueries({ queryKey: ['page-stats'] });
    },
    onError: (error: Error) => {
      toast.error(`Erro ao atualizar página: ${error.message}`);
    },
  });

  const updatePageConfig = useMutation({
    mutationFn: async ({ slug, config }: { slug: string; config: Record<string, any> }) => {
      const { error } = await supabase
        .from('pages')
        .update({ config } as any)
        .eq('slug', slug);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pages'] });
      queryClient.invalidateQueries({ queryKey: ['page-stats'] });
    },
  });

  const deletePage = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('pages')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pages'] });
      queryClient.invalidateQueries({ queryKey: ['page-stats'] });
      toast.success('Página excluída com sucesso!');
    },
    onError: (error: Error) => {
      toast.error(`Erro ao excluir página: ${error.message}`);
    },
  });

  const toggleStatus = useMutation({
    mutationFn: async ({ id, currentStatus }: { id: string; currentStatus: string }) => {
      const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
      const { error } = await supabase
        .from('pages')
        .update({ status: newStatus })
        .eq('id', id);

      if (error) throw error;
      return newStatus;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pages'] });
      queryClient.invalidateQueries({ queryKey: ['page-stats'] });
      toast.success('Status alterado com sucesso!');
    },
    onError: (error: Error) => {
      toast.error(`Erro ao alterar status: ${error.message}`);
    },
  });

  return {
    pages,
    pageStats,
    isLoading,
    refetch,
    createPage,
    updatePage,
    updatePageConfig,
    deletePage,
    toggleStatus,
  };
}
