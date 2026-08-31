"""Aqui mora a autorização da aplicação.

O RLS do banco é a segunda linha, não a primeira: as políticas dependem de
auth.uid(), que só é preenchido porque database.sessao() emite o SET LOCAL.
Endpoint que não depender de usuario_atual roda como anon.

Papéis: tabela public.user_roles, enum public.app_role. O valor de admin é
'admin' — não 'administrador', que é o do HS.OS.
"""

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth.security import ler_token
from app.database import sessao

# auto_error=False: sem header devolvemos a nossa mensagem, em português.
_bearer = HTTPBearer(auto_error=False)


class Usuario:
    def __init__(self, id: str, email: str, papel: str, nome: str | None = None):
        self.id = id
        self.email = email
        self.papel = papel
        self.nome = nome

    def __repr__(self) -> str:
        return f"Usuario({self.email}, papel={self.papel})"


async def usuario_atual(
    cred: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> Usuario:
    if cred is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Autenticação necessária.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        dados = ler_token(cred.credentials)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                            "Sessão expirada. Entre novamente.")
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token inválido.")

    user_id = dados.get("sub")
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                            "Token sem identificação de usuário.")

    # O papel é relido do banco a cada request, não confiado ao token: revogar
    # um administrador precisa valer na hora, sem esperar o token expirar.
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            """SELECT u.id::text AS id, u.email, u.is_active,
                      COALESCE(r.role::text, 'sem_papel') AS papel
                 FROM auth.users u
                 LEFT JOIN public.user_roles r ON r.user_id = u.id
                WHERE u.id = $1::uuid""",
            user_id,
        )
    if linha is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuário não encontrado.")
    if not linha["is_active"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Conta desativada.")

    return Usuario(id=linha["id"], email=linha["email"], papel=linha["papel"])


async def admin_atual(usuario: Usuario = Depends(usuario_atual)) -> Usuario:
    if usuario.papel != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Esta ação exige perfil de administrador.")
    return usuario
