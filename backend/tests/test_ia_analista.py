"""O laço de ferramentas do analista.

⚠️ NENHUM teste aqui faz rede. O cliente da Anthropic é substituído por um
dublê que devolve respostas roteirizadas — o que se prova é o LAÇO: que ele
executa a ferramenta pedida, devolve o resultado ao modelo, e para.
"""

import pytest

from app.ia import analista


class _Bloco:
    def __init__(self, **kw):
        self.__dict__.update(kw)


class _Resposta:
    def __init__(self, content, stop_reason):
        self.content = content
        self.stop_reason = stop_reason


class _MensagensFalsas:
    """Devolve, em ordem, as respostas roteirizadas."""

    def __init__(self, roteiro):
        self.roteiro = list(roteiro)
        self.chamadas = []

    async def create(self, **kw):
        self.chamadas.append(kw)
        return self.roteiro.pop(0)


class _ClienteFalso:
    def __init__(self, roteiro):
        self.messages = _MensagensFalsas(roteiro)


def _texto(t):
    return _Resposta([_Bloco(type="text", text=t)], "end_turn")


def _usa_ferramenta(nome, argumentos, id_="tu_1"):
    return _Resposta(
        [_Bloco(type="tool_use", id=id_, name=nome, input=argumentos)],
        "tool_use")


@pytest.mark.asyncio
async def test_o_laco_executa_a_ferramenta_e_devolve_o_texto(conexao):
    cliente = _ClienteFalso([
        _usa_ferramenta("contar_contatos", {"filtros": {"tipo": "datacore"}}),
        _texto("São 2.080 contatos vindos do ERP."),
    ])
    r = await analista.responder(
        cliente, conexao, [{"role": "user", "content": "quantos vieram do ERP?"}])
    assert r["texto"] == "São 2.080 contatos vindos do ERP."
    assert r["ferramentas_usadas"] == ["contar_contatos"]
    assert r["voltas"] == 2


@pytest.mark.asyncio
async def test_ferramenta_recusada_volta_como_erro_e_nao_derruba(conexao):
    """O modelo tem de poder se corrigir. Levantar aqui viraria 500 na tela
    porque o modelo pediu uma dimensão que não existe — que é falha dele, não
    do sistema."""
    cliente = _ClienteFalso([
        _usa_ferramenta("distribuir_contatos", {"dimensao": "email"}),
        _texto("Não consigo agrupar por e-mail; posso agrupar por cargo."),
    ])
    r = await analista.responder(
        cliente, conexao, [{"role": "user", "content": "agrupe por email"}])
    assert "cargo" in r["texto"]

    # O resultado devolvido ao modelo tem de estar marcado como erro.
    ultima = cliente.messages.chamadas[-1]
    resultado = ultima["messages"][-1]["content"][0]
    assert resultado["type"] == "tool_result"
    assert resultado["is_error"] is True
    assert "dimensão" in resultado["content"]


@pytest.mark.asyncio
async def test_o_laco_tem_teto_de_voltas(conexao):
    """Um modelo que só chama ferramenta para sempre não pode rodar para sempre
    contra o banco."""
    cliente = _ClienteFalso(
        [_usa_ferramenta("contar_contatos", {}, id_=f"tu_{i}")
         for i in range(analista.MAX_VOLTAS + 2)])
    r = await analista.responder(
        cliente, conexao, [{"role": "user", "content": "conte"}])
    assert r["voltas"] == analista.MAX_VOLTAS
    assert "não consegui" in r["texto"].lower()


@pytest.mark.asyncio
async def test_ferramentas_vao_em_toda_chamada(conexao):
    """Mandar as ferramentas só na primeira chamada faz o modelo 'esquecer' que
    pode chamá-las — e ele passa a responder de cabeça."""
    cliente = _ClienteFalso([
        _usa_ferramenta("contar_contatos", {}),
        _texto("pronto"),
    ])
    await analista.responder(cliente, conexao,
                             [{"role": "user", "content": "conte"}])
    for chamada in cliente.messages.chamadas:
        assert chamada["tools"], "chamada sem ferramentas"


@pytest.mark.asyncio
async def test_o_sistema_proibe_inventar_numero(conexao):
    """Regra de negócio no prompt, conferida como qualquer outra."""
    assert "não invente" in analista.SISTEMA.lower()
    assert "ferramenta" in analista.SISTEMA.lower()


@pytest.mark.asyncio
async def test_a_rota_do_chat_nunca_abre_sessao_como_service_role(monkeypatch):
    """O revisor da Task 3 apontou que `ferramentas.py` não pode impor o
    papel — o `conn` chega pronto de fora. A garantia tem de estar na rota:
    o analista lê dado a PEDIDO de uma pessoa, então a `sessao()` do chat tem
    de abrir com o papel de quem perguntou, nunca `service_role` (que tem
    BYPASSRLS e é só para operação interna).

    Este teste não bate no banco de verdade: substitui `sessao` por um dublê
    e confere só com que papel `enviar_mensagem` a chamou, antes de a conexão
    falsa quebrar o resto da rota (o que é esperado e ignorado aqui).
    """
    import contextlib

    from app.routers import ia as ia_router
    from app.dependencies import Usuario

    papeis_usados = []

    @contextlib.asynccontextmanager
    async def _sessao_falsa(*args, **kwargs):
        papeis_usados.append(kwargs.get("role", args[0] if args else None))
        raise RuntimeError("dublê: não vai ao banco de verdade")
        yield  # pragma: no cover — nunca alcançado, mas mantém o formato de gerador

    monkeypatch.setattr(ia_router, "sessao", _sessao_falsa)

    async def _cliente_falso():
        return object()

    monkeypatch.setattr(ia_router, "exigir_cliente", _cliente_falso)

    usuario = Usuario(id="11111111-1111-1111-1111-111111111111",
                      email="analista@teste.invalid", papel="admin")

    with pytest.raises(RuntimeError):
        await ia_router.enviar_mensagem(
            "22222222-2222-2222-2222-222222222222",
            ia_router.MensagemIn(conteudo="quantos contatos?"),
            usuario=usuario,
        )

    assert papeis_usados, "a rota não chegou a abrir sessao()"
    assert all(p == "authenticated" for p in papeis_usados), (
        f"enviar_mensagem abriu sessao() com papel(is) {papeis_usados!r}; "
        "nunca pode ser service_role.")
