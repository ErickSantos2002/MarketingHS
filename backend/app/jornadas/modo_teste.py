"""O modo teste da jornada (prova do RD, 027 — antimeta nº 1: nenhum e-mail
para fora da lista). Uma regra só, usada pelo executor, pelo worker (segunda
trava do e-mail), pela caixa de saída (aviso e webhook) e pela rota que salva
a jornada.

Lista nula = sem modo teste (inclusive sem a 027, quando
`to_jsonb(j)->'allowed_emails'` dá NULL). Senão o e-mail, aparado e sem
caixa, precisa estar nela. Lista vazia ou de forma inesperada não libera
ninguém — só a rota transforma `[]` em "sem modo teste", gravando NULL.
"""

import json


def _como_lista(lista):
    if isinstance(lista, str):
        lista = json.loads(lista)
    return lista


def ligado(lista) -> bool:
    return _como_lista(lista) is not None


def na_lista(lista, email: str | None) -> bool:
    lista = _como_lista(lista)
    if lista is None:
        return True
    if not isinstance(lista, list):
        return False
    alvo = (email or "").strip().lower()
    return bool(alvo) and alvo in {str(e).strip().lower() for e in lista}


async def lista_da_jornada(conn, journey_id: str | None):
    """A lista em vigor AGORA (não a do momento do nó). Jornada inexistente
    ou nula = sem modo teste."""
    if not journey_id:
        return None
    return _como_lista(await conn.fetchval(
        "SELECT to_jsonb(j)->'allowed_emails' FROM journeys j WHERE j.id = $1::uuid",
        journey_id))
