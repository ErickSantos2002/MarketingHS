"""A montagem do e-mail por destinatário.

⚠️ Esta é a parte cuja referência (`process-email-queue`) NÃO EXISTE no
repositório. Cada teste aqui é casado com a contraparte que sobreviveu — se
divergirem, o defeito é silencioso: o descadastro passa a dar 401 e ninguém
percebe até um contato reclamar.
"""

import base64
import hashlib
import hmac
from urllib.parse import parse_qs, urlparse

from app.email.montagem import (
    aplicar_merge_tags,
    cabecalhos_rfc8058,
    garantir_rodape,
    url_de_descadastro,
)


def _token_como_o_verificador_calcula(lead_id: str, email: str, segredo: str) -> str:
    """Cópia literal de `email-unsubscribe/index.ts::computeToken`.

    HMAC-SHA256 sobre "{lead_id}:{email}", base64 padrão com os caracteres
    trocados para url-safe e o padding retirado.
    """
    mac = hmac.new(segredo.encode(), f"{lead_id}:{email}".encode(),
                   hashlib.sha256).digest()
    return (base64.b64encode(mac).decode()
            .replace("+", "-").replace("/", "_").rstrip("="))


def test_token_bate_com_o_verificador():
    url = url_de_descadastro("https://x.test", "abc-123", "Joao@Empresa.com ", "s3cr3t")
    q = parse_qs(urlparse(url).query)
    # ⚠️ O verificador normaliza com .toLowerCase().trim() ANTES de conferir.
    # Assinar o valor cru daria 401 em todo endereço com maiúscula.
    assert q["t"][0] == _token_como_o_verificador_calcula(
        "abc-123", "joao@empresa.com", "s3cr3t")


def test_email_vai_em_base64url_dos_bytes_utf8():
    """O verificador decodifica os BYTES utf-8, não os code points. Endereço
    com acento tem de sobreviver à ida e à volta."""
    url = url_de_descadastro("https://x.test", "abc-123", "joão@empresa.com", "s3cr3t")
    e = parse_qs(urlparse(url).query)["e"][0]
    pad = "=" * (-len(e) % 4)
    assert base64.urlsafe_b64decode(e + pad).decode("utf-8") == "joão@empresa.com"


def test_a_url_carrega_os_tres_parametros():
    url = url_de_descadastro("https://x.test", "abc-123", "a@b.c", "s")
    q = parse_qs(urlparse(url).query)
    assert set(q) == {"lid", "e", "t"}
    assert q["lid"][0] == "abc-123"


def test_merge_tags_do_contato():
    html = "<p>Olá {{nome}}, da {{empresa}} ({{email}})</p>"
    saida = aplicar_merge_tags(html, {"nome": "Carla", "empresa": "HS",
                                      "email": "c@hs.com"}, "https://x.test/u")
    assert saida == "<p>Olá Carla, da HS (c@hs.com)</p>"


def test_campo_vazio_vira_string_vazia_nao_a_tag_crua():
    """Deixar "{{nome}}" no corpo é pior que deixar em branco: o contato vê o
    esqueleto do template."""
    saida = aplicar_merge_tags("<p>Olá {{nome}}</p>", {"nome": None}, "https://x.test/u")
    assert "{{nome}}" not in saida
    assert saida == "<p>Olá </p>"


# ── {{primeiro_nome}} ─────────────────────────────────────────────────────────
# Os 25 e-mails trazidos do RD saúdam com "*|PRIMEIRO_NOME|*", que a importação
# virou `{{primeiro_nome}}`. Sem a troca, o contato lê "Olá, {{primeiro_nome}}".

def _primeiro(nome):
    return aplicar_merge_tags("Olá, {{primeiro_nome}}!", {"nome": nome}, "https://x.test/u")


def test_primeiro_nome_de_nome_completo():
    assert _primeiro("Carla Souza Lima") == "Olá, Carla!"


def test_primeiro_nome_de_nome_de_uma_palavra():
    assert _primeiro("Carla") == "Olá, Carla!"


def test_primeiro_nome_ignora_espacos_nas_pontas_e_preserva_a_caixa():
    assert _primeiro("  joão   da Silva ") == "Olá, joão!"
    assert _primeiro("\tMARIA Clara") == "Olá, MARIA!"


def test_primeiro_nome_vazio_nulo_ou_so_espacos_vira_string_vazia():
    for nome in ("", None, "   "):
        assert _primeiro(nome) == "Olá, !"
    assert aplicar_merge_tags("Olá, {{primeiro_nome}}!", {}, "u") == "Olá, !"


def test_primeiro_nome_e_nome_convivem_no_mesmo_texto():
    saida = aplicar_merge_tags("{{primeiro_nome}} / {{nome}}",
                               {"nome": "Carla Souza"}, "u")
    assert saida == "Carla / Carla Souza"


def test_primeiro_nome_no_assunto():
    """O worker passa o assunto pela mesma função — a tag não pode ficar crua
    na caixa de entrada."""
    assunto = aplicar_merge_tags("{{primeiro_nome}}, seu bafômetro está em dia?",
                                 {"nome": "Ana Paula", "empresa": None,
                                  "email": "a@x.com"}, "https://x.test/u")
    assert assunto == "Ana, seu bafômetro está em dia?"


def test_amostra_do_envio_de_teste_tem_primeiro_nome():
    from app.routers.envio import AMOSTRA_MERGE_TAGS
    assert AMOSTRA_MERGE_TAGS["{{primeiro_nome}}"] == "João"


def test_unsubscribe_url_substituida_quando_o_template_a_declara():
    saida = aplicar_merge_tags('<a href="{{unsubscribe_url}}">sair</a>', {},
                               "https://x.test/u")
    assert 'href="https://x.test/u"' in saida


def test_rodape_so_entra_quando_o_link_nao_existe():
    """O template pode declarar {{unsubscribe_url}} para controlar posição e
    estilo. Injetar o rodapé mesmo assim daria dois links de descadastro."""
    com_link = '<a href="https://x.test/u">sair</a>'
    assert garantir_rodape(com_link, "https://x.test/u") == com_link
    sem_link = "<p>corpo</p>"
    saida = garantir_rodape(sem_link, "https://x.test/u")
    assert "https://x.test/u" in saida
    assert saida.startswith("<p>corpo</p>")


def test_cabecalhos_rfc8058():
    """⚠️ O List-Unsubscribe-Post é o que faz Gmail e Yahoo mostrarem o botão
    nativo — e é por isso que o endpoint precisa aceitar POST."""
    c = cabecalhos_rfc8058("https://x.test", "abc-123", "a@b.c", "s")
    assert c["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"


def test_list_unsubscribe_aponta_para_a_api_nao_para_a_pagina():
    """U2 (raio-x de 02/10): o cabeçalho apontava para a PÁGINA
    `/descadastrar` do SPA, e o POST one-click do Gmail/Yahoo levava 405 do
    nginx. Ele vai para a rota da API, com os mesmos lid/e/t assinados."""
    c = cabecalhos_rfc8058("https://x.test/", "abc-123", "Joao@Empresa.com", "s3cr3t")
    valor = c["List-Unsubscribe"]
    assert valor.startswith("<") and valor.endswith(">")
    url = urlparse(valor[1:-1])
    assert (url.scheme, url.netloc) == ("https", "x.test")
    assert url.path == "/api/publico/descadastro/um-clique"
    q = parse_qs(url.query)
    assert set(q) == {"lid", "e", "t"}
    assert q["t"][0] == _token_como_o_verificador_calcula(
        "abc-123", "joao@empresa.com", "s3cr3t")


def test_o_link_do_rodape_continua_na_pagina():
    """O link do corpo do e-mail é para gente: abre a página de confirmação."""
    url = urlparse(url_de_descadastro("https://x.test", "abc-123", "a@b.c", "s"))
    assert url.path == "/descadastrar"
