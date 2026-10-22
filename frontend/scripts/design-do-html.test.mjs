// Template sem design abre no editor com o HTML original, não com o padrão.
//
// Até 22/10/2026 o TemplateEditor fazia `t.design || BASE_EMAIL_DESIGN`: o
// template criado por script tinha `html` e `design` nulo, abria o modelo
// padrão e o "Salvar" gravava o padrão por cima do HTML. `designDoHtml.ts` só
// usa sintaxe apagável e não importa nada: o Node 24 roda direto.
//
//   node --test scripts/design-do-html.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

const { designDoHtml, designDoTemplate } = await import(
  "../src/components/admin/campaigns/designDoHtml.ts"
);

// Todos os conteúdos de todas as colunas de todas as linhas.
function conteudos(design) {
  return design.body.rows.flatMap((r) => r.columns.flatMap((c) => c.contents));
}

function blocoHtml(design) {
  assert.equal(design.body.rows.length, 1, "uma linha só");
  assert.deepEqual(design.body.rows[0].cells, [1]);
  assert.equal(design.body.rows[0].columns.length, 1, "uma coluna só");
  const todos = conteudos(design);
  assert.equal(todos.length, 1, "um conteúdo só");
  assert.equal(todos[0].type, "html");
  return todos[0].values.html;
}

test("fragmento entra no bloco como veio", () => {
  const html = '<table><tr><td><p>Olá, {{nome}}!</p></td></tr></table>';
  assert.equal(blocoHtml(designDoHtml(html)), html);
});

test("documento completo: só o miolo do body", () => {
  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>x</title></head>
<body style="margin:0"><div class="c">Conteúdo <a href="{{unsubscribe_url}}">sair</a></div></body></html>`;
  const miolo = blocoHtml(designDoHtml(html));
  assert.equal(miolo, '<div class="c">Conteúdo <a href="{{unsubscribe_url}}">sair</a></div>');
  assert.doesNotMatch(miolo, /<html|<head|<body|<title|<meta/i);
});

test("documento com <style> no head: o estilo vai junto, na frente", () => {
  const html = `<html><head>
<style type="text/css">.c { color: red; }</style>
<style>@media (max-width:600px){ .c { width:100% } }</style>
</head><body><div class="c">Oi</div></body></html>`;
  const miolo = blocoHtml(designDoHtml(html));
  assert.match(miolo, /^<style type="text\/css">\.c \{ color: red; \}<\/style>/);
  assert.match(miolo, /@media \(max-width:600px\)/);
  assert.ok(miolo.endsWith('<div class="c">Oi</div>'));
  assert.ok(miolo.indexOf("<style") < miolo.indexOf("<div"));
});

test("fragmento com <style> próprio fica intacto", () => {
  const html = '<style>.x{color:blue}</style><p class="x">Oi</p>';
  assert.equal(blocoHtml(designDoHtml(html)), html);
});

test("string vazia: ainda um bloco html, vazio", () => {
  assert.equal(blocoHtml(designDoHtml("")), "");
});

test("designDoTemplate: design salvo vence", () => {
  const design = { body: { rows: [] } };
  const r = designDoTemplate({ design, html: "<p>x</p>" }, "PADRAO");
  assert.equal(r.design, design);
  assert.equal(r.doHtml, false);
});

test("designDoTemplate: sem design e com html, embrulha o html", () => {
  const r = designDoTemplate({ design: null, html: "<p>original</p>" }, "PADRAO");
  assert.equal(r.doHtml, true);
  assert.equal(blocoHtml(r.design), "<p>original</p>");
});

test("designDoTemplate: nada salvo, cai no padrão", () => {
  for (const html of [null, undefined, "", "   \n"]) {
    const r = designDoTemplate({ design: null, html }, "PADRAO");
    assert.equal(r.design, "PADRAO");
    assert.equal(r.doHtml, false);
  }
});
