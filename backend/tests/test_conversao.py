"""A resolução do lead e o recálculo da data — o que clicar não exercita.

`POST /publico/conversao` tem quatro estratégias para achar o lead quando o
chamador não manda `lead_id`. Nenhuma aparece abrindo a tela: a tela não chama
esta rota. Quem chama é integrador externo, e o modo de falhar é achar o lead
ERRADO — que ninguém percebe, porque a conversão entra normalmente e o número
do painel sobe.

O recálculo está aqui pelo mesmo motivo. O gatilho
`trg_update_last_conversion_date` é AFTER INSERT e usa `greatest()`: ele nunca
BAIXA a data. Apagar a conversão mais recente sem recalcular deixa
`leads.last_conversion_date` mentindo para sempre, e nada avisa.
"""

from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from limpeza import apagar_leads
from rodada import EmailDeRodada

import app.database as db
from app.chave_api import gerar_chave
from app.routers.publico import (
    ConversaoIn, _aplicar_tag_do_slug, _recalcular_datas, _resolver_lead,
)

pytestmark = pytest.mark.asyncio


async def _lead(conexao, **campos):
    """⚠️ `tipo` é NOT NULL sem default em `leads`. Omitir derruba a fixture
    com NotNullViolationError, e o erro aparece como falha do teste errado."""
    campos.setdefault("tipo", "teste")
    nomes = ", ".join(campos)
    marcas = ", ".join(f"${i}" for i in range(1, len(campos) + 1))
    return str(await conexao.fetchval(
        f"INSERT INTO leads ({nomes}) VALUES ({marcas}) RETURNING id",
        *campos.values()))


# Único por processo (decisão 27: duas suítes ao mesmo tempo) — ver tests/rodada.py.
_EMAIL_E2E = EmailDeRodada("conversao-e2e", antigo="conversao-e2e@exemplo.invalid")
EMAIL_E2E = _EMAIL_E2E.atual


@pytest_asyncio.fixture
async def chamador():
    """Um lead e uma chave de API de escopo `write`, gravados de verdade para
    exercitar `POST /publico/conversao` pelo `cliente` (que COMMITA — ver o
    docstring da fixture `cliente` em conftest.py). Apagado no teardown,
    mesmo padrão de `envio` em conftest.py.

    Devolve `(lead_id, chave_crua)`.
    """
    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL — os testes de conversão e2e exigem banco")
    crua, hash_, prefixo = gerar_chave()
    async with db.sessao(role="service_role") as conn:
        # ⚠️ Limpa ANTES de inserir — mesmo motivo do comentário de `envio`:
        # se o pytest morrer no meio (timeout, Ctrl-C), a linha fica e
        # `leads_email_unique`/o hash da chave derrubam a rodada seguinte no
        # setup, com um erro que aponta para o índice e não para o motivo.
        await apagar_leads(conn, [r["id"] for r in await conn.fetch(
            f"SELECT id FROM leads WHERE {_EMAIL_E2E.onde(1)}",
            *_EMAIL_E2E.parametros())])
        await conn.execute("DELETE FROM api_keys WHERE key_hash = $1", hash_)
        lead = await conn.fetchval(
            "INSERT INTO leads (nome, email, tipo) VALUES "
            "('Conversão e2e', $1, 'teste') RETURNING id", EMAIL_E2E)
        await conn.execute(
            "INSERT INTO api_keys (name, key_hash, key_prefix, permissions) "
            "VALUES ('teste e2e de conversão', $1, $2, 'write')", hash_, prefixo)
    yield str(lead), crua
    async with db.sessao(role="service_role") as conn:
        await conn.execute("DELETE FROM lead_conversions WHERE lead_id = $1::uuid", lead)
        await conn.execute("DELETE FROM lead_tags WHERE lead_id = $1::uuid", lead)
        await apagar_leads(conn, [lead])
        await conn.execute("DELETE FROM api_keys WHERE key_hash = $1", hash_)


async def test_post_conversao_recalcula_a_data_que_o_default_deixa_no_futuro(
        cliente, chamador):
    """Fim a fim: `POST /publico/conversao` pelo cliente ASGI de verdade —
    não a chamada direta a `_recalcular_datas` que o teste anterior fazia.

    O lead nasce com `last_conversion_date = DEFAULT now()` (migrations/001).
    Uma conversão registrada com `converted_at` no passado não baixa isso
    sozinha: o gatilho `trg_update_last_conversion_date` é AFTER INSERT e usa
    `greatest()`, que nunca vê o passado como maior que o default. Sem a
    chamada a `_recalcular_datas` dentro do handler `registrar_conversao`
    (backend/app/routers/publico.py), a data fica presa no DEFAULT now() —
    sem erro e sem aviso. Comentar aquela linha faz este teste FALHAR: é o
    que prova que ele protege a correção do commit 4d625fd, e não só o código
    velho de `_recalcular_datas` (que os dois testes abaixo já cobrem
    isoladamente).
    """
    lead_id, chave = chamador
    converted_at = datetime.now(timezone.utc) - timedelta(days=10)

    resposta = await cliente.post(
        "/publico/conversao",
        json={
            "lead_id": lead_id,
            "tipo": "diagnostico",
            "page_slug": "humanoseagentes",
            "converted_at": converted_at.isoformat(),
            "apply_tag": False,
        },
        headers={"Authorization": f"Bearer {chave}"},
    )
    assert resposta.status_code == 201, resposta.text

    async with db.sessao(role="service_role") as conn:
        last_conversion_date = await conn.fetchval(
            "SELECT last_conversion_date FROM leads WHERE id = $1::uuid", lead_id)

    assert last_conversion_date == converted_at, (
        "last_conversion_date ficou na data do DEFAULT now() em vez da "
        "conversão registrada — a rota deixou de recalcular depois do INSERT")


async def test_acha_por_email_ignorando_maiuscula(conexao):
    lead = await _lead(conexao, nome="Carla", email="carla@exemplo.invalid")
    achado = await _resolver_lead(conexao, ConversaoIn(
        tipo="diagnostico", page_slug="humanoseagentes",
        email="CARLA@Exemplo.Invalid"))
    assert achado == lead


async def test_email_repetido_vence_o_mais_recente(conexao):
    # ⚠️ Divergência do brief: `leads_email_unique` (migrations/001) é UNIQUE
    # sobre a coluna crua, não sobre `lower(email)` — duas linhas com o MESMO
    # texto de e-mail violam a constraint e derrubam a fixture antes do teste
    # rodar. As duas linhas usam capitalização diferente (mesmo endereço, cru
    # distinto) para não colidir na constraint, e ainda assim colidem no
    # `lower(email) = $1` que `_resolver_lead` usa — preserva o cenário de
    # "e-mail repetido" que o teste quer exercitar.
    await _lead(conexao, nome="Antigo", email="dup@exemplo.invalid")
    novo = await conexao.fetchval(
        "INSERT INTO leads (nome, email, tipo, created_at) "
        "VALUES ('Novo', 'DUP@exemplo.invalid', 'teste', now() + interval '1 hour') "
        "RETURNING id")
    achado = await _resolver_lead(conexao, ConversaoIn(
        tipo="diagnostico", page_slug="p", email="dup@exemplo.invalid"))
    assert achado == str(novo)


async def test_dnia_id_vence_o_email(conexao):
    """A ordem das estratégias importa: dnia_id é exato, e-mail não é."""
    dnia = await conexao.fetchval("SELECT gen_random_uuid()")
    certo = await _lead(conexao, nome="Certo", email="a@exemplo.invalid",
                        dnia_id=dnia)
    await _lead(conexao, nome="Errado", email="b@exemplo.invalid")
    achado = await _resolver_lead(conexao, ConversaoIn(
        tipo="t", page_slug="p", dnia_id=str(dnia), email="b@exemplo.invalid"))
    assert achado == certo


@pytest.mark.trava_global  # o lead comitado da captura de outra rodada tem o mesmo telefone
async def test_acha_por_telefone_normalizado(conexao):
    normalizado = await conexao.fetchval(
        "SELECT normalize_phone_br($1)", "(85) 99999-1234")
    lead = await _lead(conexao, nome="Zé", phone_normalized=normalizado)
    achado = await _resolver_lead(conexao, ConversaoIn(
        tipo="t", page_slug="p", phone="85 99999 1234"))
    assert achado == lead


async def test_acha_pela_identidade_quando_o_lead_nao_casa(conexao):
    """A quarta estratégia: lead criado por /publico/identidade, sem e-mail na
    própria linha de `leads`, alcançável só pela identidade."""
    lead = await _lead(conexao, nome="Pela identidade")
    await conexao.execute(
        "INSERT INTO ecosystem_identities (email, dndash_lead_id) "
        "VALUES ($1, $2::uuid)", "so-na-identidade@exemplo.invalid", lead)
    achado = await _resolver_lead(conexao, ConversaoIn(
        tipo="t", page_slug="p", email="so-na-identidade@exemplo.invalid"))
    assert achado == lead


async def test_sem_nada_para_casar_devolve_none(conexao):
    achado = await _resolver_lead(conexao, ConversaoIn(
        tipo="t", page_slug="p", email="ninguem@exemplo.invalid"))
    assert achado is None


async def test_tag_do_slug_normaliza_e_repete_sem_duplicar(conexao):
    lead = await _lead(conexao, nome="Com tag")
    primeira = await _aplicar_tag_do_slug(conexao, lead, "/HumanosEAgentes")
    segunda = await _aplicar_tag_do_slug(conexao, lead, "humanoseagentes")
    assert primeira == "humanoseagentes"
    assert segunda == "humanoseagentes"
    quantas = await conexao.fetchval(
        "SELECT count(*) FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id "
        "WHERE lt.lead_id = $1::uuid AND t.name = 'humanoseagentes'", lead)
    assert quantas == 1


async def test_tag_recusa_slug_fora_do_charset(conexao):
    """`tags.name` sem guarda vira campo de texto livre escrito de fora."""
    lead = await _lead(conexao, nome="Sem tag")
    assert await _aplicar_tag_do_slug(conexao, lead, "Robert'); DROP TABLE") is None
    assert await _aplicar_tag_do_slug(conexao, lead, "x" * 61) is None
    assert await conexao.fetchval(
        "SELECT count(*) FROM lead_tags WHERE lead_id = $1::uuid", lead) == 0


async def test_recalculo_baixa_a_data_que_o_gatilho_nao_baixa(conexao):
    lead = await _lead(conexao, nome="Duas conversões")
    await conexao.execute(
        "INSERT INTO lead_conversions (lead_id, tipo, converted_at, page_slug) "
        "VALUES ($1::uuid, 't', now() - interval '10 days', 'p')", lead)
    await conexao.execute(
        "INSERT INTO lead_conversions (lead_id, tipo, converted_at, page_slug, session_id) "
        "VALUES ($1::uuid, 't', now(), 'p', 'sessao-de-teste')", lead)
    # o gatilho subiu a data para a mais recente
    antes = await conexao.fetchval(
        "SELECT last_conversion_date FROM leads WHERE id = $1::uuid", lead)

    await conexao.execute(
        "DELETE FROM lead_conversions WHERE session_id = 'sessao-de-teste'")
    await _recalcular_datas(conexao, [lead])

    depois = await conexao.fetchval(
        "SELECT last_conversion_date FROM leads WHERE id = $1::uuid", lead)
    assert depois < antes, "sem recálculo a data fica na conversão apagada"


async def test_recalculo_zera_quando_nao_sobra_conversao(conexao):
    lead = await _lead(conexao, nome="Zerado")
    await conexao.execute(
        "INSERT INTO lead_conversions (lead_id, tipo, converted_at, page_slug) "
        "VALUES ($1::uuid, 't', now(), 'p')", lead)
    await conexao.execute("DELETE FROM lead_conversions WHERE lead_id = $1::uuid", lead)
    await _recalcular_datas(conexao, [lead])
    assert await conexao.fetchval(
        "SELECT last_conversion_date FROM leads WHERE id = $1::uuid", lead) is None


async def test_conversao_com_teste_ab_registra_lead_criado_uma_vez(
        cliente, chamador, limpar_ab):
    """O `leadConversion.ts` gravava `lead_criado` no coletor; o lote 7 o
    apagou e esta rota não assumiu. Decisão 7 do plano do 8C.

    `apply_tag: False` porque a fixture `chamador` não apaga a tag criada."""
    lead_id, chave = chamador
    corpo = {"lead_id": lead_id, "tipo": "lead", "page_slug": "lp-8c",
             "ab_test": "teste-8c-conv", "ab_var": "A", "ab_vid": "v_teste8c-conv",
             "apply_tag": False}
    for _ in range(2):
        r = await cliente.post("/publico/conversao", json=corpo,
                               headers={"Authorization": f"Bearer {chave}"})
        assert r.status_code == 201, r.text
    async with db.sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            "SELECT event_name, lead_id::text, page_slug FROM ab_events "
            "WHERE ab_test = 'teste-8c-conv'")
    assert [dict(l) for l in linhas] == [
        {"event_name": "lead_criado", "lead_id": lead_id, "page_slug": "lp-8c"}]
