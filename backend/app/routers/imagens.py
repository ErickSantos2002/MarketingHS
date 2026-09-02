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
"""

import logging
import uuid

from fastapi import (APIRouter, Depends, File, Form, HTTPException, Response,
                     UploadFile, status)

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
            "SELECT bytes, tipo FROM email_assets WHERE id = $1::uuid", imagem_id)
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Imagem não encontrada.")

    return Response(
        content=linha["bytes"],
        media_type=linha["tipo"],
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
