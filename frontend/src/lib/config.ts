// Configuração de integrações. Os segredos ficam no banco e NUNCA voltam para
// a tela — só o fato de existirem.
import { api, BASE, ErroApi, lerToken } from '@/lib/api';

export interface DominioResend {
  id: string;
  name: string;
  status: string;
  capabilities?: { sending?: string } | null;
}

export interface ConfigResend {
  resend_api_key: { configurado: boolean; ultimos4: string | null;
                    escopo: 'full' | 'sending_only' | null };
  email_from: string | null;
  remetente: { nome: string; prefixo: string; dominio: string } | null;
  unsubscribe_secret: { configurado: boolean };
  webhook_secret: { configurado: boolean };
  dominios: DominioResend[];
  webhook_url: string;
}

export type TesteDeChave =
  | { valida: true; escopo: 'full' | 'sending_only'; dominios: DominioResend[] }
  | { valida: false; motivo: 'invalid_api_key' | 'network' | 'unknown' };

export interface RegistroDns {
  record: string;
  name: string;
  type: string;
  value: string;
  status?: string;
  ttl?: string | number;
}

export interface InfoDominio {
  disponivel: boolean;
  motivo?: string;
  open_tracking?: boolean;
  click_tracking?: boolean;
  tracking_subdomain?: string | null;
  status?: string | null;
  records?: RegistroDns[];
}

export interface DiagnosticoResend {
  ok: boolean;
  faltando: string[];
  segredo_descadastro_faltando: boolean;
  remetente?: string | null;
  dominios?: { name: string; status: string }[];
  erro_api?: string;
}

export const lerConfigResend = () => api.get<ConfigResend>('/config/resend');

export const testarChaveResend = (api_key: string) =>
  api.post<TesteDeChave>('/config/resend/testar', { api_key });

// ⚠️ Campo em branco é "não mexi", não "apague". O servidor ignora vazio —
// apagar a chave por engano pararia todo envio em silêncio.
export const gravarConfigResend = (dados: {
  from_name: string;
  from_prefix: string;
  from_domain: string;
  api_key?: string;
  unsubscribe_secret?: string;
  webhook_secret?: string;
}) => api.put<{ gravados: string[]; email_from: string; aviso: string | null }>(
  '/config/resend', dados);

export const lerDominioResend = (id: string) =>
  api.get<InfoDominio>(`/config/resend/dominios/${encodeURIComponent(id)}`);

export const ligarRastreamentoResend = (id: string, subdominio: string) =>
  api.post<InfoDominio & { sucesso: true }>(
    `/config/resend/dominios/${encodeURIComponent(id)}/rastreamento`, { subdominio });

export const lerDiagnosticoResend = () =>
  api.get<DiagnosticoResend>('/config/resend/diagnostico');

// Redes sociais da marca. ⚠️ Global, não por usuário — o rodapé do e-mail é o
// mesmo para todo mundo. Por isso NÃO usa `/preferencias/{chave}`, que compõe a
// chave com o id de quem está autenticado.
export const lerRedesSociais = () =>
  api.get<{ valor: unknown }>('/config/redes-sociais').then(r => r.valor);

export const gravarRedesSociais = (valor: unknown) =>
  api.put<{ valor: unknown }>('/config/redes-sociais', { valor });

export interface ImagemDeEmail {
  id: string;
  url: string;
  tamanho: number;
}

// ⚠️ Multipart, não JSON: `api.post` serializa para JSON e definiria o
// Content-Type errado. O `fetch` vai direto, e o browser monta o boundary.
export async function subirImagemDeEmail(
  arquivo: File,
  pasta: 'campaigns' | 'templates',
): Promise<ImagemDeEmail> {
  const corpo = new FormData();
  corpo.append('arquivo', arquivo);
  corpo.append('pasta', pasta);

  const token = lerToken();
  const resposta = await fetch(`${BASE}/imagens`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: corpo,
  });
  if (!resposta.ok) {
    let detalhe = `Erro ${resposta.status}`;
    try { detalhe = (await resposta.json()).detail ?? detalhe; } catch { /* sem corpo */ }
    throw new ErroApi(resposta.status, detalhe);
  }
  return resposta.json();
}
