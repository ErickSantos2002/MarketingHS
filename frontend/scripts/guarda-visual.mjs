#!/usr/bin/env node
// Guarda visual do MarketingHS — conta cor fora de token no admin.
//
// Conta, por pasta, (1) hexadecimal de 3 ou 6 dígitos e (2) cor literal do
// Tailwind (bg-blue-600, text-emerald-500…) em src/**/*.ts(x). A regra do
// Design System é "nenhum hexadecimal no JSX — cor sai de token".
//
// Uso:  npm run guarda:visual                 → relatório do app inteiro
//       npm run guarda:visual -- src/components/admin/dashboard
//                                              → só a área; sai 1 se não for zero
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const RAIZ = new URL('..', import.meta.url).pathname;
const SRC = join(RAIZ, 'src');

// Exceções da Decisão 6 do spec — cada uma com o motivo. Critério estrito:
// só entra aqui o que acaba em HTML de e-mail realmente enviado (o cliente
// de e-mail não lê variável CSS) ou na landing pública. Tela do admin que
// mostra/edita e-mail ou landing NÃO é exceção só por isso — a cor da
// própria tela sai de token igual a qualquer outra.
const EXCECOES = [
  'src/landing/', // bundle público da landing, com landing.css próprio — não usa Tailwind/tokens
  'src/design-system/', // os tokens oficiais são, por definição, os hexadecimais
  // BASE_EMAIL_DESIGN é o design inicial que o Unlayer carrega no editor de
  // e-mail (CampaignWizard e TemplateEditor); os `style="color:#534AB7"`
  // inline viram, literalmente, o HTML do e-mail que o Resend envia ao
  // destinatário — cliente de e-mail não lê `hsl(var(--tudo))`. Achado no
  // Step 1 (grep de BASE_EMAIL_DESIGN); único candidato aceito dos 16.
  'src/components/admin/campaigns/emailEditorConfig.ts',
];

const HEX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;
const LITERAL =
  /\b(?:bg|text|border|ring|from|via|to|fill|stroke|outline|divide|placeholder|decoration|shadow|accent|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;

function* arquivos(dir) {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) yield* arquivos(caminho);
    else if (/\.(ts|tsx)$/.test(nome)) yield caminho;
  }
}

const rel = (p) => relative(RAIZ, p).split(sep).join('/');
const isento = (p) => EXCECOES.some((e) => rel(p).startsWith(e));

const area = process.argv[2]?.replace(/\/$/, '');
const porPasta = new Map();
let total = 0;

for (const arquivo of arquivos(SRC)) {
  const r = rel(arquivo);
  if (isento(arquivo)) continue;
  if (area && !r.startsWith(area)) continue;
  const texto = readFileSync(arquivo, 'utf8');
  const n = (texto.match(HEX)?.length ?? 0) + (texto.match(LITERAL)?.length ?? 0);
  if (n === 0) continue;
  const pasta = r.split('/').slice(0, -1).join('/');
  porPasta.set(pasta, (porPasta.get(pasta) ?? 0) + n);
  total += n;
}

for (const [pasta, n] of [...porPasta].sort((a, b) => b[1] - a[1])) {
  console.log(String(n).padStart(5), pasta);
}
console.log(String(total).padStart(5), area ? `total em ${area}` : 'total');

if (area && total > 0) process.exit(1);
