"""Configuração do painel e eventos de agendamento.

`dashboard_settings` é uma tabela chave/valor em jsonb, GLOBAL — não por
usuário. É de propósito: meta de leads e escolha de cartões são do painel da
empresa, não da pessoa. Preferência por usuário tem outro caminho
(`/preferencias/{chave}` em configuracao.py, que compõe a chave com o id de quem
está autenticado).

⚠️ `dashboard_settings` e `contact_events` são admin-only por RLS
(`has_role(auth.uid(), 'admin')`) — medido no banco em 03/09/2026. As rotas
exigem `admin_atual`, não `usuario_atual`: um autenticado sem o papel não
levaria 403, levaria zero linhas, e o painel mostraria vazio sem erro nenhum.
Mesma decisão das nove rotas de `app/routers/ia.py`.

⚠️ E rodam pela MESMA `sessao()` do request, com `role="authenticated"` — não
o padrão `anon` de `sessao()`. Medido: sob `anon`, `SELECT count(*) FROM
contact_events` devolve 0; sob `authenticated`, 2.931 (a política é `TO
authenticated`). Com `anon` a rota de agendamentos devolveria lista vazia sem
erro nenhum, igual ao problema do papel acima.
"""

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, status

from app.database import sessao
from app.dependencies import Usuario, admin_atual

router = APIRouter(prefix="/painel", tags=["painel"])

# Chaves conhecidas. ⚠️ Allowlist, e não texto livre: sem ela a rota vira um
# armazenamento chave/valor arbitrário, escrevível por qualquer usuário
# autenticado, dentro do banco de marketing.
#
# "dashboard_cards" guarda um objeto ÚNICO, `{tabName: [chaves visíveis]}` —
# não um valor por aba. A escolha de cartões é global (ver docstring acima),
# mas cada aba do painel (Visão Geral, Tático, Operacional...) continua
# guardando seu próprio conjunto de cartões visíveis dentro desse objeto.
CHAVES = {"lead_goal", "dashboard_cards"}

# Teto de `/agendamentos`, no lugar do `LIMIT 500` fixo que o lote 6 introduziu
# ao portar `useAgendamentos` do Supabase. 500 era 40x menor que o que a versão
# anterior (paginação no cliente, `PAGE=1000`/`MAX=20000`) aguentava — e cortava
# em silêncio. 20000 restaura o teto antigo, e a rota agora AVISA quando bate
# nele, em vez de só truncar (ver `test_painel.py`).
TETO_AGENDAMENTOS = 20000


@router.get("/config/{chave}")
async def ler_config(chave: str, usuario: Usuario = Depends(admin_atual)):
    if chave not in CHAVES:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            f"Configuração '{chave}' não existe.")
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        valor = await conn.fetchval(
            "SELECT setting_value FROM dashboard_settings WHERE setting_key = $1",
            chave)
    if valor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            f"Configuração '{chave}' ainda não foi definida.")
    return {"setting_key": chave, "setting_value": valor}


@router.put("/config/{chave}")
async def gravar_config(chave: str, valor: Any = Body(...),
                        usuario: Usuario = Depends(admin_atual)):
    if chave not in CHAVES:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            f"Configuração '{chave}' não existe.")
    # ⚠️ `valor` vai cru, sem json.dumps: o codec de jsonb registrado em
    # `_preparar_conexao` (database.py) já serializa. Fazer json.dumps aqui em
    # cima disso gera um jsonb cujo conteúdo é uma STRING contendo JSON —
    # double-encoding, visto na conferência manual desta rota (03/09/2026).
    # O mesmo padrão já vale em configuracao.py (`gravar_redes_sociais`).
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        gravado = await conn.fetchval(
            """INSERT INTO dashboard_settings (setting_key, setting_value)
               VALUES ($1, $2::jsonb)
               ON CONFLICT (setting_key) DO UPDATE
                   SET setting_value = EXCLUDED.setting_value,
                       updated_at = now()
               RETURNING setting_value""",
            chave, valor)
    return {"setting_key": chave, "setting_value": gravado}


@router.get("/agendamentos")
async def listar_agendamentos(usuario: Usuario = Depends(admin_atual)):
    """Os eventos de agendamento, que o painel usa para contar reuniões.

    ⚠️ Os dois tipos legados (`scheduling_widget_booked`, `meeting_scheduled`)
    são a mesma regra que o `/enriquecimento` de leitura_contatos.py aplica —
    ver o comentário de lá antes de mexer nesta lista.

    ⚠️ A coluna é `occurred_at`, não `created_at` — `contact_events` não tem
    coluna `created_at` (conferido no schema de origem). O nome no retorno
    casa com o que o hook do frontend já esperava.

    A resposta deixou de ser uma lista nua: `truncado` distingue "parei porque
    acabou" (normal, silencioso) de "parei porque bati no teto" (`teto`
    eventos, ordenados pelo mais recente — os mais antigos ficam de fora). O
    hook do frontend (`useAgendamentos`) repassa os dois para quem quiser
    avisar, do mesmo jeito que `useLeads` faz para o teto de 10 mil leads.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        total = await conn.fetchval(
            """SELECT count(*) FROM contact_events
                WHERE event_type IN ('scheduling_widget_booked', 'meeting_scheduled')""")
        linhas = await conn.fetch(
            """SELECT id::text, lead_id::text, dnia_id::text, event_type,
                      metadata, occurred_at::text
                 FROM contact_events
                WHERE event_type IN ('scheduling_widget_booked', 'meeting_scheduled')
                ORDER BY occurred_at DESC
                LIMIT $1""", TETO_AGENDAMENTOS)
    return {
        "events": [dict(l) for l in linhas],
        "truncado": total > TETO_AGENDAMENTOS,
        "teto": TETO_AGENDAMENTOS,
    }


@router.get("/agendamentos/mql-hoje")
async def listar_mql_reuniao_agendada_hoje(usuario: Usuario = Depends(admin_atual)):
    """Leads que ENTRARAM em 'MQL - Reunião agendada' hoje (fuso Brasília).

    Porta fiel de `public.mql_reuniao_agendada_today()` (ver
    `backend/migrations/001_schema_origem.sql:1265-1288`) — a RPC não volta,
    porque a guarda `IF NOT has_role(auth.uid(),'admin') THEN RAISE` que ela
    fazia em SQL já é o `admin_atual` desta rota.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            """SELECT DISTINCT ce.lead_id::text
                 FROM contact_events ce
                WHERE ce.event_type = 'contact_updated'
                  AND ce.metadata->>'status_atual' = 'MQL - Reunião agendada'
                  AND ce.lead_id IS NOT NULL
                  AND (ce.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date
                      = (now() AT TIME ZONE 'America/Sao_Paulo')::date""")
    return [l["lead_id"] for l in linhas]
