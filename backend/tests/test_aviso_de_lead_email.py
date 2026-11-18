"""Montagem do e-mail a vendas (puro, sem banco)."""
from datetime import datetime, timezone

from app.avisos.email import montar_aviso

URL = "https://x.test/contacts?contato=abc"


def _lead(**kw):
    base = {"nome": "Ana", "email": "ana@acme.com", "whatsapp": None,
            "phone_normalized": None, "empresa": "ACME", "cargo": None,
            "campos_extras": None}
    base.update(kw)
    return base


def _conv(**kw):
    base = {"page_slug": "teste-bafometro", "site_id": None, "form_id": None,
            "page_url": None, "canal": None,
            "converted_at": datetime(2026, 11, 18, 13, 5, tzinfo=timezone.utc),
            "dados_informados": {}}
    base.update(kw)
    return base


def _montar(lead=None, conv=None, **kw):
    kw.setdefault("contato_novo", True)
    kw.setdefault("agendamento", False)
    kw.setdefault("url_contato", URL)
    return montar_aviso(lead or _lead(), conv or _conv(), **kw)


def test_assunto_novo():
    assert _montar()[0] == "Novo lead: Ana — ACME"


def test_assunto_voltou():
    assert _montar(contato_novo=False)[0].startswith("Lead voltou: ")


def test_assunto_agendamento():
    assert _montar(agendamento=True)[0].startswith("Reunião agendada: ")


def test_assunto_sem_empresa_e_sem_nome():
    assert _montar(_lead(empresa=None))[0] == "Novo lead: Ana"
    assert _montar(_lead(nome=None, empresa=None))[0] == "Novo lead: ana@acme.com"


def test_escapa_e_uma_linha():
    assunto, html, texto = _montar(_lead(nome="<script>x</script>\nInjetado"))
    assert "&lt;script&gt;" in html
    assert "<script>" not in html
    assert "\n" not in assunto and "\r" not in assunto


def test_assunto_limitado():
    assert len(_montar(_lead(nome="a" * 500))[0]) <= 200


def test_extras_com_rotulo():
    conv = _conv(dados_informados={"campos_extras": {"setor": "Mineração"}})
    _, html, texto = _montar(conv=conv, rotulos={"setor": "Setor de atuação"})
    assert "Setor de atuação" in html
    assert ">setor<" not in html
    assert "Setor de atuação: Mineração" in texto


def test_extras_aceita_json_em_texto_e_cai_no_lead():
    conv = _conv(dados_informados='{"campos_extras": {"a": "1"}}')
    assert "a: 1" in _montar(conv=conv)[2]
    lead = _lead(campos_extras='{"b": "2"}')
    assert "b: 2" in _montar(lead)[2]


def test_extras_pula_chaves_de_controle():
    conv = _conv(dados_informados={
        "campos_extras": {"utm_source": "g", "ab_test": "1", "x": "y"}})
    texto = _montar(conv=conv)[2]
    assert "x: y" in texto
    assert "ab_test" not in texto and "utm_source: g" not in texto


def test_sem_dado_sensivel():
    conv = _conv(dados_informados={"ip": "1.2.3.4", "user_agent": "Mozilla",
                                   "consentimento": True,
                                   "campos_extras": {"ip": "1.2.3.4"}})
    _, html, texto = _montar(conv=conv)
    for chave in ("ip:", "user_agent", "consentimento", "1.2.3.4", "Mozilla"):
        assert chave not in texto
        assert chave not in html


def test_onde_site_e_landing():
    assert "Landing teste-bafometro" in _montar()[2]
    conv = _conv(page_slug=None, form_id="f1")
    texto = _montar(conv=conv, nome_do_site="Site HS")[2]
    assert "Onde: Site Site HS · formulário f1" in texto


def test_hora_em_sao_paulo():
    assert "18/11/2026 às 10:05" in _montar()[2]
    conv = _conv(converted_at="2026-11-18T13:05:00Z")
    assert "18/11/2026 às 10:05" in _montar(conv=conv)[2]


def test_link_do_contato():
    _, html, texto = _montar()
    assert "Abrir o contato no MarketingHS" in html
    assert URL in html and URL in texto


def test_contato_utms_e_whatsapp():
    conv = _conv(utm_source="google", utm_campaign="c1", canal="Pago")
    texto = _montar(_lead(phone_normalized="5511999"), conv, contato_novo=False)[2]
    assert "WhatsApp: 5511999" in texto
    assert "UTMs: utm_source=google / utm_campaign=c1" in texto
    assert "Canal: Pago" in texto
    assert "Contato: Já existia — converteu de novo" in texto
    assert "Contato: Novo" in _montar()[2]


def test_data_sem_fuso_vale_utc():
    conv = _conv(converted_at=datetime(2026, 11, 18, 13, 5))
    assert "Quando: 18/11/2026 às 10:05" in _montar(conv=conv)[2]


def test_chaves_de_controle_iguais_a_da_execucao():
    from app.agendamento import execucao
    from app.avisos import email as aviso_email
    assert aviso_email.CHAVES_DE_CONTROLE == execucao.CHAVES_DE_CONTROLE
