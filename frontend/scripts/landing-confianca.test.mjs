// Os tipos de seção da confiança (frente landing-confianca, 27/10):
// certificações, depoimentos e vídeo do YouTube — mais os dados fixos da casa
// que o rodapé mostra.
//
//   node --test scripts/landing-confianca.test.mjs
//
// Mesma régua do landing-secoes.test.mjs: nada que vem da config derruba a
// página, o que não se entende é descartado, e só http(s) vira `src`. O vídeo
// tem régua própria: só link de vídeo do YouTube, e a página monta a
// miniatura e o player a partir do id — nunca da URL colada.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  secoesDaConfig, idDoYoutube, miniaturaDoYoutube, playerDoYoutube, LIMITE_ITENS,
} from "../src/landing/secoes.ts";
import { CASA } from "../src/landing/casa.ts";

const ORIGEM = "https://marketinghs.exemplo.com";
const ler = (config) => secoesDaConfig(config, ORIGEM, "/api");
const PHOEBUS = JSON.parse(readFileSync(new URL("./landing-phoebus.json", import.meta.url), "utf8"));
const ID = "3md4Er-nXEA";

test("idDoYoutube: as quatro formas do YouTube dão o id", () => {
  for (const url of [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=12s`,
    `https://m.youtube.com/watch?v=${ID}`,
    `http://www.youtube.com/watch?feature=share&v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://youtube.com/shorts/${ID}/`,
    `https://www.youtube.com/embed/${ID}`,
    `  https://WWW.YOUTUBE.COM/watch?v=${ID}  `,
  ]) assert.equal(idDoYoutube(url), ID, url);
});

test("idDoYoutube: qualquer outra coisa é null", () => {
  for (const url of [
    "", "   ", null, undefined, 42, { url: `https://youtu.be/${ID}` }, [`https://youtu.be/${ID}`],
    `javascript:alert(1)//youtu.be/${ID}`,
    `data:text/html,https://youtu.be/${ID}`,
    `ftp://youtu.be/${ID}`,
    `//youtu.be/${ID}`,
    `youtu.be/${ID}`,
    `https://evil.com/watch?v=${ID}`,
    `https://www.youtube.com.evil.com/watch?v=${ID}`,
    `https://youtube.com@evil.com/watch?v=${ID}`,
    `https://user@youtu.be/${ID}`,
    `https://youtu.be:8443/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://vimeo.com/${ID}`,
    `https://www.youtube.com/watch?v=${ID.slice(0, 10)}`,       // 10 caracteres
    `https://www.youtube.com/watch?v=${ID}x`,                    // 12
    `https://www.youtube.com/watch?v=abc"onload=x`,
    `https://www.youtube.com/watch?id=${ID}`,
    `https://www.youtube.com/watch`,
    `https://www.youtube.com/channel/${ID}`,
    `https://www.youtube.com/shorts/${ID}/extra`,
    `https://www.youtube.com/embed/${ID}%2F`,
    `https://youtu.be/${ID}/x`,
    `https://youtu.be/`,
    `https://www.youtube.com/watch?v=${ID} x`,
    `https://www.youtube.com\\@evil.com/watch?v=${ID}`,
    // O que o URL do navegador "conserta" e o servidor recusa (revisão, 27/10):
    `https://www.youtube.com:443/watch?v=${ID}`,
    `https:/www.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/a/../watch?v=${ID}`,
    `https://www.youtube.com/a/%2E%2E/watch?v=${ID}`,
    `https://www.youtube.com/watch?v=&v=${ID}`,
  ]) assert.equal(idDoYoutube(url), null, String(url));
});

test("miniatura e player saem do id, em host fixo", () => {
  assert.equal(miniaturaDoYoutube(ID), `https://i.ytimg.com/vi/${ID}/maxresdefault.jpg`);
  assert.equal(miniaturaDoYoutube(ID, false), `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
  assert.match(playerDoYoutube(ID), new RegExp(`^https://www\\.youtube-nocookie\\.com/embed/${ID}\\?autoplay=1`));
});

test("vídeo: url ruim descarta a seção; texto vira blocos; formato só 'vertical' vale", () => {
  const secoes = ler({ secoes: [
    { tipo: "video", titulo: "Ruim", url: "https://evil.com/x.mp4" },
    { tipo: "video", titulo: "Sem url" },
    { tipo: "video", titulo: "Número", url: 42 },
    { tipo: "video", titulo: "Bom", url: `https://youtu.be/${ID}`, texto: "Um.\n\n- dois", formato: "vertical" },
    { tipo: "video", url: `https://www.youtube.com/embed/${ID}`, formato: "deitado" },
  ] });
  assert.equal(secoes.length, 2);
  assert.equal(secoes[0].titulo, "Bom");
  assert.equal(secoes[0].video, ID);
  assert.equal(secoes[0].tipo, "video");
  assert.equal(secoes[0].vertical, true);
  assert.deepEqual(secoes[0].blocos, [{ tipo: "p", texto: "Um." }, { tipo: "lista", itens: ["dois"] }]);
  assert.equal(secoes[1].vertical, false);
  assert.deepEqual(secoes[1].blocos, []);
  // O corpo leva o id do vídeo, não a URL colada.
  assert.equal(JSON.stringify(secoes).includes("youtu.be"), false);
});

test("o id da seção de vídeo não é confundido com o do YouTube", () => {
  // `Secao.id` é a key do React; o id do YouTube vai em `video`.
  const [s] = ler({ secoes: [{ id: "minha-secao", tipo: "video", url: `https://youtu.be/${ID}` }] });
  assert.equal(s.id, "minha-secao");
});

test("certificações: selo sem imagem (ou com imagem insegura) sai; o nome é opcional", () => {
  const [s] = ler({ secoes: [{ tipo: "certificacoes", titulo: "Qualidade", texto: "A.\n\nB.", itens: [
    { nome: "Sem imagem" },
    { nome: "Ruim", imagem_url: "javascript:alert(1)" },
    { nome: "ISO 9001", imagem_url: "https://cdn.exemplo.com/iso.png" },
    { nome: 7, imagem_url: "/publico/imagem/dot" },
    null, "x",
  ] }] });
  assert.deepEqual(s.itens, [
    { nome: "ISO 9001", imagem: "https://cdn.exemplo.com/iso.png" },
    { nome: "", imagem: "https://marketinghs.exemplo.com/api/publico/imagem/dot" },
  ]);
  assert.equal(s.blocos.length, 2);
  // Sem nenhum selo de verdade, a seção não aparece (texto sozinho não é prova).
  assert.deepEqual(ler({ secoes: [{ tipo: "certificacoes", texto: "Só texto", itens: [{ nome: "x" }] }] }), []);
});

test("depoimentos: precisa de texto e nome; aspas coladas saem; logo inseguro vira null", () => {
  const [s] = ler({ secoes: [{ tipo: "depoimentos", itens: [
    { texto: "Sem nome." },
    { nome: "Sem texto" },
    { texto: "  “Mudou o jogo.”  ", nome: " Antônio ", empresa: "VIX" },
    { texto: '"Aspas retas"', nome: "Ana", cargo: "Gerente", empresa: "Rumo", logo_url: "data:image/png;base64,xx" },
    { texto: "Com logo.", nome: "Bia", logo_url: "/publico/imagem/l" },
    { texto: 3, nome: "Número" },
  ] }] });
  assert.deepEqual(s.itens, [
    { texto: "Mudou o jogo.", nome: "Antônio", empresa: "VIX", cargo: "", logo: null },
    { texto: "Aspas retas", nome: "Ana", empresa: "Rumo", cargo: "Gerente", logo: null },
    { texto: "Com logo.", nome: "Bia", empresa: "", cargo: "", logo: "https://marketinghs.exemplo.com/api/publico/imagem/l" },
  ]);
  assert.deepEqual(ler({ secoes: [{ tipo: "depoimentos", itens: [{ texto: "x" }, { nome: "y" }] }] }), []);
});

test("depoimentos e selos respeitam o limite de itens", () => {
  const itens = Array.from({ length: 40 }, (_, i) => ({ texto: `T${i}`, nome: `N${i}`, imagem_url: "https://x.com/a.png" }));
  const [d, c] = ler({ secoes: [{ tipo: "depoimentos", itens }, { tipo: "certificacoes", itens }] });
  assert.equal(d.itens.length, LIMITE_ITENS);
  assert.equal(c.itens.length, LIMITE_ITENS);
});

test("o Phoebus: os três depoimentos reais (Antônio sem sobrenome nem cargo), três selos, vídeo em pé", () => {
  const secoes = ler(PHOEBUS);
  const dep = secoes.find((s) => s.tipo === "depoimentos");
  assert.deepEqual(dep.itens.map((i) => [i.nome, i.empresa, i.cargo]), [
    ["Silmara Dias", "COFCO International", ""],
    ["Antônio", "VIX", ""],
    ["Thaciane Cardoso", "Rumo Logística", ""],
  ]);
  assert.ok(dep.itens.every((i) => i.logo?.startsWith("http://127.0.0.1:8131/logos/")));
  const cert = secoes.find((s) => s.tipo === "certificacoes");
  assert.deepEqual(cert.itens.map((i) => i.nome), ["ISO 9001", "ISO/IEC 27001", "DOT/NHTSA"]);
  const video = secoes.find((s) => s.tipo === "video");
  assert.equal(video.video, ID);
  assert.equal(video.vertical, true);
});

test("a casa: os dados do rodapé, com tel: e links https", () => {
  assert.equal(CASA.nome, "Health & Safety");
  assert.match(CASA.endereco.rua, /Viscondessa do Livramento, 54/);
  assert.deepEqual(CASA.telefones.map((t) => t.rotulo), ["(81) 3052-3350", "(11) 3042-6479"]);
  for (const t of CASA.telefones) {
    assert.equal(t.numero, "+55" + t.rotulo.replace(/\D/g, ""));
  }
  assert.equal(CASA.instagram.url, "https://www.instagram.com/healthsafety.oficial/");
  assert.equal(CASA.site.url, "https://www.healthsafety.com.br");
});
