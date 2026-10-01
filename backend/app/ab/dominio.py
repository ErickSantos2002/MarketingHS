"""Regras puras do teste A/B: domínio, user-agent e sorteio. Sem banco.

Porte de `backend/supabase/functions/go/index.ts` e `ab-events/index.ts`, que
tinham cada uma a sua cópia destas funções (Edge Function não importava de
`src/`). O frontend tem o espelho da parte de domínio em `lib/abConfig.ts`.
"""

import random
import re
from collections.abc import Callable


def normalizar_dominio(entrada: str | None) -> str:
    """Sem protocolo, sem `www.`, sem caminho/porta/query, minúsculo."""
    s = (entrada or "").strip().lower()
    s = re.sub(r"^https?://", "", s)
    s = re.sub(r"^www\.", "", s)
    s = re.sub(r"[/:?#].*$", "", s)
    return re.sub(r"\.+$", "", s)


def host_no_dominio(host: str | None, dominio: str | None) -> bool:
    """`host` é o próprio domínio ou um subdomínio dele?

    `promo.exemplo.com` em `exemplo.com`, sim; `exemplo.com.evil.io`, não.
    """
    h = (host or "").lower()
    d = normalizar_dominio(dominio)
    if not d or not h:
        return False
    return h == d or h.endswith("." + d)


# (padrão, nome). A ORDEM importa e é a da origem: iPhone tem "Mac OS X" no
# user-agent, e Edge tem "Chrome/".
_SISTEMAS = ((r"Windows NT", "Windows"), (r"iPhone|iPad|iPod", "iOS"),
             (r"Mac OS X", "macOS"), (r"Android", "Android"), (r"Linux", "Linux"))
_NAVEGADORES = ((r"Edg/", "Edge", r"Edg/([\d.]+)"),
                (r"OPR/|Opera", "Opera", r"(?:OPR|Opera)/([\d.]+)"),
                (r"Chrome/", "Chrome", r"Chrome/([\d.]+)"),
                (r"Firefox/", "Firefox", r"Firefox/([\d.]+)"),
                (r"Safari/", "Safari", r"Version/([\d.]+)"))


def ler_user_agent(ua: str | None) -> dict:
    """Leitura leve, no servidor. A resolução de tela chega depois, pelo coletor."""
    s = ua or ""
    if re.search(r"\bMobile\b|Android.+Mobile|iPhone|iPod|Windows Phone", s, re.I):
        aparelho = "mobile"
    elif re.search(r"\biPad\b|Tablet|Android(?!.*Mobile)", s, re.I):
        aparelho = "tablet"
    else:
        aparelho = "desktop"

    sistema = next((nome for padrao, nome in _SISTEMAS if re.search(padrao, s, re.I)),
                   "unknown")

    navegador, versao = "unknown", ""
    for padrao, nome, padrao_versao in _NAVEGADORES:
        if re.search(padrao, s, re.I):
            achado = re.search(padrao_versao, s, re.I)
            navegador, versao = nome, achado.group(1) if achado else ""
            break

    return {"device_type": aparelho, "os": sistema, "browser": navegador,
            "browser_version": versao}


def peso(variante: dict) -> float:
    """Peso 0 (ou negativo) = SEM TRÁFEGO — decisão 7 do Erick (01/10/2026).

    A origem dava peso 1 a quem tinha 0, e a tela deixa digitar 0 esperando
    "sem tráfego" (a variante nova nasce com 0). Peso AUSENTE ou não numérico
    continua valendo 1, como na origem: é variante gravada antes de o campo
    existir, não alguém que pediu zero.
    """
    valor = variante.get("weight")
    if isinstance(valor, bool) or not isinstance(valor, (int, float)):
        return 1
    return valor if valor > 0 else 0


def sortear(variantes: list[dict],
            aleatorio: Callable[[], float] | None = None) -> dict | None:
    """Sorteio por peso. `aleatorio` existe para o teste; o padrão é
    `random.random`, lido na hora da chamada (e não na definição) para que o
    `monkeypatch` do teste alcance.

    Variante de peso 0 nunca sai. Se NENHUMA tem peso, devolve None — quem
    chama decide para onde vai o tráfego (o redirecionador manda ao controle,
    como no teste pausado)."""
    aleatorio = aleatorio or random.random
    candidatas = [(v, peso(v)) for v in variantes]
    candidatas = [(v, p) for v, p in candidatas if p > 0]
    if not candidatas:
        return None
    r = aleatorio() * sum(p for _, p in candidatas)
    for variante, p in candidatas:
        r -= p
        if r < 0:
            return variante
    return candidatas[-1][0]
