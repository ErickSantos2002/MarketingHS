"""Administração das chaves de API. Toda rota exige admin: quem cria chave cria
acesso à base inteira de contatos."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.chave_api import gerar_chave
from app.database import sessao
from app.dependencies import Usuario, admin_atual

router = APIRouter(prefix="/chaves", tags=["chaves"])


class ChaveIn(BaseModel):
    nome: str = Field(min_length=1, max_length=100)
    descricao: str | None = None
    permissoes: str = Field(default="read", pattern="^(read|write|read_write)$")
    expira_em: datetime | None = None


class ChaveOut(BaseModel):
    id: str
    name: str
    description: str | None
    key_prefix: str
    permissions: str
    expires_at: str | None
    last_used_at: str | None
    is_active: bool
    created_at: str


class ChaveCriadaOut(ChaveOut):
    # ⚠️ Só existe na resposta da criação. Nunca é lida de volta do banco,
    # porque o banco guarda apenas o hash.
    chave: str


class AtivacaoIn(BaseModel):
    ativa: bool


_COLUNAS = """id::text, name, description, key_prefix, permissions,
              expires_at::text, last_used_at::text, is_active, created_at::text"""


@router.get("", response_model=list[ChaveOut])
async def listar(_: Usuario = Depends(admin_atual)):
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            f"SELECT {_COLUNAS} FROM api_keys ORDER BY created_at DESC")
    return [ChaveOut(**dict(l)) for l in linhas]


@router.post("", response_model=ChaveCriadaOut, status_code=status.HTTP_201_CREATED)
async def criar_chave(dados: ChaveIn, _: Usuario = Depends(admin_atual)):
    """Cria uma chave. A chave crua volta AQUI e nunca mais.

    ⚠️ Quem gera é o servidor. A tela original gerava no navegador com
    Math.random() e mandava só o hash — o servidor nunca via a chave e portanto
    não podia garantir nada sobre ela. Ninguém garante a qualidade de um
    segredo que não gerou.
    """
    crua, digest, prefixo = gerar_chave()
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            f"""INSERT INTO api_keys (name, description, key_hash, key_prefix,
                                      permissions, expires_at)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING {_COLUNAS}""",
            dados.nome.strip(), dados.descricao, digest, prefixo,
            dados.permissoes, dados.expira_em)
    return ChaveCriadaOut(**dict(linha), chave=crua)


@router.patch("/{chave_id}", response_model=ChaveOut)
async def ativar_ou_desativar(chave_id: str, dados: AtivacaoIn,
                              _: Usuario = Depends(admin_atual)):
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            f"UPDATE api_keys SET is_active = $2 WHERE id = $1::uuid RETURNING {_COLUNAS}",
            chave_id, dados.ativa)
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Chave não encontrada.")
    return ChaveOut(**dict(linha))


@router.delete("/{chave_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remover(chave_id: str, _: Usuario = Depends(admin_atual)):
    """Remove a chave de vez.

    Desativar (PATCH) é quase sempre melhor: preserva o histórico de uso. Mas a
    tela de origem oferecia a exclusão, e tirá-la seria decidir por quem usa.
    """
    r = await _remover(chave_id)
    if r.endswith(" 0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Chave não encontrada.")


async def _remover(chave_id: str) -> str:
    async with sessao(role="service_role") as conn:
        return await conn.execute("DELETE FROM api_keys WHERE id = $1::uuid", chave_id)
