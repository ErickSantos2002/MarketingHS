"""Receptor de TESTE do contrato do GrowthHS (prova do RD, 21/10/2026).

O `POST /api/v1/integration/cards` ainda não existe no `hsgrowth-sistema`
(conferido em 21/10). Para a prova do handoff ir "até a porta", a fila
`crm_handoffs` real aponta (Configurações → GrowthHS, `growthhs_config.base_url`,
sem deploy) para este receptor, que implementa o contrato do lado de lá:
valida o corpo, responde como o GrowthHS responderia (201 criado, 200 já
existia — mesmo `id`, nada alterado) e guarda o pedido para conferência.
Depois da prova, continua servindo de teste do contrato do nosso lado.

⚠️ **Desligado por padrão** (`PROVA_RECEPTOR_TESTE`): com a chave falsa,
todas as rotas daqui respondem 404, como se não existissem. A chave é a
MESMA que o MarketingHS manda (`GROWTHHS_API_KEY`, de `integration_secrets`):
um pedido sem ela é 401, como o GrowthHS faria.

Contrato: `docs/contratos/2026-09-02-endpoint-card-comercial-growthhs.md`.

O `id` devolvido é um por `external_id` (o lead), estável na repetição. Na
prova (22/10) quatro leads ficaram com o mesmo `card_id`: eles tinham o mesmo
`dnia_id` (mesmo telefone = mesma pessoa), e a entrega (`crm/entrega.py`,
`_ja_entregue`) reaproveita o card da pessoa sem chamar o receptor — só um
pedido chegou aqui. É o desejado: um card por pessoa, não por e-mail.
"""

import hmac
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from fastapi.responses import JSONResponse

from app.config import settings
from app.database import sessao
from app.dependencies import Usuario, admin_atual
from app.integracoes import ler_segredo


def _ligado() -> None:
    if not settings.PROVA_RECEPTOR_TESTE:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not Found")


router = APIRouter(prefix="/teste/growthhs", tags=["receptor-growthhs"],
                   dependencies=[Depends(_ligado)])


def _erros_do_corpo(corpo) -> list[str]:
    """O que o contrato exige; a lista vazia é corpo válido."""
    if not isinstance(corpo, dict):
        return ["o corpo precisa ser um objeto JSON"]
    erros = []
    if corpo.get("source") != "marketinghs":
        erros.append('source precisa ser "marketinghs"')
    try:
        uuid.UUID(str(corpo.get("external_id")))
        if not isinstance(corpo.get("external_id"), str):
            raise ValueError
    except ValueError:
        erros.append("external_id precisa ser o uuid do lead")
    if not isinstance(corpo.get("board_id"), int) or isinstance(corpo.get("board_id"), bool):
        erros.append("board_id precisa ser inteiro")
    titulo = corpo.get("title")
    if not isinstance(titulo, str) or not titulo.strip():
        erros.append("title é obrigatório")
    contato = corpo.get("contact")
    if not isinstance(contato, dict) or not (contato.get("email") or contato.get("phone")):
        erros.append("contact.email ou contact.phone é obrigatório")
    return erros


def _resposta(linha, criado: bool) -> dict:
    corpo = linha["corpo"]
    return {"id": linha["id"], "list_id": None, "title": corpo.get("title"),
            "external_source": "marketinghs", "external_id": linha["external_id"],
            "client_id": None, "person_id": None, "created": criado}


@router.get("/health")
async def saude():
    return {"ok": True}


@router.post("/api/v1/integration/cards")
async def criar_card(request: Request, x_api_key: str | None = Header(default=None)):
    chave = await ler_segredo("GROWTHHS_API_KEY")
    if not chave or not x_api_key or not hmac.compare_digest(x_api_key, chave):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Chave ausente ou inválida.")
    try:
        corpo = await request.json()
    except ValueError:
        corpo = None
    erros = _erros_do_corpo(corpo)
    if erros:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, erros)

    async with sessao(role="service_role") as conn:
        # `xmax = 0` na linha devolvida = acabou de ser inserida. Na
        # repetição, só `vezes` e `atualizado_em` mudam: o corpo da primeira
        # vez fica intacto, como o card que o vendedor já mexeu.
        linha = await conn.fetchrow(
            """INSERT INTO growthhs_receptor_pedidos (external_id, corpo)
               VALUES ($1, $2::jsonb)
               ON CONFLICT (external_id) DO UPDATE
                  SET vezes = growthhs_receptor_pedidos.vezes + 1, atualizado_em = now()
            RETURNING id, external_id, corpo, (xmax = 0) AS criado""",
            corpo["external_id"], corpo)
    criado = bool(linha["criado"])
    return JSONResponse(_resposta(linha, criado),
                        status_code=status.HTTP_201_CREATED if criado else status.HTTP_200_OK)


@router.get("/pedidos")
async def pedidos(usuario: Usuario = Depends(admin_atual)):
    """Os últimos 50 pedidos recebidos, para conferir o roteiro da prova.

    ⚠️ `service_role`: a tabela tem RLS ligado e NENHUMA política (migration
    027) — sob `authenticated` o admin veria zero linhas. Quem autoriza é o
    `admin_atual`."""
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            """SELECT id, external_id, corpo, vezes, recebido_em::text,
                      atualizado_em::text
                 FROM growthhs_receptor_pedidos
                ORDER BY atualizado_em DESC LIMIT 50""")
    return [dict(l) for l in linhas]
