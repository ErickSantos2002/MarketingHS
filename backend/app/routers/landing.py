"""A casca HTML da landing pública.

Serve um HTML pequeno com as meta tags e as `og:*` já preenchidas, mais a
config embutida como JSON. O corpo da página é React, montado no cliente.

⚠️ **Por que servida e não montada no cliente:** anunciar exige preview de link
correto, e o Meta e o WhatsApp leem o HTML CRU da resposta — nunca executam o
JavaScript. Um SPA entrega a eles o mesmo `index.html` para toda página, e o
preview sai genérico.

⚠️ **Por que a config vem embutida:** `GET /publico/paginas/{slug}` existe desde
o lote 7 e exige `chave_api("read")`. Um navegador anônimo não pode carregar
chave — qualquer credencial que chegue à landing está publicada. Embutir
resolve isso e ainda tira uma ida ao servidor.

⚠️ **`/p/{slug}` e não `/{slug}`:** um catch-all na raiz sombrearia `/paginas`,
`/publico` e `/auth`. A URL limpa do anúncio é problema do nginx em produção.
"""

import html
import json
import logging
import time

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from app.captura.urls import config_com_urls_seguras
from app.database import sessao

logger = logging.getLogger(__name__)
router = APIRouter(tags=["landing"])

# A landing é anônima e não passa pelo limite de taxa — visitante atrás de NAT
# corporativo divide IP, e limitar visualização derrubaria gente de verdade. O
# cache de processo é o que impede uma ida ao banco por acesso, tanto no
# caminho feliz quanto no 404 (ver `_config_da_pagina`).
TTL_SEGUNDOS = 60
TTL_NEGATIVO_SEGUNDOS = 10
_cache: dict[str, tuple[dict, float]] = {}
_cache_negativo: dict[str, float] = {}


def _limpar_cache() -> None:
    _cache.clear()
    _cache_negativo.clear()


async def _config_da_pagina(slug: str) -> dict | None:
    """Devolve a config da página, ou `None` se ela não existe ou não está
    `active`.

    ⚠️ **`pages` guarda o mesmo SEO em DOIS lugares.** As COLUNAS
    `meta_title` e `meta_description` são as que `paginas.py` grava quando o
    corpo do POST/PATCH as traz — foi o caminho do antigo diálogo de página
    (`PageFormDialog.tsx`, órfão apagado no G5, 30/09) e continua aberto para
    quem chama a API; as páginas criadas por ele seguem com o SEO só na
    coluna. O editor de config do construtor (`PageConfigEditor.tsx`), hoje a
    única tela que edita SEO, grava as mesmas duas chaves dentro de `config`.
    `config` vence quando as duas existem; a coluna é o fallback; o nome da
    página é o último recurso. Sem o fallback, toda página cujo SEO está só
    na coluna cai no `<title>` genérico e serve `description`/`og:description`
    vazias — exatamente o preview genérico que esta rota existe para eliminar.

    ⚠️ **Cache negativo de 10s, deliberadamente mais curto que o positivo
    (60s).** `/p/{slug}` é o único caminho público, anônimo e sem limite de
    taxa até o banco neste sistema — sem cache negativo, `GET /p/<slug
    aleatório>` bateria no banco a cada requisição, sem teto. Curto de
    propósito: uma página recém-publicada não pode ficar presa em 404 por um
    minuto inteiro.
    """
    em_cache = _cache.get(slug)
    if em_cache and em_cache[1] > time.monotonic():
        return dict(em_cache[0])

    expira_negativo = _cache_negativo.get(slug)
    if expira_negativo and expira_negativo > time.monotonic():
        return None

    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            "SELECT name, meta_title, meta_description, config FROM pages "
            "WHERE slug = $1 AND status = 'active'", slug)
    if linha is None:
        _cache_negativo[slug] = time.monotonic() + TTL_NEGATIVO_SEGUNDOS
        return None

    config = dict(linha["config"] or {})
    if not config.get("meta_title"):
        config["meta_title"] = linha["meta_title"]
    if not config.get("meta_description"):
        config["meta_description"] = linha["meta_description"]
    config.setdefault("nome_da_pagina", linha["name"])

    _cache[slug] = (config, time.monotonic() + TTL_SEGUNDOS)
    return dict(config)


def _json_seguro(dados: dict) -> str:
    """JSON para dentro de `<script type="application/json">`.

    A única propriedade que este bloco precisa garantir é não encerrar o
    estado "script data" do tokenizador HTML — a única saída dele é a
    sequência literal `</script` seguida de espaço, `/` ou `>`. Dentro de
    script data o parser **não forma tags, não forma atributos e não
    decodifica referência de caractere nenhuma**; e `type="application/json"`
    não é MIME de JavaScript, então o navegador não executa o bloco de jeito
    nenhum.

    ⚠️ **`<` é o escape OBRIGATÓRIO** — é ele que fecha a porta do `</script`
    (e dos estados de "escaped"/"double escaped" que o tokenizador entra ao
    ver `<!--` dentro de script data). `>` e `&` são cinto-e-suspensório
    barato, não a defesa em si. Trocar os três por `\\uXXXX` continua sendo
    JSON válido — o parser decodifica de volta ao caractere original.

    ⚠️ **Não amplie este conjunto sem necessidade.** Uma rodada anterior
    chegou a escapar `=`, `(` e `)` também, para satisfazer um teste que
    exigia a ausência literal de `onerror=alert(1)` no HTML — revisão
    posterior achou que isso não fecha buraco nenhum (a string já é inerte
    sem `<`, dentro de um bloco que o navegador não executa) e tem custo
    real: `config` carrega `redirect_url`, com `?utm_source=...&utm_medium=...`
    — escapar `=` e `&` incha essa URL ~5x — e o `<`, que é a única entrada
    que sustenta a segurança, some enterrado entre cinco escapes
    indistinguíveis para quem for mexer aqui depois.
    """
    saida = json.dumps(dados, ensure_ascii=False)
    return (saida.replace("<", "\\u003c")
                 .replace(">", "\\u003e")
                 .replace("&", "\\u0026"))


# Plus Jakarta Sans, a fonte oficial da H&S (a mesma URL do Design System,
# `frontend/src/design-system/tokens/typography.css`, só com os pesos que a
# landing usa). Aqui na casca e não como `@import` no `landing.css`: o
# `@import` só é descoberto depois que o CSS da landing baixa, e a fonte
# chega uma ida ao servidor mais tarde; o `<link>` no `<head>` baixa em
# paralelo, e o `preconnect` já abre a conexão com o servidor dos arquivos.
# `display=swap`: o texto aparece na fonte do sistema e troca quando chegar.
FONTE = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
    'family=Plus+Jakarta+Sans:wght@400;500;600;700;800&amp;display=swap">\n'
)


# O player do vídeo (frente landing-nicholson, 27/10) é a IFrame API do
# YouTube: o script vem de `www.youtube.com/iframe_api` e o player é um frame
# de `www.youtube-nocookie.com`. Esta casca não manda CSP (nem o nginx da
# produção, conferido em 27/10), então nada a liberar — se um dia vier uma
# CSP, ela precisa de `script-src https://www.youtube.com` e `frame-src
# https://www.youtube-nocookie.com` (`test_landing_player.py` cobra isso).
#
# ⚠️ **O que o player precisa é o Referer.** Desde 2025 o embed do YouTube
# recusa tocar sem saber de que site vem ("Erro 153"). O padrão do navegador
# já manda a origem; a meta deixa isso escrito, para um `no-referrer`
# global no nginx não derrubar o vídeo em silêncio (a meta vale depois do
# cabeçalho). `strict-origin-when-cross-origin` manda só a origem para fora
# — nunca o caminho com os `utm_*` do anúncio.
REFERRER = '<meta name="referrer" content="strict-origin-when-cross-origin">\n'


def montar_casca(slug: str, config: dict, *, previa: bool = False) -> str:
    """⚠️ Todo valor que sai daqui veio de campo EDITÁVEL na tela de Páginas.
    `html.escape(..., quote=True)` em tudo — inclusive, e principalmente, no que
    vai dentro de atributo, que é onde as `og:*` vivem."""
    titulo = html.escape(str(config.get("meta_title")
                             or config.get("nome_da_pagina") or "Health & Safety"),
                         quote=True)
    descricao = html.escape(str(config.get("meta_description") or ""), quote=True)
    slug_seguro = html.escape(slug, quote=True)
    # Prova do RD: a página pode sair dos buscadores (`noindex`) — só quando
    # a config manda; página antiga continua indexável (Review Focus 5).
    robots = ('<meta name="robots" content="noindex,nofollow">\n'
              if config.get("noindex") else "")
    # ⚠️ A config vai para a página PÚBLICA: URL que não é http(s) nem
    # caminho do site (`javascript:` no link da política) sai aqui, mesmo
    # se já estava gravada antes da regra de `paginas.py`.
    config = config_com_urls_seguras(config)
    # A prévia do editor de páginas (`?previa=1`) não carrega o `rastreio.js`:
    # quem edita a página não é visitante (achado da prova, 22/10). A
    # conversão pela prévia continua possível — o formulário é o mesmo.
    rastreio = ("" if previa else
                f'<script src="/rastreio.js" defer data-pagina="{slug_seguro}" '
                'data-api="/api" data-captura="off"></script>\n')

    return f"""<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
{REFERRER}<title>{titulo}</title>
<link rel="icon" type="image/x-icon" href="/hs.ico">
<meta name="description" content="{descricao}">
<meta property="og:type" content="website">
<meta property="og:title" content="{titulo}">
<meta property="og:description" content="{descricao}">
<meta name="twitter:card" content="summary_large_image">
{robots}{FONTE}<link rel="stylesheet" href="/landing/main.css">
</head>
<body>
<div id="landing" data-slug="{slug_seguro}"></div>
<script type="application/json" id="config-da-pagina">{_json_seguro(config)}</script>
<script type="module" src="/landing/main.js"></script>
{rastreio}</body>
</html>"""


# ⚠️ 404 de uma rota HTML respondendo JSON (`{"detail": ...}`, o padrão do
# FastAPI para HTTPException) é o que quem clicou num link de anúncio vê na
# tela. Resposta HTML simples, mesmo status.
_HTML_404 = """<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Página não encontrada</title>
</head>
<body>
<h1>Página não encontrada.</h1>
</body>
</html>"""


@router.get("/p/{slug}", response_class=HTMLResponse)
async def landing(slug: str, previa: str | None = None):
    config = await _config_da_pagina(slug)
    if config is None:
        return HTMLResponse(_HTML_404, status_code=404)
    return HTMLResponse(montar_casca(slug, config, previa=previa == "1"))
