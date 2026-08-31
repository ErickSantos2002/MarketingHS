"""Rotas de contato. Substitui import-leads-csv, recalculate-all-scores e
apply-lead-tag."""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, admin_atual
from app.dominio.importacao import (
    MODOS, LinhaCsv, campos_para_gravar, combinar_duplicadas, normalizar_status,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/contatos", tags=["contatos"])

# Quantos e-mails por SELECT ... WHERE email = ANY($1). O original usava 500 e
# não há razão para mudar.
LOTE_CONSULTA = 500


class LinhaImportacao(BaseModel):
    email: str
    nome: str | None = None
    whatsapp: str | None = None
    telefone_completo: str | None = None
    empresa: str | None = None
    cargo: str | None = None
    faturamento: str | None = None
    funcionarios: str | None = None
    desafios_ia: str | None = None
    source: str | None = None
    status: str | None = None
    tipo: str | None = None


class ImportacaoIn(BaseModel):
    linhas: list[LinhaImportacao] = Field(min_length=1, max_length=20000)
    modo: str = Field(default="enriquecer", pattern="^(enriquecer|sobrescrever)$")


class ContatoImportado(BaseModel):
    email: str
    id: str


class ImportacaoOut(BaseModel):
    criados: int
    atualizados: int
    inalterados: int
    sem_email: int
    erros: list[str]
    # A tela aplica tags logo depois de importar, e as rotas de tag são
    # chaveadas por id. Sem isto ela teria de buscar cada contato de novo.
    contatos: list[ContatoImportado]


@router.post("/importar", response_model=ImportacaoOut)
async def importar(dados: ImportacaoIn, _: Usuario = Depends(admin_atual)):
    if dados.modo not in MODOS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Modo de importação inválido.")

    criados = atualizados = inalterados = sem_email = 0
    erros: list[str] = []
    contatos: list[ContatoImportado] = []

    # E-mail é a chave de deduplicação, sempre em minúsculas. Linha sem e-mail
    # não tem como ser deduplicada e é contada à parte em vez de virar um
    # contato órfão.
    por_email: dict[str, LinhaCsv] = {}
    for linha in dados.linhas:
        email = (linha.email or "").strip().lower()
        if not email:
            sem_email += 1
            continue
        nova = LinhaCsv(**{**linha.model_dump(), "email": email})
        anterior = por_email.get(email)
        # O mesmo e-mail duas vezes no arquivo não é erro; é planilha real.
        # Fundir em vez de deixar a última vencer — ver combinar_duplicadas.
        por_email[email] = combinar_duplicadas(anterior, nova) if anterior else nova

    if not por_email:
        return ImportacaoOut(criados=0, atualizados=0, inalterados=0,
                             sem_email=sem_email, erros=[], contatos=[])

    emails = list(por_email)

    async with sessao(role="service_role") as conn:
        existentes: dict[str, dict] = {}
        for i in range(0, len(emails), LOTE_CONSULTA):
            fatia = emails[i:i + LOTE_CONSULTA]
            linhas = await conn.fetch(
                """SELECT id::text, lower(email) AS email, nome, whatsapp, empresa,
                          cargo, faturamento, funcionarios, desafios, source, status
                     FROM leads WHERE lower(email) = ANY($1::text[])""",
                fatia,
            )
            for l in linhas:
                existentes[l["email"]] = dict(l)

        for email, linha in por_email.items():
            existente = existentes.get(email)
            try:
                if existente is None:
                    novo_id = await conn.fetchval(
                        """INSERT INTO leads (email, tipo, status, source, nome, whatsapp,
                                              empresa, cargo, faturamento, funcionarios, desafios)
                           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                           RETURNING id""",
                        email,
                        linha.tipo or "csv_import",
                        normalizar_status(linha.status) or "Lead",
                        linha.source or "csv_import",
                        linha.nome, linha.whatsapp or linha.telefone_completo,
                        linha.empresa, linha.cargo, linha.faturamento,
                        linha.funcionarios, linha.desafios_ia,
                    )
                    criados += 1
                    contatos.append(ContatoImportado(email=email, id=str(novo_id)))
                    await _resolver_identidade(conn, novo_id, linha, email)
                    continue

                contatos.append(ContatoImportado(email=email, id=existente["id"]))
                campos = campos_para_gravar(linha, existente, dados.modo)
                if not campos:
                    inalterados += 1
                    continue

                # asyncpg não aceita nome de coluna parametrizado. As chaves vêm
                # de _CAMPOS em app/dominio/importacao.py — lista fechada no
                # código, nunca do corpo da requisição.
                atribuicoes = ", ".join(f"{c} = ${i + 2}" for i, c in enumerate(campos))
                await conn.execute(
                    f"UPDATE leads SET {atribuicoes} WHERE id = $1::uuid",
                    existente["id"], *campos.values(),
                )
                atualizados += 1
            except Exception as exc:  # noqa: BLE001 — uma linha ruim não derruba o lote
                logger.warning("Falha ao importar %s: %s", email, exc)
                erros.append(f"{email}: {exc}")

    return ImportacaoOut(criados=criados, atualizados=atualizados,
                         inalterados=inalterados, sem_email=sem_email,
                         erros=erros, contatos=contatos)


async def _resolver_identidade(conn, lead_id, linha: LinhaCsv, email: str) -> None:
    """Amarra o contato novo à identidade do ecossistema.

    `resolve_or_create_identity` é PL/pgSQL, sobreviveu à portagem do schema e
    devolve `jsonb` — o codec que app/database.py registra decodifica isso para
    um dict. Não reimplemente em Python.

    Falha aqui não desfaz a importação: o contato existe e a identidade pode ser
    reconciliada depois.
    """
    try:
        resultado = await conn.fetchval(
            """SELECT resolve_or_create_identity(
                   p_phone => $1, p_email => $2, p_nome => $3,
                   p_source_app => 'marketinghs', p_local_id => $4,
                   p_utm_source => $5, p_stage => 'lead')""",
            linha.whatsapp or linha.telefone_completo, email, linha.nome,
            lead_id, linha.source,
        )
        if resultado and resultado.get("dnia_id"):
            await conn.execute(
                "UPDATE leads SET dnia_id = $2, phone_normalized = $3 WHERE id = $1",
                lead_id, resultado["dnia_id"], resultado.get("phone_normalized"),
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Identidade não resolvida para %s: %s", email, exc)
