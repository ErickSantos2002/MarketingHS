// Cliente HTTP com JWT. Substitui supabase.functions.invoke e, aos poucos,
// supabase.from.
//
// ⚠️ VITE_API_URL é resolvida em BUILD TIME, não em runtime. Trocar a variável
// no servidor sem rebuildar não muda nada — a URL já está dentro do bundle.
// Isso já custou tempo no Grana. Em desenvolvimento o proxy do Vite cobre.
// `?.`: fora do Vite (o `node --test` de scripts/api-erro.test.mjs) não há
// `import.meta.env`.
export const BASE = import.meta.env?.VITE_API_URL ?? '/api';

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

// Campo declarado à parte (e não `constructor(public status…)`): propriedade
// de parâmetro não é sintaxe apagável, e o Node 24 recusaria o arquivo no
// teste.
export class ErroApi extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * O `detail` do FastAPI vira texto legível — nunca "[object Object]".
 * Três formas: string (o comum); `{mensagem, campos}` (a captura e as rotas
 * da prova do RD); a lista do 422 de validação (`[{loc, msg, type}]`).
 */
export function mensagemDoDetalhe(detail: unknown, padrao: string): string {
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d) => (d && typeof d === 'object' && typeof (d as { msg?: unknown }).msg === 'string'
        ? (d as { msg: string }).msg : null))
      .filter((m): m is string => !!m);
    return msgs.length ? [...new Set(msgs)].join('; ') : padrao;
  }
  if (detail && typeof detail === 'object') {
    const m = (detail as { mensagem?: unknown }).mensagem;
    if (typeof m === 'string' && m.trim()) return m;
  }
  return padrao;
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
    if (!location.pathname.startsWith('/login')) location.assign('/login?de=' + encodeURIComponent(location.pathname + location.search + location.hash));
    throw new ErroApi(401, 'Sessão expirada.');
  }

  if (!resposta.ok) {
    let detalhe: unknown = null;
    try {
      detalhe = (await resposta.json()).detail;
    } catch { /* resposta sem corpo JSON */ }
    throw new ErroApi(resposta.status, mensagemDoDetalhe(detalhe, `Erro ${resposta.status}`));
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
