"""O canal de um toque (visita ou conversão) — prova do RD, 21/10/2026.

Um de `pago | social | email | organico | referencia | campanha | direto`. É a régua dos
números por página (Tarefa 5): a mesma função classifica a visita e a
conversão, senão a taxa por canal compara coisas diferentes.

A ordem importa e é a do plano:
1. `gclid` ou `utm_medium` de mídia paga → `pago` (Google Ads sem UTM chega
   só com `gclid`; sem ele cairia em "orgânico" pelo referrer do Google);
2. `utm_medium = email` → `email`;
3. `fbclid`, `utm_source` ou referrer de rede social → `social`;
4. referrer de buscador → `organico`;
5. referrer de outro host → `referencia`;
6. `utm_source` ou `utm_medium` presente que não caiu em nada acima →
   `campanha` (achado da prova, 22/10: `utm_source=teste` caía em "direto",
   e link marcado de propósito não é tráfego direto);
7. o resto — sem referrer, ou referrer do próprio host → `direto`.
"""

from urllib.parse import urlsplit

MEIOS_PAGOS = frozenset({"cpc", "ppc", "paid", "pago", "ads"})

# Comparação por "termina com" sobre o host, depois de tirar `www.`/`m.`/`l.`.
REDES_SOCIAIS = ("facebook.com", "fb.com", "fb.me", "instagram.com", "linkedin.com",
                 "lnkd.in", "t.co", "twitter.com", "x.com", "youtube.com", "youtu.be",
                 "tiktok.com", "pinterest.com", "whatsapp.com", "wa.me", "threads.net")
FONTES_SOCIAIS = frozenset({"facebook", "fb", "instagram", "ig", "linkedin", "twitter",
                            "x", "youtube", "tiktok", "pinterest", "whatsapp", "meta",
                            "threads"})
BUSCADORES = ("google.", "bing.com", "yahoo.", "duckduckgo.com", "ecosia.org",
              "yandex.", "baidu.com", "search.brave.com")


def _host(url: str | None) -> str:
    if not isinstance(url, str) or not url.strip():
        return ""
    try:
        return (urlsplit(url.strip()).hostname or "").lower()
    except ValueError:
        return ""


def _casa_dominio(host: str, dominio: str) -> bool:
    return host == dominio or host.endswith("." + dominio)


def _buscador(host: str) -> bool:
    for b in BUSCADORES:
        if b.endswith("."):
            # `google.` casa google.com, google.com.br, www.google.co.uk.
            if host.startswith(b) or ("." + b) in host:
                return True
        elif _casa_dominio(host, b):
            return True
    return False


def canal_do_toque(*, utm_source: str | None, utm_medium: str | None,
                   referrer: str | None, gclid: str | None, fbclid: str | None,
                   host_da_pagina: str | None) -> str:
    meio = (utm_medium or "").strip().lower()
    fonte = (utm_source or "").strip().lower()
    if (gclid or "").strip() or meio in MEIOS_PAGOS:
        return "pago"
    if meio == "email":
        return "email"
    host = _host(referrer)
    if ((fbclid or "").strip() or fonte in FONTES_SOCIAIS
            or (host and any(_casa_dominio(host, r) for r in REDES_SOCIAIS))):
        return "social"
    if host and _buscador(host):
        return "organico"
    proprio = (host_da_pagina or "").strip().lower()
    if host and host != proprio:
        return "referencia"
    if fonte or meio:
        return "campanha"
    return "direto"
