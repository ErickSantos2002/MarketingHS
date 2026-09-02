# MarketingHS — Lote 5B: Contatos do DataCore — Plano

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — `superpowers:subagent-driven-development`
> ou `superpowers:executing-plans`. Os passos usam caixa (`- [ ]`).

**Objetivo:** os clientes do ERP entram no MarketingHS como contatos marcados
`cliente`, e o construtor de segmentos passa a conseguir recortar "cliente"
contra "lead".

**Arquitetura:** sincronização de **mão única e só leitura** — o DataCore manda,
o MarketingHS obedece, nunca escreve de volta. Uma segunda pool asyncpg,
somente-leitura, aberta contra o banco do DataCore. A chave natural é o
`cpf_cnpj`; a idempotência é uma coluna nova em `ecosystem_identities`.

**Stack:** FastAPI, asyncpg, React 18

**Spec:** `docs/superpowers/specs/2026-08-31-marketinghs-design.md`, seção 8.B
**Lote anterior:** `docs/superpowers/plans/2026-09-01-marketinghs-lote-4-jornadas.md`

---

## ⚠️ Leia isto antes: a spec está errada num número central

A spec diz, na seção 8.B:

> `tiny.clientes`: **2.077 clientes, todos os 2.077 com e-mail.**

**Medido no banco em 02/09/2026:**

| | |
|---|---|
| clientes em `tiny.clientes` | **2.081** |
| com `nome` e `cpf_cnpj` distinto | 2.081 (100%) |
| **com e-mail em `tiny.clientes`** | **190** (9,1%) |
| com telefone | 200 |

Não são 2.077 endereços. São **190**. A afirmação da spec erra por um fator de
onze, e ela é a premissa de tudo que vem depois — inclusive do aviso de
entregabilidade ("disparar para 2.077 endereços frios queima a reputação"), que
continua verdadeiro em espírito mas em outra escala.

**O e-mail existe em outros dois lugares do ERP:**

| Fonte | Clientes com e-mail | E-mails distintos |
|---|---|---|
| `tiny.clientes.email` | 190 | 189 |
| `tiny.contas_receber.cliente_email` | 113 | 107 |
| `tiny.servicos.email_do_tomador` | 297 | 160 |
| **união, casando com cliente cadastrado** | **327** | **303** |

O teto real é **327 clientes alcançáveis por e-mail**, e chegar lá exige varrer
nota fiscal e conta a receber.

⚠️ **A união é decisão do Erick e do Nicholson, não deste plano.** E-mail que
aparece numa nota fiscal foi coletado para faturar; a spec já diz que campanha
promocional para a base é "outra conversa". A tarefa 3 entrega a união
**desligada por padrão**, atrás de uma chave de configuração, para que ligá-la
seja um ato consciente e datado.

**O que NÃO muda com isso:** os 2.081 entram como contato de qualquer jeito. O
valor principal do 5B é **segmentação** — saber quem é cliente —, e isso não
depende de e-mail. `leads.email` é nulável (o índice único aceita vários NULL),
então cliente sem e-mail entra normalmente.

---

## O que você precisa saber antes de começar

### A armadilha do telefone

```
ecosystem_identities_phone_key : UNIQUE (phone)
```

E no DataCore:

| telefone | quantos clientes |
|---|---|
| `4133551019` | **26** |
| `6232849050` | 3 |
| outros três | 2 cada |

Vinte e seis clientes dividem um telefone — quase certamente um contador ou um
despachante. **Não escreva `phone` em `ecosystem_identities` a partir do
DataCore.** Com `INSERT`, vinte e cinco falham; com `UPSERT` por telefone, os
vinte e seis colapsam numa identidade só e o CRM passa a achar que são a mesma
empresa. O telefone vai para `leads.whatsapp`, que não tem unicidade.

### E-mail duplicado dentro do próprio ERP

Um só: `daniel.moraes@pora.com.br`, em dois cadastros do mesmo "Porã Sistema de
Remoções Ltda." — duplicata real no ERP. `leads_email_unique` recusaria o
segundo. A regra da tarefa 3 é ficar com o cliente de `id` menor e registrar o
descarte, não estourar a importação inteira por causa de uma linha.

### O que já existe e não se reimplementa

| Peça | Onde |
|---|---|
| dedupe e fusão de linhas duplicadas | `app/dominio/importacao.py` (`combinar_duplicadas`, `campos_para_gravar`) |
| normalização de telefone | `normalize_phone_br(text)` **no banco** |
| pontuação e etiqueta | trigger `trg_score_lead_on_change` em `leads` |
| a pool e o contexto de RLS | `app/database.py` (`sessao`) |

⚠️ **`sessao()` é de UMA pool só** (`_pool` global em `app/database.py`). O
DataCore precisa de uma segunda, e ela é **somente-leitura** — a tarefa 1 monta
isso explicitamente, não por acidente.

---

## Restrições globais

- **Mão única.** Nada neste lote escreve no banco do DataCore. A pool do
  DataCore abre com `default_transaction_read_only=on`, para que uma escrita
  acidental falhe no banco e não só na revisão.
- **`sessao()` é o único caminho para o dado do MarketingHS.**
- **`role="service_role"` + autorização explícita na rota.**
- **O portão tem TRÊS partes**, e a documentação conta.
- **Comentário e nome de módulo em português.**
- ⚠️ **Laço dentro de `sessao()` precisa de SAVEPOINT** (`async with
  conn.transaction()` aninhado). Foi a lição mais cara do lote 4: sem ele o
  primeiro erro aborta a transação e todo o resto morre em cadeia.

---

## Tarefa 1: A porta para o DataCore, e a chave de idempotência

**Arquivos:**
- Cria: `backend/migrations/013_datacore.sql`
- Modifica: `backend/app/database.py`, `backend/app/config.py`, `backend/.env.example`
- Teste: `backend/tests/test_datacore_pool.py`

**Interfaces:**
- Produz: `sessao_datacore()` — context manager assíncrono que devolve uma
  `asyncpg.Connection` somente-leitura contra o DataCore.
- Produz: coluna `ecosystem_identities.datacore_cliente_id text`, única quando
  não nula.

- [ ] **Passo 1: a migration**

```sql
-- 013: a chave do DataCore em ecosystem_identities.
--
-- É por ela que a sincronização é idempotente: rodar duas vezes não cria dois
-- contatos para o mesmo cliente do ERP. O `cpf_cnpj` é a chave natural do lado
-- de lá (2.081 clientes, 2.081 cpf_cnpj distintos — conferido em 02/09/2026).
--
-- ⚠️ Guardamos o cpf_cnpj, não o `id` do Tiny: o id é do banco espelho e muda
-- se o espelho for reconstruído; o cpf_cnpj é do mundo.
ALTER TABLE public.ecosystem_identities
    ADD COLUMN IF NOT EXISTS datacore_cliente_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_ecosystem_datacore_cliente
    ON public.ecosystem_identities (datacore_cliente_id)
 WHERE datacore_cliente_id IS NOT NULL;

COMMENT ON COLUMN public.ecosystem_identities.datacore_cliente_id IS
    'cpf_cnpj do cliente em tiny.clientes. Chave da sincronização de mão única.';
```

- [ ] **Passo 2: a configuração**

Em `backend/app/config.py`, junto das outras:

```python
    # Banco do DataCore (Tiny ERP), SOMENTE LEITURA. Vazio = sincronização
    # desligada, e a rota responde 503 em vez de estourar.
    DATACORE_URL: str = ""
    # ⚠️ Ligar isto faz a sincronização varrer e-mail de nota fiscal e conta a
    # receber, além do cadastro do cliente. Sobe o alcance de 190 para 327
    # contatos — e é decisão do Erick e do Nicholson, não do sistema: e-mail de
    # nota fiscal foi coletado para faturar, não para marketing.
    DATACORE_EMAIL_DE_NOTAS: bool = False
```

Em `backend/.env.example`:

```
# Somente leitura. Use o papel `leitura`, nunca o superusuário.
DATACORE_URL=postgresql://leitura:SENHA@62.72.11.28:5555/datacore-banco
DATACORE_EMAIL_DE_NOTAS=false
```

- [ ] **Passo 3: escreva o teste que falha**

```python
# backend/tests/test_datacore_pool.py
import pytest
from app.database import sessao_datacore


@pytest.mark.asyncio
async def test_pool_do_datacore_recusa_escrita():
    """A pool do DataCore é de leitura, e o BANCO é quem recusa a escrita —
    não a revisão de código. Uma escrita acidental tem de estourar aqui."""
    async with sessao_datacore() as conn:
        with pytest.raises(Exception) as erro:
            await conn.execute("CREATE TEMP TABLE t_proibida (i int)")
        assert "read-only" in str(erro.value).lower()


@pytest.mark.asyncio
async def test_pool_do_datacore_le():
    async with sessao_datacore() as conn:
        n = await conn.fetchval("SELECT count(*) FROM tiny.clientes")
    assert n > 2000
```

- [ ] **Passo 4: rode e veja falhar**

Run: `./.venv/bin/python -m pytest tests/test_datacore_pool.py -v`
Esperado: FAIL — `ImportError: cannot import name 'sessao_datacore'`

- [ ] **Passo 5: a segunda pool**

Em `backend/app/database.py`, ao lado de `_pool`:

```python
_pool_datacore: Optional[asyncpg.Pool] = None


async def init_datacore() -> None:
    """A pool do DataCore, SOMENTE LEITURA.

    ⚠️ `default_transaction_read_only=on` é a trava de verdade. A regra de mão
    única está na spec e em comentário, mas comentário não impede um UPDATE
    distraído — o servidor impede. Sem DATACORE_URL a pool não sobe e a rota de
    sincronização responde 503, do mesmo jeito que a API sobe sem DATABASE_URL.
    """
    global _pool_datacore
    if not settings.DATACORE_URL:
        logger.warning("DATACORE_URL vazio — sincronização do DataCore desligada.")
        return
    try:
        _pool_datacore = await asyncpg.create_pool(
            settings.DATACORE_URL, min_size=1, max_size=3,
            setup=_preparar_conexao,
            server_settings={"default_transaction_read_only": "on"},
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("Falha ao conectar no DataCore: %s", exc)


async def close_datacore() -> None:
    if _pool_datacore:
        await _pool_datacore.close()


@asynccontextmanager
async def sessao_datacore():
    """Conexão de leitura no DataCore. Sem SET LOCAL ROLE: o papel `leitura` do
    outro banco já não tem permissão de escrita, e a pool é read-only."""
    if _pool_datacore is None:
        raise RuntimeError("DataCore indisponível")
    async with _pool_datacore.acquire() as conn:
        yield conn
```

E no ciclo de vida, em `backend/app/main.py`, junto de `init_db()` e `close_db()`:

```python
    await init_datacore()
    ...
    await close_datacore()
```

- [ ] **Passo 6: rode e veja passar**

Run: `./.venv/bin/python -m pytest tests/test_datacore_pool.py -v`
Esperado: PASS (2 testes)

- [ ] **Passo 7: aplique a migration**

Monte `~/marketinghs-migration-013.sh` no molde dos scripts 011 e 012 (o Claude
não roda DDL; o Erick roda no Konsole) e confirme depois:

```sql
SELECT indexname FROM pg_indexes
 WHERE tablename='ecosystem_identities' AND indexname='uniq_ecosystem_datacore_cliente';
```

- [ ] **Passo 8: commit**

```bash
git add backend/migrations/013_datacore.sql backend/app/database.py \
        backend/app/config.py backend/.env.example backend/app/main.py \
        backend/tests/test_datacore_pool.py
git commit -m "feat(5B): a porta de leitura para o DataCore e a chave de sincronização"
```

---

## Tarefa 2: O leitor — o que o ERP tem para dar

**Arquivos:**
- Cria: `backend/app/dominio/datacore.py`
- Teste: `backend/tests/test_datacore_leitura.py`

**Interfaces:**
- Consome: `sessao_datacore()` da tarefa 1.
- Produz: `async def clientes_do_datacore(conn, com_email_de_notas: bool) -> list[ClienteErp]`
  e a dataclass `ClienteErp(cpf_cnpj, nome, email, fone, cidade, uf, tipo_pessoa)`.

- [ ] **Passo 1: escreva o teste que falha**

```python
# backend/tests/test_datacore_leitura.py
import pytest
from app.database import sessao_datacore
from app.dominio.datacore import clientes_do_datacore


@pytest.mark.asyncio
async def test_le_todos_os_clientes_mesmo_sem_email():
    """Cliente sem e-mail NÃO é descartado: o valor principal do lote é
    segmentação, e ela não depende de e-mail."""
    async with sessao_datacore() as conn:
        linhas = await clientes_do_datacore(conn, com_email_de_notas=False)
    assert len(linhas) > 2000
    assert all(c.cpf_cnpj for c in linhas)
    assert any(c.email is None for c in linhas)


@pytest.mark.asyncio
async def test_email_de_notas_amplia_o_alcance():
    """Medido em 02/09/2026: 190 com e-mail no cadastro, 327 unindo nota fiscal
    e conta a receber. O teste prova a direção, não o número exato — o ERP é
    vivo e o número sobe."""
    async with sessao_datacore() as conn:
        so_cadastro = await clientes_do_datacore(conn, com_email_de_notas=False)
        com_notas = await clientes_do_datacore(conn, com_email_de_notas=True)
    def com_email(l): return sum(1 for c in l if c.email)
    assert com_email(so_cadastro) >= 150
    assert com_email(com_notas) > com_email(so_cadastro)
```

- [ ] **Passo 2: rode e veja falhar**

Run: `./.venv/bin/python -m pytest tests/test_datacore_leitura.py -v`
Esperado: FAIL — `ModuleNotFoundError: app.dominio.datacore`

- [ ] **Passo 3: o leitor**

```python
"""Leitura do DataCore (Tiny ERP). Mão única: só lê.

⚠️ A spec dizia "2.077 clientes, todos com e-mail". Medido em 02/09/2026: são
2.081 clientes e **190** com e-mail no cadastro. Unindo `contas_receber` e
`servicos`, 327 ficam alcançáveis. O número da spec estava errado por onze
vezes; este módulo trabalha com o que o banco tem.
"""
from dataclasses import dataclass


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
# fontes entram por baixo, e só quando ligadas: `contas_receber` primeiro (é
# cobrança, o contato financeiro costuma ser o certo), `servicos` depois.
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
       nullif(btrim(c.nome), '')      AS nome,
       COALESCE(
           nullif(lower(btrim(c.email)), ''),
           e.email
       )                              AS email,
       nullif(btrim(c.fone), '')      AS fone,
       nullif(btrim(c.cidade), '')    AS cidade,
       nullif(btrim(c.uf), '')        AS uf,
       nullif(btrim(c.tipo_pessoa), '') AS tipo_pessoa
  FROM tiny.clientes c
  LEFT JOIN melhor_extra e ON e.cpf_cnpj = c.cpf_cnpj
 ORDER BY c.id
"""


async def clientes_do_datacore(conn, com_email_de_notas: bool) -> list[ClienteErp]:
    linhas = await conn.fetch(_SQL, com_email_de_notas)
    return [
        ClienteErp(
            cpf_cnpj=l["cpf_cnpj"],
            nome=l["nome"],
            # Só e-mail com cara de e-mail. O ERP guarda coisas como "não tem".
            email=l["email"] if (l["email"] or "").count("@") == 1
            and "." in (l["email"] or "").split("@")[-1] else None,
            fone=l["fone"], cidade=l["cidade"], uf=l["uf"],
            tipo_pessoa=l["tipo_pessoa"],
        )
        for l in linhas
    ]
```

- [ ] **Passo 4: rode e veja passar**

Run: `./.venv/bin/python -m pytest tests/test_datacore_leitura.py -v`
Esperado: PASS (2 testes)

- [ ] **Passo 5: commit**

```bash
git add backend/app/dominio/datacore.py backend/tests/test_datacore_leitura.py
git commit -m "feat(5B): o leitor do DataCore, com as três fontes de e-mail"
```

---

## Tarefa 3: A sincronização — do ERP para `leads` e `ecosystem_identities`

**Arquivos:**
- Cria: `backend/app/dominio/sincronizacao_datacore.py`
- Teste: `backend/tests/test_sincronizacao_datacore.py`

**Interfaces:**
- Consome: `ClienteErp` e `clientes_do_datacore` da tarefa 2; `sessao` de
  `app.database`.
- Produz: `async def sincronizar(conn_hs, clientes: list[ClienteErp]) -> Resumo`,
  com `Resumo(criados, atualizados, sem_email, colisoes_de_email, erros)`.

- [ ] **Passo 1: escreva os testes que falham**

```python
# backend/tests/test_sincronizacao_datacore.py
import pytest
from app.database import sessao
from app.dominio.datacore import ClienteErp
from app.dominio.sincronizacao_datacore import sincronizar


def _cliente(**kw):
    base = dict(cpf_cnpj="11222333000181", nome="Alfa Ltda",
                email="alfa@exemplo.com.br", fone="81999998888",
                cidade="Recife", uf="PE", tipo_pessoa="J")
    base.update(kw)
    return ClienteErp(**base)


@pytest.mark.asyncio
async def test_rodar_duas_vezes_nao_duplica():
    """A idempotência é `datacore_cliente_id`. Sem ela, cada sincronização
    noturna criaria a base inteira de novo."""
    c = [_cliente()]
    async with sessao(role="service_role") as conn:
        r1 = await sincronizar(conn, c)
        r2 = await sincronizar(conn, c)
    assert r1.criados == 1
    assert r2.criados == 0 and r2.atualizados == 1


@pytest.mark.asyncio
async def test_cliente_sem_email_entra():
    """2.081 clientes e só 190 com e-mail. Descartar quem não tem e-mail jogaria
    fora 91% do valor de segmentação do lote."""
    async with sessao(role="service_role") as conn:
        r = await sincronizar(conn, [_cliente(cpf_cnpj="99888777000166", email=None)])
    assert r.criados == 1 and r.sem_email == 1


@pytest.mark.asyncio
async def test_email_repetido_no_erp_nao_derruba_a_carga():
    """`daniel.moraes@pora.com.br` está em dois cadastros do mesmo Porã.
    `leads_email_unique` recusaria o segundo — a carga inteira não pode cair
    por causa de uma linha."""
    dois = [_cliente(cpf_cnpj="1", email="mesmo@exemplo.com"),
            _cliente(cpf_cnpj="2", email="mesmo@exemplo.com")]
    async with sessao(role="service_role") as conn:
        r = await sincronizar(conn, dois)
    assert r.criados == 2               # os dois viram contato
    assert r.colisoes_de_email == 1     # o segundo entra sem e-mail, e isso é contado


@pytest.mark.asyncio
async def test_telefone_compartilhado_nao_colapsa_identidades():
    """26 clientes dividem o telefone 4133551019 no ERP, e
    ecosystem_identities.phone é UNIQUE. Se o telefone fosse para a identidade,
    os 26 virariam uma empresa só."""
    tres = [_cliente(cpf_cnpj=str(i), email=None, fone="4133551019")
            for i in (10, 11, 12)]
    async with sessao(role="service_role") as conn:
        r = await sincronizar(conn, tres)
        identidades = await conn.fetchval(
            "SELECT count(*) FROM ecosystem_identities WHERE datacore_cliente_id IN ('10','11','12')")
        telefones = await conn.fetchval(
            "SELECT count(*) FROM ecosystem_identities WHERE datacore_cliente_id IN ('10','11','12') AND phone IS NOT NULL")
    assert r.criados == 3
    assert identidades == 3   # três identidades, não uma
    assert telefones == 0     # e nenhuma levou o telefone


@pytest.mark.asyncio
async def test_marca_como_cliente():
    async with sessao(role="service_role") as conn:
        await sincronizar(conn, [_cliente(cpf_cnpj="55")])
        stage = await conn.fetchval(
            "SELECT stage FROM ecosystem_identities WHERE datacore_cliente_id = '55'")
        source = await conn.fetchval(
            "SELECT source FROM leads WHERE dnia_id = (SELECT dnia_id FROM ecosystem_identities WHERE datacore_cliente_id='55')")
    assert stage == "cliente"
    assert source == "datacore"
```

- [ ] **Passo 2: rode e veja falhar**

Run: `./.venv/bin/python -m pytest tests/test_sincronizacao_datacore.py -v`
Esperado: FAIL — `ModuleNotFoundError: app.dominio.sincronizacao_datacore`

- [ ] **Passo 3: a sincronização**

```python
"""Do DataCore para o MarketingHS. Mão única.

Cada cliente do ERP vira uma linha em `ecosystem_identities` (stage='cliente',
chaveada por `datacore_cliente_id`) e uma em `leads` (source='datacore').

⚠️ O telefone NÃO vai para a identidade. `ecosystem_identities.phone` é UNIQUE e
26 clientes do ERP dividem o telefone 4133551019 — contador ou despachante. Com
o telefone na identidade, os 26 colapsariam num contato só. Ele vai para
`leads.whatsapp`, que não tem unicidade.
"""
import logging
from dataclasses import dataclass, field

import asyncpg

from app.dominio.datacore import ClienteErp

logger = logging.getLogger(__name__)


@dataclass
class Resumo:
    criados: int = 0
    atualizados: int = 0
    sem_email: int = 0
    colisoes_de_email: int = 0
    erros: list[str] = field(default_factory=list)


async def sincronizar(conn_hs, clientes: list[ClienteErp]) -> Resumo:
    r = Resumo()
    for c in clientes:
        try:
            # ⚠️ SAVEPOINT por cliente. `sessao()` é UMA transação para o laço
            # inteiro: sem isto, o primeiro cpf_cnpj problemático aborta a
            # transação e os outros 2.080 morrem em cadeia. Lição do lote 4.
            async with conn_hs.transaction():
                await _um_cliente(conn_hs, c, r)
        except Exception as exc:  # noqa: BLE001
            r.erros.append(f"{c.cpf_cnpj}: {exc}")
            logger.warning("cliente %s do DataCore falhou: %s", c.cpf_cnpj, exc)
    return r


async def _um_cliente(conn, c: ClienteErp, r: Resumo) -> None:
    if not c.email:
        r.sem_email += 1

    email = c.email
    if email:
        # O e-mail já é de OUTRO contato? Então este entra sem e-mail, em vez de
        # derrubar a linha. Duplicata do ERP (dois cadastros do mesmo Porã) não
        # é motivo para perder um cliente da segmentação.
        dono = await conn.fetchval(
            """SELECT i.datacore_cliente_id FROM leads l
                 LEFT JOIN ecosystem_identities i ON i.dnia_id = l.dnia_id
                WHERE lower(l.email) = $1""", email)
        if dono is not None and dono != c.cpf_cnpj:
            r.colisoes_de_email += 1
            email = None

    identidade = await conn.fetchrow(
        """INSERT INTO ecosystem_identities
                (datacore_cliente_id, nome, email, stage, first_touch_source, first_touch_app)
           VALUES ($1, $2, $3, 'cliente', 'datacore', 'marketinghs')
           ON CONFLICT (datacore_cliente_id) WHERE datacore_cliente_id IS NOT NULL
           DO UPDATE SET nome = EXCLUDED.nome,
                         email = COALESCE(EXCLUDED.email, ecosystem_identities.email),
                         stage = 'cliente',
                         updated_at = now()
           RETURNING dnia_id, (xmax = 0) AS nasceu""",
        c.cpf_cnpj, c.nome, email)

    dnia_id, nasceu = identidade["dnia_id"], identidade["nasceu"]

    # `tipo` é NOT NULL e sem default. `whatsapp` leva o telefone normalizado
    # pelo banco — a mesma função que o resto do sistema usa.
    lead = await conn.fetchrow(
        """INSERT INTO leads (dnia_id, tipo, nome, email, empresa, whatsapp,
                              phone_normalized, source, status)
           VALUES ($1, 'datacore', $2, $3, $2, $4, normalize_phone_br($4),
                   'datacore', 'Cliente')
           ON CONFLICT (email) DO NOTHING
           RETURNING id""",
        dnia_id, c.nome, email, c.fone)

    # ⚠️ Quem manda na contagem é a IDENTIDADE (`nasceu`), não o `RETURNING` do
    # lead. Contar pelo lead erra nos dois sentidos: identidade nova cujo lead
    # bateu no e-mail de outro contato seria contada como "atualizado", e
    # identidade velha com lead novo não seria contada de jeito nenhum.
    if lead is None:
        # O `ON CONFLICT (email) DO NOTHING` não inseriu: ou o e-mail já é de
        # outro contato, ou este cliente já tinha lead. Atualiza pelo dnia_id.
        await conn.execute(
            """UPDATE leads SET nome = COALESCE($2, nome),
                                empresa = COALESCE($2, empresa),
                                whatsapp = COALESCE($3, whatsapp),
                                phone_normalized = normalize_phone_br(COALESCE($3, whatsapp)),
                                source = 'datacore', updated_at = now()
                WHERE dnia_id = $1""", dnia_id, c.nome, c.fone)

    if nasceu:
        r.criados += 1
    else:
        r.atualizados += 1
```

⚠️ **`ON CONFLICT ... WHERE` exige o índice parcial da tarefa 1.** Se a migration
013 não foi aplicada, o `INSERT` estoura com "no unique or exclusion constraint
matching" — e a mensagem não é óbvia. Confira o índice antes de depurar.

- [ ] **Passo 4: rode e veja passar**

Run: `./.venv/bin/python -m pytest tests/test_sincronizacao_datacore.py -v`
Esperado: PASS (5 testes)

- [ ] **Passo 5: commit**

```bash
git add backend/app/dominio/sincronizacao_datacore.py \
        backend/tests/test_sincronizacao_datacore.py
git commit -m "feat(5B): a sincronização de mão única do DataCore"
```

---

## Tarefa 4: A rota e a tela

**Arquivos:**
- Cria: `backend/app/routers/datacore.py`, `frontend/src/lib/datacore.ts`,
  `frontend/src/components/admin/DatacoreImport.tsx`
- Modifica: `backend/app/main.py`, `frontend/src/pages/admin/ImportPage.tsx`

⚠️ `ImportPage.tsx` tem **10 linhas** — é só uma casca em volta de
`<LeadsImport />`. A aba nova entra ali, e o componente novo fica ao lado do
`LeadsImport`, não dentro dele.

**Interfaces:**
- Consome: `clientes_do_datacore`, `sincronizar`.
- Produz: `GET /datacore/previa` → `{total, com_email, ja_importados}`;
  `POST /datacore/sincronizar` → o `Resumo` serializado.

- [ ] **Passo 1: a rota**

```python
"""Sincronização com o DataCore (Tiny ERP). Mão única, só leitura do lado de lá.

⚠️ Admin: a carga mexe na base de contatos inteira.
"""
from fastapi import APIRouter, Depends, HTTPException, status

from app.database import sessao, sessao_datacore
from app.dependencies import Usuario, admin_atual
from app.config import settings
from app.dominio.datacore import clientes_do_datacore
from app.dominio.sincronizacao_datacore import sincronizar

router = APIRouter(prefix="/datacore", tags=["datacore"])


def _exigir_datacore() -> None:
    if not settings.DATACORE_URL:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "DATACORE_URL não configurada.")


@router.get("/previa")
async def previa(_: Usuario = Depends(admin_atual)):
    """Quantos clientes o ERP tem, quantos são alcançáveis, quantos já entraram.

    ⚠️ O número de alcançáveis muda com DATACORE_EMAIL_DE_NOTAS. A tela mostra
    os dois para que ligar a chave seja uma decisão informada, não uma surpresa.
    """
    _exigir_datacore()
    async with sessao_datacore() as dc:
        so_cadastro = await clientes_do_datacore(dc, com_email_de_notas=False)
        com_notas = await clientes_do_datacore(dc, com_email_de_notas=True)
    async with sessao(role="service_role") as conn:
        ja = await conn.fetchval(
            "SELECT count(*) FROM ecosystem_identities WHERE datacore_cliente_id IS NOT NULL")
    return {
        "total": len(so_cadastro),
        "com_email_cadastro": sum(1 for c in so_cadastro if c.email),
        "com_email_incluindo_notas": sum(1 for c in com_notas if c.email),
        "email_de_notas_ligado": settings.DATACORE_EMAIL_DE_NOTAS,
        "ja_importados": ja,
    }


@router.post("/sincronizar")
async def executar(_: Usuario = Depends(admin_atual)):
    _exigir_datacore()
    async with sessao_datacore() as dc:
        clientes = await clientes_do_datacore(
            dc, com_email_de_notas=settings.DATACORE_EMAIL_DE_NOTAS)
    async with sessao(role="service_role") as conn:
        resumo = await sincronizar(conn, clientes)
    return {
        "criados": resumo.criados, "atualizados": resumo.atualizados,
        "sem_email": resumo.sem_email, "colisoes_de_email": resumo.colisoes_de_email,
        "erros": resumo.erros[:20], "total_de_erros": len(resumo.erros),
    }
```

Registre em `main.py` no molde do `automacoes_router`.

- [ ] **Passo 2: o cliente do frontend**

```ts
// Cliente da sincronização com o DataCore.
//
// ⚠️ A sincronização é de MÃO ÚNICA: o ERP manda, o MarketingHS obedece. Não há
// rota de escrita para o outro lado, e não deve haver.
import { api } from '@/lib/api';

export interface PreviaDatacore {
  total: number;
  com_email_cadastro: number;
  com_email_incluindo_notas: number;
  email_de_notas_ligado: boolean;
  ja_importados: number;
}

export const previaDatacore = () => api.get<PreviaDatacore>('/datacore/previa');

export interface ResumoSincronizacao {
  criados: number;
  atualizados: number;
  sem_email: number;
  colisoes_de_email: number;
  erros: string[];
  total_de_erros: number;
}

export const sincronizarDatacore = () =>
  api.post<ResumoSincronizacao>('/datacore/sincronizar');
```

- [ ] **Passo 3: a aba na tela de Importar**

`ImportPage.tsx` passa a ter duas abas, no molde da tela de Automações:

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LeadsImport } from '@/components/admin/LeadsImport';
import { DatacoreImport } from '@/components/admin/DatacoreImport';

export default function ImportPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Importar</h1>
      <Tabs defaultValue="csv">
        <TabsList>
          <TabsTrigger value="csv">Arquivo CSV</TabsTrigger>
          <TabsTrigger value="datacore">DataCore (ERP)</TabsTrigger>
        </TabsList>
        <TabsContent value="csv" className="pt-4"><LeadsImport /></TabsContent>
        <TabsContent value="datacore" className="pt-4"><DatacoreImport /></TabsContent>
      </Tabs>
    </div>
  );
}
```

E o componente novo:

```tsx
// A aba do DataCore. Mão única: só puxa.
//
// ⚠️ O número que importa aqui é quantos têm E-MAIL, não quantos existem. Um
// botão "Importar 2.081 clientes" faz quem clica esperar 2.081 contatos
// mailáveis; chegam 190. A tela diz isso ANTES do botão, não depois da carga.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle } from 'lucide-react';
import {
  previaDatacore, sincronizarDatacore,
  type PreviaDatacore, type ResumoSincronizacao,
} from '@/lib/datacore';
import { ErroApi } from '@/lib/api';

export function DatacoreImport() {
  const [previa, setPrevia] = useState<PreviaDatacore | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [rodando, setRodando] = useState(false);
  const [resumo, setResumo] = useState<ResumoSincronizacao | null>(null);

  const recarregar = () => {
    setCarregando(true);
    previaDatacore()
      .then(setPrevia)
      .catch((e) => toast.error(e instanceof ErroApi ? e.message : 'Erro ao ler o DataCore'))
      .finally(() => setCarregando(false));
  };

  useEffect(recarregar, []);

  const sincronizar = async () => {
    setRodando(true);
    try {
      const r = await sincronizarDatacore();
      setResumo(r);
      toast.success(`${r.criados} criados, ${r.atualizados} atualizados`);
      recarregar();
    } catch (e) {
      toast.error(e instanceof ErroApi ? e.message : 'Erro na sincronização');
    } finally {
      setRodando(false);
    }
  };

  if (carregando) return <Skeleton className="h-40 w-full rounded-lg" />;
  if (!previa) return null;

  const semEmail = previa.total - previa.com_email_cadastro;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-4 space-y-1 text-sm">
          <p><strong>{previa.total}</strong> clientes no ERP</p>
          <p><strong>{previa.com_email_cadastro}</strong> com e-mail — só esses podem receber campanha</p>
          <p className="text-muted-foreground">{previa.ja_importados} já importados</p>
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
        <p className="text-xs text-amber-900 dark:text-amber-200">
          <strong>{semEmail}</strong> dos {previa.total} clientes não têm e-mail. Eles
          entram como contato para segmentação — você passa a conseguir separar
          "cliente" de "lead" —, mas não recebem e-mail enquanto não tiverem endereço.
          {!previa.email_de_notas_ligado && (
            <> Varrendo nota fiscal e conta a receber, o alcance subiria para{' '}
            <strong>{previa.com_email_incluindo_notas}</strong>; isso está desligado
            e ligar é decisão de negócio, não da tela.</>
          )}
        </p>
      </div>

      <Button onClick={sincronizar} disabled={rodando}>
        {rodando ? 'Sincronizando...' : 'Sincronizar agora'}
      </Button>

      {resumo && (
        <Card>
          <CardContent className="py-4 text-sm space-y-1">
            <p>{resumo.criados} criados · {resumo.atualizados} atualizados</p>
            <p className="text-muted-foreground">
              {resumo.sem_email} sem e-mail · {resumo.colisoes_de_email} com e-mail já usado por outro contato
            </p>
            {resumo.total_de_erros > 0 && (
              <p className="text-destructive">{resumo.total_de_erros} com erro (os 20 primeiros no console)</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Passo 4: confira no navegador**

Rode a prévia, execute a sincronização, e depois abra **Segmentos** e monte um
segmento dinâmico com `status is Cliente`. A prévia tem de contar os clientes
importados. É o "pronto" da spec: o construtor recorta cliente contra lead.

- [ ] **Passo 5: commit**

```bash
git add backend/app/routers/datacore.py backend/app/main.py \
        frontend/src/lib/datacore.ts frontend/src/pages/admin/Import.tsx
git commit -m "feat(5B): a rota e a tela da sincronização do DataCore"
```

---

## Tarefa 5: Fechar

- [ ] **Passo 1: o portão, as três partes.** Nenhuma function do lote 5B sai da
  pasta (o DataCore nunca teve function no repo herdado), mas a documentação
  conta: confira que a tela de Documentação da API e o `dnmarketing-api.yaml`
  não passaram a mentir.
- [ ] **Passo 2: o placar.** Meça com o comando canônico do `CLAUDE.md`.
- [ ] **Passo 3: `ROADMAP.md` e `CONTINUAR-AQUI.md`.** ⚠️ **Registre o erro da
  spec no ROADMAP** — "2.077 com e-mail" era 190, e quem ler a spec depois vai
  tropeçar de novo se o roadmap não avisar.
- [ ] **Passo 4: commit**

---

## Definição de pronto

- [ ] Os 2.081 clientes do ERP existem como contato, com `source='datacore'`
- [ ] `ecosystem_identities.stage = 'cliente'` para todos eles
- [ ] Rodar a sincronização duas vezes **não** duplica ninguém
- [ ] Cliente sem e-mail entra (são ~91% deles)
- [ ] Os 26 clientes que dividem telefone viram 26 identidades, não uma
- [ ] E-mail repetido no ERP não derruba a carga
- [ ] Um segmento dinâmico consegue recortar cliente contra lead, conferido na tela
- [ ] A tela diz, antes do botão, quantos têm e-mail de verdade
- [ ] Nada foi escrito no banco do DataCore — provado pelo teste de read-only
- [ ] `pytest` continua passando

## O que fica fora

- **Disparo para a base.** Aquecimento de domínio é pré-requisito e não é deste
  lote. A spec é explícita, e com 190 endereços o aquecimento é curto — mas
  existe.
- **A decisão de LGPD.** O produto entrega o mecanismo (descadastro em 1 clique,
  supressão automática, origem e data registradas). Se a base de clientes pode
  receber campanha promocional é decisão do Erick e do Nicholson.
- **Ligar `DATACORE_EMAIL_DE_NOTAS`.** Mesma conversa: sobe de 190 para 327, e é
  e-mail coletado para faturar.
- **Sincronização automática (cron).** Este lote entrega o botão. Agendar é
  depois de a carga rodar limpa ao menos uma vez com olho humano em cima.
- **5A (handoff GrowthHS)** e **5C (identidade unificada, Meta CAPI)**.
