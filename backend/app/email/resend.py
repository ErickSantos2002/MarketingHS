"""O cliente HTTP do Resend. Uma responsabilidade só: falar com a API.

Separado do worker de propósito — é o único ponto do sistema que faz rede para
fora, e é o que um teste precisa substituir para rodar sem enviar nada.
"""

import httpx
import json

API = "https://api.resend.com/emails"
TIMEOUT = 30

# Um `retry-after` absurdo (ou o de uma cota diária estourada) não pode
# congelar o worker para sempre; uma hora é o bastante para voltar a olhar.
ESPERA_MAXIMA = 3600


class LimiteDoResend(Exception):
    """429: o Resend pediu para esperar `espera` segundos.

    ⚠️ Não é falha do envio. Quem chama devolve a mensagem à fila SEM gastar
    tentativa — tratar como erro comum mandaria e-mail bom para a fila-morta
    só porque o ritmo passou do limite por um instante.
    """

    def __init__(self, espera: float):
        super().__init__(f"limite de taxa do Resend — esperar {espera:g}s")
        self.espera = espera


def interpretar_envio(resposta: httpx.Response) -> str:
    """O id do e-mail, `LimiteDoResend` no 429, `HTTPStatusError` no resto."""
    if resposta.status_code == 429:
        try:
            espera = float(resposta.headers.get("retry-after", ""))
        except ValueError:
            espera = 1.0
        if not espera > 0:
            espera = 1.0
        raise LimiteDoResend(min(espera, ESPERA_MAXIMA))
    resposta.raise_for_status()
    return resposta.json().get("id", "")


async def enviar(chave: str, de: str, para: str, assunto: str,
                 html: str, texto: str, cabecalhos: dict,
                 tags: list[dict] | None = None) -> str:
    """Devolve o id do e-mail no Resend. Levanta em qualquer falha.

    ⚠️ Levantar é o certo aqui: quem chama é o worker, que sabe transformar
    exceção em retentativa. Engolir o erro e devolver vazio faria a mensagem
    sair da fila como se tivesse sido enviada — o pior desfecho possível.
    """
    corpo = {"from": de, "to": [para], "subject": assunto, "html": html,
             "headers": cabecalhos}
    if texto:
        corpo["text"] = texto
    if tags:
        # As tags voltam nos eventos do webhook e são o que correlaciona o
        # evento ao envio de forma EXATA. Sem elas a correlação depende do
        # `resend_email_id`, que é o caminho mais fraco: ele não existe se o
        # processo morrer entre o POST aqui e o UPDATE em campaign_sends.
        #
        # ⚠️ O Resend só aceita [a-zA-Z0-9_-] em nome e valor. UUID passa;
        # qualquer coisa com ponto ou arroba, não — e a API recusa o ENVIO
        # inteiro, não só a tag.
        corpo["tags"] = tags
    async with httpx.AsyncClient(timeout=TIMEOUT) as cliente:
        resposta = await cliente.post(
            API, headers={"Authorization": f"Bearer {chave}"}, json=corpo)
    return interpretar_envio(resposta)


# ── Domínios ─────────────────────────────────────────────────────────────────
# Restaurado no lote 8A: a origem (`resend-config`) testava a chave, listava e
# exigia domínio verificado, e ligava open/click tracking. O 3C tirou tudo; o
# Erick decidiu devolver.

DOMINIOS = "https://api.resend.com/domains"


class FalhaDeRede(Exception):
    """A API do Resend não respondeu. Quem chama decide se é 502 ou degradação."""


def restrita(resposta: httpx.Response) -> bool:
    """O 401 é de chave *sending-only* — VÁLIDA, só não pode ler domínio.

    ⚠️ Qualquer outro 401 (corpo diferente, ou não-JSON) NÃO é restrita: não
    classificamos chave como válida por omissão.
    """
    try:
        corpo = resposta.json()
    except ValueError:
        return False
    if isinstance(corpo, dict) and corpo.get("name") == "restricted_api_key":
        return True
    return "restricted_api_key" in json.dumps(corpo)


async def testar_chave(chave: str) -> dict:
    """Classifica a chave sem gravá-la. NUNCA levanta."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as cliente:
            resposta = await cliente.get(
                DOMINIOS, headers={"Authorization": f"Bearer {chave}"})
    except httpx.HTTPError:
        return {"valida": False, "motivo": "network"}

    if resposta.status_code == 200:
        try:
            corpo = resposta.json()
        except ValueError:
            return {"valida": False, "motivo": "network"}
        dados = corpo.get("data") if isinstance(corpo, dict) else None
        return {"valida": True, "escopo": "full", "dominios": [
            {"id": d.get("id"), "name": d.get("name"), "status": d.get("status"),
             "capabilities": d.get("capabilities")}
            for d in (dados or []) if isinstance(d, dict)]}

    if resposta.status_code == 401:
        if restrita(resposta):
            return {"valida": True, "escopo": "sending_only", "dominios": []}
        return {"valida": False, "motivo": "invalid_api_key"}
    if resposta.status_code == 403:
        return {"valida": False, "motivo": "invalid_api_key"}
    return {"valida": False, "motivo": "unknown"}


async def ler_dominio(chave: str, dominio_id: str) -> dict:
    """O estado REAL do rastreamento, pelo GET de domínio único. NUNCA levanta.

    ⚠️ A listagem (`GET /domains`) não garante trazer open/click tracking por
    item; o GET de domínio único sempre traz. É o que permite avisar o caso
    traiçoeiro: tracking ligado na conta e o CNAME nunca adicionado no DNS.
    """
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as cliente:
            resposta = await cliente.get(
                f"{DOMINIOS}/{dominio_id}",
                headers={"Authorization": f"Bearer {chave}"})
    except httpx.HTTPError:
        return {"ok": False, "motivo": "network"}

    if resposta.status_code == 401:
        return {"ok": False, "motivo": "restricted_api_key" if restrita(resposta)
                else "unknown"}
    if resposta.status_code == 404:
        return {"ok": False, "motivo": "not_found"}
    if not resposta.is_success:
        return {"ok": False, "motivo": "unknown"}
    try:
        corpo = resposta.json()
    except ValueError:
        return {"ok": False, "motivo": "unknown"}

    registros = corpo.get("records") if isinstance(corpo.get("records"), list) else []
    return {
        "ok": True,
        "open_tracking": bool(corpo.get("open_tracking")),
        "click_tracking": bool(corpo.get("click_tracking")),
        "tracking_subdomain": corpo.get("tracking_subdomain"),
        "status": corpo.get("status"),
        "records": [r for r in registros
                    if isinstance(r, dict) and r.get("record") == "Tracking"],
    }


async def alterar_dominio(chave: str, dominio_id: str, corpo: dict) -> httpx.Response:
    """PATCH no domínio. Devolve a resposta crua — quem chama interpreta.
    Levanta `FalhaDeRede` se não houver resposta."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as cliente:
            return await cliente.patch(
                f"{DOMINIOS}/{dominio_id}",
                headers={"Authorization": f"Bearer {chave}"}, json=corpo)
    except httpx.HTTPError as e:
        raise FalhaDeRede(str(e)) from e
