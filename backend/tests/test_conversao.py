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

import pytest

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


async def test_recalculo_assenta_a_data_que_o_default_deixa_no_futuro(conexao):
    """`leads.last_conversion_date` tem `DEFAULT now()` (migrations/001). Um
    lead recém-criado já nasce com a data "no futuro" em relação a uma
    conversão que se registre depois com `converted_at` no passado — e o
    gatilho, que só SOBE a data (`greatest()`), não conserta isso: ele nunca
    vê a conversão como maior que o default. Sem o recálculo depois do
    INSERT, a data fica maior que qualquer conversão que exista, sem erro e
    sem aviso. É o cenário que `registrar_conversao` (POST /publico/conversao)
    agora fecha chamando `_recalcular_datas` no fim do handler."""
    lead = await _lead(conexao, nome="Nasce com o default no futuro")
    default_now = await conexao.fetchval(
        "SELECT last_conversion_date FROM leads WHERE id = $1::uuid", lead)
    assert default_now is not None, "a coluna precisa nascer preenchida pelo DEFAULT now()"

    conversao_passada = await conexao.fetchval(
        "INSERT INTO lead_conversions (lead_id, tipo, converted_at, page_slug) "
        "VALUES ($1::uuid, 't', now() - interval '10 days', 'p') "
        "RETURNING converted_at", lead)

    # o gatilho rodou (AFTER INSERT) e não baixou a data: greatest(default, passado) = default
    depois_do_gatilho = await conexao.fetchval(
        "SELECT last_conversion_date FROM leads WHERE id = $1::uuid", lead)
    assert depois_do_gatilho == default_now, (
        "o gatilho nunca baixa a data — se este assert falhar, o cenário do "
        "DEFAULT now() deixou de existir e o teste deve ser revisto")

    await _recalcular_datas(conexao, [lead])

    depois_do_recalculo = await conexao.fetchval(
        "SELECT last_conversion_date FROM leads WHERE id = $1::uuid", lead)
    assert depois_do_recalculo == conversao_passada, (
        "o recálculo precisa assentar a data na conversão real, não deixá-la "
        "no DEFAULT now() que o gatilho não questiona")


async def test_recalculo_zera_quando_nao_sobra_conversao(conexao):
    lead = await _lead(conexao, nome="Zerado")
    await conexao.execute(
        "INSERT INTO lead_conversions (lead_id, tipo, converted_at, page_slug) "
        "VALUES ($1::uuid, 't', now(), 'p')", lead)
    await conexao.execute("DELETE FROM lead_conversions WHERE lead_id = $1::uuid", lead)
    await _recalcular_datas(conexao, [lead])
    assert await conexao.fetchval(
        "SELECT last_conversion_date FROM leads WHERE id = $1::uuid", lead) is None
