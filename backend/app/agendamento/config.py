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

from app.captura.campos import DefinicaoCampo, ler_definicoes

# Nome, e-mail e WhatsApp: a etapa 1 do modal, sempre os da página.
CHAVES_DA_ETAPA_1 = frozenset({"email", "nome", "whatsapp"})
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


def definicoes_so_do_agendamento(config_da_pagina: dict | None) -> list[DefinicaoCampo]:
    """As perguntas que só o modal faz: `agendamento.campos` (29/10), mesmo
    formato de `config["campos"]`, lidas por `ler_definicoes`.

    ⚠️ `ler_definicoes` põe o e-mail na frente e, se nada sobra, devolve os
    campos padrão (`legado`): os dois saem daqui, com nome e WhatsApp — a
    etapa 1 é sempre da página. Lista vazia é nenhuma pergunta.
    """
    bruto = config_da_pagina.get("agendamento") if isinstance(config_da_pagina, dict) else None
    lista = bruto.get("campos") if isinstance(bruto, dict) else None
    if not isinstance(lista, list) or not lista:
        return []
    return [d for d in ler_definicoes({"campos": lista})
            if not d.legado and d.chave not in CHAVES_DA_ETAPA_1]


def definicoes_da_etapa_2(config_da_pagina: dict | None) -> list[DefinicaoCampo]:
    """Etapa 2 do modal: os campos da página menos nome, e-mail e WhatsApp,
    depois as perguntas só do agendamento (chave repetida: fica a da página).
    O espelho de `camposDaEtapa2` (`frontend/src/landing/agendamento.ts`)."""
    da_pagina = [d for d in ler_definicoes(config_da_pagina)
                 if d.chave not in CHAVES_DA_ETAPA_1]
    vistas = {d.chave for d in da_pagina}
    return da_pagina + [d for d in definicoes_so_do_agendamento(config_da_pagina)
                        if d.chave not in vistas]


def pode_agendar(cfg: ConfigAgendamento, campos: dict) -> bool:
    """O porte informado está numa das faixas que agendam (Phoebus: mais de
    400 funcionários)."""
    if not cfg.ativo:
        return False
    valor = (campos or {}).get(cfg.campo_porte)
    return isinstance(valor, str) and valor.strip() in cfg.faixas_que_agendam
