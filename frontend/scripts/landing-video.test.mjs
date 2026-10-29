// O vídeo hospedado na landing (frente video-proprio, 29/10/2026):
//
//   node --test scripts/landing-video.test.mjs
//
// A seção `video` passa a aceitar, além do link do YouTube, um arquivo
// subido pelo editor (`arquivo_url` = `/publico/video/<uuid>`) e uma capa
// (`imagem_url`). Com arquivo, a página toca num `<video>` nosso; sem, o
// YouTube como antes. A régua do arquivo é estreita: só o caminho da nossa
// rota com um uuid — a página monta o endereço a partir do id, nunca usa o
// texto colado (mesma ideia do id do YouTube).
import { test } from "node:test";
import assert from "node:assert/strict";
import { secoesDaConfig, secaoVazia, idDoVideoHospedado } from "../src/landing/secoes.ts";
import { alvoNoArquivo } from "../src/landing/player.ts";

const ORIGEM = "https://marketinghs.exemplo.com";
const ler = (config) => secoesDaConfig(config, ORIGEM, "/api");
const UUID = "3f2b8c1e-5a4d-4e8f-9b1a-0c2d3e4f5a6b";
const YT = "sByexR1w9vw";

test("idDoVideoHospedado: só o caminho da nossa rota, com uuid", () => {
  assert.equal(idDoVideoHospedado(`/publico/video/${UUID}`), UUID);
  assert.equal(idDoVideoHospedado(`  /publico/video/${UUID.toUpperCase()}  `), UUID);
  for (const ruim of [
    "", null, 42, {}, `/publico/video/${UUID}/x`, `/publico/video/${UUID}?a=1`,
    `https://evil.com/publico/video/${UUID}`, `//evil.com/publico/video/${UUID}`,
    "/publico/video/nao-e-uuid", `/publico/imagem/${UUID}`, `javascript:/publico/video/${UUID}`,
    `/api/publico/video/${UUID}`,
  ]) assert.equal(idDoVideoHospedado(ruim), null, String(ruim));
});

test("com arquivo: toca o nosso, com a capa; o endereço sai do id", () => {
  const [s] = ler({ secoes: [{
    tipo: "video", titulo: "Veja", arquivo_url: `/publico/video/${UUID}`,
    imagem_url: `/publico/imagem/${UUID}`, url: `https://youtu.be/${YT}`,
  }] });
  assert.equal(s.tipo, "video");
  assert.equal(s.arquivo, `/api/publico/video/${UUID}`);
  assert.equal(s.capa, `${ORIGEM}/api/publico/imagem/${UUID}`);
  // O arquivo vence o YouTube: com os dois, o nosso toca.
  assert.equal(s.video, "");
});

test("arquivo ruim cai no YouTube; sem os dois, a seção sai", () => {
  const secoes = ler({ secoes: [
    { tipo: "video", titulo: "A", arquivo_url: "https://evil.com/x.mp4", url: `https://youtu.be/${YT}` },
    { tipo: "video", titulo: "B", arquivo_url: "https://evil.com/x.mp4" },
    { tipo: "video", titulo: "C", arquivo_url: "" },
  ] });
  assert.equal(secoes.length, 1);
  assert.equal(secoes[0].titulo, "A");
  assert.equal(secoes[0].video, YT);
  assert.equal(secoes[0].arquivo, null);
});

test("capa insegura sai; capa http(s) fica", () => {
  const [a, b] = ler({ secoes: [
    { tipo: "video", arquivo_url: `/publico/video/${UUID}`, imagem_url: "javascript:alert(1)" },
    { tipo: "video", arquivo_url: `/publico/video/${UUID}`, imagem_url: "https://cdn.exemplo.com/capa.jpg" },
  ] });
  assert.equal(a.capa, null);
  assert.equal(b.capa, "https://cdn.exemplo.com/capa.jpg");
});

test("página antiga (só YouTube) continua igual", () => {
  const [s] = ler({ secoes: [{ tipo: "video", url: `https://youtu.be/${YT}`, formato: "vertical" }] });
  assert.equal(s.video, YT);
  assert.equal(s.arquivo, null);
  assert.equal(s.capa, null);
  assert.equal(s.vertical, true);
});

test("seção nova nasce com arquivo e capa vazios (e não aparece)", () => {
  const s = secaoVazia("video", "v1");
  assert.equal(s.arquivo_url, "");
  assert.equal(s.imagem_url, "");
  assert.deepEqual(ler({ secoes: [s] }), []);
});

test("alvoNoArquivo: entre 0 e a duração (sem a folga do YouTube)", () => {
  assert.equal(alvoNoArquivo(-5, 30), 0);
  assert.equal(alvoNoArquivo(12, 30), 12);
  assert.equal(alvoNoArquivo(45, 30), 30);
  assert.equal(alvoNoArquivo(NaN, 30), 0);
  assert.equal(alvoNoArquivo(8, 0), 8);     // sem duração ainda: só não fica negativo
});
