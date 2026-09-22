// O handoff ao GrowthHS visto das telas que NÃO são a de configuração:
// Automações, o nó "Enviar ao GrowthHS" e o botão "Enviar ao comercial".
//
// Revisão final do 8D (I6): sem o GrowthHS configurado o pedido entra na fila
// e ESPERA — dizer "enviado" nessas telas seria mentir. `GET /crm/estado`
// devolve só `{configurado}` (qualquer usuário logado; nada da configuração).
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const GROWTHHS_NAO_CONFIGURADO =
  'GrowthHS ainda não configurado — o contato fica na fila e é entregue quando a ' +
  'integração for ligada (Configurações → GrowthHS).';

export const estadoDoCrm = () => api.get<{ configurado: boolean }>('/crm/estado');

/** `configurado` é `undefined` enquanto carrega ou se a leitura falhar — as
 *  telas só avisam quando a resposta diz, com certeza, que não está ligado. */
export function useCrmEstado() {
  const consulta = useQuery({
    queryKey: ['crm-estado'],
    queryFn: estadoDoCrm,
    staleTime: 60 * 1000,
  });
  return { configurado: consulta.data?.configurado };
}

export const enviarAoComercial = (leadId: string) =>
  api.post<{ handoff_id: number | null; ja_na_fila: boolean }>(`/crm/enviar/${leadId}`);
