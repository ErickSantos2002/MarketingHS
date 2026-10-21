// A lógica do formulário da landing pública: campos tipados, validação no
// cliente, corpo, WhatsApp e o id de visitante (prova de substituição do RD,
// Tarefa 10).
//
//   node --test scripts/landing-campos.test.mjs
//
// `src/landing/campos.ts` só usa sintaxe apagável e não importa nada: o Node 24
// tira os tipos e roda o arquivo direto, sem bundler.
//
// ⚠️ A validação daqui é cortesia, não defesa: o servidor valida de novo
// (`app/captura/campos.py::validar`). O que este teste guarda é que as duas
// pontas leem a config do mesmo jeito — o cliente não pode recusar o que o
// servidor aceita, nem deixar passar em silêncio o que ele vai recusar.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  camposDaConfig,
  validarNoCliente,
  normalizarCelular,
  paragrafosDoCorpo,
  linkDoWhatsapp,
  lerVisitante,
  urlSegura,
} from "../src/landing/campos.ts";

test("urlSegura só aceita http e https", () => {
  const origem = "https://marketinghs.exemplo.com";
  assert.equal(urlSegura("https://www.healthsafety.com.br/privacidade.cfm", origem),
               "https://www.healthsafety.com.br/privacidade.cfm");
  assert.equal(urlSegura("/api/publico/imagem/1", origem),
               "https://marketinghs.exemplo.com/api/publico/imagem/1");
  for (const ruim of ["javascript:alert(1)", " JavaScript:alert(1)",
                      "data:text/html,<script>alert(1)</script>", "vbscript:x",
                      "", null, undefined, 42]) {
    assert.equal(urlSegura(ruim, origem), null, String(ruim));
  }
});

test("camposDaConfig cai em visible_fields", () => {
  const campos = camposDaConfig({ visible_fields: ["nome", "email", "whatsapp"] });
  assert.deepEqual(campos.map((c) => c.chave), ["nome", "email", "whatsapp"]);
  // Página antiga: tudo texto, só o e-mail obrigatório — o comportamento de hoje.
  assert.deepEqual(campos.map((c) => c.tipo), ["texto", "email", "texto"]);
  assert.deepEqual(campos.map((c) => c.obrigatorio), [false, true, false]);
  assert.equal(campos[0].rotulo, "Nome");
});

test("camposDaConfig sem nada usa os campos padrão de hoje", () => {
  const campos = camposDaConfig({});
  assert.deepEqual(campos.map((c) => c.chave), ["nome", "email", "whatsapp", "cargo", "empresa"]);
  assert.ok(campos.every((c) => c.obrigatorio === (c.chave === "email")));
});

test("camposDaConfig lê campos e descarta entrada inválida", () => {
  const campos = camposDaConfig({
    visible_fields: ["cargo"],
    campos: [
      { chave: "nome", rotulo: "Nome", tipo: "texto", obrigatorio: true },
      { chave: "email", rotulo: "E-mail", tipo: "texto", obrigatorio: false },
      { chave: "whatsapp", rotulo: "Celular", tipo: "telefone", obrigatorio: true },
      { chave: "ja_faz_testagem", rotulo: "Já faz testagem?", tipo: "sim_nao", obrigatorio: false },
      { chave: "x; DROP TABLE", rotulo: "Ruim", tipo: "texto", obrigatorio: false },
      { chave: "outro", rotulo: "Tipo inventado", tipo: "data", obrigatorio: false },
      { chave: "website", rotulo: "A isca", tipo: "texto", obrigatorio: false },
      { chave: "nome", rotulo: "Repetido", tipo: "texto", obrigatorio: false },
      { chave: "porte", rotulo: "Porte", tipo: "lista", obrigatorio: false, opcoes: ["P", " ", "G"] },
    ],
  });
  assert.deepEqual(campos.map((c) => c.chave), ["nome", "email", "whatsapp", "ja_faz_testagem", "porte"]);
  // O e-mail é sempre e-mail e sempre obrigatório, diga a config o que disser.
  assert.equal(campos[1].tipo, "email");
  assert.equal(campos[1].obrigatorio, true);
  assert.deepEqual(campos[4].opcoes, ["P", "G"]);
});

test("camposDaConfig sem e-mail na lista põe o e-mail na frente", () => {
  const campos = camposDaConfig({
    campos: [{ chave: "nome", rotulo: "Nome", tipo: "texto", obrigatorio: true }],
  });
  assert.deepEqual(campos.map((c) => c.chave), ["email", "nome"]);
});

test("validarNoCliente exige obrigatório e formato de e-mail", () => {
  const campos = camposDaConfig({
    campos: [
      { chave: "nome", rotulo: "Nome", tipo: "texto", obrigatorio: true },
      { chave: "email", rotulo: "E-mail", tipo: "email", obrigatorio: true },
      { chave: "empresa", rotulo: "Empresa", tipo: "texto", obrigatorio: false },
    ],
  });
  const erros = validarNoCliente(campos, { nome: "   ", email: "ana@" });
  assert.ok(erros.nome);
  assert.ok(erros.email);
  assert.equal(erros.empresa, undefined);
  assert.deepEqual(validarNoCliente(campos, { nome: "Ana", email: "ana@x.com.br" }), {});
});

test("celular com DDD passa e sem DDD não", () => {
  for (const [entrada, saida] of [
    ["+55 (31) 99999-9999", "+5531999999999"],
    ["5531999999999", "+5531999999999"],
    ["031 99999 9999", "+5531999999999"],
    ["(31) 3333-4444", "+553133334444"],
  ]) {
    assert.equal(normalizarCelular(entrada), saida, entrada);
  }
  for (const ruim of ["999", "99999-9999", "(00) 99999-9999", ""]) {
    assert.equal(normalizarCelular(ruim), null, ruim);
  }
  const campos = camposDaConfig({
    campos: [{ chave: "whatsapp", rotulo: "Celular", tipo: "telefone", obrigatorio: true }],
  });
  assert.equal(validarNoCliente(campos, { email: "a@x.com", whatsapp: "(31) 99999-9999" }).whatsapp, undefined);
  assert.match(validarNoCliente(campos, { email: "a@x.com", whatsapp: "99999-9999" }).whatsapp, /DDD/);
});

test("validarNoCliente confere lista, sim/não e tamanho", () => {
  const campos = camposDaConfig({
    campos: [
      { chave: "porte", rotulo: "Porte", tipo: "lista", obrigatorio: false, opcoes: ["P", "G"] },
      { chave: "testa", rotulo: "Testa?", tipo: "sim_nao", obrigatorio: true },
      { chave: "cargo", rotulo: "Cargo", tipo: "texto", obrigatorio: false },
      { chave: "conta", rotulo: "Conte", tipo: "texto_longo", obrigatorio: false },
    ],
  });
  const erros = validarNoCliente(campos, {
    email: "a@x.com", porte: "M", testa: "", cargo: "x".repeat(201), conta: "x".repeat(2000),
  });
  assert.ok(erros.porte);
  assert.ok(erros.testa);
  assert.ok(erros.cargo);
  assert.equal(erros.conta, undefined);
  assert.deepEqual(validarNoCliente(campos, { email: "a@x.com", porte: "G", testa: "nao" }), {});
});

test("paragrafosDoCorpo separa parágrafo e lista", () => {
  const corpo = "Primeiro parágrafo\ncontinua aqui.\n\n- item um\n- item dois\n\n\nÚltimo.";
  assert.deepEqual(paragrafosDoCorpo(corpo), [
    { tipo: "p", texto: "Primeiro parágrafo continua aqui." },
    { tipo: "lista", itens: ["item um", "item dois"] },
    { tipo: "p", texto: "Último." },
  ]);
  assert.deepEqual(paragrafosDoCorpo(""), []);
  assert.deepEqual(paragrafosDoCorpo("Intro:\n- a\n- b"), [
    { tipo: "p", texto: "Intro:" },
    { tipo: "lista", itens: ["a", "b"] },
  ]);
});

test("paragrafosDoCorpo não interpreta HTML", () => {
  const [bloco] = paragrafosDoCorpo("<img src=x onerror=alert(1)>");
  assert.deepEqual(bloco, { tipo: "p", texto: "<img src=x onerror=alert(1)>" });
});

test("linkDoWhatsapp codifica a mensagem", () => {
  assert.equal(
    linkDoWhatsapp("+55 (31) 99999-9999", "Olá! Quero saber do Phoebus & preço"),
    "https://wa.me/5531999999999?text=Ol%C3%A1!%20Quero%20saber%20do%20Phoebus%20%26%20pre%C3%A7o",
  );
  assert.equal(linkDoWhatsapp("5531999999999", ""), "https://wa.me/5531999999999");
});

test("lerVisitante acha mhs_vid entre outros cookies", () => {
  assert.equal(lerVisitante("_ga=GA1.2; mhs_vid=abc-123; outro=1"), "abc-123");
  assert.equal(lerVisitante("mhs_vid=abc-123"), "abc-123");
  assert.equal(lerVisitante("xmhs_vid=nao; mhs_pt=%7B%7D"), null);
  assert.equal(lerVisitante(""), null);
  assert.equal(lerVisitante("mhs_vid="), null);
});
