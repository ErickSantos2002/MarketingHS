// O login devolve a pessoa para onde ela ia (A6, achado da prova: o link
// `/contacts?contato=<id>` do aviso interno caía no painel depois do login).
//
//   node --test scripts/login-destino.test.mjs
//
// O destino viaja no `state` do redirecionamento — e só caminho interno vale:
// `//outro.site` e `/\outro.site` são URL de outro host para o navegador.
import { test } from "node:test";
import assert from "node:assert/strict";

const { destinoDoLogin, destinoSeguro } = await import("../src/lib/destino.ts");

test("o destino leva caminho, query e âncora", () => {
  assert.equal(destinoDoLogin({ pathname: "/contacts", search: "?contato=abc", hash: "" }),
    "/contacts?contato=abc");
  assert.equal(destinoDoLogin({ pathname: "/pages/x", search: "", hash: "#numeros" }),
    "/pages/x#numeros");
});

test("caminho interno passa", () => {
  assert.equal(destinoSeguro("/contacts?contato=abc"), "/contacts?contato=abc");
  assert.equal(destinoSeguro("/"), "/");
});

test("o que não é caminho interno vira a raiz", () => {
  for (const ruim of ["//evil.example", "/\\evil.example", "https://evil.example/x",
    "javascript:alert(1)", "contacts", "/\t/evil.example", "/\n/evil.example", "", null, undefined, 42, { de: "/x" }]) {
    assert.equal(destinoSeguro(ruim), "/", String(ruim));
  }
});

test("voltar para o próprio login não faz laço", () => {
  assert.equal(destinoSeguro("/login"), "/");
  assert.equal(destinoSeguro("/login?x=1"), "/");
});
