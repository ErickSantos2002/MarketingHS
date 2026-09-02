// Cliente da sincronização com o DataCore (Tiny ERP).
//
// ⚠️ Mão única: o ERP manda, o MarketingHS obedece. Não há rota de escrita para
// o outro lado, e não deve haver — a pool do backend abre o DataCore em
// read-only no servidor.
import { api } from '@/lib/api';

export interface PreviaDatacore {
  total: number;
  com_email_cadastro: number;
  com_email_incluindo_notas: number;
  email_de_notas_ligado: boolean;
  ja_importados: number;
}

export const previaDatacore = () => api.get<PreviaDatacore>('/datacore/previa');

export interface ResumoSincronizacao {
  criados: number;
  atualizados: number;
  sem_email: number;
  colisoes_de_email: number;
  erros: string[];
  total_de_erros: number;
}

export const sincronizarDatacore = () =>
  api.post<ResumoSincronizacao>('/datacore/sincronizar');
