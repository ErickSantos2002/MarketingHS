"""O e-mail de teste (`POST /campanhas/enviar-teste`) leva o mesmo reply-to da
campanha real (frente responder-para, 27/10/2026). Sem banco e sem rede: a
sessão, os segredos e o Resend são falsos.

Divergir aqui faria o admin conferir um e-mail de teste cuja resposta vai
para um lugar e a campanha de verdade para outro — testaria a coisa errada,
o mesmo motivo de o remetente sair do mesmo segredo.
"""

import contextlib

import pytest

from app.routers import envio


class Conn:
    async def fetchrow(self, sql, *a):
        if "email_templates" in sql:
            return {"name": "Boas-vindas", "html": "<p>Oi {{nome}}</p>"}
        return None  # não suprimido


@pytest.fixture
def mundo(monkeypatch):
    estado = {"enviados": [], "segredos": {"RESEND_API_KEY": "re_falsa",
                                            "EMAIL_FROM": "HS <c@exemplo.invalid>"}}

    @contextlib.asynccontextmanager
    async def sessao(**_):
        yield Conn()

    async def segredo(nome):
        return estado["segredos"].get(nome)

    async def enviar(**kw):
        estado["enviados"].append(kw)
        return "re_1"

    monkeypatch.setattr(envio, "sessao", sessao)
    monkeypatch.setattr(envio.integracoes, "ler_segredo", segredo)
    monkeypatch.setattr(envio.resend, "enviar", enviar)
    return estado


def _dados():
    return envio.TesteIn(template_id="00000000-0000-0000-0000-000000000001",
                         to="admin@exemplo.invalid")


async def test_envio_de_teste_leva_o_responder_para(mundo):
    mundo["segredos"]["EMAIL_REPLY_TO"] = "hs@healthsafety.com.br"
    r = await envio.enviar_teste(_dados(), None)
    assert r["enviado"] is True
    assert mundo["enviados"][0]["responder_para"] == "hs@healthsafety.com.br"


async def test_envio_de_teste_sem_responder_para_passa_vazio(mundo):
    await envio.enviar_teste(_dados(), None)
    assert not mundo["enviados"][0]["responder_para"]
