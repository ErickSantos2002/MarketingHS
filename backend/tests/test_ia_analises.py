"""As duas análises. Sem rede: o que se prova é o SCHEMA.

O prompt de origem pedia JSON por favor. Aqui o formato é garantido pela API —
e o schema tem de bater exatamente com o que o frontend já lê, senão a tela
quebra em silêncio.
"""

from app.routers import ia


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
