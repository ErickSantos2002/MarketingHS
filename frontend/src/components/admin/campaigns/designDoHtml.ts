// Design do Unlayer para template que só tem HTML.
//
// Template criado fora do editor (script, API, importação) chega com `html`
// preenchido e `design` nulo. Até 22/10/2026 o editor abria o modelo padrão
// nesse caso — e o primeiro "Salvar" gravava o padrão POR CIMA do HTML
// original. Os 5 templates de produção estavam assim. A saída é embrulhar o
// HTML num bloco do tipo `html` do Unlayer: o conteúdo aparece como era e o
// export devolve o mesmo HTML dentro da casca do Unlayer.
//
// Arquivo sem import e só com sintaxe apagável, para o Node rodar direto
// (scripts/design-do-html.test.mjs).

/** Design com uma linha, uma coluna e um bloco `html` contendo `html`. */
export function designDoHtml(html: string) {
  return {
    body: {
      rows: [
        {
          cells: [1],
          columns: [{
            contents: [{
              type: 'html',
              values: { html: miolo(html ?? '') },
            }],
          }],
        },
      ],
    },
  };
}

// Documento completo: o Unlayer já põe <html>/<head>/<body> em volta do
// export, então dentro do bloco fica só o miolo do <body>. Os <style> do
// <head> vão junto, na frente — sem eles o e-mail perde a formatação.
function miolo(html: string): string {
  const corpo = html.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i);
  const ehDocumento = corpo !== null || /<html\b/i.test(html);
  if (!ehDocumento) return html;

  const cabeca = html.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i);
  const estilos = cabeca ? cabeca[1].match(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi) ?? [] : [];

  let conteudo: string;
  if (corpo) {
    conteudo = corpo[1];
  } else {
    // <html> sem <body>: tira a casca e o <head>, fica o resto.
    conteudo = html
      .replace(/<!doctype[^>]*>/i, '')
      .replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i, '')
      .replace(/<\/?html\b[^>]*>/gi, '');
  }
  return [...estilos, conteudo.trim()].filter(Boolean).join('\n');
}

/**
 * Qual design abrir para um template: o salvo, se houver; senão o HTML
 * embrulhado num bloco; senão o `padrao`. `doHtml` diz se caiu no segundo
 * caso, para a tela avisar.
 */
// `any` como o resto do código do Unlayer aqui (EmailTemplate.design é any):
// o tipo do editor exige `counters`, que o BASE_EMAIL_DESIGN também não tem.
export function designDoTemplate(
  t: { design?: any; html?: string | null },
  padrao: any,
): { design: any; doHtml: boolean } {
  if (t.design) return { design: t.design, doHtml: false };
  if (t.html && t.html.trim()) return { design: designDoHtml(t.html), doHtml: true };
  return { design: padrao, doHtml: false };
}
