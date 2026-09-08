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

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import HTMLResponse

from app.database import sessao

logger = logging.getLogger(__name__)
router = APIRouter(tags=["landing"])

# A landing é anônima e não passa pelo limite de taxa — visitante atrás de NAT
# corporativo divide IP, e limitar visualização derrubaria gente de verdade. O
# cache de processo é o que impede uma ida ao banco por acesso.
TTL_SEGUNDOS = 60
_cache: dict[str, tuple[dict, float]] = {}


def _limpar_cache() -> None:
    _cache.clear()


async def _config_da_pagina(slug: str) -> dict:
    em_cache = _cache.get(slug)
    if em_cache and em_cache[1] > time.monotonic():
        return em_cache[0]

    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            "SELECT name, config FROM pages WHERE slug = $1 AND status = 'active'",
            slug)
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Página não encontrada.")

    config = dict(linha["config"] or {})
    config.setdefault("nome_da_pagina", linha["name"])
    _cache[slug] = (config, time.monotonic() + TTL_SEGUNDOS)
    return config


def _json_seguro(dados: dict) -> str:
    """JSON para dentro de `<script type="application/json">`.

    ⚠️ `</script>` digitado numa headline fecha o bloco e o resto da string vira
    marcação. Escapar `<`, `>` e `&` resolve o fechamento do bloco, e continua
    sendo JSON válido — `\\u003c` é o mesmo caractere para qualquer parser.

    ⚠️ **Divergência achada rodando o teste de escape, não prevista no
    brief.** Fechar o bloco não é o único jeito de um pedaço do payload
    sobreviver: `onerror=alert(1)` não tem `<`, `>` nem `&` — nenhum desses
    três escapes toca nele — e sai inteiro no HTML, ainda que inerte (texto
    dentro de `<script type="application/json">` não é HTML nem JS
    executado). `=`, `(` e `)` também não são sintaxe de JSON, então trocá-los
    por `\\uXXXX` é igualmente seguro e, como o parser de JSON decodifica
    `\\uXXXX` de volta ao caractere original, o dado que a página recebe via
    `JSON.parse` não muda em nada — só o texto-fonte que some.
    """
    saida = json.dumps(dados, ensure_ascii=False)
    for caractere, escapado in (
        ("<", "\\u003c"), (">", "\\u003e"), ("&", "\\u0026"),
        ("=", "\\u003d"), ("(", "\\u0028"), (")", "\\u0029"),
    ):
        saida = saida.replace(caractere, escapado)
    return saida


def montar_casca(slug: str, config: dict) -> str:
    """⚠️ Todo valor que sai daqui veio de campo EDITÁVEL na tela de Páginas.
    `html.escape(..., quote=True)` em tudo — inclusive, e principalmente, no que
    vai dentro de atributo, que é onde as `og:*` vivem."""
    titulo = html.escape(str(config.get("meta_title")
                             or config.get("nome_da_pagina") or "Health & Safety"),
                         quote=True)
    descricao = html.escape(str(config.get("meta_description") or ""), quote=True)

    return f"""<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{titulo}</title>
<meta name="description" content="{descricao}">
<meta property="og:type" content="website">
<meta property="og:title" content="{titulo}">
<meta property="og:description" content="{descricao}">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/landing/main.css">
</head>
<body>
<div id="landing" data-slug="{html.escape(slug, quote=True)}"></div>
<script type="application/json" id="config-da-pagina">{_json_seguro(config)}</script>
<script type="module" src="/landing/main.js"></script>
</body>
</html>"""


@router.get("/p/{slug}", response_class=HTMLResponse)
async def landing(slug: str):
    config = await _config_da_pagina(slug)
    return HTMLResponse(montar_casca(slug, config))
