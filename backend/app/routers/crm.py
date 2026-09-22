"""O botão "Enviar ao comercial" do contato — o modo `manual` do
handoff-to-nexus. Enfileira; quem entrega é o worker (decisão 3 do 8D)."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.crm.entrega import enfileirar
from app.database import sessao
from app.dependencies import Usuario, admin_atual, usuario_atual

router = APIRouter(prefix="/crm", tags=["crm"])


@router.get("/estado")
async def estado_do_crm(_: Usuario = Depends(usuario_atual)):
    """Se o GrowthHS está configurado — e só isso (revisão final do 8D, I6).

    As telas de Automações, o nó de jornada e o botão manual usam isto para
    não dizer "enviado" quando o pedido só vai esperar na fila. `usuario_atual`
    porque essas telas não são só de admin; por isso NADA da configuração
    (endereço, funil, chave) sai daqui."""
    from app.crm import growthhs

    return {"configurado": (await growthhs.ler_config()).configurado}


@router.post("/enviar/{lead_id}", status_code=status.HTTP_202_ACCEPTED)
async def enviar_ao_comercial(lead_id: UUID, _: Usuario = Depends(admin_atual)):
    """⚠️ `admin_atual`: a origem exigia chamador privilegiado para o modo
    manual. `service_role` porque a fila não tem política para `authenticated`
    — quem autoriza é a rota."""
    async with sessao(role="service_role") as conn:
        existe = await conn.fetchval(
            "SELECT 1 FROM leads WHERE id = $1::uuid AND deleted_at IS NULL", str(lead_id))
        if not existe:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Contato não encontrado.")
        pedido = await enfileirar(conn, str(lead_id), "manual")
    return {"handoff_id": pedido, "ja_na_fila": pedido is None}
