# MarketingHS — Lote 3A: Campanhas e templates (sem envio) — Plano

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — `superpowers:subagent-driven-development`
> ou `superpowers:executing-plans`. Os passos usam caixa (`- [ ]`).

**Objetivo:** criar, editar, agendar e acompanhar campanhas pela tela, com
template próprio e audiência de segmentos — **sem disparar e-mail nenhum**.

**Arquitetura:** endpoints FastAPI substituem `campaigns-api` e `templates-api`.
A resolução de audiência continua na RPC `resolve_segment_audience`, a mesma que
o lote 2 já expõe e que o envio vai usar. Nada do motor de fila entra aqui.

**Stack:** FastAPI, asyncpg · React 18, Vite, Unlayer

**Spec:** `docs/superpowers/specs/2026-08-31-marketinghs-design.md`
**Lotes anteriores:** `…-lote-0`, `…-1a`, `…-1b`, `…-1c`, `…-1d`, `…-lote-2`

---

## Por que o lote 3 virou 3A, 3B e 3C

A spec trata "Campanhas + o motor" como um lote só, e a decisão de que **o motor
nasce sendo usado, não num lote de infraestrutura** (§6) continua valendo — ela é
a resposta à lição que custou caro no HS.OS e não se reabre aqui.

O que muda é só o tamanho do plano. O lote 1 já foi partido em 1A/1B/1C/1D pelo
mesmo motivo, e o corte abaixo mantém o motor dentro do lote 3, sendo usado:

| | O que entra | Pronto quando |
|---|---|---|
| **3A** (este) | Templates, CRUD de campanha, audiência, acompanhamento | Você cria uma campanha em rascunho pela tela, com template e público, e vê a contagem |
| **3B** | Filas, worker, Resend, descadastro, supressão + `pytest` do motor | **Uma campanha de teste sai de verdade** |
| **3C** | Webhook do Resend, métricas, agendamento | **A abertura aparece na timeline** |

O "pronto" que a spec define para o lote 3 é a soma de 3B e 3C. **3A não fecha o
lote 3** — ele prepara o terreno e não deve ser anunciado como o lote inteiro.

---

## O que você precisa saber antes de começar

### ⚠️ A função que mais importa NÃO EXISTE no repositório

`process-email-queue` é o worker que de fato envia o e-mail: supressão, merge
tags, URL de descadastro assinada, rodapé, cabeçalhos RFC 8058, tags de
correlação e captura do `resend_email_id`. **Sete arquivos a citam pelo nome e
ela não está na pasta nem no histórico do git.**

```bash
grep -rln "process-email-queue" backend/supabase/functions   # 7 arquivos
ls backend/supabase/functions/process-email-queue            # não existe
git log --all --diff-filter=D --name-only | grep process-email-queue  # vazio
```

Isso **não afeta o 3A** (que não envia nada), mas define como o 3B terá de
trabalhar: a lógica por destinatário se **deriva da contraparte**, não se lembra.
`email-unsubscribe` verifica o token que ela assinava, `send-test-email` repete a
resolução de credenciais e as merge tags, `_shared/secrets.ts` fixa a ordem de
resolução do segredo. Anotado aqui para que o 3B não comece achando que existe um
original para copiar.

> A regra do projeto era "função herdada se copia do banco, não se lembra". Esta
> não está em lugar nenhum: se deriva de quem a verifica.

### ⚠️ `promote_scheduled_campaigns` está quebrada, e o defeito é latente

A função sobreviveu ao port do schema, mas o corpo dela chama
`public.invoke_edge_function`, que o lote 0 apagou de propósito. Chamar a função
hoje devolve `0` sem erro — porque o laço não roda com a tabela sem campanha
agendada. Ela **só estoura quando uma campanha vence**:

```
FALHOU como previsto: UndefinedFunctionError
   function public.invoke_edge_function(unknown, jsonb) does not exist
```

✅ **Verificado por execução** (com uma campanha `scheduled` vencida inserida numa
transação revertida). É do **3C** consertar — o agendador Python passa a fazer a
seleção e chamar o enfileirador direto, e é isso que apaga a indireção em vez de
portá-la. **No 3A, não chame esta função e não deixe a tela oferecer
agendamento como se funcionasse.**

### O que sobreviveu no banco, e que você NÃO reimplementa

Estas existem e estão em produção há meses. Confira antes de escrever qualquer
coisa parecida:

| Função | O que faz |
|---|---|
| `finalize_campaign_if_drained(uuid) → boolean` | fecha a campanha e calcula `stats` quando não há mais `pending` |
| `resolve_segment_audience(uuid[], uuid[], int)` | o público, com exclusões — a MESMA do envio |
| `count_segment_audience(uuid[], uuid[])` | só o tamanho |
| `guard_campaign_delete()` | trigger que impede apagar campanha enviada |
| `validate_campaign_status()` | trigger: `draft, scheduled, sending, sent, paused, failed` |
| `validate_campaign_channel()` / `validate_campaign_send_channel()` | trigger de canal |
| `validate_campaign_send_status()` | trigger: `pending, sent, delivered, opened, clicked, failed, unsubscribed, bounced, complained, suppressed` |
| `fn_campaign_send_event()` | trigger que joga o envio na timeline do contato |
| `sync_campaign_legacy_segment_id()` | compatibilidade `segment_id` ↔ `segment_ids` |

**Faltam** (e são do 3B/3C, não deste lote): `email_queue_read`,
`email_queue_delete`, `email_queue_send_batch`, `reset_stuck_campaigns`,
`get_integration_secret`, `set_integration_secret`, `delete_integration_secret`.

### As tabelas de fila não existem

Não há `email_send_queue` nem `journey_events` no banco — eram filas do `pgmq`,
que nunca foi instalado. **O 3B cria as duas como tabela comum.** Não invente
nenhuma delas no 3A.

### Os três índices únicos estão intactos — confira e não relaxe

```
uniq_campaign_sends_email_campaign_lead (campaign_id, lead_id)
    WHERE channel='email' AND lead_id IS NOT NULL AND campaign_id IS NOT NULL
uniq_campaign_sends_journey_node        (journey_run_id, journey_node_id)
    WHERE journey_run_id IS NOT NULL
uniq_journey_runs_open                  (journey_id, lead_id)
    WHERE state IN ('active','waiting')
```

São a garantia, no nível do banco, de não enviar e-mail duplicado — e é o que
permite o worker do 3B reprocessar à vontade. ✅ Verificados presentes.

### A tabela `campaigns`

`id, name, channel, status, segment_id, subject, body, scheduled_at, sent_at,
stats (jsonb), created_at, updated_at, design (jsonb), segment_ids (uuid[] NOT
NULL default '{}'), excluded_segment_ids (uuid[] NOT NULL default '{}')`.

⚠️ `segment_id` é **legado** e o trigger `sync_campaign_legacy_segment_id` o
mantém em sincronia com `segment_ids`. Escreva em `segment_ids`; não escreva no
legado à mão.

---

## Restrições globais

- **`sessao()` é o único caminho para dado**, e é ela que abre a transação.
- **Nenhum endpoint depende do RLS para autorizar** — cada rota autoriza sozinha.
- **`role="service_role"` + autorização explícita na rota** é o padrão dos lotes
  0 a 2. Siga.
- **O portão tem TRÊS partes** (ver `CLAUDE.md`): tela limpa, ninguém mais
  chamando a function — **inclusive a documentação**, que já pegou duas mortas no
  lote 2 — e a tela conferida no navegador.
- **Backend na porta 8100 no host.** A 8000 é do TaskHS.
- **Nenhum e-mail sai neste lote.** Se você se pegar escrevendo uma chamada ao
  Resend, parou no lote errado.
- **Comentário e nome de módulo em português.**
- Toda chave nova de ambiente **precisa** ser declarada em `Settings`
  (`backend/app/config.py`), ou o boot inteiro cai.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `backend/app/routers/templates.py` (novo) | CRUD de `email_templates` |
| `backend/app/routers/campanhas.py` (novo) | CRUD de `campaigns`, detalhe e audiência |
| `backend/app/main.py` (modificar) | registrar os dois routers |
| `frontend/src/lib/templates.ts` (novo) | cliente HTTP de templates |
| `frontend/src/lib/campanhas.ts` (novo) | cliente HTTP de campanhas |
| `frontend/src/hooks/useTemplates.tsx` (modificar) | 5 pontos de acesso direto |
| `frontend/src/hooks/useCampaigns.tsx` (modificar) | 10 pontos |
| `frontend/src/components/admin/campaigns/CampaignDetail.tsx` (modificar) | 1 ponto |
| `frontend/src/components/admin/campaigns/CampaignWizard.tsx` (modificar) | 1 ponto + 2 invokes |

---

## Tarefa 1: Templates

**Arquivos:** cria `backend/app/routers/templates.py`; modifica `app/main.py`

**Interfaces produzidas:**
- `GET /templates` → `{data: [...], pagination: {...}}`
- `GET /templates/{id}` → o template
- `POST /templates` → `{id}` · `PATCH /templates/{id}` · `DELETE /templates/{id}`

- [ ] **Passo 1: o router**

```python
"""Templates de e-mail. Substitui a `templates-api`.

O `design` é o JSON do Unlayer e o `html` é o que ele exporta. Os dois andam
juntos: gravar um sem o outro deixa um template que abre no editor e sai
diferente no envio, ou que envia certo e não abre para editar.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, usuario_atual

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/templates", tags=["templates"])

COLUNAS = ("id::text, name, description, category, design, html, "
           "created_at::text, updated_at::text")


class TemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    category: str | None = None
    design: dict | None = None
    html: str | None = None


class TemplatePatch(BaseModel):
    # Tudo opcional: o editor grava só o que mudou.
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    category: str | None = None
    design: dict | None = None
    html: str | None = None


@router.get("")
async def listar(
    categoria: str | None = Query(None, alias="category"),
    pagina: int = Query(1, alias="page", ge=1),
    limite: int = Query(20, alias="limit", ge=1, le=100),
    _: Usuario = Depends(usuario_atual),
):
    """Lista paginada. O filtro vai por parâmetro, não concatenado na string."""
    async with sessao(role="service_role") as conn:
        total = await conn.fetchval(
            "SELECT count(*) FROM email_templates "
            "WHERE $1::text IS NULL OR category = $1", categoria)
        linhas = await conn.fetch(
            f"""SELECT {COLUNAS} FROM email_templates
                 WHERE $1::text IS NULL OR category = $1
                 ORDER BY updated_at DESC, id DESC
                 LIMIT $2 OFFSET $3""",
            categoria, limite, (pagina - 1) * limite)
    return {
        "data": [dict(l) for l in linhas],
        "pagination": {"page": pagina, "limit": limite, "total": total,
                       "pages": (total + limite - 1) // limite},
    }


@router.get("/{template_id}")
async def ler(template_id: str, _: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            f"SELECT {COLUNAS} FROM email_templates WHERE id = $1::uuid",
            template_id)
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Template não encontrado.")
    return dict(linha)


@router.post("", status_code=status.HTTP_201_CREATED)
async def criar(dados: TemplateIn, _: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            f"""INSERT INTO email_templates (name, description, category, design, html)
                VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING {COLUNAS}""",
            dados.name.strip(), dados.description, dados.category,
            dados.design, dados.html)
    return dict(linha)


@router.patch("/{template_id}")
async def editar(template_id: str, dados: TemplatePatch,
                 _: Usuario = Depends(usuario_atual)):
    """⚠️ PATCH de verdade: campo ausente NÃO vira NULL.

    `exclude_unset` separa "não mandou" de "mandou null". Sem isso, salvar só o
    nome apagaria o `design` e o `html` do template — e o editor gravaria uma
    casca por cima de um template pronto.
    """
    campos = dados.model_dump(exclude_unset=True)
    if not campos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nada a atualizar.")

    # Os nomes das colunas vêm do modelo, não da requisição — a lista é fechada.
    partes = []
    valores = []
    for i, (coluna, valor) in enumerate(campos.items(), start=2):
        cast = "::jsonb" if coluna == "design" else ""
        partes.append(f"{coluna} = ${i}{cast}")
        valores.append(valor)

    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            f"""UPDATE email_templates SET {', '.join(partes)}, updated_at = now()
                 WHERE id = $1::uuid RETURNING {COLUNAS}""",
            template_id, *valores)
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Template não encontrado.")
    return dict(linha)


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir(template_id: str, _: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        r = await conn.execute(
            "DELETE FROM email_templates WHERE id = $1::uuid", template_id)
    if r.endswith(" 0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Template não encontrado.")
```

- [ ] **Passo 2: registrar no `main.py`**

```python
from app.routers.templates import router as templates_router
# ...
app.include_router(templates_router)
```

- [ ] **Passo 3: conferir por HTTP**

Suba o backend e, com um JWT de admin, confira nesta ordem — o PATCH parcial é
o que mais importa:

```bash
A=http://127.0.0.1:8100
# cria com design e html
ID=$(curl -s -X POST $A/templates -H "Authorization: Bearer $T" \
     -H 'Content-Type: application/json' \
     -d '{"name":"T1","design":{"body":{"rows":[]}},"html":"<p>oi</p>"}' \
     | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
# PATCH só do nome
curl -s -X PATCH $A/templates/$ID -H "Authorization: Bearer $T" \
     -H 'Content-Type: application/json' -d '{"name":"T1 renomeado"}'
```

**Esperado:** o `html` continua `<p>oi</p>` e o `design` continua preenchido.
Se algum dos dois virou `null`, o `exclude_unset` não está sendo respeitado.

- [ ] **Passo 4: commit**

---

## Tarefa 2: Campanhas — leitura

**Arquivos:** cria `backend/app/routers/campanhas.py`; modifica `app/main.py`

**Interfaces produzidas:**
- `GET /campanhas` → `{data: [...], pagination: {...}}`, cada item com
  `segment_names: list[str]`
- `GET /campanhas/{id}` → campanha + `segment_names` + `sends` (amostra) + `stats`

- [ ] **Passo 1: o router de leitura**

```python
"""Campanhas. Substitui a `campaigns-api`.

⚠️ Este lote (3A) NÃO envia. O enfileirador, o worker e o Resend chegam no 3B;
o agendamento, no 3C. Se você está escrevendo uma chamada ao Resend aqui, parou
no lote errado.
"""

import logging

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, usuario_atual

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/campanhas", tags=["campanhas"])

COLUNAS = """
    c.id::text, c.name, c.channel, c.status, c.subject, c.body,
    c.scheduled_at::text, c.sent_at::text, c.stats, c.design,
    c.segment_ids::text[] AS segment_ids,
    c.excluded_segment_ids::text[] AS excluded_segment_ids,
    c.created_at::text, c.updated_at::text
"""

# Os status que o trigger validate_campaign_status aceita. A lista vive aqui
# para recusar cedo, com mensagem melhor que uma exceção de trigger.
STATUS = ("draft", "scheduled", "sending", "sent", "paused", "failed")

AMOSTRA_ENVIOS = 50


@router.get("")
async def listar(
    estado: str | None = Query(None, alias="status"),
    canal: str | None = Query(None, alias="channel"),
    pagina: int = Query(1, alias="page", ge=1),
    limite: int = Query(20, alias="limit", ge=1, le=100),
    _: Usuario = Depends(usuario_atual),
):
    """Lista paginada, com os NOMES dos segmentos já resolvidos.

    ⚠️ Os nomes vêm numa subconsulta lateral, não numa segunda ida ao banco por
    campanha. A `campaigns-api` buscava as campanhas e depois fazia um segundo
    `select` em `segments` com todos os ids — que já era melhor que N+1, mas
    ainda são duas viagens e uma junção montada no navegador.
    """
    async with sessao(role="service_role") as conn:
        total = await conn.fetchval(
            """SELECT count(*) FROM campaigns
                WHERE ($1::text IS NULL OR status = $1)
                  AND ($2::text IS NULL OR channel = $2)""",
            estado, canal)
        linhas = await conn.fetch(
            f"""SELECT {COLUNAS}, s.nomes AS segment_names
                  FROM campaigns c
                  LEFT JOIN LATERAL (
                      SELECT array_agg(g.name ORDER BY g.name) AS nomes
                        FROM segments g WHERE g.id = ANY(c.segment_ids)
                  ) s ON true
                 WHERE ($1::text IS NULL OR c.status = $1)
                   AND ($2::text IS NULL OR c.channel = $2)
                 ORDER BY c.created_at DESC
                 LIMIT $3 OFFSET $4""",
            estado, canal, limite, (pagina - 1) * limite)
    return {
        "data": [{**dict(l), "segment_names": l["segment_names"] or []}
                 for l in linhas],
        "pagination": {"page": pagina, "limit": limite, "total": total,
                       "pages": (total + limite - 1) // limite},
    }


@router.get("/{campanha_id}")
async def detalhe(campanha_id: str, _: Usuario = Depends(usuario_atual)):
    """A campanha, os nomes dos segmentos e uma amostra dos envios.

    ⚠️ `stats` NÃO pode ser lido da coluna — ela é CONGELADA. Só é escrita uma
    vez, por `finalize_campaign_if_drained`, no instante em que a fila drena,
    antes de qualquer humano abrir ou clicar. Servir a coluna faria a tela
    mostrar ~0% de abertura para sempre.

    É por isso que o frontend calculava ao vivo — mas com
    `supabase.rpc('execute_readonly_query')` e SQL montado por concatenação:
    uma função SECURITY DEFINER que aceita consulta arbitrária do navegador. A
    spec já decidiu não portar essa RPC ("era dívida, não ativo"). A agregação
    vem para o servidor, num `LEFT JOIN LATERAL`.

    ⚠️ Use os MESMOS filtros de `finalize_campaign_if_drained`, coluna por
    coluna. O cálculo do frontend divergia num ponto — não contava
    `unsubscribed` como `sent`, e a função do banco conta. Seguir a função é o
    que evita uma terceira verdade.
    """
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            f"""SELECT {COLUNAS}, s.nomes AS segment_names
                  FROM campaigns c
                  LEFT JOIN LATERAL (
                      SELECT array_agg(g.name ORDER BY g.name) AS nomes
                        FROM segments g WHERE g.id = ANY(c.segment_ids)
                  ) s ON true
                 WHERE c.id = $1::uuid""",
            campanha_id)
        if linha is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Campanha não encontrada.")

        envios = await conn.fetch(
            """SELECT cs.id::text, cs.status, cs.sent_at::text,
                      cs.opened_at::text, cs.clicked_at::text, cs.error,
                      l.id::text AS lead_id, l.nome, l.email
                 FROM campaign_sends cs
                 LEFT JOIN leads l ON l.id = cs.lead_id
                WHERE cs.campaign_id = $1::uuid
                ORDER BY cs.created_at DESC
                LIMIT $2""",
            campanha_id, AMOSTRA_ENVIOS)

    return {**dict(linha),
            "segment_names": linha["segment_names"] or [],
            "sends": [dict(e) for e in envios]}
```

✅ **Verificado contra o banco** (numa transação revertida, com um segmento e
uma campanha de prova): o `LEFT JOIN LATERAL` devolve
`segment_names: ['seg prova']`, o cast `segment_ids::text[]` funciona, e `stats`
chega ao Python já como dicionário — a coluna tem
`default '{"sent":0,"failed":0,"opened":0,"clicked":0,"delivered":0}'`, então
nunca é nula numa campanha nova.

- [ ] **Passo 2: registrar no `main.py`** e conferir por HTTP que a lista
  responde `{"data": [], "pagination": {...}}` numa base sem campanha, e 404
  para id inexistente.

- [ ] **Passo 3: commit**

---

## Tarefa 3: Campanhas — escrita

**Arquivos:** modifica `backend/app/routers/campanhas.py`

**Interfaces produzidas:** `POST /campanhas`, `PATCH /campanhas/{id}`,
`DELETE /campanhas/{id}`, `POST /campanhas/{id}/duplicar`

- [ ] **Passo 1: os modelos e o criar**

```python
class CampanhaIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    channel: str = Field(pattern="^(email|whatsapp)$")
    subject: str | None = None
    body: str | None = None
    design: dict | None = None
    segment_ids: list[str] = Field(default_factory=list)
    excluded_segment_ids: list[str] = Field(default_factory=list)
    # ⚠️ datetime, NÃO str — precisa de `from datetime import datetime` no topo.
    # O asyncpg recusa string num parâmetro timestamptz ("expected a
    # datetime.date or datetime.datetime instance") e o cast `::timestamptz`
    # não salva: ele age no SQL, depois de o driver já ter rejeitado o
    # argumento. Este plano trazia `str` e derrubou o POST com 500 na primeira
    # execução.
    scheduled_at: datetime | None = None


@router.post("", status_code=status.HTTP_201_CREATED)
async def criar(dados: CampanhaIn, _: Usuario = Depends(usuario_atual)):
    """Nasce sempre em `draft`.

    ⚠️ O status NÃO vem do corpo. Deixar o cliente escolher permitiria criar uma
    campanha já em `sending` — que o worker do 3B pegaria e enviaria sem que
    ninguém tivesse clicado em enviar.

    ⚠️ `scheduled_at` é aceito e gravado, mas NADA no 3A leva a campanha para o
    status `scheduled`, e o promotor (`promote_scheduled_campaigns`) está
    quebrado até o 3C. Ou seja: a data fica guardada e não dispara nada.
    Guardá-la é certo — é o que o 3C vai ler —, mas **não construa botão de
    agendar neste lote**. Um botão que grava uma data e nunca envia é pior que
    botão nenhum: o admin acha que agendou.
    """
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            """INSERT INTO campaigns (name, channel, status, subject, body,
                                      design, segment_ids, excluded_segment_ids,
                                      scheduled_at)
               VALUES ($1, $2, 'draft', $3, $4, $5::jsonb,
                       $6::uuid[], $7::uuid[], $8::timestamptz)
               RETURNING id::text""",
            dados.name.strip(), dados.channel, dados.subject, dados.body,
            dados.design, dados.segment_ids, dados.excluded_segment_ids,
            dados.scheduled_at)
    return {"id": linha["id"]}
```

- [ ] **Passo 2: o editar, com a trava de status**

```python
class CampanhaPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    subject: str | None = None
    body: str | None = None
    design: dict | None = None
    segment_ids: list[str] | None = None
    excluded_segment_ids: list[str] | None = None
    scheduled_at: datetime | None = None


# Editar campanha que já saiu (ou está saindo) reescreveria a história de um
# envio real: o corpo mudaria, mas o que chegou na caixa de entrada não.
EDITAVEL = ("draft", "scheduled", "paused", "failed")


@router.patch("/{campanha_id}")
async def editar(campanha_id: str, dados: CampanhaPatch,
                 _: Usuario = Depends(usuario_atual)):
    """⚠️ PATCH de verdade (`exclude_unset`) e trava por status.

    Só `draft`, `scheduled`, `paused` e `failed` aceitam edição. `sending` e
    `sent` recusam com 409: a campanha já foi para a fila, e trocar o corpo
    agora faria a tela contar uma história diferente da que chegou ao contato.
    """
    campos = dados.model_dump(exclude_unset=True)
    if not campos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nada a atualizar.")

    casts = {"design": "::jsonb", "segment_ids": "::uuid[]",
             "excluded_segment_ids": "::uuid[]", "scheduled_at": "::timestamptz"}
    partes, valores = [], []
    for i, (coluna, valor) in enumerate(campos.items(), start=2):
        partes.append(f"{coluna} = ${i}{casts.get(coluna, '')}")
        valores.append(valor)

    async with sessao(role="service_role") as conn:
        estado = await conn.fetchval(
            "SELECT status FROM campaigns WHERE id = $1::uuid", campanha_id)
        if estado is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Campanha não encontrada.")
        if estado not in EDITAVEL:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Esta campanha está em {estado!r} e não pode mais ser editada. "
                "Duplique-a para criar uma nova versão.")
        await conn.execute(
            f"""UPDATE campaigns SET {', '.join(partes)}, updated_at = now()
                 WHERE id = $1::uuid""",
            campanha_id, *valores)
    return {"id": campanha_id}
```

- [ ] **Passo 3: excluir, preservando a mensagem da guarda**

```python
@router.delete("/{campanha_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir(campanha_id: str, _: Usuario = Depends(usuario_atual)):
    """`guard_campaign_delete` é um trigger que recusa apagar campanha com envio
    em andamento, com mensagem escrita para quem usa. Devolvê-la como 409 é o
    mesmo tratamento que o lote 2 deu ao `guard_segment_delete`; deixar virar
    500 trocaria orientação por "Internal Server Error".

    ⚠️ A guarda recusa em DOIS casos, e campanha `sent` não é um deles:
      - `status = 'sending'` — o envio está acontecendo agora
      - existe `campaign_sends` com `status = 'pending'` — sobrou fila
    Campanha `sent` e drenada apaga normalmente. Se você esperava o contrário,
    era o que este plano dizia numa versão anterior — e estava errado.
    """
    try:
        async with sessao(role="service_role") as conn:
            r = await conn.execute(
                "DELETE FROM campaigns WHERE id = $1::uuid", campanha_id)
    except asyncpg.exceptions.RaiseError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
    if r.endswith(" 0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Campanha não encontrada.")
```

⚠️ **Antes de escrever este passo, leia o corpo real da guarda** — a mensagem e
as condições precisam ser as que o banco tem hoje, não as que você imagina:

```bash
cd backend && PYTHONPATH=$PWD ./.venv/bin/python -c "
import asyncio, sys
from app.database import init_db, sessao, close_db
async def m():
    await init_db()
    async with sessao(role='service_role') as c:
        print(await c.fetchval(\"select pg_get_functiondef('guard_campaign_delete'::regproc)\"))
    await close_db()
asyncio.run(m())"
```

- [ ] **Passo 4: duplicar**

```python
@router.post("/{campanha_id}/duplicar", status_code=status.HTTP_201_CREATED)
async def duplicar(campanha_id: str, _: Usuario = Depends(usuario_atual)):
    """A cópia nasce em `draft`, sem `scheduled_at`, sem `sent_at` e com `stats`
    zerado — copiar o histórico de envio da original faria a cópia parecer já
    enviada. O sufixo é ' (cópia)', o mesmo que o lote 2 usou em segmentos.
    """
    async with sessao(role="service_role") as conn:
        novo = await conn.fetchval(
            """INSERT INTO campaigns (name, channel, status, subject, body,
                                      design, segment_ids, excluded_segment_ids)
               SELECT name || ' (cópia)', channel, 'draft', subject, body,
                      design, segment_ids, excluded_segment_ids
                 FROM campaigns WHERE id = $1::uuid
               RETURNING id""",
            campanha_id)
        if novo is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Campanha não encontrada.")
    return {"id": str(novo)}
```

- [ ] **Passo 5: conferir os quatro por HTTP.** Incluindo, obrigatoriamente:

1. `POST` com `"status":"sending"` no corpo → a campanha nasce em `draft`
   (o campo é ignorado, não existe no modelo)
2. `PATCH` numa campanha `sent` → **409**, com a mensagem mandando duplicar
3. `DELETE` numa campanha `sent` e sem envio pendente → **204**. Este é o
   caminho que apaga; a guarda não se importa com `sent`.
4. `DELETE` numa campanha `sending` → **409 com a mensagem do banco**, não 500
5. `duplicar` → a cópia vem `draft`, `sent_at` nulo, `stats` zerado

Para os testes 2, 3 e 4, mova o status direto no banco
(`UPDATE campaigns SET status='sent', sent_at=now()` / `status='sending'`), já
que não há envio neste lote. ✅ O corpo da guarda foi lido e confere:

```
IF OLD.status = 'sending' THEN RAISE EXCEPTION 'Nao e possivel excluir a
  campanha: o envio esta em andamento ...'
IF (count de campaign_sends pending) > 0 THEN RAISE EXCEPTION 'Nao e possivel
  excluir a campanha: existem % envio(s) pendente(s) na fila ...'
```

**Apague os dados de teste no fim.**

- [ ] **Passo 6: commit**

---

## Tarefa 4: A audiência da campanha

**Arquivos:** modifica `backend/app/routers/campanhas.py`

**Interfaces produzidas:** `GET /campanhas/{id}/audiencia` → `{total, amostra_nomes}`

- [ ] **Passo 1: o endpoint**

```python
@router.get("/{campanha_id}/audiencia")
async def audiencia(campanha_id: str, _: Usuario = Depends(usuario_atual)):
    """Quantos contatos esta campanha atingiria hoje.

    ⚠️ Chama `count_segment_audience` e `resolve_segment_audience` — as MESMAS
    funções que o envio do 3B vai usar. É isso que faz o número do card ser o
    número que sai. Uma contagem própria aqui viraria "o card dizia 500 e
    saíram 480".

    ⚠️ Sem segmento de inclusão, a audiência é a base inteira — e o enfileirador
    aplica um teto de 5.000 nesse caminho. O teto é repetido aqui para que a
    tela não prometa um número maior do que o envio entregaria.
    """
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            """SELECT segment_ids::text[] AS incluir,
                      excluded_segment_ids::text[] AS excluir
                 FROM campaigns WHERE id = $1::uuid""", campanha_id)
        if linha is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Campanha não encontrada.")

        incluir, excluir = linha["incluir"] or [], linha["excluir"] or []
        total = await conn.fetchval(
            "SELECT count_segment_audience($1::uuid[], $2::uuid[])",
            incluir, excluir)
        amostra = await conn.fetch(
            """SELECT COALESCE(l.nome, 'Sem nome') AS nome
                 FROM resolve_segment_audience($1::uuid[], $2::uuid[], 3) a
                 JOIN leads l ON l.id = a.lead_id""",
            incluir, excluir)

    return {"total": total or 0,
            "amostra_nomes": [a["nome"] for a in amostra],
            "teto_aplicado": len(incluir) == 0}
```

- [ ] **Passo 2: conferir** que uma campanha com um segmento de inclusão devolve
  o mesmo total que `POST /segmentos/audiencia` devolve para o mesmo segmento —
  são as mesmas funções, então divergência aqui é bug de parâmetro.

- [ ] **Passo 3: commit**

---

## Tarefa 5: As telas

**Arquivos:** cria `frontend/src/lib/templates.ts` e `frontend/src/lib/campanhas.ts`;
modifica `useTemplates` (5 pontos), `useCampaigns` (10), `CampaignDetail` (1),
`CampaignWizard` (1 ponto + 2 invokes)

- [ ] **Passo 1: os dois clientes.** Mesmo padrão de `lib/segmentos.ts` do lote
  2: a API fala português, o resto do frontend fala a forma antiga, e a tradução
  mora num lugar só. Leia `frontend/src/lib/segmentos.ts` antes de escrever —
  ele é o molde.

- [ ] **Passo 2: `useTemplates` e `useCampaigns`.** A forma dos hooks **não
  muda** — o que sai é o acesso direto. `useCampaigns` tem 433 linhas; não o
  reescreva, troque só os pontos.

- [ ] **Passo 3: `CampaignDetail`** (1 ponto) e o `CampaignWizard` (879 linhas,
  1 ponto de acesso direto + 2 `functions.invoke`).

  ⚠️ **Os dois `invoke` do wizard são `send-campaign` e `send-test-email`, e
  NENHUM dos dois tem substituto neste lote.** Não os aponte para endpoint
  nenhum e não os deixe estourando. Troque por um aviso honesto, no padrão que o
  lote 1C usou na barra de ações em massa:

```tsx
// O envio chega no lote 3B, junto com a fila e o worker. Até lá o botão diz
// isso em vez de estourar: um botão que falha ao ser clicado ensina o admin a
// desconfiar da tela inteira.
toast.info('O envio de campanha chega no próximo lote. A campanha fica salva em rascunho.');
```

- [ ] **Passo 4: conferir no navegador** (Playwright, Vite em `127.0.0.1`, JWT
  de admin no `localStorage` sob a chave `marketinghs-token`):

1. `/campaigns` lista as campanhas com os nomes dos segmentos
2. o wizard cria uma campanha em rascunho, com template e segmento escolhidos
3. a contagem de audiência aparece e **bate** com a da tela de Segmentos
4. abrir a campanha mostra o detalhe
5. o botão de enviar mostra o aviso do 3B, sem erro no console
6. **não existe** botão de agendar prometendo disparo (ver a tarefa 3, passo 1)
7. duplicar cria a cópia em rascunho
8. excluir uma campanha em rascunho funciona

- [ ] **Passo 5: commit**

---

## Tarefa 6: Fechar o 3A

- [ ] **Passo 1: o portão, as três partes.**

```bash
# 1. as telas de campanha e template não falam mais com o Supabase
grep -rn "supabase" frontend/src/hooks/useCampaigns.tsx \
     frontend/src/hooks/useTemplates.tsx \
     frontend/src/components/admin/campaigns/

# 2. ninguém mais chama campaigns-api nem templates-api — INCLUSIVE a
#    documentação. No lote 2 o portão pegou duas chamadas mortas que nenhuma
#    tela fazia: a tela de Documentação da API e o dnmarketing-api.yaml.
grep -rn "campaigns-api\|templates-api" frontend/src frontend/public backend/app

# 3. as telas conferidas no navegador (tarefa 5, passo 4)
```

⚠️ **`send-campaign`, `send-test-email`, `resend-*` e `email-unsubscribe`
CONTINUAM na pasta.** Elas são a especificação do 3B e do 3C. Só
`campaigns-api` e `templates-api` saem neste lote.

- [ ] **Passo 2: o placar.** Esperado: **16/48** functions (14 + as 2 deste
  lote) e acesso direto perto de **51** (68 menos os 17 dos quatro arquivos).
  Meça, não herde:

```bash
python3 -c "
import pathlib, re
n = sum(len(re.findall(r'supabase\s*\.?\s*\n?\s*\.(from|rpc)\(', f.read_text()))
        for f in pathlib.Path('frontend/src').rglob('*.ts*')
        if 'integrations/supabase' not in str(f))
print(n, 'pontos de acesso direto')"
```

- [ ] **Passo 3: `docs/ROADMAP.md` e `docs/CONTINUAR-AQUI.md`.** Deixe explícito
  que **o lote 3 não fechou** — só o 3A. O próximo é o 3B, e o plano dele ainda
  precisa ser escrito.

- [ ] **Passo 4: commit**

---

## Definição de pronto do 3A

- [ ] Um template é criado, editado e apagado pela tela
- [ ] `PATCH` parcial de template **não apaga** `design` nem `html`
- [ ] A lista de campanhas traz os nomes dos segmentos sem segunda viagem
- [ ] As estatísticas vêm ao vivo e **batem com `finalize_campaign_if_drained`**
      nas chaves que as duas têm
- [ ] `useCampaigns` não chama mais `execute_readonly_query`
- [ ] Campanha nasce em `draft` mesmo que o corpo peça outro status
- [ ] Editar campanha `sent` devolve **409**, não reescreve o passado
- [ ] Excluir campanha em `sending` devolve **409 com a mensagem do banco**
- [ ] Excluir campanha `sent` e drenada **funciona** (a guarda não a protege)
- [ ] A audiência da campanha bate com a da tela de Segmentos
- [ ] O botão de enviar avisa que o envio é do 3B, sem erro no console
- [ ] `grep` limpo nos quatro arquivos, e nenhuma menção viva a `campaigns-api`
      ou `templates-api` — documentação incluída
- [ ] `pytest` continua passando

## O que este lote NÃO entrega

Nenhum e-mail sai. Sem fila, sem worker, sem Resend, sem agendamento, sem
webhook, sem descadastro. **O lote 3 continua aberto** — 3B e 3C são o que a
spec chama de "uma campanha de teste sai de verdade e a abertura aparece na
timeline".
