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
  MENSAGEM_CONVITE,
  idDoCampo,
  PREFIXO_DO_ID_NO_MODAL,
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

// Pedido do Erick (29/10, landing phoebus): o formulário da página fica com
// nome/e-mail/WhatsApp/empresa/cargo; as perguntas de qualificação são só do
// modal, em `agendamento.campos`.
const PHOEBUS = {
  campos: [
    { chave: "nome", rotulo: "Nome", tipo: "texto", obrigatorio: true },
    { chave: "email", rotulo: "E-mail corporativo", tipo: "email", obrigatorio: true },
    { chave: "whatsapp", rotulo: "WhatsApp", tipo: "telefone", obrigatorio: true },
    { chave: "empresa", rotulo: "Empresa", tipo: "texto", obrigatorio: true },
    { chave: "cargo", rotulo: "Cargo", tipo: "texto", obrigatorio: false },
  ],
  agendamento: {
    ativo: true, faixas_que_agendam: ["401 a 1.000", "Mais de 1.000"],
    campos: [
      { chave: "funcionarios", rotulo: "Quantos funcionários a empresa tem?", tipo: "lista",
        obrigatorio: true, opcoes: FAIXAS },
      { chave: "testes_por_dia", rotulo: "Quantas pessoas passariam pelo teste por dia?",
        tipo: "lista", obrigatorio: false, opcoes: ["Até 50", "51 a 200", "201 a 1.000", "Mais de 1.000"] },
      { chave: "filiais", rotulo: "Quantas filiais?", tipo: "lista", obrigatorio: false,
        opcoes: ["Só a matriz", "2 a 5", "6 a 20", "Mais de 20"] },
    ],
  },
};

test("camposDaEtapa2 junta os da página com os só do agendamento", () => {
  const etapa2 = camposDaEtapa2(PHOEBUS);
  assert.deepEqual(etapa2.map((c) => c.chave),
    ["empresa", "cargo", "funcionarios", "testes_por_dia", "filiais"]);
  const porte = etapa2.find((c) => c.chave === "funcionarios");
  assert.equal(porte.obrigatorio, true);
  assert.deepEqual(porte.opcoes, FAIXAS);
});

test("camposDaEtapa2: chave repetida fica a da página; etapa 1 e e-mail nunca entram", () => {
  const config = {
    campos: [...PHOEBUS.campos, { chave: "filiais", rotulo: "Filiais (página)", tipo: "texto" }],
    agendamento: { ...PHOEBUS.agendamento, campos: [
      ...PHOEBUS.agendamento.campos,
      { chave: "nome", rotulo: "Outro nome", tipo: "texto" },
      { chave: "whatsapp", rotulo: "Outro whats", tipo: "telefone" },
    ] },
  };
  const etapa2 = camposDaEtapa2(config);
  assert.deepEqual(etapa2.map((c) => c.chave),
    ["empresa", "cargo", "filiais", "funcionarios", "testes_por_dia"]);
  assert.equal(etapa2.find((c) => c.chave === "filiais").rotulo, "Filiais (página)");
});

test("camposDaEtapa2: agendamento.campos vazio ou inválido não traz os campos padrão", () => {
  for (const campos of [undefined, [], [{ chave: "x" }], "lixo"]) {
    const config = { ...PHOEBUS, agendamento: { ...PHOEBUS.agendamento, campos } };
    assert.deepEqual(camposDaEtapa2(config).map((c) => c.chave), ["empresa", "cargo"]);
  }
});

test("o formulário da página não vê os campos só do agendamento", async () => {
  const { camposDaConfig } = await import("../src/landing/campos.ts");
  assert.deepEqual(camposDaConfig(PHOEBUS).map((c) => c.chave),
    ["nome", "email", "whatsapp", "empresa", "cargo"]);
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

// Ajustes do teste na homologação (28/10).
test("a confirmação diz que o convite VAI chegar (a fila manda segundos depois)", () => {
  assert.equal(MENSAGEM_CONVITE, "O convite com o link da sala vai chegar no seu e-mail em instantes.");
  const modal = readFileSync(path.join(raiz, "src", "landing", "Agendamento.tsx"), "utf8");
  assert.doesNotMatch(modal, /chegou no seu e-mail/);
  assert.match(modal, /\{MENSAGEM_CONVITE\}/);
});

test("os campos do modal têm id próprio, não o do formulário da página", () => {
  assert.equal(idDoCampo("nome"), "campo-nome");
  assert.equal(idDoCampo("nome", PREFIXO_DO_ID_NO_MODAL), "agendamento-campo-nome");
  assert.notEqual(idDoCampo("email", PREFIXO_DO_ID_NO_MODAL), idDoCampo("email"));
  const modal = readFileSync(path.join(raiz, "src", "landing", "Agendamento.tsx"), "utf8");
  const controles = modal.match(/<Controle\b[\s\S]*?\/>/g) ?? [];
  assert.ok(controles.length >= 2);
  for (const c of controles) assert.match(c, /prefixoDoId=\{PREFIXO_DO_ID_NO_MODAL\}/);
  const form = readFileSync(path.join(raiz, "src", "landing", "Formulario.tsx"), "utf8");
  assert.match(form, /const id = idDoCampo\(campo\.chave, prefixoDoId\)/);
});
