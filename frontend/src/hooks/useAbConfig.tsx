import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { normalizeProductionDomain } from "@/lib/abConfig";

export interface AbConfig {
  production_domain: string | null;
  redirector_base: string | null;
}

// Configuração compartilhada do módulo A/B (linha única em `ab_config`): o
// domínio de produção, que valida as URLs de variante, e o redirecionador,
// que monta os links. Vazio = não configurado — a tela manda configurar.
export function useAbConfig() {
  const qc = useQueryClient();
  const consulta = useQuery({
    queryKey: ["ab_config"],
    queryFn: () => api.get<AbConfig>("/ab/config"),
  });
  const gravar = useMutation({
    mutationFn: (patch: Partial<AbConfig>) => api.put<AbConfig>("/ab/config", patch),
    onSuccess: (dados) => qc.setQueryData(["ab_config"], dados),
  });

  // Devolve o domínio normalizado quando salva (para a tela sincronizar só
  // este campo, sem mexer no do redirecionador — ver M6 no 8C).
  const save = async (domain: string): Promise<string | null> => {
    const clean = normalizeProductionDomain(domain);
    if (!clean) {
      toast.error("Informe um domínio válido (ex.: exemplo.com.br).");
      return null;
    }
    try {
      await gravar.mutateAsync({ production_domain: clean });
      toast.success("Domínio de produção salvo.");
      return clean;
    } catch (e) {
      toast.error("Erro ao salvar o domínio de produção: " + (e as Error).message);
      return null;
    }
  };

  const saveRedirector = async (base: string): Promise<boolean> => {
    try {
      await gravar.mutateAsync({ redirector_base: base || null });
      toast.success("Redirecionador salvo.");
      return true;
    } catch (e) {
      toast.error("Erro ao salvar o redirecionador: " + (e as Error).message);
      return false;
    }
  };

  return {
    productionDomain: consulta.data?.production_domain ?? "",
    redirectorBase: consulta.data?.redirector_base ?? null,
    loading: consulta.isLoading,
    saving: gravar.isPending,
    save,
    saveRedirector,
    refetch: consulta.refetch,
  };
}
