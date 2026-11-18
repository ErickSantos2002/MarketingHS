"""Aviso de lead (frente aviso-de-lead, Task 3): o envio pela fila.

Dado COMITADO (o laço abre `sessao()` própria), apagado no teardown com
`limpeza.apagar_leads` (o CASCADE leva conversão e aviso). Resend falso: nenhum
e-mail real.
"""

import asyncio
import logging
import uuid
from datetime import timedelta

import httpx
import pytest
import pytest_asyncio

import app.database as db
from app import ritmo
from app.avisos import fila
from app.email.resend import LimiteDoResend
from limpeza import apagar_leads

PARA = "a@hs.invalid,b@hs.invalid"


class Cenario:
    def __init__(self):
        self.lead_id = None
        self.email = None
        self.aviso_id = None
        self.chamadas: list[dict] = []
        self.extras: list[str] = []  # leads criados à parte (limpeza)
        self.apos_envio = None
        self.levantar = None  # exceção, ou função (kw) -> exceção | None
        self.segredos = {"RESEND_API_KEY": "re_teste",
                         "EMAIL_FROM": "MHS <a@exemplo.invalid>",
                         "AVISO_LEAD_PARA": PARA}

    async def aviso(self):
        async with db.sessao(role="service_role") as conn:
            return await conn.fetchrow(
                "SELECT *, visivel_em - now() AS falta FROM avisos_de_lead "
                "WHERE id = $1::uuid", self.aviso_id)

    async def liberar(self):
        async with db.sessao(role="service_role") as conn:
            await conn.execute(
                "UPDATE avisos_de_lead SET visivel_em = now() WHERE id = $1::uuid",
                self.aviso_id)

    async def novo_aviso(self, tipo: str, email: str) -> str:
        async with db.sessao(role="service_role") as conn:
            lead = str(await conn.fetchval(
                "INSERT INTO leads (tipo, email, nome) VALUES ($1, $2, 'Beltrano') "
                "RETURNING id", tipo, email))
            self.extras.append(lead)
            conv = await conn.fetchval(
                "INSERT INTO lead_conversions (lead_id) VALUES ($1::uuid) RETURNING id",
                lead)
            return str(await conn.fetchval(
                "INSERT INTO avisos_de_lead (conversao_id, lead_id, visivel_em) "
                "VALUES ($1, $2::uuid, now()) RETURNING id", conv, lead))

    async def rodar(self, **kw):
        return await fila.rodar_avisos(somente=[self.aviso_id], **kw)


@pytest_asyncio.fixture
async def cen(monkeypatch):
    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")
    c = Cenario()
    c.email = f"aviso-{uuid.uuid4().hex[:8]}@exemplo.invalid"
    async with db.sessao(role="service_role") as conn:
        c.lead_id = str(await conn.fetchval(
            "INSERT INTO leads (tipo, email, nome, empresa) "
            "VALUES ('teste', $1, 'Fulano', 'Acme') RETURNING id", c.email))
        conversao = await conn.fetchval(
            "INSERT INTO lead_conversions (lead_id) VALUES ($1::uuid) RETURNING id",
            c.lead_id)
        c.aviso_id = str(await conn.fetchval(
            "INSERT INTO avisos_de_lead (conversao_id, lead_id, visivel_em) "
            "VALUES ($1, $2::uuid, now()) RETURNING id", conversao, c.lead_id))

    async def segredo(nome):
        return c.segredos.get(nome)

    async def enviar(**kw):
        if callable(c.levantar):
            erro = c.levantar(kw)
            if erro:
                raise erro
        elif c.levantar is not None:
            raise c.levantar
        c.chamadas.append(kw)
        if c.apos_envio:
            c.apos_envio()
        return f"re_{len(c.chamadas)}"

    monkeypatch.setattr("app.integracoes.ler_segredo", segredo)
    monkeypatch.setattr(fila.resend, "enviar", enviar)
    yield c
    async with db.sessao(role="service_role") as conn:
        await apagar_leads(conn, [c.lead_id, *c.extras])


def _erro_500():
    req = httpx.Request("POST", "https://api.resend.invalid/emails")
    return httpx.HTTPStatusError("500", request=req,
                                 response=httpx.Response(500, request=req))


async def test_envia_para_cada_destinatario_com_reply_to_do_lead(cen):
    assert await cen.rodar() == {"enviados": 1, "adiados": 0, "falhos": 0}
    assert [c["para"] for c in cen.chamadas] == ["a@hs.invalid", "b@hs.invalid"]
    assert all(c["responder_para"] == cen.email for c in cen.chamadas)
    assert all(c["de"] == "MHS <a@exemplo.invalid>" for c in cen.chamadas)
    assert cen.chamadas[0]["assunto"] == "Novo lead: Fulano — Acme"
    a = await cen.aviso()
    assert a["status"] == "enviado" and a["enviado_em"] is not None
    assert list(a["enviados"]) == ["a@hs.invalid", "b@hs.invalid"]
    assert a["resend_id"] is not None


async def test_lead_de_teste_nao_sai_sem_somente(cen):
    # ⚠️ `escopo` só limita os candidatos: não levanta a exclusão de lead de
    # teste, e a passada nunca vê aviso real (a suíte pode rodar em produção).
    await fila.rodar_avisos(escopo=[cen.aviso_id])
    assert cen.chamadas == []
    a = await cen.aviso()
    assert a["status"] == "pendente" and a["tentativas"] == 0


async def test_lead_real_sai_com_escopo(cen):
    aviso_id = await cen.novo_aviso("lead", f"aviso-{uuid.uuid4().hex[:8]}@hs-teste.com.br")
    assert (await fila.rodar_avisos(escopo=[aviso_id]))["enviados"] == 1
    assert len(cen.chamadas) == 2
    assert (await cen.aviso())["tentativas"] == 0  # o aviso do lead de teste não foi tocado


async def test_parar_devolve_os_nao_tentados(cen):
    cen.segredos["AVISO_LEAD_PARA"] = "a@hs.invalid"
    outro = await cen.novo_aviso("teste", f"aviso-{uuid.uuid4().hex[:8]}@exemplo.invalid")
    parar = asyncio.Event()
    cen.apos_envio = parar.set
    resultado = await fila.rodar_avisos(parar=parar, somente=[cen.aviso_id, outro])
    assert resultado["enviados"] == 1 and len(cen.chamadas) == 1
    async with db.sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            "SELECT status, tentativas, visivel_em <= now() AS vencido "
            "FROM avisos_de_lead WHERE id = ANY($1::uuid[])", [cen.aviso_id, outro])
    pendente = [r for r in linhas if r["status"] == "pendente"]
    assert len(pendente) == 1 and len(linhas) == 2
    assert pendente[0]["tentativas"] == 0 and pendente[0]["vencido"]


async def test_falha_adia_com_espera_crescente(cen):
    cen.levantar = _erro_500()
    assert (await cen.rodar())["adiados"] == 1
    a = await cen.aviso()
    assert a["status"] == "pendente" and a["tentativas"] == 1 and a["erro"]
    assert timedelta(seconds=40) < a["falta"] <= timedelta(minutes=1)
    assert fila.espera(1) == timedelta(minutes=1)
    assert fila.espera(3) == timedelta(minutes=4)
    assert fila.espera(20) == timedelta(minutes=60)


async def test_retry_nao_repete_quem_ja_recebeu(cen):
    cen.levantar = lambda kw: _erro_500() if kw["para"] == "b@hs.invalid" else None
    await cen.rodar()
    assert [c["para"] for c in cen.chamadas] == ["a@hs.invalid"]
    assert list((await cen.aviso())["enviados"]) == ["a@hs.invalid"]
    cen.levantar = None
    await cen.liberar()
    assert (await cen.rodar())["enviados"] == 1
    assert [c["para"] for c in cen.chamadas] == ["a@hs.invalid", "b@hs.invalid"]
    assert (await cen.aviso())["status"] == "enviado"


async def test_limite_do_resend_nao_gasta_tentativa(cen):
    cen.levantar = LimiteDoResend(30)
    compasso = ritmo.Compasso()
    await cen.rodar(compasso=compasso)
    a = await cen.aviso()
    assert a["status"] == "pendente" and a["tentativas"] == 0
    assert timedelta(seconds=20) < a["falta"] <= timedelta(seconds=30)
    assert compasso.segurado()


async def test_oitava_falha_vira_falhou_e_loga(cen, caplog):
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            "UPDATE avisos_de_lead SET tentativas = 7 WHERE id = $1::uuid", cen.aviso_id)
    cen.levantar = _erro_500()
    with caplog.at_level(logging.ERROR):
        assert (await cen.rodar())["falhos"] == 1
    a = await cen.aviso()
    assert a["status"] == "falhou" and a["erro"]
    assert "AVISO DE LEAD NÃO ENVIADO" in caplog.text


async def test_falha_ao_ler_conta_como_erro_comum(cen):
    """Defeito nosso (aviso sem lead) também adia, e não derruba a passada."""
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            "UPDATE avisos_de_lead SET lead_id = gen_random_uuid() WHERE id = $1::uuid",
            cen.aviso_id)
    assert (await cen.rodar())["adiados"] == 1
    a = await cen.aviso()
    assert a["status"] == "pendente" and a["tentativas"] == 1 and a["erro"]
    assert cen.chamadas == []


async def test_sem_chave_nao_reivindica(cen):
    cen.segredos["RESEND_API_KEY"] = None
    assert await cen.rodar() == {"sem_chave": True}
    assert (await cen.aviso())["tentativas"] == 0


async def test_desligado_nao_reivindica(cen):
    cen.segredos["AVISO_LEAD_LIGADO"] = "0"
    assert await cen.rodar() == {"desligado": True}
    assert (await cen.aviso())["tentativas"] == 0
    assert cen.chamadas == []
