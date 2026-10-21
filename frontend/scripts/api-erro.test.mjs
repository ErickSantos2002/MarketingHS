// A mensagem de erro da API nunca pode ser "[object Object]".
//
// O FastAPI devolve `detail` em três formas: texto, `{mensagem, campos}`
// (captura e rotas da prova do RD) e a lista do 422 de validação. Antes o
// `ErroApi` recebia o objeto cru e o toast mostrava "[object Object]".
//
//   node --test scripts/api-erro.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

const { mensagemDoDetalhe, ErroApi } = await import("../src/lib/api.ts");

test("detail em texto passa como está", () => {
  assert.equal(mensagemDoDetalhe("Site não encontrado.", "Erro 404"), "Site não encontrado.");
});

test("detail {mensagem, campos} usa a mensagem", () => {
  const detail = { mensagem: "Para enviar, aceite a política de privacidade.", campos: { consentimento: "..." } };
  assert.equal(mensagemDoDetalhe(detail, "Erro 400"), "Para enviar, aceite a política de privacidade.");
});

test("lista do 422 junta os msg, sem repetir", () => {
  const detail = [
    { loc: ["body", "nome"], msg: "Field required", type: "missing" },
    { loc: ["body", "dominios"], msg: "Field required", type: "missing" },
    { loc: ["body", "url"], msg: "URL inválida", type: "value_error" },
  ];
  assert.equal(mensagemDoDetalhe(detail, "Erro 422"), "Field required; URL inválida");
});

test("forma desconhecida, vazia ou ausente cai no padrão", () => {
  for (const d of [null, undefined, "", "  ", {}, { campos: {} }, [], [{ loc: [] }], 42]) {
    assert.equal(mensagemDoDetalhe(d, "Erro 500"), "Erro 500");
  }
});

test("ErroApi guarda status e mensagem", () => {
  const e = new ErroApi(403, "Sem permissão.");
  assert.ok(e instanceof Error);
  assert.equal(e.status, 403);
  assert.equal(e.message, "Sem permissão.");
});
