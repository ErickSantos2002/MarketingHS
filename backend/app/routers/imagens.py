"""Imagens do editor de e-mail.

⚠️ **A rota de leitura é PÚBLICA, sem autenticação, e isso é o ponto.** A
imagem viaja dentro de um e-mail e quem a busca é o cliente de e-mail de quem
recebeu — Gmail, Outlook, o celular de um lead. Nenhum deles tem sessão aqui. Se
a rota exigisse login, o e-mail chegaria com a imagem quebrada para todo mundo,
e o defeito só apareceria na caixa de entrada dos outros.

⚠️ Guardadas no Postgres, não em bucket ou volume: não exige infraestrutura
nova e o backup do banco leva as imagens junto. Imagem de e-mail é pequena e são
poucas — se um dia forem muitas, isto vira migração para armazenamento de
objeto (registrado no ROADMAP).

PDF (prova do RD, Tarefa 9 — a ficha técnica): mesma tabela, `pasta =
'arquivos'`, rota pública PRÓPRIA (`/publico/arquivo/<id>`). As duas rotas
públicas não se cruzam: a de imagem não serve PDF, a de arquivo não serve
imagem — o PDF só sai com `nosniff` e `Content-Security-Policy: sandbox`.
"""

import logging
import re
import unicodedata
import uuid

from fastapi import (APIRouter, Depends, File, Form, HTTPException, Response,
                     UploadFile, status)

from app.config import settings
from app.database import sessao
from app.dependencies import Usuario, admin_atual

logger = logging.getLogger(__name__)
router = APIRouter(tags=["imagens"])

# ⚠️ Lista fechada. O que sai daqui é servido com o Content-Type que veio na
# gravação; aceitar `image/svg+xml` seria aceitar SVG, e SVG carrega script —
# servido do nosso domínio, viraria XSS na conta de quem abrir a URL.
TIPOS_ACEITOS = {"image/png", "image/jpeg", "image/gif", "image/webp"}

# 5 MB. Imagem de e-mail acima disso já é problema de entregabilidade antes de
# ser problema de armazenamento.
TAMANHO_MAXIMO = 5 * 1024 * 1024

# O arquivo da ficha técnica. Lista fechada pelo mesmo motivo da de imagem; o
# tipo declarado sozinho não basta (é o navegador que diz), então os bytes
# também precisam começar pela assinatura do PDF.
TIPOS_DE_ARQUIVO = {"application/pdf"}
TAMANHO_MAXIMO_ARQUIVO = 10 * 1024 * 1024
ASSINATURA_PDF = b"%PDF-"
PASTA_DE_ARQUIVOS = "arquivos"


@router.post("/imagens", status_code=status.HTTP_201_CREATED)
async def subir_imagem(
    arquivo: UploadFile = File(...),
    pasta: str = Form("campaigns"),
    admin: Usuario = Depends(admin_atual),
):
    """Sobe uma imagem e devolve a URL pública que vai dentro do e-mail."""
    if arquivo.content_type not in TIPOS_ACEITOS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Tipo não aceito ({arquivo.content_type}). "
            f"Use PNG, JPEG, GIF ou WebP.")

    dados = await arquivo.read()
    if len(dados) > TAMANHO_MAXIMO:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"A imagem tem {len(dados) // 1024} KB; o limite é "
            f"{TAMANHO_MAXIMO // 1024} KB.")
    if not dados:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Arquivo vazio.")

    async with sessao(role="service_role") as conn:
        novo = await conn.fetchval(
            """INSERT INTO email_assets (nome, tipo, bytes, tamanho, pasta, criado_por)
               VALUES ($1, $2, $3, $4, $5, $6::uuid) RETURNING id""",
            arquivo.filename or "imagem", arquivo.content_type, dados,
            len(dados), pasta if pasta in ("campaigns", "templates") else "campaigns",
            admin.id)

    return {"id": str(novo), "url": f"/publico/imagem/{novo}",
            "tamanho": len(dados)}


@router.get("/publico/imagem/{imagem_id}")
async def servir_imagem(imagem_id: str):
    """Os bytes da imagem. **Sem autenticação, de propósito** — ver o topo.

    ⚠️ `Cache-Control` longo e imutável: o id é único por upload e o conteúdo
    nunca muda: trocar a imagem no editor gera outro id. Sem isso, cada abertura
    de e-mail bateria no nosso banco de novo.
    """
    try:
        uuid.UUID(imagem_id)
    except ValueError:
        # Sem isto, um id malformado vira erro de cast do Postgres e 500.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Imagem não encontrada.")

    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            "SELECT bytes, tipo FROM email_assets WHERE id = $1::uuid AND pasta <> $2",
            imagem_id, PASTA_DE_ARQUIVOS)
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Imagem não encontrada.")

    return Response(
        content=linha["bytes"],
        media_type=linha["tipo"],
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


# ── Arquivos (PDF) ───────────────────────────────────────────────────────────

def _urls(arquivo_id) -> dict:
    """`url` relativa ao backend (o admin usa pelo proxy); `url_publica` é a
    que vai DENTRO do e-mail — absoluta, pelo domínio do sistema."""
    return {"url": f"/publico/arquivo/{arquivo_id}",
            "url_publica": f"{settings.FRONTEND_URL}/api/publico/arquivo/{arquivo_id}"}


def _nome_seguro(nome: str | None) -> str:
    """Só ASCII de nome de arquivo: o valor vai cru num cabeçalho HTTP, e aspas
    ou quebra de linha ali seriam injeção de cabeçalho."""
    # "Técnica" vira "Tecnica", não "T-cnica": tira o acento antes de filtrar.
    sem_acento = unicodedata.normalize("NFKD", nome or "").encode("ascii", "ignore").decode()
    base = re.sub(r"\.pdf$", "", sem_acento.strip(), flags=re.IGNORECASE)
    base = re.sub(r"[^A-Za-z0-9._-]+", "-", base).strip("-.")[:80]
    return (base or "arquivo") + ".pdf"


@router.post("/arquivos", status_code=status.HTTP_201_CREATED)
async def subir_arquivo(arquivo: UploadFile = File(...),
                        admin: Usuario = Depends(admin_atual)):
    """Sobe um PDF e devolve o link público estável para pôr no e-mail."""
    if arquivo.content_type not in TIPOS_DE_ARQUIVO:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Tipo não aceito ({arquivo.content_type}). Use PDF.")
    # Lê um byte além do limite: o bastante para saber que passou, sem
    # carregar um arquivo de 1 GB inteiro na memória.
    dados = await arquivo.read(TAMANHO_MAXIMO_ARQUIVO + 1)
    if len(dados) > TAMANHO_MAXIMO_ARQUIVO:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE,
            f"O arquivo passa de {TAMANHO_MAXIMO_ARQUIVO // (1024 * 1024)} MB.")
    if not dados:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Arquivo vazio.")
    if not dados.startswith(ASSINATURA_PDF):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "O conteúdo não é um PDF (falta a assinatura %PDF-).")

    nome = arquivo.filename or "arquivo.pdf"
    async with sessao(role="service_role") as conn:
        novo = await conn.fetchval(
            """INSERT INTO email_assets (nome, tipo, bytes, tamanho, pasta, criado_por)
               VALUES ($1, 'application/pdf', $2, $3, $4, $5::uuid) RETURNING id""",
            nome, dados, len(dados), PASTA_DE_ARQUIVOS, admin.id)
    return {"id": str(novo), "nome": nome, "tamanho": len(dados), **_urls(novo)}


@router.get("/arquivos")
async def listar_arquivos(admin: Usuario = Depends(admin_atual)):
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            """SELECT id, nome, tamanho, criado_em FROM email_assets
                WHERE pasta = $1 ORDER BY criado_em DESC""", PASTA_DE_ARQUIVOS)
    return [{"id": str(l["id"]), "nome": l["nome"], "tamanho": l["tamanho"],
             **_urls(l["id"]), "criado_em": l["criado_em"].isoformat()}
            for l in linhas]


@router.get("/publico/arquivo/{arquivo_id}")
async def servir_arquivo(arquivo_id: str):
    """Os bytes do PDF. **Sem autenticação, de propósito** — quem abre é o
    lead, pelo link do e-mail.

    ⚠️ `nosniff` + `sandbox`: o arquivo é do usuário e sai do NOSSO domínio. Um
    PDF com script embutido, aberto aqui, não roda com a origem do sistema.
    """
    try:
        uuid.UUID(arquivo_id)
    except ValueError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Arquivo não encontrado.")

    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            "SELECT bytes, nome FROM email_assets WHERE id = $1::uuid AND pasta = $2",
            arquivo_id, PASTA_DE_ARQUIVOS)
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Arquivo não encontrado.")

    return Response(
        content=linha["bytes"],
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{_nome_seguro(linha["nome"])}"',
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    )
