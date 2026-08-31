# MarketingHS — Lote 2: Segmentos — Plano

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — `superpowers:subagent-driven-development`
> ou `superpowers:executing-plans`. Os passos usam caixa (`- [ ]`).

**Objetivo:** criar, editar e usar segmentos pela tela, com a lista de membros
gravada dentro de uma transação e a contagem vinda de uma consulta só.

**Arquitetura:** endpoints que expõem as funções de segmento que já existem no
Postgres. A lógica de transformar regra em SQL **fica no banco** — ela
sobreviveu ao port do schema, está em produção há meses e não há motivo para
reescrevê-la em Python.

**Stack:** FastAPI, asyncpg · React 18, Vite

**Spec:** `docs/superpowers/specs/2026-08-31-marketinghs-design.md`
**Lotes anteriores:** `…-lote-0`, `…-1a`, `…-1b`, `…-1c`, `…-1d`

---

## O que você precisa saber antes de começar

### O banco já sabe fazer segmento

Oito funções sobreviveram ao port do schema e fazem o trabalho pesado:

| Função | O que faz |
|---|---|
| `build_segment_condition(jsonb)` | transforma **uma regra** em fragmento SQL |
| `evaluate_segment_rules(segment_id)` | devolve os `lead_id` de um segmento dinâmico |
| `preview_segment_rules(rules, logic)` | o mesmo, para regras ainda não salvas |
| `evaluate_segment_for_lead(lead_id, segment_id)` | um contato pertence? |
| `resolve_segment_audience(include[], exclude[], limit)` | público de vários segmentos, com exclusão |
| `count_segment_audience(include[], exclude[])` | só o tamanho |
| `guard_segment_delete()` | trigger que impede exclusão em uso |
| `sync_campaign_legacy_segment_id()` | trigger de compatibilidade |

**Não reimplemente nada disso em Python.** Os endpoints as chamam.

### Há dois tipos de segmento, e eles não se parecem

- **estático**: a lista de membros está em `segment_contacts`, uma linha por
  contato. Quem entra, entra na mão.
- **dinâmico**: não tem membros gravados; as regras são avaliadas na hora por
  `evaluate_segment_rules`.

Quase todo endpoint precisa ramificar nos dois. A tela já faz isso; o servidor
passa a fazer.

### Quatro problemas no caminho atual

**1. A contagem é N+1.** `fetchSegments` busca os segmentos e depois, **para
cada um**, faz uma consulta ou uma RPC para contar. Dez segmentos são onze idas
ao banco. Cabe em uma.

**2. Criar e editar não são transacionais.** `createSegment` grava o segmento e
só então insere os membros, em lotes de 100. Falhar no meio deixa um segmento
com parte dos contatos — e ninguém sabe que está pela metade. Mesma família do
defeito da fusão no lote 1C.

**3. Editar apaga todos os membros antes de reinserir.** Há uma janela em que o
segmento está vazio. Se a reinserção falhar, ele fica vazio para sempre. Numa
transação isso deixa de existir.

**4. Buscar os contatos de um segmento dinâmico faz RPC + N lotes de 200.** A
RPC devolve os ids e a tela busca os leads em pedaços. Um `JOIN` resolve.

⚠️ E há um defeito pequeno: `updateSegment` chama `fetchSegments()` **duas
vezes** seguidas. Não quebra nada, dobra o tráfego.

### A guarda de exclusão é boa e precisa sobreviver

`guard_segment_delete` levanta exceção com mensagem em português quando o
segmento está em uso:

> `Este segmento é usado pela campanha "X" (ainda não enviada). Remova-o da
> campanha antes de excluí-lo.`

⚠️ **O endpoint tem de devolver essa mensagem**, como 409, e não deixá-la virar
um 500 genérico. A mensagem é boa, foi escrita para quem usa, e perdê-la seria
trocar orientação por "Internal Server Error".

---

## Restrições globais

- **`sessao()` é o único caminho para dado**, e é ela que abre a transação.
- **Nenhum endpoint depende do RLS para autorizar.**
- **A lógica de regra fica no banco.** Endpoint chama RPC.
- **O portão tem TRÊS partes** (ver `CLAUDE.md`).
- **Backend na porta 8100 no host.**
- **Comentário e nome de módulo em português.**

---

## Tarefa 1: Listar e contar

**Arquivos:** cria `backend/app/routers/segmentos.py`; modifica `app/main.py`

**Interfaces:** `GET /segmentos` → lista com `total_contatos` já preenchido

- [ ] **Passo 1: o endpoint**

```python
"""Segmentos. A lógica de regra mora no Postgres — aqui só a exposição."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, usuario_atual

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/segmentos", tags=["segmentos"])


class RegraIn(BaseModel):
    field: str
    operator: str
    value: str


class SegmentoIn(BaseModel):
    nome: str = Field(min_length=1, max_length=200)
    descricao: str | None = None
    tipo: str = Field(pattern="^(static|dynamic)$")
    regras: list[RegraIn] = Field(default_factory=list)
    logica: str = Field(default="and", pattern="^(and|or)$")
    # Só para estático: a lista de membros.
    lead_ids: list[str] | None = None


@router.get("")
async def listar(_: Usuario = Depends(usuario_atual)):
    """Lista os segmentos com a contagem de contatos já resolvida.

    ⚠️ Uma consulta, não N+1. A tela buscava os segmentos e depois, para CADA
    um, fazia outra ida ao banco para contar — dez segmentos eram onze
    consultas. O LATERAL abaixo resolve os dois tipos numa passada: estático
    conta linhas de segment_contacts, dinâmico chama evaluate_segment_rules.
    """
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            """SELECT s.id::text, s.name AS nome, s.description AS descricao,
                      s.type AS tipo, s.rules AS regras,
                      COALESCE(s.logic, 'and') AS logica,
                      s.created_at::text, s.updated_at::text,
                      c.total AS total_contatos
                 FROM segments s
                 LEFT JOIN LATERAL (
                     SELECT CASE
                         WHEN s.type = 'dynamic'
                           THEN (SELECT count(*) FROM evaluate_segment_rules(s.id))
                         ELSE (SELECT count(*) FROM segment_contacts sc
                                WHERE sc.segment_id = s.id)
                     END AS total
                 ) c ON true
                ORDER BY s.created_at DESC""")
    return [dict(l) for l in linhas]
```

✅ **Verificado: `segments.logic` existe** (text). O comentário do hook dizia
que o `types.ts` ainda não a conhecia — é o tipo gerado que estava desatualizado,
não a coluna que faltava. O `COALESCE(s.logic, 'and')` cobre as linhas antigas
gravadas antes de ela existir.

- [ ] **Passo 2: conferir** que a contagem bate com o que a tela mostrava, para
  um segmento de cada tipo. Sem segmento na base ainda? Crie dois na tarefa 2 e
  volte aqui.

- [ ] **Passo 3: commit**

---

## Tarefa 2: Criar, editar e excluir — dentro de uma transação

**Interfaces:** `POST /segmentos`, `PUT /segmentos/{id}`, `DELETE /segmentos/{id}`,
`POST /segmentos/{id}/duplicar`

- [ ] **Passo 1: criar**

```python
@router.post("", status_code=status.HTTP_201_CREATED)
async def criar(dados: SegmentoIn, _: Usuario = Depends(usuario_atual)):
    """Cria o segmento e, se for estático, os membros — na MESMA transação.

    ⚠️ A tela gravava o segmento e só então inseria os membros, em lotes de 100.
    Falhar no meio deixava um segmento com parte dos contatos, e nada indicava
    que estava pela metade. Aqui ou nasce inteiro, ou não nasce.
    """
    async with sessao(role="service_role") as conn:
        segmento_id = await conn.fetchval(
            """INSERT INTO segments (name, description, type, rules, logic)
               VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id""",
            dados.nome.strip(), dados.descricao, dados.tipo,
            [r.model_dump() for r in dados.regras], dados.logica)

        if dados.tipo == "static" and dados.lead_ids:
            # unnest em vez de laço de lotes: uma instrução, e o banco cuida
            # do volume.
            await conn.execute(
                """INSERT INTO segment_contacts (segment_id, lead_id)
                   SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING""",
                segmento_id, dados.lead_ids)

    return {"id": str(segmento_id)}
```

- [ ] **Passo 2: editar**

```python
@router.put("/{segmento_id}")
async def editar(segmento_id: str, dados: SegmentoIn,
                 _: Usuario = Depends(usuario_atual)):
    """⚠️ A tela apagava TODOS os membros e reinseria. Havia uma janela em que o
    segmento ficava vazio, e se a reinserção falhasse ele ficava vazio para
    sempre. Na transação a janela não existe: quem consultar durante a operação
    vê o estado antigo, e quem consultar depois vê o novo.
    """
    async with sessao(role="service_role") as conn:
        r = await conn.execute(
            """UPDATE segments SET name = $2, description = $3, type = $4,
                                   rules = $5::jsonb, logic = $6, updated_at = now()
                WHERE id = $1::uuid""",
            segmento_id, dados.nome.strip(), dados.descricao, dados.tipo,
            [x.model_dump() for x in dados.regras], dados.logica)
        if r.endswith(" 0"):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Segmento não encontrado.")

        if dados.tipo == "static" and dados.lead_ids is not None:
            await conn.execute(
                "DELETE FROM segment_contacts WHERE segment_id = $1::uuid", segmento_id)
            if dados.lead_ids:
                await conn.execute(
                    """INSERT INTO segment_contacts (segment_id, lead_id)
                       SELECT $1::uuid, unnest($2::uuid[]) ON CONFLICT DO NOTHING""",
                    segmento_id, dados.lead_ids)

    return {"id": segmento_id}
```

- [ ] **Passo 3: excluir, preservando a mensagem da guarda**

```python
@router.delete("/{segmento_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir(segmento_id: str, _: Usuario = Depends(usuario_atual)):
    """⚠️ `guard_segment_delete` é um trigger que impede excluir segmento em uso
    por campanha não enviada ou fluxo ativo, e levanta exceção com uma mensagem
    escrita para quem usa:

        Este segmento é usado pela campanha "X" (ainda não enviada).
        Remova-o da campanha antes de excluí-lo.

    Deixar isso virar 500 seria trocar orientação por "Internal Server Error".
    O `except` abaixo devolve a mensagem do banco como 409.
    """
    import asyncpg
    try:
        async with sessao(role="service_role") as conn:
            r = await conn.execute(
                "DELETE FROM segments WHERE id = $1::uuid", segmento_id)
    except asyncpg.exceptions.RaiseError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
    if r.endswith(" 0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Segmento não encontrado.")
```

✅ **Verificado por execução**, criando uma campanha em rascunho que usa o
segmento e tentando excluí-lo:

```
classe  : asyncpg.exceptions.RaiseError
sqlstate: P0001
mensagem: Este segmento é usado pela campanha "Campanha rascunho"
          (ainda não enviada). Remova-o da campanha antes de excluí-lo.
```

O `except asyncpg.exceptions.RaiseError` está certo, e `str(exc)` traz a
mensagem inteira.

⚠️ O trigger é `BEFORE DELETE`, então ele dispara antes de qualquer linha sair —
não há estado parcial a limpar.

- [ ] **Passo 4: duplicar.** Copia segmento e membros numa transação; o nome
  ganha um sufixo. Leia a tela para saber qual.

- [ ] **Passo 5: conferir os quatro**, incluindo a mensagem do 409 — crie uma
  campanha em rascunho usando o segmento e tente excluí-lo.

- [ ] **Passo 6: commit**

---

## Tarefa 3: Os contatos de um segmento, e a prévia

**Interfaces:** `GET /segmentos/{id}/contatos`, `POST /segmentos/previa`,
`POST /segmentos/{id}/contatos` (adicionar em lote)

- [ ] **Passo 1: os contatos**

```python
@router.get("/{segmento_id}/contatos")
async def contatos(segmento_id: str, _: Usuario = Depends(usuario_atual)):
    """Os contatos do segmento, resolvendo os dois tipos no banco.

    ⚠️ Para segmento dinâmico a tela chamava a RPC, recebia os ids e buscava os
    leads em lotes de 200 — RPC mais N consultas. Um JOIN faz tudo.
    """
    async with sessao(role="service_role") as conn:
        tipo = await conn.fetchval(
            "SELECT type FROM segments WHERE id = $1::uuid", segmento_id)
        if tipo is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Segmento não encontrado.")

        if tipo == "dynamic":
            linhas = await conn.fetch(
                """SELECT l.* FROM evaluate_segment_rules($1::uuid) r
                     JOIN leads l ON l.id = r.lead_id
                    WHERE l.deleted_at IS NULL
                    ORDER BY l.created_at DESC""", segmento_id)
        else:
            linhas = await conn.fetch(
                """SELECT l.* FROM segment_contacts sc
                     JOIN leads l ON l.id = sc.lead_id
                    WHERE sc.segment_id = $1::uuid AND l.deleted_at IS NULL
                    ORDER BY l.created_at DESC""", segmento_id)
    return [dict(l) for l in linhas]
```

⚠️ O filtro `deleted_at IS NULL` **é novo**. A tela não filtrava, então um
contato excluído continuava aparecendo no segmento — e entraria numa campanha.
Isso é correção, não port fiel; registre no commit. Se você concluir que o
comportamento antigo era proposital, tire o filtro e diga por quê.

- [ ] **Passo 2: a prévia** — `preview_segment_rules(rules, logic)` avalia
  regras **ainda não salvas**, que é o que o construtor da tela precisa para
  mostrar "quantos contatos batem" enquanto a pessoa monta o filtro.

- [ ] **Passo 3: adicionar contatos em lote** — o que a barra de ações em massa
  do lote 1C precisa. ⚠️ Ela ficou com a ação desativada esperando este
  endpoint; **reative-a nesta tarefa**, ou o lote 2 fecha deixando um botão
  morto que ninguém vai lembrar de ligar.

- [ ] **Passo 4: conferir e commitar**

---

## Tarefa 4: A tela

**Arquivos:** `frontend/src/lib/segmentos.ts` (novo), `useSegments`,
`useSegmentAudience`, `SegmentFormModal`, e a barra do lote 1C

- [ ] **Passo 1: o cliente e o `useSegments`.** São 13 pontos, o maior bloco
  isolado que resta no frontend. A forma do hook não muda — o que sai é o
  acesso direto.

  ⚠️ `updateSegment` chama `fetchSegments()` **duas vezes** seguidas. Corrija ao
  passar.

- [ ] **Passo 2: `useSegmentAudience`** (3 pontos) e **`SegmentFormModal`**
  (3 pontos: `tags` e duas em `leads`). O modal tem 836 linhas e é o construtor
  de regras — **não o reescreva**, troque só os pontos de acesso.

- [ ] **Passo 3: conferir no navegador** — crie um segmento estático com dois
  contatos, um dinâmico com uma regra, veja as contagens, abra a lista de
  contatos de cada um, e tente excluir um que esteja em uso.

- [ ] **Passo 4: commit**

---

## Tarefa 5: A API pública de segmentos

**Interfaces:** `GET /publico/segmentos` e o que `segments-api` expõe

`segments-api` usa `validateAuth` — e a chave de API existe desde o lote 1D.

- [ ] **Passo 1: ler `segments-api/index.ts`** (123 linhas) e portar o que ela
  expõe, com `Depends(chave_api('read'))` ou `'write'` conforme o método.

- [ ] **Passo 2: conferir com uma chave real e commitar**

---

## Tarefa 6: Fechar o lote

- [ ] **Passo 1: o portão, as três partes.** As telas limpas, ninguém chamando
  `segments-api`, e a tela conferida no navegador.

- [ ] **Passo 2: o placar.** Esperado: **14/48** functions e acesso direto perto
  de **68** (87 menos os 19 dos quatro arquivos).

- [ ] **Passo 3: `ROADMAP.md` e `CONTINUAR-AQUI.md`.**

- [ ] **Passo 4: commit**

---

## Definição de pronto do lote 2

- [ ] A lista de segmentos traz a contagem sem N+1
- [ ] Criar segmento estático grava segmento e membros na mesma transação
- [ ] Editar não deixa janela com o segmento vazio
- [ ] Excluir segmento em uso devolve **409 com a mensagem do banco**, não 500
- [ ] Segmento dinâmico lista contatos com uma consulta, não RPC + N lotes
- [ ] Contato excluído não aparece mais em segmento
- [ ] A ação "adicionar a segmento" da barra de ações em massa **voltou a funcionar**
- [ ] `grep` limpo nos quatro arquivos do domínio
- [ ] `pytest` continua passando

## O que este lote destrava

O **lote 3 (Campanhas)** precisa de segmento para escolher público. Sem isto,
campanha não tem para quem enviar.
