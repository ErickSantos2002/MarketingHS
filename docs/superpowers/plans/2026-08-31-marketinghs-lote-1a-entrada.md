# MarketingHS — Lote 1A: Entrada (importar, pontuar, etiquetar) — Plano

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — `superpowers:subagent-driven-development`
> ou `superpowers:executing-plans`. Os passos usam caixa (`- [ ]`).

**Objetivo:** importar um CSV de contatos reais pela tela e ver cada linha nascer
com `lead_score` e `etiqueta` calculados por uma régua que é da Health & Safety,
não da dn.ia.

**Arquitetura:** três rotas FastAPI substituem três edge functions
(`import-leads-csv`, `recalculate-all-scores`, `apply-lead-tag`), mais dois
endpoints de configuração que tiram do navegador o acesso direto a
`scoring_config`. Uma migration resolve o conflito de dois triggers que hoje
disputam a coluna `etiqueta`.

**Stack:** FastAPI, asyncpg, pytest · React 18, Vite

**Spec:** `docs/superpowers/specs/2026-08-31-marketinghs-design.md`
**Lote anterior:** `docs/superpowers/plans/2026-08-31-marketinghs-lote-0-fundacao.md`

---

## Restrições globais

- **`sessao()` é o único caminho para dado.** `role="service_role"` só para
  operação interna; nunca para request de usuário sem checar autorização antes.
- **Nenhum endpoint depende do RLS para autorizar.** Cada rota autoriza sozinha,
  via `admin_atual` (de `app/dependencies.py`, lote 0).
- **O papel de admin é `'admin'`.**
- **Toda chave lida do ambiente precisa estar declarada em `Settings`.**
- **O portão de pronto tem duas metades:** `grep` limpo na tela E tela conferida
  no navegador. A function só sai de `backend/supabase/` quando as duas valem.
  No lote 0 isso foi contado pela metade uma vez — não repita.
- **Backend na porta 8100 no host** (a 8000 é do TaskHS nesta máquina).
- **Comentário e nome de módulo em português.**
- **`leads.tipo` é NOT NULL sem default.** Todo insert precisa dele.

---

## O que você precisa saber antes de começar

### O classificador cravado já estava desligado

`public.leads` tem dois triggers que escreveriam `NEW.etiqueta`, mas **só um
está ativo**. Verificado no banco com `pg_trigger.tgenabled`:

| Trigger | Função | Estado |
|---|---|---|
| `trg_score_lead_on_change` | `score_lead_from_config` | **ativo** — lê `scoring_config` |
| `trigger_classify_lead_etiqueta` | `classify_lead_etiqueta` | **DESABILITADO** (`tgenabled = 'D'`) |

A dn.ia já tinha desligado o classificador de regras cravadas, e o dump
preservou o estado. Não há conflito ao vivo para resolver.

O que sobra é mais simples e ainda assim bloqueia tudo: **`scoring_config` veio
vazia**, e `score_lead_from_config` começa com
`IF v_criteria IS NULL THEN RETURN NEW`. Hoje **nada é pontuado** — verificado
inserindo um lead com cargo e faturamento que casariam com qualquer régua:
`etiqueta` volta NULL e `lead_score` volta 0.

A função desligada continua no schema com o ICP da dn.ia dentro — regex de
faturamento de infoproduto (`'entre 100k'`, `'de r\$ 1 milhão'`) e lista de
cargos de quem compra imersão. Trigger desabilitado é uma armadilha: alguém o
reativa daqui a seis meses achando que está "ligando o scoring", e a base
inteira recebe a régua errada. A tarefa 1 remove os dois.

### O gatilho tem lista de colunas — e isso muda o recálculo

```
CREATE TRIGGER trg_score_lead_on_change
  BEFORE INSERT OR UPDATE OF cargo, faturamento, funcionarios, desafios,
                             whatsapp, utm_source, source
  ON public.leads FOR EACH ROW EXECUTE FUNCTION score_lead_from_config()
```

⚠️ **Um `UPDATE` que toque qualquer outra coluna NÃO dispara o scoring.** Um
recálculo escrito como `UPDATE leads SET updated_at = updated_at` responderia
"atualizados: N" sem ter recalculado nada — o pior tipo de erro, o que se
reporta como sucesso. O recálculo tem de tocar uma das sete colunas da lista.

### Onde a importação encosta

`import-leads-csv` chama a RPC `resolve_or_create_identity`, que **sobreviveu à
portagem do schema** (confira: `SELECT proname FROM pg_proc WHERE proname =
'resolve_or_create_identity'`). Ela é PL/pgSQL e continua no banco — não
reimplemente em Python.

Também existe `normalize_phone_br(text)`, usada por ela.

---

## Estrutura de arquivos

**Cria:**

| Arquivo | Responsabilidade |
|---|---|
| `backend/migrations/004_etiqueta_configuravel.sql` | Resolve o conflito dos dois triggers e semeia `scoring_config` |
| `backend/app/routers/contatos.py` | `POST /contatos/importar`, `POST /contatos/recalcular-scores`, `POST /contatos/{id}/etiqueta` |
| `backend/app/routers/configuracao.py` | `GET/PUT /config/scoring`, `GET /tags` |
| `backend/app/dominio/importacao.py` | A regra de enriquecer-ou-sobrescrever, pura e testável |
| `backend/tests/test_importacao.py` | Testa a regra de mesclagem |
| `frontend/src/lib/contatos.ts` | Chamadas de contatos, sobre `@/lib/api` |

**Modifica:**

| Arquivo | O quê |
|---|---|
| `backend/app/main.py` | Registra os dois routers |
| `frontend/src/components/admin/LeadsImport.tsx` | 3 pontos → `@/lib/contatos` |
| `frontend/src/hooks/useScoringConfig.tsx` | 2 pontos diretos → endpoints |

**Remove ao fechar:** `backend/supabase/functions/{import-leads-csv,recalculate-all-scores,apply-lead-tag}`

---

## Tarefa 1: Uma régua só, e ela é da HS

**Arquivos:**
- Cria: `backend/migrations/004_etiqueta_configuravel.sql`

**Interfaces:**
- Produz: `scoring_config` com uma linha; `classify_lead_etiqueta` lendo dessa
  linha em vez de regra cravada.

- [ ] **Passo 1: confirmar o problema antes de mexer**

```bash
set -a; . ~/marketinghs.env; set +a; export PGPASSWORD="$POSTGRES_PASSWORD"
U="postgresql://${POSTGRES_USER}@${POSTGRES_HOST_EXTERNO}:${POSTGRES_PORTA_EXTERNA}/${POSTGRES_DB}"
psql "$U" -tAc "SELECT count(*) FROM scoring_config;"
psql "$U" -tAc "SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
                WHERE c.relname='leads' AND NOT t.tgisinternal ORDER BY tgname;"
```

```bash
psql "$U" -tAc "SELECT tgname, tgenabled::text FROM pg_trigger t
                JOIN pg_class c ON c.oid=t.tgrelid
                WHERE c.relname='leads' AND NOT t.tgisinternal ORDER BY tgname;"
```

Esperado: `0` linhas em `scoring_config`, e `trigger_classify_lead_etiqueta`
com `tgenabled = D`. Se ele vier `O`, o dump ou a migration 001 mudaram o
estado — pare e investigue antes de seguir, porque aí existe um conflito ao
vivo e este plano precisa mudar.

- [ ] **Passo 2: `backend/migrations/004_regua_de_scoring.sql`**

```sql
-- Duas coisas, e a segunda é a que faz o scoring existir.
--
-- 1) Remove o classificador de etiqueta com regras cravadas no corpo. Ele já
--    chegou DESABILITADO no dump — a própria dn.ia o desligou —, mas função e
--    trigger continuavam no schema com o ICP deles dentro: regex de
--    faturamento de infoproduto e lista de cargos de quem compra imersão.
--    Trigger desabilitado é armadilha: alguém o reativa daqui a seis meses
--    achando que está "ligando o scoring", e a base recebe a régua errada.
--    A régua passa a ter um lugar só, que é a tabela scoring_config.
--
-- 2) Semeia scoring_config, que veio vazia. Sem ela, score_lead_from_config
--    cai no RETURN NEW e nada é pontuado.

DROP TRIGGER IF EXISTS trigger_classify_lead_etiqueta ON public.leads;
DROP FUNCTION IF EXISTS public.classify_lead_etiqueta();

-- Régua inicial da Health & Safety.
--
-- ⚠️ PROVISÓRIA, e de propósito. A régua definitiva é decisão de produto do
-- Erick e do Nicholson, e o lugar de tomá-la é com a base real na tela, depois
-- que o lote 1B mostrar os contatos importados. O que esta migration garante é
-- que o MECANISMO funcione e que trocar os valores seja um UPDATE nesta linha.
--
-- Os cargos herdam a lista de decisores do original, ampliada com os papéis que
-- decidem compra de bafômetro e calibração na indústria (SESMT, segurança do
-- trabalho, RH). O faturamento NÃO herda nada: as faixas do original vinham do
-- formulário de um evento de infoproduto e não existem em formulário nenhum da
-- HS. Enquanto não houver faixa definida, o critério fica desligado — nenhum
-- lead ganha pontos por um campo que ninguém coleta.
INSERT INTO public.scoring_config (criteria, thresholds)
VALUES (
  jsonb_build_object(
    'cargo_decisor', jsonb_build_object(
      'enabled', true,
      'pontos', 30,
      'cargos', jsonb_build_array(
        'CEO','Fundador','Sócio','Proprietário','Dono','Diretor','Gerente',
        'Coordenador','Responsável','SESMT','Segurança do Trabalho','RH')),
    'faturamento', jsonb_build_object('enabled', false, 'pontos', 0, 'faixas', '[]'::jsonb),
    'origem', jsonb_build_object(
      'enabled', true, 'pontos', 10,
      'sources', jsonb_build_array('site','indicacao','csv_import'))
  ),
  jsonb_build_object('hotlead', 60, 'warm', 30)
);
```

⚠️ **Leia `score_lead_from_config` antes de rodar** — o corpo dela está no banco
(`SELECT prosrc FROM pg_proc WHERE proname='score_lead_from_config'`) e é ela
que define os nomes das chaves de `criteria` que valem. Se o JSON acima usar uma
chave que a função não lê, o critério é ignorado em silêncio e o score sai
sempre 0. Confira chave por chave e ajuste o INSERT ao que a função espera.

- [ ] **Passo 3: aplicar e provar que o scoring passou a existir**

```bash
psql "$U" -v ON_ERROR_STOP=1 -f backend/migrations/004_regua_de_scoring.sql

psql "$U" -tAc "
  INSERT INTO leads (email, tipo, cargo, source)
  VALUES ('teste-regua@exemplo.com', 'teste', 'Gerente de SESMT', 'site')
  RETURNING email, cargo, etiqueta, lead_score;"
psql "$U" -tAc "DELETE FROM leads WHERE email='teste-regua@exemplo.com';"
```

Esperado: `lead_score` **maior que zero** (30 do cargo + 10 da origem = 40, se
as chaves do JSON casarem com o que a função lê). Se vier 0, o INSERT do passo 2
usou chave que `score_lead_from_config` não conhece — volte e compare com o
corpo da função.

`etiqueta` deve vir NULL: 40 está abaixo do limiar `warm` de 30… **confira o que
a função faz com os thresholds** antes de decidir se NULL é o esperado. Se ela
atribuir `warm` a partir de 30, o certo aqui é `warm`, não NULL.

- [ ] **Passo 4: commit**

```bash
git add backend/migrations/004_regua_de_scoring.sql
git commit -m "fix(scoring): o scoring passa a existir, e a régua é da HS

scoring_config veio vazia no dump, e score_lead_from_config começa com
IF v_criteria IS NULL THEN RETURN NEW. Resultado: nada era pontuado.

Sai também classify_lead_etiqueta, com trigger e função. Ela já chegou
DESABILITADA — a própria dn.ia a desligou —, mas continuava no schema com o
ICP deles dentro. Trigger desabilitado é armadilha: alguém o reativa daqui a
seis meses achando que liga o scoring, e a base recebe a régua errada.

A régua semeada é provisória de propósito. Os cargos herdam a lista de
decisores e ganham os papéis que decidem compra de bafômetro e calibração;
o critério de faturamento fica DESLIGADO, porque as faixas do original vinham
do formulário de um evento de infoproduto e nenhum formulário da HS coleta
esse campo."
```

---

## Tarefa 2: A regra de mesclagem, isolada e testada

**Arquivos:**
- Cria: `backend/app/dominio/importacao.py`, `backend/app/dominio/__init__.py`,
  `backend/tests/test_importacao.py`

**Interfaces:**
- Produz: `LinhaCsv` (dataclass), `campos_para_gravar(linha, existente, modo) -> dict`,
  `MODOS = ('enriquecer', 'sobrescrever')`

Esta é a única parte do lote com teste automatizado, e a razão é a mesma de
sempre: **executar não prova.** Uma importação em modo "enriquecer" que
sobrescreve um campo já preenchido apaga dado que alguém digitou, e a tela não
mostra diferença — os dois casos parecem "importou com sucesso".

- [ ] **Passo 1: escrever o teste que falha**

`backend/tests/test_importacao.py`:

```python
"""A regra de mesclagem da importação.

Testada porque o erro dela é silencioso: em modo enriquecer, sobrescrever um
campo já preenchido apaga o que alguém digitou, e a tela diz "importado com
sucesso" nos dois casos.
"""
import pytest

from app.dominio.importacao import LinhaCsv, campos_para_gravar


def _existente(**kw):
    base = dict(nome="Maria", whatsapp="", empresa=None, cargo="Gerente",
                faturamento=None, funcionarios=None, desafios=None,
                source="site", status="Lead")
    base.update(kw)
    return base


def test_enriquecer_preenche_so_o_que_esta_vazio():
    linha = LinhaCsv(email="a@b.c", nome="Maria Souza", whatsapp="11999998888",
                     empresa="Acme")
    campos = campos_para_gravar(linha, _existente(), "enriquecer")
    # whatsapp era "" e empresa era None: os dois entram.
    assert campos == {"whatsapp": "11999998888", "empresa": "Acme"}
    # nome já tinha valor: não entra, mesmo o CSV trazendo um diferente.
    assert "nome" not in campos


def test_sobrescrever_grava_tudo_que_o_csv_trouxe():
    linha = LinhaCsv(email="a@b.c", nome="Maria Souza", empresa="Acme")
    campos = campos_para_gravar(linha, _existente(), "sobrescrever")
    assert campos == {"nome": "Maria Souza", "empresa": "Acme"}


def test_campo_vazio_no_csv_nunca_apaga_o_que_existe():
    # Vale para os DOIS modos: CSV sem valor não é instrução de apagar.
    linha = LinhaCsv(email="a@b.c", nome="", empresa=None)
    assert campos_para_gravar(linha, _existente(), "enriquecer") == {}
    assert campos_para_gravar(linha, _existente(), "sobrescrever") == {}


def test_status_invalido_e_ignorado_e_nao_vira_lixo_na_coluna():
    linha = LinhaCsv(email="a@b.c", status="Status Que Nao Existe")
    assert campos_para_gravar(linha, _existente(status=None), "sobrescrever") == {}


def test_status_valido_casa_sem_diferenciar_maiuscula():
    linha = LinhaCsv(email="a@b.c", status="lead qualificado")
    campos = campos_para_gravar(linha, _existente(status=None), "enriquecer")
    assert campos == {"status": "Lead Qualificado"}


def test_whatsapp_aceita_o_telefone_completo_como_alternativa():
    linha = LinhaCsv(email="a@b.c", telefone_completo="+5511999998888")
    campos = campos_para_gravar(linha, _existente(whatsapp=None), "enriquecer")
    assert campos == {"whatsapp": "+5511999998888"}


def test_modo_desconhecido_e_erro_e_nao_silencio():
    with pytest.raises(ValueError):
        campos_para_gravar(LinhaCsv(email="a@b.c"), _existente(), "mesclar")
```

- [ ] **Passo 2: rodar e ver falhar**

Rode: `cd backend && ./.venv/bin/pytest tests/test_importacao.py -q`
Esperado: FALHA com `ModuleNotFoundError: No module named 'app.dominio'`

- [ ] **Passo 3: `backend/app/dominio/importacao.py`**

```python
"""A regra de mesclagem da importação de CSV, isolada do transporte.

Portada de `supabase/functions/import-leads-csv`, com um nome melhor para os
modos: o original usava 'enrich' e 'overwrite'.
"""

from dataclasses import dataclass

# Os status que a coluna aceita. Vieram da function de origem; quando a régua
# de funil da HS for definida, esta lista sai daqui e vai para lead_statuses.
STATUS_VALIDOS = (
    "Lead",
    "Iniciado",
    "Lead Qualificado",
    "MQL - Reunião agendada",
    "SQL - Em negociação",
    "Em contrato",
    "Venda realizada",
)

MODOS = ("enriquecer", "sobrescrever")

# Campo do CSV -> coluna de `leads`. `desafios_ia` vira `desafios`, e o
# telefone tem duas entradas possíveis (ver `_valor`).
_CAMPOS = (
    ("nome", "nome"),
    ("whatsapp", "whatsapp"),
    ("empresa", "empresa"),
    ("cargo", "cargo"),
    ("faturamento", "faturamento"),
    ("funcionarios", "funcionarios"),
    ("desafios_ia", "desafios"),
    ("source", "source"),
)


@dataclass
class LinhaCsv:
    email: str
    nome: str | None = None
    whatsapp: str | None = None
    telefone_completo: str | None = None
    empresa: str | None = None
    cargo: str | None = None
    faturamento: str | None = None
    funcionarios: str | None = None
    desafios_ia: str | None = None
    source: str | None = None
    status: str | None = None
    tipo: str | None = None


def normalizar_status(bruto: str | None) -> str | None:
    """Casa sem diferenciar maiúscula. Status que não existe vira None em vez de
    entrar na coluna como texto livre."""
    if not bruto:
        return None
    s = bruto.strip()
    for valido in STATUS_VALIDOS:
        if valido.lower() == s.lower():
            return valido
    return None


def _valor(linha: LinhaCsv, campo: str) -> str | None:
    if campo == "whatsapp":
        # O CSV pode trazer o número em qualquer uma das duas colunas.
        return linha.whatsapp or linha.telefone_completo
    return getattr(linha, campo)


def _vazio(valor) -> bool:
    return valor is None or valor == ""


def campos_para_gravar(linha: LinhaCsv, existente: dict, modo: str) -> dict:
    """Decide o que gravar num contato que já existe.

    ⚠️ Campo vazio no CSV NUNCA apaga o que já está lá, nos dois modos. Um CSV
    exportado de outra ferramenta quase sempre vem com colunas em branco, e
    tratá-las como "apague isto" destruiria a base na primeira importação.
    """
    if modo not in MODOS:
        raise ValueError(f"modo de importação desconhecido: {modo!r}")

    campos: dict[str, str] = {}

    for origem, coluna in _CAMPOS:
        novo = _valor(linha, origem)
        if _vazio(novo):
            continue
        if modo == "enriquecer" and not _vazio(existente.get(coluna)):
            continue
        campos[coluna] = novo

    status = normalizar_status(linha.status)
    if status and not (modo == "enriquecer" and not _vazio(existente.get("status"))):
        campos["status"] = status

    return campos
```

Crie também `backend/app/dominio/__init__.py` vazio.

- [ ] **Passo 4: rodar e ver passar**

Rode: `cd backend && ./.venv/bin/pytest tests/test_importacao.py -v`
Esperado: **7 passed**

- [ ] **Passo 5: commit**

```bash
git add backend/app/dominio backend/tests/test_importacao.py
git commit -m "feat(importacao): regra de mesclagem isolada e testada

Testada porque o erro dela é silencioso: em modo enriquecer, sobrescrever um
campo preenchido apaga o que alguém digitou, e a tela diz 'importado com
sucesso' nos dois casos.

A regra que mais importa: campo vazio no CSV nunca apaga o que já existe, nos
dois modos. CSV exportado de outra ferramenta quase sempre vem com colunas em
branco, e tratá-las como 'apague isto' destruiria a base na primeira importação."
```

---

## Tarefa 3: A rota de importação

**Arquivos:**
- Cria: `backend/app/routers/contatos.py`
- Modifica: `backend/app/main.py`

**Interfaces:**
- Consome: `campos_para_gravar` (tarefa 2), `admin_atual` e `sessao` (lote 0)
- Produz: `POST /contatos/importar` recebendo
  `{"linhas": [...], "modo": "enriquecer"|"sobrescrever"}` e devolvendo
  `{criados, atualizados, inalterados, sem_email, erros: [...]}`

- [ ] **Passo 1: `backend/app/routers/contatos.py`**

```python
"""Rotas de contato. Substitui import-leads-csv, recalculate-all-scores e
apply-lead-tag."""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, admin_atual
from app.dominio.importacao import MODOS, LinhaCsv, campos_para_gravar, normalizar_status

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/contatos", tags=["contatos"])

# Quantos e-mails por SELECT ... WHERE email = ANY($1). O original usava 500 e
# não há razão para mudar.
LOTE_CONSULTA = 500


class LinhaImportacao(BaseModel):
    email: str
    nome: str | None = None
    whatsapp: str | None = None
    telefone_completo: str | None = None
    empresa: str | None = None
    cargo: str | None = None
    faturamento: str | None = None
    funcionarios: str | None = None
    desafios_ia: str | None = None
    source: str | None = None
    status: str | None = None
    tipo: str | None = None


class ImportacaoIn(BaseModel):
    linhas: list[LinhaImportacao] = Field(min_length=1, max_length=20000)
    modo: str = Field(default="enriquecer", pattern="^(enriquecer|sobrescrever)$")


class ImportacaoOut(BaseModel):
    criados: int
    atualizados: int
    inalterados: int
    sem_email: int
    erros: list[str]


@router.post("/importar", response_model=ImportacaoOut)
async def importar(dados: ImportacaoIn, _: Usuario = Depends(admin_atual)):
    if dados.modo not in MODOS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Modo de importação inválido.")

    criados = atualizados = inalterados = sem_email = 0
    erros: list[str] = []

    # E-mail é a chave de deduplicação, sempre em minúsculas. Linha sem e-mail
    # não tem como ser deduplicada e é contada à parte em vez de virar um
    # contato órfão.
    por_email: dict[str, LinhaCsv] = {}
    for linha in dados.linhas:
        email = (linha.email or "").strip().lower()
        if not email:
            sem_email += 1
            continue
        por_email[email] = LinhaCsv(**{**linha.model_dump(), "email": email})

    if not por_email:
        return ImportacaoOut(criados=0, atualizados=0, inalterados=0,
                             sem_email=sem_email, erros=[])

    emails = list(por_email)

    async with sessao(role="service_role") as conn:
        existentes: dict[str, dict] = {}
        for i in range(0, len(emails), LOTE_CONSULTA):
            fatia = emails[i:i + LOTE_CONSULTA]
            linhas = await conn.fetch(
                """SELECT id::text, lower(email) AS email, nome, whatsapp, empresa,
                          cargo, faturamento, funcionarios, desafios, source, status
                     FROM leads WHERE lower(email) = ANY($1::text[])""",
                fatia,
            )
            for l in linhas:
                existentes[l["email"]] = dict(l)

        for email, linha in por_email.items():
            existente = existentes.get(email)
            try:
                if existente is None:
                    novo_id = await conn.fetchval(
                        """INSERT INTO leads (email, tipo, status, source, nome, whatsapp,
                                              empresa, cargo, faturamento, funcionarios, desafios)
                           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                           RETURNING id""",
                        email,
                        linha.tipo or "csv_import",
                        normalizar_status(linha.status) or "Lead",
                        linha.source or "csv_import",
                        linha.nome, linha.whatsapp or linha.telefone_completo,
                        linha.empresa, linha.cargo, linha.faturamento,
                        linha.funcionarios, linha.desafios_ia,
                    )
                    criados += 1
                    await _resolver_identidade(conn, novo_id, linha, email)
                    continue

                campos = campos_para_gravar(linha, existente, dados.modo)
                if not campos:
                    inalterados += 1
                    continue

                # asyncpg não aceita nome de coluna parametrizado. As chaves vêm
                # de _CAMPOS em app/dominio/importacao.py — lista fechada no
                # código, nunca do corpo da requisição.
                atribuicoes = ", ".join(f"{c} = ${i + 2}" for i, c in enumerate(campos))
                await conn.execute(
                    f"UPDATE leads SET {atribuicoes} WHERE id = $1::uuid",
                    existente["id"], *campos.values(),
                )
                atualizados += 1
            except Exception as exc:  # noqa: BLE001 — uma linha ruim não derruba o lote
                logger.warning("Falha ao importar %s: %s", email, exc)
                erros.append(f"{email}: {exc}")

    return ImportacaoOut(criados=criados, atualizados=atualizados,
                         inalterados=inalterados, sem_email=sem_email, erros=erros)


async def _resolver_identidade(conn, lead_id, linha: LinhaCsv, email: str) -> None:
    """Amarra o contato novo à identidade do ecossistema.

    `resolve_or_create_identity` é PL/pgSQL, sobreviveu à portagem do schema e
    **devolve `jsonb`** — verificado. O codec que `app/database.py` registra
    decodifica isso para um `dict` do Python, então `resultado.get(...)`
    funciona direto. Não reimplemente em Python.

    Falha aqui não desfaz a importação: o contato existe e a identidade pode
    ser reconciliada depois.
    """
    try:
        resultado = await conn.fetchval(
            """SELECT resolve_or_create_identity(
                   p_phone => $1, p_email => $2, p_nome => $3,
                   p_source_app => 'marketinghs', p_local_id => $4,
                   p_utm_source => $5, p_stage => 'lead')""",
            linha.whatsapp or linha.telefone_completo, email, linha.nome,
            lead_id, linha.source,
        )
        if resultado and resultado.get("dnia_id"):
            await conn.execute(
                "UPDATE leads SET dnia_id = $2, phone_normalized = $3 WHERE id = $1",
                lead_id, resultado["dnia_id"], resultado.get("phone_normalized"),
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Identidade não resolvida para %s: %s", email, exc)
```

- [ ] **Passo 2: registrar em `backend/app/main.py`**

```python
from app.routers.contatos import router as contatos_router

app.include_router(contatos_router)
```

- [ ] **Passo 3: importar um CSV de verdade e conferir no banco**

```bash
cd backend && (nohup ./.venv/bin/python -m uvicorn app.main:app --port 8100 >/tmp/b.log 2>&1 & disown)
curl -s --retry 20 --retry-delay 1 --retry-connrefused -o /dev/null localhost:8100/health
T=$(curl -s -X POST localhost:8100/auth/login -H 'Content-Type: application/json' \
    -d '{"email":"erick@healthsafety.com.br","senha":"trocar-depois"}' \
    | ./.venv/bin/python -c 'import sys,json;print(json.load(sys.stdin)["token"])')

curl -s -X POST localhost:8100/contatos/importar -H "Authorization: Bearer $T" \
  -H 'Content-Type: application/json' -d '{
  "modo": "enriquecer",
  "linhas": [
    {"email":"ana@empresa.com.br","nome":"Ana Lima","cargo":"Gerente de SESMT","empresa":"Transportes Lima"},
    {"email":"ANA@empresa.com.br","nome":"Ana L."},
    {"email":"","nome":"Sem email"},
    {"email":"bruno@obra.com.br","nome":"Bruno Reis","status":"lead qualificado"}
  ]}' | ./.venv/bin/python -m json.tool
```

Esperado: `criados: 2`, `sem_email: 1`, `erros: []`. O segundo `ANA@` é a mesma
pessoa em maiúsculas — se vier `criados: 3`, a deduplicação por e-mail em
minúsculas quebrou.

Confira no banco que os triggers rodaram:

```bash
psql "$U" -c "SELECT email, status, tipo, source, etiqueta, lead_score,
                     dnia_id IS NOT NULL AS tem_identidade
                FROM leads ORDER BY created_at;"
psql "$U" -c "SELECT l.email, ce.event_type FROM contact_events ce
                JOIN leads l ON l.id = ce.lead_id;"
```

Esperado: `status` do Bruno normalizado para `Lead Qualificado`; `etiqueta` NULL
nos dois (a régua da tarefa 1 não casa faturamento); e **um `contact_event` por
lead**, criado pelo trigger `trg_lead_insert_event`. Se a timeline vier vazia, o
trigger não disparou e o lote 1B não terá o que mostrar.

- [ ] **Passo 4: limpar o teste**

```bash
psql "$U" -c "DELETE FROM leads WHERE email IN ('ana@empresa.com.br','bruno@obra.com.br');"
```

- [ ] **Passo 5: commit**

```bash
git add backend/app/routers/contatos.py backend/app/main.py
git commit -m "feat(contatos): rota de importação de CSV

Deduplica por e-mail em minúsculas, uma linha ruim não derruba o lote, e
linha sem e-mail é contada à parte em vez de virar contato órfão.

resolve_or_create_identity continua sendo a RPC PL/pgSQL do banco, que
sobreviveu à portagem do schema. Falha na identidade não desfaz a importação:
o contato existe e a identidade se reconcilia depois."
```

---

## Tarefa 4: Recalcular scores e ler/gravar a régua

**Arquivos:**
- Modifica: `backend/app/routers/contatos.py`
- Cria: `backend/app/routers/configuracao.py`
- Modifica: `backend/app/main.py`

**Interfaces:**
- Produz: `POST /contatos/recalcular-scores` → `{atualizados: int}`;
  `GET /config/scoring` → `{criteria, thresholds, updated_at}`;
  `PUT /config/scoring`; `GET /tags` → `[{id, nome}]`

- [ ] **Passo 1: acrescentar em `backend/app/routers/contatos.py`**

```python
class RecalculoOut(BaseModel):
    atualizados: int


@router.post("/recalcular-scores", response_model=RecalculoOut)
async def recalcular_scores(_: Usuario = Depends(admin_atual)):
    """Reaplica a régua a toda a base.

    O original percorria os leads em Deno e recalculava em TypeScript. Aqui não
    há laço: o score é um trigger BEFORE UPDATE, então basta um UPDATE que toque
    uma coluna vigiada. Menos código e uma fonte de verdade a menos para divergir.

    ⚠️ **Consequência que o original também tinha e ninguém documentou:** o
    trigger `update_leads_updated_at` faz `NEW.updated_at = now()` em qualquer
    UPDATE. Então recalcular a base inteira carimba `updated_at` em todos os
    contatos ao mesmo tempo — e `useLeads` ordena por `updated_at DESC`. Depois
    de um recálculo, a ordem da lista de contatos vira arbitrária.

    Não dá para evitar sem desligar o trigger, o que é pior. O lote 1B deve
    decidir se a lista passa a ordenar por `created_at`, que é estável.
    """
    async with sessao(role="service_role") as conn:
        # ⚠️ Tem de tocar uma das colunas da lista do trigger:
        #   BEFORE INSERT OR UPDATE OF cargo, faturamento, funcionarios,
        #                              desafios, whatsapp, utm_source, source
        # Um UPDATE em qualquer outra coluna NÃO dispara o scoring, e a rota
        # responderia "atualizados: N" sem ter recalculado nada — o pior tipo
        # de erro, o que se reporta como sucesso.
        resultado = await conn.execute("UPDATE leads SET cargo = cargo")
    return RecalculoOut(atualizados=int(resultado.rsplit(" ", 1)[-1]))
```

- [ ] **Passo 2: `backend/app/routers/configuracao.py`**

```python
"""Configuração do sistema. Tira do navegador o acesso direto a scoring_config
e a tags — dois dos 68 pontos que a spec mandou fechar."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

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
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            "SELECT id::text, name AS nome FROM tags ORDER BY name")
    return [TagOut(**dict(l)) for l in linhas]
```

✅ Verificado no banco: `tags` tem `id, name, color, created_at`. O `name` do
schema vira `nome` na resposta — a tradução mora aqui e em nenhum outro lugar.

- [ ] **Passo 3: registrar e conferir**

```python
from app.routers.configuracao import router as configuracao_router

app.include_router(configuracao_router)
```

```bash
curl -s localhost:8100/config/scoring -H "Authorization: Bearer $T" | ./.venv/bin/python -m json.tool | head -20
curl -s localhost:8100/tags -H "Authorization: Bearer $T"
curl -s -X POST localhost:8100/contatos/recalcular-scores -H "Authorization: Bearer $T"
```

Esperado: a régua da tarefa 1; a lista de tags (vazia se ninguém criou nenhuma);
e `{"atualizados": N}` com N igual ao total de leads.

- [ ] **Passo 4: commit**

```bash
git add backend/app/routers backend/app/main.py
git commit -m "feat(config): régua de scoring e tags saem do acesso direto ao banco

recalcular-scores não tem laço: o score é um trigger BEFORE UPDATE, então um
UPDATE que não muda coluna nenhuma já faz o banco recalcular tudo. O original
percorria os leads em Deno e recalculava em TypeScript — uma segunda fonte de
verdade que podia divergir do trigger sem ninguém notar."
```

---

## Tarefa 5: Aplicar etiqueta a um contato

**Arquivos:**
- Modifica: `backend/app/routers/contatos.py`

**Interfaces:**
- Produz: `POST /contatos/{lead_id}/tags` recebendo `{"tag": "nome-da-tag"}`

- [ ] **Passo 1: ler a function de origem antes de escrever**

```bash
cat backend/supabase/functions/apply-lead-tag/index.ts
```

Ela cria a tag se não existir e associa ao lead. Confira se há regra que este
plano não previu — normalização do nome, limite de tags por lead, evento na
timeline — e **implemente o que encontrar, anotando no commit**.

- [ ] **Passo 2: acrescentar em `backend/app/routers/contatos.py`**

```python
class EtiquetaIn(BaseModel):
    tag: str = Field(min_length=1, max_length=100)


@router.post("/{lead_id}/tags", status_code=status.HTTP_204_NO_CONTENT)
async def aplicar_tag(lead_id: str, dados: EtiquetaIn,
                      _: Usuario = Depends(admin_atual)):
    """Cria a tag se ainda não existir e associa ao contato.

    Idempotente: aplicar a mesma tag duas vezes não é erro, é ausência de
    mudança. A importação aplica tags em lote e reprocessar um arquivo é
    normal — falhar aí seria hostil sem motivo.
    """
    nome = dados.tag.strip()
    if not nome:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Tag vazia.")

    async with sessao(role="service_role") as conn:
        existe = await conn.fetchval("SELECT 1 FROM leads WHERE id = $1::uuid", lead_id)
        if not existe:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Contato não encontrado.")

        tag_id = await conn.fetchval(
            "SELECT id FROM tags WHERE lower(name) = lower($1)", nome)
        if tag_id is None:
            tag_id = await conn.fetchval(
                "INSERT INTO tags (name) VALUES ($1) RETURNING id", nome)

        await conn.execute(
            """INSERT INTO lead_tags (lead_id, tag_id) VALUES ($1::uuid, $2)
               ON CONFLICT DO NOTHING""",
            lead_id, tag_id)
```

✅ **`ON CONFLICT DO NOTHING` funciona aqui**: verifiquei no banco que a chave
primária de `lead_tags` é `(lead_id, tag_id)`. É ela que impede a associação
duplicada quando alguém reimporta o mesmo arquivo. Não relaxe essa PK.

- [ ] **Passo 3: conferir**

```bash
ID=$(psql "$U" -tAc "SELECT id FROM leads LIMIT 1")
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:8100/contatos/$ID/tags \
     -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"tag":"importado-agosto"}'
# de novo: idempotente, tem de dar 204 outra vez
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:8100/contatos/$ID/tags \
     -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"tag":"importado-agosto"}'
psql "$U" -c "SELECT t.name, count(*) FROM lead_tags lt JOIN tags t ON t.id=lt.tag_id GROUP BY 1;"
```

Esperado: `204` nas duas vezes e **uma** associação, não duas.

- [ ] **Passo 4: commit**

---

## Tarefa 6: A tela de importação

**Arquivos:**
- Cria: `frontend/src/lib/contatos.ts`
- Modifica: `frontend/src/components/admin/LeadsImport.tsx`,
  `frontend/src/hooks/useScoringConfig.tsx`

**Interfaces:**
- Consome: as rotas das tarefas 3, 4 e 5
- Produz: `importarContatos`, `aplicarTag`, `listarTags`, `lerScoring`, `gravarScoring`

- [ ] **Passo 1: acrescentar `put` em `frontend/src/lib/api.ts`**

O cliente do lote 0 tem `get`, `post`, `patch` e `delete` — não tem `put`, e
`gravarScoring` precisa dele. Acrescente na constante `api`:

```ts
  put: <T>(c: string, corpo?: unknown) => pedir<T>('PUT', c, corpo),
```

- [ ] **Passo 2: `frontend/src/lib/contatos.ts`**

```ts
import { api } from '@/lib/api';

export interface LinhaImportacao {
  email: string;
  nome?: string;
  whatsapp?: string;
  telefone_completo?: string;
  empresa?: string;
  cargo?: string;
  faturamento?: string;
  funcionarios?: string;
  desafios_ia?: string;
  source?: string;
  status?: string;
  tipo?: string;
}

export interface ResultadoImportacao {
  criados: number;
  atualizados: number;
  inalterados: number;
  sem_email: number;
  erros: string[];
}

export const importarContatos = (
  linhas: LinhaImportacao[],
  modo: 'enriquecer' | 'sobrescrever',
) => api.post<ResultadoImportacao>('/contatos/importar', { linhas, modo });

export const aplicarTag = (leadId: string, tag: string) =>
  api.post<void>(`/contatos/${leadId}/tags`, { tag });

export const listarTags = () =>
  api.get<{ id: string; nome: string }[]>('/tags');

export const recalcularScores = () =>
  api.post<{ atualizados: number }>('/contatos/recalcular-scores');

export interface Scoring { criteria: Record<string, unknown>; thresholds: Record<string, unknown>; updated_at: string | null }
export const lerScoring = () => api.get<Scoring>('/config/scoring');
export const gravarScoring = (s: Omit<Scoring, 'updated_at'>) =>
  api.put<Scoring>('/config/scoring', s);
```

- [ ] **Passo 3: trocar os 3 pontos de `LeadsImport.tsx`**

Os três são: `functions.invoke('import-leads-csv')` (linha ~257),
`functions.invoke('apply-lead-tag')` (~304) e `supabase.from('tags')` (~326).

Troque por `importarContatos`, `aplicarTag` e `listarTags`. Dois cuidados:

1. O corpo mudou de nome: era `{ leads, mergeMode: 'enrich' | 'overwrite' }`,
   agora é `{ linhas, modo: 'enriquecer' | 'sobrescrever' }`. Se a tela expõe o
   modo num seletor, traduza no ponto da chamada, não espalhe o nome novo.
2. `apply-lead-tag` recebia o e-mail; a rota nova recebe o **id no caminho**.
   Se a tela só tem o e-mail em mãos, use o retorno da importação — e se ele não
   trouxer id, esse é um achado a reportar, não a contornar com uma busca extra.

- [ ] **Passo 4: trocar os 2 pontos de `useScoringConfig.tsx`**

`supabase.from('scoring_config').select()` → `lerScoring()`;
`supabase.from('scoring_config').update()` → `gravarScoring()`.

Acrescente na tela de Lead Scoring um aviso de que **salvar não repontua a
base**, com o botão que chama `recalcularScores()`. Sem isso alguém edita a
régua, vê a tela dizer "salvo", e conclui que os leads foram reclassificados —
não foram.

- [ ] **Passo 5: conferir no navegador**

```bash
cd frontend && npx vite --port 8080
```

Com Playwright em `http://127.0.0.1:8080/import`: suba um CSV pequeno de
verdade, com pelo menos um e-mail repetido em maiúsculas e uma linha sem e-mail.
Confira que o resultado na tela bate com o banco. Depois vá em
**Configurações → Lead Scoring**, edite um valor, salve, e confirme que o aviso
sobre repontuar aparece.

- [ ] **Passo 6: commit**

---

## Tarefa 7: Fechar o lote

- [ ] **Passo 1: o portão, as duas metades**

```bash
grep -rn "supabase" frontend/src/components/admin/LeadsImport.tsx \
                    frontend/src/hooks/useScoringConfig.tsx
```

Esperado: **nenhuma linha.** E as telas conferidas no navegador no passo 4 da
tarefa 6. Só com as duas coisas:

```bash
git rm -r backend/supabase/functions/{import-leads-csv,recalculate-all-scores,apply-lead-tag}
```

- [ ] **Passo 2: o placar, dois números**

```bash
echo "functions portadas: $((48 - $(ls backend/supabase/functions | grep -v _shared | wc -l) + 6))/48"
echo "arquivos do front ainda no Supabase: $(grep -rl 'supabase\.' frontend/src | grep -v integrations/supabase | wc -l)"
```

Esperado: `9/48` e o número de arquivos caindo de 45 para 43.

- [ ] **Passo 3: atualizar `docs/ROADMAP.md` e `docs/CONTINUAR-AQUI.md`**

Marque 1A como concluído, registre o placar, e leve para as pendências a
**decisão de produto que este lote deixou aberta**: a régua de ICP da HS. Diga
onde ela mora (`scoring_config.criteria->'icp'`), que hoje o
`regex_faturamento` é `'$a'` (não casa com nada, nenhuma etiqueta é atribuída)
e que trocá-la é um `UPDATE`, não uma migration.

- [ ] **Passo 4: commit**

---

## Definição de pronto do lote 1A

- [ ] `pytest` passa: 6 de `test_security.py` + 7 de `test_importacao.py`
- [ ] Um CSV real importado pela tela, com o resultado batendo com o banco
- [ ] E-mail repetido em maiúsculas não duplica contato
- [ ] Linha sem e-mail é contada à parte, não vira contato órfão
- [ ] Cada contato importado tem um `contact_event` (o trigger disparou)
- [ ] Aplicar a mesma tag duas vezes não duplica a associação
- [ ] A tela de Lead Scoring lê e grava a régua, e avisa que salvar não repontua
- [ ] `grep` limpo nas duas telas do lote
- [ ] As 3 functions saíram de `backend/supabase/functions/`

## Perguntas que este lote levanta e não responde

1. **Qual é o ICP da Health & Safety?** Faturamento, porte, setor, cargo — o que
   faz um lead valer a ligação do comercial. Hoje o `regex_faturamento` é `'$a'`
   e nenhuma etiqueta é atribuída, que é o comportamento seguro enquanto
   ninguém decidiu.
2. **A lista de contatos deve ordenar por `updated_at` ou `created_at`?**
   Recalcular scores carimba `updated_at` em toda a base de uma vez e embaralha
   a ordem atual. Decisão do lote 1B, mas nasce aqui.
3. **O funil da HS é o mesmo do original?** `STATUS_VALIDOS` tem sete valores
   herdados (`MQL - Reunião agendada`, `SQL - Em negociação`…). Se o GrowthHS
   usa outro vocabulário, alinhar antes do lote 5 evita traduzir status no
   handoff.
