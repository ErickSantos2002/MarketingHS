"""O cliente do GrowthHS pela API normal — token, pessoa, cards, descrição.

O modo de falhar é o lead chegar ao comercial com a pessoa errada (a busca é
parcial: `ana@x.com` traz `joana@x.com`), duas pessoas para o mesmo e-mail
(corrida do 400), a descrição sem o que o vendedor precisa, ou o erro mal
classificado: um 5xx tratado como definitivo (o lead nunca chega) e um 4xx
tratado como transitório (a fila re-tenta para sempre uma credencial errada).

Nenhum teste fala com a rede: `httpx.MockTransport` roteando por
método + caminho.
"""

import json
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from app.crm import growthhs
from app.crm.growthhs import (Cliente, Config, ErroDefinitivo, ErroTransitorio,
                              bloco_de_atualizacao, criado_em_utc, marca_do_pedido,
                              montar_card, montar_descricao, normalizar_faturamento,
                              normalizar_funcionarios, origem_do_card_texto)

LEAD = {"id": "c351c124-0000-0000-0000-000000000001", "nome": "Carla Menezes",
        "email": "carla@transportadora.com.br", "whatsapp": "81999999999",
        "phone_normalized": "+5581999999999", "empresa": "Transportadora XYZ",
        "cargo": "Gerente de SESMT", "faturamento": "Entre R$ 100 mil e R$ 500 mil",
        "funcionarios": "11-50", "desafios": "controle de jornada", "indicacao": None,
        "utm_source": "google", "utm_medium": "cpc", "utm_campaign": "black-friday",
        "utm_term": None, "utm_content": None, "lead_score": 60, "etiqueta": "hotlead",
        "campos_extras": {"ja_faz_testagem": "sim"}}
CONVERSAO = {"page_slug": "phoebus-prova", "form_id": None, "site_nome": None,
             "page_url": "https://lp.exemplo.invalid/phoebus-prova",
             "converted_at": "2026-10-21T13:00:00Z", "canal": "pago",
             "gclid": "gclid-abc"}
CONSENTIMENTO = {"base_legal": "consentimento", "versao": "provisoria-2026-10",
                 "provisoria": True, "criado_em": "2026-10-21T13:00:00Z"}
FRONT = "https://mkt.exemplo.invalid"
BASE = "https://growthhs.exemplo.invalid"
CFG = Config(base_url=BASE, client_id="hsg_teste", client_secret="segredo-teste",
             list_id=22, boards_conferidos=(6, 7),
             app_url="https://app.growthhs.exemplo.invalid", ambiente="homologacao")


@pytest.fixture(autouse=True)
def _sem_token_guardado():
    growthhs.limpar_tokens()
    yield
    growthhs.limpar_tokens()


class Api:
    """GrowthHS falso: `rotas[(método, caminho)]` é uma lista de respostas
    (consumidas em ordem; a última se repete) ou uma função(request)."""

    def __init__(self, rotas: dict):
        self.rotas = {k: (list(v) if isinstance(v, list) else v) for k, v in rotas.items()}
        self.pedidos: list[httpx.Request] = []
        self.rotas.setdefault(("POST", "/api/v1/auth/client-credentials"),
                              [httpx.Response(200, json={"access_token": "tok-1",
                                                         "expires_in": 28800})])

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.pedidos.append(request)
        rota = self.rotas.get((request.method, request.url.path))
        if rota is None:
            return httpx.Response(599, json={"detail": f"rota não prevista {request.url}"})
        if callable(rota):
            return rota(request)
        return rota.pop(0) if len(rota) > 1 else rota[0]

    def transporte(self):
        return httpx.MockTransport(self)

    def de(self, metodo, caminho):
        return [p for p in self.pedidos if p.method == metodo and p.url.path == caminho]


TOKEN = ("POST", "/api/v1/auth/client-credentials")


def _corpo(pedido):
    return json.loads(pedido.content)


def _params(pedido):
    return {k: v[0] for k, v in parse_qs(urlsplit(str(pedido.url)).query).items()}


# ── Faixas da origem (inalteradas) ───────────────────────────────────────────

@pytest.mark.parametrize("entrada, saida", [
    ("Até R$ 100 mil", "Ate 100k/mes"),
    ("Entre R$ 100 mil e R$ 500 mil", "Entre 100k e 500k/mes"),
    ("Entre 500 mil e 1 milhão", "Entre 500k e 1MM/mes"),
    ("Entre 1 milhão e 3 milhões", "Entre 1MM e 3MM/mes"),
    ("Entre 3 milhões e 5 milhões", "Entre 3MM e 5MM/mes"),
    ("Acima de 5 milhões", "Acima de 5MM/mes"),
    ("não sei", None), (None, None),
])
def test_faturamento_nas_faixas_da_origem(entrada, saida):
    assert normalizar_faturamento(entrada) == saida


@pytest.mark.parametrize("entrada, saida", [
    ("Individual", "Eu S.A."), ("1-10", "1-10 funcionarios"), ("2 - 10", "1-10 funcionarios"),
    ("11-50", "11-50 funcionarios"), ("26-49", "11-50 funcionarios"),
    ("51-200", "51-200 funcionarios"), ("acima de 50", "51-200 funcionarios"),
    ("mais de 200", "+200 funcionarios"), ("", None), (None, None),
])
def test_funcionarios_nas_faixas_da_origem(entrada, saida):
    assert normalizar_funcionarios(entrada) == saida


def test_configurado_e_link_do_card():
    assert CFG.configurado
    assert CFG.url_do_card(4821) == "https://app.growthhs.exemplo.invalid/cards/4821"


# ── Token ────────────────────────────────────────────────────────────────────

async def test_token_e_reusado_e_renovado_no_401():
    # Duas chamadas → um client-credentials só.
    api = Api({("GET", "/api/v1/cards/1"): [httpx.Response(200, json={"id": 1})]})
    async with Cliente(CFG, transporte=api.transporte()) as cli:
        await cli.ler_card(1)
        await cli.ler_card(1)
    assert len(api.de(*TOKEN)) == 1
    assert api.de("GET", "/api/v1/cards/1")[0].headers["authorization"] == "Bearer tok-1"

    # O token guardado é reusado por um Cliente NOVO (cache de módulo).
    async with Cliente(CFG, transporte=api.transporte()) as cli:
        await cli.ler_card(1)
    assert len(api.de(*TOKEN)) == 1

    # A API responde 401 uma vez → token novo e repete.
    growthhs.limpar_tokens()
    api = Api({TOKEN: [httpx.Response(200, json={"access_token": "tok-1", "expires_in": 28800}),
                       httpx.Response(200, json={"access_token": "tok-2", "expires_in": 28800})],
               ("GET", "/api/v1/cards/1"): [httpx.Response(401, json={"detail": "expirado"}),
                                            httpx.Response(200, json={"id": 1})]})
    async with Cliente(CFG, transporte=api.transporte()) as cli:
        assert await cli.ler_card(1) == {"id": 1}
    leituras = api.de("GET", "/api/v1/cards/1")
    assert len(api.de(*TOKEN)) == 2 and len(leituras) == 2
    assert leituras[1].headers["authorization"] == "Bearer tok-2"

    # Dois 401 seguidos → definitivo, status 401, sem terceira tentativa.
    growthhs.limpar_tokens()
    api = Api({("GET", "/api/v1/cards/1"): [httpx.Response(401, json={"detail": "x"})]})
    async with Cliente(CFG, transporte=api.transporte()) as cli:
        with pytest.raises(ErroDefinitivo) as erro:
            await cli.ler_card(1)
    assert erro.value.status == 401
    assert len(api.de("GET", "/api/v1/cards/1")) == 2


async def test_token_expirado_e_pedido_de_novo(monkeypatch):
    """`expires_in` com folga de 5 min: 400 s de validade = 100 s úteis."""
    agora = [1000.0]
    monkeypatch.setattr(growthhs.time, "monotonic", lambda: agora[0])
    api = Api({TOKEN: [httpx.Response(200, json={"access_token": "tok-1", "expires_in": 400})],
               ("GET", "/api/v1/cards/1"): [httpx.Response(200, json={"id": 1})]})
    async with Cliente(CFG, transporte=api.transporte()) as cli:
        await cli.ler_card(1)
        agora[0] += 99
        await cli.ler_card(1)
        assert len(api.de(*TOKEN)) == 1
        agora[0] += 2
        await cli.ler_card(1)
    assert len(api.de(*TOKEN)) == 2


async def test_client_credentials_401_e_definitivo():
    api = Api({TOKEN: [httpx.Response(401, json={"detail": "client inválido"})]})
    async with Cliente(CFG, transporte=api.transporte()) as cli:
        with pytest.raises(ErroDefinitivo) as erro:
            await cli.ler_card(1)
    assert erro.value.status == 401
    assert len(api.de(*TOKEN)) == 1          # não se re-tenta credencial errada
    assert api.de("GET", "/api/v1/cards/1") == []


async def test_client_credentials_manda_grant_type():
    api = Api({("GET", "/api/v1/cards/1"): [httpx.Response(200, json={"id": 1})]})
    async with Cliente(CFG, transporte=api.transporte()) as cli:
        await cli.ler_card(1)
    pedido = api.de(*TOKEN)[0]
    assert str(pedido.url) == BASE + "/api/v1/auth/client-credentials"
    assert _corpo(pedido) == {"client_id": "hsg_teste", "client_secret": "segredo-teste",
                              "grant_type": "client_credentials"}


async def test_testar_so_chama_client_credentials():
    api = Api({})
    assert await growthhs.testar(CFG, transporte=api.transporte()) is None
    assert [(p.method, p.url.path) for p in api.pedidos] == [TOKEN]
    # Testar sempre confere de verdade — não serve de token guardado.
    await growthhs.testar(CFG, transporte=api.transporte())
    assert len(api.de(*TOKEN)) == 2
    api = Api({TOKEN: [httpx.Response(401, json={"detail": "x"})]})
    with pytest.raises(ErroDefinitivo) as erro:
        await growthhs.testar(CFG, transporte=api.transporte())
    assert erro.value.status == 401
    api = Api({TOKEN: [httpx.Response(503)]})
    with pytest.raises(ErroTransitorio):
        await growthhs.testar(CFG, transporte=api.transporte())


# ── Pessoa ───────────────────────────────────────────────────────────────────

PESSOAS = ("GET", "/api/v1/persons")
CRIAR_PESSOA = ("POST", "/api/v1/persons")


async def test_pessoa_casa_email_exato():
    lead = {**LEAD, "email": "ana@x.com"}
    api = Api({PESSOAS: [httpx.Response(200, json={"persons": [
        {"id": 1, "email": "joana@x.com"},
        {"id": 2, "email": None, "email_commercial": "ANA@x.com"}]})]})
    async with Cliente(CFG, transporte=api.transporte()) as cli:
        assert await cli.achar_ou_criar_pessoa(lead) == 2
    assert api.de(*CRIAR_PESSOA) == []
    assert _params(api.de(*PESSOAS)[0]) == {"search": "ana@x.com", "page_size": "100"}


@pytest.mark.parametrize("campo", ["email", "email_commercial", "email_personal",
                                   "email_alternative"])
async def test_pessoa_casa_nos_quatro_campos(campo):
    api = Api({PESSOAS: [httpx.Response(200, json={"persons": [
        {"id": 9, campo: " Carla@Transportadora.com.br "}]})]})
    async with Cliente(CFG, transporte=api.transporte()) as cli:
        assert await cli.achar_ou_criar_pessoa({**LEAD, "email": "CARLA@transportadora.com.br"}) == 9


async def test_pessoa_nao_achada_e_criada_com_e164():
    api = Api({PESSOAS: [httpx.Response(200, json={"persons": [
                   {"id": 1, "email": "outra-carla@transportadora.com.br"}]})],
               CRIAR_PESSOA: [httpx.Response(201, json={"id": 1180})]})
    async with Cliente(CFG, transporte=api.transporte()) as cli:
        assert await cli.achar_ou_criar_pessoa(LEAD) == 1180
    assert _corpo(api.de(*CRIAR_PESSOA)[0]) == {
        "name": "Carla Menezes", "email": "carla@transportadora.com.br",
        "phone": "+5581999999999", "phone_whatsapp": "+5581999999999",
        "position": "Gerente de SESMT"}


async def test_pessoa_corta_nome_e_telefone():
    lead = {**LEAD, "nome": "N" * 300, "phone_normalized": "+55" + "9" * 80, "cargo": None}
    api = Api({PESSOAS: [httpx.Response(200, json={"persons": []})],
               CRIAR_PESSOA: [httpx.Response(201, json={"id": 5})]})
    async with Cliente(CFG, transporte=api.transporte()) as cli:
        await cli.achar_ou_criar_pessoa(lead)
    corpo = _corpo(api.de(*CRIAR_PESSOA)[0])
    assert len(corpo["name"]) == 200 and len(corpo["phone"]) == 50
    assert corpo["phone_whatsapp"] == corpo["phone"] and "position" not in corpo


async def test_pessoa_corrida_400_busca_de_novo():
    api = Api({PESSOAS: [httpx.Response(200, json={"persons": []}),
                         httpx.Response(200, json={"persons": [
                             {"id": 77, "email": "carla@transportadora.com.br"}]})],
               CRIAR_PESSOA: [httpx.Response(400, json={"detail": "e-mail já existe"})]})
    async with Cliente(CFG, transporte=api.transporte()) as cli:
        assert await cli.achar_ou_criar_pessoa(LEAD) == 77
    assert len(api.de(*PESSOAS)) == 2 and len(api.de(*CRIAR_PESSOA)) == 1

    # 400 e a segunda busca também não acha → definitivo 400.
    api = Api({PESSOAS: [httpx.Response(200, json={"persons": []})],
               CRIAR_PESSOA: [httpx.Response(400, json={"detail": "x"})]})
    async with Cliente(CFG, transporte=api.transporte()) as cli:
        with pytest.raises(ErroDefinitivo) as erro:
            await cli.achar_ou_criar_pessoa(LEAD)
    assert erro.value.status == 400


async def test_pessoa_sem_email_cria_sem_buscar():
    """Segurança (coordenadora, 22/10): casar pelo telefone poria o
    formulário de um no card de outro (telefone sem unicidade lá). Sem
    e-mail, nem busca: pessoa nova."""
    lead = {**LEAD, "email": None}
    api = Api({PESSOAS: [httpx.Response(200, json={"persons": [
                   {"id": 4, "phone": "+5581999999999"}]})],
               CRIAR_PESSOA: [httpx.Response(201, json={"id": 1181})]})
    async with Cliente(CFG, transporte=api.transporte()) as cli:
        assert await cli.achar_ou_criar_pessoa(lead) == 1181
    assert api.de(*PESSOAS) == []
    corpo = _corpo(api.de(*CRIAR_PESSOA)[0])
    assert "email" not in corpo and corpo["phone"] == "+5581999999999"


async def test_pessoa_sem_email_nem_telefone_e_422_sem_rede():
    api = Api({})
    async with Cliente(CFG, transporte=api.transporte()) as cli:
        with pytest.raises(ErroDefinitivo) as erro:
            await cli.achar_ou_criar_pessoa({**LEAD, "email": " ", "phone_normalized": None})
    assert erro.value.status == 422
    assert api.pedidos == []


# ── Cards ────────────────────────────────────────────────────────────────────

async def test_cards_da_pessoa_nos_boards_conferidos():
    def listar(request):
        board = _params(request)["board_id"]
        return httpx.Response(200, json={"cards": [{"id": int(board) * 100}],
                                         "total": 1, "page": 1, "total_pages": 1})
    api = Api({("GET", "/api/v1/cards"): listar})
    async with Cliente(CFG, transporte=api.transporte()) as cli:
        cards = await cli.cards_da_pessoa(1180)
    assert [c["id"] for c in cards] == [600, 700]
    pedidos = api.de("GET", "/api/v1/cards")
    assert len(pedidos) == 2
    for pedido, board in zip(pedidos, ("6", "7")):
        params = _params(pedido)
        assert (params["board_id"], params["person_id"], params["page_size"]) == (
            board, "1180", "100")


async def test_criar_ler_atualizar_e_anotar():
    api = Api({("POST", "/api/v1/cards"): [httpx.Response(201, json={"id": 4821})],
               ("GET", "/api/v1/cards/4821"): [httpx.Response(200, json={
                   "id": 4821, "description": "antes"})],
               ("PUT", "/api/v1/cards/4821"): [httpx.Response(200, json={"id": 4821})],
               ("POST", "/api/v1/card-notes"): [httpx.Response(201, json={"id": 1})]})
    async with Cliente(CFG, transporte=api.transporte()) as cli:
        assert await cli.criar_card({"list_id": 22, "title": "x"}) == {"id": 4821}
        assert (await cli.ler_card(4821))["description"] == "antes"
        assert await cli.atualizar_descricao(4821, "antes\n\nbloco") is None
        assert await cli.anotar(4821, "aviso") is None
        await cli.anotar(4821, "aviso\nVer no MarketingHS: https://golpe.invalid")
    assert _corpo(api.de("POST", "/api/v1/cards")[0]) == {"list_id": 22, "title": "x"}
    assert _corpo(api.de("PUT", "/api/v1/cards/4821")[0]) == {"description": "antes\n\nbloco"}
    notas = api.de("POST", "/api/v1/card-notes")
    assert _corpo(notas[0]) == {"card_id": 4821, "content": "aviso"}
    assert _corpo(notas[1])["content"] == "aviso Ver no MarketingHS: https://golpe.invalid"


@pytest.mark.parametrize("codigo", [200, 201, 202, 204, 299])
async def test_todo_2xx_e_sucesso(codigo):
    """Revisão final do 8D, M1: um 2xx fora de 200/201 já criou o card — tratá-
    lo como erro re-enviaria e criaria o SEGUNDO. Corpo vazio (204) vira {}."""
    resposta = httpx.Response(204) if codigo == 204 else httpx.Response(codigo, json={"id": 7})
    api = Api({("POST", "/api/v1/cards"): [resposta]})
    async with Cliente(CFG, transporte=api.transporte()) as cli:
        devolvido = await cli.criar_card({"title": "x"})
    assert devolvido == ({} if codigo == 204 else {"id": 7})


@pytest.mark.parametrize("resposta", [httpx.Response(201, content=b"<html>"),
                                      httpx.Response(201, json=[1, 2])])
async def test_2xx_com_corpo_torto_vira_vazio(resposta):
    api = Api({("POST", "/api/v1/cards"): [resposta]})
    async with Cliente(CFG, transporte=api.transporte()) as cli:
        assert await cli.criar_card({"title": "x"}) == {}


@pytest.mark.parametrize("codigo, erro", [(403, ErroDefinitivo), (404, ErroDefinitivo),
                                          (422, ErroDefinitivo), (429, ErroTransitorio),
                                          (500, ErroTransitorio), (503, ErroTransitorio)])
async def test_classifica_erros(codigo, erro):
    api = Api({("POST", "/api/v1/cards"): [httpx.Response(codigo, json={"detail": "x"})],
               ("GET", "/api/v1/cards/1"): [httpx.Response(codigo, json={"detail": "x"})]})
    async with Cliente(CFG, transporte=api.transporte()) as cli:
        with pytest.raises(erro) as e1:
            await cli.criar_card({"title": "x"})
        with pytest.raises(erro):
            await cli.ler_card(1)
    if erro is ErroDefinitivo:
        assert e1.value.status == codigo


async def test_401_depois_do_retry_e_definitivo_com_status():
    api = Api({("POST", "/api/v1/cards"): [httpx.Response(401, json={"detail": "x"})]})
    async with Cliente(CFG, transporte=api.transporte()) as cli:
        with pytest.raises(ErroDefinitivo) as erro:
            await cli.criar_card({"title": "x"})
    assert erro.value.status == 401


async def test_sem_resposta_e_transitorio():
    def cair(request):
        raise httpx.ConnectError("fora do ar")
    async with Cliente(CFG, transporte=httpx.MockTransport(cair)) as cli:
        with pytest.raises(ErroTransitorio):
            await cli.criar_card({"title": "x"})
    with pytest.raises(ErroTransitorio):
        await growthhs.testar(CFG, transporte=httpx.MockTransport(cair))


# ── Puros: data, origem, descrição, card, bloco ─────────────────────────────

def test_criado_em_utc():
    treze = datetime(2026, 10, 22, 13, 0, tzinfo=timezone.utc)
    assert criado_em_utc({"created_at": "2026-10-22T13:00:00"}) == treze
    assert criado_em_utc({"created_at": "2026-10-22T10:00:00-03:00"}) == treze
    assert criado_em_utc({"created_at": "2026-10-22T13:00:00Z"}) == treze
    assert criado_em_utc({}) is None
    assert criado_em_utc({"created_at": None}) is None
    assert criado_em_utc({"created_at": "não é data"}) is None


def test_origem():
    assert origem_do_card_texto(CONVERSAO) == "Landing Page phoebus-prova"
    assert origem_do_card_texto({"page_slug": None, "form_id": "PHOEBUS"}) == \
        "Captura pelo site [PHOEBUS]"
    assert origem_do_card_texto(None) == "MarketingHS"
    assert origem_do_card_texto({"page_slug": None, "form_id": None}) == "MarketingHS"
    longa = origem_do_card_texto({"page_slug": "s" * 300})
    assert len(longa) == 200 and longa.startswith("Landing Page sss")


def test_descricao_e_card():
    card = montar_card(LEAD, CFG, conversao=CONVERSAO, consentimento=CONSENTIMENTO,
                       person_id=1180, frontend_url=FRONT + "/", pedido_id=7)
    assert card["title"] == "Carla Menezes — Transportadora XYZ"
    assert card["list_id"] == 22 and card["person_id"] == 1180
    assert card["origin"] == "Landing Page phoebus-prova"
    assert card["acquisition_channel"] == "Inbound"
    assert card["utm_params"] == "utm_source=google&utm_medium=cpc&utm_campaign=black-friday"
    assert (card["utm_source"], card["utm_campaign"], card["utm_term"]) == (
        "google", "black-friday", None)
    assert card["gclid"] == "gclid-abc"
    for chave in ("source", "external_id", "contact", "client_id", "board_id",
                  "business_info", "custom_fields", "conversion", "consent"):
        assert chave not in card
    linhas = card["description"].split("\n")
    for esperada in ("Empresa: Transportadora XYZ", "Cargo: Gerente de SESMT",
                     "Faturamento: Entre 100k e 500k/mes",
                     "Funcionários: 11-50 funcionarios", "Lead score: 60",
                     "Etiqueta: hotlead", "Campanha: black-friday",
                     "Desafios: controle de jornada", "Respostas do formulário:",
                     "- ja_faz_testagem: sim", "Pedido MarketingHS: 7",
                     f"Ver no MarketingHS: {FRONT}/contacts?contato={LEAD['id']}"):
        assert esperada in linhas, esperada
    assert linhas[-1].startswith("Ver no MarketingHS: ")
    texto = card["description"]
    # A última conversão e o consentimento, com data no fuso de São Paulo.
    assert "phoebus-prova" in texto and "pago" in texto
    assert "https://lp.exemplo.invalid/phoebus-prova" in texto
    assert "21/10/2026 10:00" in texto
    assert "consentimento" in texto and "provisoria-2026-10" in texto
    # A ordem da spec §2.
    ordem = ["Empresa:", "Cargo:", "Faturamento:", "Funcionários:", "Lead score:",
             "Etiqueta:", "Campanha:", "Desafios:", "Respostas do formulário:",
             "- ja_faz_testagem:", "Conversão:", "Base legal:", "Pedido MarketingHS:",
             "Ver no MarketingHS:"]
    posicoes = [next(i for i, l in enumerate(linhas) if l.startswith(p)) for p in ordem]
    assert posicoes == sorted(posicoes)

    minimo = montar_card({"id": LEAD["id"], "email": "a@x.com"}, CFG, person_id=1,
                         frontend_url=FRONT, pedido_id=1)
    assert minimo["title"] == "a@x.com" and minimo["origin"] == "MarketingHS"
    assert minimo["utm_params"] is None and minimo["gclid"] is None
    assert "—" not in minimo["description"]
    assert all(not l.rstrip().endswith(":") for l in minimo["description"].split("\n"))
    assert minimo["description"] == (
        f"Pedido MarketingHS: 1\nVer no MarketingHS: {FRONT}/contacts?contato={LEAD['id']}")


def test_card_corta_campos_longos():
    lead = {**LEAD, "nome": "N" * 400, "empresa": "E" * 400, "utm_source": "s" * 300,
            "utm_campaign": "c" * 300, "utm_term": "t" * 300, "utm_medium": "m" * 300,
            "desafios": "d" * 900}
    card = montar_card(lead, CFG, conversao={**CONVERSAO, "gclid": "g" * 900},
                       person_id=1, frontend_url=FRONT, pedido_id=1)
    assert len(card["title"]) == 500
    assert len(card["utm_source"]) == len(card["utm_campaign"]) == len(card["utm_term"]) == 200
    assert len(card["utm_params"]) <= 500 and len(card["gclid"]) == 500
    desafios = next(l for l in card["description"].split("\n") if l.startswith("Desafios: "))
    assert len(desafios) == len("Desafios: ") + 500


def test_descricao_formulario_de_site():
    conversao = {"page_slug": None, "form_id": "contato", "site_nome": "Site institucional",
                 "page_url": "https://www.exemplo.invalid/contato",
                 "converted_at": "2026-10-21T13:00:00Z", "canal": "organico"}
    texto = montar_descricao({"id": "x"}, conversao=conversao, consentimento=None,
                             frontend_url=FRONT)
    assert "contato" in texto and "Site institucional" in texto
    assert "https://www.exemplo.invalid/contato" in texto and "organico" in texto


def test_bloco_de_atualizacao():
    quando = datetime(2026, 10, 22, 13, 0, tzinfo=timezone.utc)
    bloco = bloco_de_atualizacao(LEAD, conversao=CONVERSAO, consentimento=CONSENTIMENTO,
                                 frontend_url=FRONT, pedido_id=7, quando=quando)
    assert bloco.startswith("\n\n— Nova conversão pelo MarketingHS em 22/10/2026 10:00 "
                            "(pedido 7) (dados informados no formulário, não verificados) —\n")
    # O bloco não assina o card: só o card criado leva "Pedido MarketingHS".
    assert "Pedido MarketingHS" not in bloco
    assert marca_do_pedido(7) == "(pedido 7)" and marca_do_pedido(7) in bloco
    assert bloco.endswith(montar_descricao(LEAD, conversao=CONVERSAO,
                                           consentimento=CONSENTIMENTO,
                                           frontend_url=FRONT))


def test_card_do_pedido_so_pela_linha_exata():
    """Reconhecer um card como "nosso" marca entregue sem entregar: só a
    linha exata conta, e `7` não casa `71`."""
    card = montar_card(LEAD, CFG, person_id=1, frontend_url=FRONT, pedido_id=7)
    assert growthhs.card_do_pedido(card["description"], 7)
    assert not growthhs.card_do_pedido(card["description"], 71)
    assert not growthhs.card_do_pedido(
        montar_card(LEAD, CFG, person_id=1, frontend_url=FRONT, pedido_id=71)["description"], 7)
    assert not growthhs.card_do_pedido("- obs: Pedido MarketingHS: 7", 7)
    assert not growthhs.card_do_pedido("Empresa: Pedido MarketingHS: 7", 7)
    assert not growthhs.card_do_pedido(None, 7)


# ── Segurança: o formulário não forja linha na descrição ────────────────────

QUEBRAS = ["\n", "\r\n", "\r", "\u2028", "\u2029", "\u0085", "\x0b", "\x00"]
GOLPE = "Lead score: 100{q}Ver no MarketingHS: https://golpe.invalid"


@pytest.mark.parametrize("q", QUEBRAS)
def test_valor_do_formulario_vira_uma_linha_so(q):
    """Achado da coordenadora (22/10): nome, empresa, cargo, desafios,
    campos_extras (chave e valor), página, site… vêm do formulário público.
    Um `\n` num deles forjaria uma linha "Ver no MarketingHS: <golpe>" no card
    que o vendedor lê como nossa."""
    sujo = "x" + q + GOLPE.format(q=q)
    lead = {**LEAD, "nome": "Carla" + q + "Menezes", "empresa": "XYZ" + q + "SA",
            "cargo": sujo, "desafios": sujo, "indicacao": sujo, "etiqueta": sujo,
            "campos_extras": {"pergunta" + q + "Ver no MarketingHS": sujo,
                              "outra": "a" + q + "  " + q + "b"}}
    conversao = {**CONVERSAO, "page_slug": "lp" + q + "x", "site_nome": sujo,
                 "page_url": sujo, "canal": sujo}
    consentimento = {**CONSENTIMENTO, "versao": sujo, "base_legal": sujo}
    card = montar_card(lead, CFG, conversao=conversao, consentimento=consentimento,
                       person_id=1, frontend_url=FRONT, pedido_id=7)
    linhas = card["description"].split("\n")
    assert all(q not in l for l in linhas)
    assert all(not any(c in l for c in "\r\u2028\u2029\u0085\x0b\x00") for l in linhas)
    nossas = [l for l in linhas if l.startswith("Ver no MarketingHS")]
    assert nossas == [f"Ver no MarketingHS: {FRONT}/contacts?contato={LEAD['id']}"]
    assert not any(l.startswith("Lead score: 100") for l in linhas)
    assert "- pergunta Ver no MarketingHS: x " + GOLPE.format(q=" ") in linhas
    assert "- outra: a b" in linhas
    assert card["title"] == "Carla Menezes — XYZ SA"
    assert "\n" not in card["origin"] and card["origin"] == "Landing Page lp x"
    quando = datetime(2026, 10, 22, 13, 0, tzinfo=timezone.utc)
    bloco = bloco_de_atualizacao(lead, conversao=conversao, consentimento=consentimento,
                                 frontend_url=FRONT, pedido_id=7, quando=quando)
    assert [l for l in bloco.split("\n") if l.startswith("— Nova conversão pelo")] == [
        "— Nova conversão pelo MarketingHS em 22/10/2026 10:00 (pedido 7) "
        "(dados informados no formulário, não verificados) —"]
    # A assinatura do card criado também não se forja pelo formulário.
    assert [l for l in linhas if l.startswith("Pedido MarketingHS")] == ["Pedido MarketingHS: 7"]
    assert [l for l in bloco.split("\n") if l.startswith("Ver no MarketingHS")] == nossas


def test_respostas_do_formulario_em_bloco_proprio_e_rotulo_cortado():
    lead = {"id": "x", "campos_extras": {"k" * 100: "v" * 900, "vazio": "  ", "": "sem chave"}}
    linhas = montar_descricao(lead, conversao=CONVERSAO, consentimento=CONSENTIMENTO,
                              frontend_url=FRONT).split("\n")
    i = linhas.index("Respostas do formulário:")
    assert linhas[i + 1] == "- " + "k" * 60 + ": " + "v" * 500
    assert linhas[i + 2].startswith("Conversão: ")     # vazio e sem chave não entram
    assert i < linhas.index("Base legal: consentimento")
    # Sem resposta nenhuma, sem cabeçalho de bloco.
    sem = montar_descricao({"id": "x", "campos_extras": {"a": None}}, conversao=None,
                           consentimento=None, frontend_url=FRONT)
    assert "Respostas do formulário:" not in sem


async def test_pessoa_criada_sem_quebra_de_linha():
    lead = {**LEAD, "nome": "Carla\nMenezes", "cargo": "Gerente\r\nSESMT"}
    api = Api({PESSOAS: [httpx.Response(200, json={"persons": []})],
               CRIAR_PESSOA: [httpx.Response(201, json={"id": 5})]})
    async with Cliente(CFG, transporte=api.transporte()) as cli:
        await cli.achar_ou_criar_pessoa(lead)
    corpo = _corpo(api.de(*CRIAR_PESSOA)[0])
    assert corpo["name"] == "Carla Menezes" and corpo["position"] == "Gerente SESMT"


# ── Texto do erro: nunca o corpo cru (achado de segurança, 22/10) ───────────
# O `base_url` é escolhido pelo admin e pode ser qualquer endereço interno: o
# corpo de lá nunca vira texto de erro (que vai para o "Testar" e para
# `crm_handoffs.erro`). Só status + mensagem da faixa + `detail` JSON.

@pytest.mark.parametrize("resposta,esperado", [
    (httpx.Response(404, html="<html>segredo-interno</html>"),
     "404: endereço não parece a API do GrowthHS"),
    (httpx.Response(500, text="token=abc"), "500: GrowthHS fora do ar ou ocupado"),
    (httpx.Response(429, text="token=abc"), "429: GrowthHS fora do ar ou ocupado"),
    (httpx.Response(403, json={"erro": "segredo-interno"}),
     "403: o usuário de integração não tem permissão"),
    (httpx.Response(409, json=["segredo-interno"]), "409: o GrowthHS recusou o pedido"),
    (httpx.Response(400, json={"detail": [{"msg": "segredo-interno"}]}),
     "400: o GrowthHS recusou o pedido"),
    (httpx.Response(422, json={"detail": "E-mail\ninválido " + "x" * 300}),
     "422: o GrowthHS recusou os dados do contato — E-mail inválido " + "x" * 184),
])
def test_texto_do_erro_sem_corpo(resposta, esperado):
    assert growthhs.texto_do_erro(resposta) == esperado


@pytest.mark.parametrize("codigo", [308, 405, 400, 422, 401])
async def test_erro_do_token_e_sempre_de_configuracao(codigo):
    """I1 da revisão final: o pedido de token não depende do lead — todo erro
    definitivo dele é configuração (a entrega pausa). O mesmo status numa
    chamada de dado (aqui, `ler_card`) NÃO é."""
    api = Api({TOKEN: [httpx.Response(codigo, json={"detail": "x"})]})
    async with Cliente(CFG, transporte=api.transporte()) as cli:
        with pytest.raises(ErroDefinitivo) as erro:
            await cli.ler_card(1)
    assert erro.value.status == codigo and erro.value.de_configuracao is True

    api = Api({("GET", "/api/v1/cards/1"): [httpx.Response(400, json={"detail": "x"})]})
    growthhs.limpar_tokens()
    async with Cliente(CFG, transporte=api.transporte()) as cli:
        with pytest.raises(ErroDefinitivo) as erro:
            await cli.ler_card(1)
    assert erro.value.status == 400 and erro.value.de_configuracao is False


async def test_url_invalida_e_erro_de_configuracao_sem_a_url():
    cfg = Config(base_url="https://growthhs.exemplo.invalid:porta", client_id="hsg",
                 client_secret="segredo-teste", list_id=22, boards_conferidos=(6,),
                 app_url=None)
    async with Cliente(cfg, transporte=Api({}).transporte()) as cli:
        with pytest.raises(ErroDefinitivo) as erro:
            await cli.ler_card(1)
    assert erro.value.de_configuracao is True and "porta" not in str(erro.value)


def test_texto_do_3xx_diz_para_usar_o_endereco_final():
    assert growthhs.texto_do_erro(httpx.Response(308)) == (
        "308: o endereço redireciona — use o endereço final, com https://")


async def test_sem_resposta_nao_ecoa_o_texto_do_httpx():
    def quebra(request):
        raise httpx.ConnectError(f"falhou {request.url} segredo-interno")

    growthhs.limpar_tokens()
    async with Cliente(CFG, transporte=httpx.MockTransport(quebra)) as cli:
        with pytest.raises(ErroTransitorio) as erro:
            await cli.ler_card(1)
    assert str(erro.value) == "sem resposta do GrowthHS (ConnectError)"


async def test_2xx_que_nao_e_objeto_nao_ecoa_o_corpo():
    api = Api({TOKEN: [httpx.Response(200, text="segredo-interno")]})
    growthhs.limpar_tokens()
    async with Cliente(CFG, transporte=api.transporte()) as cli:
        with pytest.raises(ErroTransitorio) as erro:
            await cli.ler_card(1)
    assert "segredo-interno" not in str(erro.value)
