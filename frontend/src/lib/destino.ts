// Para onde o login devolve a pessoa (A6, achado da prova de 22/10: o link
// `/contacts?contato=<id>` do aviso interno caía no painel depois do login).
//
// O `ProtectedRoute` põe o destino no `state` do redirecionamento ao
// `/login`; o login lê de volta por `destinoSeguro`. ⚠️ Só caminho interno:
// `//outro.site` e `/\outro.site` o navegador trata como outro host — seria um
// redirecionamento aberto saindo da tela de login.

export function destinoDoLogin(local: { pathname: string; search?: string; hash?: string }): string {
  return `${local.pathname}${local.search ?? ''}${local.hash ?? ''}`;
}

export function destinoSeguro(valor: unknown): string {
  if (typeof valor !== 'string' || !valor.startsWith('/')) return '/';
  if (valor.startsWith('//') || valor.startsWith('/\\')) return '/';
  // Tab e quebra de linha o navegador apaga da URL: `/\t/outro.site` vira `//`.
  if (/[\u0000-\u0020\u007f]/.test(valor)) return '/';
  if (/^\/login(?:[/?#]|$)/.test(valor)) return '/';
  return valor;
}
