"""Controle de volume do envio (R1 do raio-x, 02/10/2026).

Domínio novo disparando para a base inteira no dia 1 é o pior cenário de
reputação: o provedor de caixa postal não conhece o remetente e lê volume alto
como spam. O worker passa a respeitar quatro limites:

- **envios por segundo** — padrão 2/s, o limite de taxa do Resend;
- **teto por hora** — janela móvel de 60 minutos;
- **teto por dia** — dia civil de Brasília;
- **rampa de aquecimento** — dia 1 = 50, dobra por dia até o teto do dia.

⚠️ O teto não DESCARTA nada: ele limita quanto o worker REIVINDICA da fila. O
que passou do teto continua lá, intocado, e sai no dia (ou na hora) seguinte.
Nunca vira 'failed'.

A configuração mora em `integration_secrets` (mesmo caminho e mesmo cache dos
segredos — banco primeiro, ambiente depois), com o padrão seguro aqui no
código. Os nomes estão declarados em `Settings` para o `.env` não derrubar o
boot. Ver `CHAVES`.

O dia 1 da rampa é `ENVIO_AQUECIMENTO_INICIO` (AAAA-MM-DD) se estiver gravado;
senão, o dia do PRIMEIRO envio real (`campaign_sends.resend_email_id` não
nulo). Sem envio nenhum, hoje é o dia 1.
"""

import asyncio
import logging
import time
from dataclasses import dataclass, replace
from datetime import date

logger = logging.getLogger(__name__)

FUSO = "America/Sao_Paulo"


@dataclass(frozen=True)
class Ritmo:
    por_segundo: float = 2.0
    teto_hora: int = 500
    teto_dia: int = 2000
    aquecimento_dia1: int = 50
    aquecimento_inicio: date | None = None


PADRAO = Ritmo()

# nome em integration_secrets / ambiente -> campo do Ritmo
CHAVES = {
    "ENVIO_POR_SEGUNDO": "por_segundo",
    "ENVIO_TETO_HORA": "teto_hora",
    "ENVIO_TETO_DIA": "teto_dia",
    "ENVIO_AQUECIMENTO_DIA1": "aquecimento_dia1",
    "ENVIO_AQUECIMENTO_INICIO": "aquecimento_inicio",
}


def _converter(campo: str, bruto: str):
    """Valor válido ou `None`. Valor inválido não derruba o worker: cai no
    padrão e avisa — um teto mal digitado não pode virar "sem teto"."""
    texto = str(bruto).strip()
    try:
        if campo == "aquecimento_inicio":
            return date.fromisoformat(texto)
        if campo == "por_segundo":
            v = float(texto)
            return v if v > 0 else None
        v = int(texto)
        # aquecimento_dia1 = 0 é legítimo (desliga a rampa); teto 0 não —
        # um teto zero pararia todo envio sem dizer por quê.
        if campo == "aquecimento_dia1":
            return v if v >= 0 else None
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None


def montar(valores: dict[str, str | None]) -> Ritmo:
    """O `Ritmo` a partir dos valores crus. O que faltar ou vier inválido
    fica no padrão."""
    mudancas = {}
    for nome, campo in CHAVES.items():
        bruto = valores.get(nome)
        if bruto is None or str(bruto).strip() == "":
            continue
        v = _converter(campo, bruto)
        if v is None:
            logger.warning("%s inválido (%r) — usando o padrão", nome, bruto)
            continue
        mudancas[campo] = v
    return replace(PADRAO, **mudancas)


async def ler() -> Ritmo:
    """A configuração em vigor. Banco, depois ambiente, depois `Settings`."""
    from app import integracoes
    from app.config import settings

    valores = {}
    for nome in CHAVES:
        valores[nome] = (await integracoes.ler_segredo(nome)) or \
            (str(getattr(settings, nome, "") or "") or None)
    return montar(valores)


def teto_de_hoje(r: Ritmo, hoje: date, primeiro_dia: date | None) -> int:
    """O teto do dia com a rampa aplicada."""
    if r.aquecimento_dia1 <= 0:
        return r.teto_dia
    inicio = r.aquecimento_inicio or primeiro_dia or hoje
    dias = max(0, (hoje - inicio).days)
    # Corta o expoente: a partir de ~20 dias o teto do dia já venceu, e
    # 2 ** 400 é só número inútil.
    return min(r.teto_dia, r.aquecimento_dia1 * 2 ** min(dias, 30))


def cota(r: Ritmo, hoje: date, primeiro_dia: date | None, *,
         enviados_hora: int, enviados_dia: int, lote: int,
         visibilidade: int) -> int:
    """Quantas mensagens esta passada pode reivindicar. Nunca negativo.

    ⚠️ O lote também cabe na visibilidade: com ritmo lento, reivindicar 20
    mensagens a 0,1/s levaria 200 s, e a mensagem reapareceria na fila (para
    outro worker, ou para a próxima passada) ainda sendo enviada. Metade da
    visibilidade é a folga.
    """
    cabe_no_tempo = max(1, int(visibilidade * r.por_segundo / 2))
    return max(0, min(lote, cabe_no_tempo,
                      r.teto_hora - enviados_hora,
                      teto_de_hoje(r, hoje, primeiro_dia) - enviados_dia))


# A medição em uma ida ao banco. `resend_email_id` não nulo = saiu de fato pelo
# Resend (falha, supressão e fila-morta não têm). Os status que o webhook muda
# depois (delivered, opened...) preservam `sent_at` e o id, então contam.
#
# ⚠️ O primeiro dia é lido à parte e guardado no processo: ele nunca muda
# depois de existir, e `min()` sem índice em `sent_at` varre a tabela.
SQL_USO = f"""
SELECT count(*) FILTER (WHERE sent_at >= now() - interval '1 hour') AS hora,
       count(*) FILTER (WHERE sent_at >= inicio_do_dia)              AS dia,
       max(hoje)                                                     AS hoje
  FROM (SELECT (now() AT TIME ZONE '{FUSO}')::date AS hoje,
               date_trunc('day', now() AT TIME ZONE '{FUSO}') AT TIME ZONE '{FUSO}'
                   AS inicio_do_dia) d
  LEFT JOIN campaign_sends cs
         ON cs.resend_email_id IS NOT NULL
        AND cs.sent_at >= least(now() - interval '1 hour', d.inicio_do_dia)
"""

SQL_PRIMEIRO_DIA = f"""
SELECT (min(sent_at) AT TIME ZONE '{FUSO}')::date
  FROM campaign_sends WHERE resend_email_id IS NOT NULL
"""

_primeiro_dia: date | None = None


@dataclass(frozen=True)
class Uso:
    hoje: date
    enviados_hora: int
    enviados_dia: int
    primeiro_dia: date | None


async def medir(conn) -> Uso:
    global _primeiro_dia
    linha = await conn.fetchrow(SQL_USO)
    if _primeiro_dia is None:
        _primeiro_dia = await conn.fetchval(SQL_PRIMEIRO_DIA)
    return Uso(hoje=linha["hoje"], enviados_hora=int(linha["hora"] or 0),
               enviados_dia=int(linha["dia"] or 0), primeiro_dia=_primeiro_dia)


class Compasso:
    """Espaça as chamadas ao Resend: no máximo `por_segundo` por segundo.

    Sem crédito acumulado: ficar parado não dá direito a uma rajada depois.
    `segurar(s)` é o `retry-after` de um 429 — ninguém envia até passar.
    """

    def __init__(self, relogio=time.monotonic, dormir=asyncio.sleep):
        self._relogio = relogio
        self._dormir = dormir
        self._proximo = 0.0
        self._liberado_em = 0.0

    def segurar(self, segundos: float) -> None:
        self._liberado_em = max(self._liberado_em, self._relogio() + segundos)

    def restante(self) -> float:
        return max(0.0, self._liberado_em - self._relogio())

    def segurado(self) -> bool:
        return self.restante() > 0

    async def esperar_vez(self, por_segundo: float) -> None:
        agora = self._relogio()
        alvo = max(agora, self._proximo, self._liberado_em)
        if alvo > agora:
            await self._dormir(alvo - agora)
        self._proximo = alvo + 1.0 / por_segundo
