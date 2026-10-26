// As seções da landing pública (frente landing-secoes, 26/10/2026): o que
// vem depois do topo, na ordem de `config.secoes`.
//
// ⚠️ Só sintaxe apagável: `node --test scripts/landing-secoes.test.mjs` roda
// este arquivo direto no Node 24, que tira os tipos sem bundler. Nada de
// `enum`, `namespace`, parâmetro com modificador nem import de `@/`. O único
// import é o `./campos.ts`, com a extensão (o Node exige; o tsconfig aceita).
//
// O contrato é o da spec (`docs/superpowers/specs/2026-10-26-landing-secoes-
// design.md`). A config é JSON editável — no admin e pela chave de API — e o
// bundle da landing não tem ErrorBoundary: tudo aqui lê com desconfiança e,
// diante do que não entende, DESCARTA E SEGUE. Página com uma seção a menos
// ainda capta; página branca, não.
//
// A régua de URL do servidor (`app/captura/urls.py`) recusa ao salvar e
// descarta ao servir o `imagem_url` inseguro de seção e de item; o filtro
// daqui é a segunda volta da mesma chave, para o que escapar.

import { enderecoDaImagem, paragrafosDoCorpo, textoDaConfig, urlSegura, type BlocoDoCorpo } from "./campos.ts";

export type TipoDeSecao =
  | "numeros" | "comparativo" | "passos" | "cartoes"
  | "texto_imagem" | "logos" | "perguntas" | "chamada";

export const TIPOS_DE_SECAO: readonly TipoDeSecao[] = [
  "numeros", "comparativo", "passos", "cartoes", "texto_imagem", "logos", "perguntas", "chamada",
];

// Os mesmos do servidor (`app/captura/urls.py`, que corta ao servir).
export const LIMITE_SECOES = 20;
export const LIMITE_ITENS = 30;
export const LIMITE_LINHAS = 12;
// A faixa de números é de destaque: mais de 6 vira tabela, não faixa.
export const LIMITE_NUMEROS = 6;

// ── A forma crua, como o editor grava em `config.secoes` ─────────────────────
// Tudo opcional e frouxo de propósito: é o que está no banco, não o que se
// desenha. Quem desenha recebe `Secao`, já lida por `secoesDaConfig`.

export type ItemDaConfig = {
  valor?: string; rotulo?: string;            // numeros
  titulo?: string; texto?: string;            // passos, cartoes
  imagem_url?: string; nome?: string;         // cartoes, logos
  pergunta?: string; resposta?: string;       // perguntas
};

export type LinhaDaConfig = { criterio?: string; a?: string; b?: string };

export type SecaoDaConfig = {
  id: string;
  tipo: TipoDeSecao;
  titulo?: string;
  subtitulo?: string;
  itens?: ItemDaConfig[] | string[];          // string[] só na chamada
  colunas?: { a?: string; b?: string };
  linhas?: LinhaDaConfig[];
  texto?: string;
  imagem_url?: string;
  lado?: "esquerda" | "direita";
  nota?: string;
  botao?: string;
};

// ── A forma lida, a que o renderizador recebe ────────────────────────────────

type Cabeca = { id: string; titulo: string; subtitulo: string };

export type CorpoDaSecao =
  | { tipo: "numeros"; itens: { valor: string; rotulo: string }[] }
  | { tipo: "comparativo"; colunas: { a: string; b: string };
      linhas: { criterio: string; a: string; b: string }[] }
  | { tipo: "passos"; itens: { titulo: string; texto: string }[] }
  | { tipo: "cartoes"; itens: { titulo: string; texto: string; imagem: string | null }[] }
  | { tipo: "texto_imagem"; blocos: BlocoDoCorpo[]; imagem: string | null; lado: "esquerda" | "direita" }
  | { tipo: "logos"; itens: { nome: string; imagem: string | null }[] }
  | { tipo: "perguntas"; itens: { pergunta: string; resposta: string }[] }
  | { tipo: "chamada"; texto: string; itens: string[]; nota: string; botao: string };

export type Secao = Cabeca & CorpoDaSecao;

// Rótulos de quando o comparativo não diz quem é quem. `b` é a coluna
// destacada — a da casa.
export const COLUNA_A_PADRAO = "Hoje";
export const COLUNA_B_PADRAO = "Com a Health & Safety";
export const BOTAO_DA_CHAMADA_PADRAO = "Quero falar com a equipe";

function objeto(valor: unknown): Record<string, unknown> | null {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

function lista(valor: unknown): unknown[] {
  return Array.isArray(valor) ? valor : [];
}

/**
 * Lê cada item com `ler` e fica com os que voltam não-nulos, até `teto`.
 * O teto conta os ACEITOS: lixo na frente não empurra item bom para fora.
 */
function itensLidos<T>(valor: unknown, teto: number, ler: (o: Record<string, unknown>) => T | null): T[] {
  const saida: T[] = [];
  for (const bruto of lista(valor)) {
    if (saida.length >= teto) break;
    const o = objeto(bruto);
    if (!o) continue;
    const item = ler(o);
    if (item) saida.push(item);
  }
  return saida;
}

type Contexto = { origem: string; base: string; ctaDaPagina: string };

function imagemDe(valor: unknown, ctx: Contexto): string | null {
  const url = textoDaConfig(valor);
  return url ? urlSegura(enderecoDaImagem(url, ctx.base), ctx.origem) : null;
}

// Cada leitor devolve a parte própria do tipo, ou `null` quando a seção não
// tem o que mostrar — seção vazia parece página quebrada, e é o estado em que
// toda seção nasce no editor.
function lerCorpo(tipo: TipoDeSecao, s: Record<string, unknown>, ctx: Contexto): CorpoDaSecao | null {
  switch (tipo) {
    case "numeros": {
      // Número sem valor não é número; rótulo sozinho não sustenta a faixa.
      const itens = itensLidos(s.itens, LIMITE_NUMEROS, (o) => {
        const valor = textoDaConfig(o.valor);
        return valor ? { valor, rotulo: textoDaConfig(o.rotulo) } : null;
      });
      return itens.length ? { tipo, itens } : null;
    }
    case "comparativo": {
      const colunas = objeto(s.colunas) ?? {};
      const linhas = itensLidos(s.linhas, LIMITE_LINHAS, (o) => {
        const linha = { criterio: textoDaConfig(o.criterio), a: textoDaConfig(o.a), b: textoDaConfig(o.b) };
        return linha.criterio || linha.a || linha.b ? linha : null;
      });
      if (!linhas.length) return null;
      return {
        tipo, linhas,
        colunas: {
          a: textoDaConfig(colunas.a) || COLUNA_A_PADRAO,
          b: textoDaConfig(colunas.b) || COLUNA_B_PADRAO,
        },
      };
    }
    case "passos": {
      const itens = itensLidos(s.itens, LIMITE_ITENS, (o) => {
        const item = { titulo: textoDaConfig(o.titulo), texto: textoDaConfig(o.texto) };
        return item.titulo || item.texto ? item : null;
      });
      return itens.length ? { tipo, itens } : null;
    }
    case "cartoes": {
      const itens = itensLidos(s.itens, LIMITE_ITENS, (o) => {
        const item = { titulo: textoDaConfig(o.titulo), texto: textoDaConfig(o.texto), imagem: imagemDe(o.imagem_url, ctx) };
        return item.titulo || item.texto ? item : null;
      });
      return itens.length ? { tipo, itens } : null;
    }
    case "texto_imagem": {
      const texto = textoDaConfig(s.texto);
      const blocos = texto ? paragrafosDoCorpo(texto) : [];
      const imagem = imagemDe(s.imagem_url, ctx);
      if (!blocos.length && !imagem) return null;
      return { tipo, blocos, imagem, lado: s.lado === "esquerda" ? "esquerda" : "direita" };
    }
    case "logos": {
      // Logo sem imagem (ainda) mas com nome aparece como o nome em texto —
      // o Phoebus nasceu com a lista de clientes antes dos arquivos. Sem os
      // dois, não há o que mostrar.
      const itens = itensLidos(s.itens, LIMITE_ITENS, (o) => {
        const item = { nome: textoDaConfig(o.nome), imagem: imagemDe(o.imagem_url, ctx) };
        return item.nome || item.imagem ? item : null;
      });
      return itens.length ? { tipo, itens } : null;
    }
    case "perguntas": {
      // Pergunta sem resposta (ou o contrário) num <details> é um clique
      // que não leva a nada.
      const itens = itensLidos(s.itens, LIMITE_ITENS, (o) => {
        const item = { pergunta: textoDaConfig(o.pergunta), resposta: textoDaConfig(o.resposta) };
        return item.pergunta && item.resposta ? item : null;
      });
      return itens.length ? { tipo, itens } : null;
    }
    case "chamada": {
      const itens: string[] = [];
      for (const bruto of lista(s.itens)) {
        if (itens.length >= LIMITE_ITENS) break;
        const item = textoDaConfig(bruto);
        if (item) itens.push(item);
      }
      const texto = textoDaConfig(s.texto);
      // O título conta aqui: a chamada típica é título + botão.
      if (!textoDaConfig(s.titulo) && !texto && !itens.length) return null;
      return {
        tipo, texto, itens,
        nota: textoDaConfig(s.nota),
        botao: textoDaConfig(s.botao) || ctx.ctaDaPagina || BOTAO_DA_CHAMADA_PADRAO,
      };
    }
  }
  return null;
}

/**
 * As seções da página, prontas para desenhar: só tipos conhecidos, só texto
 * aparado, só imagem `http(s)` (com o prefixo da API no caminho do upload),
 * dentro dos limites. Nunca lança — config sem `secoes`, ou com `secoes` que
 * não é lista, dá `[]`, e a página fica exatamente como antes das seções.
 */
export function secoesDaConfig(config: unknown, origem: string, base: string): Secao[] {
  const c = objeto(config);
  if (!c) return [];
  const ctx: Contexto = { origem, base, ctaDaPagina: textoDaConfig(c.cta_text) };
  const saida: Secao[] = [];
  const ids = new Set<string>();
  const brutas = lista(c.secoes);
  for (let i = 0; i < brutas.length && saida.length < LIMITE_SECOES; i++) {
    const s = objeto(brutas[i]);
    if (!s) continue;
    // `includes` numa lista fixa, não `in` num objeto: "__proto__" ou
    // "constructor" não são tipo de seção.
    const tipo = TIPOS_DE_SECAO.find((t) => t === s.tipo);
    if (!tipo) continue;
    const corpo = lerCorpo(tipo, s, ctx);
    if (!corpo) continue;
    // O id é a `key` do React: precisa ser único na lista. O da config vale
    // quando é texto e ainda não apareceu; senão, um derivado da posição.
    let id = textoDaConfig(s.id);
    if (!id || ids.has(id)) {
      id = `secao-${i}`;
      while (ids.has(id)) id += "-";
    }
    ids.add(id);
    saida.push({ id, titulo: textoDaConfig(s.titulo), subtitulo: textoDaConfig(s.subtitulo), ...corpo });
  }
  return saida;
}

/** A seção como nasce no editor: o tipo pedido e um item vazio para preencher. */
export function secaoVazia(tipo: TipoDeSecao, id: string): SecaoDaConfig {
  const base = { id, tipo, titulo: "", subtitulo: "" };
  switch (tipo) {
    case "numeros": return { ...base, itens: [{ valor: "", rotulo: "" }] };
    case "comparativo": return { ...base, colunas: { a: "", b: "" }, linhas: [{ criterio: "", a: "", b: "" }] };
    case "passos": return { ...base, itens: [{ titulo: "", texto: "" }] };
    case "cartoes": return { ...base, itens: [{ titulo: "", texto: "", imagem_url: "" }] };
    case "texto_imagem": return { ...base, texto: "", imagem_url: "", lado: "direita" };
    case "logos": return { ...base, itens: [{ nome: "", imagem_url: "" }] };
    case "perguntas": return { ...base, itens: [{ pergunta: "", resposta: "" }] };
    case "chamada": return { ...base, texto: "", itens: [""], nota: "", botao: "" };
  }
}
