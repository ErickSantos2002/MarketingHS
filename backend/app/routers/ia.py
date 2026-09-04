"""As rotas de IA. Substituem `ai-data-analyst`, `analyze-leads` e
`analyze-challenges`.

⚠️ Todas exigem `admin_atual`, não `usuario_atual` — as NOVE rotas, inclusive
as cinco de conversa. Toda operação com sentido aqui lê `leads` pelas
ferramentas do analista (`app/ia/ferramentas.py`), e a política de RLS de
`leads` só permite SELECT para quem tem o papel `admin`
(`has_role(auth.uid(), 'admin')`, migration de origem). Com `usuario_atual`,
um não-admin não levaria 403: a query voltaria ZERO linhas por causa do RLS, e
o modelo afirmaria o zero como fato — "você tem 0 contatos" — em vez de
recusar. É o erro silencioso que este lote inteiro existe para matar, um nível
acima. As functions de origem (`analyze-leads/index.ts:28`,
`analyze-challenges/index.ts:23`) já chamavam `requireAdmin`; `admin_atual`
aqui não é aperto novo, é preservar o que já existia — não afrouxe de volta.

Deixar o CRUD de conversa (`/conversas*`) em `usuario_atual` também seria
furo: um não-admin criaria e leria conversas que nunca teriam resposta útil,
pelo mesmo motivo. Uma decisão só, aplicada às nove rotas por igual.

As ferramentas rodam pela MESMA `sessao()` do request, com o papel de quem
perguntou (`role="authenticated"`, `user_id=usuario.id`) — o RLS continua
como segunda linha, não a primeira. Nunca `service_role`: `service_role` tem
BYPASSRLS e é só para operação interna (bootstrap, job agendado) — o analista
lê dado a pedido de uma pessoa, e isso é request de usuário.
"""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, admin_atual
from app.ia import analista
from app.ia.cliente import IANaoConfigurada, exigir_cliente

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ia", tags=["ia"])


class MensagemIn(BaseModel):
    conteudo: str = Field(min_length=1, max_length=4000)


@router.get("/conversas")
async def listar_conversas(usuario: Usuario = Depends(admin_atual)):
    """As conversas de QUEM PERGUNTA, não as de todo mundo."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            """SELECT id::text, title, created_at, updated_at
                 FROM ai_chat_conversations
                WHERE user_id = $1::uuid
                ORDER BY updated_at DESC
                LIMIT 50""", usuario.id)
    return [dict(l) for l in linhas]


@router.post("/conversas", status_code=status.HTTP_201_CREATED)
async def criar_conversa(usuario: Usuario = Depends(admin_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            """INSERT INTO ai_chat_conversations (user_id)
               VALUES ($1::uuid)
               RETURNING id::text, title, created_at, updated_at""", usuario.id)
    return dict(linha)


@router.get("/conversas/{conversa_id}")
async def ler_conversa(conversa_id: str, usuario: Usuario = Depends(admin_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        dona = await conn.fetchval(
            "SELECT user_id::text FROM ai_chat_conversations WHERE id = $1::uuid",
            conversa_id)
        if dona is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversa não encontrada.")
        if dona != usuario.id:
            # ⚠️ 404, não 403: dizer "existe mas não é sua" já entrega que a
            # conversa existe. A rota autoriza sozinha, sem depender do RLS.
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversa não encontrada.")
        mensagens = await conn.fetch(
            """SELECT role, content, created_at
                 FROM ai_chat_messages
                WHERE conversation_id = $1::uuid
                ORDER BY created_at""", conversa_id)
    return {"id": conversa_id, "mensagens": [dict(m) for m in mensagens]}


@router.delete("/conversas/{conversa_id}", status_code=status.HTTP_204_NO_CONTENT)
async def apagar_conversa(conversa_id: str, usuario: Usuario = Depends(admin_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        apagadas = await conn.execute(
            "DELETE FROM ai_chat_conversations WHERE id = $1::uuid AND user_id = $2::uuid",
            conversa_id, usuario.id)
    if apagadas == "DELETE 0":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversa não encontrada.")


@router.post("/conversas/{conversa_id}/mensagens")
async def enviar_mensagem(conversa_id: str, dados: MensagemIn,
                          usuario: Usuario = Depends(admin_atual)):
    """Grava a pergunta, responde com ferramentas, grava a resposta."""
    try:
        cliente = await exigir_cliente()
    except IANaoConfigurada as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        dona = await conn.fetchval(
            "SELECT user_id::text FROM ai_chat_conversations WHERE id = $1::uuid",
            conversa_id)
        if dona != usuario.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversa não encontrada.")

        # ⚠️ `ORDER BY created_at DESC` — os RECENTES são o que interessa
        # quando a conversa excede 40 mensagens (mesmo raciocínio de
        # `ferramentas.py:207-211` para a série temporal). Sem o DESC, a
        # partir da 21ª troca o modelo veria sempre as trocas 1-20 mais a
        # pergunta nova, e nunca o meio — sem erro, sem aviso, respondendo com
        # contexto de dezenas de turnos atrás. Depois de buscar, a lista volta
        # para a ordem cronológica: o modelo espera a conversa na ordem em que
        # ela aconteceu.
        #
        # ⚠️ 40 é par e as mensagens gravadas alternam user/assistant estrito
        # — preservar isso é o que garante que a janela sempre contém trocas
        # INTEIRAS (pergunta+resposta), nunca uma pergunta sem resposta no
        # início. Mudar esse número para um ímpar quebraria a alternância.
        anteriores = await conn.fetch(
            """SELECT role, content FROM ai_chat_messages
                WHERE conversation_id = $1::uuid ORDER BY created_at DESC
                LIMIT 40""", conversa_id)
        historico = [{"role": m["role"], "content": m["content"]}
                     for m in reversed(anteriores)]
        historico.append({"role": "user", "content": dados.conteudo})

        await conn.execute(
            """INSERT INTO ai_chat_messages (conversation_id, role, content)
               VALUES ($1::uuid, 'user', $2)""", conversa_id, dados.conteudo)

        try:
            resultado = await analista.responder(cliente, conn, historico)
        except Exception as e:  # noqa: BLE001
            # A pergunta gravada acima e a resposta que não veio estão na
            # MESMA transação (`sessao()` abre uma só, `database.py:113`): um
            # 502 aqui reverte o INSERT da pergunta junto, não a preserva. Não
            # é a mesma coisa que "melhor um 502 com a pergunta salva do que
            # perder a pergunta junto" — essa frase descrevia um comportamento
            # que este código nunca teve.
            #
            # Gravar a pergunta na sua própria transação, antes de chamar o
            # modelo, deixaria essa parte verdadeira — mas quebraria a
            # alternância estrita user/assistant de que a janela do histórico
            # acima depende: um 502 deixaria a pergunta gravada SEM resposta,
            # e a próxima chamada mandaria dois turnos de 'user' seguidos para
            # a API do modelo. Trocar um comentário falso por uma conversa
            # quebrada não é conserto — por isso o código fica como está e só
            # o comentário muda.
            logger.warning("A IA não respondeu na conversa %s: %s",
                           conversa_id, e)
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                "A IA não respondeu. Tente de novo em instantes.")

        await conn.execute(
            """INSERT INTO ai_chat_messages (conversation_id, role, content)
               VALUES ($1::uuid, 'assistant', $2)""",
            conversa_id, resultado["texto"])
        await conn.execute(
            "UPDATE ai_chat_conversations SET updated_at = now() WHERE id = $1::uuid",
            conversa_id)

    return resultado


# ── As duas análises ─────────────────────────────────────────────────────────
# ⚠️ Porte FIEL: mesmo prompt, mesma forma de saída. O que muda é que o formato
# passa a ser garantido pela API em vez de pedido no prompt — o original dizia
# "IMPORTANTE: Retorne APENAS um JSON válido, sem markdown" e torcia.
#
# ⚠️ Os nomes de campo são os que o frontend JÁ LÊ. Renomear um deles aqui
# quebra a tela sem erro de compilação. Ver useAIAnalysis.tsx e
# ChallengesAIInsights.tsx.

def _lista_de_texto(descricao: str) -> dict:
    return {"type": "array", "items": {"type": "string"}, "description": descricao}


_CONTAGEM = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "count": {"type": "integer"},
            "percentage": {"type": "number"},
        },
        "required": ["name", "count", "percentage"],
        "additionalProperties": False,
    },
}

ESQUEMA_LEADS = {
    "type": "object",
    "properties": {
        "summary": {"type": "string",
                    "description": "Resumo executivo de 2-3 frases."},
        "demographics": {
            "type": "object",
            "properties": {"cargos": _CONTAGEM, "faturamentos": _CONTAGEM,
                           "funcionarios": _CONTAGEM},
            "required": ["cargos", "faturamentos", "funcionarios"],
            "additionalProperties": False,
        },
        "patterns": {
            "type": "object",
            "properties": {
                "bestDays": _lista_de_texto("Dias da semana com mais conversão."),
                "bestHours": _lista_de_texto("Faixas de horário."),
                "conversionInsights": {"type": "string"},
            },
            "required": ["bestDays", "bestHours", "conversionInsights"],
            "additionalProperties": False,
        },
        "challenges": {
            "type": "object",
            "properties": {
                "mainThemes": _lista_de_texto("Temas principais dos desafios."),
                "opportunities": _lista_de_texto("Oportunidades identificadas."),
            },
            "required": ["mainThemes", "opportunities"],
            "additionalProperties": False,
        },
        "recommendations": _lista_de_texto("3 a 5 recomendações práticas."),
        "icp": {"type": "string",
                "description": "Perfil do cliente ideal, a partir dos dados."},
    },
    "required": ["summary", "demographics", "patterns", "challenges",
                 "recommendations", "icp"],
    "additionalProperties": False,
}

ESQUEMA_DESAFIOS = {
    "type": "object",
    "properties": {
        "patterns": _lista_de_texto("3 a 5 padrões nos desafios."),
        "copyRecommendations": _lista_de_texto("3 a 5 sugestões de copy."),
        "contentSuggestions": _lista_de_texto("3 a 5 ideias de conteúdo."),
        "gems": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "response": {"type": "string",
                                 "description": "Trecho da resposta destacada."},
                    "reason": {"type": "string",
                               "description": "Por que essa resposta é valiosa."},
                },
                "required": ["response", "reason"],
                "additionalProperties": False,
            },
            "description": "2 a 3 respostas excepcionais.",
        },
        "opportunities": _lista_de_texto("3 a 5 oportunidades de produto."),
    },
    "required": ["patterns", "copyRecommendations", "contentSuggestions",
                 "gems", "opportunities"],
    "additionalProperties": False,
}

SISTEMA_LEADS = """\
Você é um analista de marketing especializado em análise de leads B2B da Health \
& Safety. Responda sempre em português do Brasil. Seja específico e prático: \
recomendação que serve para qualquer empresa não serve para nenhuma.\
"""

SISTEMA_DESAFIOS = """\
Você é um analista de marketing especializado em leads B2B. Analise os desafios \
relatados pelos contatos e devolva conclusões acionáveis, em português do \
Brasil. Foque em padrões que dêem para usar em campanha — não em observações \
genéricas.\
"""


async def _analisar(sistema: str, pergunta: str, esquema: dict) -> dict:
    try:
        cliente = await exigir_cliente()
    except IANaoConfigurada as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))

    from app.ia.cliente import MODELO
    try:
        resposta = await cliente.messages.create(
            model=MODELO,
            max_tokens=16000,
            system=sistema,
            messages=[{"role": "user", "content": pergunta}],
            output_config={"format": {"type": "json_schema", "schema": esquema}},
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"A IA não respondeu: {e}")

    # ⚠️ `output_config.format` garante que o primeiro bloco de texto é JSON
    # válido conforme o schema. Sem isso, este `json.loads` seria uma aposta.
    texto = next((b.text for b in resposta.content if b.type == "text"), "")
    if not texto:
        # Sem bloco de texto, `json.loads("")` levanta `JSONDecodeError` — que
        # não é `HTTPException` e passaria direto por cima do try/except
        # acima, virando 500 cru em vez do 502 que os caminhos vizinhos dão.
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "A IA respondeu sem conteúdo de texto.")
    return json.loads(texto)


@router.post("/analisar-leads")
async def analisar_leads(usuario: Usuario = Depends(admin_atual)):
    """Substitui `analyze-leads`.

    ⚠️ Diferente do original, a tela NÃO manda os leads no corpo. O servidor
    busca pelas mesmas ferramentas do analista — a tela mandar a base inteira
    para o servidor, que a mandava para a IA, era caminho longo e um jeito de o
    navegador vazar dado que ele nem precisava ter.
    """
    from app.ia import ferramentas

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        cargos = await ferramentas.distribuir_contatos(conn, "cargo")
        faturamentos = await ferramentas.distribuir_contatos(conn, "faturamento")
        funcionarios = await ferramentas.distribuir_contatos(conn, "funcionarios")
        origens = await ferramentas.distribuir_contatos(conn, "origem")
        por_dia = await ferramentas.serie_temporal(conn, "dia")
        perfil = {
            "total": (await ferramentas.contar_contatos(conn))["total"],
            "cargos": cargos["distribuicao"],
            # ⚠️ `truncado` viaja com cada dimensão: cargo é texto livre e passa
            # fácil de LIMITE_DE_GRUPOS (30). Sem isto o modelo conclui sobre o
            # todo tendo visto só os maiores grupos.
            "cargos_truncado": cargos["truncado"],
            "faturamentos": faturamentos["distribuicao"],
            "faturamentos_truncado": faturamentos["truncado"],
            "funcionarios": funcionarios["distribuicao"],
            "funcionarios_truncado": funcionarios["truncado"],
            "origens": origens["distribuicao"],
            "origens_truncado": origens["truncado"],
            "por_dia": por_dia["pontos"],
            "por_dia_truncado": por_dia["truncado"],
            "amostra_de_desafios": (await ferramentas.desafios_frequentes(conn))["desafios"],
        }

    pergunta = (
        "Analise o perfil abaixo da base de contatos e devolva as conclusões.\n\n"
        + json.dumps(perfil, ensure_ascii=False, default=str))
    return await _analisar(SISTEMA_LEADS, pergunta, ESQUEMA_LEADS)


@router.post("/analisar-desafios")
async def analisar_desafios(usuario: Usuario = Depends(admin_atual)):
    """Substitui `analyze-challenges`."""
    from app.ia import ferramentas

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        amostra = (await ferramentas.desafios_frequentes(conn, limite=50))["desafios"]

    if not amostra:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Nenhum contato preencheu o campo de desafio ainda — não há o que "
            "analisar.")

    linhas = "\n".join(
        f'- "{d["desafios"]}" (Cargo: {d["cargo"] or "N/A"}, '
        f'Faturamento: {d["faturamento"] or "N/A"})' for d in amostra)
    pergunta = (f"Analise os desafios relatados por {len(amostra)} contatos:\n\n"
                f"{linhas}")
    resultado = await _analisar(SISTEMA_DESAFIOS, pergunta, ESQUEMA_DESAFIOS)
    # ⚠️ `sampleSize` é o tamanho REAL da amostra que o servidor buscou (até
    # 50, `ferramentas.desafios_frequentes`), não o `leads.length` que a tela
    # tem carregado no navegador. A tela chegou a mandar de volta o próprio
    # `leadsWithChallenges.length` como `leads_analyzed` ao gravar o insight —
    # com a base grande, o card afirmava "1.243 leads analisados" quando o
    # modelo só viu 50. Fora do `ESQUEMA_DESAFIOS` de propósito: é metadado do
    # servidor sobre a chamada, não algo que o modelo decide.
    resultado["sampleSize"] = len(amostra)
    return resultado


@router.get("/insights-de-desafios")
async def listar_insights(usuario: Usuario = Depends(admin_atual)):
    """O histórico gravado, que a tela mostra sem precisar reanalisar."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            """SELECT id::text, insights, leads_analyzed, created_at
                 FROM challenge_insights
                ORDER BY created_at DESC
                LIMIT 10""")
    return [dict(l) for l in linhas]


class InsightIn(BaseModel):
    insights: dict
    leads_analyzed: int = Field(ge=0)


@router.post("/insights-de-desafios", status_code=status.HTTP_201_CREATED)
async def gravar_insight(dados: InsightIn,
                         usuario: Usuario = Depends(admin_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            """INSERT INTO challenge_insights (insights, leads_analyzed, created_by)
               VALUES ($1::jsonb, $2, $3::uuid)
               RETURNING id::text, insights, leads_analyzed, created_at""",
            json.dumps(dados.insights), dados.leads_analyzed, usuario.id)
    return dict(linha)


@router.delete("/insights-de-desafios/{insight_id}",
               status_code=status.HTTP_204_NO_CONTENT)
async def apagar_insight(insight_id: str, usuario: Usuario = Depends(admin_atual)):
    """Sem dono: a política de origem ("Admins can delete challenge insights")
    é por PAPEL, não por `created_by` — qualquer admin apaga o insight de
    qualquer admin, igual a tela já deixava antes desta rota existir.

    ⚠️ 404 quando o id não bate com nenhuma linha — não 200. Devolver sucesso
    para um DELETE que não apagou nada é a mesma falha silenciosa que este
    router inteiro existe para evitar, só que na direção de escrita."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        apagadas = await conn.execute(
            "DELETE FROM challenge_insights WHERE id = $1::uuid", insight_id)
    if apagadas == "DELETE 0":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Insight não encontrado.")
