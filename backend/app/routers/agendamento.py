"""As rotas públicas do agendamento de reunião (frente agendamento, 28/10).

O modal da landing em etapas: `/dados` (etapa 1, grava o rascunho e devolve o
token) → `/empresa` (etapa 2; quem não passa do corte vira lead comum na hora)
→ `/horarios/consultar` (etapa 3) → `/confirmar`. `/ligar` é o "deixe que a
gente liga" (GrowthHS fora, sem horário). Todas POST, com o token no CORPO.

⚠️ Sem autenticação, como `/publico/captura` — e pelas mesmas travas: honeypot
(resposta de sucesso, nada gravado), domínio do e-mail, campos validados
contra a config da página, consentimento. O `token` (24 bytes aleatórios) é a
única chave do rascunho; token desconhecido é 404 e nada mais.

⚠️ M6 (29/10): o token NUNCA no caminho da URL — o caminho fica no log de
acesso do proxy (EasyPanel/Traefik, nginx), e quem lê o log retomaria o
rascunho (e veria os dados da etapa 1). As rotas antigas
(`/{token}/empresa`, `/horarios/{token}`, `/{token}/confirmar`,
`/{token}/ligar`) ficaram só para a aba aberta antes do deploy de 29/10 e
saíram no seguinte (docs/frentes/agendamento-painel.md): não as traga de volta.

⚠️ `/horarios/consultar` (e não `/horarios`) porque o limite de taxa casa por
PREFIXO (`/publico/agendamento/horarios/`, em `main.py`): assim os horários
têm balde próprio (`LIMITE_HORARIOS_POR_MINUTO`) — o lead navega entre os
dias, e cada abertura da etapa 3 não pode gastar a cota do formulário.
"""

import logging
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from app.agendamento import reserva
from app.agendamento.config import CHAVES_DA_ETAPA_1, definicoes_da_etapa_2
from app.agendamento.config import ler_config as ler_config_agendamento
from app.captura.campos import ler_definicoes, validar
from app.captura.canal import canal_do_toque
from app.captura.email import validar_dominio
from app.captura.registro import ip_do_pedido
from app.crm import growthhs
from app.database import sessao
from app.routers.captura import (EMAIL_TAMANHO_MAXIMO, MENSAGEM_CAMPOS,
                                 MENSAGEM_CONSENTIMENTO, _bloco_de_consentimento,
                                 _host_da_landing, _tags_da_config, _texto_curto)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/publico/agendamento", tags=["agendamento"])

MENSAGEM_OCUPADO = "Esse horário acabou de ser ocupado. Escolha outro."
# Para os testes: o transporte do `growthhs.Cliente` (MockTransport).
TRANSPORTE = None


def _cliente(cfg: growthhs.Config) -> growthhs.Cliente:
    return growthhs.Cliente(cfg, transporte=TRANSPORTE)


def _nao_achado() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Não encontrado.")


async def _ambiente_ativo() -> growthhs.Config | None:
    cfg = await growthhs.ler_config()
    return cfg if cfg.configurado else None


async def _pagina_com_agendamento(conn, slug: str) -> dict:
    config = await conn.fetchval(
        "SELECT config FROM pages WHERE slug = $1 AND status = 'active'", slug)
    if config is None or not ler_config_agendamento(config).ativo:
        raise _nao_achado()
    return config


def _erros(erros: dict) -> HTTPException:
    mensagem = (MENSAGEM_CONSENTIMENTO if list(erros) == ["consentimento"]
                else MENSAGEM_CAMPOS)
    return HTTPException(status.HTTP_400_BAD_REQUEST, {"mensagem": mensagem, "campos": erros})


# ── Etapa 1 ──────────────────────────────────────────────────────────────────

class DadosIn(BaseModel):
    page_slug: str = Field(min_length=1, max_length=200)
    email: str = Field(min_length=3)
    nome: str | None = None
    whatsapp: str | None = None
    # UTMs/`source`/`ab_*` da URL da landing, como no formulário normal.
    fields: dict = Field(default_factory=dict)
    consentimento: bool | None = None
    visitor_id: str | None = None
    session_id: str | None = None
    referrer: str | None = None
    gclid: str | None = None
    fbclid: str | None = None
    page_url: str | None = None
    website: str | None = None  # honeypot

    @field_validator("visitor_id", "session_id", mode="before")
    @classmethod
    def _curto(cls, valor):
        return _texto_curto(valor, 100)

    @field_validator("referrer", "page_url", mode="before")
    @classmethod
    def _url(cls, valor):
        return _texto_curto(valor, 2000)

    @field_validator("gclid", "fbclid", mode="before")
    @classmethod
    def _clid(cls, valor):
        return _texto_curto(valor, 500)

    @field_validator("consentimento", mode="before")
    @classmethod
    def _so_true(cls, valor):
        return valor if isinstance(valor, bool) else None


def _honeypot(dados: DadosIn) -> bool:
    for valor in (dados.website, (dados.fields or {}).get("website")):
        if valor not in (None, ""):
            return True
    return False


@router.post("/dados")
async def etapa_dados(dados: DadosIn, request: Request):
    if _honeypot(dados):
        logger.info("agendamento: honeypot preenchido na página %s — descartado",
                    dados.page_slug)
        return {"token": secrets.token_urlsafe(24)}

    email = dados.email.strip().lower()
    if len(email) > EMAIL_TAMANHO_MAXIMO:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "E-mail inválido.")
    valido, motivo = await validar_dominio(email)
    if not valido:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, motivo or "E-mail inválido.")

    cfg = await _ambiente_ativo()
    async with sessao(role="service_role") as conn:
        config = await _pagina_com_agendamento(conn, dados.page_slug)
        if cfg is None:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                                "Agendamento indisponível no momento.")
        definicoes = [d for d in ler_definicoes(config) if d.chave in CHAVES_DA_ETAPA_1]
        bruto = {**(dados.fields or {}), "email": email}
        for chave in ("nome", "whatsapp"):
            valor = getattr(dados, chave)
            if valor is not None:
                bruto[chave] = valor
        validados = validar(definicoes, bruto)
        erros = dict(validados.erros)
        bloco = _bloco_de_consentimento(config)
        if bloco and bloco["obrigatorio"] and dados.consentimento is not True:
            erros["consentimento"] = MENSAGEM_CONSENTIMENTO
        if erros:
            raise _erros(erros)

        consentimento = None
        if bloco and dados.consentimento is True:
            consentimento = {
                "base_legal": "consentimento", "texto": bloco["texto"],
                "versao": bloco["versao"], "provisoria": bloco["provisoria"],
                "ip": ip_do_pedido(request), "user_agent": request.headers.get("user-agent")}
        colunas = validados.colunas
        canal = canal_do_toque(
            utm_source=colunas.get("utm_source"), utm_medium=colunas.get("utm_medium"),
            referrer=dados.referrer, gclid=dados.gclid, fbclid=dados.fbclid,
            host_da_pagina=_host_da_landing())
        token = await reserva.criar_rascunho(
            conn, page_slug=dados.page_slug, email=email, ambiente=cfg.ambiente,
            dados={"colunas": colunas, "extras": validados.extras,
                   "consentimento": consentimento, "tags": _tags_da_config(config),
                   "session_id": dados.session_id,
                   "origem": {"visitor_id": dados.visitor_id, "canal": canal,
                              "page_url": dados.page_url, "gclid": dados.gclid}})
    return {"token": token}


# ── O token, no corpo (M6) ──────────────────────────────────────────────────

class ComToken(BaseModel):
    # `token_urlsafe(24)` = 32 caracteres; a folga não abre nada.
    token: str = Field(min_length=1, max_length=100)


# ── Etapa 2 ──────────────────────────────────────────────────────────────────

class EmpresaIn(BaseModel):
    fields: dict = Field(default_factory=dict)


class EmpresaComToken(EmpresaIn, ComToken):
    pass


@router.post("/empresa")
async def etapa_empresa(dados: EmpresaComToken):
    return await _empresa(dados.token, dados)


async def _empresa(token: str, dados: EmpresaIn):
    try:
        async with sessao(role="service_role") as conn:
            slug = await conn.fetchval(
                "SELECT page_slug FROM reuniao_agendamentos WHERE token = $1 "
                "AND status = 'rascunho'", token)
            if slug is None:
                raise _nao_achado()
            config = await _pagina_com_agendamento(conn, slug)
            # Os campos da página e as perguntas só do modal
            # (`agendamento.campos`, 29/10) — o que `camposDaEtapa2` mostra.
            definicoes = definicoes_da_etapa_2(config)
            campos = {k: v for k, v in (dados.fields or {}).items()
                      if k not in CHAVES_DA_ETAPA_1}
            validados = validar(definicoes, campos)
            if validados.erros:
                raise _erros(dict(validados.erros))
            resultado = await reserva.completar_rascunho(
                conn, token, {"colunas": validados.colunas, "extras": validados.extras})
        if not resultado["pode_agendar"]:
            await reserva.virar_lead_comum(token)
    except reserva.TokenDesconhecido:
        raise _nao_achado() from None
    return resultado


# ── Etapa 3 ──────────────────────────────────────────────────────────────────

@router.post("/horarios/consultar")
async def etapa_horarios(dados: ComToken):
    return await _horarios(dados.token)


async def _horarios(token: str):
    cfg = await _ambiente_ativo()
    try:
        if cfg is None:
            async with sessao(role="service_role") as conn:
                if not await conn.fetchval(
                        "SELECT true FROM reuniao_agendamentos WHERE token = $1", token):
                    raise _nao_achado()
            return {"indisponivel": True}
        async with _cliente(cfg) as cliente:
            return await reserva.horarios(token, agora=datetime.now(timezone.utc),
                                          cliente=cliente)
    except reserva.TokenDesconhecido:
        raise _nao_achado() from None


class ConfirmarIn(BaseModel):
    inicio: str = Field(min_length=10, max_length=40)


class ConfirmarComToken(ConfirmarIn, ComToken):
    pass


def _ler_inicio(texto: str) -> datetime:
    try:
        data = datetime.fromisoformat(texto.strip().replace("Z", "+00:00"))
    except ValueError:
        data = None
    if data is None or data.tzinfo is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Horário inválido: use ISO 8601 com fuso.")
    return data


@router.post("/confirmar")
async def etapa_confirmar(dados: ConfirmarComToken):
    return await _confirmar(dados.token, dados)


async def _confirmar(token: str, dados: ConfirmarIn):
    inicio = _ler_inicio(dados.inicio)
    cfg = await _ambiente_ativo()
    if cfg is None:
        return {"status": "indisponivel"}
    try:
        async with _cliente(cfg) as cliente:
            resultado = await reserva.confirmar(token, inicio,
                                                agora=datetime.now(timezone.utc),
                                                cliente=cliente)
    except reserva.TokenDesconhecido:
        raise _nao_achado() from None
    except reserva.HorarioInvalido:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Esse horário não está disponível para agendamento.") from None
    if resultado["status"] == "ocupado":
        return JSONResponse({"status": "ocupado", "detail": MENSAGEM_OCUPADO},
                            status_code=status.HTTP_409_CONFLICT)
    return resultado


@router.post("/ligar")
async def etapa_ligar(dados: ComToken):
    return await _ligar(dados.token)


async def _ligar(token: str):
    try:
        await reserva.virar_lead_comum(token)
    except reserva.TokenDesconhecido:
        raise _nao_achado() from None
    return {"ok": True}
