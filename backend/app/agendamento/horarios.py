"""A grade de horários e a roleta de reunião — puro, sem I/O.

Tudo que entra e sai é UTC aware; o dia é o de BRASÍLIA (21:00 em Brasília é
00:00Z do dia seguinte, e o lead escolhe pelo dia que ele vê).
"""

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.agendamento.config import ConfigAgendamento

FUSO = ZoneInfo("America/Sao_Paulo")
UTC = timezone.utc

Ocupado = dict[int, list[tuple[datetime, datetime]] | None]


def livre(blocos: list[tuple[datetime, datetime]] | None, inicio: datetime,
          fim: datetime) -> bool:
    """O vendedor está livre de `inicio` a `fim`? `None` (veio em `erros` da
    agenda) é ocupado sempre. Encostar não é sobrepor: ocupado 13–14 deixa
    12–13 e 14–15 livres."""
    if blocos is None:
        return False
    return not any(b_ini < fim and b_fim > inicio for b_ini, b_fim in blocos)


def livres_em(ocupado: Ocupado, inicio: datetime, fim: datetime) -> set[int]:
    return {uid for uid, blocos in ocupado.items() if livre(blocos, inicio, fim)}


def inicios_possiveis(cfg: ConfigAgendamento, agora: datetime) -> dict[date, list[datetime]]:
    """Todos os inícios da grade (expediente, dias úteis, antecedência,
    janela), sem olhar agenda — por dia de Brasília."""
    if not cfg.ativo:
        return {}
    agora = agora.astimezone(UTC)
    minimo = agora + timedelta(minutes=cfg.antecedencia_min)
    hoje = agora.astimezone(FUSO).date()
    duracao = timedelta(minutes=cfg.duracao_min)
    passo = timedelta(minutes=cfg.grade_min)
    saida: dict[date, list[datetime]] = {}
    for n in range(cfg.janela_dias):
        dia = hoje + timedelta(days=n)
        if dia.weekday() not in cfg.dias_uteis:
            continue
        abre = datetime.combine(dia, cfg.inicio_expediente, tzinfo=FUSO)
        fecha = datetime.combine(dia, cfg.fim_expediente, tzinfo=FUSO)
        inicio = abre
        while inicio + duracao <= fecha:
            em_utc = inicio.astimezone(UTC)
            if em_utc >= minimo:
                saida.setdefault(dia, []).append(em_utc)
            inicio += passo
    return saida


def periodo(cfg: ConfigAgendamento, agora: datetime) -> tuple[datetime, datetime] | None:
    """O período a pedir à agenda: do primeiro início ao último fim da grade."""
    todos = [i for lista in inicios_possiveis(cfg, agora).values() for i in lista]
    if not todos:
        return None
    return min(todos), max(todos) + timedelta(minutes=cfg.duracao_min)


def grade(cfg: ConfigAgendamento, agora: datetime,
          ocupado: Ocupado) -> dict[date, list[datetime]]:
    """Os inícios (UTC) em que AO MENOS UM vendedor está livre do início ao
    fim da reunião, por dia de Brasília. Só os dias com vaga."""
    duracao = timedelta(minutes=cfg.duracao_min)
    saida: dict[date, list[datetime]] = {}
    for dia, inicios in inicios_possiveis(cfg, agora).items():
        vagos = [i for i in inicios if livres_em(ocupado, i, i + duracao)]
        if vagos:
            saida[dia] = vagos
    return saida


def escolher(fila: list[int], livres: set[int]) -> int | None:
    """O primeiro da fila que está livre."""
    return next((uid for uid in fila if uid in livres), None)


def fila_depois(fila: list[int], escolhido: int) -> list[int]:
    """O escolhido vai para o fim; quem foi pulado por estar ocupado guarda a
    vez (fica onde estava)."""
    return [uid for uid in fila if uid != escolhido] + [escolhido]
