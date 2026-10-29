"""A fila de entrega ao GrowthHS — pela API normal (pessoa → cards → criar ou
atualizar).

O modo de falhar: o lead "vai para o comercial" e não vai (falha silenciosa),
vira dois cards (entrega repetida, ou retry depois de um 201 que se perdeu),
o card aberto ganha dois blocos "— Nova conversão pelo MarketingHS" (retry
depois de um PUT que se perdeu), ou uma chave errada é re-tentada para sempre.
Nenhum aparece em tela; o vendedor descobre.

Nenhum teste fala com a rede: `GrowthHSFalso` é o GrowthHS inteiro em
memória (pessoas, cards, notas), servido por `httpx.MockTransport`. Os
pedidos são gravados FORA de transação (a entrega abre as próprias sessões),
por isso `somente_lead=` sempre e e-mails `@exemplo.invalid`; `cfg=` sempre
— nenhum teste lê `growthhs_config`.
"""

import asyncio
import itertools
import json
import re
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
import pytest_asyncio

import app.database as db
from app.config import settings
from app.crm import entrega, growthhs
from app.crm.growthhs import Config, bloco_ja_aplicado, marca_de_criacao, marca_do_pedido
from growthhs_falso import (ANTIGO, BOARD_DE_ENTRADA, CARDS, LISTA_DE_ENTRADA, NOTAS,
                            PESSOAS, GrowthHSFalso)
from rodada import EmailDeRodada

# Único por processo (decisão 27: duas suítes ao mesmo tempo) — ver tests/rodada.py.
_EMAIL = EmailDeRodada("entrega-8d", antigo="entrega-8d@exemplo.invalid")
_EMAIL_GEMEO = EmailDeRodada("entrega-8d-gemeo", antigo="entrega-8d-gemeo@exemplo.invalid")
EMAIL, EMAIL_GEMEO = _EMAIL.atual, _EMAIL_GEMEO.atual
CFG = Config(base_url="https://growthhs.exemplo.invalid", client_id="hsg_8d",
             client_secret="segredo-8d", list_id=LISTA_DE_ENTRADA,
             boards_conferidos=(6, 7), app_url="https://app.exemplo.invalid",
             ambiente="homologacao")
# O mesmo GrowthHS falso visto como o OUTRO ambiente (030): troca de ambiente
# entre uma entrega e outra.
CFG_PRODUCAO = Config(**{**CFG.__dict__, "ambiente": "producao"})
ZERO = {"entregues": 0, "atualizadas": 0, "adiadas": 0, "falhas": 0, "pausadas": 0}
CABECALHO = "— Nova conversão pelo MarketingHS"
# Pergunta 79: a nota é em linhas e não fala mais da descrição (que a tela do
# card de lá não mostra); fecha com o link da ficha.
NOTA = re.compile(r"^Lead converteu de novo pelo MarketingHS \(MarketingHS\) em "
                  r"\d{2}/\d{2}/\d{4} \d{2}:\d{2}\.\nVer no MarketingHS: \S+"
                  r"/contacts\?contato=[0-9a-f-]+$")
ABERTURA = re.compile(r"^Lead enviado pelo MarketingHS \(MarketingHS\) em "
                      r"\d{2}/\d{2}/\d{4} \d{2}:\d{2}\.\n")


@pytest_asyncio.fixture(autouse=True)
async def _banco_da_030(request):
    """Enquanto a migration 030 não está no banco de produção, a entrega (que
    grava `crm_handoffs.ambiente` e `ecosystem_identities.growthhs_ambiente`)
    não tem onde gravar. Então, SÓ nesse caso, todo `sessao` deste arquivo —
    o da entrega e o dos fixtures — vira UMA conexão em transação revertida,
    com cópias temporárias das tabelas da 030 (`growthhs_banco.aplicar_030`).
    Uma trava põe as sessões em fila (uma conexão não roda duas consultas ao
    mesmo tempo); ela NÃO é reentrante — `sessao` aberta dentro de outra no
    mesmo task estoura o `timeout` de 60 s. Depois que a 030 for aplicada,
    nada disso roda e o arquivo volta a gravar fora de transação, como antes.

    ⚠️ O gatilho de regras de `leads` grava em `public.crm_handoffs` (com
    schema), não na cópia: teste de regra aqui não veria o pedido do gatilho."""
    import contextlib

    from app import integracoes
    from growthhs_banco import aplicar_030, tem_030

    if "conexao" in request.fixturenames:
        # Já roda em transação revertida própria (e não grava as colunas da
        # 030). ⚠️ Segurar outra conexão aqui travaria o `close_db()` da
        # `conexao`, que espera a pool inteira voltar.
        yield
        return
    await db.init_db()
    async with db._pool.acquire() as sonda:
        if await tem_030(sonda):
            yield
            return
    async with db._pool.acquire() as conn:
        tr = conn.transaction()
        await tr.start()
        await conn.execute("SET LOCAL ROLE service_role")
        await aplicar_030(conn)
        trava = asyncio.Lock()

        @contextlib.asynccontextmanager
        async def falsa(role="anon", user_id=None, **_):
            async with asyncio.timeout(60):
                await trava.acquire()
            try:
                async with conn.transaction():
                    yield conn
            finally:
                trava.release()

        # Um MonkeyPatch próprio: desfazer o do teste aqui desfaria também os
        # patches dos outros fixtures.
        with pytest.MonkeyPatch.context() as mp:
            for modulo in (db, entrega, growthhs, integracoes):
                mp.setattr(modulo, "sessao", falsa)
            try:
                yield
            finally:
                mp.undo()
                await tr.rollback()


@pytest.fixture(autouse=True)
def _sem_token_guardado():
    growthhs.limpar_tokens()
    yield
    growthhs.limpar_tokens()


def _resposta(status):
    return httpx.Response(status, json={"detail": "x"})


@pytest_asyncio.fixture
async def lead_8d():
    """Um lead com identidade, apagado com tudo o que a entrega grava."""
    await db.init_db()

    async def limpar():
        async with db.sessao(role="service_role") as conn:
            ids = [r["id"] for r in await conn.fetch(
                f"SELECT id FROM leads WHERE {_EMAIL.onde(1)}", *_EMAIL.parametros())]
            await conn.execute("DELETE FROM journey_events WHERE lead_id = ANY($1::uuid[])", ids)
            await conn.execute("DELETE FROM contact_events WHERE lead_id = ANY($1::uuid[])", ids)
            await conn.execute("DELETE FROM leads WHERE id = ANY($1::uuid[])", ids)
            await conn.execute(f"DELETE FROM ecosystem_identities WHERE {_EMAIL.onde(1)}",
                               *_EMAIL.parametros())

    await limpar()
    async with db.sessao(role="service_role") as conn:
        dnia = await conn.fetchval(
            "INSERT INTO ecosystem_identities (email) VALUES ($1) RETURNING dnia_id::text", EMAIL)
        lead = await conn.fetchval(
            """INSERT INTO leads (nome, email, tipo, dnia_id, utm_source)
               VALUES ('Entrega 8D', $1, 'teste', $2::uuid, 'google') RETURNING id::text""",
            EMAIL, dnia)
    yield {"lead_id": lead, "dnia_id": dnia}
    await limpar()


@pytest_asyncio.fixture
async def gemeo(lead_8d):
    """Um SEGUNDO lead da mesma pessoa (mesmo `dnia_id`) — o que a fusão de
    contatos produz. Apagado com o que a entrega grava."""
    async def limpar():
        async with db.sessao(role="service_role") as conn:
            ids = [r["id"] for r in await conn.fetch(
                f"SELECT id FROM leads WHERE {_EMAIL_GEMEO.onde(1)}",
                *_EMAIL_GEMEO.parametros())]
            await conn.execute("DELETE FROM journey_events WHERE lead_id = ANY($1::uuid[])", ids)
            await conn.execute("DELETE FROM contact_events WHERE lead_id = ANY($1::uuid[])", ids)
            await conn.execute("DELETE FROM leads WHERE id = ANY($1::uuid[])", ids)
            await conn.execute(f"DELETE FROM ecosystem_identities WHERE {_EMAIL_GEMEO.onde(1)}",
                               *_EMAIL_GEMEO.parametros())

    await limpar()
    async with db.sessao(role="service_role") as conn:
        lead = await conn.fetchval(
            """INSERT INTO leads (nome, email, tipo, dnia_id)
               VALUES ('Entrega 8D gêmeo', $1, 'teste', $2::uuid) RETURNING id::text""",
            EMAIL_GEMEO, lead_8d["dnia_id"])
    yield lead
    await limpar()


NOME_SEM_EMAIL = "Entrega 8D sem e-mail"


@pytest_asyncio.fixture
async def lead_sem_email():
    """Um lead SÓ com telefone (sem identidade), apagado pelo id — e os de
    rodada morta pelo nome, com mais de 2 h (molde de `tests/rodada.py`)."""
    await db.init_db()
    telefone = "+55819" + str(uuid.uuid4().int)[:8]

    async def limpar(ids):
        async with db.sessao(role="service_role") as conn:
            ids = ids + [r["id"] for r in await conn.fetch(
                "SELECT id FROM leads WHERE email IS NULL AND nome = $1 "
                "AND created_at < now() - interval '2 hours'", NOME_SEM_EMAIL)]
            await conn.execute("DELETE FROM journey_events WHERE lead_id = ANY($1::uuid[])", ids)
            await conn.execute("DELETE FROM contact_events WHERE lead_id = ANY($1::uuid[])", ids)
            await conn.execute("DELETE FROM leads WHERE id = ANY($1::uuid[])", ids)

    async with db.sessao(role="service_role") as conn:
        lead = await conn.fetchval(
            """INSERT INTO leads (nome, email, tipo, phone_normalized)
               VALUES ($1, NULL, 'teste', $2) RETURNING id""", NOME_SEM_EMAIL, telefone)
    try:
        yield {"lead_id": str(lead), "telefone": telefone}
    finally:
        await limpar([lead])


async def _enfileirar(lead_id, origem="manual", **kw):
    async with db.sessao(role="service_role") as conn:
        return await entrega.enfileirar(conn, lead_id, origem, **kw)


async def _rodar(lead, api, **kw):
    return await entrega.rodar_entregas(somente_lead=lead, cfg=CFG,
                                        transporte=api.transporte(), **kw)


async def _pedido(lead_id):
    async with db.sessao(role="service_role") as conn:
        return await conn.fetchrow(
            "SELECT * FROM crm_handoffs WHERE lead_id = $1::uuid ORDER BY id DESC LIMIT 1",
            lead_id)


async def _tornar_visivel(pedido_id):
    async with db.sessao(role="service_role") as conn:
        await conn.execute("UPDATE crm_handoffs SET visivel_em = now() WHERE id = $1",
                           pedido_id)


async def _eventos(lead_id, tipo):
    async with db.sessao(role="service_role") as conn:
        return await conn.fetch(
            "SELECT title, metadata FROM contact_events "
            "WHERE lead_id = $1::uuid AND event_type = $2 ORDER BY occurred_at",
            lead_id, tipo)


async def _identidade(dnia_id):
    async with db.sessao(role="service_role") as conn:
        return await conn.fetchrow(
            "SELECT growthhs_card_id, growthhs_person_id FROM ecosystem_identities "
            "WHERE dnia_id = $1::uuid", dnia_id)


def _ingenuo_utc(quando: datetime) -> str:
    """Como o GrowthHS serializa `created_at`: UTC sem fuso."""
    return quando.astimezone(timezone.utc).replace(tzinfo=None).isoformat()


# ── A marca do pedido (puro) ─────────────────────────────────────────────────

def test_marca_so_conta_na_linha_do_cabecalho():
    """Um campo do formulário com "(pedido 7)" não pode suprimir o bloco do
    pedido 7: a marca só conta na linha que COMEÇA com o cabeçalho nosso."""
    bloco = growthhs.bloco_de_atualizacao(
        {"id": "x", "empresa": "Acme"}, conversao=None, consentimento=None,
        frontend_url="https://mkt.exemplo.invalid", pedido_id=7,
        quando=datetime(2026, 10, 22, 13, 0, tzinfo=timezone.utc))
    assert bloco_ja_aplicado("Anotação" + bloco, 7)
    assert not bloco_ja_aplicado("Anotação" + bloco, 71)
    assert not bloco_ja_aplicado("- campo: (pedido 7)\nCargo: (pedido 7)", 7)
    assert not bloco_ja_aplicado(f"Resposta: {CABECALHO} {marca_do_pedido(7)}", 7)
    assert not bloco_ja_aplicado(None, 7)


# ── Fila ─────────────────────────────────────────────────────────────────────

async def test_enfileirar_nao_duplica_pendente(lead_8d):
    primeiro = await _enfileirar(lead_8d["lead_id"], "manual")
    segundo = await _enfileirar(lead_8d["lead_id"], "regra")
    assert primeiro is not None and segundo is None


async def test_sem_configuracao_nao_reivindica_nada(lead_8d):
    await _enfileirar(lead_8d["lead_id"])
    vazio = Config(base_url=None, client_id=None, client_secret=None, list_id=None,
                   boards_conferidos=(), app_url=None)
    assert await entrega.rodar_entregas(cfg=vazio, somente_lead=lead_8d["lead_id"]) == {
        "desligado": True}
    assert (await _pedido(lead_8d["lead_id"]))["status"] == "pendente"


async def test_ciclo_vazio_conta_as_cinco_chaves(lead_8d):
    assert await _rodar(lead_8d["lead_id"], GrowthHSFalso()) == ZERO


# ── Criar ────────────────────────────────────────────────────────────────────

async def test_entrega_cria_pessoa_e_card(lead_8d):
    api = GrowthHSFalso()
    await _enfileirar(lead_8d["lead_id"])
    resultado = await _rodar(lead_8d["lead_id"], api)
    assert resultado == {**ZERO, "entregues": 1}

    [pessoa] = api.pessoas.values()
    assert pessoa["email"] == EMAIL.lower()
    [post] = api.de("POST", CARDS)
    corpo = json.loads(post.content)
    assert corpo["list_id"] == LISTA_DE_ENTRADA and corpo["person_id"] == pessoa["id"]
    assert corpo["acquisition_channel"] == "Inbound" and corpo["origin"] == "MarketingHS"
    pedido_id = (await _pedido(lead_8d["lead_id"]))["id"]
    assert marca_de_criacao(pedido_id) in corpo["description"].split("\n")
    assert (f"Ver no MarketingHS: {settings.FRONTEND_URL.rstrip('/')}"
            f"/contacts?contato={lead_8d['lead_id']}") in corpo["description"]
    [card_id] = api.cards
    assert api.puts() == []
    # Pergunta 79: a nota de abertura é o que o vendedor lê (a tela do card
    # de lá não mostra a descrição). Sem a marca do pedido — engrenagem.
    [nota] = api.notas
    assert nota["card_id"] == card_id and ABERTURA.match(nota["content"]), nota["content"]
    linhas = nota["content"].split("\n")
    assert "UTMs: utm_source=google" in linhas
    assert linhas[-1] == (f"Ver no MarketingHS: {settings.FRONTEND_URL.rstrip('/')}"
                          f"/contacts?contato={lead_8d['lead_id']}")
    assert marca_de_criacao(pedido_id) not in linhas

    pedido = await _pedido(lead_8d["lead_id"])
    assert (pedido["status"], pedido["card_id"], pedido["person_id"]) == (
        "entregue", card_id, pessoa["id"])
    ident = await _identidade(lead_8d["dnia_id"])
    assert (ident["growthhs_card_id"], ident["growthhs_person_id"]) == (card_id, pessoa["id"])
    [evento] = await _eventos(lead_8d["lead_id"], "crm_handoff")
    assert evento["title"] == "Enviado ao comercial (GrowthHS)"
    assert evento["metadata"]["card_id"] == card_id and evento["metadata"]["origem"] == "manual"
    assert "erro_da_nota" not in evento["metadata"]


async def test_pedido_de_contato_do_datacore_falha_sem_chamar_o_growthhs(lead_8d):
    """Pergunta 80: pedido que já estava na fila (criado antes da 033, ou
    contato que passou a ser `datacore`) não é entregue — falha com o motivo
    no pedido e na linha do tempo, e o GrowthHS nem é consultado."""
    api = GrowthHSFalso()
    await _enfileirar(lead_8d["lead_id"])
    async with db.sessao(role="service_role") as conn:
        await conn.execute("UPDATE leads SET source = 'datacore' WHERE id = $1::uuid",
                           lead_8d["lead_id"])
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "falhas": 1}
    assert api.pedidos == []
    pedido = await _pedido(lead_8d["lead_id"])
    assert pedido["status"] == "falhou" and "DataCore" in pedido["erro"]
    [evento] = await _eventos(lead_8d["lead_id"], "crm_handoff_falhou")
    assert "DataCore" in evento["metadata"]["erro"]


async def test_so_cards_ganhos_ou_perdidos_cria_novo(lead_8d):
    api = GrowthHSFalso()
    pessoa = api.pessoa(email=EMAIL)
    api.card(pessoa, is_won=True)
    api.card(pessoa, board=7, is_lost=True)
    await _enfileirar(lead_8d["lead_id"])
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "entregues": 1}
    assert len(api.de("POST", CARDS)) == 1 and api.puts() == [] and len(api.notas) == 1
    assert len(api.de("POST", PESSOAS)) == 0  # a pessoa achada é reusada
    assert (await _pedido(lead_8d["lead_id"]))["person_id"] == pessoa


async def test_mesma_pessoa_em_dois_leads_um_card(lead_8d, gemeo):
    """A fusão de contatos: dois leads, uma pessoa lá (o e-mail do gêmeo é o
    comercial dela). O segundo lead atualiza o card do primeiro."""
    api = GrowthHSFalso()
    pessoa = api.pessoa(email=EMAIL, email_commercial=EMAIL_GEMEO)
    await _enfileirar(lead_8d["lead_id"])
    assert (await _rodar(lead_8d["lead_id"], api))["entregues"] == 1
    [card_id] = api.cards

    await _enfileirar(gemeo, "regra")
    assert await _rodar(gemeo, api) == {**ZERO, "atualizadas": 1}
    # A de abertura (primeiro lead) e a da reconversão (gêmeo).
    assert len(api.de("POST", CARDS)) == 1 and len(api.notas) == 2
    assert NOTA.match(api.notas[1]["content"]), api.notas[1]["content"]
    pedido = await _pedido(gemeo)
    assert (pedido["status"], pedido["card_id"], pedido["person_id"]) == (
        "entregue", card_id, pessoa)


# ── Atualizar + nota ─────────────────────────────────────────────────────────

async def test_pessoa_com_card_aberto_atualiza_e_anota_sem_criar(lead_8d):
    api = GrowthHSFalso()
    pessoa = api.pessoa(email=EMAIL.upper())
    fechado = api.card(pessoa, is_won=True, created_at="2026-09-01T10:00:00")
    aberto = api.card(pessoa, board=7, descricao="Anotação do vendedor")
    pedido_id = await _enfileirar(lead_8d["lead_id"])
    resultado = await _rodar(lead_8d["lead_id"], api)
    assert resultado == {**ZERO, "atualizadas": 1}

    assert api.de("POST", CARDS) == [] and api.de("POST", PESSOAS) == []
    [put] = api.puts()
    assert put.url.path == f"{CARDS}/{aberto}" and set(json.loads(put.content)) == {"description"}
    descricao = api.cards[aberto]["description"]
    assert descricao.startswith(f"Anotação do vendedor\n\n{CABECALHO} em ")
    assert (f"{marca_do_pedido(pedido_id)} (dados informados no formulário, "
            f"não verificados) —\n") in descricao
    assert descricao.count(CABECALHO) == 1
    assert api.cards[fechado]["description"] == ""
    [nota] = api.notas
    assert nota["card_id"] == aberto and NOTA.match(nota["content"]), nota["content"]

    pedido = await _pedido(lead_8d["lead_id"])
    assert (pedido["status"], pedido["card_id"], pedido["person_id"], pedido["erro"]) == (
        "entregue", aberto, pessoa, None)
    ident = await _identidade(lead_8d["dnia_id"])
    assert (ident["growthhs_card_id"], ident["growthhs_person_id"]) == (aberto, pessoa)
    [evento] = await _eventos(lead_8d["lead_id"], "crm_handoff")
    assert evento["title"] == "Card atualizado no comercial (GrowthHS)"
    meta = evento["metadata"]
    assert (meta["card_id"], meta["ja_entregue"], meta["atualizado"]) == (aberto, True, True)


async def test_reconversao_com_dados_diferentes_vai_no_bloco_e_na_nota(lead_8d, monkeypatch):
    """Pergunta 73: o lead reconverteu com outra empresa e outro telefone. O
    contato não muda (R1), mas o vendedor vê o que foi digitado — no bloco
    ("Informou nesta conversão (não verificado)") e na nota. O PUT continua
    só com `description`, só anexando."""
    conversao = {"page_slug": "phoebus-prova", "form_id": None, "site_nome": None,
                 "page_url": None, "converted_at": "2026-10-26T13:00:00Z",
                 "canal": "direto", "gclid": None,
                 "dados_informados": {"nome": "entrega 8d", "empresa": "Empresa Matriz",
                                      "whatsapp": "(11) 99999-0003"}}

    async def origem(_conn, _lead_id):
        return conversao, None

    monkeypatch.setattr(entrega, "origem_do_card", origem)
    api = GrowthHSFalso()
    pessoa = api.pessoa(email=EMAIL)
    aberto = api.card(pessoa, board=7, descricao="Anotação do vendedor")
    await _enfileirar(lead_8d["lead_id"])
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "atualizadas": 1}

    [put] = api.puts()
    assert set(json.loads(put.content)) == {"description"}
    descricao = api.cards[aberto]["description"]
    assert descricao.startswith("Anotação do vendedor\n\n")
    linhas = descricao.split("\n")
    i = linhas.index("Informou nesta conversão (não verificado):")
    assert linhas[i + 1:i + 4] == ["- Empresa: Empresa Matriz",
                                   "- Telefone: (11) 99999-0003",
                                   "Cadastro no MarketingHS:"]
    assert linhas[i - 1].startswith(CABECALHO)
    [nota] = api.notas
    assert nota["content"].split("\n")[1:4] == [
        "Informou nesta conversão (não verificado):",
        "- Empresa: Empresa Matriz", "- Telefone: (11) 99999-0003"]
    assert "Descrição do card" not in nota["content"]


async def test_descricao_no_teto_nao_cresce_mas_anota(lead_8d):
    """Reconversão em série com o e-mail de um cliente não faz a descrição do
    card dele crescer sem fim: passado o teto, só a nota sai."""
    api = GrowthHSFalso()
    pessoa = api.pessoa(email=EMAIL)
    cheia = "x" * entrega.TETO_DA_DESCRICAO
    aberto = api.card(pessoa, board=7, descricao=cheia)
    await _enfileirar(lead_8d["lead_id"])
    resultado = await _rodar(lead_8d["lead_id"], api)
    assert resultado == {**ZERO, "atualizadas": 1}
    assert api.puts() == [] and api.cards[aberto]["description"] == cheia
    [nota] = api.notas
    assert nota["card_id"] == aberto
    assert (await _pedido(lead_8d["lead_id"]))["status"] == "entregue"


async def test_entre_varios_abertos_atualiza_o_mais_recente(lead_8d):
    api = GrowthHSFalso()
    pessoa = api.pessoa(email=EMAIL)
    api.card(pessoa, created_at="2026-03-01T10:00:00")
    recente = api.card(pessoa, board=7, created_at="2026-05-01T10:00:00")
    api.card(pessoa, created_at=None)  # sem data legível: nunca "o nosso", e o último
    api.card(pessoa, created_at="2026-04-01T10:00:00")
    await _enfileirar(lead_8d["lead_id"])
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "atualizadas": 1}
    [put] = api.puts()
    assert put.url.path == f"{CARDS}/{recente}"


async def test_card_aberto_criado_depois_do_pedido_e_o_nosso(lead_8d):
    """O §6 de lá: um card aberto mais novo que o pedido E assinado com
    `Pedido MarketingHS: <id>` é o que uma tentativa anterior DESTE pedido
    criou — marca entregue com ele, sem criar nem atualizar. Anota a nota de
    abertura (pergunta 79): a tentativa que criou o card não chegou nela."""
    api = GrowthHSFalso()
    await _enfileirar(lead_8d["lead_id"])
    criado_em = (await _pedido(lead_8d["lead_id"]))["criado_em"]
    pedido_id = (await _pedido(lead_8d["lead_id"]))["id"]
    pessoa = api.pessoa(email=EMAIL)
    velho = api.card(pessoa)
    nosso = api.card(pessoa, created_at=_ingenuo_utc(criado_em + timedelta(seconds=1)),
                     descricao=f"Empresa: X\n{marca_de_criacao(pedido_id)}\nVer no MarketingHS: y")
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "entregues": 1}
    assert api.de("POST", CARDS) == [] and api.puts() == []
    [nota] = api.notas
    assert nota["card_id"] == nosso and ABERTURA.match(nota["content"]), nota["content"]
    assert api.de("GET", f"{CARDS}/{velho}") == []
    pedido = await _pedido(lead_8d["lead_id"])
    assert (pedido["status"], pedido["card_id"], pedido["person_id"]) == (
        "entregue", nosso, pessoa)
    [evento] = await _eventos(lead_8d["lead_id"], "crm_handoff")
    assert evento["title"] == "Enviado ao comercial (GrowthHS)"
    assert evento["metadata"]["recuperado"] is True and evento["metadata"]["card_id"] == nosso


@pytest.mark.parametrize("descricao", ["Card criado pela automação do RD",
                                       "Pedido MarketingHS: {id}1",
                                       "- obs: Pedido MarketingHS: {id}"])
async def test_card_aberto_novo_sem_a_marca_e_atualizado_nunca_reconhecido(lead_8d, descricao):
    """Revisão (A): só a data reconheceria como "nosso" o card que a
    automação do RD, o vendedor à mão durante uma pausa ou o gêmeo criou —
    e o pedido ficaria entregue sem entregar. Sem a assinatura exata, o card
    novo é atualizado e anotado, como qualquer aberto."""
    api = GrowthHSFalso()
    pedido_id = await _enfileirar(lead_8d["lead_id"])
    criado_em = (await _pedido(lead_8d["lead_id"]))["criado_em"]
    pessoa = api.pessoa(email=EMAIL)
    novo = api.card(pessoa, created_at=_ingenuo_utc(criado_em + timedelta(seconds=1)),
                    descricao=descricao.format(id=pedido_id))
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "atualizadas": 1}
    [put] = api.puts()
    assert put.url.path == f"{CARDS}/{novo}" and len(api.notas) == 1
    assert api.de("POST", CARDS) == []
    [evento] = await _eventos(lead_8d["lead_id"], "crm_handoff")
    assert "recuperado" not in evento["metadata"] and evento["metadata"]["atualizado"] is True


async def test_201_perdido_nao_vira_segundo_card(lead_8d):
    """O caminho inteiro do §6: o POST criou o card e a resposta se perdeu
    (timeout = transitório, adia). Na volta, o card mais novo que o pedido é
    reconhecido — um POST só."""
    api = GrowthHSFalso()
    await _enfileirar(lead_8d["lead_id"])
    pedido = await _pedido(lead_8d["lead_id"])
    api.agora = _ingenuo_utc(pedido["criado_em"] + timedelta(seconds=1))
    api.perder[("POST", CARDS)] = 1
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "adiadas": 1}
    await _tornar_visivel(pedido["id"])
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "entregues": 1}
    assert len(api.de("POST", CARDS)) == 1 and len(api.cards) == 1
    assert (await _pedido(lead_8d["lead_id"]))["card_id"] == next(iter(api.cards))
    # A nota de abertura sai uma vez só, no retry que reconheceu o card.
    [nota] = api.notas
    assert ABERTURA.match(nota["content"])


# ── Nota de abertura do card novo (pergunta 79) ─────────────────────────────

@pytest.mark.parametrize("codigo", [422, 404, 401])
async def test_nota_de_abertura_recusada_entrega_e_registra(lead_8d, codigo):
    """O card JÁ existe: a nota recusada não falha, não pausa, não adia — o
    erro fica no evento. Nem 401/404 pausam: pausar re-tentaria um pedido
    cujo efeito principal já aconteceu."""
    api = GrowthHSFalso()
    api.forcar[("POST", NOTAS)] = [_resposta(codigo)] * 2  # 401 renova o token e repete
    await _enfileirar(lead_8d["lead_id"])
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "entregues": 1}
    pedido = await _pedido(lead_8d["lead_id"])
    assert (pedido["status"], pedido["card_id"]) == ("entregue", next(iter(api.cards)))
    [evento] = await _eventos(lead_8d["lead_id"], "crm_handoff")
    assert evento["metadata"]["erro_da_nota"].startswith(str(codigo))
    assert await _eventos(lead_8d["lead_id"], "crm_handoff_falhou") == []
    assert await _rodar(lead_8d["lead_id"], api) == ZERO
    assert len(api.de("POST", CARDS)) == 1


async def test_nota_de_abertura_transitoria_tenta_de_novo_na_hora(lead_8d):
    api = GrowthHSFalso()
    api.forcar[("POST", NOTAS)] = [_resposta(503)]
    await _enfileirar(lead_8d["lead_id"])
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "entregues": 1}
    assert len(api.de("POST", NOTAS)) == 2 and len(api.notas) == 1
    [evento] = await _eventos(lead_8d["lead_id"], "crm_handoff")
    assert "erro_da_nota" not in evento["metadata"]


async def test_nota_de_abertura_transitoria_de_novo_nao_adia_o_card(lead_8d):
    """Adiar depois do 2xx apostaria o "um card só" no reconhecimento do
    retry (que falha se o vendedor fechar o card no intervalo). Card
    duplicado é pior que nota faltando: entrega e registra."""
    api = GrowthHSFalso()
    api.forcar[("POST", NOTAS)] = [_resposta(503), httpx.ReadTimeout("perdida")]
    await _enfileirar(lead_8d["lead_id"])
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "entregues": 1}
    assert api.notas == []
    pedido = await _pedido(lead_8d["lead_id"])
    assert (pedido["status"], pedido["card_id"]) == ("entregue", next(iter(api.cards)))
    [evento] = await _eventos(lead_8d["lead_id"], "crm_handoff")
    assert "sem resposta" in evento["metadata"]["erro_da_nota"]
    assert await _rodar(lead_8d["lead_id"], api) == ZERO
    assert len(api.de("POST", CARDS)) == 1


async def test_entregue_grava_antes_da_nota_de_abertura(lead_8d, monkeypatch):
    """Parada do worker no meio da nota de abertura: o card já existe e o
    pedido já está `entregue` — nada volta à fila para virar segundo card."""
    original = growthhs.Cliente.anotar
    entrou = asyncio.Event()

    async def lenta(self, *args):
        entrou.set()
        await asyncio.sleep(5)
        await original(self, *args)
    monkeypatch.setattr(growthhs.Cliente, "anotar", lenta)

    api = GrowthHSFalso()
    await _enfileirar(lead_8d["lead_id"])
    tarefa = asyncio.create_task(_rodar(lead_8d["lead_id"], api))
    await asyncio.wait_for(entrou.wait(), timeout=30)
    tarefa.cancel()
    with pytest.raises(asyncio.CancelledError):
        await tarefa
    pedido = await _pedido(lead_8d["lead_id"])
    assert (pedido["status"], pedido["card_id"]) == ("entregue", next(iter(api.cards)))


async def test_reconhecido_no_retry_com_nota_recusada_ainda_entrega(lead_8d):
    api = GrowthHSFalso()
    await _enfileirar(lead_8d["lead_id"])
    pedido = await _pedido(lead_8d["lead_id"])
    api.agora = _ingenuo_utc(pedido["criado_em"] + timedelta(seconds=1))
    api.perder[("POST", CARDS)] = 1
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "adiadas": 1}
    await _tornar_visivel(pedido["id"])
    api.forcar[("POST", NOTAS)] = [_resposta(422)]
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "entregues": 1}
    [evento] = await _eventos(lead_8d["lead_id"], "crm_handoff")
    assert evento["metadata"]["recuperado"] is True
    assert evento["metadata"]["erro_da_nota"].startswith("422")
    assert (await _pedido(lead_8d["lead_id"]))["status"] == "entregue"


async def test_retry_nao_empilha_bloco(lead_8d):
    """Review Focus 1: o PUT deu certo e a resposta se perdeu. O retry acha a
    marca do pedido na descrição, pula o PUT e só anota."""
    api = GrowthHSFalso()
    pessoa = api.pessoa(email=EMAIL)
    aberto = api.card(pessoa, descricao="Anotação do vendedor")
    pedido_id = await _enfileirar(lead_8d["lead_id"])
    api.perder[("PUT", CARDS)] = 1
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "adiadas": 1}
    assert len(api.puts()) == 1 and api.notas == []
    await _tornar_visivel(pedido_id)
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "atualizadas": 1}
    assert len(api.puts()) == 1 and len(api.notas) == 1
    assert api.cards[aberto]["description"].count(CABECALHO) == 1


async def test_marca_num_campo_do_formulario_nao_suprime_o_bloco(lead_8d):
    """Decisão do controlador: "(pedido N)" fora da linha do cabeçalho nosso
    (aqui, uma resposta de formulário de outra entrega) não conta."""
    api = GrowthHSFalso()
    pessoa = api.pessoa(email=EMAIL)
    pedido_id = await _enfileirar(lead_8d["lead_id"])
    aberto = api.card(pessoa, descricao=f"Respostas do formulário:\n"
                                        f"- obs: {marca_do_pedido(pedido_id)}")
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "atualizadas": 1}
    assert len(api.puts()) == 1
    assert api.cards[aberto]["description"].count(CABECALHO) == 1


async def test_nota_transitoria_adia_e_o_retry_so_anota(lead_8d):
    api = GrowthHSFalso()
    pessoa = api.pessoa(email=EMAIL)
    aberto = api.card(pessoa, descricao="Anotação")
    pedido_id = await _enfileirar(lead_8d["lead_id"])
    api.forcar[("POST", NOTAS)] = [_resposta(503)]
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "adiadas": 1}
    pedido = await _pedido(lead_8d["lead_id"])
    assert pedido["status"] == "pendente" and pedido["erro"].startswith("503")
    await _tornar_visivel(pedido_id)
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "atualizadas": 1}
    assert len(api.puts()) == 1 and len(api.notas) == 1
    assert api.cards[aberto]["description"].count(CABECALHO) == 1


async def test_nota_recusada_entrega_e_registra_o_erro(lead_8d):
    """A descrição JÁ foi atualizada: falhar o pedido mentiria. Entrega, e o
    erro da nota fica no evento."""
    api = GrowthHSFalso()
    pessoa = api.pessoa(email=EMAIL)
    aberto = api.card(pessoa, descricao="Anotação")
    await _enfileirar(lead_8d["lead_id"])
    api.forcar[("POST", NOTAS)] = [_resposta(422)]
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "atualizadas": 1}
    pedido = await _pedido(lead_8d["lead_id"])
    assert (pedido["status"], pedido["card_id"]) == ("entregue", aberto)
    [evento] = await _eventos(lead_8d["lead_id"], "crm_handoff")
    assert evento["metadata"]["erro_da_nota"].startswith("422")
    assert await _eventos(lead_8d["lead_id"], "crm_handoff_falhou") == []


async def test_falha_apos_o_put_nao_reatualiza(lead_8d, monkeypatch):
    """I1, no caminho de atualizar: defeito NOSSO depois do PUT e da nota não
    desfaz o `entregue` nem provoca segundo bloco/segunda nota."""
    async def _explode(*args, **kwargs):
        raise RuntimeError("defeito simulado depois do sucesso")
    monkeypatch.setattr(entrega, "_registrar_evento", _explode)
    api = GrowthHSFalso()
    pessoa = api.pessoa(email=EMAIL)
    api.card(pessoa, descricao="Anotação")
    await _enfileirar(lead_8d["lead_id"])
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "atualizadas": 1}
    assert (await _pedido(lead_8d["lead_id"]))["status"] == "entregue"
    assert await _rodar(lead_8d["lead_id"], api) == ZERO
    assert len(api.puts()) == 1 and len(api.notas) == 1


async def test_identidade_ja_gravada_nao_e_sobrescrita(lead_8d):
    """B2: a identidade guarda o PRIMEIRO card/pessoa da pessoa; uma entrega
    que atualiza outro card não troca o que já estava lá."""
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            "UPDATE ecosystem_identities SET growthhs_card_id = 555, growthhs_person_id = 77, "
            "growthhs_ambiente = 'homologacao' "
            "WHERE dnia_id = $1::uuid", lead_8d["dnia_id"])
    api = GrowthHSFalso()
    pessoa = api.pessoa(email=EMAIL)
    aberto = api.card(pessoa, descricao="Anotação")
    await _enfileirar(lead_8d["lead_id"])
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "atualizadas": 1}
    assert (await _pedido(lead_8d["lead_id"]))["card_id"] == aberto
    ident = await _identidade(lead_8d["dnia_id"])
    assert (ident["growthhs_card_id"], ident["growthhs_person_id"]) == (555, 77)


async def test_cancelar_no_atualizar_o_retry_so_anota(lead_8d, monkeypatch):
    """Cancelamento entre o PUT e a nota: o pedido fica pendente; o retry
    acha a marca do bloco, pula o PUT e só anota."""
    original = growthhs.Cliente.anotar
    entrou = asyncio.Event()

    async def lenta(self, *args):
        entrou.set()
        await asyncio.sleep(5)
        await original(self, *args)
    monkeypatch.setattr(growthhs.Cliente, "anotar", lenta)

    api = GrowthHSFalso()
    pessoa = api.pessoa(email=EMAIL)
    aberto = api.card(pessoa, descricao="Anotação")
    pedido_id = await _enfileirar(lead_8d["lead_id"])
    tarefa = asyncio.create_task(_rodar(lead_8d["lead_id"], api))
    await asyncio.wait_for(entrou.wait(), timeout=30)
    tarefa.cancel()
    with pytest.raises(asyncio.CancelledError):
        await tarefa
    assert len(api.puts()) == 1 and api.notas == []
    assert (await _pedido(lead_8d["lead_id"]))["status"] == "pendente"

    monkeypatch.setattr(growthhs.Cliente, "anotar", original)
    await _tornar_visivel(pedido_id)
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "atualizadas": 1}
    assert len(api.puts()) == 1 and len(api.notas) == 1
    assert api.cards[aberto]["description"].count(CABECALHO) == 1


async def test_cancelar_dentro_da_gravacao_do_atualizar_ainda_grava_entregue(lead_8d,
                                                                           monkeypatch):
    """I5 no caminho de atualizar: o PUT e a nota já saíram; o cancelamento
    dentro da gravação blindada não deixa o pedido pendente (seria o
    segundo aviso ao vendedor)."""
    original = entrega._marcar_entregue
    entrou = asyncio.Event()

    async def lento(*args):
        entrou.set()
        await asyncio.sleep(0.3)
        await original(*args)
    monkeypatch.setattr(entrega, "_marcar_entregue", lento)
    api = GrowthHSFalso()
    pessoa = api.pessoa(email=EMAIL)
    aberto = api.card(pessoa, descricao="Anotação")
    await _enfileirar(lead_8d["lead_id"])
    tarefa = asyncio.create_task(_rodar(lead_8d["lead_id"], api))
    await asyncio.wait_for(entrou.wait(), timeout=30)
    tarefa.cancel()
    with pytest.raises(asyncio.CancelledError):
        await tarefa
    prazo = asyncio.get_running_loop().time() + 10
    while True:
        pedido = await _pedido(lead_8d["lead_id"])
        if pedido["status"] == "entregue" or asyncio.get_running_loop().time() > prazo:
            break
        await asyncio.sleep(0.1)
    assert (pedido["status"], pedido["card_id"]) == ("entregue", aberto)
    assert len(api.puts()) == 1 and len(api.notas) == 1


# ── Lead sem e-mail (B1: casamento só por e-mail exato) ─────────────────────

async def test_lead_sem_email_cria_pessoa_e_card_sem_buscar(lead_sem_email):
    """Sem e-mail, nem busca: o telefone lá é texto cru e sem unicidade —
    casar por ele poria o formulário de um no card aberto de outro."""
    api = GrowthHSFalso()
    outra = api.pessoa(phone=lead_sem_email["telefone"])
    api.card(outra, descricao="Card de outra pessoa com o mesmo telefone")
    lead = lead_sem_email["lead_id"]
    await _enfileirar(lead)
    assert await _rodar(lead, api) == {**ZERO, "entregues": 1}
    assert api.de("GET", PESSOAS) == [] and api.puts() == [] and len(api.notas) == 1
    assert len(api.de("POST", PESSOAS)) == 1 and len(api.de("POST", CARDS)) == 1
    nova = max(api.pessoas)
    assert nova != outra
    pedido = await _pedido(lead)
    assert (pedido["status"], pedido["person_id"]) == ("entregue", nova)


async def test_lead_sem_email_retry_reusa_a_pessoa_do_pedido(lead_sem_email):
    """O 201 do card se perdeu: o retry não cria outra pessoa (reusa a que
    ESTE pedido criou, gravada no pedido) e reconhece o card pela
    assinatura."""
    api = GrowthHSFalso()
    lead = lead_sem_email["lead_id"]
    await _enfileirar(lead)
    pedido = await _pedido(lead)
    api.agora = _ingenuo_utc(pedido["criado_em"] + timedelta(seconds=1))
    api.perder[("POST", CARDS)] = 1
    assert await _rodar(lead, api) == {**ZERO, "adiadas": 1}
    [pessoa] = api.pessoas
    assert (await _pedido(lead))["person_id"] == pessoa
    await _tornar_visivel(pedido["id"])
    assert await _rodar(lead, api) == {**ZERO, "entregues": 1}
    assert len(api.de("POST", PESSOAS)) == 1 and len(api.de("POST", CARDS)) == 1
    assert api.puts() == [] and len(api.notas) == 1
    assert (await _pedido(lead))["card_id"] == next(iter(api.cards))


async def test_lead_sem_email_retry_sem_a_marca_cria_nunca_atualiza(lead_sem_email):
    """Na pessoa que este pedido criou apareceu um card aberto que não é
    nosso (vendedor à mão): sem e-mail não se atualiza card nenhum — cria."""
    api = GrowthHSFalso()
    lead = lead_sem_email["lead_id"]
    await _enfileirar(lead)
    pedido = await _pedido(lead)
    api.forcar[("POST", CARDS)] = [_resposta(503)]
    assert await _rodar(lead, api) == {**ZERO, "adiadas": 1}
    [pessoa] = api.pessoas
    do_vendedor = api.card(pessoa, descricao="Card do vendedor",
                           created_at=_ingenuo_utc(pedido["criado_em"] + timedelta(seconds=1)))
    await _tornar_visivel(pedido["id"])
    assert await _rodar(lead, api) == {**ZERO, "entregues": 1}
    assert len(api.de("POST", PESSOAS)) == 1 and api.puts() == [] and len(api.notas) == 1
    assert len(api.cards) == 2
    card_id = (await _pedido(lead))["card_id"]
    assert card_id != do_vendedor and card_id in api.cards


# ── Erros ────────────────────────────────────────────────────────────────────

async def test_erro_definitivo_falha_na_hora_e_aparece(lead_8d):
    """422 é o corpo DAQUELE lead — falha o pedido. (401/403/404 são
    configuração e pausam a fila: ver o teste da pausa.)"""
    api = GrowthHSFalso()
    api.forcar[("POST", CARDS)] = [_resposta(422)]
    await _enfileirar(lead_8d["lead_id"])
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "falhas": 1}
    pedido = await _pedido(lead_8d["lead_id"])
    assert pedido["status"] == "falhou" and pedido["erro"].startswith("422")
    assert len(await _eventos(lead_8d["lead_id"], "crm_handoff_falhou")) == 1


async def test_400_do_growthhs_falha_o_pedido_e_nao_pausa(lead_8d):
    """O e-mail só existe em `email_alternative`: a busca de lá não olha esse
    campo, e o `POST /persons` recusa (400). É o dado DAQUELE lead — falha o
    pedido; pausar travaria a fila inteira por um contato."""
    api = GrowthHSFalso()
    api.pessoa(email="outra@exemplo.invalid", email_alternative=EMAIL)
    await _enfileirar(lead_8d["lead_id"])
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "falhas": 1}
    pedido = await _pedido(lead_8d["lead_id"])
    assert pedido["status"] == "falhou" and pedido["erro"].startswith("400")
    assert api.de("POST", CARDS) == []


async def test_erro_transitorio_adia_e_esgota(lead_8d, monkeypatch):
    api = GrowthHSFalso()
    api.forcar[("POST", CARDS)] = [_resposta(503), _resposta(503)]
    await _enfileirar(lead_8d["lead_id"])
    assert (await _rodar(lead_8d["lead_id"], api))["adiadas"] == 1
    pedido = await _pedido(lead_8d["lead_id"])
    assert pedido["status"] == "pendente" and pedido["tentativas"] == 1

    # Esgotar: com o pedido já visível e o teto em 2, a próxima falha é final.
    monkeypatch.setattr(entrega, "MAX_TENTATIVAS", 2)
    await _tornar_visivel(pedido["id"])
    assert (await _rodar(lead_8d["lead_id"], api))["falhas"] == 1
    assert (await _pedido(lead_8d["lead_id"]))["status"] == "falhou"


async def test_mover_etapa_falha_a_vista(lead_8d):
    api = GrowthHSFalso()
    await _enfileirar(lead_8d["lead_id"], "regra", acao="mover")
    await _rodar(lead_8d["lead_id"], api)
    pedido = await _pedido(lead_8d["lead_id"])
    assert pedido["status"] == "falhou" and "mover" in pedido["erro"]
    assert api.pedidos == []


async def test_2xx_com_corpo_invalido_ainda_entrega_e_nao_repete(lead_8d):
    """Round 1, achado I1(b): um 2xx já criou o card do lado do GrowthHS —
    corpo ilegível não pode virar re-envio (segundo card)."""
    api = GrowthHSFalso()
    api.corpo_do_post_card = b"isto nao e json"
    await _enfileirar(lead_8d["lead_id"])
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "entregues": 1}
    pedido = await _pedido(lead_8d["lead_id"])
    assert pedido["status"] == "entregue" and pedido["card_id"] is None
    # O `person_id` é o achado, não o da resposta: sobrevive ao corpo torto.
    assert pedido["person_id"] == next(iter(api.pessoas))
    # Sem id não há card para anotar: a falta fica no evento.
    assert api.notas == []
    [evento] = await _eventos(lead_8d["lead_id"], "crm_handoff")
    assert "id do card" in evento["metadata"]["erro_da_nota"]

    # Segunda passada: nada pendente, nenhuma chamada nova ao GrowthHS.
    assert await _rodar(lead_8d["lead_id"], api) == ZERO
    assert len(api.de("POST", CARDS)) == 1


async def test_falha_apos_o_2xx_nao_reenvia(lead_8d, monkeypatch):
    """Round 1, achado I1(a): um defeito NOSSO depois do sucesso (aqui,
    `_registrar_evento` explodindo) não pode desfazer o `entregue` nem
    provocar um segundo POST."""
    async def _explode(*args, **kwargs):
        raise RuntimeError("defeito simulado depois do sucesso")
    monkeypatch.setattr(entrega, "_registrar_evento", _explode)

    api = GrowthHSFalso()
    await _enfileirar(lead_8d["lead_id"])
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "entregues": 1}
    pedido = await _pedido(lead_8d["lead_id"])
    assert pedido["status"] == "entregue" and pedido["card_id"] == next(iter(api.cards))
    assert await _rodar(lead_8d["lead_id"], api) == ZERO
    assert len(api.de("POST", CARDS)) == 1


async def test_chave_errada_pausa_a_fila_sem_gastar_tentativa(lead_8d, gemeo):
    """I3: 401/403/404 é configuração — a mesma para todos os pedidos. Falhar
    cada um derrubaria a fila inteira de uma vez; o certo é pausar: o pedido
    volta a pendente daqui a 10 min, a tentativa não conta, e o ciclo para
    (os outros pedidos do lote nem são tentados). Um 401 no próprio
    client-credentials é credencial errada: uma chamada só."""
    api = GrowthHSFalso()
    api.forcar[("POST", "/api/v1/auth/client-credentials")] = [_resposta(401)]
    await _enfileirar(lead_8d["lead_id"])
    await _enfileirar(gemeo)
    resultado = await _rodar([lead_8d["lead_id"], gemeo], api)
    assert len(api.pedidos) == 1
    assert resultado == {**ZERO, "pausadas": 2}
    async with db.sessao(role="service_role") as conn:
        pedidos = await conn.fetch(
            """SELECT status, tentativas, erro, visivel_em > now() + interval '9 minutes' AS adiado
                 FROM crm_handoffs WHERE lead_id = ANY($1::uuid[])""",
            [lead_8d["lead_id"], gemeo])
    assert [(p["status"], p["tentativas"], p["adiado"]) for p in pedidos] == [
        ("pendente", 0, True), ("pendente", 0, True)]
    assert sum(1 for p in pedidos if p["erro"] and p["erro"].startswith(entrega.PREFIXO_PAUSA)) == 1
    assert await _eventos(lead_8d["lead_id"], "crm_handoff_falhou") == []
    assert await _eventos(gemeo, "crm_handoff_falhou") == []


@pytest.mark.parametrize("codigo", [403, 404])
async def test_403_e_404_tambem_pausam(lead_8d, codigo):
    """404 no `POST /cards` é a lista de entrada errada (configuração)."""
    api = GrowthHSFalso()
    api.forcar[("POST", CARDS)] = [_resposta(codigo)]
    await _enfileirar(lead_8d["lead_id"])
    assert (await _rodar(lead_8d["lead_id"], api))["pausadas"] == 1
    pedido = await _pedido(lead_8d["lead_id"])
    assert pedido["status"] == "pendente" and pedido["tentativas"] == 0


@pytest.mark.parametrize("codigo", [308, 301, 405, 400])
async def test_erro_no_token_pausa_qualquer_status(lead_8d, gemeo, codigo):
    """Revisão final da growthhs-real (I1): o `client-credentials` não leva
    nada do lead. Um 308 (o proxy mandando http → https), um 405 ou um 400 no
    token são o endereço ou a credencial — iguais para todos. Antes, só
    401/403/404 pausavam e o resto derrubava a fila pedido por pedido."""
    api = GrowthHSFalso()
    api.forcar[("POST", "/api/v1/auth/client-credentials")] = [
        httpx.Response(codigo, headers={"location": "https://growthhs.exemplo.invalid/"})]
    await _enfileirar(lead_8d["lead_id"])
    await _enfileirar(gemeo)
    resultado = await _rodar([lead_8d["lead_id"], gemeo], api)
    assert resultado == {**ZERO, "pausadas": 2}
    assert len(api.pedidos) == 1
    async with db.sessao(role="service_role") as conn:
        pedidos = await conn.fetch(
            "SELECT status, tentativas FROM crm_handoffs WHERE lead_id = ANY($1::uuid[])",
            [lead_8d["lead_id"], gemeo])
    assert [(p["status"], p["tentativas"]) for p in pedidos] == [("pendente", 0)] * 2
    assert await _eventos(lead_8d["lead_id"], "crm_handoff_falhou") == []


async def test_url_invalida_pausa_e_nao_vira_defeito_interno(lead_8d):
    """I1: porta que não é número — o httpx nem monta a URL (`InvalidURL`,
    que nem é `HTTPError`). É configuração: pausa, sem gastar tentativa."""
    api = GrowthHSFalso()
    cfg = Config(base_url="https://growthhs.exemplo.invalid:porta", client_id="hsg_8d",
                 client_secret="segredo-8d", list_id=LISTA_DE_ENTRADA,
                 boards_conferidos=(6, 7), app_url=None, ambiente="homologacao")
    await _enfileirar(lead_8d["lead_id"])
    resultado = await entrega.rodar_entregas(somente_lead=lead_8d["lead_id"], cfg=cfg,
                                             transporte=api.transporte())
    assert resultado == {**ZERO, "pausadas": 1}
    pedido = await _pedido(lead_8d["lead_id"])
    assert pedido["status"] == "pendente" and pedido["tentativas"] == 0
    assert pedido["erro"].startswith(entrega.PREFIXO_PAUSA)
    assert "porta" not in pedido["erro"]  # só o nome da classe, nunca a URL


def test_transitorio_espera_com_teto_e_desiste_depois_de_um_dia():
    """I3: a fila desistia em ~31 min — um GrowthHS fora do ar numa noite
    derrubava todos os pedidos. Agora a espera dobra até 60 min e o total
    passa de 24 h."""
    esperas = [entrega.espera_transitoria(n) for n in range(1, entrega.MAX_TENTATIVAS)]
    assert esperas[0] == timedelta(minutes=1)
    assert max(esperas) == timedelta(minutes=60)
    assert sum(esperas, timedelta()) > timedelta(hours=24)


async def test_um_token_para_o_lote_inteiro(lead_8d, gemeo):
    """Um `Cliente` por ciclo: o token do primeiro pedido serve ao segundo."""
    api = GrowthHSFalso()
    await _enfileirar(lead_8d["lead_id"])
    await _enfileirar(gemeo)
    assert (await _rodar([lead_8d["lead_id"], gemeo], api))["entregues"] == 2
    assert len(api.de("POST", "/api/v1/auth/client-credentials")) == 1


# ── Parada do worker ─────────────────────────────────────────────────────────

async def test_parada_do_worker_sai_entre_pedidos_e_devolve_o_resto(lead_8d, gemeo):
    """I5: o worker pedindo parada não pode ficar entregando o lote inteiro;
    sai entre um pedido e outro, e o que foi reivindicado e não tentado volta
    à fila na hora, sem gastar tentativa."""
    parar = asyncio.Event()
    api = GrowthHSFalso()
    api.ao_criar_card = parar.set
    await _enfileirar(lead_8d["lead_id"])
    await _enfileirar(gemeo)
    resultado = await _rodar([lead_8d["lead_id"], gemeo], api, parar=parar)
    assert len(api.de("POST", CARDS)) == 1 and resultado["entregues"] == 1
    async with db.sessao(role="service_role") as conn:
        restante = await conn.fetchrow(
            """SELECT status, tentativas, visivel_em <= now() AS visivel FROM crm_handoffs
                WHERE lead_id = ANY($1::uuid[]) AND status = 'pendente'""",
            [lead_8d["lead_id"], gemeo])
    assert (restante["status"], restante["tentativas"], restante["visivel"]) == ("pendente", 0, True)


async def test_cancelar_depois_do_2xx_ainda_grava_entregue(lead_8d, monkeypatch):
    """I5: o card já existe do lado do GrowthHS; um cancelamento (o worker
    desistindo de esperar na parada) no meio da gravação não pode deixar o
    pedido pendente — seria o segundo card."""
    original = entrega._marcar_entregue
    entrou = asyncio.Event()

    async def lento(*args):
        entrou.set()
        await asyncio.sleep(0.3)
        await original(*args)
    monkeypatch.setattr(entrega, "_marcar_entregue", lento)

    api = GrowthHSFalso()
    await _enfileirar(lead_8d["lead_id"])
    tarefa = asyncio.create_task(_rodar(lead_8d["lead_id"], api))
    # O cancelamento tem de cair DENTRO da gravação blindada — é ela que o
    # teste prova: espera o `lento` começar, com teto (estourar o teto é
    # vermelho de verdade, não espera curta).
    await asyncio.wait_for(entrou.wait(), timeout=30)
    assert api.de("POST", CARDS), "a gravação começou sem o POST ao GrowthHS"
    tarefa.cancel()
    with pytest.raises(asyncio.CancelledError):
        await tarefa
    # A gravação blindada continua depois do cancelamento: sonda até gravar
    # ou estourar o teto (só gasto no vermelho de verdade).
    prazo = asyncio.get_running_loop().time() + 10
    while True:
        pedido = await _pedido(lead_8d["lead_id"])
        if pedido["status"] == "entregue" or asyncio.get_running_loop().time() > prazo:
            break
        await asyncio.sleep(0.1)
    assert pedido["status"] == "entregue" and pedido["card_id"] == next(iter(api.cards))


# ── Modo teste na saída (A5, pergunta 66) ───────────────────────────────────

async def test_lista_do_pedido_vem_da_jornada_do_run(conexao):
    """A lista em vigor AGORA, pela jornada do run. Transação revertida: a
    jornada e o run nunca existem para o worker de produção."""
    jornada = await conexao.fetchval(
        """INSERT INTO journeys (name, status, entry_type, entry_config, entry_node_id,
                                 nodes, allowed_emails)
           VALUES ('a5-modo-teste', 'paused', 'event', '{"event_type": "form_submitted"}',
                   'n1', '[{"id": "n1", "type": "handoff_growthhs", "config": {}, "next": null}]',
                   '{erick@exemplo.invalid}')
           RETURNING id::text""")
    lead = await conexao.fetchval(
        "INSERT INTO leads (email, tipo) VALUES ('a5@exemplo.invalid', 'teste') RETURNING id::text")
    run = await conexao.fetchval(
        "INSERT INTO journey_runs (journey_id, lead_id, state, current_node_id) "
        "VALUES ($1::uuid, $2::uuid, 'done', 'n1') RETURNING id::text", jornada, lead)

    assert await entrega._lista_do_pedido(conexao, {"journey_run_id": run}) == [
        "erick@exemplo.invalid"]
    assert await entrega._lista_do_pedido(conexao, {"journey_run_id": None}) is None
    await conexao.execute("UPDATE journeys SET allowed_emails = NULL WHERE id = $1::uuid", jornada)
    assert await entrega._lista_do_pedido(conexao, {"journey_run_id": run}) is None


async def test_handoff_de_jornada_fora_da_lista_nao_sai(lead_8d, monkeypatch):
    """A lista pode ter mudado entre o nó e a entrega: a saída reconfere,
    como o aviso e o webhook. O GrowthHS não é chamado — nem para achar a
    pessoa."""
    async def lista(conn, pedido):
        return ["outro@exemplo.invalid"]
    monkeypatch.setattr(entrega, "_lista_do_pedido", lista)
    api = GrowthHSFalso()
    await _enfileirar(lead_8d["lead_id"], "jornada")
    resultado = await _rodar(lead_8d["lead_id"], api)
    assert resultado["falhas"] == 1 and api.pedidos == []
    pedido = await _pedido(lead_8d["lead_id"])
    assert pedido["status"] == "falhou" and pedido["erro"].startswith("modo teste")


async def test_handoff_de_jornada_na_lista_sai(lead_8d, monkeypatch):
    async def lista(conn, pedido):
        return [f" {EMAIL.upper()} "]
    monkeypatch.setattr(entrega, "_lista_do_pedido", lista)
    await _enfileirar(lead_8d["lead_id"], "jornada")
    assert (await _rodar(lead_8d["lead_id"], GrowthHSFalso()))["entregues"] == 1


# ── Folga de relógio no reconhecimento (revisão final, M2) ──────────────────

def test_card_um_pouco_mais_velho_que_o_pedido_ainda_e_candidato():
    """O `created_at` vem do relógio do GrowthHS; o `criado_em`, do nosso
    banco. Relógio de lá uns minutos atrasado não pode esconder o card que o
    201 perdido criou (seria o segundo card). Fora da folga, não é candidato
    — e mesmo dentro dela só vira "o nosso" com a assinatura."""
    pedido = datetime(2026, 10, 22, 13, 0, tzinfo=timezone.utc)
    dentro = {"id": 1, "created_at": _ingenuo_utc(pedido - timedelta(minutes=3))}
    fora = {"id": 2, "created_at": _ingenuo_utc(pedido - timedelta(minutes=10))}
    candidatos, ordem = entrega._separar([dentro, fora], pedido)
    assert candidatos == [dentro]
    assert ordem == [dentro, fora]


async def test_201_perdido_com_relogio_de_la_atrasado_nao_vira_segundo_card(lead_8d):
    api = GrowthHSFalso()
    await _enfileirar(lead_8d["lead_id"])
    pedido = await _pedido(lead_8d["lead_id"])
    api.agora = _ingenuo_utc(pedido["criado_em"] - timedelta(minutes=2))
    api.perder[("POST", CARDS)] = 1
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "adiadas": 1}
    await _tornar_visivel(pedido["id"])
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "entregues": 1}
    assert len(api.de("POST", CARDS)) == 1 and api.puts() == []


# ── O worker nunca pega pedido de lead de teste (revisão final, I3) ─────────

async def test_predicado_de_lead_de_teste(conexao):
    """⚠️ Prova o predicado, não o worker: rodar `_reivindicar` sem
    `somente_lead` aqui reivindicaria os pedidos REAIS. Transação revertida —
    os leads nunca existem para o worker de produção. Só `tipo = 'teste'`
    COM e-mail nulo ou `@exemplo.invalid` fica de fora; contato real marcado
    `teste` à mão continua sendo entregue."""
    casos = {
        "teste-invalid": ("teste", "i3-predicado@exemplo.invalid"),
        "teste-maiusculo": ("teste", "I3-Predicado-2@EXEMPLO.INVALID"),
        "teste-sem-email": ("teste", None),
        "teste-email-real": ("teste", "i3-predicado@empresa.com.br"),
        "real-invalid": ("lead", "i3-predicado-3@exemplo.invalid"),
    }
    ids = {}
    for nome, (tipo, email) in casos.items():
        ids[await conexao.fetchval(
            "INSERT INTO leads (nome, email, tipo) VALUES ($1, $2, $3) RETURNING id::text",
            f"I3 {nome}", email, tipo)] = nome
    de_teste = {ids[r["id"]] for r in await conexao.fetch(
        f"SELECT l.id::text AS id FROM leads l WHERE l.id = ANY($1::uuid[]) "
        f"AND {entrega.LEAD_DE_TESTE}", list(ids))}
    assert de_teste == {"teste-invalid", "teste-maiusculo", "teste-sem-email"}


def test_reivindicar_sem_filtro_usa_o_predicado():
    """O predicado provado acima é o que o UPDATE da reivindicação usa (sem
    rodar a reivindicação sem filtro contra o banco de produção)."""
    import inspect
    fonte = inspect.getsource(entrega._reivindicar)
    assert "$3::uuid[] IS NOT NULL OR NOT EXISTS" in fonte and "{LEAD_DE_TESTE}" in fonte


# ── Ambiente (migration 030: homologação e produção lado a lado) ────────────

async def _carimbo(lead_id, dnia_id):
    async with db.sessao(role="service_role") as conn:
        return (await conn.fetchval(
                    "SELECT ambiente FROM crm_handoffs WHERE lead_id = $1::uuid "
                    "ORDER BY id DESC LIMIT 1", lead_id),
                await conn.fetchrow(
                    "SELECT growthhs_card_id, growthhs_person_id, growthhs_ambiente "
                    "FROM ecosystem_identities WHERE dnia_id = $1::uuid", dnia_id))


async def test_entrega_carimba_o_ambiente(lead_8d):
    api = GrowthHSFalso()
    await _enfileirar(lead_8d["lead_id"])
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "entregues": 1}
    [card_id] = api.cards
    pedido_amb, ident = await _carimbo(lead_8d["lead_id"], lead_8d["dnia_id"])
    assert pedido_amb == "homologacao"
    assert (ident["growthhs_card_id"], ident["growthhs_ambiente"]) == (card_id, "homologacao")
    [evento] = await _eventos(lead_8d["lead_id"], "crm_handoff")
    assert evento["metadata"]["ambiente"] == "homologacao"


@pytest.mark.parametrize("ambiente_antigo", ["producao", None])
async def test_identidade_de_outro_ambiente_e_sobrescrita(lead_8d, ambiente_antigo):
    """Card 555 de OUTRO GrowthHS (ou sem carimbo, os da prova de 21–22/10)
    não vale neste: a entrega o troca pelo card daqui, com o carimbo daqui."""
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            "UPDATE ecosystem_identities SET growthhs_card_id = 555, growthhs_person_id = 77, "
            "growthhs_ambiente = $2 WHERE dnia_id = $1::uuid",
            lead_8d["dnia_id"], ambiente_antigo)
    api = GrowthHSFalso()
    pessoa = api.pessoa(email=EMAIL)
    aberto = api.card(pessoa, descricao="Anotação")
    await _enfileirar(lead_8d["lead_id"])
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "atualizadas": 1}
    _, ident = await _carimbo(lead_8d["lead_id"], lead_8d["dnia_id"])
    assert (ident["growthhs_card_id"], ident["growthhs_person_id"],
            ident["growthhs_ambiente"]) == (aberto, pessoa, "homologacao")


async def test_trocar_de_ambiente_entre_entregas_sobrescreve_a_identidade(lead_8d):
    """Entregue na homologação; depois a produção vira o ativo e o lead
    converte de novo: a identidade passa a apontar para o card da produção."""
    homo, prod = GrowthHSFalso(), GrowthHSFalso()
    prod._ids = itertools.count(9001)  # ids que não colidem com os da homologação
    await _enfileirar(lead_8d["lead_id"])
    assert await _rodar(lead_8d["lead_id"], homo) == {**ZERO, "entregues": 1}
    await _enfileirar(lead_8d["lead_id"], "regra")
    resultado = await entrega.rodar_entregas(somente_lead=lead_8d["lead_id"], cfg=CFG_PRODUCAO,
                                             transporte=prod.transporte())
    assert resultado == {**ZERO, "entregues": 1}
    [card_prod] = prod.cards
    pedido_amb, ident = await _carimbo(lead_8d["lead_id"], lead_8d["dnia_id"])
    assert pedido_amb == "producao"
    assert (ident["growthhs_card_id"], ident["growthhs_ambiente"]) == (card_prod, "producao")


async def test_pessoa_do_pedido_de_outro_ambiente_nao_e_reusada(lead_sem_email):
    """Lead sem e-mail: o retry reusa a pessoa que ESTE pedido criou — mas só
    no mesmo ambiente. Trocaram de ambiente entre as tentativas: aquela
    pessoa é de outro GrowthHS, e cria-se outra aqui."""
    api = GrowthHSFalso()
    lead = lead_sem_email["lead_id"]
    pedido_id = await _enfileirar(lead)
    async with db.sessao(role="service_role") as conn:
        await conn.execute("UPDATE crm_handoffs SET person_id = 4242, ambiente = 'producao' "
                           "WHERE id = $1", pedido_id)
    assert await _rodar(lead, api) == {**ZERO, "entregues": 1}
    [pessoa] = api.pessoas
    assert pessoa != 4242 and len(api.de("POST", PESSOAS)) == 1
    pedido = await _pedido(lead)
    assert (pedido["person_id"], pedido["ambiente"]) == (pessoa, "homologacao")


# ── Rótulo do campo extra na nota (frente faxina-tecnica, 29/10) ─────────────
# O vendedor lia `ja_faz_testagem: Sim` na nota da captura normal; o
# agendamento já mostrava a pergunta. A nota usa o rótulo da página da
# conversão; sem definição, fica a chave.

ROTULO_TESTAGEM = "Sua empresa já faz testagem?"


@pytest_asyncio.fixture
async def pagina_rotulada(lead_8d):
    slug = f"faxina-rotulo-{uuid.uuid4().hex[:8]}"
    config = {"campos": [
        {"chave": "email", "rotulo": "E-mail", "tipo": "email"},
        {"chave": "ja_faz_testagem", "rotulo": ROTULO_TESTAGEM, "tipo": "texto"}]}
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            """INSERT INTO pages (name, slug, component_name, page_type, status, config)
               VALUES ('Faxina rótulo', $1, 'FaxinaRotulo', 'landing', 'draft', $2::jsonb)""",
            slug, config)  # objeto: o pool codifica jsonb
        await conn.execute(
            """UPDATE leads SET campos_extras = '{"ja_faz_testagem": "Sim", "sem_definicao": "x"}'
               WHERE id = $1::uuid""", lead_8d["lead_id"])
    yield slug
    async with db.sessao(role="service_role") as conn:
        await conn.execute("DELETE FROM pages WHERE slug = $1", slug)


def _conversao_da(slug, extras=None):
    return {"page_slug": slug, "form_id": None, "site_nome": None, "page_url": None,
            "converted_at": "2026-10-29T13:00:00Z", "canal": "direto", "gclid": None,
            "dados_informados": {"campos_extras": extras or {}}}


async def test_nota_de_abertura_usa_o_rotulo_da_pagina(lead_8d, pagina_rotulada, monkeypatch):
    async def origem(_conn, _lead_id):
        return _conversao_da(pagina_rotulada), None

    monkeypatch.setattr(entrega, "origem_do_card", origem)
    api = GrowthHSFalso()
    await _enfileirar(lead_8d["lead_id"])
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "entregues": 1}
    [nota] = api.notas
    linhas = nota["content"].split("\n")
    assert f"- {ROTULO_TESTAGEM}: Sim" in linhas
    assert "- sem_definicao: x" in linhas  # sem definição na página, a chave
    assert not any(l.startswith("- ja_faz_testagem") for l in linhas)


async def test_nota_de_atualizacao_usa_o_rotulo_no_informado(lead_8d, pagina_rotulada,
                                                            monkeypatch):
    async def origem(_conn, _lead_id):
        return _conversao_da(pagina_rotulada, {"ja_faz_testagem": "Não"}), None

    monkeypatch.setattr(entrega, "origem_do_card", origem)
    api = GrowthHSFalso()
    pessoa = api.pessoa(email=EMAIL)
    aberto = api.card(pessoa, board=7, descricao="Anotação do vendedor")
    await _enfileirar(lead_8d["lead_id"])
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "atualizadas": 1}
    [nota] = api.notas
    assert nota["card_id"] == aberto
    linhas = nota["content"].split("\n")
    assert linhas[1:3] == ["Informou nesta conversão (não verificado):",
                           f"- {ROTULO_TESTAGEM}: Não"], linhas


async def test_nota_sem_pagina_fica_com_a_chave(lead_8d, monkeypatch):
    async def origem(_conn, _lead_id):
        return _conversao_da("pagina-que-nao-existe-faxina"), None

    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            """UPDATE leads SET campos_extras = '{"ja_faz_testagem": "Sim"}'
               WHERE id = $1::uuid""", lead_8d["lead_id"])
    monkeypatch.setattr(entrega, "origem_do_card", origem)
    api = GrowthHSFalso()
    await _enfileirar(lead_8d["lead_id"])
    assert await _rodar(lead_8d["lead_id"], api) == {**ZERO, "entregues": 1}
    [nota] = api.notas
    assert "- ja_faz_testagem: Sim" in nota["content"].split("\n")
