#!/usr/bin/env node
// Conferência de tela com navegador próprio — para as frentes paralelas, que
// não podem dividir o navegador do Playwright MCP da sessão.
//
//   node scripts/conferir-telas.mjs --porta 8081 --saida <pasta> /settings /pages
//   node scripts/conferir-telas.mjs --base https://homo-marketinghs.healthsafetytech.com --saida <pasta> /
//
// Para cada rota: tema claro e escuro, 1440 e 390 px. Salva um PNG por
// combinação e um resumo.json com scrollWidth, erros e avisos de console.
// Só navega e lê: nunca clica (regra de só leitura em produção).
//
// Login com a conta admin do Claude, lida aqui dentro de
// ~/.config/marketinghs/claude-admin.env. ⚠️ Nada deste script imprime a
// credencial nem o token; não acrescente log que imprima.
//
// Precisa de: npm i --prefix .ferramentas playwright-core@1.61.0 (uma vez,
// na checkout principal) e do Google Chrome do sistema.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const opc = (nome, padrao) => {
  const i = args.indexOf(`--${nome}`);
  if (i === -1) return padrao;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const porta = opc('porta', '8080');
const saida = path.resolve(opc('saida', 'conferencia'));
const temas = opc('temas', 'claro,escuro').split(',');
const larguras = opc('larguras', '1440,390').split(',').map(Number);
const rotas = args.length ? args : ['/'];
// --base aponta para um ambiente publicado (ex.: o Homo); sem ela, o Vite local.
const base = opc('base', `http://127.0.0.1:${porta}`);

// node_modules e .ferramentas moram na checkout principal, mesmo numa worktree.
const principal = path.dirname(
  execSync('git rev-parse --path-format=absolute --git-common-dir').toString().trim());
const require = createRequire(path.join(principal, '.ferramentas', 'x.js'));
const { chromium } = require('playwright-core');

// Token reaproveitado por 1 h: /auth/login tem limite de taxa por IP e várias
// frentes logando a cada conferência esbarrariam nele.
// Um token por ambiente: cada um tem o próprio JWT_SECRET.
const arqToken = path.join(principal, '.ferramentas',
  base.startsWith('http://127.0.0.1') ? 'token' : `token-${new URL(base).host}`);
async function token() {
  if (existsSync(arqToken) && Date.now() - statSync(arqToken).mtimeMs < 3600e3) {
    return readFileSync(arqToken, 'utf8').trim();
  }
  const env = Object.fromEntries(
    readFileSync(path.join(homedir(), '.config/marketinghs/claude-admin.env'), 'utf8')
      .split('\n').filter((l) => /^\w+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: env.MKT_ADMIN_EMAIL, senha: env.MKT_ADMIN_SENHA }),
  });
  if (!r.ok) throw new Error(`login falhou: HTTP ${r.status}`);
  const t = (await r.json()).token;
  writeFileSync(arqToken, t, { mode: 0o600 });
  return t;
}

mkdirSync(saida, { recursive: true });
const tk = await token();
const navegador = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const resumo = [];
for (const rota of rotas) {
  for (const tema of temas) {
    for (const largura of larguras) {
      const ctx = await navegador.newContext({ viewport: { width: largura, height: 900 } });
      await ctx.addInitScript(([t, tm]) => {
        localStorage.setItem('marketinghs-token', t);
        localStorage.setItem('marketinghs-tema', tm);
      }, [tk, tema]);
      const pagina = await ctx.newPage();
      const console_ = [];
      pagina.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') console_.push(`${m.type()}: ${m.text()}`);
      });
      pagina.on('pageerror', (e) => console_.push(`pageerror: ${e.message}`));
      await pagina.goto(base + rota, { waitUntil: 'networkidle' });
      await pagina.waitForTimeout(500);
      const nome = `${rota.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') || 'raiz'}-${tema}-${largura}.png`;
      await pagina.screenshot({ path: path.join(saida, nome), fullPage: true });
      const medidas = await pagina.evaluate(() => ({
        url: location.pathname,
        scrollWidth: document.documentElement.scrollWidth,
        temaNoHtml: document.documentElement.classList.contains('dark') ? 'escuro' : 'claro',
      }));
      resumo.push({ rota, tema, largura, arquivo: nome, ...medidas,
        estoura: medidas.scrollWidth > largura, console: console_ });
      await ctx.close();
    }
  }
}
await navegador.close();
writeFileSync(path.join(saida, 'resumo.json'), JSON.stringify(resumo, null, 2));
for (const r of resumo) {
  console.log(`${r.estoura ? '⚠️ ' : '  '}${r.rota} ${r.tema} ${r.largura}px → ${r.arquivo}` +
    ` (url ${r.url}, scrollWidth ${r.scrollWidth}, ${r.console.length} msg de console)`);
}
