// Cliente de templates de e-mail. Substitui o acesso direto ao banco de
// useTemplates.
//
// A API já usa os mesmos nomes de campo da tabela (name, design, html...),
// então aqui não há tradução a fazer — só o transporte.
import { api } from '@/lib/api';

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

interface Pagina<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

// O limite máximo do endpoint é 100. A tela de templates nunca paginou; se um
// dia passar de 100, é aqui que a paginação entra — e não numa segunda lista
// montada no navegador.
export const listarTemplates = () =>
  api.get<Pagina<EmailTemplate>>('/templates?limit=100').then(p => p.data);

export const lerTemplate = (id: string) =>
  api.get<EmailTemplate>(`/templates/${id}`);

export const criarTemplate = (dados: EmailTemplateInput) =>
  api.post<EmailTemplate>('/templates', dados);

// ⚠️ PATCH parcial: mandar só o que mudou. O servidor distingue "não mandou"
// de "mandou null", então enviar o objeto inteiro por precaução é o que NÃO
// se deve fazer — seria reescrever campos que ninguém tocou.
export const editarTemplate = (id: string, dados: Partial<EmailTemplateInput>) =>
  api.patch<EmailTemplate>(`/templates/${id}`, dados);

export const excluirTemplate = (id: string) =>
  api.delete<void>(`/templates/${id}`);
