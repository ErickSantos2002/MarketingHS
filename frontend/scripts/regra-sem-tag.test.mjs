// O formulário de regra de automação não oferece condição por tag (U5).
//
// O gatilho que avalia regras não tem ramo 'tag' e o backend recusa ao salvar
// e na prévia. O 8D tirou 'tag' da lista de tipos mas deixou o resto pronto
// para usá-la (operadores, lista de tags carregada do banco) — basta alguém
// devolver uma linha à lista para a regra que nunca dispara voltar à tela.
//
//   node --test scripts/regra-sem-tag.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const form = readFileSync(
  path.join(raiz, "src", "components", "admin", "automations", "AutomationRuleForm.tsx"),
  "utf8",
);
// Só código: os comentários contam a história da tag de propósito.
const codigo = form.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

test("os tipos de condição da regra não incluem tag", () => {
  const bloco = codigo.match(/const CONDITION_TYPES = \[([\s\S]*?)\];/);
  assert.ok(bloco, "CONDITION_TYPES não encontrado");
  assert.doesNotMatch(bloco[1], /'tag'/);
});

test("o formulário não tem operador nem lista de valores de tag", () => {
  assert.doesNotMatch(codigo, /^\s*tag:\s*\[/m, "OPERATORS_MAP ainda tem 'tag'");
  assert.doesNotMatch(codigo, /type === 'tag'/, "ainda monta valores para 'tag'");
  assert.doesNotMatch(codigo, /listarTags/, "ainda carrega as tags do banco");
});
