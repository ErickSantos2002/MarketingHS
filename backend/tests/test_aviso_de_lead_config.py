"""Rotas de configuração do aviso de lead e o "Enviar teste".

Os segredos ficam num dicionário em memória (a fixture nunca toca
`integration_secrets`). O Resend é sempre falso.
"""

import pytest
import pytest_asyncio

from app import integracoes
from app.email import resend as cliente_resend
from app.routers import configuracao

ROTA = "/config/aviso-lead"
NOMES = ["AVISO_LEAD_PARA", "AVISO_LEAD_LIGADO"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def segredos_aviso(monkeypatch):
    """Segredos do aviso EM MEMÓRIA: nenhum teste do arquivo toca
    `integration_secrets` (a suíte pode rodar contra um banco com api/worker
    vivos). Os nomes de `NOMES` e a `RESEND_API_KEY` saem de um dict; os demais
    passam para a função real (só leitura)."""
    memoria: dict[str, str] = {}
    proprios = set(NOMES) | {"RESEND_API_KEY"}
    ler_real = integracoes.ler_segredo

    async def ler(nome):
        if nome in proprios:
            return memoria.get(nome)
        return await ler_real(nome)

    async def gravar(nome, valor):
        assert nome in proprios, f"o teste não pode gravar {nome}"
        memoria[nome] = valor

    async def apagar(nome):
        assert nome in proprios, f"o teste não pode apagar {nome}"
        return memoria.pop(nome, None) is not None

    for modulo in (integracoes, configuracao):
        monkeypatch.setattr(modulo, "ler_segredo", ler)
    for modulo in (integracoes, configuracao):
        monkeypatch.setattr(modulo, "gravar_segredo", gravar)
        monkeypatch.setattr(modulo, "apagar_segredo", apagar)
    for nome in NOMES:
        monkeypatch.delenv(nome, raising=False)
    yield memoria


def _resend_falso(monkeypatch, erros: dict | None = None,
                  chave: str | None = "re_teste_aviso"):
    """Resend falso. A chave vem só de monkeypatch de `ler_segredo` (a
    `RESEND_API_KEY` real da tabela nunca é tocada); os outros segredos passam
    para a função real."""
    chamadas = []
    ler_real = configuracao.ler_segredo

    async def ler_segredo(nome):
        if nome == "RESEND_API_KEY":
            return chave
        return await ler_real(nome)

    monkeypatch.setattr(configuracao, "ler_segredo", ler_segredo)

    async def enviar(chave, de, para, assunto, html, texto, cabecalhos,
                     tags=None, responder_para=None):
        chamadas.append({"para": para, "assunto": assunto, "de": de,
                         "responder_para": responder_para})
        if erros and para in erros:
            raise erros[para]
        return "id-falso"

    monkeypatch.setattr(configuracao.cliente_resend, "enviar", enviar)
    return chamadas


async def test_sem_credencial_401(cliente, segredos_aviso):
    assert (await cliente.get(ROTA)).status_code == 401
    assert (await cliente.post(ROTA + "/testar")).status_code == 401


async def test_put_recusa_chave_de_api(cliente, chave_de, segredos_aviso):
    r = await cliente.put(ROTA, json={"ligado": True, "para": ""},
                          headers=_auth(await chave_de("write")))
    assert r.status_code == 401


async def test_get_padrao(cliente, token_admin, segredos_aviso):
    r = await cliente.get(ROTA, headers=_auth(token_admin))
    assert r.status_code == 200, r.text
    assert r.json() == {"ligado": True, "para": ["vendas@healthsafetytech.com"],
                        "padrao": True}


async def test_put_grava_e_le(cliente, token_admin, segredos_aviso):
    r = await cliente.put(ROTA, json={"ligado": False,
                                      "para": " a@hs.invalid ,, b@hs.invalid "},
                          headers=_auth(token_admin))
    assert r.status_code == 200, r.text
    esperado = {"ligado": False, "para": ["a@hs.invalid", "b@hs.invalid"],
                "padrao": False}
    assert r.json() == esperado
    assert (await cliente.get(ROTA, headers=_auth(token_admin))).json() == esperado
    assert await integracoes.ler_segredo("AVISO_LEAD_PARA") == "a@hs.invalid, b@hs.invalid"
    assert await integracoes.ler_segredo("AVISO_LEAD_LIGADO") == "0"


async def test_put_recusa_endereco_invalido(cliente, token_admin, segredos_aviso):
    r = await cliente.put(ROTA, json={"ligado": False,
                                      "para": "a@hs.invalid, nao-e-email"},
                          headers=_auth(token_admin))
    assert r.status_code == 400
    assert "nao-e-email" in r.text
    assert await integracoes.ler_segredo("AVISO_LEAD_PARA") is None
    assert await integracoes.ler_segredo("AVISO_LEAD_LIGADO") is None


async def test_put_recusa_mais_de_dez(cliente, token_admin, segredos_aviso):
    para = ", ".join(f"p{i}@hs.invalid" for i in range(11))
    r = await cliente.put(ROTA, json={"ligado": True, "para": para},
                          headers=_auth(token_admin))
    assert r.status_code == 400
    assert await integracoes.ler_segredo("AVISO_LEAD_PARA") is None


async def test_put_para_vazio_volta_ao_padrao(cliente, token_admin, segredos_aviso):
    await cliente.put(ROTA, json={"ligado": True, "para": "a@hs.invalid"},
                      headers=_auth(token_admin))
    r = await cliente.put(ROTA, json={"ligado": True, "para": "  "},
                          headers=_auth(token_admin))
    assert r.status_code == 200, r.text
    assert r.json() == {"ligado": True, "para": ["vendas@healthsafetytech.com"],
                        "padrao": True}
    assert await integracoes.ler_segredo("AVISO_LEAD_PARA") is None


async def test_testar_envia_para_cada_endereco(cliente, token_admin,
                                               segredos_aviso, monkeypatch):
    await cliente.put(ROTA, json={"ligado": False,
                                  "para": "a@hs.invalid, b@hs.invalid"},
                      headers=_auth(token_admin))
    chamadas = _resend_falso(monkeypatch)
    r = await cliente.post(ROTA + "/testar", headers=_auth(token_admin))
    assert r.status_code == 200, r.text
    assert r.json() == {"enviados": ["a@hs.invalid", "b@hs.invalid"], "falhas": []}
    assert [c["para"] for c in chamadas] == ["a@hs.invalid", "b@hs.invalid"]
    assert all(c["assunto"].startswith("[TESTE] ") for c in chamadas)
    assert all(not c["responder_para"] for c in chamadas)


async def test_testar_falha_de_um_nao_derruba_os_outros(cliente, token_admin,
                                                        segredos_aviso, monkeypatch):
    await cliente.put(ROTA, json={"ligado": True,
                                  "para": "a@hs.invalid, b@hs.invalid, c@hs.invalid"},
                      headers=_auth(token_admin))
    _resend_falso(monkeypatch, erros={
        "a@hs.invalid": RuntimeError("recusado"),
        "b@hs.invalid": cliente_resend.LimiteDoResend(30)})
    r = await cliente.post(ROTA + "/testar", headers=_auth(token_admin))
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["enviados"] == ["c@hs.invalid"]
    assert [f["para"] for f in corpo["falhas"]] == ["a@hs.invalid", "b@hs.invalid"]
    assert all(f["erro"] for f in corpo["falhas"])


async def test_testar_sem_chave_400(cliente, token_admin, segredos_aviso,
                                    monkeypatch):
    chamadas = _resend_falso(monkeypatch, chave=None)
    r = await cliente.post(ROTA + "/testar", headers=_auth(token_admin))
    assert r.status_code == 400
    assert chamadas == []
