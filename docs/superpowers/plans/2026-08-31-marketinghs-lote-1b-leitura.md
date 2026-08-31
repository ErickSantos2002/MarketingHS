# MarketingHS — Lote 1B: Leitura do admin — Plano

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — `superpowers:subagent-driven-development`
> ou `superpowers:executing-plans`. Os passos usam caixa (`- [ ]`).

**Objetivo:** a tela de Contatos lista os contatos importados e a ficha 360° abre
com timeline, notas e tags — tudo contra a API própria.

**Arquitetura:** endpoints de leitura que substituem o acesso direto ao banco do
`AdminDataProvider`, que é o hub de dados de todo o admin. A ficha vem inteira,
incluindo as escritas que pertencem a ela (nota, tag).

**Stack:** FastAPI, asyncpg · React 18, Vite

**Spec:** `docs/superpowers/specs/2026-08-31-marketinghs-design.md`
**Lotes anteriores:** `…-lote-0-fundacao.md`, `…-lote-1a-entrada.md`

---

## A decomposição do lote 1, ajustada

O anúncio original dizia que o 1B levaria "lista, ficha 360° e a API pública por
chave". Investigando, isso não se sustenta por dois motivos:

1. **A API pública é outro consumidor.** `contacts-list` e `contact-details`
   servem chamadores externos por chave de API — a tela do admin não os usa,
   ela lê o banco direto. Portá-los junto misturaria dois trabalhos, e exigiria
   trazer o segundo modelo de autenticação (hash SHA-256 na tabela `api_keys`,
   escopo `read`/`write`, expiração) para dentro de um lote de tela.
2. **A HS ainda não tem consumidor externo.** Quem consome aquela API hoje
   consome a produção da dn.ia, não a nossa.

Então:

| Sub-lote | Escopo | Estado |
|---|---|---|
| 1A | Entrada — importar, pontuar, etiquetar | ✅ concluído |
| **1B** | **Leitura do admin** — lista e ficha 360° inteira | este plano |
| 1C | Escrita — status e ações em massa | a fazer |
| 1D | Identidade e captura — dedupe, fusão, captura externa | a fazer |
| 1E | **A API pública** — `api_keys`, `contacts-list`, `contact-details` | a fazer |

A ficha do contato leva as escritas que são dela (criar nota, aplicar e remover
tag). Separá-las para o 1C deixaria a ficha meio quebrada por um lote inteiro,
sem ganho nenhum de clareza.

---

## Restrições globais

- **`sessao()` é o único caminho para dado.** `role="service_role"` só para
  operação interna; nunca para request de usuário sem autorizar antes.
- **Nenhum endpoint depende do RLS para autorizar.** Cada rota usa
  `usuario_atual` ou `admin_atual`.
- **O papel de admin é `'admin'`.**
- **O portão tem TRÊS partes** (ver `CLAUDE.md`): a tela limpa, ninguém mais
  chamando a function, e a tela conferida no navegador.
- **`grep` de linha única não serve para medir.** Use o comando multilinha do
  `CLAUDE.md`. São 153 pontos de acesso direto, não 68.
- **Backend na porta 8100 no host.**
- **Comentário e nome de módulo em português.**

---

## O que você precisa saber antes de começar

### O admin inteiro pendura num hub

`AdminDataProvider` (`hooks/useAdminData.tsx`) carrega **todos os leads na
memória do navegador** — `useLeads` varre a tabela de 1000 em 1000 até 10.000 —
e tudo o mais filtra em cima disso no cliente: dashboards, analytics, a tabela de
Contatos, os filtros globais.

⚠️ **Não redesenhe isso neste lote.** Trocar para filtro no servidor cascatearia
em toda tela que consome `useAdminData`, e um port não é o lugar de mudar o
modelo de carregamento de dados. Porte fiel, com o teto de 10.000, e registre a
limitação no `ROADMAP` para uma decisão futura — quando a base da HS chegar perto
disso, o assunto se resolve sozinho por necessidade.

A consequência boa: portar `useLeads` acende muito mais que a tela de Contatos.

### A ordenação da lista, e o problema que o 1A deixou

`useLeads` ordena por `updated_at DESC`. O lote 1A mostrou que recalcular scores
carimba `updated_at` em toda a base ao mesmo tempo — depois de um recálculo, a
ordem vira empate geral e o Postgres devolve as linhas em qualquer ordem, o que
faz a paginação de 1000 em 1000 **pular e repetir contatos**.

Não é hipótese: sem desempate, `ORDER BY` com valores iguais não garante ordem
estável entre páginas.

**Decisão deste lote:** manter `updated_at DESC` como intenção e acrescentar
`id DESC` como desempate. Corrige a paginação sem mudar o que a tela quer dizer.

### O scoring tem duas implementações, e a errada vence

Existem dois calculadores de score no sistema herdado:

1. **O trigger `score_lead_from_config`** no banco, que o lote 1A ligou.
2. **`scoreAndUpdateLead` em `src/lib/leadScoring.ts`**, 75 linhas de TypeScript
   que refazem a mesma conta no navegador.

A ficha do contato chama o segundo (`triggerRescore`) toda vez que uma tag muda.
E ele não recalcula: ele **grava `lead_score` e `etiqueta` direto**.

⚠️ **Essas duas colunas não estão na lista do trigger** — que só vigia `cargo`,
`faturamento`, `funcionarios`, `desafios`, `whatsapp`, `utm_source` e `source`.
Então o banco não corrige o que o navegador escreveu: **o valor do TypeScript
vence**. Duas fontes de verdade, e a que ganha é a que ninguém testou.

**Decisão deste lote: o cliente para de calcular score.** O banco é a fonte
única. `src/lib/leadScoring.ts` perde `calculateLeadScore`, `scoreToEtiqueta`,
`fetchScoringConfig` e `scoreAndUpdateLead` — as constantes de exibição
(rótulos, cores de etiqueta) ficam.

E `triggerRescore` some da ficha sem substituto: **tag não é critério de
scoring**. Os sete critérios são cargo, faturamento, funcionários, desafios,
origem, reconversão e WhatsApp. Recalcular depois de mexer numa tag nunca mudou
nada — era trabalho e risco por nada.

### `dashboard_settings` não tem dono

A tabela é `(setting_key, setting_value)` — global, sem `user_id`. O
`ColumnSelector` chama `supabase.auth.getUser()` para compor uma chave por
usuário. Preserve esse comportamento usando o id de `usuario_atual`.

---

## Estrutura de arquivos

**Cria:**

| Arquivo | Responsabilidade |
|---|---|
| `backend/app/routers/leitura_contatos.py` | Lista, enriquecimento, ficha, timeline, duplicatas |
| `backend/app/routers/preferencias.py` | `dashboard_settings` por usuário |
| `frontend/src/lib/leitura.ts` | As chamadas de leitura, sobre `@/lib/api` |

**Modifica:** `useLeads`, `useContactsEnriched`, `useLeadConversionUtmContents`,
`ColumnSelector`, `DetailSections`, `EventsTimeline`, `DuplicatesPanel`,
`backend/app/main.py`

---

## Tarefa 1: A lista de contatos

**Interfaces:**
- Produz: `GET /contatos?pagina=&tamanho=&incluir_apagados=` →
  `{itens: [...], tem_mais: bool}`

- [ ] **Passo 1: conferir as colunas que a tela consome**

```bash
sed -n '/^const LEAD_COLUMNS/,/join/p' frontend/src/hooks/useLeads.tsx
```

São 33 colunas nomeadas, escolhidas de propósito para não trazer campos de A/B e
auditoria. **Use exatamente essa lista** — `SELECT *` traria colunas que a tela
não usa e que o lote 7 vai querer manter fora.

- [ ] **Passo 2: `backend/app/routers/leitura_contatos.py`**

```python
"""Leitura de contatos para o admin.

Substitui o acesso direto ao banco do AdminDataProvider, que é o hub de dados
de todo o painel.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, usuario_atual

router = APIRouter(prefix="/contatos", tags=["contatos-leitura"])

# As 33 colunas que o painel consome. Espelha LEAD_COLUMNS em
# frontend/src/hooks/useLeads.tsx — as duas listas têm de andar juntas.
COLUNAS_LEAD = """
    id::text, created_at::text, updated_at::text, tipo, tipo_participante,
    session_id, nome, email, whatsapp, cargo, empresa, faturamento,
    funcionarios, desafios, source, utm_source, utm_medium, utm_campaign,
    utm_term, utm_content, etiqueta, origem_campanha, presenca,
    interesse_ecossistema, interesse_mtia, interesse_formacao,
    data_interesse::text, last_conversion_date::text, indicacao,
    dnia_id::text, status, lead_score, deleted_at::text
"""

TAMANHO_PAGINA_MAX = 1000


class PaginaContatos(BaseModel):
    itens: list[dict]
    tem_mais: bool


@router.get("", response_model=PaginaContatos)
async def listar(
    pagina: int = Query(0, ge=0),
    tamanho: int = Query(1000, ge=1, le=TAMANHO_PAGINA_MAX),
    incluir_apagados: bool = Query(False),
    _: Usuario = Depends(usuario_atual),
):
    """Uma página da tabela de leads.

    ⚠️ `id DESC` como desempate não é enfeite. `updated_at` fica igual em toda a
    base depois de um recálculo de scores (lote 1A), e `ORDER BY` com valores
    empatados não garante ordem estável entre páginas — a paginação passaria a
    pular e repetir contatos, e ninguém notaria olhando uma tela só.
    """
    filtro = "" if incluir_apagados else "WHERE deleted_at IS NULL"
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            f"""SELECT {COLUNAS_LEAD} FROM leads {filtro}
                 ORDER BY updated_at DESC, id DESC
                 LIMIT $1 OFFSET $2""",
            tamanho + 1, pagina * tamanho,
        )
    tem_mais = len(linhas) > tamanho
    return PaginaContatos(itens=[dict(l) for l in linhas[:tamanho]], tem_mais=tem_mais)
```

- [ ] **Passo 3: registrar e conferir**

```python
from app.routers.leitura_contatos import router as leitura_contatos_router

app.include_router(leitura_contatos_router)
```

⚠️ **Ordem importa no FastAPI.** `leitura_contatos` e `contatos` (do lote 1A)
compartilham o prefixo `/contatos`. A rota `GET /contatos/{lead_id}` que a
tarefa 4 cria pode capturar `/contatos/recalcular-scores` se for registrada
antes. Confira em `/docs` que as rotas do 1A continuam respondendo depois de
incluir este router, e se houver conflito registre as rotas literais antes das
paramétricas.

```bash
curl -s "localhost:8100/contatos?tamanho=2" -H "Authorization: Bearer $T" \
  | ./.venv/bin/python -m json.tool | head -20
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:8100/contatos/recalcular-scores -H "Authorization: Bearer $T"
```

Esperado: os contatos do lote 1A, e o `recalcular-scores` ainda respondendo 200.

- [ ] **Passo 4: `frontend/src/lib/leitura.ts` e `useLeads`**

```ts
import { api } from '@/lib/api';

export interface PaginaContatos<T> { itens: T[]; tem_mais: boolean }

export const listarContatos = <T>(pagina: number, tamanho: number, incluirApagados: boolean) =>
  api.get<PaginaContatos<T>>(
    `/contatos?pagina=${pagina}&tamanho=${tamanho}&incluir_apagados=${incluirApagados}`,
  );
```

Em `useLeads.tsx`, troque o laço de `supabase.from('leads').range()` por
`listarContatos`. O laço continua igual — página, acumula, para quando
`tem_mais` for falso ou o teto de 10.000 chegar. **Preserve o teto e o
`visiblePolling`**: os dois são comportamento existente, não sobra.

- [ ] **Passo 5: commit**

---

## Tarefa 2: O enriquecimento

**Interfaces:**
- Produz: `POST /contatos/enriquecimento` recebendo `{dnia_ids: [...]}` →
  `{[dnia_id]: {nexus_contact_id, mentoria_client_id, tem_eventos_nexus,
  tem_eventos_mentoria, tem_agendamento_aberto}}`

`useContactsEnriched` hoje faz duas varreduras em lotes de 200 e monta o mapa no
navegador, inclusive a regra de "agendamento em aberto". A regra vai para SQL:
uma volta de rede em vez de N, e a tela fica burra, que é melhor.

- [ ] **Passo 1: o endpoint**

Acrescente em `backend/app/routers/leitura_contatos.py`:

```python
class EnriquecimentoIn(BaseModel):
    # POST e não GET: a lista passa de 200 ids e não cabe em query string.
    dnia_ids: list[str] = Field(min_length=1, max_length=10000)


@router.post("/enriquecimento")
async def enriquecimento(dados: EnriquecimentoIn, _: Usuario = Depends(usuario_atual)):
    """Marca, por identidade, presença nos outros sistemas e agendamento aberto.

    A regra do agendamento vem de useContactsEnriched e tem três partes:

      1. Eventos legados de agendamento (`scheduling_widget_booked`,
         `meeting_scheduled`) contam como aberto sempre — não têm ciclo de vida.
      2. Uma atividade do Nexus abre com `activity_created` de tipo meeting ou
         demo, e fecha com completed / cancelled / no_show / deleted, casadas
         pelo `activity_id` do metadata.
      3. A identidade tem agendamento aberto se qualquer atividade dela abriu e
         não fechou.

    Atividade que só tem evento de fechamento, ou que abriu com tipo diferente
    de meeting/demo, não conta — igual ao original.
    """
    ids = dados.dnia_ids
    async with sessao(role="service_role") as conn:
        identidades = await conn.fetch(
            """SELECT dnia_id::text, nexus_contact_id::text, mentoria_client_id::text
                 FROM ecosystem_identities WHERE dnia_id = ANY($1::uuid[])""",
            ids)

        sinais = await conn.fetch(
            """
            WITH eventos AS (
                SELECT dnia_id, source_app, event_type, metadata
                  FROM contact_events
                 WHERE dnia_id = ANY($1::uuid[])
            ),
            atividades AS (
                SELECT dnia_id,
                       metadata->>'activity_id' AS atividade,
                       bool_or(event_type = 'activity_created'
                               AND lower(coalesce(metadata->>'type','')) IN ('meeting','demo')) AS abriu,
                       bool_or(event_type IN ('activity_completed','activity_cancelled',
                                              'activity_no_show','activity_deleted')) AS fechou
                  FROM eventos
                 WHERE metadata->>'activity_id' IS NOT NULL
                 GROUP BY dnia_id, metadata->>'activity_id'
            )
            SELECT e.dnia_id::text,
                   bool_or(e.source_app = 'nexus')    AS tem_eventos_nexus,
                   bool_or(e.source_app = 'mentoria') AS tem_eventos_mentoria,
                   bool_or(e.event_type IN ('scheduling_widget_booked','meeting_scheduled'))
                     OR coalesce(bool_or(a.abriu AND NOT a.fechou), false) AS tem_agendamento_aberto
              FROM eventos e
              LEFT JOIN atividades a ON a.dnia_id = e.dnia_id
             GROUP BY e.dnia_id
            """,
            ids)

    por_id = {s["dnia_id"]: dict(s) for s in sinais}
    return {
        i["dnia_id"]: {
            "nexus_contact_id": i["nexus_contact_id"],
            "mentoria_client_id": i["mentoria_client_id"],
            "tem_eventos_nexus": por_id.get(i["dnia_id"], {}).get("tem_eventos_nexus", False),
            "tem_eventos_mentoria": por_id.get(i["dnia_id"], {}).get("tem_eventos_mentoria", False),
            "tem_agendamento_aberto": por_id.get(i["dnia_id"], {}).get("tem_agendamento_aberto", False),
        }
        for i in identidades
    }
```

- [ ] **Passo 2: conferir a regra contra o original**

Antes de trocar a tela, compare o resultado do endpoint com o do código atual
para os contatos que existem. Se divergir, **o original é a referência** — ele
está em produção na dn.ia há meses.

- [ ] **Passo 3: trocar em `useContactsEnriched.tsx`**

O hook mantém a forma do mapa que a tabela consome; o que sai é a montagem. As
chaves mudam de `hasNexusEvents` para `tem_eventos_nexus` — traduza no ponto da
chamada, não espalhe.

- [ ] **Passo 4: conferir no navegador** que os ícones de ecossistema aparecem
  para quem tem identidade, e commitar.

---

## Tarefa 3: Conversões e preferências de coluna

**Interfaces:**
- Produz: `GET /contatos/conversoes-utm` → `{[lead_id]: [utm_content, ...]}`;
  `GET /preferencias/{chave}` e `PUT /preferencias/{chave}`

- [ ] **Passo 1: o mapa de utm_content**

`useLeadConversionUtmContents` pagina `lead_conversions` de 1000 em 1000 e
agrupa por `lead_id`. Isso é agregação — faça no banco:

```sql
SELECT lead_id::text, array_agg(DISTINCT utm_content) AS utm_contents
  FROM lead_conversions
 WHERE utm_content IS NOT NULL AND lead_id IS NOT NULL
 GROUP BY lead_id
```

Uma consulta em vez de N páginas. O cache de 5 minutos que o hook mantém pode
ficar como está.

- [ ] **Passo 2: preferências de coluna**

`dashboard_settings` é `(setting_key, setting_value)` — **global, sem dono**. O
`ColumnSelector` chama `supabase.auth.getUser()` para compor uma chave por
usuário. Preserve isso: o endpoint recebe a chave lógica e prefixa com o id de
`usuario_atual` no servidor.

```python
@router.get("/preferencias/{chave}")
async def ler_preferencia(chave: str, usuario: Usuario = Depends(usuario_atual)):
    # A chave é composta no SERVIDOR, com o id de quem está autenticado. Se o
    # cliente mandasse a chave inteira, um usuário leria a preferência de outro
    # só trocando o texto.
    chave_completa = f"{usuario.id}:{chave}"
    ...
```

⚠️ Esse detalhe é o motivo de o endpoint não ser um CRUD genérico de
`dashboard_settings`. Não o transforme num.

- [ ] **Passo 3: trocar nos dois hooks e conferir**

Abra a tabela de Contatos, mexa nas colunas visíveis, recarregue a página e
confirme que a escolha voltou.

- [ ] **Passo 4: commit**

---

## Tarefa 4: A ficha do contato

**Interfaces:**
- Produz: `GET /contatos/{lead_id}` → `{lead, tags, notas}`;
  `POST /contatos/{lead_id}/notas` · `DELETE /notas/{nota_id}`;
  `DELETE /contatos/{lead_id}/tags/{tag_id}` · `POST /tags`

A ficha leva as escritas que são dela. Separá-las para o 1C deixaria a ficha meio
quebrada por um lote inteiro.

- [ ] **Passo 1: os endpoints**

```python
class NotaIn(BaseModel):
    conteudo: str = Field(min_length=1, max_length=5000)


class TagIn(BaseModel):
    nome: str = Field(min_length=1, max_length=100)
    cor: str | None = Field(default=None, pattern="^#[0-9a-fA-F]{6}$")


@router.get("/{lead_id}")
async def ficha(lead_id: str, _: Usuario = Depends(usuario_atual)):
    """Lead, tags e notas numa volta só.

    A tela recarregava o lead depois de cada mudança de tag para pegar
    `etiqueta` e `lead_score` recalculados. Isso continua valendo — mas agora
    quem recalcula é só o trigger do banco (ver "O scoring tem duas
    implementações", acima).
    """
    async with sessao(role="service_role") as conn:
        lead = await conn.fetchrow(
            f"SELECT {COLUNAS_LEAD} FROM leads WHERE id = $1::uuid", lead_id)
        if lead is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Contato não encontrado.")
        tags = await conn.fetch(
            """SELECT t.id::text, t.name AS nome, t.color AS cor
                 FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id
                WHERE lt.lead_id = $1::uuid ORDER BY t.name""", lead_id)
        notas = await conn.fetch(
            """SELECT id::text, content AS conteudo, created_at::text
                 FROM lead_notes WHERE lead_id = $1::uuid
                ORDER BY created_at DESC""", lead_id)
    return {"lead": dict(lead), "tags": [dict(x) for x in tags],
            "notas": [dict(n) for n in notas]}


@router.post("/{lead_id}/notas", status_code=status.HTTP_201_CREATED)
async def criar_nota(lead_id: str, dados: NotaIn, _: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            """INSERT INTO lead_notes (lead_id, content) VALUES ($1::uuid, $2)
               RETURNING id::text, content AS conteudo, created_at::text""",
            lead_id, dados.conteudo.strip())
    return dict(linha)


@router.delete("/{lead_id}/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remover_tag(lead_id: str, tag_id: str, _: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        await conn.execute(
            "DELETE FROM lead_tags WHERE lead_id = $1::uuid AND tag_id = $2::uuid",
            lead_id, tag_id)
```

E em `backend/app/routers/configuracao.py`, a criação de tag com cor. **O
`TagIn` acima é de `leitura_contatos.py`; defina-o também aqui** — um modelo de
entrada de duas linhas não vale um módulo compartilhado, e importar router de
router cria um acoplamento que ninguém quer depurar depois:

```python
class TagIn(BaseModel):
    nome: str = Field(min_length=1, max_length=100)
    cor: str | None = Field(default=None, pattern="^#[0-9a-fA-F]{6}$")


@router.post("/tags", response_model=TagOut, status_code=status.HTTP_201_CREATED)
async def criar_tag(dados: TagIn, _: Usuario = Depends(usuario_atual)):
    """⚠️ Upsert, não INSERT — pelo mesmo motivo do lote 1A: `tags_name_key` é
    único, e duas pessoas criando a mesma tag ao mesmo tempo derrubariam uma
    delas com 500. DO UPDATE e não DO NOTHING, para o RETURNING devolver a linha
    também no conflito."""
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            """INSERT INTO tags (name, color) VALUES ($1, $2)
               ON CONFLICT (name) DO UPDATE SET color = COALESCE(EXCLUDED.color, tags.color)
               RETURNING id::text, name AS nome, color AS cor""",
            dados.nome.strip(), dados.cor)
    return dict(linha)
```

A rota `DELETE /notas/{nota_id}` vai num router sem o prefixo `/contatos` — a
nota é identificada sozinha e não precisa do contato no caminho.

- [ ] **Passo 2: arrancar o scoring do cliente**

Em `src/lib/leadScoring.ts`, remova `calculateLeadScore`, `scoreToEtiqueta`,
`fetchScoringConfig` e `scoreAndUpdateLead`. Mantenha o que for constante de
exibição. Depois:

```bash
grep -rn "scoreAndUpdateLead\|calculateLeadScore\|fetchScoringConfig" frontend/src
```

Cada uso encontrado sai junto. Em `DetailSections.tsx`, `triggerRescore` some
inteiro: tag não é critério de scoring, então ele nunca mudou nada.

⚠️ Se algum uso estiver numa tela de outro lote (`recalculate-all-scores` já
saiu no 1A, mas pode haver outro), **não deixe a chamada morta**. Ou remove, ou
o arquivo não fecha o portão.

- [ ] **Passo 3: trocar os 9 pontos de `DetailSections.tsx`.**

- [ ] **Passo 4: conferir no navegador** — abra a ficha, adicione nota, crie tag
  com cor, remova tag. Confirme que score e etiqueta na ficha vêm do banco.

- [ ] **Passo 5: commit**

---

## Tarefa 5: Timeline e duplicatas

**Interfaces:**
- Produz: `GET /contatos/{lead_id}/eventos?limite=` e `GET /contatos/duplicatas`

- [ ] **Passo 1: a timeline**

```python
@router.get("/{lead_id}/eventos")
async def eventos(lead_id: str, limite: int = Query(50, ge=1, le=500),
                  _: Usuario = Depends(usuario_atual)):
    """Histórico do contato, incluindo o que veio de outros sistemas.

    ⚠️ Filtra por `lead_id` OU pelo `dnia_id` do contato, não só por `lead_id`.
    Evento vindo de outro sistema do ecossistema chega com `dnia_id` e sem
    `lead_id` — filtrar só pelo segundo esconderia justamente o histórico
    cross-app, que é a razão de a ficha existir.

    E a FK `contact_events.lead_id` é ON DELETE SET NULL (verificado no lote
    1A): evento de contato apagado sobrevive com `lead_id` nulo, correlacionado
    só pelo `dnia_id`.
    """
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            """SELECT ce.id::text, ce.source_app, ce.event_type, ce.title,
                      ce.description, ce.metadata, ce.occurred_at::text
                 FROM contact_events ce
                WHERE ce.lead_id = $1::uuid
                   OR ce.dnia_id = (SELECT dnia_id FROM leads WHERE id = $1::uuid)
                ORDER BY ce.occurred_at DESC
                LIMIT $2""",
            lead_id, limite)
    return [dict(l) for l in linhas]
```

- [ ] **Passo 2: as duplicatas**

```python
@router.get("/duplicatas")
async def duplicatas(_: Usuario = Depends(usuario_atual)):
    """Identidades que compartilham e-mail ou telefone.

    ⚠️ Esta rota tem de ser registrada ANTES de `GET /contatos/{lead_id}`, ou o
    FastAPI casa "duplicatas" como se fosse um id e a rota nunca é alcançada.
    Rota literal antes de rota paramétrica, sempre.

    Só mostra. A fusão é do lote 1D — `merge_identities` mexe em várias tabelas
    e merece o seu próprio lote.
    """
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            """
            WITH repetidos AS (
                SELECT lower(email) AS chave, 'email' AS tipo
                  FROM ecosystem_identities
                 WHERE email IS NOT NULL AND email <> ''
                 GROUP BY lower(email) HAVING count(*) > 1
                UNION ALL
                SELECT phone AS chave, 'telefone' AS tipo
                  FROM ecosystem_identities
                 WHERE phone IS NOT NULL AND phone <> ''
                 GROUP BY phone HAVING count(*) > 1
            )
            SELECT r.tipo, r.chave,
                   json_agg(json_build_object(
                     'dnia_id', ei.dnia_id::text, 'nome', ei.nome,
                     'email', ei.email, 'phone', ei.phone, 'stage', ei.stage,
                     'lead_id', ei.dndash_lead_id::text,
                     'created_at', ei.created_at::text
                   ) ORDER BY ei.created_at) AS identidades
              FROM repetidos r
              JOIN ecosystem_identities ei
                ON (r.tipo = 'email'    AND lower(ei.email) = r.chave)
                OR (r.tipo = 'telefone' AND ei.phone = r.chave)
             GROUP BY r.tipo, r.chave
             ORDER BY r.tipo, r.chave
            """)
    return [dict(l) for l in linhas]
```

- [ ] **Passo 3: trocar em `EventsTimeline.tsx` e `DuplicatesPanel.tsx`**

- [ ] **Passo 4: conferir no navegador**

A base do lote 1A não tem duplicata de identidade — os três contatos têm
e-mails distintos. Para exercitar o painel, crie uma identidade repetida à mão:

```bash
psql "$U" -c "INSERT INTO ecosystem_identities (email, nome, stage)
              SELECT email, 'Duplicata de teste', 'lead' FROM leads LIMIT 1;"
```

Confira que o painel mostra o par, e **apague depois**:

```bash
psql "$U" -c "DELETE FROM ecosystem_identities WHERE nome = 'Duplicata de teste';"
```

- [ ] **Passo 5: commit**

---

## Tarefa 6: Fechar o lote

- [ ] **Passo 1: o portão, as três partes**

```bash
# 1. as telas do lote
grep -rn "supabase" frontend/src/hooks/useLeads.tsx \
  frontend/src/hooks/useContactsEnriched.tsx \
  frontend/src/hooks/useLeadConversionUtmContents.tsx \
  frontend/src/components/admin/ColumnSelector.tsx \
  frontend/src/components/admin/contacts/DetailSections.tsx \
  frontend/src/components/admin/contacts/EventsTimeline.tsx \
  frontend/src/components/admin/contacts/DuplicatesPanel.tsx

# 2. ninguém mais chama as functions deste lote — não há function saindo aqui,
#    porque contacts-list e contact-details ficam para o 1E

# 3. as telas conferidas no navegador (tarefas 4 e 5)
```

- [ ] **Passo 2: o placar**

```bash
python3 -c "
import pathlib, re
p = re.compile(r'supabase\s*\.\s*(from|rpc)\s*\(')
n = sum(len(p.findall(f.read_text())) for f in pathlib.Path('frontend/src').rglob('*.ts*')
        if 'integrations/supabase' not in str(f))
print(n, 'pontos de acesso direto')"
```

Esperado: cair de 153 para perto de 135.

- [ ] **Passo 3: atualizar `ROADMAP.md` e `CONTINUAR-AQUI.md`**, registrando a
  decomposição ajustada (1E ganhou existência) e o teto de 10.000 leads em
  memória como limitação conhecida.

- [ ] **Passo 4: commit**

---

## Definição de pronto do lote 1B

- [ ] A tela de Contatos lista os contatos importados no lote 1A
- [ ] A paginação não pula nem repete contato depois de um recálculo de scores
- [ ] Os ícones de ecossistema aparecem para quem tem identidade
- [ ] A escolha de colunas visíveis sobrevive a recarregar a página
- [ ] A ficha abre com timeline, notas e tags
- [ ] Criar nota, aplicar tag e remover tag funcionam pela ficha
- [ ] A etiqueta e o score na ficha refletem o recálculo do trigger
- [ ] O painel de duplicatas mostra identidades repetidas
- [ ] `grep` limpo nos sete arquivos do lote
- [ ] `pytest` continua passando (15 testes; este lote não acrescenta)

## O que este lote deixa aberto

1. **O teto de 10.000 leads em memória.** Portado fiel de propósito. Quando a
   base da HS se aproximar disso, a decisão de mover filtro para o servidor
   deixa de ser opcional — e vai cascatear em toda tela que usa `useAdminData`.
2. **A régua de ICP da HS** continua sendo a pergunta do lote 1A. Com a lista de
   contatos na tela, fica mais fácil respondê-la.
