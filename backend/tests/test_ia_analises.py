"""As duas análises. Sem rede: o que se prova é o SCHEMA.

O prompt de origem pedia JSON por favor. Aqui o formato é garantido pela API —
e o schema tem de bater exatamente com o que o frontend já lê, senão a tela
quebra em silêncio.
"""

import uuid

import pytest
from fastapi import HTTPException

from app import database as db
from app.dependencies import Usuario, admin_atual
from app.routers import ia


def test_todas_as_rotas_de_ia_exigem_admin():
    """`leads` só é legível por admin sob RLS (migration de origem). Com
    `usuario_atual` um não-admin não levaria 403 — levaria ZERO linhas, e o
    modelo afirmaria o zero como fato. Varre `ia.router.routes` em vez de
    listar rota por rota: uma rota nova que nasça com `usuario_atual` quebra
    este teste em vez de passar despercebida."""
    rotas = list(ia.router.routes)
    assert rotas, "o router de IA não tem rota nenhuma — o teste não provaria nada"
    for rota in rotas:
        dependencias = [d.call for d in rota.dependant.dependencies]
        assert admin_atual in dependencias, (
            f"{rota.methods} {rota.path} não depende de admin_atual")


def test_o_schema_de_leads_bate_com_o_que_a_tela_le():
    """Os nomes vêm de frontend/src/hooks/useAIAnalysis.tsx:5-22. Mudar um
    deles aqui quebra a tela sem erro de compilação."""
    props = ia.ESQUEMA_LEADS["properties"]
    assert set(props) == {
        "summary", "demographics", "patterns", "challenges",
        "recommendations", "icp",
    }
    assert set(props["demographics"]["properties"]) == {
        "cargos", "faturamentos", "funcionarios"}
    assert set(props["patterns"]["properties"]) == {
        "bestDays", "bestHours", "conversionInsights"}
    assert set(props["challenges"]["properties"]) == {
        "mainThemes", "opportunities"}
    item = props["demographics"]["properties"]["cargos"]["items"]
    assert set(item["properties"]) == {"name", "count", "percentage"}


def test_o_schema_de_desafios_bate_com_o_que_a_tela_le():
    """Os nomes vêm de ChallengesAIInsights.tsx:44-53."""
    props = ia.ESQUEMA_DESAFIOS["properties"]
    assert set(props) == {
        "patterns", "copyRecommendations", "contentSuggestions",
        "gems", "opportunities",
    }
    assert set(props["gems"]["items"]["properties"]) == {"response", "reason"}


def test_os_schemas_sao_fechados():
    """`additionalProperties: false` em todo nível de objeto — é o que faz a
    API garantir o formato em vez de o prompt pedir."""
    def conferir(no, caminho="raiz"):
        if no.get("type") == "object":
            assert no.get("additionalProperties") is False, caminho
            assert "required" in no, caminho
            for nome, filho in no.get("properties", {}).items():
                conferir(filho, f"{caminho}.{nome}")
        elif no.get("type") == "array":
            conferir(no["items"], f"{caminho}[]")

    conferir(ia.ESQUEMA_LEADS)
    conferir(ia.ESQUEMA_DESAFIOS)


async def _algum_admin() -> str | None:
    """Um `user_id` real com o papel `admin` em `user_roles` — a política de
    origem ("Admins can delete challenge insights") checa `has_role`, não
    aceita qualquer uuid. Sem isso o DELETE bateria em RLS e o teste
    confundiria "sem permissão" com "a rota está errada"."""
    await db.init_db()
    if db._pool is None:
        return None
    async with db.sessao(role="service_role") as conn:
        return await conn.fetchval(
            "SELECT user_id::text FROM user_roles WHERE role = 'admin' LIMIT 1")


@pytest.mark.asyncio
async def test_apagar_insight_remove_a_linha():
    """DELETE de verdade: insere comitado (por fora da rota, com
    service_role), chama a rota e confere que a linha sumiu."""
    admin_id = await _algum_admin()
    if admin_id is None:
        pytest.skip("sem DATABASE_URL, ou nenhum admin em user_roles")

    async with db.sessao(role="service_role") as conn:
        insight_id = await conn.fetchval(
            """INSERT INTO challenge_insights (insights, leads_analyzed)
               VALUES ($1::jsonb, 3) RETURNING id::text""",
            '{"patterns": ["teste"]}')

    usuario = Usuario(id=admin_id, email="teste@exemplo.invalid", papel="admin")
    await ia.apagar_insight(insight_id, usuario)

    async with db.sessao(role="service_role") as conn:
        restante = await conn.fetchval(
            "SELECT id FROM challenge_insights WHERE id = $1::uuid", insight_id)
    assert restante is None
    await db.close_db()


@pytest.mark.asyncio
async def test_apagar_insight_inexistente_da_404_nao_200():
    """⚠️ Devolver 200 para um DELETE que não apagou nada é a mesma falha
    silenciosa — permissão errada e ausência viram a mesma resposta — que o
    resto deste router existe para não repetir, agora na escrita."""
    admin_id = await _algum_admin()
    if admin_id is None:
        pytest.skip("sem DATABASE_URL, ou nenhum admin em user_roles")

    usuario = Usuario(id=admin_id, email="teste@exemplo.invalid", papel="admin")
    with pytest.raises(HTTPException) as excinfo:
        await ia.apagar_insight(str(uuid.uuid4()), usuario)
    assert excinfo.value.status_code == 404
    await db.close_db()
