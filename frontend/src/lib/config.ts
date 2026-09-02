// Configuração de integrações. Os segredos ficam no banco e NUNCA voltam para
// a tela — só o fato de existirem.
import { api } from '@/lib/api';

export interface ConfigResend {
  resend_api_key: { configurado: boolean; ultimos4: string | null };
  email_from: string | null;
  unsubscribe_secret: { configurado: boolean };
  webhook_secret: { configurado: boolean };
}

export const lerConfigResend = () => api.get<ConfigResend>('/config/resend');

// ⚠️ Campo em branco é "não mexi", não "apague". O servidor ignora vazio —
// apagar a chave por engano pararia todo envio em silêncio.
export const gravarConfigResend = (dados: {
  api_key?: string;
  email_from?: string;
  webhook_secret?: string;
}) => api.put<{ gravados: string[] }>('/config/resend', dados);

// Redes sociais da marca. ⚠️ Global, não por usuário — o rodapé do e-mail é o
// mesmo para todo mundo. Por isso NÃO usa `/preferencias/{chave}`, que compõe a
// chave com o id de quem está autenticado.
export const lerRedesSociais = () =>
  api.get<{ valor: unknown }>('/config/redes-sociais').then(r => r.valor);

export const gravarRedesSociais = (valor: unknown) =>
  api.put<{ valor: unknown }>('/config/redes-sociais', { valor });
