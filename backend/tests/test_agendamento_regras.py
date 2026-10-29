"""As regras puras do agendamento: a config da página, a grade de horários e
a roleta de reunião. Sem banco, sem rede.

O modo de falhar é oferecer ao lead um horário em que ninguém está livre
(vendedor em `erros` lido como livre, reunião que encosta num compromisso), o
dia errado (21:00 em Brasília é 00:00Z do dia seguinte) ou a roleta dar a vez
a quem não devia.
"""

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from app.agendamento.config import ConfigAgendamento, ler_config, pode_agendar
from app.agendamento.horarios import escolher, fila_depois, grade

BRT = ZoneInfo("America/Sao_Paulo")
UTC = timezone.utc
FAIXAS = ["401 a 1.000", "Mais de 1.000"]


def _cfg(**kw) -> ConfigAgendamento:
    return ler_config({"agendamento": {"ativo": True, "faixas_que_agendam": FAIXAS, **kw}})


def _brt(d, h, m=0):
    return datetime(2026, 10, d, h, m, tzinfo=BRT).astimezone(UTC)


# ── Config ───────────────────────────────────────────────────────────────────

def test_padroes():
    cfg = ler_config({"agendamento": {"ativo": True, "faixas_que_agendam": ["401 a 1.000"]}})
    assert cfg.ativo
    assert cfg.duracao_min == 60
    assert cfg.meeting_kind == "apresentacao"
    assert cfg.campo_porte == "funcionarios"
    assert cfg.faixas_que_agendam == ("401 a 1.000",)
    assert cfg.dias_uteis == (0, 1, 2, 3, 4)
    assert (cfg.inicio_expediente, cfg.fim_expediente) == (time(8), time(18))
    assert (cfg.antecedencia_min, cfg.janela_dias, cfg.grade_min) == (120, 14, 30)


def test_sem_faixas_fica_desligado():
    assert not ler_config({"agendamento": {"ativo": True}}).ativo
    assert not ler_config({"agendamento": {"ativo": True, "faixas_que_agendam": []}}).ativo


def test_sem_config_ou_desligado():
    assert not ler_config(None).ativo
    assert not ler_config({}).ativo
    assert not ler_config({"agendamento": "sim"}).ativo
    assert not ler_config({"agendamento": {"ativo": False, "faixas_que_agendam": FAIXAS}}).ativo


def test_valor_invalido_cai_no_padrao():
    cfg = _cfg(duracao_min="muito", meeting_kind="", janela_dias=90, grade_min=0,
               antecedencia_min=-5, dias_uteis=[9], inicio_expediente="25:00",
               fim_expediente="07:00", campo_porte="Não É Chave")
    assert cfg.duracao_min == 60 and cfg.meeting_kind == "apresentacao"
    assert cfg.janela_dias == 14 and cfg.grade_min == 30 and cfg.antecedencia_min == 120
    assert cfg.dias_uteis == (0, 1, 2, 3, 4)
    assert (cfg.inicio_expediente, cfg.fim_expediente) == (time(8), time(18))
    assert cfg.campo_porte == "funcionarios"


def test_valores_validos_sao_lidos():
    cfg = _cfg(duracao_min=30, meeting_kind="apresentacao_phoebus", janela_dias=7,
               antecedencia_min=60, inicio_expediente="09:00", fim_expediente="17:30",
               dias_uteis=[0, 2], campo_porte="porte")
    assert (cfg.duracao_min, cfg.meeting_kind, cfg.janela_dias) == (30, "apresentacao_phoebus", 7)
    assert (cfg.inicio_expediente, cfg.fim_expediente) == (time(9), time(17, 30))
    assert cfg.dias_uteis == (0, 2) and cfg.campo_porte == "porte"


def test_pode_agendar_pela_faixa():
    cfg = _cfg()
    assert pode_agendar(cfg, {"funcionarios": "401 a 1.000"})
    assert not pode_agendar(cfg, {"funcionarios": "101 a 400"})
    assert not pode_agendar(cfg, {})
    assert not pode_agendar(ler_config(None), {"funcionarios": "401 a 1.000"})


# ── Grade ────────────────────────────────────────────────────────────────────

AGORA = _brt(28, 10)  # quarta-feira, 28/10/2026, 10:00 em Brasília


def test_grade_respeita_expediente_e_antecedencia():
    g = grade(_cfg(), AGORA, {1: []})
    hoje = g[date(2026, 10, 28)]
    assert hoje[0] == _brt(28, 12) and hoje[0] == datetime(2026, 10, 28, 15, tzinfo=UTC)
    assert hoje[-1] == _brt(28, 17)
    assert len(hoje) == 11  # 12:00 … 17:00 de meia em meia
    amanha = g[date(2026, 10, 29)]
    assert amanha[0] == _brt(29, 8) and amanha[-1] == _brt(29, 17) and len(amanha) == 19
    # Sábado e domingo ausentes; 14 dias contando hoje (28/10 … 10/11).
    assert date(2026, 10, 31) not in g and date(2026, 11, 1) not in g
    assert max(g) == date(2026, 11, 10) and min(g) == date(2026, 10, 28)
    assert len(g) == 10


def test_grade_agrupa_por_dia_de_brasilia():
    g = grade(_cfg(fim_expediente="22:00"), AGORA, {1: []})
    ultimo = g[date(2026, 10, 29)][-1]
    assert ultimo == _brt(29, 21) == datetime(2026, 10, 30, 0, tzinfo=UTC)


def test_um_livre_basta():
    g = grade(_cfg(), AGORA, {1: [(_brt(29, 12), _brt(29, 13))], 2: []})
    assert _brt(29, 12) in g[date(2026, 10, 29)]


def test_none_e_ocupado_sempre():
    assert grade(_cfg(), AGORA, {1: None}) == {}
    assert grade(_cfg(), AGORA, {}) == {}


def test_reuniao_que_encosta_no_ocupado():
    g = grade(_cfg(), AGORA, {1: [(_brt(29, 13), _brt(29, 14))]})[date(2026, 10, 29)]
    assert _brt(29, 12) in g
    assert _brt(29, 12, 30) not in g
    assert _brt(29, 13) not in g and _brt(29, 13, 30) not in g
    assert _brt(29, 14) in g


def test_grade_desligada_e_vazia():
    assert grade(ler_config(None), AGORA, {1: []}) == {}


# ── Roleta ───────────────────────────────────────────────────────────────────

def test_escolher_e_fila_depois():
    assert escolher([1, 2, 3, 4, 5], {4, 5}) == 4
    assert fila_depois([1, 2, 3, 4, 5], 4) == [1, 2, 3, 5, 4]
    assert escolher([1, 2], set()) is None
    assert escolher([1, 2, 3], {1, 3}) == 1
    assert fila_depois([1, 2, 3], 1) == [2, 3, 1]
    assert fila_depois([1, 2, 3], 3) == [1, 2, 3]


# ── Perguntas só do agendamento (`agendamento.campos`, 29/10) ────────────────
# A landing phoebus: o formulário da página tem só nome/e-mail/WhatsApp/
# empresa/cargo; o porte, os testes por dia e as filiais só o modal pergunta.
# O modo de falhar: o modal sem o porte (ninguém passa do `pode_agendar`), a
# captura normal exigindo uma pergunta que ela não mostra, ou a lista vazia
# trazendo de volta os campos padrão.

FAIXAS_PORTE = ["Até 100", "101 a 400", "401 a 1.000", "Mais de 1.000"]


def config_phoebus() -> dict:
    return {
        "campos": [
            {"chave": "nome", "rotulo": "Nome", "tipo": "texto", "obrigatorio": True},
            {"chave": "email", "rotulo": "E-mail corporativo", "tipo": "email",
             "obrigatorio": True},
            {"chave": "whatsapp", "rotulo": "WhatsApp", "tipo": "telefone",
             "obrigatorio": True},
            {"chave": "empresa", "rotulo": "Empresa", "tipo": "texto", "obrigatorio": True},
            {"chave": "cargo", "rotulo": "Cargo", "tipo": "texto", "obrigatorio": False},
        ],
        "agendamento": {
            "ativo": True, "faixas_que_agendam": FAIXAS,
            "campos": [
                {"chave": "funcionarios", "rotulo": "Quantos funcionários a empresa tem?",
                 "tipo": "lista", "obrigatorio": True, "opcoes": FAIXAS_PORTE},
                {"chave": "testes_por_dia",
                 "rotulo": "Quantas pessoas passariam pelo teste por dia?",
                 "tipo": "lista", "obrigatorio": False,
                 "opcoes": ["Até 50", "51 a 200", "201 a 1.000", "Mais de 1.000"]},
                {"chave": "filiais", "rotulo": "Quantas filiais?", "tipo": "lista",
                 "obrigatorio": False,
                 "opcoes": ["Só a matriz", "2 a 5", "6 a 20", "Mais de 20"]},
            ],
        },
    }


def test_etapa_2_junta_pagina_e_agendamento():
    from app.agendamento.config import definicoes_da_etapa_2
    defs = definicoes_da_etapa_2(config_phoebus())
    assert [d.chave for d in defs] == ["empresa", "cargo", "funcionarios",
                                       "testes_por_dia", "filiais"]
    porte = defs[2]
    assert porte.obrigatorio and porte.opcoes == tuple(FAIXAS_PORTE) and not porte.legado


def test_etapa_2_chave_repetida_fica_a_da_pagina_e_etapa_1_nunca_entra():
    from app.agendamento.config import definicoes_da_etapa_2
    config = config_phoebus()
    config["campos"].append({"chave": "filiais", "rotulo": "Filiais (página)",
                             "tipo": "texto"})
    config["agendamento"]["campos"] += [
        {"chave": "nome", "rotulo": "Outro", "tipo": "texto"},
        {"chave": "whatsapp", "rotulo": "Outro", "tipo": "telefone"}]
    defs = definicoes_da_etapa_2(config)
    assert [d.chave for d in defs] == ["empresa", "cargo", "filiais", "funcionarios",
                                       "testes_por_dia"]
    assert defs[2].rotulo == "Filiais (página)"


def test_etapa_2_sem_lista_do_agendamento_nao_traz_campos_padrao():
    from app.agendamento.config import definicoes_da_etapa_2
    for campos in (None, [], [{"chave": "x"}], "lixo"):
        config = config_phoebus()
        config["agendamento"]["campos"] = campos
        assert [d.chave for d in definicoes_da_etapa_2(config)] == ["empresa", "cargo"]


def test_captura_normal_nao_ve_as_perguntas_do_agendamento():
    from app.captura.campos import ler_definicoes, validar
    defs = ler_definicoes(config_phoebus())
    assert [d.chave for d in defs] == ["nome", "email", "whatsapp", "empresa", "cargo"]
    validados = validar(defs, {"email": "a@b.com", "nome": "Ana",
                               "whatsapp": "(81) 99999-0000", "empresa": "Acme"})
    assert validados.erros == {}


def test_pode_agendar_com_porte_so_do_agendamento():
    cfg = ler_config(config_phoebus())
    assert cfg.ativo and cfg.campo_porte == "funcionarios"
    assert pode_agendar(cfg, {"funcionarios": "Mais de 1.000"})
