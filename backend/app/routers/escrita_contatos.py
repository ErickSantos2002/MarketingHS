"""Escrita de contatos: status, tags em massa, edição, fusão e exclusão.

Separado de leitura_contatos.py de propósito: são superfícies com risco
diferente, e misturá-las torna difícil ver o que muda dado.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status as http
from pydantic import BaseModel, Field

from app.database import PAPEIS, sessao
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
#
# ⚠️ Decisão 23+24 do Erick (01/10/2026): a fusão leva TODO o histórico. Até
# então só as seis primeiras iam; as outras ficavam para trás e o DELETE do
# descartado as levava pelo CASCADE (`journey_runs`, `crm_handoffs`) ou as
# deixava com `lead_id` NULL (`email_events`, `email_suppressions`,
# `journey_step_log`), ou apontando para um id que não existe mais (as sem FK:
# `email_send_queue` — de onde sai o link de descadastro —, `email_send_dead`,
# `ab_events`, `ab_identities`).
#
# Três delas têm índice único que envolve `lead_id` e pedem regra antes do
# UPDATE — ver `_preparar_unicos`. Fora da lista, de propósito:
# `journey_events` (fila de trânsito, consumida a cada tick; sem GRANT para
# `authenticated`, ver a migration 022) — essa não se move, se APAGA: ver
# `_apagar_fila_de_jornada` (pergunta 40, rodada 7).
_TABELAS_FILHAS = ("lead_tags", "segment_contacts", "campaign_sends",
                   "lead_notes", "contact_events", "lead_conversions",
                   "journey_runs", "journey_step_log", "crm_handoffs",
                   "email_events", "email_suppressions",
                   "email_send_queue", "email_send_dead",
                   "ab_events", "ab_identities")

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
async def fundir_contatos(dados: FusaoContatosIn, admin: Usuario = Depends(admin_atual)):
    """Funde dois contatos. São TRÊS casos, e quem decide qual é o servidor.

    A tela original ramificava sozinha, comparando os `dnia_id` no navegador.
    Isso é regra de negócio, e regra de negócio que mora na tela some quando
    aparece uma segunda tela.

      1. Mesma identidade, ou nenhum dos dois tem — funde os LEADS de verdade:
         reatribui TODO o histórico (`_TABELAS_FILHAS`) e apaga o descartado.
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

    # `authenticated` desde a rodada 5 (01/10/2026), com a migration 022
    # aplicada: ela deu ao admin a política de UPDATE que faltava em
    # `lead_conversions`, `journey_runs`, `journey_step_log` e `email_events`,
    # e RLS + política + GRANT em `crm_handoffs`, `email_send_queue` e
    # `email_send_dead`. ⚠️ Sem isso a reatribuição afetaria 0 linhas CALADA e
    # o DELETE do descartado levaria pelo CASCADE o que não foi movido — perda
    # de histórico reportada como sucesso. `test_fusao_historico.py` roda a
    # fusão inteira sob este papel e exige que as 15 tabelas movam linha.
    async with sessao(role="authenticated", user_id=admin.id) as conn:
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
        resultado = await fundir_leads(conn, dados.manter, dados.descartar)

    return {"caso": "leads", "mantido": dados.manter, **resultado}


async def _preparar_unicos(conn, manter: str, descartar: str) -> dict:
    """O que impediria o UPDATE de `lead_id` de passar pelos índices únicos.

    Regra geral: **o mantido ganha** — é ele que fica, e o que ele já tem não
    se mexe. Do descartado, o que colidiria é resolvido assim:

    - `lead_tags`, `segment_contacts`: o vínculo repetido sai (é o mesmo
      vínculo; como sempre foi).
    - `journey_runs` (`uniq_journey_runs_open`: um run ABERTO por fluxo e
      contato): o run aberto do descartado num fluxo em que o mantido também
      está aberto é ENCERRADO (`exited`) e depois reatribuído — o histórico
      fica, mas o contato não anda duas vezes no mesmo fluxo nem recebe o
      e-mail do mesmo nó duas vezes. Encerrar é o mais seguro: não apaga
      nada, e o run do mantido (que já está andando) segue intacto.
    - `crm_handoffs` (`uniq_crm_handoffs_pendente`: um pedido PENDENTE por
      contato e ação): o pendente do descartado sai quando o mantido já tem um
      pendente da mesma ação — é o mesmo pedido duas vezes, e o gatilho de
      automação já faz isso (ON CONFLICT DO NOTHING). Entregue ou falhou não
      colide e vai inteiro.
    - `campaign_sends` (`uniq_campaign_sends_email_campaign_lead`, intocável:
      um e-mail por campanha e contato): o envio do descartado numa campanha
      que o mantido também recebeu NÃO é movido — fica com `lead_id` NULL pelo
      ON DELETE SET NULL, como ficava antes de existir a fusão. Até 01/10 essa
      colisão derrubava a fusão inteira com 500 (dois cadastros da mesma
      pessoa costumam receber a mesma campanha).
    """
    feito = {}
    for tabela, chave in (("lead_tags", "tag_id"), ("segment_contacts", "segment_id")):
        r = await conn.execute(
            f"""DELETE FROM {tabela} d WHERE d.lead_id = $2::uuid
                  AND EXISTS (SELECT 1 FROM {tabela} m
                               WHERE m.lead_id = $1::uuid AND m.{chave} = d.{chave})""",
            manter, descartar)
        feito[f"{tabela}_repetidos"] = int(r.rsplit(" ", 1)[-1])

    r = await conn.execute(
        """UPDATE journey_runs d
              SET state = 'exited', lock_token = NULL, locked_until = NULL,
                  context = d.context || jsonb_build_object(
                      'encerrado_por', 'fusao', 'fundido_em', $1::text),
                  updated_at = now()
            WHERE d.lead_id = $2::uuid AND d.state IN ('active', 'waiting')
              AND EXISTS (SELECT 1 FROM journey_runs m
                           WHERE m.lead_id = $1::uuid AND m.journey_id = d.journey_id
                             AND m.state IN ('active', 'waiting'))""",
        manter, descartar)
    feito["runs_encerrados"] = int(r.rsplit(" ", 1)[-1])

    r = await conn.execute(
        """DELETE FROM crm_handoffs d
            WHERE d.lead_id = $2::uuid AND d.status = 'pendente'
              AND EXISTS (SELECT 1 FROM crm_handoffs m
                           WHERE m.lead_id = $1::uuid AND m.acao = d.acao
                             AND m.status = 'pendente')""",
        manter, descartar)
    feito["pedidos_repetidos"] = int(r.rsplit(" ", 1)[-1])
    return feito


# O predicado de `uniq_campaign_sends_email_campaign_lead`, do lado do
# descartado: o envio que colidiria com um do mantido fica onde está.
_ENVIO_COLIDE = """d.channel = 'email' AND d.campaign_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM campaign_sends m
                 WHERE m.lead_id = $1::uuid AND m.campaign_id = d.campaign_id
                   AND m.channel = 'email')"""


async def fundir_leads(conn, manter: str, descartar: str) -> dict:
    """Caso 1 da fusão, dentro da transação de quem chama: reatribui todo o
    histórico do descartado ao mantido, apaga o descartado e preenche os
    campos vazios do mantido com os dele. Separado da rota para o teste rodar
    numa transação revertida."""
    resolvidos = await _preparar_unicos(conn, manter, descartar)

    movidos = {}
    for tabela in _TABELAS_FILHAS:
        filtro = f" AND NOT ({_ENVIO_COLIDE})" if tabela == "campaign_sends" else ""
        r = await conn.execute(
            f"UPDATE {tabela} d SET lead_id = $1::uuid WHERE d.lead_id = $2::uuid{filtro}",
            manter, descartar)
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
        descartar)
    fila_apagada = await _apagar_fila_de_jornada(conn, descartar)
    await conn.execute("DELETE FROM leads WHERE id = $1::uuid", descartar)

    atribuicoes = ", ".join(
        f"{c} = COALESCE({c}, ${i + 2})" for i, c in enumerate(_CAMPOS_HERDAVEIS))
    await conn.execute(
        f"UPDATE leads SET {atribuicoes} WHERE id = $1::uuid",
        manter, *[origem[c] for c in _CAMPOS_HERDAVEIS])
    return {"movidos": movidos, "resolvidos": resolvidos,
            "fila_de_jornada_apagada": fila_apagada}


async def _apagar_fila_de_jornada(conn, descartar: str) -> int:
    """Apaga o que o descartado tem em `journey_events` (pergunta 40 (a),
    02/10/2026), na transação da fusão.

    `journey_events` é fila de trânsito (o gatilho copia cada `contact_event`
    para lá e o worker consome), sem FK para `leads`. Movê-la para o mantido
    reprocessaria eventos já vistos — matrícula em fluxo de novo; deixá-la
    deixava a linha apontando para um lead que não existe mais. Apagar é a
    decisão.

    ⚠️ `authenticated` só tem INSERT em `journey_events` (migration 010: é o
    gatilho que grava). O DELETE desce a `service_role` por UMA instrução e
    volta ao papel de quem chamou, na mesma transação — `SET LOCAL` reverte
    sozinho no fim dela, e `app.current_user_id` não é tocado. A rota já
    autorizou (`admin_atual`) antes de chegar aqui, e o filtro é o id exato do
    descartado: não há o que o RLS protegeria. A alternativa sem elevação é
    uma migration (GRANT DELETE + política admin, ou função SECURITY DEFINER)
    — ver o arquivo da frente.
    """
    papel = await conn.fetchval("SELECT current_user")
    if papel not in PAPEIS:
        raise RuntimeError(f"fusão fora de sessao(): papel {papel!r}")
    await conn.execute("SET LOCAL ROLE service_role")
    # Sem try/finally de propósito: se o DELETE falhar a transação já está
    # abortada, o SET da volta falharia também e esconderia o erro de verdade.
    r = await conn.execute(
        "DELETE FROM journey_events WHERE lead_id = $1::uuid", descartar)
    # Nome vindo de `current_user` e conferido em PAPEIS acima: nunca de
    # entrada do usuário (SET ROLE não aceita parâmetro).
    await conn.execute(f"SET LOCAL ROLE {papel}")
    return int(r.rsplit(" ", 1)[-1])


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
