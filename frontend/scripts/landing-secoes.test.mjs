// As seções da landing pública (frente landing-secoes, 26/10): a leitura
// defensiva de `config.secoes`.
//
//   node --test scripts/landing-secoes.test.mjs
//
// A config é JSON editável (no admin e pela chave de API) e o bundle da
// landing não tem ErrorBoundary: o que este teste guarda é que nenhuma config
// derruba a página — o que não se entende é descartado, sem lançar — e que
// nenhuma URL fora de http(s) chega a virar `src`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  secoesDaConfig, secaoVazia, TIPOS_DE_SECAO,
  LIMITE_SECOES, LIMITE_ITENS, LIMITE_LINHAS, LIMITE_NUMEROS,
} from "../src/landing/secoes.ts";
import { enderecoDaImagem } from "../src/landing/campos.ts";

const ORIGEM = "https://marketinghs.exemplo.com";
const ler = (config) => secoesDaConfig(config, ORIGEM, "/api");
const PHOEBUS = JSON.parse(readFileSync(new URL("./landing-phoebus.json", import.meta.url), "utf8"));

test("a config do Phoebus monta as doze seções, dos onze tipos", () => {
  const secoes = ler(PHOEBUS);
  assert.deepEqual(secoes.map((s) => s.tipo), [
    "numeros", "comparativo", "passos", "video", "cartoes", "cartoes",
    "texto_imagem", "logos", "depoimentos", "perguntas", "certificacoes", "chamada",
  ]);
  assert.deepEqual(new Set(secoes.map((s) => s.tipo)), new Set(TIPOS_DE_SECAO));
  const porTipo = (t) => secoes.find((s) => s.tipo === t);
  assert.equal(secoes[0].itens[0].valor, "23 milhões+");
  assert.equal(porTipo("comparativo").linhas.length, 6);
  assert.equal(porTipo("comparativo").colunas.b, "Phoebus");
  assert.equal(porTipo("texto_imagem").blocos.length, 2);
  assert.equal(porTipo("logos").itens.length, 8);
  assert.equal(porTipo("chamada").botao, "Quero testar 30 dias grátis");
  assert.equal(porTipo("chamada").itens.length, 3);
});

test("sem secoes, ou secoes que não é lista: nenhuma seção, sem lançar", () => {
  for (const ruim of [{}, { secoes: null }, { secoes: "x" }, { secoes: 42 }, { secoes: { a: 1 } }, null, undefined]) {
    assert.deepEqual(ler(ruim), [], JSON.stringify(ruim));
  }
});

test("seção quebrada ou de tipo desconhecido é descartada e a lista segue", () => {
  const secoes = ler({ secoes: [
    null, 42, "numeros", ["x"],
    { tipo: "carrossel", itens: [{ url: "https://youtube.com/x" }] },
    { tipo: "__proto__" },
    { itens: [{ valor: "1", rotulo: "sem tipo" }] },
    { tipo: "numeros", itens: [{ valor: "10", rotulo: "fica" }] },
  ] });
  assert.equal(secoes.length, 1);
  assert.equal(secoes[0].itens[0].rotulo, "fica");
});

test("número no lugar de texto e item que não é objeto não derrubam", () => {
  const [s] = ler({ secoes: [{
    tipo: "passos", titulo: 42, subtitulo: { a: 1 },
    itens: [null, 3, "texto", { titulo: 7, texto: "  só texto  " }, { titulo: "  Testa ", texto: ["x"] }, {}],
  }] });
  assert.equal(s.titulo, "");
  assert.equal(s.subtitulo, "");
  assert.deepEqual(s.itens, [{ titulo: "", texto: "só texto" }, { titulo: "Testa", texto: "" }]);
});

test("seção sem item aproveitável não aparece", () => {
  assert.deepEqual(ler({ secoes: [
    { tipo: "numeros", titulo: "Números", itens: [{ valor: "", rotulo: "" }] },
    { tipo: "passos", itens: "não é lista" },
    { tipo: "cartoes", itens: [] },
    { tipo: "logos", itens: [{ nome: "", imagem_url: "" }] },
    { tipo: "perguntas", itens: [{ pergunta: "", resposta: "sem pergunta" }] },
    { tipo: "comparativo", colunas: { a: "A", b: "B" }, linhas: [{ criterio: "", a: "", b: "" }] },
    { tipo: "texto_imagem", titulo: "Só título", texto: "  " },
  ] }), []);
});

test("número sem valor não entra; pergunta precisa de pergunta e resposta", () => {
  const [n, p] = ler({ secoes: [
    { tipo: "numeros", itens: [{ valor: "", rotulo: "sem valor" }, { valor: "770+", rotulo: "" }] },
    { tipo: "perguntas", itens: [{ pergunta: "Só pergunta?", resposta: "" }, { pergunta: "P?", resposta: "R." }] },
  ] });
  assert.deepEqual(n.itens, [{ valor: "770+", rotulo: "" }]);
  assert.deepEqual(p.itens, [{ pergunta: "P?", resposta: "R." }]);
});

test("imagem insegura vira null; o cartão fica, o logo sem nome sai", () => {
  const [cartoes, logos, ti] = ler({ secoes: [
    { tipo: "cartoes", itens: [
      { titulo: "A", texto: "a", imagem_url: "javascript:alert(1)" },
      { titulo: "B", texto: "b", imagem_url: "https://cdn.exemplo.com/b.png" },
    ] },
    { tipo: "logos", itens: [
      { nome: "", imagem_url: "data:image/svg+xml,<svg onload=alert(1)>" },
      { nome: "Vale", imagem_url: " JavaScript:alert(1)" },
      { nome: "CCR", imagem_url: "/publico/imagem/abc" },
      { nome: 42, imagem_url: "https://cdn.exemplo.com/x.png" },
    ] },
    { tipo: "texto_imagem", texto: "Oi", imagem_url: "vbscript:x" },
  ] });
  assert.deepEqual(cartoes.itens.map((i) => i.imagem), [null, "https://cdn.exemplo.com/b.png"]);
  // Logo sem imagem válida mas com nome fica como texto; sem os dois, sai.
  assert.deepEqual(logos.itens, [
    { nome: "Vale", imagem: null },
    { nome: "CCR", imagem: "https://marketinghs.exemplo.com/api/publico/imagem/abc" },
    { nome: "", imagem: "https://cdn.exemplo.com/x.png" },
  ]);
  assert.equal(ti.imagem, null);
});

test("imagem do upload ganha o prefixo da API, a absoluta passa como está", () => {
  assert.equal(enderecoDaImagem("/publico/imagem/1", "/api"), "/api/publico/imagem/1");
  assert.equal(enderecoDaImagem("/api/publico/imagem/1", "/api"), "/api/publico/imagem/1");
  assert.equal(enderecoDaImagem("https://x.com/a.png", "/api"), "https://x.com/a.png");
});

test("texto_imagem usa a regra do corpo e o lado cai em direita", () => {
  const [a, b] = ler({ secoes: [
    { tipo: "texto_imagem", texto: "Um.\n\n- item 1\n- item 2", lado: "esquerda" },
    { tipo: "texto_imagem", texto: "<script>alert(1)</script>", lado: "cima" },
  ] });
  assert.deepEqual(a.blocos, [{ tipo: "p", texto: "Um." }, { tipo: "lista", itens: ["item 1", "item 2"] }]);
  assert.equal(a.lado, "esquerda");
  assert.equal(b.lado, "direita");
  // Texto puro: o HTML chega como texto, quem desenha é o React.
  assert.equal(b.blocos[0].texto, "<script>alert(1)</script>");
});

test("comparativo: rótulos padrão e linha sem critério mas com valor fica", () => {
  const [c] = ler({ secoes: [{ tipo: "comparativo", colunas: "x", linhas: [
    { criterio: "Horário", a: "Quando dá", b: "24 h" },
    { criterio: "", a: "", b: "só b" },
    "lixo",
  ] }] });
  assert.equal(c.colunas.a, "Hoje");
  assert.equal(c.colunas.b, "Com a Health & Safety");
  assert.equal(c.linhas.length, 2);
});

test("chamada: botão vazio cai no cta_text e depois no padrão; itens só texto", () => {
  const [a] = secoesDaConfig({ cta_text: "Quero o teste", secoes: [
    { tipo: "chamada", titulo: "Teste", botao: "  ", itens: ["  um ", 2, null, ""] },
  ] }, ORIGEM, "/api");
  assert.equal(a.botao, "Quero o teste");
  assert.deepEqual(a.itens, ["um"]);
  const [b] = ler({ secoes: [{ tipo: "chamada", titulo: "Teste", itens: "não é lista" }] });
  assert.equal(b.botao, "Quero falar com um especialista");
  assert.deepEqual(b.itens, []);
  // Chamada sem nada além do botão não tem o que chamar.
  assert.deepEqual(ler({ secoes: [{ tipo: "chamada", botao: "Só botão" }] }), []);
});

test("limites: 20 seções, 30 itens, 12 linhas, 6 números", () => {
  assert.equal(LIMITE_SECOES, 20);
  assert.equal(LIMITE_ITENS, 30);
  assert.equal(LIMITE_LINHAS, 12);
  assert.equal(LIMITE_NUMEROS, 6);
  const muitas = Array.from({ length: 25 }, (_, i) => ({ tipo: "numeros", itens: [{ valor: String(i) }] }));
  assert.equal(ler({ secoes: muitas }).length, 20);
  const itens = Array.from({ length: 40 }, (_, i) => ({ pergunta: `P${i}?`, resposta: "R" }));
  assert.equal(ler({ secoes: [{ tipo: "perguntas", itens }] })[0].itens.length, 30);
  const linhas = Array.from({ length: 15 }, (_, i) => ({ criterio: `C${i}`, a: "a", b: "b" }));
  assert.equal(ler({ secoes: [{ tipo: "comparativo", linhas }] })[0].linhas.length, 12);
  const numeros = Array.from({ length: 9 }, (_, i) => ({ valor: String(i) }));
  assert.equal(ler({ secoes: [{ tipo: "numeros", itens: numeros }] })[0].itens.length, 6);
});

test("o limite de 20 conta as seções lidas, não as descartadas", () => {
  const lixo = Array.from({ length: 30 }, () => ({ tipo: "inventado" }));
  const boas = Array.from({ length: 5 }, (_, i) => ({ tipo: "numeros", itens: [{ valor: String(i) }] }));
  // Lixo na frente não pode empurrar seção boa para fora do teto.
  assert.equal(ler({ secoes: [...lixo, ...boas] }).length, 5);
});

test("id: o da config quando é texto único; senão um derivado da posição", () => {
  const secoes = ler({ secoes: [
    { id: "a", tipo: "numeros", itens: [{ valor: "1" }] },
    { id: "a", tipo: "numeros", itens: [{ valor: "2" }] },
    { id: 9, tipo: "numeros", itens: [{ valor: "3" }] },
  ] });
  const ids = secoes.map((s) => s.id);
  assert.equal(ids[0], "a");
  assert.equal(new Set(ids).size, 3, "ids únicos (são a key do React)");
});

test("secaoVazia nasce com um item vazio, do tipo pedido", () => {
  for (const tipo of TIPOS_DE_SECAO) {
    const s = secaoVazia(tipo, "x1");
    assert.equal(s.tipo, tipo);
    assert.equal(s.id, "x1");
    if (tipo === "comparativo") assert.equal(s.linhas.length, 1);
    else if (tipo === "texto_imagem") assert.equal(s.texto, "");
    else if (tipo === "video") assert.equal(s.url, "");
    else assert.equal(s.itens.length, 1);
    // E vazia não aparece na página até alguém preencher.
    assert.deepEqual(ler({ secoes: [s] }), []);
  }
});
