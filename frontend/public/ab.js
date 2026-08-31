/*!
 * ab.js — script leve do Teste A/B da dn.ia (v1).
 *
 * Instalação (1 linha, no <head> ou fim do <body> de qualquer landing page):
 *   <script src="https://dnmkt.dnia.ai/ab.js" async></script>
 *
 * O que faz (standalone, sem dependências):
 *  - Lê ab_test/ab_var/ab_vid da query (postos pelo redirecionador) e grava no
 *    cookie .dnia.ai (SameSite=Lax, Secure, 90d). Em retornos SEM query, o
 *    cookie é a fonte da verdade.
 *  - Dispara `exposure` ao coletor (separa humano de bot: bots seguem o redirect
 *    mas não executam JS).
 *  - Rastreia comportamento: profundidade de scroll, tempo na página, cliques em
 *    CTAs (marque com [data-ab-cta]) e submit de formulário.
 *  - Injeta ab_vid/ab_var/ab_test em campos ocultos de TODO formulário.
 *  - Reescreve o src de TODO iframe nexus.dnia.ai/schedule (inclui iframes
 *    inseridos depois, via MutationObserver) levando o tracking p/ o agendamento.
 *  - LGPD: com data-require-consent="true", só ativa após consentimento
 *    (cookie ab_consent=1 ou window.abConsentGranted()).
 *
 * Config opcional via atributos no <script>:
 *   data-endpoint   (default https://dnmkt.dnia.ai/api/ab/events)
 *   data-cookie-domain (default .dnia.ai)
 *   data-require-consent ("true" para exigir consentimento)
 */
(function () {
  'use strict';
  if (window.__abLoaded) return;
  window.__abLoaded = true;

  var script = document.currentScript || (function () {
    var s = document.getElementsByTagName('script');
    return s[s.length - 1];
  })();
  var cfg = (script && script.dataset) || {};
  var ENDPOINT = cfg.endpoint || 'https://go.dnia.ai/e';
  var COOKIE_DOMAIN = cfg.cookieDomain || '.dnia.ai';
  var REQUIRE_CONSENT = String(cfg.requireConsent || '') === 'true';
  var COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 dias

  // ---- utilidades ----------------------------------------------------------
  function qp(name) {
    try { return new URLSearchParams(window.location.search).get(name); } catch (e) { return null; }
  }
  function readCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()\[\]\\\/\+^])/g, '\\$1') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function canScopeDomain() {
    // Só usa Domain=.dnia.ai quando o host de fato é *.dnia.ai (em localhost/preview
    // grava sem domain para não falhar silenciosamente).
    return /(^|\.)dnia\.ai$/i.test(location.hostname);
  }
  function writeCookie(name, value) {
    var parts = [name + '=' + encodeURIComponent(value), 'Path=/', 'Max-Age=' + COOKIE_MAX_AGE, 'SameSite=Lax'];
    if (location.protocol === 'https:') parts.push('Secure');
    if (canScopeDomain()) parts.push('Domain=' + COOKIE_DOMAIN);
    document.cookie = parts.join('; ');
  }
  function hasConsent() {
    if (!REQUIRE_CONSENT) return true;
    if (readCookie('ab_consent') === '1') return true;
    try { return typeof window.abConsentGranted === 'function' && window.abConsentGranted() === true; } catch (e) { return false; }
  }

  // ---- resolve atribuição (query -> cookie) --------------------------------
  var ab_test = qp('ab_test');
  var ab_var = qp('ab_var');
  var ab_vid = qp('ab_vid') || readCookie('ab_vid');
  if (!ab_test || !ab_var) {
    var last = readCookie('ab_last'); // formato: test|var|vid
    if (last) {
      var p = last.split('|');
      ab_test = ab_test || p[0] || null;
      ab_var = ab_var || p[1] || null;
      ab_vid = ab_vid || p[2] || null;
    }
  }

  // Sem consentimento (quando exigido): não grava cookie nem rastreia.
  var CONSENT = hasConsent();
  if (CONSENT && ab_test && ab_var && ab_vid) {
    writeCookie('ab_vid', ab_vid);
    writeCookie('ab_last', ab_test + '|' + ab_var + '|' + ab_vid);
    writeCookie('ab_' + ab_test, ab_var);
  }

  var ctx = clientContext();
  function clientContext() {
    var w = window.screen ? (window.screen.width + 'x' + window.screen.height) : null;
    return {
      language: navigator.language || null,
      screen_resolution: w,
      referrer: document.referrer || null,
    };
  }
  function rawQuery() {
    var q = window.location.search || '';
    return q.charAt(0) === '?' ? q.slice(1) : q;
  }

  // ---- envio ao coletor (fire-and-forget) ----------------------------------
  function send(events) {
    if (!CONSENT) return;
    try {
      var payload = JSON.stringify({ events: events });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'application/json' }));
      } else {
        fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, keepalive: true }).catch(function () {});
      }
    } catch (e) { /* nunca lança */ }
  }
  function baseEvent(type, name, extra) {
    var e = {
      ab_test: ab_test, ab_var: ab_var, ab_vid: ab_vid,
      event_type: type, event_name: name || null,
      url: location.href, page_slug: location.pathname,
      referrer: ctx.referrer, language: ctx.language,
      screen_resolution: ctx.screen_resolution, raw_query: rawQuery(),
      occurred_at: new Date().toISOString(),
    };
    if (extra) for (var k in extra) e[k] = extra[k];
    return e;
  }
  // Expõe um hook global p/ conversões manuais (ex.: recordConversion no app).
  window.abTrack = function (type, name, extra) {
    if (ab_test && ab_vid) send([baseEvent(type, name, extra)]);
  };

  // Sem atribuição resolvida: ainda faz injeção de forms/iframe (caso o cookie
  // apareça depois), mas não há o que rastrear.
  var HAS_ASSIGNMENT = !!(ab_test && ab_var && ab_vid);

  // ---- 1) exposição --------------------------------------------------------
  if (HAS_ASSIGNMENT) send([baseEvent('exposure', null)]);

  // ---- 2) injeção em formulários ------------------------------------------
  function injectForm(form) {
    if (!HAS_ASSIGNMENT || !form || form.__abInjected) return;
    form.__abInjected = true;
    var fields = { ab_vid: ab_vid, ab_var: ab_var, ab_test: ab_test };
    for (var name in fields) {
      var input = form.querySelector('input[name="' + name + '"]');
      if (!input) {
        input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        form.appendChild(input);
      }
      input.value = fields[name];
    }
  }
  function injectAllForms() {
    var forms = document.getElementsByTagName('form');
    for (var i = 0; i < forms.length; i++) injectForm(forms[i]);
  }

  // ---- 3) reescrita do iframe do Nexus ------------------------------------
  function rewriteNexusIframe(iframe) {
    if (!HAS_ASSIGNMENT || !iframe || iframe.__abRewritten) return;
    var src = iframe.getAttribute('src') || '';
    if (src.indexOf('nexus.dnia.ai/schedule') === -1) return;
    try {
      var u = new URL(src, location.href);
      u.searchParams.set('ab_vid', ab_vid);
      u.searchParams.set('ab_test', ab_test);
      u.searchParams.set('ab_var', ab_var);
      iframe.__abRewritten = true;
      iframe.setAttribute('src', u.toString());
    } catch (e) { /* ignora src inválido */ }
  }
  function rewriteAllIframes() {
    var frames = document.getElementsByTagName('iframe');
    for (var i = 0; i < frames.length; i++) rewriteNexusIframe(frames[i]);
  }

  // ---- 4) comportamento: scroll, tempo, cliques ---------------------------
  var startedAt = Date.now();
  var scrollMarks = { 25: false, 50: false, 75: false, 100: false };
  function onScroll() {
    if (!HAS_ASSIGNMENT) return;
    var doc = document.documentElement;
    var scrolled = (window.scrollY || doc.scrollTop) + window.innerHeight;
    var height = Math.max(doc.scrollHeight, document.body.scrollHeight);
    var pct = height > 0 ? Math.round((scrolled / height) * 100) : 0;
    [25, 50, 75, 100].forEach(function (m) {
      if (!scrollMarks[m] && pct >= m) {
        scrollMarks[m] = true;
        send([baseEvent('behavior', 'scroll', { metadata: { depth: m } })]);
      }
    });
  }
  function onClick(ev) {
    if (!HAS_ASSIGNMENT) return;
    var el = ev.target;
    while (el && el !== document.body) {
      if (el.hasAttribute && (el.hasAttribute('data-ab-cta') || el.tagName === 'A' || el.tagName === 'BUTTON')) {
        var label = el.getAttribute('data-ab-cta') || (el.textContent || '').trim().slice(0, 80);
        send([baseEvent('behavior', 'cta_click', { metadata: { label: label, tag: el.tagName } })]);
        return;
      }
      el = el.parentNode;
    }
  }
  var timeSent = false;
  function sendTime() {
    if (timeSent || !HAS_ASSIGNMENT) return;
    timeSent = true;
    send([baseEvent('behavior', 'time_on_page', { metadata: { seconds: Math.round((Date.now() - startedAt) / 1000) } })]);
  }

  // ---- bootstrap -----------------------------------------------------------
  function init() {
    injectAllForms();
    rewriteAllIframes();

    document.addEventListener('submit', function (e) {
      if (e.target && e.target.tagName === 'FORM') injectForm(e.target);
    }, true);

    if ('IntersectionObserver' in window || true) {
      window.addEventListener('scroll', throttle(onScroll, 500), { passive: true });
    }
    document.addEventListener('click', onClick, true);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') sendTime();
    });
    window.addEventListener('pagehide', sendTime);

    // Observa iframes/forms inseridos dinamicamente (modais SPA).
    if (window.MutationObserver) {
      new MutationObserver(function () { injectAllForms(); rewriteAllIframes(); })
        .observe(document.documentElement, { childList: true, subtree: true });
    }
    onScroll();
  }

  function throttle(fn, wait) {
    var last = 0, timer = null;
    return function () {
      var now = Date.now();
      if (now - last >= wait) { last = now; fn(); }
      else { clearTimeout(timer); timer = setTimeout(function () { last = Date.now(); fn(); }, wait - (now - last)); }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
