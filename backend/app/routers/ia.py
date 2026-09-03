"""As rotas de IA. Substituem `ai-data-analyst`, `analyze-leads` e
`analyze-challenges`.

⚠️ Todas exigem `usuario_atual` — e as ferramentas rodam pela MESMA `sessao()`
do request, com o papel de quem perguntou (`role="authenticated"`,
`user_id=usuario.id`). Nunca `service_role`: `service_role` tem BYPASSRLS e é
só para operação interna (bootstrap, job agendado) — o analista lê dado a
pedido de uma pessoa, e isso é request de usuário.
"""

import json

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, usuario_atual
from app.ia import analista
from app.ia.cliente import IANaoConfigurada, exigir_cliente

router = APIRouter(prefix="/ia", tags=["ia"])


class MensagemIn(BaseModel):
    conteudo: str = Field(min_length=1, max_length=4000)


@router.get("/conversas")
async def listar_conversas(usuario: Usuario = Depends(usuario_atual)):
    """As conversas de QUEM PERGUNTA, não as de todo mundo."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            """SELECT id::text, title, created_at, updated_at
                 FROM ai_chat_conversations
                WHERE user_id = $1::uuid
                ORDER BY updated_at DESC
                LIMIT 50""", usuario.id)
    return [dict(l) for l in linhas]


@router.post("/conversas", status_code=status.HTTP_201_CREATED)
async def criar_conversa(usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            """INSERT INTO ai_chat_conversations (user_id)
               VALUES ($1::uuid)
               RETURNING id::text, title, created_at, updated_at""", usuario.id)
    return dict(linha)


@router.get("/conversas/{conversa_id}")
async def ler_conversa(conversa_id: str, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        dona = await conn.fetchval(
            "SELECT user_id::text FROM ai_chat_conversations WHERE id = $1::uuid",
            conversa_id)
        if dona is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversa não encontrada.")
        if dona != usuario.id:
            # ⚠️ 404, não 403: dizer "existe mas não é sua" já entrega que a
            # conversa existe. A rota autoriza sozinha, sem depender do RLS.
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversa não encontrada.")
        mensagens = await conn.fetch(
            """SELECT role, content, created_at
                 FROM ai_chat_messages
                WHERE conversation_id = $1::uuid
                ORDER BY created_at""", conversa_id)
    return {"id": conversa_id, "mensagens": [dict(m) for m in mensagens]}


@router.delete("/conversas/{conversa_id}", status_code=status.HTTP_204_NO_CONTENT)
async def apagar_conversa(conversa_id: str, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        apagadas = await conn.execute(
            "DELETE FROM ai_chat_conversations WHERE id = $1::uuid AND user_id = $2::uuid",
            conversa_id, usuario.id)
    if apagadas == "DELETE 0":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversa não encontrada.")


@router.post("/conversas/{conversa_id}/mensagens")
async def enviar_mensagem(conversa_id: str, dados: MensagemIn,
                          usuario: Usuario = Depends(usuario_atual)):
    """Grava a pergunta, responde com ferramentas, grava a resposta."""
    try:
        cliente = await exigir_cliente()
    except IANaoConfigurada as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        dona = await conn.fetchval(
            "SELECT user_id::text FROM ai_chat_conversations WHERE id = $1::uuid",
            conversa_id)
        if dona != usuario.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversa não encontrada.")

        anteriores = await conn.fetch(
            """SELECT role, content FROM ai_chat_messages
                WHERE conversation_id = $1::uuid ORDER BY created_at
                LIMIT 40""", conversa_id)
        historico = [{"role": m["role"], "content": m["content"]}
                     for m in anteriores]
        historico.append({"role": "user", "content": dados.conteudo})

        await conn.execute(
            """INSERT INTO ai_chat_messages (conversation_id, role, content)
               VALUES ($1::uuid, 'user', $2)""", conversa_id, dados.conteudo)

        try:
            resultado = await analista.responder(cliente, conn, historico)
        except Exception as e:  # noqa: BLE001
            # A pergunta já foi gravada; a resposta não veio. Melhor um 502 com
            # a pergunta salva do que perder a pergunta junto.
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                f"A IA não respondeu: {e}")

        await conn.execute(
            """INSERT INTO ai_chat_messages (conversation_id, role, content)
               VALUES ($1::uuid, 'assistant', $2)""",
            conversa_id, resultado["texto"])
        await conn.execute(
            "UPDATE ai_chat_conversations SET updated_at = now() WHERE id = $1::uuid",
            conversa_id)

    return resultado
