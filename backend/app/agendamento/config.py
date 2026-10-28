"""A configuração do agendamento, por landing: `pages.config["agendamento"]`.

Escrita pelo editor da página (bloco "Agendamento de reunião"). Tudo tem
padrão (spec, "Padrões"); valor inválido cai no padrão em vez de derrubar a
landing — quem vê o erro é o lead, não o admin. Sem `faixas_que_agendam` o
agendamento fica DESLIGADO: ligado sem faixa nenhuma, ninguém passaria do
corte e o botão só criaria lead comum por um caminho mais longo.
"""

import re
from dataclasses import dataclass
from datetime import time

RE_CHAVE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
RE_HORA = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
# A `/integration/agenda` aceita período de até 15 dias.
MAX_JANELA_DIAS = 14


@dataclass(frozen=True)
class ConfigAgendamento:
    ativo: bool
    duracao_min: int = 60
    meeting_kind: str = "apresentacao"
    campo_porte: str = "funcionarios"
    faixas_que_agendam: tuple[str, ...] = ()
    dias_uteis: tuple[int, ...] = (0, 1, 2, 3, 4)
    inicio_expediente: time = time(8)
    fim_expediente: time = time(18)
    antecedencia_min: int = 120
    janela_dias: int = 14
    grade_min: int = 30
    abandono_min: int = 30


def _inteiro(valor, padrao: int, minimo: int, maximo: int) -> int:
    if isinstance(valor, bool) or not isinstance(valor, (int, float)):
        return padrao
    valor = int(valor)
    return valor if minimo <= valor <= maximo else padrao


def _hora(valor, padrao: time) -> time:
    if isinstance(valor, str):
        m = RE_HORA.match(valor.strip())
        if m:
            return time(int(m.group(1)), int(m.group(2)))
    return padrao


def ler_config(config_da_pagina: dict | None) -> ConfigAgendamento:
    bruto = (config_da_pagina or {}).get("agendamento") if isinstance(
        config_da_pagina, dict) else None
    if not isinstance(bruto, dict):
        return ConfigAgendamento(ativo=False)
    padrao = ConfigAgendamento(ativo=False)

    faixas = bruto.get("faixas_que_agendam")
    faixas = tuple(f.strip() for f in faixas if isinstance(f, str) and f.strip()) \
        if isinstance(faixas, list) else ()

    kind = bruto.get("meeting_kind")
    kind = kind.strip() if isinstance(kind, str) and kind.strip() else padrao.meeting_kind

    porte = bruto.get("campo_porte")
    porte = porte if isinstance(porte, str) and RE_CHAVE.match(porte) else padrao.campo_porte

    dias = bruto.get("dias_uteis")
    if isinstance(dias, list) and dias and all(
            isinstance(d, int) and not isinstance(d, bool) and 0 <= d <= 6 for d in dias):
        dias = tuple(sorted(set(dias)))
    else:
        dias = padrao.dias_uteis

    inicio = _hora(bruto.get("inicio_expediente"), padrao.inicio_expediente)
    fim = _hora(bruto.get("fim_expediente"), padrao.fim_expediente)
    if fim <= inicio:
        inicio, fim = padrao.inicio_expediente, padrao.fim_expediente

    return ConfigAgendamento(
        ativo=bruto.get("ativo") is True and bool(faixas),
        duracao_min=_inteiro(bruto.get("duracao_min"), padrao.duracao_min, 15, 240),
        meeting_kind=kind,
        campo_porte=porte,
        faixas_que_agendam=faixas,
        dias_uteis=dias,
        inicio_expediente=inicio,
        fim_expediente=fim,
        antecedencia_min=_inteiro(bruto.get("antecedencia_min"), padrao.antecedencia_min,
                                  0, 7 * 24 * 60),
        janela_dias=_inteiro(bruto.get("janela_dias"), padrao.janela_dias, 1, MAX_JANELA_DIAS),
        grade_min=_inteiro(bruto.get("grade_min"), padrao.grade_min, 5, 240),
        abandono_min=_inteiro(bruto.get("abandono_min"), padrao.abandono_min, 5, 24 * 60),
    )


def pode_agendar(cfg: ConfigAgendamento, campos: dict) -> bool:
    """O porte informado está numa das faixas que agendam (Phoebus: mais de
    400 funcionários)."""
    if not cfg.ativo:
        return False
    valor = (campos or {}).get(cfg.campo_porte)
    return isinstance(valor, str) and valor.strip() in cfg.faixas_que_agendam
