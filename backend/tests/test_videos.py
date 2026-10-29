"""Vídeo hospedado da landing (frente video-proprio, 29/10/2026).

O editor sobe o MP4/WebM (`POST /videos`, só admin) e a landing o toca num
`<video>` nosso, servido por `GET /publico/video/{id}` — público, com Range.
⚠️ O Safari do iPhone NÃO toca vídeo de servidor sem `206`: ele começa com
`Range: bytes=0-1` e só segue se receber `206` com `Content-Range`.

⚠️ O `cliente` COMITA: a fixture `videos` apaga por id o que o teste subiu.
"""

import pathlib
import re

import pytest
import pytest_asyncio

import app.database as db
from app.routers import videos as rota

# Um MP4 de mentira: a caixa `ftyp` no começo (a assinatura que a rota
# confere) e bytes conhecidos depois, para o teste de Range comparar fatia.
MP4 = (b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom"
       + bytes(range(256)) * 1200)                      # ~300 KB
WEBM = b"\x1a\x45\xdf\xa3\x9f\x42\x86\x81\x01\x42\x82\x84webm" + b"\x00" * 4000
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100


@pytest_asyncio.fixture
async def videos():
    ids = []
    yield ids
    if ids:
        await db.init_db()
        async with db.sessao(role="service_role") as conn:
            await conn.execute("DELETE FROM landing_videos WHERE id = ANY($1::uuid[])", ids)


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _subir(cliente, token, dados, tipo="video/mp4", nome="Phoebus Pro.mp4"):
    return await cliente.post("/videos", headers=_auth(token),
                              files={"arquivo": (nome, dados, tipo)})


async def _subido(cliente, token, videos, dados=MP4, tipo="video/mp4"):
    r = await _subir(cliente, token, dados, tipo=tipo)
    assert r.status_code == 201, r.text
    videos.append(r.json()["id"])
    return r.json()


# ── Migration (sem banco) ────────────────────────────────────────────────────

def test_037_reaplicavel_e_sem_compressao():
    arquivo = (pathlib.Path(__file__).resolve().parent.parent
               / "migrations" / "037_videos_da_landing.sql")
    sql = re.sub(r"--[^\n]*", "", arquivo.read_text(encoding="utf-8"))
    assert "CREATE EXTENSION" not in sql
    assert not re.search(r"CREATE TABLE (?!IF NOT EXISTS)", sql)
    assert not re.search(r"CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)", sql)
    assert not re.search(r"CREATE POLICY", sql)
    # O substring só lê o trecho se o valor estiver fora da linha e cru.
    assert "SET STORAGE EXTERNAL" in sql


# ── Leitura do Range (sem banco) ─────────────────────────────────────────────

@pytest.mark.parametrize("cabecalho,esperado", [
    ("bytes=0-1", (0, 1)),
    ("bytes=0-", (0, 999)),
    ("bytes=10-19", (10, 19)),
    ("bytes=990-5000", (990, 999)),         # o fim passa do tamanho: corta
    ("bytes=-100", (900, 999)),             # sufixo: os últimos 100
    ("bytes=-5000", (0, 999)),
    (" bytes = 5 - 6 ", (5, 6)),
])
def test_intervalo_valido(cabecalho, esperado):
    assert rota.intervalo(cabecalho, 1000) == esperado


@pytest.mark.parametrize("cabecalho", [
    "bytes=1000-", "bytes=1000-1001",       # começa no fim ou depois
    "bytes=20-10",                          # fim antes do começo
    "bytes=-0", "bytes=-", "bytes=", "bytes=a-b", "items=0-1",
    "bytes=0-1,5-6",                        # vários trechos: não servimos
])
def test_intervalo_invalido(cabecalho):
    assert rota.intervalo(cabecalho, 1000) is None


# ── Upload ───────────────────────────────────────────────────────────────────

async def test_sobe_mp4_e_devolve_o_caminho(cliente, token_admin, videos):
    corpo = await _subido(cliente, token_admin, videos)
    assert corpo["url"] == f"/publico/video/{corpo['id']}"
    assert corpo["tamanho"] == len(MP4)
    assert corpo["tipo"] == "video/mp4"


async def test_sobe_webm(cliente, token_admin, videos):
    corpo = await _subido(cliente, token_admin, videos, dados=WEBM, tipo="video/webm")
    s = await cliente.get(corpo["url"])
    assert s.status_code == 200
    assert s.headers["content-type"] == "video/webm"
    assert s.content == WEBM


async def test_tipo_vem_dos_bytes_nao_do_navegador(cliente, token_admin, videos):
    """O navegador às vezes manda `application/octet-stream` (ou nada útil)
    para .mp4. Aceitamos se os BYTES forem de vídeo — e gravamos o tipo que
    os bytes dizem, não o declarado."""
    r = await _subir(cliente, token_admin, MP4, tipo="application/octet-stream")
    assert r.status_code == 201, r.text
    videos.append(r.json()["id"])
    assert r.json()["tipo"] == "video/mp4"


@pytest.mark.parametrize("dados,tipo", [
    (PNG, "video/mp4"),                         # bytes de imagem, tipo de vídeo
    (b"<html><script>alert(1)</script>", "video/mp4"),
    (MP4, "text/html"),                         # tipo declarado fora da lista
    (MP4, "image/svg+xml"),
    (b"\x1a\x45\xdf\xa3" + b"\x00" * 60, "video/webm"),   # EBML, mas não é WebM
])
async def test_recusa_o_que_nao_e_video(cliente, token_admin, dados, tipo):
    r = await _subir(cliente, token_admin, dados, tipo=tipo)
    assert r.status_code == 400, r.text


async def test_recusa_vazio(cliente, token_admin):
    assert (await _subir(cliente, token_admin, b"")).status_code == 400


async def test_recusa_acima_do_teto(cliente, token_admin, monkeypatch):
    # Teto baixo no teste: subir 60 MB a cada rodada da suíte é desperdício.
    monkeypatch.setattr(rota, "TAMANHO_MAXIMO", len(MP4) - 1)
    r = await _subir(cliente, token_admin, MP4)
    assert r.status_code == 413
    assert "MB" in r.json()["detail"]


async def test_upload_exige_admin(cliente, token_usuario):
    assert (await _subir(cliente, token_usuario, MP4)).status_code == 403
    assert (await cliente.post("/videos", files={
        "arquivo": ("a.mp4", MP4, "video/mp4")})).status_code == 401


async def test_leitura_leva_403(cliente):
    from conftest import _apagar_usuario_de_teste, _criar_usuario_de_teste
    uid, token = await _criar_usuario_de_teste("usuario-teste-8c", "leitura")
    try:
        assert (await _subir(cliente, token, MP4)).status_code == 403
    finally:
        await _apagar_usuario_de_teste(uid)


# ── Servir ───────────────────────────────────────────────────────────────────

async def test_200_inteiro_com_cabecalhos(cliente, token_admin, videos):
    corpo = await _subido(cliente, token_admin, videos)
    s = await cliente.get(corpo["url"])
    assert s.status_code == 200
    assert s.content == MP4
    h = s.headers
    assert h["content-type"] == "video/mp4"
    assert h["content-length"] == str(len(MP4))
    assert h["accept-ranges"] == "bytes"
    assert h["cache-control"] == "public, max-age=31536000, immutable"
    assert h["etag"] == f'"{corpo["id"]}"'
    assert h["x-content-type-options"] == "nosniff"


async def test_200_inteiro_maior_que_um_pedaco(cliente, token_admin, videos, monkeypatch):
    """O 200 sai em pedaços (`PEDACO`), sem ler o arquivo todo de uma vez."""
    monkeypatch.setattr(rota, "PEDACO", 1000)
    corpo = await _subido(cliente, token_admin, videos)
    s = await cliente.get(corpo["url"])
    assert s.status_code == 200
    assert s.content == MP4


async def test_206_sonda_do_safari(cliente, token_admin, videos):
    corpo = await _subido(cliente, token_admin, videos)
    s = await cliente.get(corpo["url"], headers={"Range": "bytes=0-1"})
    assert s.status_code == 206
    assert s.content == MP4[:2]
    assert s.headers["content-range"] == f"bytes 0-1/{len(MP4)}"
    assert s.headers["content-length"] == "2"
    assert s.headers["accept-ranges"] == "bytes"
    assert s.headers["etag"] == f'"{corpo["id"]}"'


async def test_206_meio_aberto_e_sufixo(cliente, token_admin, videos, monkeypatch):
    monkeypatch.setattr(rota, "PEDACO", 4096)
    corpo = await _subido(cliente, token_admin, videos)
    n = len(MP4)
    s = await cliente.get(corpo["url"], headers={"Range": "bytes=100000-"})
    assert s.status_code == 206
    assert s.content == MP4[100000:]
    assert s.headers["content-range"] == f"bytes 100000-{n - 1}/{n}"
    s = await cliente.get(corpo["url"], headers={"Range": "bytes=12345-23456"})
    assert s.status_code == 206
    assert s.content == MP4[12345:23457]
    s = await cliente.get(corpo["url"], headers={"Range": "bytes=-500"})
    assert s.status_code == 206
    assert s.content == MP4[-500:]


async def test_416_fora_do_arquivo(cliente, token_admin, videos):
    corpo = await _subido(cliente, token_admin, videos)
    n = len(MP4)
    for cab in (f"bytes={n}-", "bytes=50-10", "bytes=abc"):
        s = await cliente.get(corpo["url"], headers={"Range": cab})
        assert s.status_code == 416, cab
        assert s.headers["content-range"] == f"bytes */{n}"


async def test_head_sem_corpo(cliente, token_admin, videos):
    corpo = await _subido(cliente, token_admin, videos)
    s = await cliente.head(corpo["url"])
    assert s.status_code == 200
    assert s.content == b""
    assert s.headers["content-length"] == str(len(MP4))
    assert s.headers["accept-ranges"] == "bytes"
    assert s.headers["content-type"] == "video/mp4"
    s = await cliente.head(corpo["url"], headers={"Range": "bytes=0-1"})
    assert s.status_code == 206
    assert s.content == b""
    assert s.headers["content-range"] == f"bytes 0-1/{len(MP4)}"


async def test_304_com_o_etag(cliente, token_admin, videos):
    corpo = await _subido(cliente, token_admin, videos)
    s = await cliente.get(corpo["url"], headers={"If-None-Match": f'"{corpo["id"]}"'})
    assert s.status_code == 304
    assert s.content == b""


@pytest.mark.parametrize("ident", ["nao-e-uuid", "1; DROP TABLE x",
                                   "00000000-0000-0000-0000-000000000000"])
async def test_id_ruim_404(cliente, ident):
    assert (await cliente.get(f"/publico/video/{ident}")).status_code == 404


async def test_rota_publica_nao_gasta_a_cota_do_formulario():
    """Um vídeo tocando pede vários trechos por minuto (o Safari, dezenas).
    No balde comum de `/publico` (30/min, o mesmo de `/publico/captura`), a
    pessoa que viu o vídeo levaria 429 ao mandar o formulário."""
    from app.main import app
    from app.middleware.limite_taxa import LimiteTaxaMiddleware
    baldes = [m for m in app.user_middleware if m.cls is LimiteTaxaMiddleware]
    comum = [m for m in baldes if "/publico" in m.kwargs["prefixos"]]
    assert comum and all("/publico/video/" in m.kwargs.get("isentos", ())
                         for m in comum)
    proprio = [m for m in baldes if m.kwargs["prefixos"] == ("/publico/video/",)]
    assert proprio and proprio[0].kwargs["por_minuto"] == rota.LIMITE_POR_MINUTO


# ── Apagar (frente faxina-tecnica, 29/10) ────────────────────────────────────
# Trocar o vídeo no editor deixava o anterior no banco (e no dump). Apagar é
# só admin e nunca leva vídeo que alguma página ainda usa — a landing ficaria
# com o player quebrado.

@pytest_asyncio.fixture
async def pagina_com():
    """Cria página (rascunho) cuja config aponta para o vídeo; apaga no fim."""
    import uuid as _uuid
    slugs = []

    async def _criar(video_id: str, maiusculo: bool = False):
        slug = f"faxina-video-{_uuid.uuid4().hex[:8]}"
        alvo = video_id.upper() if maiusculo else video_id
        # Objeto, não texto: o pool codifica jsonb (texto viraria string JSON).
        config = {"secoes": [{"tipo": "video", "arquivo_url": f"/publico/video/{alvo}"}]}
        async with db.sessao(role="service_role") as conn:
            await conn.execute(
                """INSERT INTO pages (name, slug, component_name, page_type, status, config)
                   VALUES ('Faxina vídeo', $1, 'FaxinaVideo', 'landing', 'draft', $2::jsonb)""",
                slug, config)
        slugs.append(slug)

    yield _criar
    if slugs:
        await db.init_db()
        async with db.sessao(role="service_role") as conn:
            await conn.execute("DELETE FROM pages WHERE slug = ANY($1::text[])", slugs)


async def _existe(video_id: str) -> bool:
    async with db.sessao(role="service_role") as conn:
        return await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM landing_videos WHERE id = $1::uuid)", video_id)


async def _criado_em(video_id: str):
    async with db.sessao(role="service_role") as conn:
        return await conn.fetchval(
            "SELECT criado_em FROM landing_videos WHERE id = $1::uuid", video_id)


async def test_apagar_orfao(cliente, token_admin, videos):
    v = await _subido(cliente, token_admin, videos)
    r = await cliente.delete(f"/videos/{v['id']}", headers=_auth(token_admin))
    assert r.status_code == 204, r.text
    assert not await _existe(v["id"])
    assert (await cliente.get(f"/publico/video/{v['id']}")).status_code == 404


async def test_apagar_referenciado_409(cliente, token_admin, videos, pagina_com):
    v = await _subido(cliente, token_admin, videos)
    await pagina_com(v["id"], maiusculo=True)  # o uuid em caixa alta também conta
    r = await cliente.delete(f"/videos/{v['id']}", headers=_auth(token_admin))
    assert r.status_code == 409
    assert "página" in r.json()["detail"]
    assert await _existe(v["id"])


async def test_apagar_inexistente_404(cliente, token_admin):
    for ident in ("00000000-0000-0000-0000-000000000000", "nao-e-uuid"):
        r = await cliente.delete(f"/videos/{ident}", headers=_auth(token_admin))
        assert r.status_code == 404


async def test_apagar_exige_admin(cliente, token_admin, token_usuario, videos):
    from conftest import _apagar_usuario_de_teste, _criar_usuario_de_teste
    v = await _subido(cliente, token_admin, videos)
    assert (await cliente.delete(f"/videos/{v['id']}")).status_code == 401
    assert (await cliente.delete(f"/videos/{v['id']}",
                                 headers=_auth(token_usuario))).status_code == 403
    uid, token = await _criar_usuario_de_teste("usuario-teste-8c", "leitura")
    try:
        assert (await cliente.delete(f"/videos/{v['id']}",
                                     headers=_auth(token))).status_code == 403
        assert (await cliente.delete("/videos/orfaos",
                                     headers=_auth(token))).status_code == 403
    finally:
        await _apagar_usuario_de_teste(uid)
    assert (await cliente.delete("/videos/orfaos",
                                 headers=_auth(token_usuario))).status_code == 403
    assert await _existe(v["id"])


def test_carencia_da_faxina_e_de_uma_hora():
    from datetime import datetime, timedelta, timezone
    corte = rota._corte()
    agora = datetime.now(timezone.utc)
    assert timedelta(minutes=59) < agora - corte < timedelta(minutes=61)


async def test_faxina_dos_orfaos(cliente, token_admin, videos, pagina_com, monkeypatch):
    """Apaga só o que nenhuma página usa E passou da carência — o vídeo
    recém-subido de uma página que ainda não foi salva fica.

    ⚠️ Sem UPDATE em `landing_videos` (a 037 só dá SELECT/INSERT/DELETE), o
    teste não envelhece o vídeo: move o corte para o instante do `recente`."""
    orfao = await _subido(cliente, token_admin, videos)
    usado = await _subido(cliente, token_admin, videos)
    recente = await _subido(cliente, token_admin, videos)
    await pagina_com(usado["id"])
    corte = await _criado_em(recente["id"])
    monkeypatch.setattr(rota, "_corte", lambda: corte)
    r = await cliente.delete("/videos/orfaos", headers=_auth(token_admin))
    assert r.status_code == 200, r.text
    assert r.json()["apagados"] >= 1
    assert not await _existe(orfao["id"])
    assert await _existe(usado["id"])
    assert await _existe(recente["id"])
