"""A régua de URL dos tipos de seção da confiança (frente landing-confianca,
27/10): `certificacoes` (imagem dos selos), `depoimentos` (logo da empresa,
`logo_url`) e `video` (só link de vídeo do YouTube).

Mesma regra das outras seções: recusa ao SALVAR, com o caminho no detalhe, e
descarta ao SERVIR o que já estava gravado. Puro: nenhum teste toca o banco.
"""

import copy
import json

import pytest
from fastapi import HTTPException

from app.captura.urls import (TIPOS_DE_SECAO, config_com_urls_seguras,
                              id_do_youtube, urls_invalidas)
from app.routers.landing import montar_casca
from app.routers.paginas import recusar_urls_inseguras

ID = "3md4Er-nXEA"

CONFIG = {
    "headline": "Phoebus",
    "secoes": [
        {"id": "v", "tipo": "video", "titulo": "Em ação", "url": f"https://www.youtube.com/watch?v={ID}"},
        {"id": "d", "tipo": "depoimentos", "itens": [
            {"texto": "Mudou o jogo.", "nome": "Antônio", "empresa": "VIX",
             "logo_url": "/publico/imagem/vix"},
            {"texto": "Confiança total.", "nome": "Thaciane", "empresa": "Rumo",
             "logo_url": "javascript:alert(1)"},
        ]},
        {"id": "c", "tipo": "certificacoes", "texto": "ISO", "itens": [
            {"nome": "ISO 9001", "imagem_url": "https://cdn.exemplo.com/iso.png"},
            {"nome": "DOT", "imagem_url": "data:image/svg+xml,<svg onload=alert(1)>"},
        ]},
        {"id": "v2", "tipo": "video", "url": "https://evil.com/watch?v=" + ID},
    ],
}


@pytest.mark.parametrize("url", [
    f"https://www.youtube.com/watch?v={ID}",
    f"https://youtube.com/watch?v={ID}&t=12s",
    f"https://m.youtube.com/watch?v={ID}",
    f"http://www.youtube.com/watch?feature=share&v={ID}",
    f"https://youtu.be/{ID}",
    f"https://youtu.be/{ID}?si=abc",
    f"https://www.youtube.com/shorts/{ID}",
    f"https://youtube.com/shorts/{ID}/",
    f"https://www.youtube.com/embed/{ID}",
    f"  https://WWW.YOUTUBE.COM/watch?v={ID}  ",
])
def test_id_do_youtube_aceita_as_quatro_formas(url):
    assert id_do_youtube(url) == ID


@pytest.mark.parametrize("url", [
    "", None, 42, ["x"], {"url": f"https://youtu.be/{ID}"},
    f"javascript:alert(1)//youtu.be/{ID}",
    f"data:text/html,https://youtu.be/{ID}",
    f"ftp://youtu.be/{ID}",
    f"//youtu.be/{ID}",
    f"youtu.be/{ID}",
    f"https://evil.com/watch?v={ID}",
    f"https://www.youtube.com.evil.com/watch?v={ID}",
    f"https://youtube.com@evil.com/watch?v={ID}",
    f"https://user@youtu.be/{ID}",
    f"https://youtu.be:8443/{ID}",
    f"https://www.youtube-nocookie.com/embed/{ID}",
    f"https://www.youtube.com/watch?v={ID[:10]}",
    f"https://www.youtube.com/watch?v={ID}x",
    'https://www.youtube.com/watch?v=abc"onload=x',
    f"https://www.youtube.com/watch?id={ID}",
    f"https://www.youtube.com/channel/{ID}",
    f"https://www.youtube.com/shorts/{ID}/extra",
    f"https://www.youtube.com/embed/{ID}%2F",
    f"https://youtu.be/{ID}/x",
    f"https://www.youtube.com/watch?v={ID} x",
    f"https://www.youtube.com\\@evil.com/watch?v={ID}",
    "https://youtu.be:abc/" + ID,
])
def test_id_do_youtube_recusa_o_resto(url):
    assert id_do_youtube(url) is None


def test_os_tres_tipos_novos_existem_no_servidor():
    assert {"certificacoes", "depoimentos", "video"} <= TIPOS_DE_SECAO


def test_caminhos_das_urls_ruins():
    assert sorted(urls_invalidas(CONFIG)) == [
        "secoes.1.itens.1.logo_url",
        "secoes.2.itens.1.imagem_url",
        "secoes.3.url",
    ]


def test_video_vazio_ou_ausente_passa_ao_salvar():
    # A seção nasce assim no editor, e o salvamento é automático.
    config = {"secoes": [{"tipo": "video", "url": ""}, {"tipo": "video", "url": "  "},
                         {"tipo": "video"}, {"tipo": "video", "url": None}]}
    assert urls_invalidas(config) == []


def test_video_que_nao_e_texto_e_recusado():
    assert urls_invalidas({"secoes": [{"tipo": "video", "url": 42}]}) == ["secoes.0.url"]


def test_url_em_outro_tipo_nao_e_lida_como_video():
    # Só o tipo `video` lê `url`; em outro tipo a chave é ignorada pelo cliente.
    assert urls_invalidas({"secoes": [{"tipo": "numeros", "url": "qualquer coisa"}]}) == []


def test_logo_url_tambem_na_secao_e_em_qualquer_tipo():
    config = {"secoes": [{"tipo": "cartoes", "logo_url": "javascript:x",
                          "itens": [{"titulo": "a", "logo_url": "vbscript:y"}]}]}
    assert sorted(urls_invalidas(config)) == ["secoes.0.itens.0.logo_url", "secoes.0.logo_url"]


def test_salvar_recusa_com_os_caminhos_no_detalhe():
    with pytest.raises(HTTPException) as erro:
        recusar_urls_inseguras(CONFIG)
    assert erro.value.status_code == 400
    for caminho in ("secoes.1.itens.1.logo_url", "secoes.2.itens.1.imagem_url", "secoes.3.url"):
        assert caminho in erro.value.detail
    boa = copy.deepcopy(CONFIG)
    boa["secoes"][1]["itens"][1]["logo_url"] = "https://x.com/rumo.png"
    boa["secoes"][2]["itens"][1]["imagem_url"] = "/publico/imagem/dot"
    boa["secoes"][3]["url"] = f"https://youtu.be/{ID}"
    recusar_urls_inseguras(boa)


def test_servir_descarta_e_nao_mexe_na_original():
    original = copy.deepcopy(CONFIG)
    segura = config_com_urls_seguras(CONFIG)
    assert CONFIG == original, "a original vem do cache da landing"
    video, dep, cert, ruim = segura["secoes"]
    assert video["url"] == f"https://www.youtube.com/watch?v={ID}"
    assert dep["itens"][0]["logo_url"] == "/publico/imagem/vix"
    assert "logo_url" not in dep["itens"][1] and dep["itens"][1]["nome"] == "Thaciane"
    assert cert["itens"][0]["imagem_url"] == "https://cdn.exemplo.com/iso.png"
    assert "imagem_url" not in cert["itens"][1]
    # O vídeo de fora do YouTube fica sem `url` — e o cliente, sem id, não o desenha.
    assert ruim["tipo"] == "video" and "url" not in ruim
    assert urls_invalidas(segura) == []


def test_casca_nao_embute_nada_ruim():
    html = montar_casca("phoebus", CONFIG, previa=True)
    bloco = html.split('id="config-da-pagina">', 1)[1].split("</script>", 1)[0]
    embutida = json.loads(bloco)
    assert "javascript:" not in bloco and "data:image" not in bloco and "evil.com" not in bloco
    assert embutida["secoes"][0]["url"] == f"https://www.youtube.com/watch?v={ID}"
