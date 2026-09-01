"""O cliente HTTP do Resend. Uma responsabilidade só: falar com a API.

Separado do worker de propósito — é o único ponto do sistema que faz rede para
fora, e é o que um teste precisa substituir para rodar sem enviar nada.
"""

import httpx

API = "https://api.resend.com/emails"
TIMEOUT = 30


async def enviar(chave: str, de: str, para: str, assunto: str,
                 html: str, texto: str, cabecalhos: dict) -> str:
    """Devolve o id do e-mail no Resend. Levanta em qualquer falha.

    ⚠️ Levantar é o certo aqui: quem chama é o worker, que sabe transformar
    exceção em retentativa. Engolir o erro e devolver vazio faria a mensagem
    sair da fila como se tivesse sido enviada — o pior desfecho possível.
    """
    corpo = {"from": de, "to": [para], "subject": assunto, "html": html,
             "headers": cabecalhos}
    if texto:
        corpo["text"] = texto
    async with httpx.AsyncClient(timeout=TIMEOUT) as cliente:
        resposta = await cliente.post(
            API, headers={"Authorization": f"Bearer {chave}"}, json=corpo)
    resposta.raise_for_status()
    return resposta.json().get("id", "")
