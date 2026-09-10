"""Configuração do sistema. Tira do navegador o acesso direto a scoring_config
e a tags — dois dos 68 pontos que a spec mandou fechar."""

import re

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from app.chave_api import admin_ou_maquina
from app.database import sessao
from app.dependencies import Usuario, admin_atual, usuario_atual
from app.email import resend as cliente_resend
from app.integracoes import gravar_segredo, ler_segredo

router = APIRouter(tags=["configuracao"])


class ScoringOut(BaseModel):
    criteria: dict
    thresholds: dict
    updated_at: str | None


class ScoringIn(BaseModel):
    criteria: dict
    thresholds: dict


class TagOut(BaseModel):
    id: str
    nome: str
    cor: str | None = None


class TagIn(BaseModel):
    nome: str = Field(min_length=1, max_length=100)
    cor: str | None = Field(default=None, pattern="^#[0-9a-fA-F]{6}$")


@router.get("/config/scoring", response_model=ScoringOut)
async def ler_scoring(_: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            "SELECT criteria, thresholds, updated_at::text FROM scoring_config LIMIT 1")
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            "Nenhuma régua de scoring configurada.")
    return ScoringOut(**dict(linha))


@router.put("/config/scoring", response_model=ScoringOut)
async def gravar_scoring(dados: ScoringIn, _: Usuario = Depends(admin_atual)):
    """⚠️ Gravar aqui NÃO repontua a base. Os triggers só rodam em INSERT e
    UPDATE de `leads`; mudar a régua não toca em linha nenhuma. Depois de
    salvar, chame POST /contatos/recalcular-scores — a tela deve deixar isso
    explícito para quem edita."""
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            """UPDATE scoring_config
                  SET criteria = $1::jsonb, thresholds = $2::jsonb, updated_at = now()
                WHERE id = (SELECT id FROM scoring_config LIMIT 1)
            RETURNING criteria, thresholds, updated_at::text""",
            dados.criteria, dados.thresholds)
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            "Nenhuma régua de scoring para atualizar.")
    return ScoringOut(**dict(linha))


@router.get("/tags", response_model=list[TagOut])
async def listar_tags(_: Usuario = Depends(usuario_atual)):
    # A coluna no schema é `name`; a resposta fala `nome`. A tradução mora aqui
    # e em nenhum outro lugar.
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            "SELECT id::text, name AS nome, color AS cor FROM tags ORDER BY name")
    return [TagOut(**dict(l)) for l in linhas]


# ── Redes sociais da marca ───────────────────────────────────────────────────
# ⚠️ NÃO passa por `/preferencias/{chave}`. Aquela rota compõe a chave com o id
# de quem está autenticado, de propósito — é preferência POR USUÁRIO. Rede
# social da marca é GLOBAL: por lá, cada admin guardaria a sua, e o rodapé do
# e-mail mudaria conforme quem editou por último.

CHAVE_REDES_SOCIAIS = "social_links"


@router.get("/config/redes-sociais")
async def ler_redes_sociais(_: Usuario = Depends(usuario_atual)):
    """Leitura em `usuario_atual`: o editor de e-mail precisa dos ícones para
    montar o rodapé, e não são segredo — são links públicos da marca."""
    async with sessao(role="service_role") as conn:
        valor = await conn.fetchval(
            "SELECT setting_value FROM dashboard_settings WHERE setting_key = $1",
            CHAVE_REDES_SOCIAIS)
    return {"valor": valor}


@router.put("/config/redes-sociais")
async def gravar_redes_sociais(corpo: dict, _: Usuario = Depends(admin_atual)):
    """Escrita em `admin_atual`: é config de marca, não preferência de tela."""
    async with sessao(role="service_role") as conn:
        await conn.execute(
            """INSERT INTO dashboard_settings (setting_key, setting_value)
               VALUES ($1, $2::jsonb)
               ON CONFLICT (setting_key) DO UPDATE
                 SET setting_value = EXCLUDED.setting_value, updated_at = now()""",
            CHAVE_REDES_SOCIAIS, corpo.get("valor"))
    return {"valor": corpo.get("valor")}


@router.get("/lead-statuses")
async def listar_status_de_lead(_: Usuario = Depends(usuario_atual)):
    """O funil, na ordem em que a tela desenha.

    ⚠️ `leads.status` é FK para `lead_statuses(name)` — quem inventar um status
    no cliente toma erro de integridade do banco, que é o certo. Foi por isso
    que o lote 5B NÃO criou um status "Cliente" para os contatos do DataCore:
    mexer no funil é decisão de produto.
    """
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            """SELECT id::text, name, color, sort_order, is_system
                 FROM lead_statuses ORDER BY sort_order, name""")
    return [dict(l) for l in linhas]


@router.get("/tipos-de-contato", response_model=list[str])
async def listar_tipos(_: Usuario = Depends(usuario_atual)):
    """Os valores de `leads.tipo` que existem de verdade na base.

    ⚠️ O construtor de segmentos trazia esta lista FIXA no código, herdada da
    dn.ia ("modal_pago", "Evento 14/04/26", "Lançamento 24 e 25Fev"...). Ela já
    não incluía `csv_import`, do lote 1A, e não incluiria `datacore`, do 5B —
    ou seja, dava para importar contatos que ninguém conseguia segmentar. Uma
    lista de valores do banco escrita à mão envelhece calada; esta não.
    """
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            """SELECT DISTINCT tipo FROM leads
                WHERE tipo IS NOT NULL AND btrim(tipo) <> '' AND deleted_at IS NULL
                ORDER BY tipo""")
    return [l["tipo"] for l in linhas]


@router.post("/tags", response_model=TagOut, status_code=status.HTTP_201_CREATED)
async def criar_tag(dados: TagIn, _: Usuario = Depends(usuario_atual)):
    """⚠️ Upsert, não INSERT — pelo mesmo motivo do lote 1A: `tags_name_key` é
    único, e duas pessoas criando a mesma tag ao mesmo tempo derrubariam uma
    delas com 500. DO UPDATE e não DO NOTHING, para o RETURNING devolver a linha
    também no conflito.

    ⚠️ `COALESCE(tags.color, EXCLUDED.color)` e não o contrário: a cor de quem
    já existe vence. Criar uma tag que já existe é engano de quem digitou, não
    pedido para repintar — e repintar mudaria a aparência dela em todo contato
    que a usa, sem ninguém pedir.

    Na prática o COALESCE sempre cai no primeiro ramo: `tags.color` tem DEFAULT
    'purple' e nunca é nulo. Ou seja, **cor de tag só muda por edição
    explícita**. Mantive o COALESCE mesmo assim: se alguém tirar o default um
    dia, o comportamento continua o desejado sem precisar lembrar disto.
    Trocar tag existente de cor é operação de tela de tags, não de criar."""
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            """INSERT INTO tags (name, color) VALUES ($1, $2)
               ON CONFLICT (name) DO UPDATE SET color = COALESCE(tags.color, EXCLUDED.color)
               RETURNING id::text, name AS nome, color AS cor""",
            dados.nome.strip(), dados.cor)
    return TagOut(**dict(linha))


@router.delete("/notas/{nota_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remover_nota(nota_id: str, _: Usuario = Depends(usuario_atual)):
    """A nota se identifica sozinha; não precisa do contato no caminho."""
    async with sessao(role="service_role") as conn:
        await conn.execute("DELETE FROM lead_notes WHERE id = $1::uuid", nota_id)


@router.get("/preferencias/{chave}")
async def ler_preferencia(chave: str, usuario: Usuario = Depends(usuario_atual)):
    """Preferência de tela, por usuário.

    ⚠️ A chave é composta no SERVIDOR, com o id de quem está autenticado. Se o
    cliente mandasse a chave inteira, um usuário leria a preferência de outro só
    trocando o texto. `dashboard_settings` é global — não tem coluna de dono —,
    então o isolamento vem daqui e de nenhum outro lugar.
    """
    async with sessao(role="service_role") as conn:
        valor = await conn.fetchval(
            "SELECT setting_value FROM dashboard_settings WHERE setting_key = $1",
            f"{usuario.id}:{chave}")
    return {"valor": valor}


@router.put("/preferencias/{chave}")
async def gravar_preferencia(chave: str, corpo: dict,
                             usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        await conn.execute(
            """INSERT INTO dashboard_settings (setting_key, setting_value)
               VALUES ($1, $2::jsonb)
               ON CONFLICT (setting_key) DO UPDATE
                 SET setting_value = EXCLUDED.setting_value, updated_at = now()""",
            f"{usuario.id}:{chave}", corpo.get("valor"))
    return {"valor": corpo.get("valor")}


# ── Lista de supressão ───────────────────────────────────────────────────────
# Quem está aqui não recebe e-mail de campanha, e o worker confere esta tabela
# imediatamente antes de cada envio.

class SupressaoIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)


@router.get("/supressoes")
async def listar_supressoes(
    busca: str | None = Query(None, alias="q"),
    pagina: int = Query(1, alias="page", ge=1),
    limite: int = Query(20, alias="limit", ge=1, le=100),
    _: Usuario = Depends(admin_atual),
):
    """Lista paginada, com busca por endereço.

    ⚠️ `admin_atual`, não `usuario_atual`. Um usuário autenticado sem papel
    (`sem_papel`, o que existe neste sistema) poderia paginar a lista inteira —
    e ela não é só uma lista de endereços: o `reason` diz quem marcou a gente
    como spam e quem deu hard bounce. É informação sobre comportamento, mais
    sensível que a agenda de contatos.
    """
    padrao = f"%{busca.strip()}%" if busca and busca.strip() else None
    async with sessao(role="service_role") as conn:
        total = await conn.fetchval(
            "SELECT count(*) FROM email_suppressions "
            "WHERE $1::text IS NULL OR email ILIKE $1", padrao)
        linhas = await conn.fetch(
            """SELECT id::text, email, reason, source, lead_id::text,
                      created_at::text
                 FROM email_suppressions
                WHERE $1::text IS NULL OR email ILIKE $1
                ORDER BY created_at DESC
                LIMIT $2 OFFSET $3""",
            padrao, limite, (pagina - 1) * limite)
    return {
        "data": [dict(l) for l in linhas],
        "pagination": {"page": pagina, "limit": limite, "total": total,
                       "pages": (total + limite - 1) // limite},
    }


@router.post("/supressoes", status_code=status.HTTP_201_CREATED)
async def suprimir(dados: SupressaoIn, _: Usuario = Depends(admin_atual)):
    """Supressão manual, feita pelo admin.

    ⚠️ `admin_atual`: suprimir bloqueia um endereço de receber qualquer
    campanha, para sempre, e a tela vive em Configurações.

    ⚠️ Endereço já suprimido devolve 200 com `ja_existia`, não 409. Suprimir é
    idempotente por natureza: quem clica quer o endereço fora da lista de envio,
    e um erro aqui sugeriria que não está.

    ⚠️ A razão da PRIMEIRA supressão prevalece (`DO NOTHING`). Sobrescrever um
    `complaint` por `manual` apagaria a informação mais grave que temos sobre
    aquele endereço.
    """
    email = dados.email.strip().lower()
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            """INSERT INTO email_suppressions (email, reason, source)
               VALUES ($1, 'manual', 'admin')
               ON CONFLICT (email) DO NOTHING
               RETURNING id::text""", email)
    return {"email": email, "ja_existia": linha is None}


@router.delete("/supressoes/{supressao_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remover_supressao(supressao_id: str, _: Usuario = Depends(admin_atual)):
    """Tira o endereço da lista — ele volta a poder receber campanha.

    ⚠️ `admin_atual`, e aqui é o caso mais grave dos três: isso desfaz também
    bounce e reclamação, que vieram do provedor. Remover um endereço que pediu
    descadastro o faz voltar a receber e-mail — o oposto do que ele pediu — e
    remover um hard bounce faz o envio ser tentado de novo, piorando a
    reputação do remetente. É decisão do admin, e a tela avisa antes.
    """
    async with sessao(role="service_role") as conn:
        r = await conn.execute(
            "DELETE FROM email_suppressions WHERE id = $1::uuid", supressao_id)
    if r.endswith(" 0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Supressão não encontrada.")


# ── Configuração do Resend ───────────────────────────────────────────────────
# Os segredos moram em `integration_secrets` (ver app/integracoes.py), não no
# repositório e não no .env de produção.
#
# ⚠️ Restaurado por inteiro no lote 8A. O 3C (`ecca32d`) tinha tirado teste de
# chave, domínios, rastreamento e diagnóstico, e — sem ninguém decidir isso — a
# tela perdeu o caminho para gravar o UNSUBSCRIBE_SECRET, sem o qual o worker
# não consome a fila. O Erick decidiu em 10/09/2026 restaurar tudo.

SEGREDOS_RESEND = {
    "api_key": "RESEND_API_KEY",
    "email_from": "EMAIL_FROM",
    "unsubscribe_secret": "UNSUBSCRIBE_SECRET",
    "webhook_secret": "RESEND_WEBHOOK_SECRET",
}

_REMETENTE = re.compile(r"^\s*(.+?)\s*<([^@\s<>]+)@([^\s<>]+)>\s*$")


def partes_do_remetente(email_from: str | None) -> dict | None:
    """`"Nome <prefixo@dominio>"` → as três partes que a tela edita.

    ⚠️ O remetente mora no segredo EMAIL_FROM, que é o que o worker lê — não em
    `dashboard_settings.resend_from` como na origem. Dois lugares para o
    remetente é o defeito que o `integracoes.py` existe para acabar; as partes
    saem do próprio valor.
    """
    if not email_from:
        return None
    achado = _REMETENTE.match(email_from)
    if not achado:
        return None
    return {"nome": achado[1], "prefixo": achado[2], "dominio": achado[3]}


_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
TAMANHO_MINIMO_DESCADASTRO = 32


class ResendIn(BaseModel):
    # O remetente vem em três partes, como na origem: é o que permite conferir
    # o domínio contra a conta do Resend.
    from_name: str = Field(min_length=1, max_length=100)
    from_prefix: str = Field(min_length=1, max_length=64)
    from_domain: str = Field(min_length=1, max_length=253)
    # Opcionais: a tela manda vazio quando o admin não digitou. Vazio é "não
    # mexi", não "apague".
    api_key: str | None = None
    unsubscribe_secret: str | None = None
    webhook_secret: str | None = None


def _preenchido(valor: str | None) -> str | None:
    return valor.strip() if valor and valor.strip() else None


def _verificado(dominio: dict) -> bool:
    envio_ligado = (dominio.get("capabilities") or {}).get("sending") == "enabled"
    situacao = dominio.get("status") or ""
    return situacao == "verified" or (situacao.startswith("partially_") and envio_ligado)


@router.get("/config/resend")
async def ler_config_resend(request: Request,
                            _: str = Depends(admin_ou_maquina("read"))):
    """O que está configurado — NUNCA o valor de um segredo.

    ⚠️ Devolver o valor colocaria a RESEND_API_KEY no HTML de qualquer admin
    logado, e num log de proxy no caminho. `EMAIL_FROM` é a exceção: não é
    segredo, é o endereço que aparece na caixa de entrada de quem recebe.

    Com chave gravada, testa a chave de novo — é o que dá o escopo e a lista de
    domínios. A origem fazia o mesmo a cada leitura.
    """
    valores = {campo: await ler_segredo(nome)
               for campo, nome in SEGREDOS_RESEND.items()}
    chave = valores["api_key"] or ""

    escopo, dominios = None, []
    if chave:
        teste = await cliente_resend.testar_chave(chave)
        if teste["valida"]:
            escopo, dominios = teste["escopo"], teste["dominios"]

    return {
        "resend_api_key": {"configurado": bool(chave),
                           "ultimos4": chave[-4:] if len(chave) >= 4 else None,
                           "escopo": escopo},
        "email_from": valores["email_from"],
        "remetente": partes_do_remetente(valores["email_from"]),
        "unsubscribe_secret": {"configurado": bool(valores["unsubscribe_secret"])},
        "webhook_secret": {"configurado": bool(valores["webhook_secret"])},
        "dominios": dominios,
        # Montado pelo próprio request: o host de produção ainda não foi
        # decidido (item 11), e cravar um aqui repetiria o link de anúncio que
        # o subprojeto A pegou apontando para o lugar errado.
        "webhook_url": str(request.url_for("resend_webhook")),
    }


class TesteDeChaveIn(BaseModel):
    api_key: str = Field(min_length=1, max_length=500)


@router.post("/config/resend/testar")
async def testar_chave_resend(dados: TesteDeChaveIn,
                              _: str = Depends(admin_ou_maquina("read"))):
    """Classifica a chave SEM gravar. É leitura: não muda nada."""
    return await cliente_resend.testar_chave(dados.api_key.strip())


@router.get("/config/resend/diagnostico")
async def diagnostico_resend(_: str = Depends(admin_ou_maquina("read"))):
    """O que era `resend-config-check`: está tudo no lugar, e o Resend responde?

    ⚠️ O segredo de descadastro vem num campo PRÓPRIO, fora de `faltando`: a
    ausência dele não afeta a conexão com o Resend, mas faz o worker não
    consumir a fila. A tela mostra os dois avisos separados.

    Diferente da origem: chave *sending-only* responde `ok: true` com lista de
    domínios vazia. A origem tratava como `api_error` — chave válida acusada
    como falha.
    """
    chave = await ler_segredo("RESEND_API_KEY")
    remetente = await ler_segredo("EMAIL_FROM")
    segredo_webhook = await ler_segredo("RESEND_WEBHOOK_SECRET")
    sem_descadastro = not await ler_segredo("UNSUBSCRIBE_SECRET")

    faltando = [nome for nome, valor in (("RESEND_API_KEY", chave),
                                         ("EMAIL_FROM", remetente),
                                         ("RESEND_WEBHOOK_SECRET", segredo_webhook))
                if not valor]
    if faltando:
        return {"ok": False, "faltando": faltando,
                "segredo_descadastro_faltando": sem_descadastro}

    teste = await cliente_resend.testar_chave(chave)
    if not teste["valida"]:
        return {"ok": False, "faltando": [],
                "segredo_descadastro_faltando": sem_descadastro,
                "erro_api": f"O Resend recusou a chave ({teste['motivo']})."}
    return {"ok": True, "faltando": [],
            "segredo_descadastro_faltando": sem_descadastro,
            "remetente": remetente,
            "dominios": [{"name": d["name"], "status": d["status"]}
                         for d in teste["dominios"]]}


@router.put("/config/resend")
async def gravar_config_resend(dados: ResendIn,
                               _: str = Depends(admin_ou_maquina("write"))):
    """Grava a configuração, na ordem da origem: TUDO é validado antes de
    qualquer coisa ser gravada.

    ⚠️ O segredo de descadastro é obrigatório — vindo agora OU já gravado. Sem
    ele o worker não consome a fila, e e-mail de campanha sem link de
    descadastro viola a exigência de one-click do Gmail e do Yahoo.
    """
    nome = dados.from_name.strip()
    prefixo = dados.from_prefix.strip()
    dominio = dados.from_domain.strip().lower()
    chave_nova = _preenchido(dados.api_key)
    descadastro = _preenchido(dados.unsubscribe_secret)
    segredo_webhook = _preenchido(dados.webhook_secret)

    # 1. Chave nova é testada antes de qualquer coisa. Sem chave nova, a
    #    gravada serve só para conferir o domínio.
    if chave_nova:
        teste = await cliente_resend.testar_chave(chave_nova)
        if not teste["valida"]:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Chave do Resend inválida ou inacessível ({teste['motivo']}).")
    else:
        gravada = await ler_segredo("RESEND_API_KEY")
        teste = await cliente_resend.testar_chave(gravada) if gravada else None

    # 2. Domínio verificado — só dá para exigir com chave de escopo completo.
    aviso = None
    if teste and teste["valida"] and teste["escopo"] == "full":
        achado = next((d for d in teste["dominios"]
                       if (d.get("name") or "").lower() == dominio), None)
        if achado is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                f'Domínio "{dominio}" não encontrado na conta Resend.')
        if not _verificado(achado):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f'Domínio "{dominio}" não está verificado (status: {achado.get("status")}).')
    else:
        aviso = ("Não foi possível confirmar a verificação do domínio (chave "
                 "somente-envio ou ainda não testada) — confira manualmente em "
                 "resend.com/domains.")

    # 3. O remetente final.
    endereco = f"{prefixo}@{dominio}"
    if not _EMAIL.match(endereco):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Prefixo e domínio formam um endereço de remetente inválido.")
    remetente = f"{nome} <{endereco}>"

    # 4. Os segredos, antes de gravar qualquer um.
    if descadastro is not None and len(descadastro) < TAMANHO_MINIMO_DESCADASTRO:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"O segredo de descadastro precisa de pelo menos "
            f"{TAMANHO_MINIMO_DESCADASTRO} caracteres.")
    if descadastro is None and not await ler_segredo("UNSUBSCRIBE_SECRET"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "O segredo de descadastro é obrigatório. Sem ele os e-mails saem sem "
            "link de descadastro e o worker não envia nada.")
    if segredo_webhook and not segredo_webhook.startswith("whsec_"):
        # A chave do HMAC é o base64 do segredo SEM o prefixo. Sem `whsec_`
        # toda assinatura falharia e os eventos seriam rejeitados em silêncio.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            'O segredo do webhook começa com "whsec_" — é o signing secret que '
            "o Resend mostra ao criar o webhook.")

    # 5. Grava — só depois de tudo validado.
    gravados = []
    for campo, valor in (("api_key", chave_nova), ("unsubscribe_secret", descadastro),
                         ("webhook_secret", segredo_webhook)):
        if valor:
            await gravar_segredo(SEGREDOS_RESEND[campo], valor)
            gravados.append(campo)
    await gravar_segredo("EMAIL_FROM", remetente)
    gravados.append("email_from")

    return {"gravados": gravados, "email_from": remetente, "aviso": aviso}


# ── Configuração do Meta ─────────────────────────────────────────────────────
# Mesmo desenho do Resend: os segredos moram em `integration_secrets`, e a
# leitura NUNCA devolve o valor.
#
# ⚠️ A tabela `meta_config` do dump não é usada. Ela tem 0 linhas e ter dois
# lugares de segredo é o defeito que o app/integracoes.py existe para acabar.

class MetaIn(BaseModel):
    # Opcionais, como no Resend: campo ausente ou vazio é "não mexi", nunca
    # "apague". Para apagar existe `limpar`.
    pixel_id: str | None = None
    access_token: str | None = None
    test_event_code: str | None = None
    limpar: list[str] = []


SEGREDOS_META = {
    "pixel_id": "META_PIXEL_ID",
    "access_token": "META_ACCESS_TOKEN",
    "test_event_code": "META_TEST_EVENT_CODE",
}


@router.get("/config/meta")
async def ler_config_meta(_: Usuario = Depends(admin_atual)):
    """O que está configurado.

    ⚠️ `access_token` NUNCA volta inteiro — é ele que autoriza postar conversão
    no pixel da HS. `pixel_id` e `test_event_code` voltam: o pixel id aparece no
    HTML de qualquer página que carrega o Pixel, e o código de teste só vale no
    Events Manager. Esconder os dois só atrapalharia quem confere.
    """
    from app.dominio import meta_capi

    creds = await meta_capi.credenciais()
    token = creds.access_token or ""
    return {
        "pixel_id": creds.pixel_id,
        "access_token": {"configurado": bool(token),
                         "ultimos4": token[-4:] if len(token) >= 4 else None},
        "test_event_code": creds.test_event_code,
        "configurado": creds.configurado,
    }


@router.put("/config/meta")
async def gravar_config_meta(dados: MetaIn, _: Usuario = Depends(admin_atual)):
    """Grava só o que veio preenchido; apaga só o que veio em `limpar`."""
    from app.integracoes import apagar_segredo, gravar_segredo

    if dados.pixel_id and dados.pixel_id.strip():
        if not re.fullmatch(r"\d{6,25}", dados.pixel_id.strip()):
            # O pixel id é numérico. Colar a URL do Events Manager inteira, ou o
            # nome do dataset, faz todo evento ser recusado por 404 no Graph —
            # e a mensagem do Meta não diz que o problema é o id.
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "O Pixel ID é só números (6 a 25 dígitos), como aparece em "
                "Events Manager → Fontes de dados.")

    desconhecidos = [c for c in dados.limpar if c not in SEGREDOS_META]
    if desconhecidos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Campos desconhecidos: {', '.join(desconhecidos)}")

    gravados, limpados = [], []
    for campo, nome in SEGREDOS_META.items():
        if campo in dados.limpar:
            await apagar_segredo(nome)
            limpados.append(campo)
            continue
        valor = getattr(dados, campo)
        if valor and valor.strip():
            await gravar_segredo(nome, valor.strip())
            gravados.append(campo)
    return {"gravados": gravados, "limpados": limpados}


@router.post("/config/meta/testar")
async def testar_config_meta(_: Usuario = Depends(admin_atual)):
    """Manda um evento de teste ao Events Manager.

    ⚠️ EXIGE `test_event_code`. Sem ele o evento entraria na conta de verdade e
    contaria como conversão — um lead que não existe, na base de otimização de
    campanha. Recusar é o certo.
    """
    from app.dominio import meta_capi

    creds = await meta_capi.credenciais()
    if not creds.configurado:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Preencha o Pixel ID e o access token antes de testar.")
    if not creds.test_event_code:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Preencha o test event code. Sem ele o evento de teste entraria na "
            "conta de verdade e contaria como conversão.")

    evento = meta_capi.montar_evento(
        "Lead",
        email="teste-marketinghs@exemplo.invalid",
        custom_data={"origem": "teste de configuração do MarketingHS"})
    try:
        resposta = await meta_capi.enviar([evento], creds=creds)
    except httpx.HTTPStatusError as e:
        # A mensagem do Meta é específica e útil (token expirado, pixel
        # inexistente, permissão faltando). Repassá-la poupa uma ida ao log.
        detalhe = e.response.text[:500]
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"O Meta recusou o evento ({e.response.status_code}): {detalhe}")
    except httpx.HTTPError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                            f"Não foi possível falar com o Meta: {e}")
    return {"enviado": True, "resposta": resposta}


# ── Configuração da IA ───────────────────────────────────────────────────────
# Mesmo desenho do Resend e do Meta: o segredo mora em `integration_secrets` e
# a leitura NUNCA devolve o valor.

class IAIn(BaseModel):
    api_key: str | None = None
    limpar: bool = False


@router.get("/config/ia")
async def ler_config_ia(_: Usuario = Depends(admin_atual)):
    """O que está configurado. Nunca a chave.

    O modelo volta porque não é segredo e é o que a pessoa precisa conferir para
    saber o que vai ser cobrado.
    """
    from app.ia import cliente as ia_cliente
    from app.integracoes import ler_segredo

    chave = await ler_segredo(ia_cliente.SEGREDO_CHAVE) or ""
    return {
        "anthropic_api_key": {"configurado": bool(chave),
                              "ultimos4": chave[-4:] if len(chave) >= 4 else None},
        "modelo": ia_cliente.MODELO,
    }


@router.put("/config/ia")
async def gravar_config_ia(dados: IAIn, _: Usuario = Depends(admin_atual)):
    """Grava só o que veio preenchido; apaga só se `limpar` vier verdadeiro."""
    from app.ia import cliente as ia_cliente
    from app.integracoes import apagar_segredo, gravar_segredo

    if dados.limpar:
        await apagar_segredo(ia_cliente.SEGREDO_CHAVE)
        return {"gravado": False, "limpado": True}

    if not dados.api_key or not dados.api_key.strip():
        # String vazia é "não mexi", não "apague" — mesma regra do Resend.
        return {"gravado": False, "limpado": False}

    valor = dados.api_key.strip()
    if not valor.startswith("sk-ant-"):
        # A chave da Anthropic começa com sk-ant-. Colar a do Resend ou o token
        # do Meta aqui faria toda chamada dar 401, e a mensagem da Anthropic não
        # diz que o problema é a chave ser de outro serviço.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            'A chave da Anthropic começa com "sk-ant-". Confira se você não '
            "colou a chave de outro serviço.")
    await gravar_segredo(ia_cliente.SEGREDO_CHAVE, valor)
    return {"gravado": True, "limpado": False}
