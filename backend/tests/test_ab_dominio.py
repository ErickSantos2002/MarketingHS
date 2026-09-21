"""As regras puras do A/B — o que decide para onde vai o clique do anúncio.

O modo de falhar é mandar o clique para fora do domínio (reprovação por
"Destination mismatch" no Google/Meta) ou sortear fora do peso combinado.
Nenhum dos dois aparece na tela: o anúncio só deixa de rodar.
"""

from app.ab.dominio import host_no_dominio, ler_user_agent, normalizar_dominio, sortear


def test_normaliza_o_que_o_admin_digita():
    assert normalizar_dominio(" https://www.Exemplo.com.br/lp?x=1 ") == "exemplo.com.br"
    assert normalizar_dominio("exemplo.com:8080") == "exemplo.com"
    assert normalizar_dominio("exemplo.com.") == "exemplo.com"
    assert normalizar_dominio(None) == ""


def test_subdominio_pertence_e_sufixo_parecido_nao():
    assert host_no_dominio("exemplo.com", "exemplo.com")
    assert host_no_dominio("promo.exemplo.com", "https://www.exemplo.com")
    assert not host_no_dominio("exemplo.com.evil.io", "exemplo.com")
    assert not host_no_dominio("outroexemplo.com", "exemplo.com")
    assert not host_no_dominio("exemplo.com", "")


IPHONE = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
          "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
CHROME_WIN = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
TABLET_ANDROID = ("Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")


def test_user_agent():
    assert ler_user_agent(IPHONE) == {"device_type": "mobile", "os": "iOS",
                                      "browser": "Safari", "browser_version": "17.0"}
    assert ler_user_agent(CHROME_WIN) == {"device_type": "desktop", "os": "Windows",
                                          "browser": "Chrome", "browser_version": "128.0.0.0"}
    assert ler_user_agent(CHROME_WIN + " Edg/128.0.1.2")["browser"] == "Edge"
    assert ler_user_agent(TABLET_ANDROID)["device_type"] == "tablet"
    assert ler_user_agent(TABLET_ANDROID)["os"] == "Android"
    assert ler_user_agent(None) == {"device_type": "desktop", "os": "unknown",
                                    "browser": "unknown", "browser_version": ""}


def test_sorteio_respeita_o_peso():
    variantes = [{"key": "A", "weight": 30}, {"key": "B", "weight": 70}]
    assert sortear(variantes, lambda: 0.0)["key"] == "A"
    assert sortear(variantes, lambda: 0.29)["key"] == "A"
    assert sortear(variantes, lambda: 0.31)["key"] == "B"


def test_peso_zero_ou_ausente_vale_um_como_na_origem():
    """⚠️ A tela deixa digitar 0 esperando "sem tráfego"; a origem dava peso 1.
    Preservado de propósito — decisão 15 do plano, pergunta ao Erick."""
    variantes = [{"key": "A", "weight": 0}, {"key": "B"}]
    assert sortear(variantes, lambda: 0.49)["key"] == "A"
    assert sortear(variantes, lambda: 0.51)["key"] == "B"
