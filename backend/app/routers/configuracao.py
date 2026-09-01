"""Configuração do sistema. Tira do navegador o acesso direto a scoring_config
e a tags — dois dos 68 pontos que a spec mandou fechar."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, admin_atual, usuario_atual

router = APIRouter(tags=["configuracao"])


class ScoringOut(BaseModel):
    criteria: dict
    thresholds: dict
    updated_at: str | None


class ScoringIn(BaseModel):
    criteria: dict
    thresholds: dict


class TagOut(BaseModel):
    id: str
    nome: str
    cor: str | None = None


class TagIn(BaseModel):
    nome: str = Field(min_length=1, max_length=100)
    cor: str | None = Field(default=None, pattern="^#[0-9a-fA-F]{6}$")


@router.get("/config/scoring", response_model=ScoringOut)
async def ler_scoring(_: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            "SELECT criteria, thresholds, updated_at::text FROM scoring_config LIMIT 1")
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            "Nenhuma régua de scoring configurada.")
    return ScoringOut(**dict(linha))


@router.put("/config/scoring", response_model=ScoringOut)
async def gravar_scoring(dados: ScoringIn, _: Usuario = Depends(admin_atual)):
    """⚠️ Gravar aqui NÃO repontua a base. Os triggers só rodam em INSERT e
    UPDATE de `leads`; mudar a régua não toca em linha nenhuma. Depois de
    salvar, chame POST /contatos/recalcular-scores — a tela deve deixar isso
    explícito para quem edita."""
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            """UPDATE scoring_config
                  SET criteria = $1::jsonb, thresholds = $2::jsonb, updated_at = now()
                WHERE id = (SELECT id FROM scoring_config LIMIT 1)
            RETURNING criteria, thresholds, updated_at::text""",
            dados.criteria, dados.thresholds)
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            "Nenhuma régua de scoring para atualizar.")
    return ScoringOut(**dict(linha))


@router.get("/tags", response_model=list[TagOut])
async def listar_tags(_: Usuario = Depends(usuario_atual)):
    # A coluna no schema é `name`; a resposta fala `nome`. A tradução mora aqui
    # e em nenhum outro lugar.
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            "SELECT id::text, name AS nome, color AS cor FROM tags ORDER BY name")
    return [TagOut(**dict(l)) for l in linhas]


@router.post("/tags", response_model=TagOut, status_code=status.HTTP_201_CREATED)
async def criar_tag(dados: TagIn, _: Usuario = Depends(usuario_atual)):
    """⚠️ Upsert, não INSERT — pelo mesmo motivo do lote 1A: `tags_name_key` é
    único, e duas pessoas criando a mesma tag ao mesmo tempo derrubariam uma
    delas com 500. DO UPDATE e não DO NOTHING, para o RETURNING devolver a linha
    também no conflito.

    ⚠️ `COALESCE(tags.color, EXCLUDED.color)` e não o contrário: a cor de quem
    já existe vence. Criar uma tag que já existe é engano de quem digitou, não
    pedido para repintar — e repintar mudaria a aparência dela em todo contato
    que a usa, sem ninguém pedir.

    Na prática o COALESCE sempre cai no primeiro ramo: `tags.color` tem DEFAULT
    'purple' e nunca é nulo. Ou seja, **cor de tag só muda por edição
    explícita**. Mantive o COALESCE mesmo assim: se alguém tirar o default um
    dia, o comportamento continua o desejado sem precisar lembrar disto.
    Trocar tag existente de cor é operação de tela de tags, não de criar."""
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            """INSERT INTO tags (name, color) VALUES ($1, $2)
               ON CONFLICT (name) DO UPDATE SET color = COALESCE(tags.color, EXCLUDED.color)
               RETURNING id::text, name AS nome, color AS cor""",
            dados.nome.strip(), dados.cor)
    return TagOut(**dict(linha))


@router.delete("/notas/{nota_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remover_nota(nota_id: str, _: Usuario = Depends(usuario_atual)):
    """A nota se identifica sozinha; não precisa do contato no caminho."""
    async with sessao(role="service_role") as conn:
        await conn.execute("DELETE FROM lead_notes WHERE id = $1::uuid", nota_id)


@router.get("/preferencias/{chave}")
async def ler_preferencia(chave: str, usuario: Usuario = Depends(usuario_atual)):
    """Preferência de tela, por usuário.

    ⚠️ A chave é composta no SERVIDOR, com o id de quem está autenticado. Se o
    cliente mandasse a chave inteira, um usuário leria a preferência de outro só
    trocando o texto. `dashboard_settings` é global — não tem coluna de dono —,
    então o isolamento vem daqui e de nenhum outro lugar.
    """
    async with sessao(role="service_role") as conn:
        valor = await conn.fetchval(
            "SELECT setting_value FROM dashboard_settings WHERE setting_key = $1",
            f"{usuario.id}:{chave}")
    return {"valor": valor}


@router.put("/preferencias/{chave}")
async def gravar_preferencia(chave: str, corpo: dict,
                             usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        await conn.execute(
            """INSERT INTO dashboard_settings (setting_key, setting_value)
               VALUES ($1, $2::jsonb)
               ON CONFLICT (setting_key) DO UPDATE
                 SET setting_value = EXCLUDED.setting_value, updated_at = now()""",
            f"{usuario.id}:{chave}", corpo.get("valor"))
    return {"valor": corpo.get("valor")}


# ── Lista de supressão ───────────────────────────────────────────────────────
# Quem está aqui não recebe e-mail de campanha, e o worker confere esta tabela
# imediatamente antes de cada envio.

class SupressaoIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)


@router.get("/supressoes")
async def listar_supressoes(
    busca: str | None = Query(None, alias="q"),
    pagina: int = Query(1, alias="page", ge=1),
    limite: int = Query(20, alias="limit", ge=1, le=100),
    _: Usuario = Depends(admin_atual),
):
    """Lista paginada, com busca por endereço.

    ⚠️ `admin_atual`, não `usuario_atual`. Um usuário autenticado sem papel
    (`sem_papel`, o que existe neste sistema) poderia paginar a lista inteira —
    e ela não é só uma lista de endereços: o `reason` diz quem marcou a gente
    como spam e quem deu hard bounce. É informação sobre comportamento, mais
    sensível que a agenda de contatos.
    """
    padrao = f"%{busca.strip()}%" if busca and busca.strip() else None
    async with sessao(role="service_role") as conn:
        total = await conn.fetchval(
            "SELECT count(*) FROM email_suppressions "
            "WHERE $1::text IS NULL OR email ILIKE $1", padrao)
        linhas = await conn.fetch(
            """SELECT id::text, email, reason, source, lead_id::text,
                      created_at::text
                 FROM email_suppressions
                WHERE $1::text IS NULL OR email ILIKE $1
                ORDER BY created_at DESC
                LIMIT $2 OFFSET $3""",
            padrao, limite, (pagina - 1) * limite)
    return {
        "data": [dict(l) for l in linhas],
        "pagination": {"page": pagina, "limit": limite, "total": total,
                       "pages": (total + limite - 1) // limite},
    }


@router.post("/supressoes", status_code=status.HTTP_201_CREATED)
async def suprimir(dados: SupressaoIn, _: Usuario = Depends(admin_atual)):
    """Supressão manual, feita pelo admin.

    ⚠️ `admin_atual`: suprimir bloqueia um endereço de receber qualquer
    campanha, para sempre, e a tela vive em Configurações.

    ⚠️ Endereço já suprimido devolve 200 com `ja_existia`, não 409. Suprimir é
    idempotente por natureza: quem clica quer o endereço fora da lista de envio,
    e um erro aqui sugeriria que não está.

    ⚠️ A razão da PRIMEIRA supressão prevalece (`DO NOTHING`). Sobrescrever um
    `complaint` por `manual` apagaria a informação mais grave que temos sobre
    aquele endereço.
    """
    email = dados.email.strip().lower()
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            """INSERT INTO email_suppressions (email, reason, source)
               VALUES ($1, 'manual', 'admin')
               ON CONFLICT (email) DO NOTHING
               RETURNING id::text""", email)
    return {"email": email, "ja_existia": linha is None}


@router.delete("/supressoes/{supressao_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remover_supressao(supressao_id: str, _: Usuario = Depends(admin_atual)):
    """Tira o endereço da lista — ele volta a poder receber campanha.

    ⚠️ `admin_atual`, e aqui é o caso mais grave dos três: isso desfaz também
    bounce e reclamação, que vieram do provedor. Remover um endereço que pediu
    descadastro o faz voltar a receber e-mail — o oposto do que ele pediu — e
    remover um hard bounce faz o envio ser tentado de novo, piorando a
    reputação do remetente. É decisão do admin, e a tela avisa antes.
    """
    async with sessao(role="service_role") as conn:
        r = await conn.execute(
            "DELETE FROM email_suppressions WHERE id = $1::uuid", supressao_id)
    if r.endswith(" 0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Supressão não encontrada.")


# ── Configuração do Resend ───────────────────────────────────────────────────
# Os segredos moram em `integration_secrets` (ver app/integracoes.py), não no
# repositório e não no .env de produção.

class ResendIn(BaseModel):
    # Todos opcionais: a tela grava só o que o admin preencheu. Campo ausente
    # NÃO apaga o segredo guardado.
    api_key: str | None = None
    email_from: str | None = None
    unsubscribe_secret: str | None = None
    webhook_secret: str | None = None


SEGREDOS_RESEND = {
    "api_key": "RESEND_API_KEY",
    "email_from": "EMAIL_FROM",
    "unsubscribe_secret": "UNSUBSCRIBE_SECRET",
    "webhook_secret": "RESEND_WEBHOOK_SECRET",
}


@router.get("/config/resend")
async def ler_config_resend(_: Usuario = Depends(admin_atual)):
    """O que está configurado — NUNCA o valor.

    ⚠️ Devolver o valor colocaria a RESEND_API_KEY no HTML de qualquer admin
    logado, e num log de proxy no caminho. A tela só precisa saber se o segredo
    existe; os últimos quatro caracteres da chave bastam para a pessoa
    reconhecer qual é.

    ⚠️ `EMAIL_FROM` é a exceção e volta inteiro: não é segredo, é o endereço que
    aparece na caixa de entrada de quem recebe.
    """
    from app.integracoes import ler_segredo

    valores = {campo: await ler_segredo(nome)
               for campo, nome in SEGREDOS_RESEND.items()}
    chave = valores["api_key"] or ""
    return {
        "resend_api_key": {"configurado": bool(chave),
                           "ultimos4": chave[-4:] if len(chave) >= 4 else None},
        "email_from": valores["email_from"],
        "unsubscribe_secret": {"configurado": bool(valores["unsubscribe_secret"])},
        "webhook_secret": {"configurado": bool(valores["webhook_secret"])},
    }


@router.put("/config/resend")
async def gravar_config_resend(dados: ResendIn, _: Usuario = Depends(admin_atual)):
    """Grava só o que veio preenchido.

    ⚠️ `exclude_unset` não basta aqui: a tela manda campo vazio quando o admin
    não digitou nada naquele input. String vazia é "não mexi", não "apague" —
    apagar a RESEND_API_KEY por engano pararia todo envio em silêncio.
    """
    from app.integracoes import gravar_segredo

    if dados.webhook_secret and not dados.webhook_secret.startswith("whsec_"):
        # A chave do HMAC é o base64 do segredo SEM o prefixo. Um valor sem
        # `whsec_` faz toda assinatura falhar e os eventos do Resend serem
        # rejeitados em silêncio — melhor recusar aqui.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            'O segredo do webhook começa com "whsec_" — é o signing secret que '
            "o Resend mostra ao criar o webhook.")

    gravados = []
    for campo, nome in SEGREDOS_RESEND.items():
        valor = getattr(dados, campo)
        if valor and valor.strip():
            await gravar_segredo(nome, valor.strip())
            gravados.append(campo)
    return {"gravados": gravados}
