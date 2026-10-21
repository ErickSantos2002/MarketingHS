"""PDF no armazenamento de e-mail (prova do RD, Tarefa 9 — a ficha técnica).

O PDF vai em `email_assets` com `pasta = 'arquivos'` e sai por uma rota pública
própria (`/publico/arquivo/<id>`), com link estável para pôr no e-mail.

⚠️ O `cliente` COMITA: a fixture `assets` apaga por id tudo o que o teste subiu.
"""

import pytest
import pytest_asyncio

import app.database as db
from app.config import settings

PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
PNG = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
       b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\x0f"
       b"\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82")


@pytest_asyncio.fixture
async def assets():
    ids = []
    yield ids
    if ids:
        await db.init_db()
        async with db.sessao(role="service_role") as conn:
            await conn.execute("DELETE FROM email_assets WHERE id = ANY($1::uuid[])", ids)


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _subir(cliente, token, dados, tipo="application/pdf",
                 nome="Ficha Técnica Phoebus.pdf", rota="/arquivos"):
    return await cliente.post(rota, headers=_auth(token),
                              files={"arquivo": (nome, dados, tipo)})


async def test_sobe_pdf_e_serve_inline_com_cabecalhos(cliente, token_admin, assets):
    r = await _subir(cliente, token_admin, PDF)
    assert r.status_code == 201, r.text
    corpo = r.json()
    assets.append(corpo["id"])
    assert corpo["tamanho"] == len(PDF)
    assert corpo["url"] == f"/publico/arquivo/{corpo['id']}"
    assert corpo["url_publica"] == (
        f"{settings.FRONTEND_URL}/api/publico/arquivo/{corpo['id']}")

    s = await cliente.get(corpo["url"])
    assert s.status_code == 200
    assert s.content == PDF
    assert s.headers["content-type"] == "application/pdf"
    assert s.headers["content-disposition"].startswith("inline; filename=\"")
    assert s.headers["content-disposition"].endswith(".pdf\"")
    assert s.headers["content-disposition"] == 'inline; filename="Ficha-Tecnica-Phoebus.pdf"'
    assert s.headers["x-content-type-options"] == "nosniff"
    assert s.headers["content-security-policy"] == "sandbox"
    assert s.headers["cache-control"] == "public, max-age=31536000, immutable"

    lista = await cliente.get("/arquivos", headers=_auth(token_admin))
    assert lista.status_code == 200
    [meu] = [a for a in lista.json() if a["id"] == corpo["id"]]
    assert meu["nome"] == "Ficha Técnica Phoebus.pdf"
    assert meu["url_publica"] == corpo["url_publica"]
    assert meu["criado_em"]


async def test_recusa_pdf_falso(cliente, token_admin):
    r = await _subir(cliente, token_admin, b"<html>nao sou pdf</html>")
    assert r.status_code == 400
    r = await _subir(cliente, token_admin, PDF, tipo="text/html")
    assert r.status_code == 400


async def test_recusa_vazio(cliente, token_admin):
    r = await _subir(cliente, token_admin, b"")
    assert r.status_code == 400


async def test_recusa_acima_de_10mb(cliente, token_admin):
    r = await _subir(cliente, token_admin, PDF + b"0" * (10 * 1024 * 1024))
    assert r.status_code == 413


async def test_arquivo_exige_admin(cliente, token_usuario):
    assert (await _subir(cliente, token_usuario, PDF)).status_code == 403
    assert (await cliente.get("/arquivos", headers=_auth(token_usuario))).status_code == 403
    assert (await cliente.post("/arquivos", files={
        "arquivo": ("a.pdf", PDF, "application/pdf")})).status_code == 401


async def test_imagens_continua_recusando_pdf(cliente, token_admin):
    r = await _subir(cliente, token_admin, PDF, rota="/imagens")
    assert r.status_code == 400


@pytest.mark.parametrize("ident", ["nao-e-uuid", "1; DROP TABLE x",
                                   "00000000-0000-0000-0000-000000000000"])
async def test_servir_id_malformado_404(cliente, ident):
    assert (await cliente.get(f"/publico/arquivo/{ident}")).status_code == 404


async def test_rota_de_arquivo_nao_serve_imagem(cliente, token_admin, assets):
    r = await _subir(cliente, token_admin, PNG, tipo="image/png", nome="x.png",
                     rota="/imagens")
    assert r.status_code == 201, r.text
    assets.append(r.json()["id"])
    assert (await cliente.get(f"/publico/arquivo/{r.json()['id']}")).status_code == 404
    # E a imagem não aparece na lista de arquivos.
    lista = (await cliente.get("/arquivos", headers=_auth(token_admin))).json()
    assert r.json()["id"] not in [a["id"] for a in lista]


async def test_rota_de_imagem_nao_serve_pdf(cliente, token_admin, assets):
    """Sem isto o PDF sairia pela rota de imagem, sem `nosniff` nem
    `sandbox` — os cabeçalhos que a rota de arquivo põe de propósito."""
    r = await _subir(cliente, token_admin, PDF)
    assets.append(r.json()["id"])
    assert (await cliente.get(f"/publico/imagem/{r.json()['id']}")).status_code == 404


@pytest.mark.parametrize("bruto,seguro", [
    ('a"\r\nX-Injetado: 1.PDF', "a-X-Injetado-1.pdf"),
    ("", "arquivo.pdf"),
    ("...", "arquivo.pdf"),
    ("Manual Ação.pdf", "Manual-Acao.pdf"),
])
def test_nome_no_cabecalho_e_seguro(bruto, seguro):
    from app.routers.imagens import _nome_seguro
    assert _nome_seguro(bruto) == seguro
