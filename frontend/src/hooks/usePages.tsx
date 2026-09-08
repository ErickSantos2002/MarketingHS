import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
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

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ['pages'] });
    queryClient.invalidateQueries({ queryKey: ['page-stats'] });
  };

  const { data: pages = [], isLoading, refetch } = useQuery({
    queryKey: ['pages'],
    queryFn: () => api.get<Page[]>('/paginas'),
  });

  // A tabela da tela mostra a view page_stats; a edição usa a linha cheia.
  // São duas formas diferentes, e por isso duas queries — era assim antes.
  const { data: pageStats = [] } = useQuery({
    queryKey: ['page-stats'],
    queryFn: () => api.get<PageStat[]>('/paginas/estatisticas'),
  });

  const createPage = useMutation({
    mutationFn: (pageData: PageFormData) => api.post<Page>('/paginas', pageData),
    onSuccess: () => {
      invalidar();
      toast.success('Página criada com sucesso!');
    },
    onError: (error: Error) => {
      toast.error(`Erro ao criar página: ${error.message}`);
    },
  });

  const updatePage = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<PageFormData> }) =>
      api.patch<Page>(`/paginas/${id}`, data),
    onSuccess: invalidar,
    onError: (error: Error) => {
      toast.error(`Erro ao atualizar página: ${error.message}`);
    },
  });

  const updatePageConfig = useMutation({
    mutationFn: ({ slug, config }: { slug: string; config: Record<string, any> }) =>
      api.patch<Page>(`/paginas/por-slug/${encodeURIComponent(slug)}/config`, config),
    onSuccess: invalidar,
  });

  const deletePage = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/paginas/${id}`),
    onSuccess: () => {
      invalidar();
      toast.success('Página excluída com sucesso!');
    },
    onError: (error: Error) => {
      toast.error(`Erro ao excluir página: ${error.message}`);
    },
  });

  // ⚠️ Recebe só o id: quem inverte o status é o banco, na mesma instrução do
  // UPDATE. Antes o valor novo era calculado aqui e mandado pronto, e duas
  // abas abertas mandavam o mesmo valor.
  const toggleStatus = useMutation({
    mutationFn: (id: string) => api.patch<{ status: string }>(`/paginas/${id}/status`),
    onSuccess: () => {
      invalidar();
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
