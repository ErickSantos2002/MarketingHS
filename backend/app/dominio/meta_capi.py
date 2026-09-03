"""O Meta Conversions API. Uma responsabilidade só: montar e mandar o evento.

Portado de `supabase/functions/send-to-meta-capi`, com duas mudanças
deliberadas:

  1. **A function original não tinha autenticação nenhuma** —
     `Access-Control-Allow-Origin: *` e zero verificação. Qualquer um na
     internet postava conversão no pixel da HS. Aqui não há endpoint público de
     evento: quem dispara é o servidor, no caminho de captura do lead (lote 7).
  2. As credenciais saem de `integration_secrets` (app/integracoes.py), não da
     tabela `meta_config` do dump — que está com 0 linhas e seria um segundo
     lugar de segredo.

⚠️ A HS ainda não decidiu se faz anúncio no Meta (spec, seção 9, 03/09/2026).
Por isso este módulo nasce parametrizado e DESLIGADO: sem credencial gravada,
`credenciais().configurado` é falso e quem chama não manda nada.
"""

import hashlib
import logging
import re
import time
from dataclasses import dataclass

import httpx

from app.integracoes import ler_segredo

logger = logging.getLogger(__name__)

# A versão fica fixa e visível de propósito: subir de versão é decisão, não
# efeito colateral de um deploy. A original usava v18.0.
VERSAO_API = "v18.0"
TIMEOUT = 15

SEGREDO_PIXEL = "META_PIXEL_ID"
SEGREDO_TOKEN = "META_ACCESS_TOKEN"
SEGREDO_TESTE = "META_TEST_EVENT_CODE"

# Os campos que o Meta espera como LISTA de hashes, e não como escalar.
_LISTA = {"em", "ph", "external_id"}


@dataclass(frozen=True)
class Credenciais:
    pixel_id: str | None
    access_token: str | None
    test_event_code: str | None

    @property
    def configurado(self) -> bool:
        return bool(self.pixel_id and self.access_token)


async def credenciais() -> Credenciais:
    """Nunca levanta — `ler_segredo` degrada para o ambiente e devolve None."""
    return Credenciais(
        pixel_id=await ler_segredo(SEGREDO_PIXEL),
        access_token=await ler_segredo(SEGREDO_TOKEN),
        test_event_code=await ler_segredo(SEGREDO_TESTE),
    )


def _hash(valor: str) -> str:
    """SHA-256 do valor normalizado. Minúscula e sem espaço nas pontas — é o que
    o Meta faz do lado dele antes de comparar."""
    return hashlib.sha256(valor.strip().lower().encode()).hexdigest()


def _telefone(bruto: str) -> str:
    """Só dígitos, com o 55 na frente.

    ⚠️ 10 ou 11 dígitos é número brasileiro sem código de país (fixo e celular).
    Já com 12 ou 13 o código está lá e acrescentar outro produziria um número
    que não existe — e o Meta não reclama, só não atribui.

    ⚠️ LIMITE HERDADO: a regra é por comprimento, não por validade. Um número
    estrangeiro de 10 ou 11 dígitos (um `2125550199` dos EUA, por exemplo) leva
    um `55` na frente por engano e o hash sai errado — calado, como sempre. Não
    dá para distinguir: um fixo americano de 10 dígitos e um fixo brasileiro de
    10 dígitos são a mesma string. Vem do original (send-to-meta-capi). Se o
    lote 7 passar a captar lead de fora do Brasil, é aqui que se mexe.
    """
    digitos = re.sub(r"\D", "", bruto)
    if len(digitos) in (10, 11):
        return "55" + digitos
    return digitos


def montar_evento(
    event_name: str,
    *,
    event_id: str | None = None,
    email: str | None = None,
    phone: str | None = None,
    first_name: str | None = None,
    last_name: str | None = None,
    external_id: str | None = None,
    client_ip_address: str | None = None,
    client_user_agent: str | None = None,
    event_source_url: str | None = None,
    fbc: str | None = None,
    fbp: str | None = None,
    custom_data: dict | None = None,
) -> dict:
    """Um evento pronto para o Graph.

    ⚠️ Campo ausente NÃO entra. Mandar `sha256("")` é pior que omitir: o Meta o
    trata como identificador válido, e ele bate com todo mundo que também mandou
    vazio.
    """
    user_data: dict = {}
    for chave, valor in (("em", email), ("ph", phone), ("fn", first_name),
                         ("ln", last_name), ("external_id", external_id)):
        if not valor or not str(valor).strip():
            continue
        bruto = _telefone(valor) if chave == "ph" else str(valor)
        digest = _hash(bruto)
        user_data[chave] = [digest] if chave in _LISTA else digest

    # Crus de propósito: são identificadores do próprio Meta e do transporte.
    # Hashear qualquer um deles quebra a atribuição em silêncio.
    for chave, valor in (("client_ip_address", client_ip_address),
                         ("client_user_agent", client_user_agent),
                         ("fbc", fbc), ("fbp", fbp)):
        if valor:
            user_data[chave] = valor

    if not user_data:
        raise ValueError(
            f"Evento '{event_name}' não tem nenhum identificador de pessoa. O "
            "Meta recusaria com error_subcode 2804050 (insufficient customer "
            "parameters). Evento sem PII é Pixel-only, não vai ao CAPI.")

    evento = {
        "event_name": event_name,
        "event_time": int(time.time()),
        "action_source": "website",
        "user_data": user_data,
        "custom_data": custom_data or {},
    }
    if event_source_url:
        evento["event_source_url"] = event_source_url
    # ⚠️ O event_id é o que deduplica com o Pixel do navegador. Ele só existe se
    # quem chama gerou UM id e usou nos dois lados; por isso é parâmetro, e não
    # gerado aqui dentro.
    if event_id:
        evento["event_id"] = event_id
    return evento


async def enviar(eventos: list[dict], *, creds: Credenciais,
                 test_event_code: str | None = None) -> dict:
    """Manda os eventos ao Graph e devolve a resposta. Levanta em falha.

    ⚠️ Levantar é o certo AQUI, no cliente. Quem chama é que decide engolir —
    e no caminho de captura de lead ele deve engolir: perder a contagem de uma
    conversão é ruim; perder o lead é pior.
    """
    if not creds.configurado:
        raise RuntimeError(
            "Meta não configurado: falta pixel_id ou access_token em "
            "integration_secrets (Configurações → Integrações → Meta).")

    corpo: dict = {"data": eventos}
    codigo = test_event_code or creds.test_event_code
    if codigo:
        corpo["test_event_code"] = codigo

    url = f"https://graph.facebook.com/{VERSAO_API}/{creds.pixel_id}/events"
    # ⚠️ O token vai no CABEÇALHO, nunca em `params`. `app.main` liga o logger
    # raiz em INFO, e o httpx loga `request.url` — a URL INTEIRA, com query
    # string — em toda chamada, inclusive quando dá certo. Um `access_token`
    # em `params` vazaria para o log a cada envio. A Graph API aceita
    # `Authorization: Bearer`, então não há motivo para arriscar.
    async with httpx.AsyncClient(timeout=TIMEOUT) as cliente:
        resposta = await cliente.post(
            url, headers={"Authorization": f"Bearer {creds.access_token}"}, json=corpo)
    resposta.raise_for_status()
    return resposta.json()
