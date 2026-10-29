"""Vídeo hospedado da landing (frente video-proprio, 29/10/2026).

A landing `phoebus` tocava o vídeo num player "fechado" do YouTube, que ainda
mostra ~3 s de título, "Mais vídeos" e logo, e no iPhone não foi provado. O
editor agora sobe o MP4 (ou WebM) e a página toca num `<video>` nosso.

⚠️ **A rota de leitura é PÚBLICA, sem autenticação** — quem busca é o
navegador de quem abriu a landing, como a imagem (`imagens.py`).

⚠️ **Range é obrigatório, não enfeite.** O Safari do iPhone começa pedindo
`Range: bytes=0-1` e só toca se receber `206` com `Content-Range`; sem isso,
o `<video>` fica preto para sempre. Os outros navegadores também pedem
trechos para buscar no meio do vídeo sem baixá-lo todo.

**Armazenamento:** bytea no Postgres (`landing_videos`, migration 037), como
`email_assets` — sem infraestrutura nova, o dump leva o vídeo junto. A coluna
é `STORAGE EXTERNAL` (fora da linha, sem compressão), então o
`substring(bytes FROM a FOR n)` lê só os pedaços TOAST daquele trecho: um
pedido de 64 KB não traz 60 MB para a memória, nem do banco nem daqui. O
corpo sai em pedaços de `PEDACO`, cada um numa sessão curta — segurar uma
conexão do pool (são 10) enquanto um celular lento baixa o vídeo travaria o
resto do sistema.
"""

import re
import uuid

from fastapi import (APIRouter, Depends, File, HTTPException, Request, Response,
                     UploadFile, status)
from fastapi.responses import StreamingResponse

from app.database import sessao
from app.dependencies import Usuario, admin_atual

router = APIRouter(tags=["videos"])

# 60 MB: um vídeo de produto de 1 a 3 min em 1080p H.264 cabe com folga. O
# nginx do sistema (`frontend/nginx.conf`) libera este tamanho SÓ na rota de
# upload; o resto continua em 20 MB.
TAMANHO_MAXIMO = 60 * 1024 * 1024

# O que o navegador declara para .mp4/.webm. `application/octet-stream` (e
# vazio) entra porque há navegador e sistema que não sabem o tipo de .mp4 —
# quem decide são os BYTES, e o tipo gravado é o que eles dizem.
TIPOS_DECLARADOS = {"video/mp4", "video/webm", "application/octet-stream", ""}

# Trecho lido do banco por vez ao servir.
PEDACO = 1024 * 1024

# Balde próprio de `/publico/video/` (registrado no `main.py`): um vídeo
# tocando pede vários trechos por minuto — o Safari, dezenas. No balde comum
# (30/min, o mesmo de `/publico/captura`), quem assistisse levaria 429 ao
# mandar o formulário. Generoso porque operadora de celular põe muita gente
# atrás do mesmo IP.
LIMITE_POR_MINUTO = 600

CACHE = "public, max-age=31536000, immutable"


def tipo_pelos_bytes(dados: bytes) -> str | None:
    """`video/mp4` ou `video/webm` pela assinatura; `None` se não for vídeo.

    MP4 (ISO BMFF): a primeira caixa é `ftyp` — 4 bytes de tamanho e o nome.
    WebM: cabeçalho EBML (`1A 45 DF A3`) com DocType `webm` logo depois — o
    EBML sozinho também abre Matroska (.mkv), que o navegador não toca.
    """
    if len(dados) >= 12 and dados[4:8] == b"ftyp":
        return "video/mp4"
    if dados.startswith(b"\x1a\x45\xdf\xa3") and b"webm" in dados[:64]:
        return "video/webm"
    return None


_RANGE = re.compile(r"\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*")


def intervalo(cabecalho: str, tamanho: int) -> tuple[int, int] | None:
    """(início, fim) inclusivos de um `Range: bytes=...`, ou `None` se o
    pedido não puder ser atendido (vira 416).

    Aceita `a-b`, `a-` e o sufixo `-n` (os últimos n). Fim além do arquivo
    é cortado no último byte, como manda a RFC 9110. Vários trechos
    (`0-1,5-6`) não: nenhum navegador pede assim para vídeo.
    """
    m = _RANGE.fullmatch(cabecalho or "")
    if not m or tamanho <= 0:
        return None
    a, b = m.group(1), m.group(2)
    if a == "":
        if b == "" or int(b) == 0:
            return None
        return max(0, tamanho - int(b)), tamanho - 1
    inicio = int(a)
    fim = tamanho - 1 if b == "" else min(int(b), tamanho - 1)
    if inicio >= tamanho or fim < inicio:
        return None
    return inicio, fim


@router.post("/videos", status_code=status.HTTP_201_CREATED)
async def subir_video(arquivo: UploadFile = File(...),
                      admin: Usuario = Depends(admin_atual)):
    """Sobe um vídeo e devolve o caminho que vai na config da seção."""
    if (arquivo.content_type or "") not in TIPOS_DECLARADOS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Tipo não aceito ({arquivo.content_type}). Use MP4 (H.264) ou WebM.")
    # Um byte além do limite: o bastante para saber que passou.
    dados = await arquivo.read(TAMANHO_MAXIMO + 1)
    if len(dados) > TAMANHO_MAXIMO:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE,
            f"O vídeo passa de {TAMANHO_MAXIMO // (1024 * 1024)} MB. "
            "Exporte em 1080p (ou 720p) H.264 e tente de novo.")
    if not dados:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Arquivo vazio.")
    tipo = tipo_pelos_bytes(dados)
    if tipo is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "O conteúdo não é um vídeo MP4 nem WebM.")

    nome = (arquivo.filename or "video")[:200]
    async with sessao(role="service_role") as conn:
        novo = await conn.fetchval(
            """INSERT INTO landing_videos (nome, tipo, tamanho, bytes, criado_por)
               VALUES ($1, $2, $3, $4, $5::uuid) RETURNING id""",
            nome, tipo, len(dados), dados, admin.id)
    return {"id": str(novo), "url": f"/publico/video/{novo}", "nome": nome,
            "tipo": tipo, "tamanho": len(dados)}


async def _pedacos(video_id: str, inicio: int, fim: int):
    """Os bytes de `inicio` a `fim` (inclusivos), um `PEDACO` por vez, cada
    um numa sessão curta. `substring` do Postgres conta a partir de 1."""
    posicao = inicio
    while posicao <= fim:
        n = min(PEDACO, fim - posicao + 1)
        async with sessao(role="service_role") as conn:
            trecho = await conn.fetchval(
                "SELECT substring(bytes FROM $2 FOR $3) FROM landing_videos WHERE id = $1::uuid",
                video_id, posicao + 1, n)
        if not trecho:
            return  # apagado no meio do caminho: a conexão fecha curta
        yield trecho
        posicao += len(trecho)


@router.api_route("/publico/video/{video_id}", methods=["GET", "HEAD"])
async def servir_video(video_id: str, request: Request):
    """O vídeo, inteiro (200) ou um trecho (206). **Sem autenticação, de
    propósito** — ver o topo.

    `ETag` é o próprio id: o conteúdo de um id nunca muda (trocar o vídeo no
    editor gera outro id), por isso também o `Cache-Control` imutável.
    """
    try:
        uuid.UUID(video_id)
    except ValueError:
        # Sem isto, um id malformado vira erro de cast do Postgres e 500.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vídeo não encontrado.")

    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            "SELECT tipo, tamanho FROM landing_videos WHERE id = $1::uuid", video_id)
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vídeo não encontrado.")

    tamanho = linha["tamanho"]
    etag = f'"{video_id}"'
    base = {"Accept-Ranges": "bytes", "ETag": etag, "Cache-Control": CACHE,
            "X-Content-Type-Options": "nosniff"}

    if etag in (request.headers.get("if-none-match") or ""):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=base)

    pedido = request.headers.get("range")
    if pedido is None:
        inicio, fim, codigo = 0, tamanho - 1, status.HTTP_200_OK
    else:
        trecho = intervalo(pedido, tamanho)
        if trecho is None:
            return Response(status_code=status.HTTP_416_RANGE_NOT_SATISFIABLE,
                            headers={**base, "Content-Range": f"bytes */{tamanho}"})
        inicio, fim = trecho
        codigo = status.HTTP_206_PARTIAL_CONTENT
        base["Content-Range"] = f"bytes {inicio}-{fim}/{tamanho}"

    base["Content-Length"] = str(fim - inicio + 1)
    if request.method == "HEAD":
        return Response(status_code=codigo, headers=base, media_type=linha["tipo"])
    return StreamingResponse(_pedacos(video_id, inicio, fim), status_code=codigo,
                             headers=base, media_type=linha["tipo"])
