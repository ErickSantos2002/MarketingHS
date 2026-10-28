"""Configuração do sistema. Tira do navegador o acesso direto a scoring_config
e a tags — dois dos 68 pontos que a spec mandou fechar."""

import os
import re
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator

from app.chave_api import admin_ou_maquina
from app.config import settings
from app.database import sessao
from app.dependencies import Usuario, admin_atual, usuario_atual
from app.email import resend as cliente_resend
from app.integracoes import apagar_segredo, gravar_segredo, ler_segredo

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
    "reply_to": "EMAIL_REPLY_TO",
}

# O reply-to é UM endereço simples: sem nome de exibição, sem vírgula (dois
# destinatários), sem espaço nem quebra de linha (injeção de cabeçalho).
# `fullmatch`, não `match` com `$`: o `$` aceita um `\n` no fim.
_RESPONDER_PARA = re.compile(r"[^\s@<>,;\"']+@[^\s@<>,;\"']+\.[^\s@<>,;\"'.][^\s@<>,;\"']*")


def responder_para_valido(valor: str) -> bool:
    return bool(_RESPONDER_PARA.fullmatch(valor or ""))

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
    # ⚠️ Diferente dos segredos acima: aqui vazio É "apague" (volta a responder
    # ao remetente) — o reply-to é opcional e a tela sempre manda o campo.
    # Ausente (`None`, cliente antigo) é que é "não mexi".
    reply_to: str | None = Field(default=None, max_length=320)


def _preenchido(valor: str | None) -> str | None:
    return valor.strip() if valor and valor.strip() else None


def _verificado(dominio: dict) -> bool:
    envio_ligado = (dominio.get("capabilities") or {}).get("sending") == "enabled"
    situacao = dominio.get("status") or ""
    return situacao == "verified" or (situacao.startswith("partially_") and envio_ligado)


def url_do_webhook_resend(base: str) -> str:
    """A URL pública que se cadastra no painel do Resend.

    ⚠️ Não é `request.url_for`: atrás do proxy do EasyPanel o request chega em
    `http` e sem o `/api/`, que o nginx tira antes de repassar ao backend — a
    tela mostrava uma URL que não responde. Sai do `FRONTEND_URL`, como o link
    de descadastro do worker (`url_de_descadastro_um_clique`).
    """
    return f"{base.rstrip('/')}/api/publico/webhook/resend"


@router.get("/config/resend")
async def ler_config_resend(_: str = Depends(admin_ou_maquina("read"))):
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
        # Em claro, como o EMAIL_FROM: é um endereço, não um segredo.
        "reply_to": valores["reply_to"] or None,
        "unsubscribe_secret": {"configurado": bool(valores["unsubscribe_secret"])},
        "webhook_secret": {"configurado": bool(valores["webhook_secret"])},
        "dominios": dominios,
        "webhook_url": url_do_webhook_resend(settings.FRONTEND_URL),
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
        erro_api = ("Falha ao conectar ao Resend." if teste["motivo"] == "network"
                    else f"O Resend recusou a chave ({teste['motivo']}).")
        return {"ok": False, "faltando": [],
                "segredo_descadastro_faltando": sem_descadastro,
                "erro_api": erro_api}
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
    # None = não mexer; "" = apagar; o resto, validado no passo 4.
    responder_para = dados.reply_to.strip() if dados.reply_to is not None else None

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
    if responder_para and not responder_para_valido(responder_para):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            '"Responder para" precisa ser um único e-mail simples, como '
            "hs@healthsafety.com.br — sem nome, sem vírgula, sem quebra de linha.")

    # 5. Grava — só depois de tudo validado.
    gravados = []
    for campo, valor in (("api_key", chave_nova), ("unsubscribe_secret", descadastro),
                         ("webhook_secret", segredo_webhook)):
        if valor:
            await gravar_segredo(SEGREDOS_RESEND[campo], valor)
            gravados.append(campo)
    await gravar_segredo("EMAIL_FROM", remetente)
    gravados.append("email_from")
    if responder_para:
        await gravar_segredo("EMAIL_REPLY_TO", responder_para)
        gravados.append("reply_to")
    elif responder_para == "":
        await apagar_segredo("EMAIL_REPLY_TO")
        gravados.append("reply_to")

    return {"gravados": gravados, "email_from": remetente,
            "reply_to": (responder_para if responder_para is not None
                         else await ler_segredo("EMAIL_REPLY_TO")) or None,
            "aviso": aviso}


class RastreamentoIn(BaseModel):
    subdominio: str = Field(default="links", min_length=1, max_length=63,
                            pattern=r"^[a-z0-9-]+$")
    abertura: bool = True
    clique: bool = True


async def _chave_gravada() -> str:
    chave = await ler_segredo("RESEND_API_KEY")
    if not chave:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "RESEND_API_KEY não configurada — salve a chave antes.")
    return chave


def _info_do_dominio(info: dict) -> dict:
    return {k: info[k] for k in ("open_tracking", "click_tracking",
                                 "tracking_subdomain", "status", "records")}


@router.get("/config/resend/dominios/{dominio_id}")
async def ler_dominio_resend(dominio_id: str,
                             _: str = Depends(admin_ou_maquina("read"))):
    """O estado real do rastreamento de um domínio (`domain_info` da origem).

    ⚠️ Chave *sending-only* ou domínio inexistente NÃO é erro: é um estado que
    a tela mostra ("não dá para consultar por aqui"). Responde 200 com
    `disponivel: false`, como a origem.
    """
    info = await cliente_resend.ler_dominio(await _chave_gravada(), dominio_id)
    if not info["ok"]:
        return {"disponivel": False, "motivo": info["motivo"]}
    return {"disponivel": True, **_info_do_dominio(info)}


@router.post("/config/resend/dominios/{dominio_id}/rastreamento")
async def ligar_rastreamento_resend(dominio_id: str, dados: RastreamentoIn,
                                    _: str = Depends(admin_ou_maquina("write"))):
    """Liga open/click tracking no domínio (`enable_tracking` da origem).

    O Resend vem com os dois DESLIGADOS — é por isso que o webhook recebe
    `email.delivered` mas nunca `email.opened`. Ligar exige um CNAME novo no
    DNS, que só quem administra o domínio aplica: a resposta devolve os
    registros para a tela mostrar.
    """
    chave = await _chave_gravada()
    try:
        resposta = await cliente_resend.alterar_dominio(chave, dominio_id, {
            "open_tracking": dados.abertura, "click_tracking": dados.clique,
            "tracking_subdomain": dados.subdominio})
    except cliente_resend.FalhaDeRede:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                            "Não foi possível conectar à API do Resend.")

    if resposta.status_code == 401:
        if cliente_resend.restrita(resposta):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                'A chave configurada é do tipo "somente envio", e o Resend não '
                "permite alterar domínios com ela. Gere uma chave de acesso "
                "completo em resend.com/api-keys, salve-a aqui e tente de novo.")
        # ⚠️ NUNCA 401 aqui: é o Resend recusando a CHAVE GRAVADA, não a sessão
        # de quem clicou. O wrapper do admin (`pedir()` em lib/api.ts) trata
        # TODO 401 como sessão vencida e desloga — um 401 nesta rota derrubaria
        # o admin no meio do clique em "Ativar rastreamento".
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "A chave salva foi rejeitada pelo Resend ao ativar o rastreamento "
            "— confira se ela ainda vale.")
    if not resposta.is_success:
        try:
            mensagem = resposta.json().get("message")
        except ValueError:
            mensagem = None
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            mensagem or f"O Resend recusou a alteração (status {resposta.status_code}).")

    info = await cliente_resend.ler_dominio(chave, dominio_id)
    if not info["ok"]:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "O rastreamento foi ativado, mas não deu para confirmar o estado. "
            "Recarregue a página.")
    return {"sucesso": True, **_info_do_dominio(info),
            "tracking_subdomain": info["tracking_subdomain"] or dados.subdominio}


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


# ============================================================================
# GrowthHS — para onde vai o lead qualificado (lote 8D; API real em 22/10)
# ============================================================================

# Desde a 030 (23/10) há DOIS GrowthHS salvos lado a lado — homologação e
# produção —, cada um com a própria linha em `growthhs_config` e os próprios
# segredos; só o ATIVO recebe lead e só o webhook dele vale.
AMBIENTES_GROWTHHS = ("homologacao", "producao")
# Os dois segredos que a tela grava e `limpar` aceita apagar, por ambiente —
# a chave em integration_secrets sai de `growthhs.segredo_cliente/webhook`.
_SEGREDOS_GROWTHHS = ("client_secret", "webhook_secret")
EVENTOS_WEBHOOK_GROWTHHS = ("meeting_scheduled", "deal_won", "deal_lost", "no_show")
MAX_LISTA_GROWTHHS = 10
# As listas que provam cada evento do webhook de volta, com o nome que a
# recusa de cruzamento mostra (029 + 032).
_LISTAS_DE_EVENTO = ("listas_reuniao", "listas_ganho", "listas_perdido", "listas_no_show")
_NOME_DA_LISTA = {"listas_reuniao": "reunião", "listas_ganho": "ganho",
                  "listas_perdido": "perdido", "listas_no_show": "no show"}
MAX_ID_GROWTHHS = 9223372036854775807  # bigint
MIN_SEGREDO_WEBHOOK = 16
MAX_DETALHE_TESTE = 200


def _vazio_e_none(valor):
    """String vazia (ou só espaço) é "não mexi", não "apague" — mesma regra
    do Resend. ⚠️ O resto passa por `strip()`: o GrowthHS faz strip do segredo
    dele antes de assinar/comparar, então um espaço colado aqui seria 401
    eterno — e a mensagem de lá não diz que o problema é o espaço."""
    if valor is None:
        return None
    valor = valor.strip()
    return valor or None


class GrowthHSIn(BaseModel):
    base_url: str | None = None
    app_url: str | None = None
    client_id: str | None = Field(default=None, max_length=200)
    client_secret: str | None = None
    list_id: int | None = Field(default=None, gt=0, le=MAX_ID_GROWTHHS)
    boards_conferidos: list[int] | None = None
    listas_reuniao: list[int] | None = None
    listas_ganho: list[int] | None = None
    listas_perdido: list[int] | None = None
    listas_no_show: list[int] | None = None
    webhook_secret: str | None = None
    # `list[str]`, não `Literal`: campo desconhecido devolve 400 com o nome
    # dele (como no 8D), em vez do 422 genérico do pydantic.
    limpar: list[str] = Field(default_factory=list)

    @field_validator("base_url", "app_url")
    @classmethod
    def _endereco(cls, valor):
        """Só http/https, com host, sem usuário/senha, sem query string, sem
        fragmento e com porta válida (revisão final, M5: `?x=1` iria colado
        na frente de todo caminho da API, e porta inválida só estourava na
        fila, pedido a pedido).

        ⚠️ IP privado NÃO é recusado: a API do GrowthHS pode ser legítima
        pelo nome interno do EasyPanel (`http://erick_hsgrowth-api:8000`). A
        defesa contra virar leitor de URL interna é outra: nenhuma resposta
        de lá volta crua (`growthhs.texto_do_erro`). Credencial na URL
        apareceria inteira no GET desta tela — por isso sai."""
        if valor is None or not valor.strip():
            return None
        valor = valor.strip().rstrip("/")
        try:
            partes = urlsplit(valor)
            host = partes.hostname
            partes.port  # ⚠️ porta fora de 0–65535 ou não numérica levanta aqui
        except ValueError:
            raise ValueError("endereço inválido") from None
        if partes.scheme.lower() not in ("http", "https") or not host or re.search(r"\s", valor):
            raise ValueError("use o endereço completo, com https://")
        if partes.username or partes.password or "@" in partes.netloc:
            raise ValueError("não coloque usuário ou senha no endereço")
        if partes.fragment or "#" in valor:
            raise ValueError("o endereço não pode ter # (fragmento)")
        if partes.query or "?" in valor:
            raise ValueError("o endereço não pode ter ? (parâmetros)")
        return valor

    @field_validator("client_id", "client_secret")
    @classmethod
    def _sem_espaco(cls, valor):
        return _vazio_e_none(valor)

    @field_validator("webhook_secret")
    @classmethod
    def _segredo_webhook(cls, valor):
        valor = _vazio_e_none(valor)
        if valor is not None and len(valor) < MIN_SEGREDO_WEBHOOK:
            raise ValueError(f"o segredo do webhook precisa de pelo menos "
                             f"{MIN_SEGREDO_WEBHOOK} caracteres")
        return valor

    @field_validator("boards_conferidos", *_LISTAS_DE_EVENTO)
    @classmethod
    def _ids(cls, valor):
        """Ids do GrowthHS: inteiros > 0, sem repetidos, no máximo 10.
        ⚠️ Repetido não é inofensivo: na busca de card aberto viraria duas
        chamadas ao mesmo board, e na tela pareceria que há dois funis."""
        if valor is None:
            return None
        if len(valor) > MAX_LISTA_GROWTHHS:
            raise ValueError(f"no máximo {MAX_LISTA_GROWTHHS} ids")
        if any(v <= 0 or v > MAX_ID_GROWTHHS for v in valor):
            raise ValueError("cada id precisa ser um número maior que zero")
        if len(set(valor)) != len(valor):
            raise ValueError("há id repetido")
        return valor

    @field_validator(*_LISTAS_DE_EVENTO)
    @classmethod
    def _ao_menos_uma(cls, valor):
        """⚠️ Lista vazia aqui faria o webhook de volta ignorar TODO evento em
        silêncio (nenhuma lista prova reunião/ganho) — 200 para o GrowthHS e
        nada no contato. `null` continua sendo "não mexi"; `boards_conferidos`
        vazio é aceito (só deixa `configurado` falso, e isso aparece)."""
        if valor is not None and not valor:
            raise ValueError("informe ao menos uma lista")
        return valor


# Revisão final do 8D (M3): falha que já foi resolvida — o lead chegou ao
# comercial depois, por reenfileiramento, botão ou regra — não é falha. O
# painel acusando o que já está no GrowthHS ensina a ignorar o painel.
_FALHA_EM_ABERTO = """h.status = 'falhou'
    AND NOT EXISTS (SELECT 1 FROM crm_handoffs e
                     WHERE e.lead_id = h.lead_id AND e.acao = 'criar'
                       AND e.status = 'entregue' AND e.id > h.id)"""


def urls_do_webhook_growthhs(base: str, ambiente: str) -> dict:
    """As URLs que se cadastram na automação do GrowthHS DAQUELE ambiente, uma
    por evento. Saem do `FRONTEND_URL`, pelo mesmo motivo de
    `url_do_webhook_resend` (atrás do proxy o request chega em `http` e sem o
    `/api/`)."""
    raiz = f"{base.rstrip('/')}/api/publico/growthhs/webhook/{ambiente}?evento="
    return {e: raiz + e for e in EVENTOS_WEBHOOK_GROWTHHS}


def _ambiente_growthhs(ambiente: str) -> str:
    if ambiente not in AMBIENTES_GROWTHHS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ambiente do GrowthHS desconhecido.")
    return ambiente


def _nome_do_segredo(campo: str, ambiente: str) -> str:
    from app.crm import growthhs

    return (growthhs.segredo_cliente(ambiente) if campo == "client_secret"
            else growthhs.segredo_webhook(ambiente))


def _faltando(cfg) -> list[str]:
    """O que impede o ambiente de receber lead — dito na recusa do "Usar este
    ambiente" e na tela."""
    return [nome for ok, nome in (
        (cfg.base_url, "endereço da API"), (cfg.client_id, "Client ID"),
        (cfg.client_secret, "Client secret"), (cfg.list_id, "lista de entrada"),
        (cfg.boards_conferidos, "boards conferidos")) if not ok]


async def _estado_do_ambiente(ambiente: str, ativo: str | None) -> dict:
    from app.crm import growthhs

    cfg = await growthhs.ler_config_do_ambiente(ambiente)
    segredo = cfg.client_secret or ""
    webhook = await ler_segredo(growthhs.segredo_webhook(ambiente))
    # ⚠️ Nenhum valor de segredo sai daqui: do client_secret, só os 4 últimos
    # (para saber QUAL está gravado); do segredo do webhook, nem isso — ele é
    # a única coisa que separa um POST forjado de "venda realizada".
    return {
        "ambiente": ambiente, "ativo": ambiente == ativo,
        "base_url": cfg.base_url, "app_url": cfg.app_url, "client_id": cfg.client_id,
        "list_id": cfg.list_id, "boards_conferidos": list(cfg.boards_conferidos),
        "listas_reuniao": list(cfg.listas_reuniao), "listas_ganho": list(cfg.listas_ganho),
        "listas_perdido": list(cfg.listas_perdido), "listas_no_show": list(cfg.listas_no_show),
        "client_secret": {"configurado": bool(segredo),
                          "ultimos4": segredo[-4:] if len(segredo) >= 4 else None},
        "webhook_secret": {"configurado": bool(webhook)},
        "completo": cfg.completo, "faltando": _faltando(cfg),
        "webhook_urls": urls_do_webhook_growthhs(settings.FRONTEND_URL, ambiente),
    }


async def _estado_growthhs() -> dict:
    from app.crm import entrega, growthhs

    cfg = await growthhs.ler_config()
    async with sessao(role="service_role") as conn:
        pendentes = await conn.fetchval(
            "SELECT count(*) FROM crm_handoffs WHERE status = 'pendente'")
        falhas = await conn.fetchval(
            f"SELECT count(*) FROM crm_handoffs h WHERE {_FALHA_EM_ABERTO}")
        ultimas = await conn.fetch(
            f"""SELECT h.lead_id::text, h.erro, h.atualizado_em::text FROM crm_handoffs h
                 WHERE {_FALHA_EM_ABERTO} ORDER BY h.atualizado_em DESC LIMIT 5""")
        # I3: a pausa de configuração (401/403/404) não é falha de nenhum
        # lead — é a fila inteira parada. O motivo é o do pedido pausado mais
        # recente; `desde`, o da pausa mais antiga ainda de pé.
        pausa = await conn.fetchrow(
            """SELECT (array_agg(erro ORDER BY atualizado_em DESC))[1] AS motivo,
                      min(atualizado_em)::text AS desde
                 FROM crm_handoffs
                WHERE status = 'pendente' AND erro LIKE $1 || '%'""",
            entrega.PREFIXO_PAUSA)
    return {
        # `ativo` é o ambiente que recebe lead (ou `None`); `configurado`, se
        # a fila anda — ativo E completo.
        "ativo": cfg.ambiente, "configurado": cfg.configurado,
        "ambientes": {a: await _estado_do_ambiente(a, cfg.ambiente)
                      for a in AMBIENTES_GROWTHHS},
        # A fila é uma só: o pedido vai para o ambiente ativo NA HORA da
        # entrega (spec, decisão 7).
        "fila": {"pendentes": pendentes, "falhas": falhas,
                 "ultimas_falhas": [dict(l) for l in ultimas],
                 "pausada": ({"motivo": pausa["motivo"], "desde": pausa["desde"]}
                             if pausa and pausa["motivo"] else None)},
    }


@router.get("/config/growthhs")
async def ler_config_growthhs(_: Usuario = Depends(admin_atual)):
    """Os dois ambientes, qual está ativo, e como anda a fila de entrega.

    ⚠️ Nenhum segredo volta — o client_secret cria card no funil de vendas, o
    do webhook marca reunião e venda. As falhas aparecem aqui porque falha de
    entrega é o tipo de coisa que ninguém vê: o lead "foi para o comercial" e
    não foi."""
    return await _estado_growthhs()


# Colunas de growthhs_config que o PUT grava (só as que vieram no corpo).
# ⚠️ `board_id` fica na tabela (o receptor desligado ainda lê), mas saiu da API.
_COLUNAS_GROWTHHS = ("base_url", "app_url", "client_id", "list_id", "boards_conferidos",
                     *_LISTAS_DE_EVENTO)
# As de lista são NOT NULL (029, 032): `null` explícito no corpo é "não mexi".
_COLUNAS_LISTA = ("boards_conferidos", *_LISTAS_DE_EVENTO)


# A trava consultiva que põe em fila o "Usar este ambiente" e o "Salvar".
_TRAVA_GROWTHHS = "growthhs-ativo"


class AtivarGrowthHSIn(BaseModel):
    ambiente: str


@router.post("/config/growthhs/ativar")
async def ativar_ambiente_growthhs(dados: AtivarGrowthHSIn,
                                   admin: Usuario = Depends(admin_atual)):
    """"Usar este ambiente": daqui em diante os leads vão para ESTE GrowthHS
    e só o webhook dele vale. Nada é reenviado (spec, decisão 7).

    ⚠️ Ambiente incompleto → 400 com o que falta, sem trocar nada: ativá-lo
    pararia a fila em silêncio (`configurado` falso), e quem clicou acharia
    que os leads estão indo."""
    from app.crm import entrega, growthhs

    ambiente = _ambiente_growthhs(dados.ambiente)
    cfg = await growthhs.ler_config_do_ambiente(ambiente)
    if not cfg.completo:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"{growthhs.NOME_DO_AMBIENTE[ambiente]} incompleta — falta: "
            + ", ".join(_faltando(cfg)) + ". Salve antes de usar este ambiente.")
    async with sessao(role="service_role") as conn:
        # Dois admins trocando ao mesmo tempo: a trava os põe em fila (sem
        # ela, o índice único parcial `WHERE ativo` daria 500 a quem
        # chegasse segundo). O PUT toma a MESMA trava: um "Salvar" que troca
        # o endereço (e apaga o secret) não passa entre a conferência e a
        # troca.
        await conn.execute(f"SELECT pg_advisory_xact_lock(hashtext('{_TRAVA_GROWTHHS}'))")
        # Reconfere DENTRO da trava, direto no banco (o `ler_segredo` tem
        # cache): o que foi conferido acima pode ter mudado no meio.
        linha = await conn.fetchrow(
            """SELECT base_url, client_id, list_id, boards_conferidos
                 FROM growthhs_config WHERE ambiente = $1 FOR UPDATE""", ambiente)
        nome_segredo = growthhs.segredo_cliente(ambiente)
        tem_segredo = bool(os.environ.get(nome_segredo)) or await conn.fetchval(
            """SELECT EXISTS (SELECT 1 FROM public.integration_secrets
                WHERE name = $1 AND coalesce(value, '') <> '')""", nome_segredo)
        if not (linha and linha["base_url"] and linha["client_id"] and linha["list_id"]
                and linha["boards_conferidos"] and tem_segredo):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"A {growthhs.NOME_DO_AMBIENTE[ambiente]} mudou enquanto era ativada e "
                "ficou incompleta. Confira e tente de novo.")
        # A pausa de configuração era do GrowthHS de antes (credencial ou
        # endereço recusados lá): com o outro ambiente, os pedidos pausados
        # tentam na hora, e a faixa "Fila pausada" não fica mostrando o
        # motivo velho.
        await conn.execute(
            """UPDATE crm_handoffs SET visivel_em = now(), erro = NULL, atualizado_em = now()
                WHERE status = 'pendente' AND erro LIKE $1 || '%'""", entrega.PREFIXO_PAUSA)
        await conn.execute(
            "UPDATE growthhs_config SET ativo = false, updated_at = now() "
            "WHERE ativo AND ambiente <> $1", ambiente)
        await conn.execute(
            "UPDATE growthhs_config SET ativo = true, updated_by = $2::uuid, "
            "updated_at = now() WHERE ambiente = $1 AND NOT ativo", ambiente, admin.id)
    return await _estado_growthhs()


@router.put("/config/growthhs/{ambiente}")
async def gravar_config_growthhs(ambiente: str, dados: GrowthHSIn,
                                 admin: Usuario = Depends(admin_atual)):
    """Ver `_gravar_growthhs`. Roda sob a trava do "Usar este ambiente":
    trocar o endereço (que apaga o secret) não passa no meio de uma
    ativação."""
    _ambiente_growthhs(ambiente)
    async with sessao(role="service_role") as trava:
        await trava.execute(f"SELECT pg_advisory_xact_lock(hashtext('{_TRAVA_GROWTHHS}'))")
        return await _gravar_growthhs(ambiente, dados, admin)


async def _gravar_growthhs(ambiente: str, dados: GrowthHSIn, admin: Usuario):
    """Grava só o que veio, no ambiente do caminho — o outro não é tocado;
    `limpar: ["client_secret" | "webhook_secret"]` apaga o segredo DESTE
    ambiente. Campo desconhecido em `limpar` → 400, antes de gravar qualquer
    coisa. Gravar não ativa: isso é `POST /config/growthhs/ativar`."""
    from app.crm import growthhs
    from app.integracoes import apagar_segredo

    ambiente = _ambiente_growthhs(ambiente)
    desconhecidos = [c for c in dados.limpar if c not in _SEGREDOS_GROWTHHS]
    if desconhecidos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Campos desconhecidos: {', '.join(desconhecidos)}")
    # A salva só é lida quando precisa (alguma lista sem as outras, troca de
    # endereço): as quatro listas vindas juntas se conferem sozinhas.
    vindas = {c: getattr(dados, c) for c in _LISTAS_DE_EVENTO}
    alguma = any(v is not None for v in vindas.values())
    salvo = (await growthhs.ler_config_do_ambiente(ambiente)
             if (alguma and any(v is None for v in vindas.values()))
             or "base_url" in dados.model_fields_set else None)
    if alguma:
        # ⚠️ Revisão final (M4), estendida na 032: uma lista que prova dois
        # eventos faria o webhook de volta marcar venda num card que só teve
        # reunião, perdido num ganho etc. Quando uma não vem no PUT, vale a
        # salva. Antes de gravar qualquer coisa, segredo inclusive.
        listas = {c: set(v if v is not None else getattr(salvo, c))
                  for c, v in vindas.items()}
        for i, a in enumerate(_LISTAS_DE_EVENTO):
            for b in _LISTAS_DE_EVENTO[i + 1:]:
                if listas[a] & listas[b]:
                    raise HTTPException(
                        status.HTTP_422_UNPROCESSABLE_CONTENT,
                        f"A mesma lista não pode valer como {_NOME_DA_LISTA[a]} e como "
                        f"{_NOME_DA_LISTA[b]}: "
                        + ", ".join(str(n) for n in sorted(listas[a] & listas[b])))
    limpar = set(dados.limpar)
    if "base_url" in dados.model_fields_set and not dados.client_secret:
        # ⚠️ O secret é só de escrita: ninguém o lê de volta pela tela. Trocar
        # o endereço e clicar "Testar" o mandaria (no client-credentials) ao
        # endereço novo — um admin leria o secret apontando para um servidor
        # dele. Endereço mudou sem secret no mesmo pedido → o secret salvo
        # DESTE ambiente cai (o do outro fica).
        if (salvo.base_url or "").rstrip("/") != (dados.base_url or "").rstrip("/"):
            limpar.add("client_secret")
    for campo in _SEGREDOS_GROWTHHS:
        nome = _nome_do_segredo(campo, ambiente)
        if campo in limpar:
            await apagar_segredo(nome)
        elif getattr(dados, campo):
            # Já vem sem espaço (validador) — o GrowthHS faz strip do dele.
            await gravar_segredo(nome, getattr(dados, campo))

    vindos = dados.model_dump(exclude_unset=True)
    campos = {c: vindos[c] for c in _COLUNAS_GROWTHHS if c in vindos
              and not (c in _COLUNAS_LISTA and vindos[c] is None)}
    if campos:
        nomes = list(campos)
        # Os nomes vêm da tupla fechada acima, nunca do corpo.
        valores = ", ".join(f"${i + 3}" for i in range(len(nomes)))
        atualiza = ", ".join(f"{c} = EXCLUDED.{c}" for c in nomes)
        async with sessao(role="service_role") as conn:
            await conn.execute(
                f"""INSERT INTO growthhs_config (ambiente, {', '.join(nomes)}, updated_by)
                    VALUES ($2, {valores}, $1::uuid)
                    ON CONFLICT (ambiente) DO UPDATE SET {atualiza},
                      updated_by = EXCLUDED.updated_by, updated_at = now()""",
                admin.id, ambiente, *(campos[c] for c in nomes))
    return await _estado_growthhs()


@router.post("/config/growthhs/{ambiente}/testar")
async def testar_config_growthhs(ambiente: str, _: Usuario = Depends(admin_atual)):
    """Pede um token com a credencial SALVA daquele ambiente
    (`client-credentials`, §1 do doc do GrowthHS): 200 com token = credencial
    válida. Testa ativo ou não — serve para conferir um ambiente antes de
    trocar para ele. Testar a digitada na tela daria um "ok" que a fila não
    tem.

    Recusa do GrowthHS (401 etc.) não é erro desta rota: 200 com
    `valido: false`, o status e um detalhe curto. Fora do ar → 502.
    ⚠️ Sem endereço, Client ID ou Client secret → 400 antes de chamar: o
    cliente HTTP não monta URL sem `base_url`."""
    from app.crm import growthhs

    cfg = await growthhs.ler_config_do_ambiente(_ambiente_growthhs(ambiente))
    if not (cfg.base_url and cfg.client_id and cfg.client_secret):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Salve o endereço da API, o Client ID e o Client secret "
                            "antes de testar.")
    try:
        await growthhs.testar(cfg)
    except growthhs.ErroDefinitivo as erro:
        # ⚠️ O detalhe é o que o GrowthHS respondeu — o segredo não vai no
        # corpo de lá, mas corta mesmo assim: resposta de proxy pode ser uma
        # página HTML inteira.
        return {"valido": False, "status": erro.status,
                "detalhe": str(erro)[:MAX_DETALHE_TESTE]}
    except growthhs.ErroTransitorio as erro:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(erro)[:MAX_DETALHE_TESTE])
    return {"valido": True}


# ── Roleta de reunião (frente agendamento, 28/10) ────────────────────────────
# Fila de vendedores do agendamento pela landing, uma por ambiente do GrowthHS
# (os ids são outros em cada um). Nome e e-mail vêm SEMPRE do GrowthHS
# (`/integration/vendedores`) — ninguém cadastra vendedor à mão aqui.
# `admin_atual` nas duas: é configuração de integração, como o resto daqui.

# Para os testes: o transporte do `growthhs.Cliente` (MockTransport).
TRANSPORTE_ROLETA = None
AVISO_SEM_VENDEDORES = ("Não foi possível listar os vendedores do GrowthHS deste "
                        "ambiente agora. A fila salva continua valendo.")


class RoletaIn(BaseModel):
    user_ids: list[int] = Field(max_length=30)


async def _vendedores_do_ambiente(ambiente: str) -> list[dict] | None:
    """Os vendedores ativos daquele GrowthHS, ou `None` se não deu para
    perguntar (ambiente incompleto, fora do ar, credencial recusada)."""
    from app.crm import growthhs

    cfg = await growthhs.ler_config_do_ambiente(ambiente)
    if not cfg.completo:
        return None
    try:
        async with growthhs.Cliente(cfg, transporte=TRANSPORTE_ROLETA) as cliente:
            return await cliente.vendedores()
    except (growthhs.ErroTransitorio, growthhs.ErroDefinitivo):
        return None


async def _fila_da_roleta(ambiente: str) -> list[dict]:
    async with sessao(role="service_role") as conn:
        return [dict(r) for r in await conn.fetch(
            """SELECT user_id, nome, email, posicao FROM reuniao_roleta
                WHERE ambiente = $1 ORDER BY posicao, user_id""", ambiente)]


@router.get("/config/growthhs/{ambiente}/roleta")
async def ler_roleta_reuniao(ambiente: str, _: Usuario = Depends(admin_atual)):
    _ambiente_growthhs(ambiente)
    vendedores = await _vendedores_do_ambiente(ambiente)
    resposta = {"fila": await _fila_da_roleta(ambiente), "vendedores": vendedores or []}
    if vendedores is None:
        resposta["aviso"] = AVISO_SEM_VENDEDORES
    return resposta


@router.put("/config/growthhs/{ambiente}/roleta")
async def gravar_roleta_reuniao(ambiente: str, dados: RoletaIn,
                                _: Usuario = Depends(admin_atual)):
    """Substitui a fila: a ordem de `user_ids` é a vez. Todo id tem que ser
    vendedor ativo daquele GrowthHS (422 senão); o nome e o e-mail são
    gravados do GrowthHS. Sem como perguntar ao GrowthHS → 502, nada muda."""
    _ambiente_growthhs(ambiente)
    ids = list(dict.fromkeys(dados.user_ids))
    vendedores = await _vendedores_do_ambiente(ambiente)
    if vendedores is None:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, AVISO_SEM_VENDEDORES)
    por_id = {v["id"]: v for v in vendedores}
    desconhecidos = [i for i in ids if i not in por_id]
    if desconhecidos:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Não são vendedores ativos deste GrowthHS: "
                            + ", ".join(str(i) for i in desconhecidos))
    async with sessao(role="service_role") as conn:
        # A mesma linha que a confirmação trava (`FOR UPDATE`): a troca da
        # fila espera a confirmação em curso terminar.
        await conn.execute(
            "SELECT 1 FROM reuniao_roleta WHERE ambiente = $1 FOR UPDATE", ambiente)
        await conn.execute("DELETE FROM reuniao_roleta WHERE ambiente = $1", ambiente)
        for posicao, uid in enumerate(ids):
            await conn.execute(
                """INSERT INTO reuniao_roleta (ambiente, user_id, posicao, nome, email)
                   VALUES ($1, $2, $3, $4, $5)""",
                ambiente, uid, posicao, por_id[uid]["nome"], por_id[uid]["email"])
    return {"fila": await _fila_da_roleta(ambiente), "vendedores": vendedores}


@router.post("/config/growthhs/reenfileirar")
async def reenfileirar_falhas_growthhs(_: Usuario = Depends(admin_atual)):
    """Devolve à fila as falhas em aberto (revisão final do 8D, I3) — até
    aqui a única recuperação era clicar lead a lead.

    Um pedido por lead (o mais recente), só de criar card — `mover` falharia
    de novo, pelo mesmo motivo —, só de lead que não foi apagado, não tem
    pedido pendente (o índice único de pendente recusaria o segundo) e não
    foi entregue DEPOIS da falha — o mesmo critério de `_FALHA_EM_ABERTO`.
    ⚠️ Revisão final (I2): excluir o lead com QUALQUER `entregue` deixava de
    fora a falha de reconversão (entregue em setembro, converteu de novo,
    falhou) — o painel contava a falha e o botão não a pegava. Tentativas
    zeradas, visível na hora."""
    async with sessao(role="service_role") as conn:
        ids = await conn.fetch(
            """UPDATE crm_handoffs h
                  SET status = 'pendente', tentativas = 0, visivel_em = now(),
                      erro = NULL, atualizado_em = now()
                WHERE h.id IN (
                      SELECT DISTINCT ON (f.lead_id) f.id
                        FROM crm_handoffs f JOIN leads l ON l.id = f.lead_id
                       WHERE f.status = 'falhou' AND f.acao = 'criar'
                         AND l.deleted_at IS NULL
                         AND NOT EXISTS (SELECT 1 FROM crm_handoffs e
                                          WHERE e.lead_id = f.lead_id AND e.acao = 'criar'
                                            AND (e.status = 'pendente'
                                                 OR (e.status = 'entregue' AND e.id > f.id)))
                       ORDER BY f.lead_id, f.id DESC)
            RETURNING h.id""")
    return {"reenfileirados": len(ids)}
