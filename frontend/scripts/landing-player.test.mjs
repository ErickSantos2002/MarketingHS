// O player fechado do YouTube (frente landing-nicholson, 27/10/2026):
// `node --test scripts/landing-player.test.mjs`. O que se prova aqui é a
// parte pura — as opções que fecham o player, o tempo, o seek e o fim. O
// player de verdade se confere no navegador (docs/frentes/landing-nicholson.md).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FOLGA_DO_FIM, MARGEM_DO_SEEK, SALTO, URL_DA_API, alvoDoSeek, chegouAoFim, formatarTempo,
  opcoesDoPlayer, progressoDaBarra, tempoPorExtenso,
} from "../src/landing/player.ts";

const ID = "sByexR1w9vw";

test("opções: youtube-nocookie, sem controles, teclado, tela cheia nem anotações", () => {
  const o = opcoesDoPlayer(ID, "https://marketinghs.healthsafetytech.com");
  assert.equal(o.videoId, ID);
  assert.equal(o.host, "https://www.youtube-nocookie.com");
  assert.deepEqual(o.playerVars, {
    autoplay: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, iv_load_policy: 3, playsinline: 1,
    modestbranding: 1, enablejsapi: 1, origin: "https://marketinghs.healthsafetytech.com",
  });
  assert.equal(URL_DA_API, "https://www.youtube.com/iframe_api");
});

test("tempo: m:ss, h:mm:ss, e lixo vira 0:00", () => {
  assert.equal(formatarTempo(0), "0:00");
  assert.equal(formatarTempo(5.9), "0:05");
  assert.equal(formatarTempo(65), "1:05");
  assert.equal(formatarTempo(600), "10:00");
  assert.equal(formatarTempo(3725), "1:02:05");
  for (const lixo of [NaN, -3, Infinity]) assert.equal(formatarTempo(lixo), "0:00");
});

test("tempo por extenso, para o leitor de tela", () => {
  assert.equal(tempoPorExtenso(0), "0 segundos");
  assert.equal(tempoPorExtenso(1), "1 segundo");
  assert.equal(tempoPorExtenso(65), "1 minuto e 5 segundos");
  assert.equal(tempoPorExtenso(120), "2 minutos");
  assert.equal(tempoPorExtenso(3661), "1 hora, 1 minuto e 1 segundo");
});

test("seek: nunca negativo, nunca dentro da folga do fim", () => {
  assert.equal(SALTO, 10);
  assert.equal(alvoDoSeek(-5, 100), 0);
  assert.equal(alvoDoSeek(50, 100), 50);
  assert.equal(alvoDoSeek(100, 100), 100 - MARGEM_DO_SEEK);
  assert.equal(alvoDoSeek(95 + SALTO, 100), 100 - MARGEM_DO_SEEK);
  // A margem do seek é maior que a folga do fim: o seek mais longe possível
  // não encerra o vídeo na hora.
  assert.ok(MARGEM_DO_SEEK > FOLGA_DO_FIM);
  assert.equal(chegouAoFim(alvoDoSeek(1e9, 100), 100), false);
  // Sem duração (o player ainda não sabe), só não deixa ficar negativo.
  assert.equal(alvoDoSeek(30, 0), 30);
  assert.equal(alvoDoSeek(NaN, 100), 0);
});

test("fim: a menos de 1,5 s do fim (a API arredonda a duração), e só com duração conhecida", () => {
  // O sByexR1w9vw: a API diz 30 s, o vídeo acaba em 29,00 s. A folga tem de
  // começar antes do fim de verdade, com uma leitura (250 ms) de sobra.
  assert.ok(chegouAoFim(29 - 0.25, 30));
  assert.equal(chegouAoFim(98.6, 100), true);
  assert.equal(chegouAoFim(100, 100), true);
  assert.equal(chegouAoFim(98.4, 100), false);
  assert.equal(chegouAoFim(0, 0), false);
  assert.equal(chegouAoFim(NaN, 100), false);
});

// 29/10: a linha branca andava na frente da bolinha. A linha ia de 0 a 100%
// do trilho; o centro da bolinha (16 px) anda de 8 px a 100% − 8 px.
test("progressoDaBarra: a linha acaba no centro da bolinha", () => {
  assert.equal(progressoDaBarra(0, 28.97), "calc(8px + (100% - 16px) * 0)");
  assert.equal(progressoDaBarra(28.97, 28.97), "calc(8px + (100% - 16px) * 1)");
  assert.equal(progressoDaBarra(14.485, 28.97), "calc(8px + (100% - 16px) * 0.5)");
});

test("progressoDaBarra: sem duração ou fora da faixa", () => {
  assert.equal(progressoDaBarra(5, 0), "calc(8px + (100% - 16px) * 0)");
  assert.equal(progressoDaBarra(40, 28.97), "calc(8px + (100% - 16px) * 1)");
  assert.equal(progressoDaBarra(Number.NaN, 28.97), "calc(8px + (100% - 16px) * 0)");
});
