"""Campos tipados da landing (prova do RD, Tarefa 2) — puro, sem banco.

O servidor descarta o que `frontend/src/landing/campos.ts::camposDaConfig`
descarta e normaliza o celular igual a `normalizarCelular`: o front valida
por cortesia, a defesa é aqui.
"""

from app.captura.campos import (
    CHAVE_EXTRA, TIPOS_DE_CAMPO, DefinicaoCampo, ler_definicoes,
    normalizar_celular_br, validar,
)


def _d(chave, tipo="texto", obrigatorio=False, opcoes=(), rotulo=None):
    return DefinicaoCampo(chave=chave, rotulo=rotulo or chave, tipo=tipo,
                          obrigatorio=obrigatorio, opcoes=tuple(opcoes))


# ── Celular ──────────────────────────────────────────────────────────────────

def test_celular_formatos_diversos_normalizam():
    for bruto in ("+55 (31) 99999-9999", "5531999999999", "031 99999 9999",
                  "31999999999", "(31) 99999-9999"):
        assert normalizar_celular_br(bruto) == "+5531999999999", bruto
    assert normalizar_celular_br("(31) 3333-4444") == "+553133334444"
    assert normalizar_celular_br("553133334444") == "+553133334444"


def test_celular_invalido_e_none():
    for bruto in ("999", "(00) 99999-9999", "", "   ", "(31) 9999-99999-99",
                  "abc", None, "(01) 9999-9999"):
        assert normalizar_celular_br(bruto) is None, bruto


# ── Definições ───────────────────────────────────────────────────────────────

def test_constantes():
    assert TIPOS_DE_CAMPO == frozenset({"texto", "email", "telefone", "lista",
                                        "sim_nao", "texto_longo"})
    assert CHAVE_EXTRA.match("ja_faz_testagem")
    assert not CHAVE_EXTRA.match("Ja_faz")
    assert not CHAVE_EXTRA.match("1abc")
    assert not CHAVE_EXTRA.match("a" * 41)


def test_chave_extra_invalida_descartada_da_definicao():
    defs = ler_definicoes({"campos": [
        {"chave": "nome", "rotulo": "Nome", "tipo": "texto", "obrigatorio": True},
        {"chave": "x; DROP TABLE leads", "rotulo": "X", "tipo": "texto"},
        {"chave": "Maiuscula", "rotulo": "M", "tipo": "texto"},
        {"chave": "tipo_ruim", "rotulo": "T", "tipo": "numero"},
        {"chave": "lista_vazia", "rotulo": "L", "tipo": "lista", "opcoes": ["", "  "]},
        {"chave": "nome", "rotulo": "Repetido", "tipo": "texto"},
        {"chave": "website", "rotulo": "Isca", "tipo": "texto"},
        "não é objeto",
        {"chave": "porte", "rotulo": "Porte", "tipo": "lista", "opcoes": [" P ", "M", ""]},
    ]})
    chaves = [d.chave for d in defs]
    # O e-mail entra sempre, na frente, se a config não o trouxe.
    assert chaves == ["email", "nome", "porte"]
    assert defs[0].tipo == "email" and defs[0].obrigatorio is True
    assert defs[1].rotulo == "Nome" and defs[1].obrigatorio is True
    assert defs[2].opcoes == ("P", "M")


def test_email_da_config_e_sempre_email_obrigatorio():
    defs = ler_definicoes({"campos": [
        {"chave": "nome", "rotulo": "Nome", "tipo": "texto"},
        {"chave": "email", "rotulo": "Seu e-mail", "tipo": "texto", "obrigatorio": False},
    ]})
    assert [d.chave for d in defs] == ["nome", "email"]
    assert defs[1].tipo == "email" and defs[1].obrigatorio is True
    assert defs[1].rotulo == "Seu e-mail"


def test_obrigatorio_so_com_true_literal():
    defs = ler_definicoes({"campos": [
        {"chave": "nome", "rotulo": "Nome", "tipo": "texto", "obrigatorio": "sim"}]})
    assert defs[1].obrigatorio is False


def test_sem_campos_na_config_cai_em_visible_fields():
    defs = ler_definicoes({"visible_fields": ["nome", "email", "empresa", "nome", "website"]})
    assert [d.chave for d in defs] == ["nome", "email", "empresa"]
    assert all(d.tipo == "texto" and not d.obrigatorio for d in defs if d.chave != "email")
    email = [d for d in defs if d.chave == "email"][0]
    assert email.tipo == "email" and email.obrigatorio


def test_campos_todos_invalidos_caem_em_visible_fields():
    defs = ler_definicoes({"campos": [{"chave": "X"}], "visible_fields": ["nome"]})
    assert [d.chave for d in defs] == ["email", "nome"]


def test_config_vazia_usa_campos_padrao():
    defs = ler_definicoes({})
    assert [d.chave for d in defs] == ["nome", "email", "whatsapp", "cargo", "empresa"]
    assert ler_definicoes(None)[1].chave == "email"


# ── Validação ────────────────────────────────────────────────────────────────

def test_obrigatorio_ausente_vira_erro_no_campo():
    r = validar([_d("email", "email", True), _d("nome", obrigatorio=True),
                 _d("porte", "lista", True, ["P", "M"])],
                {"email": "a@b.com", "nome": "  "})
    assert set(r.erros) == {"nome", "porte"}
    assert r.erros["nome"] == "Preencha este campo."
    assert r.erros["porte"] == "Escolha uma opção."


def test_email_tipo_recusa_formato():
    r = validar([_d("email", "email", True), _d("email_comercial", "email")],
                {"email": "sem-arroba", "email_comercial": "x@"})
    assert r.erros == {"email": "Informe um e-mail válido.",
                       "email_comercial": "Informe um e-mail válido."}


def test_email_principal_nao_entra_em_colunas_nem_extras():
    r = validar([_d("email", "email", True)], {"email": "a@b.com"})
    assert r.erros == {} and "email" not in r.colunas and "email" not in r.extras


def test_telefone_normaliza_e_recusa():
    defs = [_d("whatsapp", "telefone", True)]
    ok = validar(defs, {"whatsapp": "+55 (31) 99999-9999"})
    assert ok.erros == {} and ok.colunas["whatsapp"] == "+5531999999999"
    ruim = validar(defs, {"whatsapp": "(00) 9999-9999"})
    assert ruim.erros == {"whatsapp": "Informe o celular com DDD."}
    assert "whatsapp" not in ruim.colunas


def test_lista_fora_das_opcoes_e_erro():
    defs = [_d("porte", "lista", opcoes=["Pequena", "Grande"])]
    assert validar(defs, {"porte": "Média"}).erros == {"porte": "Escolha uma das opções."}
    assert validar(defs, {"porte": " Grande "}).extras == {"porte": "Grande"}


def test_sim_nao_normaliza():
    defs = [_d("ja_faz_testagem", "sim_nao")]
    for bruto, esperado in (("sim", "sim"), ("SIM", "sim"), ("nao", "nao"),
                            ("não", "nao"), (True, "sim"), (False, "nao"),
                            ("true", "sim"), ("false", "nao")):
        r = validar(defs, {"ja_faz_testagem": bruto})
        assert r.erros == {} and r.extras == {"ja_faz_testagem": esperado}, bruto
    assert validar(defs, {"ja_faz_testagem": "talvez"}).erros == {
        "ja_faz_testagem": "Escolha sim ou não."}


def test_falso_em_sim_nao_obrigatorio_nao_e_ausente():
    r = validar([_d("aceita", "sim_nao", True)], {"aceita": False})
    assert r.erros == {} and r.extras == {"aceita": "nao"}


def test_limites_de_texto():
    defs = [_d("nome"), _d("relato", "texto_longo")]
    r = validar(defs, {"nome": "a" * 201, "relato": "b" * 2001})
    assert r.erros == {"nome": "Use até 200 caracteres.",
                       "relato": "Use até 2000 caracteres."}
    assert validar(defs, {"nome": "a" * 200, "relato": "b" * 2000}).erros == {}


def test_texto_nao_texto_e_erro():
    r = validar([_d("nome", obrigatorio=True)], {"nome": {"x": 1}})
    assert "nome" in r.erros


def test_chave_extra_vai_para_extras_e_coluna_para_colunas():
    defs = ler_definicoes({"campos": [
        {"chave": "empresa", "rotulo": "Empresa", "tipo": "texto", "obrigatorio": True},
        {"chave": "ja_faz_testagem", "rotulo": "Já testa?", "tipo": "sim_nao"},
    ]})
    r = validar(defs, {"email": "a@b.com", "empresa": " Transportes X ",
                       "ja_faz_testagem": "sim", "utm_source": "google",
                       "cargo": "Gerente", "fora_da_definicao": "não entra"})
    assert r.erros == {}
    assert r.colunas["empresa"] == "Transportes X"
    # O que a lista branca aceita entra como hoje, mesmo fora das definições.
    assert r.colunas["utm_source"] == "google" and r.colunas["cargo"] == "Gerente"
    assert r.extras == {"ja_faz_testagem": "sim"}


def test_status_e_tipo_nunca_entram_em_extras():
    defs = [_d("status"), _d("tipo"), _d("nome")]
    r = validar(defs, {"status": "Venda realizada", "tipo": "cliente", "nome": "Ana"})
    assert "status" not in r.extras and "tipo" not in r.extras
    # Seguem a lista branca, como hoje (o `_atualizar` os ignora no contato
    # que já existe).
    assert r.colunas == {"status": "Venda realizada", "tipo": "cliente", "nome": "Ana"}


def test_extra_vazio_nao_entra():
    r = validar([_d("ja_faz_testagem", "sim_nao"), _d("observacao")],
                {"ja_faz_testagem": "", "observacao": "  "})
    assert r.extras == {} and r.erros == {}


def test_pagina_antiga_continua_como_antes():
    """Review Focus 5: sem `campos`, nada obrigatório além do e-mail, e o
    texto longo é cortado pela lista branca (2000) — não vira erro."""
    defs = ler_definicoes({"visible_fields": ["nome", "whatsapp", "desafios"]})
    r = validar(defs, {"email": "a@b.com", "nome": "x" * 500,
                       "whatsapp": "85999991234", "desafios": "d" * 3000})
    assert r.erros == {}
    assert r.colunas["whatsapp"] == "85999991234"      # sem normalizar: é texto
    assert len(r.colunas["desafios"]) == 2000
    assert r.extras == {}
