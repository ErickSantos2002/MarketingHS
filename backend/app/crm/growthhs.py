"""O cliente do GrowthHS. Uma responsabilidade: montar o card do contrato e
mandar.

Contrato: `docs/contratos/2026-09-02-endpoint-card-comercial-growthhs.md`
(`POST /api/v1/integration/cards`, `X-API-Key`, escopo `cards:create`).
⚠️ Em 21/09/2026 o endpoint ainda NÃO existe no `hsgrowth-sistema`. Este módulo
nasce parametrizado e desligado: sem configuração, `Config.configurado` é falso
e a fila não é drenada (ver `app/crm/entrega.py`).

As regras de negócio que viajam no corpo são as do `handoff-to-nexus` de
origem, portadas literalmente: origem por UTM e as faixas de faturamento e de
funcionários do Nexus antigo (o contrato pede ao GrowthHS que diga se usa
outras).
"""

import logging
import re
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx

from app.database import sessao
from app.integracoes import ler_segredo

logger = logging.getLogger(__name__)

SEGREDO_CHAVE = "GROWTHHS_API_KEY"
TIMEOUT = 15
CAMINHO_CARDS = "/api/v1/integration/cards"
UTMS = ("utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content")


@dataclass(frozen=True)
class Config:
    base_url: str | None
    board_id: int | None
    app_url: str | None
    api_key: str | None

    @property
    def configurado(self) -> bool:
        return bool(self.base_url and self.board_id and self.api_key)

    def url_do_card(self, card_id) -> str | None:
        """O link "Ver no GrowthHS" (rota `/cards/:cardId` do app dele)."""
        if not self.app_url or card_id is None:
            return None
        return f"{self.app_url.rstrip('/')}/cards/{card_id}"


async def ler_config() -> Config:
    """Nunca levanta: banco fora vira "não configurado", e a fila espera."""
    try:
        async with sessao(role="service_role") as conn:
            linha = await conn.fetchrow(
                "SELECT base_url, board_id, app_url FROM growthhs_config LIMIT 1")
    except Exception:
        logger.exception("[growthhs] não foi possível ler growthhs_config")
        linha = None
    return Config(base_url=linha["base_url"] if linha else None,
                  board_id=linha["board_id"] if linha else None,
                  app_url=linha["app_url"] if linha else None,
                  api_key=await ler_segredo(SEGREDO_CHAVE))


def normalizar_faturamento(valor: str | None) -> str | None:
    """`mapRevenue` do handoff-to-nexus, literal (inclusive a ordem)."""
    if not valor:
        return None
    s = valor.lower()
    # ⚠️ `and "500" not in s` é a ÚNICA diferença da origem: lá, "Entre R$ 100
    # mil e R$ 500 mil" contém "100 mil" e caía em "Ate 100k/mes" — a primeira
    # faixa engolia a segunda. Correção deliberada (plano do 8D, Tarefa 2).
    if ("100 mil" in s or "100k" in s or "até 100" in s or "ate 100" in s) and "500" not in s:
        return "Ate 100k/mes"
    if ("100" in s and "500" in s) or "100k e 500k" in s:
        return "Entre 100k e 500k/mes"
    if ("500" in s and ("1 milh" in s or "1mm" in s)) or "500k e 1mm" in s:
        return "Entre 500k e 1MM/mes"
    if ("1 milh" in s and "3 milh" in s) or "1mm e 3mm" in s:
        return "Entre 1MM e 3MM/mes"
    if ("3 milh" in s and "5 milh" in s) or "3mm e 5mm" in s:
        return "Entre 3MM e 5MM/mes"
    if "acima" in s and ("5 milh" in s or "5mm" in s):
        return "Acima de 5MM/mes"
    return None


def normalizar_funcionarios(valor: str | None) -> str | None:
    """`mapEmployeeCount` do handoff-to-nexus, literal."""
    if not valor:
        return None
    s = valor.lower().strip()
    if "individual" in s or "eu s" in s:
        return "Eu S.A."
    if "1-10" in s or re.fullmatch(r"2\s*-\s*10", s) or "1 a 10" in s:
        return "1-10 funcionarios"
    if "11-50" in s or re.search(r"11\s*-\s*(25|50)", s) or re.search(r"26\s*-\s*(49|50)", s):
        return "11-50 funcionarios"
    if "51-200" in s or re.search(r"51\s*-\s*200", s) or "acima de 50" in s:
        return "51-200 funcionarios"
    if "+200" in s or "acima de 200" in s or "mais de 200" in s:
        return "+200 funcionarios"
    return None


def _ou_traco(valor) -> str:
    texto = str(valor).strip() if valor is not None else ""
    return texto or "—"


def montar_card(lead: dict, board_id: int) -> dict:
    """O corpo do contrato. `list_id` nulo = etapa de entrada do funil —
    qual é a entrada é decisão do CRM (decisão 7 do plano do 8D).

    Origem: "Tráfego pago" se houver QUALQUER UTM, senão "Orgânico" — regra
    global da origem; o `source` do lead é ignorado de propósito, para não
    haver dois dialetos de origem.
    """
    utms = {c: lead.get(c) for c in UTMS if lead.get(c)}
    nome = lead.get("nome") or lead.get("email") or "Sem nome"
    titulo = f"{nome} — {lead['empresa']}" if lead.get("empresa") else nome
    return {
        "source": "marketinghs",
        "external_id": str(lead["id"]),
        "board_id": board_id,
        "list_id": None,
        "title": titulo,
        "description": (f"Campanha: {_ou_traco(lead.get('utm_campaign'))}\n"
                        f"Desafios: {_ou_traco((lead.get('desafios') or '')[:500])}\n"
                        f"Indicação: {_ou_traco(lead.get('indicacao'))}"),
        "contact": {"name": nome, "email": lead.get("email"),
                    "phone": lead.get("phone_normalized") or lead.get("whatsapp"),
                    "company": lead.get("empresa"), "job_title": lead.get("cargo")},
        "origin": "Tráfego pago" if utms else "Orgânico",
        "acquisition_channel": "Inbound",
        "utm_source": lead.get("utm_source"),
        "utm_campaign": lead.get("utm_campaign"),
        "utm_term": lead.get("utm_term"),
        "utm_params": urlencode(utms) if utms else None,
        "business_info": {"faturamento": normalizar_faturamento(lead.get("faturamento")),
                          "funcionarios": normalizar_funcionarios(lead.get("funcionarios")),
                          "lead_score": lead.get("lead_score"),
                          "etiqueta": lead.get("etiqueta")},
    }


class ErroDefinitivo(Exception):
    """4xx: configuração ou corpo — re-tentar não muda nada.

    `status` viaja no erro (revisão final do 8D, I3): 401/403/404 são
    configuração — a mesma para todos os pedidos — e pausam a fila; 422 é o
    corpo daquele lead e falha só o pedido dele."""

    def __init__(self, detalhe: str, status: int | None = None):
        super().__init__(detalhe)
        self.status = status


class ErroTransitorio(Exception):
    """5xx, 429 ou sem resposta — a fila re-tenta."""


async def criar_card(cfg: Config, corpo: dict, *,
                     transporte: httpx.AsyncBaseTransport | None = None) -> dict:
    url = cfg.base_url.rstrip("/") + CAMINHO_CARDS
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, transport=transporte) as cliente:
            resposta = await cliente.post(url, json=corpo,
                                          headers={"X-API-Key": cfg.api_key})
    except httpx.HTTPError as erro:
        raise ErroTransitorio(f"sem resposta do GrowthHS: {erro}") from erro
    if 200 <= resposta.status_code < 300:
        # ⚠️ Um 2xx já criou o card do lado do GrowthHS — daqui para frente
        # NUNCA se levanta exceção, mesmo que o corpo não sirva para nada.
        # Levantar aqui devolveria um pedido "sem resposta" para quem chama,
        # que re-tentaria e criaria um SEGUNDO card (achado I1 do round 1 de
        # revisão do 8D/Tarefa 4). Corpo que não é JSON, ou é JSON mas não é
        # objeto, vira dict vazio: quem chama grava a entrega sem
        # card_id/person_id, mas grava. Revisão final do 8D (M1): TODO 2xx
        # é sucesso, não só 200/201 — um 202 ou 204 tratado como erro seria
        # re-enviado e viraria o segundo card. Corpo vazio (204) é `{}`.
        if not resposta.content:
            return {}
        try:
            corpo_resposta = resposta.json()
        except ValueError:
            logger.warning("[growthhs] 2xx com corpo que não é JSON válido: %s",
                           resposta.text[:200])
            return {}
        if not isinstance(corpo_resposta, dict):
            logger.warning("[growthhs] 2xx com corpo JSON que não é objeto: %r",
                           corpo_resposta)
            return {}
        return corpo_resposta
    detalhe = f"{resposta.status_code}: {resposta.text[:400]}"
    if resposta.status_code >= 500 or resposta.status_code == 429:
        raise ErroTransitorio(detalhe)
    raise ErroDefinitivo(detalhe, resposta.status_code)


async def testar(cfg: Config, *,
                 transporte: httpx.AsyncBaseTransport | None = None) -> int:
    """Só confere que a API responde (decisão 10): o contrato não tem rota de
    leitura autenticada, e testar a chave exigiria criar um card."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, transport=transporte) as cliente:
            resposta = await cliente.get(cfg.base_url.rstrip("/") + "/health")
    except httpx.HTTPError as erro:
        raise ErroTransitorio(f"sem resposta do GrowthHS: {erro}") from erro
    return resposta.status_code
