"""Montagem do e-mail de aviso de lead a vendas. Puro: sem banco, sem rede.

⚠️ Todo valor vem de formulário PÚBLICO: passa por `growthhs.uma_linha` (uma
linha só, sem forjar linha nossa) e `html.escape`. Nunca entram consentimento,
IP nem user-agent: só os campos listados aqui são lidos de `dados_informados`.
"""

import html
import json
from datetime import datetime
from zoneinfo import ZoneInfo

from app.crm.growthhs import uma_linha

# Cópia de `app.agendamento.execucao.CHAVES_DE_CONTROLE` (importar de lá puxa
# banco e config); mantenha as duas iguais.
CHAVES_DE_CONTROLE = frozenset({
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "source", "ab_test", "ab_var", "ab_vid", "tipo", "status"})

# Nunca no e-mail, nem se vierem escondidos entre os campos extras.
CHAVES_SENSIVEIS = frozenset({"ip", "user_agent", "consentimento", "consent"})

FUSO = ZoneInfo("America/Sao_Paulo")
LIMITE_ASSUNTO = 200
UTMS = ("utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content")


def _dict(valor) -> dict:
    """jsonb cru pode chegar como texto: aceita dict ou JSON."""
    if isinstance(valor, str):
        try:
            valor = json.loads(valor)
        except ValueError:
            return {}
    return valor if isinstance(valor, dict) else {}


def _quando(valor) -> str:
    if isinstance(valor, str):
        try:
            valor = datetime.fromisoformat(valor.replace("Z", "+00:00"))
        except ValueError:
            return uma_linha(valor)
    if not isinstance(valor, datetime):
        return ""
    return valor.astimezone(FUSO).strftime("%d/%m/%Y às %H:%M")


def _extras(lead: dict, conversao: dict, rotulos: dict[str, str]) -> list[tuple[str, str]]:
    extras = _dict(_dict(conversao.get("dados_informados")).get("campos_extras"))
    if not extras:
        extras = _dict(lead.get("campos_extras"))
    saida = []
    for chave, valor in extras.items():
        if chave in CHAVES_DE_CONTROLE or str(chave).lower() in CHAVES_SENSIVEIS:
            continue
        texto = uma_linha(valor)
        if texto:
            saida.append((uma_linha(rotulos.get(chave) or chave), texto))
    return saida


def montar_aviso(lead: dict, conversao: dict, *, contato_novo: bool,
                 agendamento: bool, rotulos: dict[str, str] | None = None,
                 nome_do_site: str | None = None,
                 url_contato: str) -> tuple[str, str, str]:
    """`(assunto, html, texto)` do aviso. Ver as linhas e a ordem no plano."""
    rotulos = rotulos or {}
    nome = uma_linha(lead.get("nome"))
    email = uma_linha(lead.get("email"))
    empresa = uma_linha(lead.get("empresa"))

    prefixo = ("Reunião agendada" if agendamento
               else "Novo lead" if contato_novo else "Lead voltou")
    quem = nome or email
    assunto = f"{prefixo}: {quem}" + (f" — {empresa}" if empresa else "")
    assunto = uma_linha(assunto)[:LIMITE_ASSUNTO]

    if conversao.get("page_slug"):
        onde = f"Landing {uma_linha(conversao['page_slug'])}"
    elif nome_do_site:
        onde = f"Site {uma_linha(nome_do_site)}"
    else:
        onde = ""
    if onde and conversao.get("form_id"):
        onde += f" · formulário {uma_linha(conversao['form_id'])}"

    utms = " / ".join(f"{k}={uma_linha(conversao[k])}"
                      for k in UTMS if uma_linha(conversao.get(k)))

    itens: list[tuple[str, str]] = [
        ("Nome", nome), ("E-mail", email),
        ("WhatsApp", uma_linha(lead.get("whatsapp") or lead.get("phone_normalized"))),
        ("Empresa", empresa), ("Cargo", uma_linha(lead.get("cargo"))),
        *_extras(lead, conversao, rotulos),
        ("Onde", onde), ("Página", uma_linha(conversao.get("page_url"))),
        ("Canal", uma_linha(conversao.get("canal"))), ("UTMs", utms),
        ("Quando", _quando(conversao.get("converted_at"))),
        ("Contato", "Novo" if contato_novo else "Já existia — converteu de novo"),
    ]
    itens = [(r, v) for r, v in itens if v]

    e = html.escape
    linhas_html = "".join(
        f"<tr><td style=\"padding:4px 12px 4px 0;color:#555\">{e(r)}</td>"
        f"<td style=\"padding:4px 0\"><strong>{e(v)}</strong></td></tr>"
        for r, v in itens)
    corpo = (f"<p>{e(assunto)}</p><table>{linhas_html}</table>"
             f"<p><a href=\"{e(url_contato, quote=True)}\" style=\"display:inline-block;"
             f"padding:8px 14px;background:#0b5fff;color:#fff;text-decoration:none;"
             f"border-radius:4px\">Abrir o contato no MarketingHS</a></p>")
    texto = "\n".join(
        [assunto, ""] + [f"{r}: {v}" for r, v in itens]
        + ["", f"Abrir o contato no MarketingHS: {url_contato}"])
    return assunto, corpo, texto
