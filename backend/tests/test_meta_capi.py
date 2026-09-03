"""A montagem do evento do Meta CAPI.

⚠️ Nenhum teste aqui faz rede. O que se prova é a montagem, que é a parte que
erra CALADA: o Meta aceita evento com hash errado e simplesmente não atribui a
conversão. Um teste que só verificasse "respondeu 200" não provaria nada.
"""

import hashlib

import pytest

from app.dominio import meta_capi


def _sha(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def test_email_e_normalizado_antes_do_hash():
    """Maiúscula e espaço mudam o hash. O Meta compara hash com hash: um
    '  Erick@HS.com ' não bate com o cadastro dele e a conversão se perde."""
    evento = meta_capi.montar_evento("Lead", email="  Erick@HS.COM ")
    assert evento["user_data"]["em"] == [_sha("erick@hs.com")]


def test_telefone_brasileiro_ganha_o_55():
    """Sem o código do país o número não casa com nada na base do Meta."""
    evento = meta_capi.montar_evento("Lead", phone="(81) 99999-8888")
    assert evento["user_data"]["ph"] == [_sha("5581999998888")]


def test_telefone_que_ja_tem_codigo_do_pais_nao_ganha_outro():
    evento = meta_capi.montar_evento("Lead", phone="+55 81 99999-8888")
    assert evento["user_data"]["ph"] == [_sha("5581999998888")]


def test_campo_ausente_nao_vira_hash_de_string_vazia():
    """Mandar sha256('') é pior que não mandar: o Meta trata como identificador
    e ele bate com todo mundo que também mandou vazio."""
    evento = meta_capi.montar_evento("Lead", email="a@b.com")
    assert "ph" not in evento["user_data"]
    assert "fn" not in evento["user_data"]
    assert "external_id" not in evento["user_data"]


def test_fbc_e_fbp_vao_crus():
    """São identificadores do próprio Meta. Hashear quebra a atribuição."""
    evento = meta_capi.montar_evento("Lead", fbc="fb.1.123.abc", fbp="fb.1.456.def")
    assert evento["user_data"]["fbc"] == "fb.1.123.abc"
    assert evento["user_data"]["fbp"] == "fb.1.456.def"


def test_ip_e_user_agent_vao_crus():
    evento = meta_capi.montar_evento(
        "Lead", client_ip_address="200.1.2.3", client_user_agent="Mozilla/5.0")
    assert evento["user_data"]["client_ip_address"] == "200.1.2.3"
    assert evento["user_data"]["client_user_agent"] == "Mozilla/5.0"


def test_o_event_id_e_o_que_deduplica_com_o_pixel():
    """O Pixel do navegador e o CAPI mandam o MESMO evento. Sem event_id igual
    nos dois, o Meta conta duas conversões para um lead só."""
    evento = meta_capi.montar_evento("Lead", event_id="abc-123", email="a@b.com")
    assert evento["event_id"] == "abc-123"


def test_sem_event_id_o_campo_nao_aparece():
    evento = meta_capi.montar_evento("Lead", email="a@b.com")
    assert "event_id" not in evento


def test_o_evento_carrega_hora_e_origem():
    evento = meta_capi.montar_evento("Lead", email="a@b.com")
    assert evento["event_name"] == "Lead"
    assert evento["action_source"] == "website"
    assert isinstance(evento["event_time"], int)


def test_evento_sem_nenhum_identificador_e_recusado_aqui():
    """error_subcode 2804050 — 'insufficient customer parameters'. O Meta
    recusa, mas só depois da viagem. Recusar aqui poupa a rede e dá uma
    mensagem que diz o que fazer.

    ⚠️ É por isto que o ClickCTA da dn.ia era Pixel-only: evento sem PII não
    tem o que mandar ao CAPI. O Pixel do navegador carrega fbp/fbc/ip/UA
    sozinho e não precisa do servidor."""
    with pytest.raises(ValueError, match="identificador"):
        meta_capi.montar_evento("ClickCTA", custom_data={"cta": "topo"})


def test_custom_data_passa_inteiro():
    evento = meta_capi.montar_evento(
        "Lead", email="a@b.com", custom_data={"lead_type": "gratuito"})
    assert evento["custom_data"] == {"lead_type": "gratuito"}


@pytest.mark.asyncio
async def test_credenciais_ausentes_nao_levantam():
    """`ler_segredo` nunca levanta, e isto também não pode. Falhar em contar uma
    conversão jamais pode derrubar a captura de um lead."""
    creds = await meta_capi.credenciais()
    assert isinstance(creds.configurado, bool)
