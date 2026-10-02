"""Regra de automação por tag: nem salva, nem conta (U5, raio-x de 02/10/2026).

O gatilho que avalia as regras (019/020) não tem ramo 'tag', e aplicar tag
grava `lead_tags`, não `leads` — a regra nunca dispararia. O 8D já recusava ao
SALVAR, mas a prévia continuava contando: a tela dizia "N contatos atendem"
para uma regra que não manda ninguém. Implementar o disparo por tag fica para
a frente de qualificação; até lá a prévia recusa com a mesma mensagem.
"""

from app.routers.automacoes import MSG_TAG, Condicao, _condicao_sql


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_tag_nao_vira_sql_de_contagem():
    params: list = []
    assert _condicao_sql(Condicao(type="tag", operator="contains", value="x"), params) is None
    assert params == []


async def test_previa_recusa_condicao_por_tag(cliente, token_admin):
    for corpo in (
        {"conditions": [{"type": "tag", "operator": "contains", "value": "x"}]},
        {"condition_type": "tag", "condition_operator": "contains", "condition_value": "x"},
    ):
        r = await cliente.post("/automacoes/previa", headers=_auth(token_admin), json=corpo)
        assert r.status_code == 400, r.text
        assert r.json()["detail"] == MSG_TAG


async def test_previa_sem_tag_continua_contando(cliente, token_admin):
    r = await cliente.post("/automacoes/previa", headers=_auth(token_admin),
                           json={"conditions": [{"type": "score", "operator": "greater_than",
                                                 "value": "1000"}]})
    assert r.status_code == 200, r.text
    assert r.json()["total"] == 0
