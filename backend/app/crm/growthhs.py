"""O cliente do GrowthHS pela API normal do CRM.

Autoridade: `~/github/hsgrowth-sistema/docs/integracao-marketinghs.md`
(§1–§8, 22/10/2026) — o GrowthHS NÃO terá o `POST /integration/cards` do
contrato antigo (`docs/contratos/2026-09-02-…`). O caminho é o mesmo da
automação que já cria cards inbound lá:

    POST /api/v1/auth/client-credentials → token (em memória, folga de 5 min)
    GET  /api/v1/persons?search=<email>  → pessoa (conferindo o e-mail EXATO)
    POST /api/v1/persons                 → se não achou
    GET  /api/v1/cards?board_id=&person_id= → os cards dela (boards conferidos)
    POST /api/v1/cards | PUT /api/v1/cards/{id} + POST /api/v1/card-notes

Este módulo só fala HTTP e monta texto; quem decide criar ou atualizar é
`app/crm/entrega.py`. Sem configuração, `Config.configurado` é falso e a fila
não é drenada.

As faixas de faturamento e de funcionários são as do `handoff-to-nexus` de
origem, portadas literalmente; no card comercial elas vão na `description`
(o card não tem `business_info`, §3 de lá).
"""

import logging
import re
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import httpx

from app.captura.informados import divergencias
from app.database import sessao
from app.integracoes import ler_segredo

logger = logging.getLogger(__name__)

# Dois GrowthHS salvos lado a lado (migration 030): cada um com a própria
# linha em `growthhs_config` e os próprios segredos. Só o ATIVO recebe lead.
AMBIENTES = ("homologacao", "producao")
NOME_DO_AMBIENTE = {"homologacao": "Homologação", "producao": "Produção"}


def segredo_cliente(ambiente: str) -> str:
    """`GROWTHHS_CLIENT_SECRET_HOMOLOGACAO` / `..._PRODUCAO`."""
    return f"GROWTHHS_CLIENT_SECRET_{ambiente.upper()}"


def segredo_webhook(ambiente: str) -> str:
    """`GROWTHHS_WEBHOOK_SECRET_HOMOLOGACAO` / `..._PRODUCAO`."""
    return f"GROWTHHS_WEBHOOK_SECRET_{ambiente.upper()}"


TIMEOUT = 15
CAMINHO_TOKEN = "/api/v1/auth/client-credentials"
CAMINHO_PESSOAS = "/api/v1/persons"
CAMINHO_CARDS = "/api/v1/cards"
CAMINHO_NOTAS = "/api/v1/card-notes"
UTMS = ("utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content")
FUSO_VENDEDOR = ZoneInfo("America/Sao_Paulo")
# Limites de §3 de lá (colunas do banco do GrowthHS). Cortar, nunca 422 por
# tamanho: um lead com campanha comprida não pode deixar de chegar.
MAX_ORIGEM = 200
MAX_UTM = 200
MAX_UTM_PARAMS = 500
MAX_GCLID = 500
MAX_TITULO = 500
MAX_NOME_PESSOA = 200
MAX_TELEFONE = 50
MAX_DESAFIOS = 500
MAX_ROTULO_EXTRA = 60
MAX_VALOR_EXTRA = 500
# §1 de lá: o token vale 8 h; renova 5 min antes para não morrer no meio.
VALIDADE_PADRAO_TOKEN = 8 * 3600
FOLGA_TOKEN = 5 * 60
CAMPOS_EMAIL = ("email", "email_commercial", "email_personal", "email_alternative")
# Produção do GrowthHS: "Reunião Agendada" é a lista 28; ganhar o card o MOVE
# para a lista de ganho (is_done_stage), a 32. São os padrões da 029.
LISTAS_REUNIAO_PADRAO = (28,)
LISTAS_GANHO_PADRAO = (32,)
# Os padrões da 032 (pergunta 74): "Perdido" move o card para a lista
# `is_lost_stage` do board — 27 no board 6, 33 no board 7 —, e "No Show" é o
# card ir para 25 "Reagendamento".
LISTAS_PERDIDO_PADRAO = (27, 33)
LISTAS_NO_SHOW_PADRAO = (25,)


@dataclass(frozen=True)
class Config:
    base_url: str | None
    client_id: str | None
    client_secret: str | None
    list_id: int | None
    boards_conferidos: tuple[int, ...]
    app_url: str | None
    # As listas que o webhook de volta exige no corpo assinado (migration 029).
    # Com padrão: quem constrói `Config` à mão (testes, entrega) não muda.
    listas_reuniao: tuple[int, ...] = LISTAS_REUNIAO_PADRAO
    listas_ganho: tuple[int, ...] = LISTAS_GANHO_PADRAO
    listas_perdido: tuple[int, ...] = LISTAS_PERDIDO_PADRAO
    listas_no_show: tuple[int, ...] = LISTAS_NO_SHOW_PADRAO
    # De qual GrowthHS é esta configuração (migration 030). É o carimbo que a
    # entrega grava ao lado de todo card_id/person_id — sem ele, o id não vale.
    ambiente: str | None = None

    @property
    def completo(self) -> bool:
        """Os campos que a entrega precisa — o que "Usar este ambiente" exige."""
        return bool(self.base_url and self.client_id and self.client_secret
                    and self.list_id and self.boards_conferidos)

    @property
    def configurado(self) -> bool:
        return self.completo and self.ambiente in AMBIENTES

    def url_do_card(self, card_id) -> str | None:
        """O link "Ver no GrowthHS" (rota `/cards/:cardId` do app dele)."""
        if not self.app_url or card_id is None:
            return None
        return f"{self.app_url.rstrip('/')}/cards/{card_id}"


# ⚠️ A linha inteira (`*`), não uma lista de colunas: as listas da 032 são
# lidas com `.get` e, sem a migration, ficam no padrão. Com a lista fixa, um
# deploy antes da 032 faria a leitura falhar — e `ler_config` cair no "não
# configurado" para a fila de entrega E para a volta.
_COLUNAS_CONFIG = "*"


def _listas(linha, coluna: str, padrao: tuple[int, ...]) -> tuple[int, ...]:
    valor = linha.get(coluna) if linha else None
    return tuple(valor) if valor is not None else padrao


async def _config_da_linha(linha, ambiente: str | None) -> Config:
    """Sem linha: tudo vazio, mas as listas do webhook são as padrão de
    produção — nunca "nenhuma lista"."""
    return Config(
        base_url=linha["base_url"] if linha else None,
        client_id=linha["client_id"] if linha else None,
        client_secret=await ler_segredo(segredo_cliente(ambiente)) if ambiente else None,
        list_id=linha["list_id"] if linha else None,
        boards_conferidos=tuple(linha["boards_conferidos"] or ()) if linha else (),
        app_url=linha["app_url"] if linha else None,
        listas_reuniao=_listas(linha, "listas_reuniao", LISTAS_REUNIAO_PADRAO),
        listas_ganho=_listas(linha, "listas_ganho", LISTAS_GANHO_PADRAO),
        listas_perdido=_listas(linha, "listas_perdido", LISTAS_PERDIDO_PADRAO),
        listas_no_show=_listas(linha, "listas_no_show", LISTAS_NO_SHOW_PADRAO),
        ambiente=ambiente)


async def ler_config() -> Config:
    """A configuração do ambiente ATIVO. Nunca levanta: nenhum ativo, banco
    fora ou coluna ausente (030 não aplicada) viram "não configurado"
    (`ambiente=None`), e a fila espera — o worker não pode cair por causa de
    configuração."""
    try:
        async with sessao(role="service_role") as conn:
            linha = await conn.fetchrow(
                f"SELECT {_COLUNAS_CONFIG} FROM growthhs_config WHERE ativo LIMIT 1")
    except Exception:
        logger.exception("[growthhs] não foi possível ler growthhs_config")
        linha = None
    return await _config_da_linha(linha, linha["ambiente"] if linha else None)


async def ler_config_do_ambiente(ambiente: str) -> Config:
    """A configuração de UM ambiente, ativo ou não (a tela e o "Testar").
    Levanta `ValueError` para ambiente fora de `AMBIENTES`. Erro de banco
    sobe — quem chama é rota de admin, não o worker."""
    if ambiente not in AMBIENTES:
        raise ValueError(f"ambiente desconhecido: {ambiente!r}")
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            f"SELECT {_COLUNAS_CONFIG} FROM growthhs_config WHERE ambiente = $1", ambiente)
    return await _config_da_linha(linha, ambiente)


def normalizar_faturamento(valor: str | None) -> str | None:
    """`mapRevenue` do handoff-to-nexus, literal (inclusive a ordem)."""
    if not valor:
        return None
    s = valor.lower()
    # ⚠️ `and "500" not in s` é a ÚNICA diferença da origem: lá, "Entre R$ 100
    # mil e R$ 500 mil" contém "100 mil" e caía em "Ate 100k/mes" — a primeira
    # faixa engolia a segunda. Correção deliberada (plano do 8D, Tarefa 2).
    if ("100 mil" in s or "100k" in s or "até 100" in s or "ate 100" in s) and "500" not in s:
        return "Ate 100k/mes"
    if ("100" in s and "500" in s) or "100k e 500k" in s:
        return "Entre 100k e 500k/mes"
    if ("500" in s and ("1 milh" in s or "1mm" in s)) or "500k e 1mm" in s:
        return "Entre 500k e 1MM/mes"
    if ("1 milh" in s and "3 milh" in s) or "1mm e 3mm" in s:
        return "Entre 1MM e 3MM/mes"
    if ("3 milh" in s and "5 milh" in s) or "3mm e 5mm" in s:
        return "Entre 3MM e 5MM/mes"
    if "acima" in s and ("5 milh" in s or "5mm" in s):
        return "Acima de 5MM/mes"
    return None


def normalizar_funcionarios(valor: str | None) -> str | None:
    """`mapEmployeeCount` do handoff-to-nexus, literal."""
    if not valor:
        return None
    s = valor.lower().strip()
    if "individual" in s or "eu s" in s:
        return "Eu S.A."
    if "1-10" in s or re.fullmatch(r"2\s*-\s*10", s) or "1 a 10" in s:
        return "1-10 funcionarios"
    if "11-50" in s or re.search(r"11\s*-\s*(25|50)", s) or re.search(r"26\s*-\s*(49|50)", s):
        return "11-50 funcionarios"
    if "51-200" in s or re.search(r"51\s*-\s*200", s) or "acima de 50" in s:
        return "51-200 funcionarios"
    if "+200" in s or "acima de 200" in s or "mais de 200" in s:
        return "+200 funcionarios"
    return None


class ErroDefinitivo(Exception):
    """4xx: configuração ou corpo — re-tentar não muda nada.

    `status` viaja no erro (revisão final do 8D, I3): 401/403/404 são
    configuração — a mesma para todos os pedidos — e pausam a fila; 422 é o
    corpo daquele lead e falha só o pedido dele.

    `de_configuracao` (revisão final da growthhs-real, I1): o erro não
    depende do lead — nasceu no `client-credentials` (qualquer status: um
    301/308 do proxy http→https, um 405, um 400 são o endereço ou a
    credencial, iguais para todos os pedidos) ou numa URL que o httpx nem
    monta. A entrega PAUSA nesse caso, como no 401/403/404; tratá-lo como
    defeito do lead derrubaria a fila inteira, pedido por pedido."""

    def __init__(self, detalhe: str, status: int | None = None, *,
                 de_configuracao: bool = False):
        super().__init__(detalhe)
        self.status = status
        self.de_configuracao = de_configuracao


class ErroTransitorio(Exception):
    """5xx, 429 ou sem resposta — a fila re-tenta."""


# ── Texto do card (puro) ─────────────────────────────────────────────────────

def uma_linha(valor) -> str:
    """Qualquer valor numa linha só: todo caractere de controle/formatação
    (categoria Unicode C*: `\r`, `\n`, `\x0b`, U+0085, zero-width…) e os
    separadores de linha/parágrafo (U+2028/U+2029) viram espaço; espaços
    seguidos colapsam; strip.

    ⚠️ Segurança (achado da coordenadora, 22/10): nome, empresa, cargo,
    desafios, `campos_extras` (chave E valor), página e site vêm do
    formulário PÚBLICO. Um `\n` num deles forjaria, na descrição que o
    vendedor lê, uma linha "Lead score: 100" ou "Ver no MarketingHS: <golpe>"
    indistinguível das nossas. Todo texto de fora passa por aqui antes de
    virar linha, título, nome de pessoa ou nota."""
    if valor is None:
        return ""
    texto = "".join(
        " " if unicodedata.category(c)[0] == "C" or c in "\u2028\u2029" else c
        for c in str(valor))
    return " ".join(texto.split())


def _tem(valor) -> bool:
    return uma_linha(valor) != ""


def _cortar(valor, limite: int):
    """Uma linha só, cortada no limite da coluna de lá; vazio vira `None`."""
    return uma_linha(valor)[:limite] or None


def _ler_iso(valor) -> datetime | None:
    """ISO 8601 com ou sem fuso (ou `datetime`) → `datetime` em UTC.

    ⚠️ Ingênuo é UTC: o GrowthHS grava `datetime.utcnow()` e serializa sem
    `Z`. Lido como hora local, um card criado às 13:00 UTC pareceria das
    16:00 — e a entrega acharia "criado depois do pedido" um card que é de
    antes. Texto que não é data vira `None`, nunca exceção."""
    if isinstance(valor, datetime):
        data = valor
    elif isinstance(valor, str) and valor.strip():
        try:
            data = datetime.fromisoformat(valor.strip())
        except ValueError:
            return None
    else:
        return None
    if data.tzinfo is None:
        data = data.replace(tzinfo=timezone.utc)
    return data.astimezone(timezone.utc)


def data_do_vendedor(valor) -> str | None:
    """`dd/mm/aaaa hh:mm` em São Paulo — é o vendedor quem lê."""
    data = _ler_iso(valor)
    if data is None:
        return uma_linha(valor) or None
    return data.astimezone(FUSO_VENDEDOR).strftime("%d/%m/%Y %H:%M")


def criado_em_utc(card: dict) -> datetime | None:
    """`created_at` de um card do GrowthHS em UTC (ingênuo = UTC)."""
    return _ler_iso((card or {}).get("created_at"))


def origem_do_card_texto(conversao: dict | None) -> str:
    """O `origin` do card (decisão 2 do Erick, 22/10): `Landing Page <slug>`
    para landing, `Captura pelo site [<form_id>]` para formulário de site de
    fora, `MarketingHS` sem conversão (envio manual, regra sobre base
    importada — suposição, pergunta 70). Pago × orgânico já vai pelos UTMs."""
    conversao = conversao or {}
    if _tem(conversao.get("page_slug")):
        texto = f"Landing Page {uma_linha(conversao['page_slug'])}"
    elif _tem(conversao.get("form_id")):
        texto = f"Captura pelo site [{uma_linha(conversao['form_id'])}]"
    else:
        texto = "MarketingHS"
    return texto[:MAX_ORIGEM]


def montar_descricao(lead: dict, *, conversao: dict | None, consentimento: dict | None,
                     frontend_url: str, pedido_id: int | None = None) -> str:
    """A `description` do card: uma linha por item, SÓ os que têm valor (o
    "—" do contrato antigo poluía o card), na ordem da spec §2. O card
    comercial não tem `business_info`/`custom_fields`/`conversion`/`consent`
    (§3 de lá) — o que o vendedor precisa ver vem para cá.

    ⚠️ Todo valor passa por `uma_linha` (ver lá o porquê). E o que é
    resposta livre do formulário (`campos_extras`, chave e valor) vai num
    bloco próprio, "Respostas do formulário:", com cada linha prefixada por
    "- " — nenhuma delas pode começar como uma linha nossa ("Lead score",
    "Ver no MarketingHS", "Pedido MarketingHS", o cabeçalho do bloco de
    atualização).

    Com `pedido_id` (só no card que NASCE de um pedido — `montar_card`), a
    linha `Pedido MarketingHS: <id>` é a assinatura do card: é por ela que a
    entrega reconhece, num retry, o card que este pedido criou (ver
    `card_do_pedido`).

    Pergunta 73 (26/10): se a conversão trouxe valores DIFERENTES dos do
    contato (`conversao.dados_informados`, migration 031), a descrição abre
    com eles — "Informou nesta conversão (não verificado):", um "- Rótulo:
    valor" por linha, como as respostas livres — e "Cadastro no
    MarketingHS:" separa o que é do contato. Sem divergência, a descrição é
    a de antes, byte a byte. Vale para o card NOVO também: card novo nasce de
    reconversão quando os cards da pessoa estão todos ganhos ou perdidos."""
    linhas: list[str] = []

    def item(rotulo, valor):
        texto = uma_linha(valor)
        if texto:
            linhas.append(f"{rotulo}: {texto}")

    informadas = []
    for d in divergencias(lead, (conversao or {}).get("dados_informados")):
        rotulo = _cortar(d["rotulo"], MAX_ROTULO_EXTRA)
        texto = _cortar(d["valor"], MAX_VALOR_EXTRA)
        if rotulo and texto:
            informadas.append(f"- {rotulo}: {texto}")
    if informadas:
        linhas.append(f"{ROTULO_INFORMADOS}:")
        linhas.extend(informadas)
        linhas.append("Cadastro no MarketingHS:")

    item("Empresa", lead.get("empresa"))
    item("Cargo", lead.get("cargo"))
    # A faixa de hoje; se o texto não cai em faixa nenhuma, vai o texto cru —
    # sumir com o dado seria o corte silencioso.
    item("Faturamento", normalizar_faturamento(lead.get("faturamento"))
         or lead.get("faturamento"))
    item("Funcionários", normalizar_funcionarios(lead.get("funcionarios"))
         or lead.get("funcionarios"))
    item("Lead score", lead.get("lead_score"))
    item("Etiqueta", lead.get("etiqueta"))
    item("Campanha", lead.get("utm_campaign"))
    item("Desafios", _cortar(lead.get("desafios"), MAX_DESAFIOS))
    # Fora da lista da spec §2, mas estava na descrição do contrato antigo:
    # não sai sem alguém decidir.
    item("Indicação", lead.get("indicacao"))
    respostas = []
    for chave, valor in dict(lead.get("campos_extras") or {}).items():
        rotulo = _cortar(chave, MAX_ROTULO_EXTRA)
        texto = _cortar(valor, MAX_VALOR_EXTRA)
        if rotulo and texto:
            respostas.append(f"- {rotulo}: {texto}")
    if respostas:
        linhas.append("Respostas do formulário:")
        linhas.extend(respostas)
    if conversao:
        if _tem(conversao.get("page_slug")):
            item("Conversão", f"página {conversao['page_slug']}")
        elif _tem(conversao.get("form_id")):
            item("Conversão", f"formulário [{conversao['form_id']}]")
        item("Site", conversao.get("site_nome"))
        item("URL da conversão", conversao.get("page_url"))
        item("Canal", conversao.get("canal"))
        item("Data da conversão", data_do_vendedor(conversao.get("converted_at")))
    if consentimento:
        item("Base legal", consentimento.get("base_legal"))
        versao = uma_linha(consentimento.get("versao"))
        if consentimento.get("provisoria"):
            versao = f"{versao} (provisória)".strip()
        item("Versão do consentimento", versao)
        item("Data do consentimento", data_do_vendedor(consentimento.get("criado_em")))
    if pedido_id is not None:
        linhas.append(marca_de_criacao(pedido_id))
    link = link_da_ficha(frontend_url, lead.get("id"))
    if link:
        linhas.append(link)
    return "\n".join(linhas)


def link_da_ficha(frontend_url: str | None, lead_id) -> str | None:
    """A linha `Ver no MarketingHS: <ficha do contato>` — sem endereço do
    front, nenhuma."""
    if not _tem(frontend_url) or lead_id is None:
        return None
    return f"Ver no MarketingHS: {frontend_url.rstrip('/')}/contacts?contato={lead_id}"


def linha_de_utms(lead: dict) -> str | None:
    """`UTMs: utm_source=… · utm_medium=…` — só as que têm valor."""
    pares = [f"{c}={_cortar(lead.get(c), MAX_UTM)}" for c in UTMS if _tem(lead.get(c))]
    return f"UTMs: {' · '.join(pares)}" if pares else None


def nota_de_abertura(lead: dict, *, conversao: dict | None, consentimento: dict | None,
                     frontend_url: str, quando: datetime) -> list[str]:
    """A primeira nota do card NOVO (pergunta 79), em linhas para
    `Cliente.anotar`. A tela do card do GrowthHS não mostra a `description`:
    o que o vendedor precisa ler vai aqui.

    O corpo é o de `montar_descricao` inteiro — não só origem, UTMs e
    consentimento: faixas, lead score, desafios e respostas livres também não
    têm outro lugar visível lá, e levar só parte seria o corte silencioso. Sem
    a marca `Pedido MarketingHS` (engrenagem da idempotência, fica só na
    descrição). Reusar `montar_descricao` traz junto as travas do texto de
    fora (`uma_linha`, "- " nas respostas livres)."""
    linhas = [f"Lead enviado pelo MarketingHS ({origem_do_card_texto(conversao)}) em "
              f"{data_do_vendedor(quando)}."]
    corpo = montar_descricao(lead, conversao=conversao, consentimento=consentimento,
                             frontend_url="")
    linhas.extend(l for l in corpo.split("\n") if l)
    for extra in (linha_de_utms(lead), link_da_ficha(frontend_url, lead.get("id"))):
        if extra:
            linhas.append(extra)
    return linhas


def _titulo(lead: dict) -> str:
    nome = (_cortar(lead.get("nome"), MAX_TITULO) or _cortar(lead.get("email"), MAX_TITULO)
            or _cortar(lead.get("phone_normalized"), MAX_TITULO) or "Sem nome")
    empresa = _cortar(lead.get("empresa"), MAX_TITULO)
    titulo = f"{nome} — {empresa}" if empresa else nome
    return titulo[:MAX_TITULO]


def montar_card(lead: dict, cfg: Config, *, conversao: dict | None = None,
                consentimento: dict | None = None, person_id: int,
                frontend_url: str, pedido_id: int) -> dict:
    """O corpo do `POST /api/v1/cards` (§3 de lá).

    Sem `client_id`/organização: o CRM exige Setor e Tipo de Relacionamento
    na empresa e o formulário não tem (§5 de lá) — o vendedor vincula depois.
    Sem `source`/`external_id`: o card comercial não tem (a idempotência é
    nossa, ver `entrega.py`): a descrição leva `Pedido MarketingHS: <id>`."""
    utms = {c: _cortar(lead.get(c), MAX_UTM) for c in UTMS if _tem(lead.get(c))}
    return {
        "list_id": cfg.list_id,
        "title": _titulo(lead),
        "description": montar_descricao(lead, conversao=conversao,
                                        consentimento=consentimento,
                                        frontend_url=frontend_url, pedido_id=pedido_id),
        "person_id": person_id,
        "origin": origem_do_card_texto(conversao),
        "acquisition_channel": "Inbound",
        "utm_source": utms.get("utm_source"),
        "utm_campaign": utms.get("utm_campaign"),
        "utm_term": utms.get("utm_term"),
        "utm_params": urlencode(utms)[:MAX_UTM_PARAMS] if utms else None,
        "gclid": _cortar((conversao or {}).get("gclid"), MAX_GCLID),
    }


CABECALHO_DO_BLOCO = "— Nova conversão pelo MarketingHS"
# Pergunta 73: o que o lead digitou nesta conversão e difere do contato.
ROTULO_INFORMADOS = "Informou nesta conversão (não verificado)"
AVISO_NAO_VERIFICADO = "(dados informados no formulário, não verificados)"
ROTULO_DO_PEDIDO = "Pedido MarketingHS"


def marca_de_criacao(pedido_id) -> str:
    """A linha que assina o card criado por um pedido."""
    return f"{ROTULO_DO_PEDIDO}: {pedido_id}"


def card_do_pedido(descricao: str | None, pedido_id) -> bool:
    """O card foi criado por ESTE pedido? Só se uma linha da descrição é
    exatamente `Pedido MarketingHS: <id>` (`7` não casa `71`).

    ⚠️ Segurança: reconhecer um card como "nosso" marca o pedido entregue SEM
    entregar nada. Por data só, um card que a automação do RD ou o vendedor
    criou durante uma pausa passaria por nosso e o lead sumiria. A linha não
    pode ser forjada pelo formulário: todo valor de fora entra numa linha
    rotulada ("Empresa: …", "- chave: valor") e numa linha só
    (`uma_linha`), então nenhuma linha vinda de fora começa com o rótulo."""
    marca = marca_de_criacao(pedido_id)
    return any(linha.rstrip() == marca for linha in (descricao or "").splitlines())


def bloco_ja_aplicado(descricao: str | None, pedido_id) -> bool:
    """A descrição já tem o bloco DESTE pedido? Só conta a marca numa linha
    que COMEÇA com o cabeçalho nosso (`— Nova conversão pelo MarketingHS`).

    ⚠️ Procurar a marca no texto todo deixaria um campo do formulário
    contendo "(pedido 7)" — ou o vendedor escrevendo isso — suprimir a
    atualização do pedido 7: o lead converteria de novo e o card não
    mudaria, sem erro. Nenhuma linha vinda de fora começa com o cabeçalho:
    as respostas livres vão prefixadas por "- " e os itens pelo rótulo
    (`montar_descricao`)."""
    marca = marca_do_pedido(pedido_id)
    return any(linha.startswith(CABECALHO_DO_BLOCO) and marca in linha
               for linha in (descricao or "").splitlines())


def marca_do_pedido(pedido_id) -> str:
    """O que identifica, na descrição do card, o bloco de UM pedido. A
    entrega procura esta marca antes do PUT: se uma tentativa anterior do
    mesmo pedido já atualizou (e a resposta se perdeu), não empilha outro."""
    return f"(pedido {pedido_id})"


def bloco_de_atualizacao(lead: dict, *, conversao: dict | None,
                         consentimento: dict | None, frontend_url: str,
                         pedido_id: int, quando: datetime) -> str:
    """O bloco que vai NO FIM da descrição de um card aberto (decisão 3 do
    Erick). Nunca substitui o que o vendedor escreveu: quem chama concatena
    com a descrição atual.

    ⚠️ Segurança (coordenadora, 22/10): o card é de um vendedor e o bloco vem
    de um formulário PÚBLICO — qualquer um que saiba o e-mail do cliente
    converte "por ele". O cabeçalho diz que são dados informados no
    formulário, não verificados, para o vendedor não tomar o bloco como
    cadastro conferido."""
    return (f"\n\n{CABECALHO_DO_BLOCO} em {data_do_vendedor(quando)} "
            f"{marca_do_pedido(pedido_id)} {AVISO_NAO_VERIFICADO} —\n"
            + montar_descricao(lead, conversao=conversao, consentimento=consentimento,
                               frontend_url=frontend_url))


# ── Cliente HTTP ─────────────────────────────────────────────────────────────

# (base_url, client_id, client_secret) → (access_token, expira em monotonic).
# Em memória do processo: o worker é um processo só, e perder o cache num
# restart custa um client-credentials a mais, nada além.
_TOKENS: dict[tuple[str, str, str], tuple[str, float]] = {}


def limpar_tokens() -> None:
    """Esquece todo token guardado (testes; e troca de credencial na tela)."""
    _TOKENS.clear()


MENSAGENS_POR_STATUS = {
    400: "o GrowthHS recusou o pedido",
    401: "client_id ou client_secret recusados",
    403: "o usuário de integração não tem permissão",
    404: "endereço não parece a API do GrowthHS",
    422: "o GrowthHS recusou os dados do contato",
}
MENSAGEM_FORA_DO_AR = "GrowthHS fora do ar ou ocupado"
# 3xx: o httpx não segue redirecionamento — o caso real é o proxy mandando
# http → https. A mensagem diz o que corrigir na tela.
MENSAGEM_REDIRECIONA = "o endereço redireciona — use o endereço final, com https://"
MAX_DETAIL = 200


# Teto do `content` de uma nota — o mesmo da descrição (`entrega.TETO_DA_DESCRICAO`).
TETO_DA_NOTA = 20_000


def conteudo_da_nota(texto: str | list[str]) -> str:
    """O `content` do `POST /card-notes`.

    - `str`: uma linha só (`uma_linha`), como sempre foi.
    - lista: cada item vira UMA linha (`uma_linha`) e elas se juntam com
      `\\n` — a tela de lá mostra texto puro em `whitespace-pre-wrap`. A
      única quebra é a que nós pomos entre os itens; a do lead vira espaço
      (mesmo motivo de `uma_linha`: um `\\n` no nome forjaria uma linha
      "Ver no MarketingHS: <golpe>"). Item vazio some.

    ⚠️ `<` vira `‹` (U+2039): o `NoteRenderer` de lá trata como HTML
    (`dangerouslySetInnerHTML`, sanitizado por regex) toda nota que tenha
    uma `<tag>` — um nome `<img src=x onerror=…>` rodaria script na tela do
    vendedor. Nenhum texto nosso usa `<`. Cortado em `TETO_DA_NOTA`."""
    if isinstance(texto, str):
        conteudo = uma_linha(texto)
    else:
        conteudo = "\n".join(l for l in (uma_linha(t) for t in texto) if l)
    return conteudo.replace("<", "‹")[:TETO_DA_NOTA]


def _detail_da_resposta(resposta: httpx.Response) -> str | None:
    """O `detail` do FastAPI de lá, se a resposta for um objeto JSON com
    `detail` string — numa linha, cortado. Qualquer outra coisa: nada."""
    try:
        corpo = resposta.json()
    except ValueError:
        return None
    if isinstance(corpo, dict) and isinstance(corpo.get("detail"), str):
        return uma_linha(corpo["detail"])[:MAX_DETAIL] or None
    return None


def texto_do_erro(resposta: httpx.Response) -> str:
    """`"<status>: <mensagem genérica>"` (+ ` — <detail>` do JSON de lá).

    ⚠️ Segurança (achado da coordenadora, 22/10): NUNCA o corpo cru. O
    `base_url` é escolhido na tela de admin e pode apontar para qualquer
    endereço interno; ecoar o corpo no "Testar conexão" (ou em
    `crm_handoffs.erro`, que a tela mostra) transformaria a integração num
    leitor de URL interna. Só o status, a mensagem da faixa e, no máximo, o
    `detail` de um objeto JSON."""
    codigo = resposta.status_code
    if codigo >= 500 or codigo == 429:
        mensagem = MENSAGEM_FORA_DO_AR
    elif 300 <= codigo < 400:
        mensagem = MENSAGEM_REDIRECIONA
    else:
        mensagem = MENSAGENS_POR_STATUS.get(codigo, MENSAGENS_POR_STATUS[400])
    detail = _detail_da_resposta(resposta)
    return f"{codigo}: {mensagem}" + (f" — {detail}" if detail else "")


def _classificar(resposta: httpx.Response) -> None:
    """Não-2xx → exceção. 5xx/429 transitório; outro 4xx definitivo com o
    status (401/403/404 pausam a fila em `entrega.py`; 422 falha o pedido)."""
    if 200 <= resposta.status_code < 300:
        return
    detalhe = texto_do_erro(resposta)
    if resposta.status_code >= 500 or resposta.status_code == 429:
        raise ErroTransitorio(detalhe)
    raise ErroDefinitivo(detalhe, resposta.status_code)


def _objeto(resposta: httpx.Response) -> dict:
    """Corpo 2xx como dict. ⚠️ Fora do `criar_card`, corpo torto numa leitura
    é transitório: não criou nada lá, e re-tentar é seguro."""
    try:
        corpo = resposta.json()
    except ValueError:
        corpo = None
    if not isinstance(corpo, dict):
        # ⚠️ Sem o corpo: ver `texto_do_erro`.
        raise ErroTransitorio(f"{resposta.status_code}: resposta inesperada do GrowthHS "
                              f"(não é objeto JSON)")
    return corpo


class Cliente:
    """Uma sessão com o GrowthHS: um `httpx.AsyncClient` por `async with`.

    Toda chamada leva `Authorization: Bearer`. 401 numa chamada → token novo
    e repete UMA vez (§1 de lá); o segundo 401 é `ErroDefinitivo(401)`. 401
    no próprio `client-credentials` é credencial errada ou client desativado
    — definitivo, não se re-tenta. Sem resposta (timeout, rede) é
    transitório."""

    def __init__(self, cfg: Config, transporte: httpx.AsyncBaseTransport | None = None):
        self.cfg = cfg
        self._transporte = transporte
        self._http: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "Cliente":
        self._http = httpx.AsyncClient(timeout=TIMEOUT, transport=self._transporte)
        return self

    async def __aexit__(self, *exc) -> None:
        await self._http.aclose()
        self._http = None

    def _url(self, caminho: str) -> str:
        return self.cfg.base_url.rstrip("/") + caminho

    def _chave_token(self) -> tuple[str, str, str]:
        return (self.cfg.base_url or "", self.cfg.client_id or "",
                self.cfg.client_secret or "")

    async def _enviar(self, metodo: str, url: str, **kw) -> httpx.Response:
        try:
            return await self._http.request(metodo, url, **kw)
        except (httpx.InvalidURL, httpx.UnsupportedProtocol) as erro:
            # ⚠️ Endereço que o httpx nem monta (porta inválida, esquema sem
            # suporte) é configuração, não rede nem defeito interno: pausa a
            # fila (I1 da revisão final). `InvalidURL` nem é `HTTPError` — sem
            # este ramo, virava "defeito interno" e esgotava as tentativas.
            raise ErroDefinitivo(
                f"endereço da API do GrowthHS inválido ({type(erro).__name__})",
                de_configuracao=True) from erro
        except httpx.HTTPError as erro:
            # ⚠️ Só o nome da classe: o texto do httpx pode trazer a URL.
            raise ErroTransitorio(
                f"sem resposta do GrowthHS ({type(erro).__name__})") from erro

    async def _token(self, *, renovar: bool = False) -> str:
        chave = self._chave_token()
        guardado = _TOKENS.get(chave)
        if guardado and not renovar and time.monotonic() < guardado[1]:
            return guardado[0]
        _TOKENS.pop(chave, None)
        resposta = await self._enviar(
            "POST", self._url(CAMINHO_TOKEN),
            json={"client_id": self.cfg.client_id, "client_secret": self.cfg.client_secret,
                  "grant_type": "client_credentials"})
        try:
            _classificar(resposta)
        except ErroDefinitivo as erro:
            # ⚠️ I1 da revisão final: o pedido de token não leva nada do lead
            # — todo não-2xx definitivo aqui é configuração (308 do proxy
            # http→https, 405 de endereço errado, 400 de credencial mal
            # formada) e pausa a fila, qualquer que seja o status.
            erro.de_configuracao = True
            raise
        corpo = _objeto(resposta)
        token = corpo.get("access_token")
        if not token:
            raise ErroTransitorio("client-credentials sem access_token na resposta")
        try:
            validade = int(corpo.get("expires_in") or VALIDADE_PADRAO_TOKEN)
        except (TypeError, ValueError):
            validade = VALIDADE_PADRAO_TOKEN
        _TOKENS[chave] = (token, time.monotonic() + validade - FOLGA_TOKEN)
        return token

    async def _chamar(self, metodo: str, caminho: str, **kw) -> httpx.Response:
        """Uma chamada autenticada, já classificada (não-2xx levanta)."""
        url = self._url(caminho)
        token = await self._token()
        resposta = await self._enviar(metodo, url, headers={"Authorization": f"Bearer {token}"},
                                      **kw)
        if resposta.status_code == 401:
            token = await self._token(renovar=True)
            resposta = await self._enviar(metodo, url,
                                          headers={"Authorization": f"Bearer {token}"}, **kw)
        _classificar(resposta)
        return resposta

    # ── Pessoa ──

    async def _buscar_pessoa(self, termo: str, campos: tuple[str, ...]) -> int | None:
        """Só para e-mail (ver `achar_ou_criar_pessoa`). ⚠️ A busca de lá é parcial (`ILIKE '%termo%'`): `ana@x.com` traz
        `joana@x.com`. Só vale o casamento EXATO (minúsculas, sem espaço)
        num dos `campos`."""
        resposta = await self._chamar("GET", CAMINHO_PESSOAS,
                                      params={"search": termo, "page_size": 100})
        alvo = termo.strip().lower()
        for pessoa in _objeto(resposta).get("persons") or []:
            if not isinstance(pessoa, dict):
                continue
            for campo in campos:
                if str(pessoa.get(campo) or "").strip().lower() == alvo:
                    return int(pessoa["id"])
        return None

    async def achar_ou_criar_pessoa(self, lead: dict) -> int:
        """O `person_id` do lead (o `POST /cards` não aceita contato inline).

        Casa SÓ por e-mail exato. ⚠️ Segurança (coordenadora, 22/10): a
        entrega anexa dados do formulário público ao card aberto da pessoa
        achada — casar pelo telefone (texto cru lá, sem unicidade; 26
        clientes do ERP dividem um telefone) poria o formulário de um no
        card de outro. Sem e-mail, NÃO busca: cria pessoa nova (quem chama
        guarda o id no pedido, para o retry não duplicar). Lead sem e-mail e
        sem telefone: o CRM daria 422 — falha o pedido aqui, sem rede.
        ⚠️ 400 no POST com e-mail é corrida (alguém criou a pessoa entre a
        busca e o POST): busca de novo e usa a achada."""
        email = (lead.get("email") or "").strip().lower()
        telefone = uma_linha(lead.get("phone_normalized"))
        if not email and not telefone:
            raise ErroDefinitivo("lead sem e-mail e sem telefone: o GrowthHS recusa "
                                 "pessoa assim (422)", 422)
        if email:
            achada = await self._buscar_pessoa(email, CAMPOS_EMAIL)
            if achada is not None:
                return achada
        corpo = {"name": _cortar(lead.get("nome"), MAX_NOME_PESSOA)
                 or (email or telefone)[:MAX_NOME_PESSOA]}
        if email:
            corpo["email"] = email
        if telefone:
            corpo["phone"] = corpo["phone_whatsapp"] = telefone[:MAX_TELEFONE]
        if _tem(lead.get("cargo")):
            corpo["position"] = uma_linha(lead["cargo"])
        try:
            resposta = await self._chamar("POST", CAMINHO_PESSOAS, json=corpo)
        except ErroDefinitivo as erro:
            if erro.status == 400 and email:
                achada = await self._buscar_pessoa(email, CAMPOS_EMAIL)
                if achada is not None:
                    return achada
            raise
        criada = _objeto(resposta).get("id")
        if criada is None:
            # Criou lá, mas não sabemos o id. Com e-mail, a re-tentativa acha
            # a pessoa pela busca (ou cai no 400 de e-mail repetido e busca de
            # novo). ⚠️ SEM e-mail não há busca nem 400: o id nunca chegou ao
            # pedido, e a re-tentativa cria uma SEGUNDA pessoa (só telefone).
            # Aceito — 2xx sem id é defeito de lá, raro; perder o lead seria
            # pior que uma pessoa duplicada que o vendedor funde.
            raise ErroTransitorio("POST /persons sem id na resposta")
        return int(criada)

    # ── Cards ──

    async def cards_da_pessoa(self, person_id: int) -> list[dict]:
        """Os cards da pessoa em TODOS os `boards_conferidos` — o card criado
        na lista de entrada (board 6) pode já ter ido para o 7 (§8.4 de lá).
        `board_id` é obrigatório lá; pagina até `total_pages`."""
        cards: list[dict] = []
        for board in self.cfg.boards_conferidos:
            pagina = 1
            while True:
                resposta = await self._chamar(
                    "GET", CAMINHO_CARDS,
                    params={"board_id": board, "person_id": person_id,
                            "page_size": 100, "page": pagina})
                corpo = _objeto(resposta)
                cards.extend(c for c in corpo.get("cards") or [] if isinstance(c, dict))
                try:
                    total = int(corpo.get("total_pages") or 1)
                except (TypeError, ValueError):
                    total = 1
                if pagina >= total:
                    break
                pagina += 1
        return cards

    async def criar_card(self, corpo: dict) -> dict:
        resposta = await self._chamar("POST", CAMINHO_CARDS, json=corpo)
        # ⚠️ Chegou aqui = 2xx = o card JÁ EXISTE do lado do GrowthHS — daqui
        # para frente NUNCA se levanta exceção, mesmo que o corpo não sirva
        # para nada. Levantar devolveria um pedido "sem resposta" para quem
        # chama, que re-tentaria e criaria um SEGUNDO card (achado I1 do
        # round 1 de revisão do 8D/Tarefa 4). Corpo que não é JSON, ou é JSON
        # mas não é objeto, vira dict vazio: quem chama grava a entrega sem
        # card_id, mas grava. Revisão final do 8D (M1): TODO 2xx é sucesso,
        # não só 200/201 — um 202 ou 204 tratado como erro seria re-enviado e
        # viraria o segundo card. Corpo vazio (204) é `{}`.
        if not resposta.content:
            return {}
        try:
            corpo_resposta = resposta.json()
        except ValueError:
            logger.warning("[growthhs] 2xx com corpo que não é JSON válido: %s",
                           resposta.text[:200])
            return {}
        if not isinstance(corpo_resposta, dict):
            logger.warning("[growthhs] 2xx com corpo JSON que não é objeto: %r",
                           corpo_resposta)
            return {}
        return corpo_resposta

    async def ler_card(self, card_id: int) -> dict:
        return _objeto(await self._chamar("GET", f"{CAMINHO_CARDS}/{card_id}"))

    async def atualizar_descricao(self, card_id: int, descricao: str) -> None:
        """PUT SÓ com `description`: não mexe em título, valor, responsável
        nem lista — o card é do vendedor."""
        await self._chamar("PUT", f"{CAMINHO_CARDS}/{card_id}",
                           json={"description": descricao})

    async def anotar(self, card_id: int, texto: str | list[str]) -> None:
        """A nota é o que o vendedor lê (o GrowthHS não manda push de nota;
        fica no histórico do card, e a tela do card NÃO mostra a
        `description` — pergunta 79). Ver `conteudo_da_nota`."""
        await self._chamar("POST", CAMINHO_NOTAS,
                           json={"card_id": card_id, "content": conteudo_da_nota(texto)})

    # ── Agendamento de reunião (frente agendamento, 28/10/2026) ──
    # Contrato final do GrowthHS: spec 2026-10-28-agendamento-reuniao-design.md,
    # "Contrato final, como o GrowthHS implementou". As três rotas de
    # integração exigem o mesmo JWT do `client-credentials`.

    async def vendedores(self) -> list[dict]:
        """Os vendedores ATIVOS (`GET /integration/vendedores` devolve ativos e
        inativos, por nome). Corpo que não é lista é transitório: leitura, não
        criou nada lá."""
        resposta = await self._chamar("GET", CAMINHO_VENDEDORES)
        try:
            corpo = resposta.json()
        except ValueError:
            corpo = None
        if not isinstance(corpo, list):
            raise ErroTransitorio(f"{resposta.status_code}: resposta inesperada do GrowthHS "
                                  f"(não é lista JSON)")
        saida = []
        for v in corpo:
            if not isinstance(v, dict) or not v.get("ativo") or v.get("id") is None:
                continue
            saida.append({"id": int(v["id"]), "nome": uma_linha(v.get("nome")),
                          "email": uma_linha(v.get("email")).lower(), "ativo": True})
        return saida

    async def agenda(self, user_ids: list[int], inicio: datetime,
                     fim: datetime) -> dict[int, list[tuple[datetime, datetime]] | None]:
        """Os blocos OCUPADOS de cada vendedor no período, em UTC.

        `None` = o vendedor veio em `erros` (fora do grupo do Exchange, sem
        caixa) ou nem veio: quem chama trata como ocupado o período inteiro —
        nunca "livre" por falta de informação. Todo status que a rota devolve
        conta como ocupado (`busy`, `tentative`, `oof`, `workingElsewhere`; o
        `free` ela não manda). Mais de `MAX_IDS_AGENDA` ids vira mais de uma
        chamada."""
        ids = [int(i) for i in dict.fromkeys(user_ids)]
        saida: dict[int, list[tuple[datetime, datetime]] | None] = {i: None for i in ids}
        for k in range(0, len(ids), MAX_IDS_AGENDA):
            lote = ids[k:k + MAX_IDS_AGENDA]
            resposta = await self._chamar(
                "GET", CAMINHO_AGENDA,
                params={"user_ids": ",".join(str(i) for i in lote),
                        "inicio": _utc_z(inicio), "fim": _utc_z(fim)})
            corpo = _objeto(resposta)
            for v in corpo.get("vendedores") or []:
                if not isinstance(v, dict):
                    continue
                try:
                    uid = int(v.get("user_id"))
                except (TypeError, ValueError):
                    continue
                if uid not in saida:
                    continue
                blocos = []
                for b in v.get("ocupado") or []:
                    ini, fim_b = (_ler_iso((b or {}).get("inicio")),
                                  _ler_iso((b or {}).get("fim")))
                    if ini is None or fim_b is None:
                        # Bloco ilegível: o vendedor inteiro fica ocupado.
                        blocos = None
                        break
                    blocos.append((ini, fim_b))
                saida[uid] = blocos
            for e in corpo.get("erros") or []:
                try:
                    saida[int((e or {}).get("user_id"))] = None
                except (TypeError, ValueError):
                    continue
        return {i: saida[i] for i in ids}

    async def buscar_pessoa(self, email: str) -> int | None:
        """Só BUSCA a pessoa pelo e-mail exato — nunca cria (a etapa 3 do
        agendamento procura o card aberto do lead antes de ele confirmar)."""
        alvo = (email or "").strip().lower()
        if not alvo:
            return None
        return await self._buscar_pessoa(alvo, CAMPOS_EMAIL)

    async def card_aberto(self, person_id: int) -> dict | None:
        """O card aberto (nem ganho nem perdido) mais recente da pessoa, como
        `{"id", "assigned_to_id"}`. A listagem que não traz o vendedor faz
        ler o card."""
        abertos = [c for c in await self.cards_da_pessoa(person_id)
                   if not c.get("is_won") and not c.get("is_lost") and c.get("id") is not None]
        if not abertos:
            return None
        minimo = datetime.min.replace(tzinfo=timezone.utc)
        card = max(abertos, key=lambda c: (criado_em_utc(c) or minimo, int(c["id"])))
        if "assigned_to_id" not in card:
            card = await self.ler_card(int(card["id"]))
        vendedor = card.get("assigned_to_id")
        return {"id": int(card["id"]),
                "assigned_to_id": int(vendedor) if vendedor is not None else None}

    async def criar_tarefa(self, corpo: dict) -> dict:
        """`POST /card-tasks`. Mesma regra do `criar_card`: chegou 2xx, a
        tarefa JÁ existe lá — daqui para frente nunca levanta (corpo torto
        vira `{}`), senão quem chama re-tentaria e criaria a segunda."""
        resposta = await self._chamar("POST", CAMINHO_TAREFAS, json=corpo)
        return _corpo_depois_do_2xx(resposta)

    async def atribuir_vendedor(self, card_id: int, user_id: int) -> None:
        """PUT SÓ com `assigned_to_id` — o card aberto sem vendedor ganha o
        da roleta de reunião. Nada mais do card muda."""
        await self._chamar("PUT", f"{CAMINHO_CARDS}/{card_id}",
                           json={"assigned_to_id": int(user_id)})

    async def criar_sala(self, task_id: int) -> dict:
        """`POST /card-tasks/{id}/daily-room`: sala, link público e o evento no
        Outlook DO VENDEDOR com o lead convidado. 503 (Graph) é transitório;
        422 (tarefa sem vendedor com e-mail) definitivo.

        ⚠️ `convidados_removidos > 0` vem num 2xx — é o `DAILY_DEV_MODE` de
        lá cortando o lead. Quem chama trata como falha (Task 7)."""
        corpo = _objeto(await self._chamar("POST", f"{CAMINHO_TAREFAS}/{task_id}/daily-room"))
        try:
            removidos = int(corpo.get("convidados_removidos") or 0)
        except (TypeError, ValueError):
            removidos = 0
        return {"room_url": corpo.get("room_url"), "public_link": corpo.get("public_link"),
                "public_access_token": corpo.get("public_access_token"),
                "convidados_removidos": removidos}


CAMINHO_VENDEDORES = "/api/v1/integration/vendedores"
CAMINHO_AGENDA = "/api/v1/integration/agenda"
CAMINHO_TAREFAS = "/api/v1/card-tasks"
# Limite da `/integration/agenda` (422 acima disso).
MAX_IDS_AGENDA = 30


def _utc_z(data: datetime) -> str:
    """`2026-10-29T15:00:00Z` — a rota recusa data sem fuso (422)."""
    if data.tzinfo is None:
        raise ValueError("data sem fuso")
    return data.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _corpo_depois_do_2xx(resposta: httpx.Response) -> dict:
    """O corpo de um POST que JÁ criou algo lá: nunca levanta."""
    if not resposta.content:
        return {}
    try:
        corpo = resposta.json()
    except ValueError:
        logger.warning("[growthhs] 2xx com corpo que não é JSON válido")
        return {}
    return corpo if isinstance(corpo, dict) else {}


async def testar(cfg: Config, *,
                 transporte: httpx.AsyncBaseTransport | None = None) -> None:
    """"Testar conexão" = só o `client-credentials` (§1 de lá: 200 com token
    é credencial válida). Sempre pede token novo — testar com um guardado
    diria "ok" para um client já desativado. Levanta `ErroDefinitivo`
    (401 = credencial errada) ou `ErroTransitorio` (fora do ar)."""
    async with Cliente(cfg, transporte=transporte) as cliente:
        await cliente._token(renovar=True)


