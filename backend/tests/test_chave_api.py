"""A geração e o hash da chave de API.

Testado porque são funções puras e porque o erro é invisível: uma chave com
entropia fraca funciona exatamente como uma forte, até alguém adivinhar a
próxima.
"""
import hashlib

from app.chave_api import PREFIXO, gerar_chave, hash_da_chave


def test_a_chave_tem_prefixo_do_sistema():
    crua, _, prefixo = gerar_chave()
    assert crua.startswith(PREFIXO)
    assert prefixo == crua[:12]


def test_o_hash_e_sha256_do_texto_da_chave():
    crua, digest, _ = gerar_chave()
    assert digest == hashlib.sha256(crua.encode()).hexdigest()
    assert len(digest) == 64


def test_duas_chaves_nunca_se_repetem():
    chaves = {gerar_chave()[0] for _ in range(500)}
    assert len(chaves) == 500


def test_a_chave_tem_entropia_de_segredo_de_verdade():
    # 32 bytes de os.urandom em base64url. O teste não prova aleatoriedade —
    # isso nenhum teste prova — mas trava o tamanho, que é o que alguém
    # reduziria sem perceber ao "simplificar".
    crua, _, _ = gerar_chave()
    corpo = crua[len(PREFIXO):]
    assert len(corpo) >= 40


def test_hash_da_chave_e_estavel():
    assert hash_da_chave("mhs_abc") == hash_da_chave("mhs_abc")
    assert hash_da_chave("mhs_abc") != hash_da_chave("mhs_abd")
