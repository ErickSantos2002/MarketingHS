"""A captação pública — o que clicar não prova.

A validação de e-mail é ***fail-open*** por decisão: DNS instável ou fora do ar
NÃO pode recusar um lead real. Testar isso é o ponto do arquivo — é um caminho
que só aparece quando a rede falha, e ninguém percebe se ele inverter.

A captura em si é testada ponta a ponta porque o modo de falhar dela é gravar
lead sem pontuação, sem identidade ou sem conversão — tudo silencioso.
"""

import pytest

from app.captura import email as vemail

# ⚠️ SEM `pytestmark = pytest.mark.asyncio` neste arquivo, ao contrário do
# `test_conversao.py`. O `pytest.ini` tem `asyncio_mode = auto`, que já marca as
# funções `async def` sozinho — e aqui há testes SÍNCRONOS misturados
# (`test_formato_recusa_o_obvio`, e os três da Task 2). O marcador de módulo
# alcançaria também os síncronos, e o pytest-asyncio recusa marcar função que
# não é corrotina.


def test_formato_recusa_o_obvio():
    assert vemail.formato_ok("erick@healthsafety.com.br")
    assert not vemail.formato_ok("sem-arroba")
    assert not vemail.formato_ok("dois@@arrobas.com")
    assert not vemail.formato_ok("sem@tld")
    assert not vemail.formato_ok("")


async def test_descartavel_conhecido_e_recusado():
    vemail._limpar_cache()
    valido, motivo = await vemail.validar_dominio("alguem@mailinator.com")
    assert valido is False
    assert motivo


async def test_dns_fora_do_ar_deixa_passar(monkeypatch):
    """⚠️ O teste mais importante do arquivo. Se ele inverter, uma instabilidade
    de DNS passa a recusar lead de verdade — e ninguém descobre, porque o
    formulário só diz 'e-mail inválido' e a pessoa vai embora."""
    vemail._limpar_cache()

    async def explodir(_dominio):
        raise OSError("resolver indisponível")

    monkeypatch.setattr(vemail, "_tem_mx", explodir)
    valido, motivo = await vemail.validar_dominio("alguem@empresa-real.com.br")
    assert valido is True
    assert motivo is None


async def test_dominio_sem_mx_e_recusado(monkeypatch):
    vemail._limpar_cache()

    async def sem_mx(_dominio):
        return False

    monkeypatch.setattr(vemail, "_tem_mx", sem_mx)
    valido, motivo = await vemail.validar_dominio("alguem@dominio-inexistente.tld")
    assert valido is False
    assert motivo


async def test_o_cache_evita_a_segunda_consulta(monkeypatch):
    vemail._limpar_cache()
    chamadas = []

    async def contar(dominio):
        chamadas.append(dominio)
        return True

    monkeypatch.setattr(vemail, "_tem_mx", contar)
    await vemail.validar_dominio("a@empresa.com.br")
    await vemail.validar_dominio("b@empresa.com.br")
    assert chamadas == ["empresa.com.br"], "o domínio deveria ser consultado uma vez"


from app.captura import campos as vcampos


def test_higienizar_descarta_campo_fora_da_lista():
    saida = vcampos.higienizar({"nome": "Carla", "lead_score": 999, "etiqueta": "hotlead"})
    assert saida == {"nome": "Carla"}, "score e etiqueta são do gatilho, não do formulário"


def test_higienizar_apara_e_descarta_vazio():
    saida = vcampos.higienizar({"nome": "  Carla  ", "cargo": "", "empresa": None})
    assert saida == {"nome": "Carla"}


def test_higienizar_corta_texto_gigante():
    saida = vcampos.higienizar({"desafios": "x" * 5000})
    assert len(saida["desafios"]) == 2000


def test_higienizar_aceita_numero_e_booleano():
    saida = vcampos.higienizar({"funcionarios": "500", "interesse_formacao": True})
    assert saida["funcionarios"] == "500"
    assert saida["interesse_formacao"] is True
