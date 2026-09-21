"""O cliente do GrowthHS — o corpo do contrato e a leitura do erro.

O modo de falhar é o card nascer com origem errada (o painel do comercial
conta "Orgânico" onde houve anúncio pago), faixa de faturamento que o CRM não
reconhece, ou um 5xx tratado como definitivo (o lead nunca chega) — e um 4xx
tratado como transitório (a fila re-tenta para sempre uma chave errada).
"""

import httpx
import pytest

from app.crm import growthhs
from app.crm.growthhs import (Config, ErroDefinitivo, ErroTransitorio, criar_card,
                              montar_card, normalizar_faturamento,
                              normalizar_funcionarios)

LEAD = {"id": "c351c124-0000-0000-0000-000000000001", "nome": "Carla Menezes",
        "email": "carla@transportadora.com.br", "whatsapp": "81999999999",
        "phone_normalized": "+5581999999999", "empresa": "Transportadora XYZ",
        "cargo": "Gerente de SESMT", "faturamento": "Entre R$ 100 mil e R$ 500 mil",
        "funcionarios": "11-50", "desafios": "controle de jornada", "indicacao": None,
        "utm_source": "google", "utm_medium": "cpc", "utm_campaign": "black-friday",
        "utm_term": None, "utm_content": None, "lead_score": 60, "etiqueta": "hotlead"}
CFG = Config(base_url="https://growthhs.exemplo.invalid", board_id=3,
             app_url="https://app.growthhs.exemplo.invalid", api_key="chave-8d")


@pytest.mark.parametrize("entrada, saida", [
    ("Até R$ 100 mil", "Ate 100k/mes"),
    ("Entre R$ 100 mil e R$ 500 mil", "Entre 100k e 500k/mes"),
    ("Entre 500 mil e 1 milhão", "Entre 500k e 1MM/mes"),
    ("Entre 1 milhão e 3 milhões", "Entre 1MM e 3MM/mes"),
    ("Entre 3 milhões e 5 milhões", "Entre 3MM e 5MM/mes"),
    ("Acima de 5 milhões", "Acima de 5MM/mes"),
    ("não sei", None), (None, None),
])
def test_faturamento_nas_faixas_da_origem(entrada, saida):
    assert normalizar_faturamento(entrada) == saida


@pytest.mark.parametrize("entrada, saida", [
    ("Individual", "Eu S.A."), ("1-10", "1-10 funcionarios"), ("2 - 10", "1-10 funcionarios"),
    ("11-50", "11-50 funcionarios"), ("26-49", "11-50 funcionarios"),
    ("51-200", "51-200 funcionarios"), ("acima de 50", "51-200 funcionarios"),
    ("mais de 200", "+200 funcionarios"), ("", None), (None, None),
])
def test_funcionarios_nas_faixas_da_origem(entrada, saida):
    assert normalizar_funcionarios(entrada) == saida


def test_corpo_do_contrato():
    corpo = montar_card(LEAD, 3)
    assert corpo["source"] == "marketinghs" and corpo["external_id"] == LEAD["id"]
    assert corpo["board_id"] == 3 and corpo["list_id"] is None
    assert corpo["title"] == "Carla Menezes — Transportadora XYZ"
    assert corpo["description"] == ("Campanha: black-friday\nDesafios: controle de jornada"
                                    "\nIndicação: —")
    assert corpo["contact"] == {"name": "Carla Menezes", "email": "carla@transportadora.com.br",
                                "phone": "+5581999999999", "company": "Transportadora XYZ",
                                "job_title": "Gerente de SESMT"}
    assert corpo["origin"] == "Tráfego pago" and corpo["acquisition_channel"] == "Inbound"
    assert corpo["utm_params"] == "utm_source=google&utm_medium=cpc&utm_campaign=black-friday"
    assert corpo["business_info"] == {"faturamento": "Entre 100k e 500k/mes",
                                      "funcionarios": "11-50 funcionarios",
                                      "lead_score": 60, "etiqueta": "hotlead"}


def test_sem_utm_e_organico_e_sem_nome_usa_o_email():
    lead = {**LEAD, "nome": None, "empresa": None, "utm_source": None, "utm_medium": None,
            "utm_campaign": None}
    corpo = montar_card(lead, 3)
    assert corpo["origin"] == "Orgânico" and corpo["utm_params"] is None
    assert corpo["title"] == "carla@transportadora.com.br"


def _transporte(status, corpo=None, registro=None):
    def responder(request):
        if registro is not None:
            registro.append(request)
        return httpx.Response(status, json=corpo if corpo is not None else {"detail": "x"})
    return httpx.MockTransport(responder)


async def test_criar_card_manda_a_chave_e_devolve_a_resposta():
    pedidos = []
    resposta = {"id": 4821, "person_id": 1180, "created": True}
    devolvido = await criar_card(CFG, montar_card(LEAD, 3),
                                 transporte=_transporte(201, resposta, pedidos))
    assert devolvido == resposta
    assert str(pedidos[0].url) == "https://growthhs.exemplo.invalid/api/v1/integration/cards"
    assert pedidos[0].headers["x-api-key"] == "chave-8d"


@pytest.mark.parametrize("codigo, erro", [(401, ErroDefinitivo), (403, ErroDefinitivo),
                                          (404, ErroDefinitivo), (422, ErroDefinitivo),
                                          (429, ErroTransitorio), (500, ErroTransitorio),
                                          (503, ErroTransitorio)])
async def test_classifica_o_erro_como_o_contrato_manda(codigo, erro):
    with pytest.raises(erro):
        await criar_card(CFG, montar_card(LEAD, 3), transporte=_transporte(codigo))


async def test_sem_resposta_e_transitorio():
    def cair(request):
        raise httpx.ConnectError("fora do ar")
    with pytest.raises(ErroTransitorio):
        await criar_card(CFG, montar_card(LEAD, 3), transporte=httpx.MockTransport(cair))


def test_configurado_e_link_do_card():
    assert CFG.configurado
    assert CFG.url_do_card(4821) == "https://app.growthhs.exemplo.invalid/cards/4821"
    assert not Config(base_url=None, board_id=3, app_url=None, api_key="k").configurado
    assert Config(base_url="x", board_id=3, app_url=None, api_key="k").url_do_card(1) is None
