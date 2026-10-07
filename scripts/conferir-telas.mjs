#!/usr/bin/env node
// Conferência de tela com navegador próprio — para as frentes paralelas, que
// não podem dividir o navegador do Playwright MCP da sessão.
//
//   node scripts/conferir-telas.mjs --porta 8081 --saida <pasta> /settings /pages
//   node scripts/conferir-telas.mjs --base https://homo-marketinghs.healthsafetytech.com --saida <pasta> /
//   node scripts/conferir-telas.mjs --porta 8096 --saida <pasta> --abrir Filtros /contacts
//   node scripts/conferir-telas.mjs --porta 8096 --saida <pasta> --clicar-linha /contacts
//   node scripts/conferir-telas.mjs --porta 8096 --saida <pasta> --abrir "Novo fluxo" /automations
//
// Para cada rota: tema claro e escuro, 1440 e 390 px. Salva um PNG por
// combinação e um resumo.json com scrollWidth, erros e avisos de console.
// Só navega e lê (regra de só leitura em produção).
//
// ABRIR PAINÉIS DE LEITURA — os únicos cliques que o script dá:
//   --abrir "<texto>"   repetível, aplicado em ordem em cada rota. Clica no
//                       botão cujo nome acessível é <texto> (aceita um número
//                       grudado no fim, ex. o contador "Filtros 2"). Só vale
//                       texto da lista ABRIDORES abaixo; "aba:<nome>" clica na
//                       aba (role=tab) <nome>.
//   --clicar-linha      depois dos --abrir, clica numa célula sem controle da
//                       1ª linha da tabela (em Contatos, abre a ficha).
// Cada passo salva um PNG próprio (<rota>-<tema>-<largura>-passoN-<nome>.png).
// ⚠️ Texto fora da lista, ou que pareça ação (Salvar, Enviar, Excluir…), é
// RECUSADO antes de abrir o navegador. Se o botão achado na tela tiver nome de
// ação, a rota é abortada. E toda requisição que não seja GET para a API é
// BLOQUEADA no navegador e anotada no resumo (campo `bloqueadas`) — rede de
// segurança caso um abridor grave ao abrir. Exceção: as leituras por POST
// de LEITURAS_POR_POST (a tabela de Contatos usa duas).
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

// ---- argumentos -----------------------------------------------------------
const opcoes = { abrir: [] };
const rotas = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--clicar-linha') opcoes.clicarLinha = true;
  else if (a === '--abrir') opcoes.abrir.push(argv[++i] ?? '');
  else if (a.startsWith('--')) {
    const nome = a.slice(2);
    // Opção desconhecida engoliria o argumento seguinte (às vezes a rota).
    if (!['porta', 'saida', 'temas', 'larguras', 'base'].includes(nome)) {
      console.error(`✖ opção desconhecida: ${a}`);
      process.exit(2);
    }
    opcoes[nome] = argv[++i];
  }
  else rotas.push(a);
}
const porta = opcoes.porta ?? '8080';
const saida = path.resolve(opcoes.saida ?? 'conferencia');
const temas = (opcoes.temas ?? 'claro,escuro').split(',');
const larguras = (opcoes.larguras ?? '1440,390').split(',').map(Number);
if (!rotas.length) rotas.push('/');
// --base aponta para um ambiente publicado (ex.: o Homo); sem ela, o Vite local.
const base = opcoes.base ?? `http://127.0.0.1:${porta}`;

// ---- lista permitida de cliques -------------------------------------------
const normalizar = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ').trim().toLowerCase();
// Só abrem painel/diálogo/aba de leitura. Conferido no código em 07/10:
// "Novo fluxo" e "Nova campanha" abrem formulário vazio; nada grava ao abrir.
const ABRIDORES = new Set(['filtros', 'colunas', 'novo fluxo', 'nova campanha', '+']);
// Tudo que soe a ação. Vale também para abas e para o nome achado na tela.
const ACAO = /\b(salva|salvar|envia|enviar|exclui|excluir|apaga|apagar|remove|remover|para|parar|pausa|pausar|testa|testar|gera|gerar|importa|importar|sincroniza|sincronizar|confirma|confirmar|publica|publicar|ativa|ativar|desativa|desativar|dispara|disparar|duplica|duplicar|mescla|mesclar|restaura|restaurar|redefine|redefinir|reseta|resetar|cria|criar|adiciona|adicionar|aplica|aplicar|aprova|aprovar|deleta|deletar|limpa|limpar|descadastra|descadastrar|move|mover|conecta|conectar|desconecta|desconectar|copia|copiar|atualiza|atualizar|exporta|exportar|baixa|baixar|retoma|retomar|inicia|iniciar|agenda|agendar|reenvia|reenviar|arquiva|arquivar|edita|editar|grava|gravar|cancela|cancelar|executa|executar|roda|rodar|reprocessa|reprocessar|marca|marcar|qualifica|qualificar|converte|converter|promove|promover|desfaz|desfazer|vincula|vincular|transfere|transferir|send|save|delete|remove|sync|import|export|run|execute)\b/;

function validarAbridor(texto) {
  const n = normalizar(texto);
  const aba = n.startsWith('aba:');
  const nome = aba ? n.slice(4).trim() : n;
  if (!nome) throw new Error(`--abrir vazio`);
  if (ACAO.test(nome)) {
    throw new Error(`--abrir "${texto}" RECUSADO: parece ação, e o navegador aqui só lê.`);
  }
  if (!aba && !ABRIDORES.has(nome)) {
    throw new Error(`--abrir "${texto}" RECUSADO: fora da lista permitida ` +
      `(${[...ABRIDORES].join(', ')}, ou aba:<nome>).`);
  }
  return { texto: texto.trim().replace(/^aba:\s*/i, ''), aba };
}
let passos;
try {
  passos = opcoes.abrir.map(validarAbridor);
} catch (e) {
  console.error(`✖ ${e.message}`);
  process.exit(2);
}
if (opcoes.clicarLinha) passos.push({ linha: true });

// POST que só lê: a lista de ids não cabe em query string. Conferido no
// backend (leitura_contatos.py) em 07/10 — só SELECT. Caminho exato; não
// acrescente rota sem ler o handler.
const LEITURAS_POR_POST = new Set([
  '/api/contatos/enriquecimento',
  '/api/contatos/tags-por-contato',
]);

const escaparRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const slug = (s) => normalizar(s).replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') || 'mais';

async function executarPasso(pagina, passo) {
  if (passo.linha) {
    const linha = pagina.locator('table tbody tr').first();
    await linha.waitFor({ state: 'visible', timeout: 10e3 });
    // Uma célula sem botão, link, caixa ou menu: clicar ali só abre a linha.
    const i = await linha.evaluate((tr) => [...tr.querySelectorAll(':scope > td')]
      .findIndex((td) => td.innerText.trim() &&
        !td.querySelector('button, a, input, select, [role=checkbox], [role=combobox], [role=button]')));
    if (i < 0) throw new Error('a 1ª linha não tem célula sem controle para clicar');
    await linha.locator(':scope > td').nth(i).click();
    return 'linha';
  }
  const nome = new RegExp(`^\\s*${escaparRegex(passo.texto)}(\\s+\\d+)?\\s*$`, 'i');
  const alvo = pagina.getByRole(passo.aba ? 'tab' : 'button', { name: nome })
    .filter({ visible: true }).first();
  await alvo.waitFor({ state: 'visible', timeout: 10e3 }).catch(() => {
    throw new Error(`${passo.aba ? 'aba' : 'botão'} "${passo.texto}" não achado na tela`);
  });
  const achado = (await alvo.innerText()).trim();
  if (ACAO.test(normalizar(achado))) {
    throw new Error(`o elemento achado ("${achado}") tem nome de ação — abortado`);
  }
  await alvo.click();
  return (passo.aba ? 'aba_' : '') + slug(passo.texto);
}

// ---- login ----------------------------------------------------------------
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

// ---- conferência ----------------------------------------------------------
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
      // Só leitura de verdade: o que não for GET/HEAD para a API não sai,
      // fora as leituras por POST conhecidas (LEITURAS_POR_POST).
      const bloqueadas = [];
      await ctx.route('**/api/**', (req) => {
        const m = req.request().method();
        const caminho = new URL(req.request().url()).pathname;
        if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return req.continue();
        if (m === 'POST' && LEITURAS_POR_POST.has(caminho)) return req.continue();
        bloqueadas.push(`${m} ${caminho}`);
        return req.abort('blockedbyclient');
      });
      const pagina = await ctx.newPage();
      const console_ = [];
      pagina.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') console_.push(`${m.type()}: ${m.text()}`);
      });
      pagina.on('pageerror', (e) => console_.push(`pageerror: ${e.message}`));
      await pagina.goto(base + rota, { waitUntil: 'networkidle' });
      await pagina.waitForTimeout(500);
      const raiz = `${rota.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') || 'raiz'}-${tema}-${largura}`;
      const registrar = async (nome, extra = {}) => {
        await pagina.screenshot({ path: path.join(saida, nome), fullPage: true });
        const medidas = await pagina.evaluate(() => ({
          url: location.pathname,
          scrollWidth: document.documentElement.scrollWidth,
          temaNoHtml: document.documentElement.classList.contains('dark') ? 'escuro' : 'claro',
        }));
        resumo.push({ rota, tema, largura, arquivo: nome, ...extra, ...medidas,
          estoura: medidas.scrollWidth > largura, console: [...console_],
          bloqueadas: [...bloqueadas] });
      };
      await registrar(`${raiz}.png`);
      for (const [n, passo] of passos.entries()) {
        try {
          const nome = await executarPasso(pagina, passo);
          await pagina.waitForTimeout(700);
          await registrar(`${raiz}-passo${n + 1}-${nome}.png`, { passo: nome });
        } catch (e) {
          resumo.push({ rota, tema, largura, passo: n + 1, abortado: e.message });
          break;
        }
      }
      await ctx.close();
    }
  }
}
await navegador.close();
writeFileSync(path.join(saida, 'resumo.json'), JSON.stringify(resumo, null, 2));
for (const r of resumo) {
  if (r.abortado) {
    console.log(`✖ ${r.rota} ${r.tema} ${r.largura}px passo ${r.passo}: ${r.abortado}`);
    continue;
  }
  const alerta = r.estoura || r.bloqueadas.length ? '⚠️ ' : '  ';
  console.log(`${alerta}${r.rota} ${r.tema} ${r.largura}px → ${r.arquivo}` +
    ` (url ${r.url}, scrollWidth ${r.scrollWidth}, ${r.console.length} msg de console` +
    `${r.bloqueadas.length ? `, ${r.bloqueadas.length} escrita(s) BLOQUEADA(s)` : ''})`);
}
// Passo abortado ou escrita bloqueada: a conferência não passou.
if (resumo.some((r) => r.abortado || r.bloqueadas?.length)) process.exitCode = 1;
