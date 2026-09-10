# MarketingHS — Lote 8B: API de contato — Plano

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para executar tarefa a tarefa.
> Os passos usam caixa de seleção (`- [ ]`) para acompanhamento.

**Objetivo:** portar as três functions que sistemas externos usam para escrever
num contato — `contact-update`, `contact-status-update` e `contact-tags-sync` —
como rotas por chave de API em `/publico/contato`, e corrigir a documentação,
que ainda ensina os três endereços mortos.

**Arquitetura:** um router novo, `app/routers/api_contato.py`, sob `/publico`
(e portanto sob o limite de taxa do lote 0), autenticado por
`chave_api("write")`. O status reusa `_resolver_status` e `_registrar_mudanca`
do admin (`escrita_contatos.py`), para as duas portas de escrita concordarem
sobre o que é uma mudança de status. A forma das respostas segue a da origem,
porque quem consome é sistema de terceiro.

**Stack:** FastAPI + asyncpg · pytest

**Spec:** `docs/superpowers/specs/2026-08-31-marketinghs-design.md`
**Documento-mãe:** `docs/superpowers/plans/2026-09-10-marketinghs-lote-8-fechamento.md`

---

## Restrições globais

Valem para **toda** tarefa deste plano.

- **`sessao()` é o único caminho para dado.** Nunca superusuário.
- **`role="service_role"` + autorização explícita na rota** — aqui,
  `Depends(chave_api("write"))`. O chamador é sistema externo; não há
  `user_id`.
- **Nenhum endpoint depende do RLS para autorizar.**
- **Toda chave lida do ambiente precisa estar declarada em `Settings`.** Este
  plano não lê chave nova.
- **Comentário e nome em português; chaves de RESPOSTA como na origem**
  (`success`, `dnia_id`, `updated_fields`...). Mudar o formato quebraria
  integração que não passa por nós — mesma regra do `publico.py:413-416`.
- **Colunas do UPDATE vêm de lista fechada no código**, nunca das chaves do
  corpo (`escrita_contatos.py:49-52`).
- ⚠️ **`contact_events` alimenta as jornadas** (gatilho
  `trg_contact_event_journey`, `migrations/010_jornadas.sql`) e o
  `status_changed_at` da listagem. Evento a mais ou a menos não é cosmético.
- ⚠️ **`source_app` é validado por gatilho.** Valores aceitos em
  `publico.py:32` (`SOURCE_APPS`).
- ⚠️ **Os testes gravam no banco real.** Fixture que usa o `cliente` limpa o que
  escreveu, antes e depois (padrão de `chamador` em `tests/test_conversao.py:43`).
  **Nunca mate o pytest no meio.** Timeout ≥600s na suíte inteira.
- **`pytest.ini` tem `asyncio_mode = auto`.**
- **Não escreva migration.**

---

## Decisões tomadas neste plano

| # | Decisão | Motivo |
|---|---|---|
| 1 | **Status desconhecido é 400 com a lista do que vale**, não criação automática como na origem | Decisão já tomada no lote 1D e implementada em `_resolver_status` (`escrita_contatos.py:69-94`): desde a migration 005, `lead_statuses` é a régua e `leads.status` tem FK para ela. Criar status por API seria mudar o funil da HS por um integrador. `status_created` continua na resposta, sempre `false`, para não quebrar quem lê o campo. |
| 2 | **O estágio da identidade NÃO avança para `opportunity` em "Lead Qualificado"** | Mesmo motivo do admin (`escrita_contatos.py:166-169`): a régua de quais status avançam o estágio é decisão de produto da HS e ainda não existe, e duas portas de escrita discordando é o padrão que já mordeu este projeto. ⚠️ **A origem avançava, e a documentação prometia.** Pergunta ao Erick registrada no portão; se ele decidir avançar, é uma linha nas duas rotas ao mesmo tempo. |
| 3 | `source_app = 'marketinghs'` nos três (a origem gravava `dnmarketing` e `nexus`) | É o sistema que registra. Mesma troca que a captura fez. O `metadata.source = 'api'` diz de onde veio. |
| 4 | Tag normalizada nas duas rotas que mexem com tag: sem `/` na frente, sem espaço nas pontas, minúscula; busca por `lower(name)` | É o `normalizeTag` do `contact-tags-sync`. A origem do `contact-update` não normalizava, e as duas discordavam; `tags-em-lote` do admin já busca por `lower(name)`. **Não** se aplica `TAG_VALIDA` (a de slug): os exemplos documentados têm espaço ("Evento Abril"), e recusá-los quebraria integrador. |
| 5 | Mudança de status pela rota de atualização geral (`PATCH /publico/contato` com `status`) grava os mesmos eventos da rota de status | Na origem, `contact-update` gravava o status cru, sem evento de status. Hoje isso cairia na FK com 500, e deixaria buraco no histórico de status. |
| 6 | `dnia_id` malformado dá **422** (validação do FastAPI), não 500 | A origem deixava o erro do banco subir. |
| 7 | `contact-status-update` com identidade cuja linha de lead não existe mais dá **404** | A origem respondia sucesso sem ter gravado nada. |

---

## O que já existe e não se reimplementa

| | |
|---|---|
| `chave_api("write")`, `gerar_chave()` | `backend/app/chave_api.py` |
| `_resolver_status(conn, bruto) -> str` | `escrita_contatos.py:69` — 400 com a lista, NÃO cria |
| `_registrar_mudanca(conn, lead_id, de, para)` | `escrita_contatos.py:111` — `contact_updated` + o evento específico de `_EVENTO_POR_STATUS` |
| `normalize_phone_br(texto)` | função do banco |
| `resolve_or_create_identity(p_phone, p_email, p_nome, p_source_app, p_local_id, p_utm_source, p_stage)` | devolve `jsonb` com `dnia_id` |
| fixtures `cliente`, `conexao` | `backend/tests/conftest.py` |

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| **Modificar** `backend/app/routers/escrita_contatos.py:111-142` | `_registrar_mudanca` ganha `origem` e `descricao` (padrões iguais aos de hoje) |
| **Criar** `backend/app/routers/api_contato.py` | as três rotas e seus ajudantes |
| **Modificar** `backend/app/main.py:113-116` | inclui o router |
| **Criar** `backend/tests/test_api_contato.py` | as três rotas |
| **Modificar** `frontend/src/components/admin/settings/ApiDocumentation.tsx:408-447, 585-652` | os três blocos |
| **Modificar** `frontend/public/api/dnmarketing-api.yaml:432, 912-1189` | os três caminhos |
| **Apagar** `backend/supabase/functions/contact-update`, `contact-status-update`, `contact-tags-sync` | no portão |

---

### Tarefa 1: Atualizar contato — `PATCH /publico/contato`

**Arquivos:**
- Modificar: `backend/app/routers/escrita_contatos.py:111-142`
- Criar: `backend/app/routers/api_contato.py`
- Modificar: `backend/app/main.py`
- Criar: `backend/tests/test_api_contato.py`

**Interfaces:**
- Consome: `chave_api`, `_resolver_status`, `_registrar_mudanca`.
- Produz:
  - `_registrar_mudanca(conn, lead_id, de, para, origem="manual", descricao="Mudança de status pelo painel")` — o admin continua chamando sem os dois argumentos.
  - `normalizar_tag(bruta) -> str`
  - `async def _id_da_tag(conn, nome: str) -> tuple[str, bool]` — `(tag_id, criada)`
  - `PATCH /publico/contato?dnia_id=|email=|phone=` → `{"success": True, "dnia_id": str|None, "updated_fields": list[str], "lead_score": int, "etiqueta": str|None}`
  - fixture `contato_api` (no próprio arquivo de teste): `{"lead_id", "dnia_id", "chave", "chave_leitura"}`

- [ ] **Passo 1: `_registrar_mudanca` aceita a origem**

Em `backend/app/routers/escrita_contatos.py`, troque a assinatura e o segundo
INSERT de `_registrar_mudanca`:

```python
async def _registrar_mudanca(conn, lead_id: str, de: str | None, para: str,
                             origem: str = "manual",
                             descricao: str = "Mudança de status pelo painel") -> None:
```

e, no INSERT do evento específico, troque o literal `'Mudança de status pelo painel'`
por `$5` e `'origem', 'manual'` por `'origem', $6::text`, passando os dois:

```python
        await conn.execute(
            """INSERT INTO contact_events (lead_id, dnia_id, source_app, event_type,
                                           title, description, metadata)
               SELECT $1::uuid, l.dnia_id, 'marketinghs', $2, $3, $5,
                      jsonb_build_object('status_anterior', $4::text, 'origem', $6::text)
                 FROM leads l WHERE l.id = $1::uuid""",
            lead_id, tipo, titulo, de, descricao, origem)
```

Os padrões são os valores de hoje: a rota do admin (`mudar_status`) não muda de
comportamento.

- [ ] **Passo 2: escrever os testes que falham**

Crie `backend/tests/test_api_contato.py`:

```python
"""A API de contato para sistema externo — o que eram contact-update,
contact-status-update e contact-tags-sync.

Nenhuma tela chama estas rotas: quem chama é integrador. O modo de falhar é
gravar no contato ERRADO, ou gravar sem deixar o evento que a listagem e as
jornadas leem — e ninguém percebe, porque a resposta volta 200.
"""

import pytest
import pytest_asyncio

import app.database as db
from app.chave_api import gerar_chave

EMAIL = "api-contato-8b@exemplo.invalid"
PREFIXO_TAG = "api-teste-8b"


def _auth(chave: str) -> dict:
    return {"Authorization": f"Bearer {chave}"}


async def _limpar(conn, hashes=()):
    lead_ids = [r["id"] for r in await conn.fetch(
        "SELECT id FROM leads WHERE email = $1", EMAIL)]
    dnias = [r["dnia_id"] for r in await conn.fetch(
        "SELECT dnia_id FROM ecosystem_identities WHERE lower(email) = $1", EMAIL)]
    for tabela in ("contact_events", "lead_notes", "lead_tags"):
        await conn.execute(f"DELETE FROM {tabela} WHERE lead_id = ANY($1::uuid[])",
                           lead_ids)
    await conn.execute("DELETE FROM leads WHERE id = ANY($1::uuid[])", lead_ids)
    await conn.execute("DELETE FROM ecosystem_identities WHERE dnia_id = ANY($1::uuid[])",
                       dnias)
    await conn.execute("DELETE FROM tags WHERE name LIKE $1", f"{PREFIXO_TAG}%")
    await conn.execute("DELETE FROM api_keys WHERE key_hash = ANY($1::text[])",
                       list(hashes))


@pytest_asyncio.fixture
async def contato_api():
    """Um contato com identidade, uma chave de escrita e uma de leitura.

    ⚠️ O `cliente` COMMITA. Limpa antes (pytest morto no meio deixa linha e o
    e-mail único derruba a rodada seguinte) e depois.
    """
    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")
    crua, hash_, prefixo = gerar_chave()
    crua_l, hash_l, prefixo_l = gerar_chave()
    async with db.sessao(role="service_role") as conn:
        await _limpar(conn, (hash_, hash_l))
        lead = await conn.fetchval(
            "INSERT INTO leads (nome, email, tipo, status) "
            "VALUES ('Contato API', $1, 'teste', 'Lead') RETURNING id::text", EMAIL)
        identidade = await conn.fetchval(
            "SELECT resolve_or_create_identity(NULL, $1, 'Contato API', "
            "'marketinghs', $2::uuid, NULL, 'lead')", EMAIL, lead)
        dnia = str(identidade["dnia_id"])
        # Explícito, para o teste não depender de como a function preenche o
        # vínculo canônico: a identidade aponta para ESTE lead.
        await conn.execute(
            "UPDATE ecosystem_identities SET dndash_lead_id = $2::uuid WHERE dnia_id = $1::uuid",
            dnia, lead)
        await conn.execute("UPDATE leads SET dnia_id = $2::uuid WHERE id = $1::uuid",
                           lead, dnia)
        await conn.execute(
            "INSERT INTO api_keys (name, key_hash, key_prefix, permissions) VALUES "
            "('teste 8B escrita', $1, $2, 'write'), ('teste 8B leitura', $3, $4, 'read')",
            hash_, prefixo, hash_l, prefixo_l)
    yield {"lead_id": lead, "dnia_id": dnia, "chave": crua, "chave_leitura": crua_l}
    async with db.sessao(role="service_role") as conn:
        await _limpar(conn, (hash_, hash_l))


async def _eventos(lead_id: str) -> list:
    async with db.sessao(role="service_role") as conn:
        return [dict(r) for r in await conn.fetch(
            "SELECT event_type, source_app, metadata FROM contact_events "
            "WHERE lead_id = $1::uuid ORDER BY occurred_at", lead_id)]


async def test_atualiza_campos_tags_e_nota_por_email(cliente, contato_api):
    r = await cliente.patch(
        "/publico/contato", params={"email": EMAIL.upper()},
        headers=_auth(contato_api["chave"]),
        json={"cargo": "Gerente de SESMT", "empresa": "Transportes Sonda",
              "tags_add": [f"/{PREFIXO_TAG}-VIP ", f"{PREFIXO_TAG}-evento"],
              "note": "Pediu proposta"})

    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["success"] is True
    assert corpo["dnia_id"] == contato_api["dnia_id"]
    assert corpo["updated_fields"] == ["cargo", "empresa", "tags", "note"]
    assert corpo["lead_score"] > 0, "cargo pontua — o gatilho não viu a mudança"

    async with db.sessao(role="service_role") as conn:
        tags = sorted(r["name"] for r in await conn.fetch(
            "SELECT t.name FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id "
            "WHERE lt.lead_id = $1::uuid", contato_api["lead_id"]))
        nota = await conn.fetchval(
            "SELECT content FROM lead_notes WHERE lead_id = $1::uuid", contato_api["lead_id"])
    assert tags == [f"{PREFIXO_TAG}-evento", f"{PREFIXO_TAG}-vip"]
    assert nota == "Pediu proposta"

    eventos = await _eventos(contato_api["lead_id"])
    atualizados = [e for e in eventos if e["event_type"] == "contact_updated"]
    assert atualizados[-1]["source_app"] == "marketinghs"
    assert atualizados[-1]["metadata"]["source"] == "api"


async def test_remove_tag_sem_diferenciar_maiuscula(cliente, contato_api):
    await cliente.patch("/publico/contato", params={"dnia_id": contato_api["dnia_id"]},
                        headers=_auth(contato_api["chave"]),
                        json={"tags_add": [f"{PREFIXO_TAG}-sai"]})
    r = await cliente.patch("/publico/contato", params={"dnia_id": contato_api["dnia_id"]},
                            headers=_auth(contato_api["chave"]),
                            json={"tags_remove": [f"{PREFIXO_TAG}-SAI"]})
    assert r.status_code == 200, r.text
    async with db.sessao(role="service_role") as conn:
        assert await conn.fetchval(
            "SELECT count(*) FROM lead_tags WHERE lead_id = $1::uuid",
            contato_api["lead_id"]) == 0


async def test_status_pela_atualizacao_grava_os_eventos_de_status(cliente, contato_api):
    r = await cliente.patch("/publico/contato", params={"dnia_id": contato_api["dnia_id"]},
                            headers=_auth(contato_api["chave"]),
                            json={"status": "lead qualificado"})
    assert r.status_code == 200, r.text
    assert r.json()["updated_fields"] == ["status"]
    tipos = [e["event_type"] for e in await _eventos(contato_api["lead_id"])]
    assert "lead_qualified" in tipos


async def test_status_desconhecido_e_400_e_nada_muda(cliente, contato_api):
    r = await cliente.patch("/publico/contato", params={"dnia_id": contato_api["dnia_id"]},
                            headers=_auth(contato_api["chave"]),
                            json={"status": "Inventado", "cargo": "Diretor"})
    assert r.status_code == 400
    assert "Lead Qualificado" in r.json()["detail"], "a mensagem lista os que valem"
    async with db.sessao(role="service_role") as conn:
        assert await conn.fetchval(
            "SELECT cargo FROM leads WHERE id = $1::uuid", contato_api["lead_id"]) is None


async def test_sem_identificador_e_400(cliente, contato_api):
    r = await cliente.patch("/publico/contato", headers=_auth(contato_api["chave"]),
                            json={"cargo": "x"})
    assert r.status_code == 400


async def test_contato_inexistente_e_404(cliente, contato_api):
    r = await cliente.patch("/publico/contato", params={"email": "ninguem@exemplo.invalid"},
                            headers=_auth(contato_api["chave"]), json={"cargo": "x"})
    assert r.status_code == 404


async def test_chave_de_leitura_nao_escreve(cliente, contato_api):
    r = await cliente.patch("/publico/contato", params={"email": EMAIL},
                            headers=_auth(contato_api["chave_leitura"]),
                            json={"cargo": "x"})
    assert r.status_code == 403
```

- [ ] **Passo 3: rodar e ver falhar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_api_contato.py`
Expected: FAIL — 405 ou 404 em `PATCH /publico/contato` (a rota não existe).

- [ ] **Passo 4: implementar**

Crie `backend/app/routers/api_contato.py`:

```python
"""A API de contato para sistema externo: o que eram `contact-update`,
`contact-status-update` e `contact-tags-sync`.

Fica sob `/publico` porque é esse prefixo que o limite de taxa do lote 0
cobre, e porque quem chama é máquina, com chave de API — nunca a tela.

⚠️ As respostas têm a FORMA DA ORIGEM (chaves em inglês): quem consome é
sistema de terceiro, e mudar o formato quebraria integração que não passa por
nós.

⚠️ Status desconhecido é 400, não criação automática — ver `_resolver_status`
em `escrita_contatos.py`. A origem criava; o lote 1D decidiu que não.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.chave_api import ChaveApi, chave_api
from app.database import sessao
from app.routers.escrita_contatos import _registrar_mudanca, _resolver_status

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/publico", tags=["api-contato"])

# Colunas que a atualização pode tocar. Lista fechada: o UPDATE nunca é montado
# a partir das chaves do corpo. `status` fica de fora de propósito — passa por
# `_resolver_status` e grava evento.
_CAMPOS = ("nome", "cargo", "whatsapp", "empresa", "faturamento",
           "funcionarios", "desafios")

DESCRICAO_API = "Mudança de status pela API"


def normalizar_tag(bruta) -> str:
    """O `normalizeTag` do `contact-tags-sync`: sem `/` na frente, sem espaço
    nas pontas, minúscula. Vale para as duas rotas que mexem em tag — a origem
    do `contact-update` não normalizava, e as duas discordavam."""
    return str(bruta or "").lstrip("/").strip().lower()


async def _id_da_tag(conn, nome: str) -> tuple[str, bool]:
    """Acha a tag sem diferenciar maiúscula, ou cria. Devolve (id, criada).

    ⚠️ `tags_name_key` é único na coluna crua; a busca por `lower(name)` evita
    criar "vip" ao lado de um "VIP" que já existia, como `tags-em-lote` do admin.
    """
    existente = await conn.fetchval(
        "SELECT id::text FROM tags WHERE lower(name) = lower($1) LIMIT 1", nome)
    if existente:
        return existente, False
    criada = await conn.fetchval(
        "INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO NOTHING "
        "RETURNING id::text", nome)
    if criada:
        return criada, True
    # Outra requisição criou no meio do caminho.
    return await conn.fetchval("SELECT id::text FROM tags WHERE name = $1", nome), False


async def _lead_por_identificador(conn, dnia_id: UUID | None, email: str | None,
                                  phone: str | None):
    """A ordem da origem: dnia_id, depois e-mail, depois telefone.

    Diferente da origem, que fazia `limit(1)` sem ordem: pelo `dnia_id` vence o
    lead CANÔNICO da identidade (`dndash_lead_id`, lote 5C), e nos outros o
    mais recente — o mesmo critério de `_resolver_lead` em `publico.py`.
    """
    colunas = "id::text AS id, dnia_id::text AS dnia_id, status"
    if dnia_id:
        canonico = await conn.fetchrow(
            f"""SELECT {colunas} FROM leads WHERE id =
                  (SELECT dndash_lead_id FROM ecosystem_identities WHERE dnia_id = $1::uuid)""",
            str(dnia_id))
        if canonico:
            return canonico
        return await conn.fetchrow(
            f"SELECT {colunas} FROM leads WHERE dnia_id = $1::uuid "
            "ORDER BY created_at DESC LIMIT 1", str(dnia_id))
    if email:
        return await conn.fetchrow(
            f"SELECT {colunas} FROM leads WHERE lower(email) = lower($1) "
            "ORDER BY created_at DESC LIMIT 1", email.strip())
    normalizado = await conn.fetchval("SELECT normalize_phone_br($1)", phone)
    return await conn.fetchrow(
        f"""SELECT {colunas} FROM leads
             WHERE ($1::text IS NOT NULL AND phone_normalized = $1) OR whatsapp = $2
             ORDER BY created_at DESC LIMIT 1""", normalizado, phone.strip())


class AtualizacaoIn(BaseModel):
    status: str | None = Field(default=None, min_length=1, max_length=60)
    nome: str | None = None
    cargo: str | None = None
    whatsapp: str | None = None
    empresa: str | None = None
    faturamento: str | None = None
    funcionarios: str | None = None
    desafios: str | None = None
    tags_add: list[str] | None = None
    tags_remove: list[str] | None = None
    note: str | None = Field(default=None, max_length=10000)


@router.patch("/contato")
async def atualizar_contato(
    dados: AtualizacaoIn,
    dnia_id: UUID | None = Query(None),
    email: str | None = Query(None),
    phone: str | None = Query(None),
    _: ChaveApi = Depends(chave_api("write")),
):
    """O que era `contact-update`.

    ⚠️ Registra `contact_updated` SEMPRE, mesmo sem mudança — como a origem. É o
    rastro de que o integrador chamou.
    """
    if not (dnia_id or email or phone):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Informe phone, email ou dnia_id como query param.")
    enviados = dados.model_dump(exclude_unset=True)

    async with sessao(role="service_role") as conn:
        lead = await _lead_por_identificador(conn, dnia_id, email, phone)
        if lead is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Contato não encontrado.")
        lead_id = lead["id"]
        atualizados: list[str] = []

        # O status é resolvido ANTES de qualquer escrita: status inválido não
        # pode deixar a outra metade do pedido gravada.
        novo_status = None
        if enviados.get("status"):
            novo_status = await _resolver_status(conn, enviados["status"])

        if novo_status is not None:
            await conn.execute("UPDATE leads SET status = $2 WHERE id = $1::uuid",
                               lead_id, novo_status)
            await _registrar_mudanca(conn, lead_id, lead["status"], novo_status,
                                     origem="api", descricao=DESCRICAO_API)
            atualizados.append("status")

        campos = {c: enviados[c] for c in _CAMPOS if c in enviados}
        if campos:
            atribuicoes = ", ".join(f"{c} = ${i + 2}" for i, c in enumerate(campos))
            await conn.execute(f"UPDATE leads SET {atribuicoes} WHERE id = $1::uuid",
                               lead_id, *campos.values())
            atualizados.extend(campos)

        mexeu_em_tag = False
        for bruta in enviados.get("tags_add") or []:
            nome = normalizar_tag(bruta)
            if not nome:
                continue
            tag_id, _criada = await _id_da_tag(conn, nome)
            await conn.execute(
                "INSERT INTO lead_tags (lead_id, tag_id) VALUES ($1::uuid, $2::uuid) "
                "ON CONFLICT DO NOTHING", lead_id, tag_id)
            mexeu_em_tag = True
        for bruta in enviados.get("tags_remove") or []:
            nome = normalizar_tag(bruta)
            if not nome:
                continue
            await conn.execute(
                """DELETE FROM lead_tags WHERE lead_id = $1::uuid AND tag_id IN
                     (SELECT id FROM tags WHERE lower(name) = lower($2))""",
                lead_id, nome)
            mexeu_em_tag = True
        if mexeu_em_tag:
            atualizados.append("tags")

        if enviados.get("note"):
            await conn.execute(
                "INSERT INTO lead_notes (lead_id, content) VALUES ($1::uuid, $2)",
                lead_id, enviados["note"])
            atualizados.append("note")

        await conn.execute(
            """INSERT INTO contact_events (lead_id, dnia_id, source_app, event_type,
                                           title, metadata)
               SELECT $1::uuid, l.dnia_id, 'marketinghs', 'contact_updated',
                      'Contato atualizado via API',
                      jsonb_build_object('fields_updated', $2::text[], 'source', 'api')
                 FROM leads l WHERE l.id = $1::uuid""",
            lead_id, atualizados)

        final = await conn.fetchrow(
            "SELECT dnia_id::text AS dnia_id, lead_score, etiqueta FROM leads "
            "WHERE id = $1::uuid", lead_id)

    return {"success": True, "dnia_id": final["dnia_id"],
            "updated_fields": atualizados,
            "lead_score": final["lead_score"] or 0,
            "etiqueta": final["etiqueta"]}
```

⚠️ A ordem de `updated_fields` é **status, campos na ordem de `_CAMPOS`, tags,
note** — o primeiro teste depende dela (`cargo` antes de `empresa` em `_CAMPOS`).

Em `backend/app/main.py`, importe e inclua o router **antes** do
`publico_router` (mesma família de rotas; a ordem não conflita porque os
métodos diferem de `GET /publico/contato`, mas deixa as rotas de contato
juntas na leitura):

```python
from app.routers.api_contato import router as api_contato_router
...
app.include_router(captura_router)
app.include_router(api_contato_router)
app.include_router(publico_router)
```

Confira o estilo de import dos outros routers no topo de `main.py` e siga o mesmo.

- [ ] **Passo 5: rodar e ver passar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_api_contato.py`
Expected: 7 passed

- [ ] **Passo 6: o admin não mudou**

Run: `cd backend && ./.venv/bin/pytest -q -k "status or escrita or contato"`
Expected: tudo o que já passava continua passando.

- [ ] **Passo 7: commit**

```bash
git add backend/app/routers/api_contato.py backend/app/routers/escrita_contatos.py \
        backend/app/main.py backend/tests/test_api_contato.py
git commit -m "feat(8B): PATCH /publico/contato no lugar de contact-update"
```

---

### Tarefa 2: Status do contato — `PATCH|POST /publico/contato/status`

**Arquivos:**
- Modificar: `backend/app/routers/api_contato.py`
- Modificar: `backend/tests/test_api_contato.py`

**Interfaces:**
- Consome: `_resolver_status`, `_registrar_mudanca`.
- Produz: `PATCH` e `POST /publico/contato/status` com `{"dnia_id": uuid, "status": str}` → `{"success": True, "dnia_id", "lead_id", "status_anterior", "status_atual", "status_created": False}`.

- [ ] **Passo 1: escrever os testes que falham**

```python
async def test_status_por_dnia_id_grava_contact_updated_e_lead_qualified(
        cliente, contato_api):
    r = await cliente.patch("/publico/contato/status", headers=_auth(contato_api["chave"]),
                            json={"dnia_id": contato_api["dnia_id"],
                                  "status": "LEAD QUALIFICADO"})
    assert r.status_code == 200, r.text
    assert r.json() == {"success": True, "dnia_id": contato_api["dnia_id"],
                        "lead_id": contato_api["lead_id"], "status_anterior": "Lead",
                        "status_atual": "Lead Qualificado", "status_created": False}
    tipos = [e["event_type"] for e in await _eventos(contato_api["lead_id"])]
    assert tipos.count("contact_updated") == 1
    assert tipos.count("lead_qualified") == 1


async def test_status_aceita_post_como_alias(cliente, contato_api):
    r = await cliente.post("/publico/contato/status", headers=_auth(contato_api["chave"]),
                           json={"dnia_id": contato_api["dnia_id"], "status": "Iniciado"})
    assert r.status_code == 200, r.text
    assert r.json()["status_atual"] == "Iniciado"


async def test_status_nao_avanca_o_estagio_da_identidade(cliente, contato_api):
    """Decisão 2 do plano. Se o Erick decidir que avança, este teste muda junto
    com a rota do admin — nunca uma sem a outra."""
    await cliente.patch("/publico/contato/status", headers=_auth(contato_api["chave"]),
                        json={"dnia_id": contato_api["dnia_id"],
                              "status": "Lead Qualificado"})
    async with db.sessao(role="service_role") as conn:
        estagio = await conn.fetchval(
            "SELECT stage FROM ecosystem_identities WHERE dnia_id = $1::uuid",
            contato_api["dnia_id"])
    assert estagio != "opportunity"


async def test_status_desconhecido_e_400(cliente, contato_api):
    r = await cliente.patch("/publico/contato/status", headers=_auth(contato_api["chave"]),
                            json={"dnia_id": contato_api["dnia_id"], "status": "Novo Status"})
    assert r.status_code == 400


async def test_status_dnia_id_inexistente_e_404(cliente, contato_api):
    r = await cliente.patch("/publico/contato/status", headers=_auth(contato_api["chave"]),
                            json={"dnia_id": "00000000-0000-0000-0000-000000000000",
                                  "status": "Lead"})
    assert r.status_code == 404


async def test_status_dnia_id_malformado_e_422(cliente, contato_api):
    r = await cliente.patch("/publico/contato/status", headers=_auth(contato_api["chave"]),
                            json={"dnia_id": "nao-e-uuid", "status": "Lead"})
    assert r.status_code == 422
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_api_contato.py -k status_`
Expected: FAIL — 404/405 em `/publico/contato/status`.

- [ ] **Passo 3: implementar**

Acrescente a `backend/app/routers/api_contato.py`:

```python
class StatusApiIn(BaseModel):
    dnia_id: UUID
    status: str = Field(min_length=1, max_length=60)


@router.api_route("/contato/status", methods=["PATCH", "POST"])
async def atualizar_status(dados: StatusApiIn,
                           _: ChaveApi = Depends(chave_api("write"))):
    """O que era `contact-status-update`. PATCH é a rota; POST é alias, como na
    origem — mesmo caminho, porque aqui POST não colide com nada.

    ⚠️ O estágio da identidade NÃO avança para `opportunity`, e o handoff para
    o CRM não é disparado. A origem fazia os dois; a rota do admin deixou de
    fazer (`escrita_contatos.py:166-169`) porque a régua é decisão de produto,
    e as duas portas de escrita têm de concordar. O handoff é o lote 8D.
    """
    if not dados.status.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            'Campo "status" não pode ser vazio.')
    dnia_id = str(dados.dnia_id)

    async with sessao(role="service_role") as conn:
        novo = await _resolver_status(conn, dados.status)

        identidade = await conn.fetchrow(
            "SELECT dndash_lead_id::text AS lead_id FROM ecosystem_identities "
            "WHERE dnia_id = $1::uuid", dnia_id)
        if identidade is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "dnia_id não encontrado.")
        lead_id = identidade["lead_id"]
        if not lead_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND,
                                "Identidade não possui contato vinculado no MarketingHS.")

        linha = await conn.fetchrow("SELECT status FROM leads WHERE id = $1::uuid", lead_id)
        if linha is None:
            # A origem respondia sucesso sem gravar nada.
            raise HTTPException(status.HTTP_404_NOT_FOUND,
                                "O contato vinculado a esta identidade não existe mais.")
        anterior = linha["status"]

        await conn.execute("UPDATE leads SET status = $2 WHERE id = $1::uuid", lead_id, novo)
        await _registrar_mudanca(conn, lead_id, anterior, novo,
                                 origem="api", descricao=DESCRICAO_API)

    return {"success": True, "dnia_id": dnia_id, "lead_id": lead_id,
            "status_anterior": anterior, "status_atual": novo,
            # Sempre falso: status não é criado por API (decisão do lote 1D).
            # O campo fica porque integrador pode estar lendo.
            "status_created": False}
```

- [ ] **Passo 4: rodar e ver passar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_api_contato.py`
Expected: 13 passed

- [ ] **Passo 5: commit**

```bash
git add backend/app/routers/api_contato.py backend/tests/test_api_contato.py
git commit -m "feat(8B): PATCH|POST /publico/contato/status no lugar de contact-status-update"
```

---

### Tarefa 3: Sincronizar tags — `PUT|POST /publico/contato/tags`

**Arquivos:**
- Modificar: `backend/app/routers/api_contato.py`
- Modificar: `backend/tests/test_api_contato.py`

**Interfaces:**
- Consome: `normalizar_tag`, `_id_da_tag`.
- Produz: `PUT` e `POST /publico/contato/tags` com `{"dnia_id"?, "nexus_contact_id"?, "email"?, "tags": list}` → `{"success", "dnia_id", "lead_id", "tags_final", "added", "removed", "kept", "created_tags"}`.

- [ ] **Passo 1: escrever os testes que falham**

```python
async def test_tags_espelha_o_conjunto(cliente, contato_api):
    chave = _auth(contato_api["chave"])
    base = {"dnia_id": contato_api["dnia_id"]}
    r1 = await cliente.put("/publico/contato/tags", headers=chave, json={
        **base, "tags": [f"{PREFIXO_TAG}-a", f"{PREFIXO_TAG}-b"]})
    assert r1.status_code == 200, r1.text
    assert sorted(r1.json()["created_tags"]) == [f"{PREFIXO_TAG}-a", f"{PREFIXO_TAG}-b"]

    r2 = await cliente.put("/publico/contato/tags", headers=chave, json={
        **base, "tags": [f"{PREFIXO_TAG}-B", f"/{PREFIXO_TAG}-c", f"{PREFIXO_TAG}-c", 7]})
    corpo = r2.json()
    assert corpo["tags_final"] == [f"{PREFIXO_TAG}-b", f"{PREFIXO_TAG}-c"]
    assert corpo["added"] == [f"{PREFIXO_TAG}-c"]
    assert corpo["removed"] == [f"{PREFIXO_TAG}-a"]
    assert corpo["kept"] == [f"{PREFIXO_TAG}-b"]

    tipos = [e["event_type"] for e in await _eventos(contato_api["lead_id"])]
    assert tipos.count("tags_synced") == 2


async def test_tags_lista_vazia_limpa_tudo_e_post_e_alias(cliente, contato_api):
    chave = _auth(contato_api["chave"])
    await cliente.put("/publico/contato/tags", headers=chave, json={
        "email": EMAIL, "tags": [f"{PREFIXO_TAG}-x"]})
    r = await cliente.post("/publico/contato/tags", headers=chave,
                           json={"email": EMAIL, "tags": []})
    assert r.status_code == 200, r.text
    assert r.json()["removed"] == [f"{PREFIXO_TAG}-x"]
    async with db.sessao(role="service_role") as conn:
        assert await conn.fetchval("SELECT count(*) FROM lead_tags WHERE lead_id = $1::uuid",
                                   contato_api["lead_id"]) == 0


async def test_tags_sem_identificador_e_400(cliente, contato_api):
    r = await cliente.put("/publico/contato/tags", headers=_auth(contato_api["chave"]),
                          json={"tags": []})
    assert r.status_code == 400


async def test_tags_que_nao_e_lista_e_400(cliente, contato_api):
    r = await cliente.put("/publico/contato/tags", headers=_auth(contato_api["chave"]),
                          json={"email": EMAIL, "tags": "a,b"})
    assert r.status_code == 400
    assert "array" in r.json()["detail"]
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_api_contato.py -k tags`
Expected: FAIL — 404/405 em `/publico/contato/tags`.

- [ ] **Passo 3: implementar**

Acrescente a `backend/app/routers/api_contato.py`:

```python
class TagsApiIn(BaseModel):
    dnia_id: UUID | None = None
    nexus_contact_id: UUID | None = None
    email: str | None = None
    # Sem tipo de item: a origem aceitava lista com não-string e descartava.
    # A validação de "é lista?" é da rota, para a mensagem ser a da origem.
    tags: object = None


@router.api_route("/contato/tags", methods=["PUT", "POST"])
async def sincronizar_tags(dados: TagsApiIn,
                           _: ChaveApi = Depends(chave_api("write"))):
    """O que era `contact-tags-sync`: substituição TOTAL. O que não veio sai.

    PUT é a rota; POST é alias, para cliente que não sabe mandar PUT.
    """
    if not (dados.dnia_id or dados.nexus_contact_id or dados.email):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Informe ao menos um identificador: dnia_id, nexus_contact_id ou email.")
    if not isinstance(dados.tags, list):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            'O campo "tags" precisa ser um array de strings (use [] para remover todas).')

    alvo: list[str] = []
    for bruta in dados.tags:
        if isinstance(bruta, str):
            nome = normalizar_tag(bruta)
            if nome and nome not in alvo:
                alvo.append(nome)

    async with sessao(role="service_role") as conn:
        if dados.dnia_id or dados.nexus_contact_id:
            coluna = "dnia_id" if dados.dnia_id else "nexus_contact_id"
            valor = str(dados.dnia_id or dados.nexus_contact_id)
            identidade = await conn.fetchrow(
                f"SELECT dnia_id::text AS dnia_id, dndash_lead_id::text AS lead_id "
                f"FROM ecosystem_identities WHERE {coluna} = $1::uuid", valor)
            if identidade is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND,
                                    "Contato não encontrado para o identificador informado.")
            dnia_id, lead_id = identidade["dnia_id"], identidade["lead_id"]
        else:
            lead = await conn.fetchrow(
                """SELECT id::text AS id, dnia_id::text AS dnia_id FROM leads
                    WHERE lower(email) = lower($1) AND deleted_at IS NULL
                    ORDER BY created_at DESC LIMIT 1""", dados.email.strip())
            if lead is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND,
                                    "Contato não encontrado pelo email informado.")
            dnia_id, lead_id = lead["dnia_id"], lead["id"]
        if not lead_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND,
                                "Contato encontrado, mas sem lead vinculado.")

        atuais = {r["name"].lower(): r["id"] for r in await conn.fetch(
            """SELECT t.id::text AS id, t.name FROM lead_tags lt
                 JOIN tags t ON t.id = lt.tag_id WHERE lt.lead_id = $1::uuid""", lead_id)}

        adicionadas = [n for n in alvo if n not in atuais]
        mantidas = [n for n in alvo if n in atuais]
        removidas = [n for n in atuais if n not in alvo]

        criadas: list[str] = []
        for nome in adicionadas:
            tag_id, criada = await _id_da_tag(conn, nome)
            if criada:
                criadas.append(nome)
            await conn.execute(
                "INSERT INTO lead_tags (lead_id, tag_id) VALUES ($1::uuid, $2::uuid) "
                "ON CONFLICT DO NOTHING", lead_id, tag_id)
        if removidas:
            await conn.execute(
                "DELETE FROM lead_tags WHERE lead_id = $1::uuid AND tag_id = ANY($2::uuid[])",
                lead_id, [atuais[n] for n in removidas])

        await conn.execute(
            """INSERT INTO contact_events (lead_id, dnia_id, source_app, event_type,
                                           title, metadata)
               VALUES ($1::uuid, $2::uuid, 'marketinghs', 'tags_synced',
                       'Tags sincronizadas via API',
                       jsonb_build_object('added', $3::text[], 'removed', $4::text[],
                                          'kept', $5::text[], 'total', $6::int,
                                          'source', 'api'))""",
            lead_id, dnia_id, adicionadas, removidas, mantidas, len(alvo))

    return {"success": True, "dnia_id": dnia_id, "lead_id": lead_id,
            "tags_final": alvo, "added": adicionadas, "removed": removidas,
            "kept": mantidas, "created_tags": criadas}
```

⚠️ `removidas` usa o nome **em minúscula** (a chave de `atuais`); a resposta
mostra a tag como foi comparada, não como está gravada. Se uma tag antiga foi
gravada como "VIP", ela aparece como "vip" em `removed`. É o preço de comparar
sem diferenciar maiúscula, e a origem comparava exato — registrado.

- [ ] **Passo 4: rodar e ver passar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_api_contato.py`
Expected: 17 passed

- [ ] **Passo 5: commit**

```bash
git add backend/app/routers/api_contato.py backend/tests/test_api_contato.py
git commit -m "feat(8B): PUT|POST /publico/contato/tags no lugar de contact-tags-sync"
```

---

### Tarefa 4: A documentação ensina as rotas novas

**Arquivos:**
- Modificar: `frontend/src/components/admin/settings/ApiDocumentation.tsx:408-447, 585-652`
- Modificar: `frontend/public/api/dnmarketing-api.yaml:432, 912-1189`

⚠️ **A documentação já ensinou URL morta oito vezes neste projeto** — a nona
foi pega na navegação lateral, que montava o rótulo a partir do `id` do bloco
(`b43ccc0`). Convenção da casa: o `id` do bloco **mantém** o nome antigo; o
`path` muda.

- [ ] **Passo 1: `ApiDocumentation.tsx`**

No bloco `id: 'contact-update'`:
- `path: '/contact-update'` → `path: '/publico/contato'`
- no `curl`, `'${BASE_URL}/contact-update?email=joao@empresa.com'` → `'${BASE_URL}/publico/contato?email=joao@empresa.com'`
- no corpo do `curl`, `"status": "Qualificado"` → `"status": "Lead Qualificado"` (o exemplo antigo usava um status que não existe e hoje daria 400)
- `description` → `'Atualiza campos do contato, gerencia tags e adiciona notas. Registra evento contact_updated na timeline. Status precisa ser um dos cadastrados — status desconhecido responde 400 com a lista dos que valem.'`
- no parâmetro `status`, `description: 'Novo status'` → `description: 'Um dos status cadastrados (ex: Lead Qualificado). Desconhecido: 400.'`

No bloco `id: 'contact-status-update'`:
- `method: 'PATCH'` → `method: 'PATCH / POST'`
- `path: '/contact-status-update'` → `path: '/publico/contato/status'`
- no `curl`, `'${BASE_URL}/contact-status-update'` → `'${BASE_URL}/publico/contato/status'`
- `description` → `'Atualiza o status do contato via dnia_id. Registra contact_updated e, para Lead Qualificado, MQL e Venda realizada, o evento específico que a listagem conta. PATCH é a rota; POST é alias com a mesma semântica.'`
- no parâmetro `status`, a `description` → `'Um dos status cadastrados (máx. 60 caracteres, sem diferenciar maiúscula). Status desconhecido responde 400 com a lista dos que valem — não é criado. Padrões: Lead | Iniciado | Lead Qualificado | MQL - Reunião agendada | SQL - Em negociação | Em contrato | Venda realizada'`
- `notes` → `'Status não é mais criado automaticamente: o funil da HS é cadastrado em Configurações. status_created vem sempre false e fica na resposta por compatibilidade. O estágio do contato no ecossistema NÃO é avançado e o handoff ao CRM não é disparado por esta rota.'`

No bloco `id: 'contact-tags-sync'`:
- `path: '/contact-tags-sync'` → `path: '/publico/contato/tags'`
- os dois `curl`: `'${BASE_URL}/contact-tags-sync'` → `'${BASE_URL}/publico/contato/tags'`
- na `description`, "Ideal para sincronização contínua a partir do Nexus." → "Ideal para sincronização contínua a partir do CRM."
- `notes` → `'Substituição total (PUT semântico, POST aceito como alias). Tags são comparadas sem diferenciar maiúscula. Registra evento "tags_synced" na timeline. Para mutações parciais (adicionar OU remover tags individualmente), use PATCH /publico/contato com tags_add / tags_remove.'`

- [ ] **Passo 2: `dnmarketing-api.yaml`**

- linha 432: `Para sobrescrever, use PATCH /contact-update.` → `Para sobrescrever, use PATCH /publico/contato.`
- `  /contact-update:` → `  /publico/contato:` (e acrescente, na `description` do `patch`, a frase "Status desconhecido responde 400.")
- `  /contact-status-update:` → `  /publico/contato/status:`, e no `status` do schema **troque o `enum` fixo** por:
  ```yaml
                status:
                  type: string
                  maxLength: 60
                  description: |
                    Um dos status cadastrados em lead_statuses, sem diferenciar
                    maiúscula. Status desconhecido responde 400 com a lista dos
                    que valem. Padrões: Lead, Iniciado, Lead Qualificado,
                    MQL - Reunião agendada, SQL - Em negociação, Em contrato,
                    Venda realizada.
  ```
  e na `description` do `patch`, troque "dispara o handoff para o Nexus CRM (avança stage para `opportunity` e registra evento `lead_qualified`)" por "registra também o evento `lead_qualified`. O estágio no ecossistema não é avançado e o handoff ao CRM não é disparado". Acrescente `post:` com `$ref` para o `patch`, no mesmo formato do alias de tags (`$ref: '#/paths/~1publico~1contato~1status/patch/...'`).
- `  /contact-tags-sync:` → `  /publico/contato/tags:`, e **os cinco `$ref` do `post`** trocam `~1contact-tags-sync` por `~1publico~1contato~1tags`. Na `description` do `put`, "A origem (ex: Nexus)" → "O sistema de origem (ex: o CRM)".

- [ ] **Passo 3: nenhum endereço morto**

```bash
grep -rn "contact-update\|contact-status-update\|contact-tags-sync" frontend/src frontend/public backend/app
```

Expected: só os três `id:` de bloco em `ApiDocumentation.tsx` e comentários "o
que era" em `api_contato.py`. Confira que a navegação lateral mostra o `path`, não
o `id` (`b43ccc0`).

- [ ] **Passo 4: tipagem**

Run: `cd frontend && npx tsc --noEmit`
Expected: sem erro.

- [ ] **Passo 5: commit**

```bash
git add frontend/src/components/admin/settings/ApiDocumentation.tsx \
        frontend/public/api/dnmarketing-api.yaml
git commit -m "docs(8B): a documentação da API ensina /publico/contato"
```

---

### Tarefa 5: O portão

**Arquivos:**
- Apagar: `backend/supabase/functions/contact-update`, `contact-status-update`, `contact-tags-sync`
- Modificar: `docs/CONTINUAR-AQUI.md`

- [ ] **Passo 1: a suíte**

```bash
cd backend && ./.venv/bin/pytest -q          # ⚠️ timeout ≥600s — nunca mate no meio
```

Expected: o total do 8A + 17.

- [ ] **Passo 2: ao vivo, pela tela e por fora**

Não há tela que chame estas rotas — quem chama é integrador. O portão exercita o
caminho que o integrador faria, com o que o admin oferece:

1. Suba backend e Vite em `127.0.0.1`; entre com a conta de trabalho do Claude.
2. Em Configurações → **Chaves de API**, crie uma chave de escrita pela tela e
   copie o valor (a tela mostra uma vez só).
3. Pela linha de comando, com um contato de teste criado pela landing ou pelo
   script do subprojeto A:
   ```bash
   curl -s -X PATCH "http://127.0.0.1:8100/publico/contato?email=<email-de-teste>" \
     -H "Authorization: Bearer <chave>" -H "Content-Type: application/json" \
     -d '{"cargo":"Gerente de SESMT","tags_add":["teste-8b"],"note":"via API"}'
   curl -s -X POST "http://127.0.0.1:8100/publico/contato/status" \
     -H "Authorization: Bearer <chave>" -H "Content-Type: application/json" \
     -d '{"dnia_id":"<dnia_id>","status":"Lead Qualificado"}'
   ```
4. Abra o contato na tela de **Contatos** e confira: cargo, score recalculado,
   tag, nota, status "Lead Qualificado", e os eventos na timeline.
5. Apague pela tela a chave e o contato de teste. Confira o banco limpo.

- [ ] **Passo 3: a capacidade, contra a origem**

Abra as três `index.ts` e marque, item a item, onde cada capacidade vive agora —
e quais saíram de propósito: criação automática de status (decisão 1), avanço
de estágio (decisão 2), `source_app` (decisão 3). **Qualquer item sem lugar e
sem decisão para o `git rm`.**

- [ ] **Passo 4: só então, apagar**

```bash
git rm -r backend/supabase/functions/contact-update \
          backend/supabase/functions/contact-status-update \
          backend/supabase/functions/contact-tags-sync
```

- [ ] **Passo 5: o CONTINUAR-AQUI**

Acrescente a seção do 8B: placar **42 portadas, 7 descartadas, restam 5**; as
sete decisões deste plano; e, **na lista do Erick**, a pergunta da decisão 2 —
*"Lead Qualificado avança o contato para `opportunity` no ecossistema?"* — com a
nota de que a resposta vale para as duas portas (admin e API) ao mesmo tempo.

- [ ] **Passo 6: commit**

```bash
git add -A backend/supabase/functions docs/CONTINUAR-AQUI.md
git commit -m "chore(8B): o portão fecha — as três functions de contato saem

Placar da pasta de especificação: 42 portadas, 7 descartadas, restam 5."
```

---

## Autorrevisão deste plano

**Cobertura, contra as três functions.** `contact-update`: PATCH, busca por
dnia_id/email/phone (T1), lista de campos (T1), status (T1, decisão 5),
`tags_add`/`tags_remove` (T1, decisão 4), `note` (T1), evento sempre (T1),
resposta com score e etiqueta (T1). `contact-status-update`: PATCH e POST (T2),
validações do corpo (T2 — vazio 400, >60 pelo `Field`), status (T2, decisão 1),
identidade e lead vinculado (T2), eventos (T2 via `_registrar_mudanca`), avanço
de estágio (decisão 2), resposta (T2). `contact-tags-sync`: PUT e POST (T3),
três identificadores (T3), normalização e dedupe (T3), diff e criação de tag
(T3), evento `tags_synced` (T3), resposta (T3). Documentação (T4).

**Sem placeholders.** Todo passo de código tem código. A Tarefa 4 descreve cada
troca de texto com o valor exato.

**Consistência de tipos.** `_registrar_mudanca(..., origem, descricao)` é
definida em T1 e usada em T1 e T2 com `DESCRICAO_API`. `normalizar_tag` e
`_id_da_tag` (T1) são usadas em T3 com a mesma assinatura. As chaves de resposta
seguem a origem nas três.

**O que este plano assume e pode estar errado:** que
`resolve_or_create_identity` devolve um `dict` com `dnia_id` (conferido em
produção no subprojeto A, `captura.py:229-235`); que a coluna `stage` de
`ecosystem_identities` se chama assim (é o nome do parâmetro `p_stage` e do
`stage` que `_achar_identidade` lê com `SELECT *`); e que o contador de
`status > 60` da origem é coberto pelo `max_length=60` do `Field` (422 em vez
de 400 — mesma classe de diferença já aceita na captura).
