"""A regra de mesclagem da importação.

Testada porque o erro dela é silencioso: em modo enriquecer, sobrescrever um
campo já preenchido apaga o que alguém digitou, e a tela diz "importado com
sucesso" nos dois casos.
"""
import pytest

from app.dominio.importacao import LinhaCsv, campos_para_gravar


def _existente(**kw):
    base = dict(nome="Maria", whatsapp="", empresa=None, cargo="Gerente",
                faturamento=None, funcionarios=None, desafios=None,
                source="site", status="Lead")
    base.update(kw)
    return base


def test_enriquecer_preenche_so_o_que_esta_vazio():
    linha = LinhaCsv(email="a@b.c", nome="Maria Souza", whatsapp="11999998888",
                     empresa="Acme")
    campos = campos_para_gravar(linha, _existente(), "enriquecer")
    # whatsapp era "" e empresa era None: os dois entram.
    assert campos == {"whatsapp": "11999998888", "empresa": "Acme"}
    # nome já tinha valor: não entra, mesmo o CSV trazendo um diferente.
    assert "nome" not in campos


def test_sobrescrever_grava_tudo_que_o_csv_trouxe():
    linha = LinhaCsv(email="a@b.c", nome="Maria Souza", empresa="Acme")
    campos = campos_para_gravar(linha, _existente(), "sobrescrever")
    assert campos == {"nome": "Maria Souza", "empresa": "Acme"}


def test_campo_vazio_no_csv_nunca_apaga_o_que_existe():
    # Vale para os DOIS modos: CSV sem valor não é instrução de apagar.
    linha = LinhaCsv(email="a@b.c", nome="", empresa=None)
    assert campos_para_gravar(linha, _existente(), "enriquecer") == {}
    assert campos_para_gravar(linha, _existente(), "sobrescrever") == {}


def test_status_invalido_e_ignorado_e_nao_vira_lixo_na_coluna():
    linha = LinhaCsv(email="a@b.c", status="Status Que Nao Existe")
    assert campos_para_gravar(linha, _existente(status=None), "sobrescrever") == {}


def test_status_valido_casa_sem_diferenciar_maiuscula():
    linha = LinhaCsv(email="a@b.c", status="lead qualificado")
    campos = campos_para_gravar(linha, _existente(status=None), "enriquecer")
    assert campos == {"status": "Lead Qualificado"}


def test_whatsapp_aceita_o_telefone_completo_como_alternativa():
    linha = LinhaCsv(email="a@b.c", telefone_completo="+5511999998888")
    campos = campos_para_gravar(linha, _existente(whatsapp=None), "enriquecer")
    assert campos == {"whatsapp": "+5511999998888"}


def test_modo_desconhecido_e_erro_e_nao_silencio():
    with pytest.raises(ValueError):
        campos_para_gravar(LinhaCsv(email="a@b.c"), _existente(), "mesclar")
