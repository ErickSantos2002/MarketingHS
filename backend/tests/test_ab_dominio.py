"""As regras puras do A/B — o que decide para onde vai o clique do anúncio.

O modo de falhar é mandar o clique para fora do domínio (reprovação por
"Destination mismatch" no Google/Meta) ou sortear fora do peso combinado.
Nenhum dos dois aparece na tela: o anúncio só deixa de rodar.
"""

from app.ab.dominio import host_no_dominio, ler_user_agent, normalizar_dominio, sortear
from app.ab.eventos import chave_de_dedupe, normalizar_evento


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


def test_peso_zero_nao_recebe_trafego():
    """Decisão 7 do Erick (01/10/2026): 0 = sem tráfego. Até então valia 1,
    como na origem — a tela deixa digitar 0 esperando o contrário."""
    variantes = [{"key": "A", "weight": 0}, {"key": "B", "weight": 50},
                 {"key": "C", "weight": -3}]
    for r in (0.0, 0.25, 0.5, 0.99):
        assert sortear(variantes, lambda: r)["key"] == "B"


def test_peso_ausente_ou_nao_numerico_continua_valendo_um():
    """Variante gravada antes de o campo existir não pediu zero."""
    variantes = [{"key": "A"}, {"key": "B", "weight": "x"}]
    assert sortear(variantes, lambda: 0.49)["key"] == "A"
    assert sortear(variantes, lambda: 0.51)["key"] == "B"


def test_todas_zeradas_nao_sorteiam_ninguem():
    """O chamador decide (o redirecionador manda ao controle)."""
    assert sortear([{"key": "A", "weight": 0}, {"key": "B", "weight": 0}],
                   lambda: 0.5) is None


LIDO = {"device_type": "desktop", "os": "Windows", "browser": "Chrome", "browser_version": "1"}


def test_chave_de_dedupe_como_na_origem():
    base = {"ab_vid": "v1", "ab_test": "t1"}
    assert chave_de_dedupe({**base, "event_type": "exposure"}) == "v1:t1:exposure"
    assert chave_de_dedupe({**base, "event_type": "conversion"}) == "v1:t1:conversion:default"
    assert (chave_de_dedupe({**base, "event_type": "schedule_step", "metadata": {"step": 2}})
            == "v1:t1:schedule_step:2")
    assert chave_de_dedupe({**base, "event_type": "behavior"}) is None


def test_normalizacao_descarta_o_invalido_e_nao_perde_evento_por_campo_ruim():
    assert normalizar_evento("texto", LIDO, None, None) is None
    assert normalizar_evento({"ab_test": "t", "ab_vid": "v", "event_type": "x"},
                             LIDO, None, None) is None
    assert normalizar_evento({"ab_test": "", "ab_vid": "v", "event_type": "exposure"},
                             LIDO, None, None) is None

    linha = normalizar_evento(
        {"ab_test": "t" * 300, "ab_vid": "v", "event_type": "exposure",
         "lead_id": "não-é-uuid", "occurred_at": "ontem", "metadata": [1]},
        LIDO, "https://ref.invalid", "pt-BR")
    assert len(linha["ab_test"]) == 200
    # Decisão 11: a origem perdia o evento inteiro por um destes campos.
    assert linha["lead_id"] is None and linha["occurred_at"] is not None
    assert linha["metadata"] is None
    assert linha["referrer"] == "https://ref.invalid" and linha["language"] == "pt-BR"
    assert linha["browser"] == "Chrome" and linha["browser_version"] is None

    quando = normalizar_evento({"ab_test": "t", "ab_vid": "v", "event_type": "exposure",
                                "occurred_at": "2026-09-01T12:00:00Z"}, LIDO, None, None)
    assert quando["occurred_at"].isoformat() == "2026-09-01T12:00:00+00:00"
