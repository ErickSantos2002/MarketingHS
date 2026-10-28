"""O registro de uma captura: achar ou criar o contato, a conversão, a
identidade, o A/B, as tags e o consentimento — numa transação só.

Era o corpo de `routers/captura.py::capturar()`. Saiu de lá na prova do RD
(21/10/2026) porque agora são DUAS portas para o mesmo registro: a landing
(`POST /publico/captura`) e o formulário de outro site (`POST
/publico/site/conversao`, `routers/rastreio.py`). Duas cópias do "não
sobrescrever" e do "primeiro toque congelado" divergiriam na primeira
correção — e a captura anônima é onde divergir custa lead ou dado de cliente.

O comportamento de antes foi movido sem mudar; o que a prova acrescenta:
`leads.campos_extras` (o que já existe vence), as colunas novas de
`lead_conversions` (formulário, site, visitante, URL, canal), o consentimento
por conversão e as tags da config/do site. Exige a migration 027 (aplicada
em produção em 21/10).
"""

import logging
from dataclasses import dataclass

from app.ab.costura import Ab, registrar_conversao_ab
from app.captura.evento import marcar_agendamento, marcar_pagina, publicar_conversao
from app.captura.informados import dados_informados, divergencias

logger = logging.getLogger(__name__)

# A origem do primeiro toque anda em BLOCO (ver `_atualizar`).
UTMS = ("utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content")

# ⚠️ Constante, não literal inline, só para o teste da rodada 1 de correção
# conseguir forçar uma falha DE BANCO real dentro da transação (trocando o
# nome da function por um que não existe) e provar que o SAVEPOINT de
# `_resolver_identidade` recupera a transação de verdade. O teste troca a
# constante de `routers/captura.py`, que a passa para cá a cada captura
# (`sql_identidade`); esta é a padrão, para quem chama sem ela.
SQL_RESOLVE_IDENTIDADE = (
    "SELECT resolve_or_create_identity($1, $2, $3, $4, $5::uuid, $6, $7)"
)


@dataclass(frozen=True)
class Origem:
    page_slug: str | None = None
    form_id: str | None = None
    site_id: str | None = None
    page_url: str | None = None
    page_path: str | None = None
    visitor_id: str | None = None
    canal: str | None = None


@dataclass(frozen=True)
class Consentimento:
    base_legal: str
    texto: str
    versao: str
    provisoria: bool
    ip: str | None
    user_agent: str | None


def ip_do_pedido(request) -> str | None:
    """O 1º do `X-Forwarded-For` (atrás do nginx da VPS), senão o IP da
    conexão — a mesma regra de `LimiteTaxaMiddleware._cliente`."""
    encaminhado = request.headers.get("x-forwarded-for")
    if encaminhado:
        primeiro = encaminhado.split(",")[0].strip()
        return primeiro[:100] or None
    return request.client.host if request.client else None


async def registrar_captura(conn, *, email: str, campos: dict, extras: dict,
                            origem: Origem, session_id: str | None,
                            consentimento: Consentimento | None, tags: list[str],
                            utm_da_conversao: dict | None = None,
                            canal_origem: str = "captura",
                            sql_identidade: str | None = None,
                            agendamento: bool = False) -> str:
    """Grava a captura e devolve o `lead_id`. `conn` já está numa transação
    (`sessao()`), e tudo aqui acontece nela.

    `campos` são colunas da lista branca (já higienizadas); `extras` vão para
    `leads.campos_extras`. `utm_da_conversao`, quando vem, são os UTMs do
    TOQUE desta conversão (o site manda o primeiro toque em `campos`, que vai
    para o contato, e o último toque aqui, que vai para a conversão); sem ele,
    a conversão leva os UTMs de `campos`, como sempre. `canal_origem` é o
    `origem` do evento de reconversão (`captura` ou `site`).

    Pergunta 73 (26/10): o que veio de contato em `campos`/`extras` fica na
    conversão (`dados_informados`, migration 031), e no evento de reconversão
    vai o que difere do contato (`informados_diferentes`) — o contato em si
    continua sem ser sobrescrito (`_atualizar`).

    `agendamento` (036, 28/10): a captura de quem CONFIRMOU um agendamento
    leva a marca no evento de conversão (novo: pelo gatilho; existente: pela
    reconversão) e não entra em jornada com nó `handoff_growthhs` — o
    agendamento cria o card, a jornada criaria o segundo.
    """
    # ⚠️ Sem `finally`, como a marca da página em `_inserir`: se algo falha,
    # a transação já está abortada (e a marca morre com ela) — desmarcar ali
    # levantaria outro erro por cima do verdadeiro.
    if agendamento:
        await marcar_agendamento(conn, True)
    lead_id = await _registrar(conn, email=email, campos=campos, extras=extras,
                               origem=origem, session_id=session_id,
                               consentimento=consentimento, tags=tags,
                               utm_da_conversao=utm_da_conversao,
                               canal_origem=canal_origem, sql_identidade=sql_identidade,
                               agendamento=agendamento)
    if agendamento:
        await marcar_agendamento(conn, False)
    return lead_id


async def _registrar(conn, *, email, campos, extras, origem, session_id, consentimento,
                     tags, utm_da_conversao, canal_origem, sql_identidade,
                     agendamento) -> str:
    informados = dados_informados(campos, extras)
    # ⚠️ `lower(email)`, não `email = $1`. `leads_email_unique` é única na
    # coluna CRUA, sem `lower()` — uma linha antiga gravada como
    # `Carla@Empresa.com` não seria achada por uma captura de
    # `carla@empresa.com`, nasceria um segundo contato vazio, e o score, a
    # tag e a conversão iriam para ele em vez do contato real.
    # `_resolver_lead`, em `publico.py`, já casa assim — os caminhos de
    # escrita deste sistema têm que concordar.
    existente = await conn.fetchrow(
        "SELECT id::text AS id, session_id, deleted_at, deleted_by, dnia_id::text "
        "AS dnia_id FROM leads WHERE lower(email) = $1", email)

    if existente is None:
        # O `form_submitted` do gatilho de INSERT leva a origem (026/027).
        lead_id = await _inserir(conn, email, session_id, campos, origem.page_slug,
                                 extras=extras, form_id=origem.form_id,
                                 site_id=origem.site_id)
        if lead_id is None:
            # ⚠️ `ON CONFLICT (email) DO NOTHING` não gravou: outra
            # requisição para o MESMO e-mail venceu a corrida entre o SELECT
            # acima e este INSERT — o caso canônico é duplo clique em Enviar.
            # Sem isto, o segundo INSERT bateria direto em
            # `leads_email_unique` e devolveria 500 para um lead real.
            # Reconsulta e segue pelo mesmo caminho de quem já achou o
            # contato.
            existente = await conn.fetchrow(
                "SELECT id::text AS id, session_id, deleted_at, deleted_by, "
                "dnia_id::text AS dnia_id FROM leads WHERE lower(email) = $1",
                email)
            lead_id = existente["id"]
            await _atualizar(conn, existente, session_id, campos, extras=extras)
            # ⚠️ Sem `publicar_conversao` aqui: quem venceu a corrida já
            # publicou o `form_submitted` desta origem (duplo clique).
    else:
        lead_id = existente["id"]
        await _atualizar(conn, existente, session_id, campos, extras=extras)
        # R5: contato que volta e converte de novo (o caso de "pediu
        # demonstração") também publica o evento, com a origem.
        # Pergunta 73: e com o que a pessoa informou de diferente do contato
        # — contra o contato DEPOIS do `_atualizar`, para o que só preencheu
        # campo vazio não aparecer como divergência.
        await publicar_conversao(conn, lead_id, origem.page_slug, origem=canal_origem,
                                 form_id=origem.form_id, site_id=origem.site_id,
                                 informados=await _diferentes_do_contato(
                                     conn, lead_id, informados),
                                 agendamento=agendamento)

    await _resolver_identidade(conn, lead_id, email, campos, sql=sql_identidade)

    utm = utm_da_conversao if utm_da_conversao is not None else campos
    valores = [lead_id, campos.get("tipo") or "lead", origem.page_slug, session_id,
               utm.get("utm_source"), utm.get("utm_medium"), utm.get("utm_campaign"),
               utm.get("utm_term"), utm.get("utm_content"), campos.get("source"),
               campos.get("ab_test"), campos.get("ab_var"), campos.get("ab_vid")]
    conversao_id = await conn.fetchval(
        """INSERT INTO lead_conversions
               (lead_id, tipo, converted_at, page_slug, session_id,
                utm_source, utm_medium, utm_campaign, utm_term, utm_content,
                source, ab_test, ab_var, ab_vid,
                form_id, site_id, visitor_id, page_url, page_path, canal)
           VALUES ($1::uuid, $2, now(), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                   $13, $14, $15::uuid, $16, $17, $18, $19)
        RETURNING id::text""",
        *valores, origem.form_id, origem.site_id, origem.visitor_id,
        origem.page_url, origem.page_path, origem.canal)
    await _gravar_informados(conn, conversao_id, informados)
    if consentimento is not None:
        await gravar_consentimento(conn, lead_id, conversao_id, consentimento, origem)

    # `lead_criado` no teste A/B: a landing lê `ab_*` da URL e manda aqui.
    await registrar_conversao_ab(
        conn, Ab(campos.get("ab_vid"), campos.get("ab_test"), campos.get("ab_var")),
        "lead_criado", lead_id=lead_id, page_slug=origem.page_slug)

    # A tag do slug primeiro, como sempre; depois as da config/do site.
    # ⚠️ Import tardio: `routers/publico.py` importa este pacote.
    from app.routers.publico import _aplicar_tag_do_slug
    aplicadas: set[str] = set()
    for tag in ([origem.page_slug] if origem.page_slug else []) + list(tags or []):
        if not isinstance(tag, str) or tag.strip().lower() in aplicadas:
            continue
        aplicada = await _aplicar_tag_do_slug(conn, lead_id, tag)
        if aplicada:
            aplicadas.add(aplicada)
    return lead_id


async def _tem_coluna_dados_informados(conn) -> bool:
    """A 031 está no banco? ⚠️ `'lead_conversions'::regclass` SEM schema, de
    propósito: resolve pelo `search_path`, como o INSERT acima — é a mesma
    tabela que acabou de receber a conversão. Sem cache: o custo é uma
    consulta ao catálogo, e um cache de processo mentiria depois de um
    rollback (testes) ou de uma migration desfeita."""
    return bool(await conn.fetchval(
        """SELECT EXISTS (SELECT 1 FROM pg_attribute
                           WHERE attrelid = 'lead_conversions'::regclass
                             AND attname = 'dados_informados' AND NOT attisdropped)"""))


async def _gravar_informados(conn, conversao_id: str, informados: dict | None) -> None:
    """`lead_conversions.dados_informados` (031) da conversão que acabou de
    nascer. ⚠️ Tolerante à ordem do deploy: sem a coluna, não grava e a
    captura segue como antes — nenhum caminho de falha nosso pode recusar um
    lead real, e o histórico é enriquecimento."""
    if not informados or not await _tem_coluna_dados_informados(conn):
        return
    await conn.execute(
        "UPDATE lead_conversions SET dados_informados = $2::jsonb WHERE id = $1::uuid",
        conversao_id, informados)


async def _diferentes_do_contato(conn, lead_id: str,
                                 informados: dict | None) -> list[dict] | None:
    """O que foi informado e difere do contato como ele está agora; `None`
    sem diferença (o evento não ganha a chave)."""
    if not informados:
        return None
    contato = await conn.fetchrow(
        """SELECT nome, empresa, cargo, whatsapp, phone_normalized, faturamento,
                  funcionarios, desafios, indicacao, campos_extras
             FROM leads WHERE id = $1::uuid""", lead_id)
    return divergencias(dict(contato) if contato else {}, informados) or None


async def gravar_consentimento(conn, lead_id: str, conversao_id: str,
                               c: Consentimento, origem: Origem) -> None:
    """Um registro por aceite, com o texto e a versão que valiam na hora.
    Nunca se atualiza: o histórico é a prova."""
    await conn.execute(
        """INSERT INTO lead_consents
               (lead_id, conversao_id, base_legal, texto, versao, provisoria, ip,
                user_agent, origem_tipo, page_slug, site_id, form_id, page_url)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11::uuid,
                   $12, $13)""",
        lead_id, conversao_id, c.base_legal, c.texto, c.versao, c.provisoria,
        c.ip, (c.user_agent or "")[:500] or None,
        "site" if origem.site_id else "pagina", origem.page_slug, origem.site_id,
        origem.form_id, origem.page_url)


async def _inserir(conn, email: str, session_id: str | None, campos: dict,
                   page_slug: str | None = None, *, extras: dict | None = None,
                   form_id: str | None = None, site_id: str | None = None) -> str | None:
    """⚠️ `tipo` é NOT NULL sem default em `leads`; o padrão da origem é 'lead'.

    As colunas saem das chaves de `campos`, que vêm da lista branca — nunca do
    corpo do request. Chave desconhecida o `higienizar` já descartou.

    ⚠️ `ON CONFLICT (email) DO NOTHING RETURNING id::text`: devolve `None`
    quando o e-mail já existe — duplo clique em Enviar chega aqui como dois
    requests concorrentes que passaram os dois pelo SELECT do chamador sem se
    verem. Quem chama trata o `None` reconsultando e seguindo pela
    atualização.
    """
    colunas = ["email", "session_id", "tipo"]
    valores = [email, session_id, campos.get("tipo") or "lead"]
    for chave, valor in campos.items():
        if chave == "tipo":
            continue
        colunas.append(chave)
        valores.append(valor)
    marcas = [f"${i}" for i in range(1, len(valores) + 1)]
    if extras:
        colunas.append("campos_extras")
        valores.append(extras)
        marcas.append(f"${len(valores)}::jsonb")
    # ⚠️ A marca da origem vale só para ESTE INSERT: o `fn_lead_insert_event`
    # a lê (migrations 026/027) e ela é desfeita logo depois. Sem `finally`:
    # se o INSERT falha, a transação já está abortada (e a marca morre com
    # ela) — desmarcar ali levantaria outro erro por cima do verdadeiro.
    await marcar_pagina(conn, page_slug, form_id=form_id, site_id=site_id)
    lead_id = await conn.fetchval(
        f"INSERT INTO leads ({', '.join(colunas)}) VALUES ({', '.join(marcas)}) "
        f"ON CONFLICT (email) DO NOTHING RETURNING id::text",
        *valores)
    await marcar_pagina(conn, None)
    return lead_id


async def _atualizar(conn, existente, session_id: str | None, campos: dict, *,
                     extras: dict | None = None) -> None:
    """Preenche o que estava vazio (nunca sobrescreve — ver abaixo), adota o
    `session_id` se ainda não havia, e REATIVA
    contato excluído — reconverter é sinal de que a pessoa voltou.

    ⚠️ A exclusão aqui é lógica (`deleted_at`), e o índice `leads_email_unique`
    não olha `deleted_at`: sem reativar, a segunda conversão da mesma pessoa
    bateria no índice e a captura falharia.

    ⚠️ `status` e `tipo` NÃO entram nas atribuições, embora estejam na lista
    branca de `higienizar`. Os dois são estado de CRM, não campo de
    formulário: no `_inserir` (contato NOVO) tudo bem — é assim que um lead
    nasce com `tipo='lead'`/`'participante'`/etc. Mas num contato JÁ
    EXISTENTE, gravar os dois deixaria qualquer pessoa que soubesse o e-mail
    mover o estágio de CRM de um contato real só reconvertendo pela landing.
    A assimetria entre os dois caminhos é DELIBERADA — não "harmonize" isto
    achando que é uma inconsistência a consertar.

    ⚠️ `campos_extras` segue a mesma regra, chave a chave: `novos || antigos`
    — no `||` do jsonb vence o lado DIREITO, então o que já existe fica e só
    a chave nova entra.
    """
    # ⚠️ NÃO DESTRUTIVA (R1, 02/10/2026). Esta rota é anônima: quem soubesse o
    # e-mail de um contato real trocava nome, cargo, empresa, WhatsApp e origem
    # dele mandando o formulário. Agora só se PREENCHE o que está vazio (NULL
    # ou ''), como `/publico/identidade`.
    #
    # ⚠️ O que a pessoa digitou de diferente NÃO fica no contato. Até 26/10 o
    # comentário daqui dizia que ficava em `lead_conversions` — e era falso:
    # a conversão só guardava a origem, e o valor se perdia (pergunta 73).
    # Desde a 031 ele fica em `lead_conversions.dados_informados` (gravado
    # por `registrar_captura`, `_gravar_informados`), e o que diverge do
    # contato vai no `metadata.informados_diferentes` do evento de
    # reconversão — é dali que o card do GrowthHS e a linha do tempo mostram
    # "Informou nesta conversão (não verificado)".
    #
    # ⚠️ Os UTMs andam em BLOCO, e é isso que congela o primeiro toque: se o
    # contato já tem QUALQUER utm_*, nenhum é tocado — misturar o
    # `utm_source` de um toque com o `utm_campaign` de outro inventaria uma
    # origem que nunca existiu. Sem nenhum, entra o bloco desta conversão.
    atribuicoes = {chave: valor for chave, valor in campos.items()
                   if chave not in ("status", "tipo")}
    if session_id and not existente["session_id"]:
        atribuicoes["session_id"] = session_id

    expressoes: dict[str, str] = {}
    valores: list = []
    sem_origem = " AND ".join(f"coalesce({u}, '') = ''" for u in UTMS)
    for nome, valor in atribuicoes.items():
        valores.append(valor)
        marca = f"${len(valores) + 1}"
        if nome in UTMS:
            expressoes[nome] = f"CASE WHEN {sem_origem} THEN {marca} ELSE {nome} END"
        elif isinstance(valor, str) and nome != "data_interesse":
            expressoes[nome] = f"COALESCE(NULLIF({nome}, ''), {marca})"
        else:
            expressoes[nome] = f"COALESCE({nome}, {marca})"
    if extras:
        valores.append(extras)
        expressoes["campos_extras"] = (
            f"${len(valores) + 1}::jsonb || coalesce(campos_extras, '{{}}'::jsonb)")

    estava_excluido = existente["deleted_at"] is not None
    if estava_excluido:
        expressoes["deleted_at"] = "NULL"
        expressoes["deleted_by"] = "NULL"

    if expressoes:
        # As expressões do SET leem a linha ANTIGA: o CASE do bloco de UTMs
        # decide sobre a origem que existia antes desta conversão.
        sets = ", ".join(f"{nome} = {expr}" for nome, expr in expressoes.items())
        await conn.execute(
            f"UPDATE leads SET {sets} WHERE id = $1::uuid",
            existente["id"], *valores)

    if estava_excluido:
        # ⚠️ `deleted_by` é `uuid` na tabela — asyncpg devolve um `uuid.UUID`,
        # e o codec jsonb desta conexão serializa com `json.dumps`, que não
        # sabe converter `UUID` sozinho. Sem o `str()`, a reativação levanta
        # `TypeError` e a captura toda falha por causa de um campo de
        # auditoria. `str(None)` nunca acontece aqui porque só entra neste
        # bloco quando `deleted_at` não é nulo.
        #
        # ⚠️ `dnia_id` vai no evento, como na origem: é por ele que o evento
        # entra no cruzamento de `idx_contact_events_universal_id` e no merge
        # de identidade. A primeira versão desta rota o esqueceu — corte
        # silencioso achado no portão.
        deleted_by = existente["deleted_by"]
        await conn.execute(
            """INSERT INTO contact_events
                   (lead_id, dnia_id, source_app, event_type, title, metadata)
               VALUES ($1::uuid, $3::uuid, 'marketinghs', 'contact_reactivated',
                       'Contato reativado por nova conversão', $2)""",
            existente["id"],
            {"previous_deleted_at": str(existente["deleted_at"]),
             "previous_deleted_by": str(deleted_by) if deleted_by else None,
             "reason": "captura_reconversao"},
            existente["dnia_id"])


async def _resolver_identidade(conn, lead_id: str, email: str, campos: dict, *,
                               sql: str | None = None) -> None:
    """Chama `resolve_or_create_identity` e escreve de volta o que ela resolveu.

    ⚠️ A function devolve `jsonb` (tipo escalar), não um conjunto de colunas —
    conferido em produção em 08/09/2026 com `\\df+` e uma chamada real. `SELECT
    * FROM resolve_or_create_identity(...)` dá uma linha com UMA coluna, de
    nome igual ao da function, carregando o dict inteiro — não colunas
    `dnia_id` / `phone_normalized` soltas. Por isso a chamada abaixo vai na
    lista de SELECT, não no FROM, e `fetchval` devolve o dict já decodificado
    pelo mesmo codec jsonb que `app.database._preparar_conexao` registra.

    ⚠️ **Não levanta — mas o `try/except` sozinho NÃO bastava.** `sessao()`
    entrega a conexão já dentro de `conn.transaction()`; a captura inteira é
    UMA transação só. Se `resolve_or_create_identity` levantar erro DE BANCO
    (ex.: `ecosystem_identities_phone_key UNIQUE (phone)` — dois leads reais
    com o mesmo telefone de escritório, caso comum na base da HS), o Postgres
    aborta o bloco de transação inteiro; um `except` comum engole a exceção
    Python mas não desfaz o aborto, e a instrução seguinte (o INSERT em
    `lead_conversions`) morre com `InFailedSQLTransactionError` sem
    tratamento — a captura vira 500 e o lead real é recusado, exatamente o
    que a regra "nenhum caminho de falha nosso pode recusar um lead real"
    proíbe. O `async with conn.transaction():` aninhado aqui dentro faz o
    asyncpg emitir um `SAVEPOINT` de verdade (confirmado lendo
    `asyncpg.transaction.Transaction.start`); o `except` então faz
    `ROLLBACK TO SAVEPOINT`, não aborta o resto da transação, e o INSERT
    seguinte roda normalmente. Identidade é enriquecimento: falhar nela não
    pode custar a conversão nem a tag.
    """
    try:
        async with conn.transaction():
            resultado = await conn.fetchval(
                sql or SQL_RESOLVE_IDENTIDADE,
                campos.get("whatsapp"), email, campos.get("nome"),
                "marketinghs", lead_id, campos.get("utm_source") or campos.get("source"),
                "lead")
            if not resultado or not resultado.get("dnia_id"):
                return
            await conn.execute(
                """UPDATE leads
                      SET dnia_id = $2::uuid,
                          phone_normalized = COALESCE($3, phone_normalized)
                    WHERE id = $1::uuid""",
                lead_id, str(resultado["dnia_id"]), resultado.get("phone_normalized"))
    except Exception as exc:  # noqa: BLE001 — ver o docstring
        logger.error("captura: identidade não resolvida para %s: %s", lead_id, exc)
