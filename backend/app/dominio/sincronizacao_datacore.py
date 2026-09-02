"""Do DataCore para o MarketingHS. Mão única: o ERP manda, nós obedecemos.

Cada cliente vira uma linha em `ecosystem_identities` (`stage='client'`,
chaveada por `datacore_cliente_id`) e uma em `leads` (`source='datacore'`,
`tipo='datacore'`).

⚠️ **`stage` é vocabulário em INGLÊS.** O trigger
`validate_ecosystem_identity_stage` aceita `lead·prospect·opportunity·client·
active·churned` e recusa qualquer outra coisa. A spec do lote 5B pedia
`stage='cliente'`, que o banco rejeita com "Invalid stage value".

⚠️ **`leads.status` NÃO vira "Cliente".** `leads_status_fkey` aponta para
`lead_statuses`, e lá o funil vai de "Lead" a "Venda realizada" — não existe
"Cliente". Inventar um status é decisão de produto, não desta sincronização.
Quem carrega o fato "é cliente" é o `stage` da identidade; e quem permite
**segmentar** é o `tipo='datacore'`, que `build_segment_condition` já entende
(o campo "Modal" no construtor de regras). O status fica no padrão do banco.

⚠️ **O telefone NÃO vai para a identidade.** `ecosystem_identities.phone` é
UNIQUE, e no ERP **26 clientes dividem o telefone 4133551019** — contador ou
despachante, quase certo; outros quatro números se repetem 2 ou 3 vezes. Com o
telefone na identidade, ou 25 inserções falham, ou (pior) um upsert por telefone
colapsa os 26 num contato só e o CRM passa a achar que são a mesma empresa. Ele
vai para `leads.whatsapp`, que não tem unicidade.

⚠️ **`leads_email_unique` é UNIQUE em `email`.** O ERP tem e-mail repetido
(dois cadastros do mesmo "Porã Sistema de Remoções"). O segundo entra SEM
e-mail e é contado, em vez de derrubar a carga inteira por causa de uma linha.
"""

import logging
from dataclasses import dataclass, field

from app.dominio.datacore import ClienteErp

logger = logging.getLogger(__name__)


@dataclass
class Resumo:
    criados: int = 0
    atualizados: int = 0
    sem_email: int = 0
    colisoes_de_email: int = 0
    erros: list[str] = field(default_factory=list)


async def sincronizar(conn, clientes: list[ClienteErp]) -> Resumo:
    r = Resumo()
    for c in clientes:
        try:
            # ⚠️ SAVEPOINT por cliente. `sessao()` abre UMA transação para o
            # laço inteiro: sem isto, o primeiro cpf_cnpj problemático aborta a
            # transação e os outros 2.080 morrem em cadeia com "current
            # transaction is aborted" — e o `try/except` sozinho não protege,
            # porque captura o erro mas deixa a transação envenenada. Foi a
            # lição mais cara do lote 4.
            async with conn.transaction():
                await _um_cliente(conn, c, r)
        except Exception as exc:  # noqa: BLE001 — um cliente não derruba a carga
            r.erros.append(f"{c.cpf_cnpj}: {exc}")
            logger.warning("cliente %s do DataCore falhou: %s", c.cpf_cnpj, exc)
    return r


async def _um_cliente(conn, c: ClienteErp, r: Resumo) -> None:
    if not c.email:
        r.sem_email += 1

    email = c.email
    if email:
        # O e-mail já é de OUTRO contato? Então este entra sem e-mail. Duplicata
        # do ERP não é motivo para perder um cliente da segmentação.
        dono = await conn.fetchval(
            """SELECT COALESCE(i.datacore_cliente_id, '')
                 FROM leads l
                 LEFT JOIN ecosystem_identities i ON i.dnia_id = l.dnia_id
                WHERE lower(l.email) = $1 AND l.deleted_at IS NULL""", email)
        if dono is not None and dono != c.cpf_cnpj:
            r.colisoes_de_email += 1
            email = None

    identidade = await conn.fetchrow(
        """INSERT INTO ecosystem_identities
                (datacore_cliente_id, nome, email, stage,
                 first_touch_source, first_touch_app)
           VALUES ($1, $2, $3, 'client', 'datacore', 'marketinghs')
           ON CONFLICT (datacore_cliente_id) WHERE datacore_cliente_id IS NOT NULL
           DO UPDATE SET nome  = COALESCE(EXCLUDED.nome, ecosystem_identities.nome),
                         email = COALESCE(EXCLUDED.email, ecosystem_identities.email),
                         stage = 'client',
                         updated_at = now()
           RETURNING dnia_id, (xmax = 0) AS nasceu""",
        c.cpf_cnpj, c.nome, email)

    dnia_id, nasceu = identidade["dnia_id"], identidade["nasceu"]

    # `tipo` é NOT NULL e sem default. `empresa` recebe o nome porque no ERP o
    # cadastro É a empresa (2.011 dos 2.081 são pessoa jurídica).
    # `phone_normalized` sai da mesma função que o resto do sistema usa.
    lead = await conn.fetchrow(
        """INSERT INTO leads (dnia_id, tipo, nome, email, empresa, whatsapp,
                              phone_normalized, source)
           VALUES ($1, 'datacore', $2, $3, $2, $4, normalize_phone_br($4),
                   'datacore')
           ON CONFLICT (email) DO NOTHING
           RETURNING id""",
        dnia_id, c.nome, email, c.fone)

    if lead is None:
        # O `DO NOTHING` não inseriu: ou este cliente já tinha lead, ou o e-mail
        # é de um contato que já existia. Atualiza pelo dnia_id, que é o vínculo
        # com a identidade.
        await conn.execute(
            """UPDATE leads
                  SET nome = COALESCE($2, nome),
                      empresa = COALESCE($2, empresa),
                      whatsapp = COALESCE($3, whatsapp),
                      phone_normalized = normalize_phone_br(COALESCE($3, whatsapp)),
                      source = 'datacore',
                      updated_at = now()
                WHERE dnia_id = $1""", dnia_id, c.nome, c.fone)

    # ⚠️ Quem manda na contagem é a IDENTIDADE, não o `RETURNING` do lead.
    # Contar pelo lead erra nos dois sentidos: identidade nova cujo lead bateu
    # no e-mail de outro contato seria contada como "atualizado", e identidade
    # velha com lead novo não seria contada de jeito nenhum.
    if nasceu:
        r.criados += 1
    else:
        r.atualizados += 1
