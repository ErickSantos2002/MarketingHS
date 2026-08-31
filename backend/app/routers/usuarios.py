"""Substitui as 6 edge functions de administração de usuário.

Toda rota exige admin. As duas regras que valem a pena não perder:
  - ninguém remove nem rebaixa a si mesmo (evita instalação sem administrador)
  - o último admin não pode ser removido nem rebaixado
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field

from app.auth.security import gerar_hash
from app.database import sessao
from app.dependencies import Usuario, admin_atual

router = APIRouter(prefix="/usuarios", tags=["usuarios"])


class UsuarioLinha(BaseModel):
    id: str
    email: str
    papel: str
    is_active: bool
    created_at: str
    last_sign_in_at: str | None


class CriarUsuarioIn(BaseModel):
    email: EmailStr
    senha: str = Field(min_length=8, max_length=72)
    papel: str = Field(pattern="^(admin|user)$")


class TrocarEmailIn(BaseModel):
    email: EmailStr


class TrocarPapelIn(BaseModel):
    papel: str = Field(pattern="^(admin|user)$")


class TrocarSenhaIn(BaseModel):
    senha: str = Field(min_length=8, max_length=72)


async def _total_admins(conn) -> int:
    return await conn.fetchval(
        "SELECT count(*) FROM public.user_roles WHERE role = 'admin'"
    )


@router.get("", response_model=list[UsuarioLinha])
async def listar(_: Usuario = Depends(admin_atual)):
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            """SELECT u.id::text AS id, u.email, u.is_active,
                      u.created_at::text, u.last_sign_in_at::text,
                      COALESCE(r.role::text, 'sem_papel') AS papel
                 FROM auth.users u
                 LEFT JOIN public.user_roles r ON r.user_id = u.id
                ORDER BY u.created_at"""
        )
    return [UsuarioLinha(**dict(l)) for l in linhas]


@router.post("", response_model=UsuarioLinha, status_code=status.HTTP_201_CREATED)
async def criar(dados: CriarUsuarioIn, _: Usuario = Depends(admin_atual)):
    async with sessao(role="service_role") as conn:
        if await conn.fetchval("SELECT 1 FROM auth.users WHERE lower(email)=lower($1)",
                               dados.email):
            raise HTTPException(status.HTTP_409_CONFLICT, "Já existe conta com esse e-mail.")
        user_id = await conn.fetchval(
            "INSERT INTO auth.users (email, password_hash) VALUES ($1, $2) RETURNING id",
            dados.email, gerar_hash(dados.senha),
        )
        await conn.execute(
            "INSERT INTO public.user_roles (user_id, role) VALUES ($1, $2::public.app_role)",
            user_id, dados.papel,
        )
        linha = await conn.fetchrow(
            """SELECT u.id::text AS id, u.email, u.is_active, u.created_at::text,
                      u.last_sign_in_at::text, r.role::text AS papel
                 FROM auth.users u JOIN public.user_roles r ON r.user_id = u.id
                WHERE u.id = $1""", user_id)
    return UsuarioLinha(**dict(linha))


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remover(user_id: str, admin: Usuario = Depends(admin_atual)):
    if user_id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Você não pode remover a própria conta.")
    async with sessao(role="service_role") as conn:
        papel = await conn.fetchval(
            "SELECT role::text FROM public.user_roles WHERE user_id = $1::uuid", user_id)
        if papel == "admin" and await _total_admins(conn) <= 1:
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "Não é possível remover o último administrador.")
        removidos = await conn.execute("DELETE FROM auth.users WHERE id = $1::uuid", user_id)
    if removidos.endswith(" 0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuário não encontrado.")


@router.patch("/{user_id}/email", response_model=UsuarioLinha)
async def trocar_email(user_id: str, dados: TrocarEmailIn,
                       _: Usuario = Depends(admin_atual)):
    async with sessao(role="service_role") as conn:
        if await conn.fetchval(
            "SELECT 1 FROM auth.users WHERE lower(email)=lower($1) AND id <> $2::uuid",
            dados.email, user_id,
        ):
            raise HTTPException(status.HTTP_409_CONFLICT, "Já existe conta com esse e-mail.")
        linha = await conn.fetchrow(
            """UPDATE auth.users SET email = $2 WHERE id = $1::uuid
               RETURNING id::text AS id, email, is_active, created_at::text,
                         last_sign_in_at::text""", user_id, dados.email)
        if linha is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuário não encontrado.")
        papel = await conn.fetchval(
            "SELECT COALESCE(role::text,'sem_papel') FROM public.user_roles WHERE user_id=$1::uuid",
            user_id) or "sem_papel"
    return UsuarioLinha(**dict(linha), papel=papel)


@router.patch("/{user_id}/papel", response_model=UsuarioLinha)
async def trocar_papel(user_id: str, dados: TrocarPapelIn,
                       admin: Usuario = Depends(admin_atual)):
    if user_id == admin.id and dados.papel != "admin":
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Você não pode rebaixar a própria conta.")
    async with sessao(role="service_role") as conn:
        atual = await conn.fetchval(
            "SELECT role::text FROM public.user_roles WHERE user_id = $1::uuid", user_id)
        if atual == "admin" and dados.papel != "admin" and await _total_admins(conn) <= 1:
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "Não é possível rebaixar o último administrador.")
        # O upsert depende do índice único em user_roles(user_id), criado pela
        # migration 003 — o schema de origem permitia vários papéis por usuário.
        await conn.execute(
            """INSERT INTO public.user_roles (user_id, role)
               VALUES ($1::uuid, $2::public.app_role)
               ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role""",
            user_id, dados.papel)
        linha = await conn.fetchrow(
            """SELECT u.id::text AS id, u.email, u.is_active, u.created_at::text,
                      u.last_sign_in_at::text, r.role::text AS papel
                 FROM auth.users u JOIN public.user_roles r ON r.user_id = u.id
                WHERE u.id = $1::uuid""", user_id)
        if linha is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuário não encontrado.")
    return UsuarioLinha(**dict(linha))


@router.post("/{user_id}/senha", status_code=status.HTTP_204_NO_CONTENT)
async def trocar_senha(user_id: str, dados: TrocarSenhaIn,
                       _: Usuario = Depends(admin_atual)):
    """Reset feito por administrador. Não há autosserviço por e-mail."""
    async with sessao(role="service_role") as conn:
        r = await conn.execute(
            "UPDATE auth.users SET password_hash = $2 WHERE id = $1::uuid",
            user_id, gerar_hash(dados.senha))
    if r.endswith(" 0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuário não encontrado.")
