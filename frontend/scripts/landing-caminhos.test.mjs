// Teste do bundle público: toda chamada da landing ao backend passa por /api.
//
// Em produção o nginx só repassa /api/, /p/ e /landing/ — um fetch direto em
// "/publico/..." cai no SPA e volta 405, e a landing deixa de captar sem
// nenhum erro no painel (raio-x de 02/10, item U1).
//
//   node --test scripts/landing-caminhos.test.mjs
//
// Confere o código-fonte de src/landing/ e, se existir, o dist-landing/main.js
// já construído (rode `npm run build:landing` antes para conferir o bundle).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pastaLanding = path.join(raiz, "src", "landing");

// Literal de caminho que começa direto em /publico (sem /api na frente).
const SEM_API = /["'`]\/publico\//;

test("src/landing não chama /publico sem o prefixo /api", () => {
  for (const nome of readdirSync(pastaLanding)) {
    if (!/\.(ts|tsx)$/.test(nome)) continue;
    const texto = readFileSync(path.join(pastaLanding, nome), "utf8");
    assert.doesNotMatch(texto, SEM_API, `${nome} tem caminho /publico sem /api`);
  }
});

test("o formulário da landing posta em /api/publico/captura", () => {
  const texto = readFileSync(path.join(pastaLanding, "Formulario.tsx"), "utf8");
  assert.match(texto, /\$\{BASE\}\/publico\/captura/);
  assert.match(texto, /VITE_API_URL \?\? ["']\/api["']/);
});

test("o bundle construído (dist-landing) usa /api/publico/captura", (t) => {
  const bundle = path.join(raiz, "dist-landing", "main.js");
  if (!existsSync(bundle)) return t.skip("dist-landing/main.js não construído");
  const texto = readFileSync(bundle, "utf8");
  assert.doesNotMatch(texto, SEM_API, "bundle tem /publico sem /api");
  assert.match(texto, /\/api/);
  assert.match(texto, /\/publico\/captura/);
});
