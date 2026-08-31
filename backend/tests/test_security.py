"""Único teste do lote 0. Justificativa nas Restrições globais do plano: são funções
puras, e expiração de token é o caso em que abrir a tela não prova nada."""

import jwt
import pytest

from app.auth.security import conferir_senha, emitir_token, gerar_hash, ler_token
from app.config import settings


def test_hash_confere_a_senha_certa_e_recusa_a_errada():
    h = gerar_hash("segredo-do-erick")
    assert conferir_senha("segredo-do-erick", h)
    assert not conferir_senha("outra", h)


def test_conta_sem_senha_nunca_autentica():
    # Conta criada por admin e ainda sem senha definida tem hash NULL.
    assert not conferir_senha("qualquer", None)


def test_hash_malformado_no_banco_e_falha_e_nao_excecao():
    assert not conferir_senha("qualquer", "isto-nao-e-um-hash-bcrypt")


def test_token_carrega_identidade_e_papel():
    token, segundos = emitir_token("11111111-1111-1111-1111-111111111111",
                                   "admin", "erick@healthsafety.com.br")
    dados = ler_token(token)
    assert dados["sub"] == "11111111-1111-1111-1111-111111111111"
    assert dados["papel"] == "admin"
    assert dados["email"] == "erick@healthsafety.com.br"
    assert segundos == settings.JWT_EXPIRE_HOURS * 3600


def test_token_expirado_e_recusado():
    original = settings.JWT_EXPIRE_HOURS
    settings.JWT_EXPIRE_HOURS = -1   # já nasce vencido
    try:
        token, _ = emitir_token("22222222-2222-2222-2222-222222222222",
                                "admin", "a@b.c")
        with pytest.raises(jwt.ExpiredSignatureError):
            ler_token(token)
    finally:
        settings.JWT_EXPIRE_HOURS = original


def test_token_assinado_com_outro_segredo_e_recusado():
    token = jwt.encode({"sub": "x"}, "segredo-errado", algorithm="HS256")
    with pytest.raises(jwt.InvalidSignatureError):
        ler_token(token)
