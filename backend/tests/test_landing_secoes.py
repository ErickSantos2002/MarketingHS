"""A régua de URL nas seções da landing (frente landing-secoes, 26/10).

`config.secoes` traz `imagem_url` na seção (`texto_imagem`) e nos itens
(`cartoes`, `logos`) — URL que vira `src` na página PÚBLICA. Mesma regra dos
caminhos fixos: recusa ao SALVAR, com o caminho no detalhe, e descarta ao
SERVIR o que já estava gravado. Puro: nenhum teste aqui toca o banco.
"""

import copy
import json

import pytest
from fastapi import HTTPException

from app.captura.urls import (LIMITE_ITENS, LIMITE_LINHAS, LIMITE_SECOES,
                              config_com_urls_seguras, urls_invalidas)
from app.routers.landing import montar_casca
from app.routers.paginas import recusar_urls_inseguras

CONFIG = {
    "headline": "Phoebus",
    "imagem_url": "/publico/imagem/topo",
    "secoes": [
        {"id": "n", "tipo": "numeros", "itens": [{"valor": "770+", "rotulo": "aparelhos"}]},
        {"id": "c", "tipo": "cartoes", "itens": [
            {"titulo": "Parede", "texto": "x", "imagem_url": "https://cdn.exemplo.com/p.png"},
            {"titulo": "Pedestal", "texto": "y", "imagem_url": "javascript:alert(1)"},
        ]},
        {"id": "l", "tipo": "logos", "itens": [
            {"nome": "CCR", "imagem_url": "/publico/imagem/ccr"},
            {"nome": "Vale", "imagem_url": ""},
        ]},
        {"id": "t", "tipo": "texto_imagem", "texto": "Calibração",
         "imagem_url": "data:text/html,<script>alert(1)</script>"},
    ],
}


def test_imagem_insegura_em_secao_e_em_item_tem_o_caminho():
    assert sorted(urls_invalidas(CONFIG)) == [
        "secoes.1.itens.1.imagem_url", "secoes.3.imagem_url"]


def test_segura_vazia_e_ausente_passam():
    config = {"secoes": [
        {"tipo": "cartoes", "itens": [{"titulo": "a", "imagem_url": "https://x.com/a.png"},
                                      {"titulo": "b", "imagem_url": "  "},
                                      {"titulo": "c", "imagem_url": None},
                                      {"titulo": "d"}]},
        {"tipo": "texto_imagem", "texto": "x", "imagem_url": "/publico/imagem/1"},
    ]}
    assert urls_invalidas(config) == []


def test_valor_que_nao_e_texto_e_recusado():
    config = {"secoes": [{"tipo": "logos", "itens": [{"nome": "x", "imagem_url": 42}]}]}
    assert urls_invalidas(config) == ["secoes.0.itens.0.imagem_url"]


def test_secoes_quebradas_nao_derrubam_a_regua():
    for secoes in ("x", 42, None, {"a": 1}, [None, 3, "s", ["x"], {"itens": "x"},
                                            {"itens": [None, 2, "y"]}]):
        assert urls_invalidas({"secoes": secoes}) == [], secoes
        config_com_urls_seguras({"secoes": secoes})


def test_tipo_que_nao_e_texto_nao_derruba_a_casca():
    # `["cartoes"]` num frozenset levantaria TypeError (unhashable) e a
    # landing daria 500 a cada acesso — a config grava sem recusa.
    config = {"secoes": [{"tipo": ["cartoes"]}, {"tipo": {"a": 1}},
                         {"tipo": "numeros", "itens": [{"valor": "1"}]}]}
    assert urls_invalidas(config) == []
    assert [s["tipo"] for s in config_com_urls_seguras(config)["secoes"]] == ["numeros"]
    montar_casca("x", config)


def test_config_sem_secoes_igual_a_antes():
    config = {"redirect_url": "javascript:alert(1)", "imagem_url": "/publico/imagem/1",
              "consentimento": {"texto": "x", "link": "data:text/html,oi"}}
    assert sorted(urls_invalidas(config)) == ["consentimento.link", "redirect_url"]
    segura = config_com_urls_seguras(config)
    assert "secoes" not in segura
    assert segura["imagem_url"] == "/publico/imagem/1"


def test_salvar_recusa_com_o_caminho_no_detalhe():
    with pytest.raises(HTTPException) as erro:
        recusar_urls_inseguras(CONFIG)
    assert erro.value.status_code == 400
    assert "secoes.1.itens.1.imagem_url" in erro.value.detail
    assert "secoes.3.imagem_url" in erro.value.detail
    sem_ruim = copy.deepcopy(CONFIG)
    sem_ruim["secoes"][1]["itens"][1]["imagem_url"] = "https://x.com/ok.png"
    sem_ruim["secoes"][3].pop("imagem_url")
    recusar_urls_inseguras(sem_ruim)


def test_servir_descarta_a_url_ruim_e_nao_mexe_na_original():
    original = copy.deepcopy(CONFIG)
    segura = config_com_urls_seguras(CONFIG)
    assert CONFIG == original, "a original vem do cache da landing"
    cartoes = segura["secoes"][1]["itens"]
    assert cartoes[0]["imagem_url"] == "https://cdn.exemplo.com/p.png"
    assert "imagem_url" not in cartoes[1] and cartoes[1]["titulo"] == "Pedestal"
    assert "imagem_url" not in segura["secoes"][3]
    assert segura["secoes"][3]["texto"] == "Calibração"
    assert segura["secoes"][2]["itens"][0]["imagem_url"] == "/publico/imagem/ccr"
    assert urls_invalidas(segura) == []


def test_servir_corta_nos_limites_e_tira_secao_de_tipo_desconhecido():
    config = {"secoes": [{"tipo": "carrossel", "url": "https://youtube.com/x"}, "lixo"]
              + [{"tipo": "perguntas",
                  "itens": [{"pergunta": f"P{j}", "resposta": "R"} for j in range(40)]}
                 for _ in range(25)]
              + [{"tipo": "comparativo",
                  "linhas": [{"criterio": f"C{j}"} for j in range(20)]}]}
    segura = config_com_urls_seguras(config)
    assert len(segura["secoes"]) == LIMITE_SECOES == 20
    assert all(s["tipo"] == "perguntas" for s in segura["secoes"])
    assert all(len(s["itens"]) == LIMITE_ITENS == 30 for s in segura["secoes"])
    config["secoes"] = config["secoes"][-1:]
    assert len(config_com_urls_seguras(config)["secoes"][0]["linhas"]) == LIMITE_LINHAS == 12


def test_casca_nao_embute_a_url_ruim():
    html = montar_casca("phoebus", CONFIG, previa=True)
    bloco = html.split('id="config-da-pagina">', 1)[1].split("</script>", 1)[0]
    embutida = json.loads(bloco)
    assert "javascript:" not in bloco and "data:text/html" not in bloco
    assert embutida["secoes"][1]["itens"][0]["imagem_url"] == "https://cdn.exemplo.com/p.png"
