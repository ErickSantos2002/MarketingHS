// Todo evento que o builder de jornada oferece precisa ser EMITIDO por alguém.
//
// Até 02/10 o seletor oferecia `lead_created`, que nenhum gatilho nem rota
// grava: o banco emite `form_submitted` (`fn_lead_insert_event`). Jornada que
// entrava por "Lead criado" ficava ativa e vazia para sempre, sem erro (U4).
//
//   node --test scripts/journeys-eventos.test.mjs
//
// Confere cada `value` de EVENT_OPTIONS (src/lib/journeys.ts) contra o literal
// `'<evento>'` nas migrations e no código do backend.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const front = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backend = path.resolve(front, "..", "backend");

function arquivos(pasta, ext) {
  const saida = [];
  for (const nome of readdirSync(pasta)) {
    const p = path.join(pasta, nome);
    if (statSync(p).isDirectory()) saida.push(...arquivos(p, ext));
    else if (p.endsWith(ext)) saida.push(p);
  }
  return saida;
}

function eventosOferecidos() {
  const fonte = readFileSync(path.join(front, "src", "lib", "journeys.ts"), "utf8");
  const bloco = fonte.match(/export const EVENT_OPTIONS[^=]*=\s*\[([\s\S]*?)\n\];/);
  assert.ok(bloco, "EVENT_OPTIONS não encontrado em src/lib/journeys.ts");
  return [...bloco[1].matchAll(/value:\s*'([a-z_]+)'/g)].map((m) => m[1]);
}

const emissores = [
  ...arquivos(path.join(backend, "migrations"), ".sql"),
  ...arquivos(path.join(backend, "app"), ".py"),
].map((p) => readFileSync(p, "utf8")).join("\n");

test("o builder oferece o evento que o INSERT de lead grava", () => {
  const eventos = eventosOferecidos();
  assert.ok(eventos.includes("form_submitted"), "falta form_submitted");
  assert.ok(!eventos.includes("lead_created"), "lead_created não é emitido por ninguém");
});

test("todo evento oferecido é emitido pelo backend", () => {
  const orfaos = eventosOferecidos().filter((e) => !emissores.includes(`'${e}'`));
  assert.deepEqual(orfaos, [], `eventos sem emissor: ${orfaos.join(", ")}`);
});
