"""Aqui mora a autorização da aplicação.

O RLS do banco é a segunda linha, não a primeira: as políticas dependem de
auth.uid(), que só é preenchido porque database.sessao() emite o SET LOCAL.
Endpoint que não depender de usuario_atual roda como anon.

Papéis: tabela public.user_roles, enum public.app_role. O valor de admin é
'admin' — não 'administrador', que é o do HS.OS.
"""

import jwt
from fastapi import Depends, HTTPException, Request, status
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


# Papel `leitura` (034): vê as telas do admin, não altera nada.
PAPEL_LEITURA = "leitura"
METODOS_DE_LEITURA = frozenset({"GET", "HEAD", "OPTIONS"})

# As ÚNICAS rotas que aceitam método de escrita vindo de `leitura`, pelo
# MODELO do caminho (o da rota, não o da URL). Cada uma precisa ser leitura
# pura — ver docs/frentes/papel-leitura.md antes de crescer esta lista.
#   - enriquecimento: só lê; é POST porque a lista de ids não cabe na URL, e
#     sem ela a tabela de Contatos perde as colunas de ecossistema;
#   - tags-por-contato: idem, a coluna de tags da tabela e as tags da ficha.
#     Sem ela o hook engole o 403 e as tags aparecem VAZIAS, sem aviso.
# Login e bootstrap não passam por `usuario_atual` e não precisam estar aqui;
# não há logout nem refresh no servidor, nem troca da própria senha.
ESCRITAS_PERMITIDAS_A_LEITURA = frozenset({
    ("POST", "/contatos/enriquecimento"),
    ("POST", "/contatos/tags-por-contato"),
})


def _trava_de_leitura(request: Request | None, usuario: "Usuario") -> None:
    """A garantia do papel `leitura` mora AQUI, e não rota por rota: toda rota
    autenticada passa por `usuario_atual` (direto ou via `admin_atual`), então
    rota nova já nasce protegida. `tests/test_papel_leitura.py` varre as rotas
    e prova."""
    if usuario.papel != PAPEL_LEITURA:
        return
    if request is None:
        # Chamada à mão, sem a requisição: não dá para saber o método — falha
        # FECHADA. (Hoje só `admin_ou_maquina` chama assim, e exige admin.)
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Acesso somente leitura: esta conta não altera dados.")
    if request.method in METODOS_DE_LEITURA:
        return
    rota = request.scope.get("route")
    modelo = getattr(rota, "path", None) or request.url.path
    if (request.method, modelo) in ESCRITAS_PERMITIDAS_A_LEITURA:
        return
    raise HTTPException(status.HTTP_403_FORBIDDEN,
                        "Acesso somente leitura: esta conta não altera dados.")


async def usuario_atual(
    cred: HTTPAuthorizationCredentials | None = Depends(_bearer),
    request: Request = None,  # type: ignore[assignment] — o FastAPI injeta
) -> Usuario:
    """⚠️ `request` vem DEPOIS e com padrão `None` porque `chave_api.
    admin_ou_maquina` chama esta função à mão, só com a credencial — e lá o
    papel exigido é admin, então a trava de leitura não faz falta."""
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

    usuario = Usuario(id=linha["id"], email=linha["email"], papel=linha["papel"])
    _trava_de_leitura(request, usuario)
    return usuario


async def admin_atual(usuario: Usuario = Depends(usuario_atual)) -> Usuario:
    if usuario.papel != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Esta ação exige perfil de administrador.")
    return usuario


async def admin_ou_leitura(usuario: Usuario = Depends(usuario_atual)) -> Usuario:
    """Só nas rotas de LEITURA das telas do admin (inventário em
    `tests/test_papel_leitura.py`). Configuração, integração, segredo, usuário,
    chave de API e qualquer saída de dado em massa continuam `admin_atual`.

    ⚠️ O leitor vê o que o admin vê porque a sessão `authenticated` dele é
    READ ONLY e o `has_role` da 034 o aceita nela. Rota que abra
    `sessao(role="authenticated", user_id=usuario.id)` funciona sem mais nada.
    """
    if usuario.papel not in ("admin", PAPEL_LEITURA):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Esta tela exige perfil de administrador ou de leitura.")
    return usuario
