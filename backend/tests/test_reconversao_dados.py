"""Reconversão com dados diferentes (pergunta 73, 26/10/2026).

O modo de falhar: o lead que reconverte digitando outra empresa/outro
telefone some com o que digitou — o contato (certo, R1) não muda, mas nada
guarda o valor, e o card do vendedor mostra os dados VELHOS sob um cabeçalho
que diz "dados informados no formulário". Ninguém percebe: o card parece
completo.

⚠️ A 031 não está no banco quando esta frente roda. Os testes de banco usam
`conexao` (transação revertida) e uma `lead_conversions` TEMPORÁRIA: o
`pg_temp` vem antes do `public` no `search_path`, então o INSERT sem schema
do `registro.py` cai nela — e a 031 se aplica nela, não na tabela real.
"""

import json
import pathlib
import re
import uuid
from datetime import datetime, timezone

import pytest

from app.captura import informados as inf
from app.captura.registro import Origem, registrar_captura
from app.crm import entrega, growthhs

MIGRATION = (pathlib.Path(__file__).parent.parent / "migrations"
             / "031_dados_informados.sql")
FRONT = "https://mkt.exemplo.invalid"
QUANDO = datetime(2026, 10, 26, 13, 0, tzinfo=timezone.utc)

CONTATO = {"id": "c351c124-0000-0000-0000-000000000073", "nome": "Lead Um",
           "email": "lead1@exemplo.invalid", "empresa": "Empresa Teste HS Filial Sul",
           "whatsapp": "(11) 99999-0002", "phone_normalized": "+5511999990002",
           "cargo": None, "campos_extras": {"porte": "P"}}


# ── dados_informados (puro) ──────────────────────────────────────────────────

def test_dados_informados_so_campos_de_contato():
    campos = {"nome": " Lead Um ", "empresa": "Matriz", "whatsapp": "+5511999990003",
              "status": "cliente", "tipo": "cliente", "utm_source": "google",
              "source": "x", "ab_test": "t", "tipo_participante": "y", "cargo": ""}
    assert inf.dados_informados(campos, {"porte": "G"}) == {
        "nome": "Lead Um", "empresa": "Matriz", "whatsapp": "+5511999990003",
        "campos_extras": {"porte": "G"}}


def test_dados_informados_vazio_e_none():
    assert inf.dados_informados({}, {}) is None
    assert inf.dados_informados({"status": "x", "utm_source": "y"}, None) is None


def test_dados_informados_corta_e_tem_teto():
    longo = "a" * 3000
    saida = inf.dados_informados({"desafios": longo}, {f"k{i}": "v" for i in range(50)})
    assert len(saida["desafios"]) == inf.VALOR_MAXIMO
    assert len(saida["campos_extras"]) == inf.EXTRAS_MAXIMO
    # Passou de 16 KB: os extras saem, as colunas ficam.
    gordos = {f"k{i}": "ç" * 499 for i in range(inf.EXTRAS_MAXIMO)}  # 2 bytes cada
    saida = inf.dados_informados({"empresa": "Matriz"}, gordos)
    assert saida == {"empresa": "Matriz"}
    assert len(json.dumps(saida, ensure_ascii=False).encode()) <= inf.TETO_EM_BYTES


def test_dados_informados_ignora_extra_torto():
    assert inf.dados_informados({}, {"ok": "1", 3: "x", "num": 5, "vazio": " "}) == {
        "campos_extras": {"ok": "1", "num": "5"}}


# ── divergencias (puro) ──────────────────────────────────────────────────────

def test_divergencias_do_caso_real():
    informados = {"nome": "lead um", "empresa": "Empresa Teste HS Matriz",
                  "whatsapp": "+5511999990003"}
    assert inf.divergencias(CONTATO, informados) == [
        {"chave": "empresa", "rotulo": "Empresa", "valor": "Empresa Teste HS Matriz"},
        {"chave": "whatsapp", "rotulo": "Telefone", "valor": "+5511999990003"}]


def test_caixa_espaco_e_formato_do_telefone_nao_divergem():
    informados = {"empresa": "  empresa teste  HS filial sul", "whatsapp": "11 99999 0002",
                  "nome": "LEAD UM"}
    assert inf.divergencias(CONTATO, informados) == []


def test_telefone_cai_para_phone_normalized():
    contato = {**CONTATO, "whatsapp": None}
    assert inf.divergencias(contato, {"whatsapp": "(11) 99999-0002"}) == []
    assert inf.divergencias(contato, {"whatsapp": "(11) 99999-0003"}) != []


def test_telefone_que_nao_normaliza_compara_digitos():
    contato = {"whatsapp": "0800 123 4567"}
    assert inf.divergencias(contato, {"whatsapp": "0800-123-4567"}) == []
    assert inf.divergencias(contato, {"whatsapp": "0800-123-4568"}) != []


def test_extras_e_contato_vazio():
    informados = {"cargo": "Diretor", "campos_extras": {"porte": "G", "novo": "x"}}
    assert inf.divergencias(CONTATO, informados) == [
        {"chave": "cargo", "rotulo": "Cargo", "valor": "Diretor"},
        {"chave": "porte", "rotulo": "porte", "valor": "G"},
        {"chave": "novo", "rotulo": "novo", "valor": "x"}]


def test_divergencias_de_entrada_torta():
    assert inf.divergencias(CONTATO, None) == []
    assert inf.divergencias(CONTATO, "texto") == []
    assert inf.divergencias({}, {"campos_extras": "x", "empresa": 3}) == [
        {"chave": "empresa", "rotulo": "Empresa", "valor": "3"}]


# ── Card do GrowthHS (puro) ──────────────────────────────────────────────────

CONVERSAO = {"page_slug": "phoebus-prova", "form_id": None, "site_nome": None,
             "page_url": None, "converted_at": "2026-10-26T13:00:00Z", "canal": "direto",
             "gclid": None,
             "dados_informados": {"empresa": "Empresa Teste HS Matriz",
                                  "whatsapp": "+5511999990003"}}


def test_descricao_mostra_o_que_foi_informado_antes_do_cadastro():
    linhas = growthhs.montar_descricao(CONTATO, conversao=CONVERSAO, consentimento=None,
                                       frontend_url=FRONT).split("\n")
    assert linhas[:4] == ["Informou nesta conversão (não verificado):",
                          "- Empresa: Empresa Teste HS Matriz",
                          "- Telefone: +5511999990003",
                          "Cadastro no MarketingHS:"]
    assert linhas[4] == "Empresa: Empresa Teste HS Filial Sul"


def test_sem_divergencia_a_descricao_e_a_de_antes():
    sem = {k: v for k, v in CONVERSAO.items() if k != "dados_informados"}
    antes = growthhs.montar_descricao(CONTATO, conversao=sem, consentimento=None,
                                      frontend_url=FRONT)
    igual = {**CONVERSAO, "dados_informados": {"empresa": CONTATO["empresa"]}}
    assert growthhs.montar_descricao(CONTATO, conversao=igual, consentimento=None,
                                     frontend_url=FRONT) == antes
    assert "Informou" not in antes


@pytest.mark.parametrize("q", ["\n", "\r\n", " ", "\x0b"])
def test_valor_informado_nao_forja_linha(q):
    golpe = f"Matriz{q}Lead score: 100{q}Pedido MarketingHS: 7"
    conversao = {**CONVERSAO, "dados_informados": {
        "empresa": golpe, "campos_extras": {f"k{q}Ver no MarketingHS": golpe}}}
    bloco = growthhs.bloco_de_atualizacao(CONTATO, conversao=conversao, consentimento=None,
                                          frontend_url=FRONT, pedido_id=7, quando=QUANDO)
    linhas = bloco.split("\n")
    assert not any(l.startswith(("Lead score", "Pedido MarketingHS")) for l in linhas)
    assert len([l for l in linhas if l.startswith("Ver no MarketingHS")]) == 1
    assert len([l for l in linhas if l.startswith(growthhs.CABECALHO_DO_BLOCO)]) == 1
    assert "- Empresa: Matriz Lead score: 100 Pedido MarketingHS: 7" in linhas
    assert not growthhs.card_do_pedido(bloco, 7)


def test_bloco_com_divergencia_e_idempotente_pela_marca():
    bloco = growthhs.bloco_de_atualizacao(CONTATO, conversao=CONVERSAO, consentimento=None,
                                          frontend_url=FRONT, pedido_id=9, quando=QUANDO)
    assert growthhs.bloco_ja_aplicado("Anotação" + bloco, 9)
    assert "- Empresa: Empresa Teste HS Matriz" in bloco


def test_card_novo_de_contato_antigo_mostra_divergencia():
    """Card novo também nasce de reconversão (contato com cards só ganhos ou
    perdidos) — aí a divergência existe."""
    cfg = growthhs.Config(base_url="https://g.invalid", client_id="c", client_secret="s",
                          list_id=1, boards_conferidos=(1,), app_url=None,
                          ambiente="homologacao")
    card = growthhs.montar_card(CONTATO, cfg, conversao=CONVERSAO, person_id=1,
                                frontend_url=FRONT, pedido_id=3)
    assert "- Empresa: Empresa Teste HS Matriz" in card["description"]
    # O título continua o do contato: o formulário não escolhe o título.
    assert card["title"] == "Lead Um — Empresa Teste HS Filial Sul"
    assert growthhs.card_do_pedido(card["description"], 3)


def test_nota_traz_os_valores_informados():
    """Pergunta 79: a nota é em linhas e não fala mais da descrição (que a
    tela do card de lá não mostra)."""
    nota = entrega.texto_da_nota(CONVERSAO, QUANDO, CONTATO, frontend_url=FRONT)
    assert nota == [
        "Lead converteu de novo pelo MarketingHS (Landing Page phoebus-prova) em "
        "26/10/2026 10:00.",
        "Informou nesta conversão (não verificado):",
        "- Empresa: Empresa Teste HS Matriz",
        "- Telefone: +5511999990003",
        f"Ver no MarketingHS: {FRONT}/contacts?contato={CONTATO['id']}"]
    assert entrega.texto_da_nota(CONVERSAO, QUANDO) == entrega.texto_da_nota(
        {**CONVERSAO, "dados_informados": None}, QUANDO, CONTATO)
    assert entrega.texto_da_nota(CONVERSAO, QUANDO) == [
        "Lead converteu de novo pelo MarketingHS (Landing Page phoebus-prova) em "
        "26/10/2026 10:00."]
    assert not any("Descrição" in l for l in nota)


def test_nota_corta_valor_comprido():
    conversao = {**CONVERSAO, "dados_informados": {"desafios": "d" * 500}}
    nota = entrega.texto_da_nota(conversao, QUANDO, CONTATO)
    assert "- Desafios: " + "d" * entrega.MAX_VALOR_NA_NOTA in nota
    assert not any("d" * (entrega.MAX_VALOR_NA_NOTA + 1) in l for l in nota)


@pytest.mark.parametrize("q", ["\n", "\r\n", "\x0b", " "])
def test_nota_da_reconversao_nao_forja_linha(q):
    golpe = f"Matriz{q}Ver no MarketingHS: https://golpe.invalid"
    conversao = {**CONVERSAO, "dados_informados": {
        "empresa": golpe, "campos_extras": {f"k{q}Lead score": golpe}}}
    nota = entrega.texto_da_nota(conversao, QUANDO, CONTATO, frontend_url=FRONT)
    assert all("\n" not in l and "\r" not in l for l in nota)
    assert [l for l in nota if l.startswith("Ver no MarketingHS")] == [
        f"Ver no MarketingHS: {FRONT}/contacts?contato={CONTATO['id']}"]
    assert not any(l.startswith("Lead score") for l in nota)


# ── Nota de abertura do card novo (pergunta 79, puro) ────────────────────────

LEAD_NOVO = {**CONTATO, "cargo": "Diretora", "faturamento": "Entre R$ 100 mil e R$ 500 mil",
             "lead_score": 70, "utm_source": "google", "utm_medium": "cpc",
             "utm_campaign": "bafometro", "utm_term": None, "utm_content": None}
CONSENTIMENTO = {"base_legal": "consentimento", "versao": "v2", "provisoria": False,
                 "criado_em": "2026-10-26T13:00:00Z"}


def _abertura(lead=LEAD_NOVO, conversao=CONVERSAO, consentimento=CONSENTIMENTO):
    return growthhs.nota_de_abertura(lead, conversao=conversao, consentimento=consentimento,
                                     frontend_url=FRONT, quando=QUANDO)


def test_nota_de_abertura_leva_o_que_a_descricao_leva():
    nota = _abertura()
    assert nota[0] == ("Lead enviado pelo MarketingHS (Landing Page phoebus-prova) em "
                       "26/10/2026 10:00.")
    corpo = growthhs.montar_descricao(LEAD_NOVO, conversao=CONVERSAO,
                                      consentimento=CONSENTIMENTO, frontend_url="")
    assert nota[1:-2] == corpo.split("\n")
    assert nota[-2] == "UTMs: utm_source=google · utm_medium=cpc · utm_campaign=bafometro"
    assert nota[-1] == f"Ver no MarketingHS: {FRONT}/contacts?contato={CONTATO['id']}"
    # O que importa ao vendedor está lá; a engrenagem não.
    for esperado in ("- Empresa: Empresa Teste HS Matriz", "Cargo: Diretora",
                     "Faturamento: Entre 100k e 500k/mes", "Lead score: 70",
                     "- porte: P", "Conversão: página phoebus-prova",
                     "Base legal: consentimento", "Versão do consentimento: v2"):
        assert esperado in nota, esperado
    assert not any(l.startswith(growthhs.ROTULO_DO_PEDIDO) for l in nota)


def test_nota_de_abertura_sem_conversao_nem_utm():
    lead = {"id": "x-1", "nome": "Só nome"}
    nota = growthhs.nota_de_abertura(lead, conversao=None, consentimento=None,
                                     frontend_url="", quando=QUANDO)
    assert nota == ["Lead enviado pelo MarketingHS (MarketingHS) em 26/10/2026 10:00."]


@pytest.mark.parametrize("q", ["\n", "\r\n", "\x0b", " "])
def test_nota_de_abertura_nao_forja_linha(q):
    golpe = f"Acme{q}Pedido MarketingHS: 7{q}Ver no MarketingHS: https://golpe.invalid"
    lead = {**LEAD_NOVO, "empresa": golpe, "utm_source": golpe,
            "campos_extras": {f"k{q}Lead score": golpe}}
    nota = _abertura(lead=lead, conversao={**CONVERSAO, "page_slug": golpe})
    assert all("\n" not in l and "\r" not in l and " " not in l for l in nota)
    assert [l for l in nota if l.startswith("Ver no MarketingHS")] == [
        f"Ver no MarketingHS: {FRONT}/contacts?contato={CONTATO['id']}"]
    assert not any(l.startswith(("Pedido MarketingHS", "Lead score: 1")) for l in nota)
    assert not growthhs.card_do_pedido("\n".join(nota), 7)


# ── Banco (transação revertida, `lead_conversions` temporária) ───────────────

async def _lead_conversions_temporaria(conexao, *, com_031: bool):
    await conexao.execute(
        "CREATE TEMP TABLE lead_conversions (LIKE public.lead_conversions "
        "INCLUDING DEFAULTS) ON COMMIT DROP")
    # A cópia nasce com a forma de ANTES da 031 — com a 031 já no `public`
    # (banco local de teste, ou produção depois de aplicada), o LIKE traria
    # a coluna.
    await conexao.execute(
        "ALTER TABLE pg_temp.lead_conversions DROP COLUMN IF EXISTS dados_informados")
    # O nome sem schema (o do `registro.py`) tem que cair na temporária.
    assert await conexao.fetchval(
        "SELECT n.nspname LIKE 'pg_temp%' FROM pg_class c JOIN pg_namespace n "
        "ON n.oid = c.relnamespace WHERE c.oid = 'lead_conversions'::regclass")
    if com_031:
        sql = MIGRATION.read_text().replace("public.lead_conversions",
                                            "pg_temp.lead_conversions")
        await conexao.execute(sql)


async def test_031_reaplicavel(conexao):
    await _lead_conversions_temporaria(conexao, com_031=False)
    sql = MIGRATION.read_text()
    assert "CREATE EXTENSION" not in sql.upper()
    sql = sql.replace("public.lead_conversions", "pg_temp.lead_conversions")
    await conexao.execute(sql)
    await conexao.execute(sql)
    tipo = await conexao.fetchval(
        """SELECT format_type(atttypid, atttypmod) FROM pg_attribute
            WHERE attrelid = 'pg_temp.lead_conversions'::regclass
              AND attname = 'dados_informados' AND NOT attisdropped""")
    assert tipo == "jsonb"


EMAIL = f"reconversao-{uuid.uuid4().hex[:10]}@exemplo.invalid"


async def _capturar(conexao, campos, extras=None):
    return await registrar_captura(
        conexao, email=EMAIL, campos=campos, extras=extras or {},
        origem=Origem(form_id="reconversao-teste"), session_id=None,
        consentimento=None, tags=[])


async def _envelhecer(conexao, lead_id):
    """Tudo aqui é UMA transação, e `now()` é o início dela: as conversões
    sairiam com o mesmo `converted_at`. A anterior recua um minuto."""
    await conexao.execute(
        "UPDATE lead_conversions SET converted_at = converted_at - interval '1 minute' "
        "WHERE lead_id = $1::uuid", lead_id)


def _telefone():
    return "+55119" + str(uuid.uuid4().int)[:8]


async def test_reconversao_guarda_o_informado_e_nao_toca_o_contato(conexao):
    await _lead_conversions_temporaria(conexao, com_031=True)
    tel_antigo, tel_novo = _telefone(), _telefone()
    lead_id = await _capturar(conexao, {"nome": "Lead Um", "empresa": "Filial Sul",
                                        "whatsapp": tel_antigo}, {"porte": "P"})
    await _envelhecer(conexao, lead_id)
    assert await _capturar(conexao, {"nome": "Lead Um", "empresa": "Matriz",
                                     "whatsapp": tel_novo, "status": "cliente"},
                           {"porte": "G"}) == lead_id

    lead = await conexao.fetchrow(
        "SELECT empresa, whatsapp, status, campos_extras FROM leads WHERE id = $1::uuid",
        lead_id)
    assert (lead["empresa"], lead["whatsapp"]) == ("Filial Sul", tel_antigo)
    assert lead["campos_extras"] == {"porte": "P"}

    conversoes = await conexao.fetch(
        "SELECT dados_informados FROM lead_conversions WHERE lead_id = $1::uuid "
        "ORDER BY converted_at", lead_id)
    informados = [c["dados_informados"] for c in conversoes]
    assert len(informados) == 2
    assert {"empresa": "Filial Sul", "whatsapp": tel_antigo}.items() <= informados[0].items()
    assert informados[1] == {"nome": "Lead Um", "empresa": "Matriz", "whatsapp": tel_novo,
                             "campos_extras": {"porte": "G"}}

    [evento] = await conexao.fetch(
        """SELECT metadata FROM contact_events
            WHERE lead_id = $1::uuid AND event_type = 'form_submitted'
              AND (metadata->>'reconversao')::boolean""", lead_id)
    assert evento["metadata"]["informados_diferentes"] == [
        {"chave": "empresa", "rotulo": "Empresa", "valor": "Matriz"},
        {"chave": "whatsapp", "rotulo": "Telefone", "valor": tel_novo},
        {"chave": "porte", "rotulo": "porte", "valor": "G"}]


async def test_reconversao_igual_ou_que_so_preenche_nao_vira_divergencia(conexao):
    await _lead_conversions_temporaria(conexao, com_031=True)
    lead_id = await _capturar(conexao, {"nome": "Lead Um"})
    await _capturar(conexao, {"nome": "LEAD UM", "empresa": "Preencheu agora"})
    assert (await conexao.fetchval("SELECT empresa FROM leads WHERE id = $1::uuid",
                                   lead_id)) == "Preencheu agora"
    [evento] = await conexao.fetch(
        """SELECT metadata FROM contact_events
            WHERE lead_id = $1::uuid AND event_type = 'form_submitted'
              AND (metadata->>'reconversao')::boolean""", lead_id)
    assert "informados_diferentes" not in evento["metadata"]


async def test_sem_a_031_a_captura_segue(conexao):
    await _lead_conversions_temporaria(conexao, com_031=False)
    lead_id = await _capturar(conexao, {"nome": "Lead Um", "empresa": "Filial Sul"})
    await _capturar(conexao, {"empresa": "Matriz"})
    assert await conexao.fetchval(
        "SELECT count(*) FROM lead_conversions WHERE lead_id = $1::uuid", lead_id) == 2


async def test_origem_do_card_le_o_informado_e_nao_quebra_sem_a_031(conexao):
    await _lead_conversions_temporaria(conexao, com_031=False)
    lead_id = await _capturar(conexao, {"nome": "Lead Um", "empresa": "Filial Sul"})
    conversao, _ = await entrega.origem_do_card(conexao, lead_id)
    assert conversao["dados_informados"] is None
    sql = MIGRATION.read_text().replace("public.lead_conversions", "pg_temp.lead_conversions")
    await conexao.execute(sql)
    await _envelhecer(conexao, lead_id)
    await _capturar(conexao, {"empresa": "Matriz"})
    conversao, _ = await entrega.origem_do_card(conexao, lead_id)
    assert conversao["dados_informados"] == {"empresa": "Matriz"}
    assert re.match(r"\d{4}-\d{2}-\d{2}T", conversao["converted_at"])
