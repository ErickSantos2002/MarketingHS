"""O laço de ferramentas do analista de dados.

⚠️ Laço MANUAL, não `client.beta.messages.tool_runner`. Três razões, e a
terceira é a que decide:

  1. O runner é beta, e este sistema está sendo reconstruído para durar.
  2. As ferramentas precisam da conexão da `sessao()` do admin que perguntou; o
     runner não expõe onde injetar isso.
  3. Precisamos de TETO de voltas. Um modelo que só chama ferramenta não pode
     rodar para sempre contra o banco.

Não há ferramenta de servidor aqui, então `pause_turn` não acontece — só
`tool_use` e `end_turn`.
"""

import logging

from app.ia import ferramentas
from app.ia.cliente import MODELO

logger = logging.getLogger(__name__)

# 8: fundo o bastante para uma pergunta que precise cruzar três recortes, raso o
# bastante para um modelo em laço não varrer o banco.
MAX_VOLTAS = 8

MAX_TOKENS = 16000

SISTEMA = """\
Você é o analista de dados do MarketingHS, a plataforma de marketing da Health \
& Safety. Responde em português do Brasil, direto, sem enrolação.

Você NÃO tem acesso ao banco de dados. Você tem ferramentas. Para saber \
qualquer número, chame a ferramenta — mesmo que você ache que sabe a resposta.

⚠️ NÃO INVENTE NÚMERO. Se uma ferramenta não devolveu o dado, diga que não \
tem o dado. Um número inventado num painel de marketing vira decisão errada de \
campanha, e ninguém descobre que veio de você.

Se a pergunta for ambígua, chame a ferramenta com o recorte mais provável e \
diga qual recorte você usou. Se uma ferramenta recusar um argumento, leia a \
mensagem: ela lista o que existe.

Ao citar números, diga o recorte junto ("2.080 contatos do tipo datacore"), \
nunca o número sozinho.\
"""


async def responder(cliente, conn, mensagens: list[dict]) -> dict:
    """Conversa com o modelo até ele parar de pedir ferramenta.

    `mensagens` é o histórico no formato da API. Devolve o texto final, quais
    ferramentas foram usadas, e quantas voltas levou.
    """
    historico = list(mensagens)
    usadas: list[str] = []

    for volta in range(1, MAX_VOLTAS + 1):
        resposta = await cliente.messages.create(
            model=MODELO,
            max_tokens=MAX_TOKENS,
            system=SISTEMA,
            # ⚠️ As ferramentas vão em TODA chamada. Mandá-las só na primeira
            # faz o modelo parar de considerá-las e voltar a responder de
            # cabeça — que é o defeito que este lote existe para consertar.
            tools=ferramentas.ESQUEMAS,
            messages=historico,
        )

        blocos_de_ferramenta = [b for b in resposta.content if b.type == "tool_use"]

        if not blocos_de_ferramenta:
            texto = next((b.text for b in resposta.content if b.type == "text"), "")
            return {"texto": texto, "ferramentas_usadas": usadas, "voltas": volta}

        historico.append({"role": "assistant", "content": resposta.content})

        resultados = []
        for bloco in blocos_de_ferramenta:
            usadas.append(bloco.name)
            try:
                saida = await ferramentas.executar(conn, bloco.name, bloco.input)
                conteudo, erro = _json(saida), False
            except (ferramentas.FerramentaDesconhecida,
                    ferramentas.ArgumentoRecusado) as e:
                # ⚠️ Volta como resultado de erro, NÃO como exceção. O modelo
                # pediu algo que não existe — falha dele, e ele consegue se
                # corrigir se a mensagem chegar. Levantar aqui viraria 500 na
                # tela por causa de um argumento errado do modelo.
                conteudo, erro = str(e), True
                logger.info("ferramenta recusada: %s(%s) — %s",
                            bloco.name, bloco.input, e)
            resultados.append({
                "type": "tool_result",
                "tool_use_id": bloco.id,
                "content": conteudo,
                "is_error": erro,
            })

        # ⚠️ TODOS os resultados numa mensagem só. Espalhar em várias ensina o
        # modelo a parar de pedir ferramentas em paralelo.
        historico.append({"role": "user", "content": resultados})

    logger.warning("analista bateu o teto de %s voltas", MAX_VOLTAS)
    return {
        "texto": ("Não consegui chegar a uma resposta: a consulta ficou "
                  "girando. Tente uma pergunta mais específica."),
        "ferramentas_usadas": usadas,
        "voltas": MAX_VOLTAS,
    }


def _json(valor) -> str:
    import json
    return json.dumps(valor, ensure_ascii=False, default=str)
