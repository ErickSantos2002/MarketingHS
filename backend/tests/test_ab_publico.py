"""O redirecionador e o coletor do A/B — o que eram as functions `go` e
`ab-events`. Ninguém abre estas rotas na tela: quem chama é o clique do
anúncio e o `ab.js` da landing.

O modo de falhar do redirecionador é mandar o clique para o lugar errado (fora
do domínio, variante trocada entre visitas) ou deixar o visitante numa página
de erro. O do coletor é perder evento, ou contar a mesma exposição duas vezes
— e o relatório mente para os dois lados.
"""

import json
from urllib.parse import parse_qsl, urlsplit
from uuid import uuid4

import app.database as db
from app.ab import dominio

CHROME_WIN = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
VARIANTES = [{"key": "A", "url": "https://lp.exemplo.invalid/a", "weight": 50},
             {"key": "B", "url": "https://lp.exemplo.invalid/b?x=1", "weight": 50}]


async def _teste(prefixo, status="running", sufixo="lp", variantes=None,
                 vencedora=None) -> str:
    """Grava um teste direto no banco e devolve a chave interna (`slug`)."""
    publico = f"{prefixo}-{sufixo}"
    slug = f"{publico}-{uuid4().hex[:4]}"
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            """INSERT INTO ab_tests (slug, public_slug, name, status, variants,
                                     control_variant, winner_variant)
               VALUES ($1, $2, 'Teste 8C', $3, $4::jsonb, 'A', $5)""",
            slug, publico, status, variantes or VARIANTES, vencedora)
    return slug


def _query(resposta) -> tuple[str, dict]:
    destino = urlsplit(resposta.headers["location"])
    return f"{destino.netloc}{destino.path}", dict(parse_qsl(destino.query))


async def _contar(tabela: str, slug: str, extra: str = "") -> int:
    async with db.sessao(role="service_role") as conn:
        return await conn.fetchval(
            f"SELECT count(*) FROM {tabela} WHERE ab_test = $1 {extra}", slug)


async def test_primeiro_clique_sorteia_grava_e_redireciona(
        cliente, config_ab, limpar_ab, monkeypatch):
    await config_ab("exemplo.invalid")
    slug = await _teste(limpar_ab)
    monkeypatch.setattr(dominio.random, "random", lambda: 0.9)

    r = await cliente.get(f"/publico/ab/go/{limpar_ab}-lp",
                          params={"utm_source": "google", "gclid": "abc"},
                          headers={"user-agent": CHROME_WIN})

    assert r.status_code == 302
    assert r.headers["cache-control"].startswith("no-store")
    lugar, q = _query(r)
    assert lugar == "lp.exemplo.invalid/b"
    assert q["x"] == "1" and q["utm_source"] == "google" and q["gclid"] == "abc"
    assert q["ab_test"] == slug and q["ab_var"] == "B" and q["ab_vid"].startswith("v_")

    cookies = r.headers.get_list("set-cookie")
    assert any(c.startswith(f"ab_{slug}=B%7C{q['ab_vid']}") and
               "Domain=.exemplo.invalid" in c and "Max-Age=7776000" in c for c in cookies)
    assert any(c.startswith(f"ab_vid={q['ab_vid']}") for c in cookies)

    async with db.sessao(role="service_role") as conn:
        atribuicao = await conn.fetchrow(
            "SELECT utm_source, gclid, device_type, browser FROM ab_assignments "
            "WHERE ab_test = $1", slug)
        evento = await conn.fetchrow(
            "SELECT event_type, event_name FROM ab_events WHERE ab_test = $1", slug)
    assert dict(atribuicao) == {"utm_source": "google", "gclid": "abc",
                                "device_type": "desktop", "browser": "Chrome"}
    assert dict(evento) == {"event_type": "assignment", "event_name": "new"}


async def test_volta_do_mesmo_visitante_mantem_a_variante(cliente, config_ab, limpar_ab):
    await config_ab("exemplo.invalid")
    slug = await _teste(limpar_ab)
    r = await cliente.get(f"/publico/ab/go/{limpar_ab}-lp", headers={
        "cookie": f"ab_vid=v_teste8c1; ab_{slug}=A%7Cv_teste8c1"})

    _, q = _query(r)
    assert q["ab_var"] == "A" and q["ab_vid"] == "v_teste8c1"
    # O visitante já tinha `ab_vid`: só o cookie do teste é regravado.
    assert not any(c.startswith("ab_vid=") for c in r.headers.get_list("set-cookie"))
    # A primeira atribuição não se repete; o clique, sim.
    assert await _contar("ab_assignments", slug) == 0
    assert await _contar("ab_events", slug, "AND event_name = 'sticky'") == 1


async def test_pausado_manda_tudo_para_o_controle_e_concluido_para_a_vencedora(
        cliente, config_ab, limpar_ab, monkeypatch):
    await config_ab("exemplo.invalid")
    monkeypatch.setattr(dominio.random, "random", lambda: 0.9)

    await _teste(limpar_ab, status="paused", sufixo="pausado")
    _, q = _query(await cliente.get(f"/publico/ab/go/{limpar_ab}-pausado"))
    assert q["ab_var"] == "A"

    await _teste(limpar_ab, status="completed", sufixo="concluido", vencedora="B")
    _, q = _query(await cliente.get(f"/publico/ab/go/{limpar_ab}-concluido"))
    assert q["ab_var"] == "B"


async def test_o_que_esta_rodando_vence_o_concluido_na_mesma_slug(
        cliente, config_ab, limpar_ab, monkeypatch):
    await config_ab("exemplo.invalid")
    monkeypatch.setattr(dominio.random, "random", lambda: 0.0)
    await _teste(limpar_ab, status="completed", vencedora="B")
    rodando = await _teste(limpar_ab)
    _, q = _query(await cliente.get(f"/publico/ab/go/{limpar_ab}-lp"))
    assert q["ab_test"] == rodando and q["ab_var"] == "A"


async def test_slug_por_query_e_t_nao_vai_para_o_destino(cliente, config_ab, limpar_ab):
    await config_ab("exemplo.invalid")
    slug = await _teste(limpar_ab)
    r = await cliente.get("/publico/ab/go", params={"t": f"{limpar_ab}-lp", "utm_medium": "cpc"})
    _, q = _query(r)
    assert q["ab_test"] == slug and q["utm_medium"] == "cpc" and "t" not in q


async def test_slug_desconhecida_vai_para_o_dominio_de_producao(cliente, config_ab, limpar_ab):
    await config_ab("exemplo.invalid")
    r = await cliente.get(f"/publico/ab/go/{limpar_ab}-nao-existe")
    assert r.status_code == 302
    assert r.headers["location"] == "https://exemplo.invalid"


async def test_sem_configuracao_e_sem_teste_e_404_curto(cliente, config_ab, limpar_ab):
    await config_ab(None)
    r = await cliente.get(f"/publico/ab/go/{limpar_ab}-nao-existe")
    assert r.status_code == 404


async def test_destino_fora_do_dominio_cai_na_reserva_sem_gravar(
        cliente, config_ab, limpar_ab):
    await config_ab("exemplo.invalid")
    slug = await _teste(limpar_ab, variantes=[
        {"key": "A", "url": "https://outro.invalid/a", "weight": 1}])
    r = await cliente.get(f"/publico/ab/go/{limpar_ab}-lp")
    assert r.headers["location"] == "https://exemplo.invalid"
    assert await _contar("ab_events", slug) == 0


async def test_redirecionador_nao_leva_429(cliente, config_ab, limpar_ab):
    """Clique de anúncio nunca pode levar 429 — decisão 6 do plano."""
    await config_ab(None)
    for _ in range(35):
        r = await cliente.get(f"/publico/ab/go/{limpar_ab}-nao-existe")
        assert r.status_code == 404
