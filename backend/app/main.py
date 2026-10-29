import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.auth.router import router as auth_router
from app.database import close_db, init_db
from app.middleware.cors_coletor import CorsDoColetorMiddleware
from app.middleware.cors_sites import CorsDosSitesMiddleware
from app.middleware.limite_taxa import LimiteTaxaMiddleware
from app.routers.ab import router as ab_router
from app.routers.ab_publico import router as ab_publico_router
from app.routers.agendamento import router as agendamento_router
from app.routers.api_contato import router as api_contato_router
from app.routers.automacoes import router as automacoes_router
from app.routers.campanhas import router as campanhas_router
from app.routers.captura import router as captura_router
from app.routers.envio import router as envio_router
from app.routers.chaves import router as chaves_router
from app.routers.configuracao import router as configuracao_router
from app.routers.contatos import router as contatos_router
from app.routers.crm import router as crm_router
from app.routers.escrita_contatos import router as escrita_contatos_router
from app.routers.ia import router as ia_router
from app.routers.imagens import router as imagens_router
from app.routers.jornadas import router as jornadas_router
from app.routers.landing import router as landing_router
from app.routers.leitura_contatos import router as leitura_contatos_router
from app.routers.paginas import router as paginas_router
from app.routers.painel import router as painel_router
from app.routers.publico import router as publico_router
from app.routers.rastreio import router as rastreio_router
from app.routers.receptor_growthhs import router as receptor_growthhs_router
from app.routers.ritmo_envio import router as ritmo_envio_router
from app.routers.videos import LIMITE_POR_MINUTO as LIMITE_VIDEO_POR_MINUTO
from app.routers.videos import router as videos_router
from app.routers.webhook import router as webhook_router
from app.routers.segmentos import router as segmentos_router
from app.routers.sites import router as sites_router
from app.routers.templates import router as templates_router
from app.routers.usuarios import router as usuarios_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    await init_db()
    yield
    await close_db()


app = FastAPI(title="MarketingHS", lifespan=ciclo_de_vida)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Prefixos públicos. Cresce conforme os lotes 3 e 7 trouxerem as rotas de
# captura, descadastro, webhook e A/B.
app.add_middleware(
    LimiteTaxaMiddleware,
    por_minuto=settings.LIMITE_PUBLICO_POR_MINUTO,
    prefixos=("/publico", "/auth/login"),
    # ⚠️ O webhook do Resend vem de poucos IPs e uma campanha de mil e-mails
    # gera milhares de eventos em minutos. Limitá-lo faria o provedor levar 429
    # e re-tentar cada evento por 10 horas. Ele se autentica por assinatura
    # Svix — ver o cabeçalho do middleware.
    #
    # ⚠️ `/publico/validar-email` também é isenta: ela não escreve nada no
    # banco e tem cache de domínio por 1h (`app/captura/email.py`), mas é
    # chamada a cada pausa de digitação no formulário — dividir o balde de
    # 30/min com `/publico/captura` faria a conferência gastar o orçamento do
    # ENVIO de verdade, e a pessoa levaria 429 na hora de mandar o formulário
    # que preencheu direitinho. Mesma classe de defeito que recusar lead real.
    #
    # ⚠️ `/publico/ab/go` e `/publico/ab/eventos` são isentos DESTE balde
    # comum, mas não do limite de taxa em geral — cada um tem o seu próprio,
    # registrado abaixo (revisão final do 8C, I1 e I4). O do coletor evita que
    # os vários eventos por visita do `ab.js` estourem a cota de
    # `/publico/captura` da MESMA visita; o do redirecionador substitui o que
    # antes era isenção total (ver o comentário no `add_middleware` dele).
    #
    # ⚠️ `/publico/descadastro/um-clique` (RFC 8058) também: o POST vem dos
    # servidores do Gmail e do Yahoo — poucos IPs para milhares de
    # destinatários. Com 30/min o provedor levaria 429 e o contato ficaria na
    # lista, que é o que o faz marcar spam. O HMAC do link autentica, como a
    # assinatura Svix autentica o webhook. Só o um clique: o GET/POST de
    # `/publico/descadastro` (a página) continua no balde.
    #
    # ⚠️ `/publico/site/visita` (prova do RD) tem balde próprio, abaixo: o
    # `rastreio.js` manda uma por carregamento de página do site inteiro, e
    # dividir o balde com `/publico/captura` gastaria a cota do formulário.
    # A CONVERSÃO de site (`/publico/site/conversao`) fica no balde comum.
    # ⚠️ `/publico/growthhs/webhook` (a volta do CRM) também é isento: lá, um
    # 429 conta como falha e 5 seguidas DESLIGAM a automação do GrowthHS. A
    # rota se defende sozinha — HMAC, teto de corpo, janela de tempo. Desde a
    # 030 são dois endereços (`/publico/growthhs/webhook/{ambiente}`): a
    # isenção é por PREFIXO (`startswith`), cobre os dois.
    isentos=("/publico/webhook/", "/publico/growthhs/webhook/", "/publico/validar-email",
             "/publico/ab/go", "/publico/ab/eventos",
             "/publico/descadastro/um-clique", "/publico/site/visita",
             "/publico/agendamento/horarios/", "/publico/video/"),
)

# I1: balde próprio do coletor de eventos do A/B — bem mais generoso que o
# comum, porque um único visitante gera vários eventos (troca de aba,
# pagehide, scroll, clique em CTA). Sem ele, o coletor dividia cota com
# `/publico/captura` e o FORMULÁRIO da mesma visita levava 429.
app.add_middleware(
    LimiteTaxaMiddleware,
    por_minuto=settings.LIMITE_COLETOR_POR_MINUTO,
    prefixos=("/publico/ab/eventos",),
)

# I4: balde próprio do redirecionador — generoso, mas não mais TOTALMENTE
# isento (isso mudava a decisão 6 do plano; deliberado). Isenção total deixava
# qualquer GET em loop na URL pública (a tela de configuração a imprime)
# enfileirar duas escritas por acesso no pool de 10 sem limite nenhum —
# poluindo o volume de cliques e podendo travar as outras rotas, admin
# inclusive. Ninguém clica 300 anúncios por minuto, nem atrás de NAT de
# operadora.
app.add_middleware(
    LimiteTaxaMiddleware,
    por_minuto=settings.LIMITE_REDIRECIONADOR_POR_MINUTO,
    prefixos=("/publico/ab/go",),
)

# Balde próprio da visita do `rastreio.js` (prova do RD).
app.add_middleware(
    LimiteTaxaMiddleware,
    por_minuto=settings.LIMITE_VISITA_POR_MINUTO,
    prefixos=("/publico/site/visita",),
)

# Balde próprio dos horários do agendamento (frente agendamento, 28/10): o
# lead navega entre os dias da etapa 3; o resto do modal fica no comum.
app.add_middleware(
    LimiteTaxaMiddleware,
    por_minuto=settings.LIMITE_HORARIOS_POR_MINUTO,
    prefixos=("/publico/agendamento/horarios/",),
)

# Balde próprio do vídeo hospedado (frente video-proprio, 29/10): o `<video>`
# pede o arquivo em trechos (Range) — o Safari, dezenas por minuto. No balde
# comum, quem assistisse levaria 429 ao mandar o formulário.
app.add_middleware(
    LimiteTaxaMiddleware,
    por_minuto=LIMITE_VIDEO_POR_MINUTO,
    prefixos=("/publico/video/",),
)

# ⚠️ Por último de propósito: é o mais de fora, e responde o preflight do
# coletor antes do CORSMiddleware global recusá-lo (ver o módulo).
app.add_middleware(CorsDoColetorMiddleware, caminho="/publico/ab/eventos")

# ⚠️ E este depois dele — o MAIS de fora de todos: o preflight do
# `rastreio.js` vem de domínio cadastrado em `sites`, que o CORSMiddleware
# global recusaria; e o 429 do balde da visita também leva o cabeçalho.
app.add_middleware(CorsDosSitesMiddleware, prefixo="/publico/site/")


@app.exception_handler(RuntimeError)
async def banco_indisponivel(request: Request, exc: RuntimeError):
    """A `sessao()` levanta RuntimeError quando o pool não subiu. Sem este
    handler viraria 500 — e 500 diz "o servidor tem um bug", quando a verdade
    é "o banco não está de pé". A diferença importa para quem depura."""
    if str(exc) == "banco indisponível":
        return JSONResponse({"detail": "Banco de dados indisponível."}, status_code=503)
    raise exc


@app.get("/health")
async def health():
    return {"ok": True}


app.include_router(auth_router)
app.include_router(usuarios_router)
app.include_router(contatos_router)
app.include_router(configuracao_router)
app.include_router(ritmo_envio_router)
app.include_router(leitura_contatos_router)
app.include_router(escrita_contatos_router)
app.include_router(chaves_router)
app.include_router(segmentos_router)
app.include_router(templates_router)
app.include_router(campanhas_router)
app.include_router(envio_router)
app.include_router(jornadas_router)
app.include_router(automacoes_router)
app.include_router(crm_router)
app.include_router(ia_router)
app.include_router(imagens_router)
app.include_router(videos_router)
app.include_router(painel_router)
app.include_router(paginas_router)
app.include_router(captura_router)
app.include_router(agendamento_router)
app.include_router(api_contato_router)
app.include_router(ab_router)
app.include_router(ab_publico_router)
app.include_router(publico_router)
app.include_router(rastreio_router)
app.include_router(sites_router)
# Sempre incluído; 404 em tudo enquanto `PROVA_RECEPTOR_TESTE` for falso.
app.include_router(receptor_growthhs_router)
app.include_router(webhook_router)
app.include_router(landing_router)

# O bundle público da landing, construído por `npm run build:landing`. Fora do
# ar em desenvolvimento até alguém rodar o build — a casca continua servindo, a
# página fica em branco, e isso é honesto.
_LANDING = Path(__file__).resolve().parents[2] / "frontend" / "dist-landing"
if _LANDING.is_dir():
    app.mount("/landing", StaticFiles(directory=_LANDING), name="landing")
else:
    logger.warning("dist-landing não existe — rode `npm run build:landing`")
