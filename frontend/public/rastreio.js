/*!
 * rastreio.js — o "código de monitoramento" do MarketingHS.
 *
 * Instalação (1 linha, no <head> do site; convive com o script do RD):
 *   <script src="https://<app>/rastreio.js" async data-token="pub_…" data-api="https://<app>/api"></script>
 * Na landing do próprio MarketingHS a casca põe:
 *   <script src="/rastreio.js" defer data-pagina="<slug>" data-api="/api" data-captura="off"></script>
 *
 * O que faz (JS puro, sem dependência):
 *  - Registra UMA visita por carregamento em POST <api>/publico/site/visita
 *    (página, título, referrer, UTMs, gclid/fbclid, primeiro toque).
 *  - Cookies primários no host da página (SameSite=Lax; Secure em https):
 *    `mhs_vid` (id do visitante, 365 dias), `mhs_pt` (primeiro toque, gravado
 *    UMA vez) e `mhs_ut` (último toque, trocado a cada visita que chega com
 *    UTM/clid ou de referrer externo).
 *  - Com token e sem data-captura="off": escuta o envio de TODO <form> da
 *    página que tenha e-mail preenchido e manda a conversão a
 *    POST <api>/publico/site/conversao.
 *
 * ⚠️ ANTIMETA — o envio original do site nunca é afetado. No site da H&S o
 * formulário de cotação manda o e-mail ao comercial pelo `contato.cfm`; se
 * este script atrapalhar, perdemos lead. Por isso:
 *  - nunca `preventDefault`/`stopPropagation`; o ouvinte é passivo, na fase de
 *    captura, e manda mesmo com `defaultPrevented` (o AJAX do site já chamou);
 *  - nunca espera rede: `navigator.sendBeacon` com `text/plain` (sem
 *    preflight), recuo para `fetch(..., {keepalive: true, mode: 'no-cors'})`;
 *  - `form.submit()` por JavaScript não dispara `submit`: o método é embrulhado
 *    para mandar a conversão e chamar o original NA MESMA HORA, sempre;
 *  - tudo em try/catch; nada no console sem data-debug="true".
 *
 * Nunca lê campo de senha, de cartão (`autocomplete="cc-*"`) nem o oculto do
 * captcha. Repetição do mesmo formulário com o mesmo e-mail em 10 s é
 * descartada (reenvio depois de erro de validação do site, AJAX duplo).
 *
 * O token público (`pub_…`) só cria/atualiza lead, conversão e visita, e só
 * vale vindo de domínio cadastrado. Não é segredo — mas também não é versionado.
 */
(function () {
  'use strict';
  try {
    if (window.__mhsRastreio) return;
    window.__mhsRastreio = true;
  } catch (e) { return; }

  var DEBUG = false;
  function log() {
    if (!DEBUG) return;
    try { window.console.log.apply(window.console, ['[rastreio]'].concat([].slice.call(arguments))); } catch (e) { /* nada */ }
  }

  var UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  var PROIBIDO = /senha|password|card|cartao|cvv|cvc|captcha/i;
  var JANELA_REPETICAO = 10000;
  var MAX_CAMPOS = 60;
  var MAX_VALOR = 2000;
  var UM_ANO = 365 * 24 * 3600;

  // ---- cookies ------------------------------------------------------------
  function lerCookie(nome) {
    try {
      var partes = String(document.cookie || '').split(';');
      for (var i = 0; i < partes.length; i++) {
        var p = partes[i];
        var j = p.indexOf('=');
        if (j < 0 || p.slice(0, j).replace(/^\s+|\s+$/g, '') !== nome) continue;
        var v = p.slice(j + 1).replace(/^\s+|\s+$/g, '');
        try { return decodeURIComponent(v); } catch (e) { return v; }
      }
    } catch (e) { /* nada */ }
    return null;
  }

  function gravarCookie(nome, valor, segundos) {
    try {
      var linha = nome + '=' + encodeURIComponent(valor) + '; Max-Age=' + segundos +
        '; Path=/; SameSite=Lax';
      if (window.location.protocol === 'https:') linha += '; Secure';
      document.cookie = linha;
    } catch (e) { /* nada */ }
  }

  function lerJson(nome) {
    var v = lerCookie(nome);
    if (!v) return null;
    try { return JSON.parse(v); } catch (e) { return null; }
  }

  function novoId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    } catch (e) { /* recuo abaixo */ }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  // ---- toque --------------------------------------------------------------
  function hostDe(url) {
    try { return new URL(url).hostname; } catch (e) { return ''; }
  }

  // Toque desta URL: UTMs e clids da query; `null` quando não há nenhum e o
  // referrer é vazio ou do próprio host (navegação interna não é toque novo).
  function toqueDaUrl(href, referrer) {
    var q;
    try { q = new URL(href).searchParams; } catch (e) { return null; }
    var utm = {};
    var tem = false;
    for (var i = 0; i < UTM.length; i++) {
      var v = q.get(UTM[i]);
      if (v) { utm[UTM[i]] = v.slice(0, 200); tem = true; }
    }
    var gclid = q.get('gclid');
    var fbclid = q.get('fbclid');
    var externo = !!referrer && hostDe(referrer) !== '' && hostDe(referrer) !== window.location.hostname;
    if (!tem && !gclid && !fbclid && !externo) return null;
    return {
      utm: utm, gclid: gclid || null, fbclid: fbclid || null,
      referrer: referrer || null, url: href, ts: new Date(Date.now()).toISOString(),
    };
  }

  // ---- envio --------------------------------------------------------------
  function mandar(url, dados) {
    var json;
    try { json = JSON.stringify(dados); } catch (e) { return; }
    try {
      if (window.navigator && typeof window.navigator.sendBeacon === 'function') {
        var blob = new Blob([json], { type: 'text/plain' });
        if (window.navigator.sendBeacon(url, blob)) { log('beacon', url); return; }
      }
    } catch (e) { log('beacon falhou', e); }
    try {
      if (typeof window.fetch === 'function') {
        var p = window.fetch(url, { method: 'POST', body: json, keepalive: true, mode: 'no-cors' });
        if (p && typeof p.catch === 'function') p.catch(function () { /* servidor fora: o site segue */ });
        log('fetch', url);
      }
    } catch (e) { log('fetch falhou', e); }
  }

  // ---- formulário ---------------------------------------------------------
  function campoProibido(el) {
    if (!el) return false;
    var tipo = String(el.type || '').toLowerCase();
    var auto = String(el.autocomplete || (el.getAttribute && el.getAttribute('autocomplete')) || '').toLowerCase();
    return tipo === 'password' || auto.indexOf('cc-') === 0 || PROIBIDO.test(String(el.name || ''));
  }

  // `getAttribute('id')` e não `form.id`: um <input name="id"> dentro do form
  // sombreia a propriedade. Sem id, caminho + posição — estável, nunca
  // aleatório como o CFForm_* do RD.
  function idDoFormulario(form) {
    var id = null;
    try { id = form.getAttribute('id'); } catch (e) { /* nada */ }
    if (typeof id === 'string' && id.replace(/\s+/g, '')) return id.slice(0, 120);
    var indice = -1;
    try { indice = Array.prototype.indexOf.call(document.forms || [], form); } catch (e) { /* nada */ }
    return (window.location.pathname + '#form' + (indice + 1)).slice(0, 120);
  }

  // Os campos do formulário NA HORA do envio; `null` sem e-mail preenchido.
  function lerCampos(form) {
    var proibidos = {};
    var tipos = {};
    var elementos = form.elements || [];
    for (var i = 0; i < elementos.length; i++) {
      var el = elementos[i];
      if (!el || !el.name) continue;
      if (campoProibido(el)) proibidos[el.name] = true;
      tipos[el.name] = String(el.type || '').toLowerCase();
    }
    var campos = {};
    var n = 0;
    var temEmail = false;
    new FormData(form).forEach(function (valor, nome) {
      if (!nome || proibidos[nome] || PROIBIDO.test(nome) || typeof valor !== 'string') return;
      if (Object.prototype.hasOwnProperty.call(campos, nome)) return;
      if (n >= MAX_CAMPOS) return;
      var v = valor.replace(/^\s+|\s+$/g, '').slice(0, MAX_VALOR);
      if (!v) return;
      campos[nome] = v;
      n++;
      if (v.indexOf('@') > 0 && (tipos[nome] === 'email' || /e-?mail/i.test(nome))) temEmail = v;
    });
    return temEmail ? { campos: campos, email: temEmail } : null;
  }

  // ---- instalação ---------------------------------------------------------
  try {
    var script = document.currentScript;
    if (!script) {
      var todos = document.getElementsByTagName('script');
      for (var k = todos.length - 1; k >= 0; k--) {
        if (/rastreio\.js/.test(String(todos[k].src || ''))) { script = todos[k]; break; }
      }
    }
    if (!script) return;
    var attr = function (n) { var v = script.getAttribute(n); return v == null ? null : String(v); };
    DEBUG = attr('data-debug') === 'true';
    var token = attr('data-token');
    var pagina = attr('data-pagina');
    var api = attr('data-api');
    if (!api) {
      try { api = new URL(script.src).origin + '/api'; } catch (e) { api = '/api'; }
    }
    api = api.replace(/\/+$/, '');
    var captura = attr('data-captura') !== 'off' && !!token;

    if (window.__MHS_TESTE__) {
      window.__mhsTeste = {
        idDoFormulario: idDoFormulario, campoProibido: campoProibido,
        lerCampos: function (f) { var r = lerCampos(f); return r ? r.campos : null; },
        toqueDaUrl: toqueDaUrl,
      };
    }
    if (!token && !pagina) { log('sem data-token nem data-pagina'); return; }

    // Visitante e toques.
    var href = window.location.href;
    var referrer = document.referrer || '';
    var visitante = lerCookie('mhs_vid');
    if (!visitante || visitante.length > 64) visitante = novoId();
    gravarCookie('mhs_vid', visitante, UM_ANO);

    var toque = toqueDaUrl(href, referrer);
    var direto = { utm: {}, gclid: null, fbclid: null, referrer: referrer || null, url: href,
                   ts: new Date(Date.now()).toISOString() };
    var primeiro = lerJson('mhs_pt');
    if (!primeiro) {
      primeiro = toque || direto;
      gravarCookie('mhs_pt', JSON.stringify(primeiro), UM_ANO);
    }
    var ultimo = lerJson('mhs_ut');
    if (toque || !ultimo) {
      ultimo = toque || direto;
      gravarCookie('mhs_ut', JSON.stringify(ultimo), UM_ANO);
    }

    var atual = toque || direto;
    var visita = {
      visitor_id: visitante, url: href, titulo: String(document.title || '').slice(0, 300),
      referrer: referrer || null, utm: atual.utm, gclid: atual.gclid, fbclid: atual.fbclid,
      primeiro_toque: primeiro,
    };
    if (token) visita.token = token; else visita.pagina = pagina;
    mandar(api + '/publico/site/visita', visita);

    if (!captura) return;

    var vistos = {};
    var converter = function (form) {
      try {
        if (!form || String(form.tagName || '').toUpperCase() !== 'FORM') return;
        var lido = lerCampos(form);
        if (!lido) return;
        var formId = idDoFormulario(form);
        var chave = formId + '|' + String(lido.email).toLowerCase();
        var agora = Date.now();
        if (vistos[chave] && agora - vistos[chave] < JANELA_REPETICAO) { log('repetição descartada', formId); return; }
        vistos[chave] = agora;
        mandar(api + '/publico/site/conversao', {
          token: token, visitor_id: visitante, form_id: formId, url: window.location.href,
          campos: lido.campos, toque: lerJson('mhs_ut') || ultimo, primeiro_toque: lerJson('mhs_pt') || primeiro,
        });
      } catch (e) { log('conversão falhou', e); }
    };

    // Fase de captura no document: roda antes do handler do site, que pode
    // chamar preventDefault (AJAX). Não olhamos `defaultPrevented`.
    document.addEventListener('submit', function (evento) {
      try { converter(evento && evento.target); } catch (e) { /* nada */ }
    }, true);

    // `form.submit()` não dispara o evento `submit`. Embrulho mínimo: manda a
    // conversão e chama o original, sempre, mesmo se a nossa parte falhar.
    try {
      var proto = window.HTMLFormElement && window.HTMLFormElement.prototype;
      if (proto && typeof proto.submit === 'function' && !proto.submit.__mhs) {
        var original = proto.submit;
        var embrulho = function () {
          try { converter(this); } catch (e) { /* nada */ }
          return original.apply(this, arguments);
        };
        embrulho.__mhs = true;
        proto.submit = embrulho;
      }
    } catch (e) { log('sem embrulho de submit()', e); }
  } catch (e) {
    log('rastreio desligado por erro', e);
  }
})();
