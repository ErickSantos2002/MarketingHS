from pydantic import BaseModel, EmailStr, Field


class LoginIn(BaseModel):
    email: EmailStr
    # 72 bytes é o teto do bcrypt (ver LIMITE_SENHA_BYTES).
    senha: str = Field(min_length=8, max_length=72)


class BootstrapIn(BaseModel):
    email: EmailStr
    senha: str = Field(min_length=8, max_length=72)


class UsuarioOut(BaseModel):
    id: str
    email: str
    papel: str


class TokenOut(BaseModel):
    token: str
    expira_em: int
    usuario: UsuarioOut


class StatusInstalacaoOut(BaseModel):
    precisa_bootstrap: bool
    total_usuarios: int
