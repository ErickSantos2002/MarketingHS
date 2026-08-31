// Conversao HTML -> texto puro para a parte `text/plain` dos emails.
//
// POR QUE converter aqui, e nao salvar um `text` gerado pelo editor:
// o HTML que chega nesta funcao ja passou por replaceVars (merge tags trocadas
// por destinatario) e pela injecao do rodape automatico de descadastro. Um texto
// gerado no editor, na hora de salvar, nao teria nem uma coisa nem outra -- e
// ficaria NULL para todo template/campanha criado antes da mudanca. Convertendo
// o HTML final, a parte texto e sempre um espelho exato do que foi enviado, para
// 100% do conteudo, sem migration.
//
// O alvo e o HTML que o Unlayer exporta: tabelas aninhadas, comentarios
// condicionais do Outlook (<!--[if mso]>), <style> no <head> e entidades HTML.
// Nao e um parser -- e uma sequencia de substituicoes calibrada para essa saida.

// Entidades Latin-1: os nomes HTML de U+00A0 a U+00FF sao CONTIGUOS e nesta
// ordem exata, entao a tabela inteira sai de uma lista de nomes + o indice.
// Escrever as ~96 entradas a mao seria so oportunidade de errar um acento.
// Cobre todo o portugues (&ccedil; &atilde; &eacute; &ocirc; ...), que e o que
// mais aparece aqui.
// Codepoints invisiveis (zero-width, joiners, o &#847; do preheader) viram
// vazio; o resto vira o caractere. Um codepoint invalido nunca lanca -- devolve
// vazio, porque uma excecao aqui derrubaria o envio de um destinatario inteiro.
//
// DECLARADO ANTES da tabela de entidades de proposito: a construcao da tabela
// (LATIN1_NAMES.forEach, abaixo) roda no carregamento do modulo e CHAMA
// safeCodePoint. Mover este bloco para depois joga INVISIBLE_CODEPOINTS na
// temporal dead zone e o modulo lanca no import -- o que, no worker, derruba
// TODO o envio de email, nao so a conversao para texto.
const INVISIBLE_CODEPOINTS = new Set([0x034f, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x00ad]);
function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  if (INVISIBLE_CODEPOINTS.has(code)) return '';
  // Espacos que nao quebram (&nbsp;, &#160;) precisam virar espaco COMUM: o
  // colapso de whitespace la embaixo usa [ \t\f\v]+, que nao pega U+00A0 --
  // eles sobreviveriam como espacos duplos espalhados pelo texto.
  if (code === 0x00a0 || code === 0x2007 || code === 0x202f) return ' ';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

const LATIN1_NAMES =
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr ' +
  'deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest ' +
  'Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ' +
  'ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig ' +
  'agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml ' +
  'eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml';

const NAMED_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  amp: '&',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  bull: '•',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  // Caracteres invisiveis que o Unlayer injeta depois do preheader para
  // "empurrar" o texto de preview nas caixas de entrada. Viram vazio, senao
  // aparecem como lixo no comeco do texto.
  zwnj: '',
  zwj: '',
};
LATIN1_NAMES.split(' ').forEach((name, i) => {
  NAMED_ENTITIES[name] = safeCodePoint(0xa0 + i);
});

// UMA passada so, de proposito. Decodificar entidade por entidade, em sequencia,
// causa dupla decodificacao: "&amp;eacute;" (o texto literal "&eacute;" escrito
// pelo autor) viraria "&eacute;" na passada do &amp; e depois "é" na do &eacute;.
// Numa unica varredura cada match e consumido de uma vez e isso nao acontece.
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return safeCodePoint(code);
    }
    const named = NAMED_ENTITIES[body];
    if (named !== undefined) return named;
    // Entidade desconhecida fica como estava: melhor um "&foo;" visivel no texto
    // do que engolir silenciosamente algo que podia ser conteudo.
    return match;
  });
}

export function htmlToText(html: string): string {
  if (!html) return '';

  let s = html;

  // 1. Fora tudo que nao e conteudo. Os comentarios vao PRIMEIRO porque os
  //    condicionais do Outlook (<!--[if mso]>...<![endif]-->) embrulham markup
  //    de verdade -- se as tags fossem processadas antes, esse markup so-Outlook
  //    vazaria para o texto, duplicando botoes e espacadores.
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, ' ');
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, ' ');

  // 2. Imagens viram o alt, quando ha um. Sem alt somem: o Unlayer deixa
  //    alt="" na maioria dos blocos, e "[imagem]" repetido so poluiria.
  s = s.replace(/<img\b[^>]*?\balt\s*=\s*"([^"]+)"[^>]*>/gi, ' $1 ');
  s = s.replace(/<img\b[^>]*>/gi, ' ');

  // 3. Links viram "texto (url)". O href e preservado porque e o unico jeito de
  //    o destinatario chegar ao CTA na versao texto. Casos em que anexar a URL
  //    so atrapalha:
  //      - ancoras internas e mailto/tel (o texto ja diz tudo);
  //      - quando o proprio texto do link JA e a URL (viraria "x (x)").
  s = s.replace(
    /<a\b[^>]*?\bhref\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href: string, inner: string) => {
      const label = stripTags(inner).trim();
      const url = String(href).trim();
      if (!url || url.startsWith('#') || /^(mailto|tel):/i.test(url)) return ` ${label} `;
      if (!label) return ` ${url} `;
      if (label.includes(url)) return ` ${label} `;
      return ` ${label} (${url}) `;
    },
  );

  // 4. Quebras de linha estruturais. <td> vira espaco (celulas da mesma linha
  //    ficam lado a lado); <tr> e blocos viram quebra.
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<li\b[^>]*>/gi, '\n- ');
  s = s.replace(/<\/(td|th)>/gi, ' ');
  // `li` fica FORA desta lista: a abertura <li> ja emite o "\n- ", e fechar
  // tambem com "\n" daria uma linha em branco entre cada item da lista.
  s = s.replace(/<\/(p|div|tr|table|h[1-6]|ul|ol|blockquote|section|header|footer)>/gi, '\n');
  s = s.replace(/<hr\b[^>]*>/gi, '\n');

  // 5. O que sobrou de markup sai; so entao as entidades sao decodificadas --
  //    inverter a ordem faria um "&lt;script&gt;" escrito no email virar uma tag
  //    de verdade e ser removido como se fosse markup.
  s = stripTags(s);
  s = decodeEntities(s);

  // 6. Normalizacao. O HTML do Unlayer e cheio de tabelas de espacamento, entao
  //    sem isto o texto sai com dezenas de linhas em branco seguidas.
  s = s.replace(/\r\n?/g, '\n');
  s = s.replace(/[ \t\f\v]+/g, ' ');
  s = s.split('\n').map((line) => line.trim()).join('\n');
  s = s.replace(/\n{3,}/g, '\n\n');

  return s.trim();
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, ' ');
}
