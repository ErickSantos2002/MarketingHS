"""A porta da landing: captura anônima de lead.

⚠️ **Esta rota não tem autenticação, por desenho** — é a landing pública
chamando, e qualquer credencial que chegasse ao navegador estaria publicada. É
por isso que ela mora sob `/publico`, dentro do limite de 30/min por IP do
middleware do lote 0 (menos `/publico/validar-email`, isento — ver
`app/main.py`).

⚠️ **E é por isso que ela não devolve NADA sobre o lead.** A function
`lead-capture` que ela substitui devolvia o registro projetado (id, etiqueta,
dnia_id e booleanos de completude) para chamador não privilegiado — mas ela
exigia a chave publicável do Supabase. Sem nenhuma credencial, até a projeção é
demais: `isNew` sozinho já é um oráculo de enumeração, que responde "este
e-mail está na base?" para quem perguntar. A resposta daqui é `{ok, redirect_url}`
e mais nada.

⚠️ A conversão é registrada AQUI, no servidor. O `leadConversion.ts`, apagado
no lote 7, fazia isso do navegador; `POST /publico/conversao` exige chave de
API. Fechar o laço aqui é o único caminho que não expõe credencial.

⚠️ Desde a prova do RD (21/10/2026) o REGISTRO da captura mora em
`app/captura/registro.py`, que esta rota divide com a conversão de outro site
(`routers/rastreio.py`). Aqui ficou a porta: campo-isca, e-mail, página,
campos tipados (`app/captura/campos.py`), consentimento e canal.
"""

import logging
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator

from app.captura.campos import ler_definicoes, validar
from app.captura.canal import canal_do_toque
from app.captura.email import validar_dominio
from app.captura.evento import publicar_conversao  # noqa: F401 — usado pelos testes do R5
from app.captura.registro import (  # noqa: F401 — `_inserir`/`_atualizar`/`UTMS` pelos testes
    UTMS, Consentimento, Origem, _atualizar, _inserir, _resolver_identidade,
    ip_do_pedido, registrar_captura,
)
from app.captura.urls import url_segura
from app.config import settings
from app.database import sessao

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/publico", tags=["captura"])

EMAIL_TAMANHO_MAXIMO = 320
SESSION_ID_TAMANHO_MAXIMO = 100
VISITOR_ID_TAMANHO_MAXIMO = 64
REFERRER_TAMANHO_MAXIMO = 2000
CLID_TAMANHO_MAXIMO = 500

# O nome do campo-isca. "website" porque robô de formulário reconhece e
# preenche; não é coluna de `leads` nem está na lista branca de `higienizar`.
CAMPO_ISCA = "website"

# ⚠️ Constante, não literal inline, só para o teste da rodada 1 de correção
# conseguir forçar uma falha DE BANCO real dentro da transação (trocando o
# nome da function por um que não existe) e provar que o SAVEPOINT de
# `_resolver_identidade` recupera a transação de verdade — não apenas engole
# uma exceção Python que nunca chegou a abortar nada. Lida a cada captura e
# passada ao registro (`sql_identidade`).
_SQL_RESOLVE_IDENTIDADE = (
    "SELECT resolve_or_create_identity($1, $2, $3, $4, $5::uuid, $6, $7)"
)

# As mensagens do consentimento e da validação por campo. O front aceita
# `detail = {mensagem, campos}` (`Formulario.tsx::lerErroDoServidor`).
MENSAGEM_CONSENTIMENTO = "Para enviar, aceite a política de privacidade."
MENSAGEM_CAMPOS = "Confira os campos destacados."
# O mesmo `TEXTO_CONSENTIMENTO_PADRAO` do front: vale a PRESENÇA do bloco,
# não o texto — bloco com texto vazio pede consentimento com este texto.
TEXTO_CONSENTIMENTO_PADRAO = "Li e aceito a política de privacidade."
VERSAO_SEM_NOME = "sem-versao"


def _texto_curto(valor, limite: int):
    """Campo de rastreio ruim some e a captura segue: recusar a requisição
    inteira perderia o lead por causa dele."""
    if not isinstance(valor, str):
        return None
    valor = valor.strip()
    return valor if valor and len(valor) <= limite else None


class CapturaIn(BaseModel):
    # ⚠️ Sem `max_length` no e-mail de propósito: o teto de 320 é checado em
    # `capturar()`, para responder 400 como qualquer outro e-mail inválido —
    # o `max_length` do Pydantic respondia 422 com `detail` em lista, um
    # segundo contrato de erro que a origem não tinha.
    email: str = Field(min_length=3)
    page_slug: str = Field(min_length=1, max_length=200)
    session_id: str | None = None
    fields: dict = Field(default_factory=dict)
    # Honeypot (R1): campo escondido no formulário. Gente não vê e não
    # preenche; robô preenche tudo. Aceito aqui ou dentro de `fields`.
    website: str | None = None
    # Prova do RD (21/10). O navegador só diz "aceitou" — o texto e a versão
    # saem da config da página, aqui no servidor. O front só manda a chave
    # quando a página tem o bloco.
    consentimento: bool | None = None
    # O cookie `mhs_vid` do `rastreio.js` e o toque, para o canal.
    visitor_id: str | None = None
    referrer: str | None = None
    gclid: str | None = None
    fbclid: str | None = None

    @field_validator("session_id", mode="before")
    @classmethod
    def _descartar_session_id_invalido(cls, valor):
        """Como a origem (`sessionId.length <= 100 ? sessionId : null`): o
        campo de rastreio ruim some e a captura segue. Recusar a requisição
        inteira perderia o lead por causa dele."""
        if not isinstance(valor, str) or not valor or len(valor) > SESSION_ID_TAMANHO_MAXIMO:
            return None
        return valor

    @field_validator("visitor_id", mode="before")
    @classmethod
    def _descartar_visitor_id_invalido(cls, valor):
        return _texto_curto(valor, VISITOR_ID_TAMANHO_MAXIMO)

    @field_validator("referrer", mode="before")
    @classmethod
    def _descartar_referrer_invalido(cls, valor):
        return _texto_curto(valor, REFERRER_TAMANHO_MAXIMO)

    @field_validator("gclid", "fbclid", mode="before")
    @classmethod
    def _descartar_clid_invalido(cls, valor):
        return _texto_curto(valor, CLID_TAMANHO_MAXIMO)

    @field_validator("consentimento", mode="before")
    @classmethod
    def _so_true_e_aceite(cls, valor):
        """Só o booleano `true` é aceite — `"sim"`, `1` ou lixo não são."""
        return valor if isinstance(valor, bool) else None


class EmailIn(BaseModel):
    email: str = Field(min_length=1, max_length=320)


@router.post("/validar-email")
async def validar_email(dados: EmailIn):
    """Conferência inline do formulário, antes do envio.

    Devolve 200 sempre — inclusive quando inválido. Um 4xx aqui viraria erro no
    console do navegador a cada tecla digerida por quem preenche.

    ⚠️ Isenta do balde de 30/min de `/publico` (ver `isentos` em
    `app/main.py`): ela não escreve nada e tem cache de domínio por 1h em
    `app.captura.email`, mas é chamada a cada pausa de digitação — dividir o
    balde com `/publico/captura` faria a conferência gastar o orçamento do
    envio de verdade, e o formulário levaria 429 na hora de enviar.
    """
    valido, motivo = await validar_dominio(dados.email)
    return {"valido": valido, "motivo": motivo}


def _caiu_no_honeypot(dados: CapturaIn) -> bool:
    for valor in (dados.website, (dados.fields or {}).get(CAMPO_ISCA)):
        if isinstance(valor, str) and valor.strip():
            return True
        if valor not in (None, "") and not isinstance(valor, str):
            return True
    return False


def _redirect(config: dict) -> str | None:
    """Só `http(s)` ou caminho do próprio site: `javascript:` vindo da config
    não sai daqui (ver `app/captura/urls.py`)."""
    return url_segura((config or {}).get("redirect_url"))


async def _resposta_de_sucesso(page_slug: str) -> dict:
    """A mesma resposta do caminho que grava — só lendo, sem escrever."""
    async with sessao(role="service_role") as conn:
        config = await conn.fetchval(
            "SELECT config FROM pages WHERE slug = $1 AND status = 'active'",
            page_slug)
    if config is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Página não encontrada.")
    return {"ok": True, "redirect_url": _redirect(config)}


def _bloco_de_consentimento(config: dict) -> dict | None:
    """O bloco `consentimento` da config, normalizado — ou `None` sem ele.

    Vale a PRESENÇA do bloco (um objeto), não o texto: texto vazio usa o
    padrão, igual a `consentimentoDaConfig` do front — senão uma edição
    apagando o texto tiraria a caixa da página sem ninguém perceber.
    `obrigatorio` ausente = `true`.
    """
    bloco = (config or {}).get("consentimento")
    if not isinstance(bloco, dict):
        return None
    texto = bloco.get("texto")
    versao = bloco.get("versao")
    return {
        "texto": texto.strip() if isinstance(texto, str) and texto.strip()
        else TEXTO_CONSENTIMENTO_PADRAO,
        "versao": versao.strip() if isinstance(versao, str) and versao.strip()
        else VERSAO_SEM_NOME,
        "provisoria": bloco.get("provisoria") is True,
        "obrigatorio": bloco.get("obrigatorio") is not False,
    }


def _tags_da_config(config: dict) -> list[str]:
    tags = (config or {}).get("tags")
    return [t for t in tags if isinstance(t, str)] if isinstance(tags, list) else []


def _host_da_landing() -> str | None:
    try:
        return urlsplit(settings.FRONTEND_URL).hostname
    except ValueError:
        return None


@router.post("/captura")
async def capturar(dados: CapturaIn, request: Request):
    # ⚠️ Honeypot ANTES de tudo, e a resposta é a de sucesso: dizer "recusado"
    # ensinaria o robô qual campo evitar. Nada é gravado — nem conversão, nem
    # evento de A/B.
    if _caiu_no_honeypot(dados):
        logger.info("captura: honeypot preenchido na página %s — descartada",
                    dados.page_slug)
        return await _resposta_de_sucesso(dados.page_slug)

    email = dados.email.strip().lower()
    if len(email) > EMAIL_TAMANHO_MAXIMO:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "E-mail inválido.")

    valido, motivo = await validar_dominio(email)
    if not valido:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, motivo or "E-mail inválido.")

    async with sessao(role="service_role") as conn:
        # ⚠️ `status = 'active'` — a casca `GET /p/{slug}` só serve página
        # nesse estado. Sem o mesmo filtro aqui, esta rota aceita conversão de
        # página pausada/rascunho que a landing nem consegue mostrar: duas
        # rotas irmãs discordando sobre o que é "uma página no ar" é o padrão
        # que já mordeu este subprojeto.
        pagina = await conn.fetchrow(
            "SELECT slug, config FROM pages WHERE slug = $1 AND status = 'active'",
            dados.page_slug)
        if pagina is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Página não encontrada.")
        config = pagina["config"] or {}

        # Campos tipados: a defesa de verdade (o front valida por cortesia).
        # Página antiga, sem `campos`, cai em `visible_fields` e capta como
        # sempre (Review Focus 5 do plano).
        validados = validar(ler_definicoes(config),
                            {**(dados.fields or {}), "email": email})
        erros = dict(validados.erros)
        bloco = _bloco_de_consentimento(config)
        if bloco and bloco["obrigatorio"] and dados.consentimento is not True:
            erros["consentimento"] = MENSAGEM_CONSENTIMENTO
        if erros:
            mensagem = (MENSAGEM_CONSENTIMENTO if list(erros) == ["consentimento"]
                        else MENSAGEM_CAMPOS)
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                {"mensagem": mensagem, "campos": erros})

        consentimento = None
        if bloco and dados.consentimento is True:
            consentimento = Consentimento(
                base_legal="consentimento", texto=bloco["texto"],
                versao=bloco["versao"], provisoria=bloco["provisoria"],
                ip=ip_do_pedido(request), user_agent=request.headers.get("user-agent"))

        campos = validados.colunas
        origem = Origem(
            page_slug=dados.page_slug, visitor_id=dados.visitor_id,
            canal=canal_do_toque(
                utm_source=campos.get("utm_source"), utm_medium=campos.get("utm_medium"),
                referrer=dados.referrer, gclid=dados.gclid, fbclid=dados.fbclid,
                host_da_pagina=_host_da_landing()))

        await registrar_captura(
            conn, email=email, campos=campos, extras=validados.extras, origem=origem,
            session_id=dados.session_id, consentimento=consentimento,
            tags=_tags_da_config(config), sql_identidade=_SQL_RESOLVE_IDENTIDADE)

    return {"ok": True, "redirect_url": _redirect(config)}
