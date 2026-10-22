// Todo tipo de nó que o construtor oferece precisa ser ACEITO pelo banco.
//
// `JourneyNodeType` (src/lib/journeys.ts) e a lista do `NOT IN (...)` de
// `validate_journey_graph` andam juntos: tipo que a tela deixa montar e o
// banco recusa é fluxo que não salva — com erro em inglês de plpgsql. Na
// prova do RD entram `notify_email` e `webhook` (migration 027).
//
//   node --test scripts/journeys-nos.test.mjs
//
// Confere contra a migration MAIS NOVA que (re)define a função — é ela que
// vale no banco.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const front = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrations = path.resolve(front, "..", "backend", "migrations");
const fonte = readFileSync(path.join(front, "src", "lib", "journeys.ts"), "utf8");

function tiposDaTela() {
  const bloco = fonte.match(/export type JourneyNodeType\s*=([\s\S]*?);/);
  assert.ok(bloco, "JourneyNodeType não encontrado em src/lib/journeys.ts");
  return [...bloco[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

function tiposDoBanco() {
  const arquivos = readdirSync(migrations).filter((n) => n.endsWith(".sql")).sort();
  let corpo = null;
  let origem = null;
  for (const nome of arquivos) {
    const sql = readFileSync(path.join(migrations, nome), "utf8");
    const achado = sql.match(
      /CREATE (?:OR REPLACE )?FUNCTION public\.validate_journey_graph\([\s\S]*?\$\$([\s\S]*?)\$\$/,
    );
    if (achado) { corpo = achado[1]; origem = nome; }
  }
  assert.ok(corpo, "validate_journey_graph não encontrada nas migrations");
  const lista = corpo.match(/v_type NOT IN\s*\(([\s\S]*?)\)/);
  assert.ok(lista, `lista de tipos não encontrada em ${origem}`);
  return { origem, tipos: [...lista[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) };
}

test("a tela oferece os nós da prova do RD", () => {
  const tipos = tiposDaTela();
  assert.ok(tipos.includes("notify_email"), "falta notify_email");
  assert.ok(tipos.includes("webhook"), "falta webhook");
});

test("todo tipo de nó da tela é aceito por validate_journey_graph", () => {
  const { origem, tipos } = tiposDoBanco();
  const recusados = tiposDaTela().filter((t) => !tipos.includes(t));
  assert.deepEqual(recusados, [], `recusados por ${origem}: ${recusados.join(", ")}`);
});

test("todo tipo de nó tem rótulo em NODE_LABELS", () => {
  const bloco = fonte.match(/export const NODE_LABELS[^=]*=\s*\{([\s\S]*?)\n\};/);
  assert.ok(bloco, "NODE_LABELS não encontrado");
  const comRotulo = [...bloco[1].matchAll(/^\s*([a-z_]+):\s*'[^']+'/gm)].map((m) => m[1]);
  const sem = tiposDaTela().filter((t) => !comRotulo.includes(t));
  assert.deepEqual(sem, [], `sem rótulo: ${sem.join(", ")}`);
});

// ---- funções puras de src/lib/journeys.ts (sintaxe apagável, sem import) ----
const journeys = await import("../src/lib/journeys.ts");

test("buildEntryConfig: página e formulários só no form_submitted", () => {
  const { buildEntryConfig } = journeys;
  assert.deepEqual(buildEntryConfig("form_submitted"), { event_type: "form_submitted" });
  assert.deepEqual(
    buildEntryConfig("form_submitted", "phoebus-prova", [" prova_cap_phoebus ", "", "prova_cap_phoebus"]),
    { event_type: "form_submitted", page_slug: "phoebus-prova", form_ids: ["prova_cap_phoebus"] },
  );
  assert.deepEqual(buildEntryConfig("form_submitted", "", ["prova_ficha_phoebus"]),
    { event_type: "form_submitted", form_ids: ["prova_ficha_phoebus"] });
  assert.deepEqual(buildEntryConfig("email_opened", "x", ["y"]), { event_type: "email_opened" });
});

test("readEntryFormIds só aceita lista de texto", () => {
  assert.deepEqual(journeys.readEntryFormIds({ form_ids: ["a", 3, "b"] }), ["a", "b"]);
  assert.deepEqual(journeys.readEntryFormIds({ form_ids: "a" }), []);
  assert.deepEqual(journeys.readEntryFormIds(null), []);
});

test("lista do modo teste: apara, minúscula, sem repetido, e não engole inválido", () => {
  const { validos, invalidos } = journeys.lerListaDeEmails(
    " Erick@HealthSafety.com.br \n erick@healthsafety.com.br, outro@x.com; nao-e-email ",
  );
  assert.deepEqual(validos, ["erick@healthsafety.com.br", "outro@x.com"]);
  assert.deepEqual(invalidos, ["nao-e-email"]);
  assert.deepEqual(journeys.lerListaDeEmails("   "), { validos: [], invalidos: [] });
});

test("webhook exige https", () => {
  assert.equal(journeys.webhookValido("https://n8n.exemplo.com/webhook/x"), true);
  assert.equal(journeys.webhookValido("http://n8n.exemplo.com/webhook/x"), false);
  assert.equal(journeys.webhookValido("n8n.exemplo.com"), false);
  assert.equal(journeys.webhookValido(""), false);
});
