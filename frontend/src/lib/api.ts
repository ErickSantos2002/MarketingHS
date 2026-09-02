// Cliente HTTP com JWT. Substitui supabase.functions.invoke e, aos poucos,
// supabase.from.
//
// ⚠️ VITE_API_URL é resolvida em BUILD TIME, não em runtime. Trocar a variável
// no servidor sem rebuildar não muda nada — a URL já está dentro do bundle.
// Isso já custou tempo no Grana. Em desenvolvimento o proxy do Vite cobre.
export const BASE = import.meta.env.VITE_API_URL ?? '/api';

const CHAVE_TOKEN = 'marketinghs-token';

export function guardarToken(token: string) {
  localStorage.setItem(CHAVE_TOKEN, token);
}

export function lerToken(): string | null {
  return localStorage.getItem(CHAVE_TOKEN);
}

export function limparToken() {
  localStorage.removeItem(CHAVE_TOKEN);
}

export class ErroApi extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function pedir<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  const token = lerToken();
  const resposta = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: {
      ...(corpo ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });

  if (resposta.status === 401) {
    // Sessão morta: limpa e manda para o login em vez de deixar a tela
    // tentando de novo com um token que não vale mais.
    limparToken();
    if (!location.pathname.startsWith('/login')) location.assign('/login');
    throw new ErroApi(401, 'Sessão expirada.');
  }

  if (!resposta.ok) {
    let detalhe = `Erro ${resposta.status}`;
    try {
      detalhe = (await resposta.json()).detail ?? detalhe;
    } catch { /* resposta sem corpo JSON */ }
    throw new ErroApi(resposta.status, detalhe);
  }

  return resposta.status === 204 ? (undefined as T) : resposta.json();
}

export const api = {
  get: <T>(c: string) => pedir<T>('GET', c),
  post: <T>(c: string, corpo?: unknown) => pedir<T>('POST', c, corpo),
  put: <T>(c: string, corpo?: unknown) => pedir<T>('PUT', c, corpo),
  patch: <T>(c: string, corpo?: unknown) => pedir<T>('PATCH', c, corpo),
  delete: <T>(c: string) => pedir<T>('DELETE', c),
};
