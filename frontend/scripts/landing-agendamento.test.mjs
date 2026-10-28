// O agendamento de reunião na landing (frente agendamento, 28/10/2026): as
// regras puras do modal.
//
//   node --test scripts/landing-agendamento.test.mjs
//
// `src/landing/agendamento.ts` só usa sintaxe apagável e importa só
// `campos.ts`: o Node tira os tipos e roda direto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  agendamentoAtivo,
  podeAgendar,
  camposDaEtapa1,
  camposDaEtapa2,
  rotuloDoHorario,
  rotuloDoDia,
  diaDeBrasilia,
  semanasDoMes,
  duracaoDaReuniao,
  MENSAGEM_JA_TEM,
  MENSAGEM_CONTATO,
  mensagemDoErroAoConfirmar,
} from "../src/landing/agendamento.ts";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FAIXAS = ["Até 100", "101 a 400", "401 a 1.000", "Mais de 1.000"];
const CONFIG = {
  campos: [
    { chave: "nome", rotulo: "Nome", tipo: "texto", obrigatorio: true },
    { chave: "email", rotulo: "E-mail", tipo: "email", obrigatorio: true },
    { chave: "whatsapp", rotulo: "WhatsApp", tipo: "telefone", obrigatorio: false },
    { chave: "empresa", rotulo: "Empresa", tipo: "texto", obrigatorio: true },
    { chave: "funcionarios", rotulo: "Funcionários", tipo: "lista", obrigatorio: true,
      opcoes: FAIXAS },
    { chave: "filiais", rotulo: "Filiais", tipo: "lista", obrigatorio: false,
      opcoes: ["Só a matriz", "2 a 5"] },
  ],
  agendamento: { ativo: true, faixas_que_agendam: ["401 a 1.000", "Mais de 1.000"],
                 duracao_min: 60 },
};

test("agendamentoAtivo exige ativo e faixas", () => {
  assert.equal(agendamentoAtivo(CONFIG), true);
  assert.equal(agendamentoAtivo({ ...CONFIG, agendamento: { ativo: true } }), false);
  assert.equal(agendamentoAtivo({ ...CONFIG, agendamento: { ativo: true, faixas_que_agendam: [] } }), false);
  assert.equal(agendamentoAtivo({ ...CONFIG, agendamento: { ...CONFIG.agendamento, ativo: false } }), false);
  assert.equal(agendamentoAtivo({}), false);
});

test("podeAgendar pela faixa do campo de porte", () => {
  assert.equal(podeAgendar(CONFIG, { funcionarios: "401 a 1.000" }), true);
  assert.equal(podeAgendar(CONFIG, { funcionarios: "Mais de 1.000" }), true);
  assert.equal(podeAgendar(CONFIG, { funcionarios: "101 a 400" }), false);
  assert.equal(podeAgendar(CONFIG, {}), false);
  const outroCampo = { ...CONFIG, agendamento: { ...CONFIG.agendamento, campo_porte: "porte" } };
  assert.equal(podeAgendar(outroCampo, { funcionarios: "401 a 1.000" }), false);
  assert.equal(podeAgendar(outroCampo, { porte: "401 a 1.000" }), true);
});

test("camposDaEtapa2 tira nome, e-mail e WhatsApp", () => {
  assert.deepEqual(camposDaEtapa2(CONFIG).map((c) => c.chave), ["empresa", "funcionarios", "filiais"]);
});

test("camposDaEtapa1 tem os três, obrigatórios, mesmo se a página não pede", () => {
  const etapa1 = camposDaEtapa1(CONFIG);
  assert.deepEqual(etapa1.map((c) => c.chave), ["nome", "email", "whatsapp"]);
  assert.ok(etapa1.every((c) => c.obrigatorio));
  assert.equal(etapa1[2].tipo, "telefone");
  const semWhats = camposDaEtapa1({ campos: [CONFIG.campos[1]] });
  assert.deepEqual(semWhats.map((c) => c.chave), ["nome", "email", "whatsapp"]);
});

test("rotuloDoHorario mostra Brasília: 2026-10-29T15:00:00Z -> 12:00", () => {
  assert.equal(rotuloDoHorario("2026-10-29T15:00:00Z"), "12:00");
  assert.equal(rotuloDoHorario("2026-10-30T00:00:00Z"), "21:00");
});

test("rotuloDoDia: 2026-10-29 -> quinta-feira, 29 de outubro", () => {
  assert.equal(rotuloDoDia("2026-10-29"), "quinta-feira, 29 de outubro");
});

test("o dia é o de Brasília, não o de UTC", () => {
  assert.equal(diaDeBrasilia("2026-10-30T00:00:00Z"), "2026-10-29");
});

test("semanas do mês começam no domingo", () => {
  const out = semanasDoMes(2026, 10); // 01/10/2026 é quinta
  assert.deepEqual(out[0], [null, null, null, null, "2026-10-01", "2026-10-02", "2026-10-03"]);
  assert.equal(out.flat().filter(Boolean).length, 31);
  assert.ok(out.every((s) => s.length === 7));
});

test("duração da config, 60 por padrão", () => {
  assert.equal(duracaoDaReuniao(CONFIG), 60);
  assert.equal(duracaoDaReuniao({ agendamento: { ativo: true, duracao_min: 30 } }), 30);
  assert.equal(duracaoDaReuniao({ agendamento: { ativo: true, duracao_min: "x" } }), 60);
});

test("ja_tem não mostra dia nem hora (o convite está no e-mail)", () => {
  assert.match(MENSAGEM_JA_TEM, /convite/);
  assert.doesNotMatch(MENSAGEM_JA_TEM, /\d/);
});

test("o modal chama /api/publico/agendamento", () => {
  const texto = readFileSync(path.join(raiz, "src", "landing", "agendamento.ts"), "utf8");
  assert.match(texto, /VITE_API_URL \?\? "\/api"/);
  assert.match(texto, /\$\{BASE\}\/publico\/agendamento/);
  const modal = readFileSync(path.join(raiz, "src", "landing", "Agendamento.tsx"), "utf8");
  assert.doesNotMatch(modal, /["'`]\/publico\//);
  assert.doesNotMatch(modal, /dangerouslySetInnerHTML/);
});

test("404 ao confirmar (rascunho que a varredura já virou lead comum) termina em contato", () => {
  assert.equal(mensagemDoErroAoConfirmar(404, "Não encontrado."), MENSAGEM_CONTATO);
  assert.equal(mensagemDoErroAoConfirmar(422, "Esse horário não está disponível."),
               "Esse horário não está disponível.");
  assert.equal(mensagemDoErroAoConfirmar(0, ""), null);
});
