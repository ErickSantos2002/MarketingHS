"""O cliente do Resend, sem rede.

A classificação da chave é o que a origem acertou e o 3C perdeu: 200 é chave
completa; 401 com `restricted_api_key` é chave VÁLIDA de envio; 403 é chave
inválida. Testar só "deu 200?" reprovaria uma chave de envio perfeita.
"""

import httpx
import pytest

from app.email import resend


def _trocar_transporte(monkeypatch, handler):
    transporte = httpx.MockTransport(handler)

    class ClienteFalso(httpx.AsyncClient):
        def __init__(self, *args, **kwargs):
            kwargs["transport"] = transporte
            super().__init__(*args, **kwargs)

    monkeypatch.setattr(resend.httpx, "AsyncClient", ClienteFalso)


async def test_chave_completa_lista_os_dominios(monkeypatch):
    def handler(request):
        assert request.url == httpx.URL(resend.DOMINIOS)
        assert request.headers["authorization"] == "Bearer re_completa"
        return httpx.Response(200, json={"data": [
            {"id": "d1", "name": "hs.com.br", "status": "verified",
             "capabilities": {"sending": "enabled"}}]})
    _trocar_transporte(monkeypatch, handler)

    r = await resend.testar_chave("re_completa")

    assert r == {"valida": True, "escopo": "full", "dominios": [
        {"id": "d1", "name": "hs.com.br", "status": "verified",
         "capabilities": {"sending": "enabled"}}]}


async def test_chave_de_envio_e_valida(monkeypatch):
    _trocar_transporte(monkeypatch, lambda r: httpx.Response(
        401, json={"name": "restricted_api_key", "message": "..."}))
    assert await resend.testar_chave("re_envio") == {
        "valida": True, "escopo": "sending_only", "dominios": []}


async def test_401_sem_restricted_e_chave_invalida(monkeypatch):
    _trocar_transporte(monkeypatch, lambda r: httpx.Response(
        401, json={"name": "missing_api_key"}))
    assert await resend.testar_chave("re_x") == {
        "valida": False, "motivo": "invalid_api_key"}


async def test_403_e_chave_invalida(monkeypatch):
    _trocar_transporte(monkeypatch, lambda r: httpx.Response(
        403, json={"name": "invalid_api_key"}))
    assert await resend.testar_chave("re_x") == {
        "valida": False, "motivo": "invalid_api_key"}


async def test_rede_fora_do_ar_nao_levanta(monkeypatch):
    def handler(request):
        raise httpx.ConnectError("sem rede")
    _trocar_transporte(monkeypatch, handler)
    assert await resend.testar_chave("re_x") == {"valida": False, "motivo": "network"}


async def test_ler_dominio_filtra_so_os_registros_de_tracking(monkeypatch):
    def handler(request):
        assert request.url == httpx.URL(f"{resend.DOMINIOS}/d1")
        return httpx.Response(200, json={
            "open_tracking": True, "click_tracking": False,
            "tracking_subdomain": "links", "status": "verified",
            "records": [{"record": "SPF", "name": "x"},
                        {"record": "Tracking", "name": "links", "type": "CNAME",
                         "value": "links1.resend-dns.com", "status": "pending"}]})
    _trocar_transporte(monkeypatch, handler)

    r = await resend.ler_dominio("re_completa", "d1")

    assert r["ok"] is True
    assert r["open_tracking"] is True and r["click_tracking"] is False
    assert [x["record"] for x in r["records"]] == ["Tracking"]


async def test_ler_dominio_com_chave_de_envio(monkeypatch):
    _trocar_transporte(monkeypatch, lambda r: httpx.Response(
        401, json={"name": "restricted_api_key"}))
    assert await resend.ler_dominio("re_envio", "d1") == {
        "ok": False, "motivo": "restricted_api_key"}


async def test_ler_dominio_inexistente(monkeypatch):
    _trocar_transporte(monkeypatch, lambda r: httpx.Response(404, json={}))
    assert await resend.ler_dominio("re_x", "d9") == {"ok": False, "motivo": "not_found"}


async def test_alterar_dominio_manda_patch_com_o_corpo(monkeypatch):
    visto = {}

    def handler(request):
        visto["metodo"] = request.method
        visto["corpo"] = request.read()
        return httpx.Response(200, json={"object": "domain"})
    _trocar_transporte(monkeypatch, handler)

    r = await resend.alterar_dominio("re_x", "d1", {"open_tracking": True})

    assert r.status_code == 200
    assert visto["metodo"] == "PATCH"
    assert b'"open_tracking":true' in visto["corpo"].replace(b" ", b"")


async def test_alterar_dominio_sem_rede_levanta_falha_de_rede(monkeypatch):
    def handler(request):
        raise httpx.ConnectError("sem rede")
    _trocar_transporte(monkeypatch, handler)
    with pytest.raises(resend.FalhaDeRede):
        await resend.alterar_dominio("re_x", "d1", {})
