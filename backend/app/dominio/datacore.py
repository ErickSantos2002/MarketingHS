"""Leitura do DataCore (Tiny ERP). Mão única: daqui só se lê.

⚠️ A spec dizia "2.077 clientes, todos os 2.077 com e-mail". Medido em
02/09/2026: são **2.081 clientes e 190 com e-mail** no cadastro — a spec erra
por onze vezes, e essa afirmação é a premissa do aviso de entregabilidade dela.
Este módulo trabalha com o que o banco tem.

O e-mail existe em mais dois lugares do ERP. Unindo os três e casando com
cliente cadastrado, o teto é 327 clientes alcançáveis (303 endereços):

    tiny.clientes.email                190 clientes
    tiny.contas_receber.cliente_email  113
    tiny.servicos.email_do_tomador     297
    união                              327

⚠️ Varrer as duas últimas é decisão de negócio, não deste módulo: e-mail que
aparece em nota fiscal foi coletado para faturar. Por isso `com_email_de_notas`
é parâmetro, e a configuração que o alimenta nasce desligada.
"""

import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ClienteErp:
    cpf_cnpj: str
    nome: str | None
    email: str | None
    fone: str | None
    cidade: str | None
    uf: str | None
    tipo_pessoa: str | None


# O e-mail do cadastro do cliente é sempre a primeira escolha. As outras duas
# fontes entram por baixo, e só quando ligadas: `contas_receber` antes de
# `servicos` porque é cobrança — o contato financeiro costuma ser o que responde.
#
# ⚠️ `$1::boolean` aparece nos dois ramos do UNION de propósito. Com ele
# desligado o planejador descarta os dois lados antes de varrer as tabelas, em
# vez de montar a CTE inteira para jogar fora depois.
_SQL = """
WITH extra AS (
    SELECT cliente_cpf_cnpj AS cpf_cnpj, lower(btrim(cliente_email)) AS email, 1 AS pref
      FROM tiny.contas_receber
     WHERE $1::boolean AND btrim(coalesce(cliente_email, '')) <> ''
     UNION ALL
    SELECT "cpf_cnpj_do_tomador", lower(btrim("email_do_tomador")), 2
      FROM tiny.servicos
     WHERE $1::boolean AND btrim(coalesce("email_do_tomador", '')) <> ''
), melhor_extra AS (
    SELECT DISTINCT ON (cpf_cnpj) cpf_cnpj, email
      FROM extra WHERE email LIKE '%@%.%'
     ORDER BY cpf_cnpj, pref, email
)
SELECT c.cpf_cnpj,
       nullif(btrim(c.nome), '')        AS nome,
       COALESCE(nullif(lower(btrim(c.email)), ''), e.email) AS email,
       nullif(btrim(c.fone), '')        AS fone,
       nullif(btrim(c.cidade), '')      AS cidade,
       nullif(btrim(c.uf), '')          AS uf,
       nullif(btrim(c.tipo_pessoa), '') AS tipo_pessoa
  FROM tiny.clientes c
  LEFT JOIN melhor_extra e ON e.cpf_cnpj = c.cpf_cnpj
 ORDER BY c.id
"""

# ⚠️ O ERP tem cliente sem cpf_cnpj. Em 02/09/2026 é um só — "C4 DEVELOPMENT",
# id 764, sem e-mail também. Ele NÃO pode entrar: o cpf_cnpj é a chave de
# idempotência, e string vazia como chave faria a próxima carga achar que já
# importou esse cliente e, pior, casaria com qualquer outro que aparecesse sem
# chave depois. Pular é o certo; pular EM SILÊNCIO não é — quando virarem dez,
# alguém precisa ver.


def _email_plausivel(bruto: str | None) -> str | None:
    """O ERP guarda coisas como "não tem" e "-" no campo de e-mail. Um endereço
    sem `@` ou sem ponto no domínio não é endereço; deixar passar só adianta o
    hard bounce, que custa reputação do remetente."""
    if not bruto:
        return None
    e = bruto.strip().lower()
    if e.count("@") != 1:
        return None
    local, _, dominio = e.partition("@")
    if not local or "." not in dominio or dominio.startswith(".") or dominio.endswith("."):
        return None
    return e


async def clientes_do_datacore(conn, com_email_de_notas: bool) -> list[ClienteErp]:
    """Todos os clientes do ERP — inclusive os sem e-mail.

    ⚠️ Cliente sem e-mail NÃO é descartado. São ~91% da base, e o valor
    principal da sincronização é segmentação (saber quem é cliente), que não
    depende de e-mail.
    """
    linhas = await conn.fetch(_SQL, com_email_de_notas)

    sem_chave = [l["nome"] or "(sem nome)" for l in linhas
                 if not (l["cpf_cnpj"] or "").strip()]
    if sem_chave:
        logger.warning(
            "DataCore: %d cliente(s) sem cpf_cnpj ficaram de fora da "
            "sincronização (não há chave para deduplicá-los): %s",
            len(sem_chave), ", ".join(sem_chave[:10]))

    return [
        ClienteErp(
            cpf_cnpj=l["cpf_cnpj"].strip(),
            nome=l["nome"],
            email=_email_plausivel(l["email"]),
            fone=l["fone"],
            cidade=l["cidade"],
            uf=l["uf"],
            tipo_pessoa=l["tipo_pessoa"],
        )
        for l in linhas
        if (l["cpf_cnpj"] or "").strip()
    ]
