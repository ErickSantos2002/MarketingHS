"""Faxina técnica (frente faxina-tecnica, 29/10/2026).

1. Régua do servidor para `arquivo_url` da seção `video`: só
   `/publico/video/<uuid>`. Recusa ao SALVAR (com o caminho no detalhe) e
   descarta ao SERVIR — a mesma régua do cliente (`secoes.ts::
   idDoVideoHospedado`).
"""

import copy

import pytest
from fastapi import HTTPException

from app.captura.urls import (config_com_urls_seguras, urls_invalidas,
                              video_hospedado)
from app.routers.paginas import recusar_urls_inseguras

UUID = "0f8b7c2e-4d1a-4b5e-9c3f-1a2b3c4d5e6f"
BOM = f"/publico/video/{UUID}"


# ── 1. arquivo_url ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("valor", [BOM, f"  {BOM}  ", BOM.upper().replace("/PUBLICO/VIDEO/", "/publico/video/")])
def test_video_hospedado_aceita_so_o_caminho_com_uuid(valor):
    assert video_hospedado(valor) == valor.strip()


@pytest.mark.parametrize("valor", [
    "/publico/video/abc",
    f"/publico/video/{UUID}/",
    f"/publico/video/{UUID}?x=1",
    f"/publico/imagem/{UUID}",
    f"https://evil.com/publico/video/{UUID}",
    f"//evil.com/publico/video/{UUID}",
    f"javascript:/publico/video/{UUID}",
    f"/publico/video/../video/{UUID}",
    42, ["x"], {"a": 1},
])
def test_video_hospedado_recusa_o_resto(valor):
    assert video_hospedado(valor) is None


def test_arquivo_ruim_entra_nos_caminhos_ruins():
    config = {"secoes": [
        {"tipo": "video", "arquivo_url": BOM},
        {"tipo": "video", "arquivo_url": "https://evil.com/v.mp4"},
        {"tipo": "video", "arquivo_url": ""},
        {"tipo": "video"},
        {"tipo": "video", "arquivo_url": None},
        {"tipo": "numeros", "arquivo_url": "qualquer"},  # outro tipo não lê a chave
        {"tipo": "video", "arquivo_url": 7},
    ]}
    assert urls_invalidas(config) == ["secoes.1.arquivo_url", "secoes.6.arquivo_url"]


def test_salvar_recusa_com_caminho_e_mensagem_do_video():
    with pytest.raises(HTTPException) as erro:
        recusar_urls_inseguras({"secoes": [{"tipo": "video", "arquivo_url": "/x.mp4"}]})
    assert erro.value.status_code == 400
    assert "secoes.0.arquivo_url" in erro.value.detail
    assert "/publico/video/" in erro.value.detail
    recusar_urls_inseguras({"secoes": [{"tipo": "video", "arquivo_url": BOM}]})


def test_servir_descarta_o_arquivo_ruim_e_mantem_o_youtube():
    yt = "https://youtu.be/3md4Er-nXEA"
    config = {"secoes": [
        {"tipo": "video", "arquivo_url": BOM, "url": yt},
        {"tipo": "video", "arquivo_url": "https://evil.com/v.mp4", "url": yt},
    ]}
    original = copy.deepcopy(config)
    boa, ruim = config_com_urls_seguras(config)["secoes"]
    assert config == original, "a original vem do cache da landing"
    assert boa["arquivo_url"] == BOM
    assert "arquivo_url" not in ruim and ruim["url"] == yt
