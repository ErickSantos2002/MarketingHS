"""A configuração do Resend, restaurada no lote 8A.

As rotas chamam a API do Resend; aqui as funções do cliente são trocadas por
monkeypatch — o cliente em si é testado em `test_resend_cliente.py`.
"""

from datetime import datetime, timedelta, timezone

import jwt
import pytest

from app import integracoes
from app.config import settings
from app.email import resend as cliente_resend
from app.routers.configuracao import partes_do_remetente

ROTA = "/config/resend"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _resend_falso(monkeypatch, teste=None, dominio=None):
    async def testar_chave(chave):
        return teste or {"valida": True, "escopo": "full", "dominios": []}

    async def ler_dominio(chave, dominio_id):
        return dominio or {"ok": False, "motivo": "not_found"}

    monkeypatch.setattr(cliente_resend, "testar_chave", testar_chave)
    monkeypatch.setattr(cliente_resend, "ler_dominio", ler_dominio)


async def test_leitura_sem_credencial_da_401(cliente):
    r = await cliente.get(ROTA)
    assert r.status_code == 401


async def test_leitura_aceita_chave_de_api_de_leitura(cliente, chave_de,
                                                      segredos_resend, monkeypatch):
    _resend_falso(monkeypatch)
    r = await cliente.get(ROTA, headers=_auth(await chave_de("read")))
    assert r.status_code == 200, r.text


async def test_escrita_recusa_chave_de_api_mesmo_de_escrita(cliente, chave_de,
                                                            segredos_resend):
    """Comentário I2 da origem: chave da tabela `api_keys` que vazasse poderia
    trocar a RESEND_API_KEY por uma de outra conta e exfiltrar a base."""
    r = await cliente.put(ROTA, headers=_auth(await chave_de("write")), json={
        "from_name": "HS", "from_prefix": "contato", "from_domain": "hs.com.br"})
    assert r.status_code == 401


async def test_leitura_aceita_jwt_de_admin(cliente, token_admin, segredos_resend,
                                           monkeypatch):
    _resend_falso(monkeypatch)
    r = await cliente.get(ROTA, headers=_auth(token_admin))
    assert r.status_code == 200, r.text


async def test_leitura_aceita_webhook_secret(cliente, segredos_resend, monkeypatch):
    _resend_falso(monkeypatch)
    monkeypatch.setattr(settings, "WEBHOOK_SECRET", "segredo-mestre-de-teste-8a")
    r = await cliente.get(ROTA, headers=_auth("segredo-mestre-de-teste-8a"))
    assert r.status_code == 200, r.text


async def test_escrita_com_jwt_de_admin_vencido_da_sessao_expirada(cliente, token_admin):
    """JWT vencido de admin é do navegador, não de máquina — não pode cair no
    caminho de `api_keys` (leitura) nem virar o 401 genérico de credencial de
    máquina (escrita). Tem de dar a mensagem de sessão vencida, do
    `usuario_atual`."""
    # Decodifica sem validar para pegar o `sub` de verdade, sem precisar de
    # outra ida ao banco: a fixture já garante que o usuário existe.
    dados = jwt.decode(token_admin, options={"verify_signature": False})
    agora = datetime.now(timezone.utc)
    vencido = jwt.encode(
        {"sub": dados["sub"], "email": dados["email"], "papel": "admin",
         "iat": agora - timedelta(hours=2), "exp": agora - timedelta(hours=1)},
        settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    r = await cliente.put(ROTA, headers=_auth(vencido), json={
        "from_name": "HS", "from_prefix": "contato", "from_domain": "hs.com.br"})
    assert r.status_code == 401
    assert "expirada" in r.json()["detail"]


def test_partes_do_remetente():
    assert partes_do_remetente("Health & Safety <contato@hs.com.br>") == {
        "nome": "Health & Safety", "prefixo": "contato", "dominio": "hs.com.br"}
    assert partes_do_remetente("contato@hs.com.br") is None
    assert partes_do_remetente(None) is None


async def test_leitura_devolve_escopo_dominios_e_webhook_url_e_nunca_o_segredo(
        cliente, token_admin, segredos_resend, monkeypatch):
    await integracoes.gravar_segredo("RESEND_API_KEY", "re_segredo_de_teste_1234")
    await integracoes.gravar_segredo("EMAIL_FROM", "HS <contato@hs.com.br>")
    _resend_falso(monkeypatch, teste={"valida": True, "escopo": "full", "dominios": [
        {"id": "d1", "name": "hs.com.br", "status": "verified", "capabilities": None}]})

    r = await cliente.get(ROTA, headers=_auth(token_admin))

    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["resend_api_key"] == {"configurado": True, "ultimos4": "1234",
                                       "escopo": "full"}
    assert corpo["remetente"] == {"nome": "HS", "prefixo": "contato",
                                  "dominio": "hs.com.br"}
    assert corpo["dominios"][0]["id"] == "d1"
    assert corpo["webhook_url"].endswith("/publico/webhook/resend")
    assert "re_segredo_de_teste" not in r.text


async def test_testar_classifica_sem_gravar(cliente, token_admin, segredos_resend,
                                            monkeypatch):
    _resend_falso(monkeypatch, teste={"valida": True, "escopo": "sending_only",
                                      "dominios": []})
    r = await cliente.post(f"{ROTA}/testar", headers=_auth(token_admin),
                           json={"api_key": "re_nova"})
    assert r.json() == {"valida": True, "escopo": "sending_only", "dominios": []}
    assert await integracoes.ler_segredo("RESEND_API_KEY") is None


async def test_diagnostico_aponta_o_que_falta(cliente, token_admin, segredos_resend):
    r = await cliente.get(f"{ROTA}/diagnostico", headers=_auth(token_admin))
    corpo = r.json()
    assert corpo["ok"] is False
    assert corpo["faltando"] == ["RESEND_API_KEY", "EMAIL_FROM", "RESEND_WEBHOOK_SECRET"]
    assert corpo["segredo_descadastro_faltando"] is True


async def test_diagnostico_completo(cliente, token_admin, segredos_resend, monkeypatch):
    for nome, valor in (("RESEND_API_KEY", "re_x"), ("EMAIL_FROM", "HS <c@hs.com.br>"),
                        ("RESEND_WEBHOOK_SECRET", "whsec_eA=="),
                        ("UNSUBSCRIBE_SECRET", "u" * 32)):
        await integracoes.gravar_segredo(nome, valor)
    _resend_falso(monkeypatch, teste={"valida": True, "escopo": "full", "dominios": [
        {"id": "d1", "name": "hs.com.br", "status": "verified", "capabilities": None}]})

    corpo = (await cliente.get(f"{ROTA}/diagnostico", headers=_auth(token_admin))).json()

    assert corpo == {"ok": True, "faltando": [], "segredo_descadastro_faltando": False,
                     "remetente": "HS <c@hs.com.br>",
                     "dominios": [{"name": "hs.com.br", "status": "verified"}]}


REMETENTE = {"from_name": "Health & Safety", "from_prefix": "contato",
             "from_domain": "hs.com.br"}
VERIFICADO = {"valida": True, "escopo": "full", "dominios": [
    {"id": "d1", "name": "hs.com.br", "status": "verified",
     "capabilities": {"sending": "enabled"}}]}


async def test_gravar_recusa_chave_invalida_e_nao_grava_nada(
        cliente, token_admin, segredos_resend, monkeypatch):
    _resend_falso(monkeypatch, teste={"valida": False, "motivo": "invalid_api_key"})
    r = await cliente.put(ROTA, headers=_auth(token_admin), json={
        **REMETENTE, "api_key": "re_ruim", "unsubscribe_secret": "u" * 32})
    assert r.status_code == 400
    assert await integracoes.ler_segredo("RESEND_API_KEY") is None
    assert await integracoes.ler_segredo("UNSUBSCRIBE_SECRET") is None


async def test_gravar_exige_o_dominio_na_conta(cliente, token_admin, segredos_resend,
                                               monkeypatch):
    _resend_falso(monkeypatch, teste={"valida": True, "escopo": "full", "dominios": []})
    r = await cliente.put(ROTA, headers=_auth(token_admin), json={
        **REMETENTE, "api_key": "re_ok", "unsubscribe_secret": "u" * 32})
    assert r.status_code == 400
    assert "não encontrado" in r.json()["detail"]
    assert await integracoes.ler_segredo("RESEND_API_KEY") is None
    assert await integracoes.ler_segredo("EMAIL_FROM") is None


async def test_gravar_exige_dominio_verificado(cliente, token_admin, segredos_resend,
                                               monkeypatch):
    _resend_falso(monkeypatch, teste={"valida": True, "escopo": "full", "dominios": [
        {"id": "d1", "name": "hs.com.br", "status": "pending", "capabilities": None}]})
    r = await cliente.put(ROTA, headers=_auth(token_admin), json={
        **REMETENTE, "api_key": "re_ok", "unsubscribe_secret": "u" * 32})
    assert r.status_code == 400
    assert "não está verificado" in r.json()["detail"]
    assert await integracoes.ler_segredo("RESEND_API_KEY") is None
    assert await integracoes.ler_segredo("EMAIL_FROM") is None


async def test_parcialmente_verificado_com_envio_ligado_passa(
        cliente, token_admin, segredos_resend, monkeypatch):
    _resend_falso(monkeypatch, teste={"valida": True, "escopo": "full", "dominios": [
        {"id": "d1", "name": "hs.com.br", "status": "partially_verified",
         "capabilities": {"sending": "enabled"}}]})
    r = await cliente.put(ROTA, headers=_auth(token_admin), json={
        **REMETENTE, "api_key": "re_ok", "unsubscribe_secret": "u" * 32})
    assert r.status_code == 200, r.text


async def test_gravar_monta_o_remetente_e_grava(cliente, token_admin, segredos_resend,
                                               monkeypatch):
    _resend_falso(monkeypatch, teste=VERIFICADO)
    r = await cliente.put(ROTA, headers=_auth(token_admin), json={
        **REMETENTE, "api_key": "re_ok", "unsubscribe_secret": "u" * 32,
        "webhook_secret": "whsec_eA=="})
    assert r.status_code == 200, r.text
    assert r.json()["email_from"] == "Health & Safety <contato@hs.com.br>"
    assert r.json()["aviso"] is None
    assert await integracoes.ler_segredo("EMAIL_FROM") == \
        "Health & Safety <contato@hs.com.br>"
    assert await integracoes.ler_segredo("RESEND_API_KEY") == "re_ok"


async def test_chave_de_envio_grava_com_aviso(cliente, token_admin, segredos_resend,
                                              monkeypatch):
    _resend_falso(monkeypatch, teste={"valida": True, "escopo": "sending_only",
                                      "dominios": []})
    r = await cliente.put(ROTA, headers=_auth(token_admin), json={
        **REMETENTE, "api_key": "re_envio", "unsubscribe_secret": "u" * 32})
    assert r.status_code == 200, r.text
    assert "confira manualmente" in r.json()["aviso"]


async def test_segredo_de_descadastro_e_obrigatorio_na_primeira_vez(
        cliente, token_admin, segredos_resend, monkeypatch):
    """Sem ele o worker não consome a fila (`worker.py:180`) — e o 3C deixou a
    tela sem caminho para gravá-lo."""
    _resend_falso(monkeypatch, teste=VERIFICADO)
    r = await cliente.put(ROTA, headers=_auth(token_admin),
                          json={**REMETENTE, "api_key": "re_ok"})
    assert r.status_code == 400
    assert "descadastro" in r.json()["detail"]
    assert await integracoes.ler_segredo("RESEND_API_KEY") is None
    assert await integracoes.ler_segredo("EMAIL_FROM") is None
    assert await integracoes.ler_segredo("UNSUBSCRIBE_SECRET") is None


async def test_segredo_de_descadastro_curto_e_recusado(cliente, token_admin,
                                                       segredos_resend, monkeypatch):
    _resend_falso(monkeypatch, teste=VERIFICADO)
    r = await cliente.put(ROTA, headers=_auth(token_admin), json={
        **REMETENTE, "api_key": "re_ok", "unsubscribe_secret": "curto"})
    assert r.status_code == 400
    assert "32" in r.json()["detail"]
    assert await integracoes.ler_segredo("RESEND_API_KEY") is None
    assert await integracoes.ler_segredo("EMAIL_FROM") is None
    assert await integracoes.ler_segredo("UNSUBSCRIBE_SECRET") is None


async def test_com_segredo_ja_gravado_so_o_remetente_basta(
        cliente, token_admin, segredos_resend, monkeypatch):
    await integracoes.gravar_segredo("UNSUBSCRIBE_SECRET", "u" * 40)
    await integracoes.gravar_segredo("RESEND_API_KEY", "re_ja_gravada")
    _resend_falso(monkeypatch, teste=VERIFICADO)
    r = await cliente.put(ROTA, headers=_auth(token_admin),
                          json={**REMETENTE, "api_key": "", "unsubscribe_secret": ""})
    assert r.status_code == 200, r.text
    assert r.json()["gravados"] == ["email_from"]
    assert await integracoes.ler_segredo("UNSUBSCRIBE_SECRET") == "u" * 40
    assert await integracoes.ler_segredo("RESEND_API_KEY") == "re_ja_gravada"


async def test_webhook_sem_whsec_e_recusado(cliente, token_admin, segredos_resend,
                                            monkeypatch):
    _resend_falso(monkeypatch, teste=VERIFICADO)
    r = await cliente.put(ROTA, headers=_auth(token_admin), json={
        **REMETENTE, "api_key": "re_ok", "unsubscribe_secret": "u" * 32,
        "webhook_secret": "sem-prefixo"})
    assert r.status_code == 400
    assert await integracoes.ler_segredo("RESEND_API_KEY") is None
