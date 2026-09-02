"""Do DataCore para o MarketingHS. Mão única: o ERP manda, nós obedecemos.

Cada cliente vira uma linha em `ecosystem_identities` (`stage='client'`,
chaveada por `datacore_cliente_id`) e uma em `leads` (`source='datacore'`,
`tipo='datacore'`).

⚠️ **`stage` é vocabulário em INGLÊS.** O trigger
`validate_ecosystem_identity_stage` aceita `lead·prospect·opportunity·client·
active·churned` e recusa o resto. A spec do lote 5B pedia `stage='cliente'`, que
o banco rejeita com "Invalid stage value".

⚠️ **`leads.status` NÃO vira "Cliente".** `leads_status_fkey` aponta para
`lead_statuses`, e lá o funil vai de "Lead" a "Venda realizada" — não existe
"Cliente". Inventar um status é decisão de produto, não desta sincronização.
Quem carrega o fato "é cliente" é o `stage` da identidade; quem permite
**segmentar** é o `tipo='datacore'`, que `build_segment_condition` já entende
(o campo "Modal" do construtor de regras) e que ele NÃO entenderia em `stage`.

⚠️ **O telefone NÃO vai para a identidade.** `ecosystem_identities.phone` é
UNIQUE, e no ERP **26 clientes dividem o telefone 4133551019**. Com o telefone
na identidade, ou 25 inserções falham, ou um upsert por telefone colapsa os 26
num contato só. Ele vai para `leads.whatsapp`, que não tem unicidade.

⚠️ **A idempotência do LEAD é por `dnia_id`, não por e-mail.** `ON CONFLICT
(email) DO NOTHING` não protege quem entra sem e-mail — NULL não conflita com
NULL —, e ~91% da base do ERP não tem e-mail. Com ele sozinho, a segunda carga
criaria 1.898 leads duplicados.

⚠️ **Em LOTE, não cliente a cliente.** A primeira versão fazia três idas ao
banco por cliente: 400ms cada contra o Postgres remoto, ~14 minutos para os
2.080, tudo numa transação só — tempo que nenhum proxy na frente da API
aguenta. Agora são quatro consultas por bloco de 500.
"""

import logging
from dataclasses import dataclass, field

from app.dominio.datacore import ClienteErp

logger = logging.getLogger(__name__)

# 500 é o meio-termo: poucas idas ao banco, e um bloco que falha e cai para o
# caminho cliente-a-cliente não custa caro demais para reprocessar.
TAMANHO_DO_BLOCO = 500


@dataclass
class Resumo:
    criados: int = 0
    atualizados: int = 0
    sem_email: int = 0
    colisoes_de_email: int = 0
    erros: list[str] = field(default_factory=list)


async def sincronizar(conn, clientes: list[ClienteErp]) -> Resumo:
    r = Resumo()
    for i in range(0, len(clientes), TAMANHO_DO_BLOCO):
        bloco = clientes[i:i + TAMANHO_DO_BLOCO]
        try:
            # ⚠️ SAVEPOINT por bloco. `sessao()` abre UMA transação para tudo:
            # sem isto, um bloco que falha aborta a transação e os blocos
            # seguintes morrem em cadeia com "current transaction is aborted".
            # Foi a lição mais cara do lote 4.
            async with conn.transaction():
                await _um_bloco(conn, bloco, r)
        except Exception as exc:  # noqa: BLE001
            logger.warning("bloco %d-%d falhou (%s) — caindo para cliente a cliente",
                           i, i + len(bloco), exc)
            await _bloco_cliente_a_cliente(conn, bloco, r)
    return r


async def _bloco_cliente_a_cliente(conn, bloco, r: Resumo) -> None:
    """O caminho lento, só quando o rápido falha: isola qual cliente é o
    problema em vez de perder o bloco inteiro."""
    for c in bloco:
        try:
            async with conn.transaction():
                await _um_bloco(conn, [c], r)
        except Exception as exc:  # noqa: BLE001
            r.erros.append(f"{c.cpf_cnpj}: {exc}")
            logger.warning("cliente %s do DataCore falhou: %s", c.cpf_cnpj, exc)


async def _resolver_emails(conn, bloco: list[ClienteErp], r: Resumo) -> list[str | None]:
    """Devolve o e-mail de cada cliente do bloco, ou None quando ele não pode
    ser usado. Duas colisões possíveis, as duas contadas em `colisoes_de_email`:

    1. dentro do próprio bloco — o ERP tem cadastro repetido (dois do mesmo
       "Porã Sistema de Remoções" dividem um e-mail);
    2. contra a base — o e-mail já é de outro contato.

    Em ambas, o perdedor entra SEM e-mail em vez de derrubar a carga: perder um
    cliente da segmentação por causa de um endereço repetido é pior.
    """
    emails: list[str | None] = []
    vistos: set[str] = set()
    for c in bloco:
        if not c.email:
            r.sem_email += 1
            emails.append(None)
        elif c.email in vistos:
            r.colisoes_de_email += 1
            emails.append(None)
        else:
            vistos.add(c.email)
            emails.append(c.email)

    candidatos = [e for e in emails if e]
    if not candidatos:
        return emails

    # Uma consulta para o bloco inteiro, não uma por cliente.
    donos = {
        linha["email"]: linha["dono"]
        for linha in await conn.fetch(
            """SELECT lower(l.email) AS email,
                      COALESCE(i.datacore_cliente_id, '') AS dono
                 FROM leads l
                 LEFT JOIN ecosystem_identities i ON i.dnia_id = l.dnia_id
                WHERE lower(l.email) = ANY($1::text[]) AND l.deleted_at IS NULL""",
            candidatos)
    }

    for pos, (c, email) in enumerate(zip(bloco, emails)):
        if email and donos.get(email, c.cpf_cnpj) != c.cpf_cnpj:
            r.colisoes_de_email += 1
            emails[pos] = None
    return emails


async def _um_bloco(conn, bloco: list[ClienteErp], r: Resumo) -> None:
    emails = await _resolver_emails(conn, bloco, r)

    chaves = [c.cpf_cnpj for c in bloco]
    nomes = [c.nome for c in bloco]
    fones = [c.fone for c in bloco]

    # 1) As identidades. O RETURNING traz o dnia_id de cada chave e se nasceu
    #    agora — é daí que sai a contagem, e não do INSERT do lead: contar pelo
    #    lead erraria nos dois sentidos quando o e-mail colide.
    linhas = await conn.fetch(
        """INSERT INTO ecosystem_identities
                (datacore_cliente_id, nome, email, stage,
                 first_touch_source, first_touch_app)
           SELECT d.chave, d.nome, d.email, 'client', 'datacore', 'marketinghs'
             FROM unnest($1::text[], $2::text[], $3::text[]) AS d(chave, nome, email)
           ON CONFLICT (datacore_cliente_id) WHERE datacore_cliente_id IS NOT NULL
           DO UPDATE SET nome  = COALESCE(EXCLUDED.nome, ecosystem_identities.nome),
                         email = COALESCE(EXCLUDED.email, ecosystem_identities.email),
                         stage = 'client',
                         updated_at = now()
           RETURNING datacore_cliente_id AS chave, dnia_id, (xmax = 0) AS nasceu""",
        chaves, nomes, emails)

    por_chave = {l["chave"]: l for l in linhas}
    dnias, n_nomes, n_emails, n_fones = [], [], [], []
    for c, email in zip(bloco, emails):
        linha = por_chave.get(c.cpf_cnpj)
        if linha is None:
            continue
        dnias.append(linha["dnia_id"])
        n_nomes.append(c.nome)
        n_emails.append(email)
        n_fones.append(c.fone)
        if linha["nasceu"]:
            r.criados += 1
        else:
            r.atualizados += 1

    if not dnias:
        return

    # 2) Os leads que ainda não existem. ⚠️ `NOT EXISTS` pelo dnia_id é a
    #    idempotência de verdade; o `ON CONFLICT (email)` fica como segunda
    #    linha, para o caso de um e-mail escapar da resolução acima.
    await conn.execute(
        """INSERT INTO leads (dnia_id, tipo, nome, email, empresa, whatsapp,
                              phone_normalized, source)
           SELECT d.dnia_id, 'datacore', d.nome, d.email, d.nome, d.fone,
                  normalize_phone_br(d.fone), 'datacore'
             FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[])
                  AS d(dnia_id, nome, email, fone)
            WHERE NOT EXISTS (SELECT 1 FROM leads l WHERE l.dnia_id = d.dnia_id)
           ON CONFLICT (email) DO NOTHING""",
        dnias, n_nomes, n_emails, n_fones)

    # 3) E os que já existiam recebem o que o ERP tem de novo.
    #    ⚠️ O e-mail é PREENCHIDO, nunca sobrescrito: se alguém corrigiu o
    #    endereço do lado do marketing, o ERP não desfaz a correção.
    await conn.execute(
        """UPDATE leads l
              SET nome     = COALESCE(d.nome, l.nome),
                  empresa  = COALESCE(d.nome, l.empresa),
                  email    = COALESCE(l.email, d.email),
                  whatsapp = COALESCE(d.fone, l.whatsapp),
                  phone_normalized = normalize_phone_br(COALESCE(d.fone, l.whatsapp)),
                  source   = 'datacore',
                  updated_at = now()
             FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[])
                  AS d(dnia_id, nome, email, fone)
            WHERE l.dnia_id = d.dnia_id""",
        dnias, n_nomes, n_emails, n_fones)
