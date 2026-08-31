"""Autenticação. Substitui o supabase.auth.

Uma conta é duas linhas em duas tabelas, criadas na mesma transação:
  auth.users        identidade (e-mail, hash da senha)
  public.user_roles papel — o enum public.app_role, cujo valor de admin é 'admin'

Não há recuperação de senha por e-mail: sistema interno, senha definida pelo TI.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth.schemas import (
    BootstrapIn, LoginIn, StatusInstalacaoOut, TokenOut, UsuarioOut,
)
from app.auth.security import conferir_senha, emitir_token, gerar_hash
from app.database import sessao
from app.dependencies import Usuario, usuario_atual

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/status", response_model=StatusInstalacaoOut)
async def status_instalacao():
    """Instalação zerada não tem usuário e não há cadastro público. A tela de
    login usa isto para oferecer a criação do primeiro administrador."""
    async with sessao(role="service_role") as conn:
        total = await conn.fetchval("SELECT count(*) FROM auth.users")
    return StatusInstalacaoOut(precisa_bootstrap=(total == 0), total_usuarios=total)


@router.post("/bootstrap-admin", response_model=TokenOut,
             status_code=status.HTTP_201_CREATED)
async def bootstrap_admin(dados: BootstrapIn):
    """Cria o primeiro administrador. Só funciona com o banco sem usuário."""
    senha_hash = gerar_hash(dados.senha)
    async with sessao(role="service_role") as conn:
        # Trava a tabela para que duas chamadas simultâneas não criem dois
        # "primeiros" admins. A transação da sessão garante a liberação.
        await conn.execute("LOCK TABLE auth.users IN EXCLUSIVE MODE")
        if await conn.fetchval("SELECT count(*) FROM auth.users") > 0:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Esta instalação já tem usuários. Peça acesso a um administrador.",
            )
        user_id = await conn.fetchval(
            """INSERT INTO auth.users (email, password_hash, last_sign_in_at)
               VALUES ($1, $2, now()) RETURNING id""",
            dados.email, senha_hash,
        )
        await conn.execute(
            "INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin')",
            user_id,
        )
    token, expira = emitir_token(str(user_id), "admin", dados.email)
    return TokenOut(token=token, expira_em=expira,
                    usuario=UsuarioOut(id=str(user_id), email=dados.email, papel="admin"))


@router.post("/login", response_model=TokenOut)
async def login(dados: LoginIn):
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            """SELECT u.id::text AS id, u.email, u.password_hash, u.is_active,
                      COALESCE(r.role::text, 'sem_papel') AS papel
                 FROM auth.users u
                 LEFT JOIN public.user_roles r ON r.user_id = u.id
                WHERE lower(u.email) = lower($1)""",
            dados.email,
        )
    # Mensagem única para e-mail inexistente e senha errada: não entregamos a
    # quem tenta a informação de quais e-mails existem.
    if linha is None or not conferir_senha(dados.senha, linha["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "E-mail ou senha incorretos.")
    if not linha["is_active"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Conta desativada.")

    async with sessao(role="service_role") as conn:
        await conn.execute("UPDATE auth.users SET last_sign_in_at = now() WHERE id = $1::uuid",
                           linha["id"])

    token, expira = emitir_token(linha["id"], linha["papel"], linha["email"])
    return TokenOut(token=token, expira_em=expira,
                    usuario=UsuarioOut(id=linha["id"], email=linha["email"],
                                       papel=linha["papel"]))


@router.get("/eu", response_model=UsuarioOut)
async def eu(usuario: Usuario = Depends(usuario_atual)):
    return UsuarioOut(id=usuario.id, email=usuario.email, papel=usuario.papel)
