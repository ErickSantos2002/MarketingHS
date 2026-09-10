"""Autenticação por chave de API — o segundo modelo, para chamador máquina.

Não confundir com `app/dependencies.py`, que autentica USUÁRIO por JWT. Aqui é
sistema externo falando com o nosso: sem sessão, sem papel, com escopo próprio.
"""

import hashlib
import hmac
import logging
import secrets
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings
from app.database import sessao

logger = logging.getLogger(__name__)

# `mhs_` e não `dnk_`: o prefixo identifica o sistema a quem lê a chave num log
# ou num painel de terceiro, e o `dnk_` é da dn.ia.
PREFIXO = "mhs_"

_bearer = HTTPBearer(auto_error=False)


def hash_da_chave(crua: str) -> str:
    return hashlib.sha256(crua.encode("utf-8")).hexdigest()


def gerar_chave() -> tuple[str, str, str]:
    """Devolve (chave_crua, hash, prefixo_visivel).

    ⚠️ `secrets`, nunca `random`. A tela original gerava a chave no navegador
    com Math.random() — xorshift128+, cujo estado se recupera a partir de
    algumas saídas. Quem recebesse duas ou três chaves preveria as seguintes, e
    uma chave dá acesso de leitura ou escrita à base inteira de contatos.

    A chave crua existe UMA vez, aqui. O banco guarda só o hash; o prefixo
    serve para a pessoa reconhecer qual chave é qual na tela.
    """
    crua = PREFIXO + secrets.token_urlsafe(32)
    return crua, hash_da_chave(crua), crua[:12]


class ChaveApi:
    def __init__(self, id: str, nome: str, permissoes: str):
        self.id = id
        self.nome = nome
        self.permissoes = permissoes

    def __repr__(self) -> str:
        return f"ChaveApi({self.nome}, {self.permissoes})"


def chave_api(permissao: str):
    """Fábrica de dependência: `Depends(chave_api('write'))`.

    Aceita duas credenciais no mesmo header, como a origem:
      - o WEBHOOK_SECRET, segredo global sem escopo nem expiração
      - uma chave da tabela api_keys, buscada pelo SHA-256 do token
    """
    if permissao not in ("read", "write"):
        raise ValueError(f"permissão inválida: {permissao!r}")

    async def dependencia(
        cred: HTTPAuthorizationCredentials | None = Depends(_bearer),
    ) -> ChaveApi:
        if cred is None:
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED, "Chave de API necessária.",
                headers={"WWW-Authenticate": "Bearer"})

        token = cred.credentials

        # O segredo global. compare_digest e não `==`: comparação de string em
        # Python sai no primeiro byte diferente, e isso é medível.
        if settings.WEBHOOK_SECRET and hmac.compare_digest(token, settings.WEBHOOK_SECRET):
            return ChaveApi(id="webhook", nome="webhook", permissoes="read_write")

        digest = hash_da_chave(token)
        async with sessao(role="service_role") as conn:
            linha = await conn.fetchrow(
                """SELECT id::text, name, permissions, expires_at, is_active
                     FROM api_keys WHERE key_hash = $1""", digest)

        if linha is None or not linha["is_active"]:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Chave inválida.")

        if linha["expires_at"] is not None and linha["expires_at"] < datetime.now(timezone.utc):
            # A origem desativava a chave ao encontrá-la vencida. Mantido: uma
            # chave vencida não volta a valer, e desativar evita reconsultar a
            # data em toda requisição futura.
            async with sessao(role="service_role") as conn:
                await conn.execute(
                    "UPDATE api_keys SET is_active = false WHERE id = $1::uuid", linha["id"])
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Chave expirada.")

        permissoes = linha["permissions"]
        if permissoes != "read_write" and permissoes != permissao:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Esta chave tem permissão de {permissoes!r} e a operação exige {permissao!r}.")

        # ⚠️ Com await. A origem gravava sem esperar, e numa Edge Function isso
        # pode simplesmente não acontecer — o processo termina antes. Em Python
        # uma corrotina não aguardada vira aviso e nunca roda.
        async with sessao(role="service_role") as conn:
            await conn.execute(
                "UPDATE api_keys SET last_used_at = now() WHERE id = $1::uuid", linha["id"])

        return ChaveApi(id=linha["id"], nome=linha["name"], permissoes=permissoes)

    return dependencia


def admin_ou_maquina(permissao: str):
    """Fábrica de dependência para a configuração de integração.

    A origem (`resend-config`, `resend-config-check`) aceitava o navegador do
    admin E o chamador máquina — mas não do mesmo jeito:

      - leitura: JWT de admin, `WEBHOOK_SECRET` ou chave de API de leitura
      - escrita: JWT de admin ou `WEBHOOK_SECRET` — NUNCA chave da tabela
        `api_keys`, mesmo com permissão de escrita

    ⚠️ A assimetria é o ponto. Uma chave de `api_keys` que vazasse poderia
    trocar a RESEND_API_KEY por uma de outra conta: toda campanha passaria a
    sair — e ser lida — pela conta de terceiro. Não "simplifique" para
    `chave_api("write")`.

    Devolve quem autorizou: "admin", "webhook" ou "chave".
    """
    if permissao not in ("read", "write"):
        raise ValueError(f"permissão inválida: {permissao!r}")

    async def dependencia(
        cred: HTTPAuthorizationCredentials | None = Depends(_bearer),
    ) -> str:
        if cred is None:
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED, "Credencial necessária.",
                headers={"WWW-Authenticate": "Bearer"})
        token = cred.credentials

        if settings.WEBHOOK_SECRET and hmac.compare_digest(token, settings.WEBHOOK_SECRET):
            return "webhook"

        # Parece JWT? Então é o navegador — e tem de ser admin.
        from app.auth.security import ler_token
        from app.dependencies import usuario_atual
        import jwt

        try:
            ler_token(token)
            eh_jwt = True
        except jwt.PyJWTError:
            eh_jwt = False
        if eh_jwt:
            usuario = await usuario_atual(cred)
            if usuario.papel != "admin":
                raise HTTPException(status.HTTP_403_FORBIDDEN,
                                    "Esta ação exige perfil de administrador.")
            return "admin"

        if permissao == "write":
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED,
                "Esta operação aceita só o login de administrador ou o WEBHOOK_SECRET.")
        await chave_api("read")(cred)
        return "chave"

    return dependencia
