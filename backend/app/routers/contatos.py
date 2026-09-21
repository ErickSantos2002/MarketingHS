"""Rotas de contato. Substitui import-leads-csv, recalculate-all-scores e
apply-lead-tag."""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, admin_atual
from app.dominio.importacao import (
    MODOS, LinhaCsv, campos_para_gravar, campos_preenchidos_no_csv,
    combinar_duplicadas, normalizar_status,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/contatos", tags=["contatos"])

# Quantos e-mails por SELECT ... WHERE email = ANY($1). O original usava 500 e
# não há razão para mudar.
LOTE_CONSULTA = 500


class LinhaImportacao(BaseModel):
    # ⚠️ Opcional de propósito. CSV exportado de outra ferramenta pode não ter a
    # coluna de e-mail, e um campo obrigatório derrubaria o LOTE INTEIRO com 422
    # em vez de contar as linhas sem e-mail e importar o resto — que é o que a
    # tela mostra e o que o original fazia.
    email: str | None = None
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
    # Quantos campos foram de fato preenchidos e quantos o CSV trazia mas não
    # entraram por já haver valor. É o que a tela mostra para quem importa
    # entender o efeito do modo "enriquecer".
    campos_enriquecidos: int
    campos_pulados: int
    # A tela aplica tags logo depois de importar, e as rotas de tag são
    # chaveadas por id. Sem isto ela teria de buscar cada contato de novo.
    contatos: list[ContatoImportado]


@router.post("/importar", response_model=ImportacaoOut)
async def importar(dados: ImportacaoIn, _: Usuario = Depends(admin_atual)):
    if dados.modo not in MODOS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Modo de importação inválido.")

    criados = atualizados = inalterados = sem_email = 0
    campos_enriquecidos = campos_pulados = 0
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
                             sem_email=sem_email, erros=[], contatos=[],
                             campos_enriquecidos=0, campos_pulados=0)

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
                campos_enriquecidos += len(campos)
                campos_pulados += campos_preenchidos_no_csv(linha) - len(campos)
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
                         erros=erros, contatos=contatos,
                         campos_enriquecidos=campos_enriquecidos,
                         campos_pulados=campos_pulados)


class RecalculoOut(BaseModel):
    atualizados: int


@router.post("/recalcular-scores", response_model=RecalculoOut)
async def recalcular_scores(_: Usuario = Depends(admin_atual)):
    """Reaplica a régua a toda a base.

    O original percorria os leads em Deno e recalculava em TypeScript. Aqui não
    há laço: o score é um trigger BEFORE UPDATE, então basta um UPDATE que toque
    uma coluna vigiada. Uma fonte de verdade a menos para divergir.

    ⚠️ Desde a migration 019, `trg_automation_on_etiqueta_change` não tem mais
    lista de colunas (`AFTER INSERT OR UPDATE`, sem `OF ...`) — ele reavalia em
    TODO UPDATE de `leads`, inclusive este. Se uma etiqueta/status/score mudar
    como efeito colateral do recálculo (`UPDATE leads SET cargo = cargo`
    dispara `trg_score_lead_on_change`, que pode reescrever `etiqueta` e
    `lead_score`), e houver regra de automação ATIVA casando com o resultado,
    esta rota pode enfileirar MUITOS leads para o comercial de uma vez — um
    recálculo em massa virando um envio em massa ao GrowthHS. Não é bug: é
    consequência de remover a lista de colunas do gatilho (correção de um
    achado maior — ver migration 019). Decisão de produto pendente com o
    Erick; nada foi alterado aqui para evitar isso.
    """
    async with sessao(role="service_role") as conn:
        # ⚠️ Tem de tocar uma das colunas da lista do trigger:
        #   BEFORE INSERT OR UPDATE OF cargo, faturamento, funcionarios,
        #                              desafios, whatsapp, utm_source, source
        # Um UPDATE em qualquer outra coluna NÃO dispara o scoring, e a rota
        # responderia "atualizados: N" sem ter recalculado nada — o pior tipo
        # de erro, o que se reporta como sucesso.
        resultado = await conn.execute("UPDATE leads SET cargo = cargo")
    return RecalculoOut(atualizados=int(resultado.rsplit(" ", 1)[-1]))


class EtiquetaIn(BaseModel):
    tag: str = Field(min_length=1, max_length=100)


@router.post("/{lead_id}/tags", status_code=status.HTTP_204_NO_CONTENT)
async def aplicar_tag(lead_id: str, dados: EtiquetaIn,
                      _: Usuario = Depends(admin_atual)):
    """Cria a tag se ainda não existir e associa ao contato.

    Idempotente: aplicar a mesma tag duas vezes não é erro, é ausência de
    mudança. A importação aplica tags em lote e reprocessar um arquivo é
    normal — falhar aí seria hostil sem motivo. Quem garante isso é a chave
    primária (lead_id, tag_id) de lead_tags; não relaxe.
    """
    nome = dados.tag.strip()
    if not nome:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Tag vazia.")

    async with sessao(role="service_role") as conn:
        existe = await conn.fetchval("SELECT 1 FROM leads WHERE id = $1::uuid", lead_id)
        if not existe:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Contato não encontrado.")

        # Casa sem diferenciar maiúscula, para "Importado" e "importado" não
        # virarem duas tags.
        tag_id = await conn.fetchval(
            "SELECT id FROM tags WHERE lower(name) = lower($1)", nome)
        if tag_id is None:
            # ⚠️ Upsert, não INSERT. A tela aplica tags em PARALELO depois de
            # importar: várias requisições fazem o SELECT acima ao mesmo tempo,
            # todas erram, e todas tentam inserir a mesma tag — o índice único
            # tags_name_key derruba as perdedoras com 500. Aconteceu na primeira
            # importação feita pela tela.
            #
            # DO UPDATE e não DO NOTHING: só o UPDATE faz o RETURNING devolver a
            # linha também no caso de conflito.
            tag_id = await conn.fetchval(
                """INSERT INTO tags (name) VALUES ($1)
                   ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
                   RETURNING id""",
                nome)

        await conn.execute(
            """INSERT INTO lead_tags (lead_id, tag_id) VALUES ($1::uuid, $2)
               ON CONFLICT DO NOTHING""",
            lead_id, tag_id)


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
