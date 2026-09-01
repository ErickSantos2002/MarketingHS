"""A montagem do e-mail, por destinatário.

⚠️ A referência desta lógica — `process-email-queue` — NÃO EXISTE no
repositório nem no histórico do git, embora sete arquivos a citem. Cada função
aqui foi **derivada da contraparte que sobreviveu**, não lembrada:

    assinatura do token    <- email-unsubscribe/index.ts::computeToken (verifica)
    codificação do e-mail  <- email-unsubscribe/index.ts::b64urlDecode (inverso)
    merge tags             <- emailEditorConfig.ts::EMAIL_MERGE_TAGS
    parte texto            <- _shared/htmlToText.ts (ver app/texto.py)

Divergir de qualquer uma quebra em silêncio.
"""

import base64
import hashlib
import hmac
from urllib.parse import urlencode

# As tags de contato que o editor oferece. Espelha EMAIL_MERGE_TAGS em
# frontend/src/components/admin/campaigns/emailEditorConfig.ts — as duas listas
# têm de andar juntas.
CAMPOS = ("nome", "empresa", "email")


def _b64url(dados: bytes) -> str:
    """Base64 url-safe SEM padding — a forma que o verificador espera."""
    return base64.urlsafe_b64encode(dados).decode().rstrip("=")


def url_de_descadastro(base: str, lead_id: str, email: str, segredo: str) -> str:
    """O link assinado, por destinatário.

    ⚠️ O e-mail é normalizado (minúsculo, sem espaços nas pontas) ANTES de
    assinar. O verificador faz `b64urlDecode(e).toLowerCase().trim()` e só
    então confere o MAC — assinar o valor cru daria 401 em todo endereço com
    maiúscula, e o contato veria "link inválido" ao tentar sair da lista.
    """
    normalizado = (email or "").strip().lower()
    mac = hmac.new(segredo.encode("utf-8"),
                   f"{lead_id}:{normalizado}".encode("utf-8"),
                   hashlib.sha256).digest()
    parametros = urlencode({
        "lid": lead_id,
        "e": _b64url(normalizado.encode("utf-8")),
        "t": _b64url(mac),
    })
    return f"{base.rstrip('/')}/descadastrar?{parametros}"


def aplicar_merge_tags(html: str, contato: dict, url_descadastro: str) -> str:
    """Troca `{{nome}}`, `{{empresa}}`, `{{email}}` e `{{unsubscribe_url}}`.

    ⚠️ Campo ausente ou nulo vira string VAZIA, nunca a tag crua. Deixar
    "{{nome}}" no corpo é pior que deixar em branco: o contato vê o esqueleto
    do template e o e-mail parece quebrado.
    """
    saida = html or ""
    for campo in CAMPOS:
        valor = contato.get(campo)
        saida = saida.replace("{{%s}}" % campo, "" if valor is None else str(valor))
    return saida.replace("{{unsubscribe_url}}", url_descadastro)


# O rodapé automático. Só entra quando o HTML final não tem o link — o template
# PODE declarar {{unsubscribe_url}} para controlar posição e estilo, e injetar
# mesmo assim daria dois links de descadastro no mesmo e-mail.
RODAPE = (
    '<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e5e5;'
    'font-family:Arial,sans-serif;font-size:12px;color:#888;text-align:center">'
    'Você recebeu este e-mail porque está em nossa lista de contatos. '
    '<a href="{url}" style="color:#888;text-decoration:underline">'
    'Descadastrar-se</a>.</div>'
)


def garantir_rodape(html: str, url_descadastro: str) -> str:
    """Acrescenta o rodapé de descadastro, se ele já não estiver lá."""
    corpo = html or ""
    if url_descadastro and url_descadastro in corpo:
        return corpo
    return corpo + RODAPE.format(url=url_descadastro)


def cabecalhos_rfc8058(url_descadastro: str) -> dict[str, str]:
    """Os cabeçalhos que dão o botão nativo de descadastro no Gmail/Yahoo.

    ⚠️ `List-Unsubscribe-Post` é o que ativa o one-click — e é por isso que o
    endpoint de descadastro precisa aceitar POST, não só GET. Sem ele o botão
    nativo não aparece, e a reputação do remetente sofre: o contato sem saída
    fácil marca como spam.
    """
    return {
        "List-Unsubscribe": f"<{url_descadastro}>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    }
