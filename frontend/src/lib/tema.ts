// Tema claro (padrão do Design System) ou escuro (navy), pela classe `dark`
// no <html>. Tem de ser no <html>: a ponte do index.css e os tokens do DS
// estão no :root, e o .dark precisa cair no mesmo elemento.
//
// Sem escolha salva, o claro — não prefers-color-scheme: o DS define o claro
// como o tema de trabalho.

export type Tema = 'claro' | 'escuro';

export const CHAVE_TEMA = 'marketinghs-tema';

export function lerTema(): Tema {
  try {
    return localStorage.getItem(CHAVE_TEMA) === 'escuro' ? 'escuro' : 'claro';
  } catch {
    return 'claro';
  }
}

export function aplicarTema(tema: Tema): void {
  document.documentElement.classList.toggle('dark', tema === 'escuro');
  try {
    localStorage.setItem(CHAVE_TEMA, tema);
  } catch {
    // navegação privada ou armazenamento bloqueado: o tema vale só nesta aba
  }
}

export function alternarTema(): Tema {
  const novo: Tema = lerTema() === 'escuro' ? 'claro' : 'escuro';
  aplicarTema(novo);
  return novo;
}
