"""A costura do teste A/B no servidor — porte de `_shared/ab.ts`.

Quem chamava: `identity-upsert` e `receive-contact-event` (costura + conversão
`agendamento`) e o `leadConversion.ts` do cliente (conversão `lead_criado`).
⚠️ Os três foram portados SEM isto — lotes 1D (`7a2a1b2`) e 7 (`46f2a07`) — e o
funil do A/B ficou sem conversão nenhuma, em silêncio.

⚠️ NÃO BLOQUEIA, como na origem: erro é logado e engolido. Mas a origem rodava
fora de transação, e aqui a escrita roda DENTRO da transação de quem chama —
um erro de SQL a abortaria e levaria junto o contato, o evento ou a conversão.
Por isso cada função abre um SAVEPOINT (`conn.transaction()` aninhada): a falha
desfaz só o que é do A/B.

⚠️ `lead_id` vai como `$n::text::uuid`, e não `$n::uuid`: com `::uuid` o
asyncpg valida no CLIENTE e o erro nunca chega ao banco — o SAVEPOINT não
seria exercitado, e o teste que o prova passaria por acaso.
"""

import logging
from dataclasses import dataclass

from app.ab.eventos import SEM_DUPLICATA

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Ab:
    ab_vid: str | None = None
    ab_test: str | None = None
    ab_var: str | None = None


def extrair_ab(topo: dict, metadata: dict | None) -> Ab:
    """`ab_vid`/`ab_test`/`ab_var` do topo do corpo ou de `metadata`.

    ⚠️ Como o `??` da origem: só NULO no topo cai para o `metadata`; texto
    vazio no topo vira `None` e para ali.
    """
    md = metadata if isinstance(metadata, dict) else {}

    def pegar(chave: str) -> str | None:
        valor = topo.get(chave)
        if valor is None:
            valor = md.get(chave)
        if valor is None:
            return None
        return str(valor).strip() or None

    return Ab(pegar("ab_vid"), pegar("ab_test"), pegar("ab_var"))


async def costurar_visitante(conn, ab: Ab, *, email: str | None, phone: str | None,
                             phone_normalized: str | None, lead_id: str | None,
                             dnia_id: str | None, source_app: str,
                             metadata: dict | None) -> Ab:
    """Liga o visitante anônimo (`ab_vid`) ao contato, em `ab_identities`.

    Sem `ab_vid`, procura uma costura anterior pelo e-mail, depois pelo
    telefone. Sem teste/variante, completa pelo último clique do visitante.
    Não grava de novo o que já está lá; guarda o histórico entre `ab_vid`s.
    Devolve o que conseguiu resolver — é o que a conversão usa.
    """
    vid, teste, variante = ab.ab_vid, ab.ab_test, ab.ab_var
    email = email.strip().lower() if email else None
    telefone = phone_normalized or phone or None
    try:
        async with conn.transaction():
            if not vid and email:
                vid = await conn.fetchval(
                    "SELECT ab_vid FROM ab_identities WHERE lower(email) = $1 "
                    "ORDER BY linked_at DESC LIMIT 1", email)
            if not vid and telefone:
                vid = await conn.fetchval(
                    "SELECT ab_vid FROM ab_identities WHERE phone_normalized = $1 "
                    "ORDER BY linked_at DESC LIMIT 1", telefone)
            if not vid:
                return Ab(None, teste, variante)

            if not teste or not variante:
                clique = await conn.fetchrow(
                    "SELECT ab_test, ab_var FROM ab_assignments WHERE ab_vid = $1 "
                    "ORDER BY assigned_at DESC LIMIT 1", vid)
                if clique:
                    teste = teste or clique["ab_test"]
                    variante = variante or clique["ab_var"]

            if lead_id:
                existe = await conn.fetchval(
                    "SELECT 1 FROM ab_identities WHERE ab_vid = $1 AND lead_id = $2::text::uuid "
                    "LIMIT 1", vid, lead_id)
            elif email:
                existe = await conn.fetchval(
                    "SELECT 1 FROM ab_identities WHERE ab_vid = $1 AND lower(email) = $2 "
                    "LIMIT 1", vid, email)
            else:
                existe = None

            if not existe:
                await conn.execute(
                    """INSERT INTO ab_identities (ab_vid, email, phone, phone_normalized,
                                                  lead_id, dnia_id, source_app, metadata)
                       VALUES ($1, $2, $3, $4, $5::text::uuid, $6, $7, $8)""",
                    vid, email, phone, phone_normalized, lead_id, dnia_id,
                    source_app, metadata)
    except Exception:
        logger.exception("[ab] a costura falhou — o contato segue sem ela")
    return Ab(vid, teste, variante)


async def registrar_conversao_ab(conn, ab: Ab, nome: str, *, lead_id: str | None = None,
                                 dnia_id: str | None = None, page_slug: str | None = None,
                                 metadata: dict | None = None) -> None:
    """Conversão nomeada em `ab_events`, uma vez por visitante e teste.

    A chave de dedupe é a mesma que o coletor calcula para uma conversão
    vinda do navegador (`app/ab/eventos.py:chave_de_dedupe`): as duas portas
    deduplicam juntas.
    """
    if not ab.ab_vid or not ab.ab_test:
        return
    try:
        async with conn.transaction():
            await conn.execute(
                f"""INSERT INTO ab_events (ab_test, ab_var, ab_vid, event_type, event_name,
                                           lead_id, dnia_id, page_slug, metadata, dedupe_key)
                    VALUES ($1, $2, $3, 'conversion', $4, $5::text::uuid, $6, $7, $8, $9)
                    {SEM_DUPLICATA}""",
                ab.ab_test, ab.ab_var, ab.ab_vid, nome, lead_id, dnia_id, page_slug,
                metadata, f"{ab.ab_vid}:{ab.ab_test}:conversion:{nome}")
    except Exception:
        logger.exception("[ab] a conversão %s não foi registrada", nome)
