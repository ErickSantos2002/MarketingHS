"""A tela do ritmo de envio: ler e editar os limites do `app/ritmo.py`.

Até 07/10/2026 os cinco limites (`ENVIO_POR_SEGUNDO`, `ENVIO_TETO_HORA`,
`ENVIO_TETO_DIA`, `ENVIO_AQUECIMENTO_DIA1`, `ENVIO_AQUECIMENTO_INICIO`) só se
mudavam por SQL em `integration_secrets` — foi assim que o Erick gravou 90/dia
e 90/h em produção (plano gratuito do Resend).

⚠️ A leitura repete a ordem do `ritmo.ler()` — banco, depois ambiente, depois
o padrão do código — e diz de ONDE veio cada valor. Valor gravado e inválido
aparece com o padrão que o worker de fato usa e o texto cru em `invalido`:
mostrar o texto como se valesse seria mentir sobre o que sai.

⚠️ A gravação é PARCIAL: só as chaves que vieram no corpo são tocadas. A tela
manda apenas o que o admin editou — salvar o ritmo por segundo não pode
reescrever os tetos de 90 com o que estava no formulário.

⚠️ `role="service_role"`: `integration_secrets` só tem GRANT para ele (008),
como em `app/integracoes.py` e na configuração do Resend. A autorização é o
`admin_atual` da rota, não o banco.

O worker lê pelo `integracoes.ler_segredo`, com cache de 60 s por processo: a
mudança vale no worker em até um minuto.
"""

import logging
import os
from datetime import date

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app import integracoes, ritmo
from app.config import settings
from app.database import sessao
from app.dependencies import Usuario, admin_atual

logger = logging.getLogger(__name__)

router = APIRouter(tags=["configuracao"])

ROTA = "/config/envio/ritmo"

# nome em integration_secrets -> campo do Ritmo (o mesmo mapa do worker)
CHAVES = dict(ritmo.CHAVES)
NOME_DO_CAMPO = {campo: nome for nome, campo in CHAVES.items()}


def _do_ambiente(nome: str) -> str | None:
    """O que o worker leria do ambiente: variável do processo, ou o `.env`
    que o `Settings` carregou. O padrão declarado em `Settings` NÃO conta
    como ambiente — ele é o mesmo padrão do código."""
    valor = os.environ.get(nome)
    if valor and valor.strip():
        return valor
    if nome in settings.model_fields_set:
        valor = str(getattr(settings, nome, "") or "")
        return valor if valor.strip() else None
    return None


async def ler_detalhado(conn) -> dict:
    gravados = {r["name"]: r["value"] for r in await conn.fetch(
        "SELECT name, value FROM integration_secrets WHERE name = ANY($1::text[])",
        list(CHAVES))}

    campos, crus = {}, {}
    for nome, campo in CHAVES.items():
        padrao = getattr(ritmo.PADRAO, campo)
        bruto, origem = gravados.get(nome), "banco"
        # ⚠️ Igual ao `ler_segredo`: só a string VAZIA cai para o ambiente.
        # Uma linha só de espaços é "verdadeira" lá, e o `montar` a ignora —
        # o worker fica no padrão, sem olhar o ambiente.
        if not bruto:
            bruto, origem = _do_ambiente(nome), "ambiente"
        valor, invalido = padrao, None
        if bruto is None or not str(bruto).strip():
            origem = "padrao"
        else:
            convertido = ritmo._converter(campo, bruto)
            if convertido is None:
                origem, invalido = "padrao", str(bruto)
            else:
                valor = convertido
                crus[nome] = bruto
        campos[campo] = {"chave": nome, "valor": valor, "origem": origem,
                         "padrao": padrao, "invalido": invalido}

    vigente = ritmo.montar(crus)
    uso = await ritmo.medir(conn)
    rampa = vigente.aquecimento_dia1 > 0
    return {
        "campos": campos,
        "hoje": uso.hoje,
        "primeiro_envio": uso.primeiro_dia,
        # O dia 1 da rampa: o gravado, senão o do primeiro envio real, senão
        # hoje — a mesma regra do `ritmo.teto_de_hoje`.
        "inicio_rampa": (vigente.aquecimento_inicio or uso.primeiro_dia or uso.hoje)
                        if rampa else None,
        "teto_hoje": ritmo.teto_de_hoje(vigente, uso.hoje, uso.primeiro_dia),
        "enviados_hoje": uso.enviados_dia,
        "enviados_ultima_hora": uso.enviados_hora,
    }


class RitmoIn(BaseModel):
    """Só o que veio é gravado. Os limites espelham o `ritmo._converter`:

    ⚠️ teto 0 é RECUSADO aqui — o worker trata teto 0 como inválido e cai no
    padrão (2.000/dia). Aceitar 0 seria o admin achar que parou o envio e o
    worker mandar 2.000. Parar uma campanha é o botão "Pausar envio".
    """
    model_config = ConfigDict(extra="forbid")

    por_segundo: float | None = Field(default=None, gt=0, le=100)
    teto_hora: int | None = Field(default=None, ge=1, le=1_000_000)
    teto_dia: int | None = Field(default=None, ge=1, le=10_000_000)
    aquecimento_dia1: int | None = Field(default=None, ge=0, le=10_000_000)
    # AAAA-MM-DD; `null` apaga (volta à regra do primeiro envio real).
    aquecimento_inicio: str | None = None

    @field_validator("por_segundo", "teto_hora", "teto_dia", "aquecimento_dia1",
                     mode="before")
    @classmethod
    def _numero_obrigatorio(cls, v):
        # `null` num número apagaria a linha e trocaria o 90 por 2.000 sem
        # ninguém digitar 2.000. Para voltar ao padrão, grava-se o padrão.
        if v is None:
            raise ValueError("informe um número")
        return v

    @field_validator("aquecimento_inicio")
    @classmethod
    def _data(cls, v):
        if v is None:
            return None
        texto = v.strip()
        try:
            if len(texto) != 10:
                raise ValueError
            date.fromisoformat(texto)
        except ValueError:
            raise ValueError("data no formato AAAA-MM-DD") from None
        return texto


def _texto(valor) -> str:
    if isinstance(valor, float) and valor.is_integer():
        return str(int(valor))
    return str(valor)


def mudancas(dados: RitmoIn) -> dict[str, str | None]:
    """{nome em integration_secrets: texto a gravar, ou None para apagar}."""
    return {NOME_DO_CAMPO[campo]: (None if valor is None else _texto(valor))
            for campo, valor in dados.model_dump(exclude_unset=True).items()}


async def gravar(conn, alteracoes: dict[str, str | None]) -> None:
    for nome, valor in alteracoes.items():
        if valor is None:
            await conn.execute(
                "DELETE FROM integration_secrets WHERE name = $1", nome)
        else:
            await conn.execute(
                """INSERT INTO integration_secrets (name, value, updated_at)
                   VALUES ($1, $2, now())
                   ON CONFLICT (name) DO UPDATE
                       SET value = EXCLUDED.value, updated_at = now()""",
                nome, valor)


@router.get(ROTA)
async def ler_ritmo(_: Usuario = Depends(admin_atual)):
    async with sessao(role="service_role") as conn:
        return await ler_detalhado(conn)


@router.put(ROTA)
async def gravar_ritmo(dados: RitmoIn, admin: Usuario = Depends(admin_atual)):
    alteracoes = mudancas(dados)
    async with sessao(role="service_role") as conn:
        if alteracoes:
            await gravar(conn, alteracoes)
        resposta = await ler_detalhado(conn)
    for nome in alteracoes:
        integracoes.esquecer(nome)
    if alteracoes:
        logger.info("ritmo de envio alterado por %s: %s", admin.email, alteracoes)
    return resposta
