"""Escrita de contatos: status, tags em massa, edição, fusão e exclusão.

Separado de leitura_contatos.py de propósito: são superfícies com risco
diferente, e misturá-las torna difícil ver o que muda dado.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status as http
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, admin_atual

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/contatos", tags=["contatos-escrita"])


class StatusIn(BaseModel):
    status: str = Field(min_length=1, max_length=60)


class StatusEmLoteIn(BaseModel):
    lead_ids: list[str] = Field(min_length=1, max_length=10000)
    status: str = Field(min_length=1, max_length=60)


class TagEmLoteIn(BaseModel):
    lead_ids: list[str] = Field(min_length=1, max_length=10000)
    tag: str = Field(min_length=1, max_length=100)


class FusaoContatosIn(BaseModel):
    manter: str
    descartar: str


class EdicaoContatoIn(BaseModel):
    nome: str | None = None
    email: str | None = None
    whatsapp: str | None = None
    empresa: str | None = None
    cargo: str | None = None
    faturamento: str | None = None
    funcionarios: str | None = None
    desafios: str | None = None


# Colunas que a edição pode tocar. Lista fechada no código: nunca monte o
# UPDATE a partir das chaves que vieram no corpo da requisição.
_CAMPOS_EDITAVEIS = ("nome", "email", "whatsapp", "empresa", "cargo",
                     "faturamento", "funcionarios", "desafios")

# As tabelas que apontam para `leads` e precisam ser reatribuídas na fusão.
_TABELAS_FILHAS = ("lead_tags", "segment_contacts", "campaign_sends",
                   "lead_notes", "contact_events", "lead_conversions")

# Campos que o mantido herda do descartado QUANDO estiver vazio.
#
# ⚠️ `email` e `dnia_id` estão aqui porque a origem os herdava. Eu os havia
# esquecido, e a fusão perderia silenciosamente o e-mail de um contato que só o
# descartado tinha.
_CAMPOS_HERDAVEIS = ("nome", "email", "whatsapp", "empresa", "cargo",
                     "faturamento", "funcionarios", "desafios", "dnia_id",
                     "utm_source", "utm_medium", "utm_campaign", "utm_term",
                     "utm_content")


async def _resolver_status(conn, bruto: str) -> str:
    """Devolve o nome canônico do status. NÃO cria status novo.

    ⚠️ A origem criava. Ela buscava em `lead_statuses` e, se não achasse,
    inseria — e depois tentava gravar o valor em `leads.status`, que tinha um
    CHECK com sete valores cravados. Ou seja: a function criava status que o
    banco impedia de atribuir, e isso nunca apareceu porque os chamadores só
    mandavam os sete. Era uma régua em dois lugares, discordando.

    A migration 005 resolveu: o CHECK saiu, `lead_statuses` virou a fonte de
    verdade e `leads.status` tem FK para ela. Trocar o funil da HS passou a ser
    um INSERT na tabela, não uma migration.

    Consequência aqui: status desconhecido é ERRO com a lista do que vale, não
    criação silenciosa. Quem quiser um status novo o cadastra de propósito.
    """
    nome = bruto.strip()
    existente = await conn.fetchval(
        "SELECT name FROM lead_statuses WHERE lower(name) = lower($1)", nome)
    if existente:
        return existente
    validos = await conn.fetch("SELECT name FROM lead_statuses ORDER BY sort_order")
    raise HTTPException(
        http.HTTP_400_BAD_REQUEST,
        f"Status desconhecido: {nome!r}. Os que existem são: "
        + ", ".join(v["name"] for v in validos) + ".")


# Status cuja entrada merece um evento do tipo que a listagem conta.
#
# ⚠️ `contact_updated` NÃO está entre os sete tipos que o `status_changed_at`
# soma ('deal_moved', 'lead_qualified', 'meeting_scheduled',
# 'scheduling_widget_booked', 'deal_won', 'deal_lost', 'onboarding_started').
# Ele serve à métrica de agendamentos do dia. São coisas diferentes, e as duas
# precisam existir — por isso a qualificação grava DOIS eventos.
_EVENTO_POR_STATUS = {
    "Lead Qualificado": ("lead_qualified", "Lead qualificado"),
    "MQL - Reunião agendada": ("meeting_scheduled", "Reunião agendada"),
    "Venda realizada": ("deal_won", "Venda realizada"),
}


async def _registrar_mudanca(conn, lead_id: str, de: str | None, para: str,
                             origem: str = "manual",
                             descricao: str = "Mudança de status pelo painel",
                             gravar_generico: bool = True,
                             metadata_extra: dict | None = None) -> None:
    """Grava os eventos de mudança de status na timeline.

    ⚠️ Não é log opcional. A listagem calcula `status_changed_at` a partir
    destes eventos, e a ficha monta o histórico de status com eles. Sem o
    evento, a mudança aconteceu e ninguém consegue dizer quando.

    ⚠️ O original só gravava evento ao qualificar; as outras transições não
    deixavam rastro nenhum, e o histórico de status ficava com buraco. Aqui
    toda mudança grava `contact_updated`, e as três transições que a listagem
    conta gravam também o tipo específico dela.

    ⚠️ `status_atual`/`status_anterior` duplicam `para`/`de` na mesma
    metadata: são as chaves da ORIGEM, e `GET /painel/agendamentos/mql-hoje`
    (painel.py) lê `metadata->>'status_atual'` para contar quem entrou em
    "MQL - Reunião agendada" hoje — sem elas, o indicador nunca via a
    mudança, mesmo com o evento gravado.

    `gravar_generico=False` pula SÓ o INSERT genérico de `contact_updated`
    (mantém o evento específico de `_EVENTO_POR_STATUS`): existe para quem
    chama já grava seu PRÓPRIO `contact_updated` — hoje, `atualizar_contato`
    em `api_contato.py`, que junta tudo (status, campos, tags, note) num
    evento só. Sem isso, um PATCH com `status` duplicaria o `contact_updated`
    (e, por tabela, a linha de `journey_events` que o gatilho copia).

    `metadata_extra` mescla chaves adicionais SÓ no metadata do
    `contact_updated` genérico (`{**metadata, **metadata_extra}`) — nunca no
    evento específico. Existe para `atualizar_status` (`api_contato.py`)
    marcar `source: "api"`: sem ela, uma mudança de status feita pela API
    ficava idêntica à do painel na timeline, e a decisão 3 do plano do 8B
    conta justamente com `metadata.source` para dizer de onde veio. Padrão
    `None` — comportamento do painel (`mudar_status`) fica byte-idêntico.
    """
    if gravar_generico:
        metadata = {"de": de, "para": para, "status_anterior": de, "status_atual": para}
        if metadata_extra:
            metadata = {**metadata, **metadata_extra}
        await conn.execute(
            """INSERT INTO contact_events (lead_id, dnia_id, source_app, event_type,
                                           title, metadata)
               SELECT $1::uuid, l.dnia_id, 'marketinghs', 'contact_updated',
                      'Status alterado', $2::jsonb
                 FROM leads l WHERE l.id = $1::uuid""",
            lead_id, metadata)

    especifico = _EVENTO_POR_STATUS.get(para)
    if especifico:
        tipo, titulo = especifico
        await conn.execute(
            """INSERT INTO contact_events (lead_id, dnia_id, source_app, event_type,
                                           title, description, metadata)
               SELECT $1::uuid, l.dnia_id, 'marketinghs', $2, $3, $5,
                      jsonb_build_object('status_anterior', $4::text, 'origem', $6::text)
                 FROM leads l WHERE l.id = $1::uuid""",
            lead_id, tipo, titulo, de, descricao, origem)


@router.patch("/{lead_id}/status")
async def mudar_status(lead_id: str, dados: StatusIn,
                       admin: Usuario = Depends(admin_atual)):
    """Muda o status de um contato.

    O status e o evento na timeline acontecem na MESMA transação. Na tela
    original eram idas ao banco independentes: o status mudava e o evento podia
    não ser gravado sem que nada avisasse.
    """
    async with sessao(role="authenticated", user_id=admin.id) as conn:
        linha = await conn.fetchrow(
            "SELECT status FROM leads WHERE id = $1::uuid", lead_id)
        if linha is None:
            raise HTTPException(http.HTTP_404_NOT_FOUND, "Contato não encontrado.")
        anterior = linha["status"]

        novo = await _resolver_status(conn, dados.status)
        await conn.execute(
            "UPDATE leads SET status = $2 WHERE id = $1::uuid", lead_id, novo)
        await _registrar_mudanca(conn, lead_id, anterior, novo)

        # ⚠️ O estágio da identidade NÃO é tocado. O original avançava para
        # 'opportunity' ao qualificar, mas a régua de quais status avançam o
        # estágio é decisão de produto da HS e ainda não existe. Avançar por
        # engano é pior que não avançar. Registrado no ROADMAP.

    return {"status": novo, "anterior": anterior}


@router.post("/status-em-lote")
async def status_em_lote(dados: StatusEmLoteIn, admin: Usuario = Depends(admin_atual)):
    """Muda o status de vários contatos de uma vez.

    Um UPDATE só, e um INSERT ... SELECT para os eventos. A tela fazia lotes de
    100 num laço no navegador; aqui o banco resolve, e ou muda tudo ou nada.
    """
    async with sessao(role="authenticated", user_id=admin.id) as conn:
        novo = await _resolver_status(conn, dados.status)
        # ⚠️ Os eventos vêm ANTES do UPDATE: eles leem `l.status` para gravar o
        # valor anterior. Invertido, todo evento registraria "de X para X".
        await conn.execute(
            """INSERT INTO contact_events (lead_id, dnia_id, source_app, event_type,
                                           title, metadata)
               SELECT l.id, l.dnia_id, 'marketinghs', 'contact_updated',
                      'Status alterado',
                      jsonb_build_object('de', l.status, 'para', $2::text,
                                         'status_anterior', l.status, 'status_atual', $2::text)
                 FROM leads l
                WHERE l.id = ANY($1::uuid[]) AND l.status IS DISTINCT FROM $2""",
            dados.lead_ids, novo)
        especifico = _EVENTO_POR_STATUS.get(novo)
        if especifico:
            tipo, titulo = especifico
            await conn.execute(
                """INSERT INTO contact_events (lead_id, dnia_id, source_app, event_type,
                                               title, description, metadata)
                   SELECT l.id, l.dnia_id, 'marketinghs', $2, $3,
                          'Mudança de status em lote pelo painel',
                          jsonb_build_object('status_anterior', l.status, 'origem', 'lote')
                     FROM leads l
                    WHERE l.id = ANY($1::uuid[]) AND l.status IS DISTINCT FROM $4""",
                dados.lead_ids, tipo, titulo, novo)

        resultado = await conn.execute(
            "UPDATE leads SET status = $2 WHERE id = ANY($1::uuid[])",
            dados.lead_ids, novo)
    return {"atualizados": int(resultado.rsplit(" ", 1)[-1]), "status": novo}


@router.post("/tags-em-lote")
async def tags_em_lote(dados: TagEmLoteIn, admin: Usuario = Depends(admin_atual)):
    """Aplica uma tag a vários contatos.

    A tag é criada se não existir, com o mesmo upsert do lote 1A e pelo mesmo
    motivo: `tags_name_key` é único e a criação concorrente derruba as
    perdedoras.

    O vínculo usa ON CONFLICT DO NOTHING sobre a PK (lead_id, tag_id): aplicar a
    mesma tag a quem já a tem não é erro, é ausência de mudança.
    """
    nome = dados.tag.strip()
    async with sessao(role="authenticated", user_id=admin.id) as conn:
        tag_id = await conn.fetchval(
            "SELECT id FROM tags WHERE lower(name) = lower($1)", nome)
        if tag_id is None:
            tag_id = await conn.fetchval(
                """INSERT INTO tags (name) VALUES ($1)
                   ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
                   RETURNING id""", nome)
        resultado = await conn.execute(
            """INSERT INTO lead_tags (lead_id, tag_id)
               SELECT unnest($1::uuid[]), $2
               ON CONFLICT DO NOTHING""",
            dados.lead_ids, tag_id)
    return {"vinculados": int(resultado.rsplit(" ", 1)[-1]), "tag": nome}


@router.post("/fundir")
async def fundir_contatos(dados: FusaoContatosIn, _: Usuario = Depends(admin_atual)):
    """Funde dois contatos. São TRÊS casos, e quem decide qual é o servidor.

    A tela original ramificava sozinha, comparando os `dnia_id` no navegador.
    Isso é regra de negócio, e regra de negócio que mora na tela some quando
    aparece uma segunda tela.

      1. Mesma identidade, ou nenhum dos dois tem — funde os LEADS de verdade:
         reatribui as seis tabelas filhas e apaga o descartado.
      2. Identidades diferentes — não são o mesmo lead ainda; funde as
         IDENTIDADES pela RPC `merge_identities`, que é transacional e já
         existia.
      3. Só um tem identidade — vincula o outro à mesma, sem apagar ninguém.

    ⚠️ A razão de o caso 1 ser um endpoint é a TRANSAÇÃO. Na tela eram sete idas
    ao banco independentes, com try/catch e sem rollback: falhar no meio deixava
    tags e segmentos já migrados, o descartado ainda existindo, e os dois
    apontando para os mesmos dados. Fechar o navegador produzia o mesmo estado.
    """
    if dados.manter == dados.descartar:
        raise HTTPException(http.HTTP_400_BAD_REQUEST, "Os dois contatos são o mesmo.")

    # ⚠️ Fica `service_role` (a rota autoriza sozinha, `admin_atual`). Única do
    # router que NÃO foi para `authenticated` em 01/10: `lead_conversions` não
    # tem política de UPDATE, então a reatribuição dela afetaria 0 linhas
    # calada — e o DELETE do descartado logo abaixo levaria as conversões
    # junto pelo ON DELETE CASCADE. Perda de dado reportada como sucesso.
    # Converter exige antes uma política de UPDATE admin em `lead_conversions`.
    async with sessao(role="service_role") as conn:
        manter = await conn.fetchrow(
            "SELECT id::text, dnia_id::text FROM leads WHERE id = $1::uuid", dados.manter)
        descartar = await conn.fetchrow(
            "SELECT id::text, dnia_id::text FROM leads WHERE id = $1::uuid", dados.descartar)
        if manter is None:
            raise HTTPException(http.HTTP_404_NOT_FOUND, "Contato a manter não encontrado.")
        if descartar is None:
            raise HTTPException(http.HTTP_404_NOT_FOUND, "Contato a descartar não encontrado.")

        dm, dd = manter["dnia_id"], descartar["dnia_id"]

        # --- Caso 2: identidades diferentes. Funde as identidades, não os leads.
        if dm and dd and dm != dd:
            resultado = await conn.fetchval(
                "SELECT merge_identities(p_keep => $1::uuid, p_discard => $2::uuid)", dm, dd)
            return {"caso": "identidades", "resultado": resultado}

        # --- Caso 3: só um tem identidade. Vincula o outro à mesma.
        if bool(dm) != bool(dd):
            identidade = dm or dd
            alvo = dados.manter if not dm else dados.descartar
            # `leads.dnia_id` não tem índice único (auditado na origem), então
            # este UPDATE não colide.
            await conn.execute(
                "UPDATE leads SET dnia_id = $2::uuid WHERE id = $1::uuid", alvo, identidade)
            return {"caso": "vinculo", "identidade": identidade}

        # --- Caso 1: mesma identidade ou nenhuma. Funde os leads.
        await conn.execute(
            """DELETE FROM lead_tags d WHERE d.lead_id = $2::uuid
                 AND EXISTS (SELECT 1 FROM lead_tags m
                              WHERE m.lead_id = $1::uuid AND m.tag_id = d.tag_id)""",
            dados.manter, dados.descartar)
        await conn.execute(
            """DELETE FROM segment_contacts d WHERE d.lead_id = $2::uuid
                 AND EXISTS (SELECT 1 FROM segment_contacts m
                              WHERE m.lead_id = $1::uuid AND m.segment_id = d.segment_id)""",
            dados.manter, dados.descartar)

        movidos = {}
        for tabela in _TABELAS_FILHAS:
            r = await conn.execute(
                f"UPDATE {tabela} SET lead_id = $1::uuid WHERE lead_id = $2::uuid",
                dados.manter, dados.descartar)
            movidos[tabela] = int(r.rsplit(" ", 1)[-1])

        # ⚠️ A ORDEM AQUI IMPORTA, e a origem aprendeu isso na prática — o
        # comentário dela documenta o defeito. `leads` tem `leads_email_unique`
        # UNIQUE (email): copiar o e-mail do descartado para o mantido ENQUANTO
        # o descartado ainda existe viola a constraint. Na tela antiga o erro
        # não era checado, o preenchimento falhava em silêncio, e o e-mail era
        # destruído junto com o descartado no delete seguinte.
        #
        # Apaga primeiro (liberando o e-mail), preenche depois. Seguro nesta
        # ordem porque tudo que o CASCADE levaria junto já foi reatribuído.
        #
        # A cópia dos campos é feita numa variável ANTES do delete, porque
        # depois dele a linha do descartado não existe mais para ser lida.
        origem = await conn.fetchrow(
            f"SELECT {', '.join(_CAMPOS_HERDAVEIS)} FROM leads WHERE id = $1::uuid",
            dados.descartar)
        await conn.execute("DELETE FROM leads WHERE id = $1::uuid", dados.descartar)

        atribuicoes = ", ".join(
            f"{c} = COALESCE({c}, ${i + 2})" for i, c in enumerate(_CAMPOS_HERDAVEIS))
        await conn.execute(
            f"UPDATE leads SET {atribuicoes} WHERE id = $1::uuid",
            dados.manter, *[origem[c] for c in _CAMPOS_HERDAVEIS])

    return {"caso": "leads", "mantido": dados.manter, "movidos": movidos}


@router.patch("/{lead_id}")
async def editar_contato(lead_id: str, dados: EdicaoContatoIn,
                         admin: Usuario = Depends(admin_atual)):
    """Edita os campos do contato.

    Só o que veio no corpo é tocado — campo ausente não é instrução de apagar,
    mesma regra da importação. As colunas vêm de _CAMPOS_EDITAVEIS, lista
    fechada no código: o UPDATE nunca é montado a partir das chaves da
    requisição.
    """
    campos = {c: v for c, v in dados.model_dump(exclude_unset=True).items()
              if c in _CAMPOS_EDITAVEIS}
    if not campos:
        raise HTTPException(http.HTTP_400_BAD_REQUEST, "Nada para atualizar.")

    atribuicoes = ", ".join(f"{c} = ${i + 2}" for i, c in enumerate(campos))
    async with sessao(role="authenticated", user_id=admin.id) as conn:
        r = await conn.execute(
            f"UPDATE leads SET {atribuicoes} WHERE id = $1::uuid",
            lead_id, *campos.values())
    if r.endswith(" 0"):
        raise HTTPException(http.HTTP_404_NOT_FOUND, "Contato não encontrado.")
    return {"atualizados": list(campos)}


@router.delete("/{lead_id}", status_code=http.HTTP_204_NO_CONTENT)
async def excluir_contato(lead_id: str, admin: Usuario = Depends(admin_atual)):
    """Exclusão LÓGICA: marca `deleted_at` e `deleted_by`.

    Verificado na function de origem: ela faz update, não delete. Isso fecha com
    as três visões da listagem (ativos / apagados / todos).

    `deleted_by` existia e ninguém o preenchia pela tela. Um registro de quem
    apagou vale mais que a coluna vazia.

    ⚠️ Excluir não apaga o card no GrowthHS (decisão 12 do 8D). A origem
    chamava a API do Nexus para apagar o contato lá também, antes de marcar
    aqui; o contrato do GrowthHS não tem rota de exclusão, e apagar card de
    vendedor é decisão do CRM, não do MarketingHS. Registrado como pergunta
    em aberto no contrato (docs/contratos/2026-09-02-endpoint-card-comercial-growthhs.md).
    """
    async with sessao(role="authenticated", user_id=admin.id) as conn:
        r = await conn.execute(
            """UPDATE leads SET deleted_at = now(), deleted_by = $2::uuid
                WHERE id = $1::uuid AND deleted_at IS NULL""",
            lead_id, admin.id)
    if r.endswith(" 0"):
        raise HTTPException(http.HTTP_404_NOT_FOUND,
                            "Contato não encontrado ou já excluído.")
