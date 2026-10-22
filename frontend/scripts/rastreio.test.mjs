// O `public/rastreio.js` — o "código de monitoramento" nosso, que convive com
// o do RD no site da H&S (prova de substituição do RD, Tarefa 11).
//
//   node --test scripts/rastreio.test.mjs
//
// Roda o script de verdade num `node:vm` com `window`, `document`,
// `navigator.sendBeacon` e `FormData` falsos. O que mais importa aqui é a
// antimeta: o script NUNCA impede nem atrasa o envio original do formulário
// do site — no site real ele manda o e-mail ao comercial pelo `contato.cfm`,
// e se a gente quebrar isso, perde lead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const front = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CODIGO = readFileSync(path.join(front, "public", "rastreio.js"), "utf8");
// Fora de `public/` de propósito: lá ela seria servida no domínio do admin,
// com o script do RD (terceiro) na mesma origem da sessão.
const SITE_TESTE = path.join(front, "..", "prova-site", "site-teste.html");

// ---- o navegador de mentira ------------------------------------------------

function poteDeCookies() {
  const valores = new Map();
  const brutos = [];
  return {
    valores, brutos,
    get cookie() { return [...valores].map(([k, v]) => `${k}=${v}`).join("; "); },
    set cookie(linha) {
      brutos.push(linha);
      const [par] = linha.split(";");
      const i = par.indexOf("=");
      valores.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
    },
  };
}

function campo(name, value, extra = {}) {
  return { name, value, type: "text", autocomplete: "", disabled: false, ...extra };
}

function formulario({ id = null, campos = [] } = {}) {
  return {
    _campos: campos,
    elements: campos,
    getAttribute(nome) { return nome === "id" ? id : null; },
    tagName: "FORM",
  };
}

function navegador({
  url = "https://site.exemplo.com.br/phoebus.cfm",
  referrer = "",
  dados = { token: "pub_teste", api: "https://app.exemplo.com/api" },
  cookies = poteDeCookies(),
  forms = [],
  semBeacon = false,
  beaconQuebrado = false,
  fetchQuebrado = false,
  modoTeste = true,
} = {}) {
  const enviados = [];
  const ouvintes = [];
  const console_ = { chamadas: 0, log() { this.chamadas++; }, warn() { this.chamadas++; }, error() { this.chamadas++; } };
  const u = new URL(url);
  const script = {
    src: "https://app.exemplo.com/rastreio.js",
    getAttribute(nome) {
      const chave = nome.replace(/^data-/, "");
      return Object.prototype.hasOwnProperty.call(dados, chave) ? dados[chave] : null;
    },
  };
  const document = {
    currentScript: script,
    referrer,
    title: "Phoebus — Health & Safety",
    forms,
    getElementsByTagName(t) { return t === "script" ? [script] : []; },
    querySelector() { return script; },
    addEventListener(tipo, fn, captura) { ouvintes.push({ tipo, fn, captura }); },
    get cookie() { return cookies.cookie; },
    set cookie(v) { cookies.cookie = v; },
  };
  class Blob {
    constructor(partes, opcoes) { this.texto = partes.join(""); this.type = opcoes?.type; }
  }
  class FormData {
    constructor(form) { this._pares = form._campos.filter((c) => !c.disabled).map((c) => [c.name, c.value]); }
    forEach(fn) { for (const [k, v] of this._pares) fn(v, k); }
  }
  class HTMLFormElement { submit() { enviados.push({ via: "submit-original" }); } }
  const navigator = {};
  if (!semBeacon) {
    navigator.sendBeacon = (destino, blob) => {
      if (beaconQuebrado) throw new Error("beacon quebrou");
      enviados.push({ via: "beacon", destino, corpo: JSON.parse(blob.texto), tipo: blob.type });
      return true;
    };
  }
  const window = {
    document, navigator, location: {
      href: u.href, pathname: u.pathname, protocol: u.protocol, hostname: u.hostname,
      host: u.host, search: u.search,
    },
    console: console_, Blob, FormData, HTMLFormElement, JSON, Date, Math, URL, URLSearchParams,
    encodeURIComponent, decodeURIComponent, Array, Object, String, RegExp, Error,
    fetch: (destino, opcoes) => {
      if (fetchQuebrado) throw new Error("rede fora");
      enviados.push({ via: "fetch", destino, corpo: JSON.parse(opcoes.body), opcoes });
      return Promise.resolve({ ok: true });
    },
  };
  if (modoTeste) window.__MHS_TESTE__ = true;
  window.window = window;
  window.self = window;
  for (const f of forms) Object.setPrototypeOf(f, HTMLFormElement.prototype);
  return { window, document, enviados, ouvintes, cookies, console: console_ };
}

function rodar(nav) {
  const ctx = vm.createContext(nav.window);
  vm.runInContext(CODIGO, ctx, { filename: "rastreio.js" });
  return nav;
}

// Dispara o `submit` como o navegador faria: o nosso ouvinte de captura, num
// evento que pode já vir com `defaultPrevented` (o AJAX do site chamou antes).
function enviar(nav, form, { defaultPrevented = false } = {}) {
  const evento = {
    target: form, defaultPrevented,
    preventDefault() { this.chamouPreventDefault = true; },
    stopPropagation() { this.chamouStop = true; },
    stopImmediatePropagation() { this.chamouStop = true; },
  };
  for (const o of nav.ouvintes.filter((o) => o.tipo === "submit")) o.fn(evento);
  return evento;
}

const conversoes = (nav) => nav.enviados.filter((e) => e.destino?.endsWith("/publico/site/conversao"));
const visitas = (nav) => nav.enviados.filter((e) => e.destino?.endsWith("/publico/site/visita"));

function formDoPhoebus(extra = []) {
  return formulario({
    id: "prova_cap_phoebus",
    campos: [
      campo("passunto", "Captura pelo site [PHOEBUS]", { type: "hidden" }),
      campo("pnome", "Ana"),
      campo("pemail", "ana@exemplo.com.br", { type: "email" }),
      campo("pwhatsapp", "31999999999"),
      campo("pmensagem", "Quero cotação", { type: "textarea" }),
      ...extra,
    ],
  });
}

// ---- os testes -------------------------------------------------------------

test("não chama preventDefault e o envio segue", () => {
  const form = formDoPhoebus();
  const nav = rodar(navegador({ forms: [form] }));
  const ouvinte = nav.ouvintes.find((o) => o.tipo === "submit");
  assert.ok(ouvinte, "escuta submit");
  assert.equal(ouvinte.captura, true, "na fase de captura, antes do AJAX do site");
  const evento = enviar(nav, form);
  assert.equal(evento.chamouPreventDefault, undefined);
  assert.equal(evento.chamouStop, undefined);
  assert.equal(conversoes(nav).length, 1);
});

test("manda conversão com form_id e campos mapeáveis", () => {
  const form = formDoPhoebus();
  const nav = rodar(navegador({
    url: "https://site.exemplo.com.br/phoebus.cfm?utm_source=google&utm_medium=cpc&gclid=abc",
    forms: [form],
  }));
  enviar(nav, form);
  const [c] = conversoes(nav);
  assert.equal(c.via, "beacon");
  assert.equal(c.tipo, "text/plain", "text/plain não pede preflight");
  assert.equal(c.destino, "https://app.exemplo.com/api/publico/site/conversao");
  assert.equal(c.corpo.token, "pub_teste");
  assert.equal(c.corpo.form_id, "prova_cap_phoebus");
  assert.equal(c.corpo.url, "https://site.exemplo.com.br/phoebus.cfm?utm_source=google&utm_medium=cpc&gclid=abc");
  assert.deepEqual(c.corpo.campos, {
    passunto: "Captura pelo site [PHOEBUS]", pnome: "Ana", pemail: "ana@exemplo.com.br",
    pwhatsapp: "31999999999", pmensagem: "Quero cotação",
  });
  assert.match(c.corpo.visitor_id, /^[0-9a-f-]{36}$/);
  assert.equal(c.corpo.toque.utm.utm_source, "google");
  assert.equal(c.corpo.toque.gclid, "abc");
  assert.equal(c.corpo.primeiro_toque.utm.utm_medium, "cpc");
});

test("form sem id ganha nome estável", () => {
  const a = formulario({ campos: [campo("email", "a@x.com")] });
  const b = formulario({ campos: [campo("email", "b@x.com")] });
  const nav = rodar(navegador({ forms: [a, b] }));
  assert.equal(nav.window.__mhsTeste.idDoFormulario(b), "/phoebus.cfm#form2");
  assert.equal(nav.window.__mhsTeste.idDoFormulario(b), "/phoebus.cfm#form2", "o mesmo a cada chamada");
  assert.equal(nav.window.__mhsTeste.idDoFormulario(a), "/phoebus.cfm#form1");
  enviar(nav, b);
  assert.equal(conversoes(nav)[0].corpo.form_id, "/phoebus.cfm#form2");
});

test("ignora senha, cartão e captcha", () => {
  const form = formDoPhoebus([
    campo("senha", "segredo"),
    campo("qualquer", "1234", { type: "password" }),
    campo("numero", "4111111111111111", { autocomplete: "cc-number" }),
    campo("card_cvv", "123"),
    campo("g-recaptcha-response", "tokendocaptcha", { type: "textarea" }),
  ]);
  const nav = rodar(navegador({ forms: [form] }));
  const t = nav.window.__mhsTeste;
  assert.equal(t.campoProibido(campo("cartao_numero", "")), true);
  assert.equal(t.campoProibido(campo("pnome", "")), false);
  for (const nome of ["cc_num", "cc-number", "ccexp", "cc_cvv", "CCCVC", "cf-turnstile-response",
                      "csrf", "csrfmiddlewaretoken", "_token", "authenticity_token"]) {
    assert.equal(t.campoProibido(campo(nome, "")), true, nome);
  }
  for (const nome of ["pemail", "empresa", "accept", "ccusto"]) {
    assert.equal(t.campoProibido(campo(nome, "")), false, nome);
  }
  const lidos = t.lerCampos(form);
  for (const fora of ["senha", "qualquer", "numero", "card_cvv", "g-recaptcha-response"]) {
    assert.equal(lidos[fora], undefined, fora);
  }
  assert.equal(lidos.pemail, "ana@exemplo.com.br");
});

test("form sem e-mail preenchido não manda nada", () => {
  const busca = formulario({ campos: [campo("q", "bafômetro")] });
  const vazio = formulario({ id: "x", campos: [campo("pemail", "  ", { type: "email" })] });
  const nav = rodar(navegador({ forms: [busca, vazio] }));
  enviar(nav, busca);
  enviar(nav, vazio);
  assert.equal(conversoes(nav).length, 0);
});

test("repetição em 10 s não manda de novo", () => {
  const form = formDoPhoebus();
  const nav = rodar(navegador({ forms: [form] }));
  const agora = nav.window.Date.now;
  let relogio = 1_000_000;
  nav.window.Date = class extends Date { static now() { return relogio; } };
  vm.runInContext("0", vm.createContext(nav.window)); // contexto já criado; só troca o relógio
  enviar(nav, form);
  relogio += 9_000;
  enviar(nav, form);  // o site recusou e a pessoa reenviou, ou o AJAX disparou duas vezes
  assert.equal(conversoes(nav).length, 1);
  relogio += 2_000;
  enviar(nav, form);
  assert.equal(conversoes(nav).length, 2);
  assert.ok(agora);
});

test("envia mesmo com defaultPrevented", () => {
  const form = formDoPhoebus();
  const nav = rodar(navegador({ forms: [form] }));
  enviar(nav, form, { defaultPrevented: true });
  assert.equal(conversoes(nav).length, 1);
});

test("form.submit() por JavaScript também manda, e o envio original acontece", () => {
  const form = formDoPhoebus();
  const nav = rodar(navegador({ forms: [form] }));
  form.submit();
  assert.equal(conversoes(nav).length, 1);
  assert.equal(nav.enviados.filter((e) => e.via === "submit-original").length, 1);
});

test("sem sendBeacon usa fetch keepalive", () => {
  const form = formDoPhoebus();
  const nav = rodar(navegador({ forms: [form], semBeacon: true }));
  enviar(nav, form);
  const [c] = conversoes(nav);
  assert.equal(c.via, "fetch");
  assert.equal(c.opcoes.method, "POST");
  assert.equal(c.opcoes.keepalive, true);
  assert.equal(c.opcoes.mode, "no-cors");
});

test("erro no envio não sobe exceção", () => {
  const form = formDoPhoebus();
  const nav = rodar(navegador({ forms: [form], beaconQuebrado: true, fetchQuebrado: true }));
  assert.doesNotThrow(() => enviar(nav, form));
  assert.doesNotThrow(() => form.submit());
  assert.equal(nav.enviados.filter((e) => e.via === "submit-original").length, 1);
  assert.equal(nav.console.chamadas, 0, "nada no console sem data-debug");
});

test("primeiro toque é gravado uma vez só", () => {
  const cookies = poteDeCookies();
  rodar(navegador({ cookies, url: "https://site.exemplo.com.br/?utm_source=newsletter&utm_medium=email" }));
  const pt = cookies.valores.get("mhs_pt");
  const vid = cookies.valores.get("mhs_vid");
  assert.ok(pt && vid);
  assert.match(cookies.brutos.find((b) => b.startsWith("mhs_vid=")), /SameSite=Lax/);
  assert.match(cookies.brutos.find((b) => b.startsWith("mhs_vid=")), /Secure/);
  const segunda = rodar(navegador({
    cookies, url: "https://site.exemplo.com.br/?utm_source=google&utm_medium=cpc",
  }));
  assert.equal(cookies.valores.get("mhs_pt"), pt, "primeiro toque congelado");
  assert.equal(cookies.valores.get("mhs_vid"), vid, "o mesmo visitante");
  const [v] = visitas(segunda);
  assert.equal(v.corpo.primeiro_toque.utm.utm_source, "newsletter");
  assert.equal(v.corpo.utm.utm_source, "google");
  // O último toque mudou com a UTM nova.
  assert.match(decodeURIComponent(cookies.valores.get("mhs_ut")), /google/);
});

test("visita sem UTM nem referrer externo não troca o último toque", () => {
  const cookies = poteDeCookies();
  rodar(navegador({ cookies, url: "https://site.exemplo.com.br/?utm_source=google" }));
  const ut = cookies.valores.get("mhs_ut");
  rodar(navegador({ cookies, url: "https://site.exemplo.com.br/outra", referrer: "https://site.exemplo.com.br/" }));
  assert.equal(cookies.valores.get("mhs_ut"), ut);
  rodar(navegador({ cookies, url: "https://site.exemplo.com.br/x", referrer: "https://www.bing.com/" }));
  assert.notEqual(cookies.valores.get("mhs_ut"), ut, "referrer externo é toque novo");
});

test("registra uma visita por carregamento", () => {
  const nav = rodar(navegador({ referrer: "https://www.google.com/" }));
  const [v] = visitas(nav);
  assert.equal(visitas(nav).length, 1);
  assert.equal(v.corpo.token, "pub_teste");
  assert.equal(v.corpo.referrer, "https://www.google.com/");
  assert.equal(v.corpo.titulo, "Phoebus — Health & Safety");
  assert.ok(v.corpo.visitor_id);
});

test("data-captura=off só registra visita", () => {
  const form = formDoPhoebus();
  const nav = rodar(navegador({
    forms: [form], dados: { pagina: "phoebus-prova", api: "/api", captura: "off" },
    url: "https://marketinghs.exemplo.com/p/phoebus-prova",
  }));
  assert.equal(nav.ouvintes.filter((o) => o.tipo === "submit").length, 0);
  enviar(nav, form);
  form.submit();
  assert.equal(conversoes(nav).length, 0);
  const [v] = visitas(nav);
  assert.equal(v.destino, "/api/publico/site/visita");
  assert.equal(v.corpo.pagina, "phoebus-prova");
  assert.equal(v.corpo.token, undefined);
});

test("sem token nem página não faz nada", () => {
  const nav = rodar(navegador({ dados: { api: "/api" } }));
  assert.equal(nav.enviados.length, 0);
});

test("toqueDaUrl lê UTM e clid", () => {
  const nav = rodar(navegador());
  const t = nav.window.__mhsTeste.toqueDaUrl(
    "https://site.exemplo.com.br/?utm_source=fb&utm_campaign=x&fbclid=F1", "");
  assert.equal(t.utm.utm_source, "fb");
  assert.equal(t.utm.utm_campaign, "x");
  assert.equal(t.fbclid, "F1");
  assert.equal(nav.window.__mhsTeste.toqueDaUrl("https://site.exemplo.com.br/", ""), null);
});

test("instalado duas vezes não escuta duas vezes", () => {
  const nav = navegador();
  const ctx = vm.createContext(nav.window);
  vm.runInContext(CODIGO, ctx);
  vm.runInContext(CODIGO, ctx);
  assert.equal(nav.ouvintes.filter((o) => o.tipo === "submit").length, 1);
  assert.equal(visitas(nav).length, 1);
});

test("prévia do editor (?previa=1) na landing não registra visita", () => {
  const nav = rodar(navegador({
    dados: { pagina: "phoebus-prova", api: "/api", captura: "off" },
    url: "https://marketinghs.exemplo.com/p/phoebus-prova?previa=1",
  }));
  assert.equal(visitas(nav).length, 0);
});

test("previa=1 num site de fora (token) não desliga a visita", () => {
  const nav = rodar(navegador({ url: "https://site.exemplo.com.br/phoebus.cfm?previa=1" }));
  assert.equal(visitas(nav).length, 1);
});

test("site-teste tem prova_cap_phoebus com os names do site", () => {
  const html = readFileSync(SITE_TESTE, "utf8");
  const cap = /<form[^>]*id="prova_cap_phoebus"[^>]*>([\s\S]*?)<\/form>/.exec(html);
  assert.ok(cap, "form prova_cap_phoebus");
  for (const nome of ["pnome", "pemail", "pwhatsapp", "pmensagem", "passunto"]) {
    assert.match(cap[1], new RegExp(`name="${nome}"`), nome);
  }
  assert.match(cap[0], /data-acao="\/api\/publico\/prova\/recebido"/);
  assert.match(cap[0], /method="post"/);
  const ficha = /<form[^>]*id="prova_ficha_phoebus"[^>]*>([\s\S]*?)<\/form>/.exec(html);
  assert.ok(ficha, "form prova_ficha_phoebus");
  assert.match(ficha[0], /data-acao="\/api\/publico\/prova\/recebido"/);
  // Um só ponto com o host do sistema; script e action saem dele.
  assert.equal(html.match(/https:\/\/marketinghs\.healthsafetytech\.com/g)?.length, 1);
  assert.match(html, /MHS_SISTEMA \+ '\/rastreio\.js'/);
  assert.doesNotMatch(html, /s\.src = '\/rastreio\.js'/, "nunca o rastreio.js da própria origem");
  assert.match(ficha[1], /name="passunto"[^>]*value="Ficha técnica Phoebus"|value="Ficha técnica Phoebus"[^>]*name="passunto"/);
  assert.doesNotMatch(html, /id="cap_phoebus"/, "nunca o id do site real: os fluxos do RD escutam esse");
  assert.match(html, /Página de teste da prova — não é o site da H&amp;S/);
  assert.match(html, /d335luupugsy2\.cloudfront\.net\/js\/loader-scripts\/46bacd8c-1415-4afb-8def-463d24133281-loader\.js/);
  assert.doesNotMatch(html, /pub_[A-Za-z0-9_-]{8,}/, "nenhum token versionado");
  assert.match(html, /noindex/);
});
