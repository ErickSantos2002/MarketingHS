# MarketingHS — Lote 1C: Escrita do admin — Plano

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — `superpowers:subagent-driven-development`
> ou `superpowers:executing-plans`. Os passos usam caixa (`- [ ]`).

**Objetivo:** mudar status, aplicar tag, editar, fundir e excluir contatos pela
tela — com a fusão acontecendo dentro de uma transação, e não em sete idas ao
banco a partir do navegador.

**Arquitetura:** endpoints de escrita que substituem `ContactsBulkBar` e
`StatusDropdown`. A fusão de contatos vira uma única transação no servidor.

**Stack:** FastAPI, asyncpg, pytest · React 18, Vite

**Spec:** `docs/superpowers/specs/2026-08-31-marketinghs-design.md`
**Lotes anteriores:** `…-lote-0-fundacao.md`, `…-lote-1a-entrada.md`, `…-lote-1b-leitura.md`

---

## O que você precisa saber antes de começar

### Metade do trabalho deste lote é código morto

`src/pages/admin/Dashboard.tsx` **não está roteado**. Verificado: ele não aparece
em `App.tsx`, a rota `/` do admin renderiza `AdminOverview`, e nenhum arquivo o
importa. Dele pende uma cadeia inteira:

```
pages/admin/Dashboard.tsx        208 linhas   ← ninguém importa
  └─ components/admin/LeadsTable.tsx          450 linhas   ← só o Dashboard
       └─ contacts/BulkActionsBar.tsx         527 linhas   ← só o LeadsTable
                                            ──────────────
                                            1.185 linhas
```

A `BulkActionsBar` é quase gêmea da `ContactsBulkBar` — mesmos
`handleBulkStatus`, `handleBulkTag` e `handleExport` — e carrega **17 dos 34
pontos** de acesso direto que este lote parecia ter. Portá-la seria trabalho
inteiro num código que ninguém alcança.

**A tarefa 1 apaga a cadeia.** Não é limpeza oportunista: enquanto esses
arquivos existirem, o placar de progresso mente sobre quanto falta, e a próxima
pessoa vai portar 527 linhas por engano.

### A fusão de contatos não tem transação

`ContactsBulkBar.handleMerge` funde dois contatos em **sete operações
independentes**, do navegador:

1. reatribui `lead_tags` do descartado para o mantido
2. reatribui `segment_contacts`
3. reatribui `campaign_sends`
4. reatribui `lead_notes`
5. reatribui `contact_events`
6. reatribui `lead_conversions`
7. preenche campos vazios do mantido e **apaga** o descartado

Há `try/catch`, mas **não há rollback**. Se o passo 4 falhar, os três primeiros
já foram gravados: as tags e os segmentos do descartado já migraram, mas ele
continua existindo, e agora os dois contatos apontam para os mesmos dados. O
código chega a ter a mensagem "Falha ao apagar o contato descartado" — ou seja,
o caso já foi previsto e deixado sem conserto.

Fechar o navegador no meio produz o mesmo estado.

**Este é o maior ganho de correção do lote.** No servidor, os sete passos cabem
numa transação: ou tudo acontece, ou nada.

⚠️ **Não confundir com a fusão de identidades** do lote 1B
(`merge_identities`, no `DuplicatesPanel`). Aquela funde linhas de
`ecosystem_identities` e já era uma RPC transacional. Esta funde `leads`.

### Há dois "mudar status", e eles não são iguais

| Onde | Chave | Cria status novo? |
|---|---|---|
| `StatusDropdown` (tela) | `lead_id` | não |
| `contact-status-update` (API pública) | `dnia_id` | **sim** — insere em `lead_statuses` se não existir |

A function externa faz busca case-insensitive em `lead_statuses` e, se não achar,
insere — com uma nova busca em caso de erro, que é uma tentativa de contornar
corrida. É a mesma família de problema da criação de tag no lote 1A: **use
upsert com `ON CONFLICT`**, não busca-e-insere.

O `StatusDropdown` faz três coisas em sequência, sem transação: atualiza o
status, avança o `stage` da identidade via `resolve_or_create_identity`, e
insere um `contact_event`. Esse evento é o que alimenta o `status_changed_at` da
listagem — se ele falhar em silêncio, o histórico de status fica com buraco.

### O `delete-contact` fala com o Nexus

Antes de apagar localmente, ele chama a API do Nexus para apagar o contato lá
também. Isso é integração da dn.ia — **território do lote 5**, onde vira
GrowthHS. Neste lote a exclusão é **local apenas**, com a chamada externa
deixada como ponto de extensão explícito, não esquecida.

---

## Restrições globais

- **`sessao()` é o único caminho para dado.**
- **Nenhum endpoint depende do RLS para autorizar** — `usuario_atual` ou `admin_atual`.
- **Excluir contato exige `admin_atual`**, como a function de origem exigia.
- **O portão tem TRÊS partes** (ver `CLAUDE.md`).
- **`grep` de linha única não serve para medir.**
- **Backend na porta 8100 no host.**
- **Comentário e nome de módulo em português.**

---

## Tarefa 1: Apagar a cadeia morta

**Arquivos:** remove `src/pages/admin/Dashboard.tsx`,
`src/components/admin/LeadsTable.tsx`,
`src/components/admin/contacts/BulkActionsBar.tsx`

- [ ] **Passo 1: provar que está morto antes de apagar**

```bash
cd frontend
grep -rn "admin/Dashboard\|pages/admin/Dashboard" src --include=*.ts --include=*.tsx
grep -rn "admin/LeadsTable" src --include=*.ts --include=*.tsx
grep -rn "BulkActionsBar" src --include=*.tsx | grep import
grep -n "Dashboard" src/App.tsx
```

Esperado: o primeiro e o último **vazios**; o segundo só com `Dashboard.tsx`; o
terceiro só com `LeadsTable.tsx`. Se qualquer um trouxer outra coisa, **pare** —
a cadeia não está morta e este plano precisa mudar.

- [ ] **Passo 2: apagar**

```bash
git rm src/pages/admin/Dashboard.tsx \
       src/components/admin/LeadsTable.tsx \
       src/components/admin/contacts/BulkActionsBar.tsx
```

- [ ] **Passo 3: o build e os tipos têm de continuar limpos**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -E "Dashboard|LeadsTable|BulkActionsBar"
npx vite build 2>&1 | tail -3
```

Esperado: nenhuma menção aos três, e build completo. Se aparecer import
quebrado, algum arquivo os usava e o passo 1 não pegou.

- [ ] **Passo 4: o placar cai sozinho**

```bash
python3 -c "
import pathlib, re
p = re.compile(r'supabase\s*\.\s*(from|rpc)\s*\(')
n = sum(len(p.findall(f.read_text())) for f in pathlib.Path('src').rglob('*.ts*')
        if 'integrations/supabase' not in str(f))
print(n, 'pontos de acesso direto')"
```

Esperado: **111**, vindo de 128 — os 17 da `BulkActionsBar`.

- [ ] **Passo 5: commit**

```bash
git commit -m "chore: apaga a cadeia morta do Dashboard

pages/admin/Dashboard.tsx não está roteado — não aparece em App.tsx, a rota /
do admin renderiza o Overview, e ninguém o importa. Dele pendiam LeadsTable
(450 linhas) e BulkActionsBar (527), cada um importado só pelo anterior.

A BulkActionsBar é quase gêmea da ContactsBulkBar e carregava 17 dos 34 pontos
de acesso direto que o lote 1C parecia ter. Enquanto ela existisse, o placar
mentiria sobre quanto falta e alguém portaria 527 linhas por engano.

1.185 linhas, 17 pontos. O acesso direto cai de 128 para 111."
```

---

## Tarefa 2: Mudança de status

**Arquivos:**
- Cria: `backend/app/routers/escrita_contatos.py`
- Modifica: `backend/app/main.py`, `frontend/src/components/admin/contacts/StatusDropdown.tsx`

**Interfaces:**
- Produz: `PATCH /contatos/{lead_id}/status` com `{status}`;
  `POST /contatos/status-em-lote` com `{lead_ids, status}`

- [ ] **Passo 1: `backend/app/routers/escrita_contatos.py`**

```python
"""Escrita de contatos: status, tags em massa, edição, fusão e exclusão.

Separado de leitura_contatos.py de propósito: são superfícies com risco
diferente, e misturá-las torna difícil ver o que muda dado.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status as http
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, admin_atual, usuario_atual

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/contatos", tags=["contatos-escrita"])


class StatusIn(BaseModel):
    status: str = Field(min_length=1, max_length=60)


class StatusEmLoteIn(BaseModel):
    lead_ids: list[str] = Field(min_length=1, max_length=10000)
    status: str = Field(min_length=1, max_length=60)


async def _resolver_status(conn, bruto: str) -> str:
    """Devolve o nome canônico do status, criando-o se ainda não existir.

    ⚠️ Upsert, não busca-e-insere. A function de origem buscava, e se não
    achasse inseria — com uma segunda busca no `catch` para contornar corrida.
    Isso é a corrida, tratada por sintoma. Aqui o `ON CONFLICT` resolve na
    origem. É o mesmo problema que derrubou a aplicação de tags no lote 1A,
    quando a tela disparou várias ao mesmo tempo.

    A busca case-insensitive vem antes para "Lead Qualificado" e "lead
    qualificado" não virarem dois status.
    """
    nome = bruto.strip()
    existente = await conn.fetchval(
        "SELECT name FROM lead_statuses WHERE lower(name) = lower($1)", nome)
    if existente:
        return existente
    # ⚠️ O alvo do conflito é `lower(name)`, não `name`. O índice único de
    # lead_statuses é uma EXPRESSÃO (`lead_statuses_name_lower_uniq`), e o
    # Postgres exige que o ON CONFLICT case com ela — `ON CONFLICT (name)`
    # falha em tempo de execução com "no unique or exclusion constraint
    # matching".
    return await conn.fetchval(
        """INSERT INTO lead_statuses (name, color, is_system)
           VALUES ($1, '#888780', false)
           ON CONFLICT (lower(name)) DO UPDATE SET name = lead_statuses.name
           RETURNING name""",
        nome)


async def _registrar_mudanca(conn, lead_id: str, de: str | None, para: str) -> None:
    """Grava o evento de mudança de status na timeline.

    ⚠️ Não é log opcional. `contacts-list` calcula `status_changed_at` a partir
    destes eventos, e a ficha monta o histórico de status com eles. Sem o
    evento, a mudança aconteceu e ninguém consegue dizer quando.
    """
    await conn.execute(
        """INSERT INTO contact_events (lead_id, dnia_id, source_app, event_type,
                                       title, metadata)
           SELECT $1::uuid, l.dnia_id, 'marketinghs', 'contact_updated',
                  'Status alterado',
                  jsonb_build_object('de', $2::text, 'para', $3::text)
             FROM leads l WHERE l.id = $1::uuid""",
        lead_id, de, para)


@router.patch("/{lead_id}/status")
async def mudar_status(lead_id: str, dados: StatusIn,
                       _: Usuario = Depends(usuario_atual)):
    """Muda o status de um contato.

    As três operações — status, evento na timeline, avanço do estágio da
    identidade — acontecem na MESMA transação. Na tela original eram três idas
    ao banco independentes: o status mudava, e o evento podia não ser gravado
    sem que nada avisasse.
    """
    async with sessao(role="service_role") as conn:
        anterior = await conn.fetchval(
            "SELECT status FROM leads WHERE id = $1::uuid", lead_id)
        if anterior is None:
            existe = await conn.fetchval(
                "SELECT 1 FROM leads WHERE id = $1::uuid", lead_id)
            if not existe:
                raise HTTPException(http.HTTP_404_NOT_FOUND, "Contato não encontrado.")

        novo = await _resolver_status(conn, dados.status)
        await conn.execute(
            "UPDATE leads SET status = $2 WHERE id = $1::uuid", lead_id, novo)
        await _registrar_mudanca(conn, lead_id, anterior, novo)

        # Estágio da identidade: o original avançava para 'opportunity' ao
        # qualificar. A regra de QUAIS status avançam o estágio é de produto e
        # ainda não foi definida para a HS — ver ROADMAP. Enquanto isso o
        # estágio não é tocado, que é melhor que avançá-lo por engano.

    return {"status": novo, "anterior": anterior}


@router.post("/status-em-lote")
async def status_em_lote(dados: StatusEmLoteIn, _: Usuario = Depends(usuario_atual)):
    """Muda o status de vários contatos de uma vez.

    Um UPDATE só, e um INSERT ... SELECT para os eventos. A tela fazia lotes de
    100 num laço no navegador; aqui o banco resolve, e ou muda tudo ou não muda
    nada.
    """
    async with sessao(role="service_role") as conn:
        novo = await _resolver_status(conn, dados.status)
        await conn.execute(
            """INSERT INTO contact_events (lead_id, dnia_id, source_app, event_type,
                                           title, metadata)
               SELECT l.id, l.dnia_id, 'marketinghs', 'contact_updated',
                      'Status alterado',
                      jsonb_build_object('de', l.status, 'para', $2::text)
                 FROM leads l WHERE l.id = ANY($1::uuid[]) AND l.status IS DISTINCT FROM $2""",
            dados.lead_ids, novo)
        resultado = await conn.execute(
            "UPDATE leads SET status = $2 WHERE id = ANY($1::uuid[])",
            dados.lead_ids, novo)
    return {"atualizados": int(resultado.rsplit(" ", 1)[-1]), "status": novo}
```

✅ **Verificado no banco:** `lead_statuses` tem `lead_statuses_name_lower_uniq`,
um índice único sobre `lower(name)`. Por isso o `ON CONFLICT` acima usa
`(lower(name))` — a expressão, não a coluna. E por isso a busca prévia é
redundante para a correção, mas útil para devolver o nome **canônico**: quem
mandar "lead qualificado" recebe de volta "Lead Qualificado".

⚠️ **Ordem no lote:** o `INSERT ... SELECT` dos eventos vem ANTES do `UPDATE`,
porque ele lê `l.status` para gravar o valor anterior. Invertido, todo evento
registraria "de X para X".

- [ ] **Passo 2: registrar o router e conferir**

```bash
curl -s -X PATCH localhost:8100/contatos/$ID/status -H "$H" \
     -H 'Content-Type: application/json' -d '{"status":"SQL - Em negociação"}'
psql "$U" -c "SELECT event_type, metadata FROM contact_events
               WHERE lead_id='$ID' ORDER BY occurred_at DESC LIMIT 1;"
```

Esperado: o status novo, e um evento com `{"de": "Lead", "para": "SQL - Em negociação"}`.

Teste também um status que **não existe** (`{"status":"Reativação"}`) e confirme
que ele foi criado em `lead_statuses` uma vez só, mesmo chamando duas vezes.

- [ ] **Passo 3: `StatusDropdown.tsx`** — troca os 3 pontos por
  `mudarStatus(leadId, status)`. O `resolve_or_create_identity` sai da tela:
  quem decide avançar estágio é o servidor, e por ora ele não avança (ver
  comentário no endpoint).

- [ ] **Passo 4: commit**

---

## Tarefa 3: Tags em massa

**Interfaces:**
- Produz: `POST /contatos/tags-em-lote` com `{lead_ids, tag}`

- [ ] **Passo 1: o endpoint**

```python
class TagEmLoteIn(BaseModel):
    lead_ids: list[str] = Field(min_length=1, max_length=10000)
    tag: str = Field(min_length=1, max_length=100)


@router.post("/tags-em-lote")
async def tags_em_lote(dados: TagEmLoteIn, _: Usuario = Depends(usuario_atual)):
    """Aplica uma tag a vários contatos.

    A tag é criada se não existir, com o mesmo upsert do lote 1A — e pelo mesmo
    motivo: `tags_name_key` é único e a criação concorrente derruba as
    perdedoras.

    O vínculo usa `ON CONFLICT DO NOTHING` sobre a PK (lead_id, tag_id): aplicar
    a mesma tag a quem já a tem não é erro, é ausência de mudança.
    """
    nome = dados.tag.strip()
    async with sessao(role="service_role") as conn:
        tag_id = await conn.fetchval(
            "SELECT id FROM tags WHERE lower(name) = lower($1)", nome)
        if tag_id is None:
            tag_id = await conn.fetchval(
                """INSERT INTO tags (name) VALUES ($1)
                   ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
                   RETURNING id""", nome)
        resultado = await conn.execute(
            """INSERT INTO lead_tags (lead_id, tag_id)
               SELECT unnest($1::uuid[]), $2
               ON CONFLICT DO NOTHING""",
            dados.lead_ids, tag_id)
    return {"vinculados": int(resultado.rsplit(" ", 1)[-1]), "tag": nome}
```

- [ ] **Passo 2: conferir** que aplicar duas vezes devolve `vinculados: 0` na
  segunda, sem erro.

- [ ] **Passo 3: commit**

---

## Tarefa 4: A fusão de contatos, numa transação

**Interfaces:**
- Produz: `POST /contatos/fundir` com `{manter, descartar}`

Esta é a tarefa que mais importa do lote.

- [ ] **Passo 1: ler o `handleMerge` inteiro antes de escrever**

```bash
sed -n "$(grep -n 'const handleMerge' frontend/src/components/admin/contacts/ContactsBulkBar.tsx | cut -d: -f1),+70p" \
    frontend/src/components/admin/contacts/ContactsBulkBar.tsx
```

Preste atenção em **quais campos** são copiados do descartado para o mantido e
sob que condição (só os vazios? todos?). Essa regra não pode ser adivinhada.

- [ ] **Passo 2: o endpoint**

```python
class FusaoContatosIn(BaseModel):
    manter: str
    descartar: str


# As tabelas que apontam para `leads` e precisam ser reatribuídas na fusão.
# Vieram do handleMerge da tela; se alguma FK nova aparecer, ela entra aqui.
_TABELAS_FILHAS = ("lead_tags", "segment_contacts", "campaign_sends",
                   "lead_notes", "contact_events", "lead_conversions")

# Campos que o mantido herda do descartado QUANDO estiver vazio.
_CAMPOS_HERDAVEIS = ("nome", "whatsapp", "empresa", "cargo", "faturamento",
                     "funcionarios", "desafios", "utm_source", "utm_medium",
                     "utm_campaign", "utm_term", "utm_content")


@router.post("/fundir")
async def fundir_contatos(dados: FusaoContatosIn, _: Usuario = Depends(admin_atual)):
    """Funde dois contatos: o descartado entrega tudo ao mantido e some.

    ⚠️ A razão de este endpoint existir é a TRANSAÇÃO. Na tela isto eram sete
    idas ao banco independentes — reatribuir seis tabelas e apagar o descartado
    —, com try/catch mas sem rollback. Falhar no meio deixava as tags e os
    segmentos já migrados, o descartado ainda existindo, e os dois contatos
    apontando para os mesmos dados. Fechar o navegador produzia o mesmo estado.

    `sessao()` abre transação; ou os sete passos acontecem, ou nenhum.

    ⚠️ `lead_tags` tem PK (lead_id, tag_id) e `segment_contacts` tem PK
    (segment_id, lead_id) — verificado no banco. Se o mantido JÁ tem a mesma tag
    ou segmento, o UPDATE do descartado viola a chave. Por isso a reatribuição
    apaga a duplicata do descartado antes de mover.

    `campaign_sends.lead_id` é ON DELETE SET NULL: sem a reatribuição, apagar o
    descartado não apagaria os envios dele — deixaria órfãos com lead_id nulo,
    e o histórico de campanha do contato mantido ficaria incompleto.
    """
    if dados.manter == dados.descartar:
        raise HTTPException(http.HTTP_400_BAD_REQUEST, "Os dois contatos são o mesmo.")

    async with sessao(role="service_role") as conn:
        for coluna in ("manter", "descartar"):
            if not await conn.fetchval(
                "SELECT 1 FROM leads WHERE id = $1::uuid", getattr(dados, coluna)):
                raise HTTPException(http.HTTP_404_NOT_FOUND,
                                    f"Contato a {coluna} não encontrado.")

        # Junções com par único: tira do descartado o que o mantido já tem.
        await conn.execute(
            """DELETE FROM lead_tags d WHERE d.lead_id = $2::uuid
                 AND EXISTS (SELECT 1 FROM lead_tags m
                              WHERE m.lead_id = $1::uuid AND m.tag_id = d.tag_id)""",
            dados.manter, dados.descartar)
        await conn.execute(
            """DELETE FROM segment_contacts d WHERE d.lead_id = $2::uuid
                 AND EXISTS (SELECT 1 FROM segment_contacts m
                              WHERE m.lead_id = $1::uuid AND m.segment_id = d.segment_id)""",
            dados.manter, dados.descartar)

        movidos = {}
        for tabela in _TABELAS_FILHAS:
            r = await conn.execute(
                f"UPDATE {tabela} SET lead_id = $1::uuid WHERE lead_id = $2::uuid",
                dados.manter, dados.descartar)
            movidos[tabela] = int(r.rsplit(" ", 1)[-1])

        # O mantido herda só o que tem vazio. Dado preenchido nunca é
        # sobrescrito — a mesma regra da importação, pelo mesmo motivo.
        atribuicoes = ", ".join(
            f"{c} = COALESCE(m.{c}, d.{c})" for c in _CAMPOS_HERDAVEIS)
        await conn.execute(
            f"""UPDATE leads m SET {atribuicoes}
                  FROM leads d WHERE m.id = $1::uuid AND d.id = $2::uuid""",
            dados.manter, dados.descartar)

        await conn.execute("DELETE FROM leads WHERE id = $1::uuid", dados.descartar)

    return {"mantido": dados.manter, "movidos": movidos}
```

- [ ] **Passo 3: provar que a transação segura**

Não basta ver a fusão funcionar. Prove que ela **desfaz**: force um erro no
meio (por exemplo, passando um `descartar` que existe mas violando uma FK de
propósito, ou interrompendo com uma constraint temporária) e confirme que
NENHUMA tabela ficou alterada.

```bash
psql "$U" -c "SELECT 'antes', count(*) FROM lead_tags WHERE lead_id='$DESCARTAR';"
# provoca a falha
psql "$U" -c "SELECT 'depois', count(*) FROM lead_tags WHERE lead_id='$DESCARTAR';"
```

Esperado: os dois números **iguais**. Se o segundo for 0, a transação não está
segurando e o endpoint é tão perigoso quanto a tela era.

- [ ] **Passo 4: `ContactsBulkBar.handleMerge`** vira uma chamada.

- [ ] **Passo 5: commit**

---

## Tarefa 5: Editar e excluir contato

**Interfaces:**
- Produz: `PATCH /contatos/{lead_id}` · `DELETE /contatos/{lead_id}`

- [ ] **Passo 1: ler `contact-update` e `contact-delete` de origem**

```bash
cat backend/supabase/functions/contact-update/index.ts
cat backend/supabase/functions/delete-contact/index.ts
```

⚠️ O `delete-contact` **chama a API do Nexus** para apagar o contato lá antes de
apagar aqui. Isso é integração da dn.ia e é do **lote 5**, onde vira GrowthHS.
Neste lote a exclusão é local. Deixe um comentário nomeando o ponto de extensão
— não apague a intenção junto com o código.

- [ ] **Passo 2: os endpoints.** A exclusão exige `admin_atual`, como a origem
  exigia.

✅ **Verificado: a exclusão é LÓGICA.** O `delete-contact` faz
`update({ deleted_at, deleted_by })`, e a tabela `leads` tem as duas colunas.
Isso fecha com as três visões da listagem do lote 1B (ativos / apagados /
todos) — não há inconsistência herdada, como eu suspeitava.

Grave `deleted_by` com o id de `admin_atual`. Ele existe e ninguém o preenchia
pela tela; um registro de quem apagou vale mais que a coluna vazia.

```python
@router.delete("/{lead_id}", status_code=http.HTTP_204_NO_CONTENT)
async def excluir_contato(lead_id: str, admin: Usuario = Depends(admin_atual)):
    """Exclusão lógica: marca `deleted_at` e `deleted_by`.

    ⚠️ Ponto de extensão do lote 5: a function de origem chamava a API do Nexus
    para apagar o contato lá também, antes de marcar aqui. Na HS o destino é o
    GrowthHS. Não implemente agora — mas não apague a intenção: quando o handoff
    existir, a exclusão precisa propagar.
    """
    async with sessao(role="service_role") as conn:
        r = await conn.execute(
            """UPDATE leads SET deleted_at = now(), deleted_by = $2::uuid
                WHERE id = $1::uuid AND deleted_at IS NULL""",
            lead_id, admin.id)
    if r.endswith(" 0"):
        raise HTTPException(http.HTTP_404_NOT_FOUND,
                            "Contato não encontrado ou já excluído.")
```

- [ ] **Passo 3: trocar na tela e conferir**

- [ ] **Passo 4: commit**

---

## Tarefa 6: Fechar o lote

- [ ] **Passo 1: o portão, as três partes**

```bash
grep -rn "supabase" frontend/src/components/admin/contacts/ContactsBulkBar.tsx \
                    frontend/src/components/admin/contacts/StatusDropdown.tsx

for f in contact-update contact-status-update contact-tags-sync apply-lead-tag delete-contact; do
  echo -n "$f: "; grep -rl "$f" frontend/src 2>/dev/null | tr '\n' ' '; echo
done
```

⚠️ `apply-lead-tag` ficou desde o lote 1A porque `lib/leadConversion.ts` a
chamava. Confira se ainda chama — se sim, ela **continua na pasta**, e isso não
é falha deste lote.

- [ ] **Passo 2: o placar**

Esperado: acesso direto perto de **94** (111 depois da tarefa 1, menos os 17 da
`ContactsBulkBar`), e as functions que puderem sair.

- [ ] **Passo 3: atualizar `ROADMAP.md` e `CONTINUAR-AQUI.md`**

- [ ] **Passo 4: commit**

---

## Definição de pronto do lote 1C

- [ ] A cadeia morta do Dashboard foi apagada e o build continua limpo
- [ ] Mudar status de um contato grava o evento na timeline, na mesma transação
- [ ] Mudar status de vários grava um evento por contato, com o valor anterior certo
- [ ] Um status que não existe é criado uma vez só, mesmo com chamadas simultâneas
- [ ] Aplicar tag em massa duas vezes não duplica vínculo
- [ ] **A fusão desfaz por completo quando falha no meio** — provado, não suposto
- [ ] A fusão não quebra quando o mantido já tem a mesma tag ou segmento
- [ ] Excluir contato exige perfil de administrador
- [ ] `grep` limpo na `ContactsBulkBar` e no `StatusDropdown`
- [ ] `pytest` continua passando

## O que este lote deixa aberto

1. **Quais status avançam o estágio da identidade.** O original avançava para
   `opportunity` ao qualificar. A régua da HS não existe ainda, e avançar por
   engano é pior que não avançar.
2. **A exclusão no sistema externo.** Local neste lote; vira GrowthHS no lote 5.
3. **Quem limpa os contatos com `deleted_at` antigo.** A exclusão é lógica e
   nada os remove de vez. Não é urgente, mas a lixeira cresce para sempre.
