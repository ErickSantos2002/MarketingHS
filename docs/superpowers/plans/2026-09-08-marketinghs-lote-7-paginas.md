# Lote 7 — Páginas e conversões

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para executar tarefa a tarefa.
> Os passos usam caixa de seleção (`- [ ]`) para acompanhamento.

**Objetivo:** tirar o cadastro de páginas e o caminho de conversão do toco do
Supabase, escrevendo no backend as rotas que faltam — e fechar as cinco últimas
functions que a tela de Páginas segurava.

**Arquitetura:** `pages` é admin-only por RLS e `page_stats` é view com
`security_invoker`, então as rotas de admin nascem com `admin_atual` +
`sessao(role="authenticated", user_id=...)` — errar qualquer um dos dois devolve
lista vazia sem erro. O caminho de conversão vira três rotas públicas
autenticadas por chave de API, preservando as quatro estratégias de resolução
de lead que a function tinha. A aplicação da tag, que era uma chamada HTTP
fire-and-forget para outra function, passa a acontecer na mesma transação da
conversão. O cliente de navegador (`leadConversion.ts`) é apagado: ninguém o
importa, e as landings para as quais ele foi escrito saíram do repositório no
lote 0.

**Stack:** FastAPI + asyncpg · React 18 + TanStack Query · pytest

**Spec:** `docs/superpowers/specs/2026-08-31-marketinghs-design.md` — linha 238
(lote 7) e §10 (endpoints públicos sem autenticação, por desenho).

---

## ⚠️ O que este lote NÃO é

A spec chama o lote 7 de **Captação pública** e lista "landing modelo da HS,
conversões, OG estático, teste A/B". **Decidido com o Erick em 08/09/2026: este
lote é só o porte** — cadastro de páginas e conversões. A landing modelo, o OG
estático e o teste A/B ficam para um lote próprio, porque envolvem desenho de
produto (a spec, na linha 439, diz explicitamente que não decide a landing),
conta Cloudflare da HS e o formulário de captura real.

**Consequência que precisa estar escrita:** quando este lote fechar, a tabela
`pages` continuará **vazia** e `lead_conversions` também. "Lote 7 concluído"
não quer dizer que a captação está de pé — quer dizer que ela não fala mais com
o Supabase.

---

## Restrições globais

Valem para **toda** tarefa deste plano.

- **`sessao()` é o único caminho para dado.** O backend conecta como
  `marketinghs_app`, `NOINHERIT`, sem privilégio em `public` por si. Nunca
  conecte como superusuário: **superusuário ignora RLS por definição**.
- ⚠️ **O padrão de `sessao()` é `anon`, e política `TO authenticated` não se
  aplica ao anônimo** — a query devolve zero linhas, sem erro. Rota de usuário
  escreve sempre `sessao(role="authenticated", user_id=usuario.id)`.
- **`role="service_role"` tem `BYPASSRLS`.** Só para operação interna e para
  chamador máquina autenticado por chave de API — que não tem `user_id` para
  pôr em `auth.uid()`, e por isso é a própria rota que autoriza, pelo escopo.
  É o que as rotas de `/publico` já fazem.
- **Nenhum endpoint depende do RLS para autorizar.** Cada rota autoriza sozinha.
- **O papel é `'admin'`**, não `'administrador'`; o enum é `public.app_role`.
- **Toda chave lida do ambiente precisa estar declarada em `Settings`**
  (`backend/app/config.py`). Este lote não introduz variável nova.
- **`.env` nunca é versionado.** **Não escreva `CREATE EXTENSION`.**
- **Os três índices únicos parciais são intocáveis.**
- **Este lote não tem migration.** Toda tabela, view, gatilho e constraint de
  que ele precisa já existe — conferido no banco em 08/09/2026.
- **Backend na porta 8100** (a 8000 é do TaskHS). Frontend em `127.0.0.1:8080`.
- **Testes:** `cd backend && ./.venv/bin/pytest -q`. A fixture `conexao`
  (`backend/tests/conftest.py`) abre transação com `SET LOCAL ROLE service_role`
  e **sempre reverte**. ⚠️ Não mate o pytest no meio. `pytest.ini` tem
  `asyncio_mode = auto`, então teste `async def` não precisa de marcador — o
  `pytestmark` do arquivo novo é explícito de propósito, não obrigatório.
  ⚠️ A suíte leva ~3 minutos (medido: 182s com 127 testes). Se for usar
  `timeout`, dê pelo menos 600s.
- **Tipagem do frontend:** `cd frontend && npx tsc --noEmit` limpo antes de
  cada commit que toque `.ts`/`.tsx`.

---

## O que foi medido no banco em 08/09/2026

Os números e formas abaixo saíram de consulta ao banco, não de leitura de
código. Quem executar não precisa reconferir, mas precisa saber que são fatos:

| | |
|---|---|
| `pages` | **0 linhas**. RLS ligada; as quatro políticas são `has_role(auth.uid(), 'admin')` |
| `lead_conversions` | **0 linhas**. RLS ligada |
| `page_stats` | view com **`security_invoker=true`** — a RLS de `pages` vale para quem chama |
| `pages` | gatilhos `trg_sanitize_page_slug` (BEFORE INSERT/UPDATE OF slug) e `update_pages_updated_at` |
| `pages` | `UNIQUE (slug)`; `CHECK page_type IN (landing, thankyou, form, admin)`; `CHECK status IN (active, draft, inactive)` |
| `lead_conversions` | gatilho `trg_update_last_conversion_date`, **AFTER INSERT**, corpo usa `greatest()` — nunca baixa a data |
| `lead_conversions` | tem `ab_test`, `ab_var`, `ab_vid` (text, nulos) |
| `tags` | `UNIQUE (name)` · `lead_tags` | `PRIMARY KEY (lead_id, tag_id)` |
| `leads` | `dnia_id uuid` · `phone_normalized text` · `whatsapp text` · `email text` |

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| **Criar** `backend/app/routers/paginas.py` | as sete rotas de admin do cadastro de páginas |
| **Criar** `backend/tests/test_conversao.py` | resolução de lead, tag e recálculo da data |
| Modificar `backend/app/main.py` | registrar o router novo |
| Modificar `backend/app/routers/publico.py` | `/publico/conversao` (3 métodos) e `/publico/paginas` |
| Modificar `frontend/src/hooks/usePages.tsx` | falar com `@/lib/api` |
| Modificar `frontend/src/components/admin/pages/PagesManagement.tsx` | `toggleStatus` passa a receber só o id |
| Modificar `frontend/src/components/admin/pages/PageConfigEditor.tsx` | idem |
| **Apagar** `frontend/src/lib/leadConversion.ts` | cliente de navegador sem chamador |
| Modificar `frontend/src/components/admin/settings/ApiDocumentation.tsx` | rotas novas |
| Modificar `frontend/public/api/dnmarketing-api.yaml` | rotas novas **+ 5 URLs mortas herdadas** |
| **Apagar** `backend/supabase/functions/{pages-api,register-conversion,unregister-conversion,update-conversion,apply-lead-tag}` | no portão, por último |

---

### Task 1: As rotas de admin do cadastro de páginas

**Files:**
- Create: `backend/app/routers/paginas.py`
- Modify: `backend/app/main.py` (imports por volta da linha 15-29; `include_router` por volta da 85-100)

**Interfaces:**
- Produces: `GET /paginas` (array de página) · `GET /paginas/estatisticas` (array
  da view) · `POST /paginas` (201, devolve a linha) · `PATCH /paginas/{id}` ·
  `PATCH /paginas/por-slug/{slug}/config` · `DELETE /paginas/{id}` (204) ·
  `PATCH /paginas/{id}/status` (devolve `{"status": "<novo>"}`)
- Consumes: `app.database.sessao`, `app.dependencies.admin_atual`

- [ ] **Passo 1: escrever `backend/app/routers/paginas.py`**

```python
"""Cadastro de páginas do admin.

⚠️ `pages` é admin-only por RLS — as quatro políticas são
`has_role(auth.uid(), 'admin')`, medido no banco em 08/09/2026. E `page_stats`
é view com `security_invoker=true`: a RLS de `pages` vale para QUEM CHAMA a
view, não para o dono dela.

Isso obriga as rotas a duas coisas ao mesmo tempo, e errar qualquer uma
devolve LISTA VAZIA SEM ERRO — não 403:

  1. `admin_atual`, não `usuario_atual`: um autenticado sem o papel veria zero
     páginas e concluiria que o cadastro está vazio;
  2. `sessao(role="authenticated", user_id=usuario.id)`, não o `anon` padrão:
     sob `anon` nem o admin enxerga.

Mesma decisão de `painel.py` e das nove rotas de `ia.py`.

⚠️ A tabela está VAZIA (0 linhas em 08/09/2026). Rota devolvendo `[]` aqui é
o estado correto do sistema, não sintoma de permissão errada — as landings da
dn.ia saíram no lote 0 e a landing da HS é de outro lote.
"""

from typing import Any

import asyncpg
from fastapi import APIRouter, Body, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, admin_atual

router = APIRouter(prefix="/paginas", tags=["paginas"])

# As duas listas fechadas do CHECK de `pages`, repetidas aqui para o 422 do
# FastAPI chegar antes da exceção do Postgres — mensagem melhor, mesma recusa.
TIPOS = "^(landing|thankyou|form|admin)$"
ESTADOS = "^(active|draft|inactive)$"

# A forma que o frontend tipa como `Page`. Fixa numa constante porque cinco
# rotas devolvem exatamente esta lista, e uma coluna a menos numa delas vira
# campo `undefined` na tela sem erro nenhum.
COLUNAS = """id::text, name, slug, component_name, page_type, status,
             description, webhook_url, whatsapp_group_url, meta_title,
             meta_description, config, template_base,
             created_at::text, updated_at::text"""


class PaginaIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    slug: str = Field(min_length=1, max_length=200)
    component_name: str = Field(min_length=1, max_length=200)
    page_type: str = Field(pattern=TIPOS)
    status: str = Field(default="draft", pattern=ESTADOS)
    description: str | None = None
    webhook_url: str | None = None
    whatsapp_group_url: str | None = None
    meta_title: str | None = None
    meta_description: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)
    template_base: str | None = None


class PaginaPatch(BaseModel):
    """Todo campo opcional: o PATCH atualiza só o que veio.

    ⚠️ É esta classe que faz o `SET` do UPDATE ser seguro. Os nomes de coluna
    saem de `model_dump(exclude_unset=True)`, ou seja, das chaves DECLARADAS
    aqui — chave desconhecida no corpo o pydantic descarta antes. Nome de
    coluna nunca vem do corpo do request.
    """
    name: str | None = Field(default=None, min_length=1, max_length=200)
    slug: str | None = Field(default=None, min_length=1, max_length=200)
    component_name: str | None = Field(default=None, min_length=1, max_length=200)
    page_type: str | None = Field(default=None, pattern=TIPOS)
    status: str | None = Field(default=None, pattern=ESTADOS)
    description: str | None = None
    webhook_url: str | None = None
    whatsapp_group_url: str | None = None
    meta_title: str | None = None
    meta_description: str | None = None
    config: dict[str, Any] | None = None
    template_base: str | None = None


@router.get("")
async def listar(usuario: Usuario = Depends(admin_atual)):
    """As linhas cheias, na ordem que a tela espera (`created_at ASC`)."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            f"SELECT {COLUNAS} FROM pages ORDER BY created_at ASC")
    return [dict(l) for l in linhas]


@router.get("/estatisticas")
async def estatisticas(usuario: Usuario = Depends(admin_atual)):
    """A view `page_stats`, que é o que a TABELA da tela mostra.

    ⚠️ Esta rota precisa ser declarada ANTES de qualquer `GET /{algo}` neste
    router, senão `estatisticas` é lido como id. Hoje não há GET por id, mas
    quem adicionar um precisa pôr abaixo desta.

    ⚠️ `page_stats` conta lead por `lead_conversions.page_slug`. A rota
    pública `/publico/paginas` conta por `leads.source = slug` — duas
    definições de "lead da página" no mesmo sistema. As duas são portadas como
    estão, de propósito: mudar qualquer uma alteraria número que alguém pode
    estar lendo. Está registrado como pergunta ao Erick no CONTINUAR-AQUI.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            """SELECT id::text, slug, name, status, config, template_base,
                      page_type, created_at::text, updated_at::text,
                      total_leads, hot_leads, last_lead_at::text
                 FROM page_stats
                ORDER BY created_at ASC""")
    return [dict(l) for l in linhas]


@router.post("", status_code=status.HTTP_201_CREATED)
async def criar(dados: PaginaIn, usuario: Usuario = Depends(admin_atual)):
    """⚠️ O gatilho `trg_sanitize_page_slug` pode reescrever o slug. Por isso o
    `RETURNING`: quem chama deve usar o slug DEVOLVIDO, não o que mandou."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        try:
            linha = await conn.fetchrow(
                f"""INSERT INTO pages (name, slug, component_name, page_type,
                                       status, description, webhook_url,
                                       whatsapp_group_url, meta_title,
                                       meta_description, config, template_base)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                 RETURNING {COLUNAS}""",
                dados.name, dados.slug, dados.component_name, dados.page_type,
                dados.status, dados.description, dados.webhook_url,
                dados.whatsapp_group_url, dados.meta_title,
                dados.meta_description, dados.config, dados.template_base)
        except asyncpg.UniqueViolationError:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Já existe uma página com o slug '{dados.slug}'.")
    return dict(linha)


@router.patch("/{pagina_id}")
async def atualizar(pagina_id: str, dados: PaginaPatch,
                    usuario: Usuario = Depends(admin_atual)):
    campos = dados.model_dump(exclude_unset=True)
    if not campos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nada para atualizar.")
    atribuicoes = ", ".join(
        f"{nome} = ${i}" for i, nome in enumerate(campos, start=2))
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        try:
            linha = await conn.fetchrow(
                f"""UPDATE pages SET {atribuicoes}
                     WHERE id = $1::uuid
                 RETURNING {COLUNAS}""",
                pagina_id, *campos.values())
        except asyncpg.UniqueViolationError:
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "Já existe uma página com esse slug.")
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Página não encontrada.")
    return dict(linha)


@router.patch("/por-slug/{slug}/config")
async def atualizar_config(slug: str,
                           config: dict[str, Any] = Body(...),
                           usuario: Usuario = Depends(admin_atual)):
    """SUBSTITUI o `config` inteiro — não funde.

    ⚠️ É o comportamento do hook que esta rota substitui
    (`supabase.from('pages').update({ config }).eq('slug', slug)`), e é o que o
    `UTMPresetsModal` espera: ele monta o objeto completo e manda. A rota
    PÚBLICA `PATCH /publico/paginas/{slug}` funde, porque a function que ela
    substitui fundia. As duas semânticas são preservadas de propósito.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            f"UPDATE pages SET config = $2 WHERE slug = $1 RETURNING {COLUNAS}",
            slug, config)
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Página não encontrada.")
    return dict(linha)


@router.patch("/{pagina_id}/status")
async def alternar_status(pagina_id: str, usuario: Usuario = Depends(admin_atual)):
    """A inversão acontece no SQL, não no navegador.

    ⚠️ Mudança consciente em relação ao código herdado, registrada porque este
    projeto já perdeu capacidade em porte silencioso três vezes: o hook antigo
    lia `currentStatus` na tela, calculava o oposto e mandava o valor pronto.
    Duas abas abertas liam 'active' e as duas mandavam 'inactive' — a segunda
    desfazia nada. Aqui o banco lê e inverte na mesma instrução. A capacidade é
    a mesma; o que sai é a corrida.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        novo = await conn.fetchval(
            """UPDATE pages
                  SET status = CASE WHEN status = 'active'
                                    THEN 'inactive' ELSE 'active' END
                WHERE id = $1::uuid
            RETURNING status""",
            pagina_id)
    if novo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Página não encontrada.")
    return {"status": novo}


@router.delete("/{pagina_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir(pagina_id: str, usuario: Usuario = Depends(admin_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        resultado = await conn.execute(
            "DELETE FROM pages WHERE id = $1::uuid", pagina_id)
    if resultado == "DELETE 0":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Página não encontrada.")
```

- [ ] **Passo 2: registrar o router em `backend/app/main.py`**

Adicione o import junto dos outros (a lista está em ordem alfabética; entre
`leitura_contatos` e `painel`):

```python
from app.routers.paginas import router as paginas_router
```

E o registro junto dos outros `include_router`, antes de `publico_router`:

```python
app.include_router(paginas_router)
```

- [ ] **Passo 3: subir e conferir que a rota responde**

```bash
cd backend && ./.venv/bin/python -m uvicorn app.main:app --port 8100 --reload
```

Noutro terminal, pegue um token de admin e liste:

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:8100/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<e-mail do admin>","password":"<senha>"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

curl -s http://127.0.0.1:8100/paginas -H "Authorization: Bearer $TOKEN"
curl -s http://127.0.0.1:8100/paginas/estatisticas -H "Authorization: Bearer $TOKEN"
```

Esperado nas duas: **`[]`** — e HTTP 200, não 500. A tabela está vazia; lista
vazia aqui é o estado correto.

- [ ] **Passo 4: provar que o papel e a `sessao()` estão certos**

Este passo existe porque errar aqui não dá erro, dá lista vazia — e lista vazia
é indistinguível do estado real de hoje. Crie uma página pela rota, confirme
que ela aparece, e apague:

```bash
curl -s -X POST http://127.0.0.1:8100/paginas \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Sonda do lote 7","slug":"sonda-lote-7","component_name":"SondaLote7","page_type":"landing"}'
# → 201 com a linha, status "draft"

curl -s http://127.0.0.1:8100/paginas -H "Authorization: Bearer $TOKEN"
# → array com UMA página. Se vier [], a sessao() está em anon ou o papel está errado.

ID=<id devolvido>
curl -s -X PATCH http://127.0.0.1:8100/paginas/$ID/status -H "Authorization: Bearer $TOKEN"
# → {"status":"active"}
curl -s -X PATCH http://127.0.0.1:8100/paginas/$ID/status -H "Authorization: Bearer $TOKEN"
# → {"status":"inactive"}  (prova que a inversão é do banco, não do cliente)

curl -s -o /dev/null -w '%{http_code}\n' -X DELETE http://127.0.0.1:8100/paginas/$ID \
  -H "Authorization: Bearer $TOKEN"
# → 204
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE http://127.0.0.1:8100/paginas/$ID \
  -H "Authorization: Bearer $TOKEN"
# → 404 (e não 204 sem efeito)
```

⚠️ **Não deixe a sonda no banco.** O lote 6 deixou duas linhas de teste em
`dashboard_settings` que viraram item 13 da lista de pendências do Erick.

- [ ] **Passo 5: commit**

```bash
git add backend/app/routers/paginas.py backend/app/main.py
git commit -m "feat(7): as rotas de admin do cadastro de páginas

pages é admin-only por RLS e page_stats é view com security_invoker: as
rotas exigem admin_atual e sessao(role=authenticated). Errar qualquer um
dos dois devolve lista vazia sem erro, que é indistinguível da tabela
vazia de hoje.

A inversão de status passa a ser feita no SQL, e não calculada no
navegador — mudança consciente, some a corrida entre duas abas."
```

---

### Task 2: Os dois auxiliares da conversão, com teste

Esta tarefa entrega as funções que a rota da Task 3 vai usar, e os testes que
elas exigem. Ela vem antes da rota porque é ela que carrega a lógica que
clicar não exercita.

**Files:**
- Modify: `backend/app/routers/publico.py` (adicionar no fim do arquivo)
- Test: `backend/tests/test_conversao.py` (criar)

**Interfaces:**
- Produces:
  - `async def _resolver_lead(conn, dados: "ConversaoIn") -> str | None`
  - `async def _aplicar_tag_do_slug(conn, lead_id: str, page_slug: str) -> str | None`
  - `async def _recalcular_datas(conn, lead_ids: list[str]) -> None`
  - `class ConversaoIn(BaseModel)`
- Consumes: `sessao`, `chave_api` (já importados em `publico.py`)

- [ ] **Passo 1: escrever o teste que falha**

Crie `backend/tests/test_conversao.py`:

```python
"""A resolução do lead e o recálculo da data — o que clicar não exercita.

`POST /publico/conversao` tem quatro estratégias para achar o lead quando o
chamador não manda `lead_id`. Nenhuma aparece abrindo a tela: a tela não chama
esta rota. Quem chama é integrador externo, e o modo de falhar é achar o lead
ERRADO — que ninguém percebe, porque a conversão entra normalmente e o número
do painel sobe.

O recálculo está aqui pelo mesmo motivo. O gatilho
`trg_update_last_conversion_date` é AFTER INSERT e usa `greatest()`: ele nunca
BAIXA a data. Apagar a conversão mais recente sem recalcular deixa
`leads.last_conversion_date` mentindo para sempre, e nada avisa.
"""

import pytest

from app.routers.publico import (
    ConversaoIn, _aplicar_tag_do_slug, _recalcular_datas, _resolver_lead,
)

pytestmark = pytest.mark.asyncio


async def _lead(conexao, **campos):
    """⚠️ `tipo` é NOT NULL sem default em `leads`. Omitir derruba a fixture
    com NotNullViolationError, e o erro aparece como falha do teste errado."""
    campos.setdefault("tipo", "teste")
    nomes = ", ".join(campos)
    marcas = ", ".join(f"${i}" for i in range(1, len(campos) + 1))
    return str(await conexao.fetchval(
        f"INSERT INTO leads ({nomes}) VALUES ({marcas}) RETURNING id",
        *campos.values()))


async def test_acha_por_email_ignorando_maiuscula(conexao):
    lead = await _lead(conexao, nome="Carla", email="carla@exemplo.invalid")
    achado = await _resolver_lead(conexao, ConversaoIn(
        tipo="diagnostico", page_slug="humanoseagentes",
        email="CARLA@Exemplo.Invalid"))
    assert achado == lead


async def test_email_repetido_vence_o_mais_recente(conexao):
    await _lead(conexao, nome="Antigo", email="dup@exemplo.invalid")
    novo = await conexao.fetchval(
        "INSERT INTO leads (nome, email, tipo, created_at) "
        "VALUES ('Novo', 'dup@exemplo.invalid', 'teste', now() + interval '1 hour') "
        "RETURNING id")
    achado = await _resolver_lead(conexao, ConversaoIn(
        tipo="diagnostico", page_slug="p", email="dup@exemplo.invalid"))
    assert achado == str(novo)


async def test_dnia_id_vence_o_email(conexao):
    """A ordem das estratégias importa: dnia_id é exato, e-mail não é."""
    dnia = await conexao.fetchval("SELECT gen_random_uuid()")
    certo = await _lead(conexao, nome="Certo", email="a@exemplo.invalid",
                        dnia_id=dnia)
    await _lead(conexao, nome="Errado", email="b@exemplo.invalid")
    achado = await _resolver_lead(conexao, ConversaoIn(
        tipo="t", page_slug="p", dnia_id=str(dnia), email="b@exemplo.invalid"))
    assert achado == certo


async def test_acha_por_telefone_normalizado(conexao):
    normalizado = await conexao.fetchval(
        "SELECT normalize_phone_br($1)", "(85) 99999-1234")
    lead = await _lead(conexao, nome="Zé", phone_normalized=normalizado)
    achado = await _resolver_lead(conexao, ConversaoIn(
        tipo="t", page_slug="p", phone="85 99999 1234"))
    assert achado == lead


async def test_acha_pela_identidade_quando_o_lead_nao_casa(conexao):
    """A quarta estratégia: lead criado por /publico/identidade, sem e-mail na
    própria linha de `leads`, alcançável só pela identidade."""
    lead = await _lead(conexao, nome="Pela identidade")
    await conexao.execute(
        "INSERT INTO ecosystem_identities (email, dndash_lead_id) "
        "VALUES ($1, $2::uuid)", "so-na-identidade@exemplo.invalid", lead)
    achado = await _resolver_lead(conexao, ConversaoIn(
        tipo="t", page_slug="p", email="so-na-identidade@exemplo.invalid"))
    assert achado == lead


async def test_sem_nada_para_casar_devolve_none(conexao):
    achado = await _resolver_lead(conexao, ConversaoIn(
        tipo="t", page_slug="p", email="ninguem@exemplo.invalid"))
    assert achado is None


async def test_tag_do_slug_normaliza_e_repete_sem_duplicar(conexao):
    lead = await _lead(conexao, nome="Com tag")
    primeira = await _aplicar_tag_do_slug(conexao, lead, "/HumanosEAgentes")
    segunda = await _aplicar_tag_do_slug(conexao, lead, "humanoseagentes")
    assert primeira == "humanoseagentes"
    assert segunda == "humanoseagentes"
    quantas = await conexao.fetchval(
        "SELECT count(*) FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id "
        "WHERE lt.lead_id = $1::uuid AND t.name = 'humanoseagentes'", lead)
    assert quantas == 1


async def test_tag_recusa_slug_fora_do_charset(conexao):
    """`tags.name` sem guarda vira campo de texto livre escrito de fora."""
    lead = await _lead(conexao, nome="Sem tag")
    assert await _aplicar_tag_do_slug(conexao, lead, "Robert'); DROP TABLE") is None
    assert await _aplicar_tag_do_slug(conexao, lead, "x" * 61) is None
    assert await conexao.fetchval(
        "SELECT count(*) FROM lead_tags WHERE lead_id = $1::uuid", lead) == 0


async def test_recalculo_baixa_a_data_que_o_gatilho_nao_baixa(conexao):
    lead = await _lead(conexao, nome="Duas conversões")
    await conexao.execute(
        "INSERT INTO lead_conversions (lead_id, tipo, converted_at, page_slug) "
        "VALUES ($1::uuid, 't', now() - interval '10 days', 'p')", lead)
    await conexao.execute(
        "INSERT INTO lead_conversions (lead_id, tipo, converted_at, page_slug, session_id) "
        "VALUES ($1::uuid, 't', now(), 'p', 'sessao-de-teste')", lead)
    # o gatilho subiu a data para a mais recente
    antes = await conexao.fetchval(
        "SELECT last_conversion_date FROM leads WHERE id = $1::uuid", lead)

    await conexao.execute(
        "DELETE FROM lead_conversions WHERE session_id = 'sessao-de-teste'")
    await _recalcular_datas(conexao, [lead])

    depois = await conexao.fetchval(
        "SELECT last_conversion_date FROM leads WHERE id = $1::uuid", lead)
    assert depois < antes, "sem recálculo a data fica na conversão apagada"


async def test_recalculo_zera_quando_nao_sobra_conversao(conexao):
    lead = await _lead(conexao, nome="Zerado")
    await conexao.execute(
        "INSERT INTO lead_conversions (lead_id, tipo, converted_at, page_slug) "
        "VALUES ($1::uuid, 't', now(), 'p')", lead)
    await conexao.execute("DELETE FROM lead_conversions WHERE lead_id = $1::uuid", lead)
    await _recalcular_datas(conexao, [lead])
    assert await conexao.fetchval(
        "SELECT last_conversion_date FROM leads WHERE id = $1::uuid", lead) is None
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
cd backend && ./.venv/bin/pytest tests/test_conversao.py -q
```

Esperado: **falha no import** — `cannot import name 'ConversaoIn' from 'app.routers.publico'`.

- [ ] **Passo 3: escrever os auxiliares em `backend/app/routers/publico.py`**

No topo do arquivo, junto dos imports já existentes, acrescente `import re`.
No fim do arquivo, acrescente:

```python
# ---------------------------------------------------------------------------
# Conversões — o que era register-/update-/unregister-conversion
# ---------------------------------------------------------------------------

# Herdado de `apply-lead-tag`, e fica. O slug chega pelo corpo do request; sem
# guarda, `tags.name` vira campo de texto livre escrito de fora.
TAG_VALIDA = re.compile(r"^[a-z0-9][a-z0-9._\-/]*$")
TAG_MAX = 60


class ConversaoIn(BaseModel):
    """O corpo de `POST /publico/conversao`.

    ⚠️ `ab_test`/`ab_var`/`ab_vid` não existiam na function `register-conversion`
    — quem gravava as três colunas era `frontend/src/lib/leadConversion.ts`, que
    este lote apaga. Elas entram aqui para que apagar o cliente não leve junto
    a atribuição de teste A/B: as colunas existem em `lead_conversions` e a
    landing do próximo lote vai precisar delas. É exatamente o corte silencioso
    que o portão do lote 6 deixou passar três vezes.
    """
    lead_id: str | None = None
    dnia_id: str | None = None
    email: str | None = None
    phone: str | None = None
    tipo: str = Field(min_length=1, max_length=80)
    page_slug: str = Field(min_length=1, max_length=200)
    session_id: str | None = None
    converted_at: str | None = None
    utm_source: str | None = None
    utm_medium: str | None = None
    utm_campaign: str | None = None
    utm_term: str | None = None
    utm_content: str | None = None
    source: str | None = None
    ab_test: str | None = None
    ab_var: str | None = None
    ab_vid: str | None = None
    apply_tag: bool = True


async def _resolver_lead(conn, dados: ConversaoIn) -> str | None:
    """As quatro estratégias do `register-conversion`, na ordem da origem.

    A ordem não é arbitrária e não pode ser trocada: `dnia_id` é exato; o
    e-mail é o mais frágil (a mesma pessoa pode ter várias linhas — daí o
    `ORDER BY created_at DESC`, que faz vencer a mais recente); o telefone
    tenta o normalizado antes do cru; e a quarta é a rede de segurança para
    lead criado por `/publico/identidade` antes de qualquer normalização.

    Devolve `None` quando não acha — quem chama transforma em 404. Não invente
    lead: criar contato aqui faria a rota de conversão virar rota de captura.
    """
    if dados.lead_id:
        return dados.lead_id

    email = dados.email.strip().lower() if dados.email else None
    telefone_cru = str(dados.phone).strip() if dados.phone else None
    telefone = None
    if telefone_cru:
        telefone = await conn.fetchval(
            "SELECT normalize_phone_br($1)", telefone_cru)

    if dados.dnia_id:
        achado = await conn.fetchval(
            "SELECT id::text FROM leads WHERE dnia_id = $1::uuid LIMIT 1",
            dados.dnia_id)
        if achado:
            return achado

    if email:
        achado = await conn.fetchval(
            """SELECT id::text FROM leads WHERE lower(email) = $1
                ORDER BY created_at DESC LIMIT 1""", email)
        if achado:
            return achado

    if telefone:
        achado = await conn.fetchval(
            """SELECT id::text FROM leads WHERE phone_normalized = $1
                ORDER BY created_at DESC LIMIT 1""", telefone)
        if achado:
            return achado

    if telefone_cru:
        achado = await conn.fetchval(
            """SELECT id::text FROM leads WHERE whatsapp = $1
                ORDER BY created_at DESC LIMIT 1""", telefone_cru)
        if achado:
            return achado

    if email or telefone:
        # ⚠️ E-mail tem precedência sobre telefone, como na origem: quando os
        # dois vêm, procura só por e-mail. Trocar isso muda qual lead recebe a
        # conversão em base com telefone repetido.
        linha = await conn.fetchrow(
            """SELECT dnia_id::text AS dnia_id,
                      dndash_lead_id::text AS lead_id
                 FROM ecosystem_identities
                WHERE ($1::text IS NOT NULL AND lower(email) = $1)
                   OR ($1::text IS NULL AND $2::text IS NOT NULL AND phone = $2)
                LIMIT 1""", email, telefone)
        if linha:
            if linha["lead_id"]:
                return linha["lead_id"]
            if linha["dnia_id"]:
                return await conn.fetchval(
                    """SELECT id::text FROM leads WHERE dnia_id = $1::uuid
                        ORDER BY created_at DESC LIMIT 1""", linha["dnia_id"])
    return None


async def _aplicar_tag_do_slug(conn, lead_id: str, page_slug: str) -> str | None:
    """A tag derivada do slug, aplicada na MESMA transação da conversão.

    Era a function `apply-lead-tag`, chamada por HTTP e fire-and-forget: se
    falhasse, ninguém ficava sabendo e a conversão ficava sem tag. Aqui, ou as
    duas coisas acontecem, ou nenhuma.

    Devolve a tag aplicada, ou `None` quando o slug não passa na guarda — e
    não levanta: tag é efeito secundário da conversão, e recusar a conversão
    inteira por causa de um slug estranho seria pior que não etiquetar.
    """
    tag = page_slug.lstrip("/").strip().lower()
    if not tag or len(tag) > TAG_MAX or not TAG_VALIDA.match(tag):
        return None
    tag_id = await conn.fetchval(
        """INSERT INTO tags (name) VALUES ($1)
           ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id""", tag)
    await conn.execute(
        """INSERT INTO lead_tags (lead_id, tag_id) VALUES ($1::uuid, $2)
           ON CONFLICT (lead_id, tag_id) DO NOTHING""", lead_id, tag_id)
    return tag


async def _recalcular_datas(conn, lead_ids: list[str]) -> None:
    """Recalcula `leads.last_conversion_date` do zero para os leads dados.

    ⚠️ Isto NÃO é redundante com o gatilho. `trg_update_last_conversion_date`
    é AFTER INSERT e usa `greatest()`: ele só sobe a data. Depois de apagar ou
    de mover uma conversão para trás, é preciso recalcular, senão a data fica
    apontando para uma conversão que não existe mais — sem erro, sem aviso.

    Uma instrução para o conjunto todo, e não o laço por lead da function
    original: o `unregister-conversion` fazia duas consultas por lead afetado.
    """
    if not lead_ids:
        return
    await conn.execute(
        """UPDATE leads l
              SET last_conversion_date = (SELECT max(c.converted_at)
                                            FROM lead_conversions c
                                           WHERE c.lead_id = l.id)
            WHERE l.id = ANY($1::uuid[])""", lead_ids)
```

- [ ] **Passo 4: rodar os testes e ver passar**

```bash
cd backend && ./.venv/bin/pytest tests/test_conversao.py -q
```

Esperado: **10 passed**.

- [ ] **Passo 5: commit**

```bash
git add backend/app/routers/publico.py backend/tests/test_conversao.py
git commit -m "feat(7): resolução de lead, tag e recálculo da data de conversão

As quatro estratégias de resolução vieram do register-conversion sem
mudar de ordem — trocar a ordem muda qual lead recebe a conversão.

O recálculo não é redundante com o gatilho: ele é AFTER INSERT e usa
greatest(), então nunca baixa a data. Apagar a conversão mais recente
sem recalcular deixa leads.last_conversion_date mentindo.

A tag passa a ser aplicada na mesma transação, no lugar da chamada HTTP
fire-and-forget para apply-lead-tag, que falhava calada."
```

---

### Task 3: `POST /publico/conversao`

**Files:**
- Modify: `backend/app/routers/publico.py`

**Interfaces:**
- Consumes: `ConversaoIn`, `_resolver_lead`, `_aplicar_tag_do_slug` (Task 2)
- Produces: `POST /publico/conversao` → `201 {"success": true, "lead_id": str, "conversion": {...}, "tag": str | None}`

- [ ] **Passo 1: escrever a rota, no fim de `publico.py`**

```python
@router.post("/conversao", status_code=status.HTTP_201_CREATED)
async def registrar_conversao(dados: ConversaoIn,
                              _: ChaveApi = Depends(chave_api("write"))):
    """Registra uma conversão. Era a function `register-conversion`.

    ⚠️ `role="service_role"`: o chamador é máquina, autenticada por chave de
    API — não há `user_id` para pôr em `auth.uid()`, então a RLS de
    `lead_conversions` não tem como expressar esta autorização. Quem autoriza
    é o escopo `write` da chave, aqui na rota. É o mesmo desenho das outras
    rotas de `/publico`.

    ⚠️ `last_conversion_date` NÃO é escrito aqui. O gatilho
    `trg_update_last_conversion_date` já grava, e com `greatest()`. A function
    original escrevia por cima, sem `greatest()` — o que fazia uma conversão
    registrada com `converted_at` no passado BAIXAR a data do lead. Deixar o
    gatilho ser o dono do campo conserta isso de graça.
    """
    if not (dados.lead_id or dados.dnia_id or dados.email or dados.phone):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Informe 'lead_id', 'dnia_id', 'email' ou 'phone' para identificar o lead.")

    async with sessao(role="service_role") as conn:
        lead_id = await _resolver_lead(conn, dados)
        if lead_id is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Lead não encontrado.")

        conversao = await conn.fetchrow(
            """INSERT INTO lead_conversions
                   (lead_id, tipo, converted_at, page_slug, session_id,
                    utm_source, utm_medium, utm_campaign, utm_term, utm_content,
                    source, ab_test, ab_var, ab_vid)
               VALUES ($1::uuid, $2, COALESCE($3::timestamptz, now()), $4, $5,
                       $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING id::text, lead_id::text, tipo, converted_at::text,
                      page_slug, session_id, source,
                      utm_source, utm_medium, utm_campaign, utm_term, utm_content,
                      ab_test, ab_var, ab_vid""",
            lead_id, dados.tipo, dados.converted_at, dados.page_slug,
            dados.session_id, dados.utm_source, dados.utm_medium,
            dados.utm_campaign, dados.utm_term, dados.utm_content,
            dados.source, dados.ab_test, dados.ab_var, dados.ab_vid)

        # As mesmas colunas que a function carimbava no lead — e só quando o
        # valor veio. `COALESCE` guarda o que já estava lá.
        await conn.execute(
            """UPDATE leads SET
                   source       = COALESCE($2, source),
                   tipo         = COALESCE($3, tipo),
                   utm_source   = COALESCE($4, utm_source),
                   utm_medium   = COALESCE($5, utm_medium),
                   utm_campaign = COALESCE($6, utm_campaign),
                   utm_term     = COALESCE($7, utm_term),
                   utm_content  = COALESCE($8, utm_content)
                 WHERE id = $1::uuid""",
            lead_id, dados.source or None, dados.tipo or None,
            dados.utm_source or None, dados.utm_medium or None,
            dados.utm_campaign or None, dados.utm_term or None,
            dados.utm_content or None)

        tag = None
        if dados.apply_tag:
            tag = await _aplicar_tag_do_slug(conn, lead_id, dados.page_slug)

    return {"success": True, "lead_id": lead_id,
            "conversion": dict(conversao), "tag": tag}
```

- [ ] **Passo 2: conferir por HTTP, com chave de API de verdade**

Crie (ou reaproveite) uma chave com escopo de escrita em Configurações → API
Keys, e um contato de teste. Depois:

```bash
CHAVE=<a chave crua>
curl -s -X POST http://127.0.0.1:8100/publico/conversao \
  -H "Authorization: Bearer $CHAVE" -H 'Content-Type: application/json' \
  -d '{"email":"<e-mail de um contato existente>","tipo":"diagnostico","page_slug":"/HumanosEAgentes"}'
```

Esperado: 201, `lead_id` preenchido, `tag` igual a `humanoseagentes` (repare na
normalização: barra e maiúsculas sumiram).

E o caminho de erro, que é o que mais importa aqui:

```bash
curl -s -X POST http://127.0.0.1:8100/publico/conversao \
  -H "Authorization: Bearer $CHAVE" -H 'Content-Type: application/json' \
  -d '{"email":"ninguem@exemplo.invalid","tipo":"t","page_slug":"p"}'
# → 404 "Lead não encontrado." — e não 201 com conversão órfã

curl -s -X POST http://127.0.0.1:8100/publico/conversao \
  -H 'Content-Type: application/json' -d '{"tipo":"t","page_slug":"p"}'
# → 401 (sem chave)
```

⚠️ **Apague a conversão de teste depois** (`DELETE FROM lead_conversions WHERE
...`) — ou use a rota da Task 4 para isso, que é melhor ainda, porque exercita
o recálculo.

- [ ] **Passo 3: commit**

```bash
git add backend/app/routers/publico.py
git commit -m "feat(7): POST /publico/conversao no lugar de register-conversion

Preserva as quatro estratégias de resolução e a aplicação da tag, agora
na mesma transação. Passa a aceitar ab_test/ab_var/ab_vid, que só o
cliente de navegador gravava — apagá-lo sem isso levaria junto a
atribuição de teste A/B.

Deixa de escrever last_conversion_date: o gatilho já grava, com
greatest(). A escrita manual da function baixava a data quando a
conversão vinha com converted_at no passado."
```

---

### Task 4: `PATCH` e `DELETE /publico/conversao`

**Files:**
- Modify: `backend/app/routers/publico.py`

**Interfaces:**
- Consumes: `_recalcular_datas` (Task 2)
- Produces: `PATCH /publico/conversao` e `DELETE /publico/conversao` →
  `{"success": true, "affected": int, ...}`

- [ ] **Passo 1: escrever as duas rotas, no fim de `publico.py`**

```python
class ConversaoPatch(BaseModel):
    session_id: str = Field(min_length=1, max_length=200)
    converted_at: str = Field(min_length=1)


class ConversaoDelete(BaseModel):
    session_id: str = Field(min_length=1, max_length=200)


# ⚠️ `source_app` do evento de auditoria: 'marketinghs', não o 'dnmarketing'
# que as functions escreviam. Os dois passam no gatilho
# `validate_contact_event_source_app`. Escolhido 'marketinghs' porque é este
# sistema que escreve agora, e porque não há linha anterior para ficar
# incoerente: `lead_conversions` está vazia, logo nunca houve evento
# 'conversion_updated' nem 'conversion_unregistered'.
APP_DA_CONVERSAO = "marketinghs"


@router.patch("/conversao")
async def atualizar_conversao(dados: ConversaoPatch,
                              _: ChaveApi = Depends(chave_api("write"))):
    """Move a data de todas as conversões de uma sessão. Era `update-conversion`."""
    async with sessao(role="service_role") as conn:
        antes = await conn.fetch(
            """SELECT id::text, lead_id::text, converted_at::text
                 FROM lead_conversions WHERE session_id = $1""",
            dados.session_id)
        if not antes:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                "Nenhuma conversão para o session_id informado.")

        try:
            atualizadas = await conn.fetch(
                """UPDATE lead_conversions SET converted_at = $2::timestamptz
                    WHERE session_id = $1
                RETURNING id::text, lead_id::text, converted_at::text,
                          tipo, page_slug, session_id""",
                dados.session_id, dados.converted_at)
        except (asyncpg.DataError, ValueError):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "'converted_at' precisa ser um timestamp ISO 8601 válido.")

        leads = sorted({l["lead_id"] for l in antes if l["lead_id"]})
        await _recalcular_datas(conn, leads)

        for lead_id in leads:
            await conn.execute(
                """INSERT INTO contact_events
                       (lead_id, source_app, event_type, title, metadata)
                   VALUES ($1::uuid, $2, 'conversion_updated', $3, $4)""",
                lead_id, APP_DA_CONVERSAO,
                f"Conversão atualizada (session_id: {dados.session_id})",
                {"session_id": dados.session_id,
                 "new_converted_at": dados.converted_at,
                 "previous": [{"id": l["id"], "converted_at": l["converted_at"]}
                              for l in antes if l["lead_id"] == lead_id]})

    return {"success": True, "affected": len(antes),
            "updated": [dict(l) for l in atualizadas]}


@router.delete("/conversao")
async def remover_conversao(dados: ConversaoDelete,
                            _: ChaveApi = Depends(chave_api("write"))):
    """Apaga as conversões de uma sessão. Era `unregister-conversion`.

    ⚠️ O recálculo depois do DELETE é obrigatório e é o motivo de esta rota
    existir em vez de um DELETE cru: o gatilho da tabela só sobe a data.
    """
    async with sessao(role="service_role") as conn:
        antes = await conn.fetch(
            """SELECT id::text, lead_id::text, converted_at::text,
                      tipo, page_slug, session_id
                 FROM lead_conversions WHERE session_id = $1""",
            dados.session_id)
        if not antes:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                "Nenhuma conversão para o session_id informado.")

        await conn.execute(
            "DELETE FROM lead_conversions WHERE session_id = $1", dados.session_id)

        leads = sorted({l["lead_id"] for l in antes if l["lead_id"]})
        await _recalcular_datas(conn, leads)

        for lead_id in leads:
            removidas = [dict(l) for l in antes if l["lead_id"] == lead_id]
            await conn.execute(
                """INSERT INTO contact_events
                       (lead_id, source_app, event_type, title, metadata)
                   VALUES ($1::uuid, $2, 'conversion_unregistered', $3, $4)""",
                lead_id, APP_DA_CONVERSAO,
                f"Conversão removida (session_id: {dados.session_id})",
                {"session_id": dados.session_id,
                 "removed_count": len(removidas), "removed": removidas})

    return {"success": True, "affected": len(antes),
            "deleted": [dict(l) for l in antes]}
```

⚠️ **`DELETE` com corpo:** o `unregister-conversion` aceitava `session_id` no
corpo **ou** na query string. O FastAPI aceita corpo em DELETE, e é a forma
documentada no `curl` da tela de Documentação da API — que usa `-d`. Mantida só
a forma com corpo; se a conferência do passo 2 mostrar que algum cliente usa
query string, acrescente `session_id: str | None = Query(None)` e prefira o
corpo quando os dois vierem.

- [ ] **Passo 2: conferir por HTTP, incluindo o recálculo**

```bash
# registre duas conversões para o mesmo contato, uma antiga e uma nova
curl -s -X POST http://127.0.0.1:8100/publico/conversao \
  -H "Authorization: Bearer $CHAVE" -H 'Content-Type: application/json' \
  -d '{"email":"<contato>","tipo":"t","page_slug":"p","converted_at":"2026-01-01T10:00:00Z"}'
curl -s -X POST http://127.0.0.1:8100/publico/conversao \
  -H "Authorization: Bearer $CHAVE" -H 'Content-Type: application/json' \
  -d '{"email":"<contato>","tipo":"t","page_slug":"p","session_id":"sessao-conferencia"}'
```

Anote `leads.last_conversion_date` do contato. Depois apague a mais recente:

```bash
curl -s -X DELETE http://127.0.0.1:8100/publico/conversao \
  -H "Authorization: Bearer $CHAVE" -H 'Content-Type: application/json' \
  -d '{"session_id":"sessao-conferencia"}'
```

Esperado: `affected: 1`, e `last_conversion_date` **voltou para 2026-01-01**.
Se continuar na data de hoje, o recálculo não rodou — e esse é justamente o
defeito que o teste da Task 2 cobre. Apague também a conversão de 2026-01-01
antes de seguir.

- [ ] **Passo 3: rodar a suíte inteira**

```bash
cd backend && ./.venv/bin/pytest -q
```

Esperado: **137 passed** (127 de antes + 10 desta portagem).

- [ ] **Passo 4: commit**

```bash
git add backend/app/routers/publico.py
git commit -m "feat(7): PATCH e DELETE /publico/conversao, com recálculo da data

Substituem update-conversion e unregister-conversion. O recálculo de
last_conversion_date é o motivo de as rotas existirem: o gatilho da
tabela é AFTER INSERT com greatest() e nunca baixa a data.

Uma instrução para o conjunto de leads afetados no lugar de duas
consultas por lead."
```

---

### Task 5: `/publico/paginas` no lugar de `pages-api`

**Files:**
- Modify: `backend/app/routers/publico.py`

**Interfaces:**
- Produces: `GET /publico/paginas` · `GET /publico/paginas/{slug}` ·
  `POST /publico/paginas` · `PATCH /publico/paginas/{slug}`

- [ ] **Passo 1: escrever as rotas, no fim de `publico.py`**

```python
# ⚠️ Declarado ANTES das classes: `Field(pattern=...)` é avaliado quando a
# classe é definida, não quando a rota roda. Constante embaixo dá NameError no
# import e derruba o boot inteiro.
#
# Repetido de `paginas.py` de propósito: `publico.py` não importa router de
# admin, e a autoridade sobre os dois é o CHECK do banco.
TIPOS_DE_PAGINA = "^(landing|thankyou|form|admin)$"


class PaginaPublicaIn(BaseModel):
    """⚠️ O vocabulário desta rota é o da `pages-api`, não o da tela: aqui o
    nome da página é `title`, e o estado é o booleano `active`. Traduzir para
    `name`/`status` quebraria integrador que já usa. A rota de admin
    (`/paginas`) usa o vocabulário do banco."""
    title: str = Field(min_length=1, max_length=200)
    slug: str = Field(min_length=1, max_length=200)
    page_type: str = Field(default="landing", pattern=TIPOS_DE_PAGINA)
    template_base: str | None = None
    config: dict = Field(default_factory=dict)
    description: str | None = None


class PaginaPublicaPatch(BaseModel):
    config: dict | None = None
    active: bool | None = None
    utm_preset: dict | None = None


@router.get("/paginas")
async def listar_paginas_publico(_: ChaveApi = Depends(chave_api("read"))):
    """⚠️ Conta lead por `leads.source = slug` — que NÃO é como a view
    `page_stats` conta (ela usa `lead_conversions.page_slug`). As duas
    definições vêm da origem e são preservadas; a divergência está registrada
    no CONTINUAR-AQUI como pergunta ao Erick.

    A origem fazia três consultas POR PÁGINA (total, hotlead, último lead).
    Aqui é uma consulta só, com LATERAL — mesma resposta.
    """
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            """SELECT p.id::text, p.slug, p.name AS title,
                      (p.status = 'active') AS active,
                      COALESCE(c.total, 0) AS total_leads,
                      COALESCE(c.quentes, 0) AS hot_leads,
                      c.ultimo::text AS last_lead_at,
                      p.config
                 FROM pages p
                 LEFT JOIN LATERAL (
                     SELECT count(*) AS total,
                            count(*) FILTER (WHERE l.etiqueta = 'hotlead') AS quentes,
                            max(l.created_at) AS ultimo
                       FROM leads l
                      WHERE l.source = p.slug
                 ) c ON true
                ORDER BY p.created_at DESC""")
    return {"data": [dict(l) for l in linhas]}


@router.get("/paginas/{slug}")
async def pagina_publico(slug: str, _: ChaveApi = Depends(chave_api("read"))):
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            """SELECT p.id::text, p.name, p.slug, p.component_name, p.page_type,
                      p.status, (p.status = 'active') AS active,
                      p.description, p.webhook_url, p.whatsapp_group_url,
                      p.meta_title, p.meta_description, p.config,
                      p.template_base,
                      p.created_at::text, p.updated_at::text,
                      COALESCE(c.total, 0) AS total_leads,
                      COALESCE(c.quentes, 0) AS hot_leads
                 FROM pages p
                 LEFT JOIN LATERAL (
                     SELECT count(*) AS total,
                            count(*) FILTER (WHERE l.etiqueta = 'hotlead') AS quentes
                       FROM leads l WHERE l.source = p.slug
                 ) c ON true
                WHERE p.slug = $1""", slug)
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Página não encontrada.")
    return dict(linha)


@router.post("/paginas", status_code=status.HTTP_201_CREATED)
async def criar_pagina_publico(dados: PaginaPublicaIn,
                               _: ChaveApi = Depends(chave_api("write"))):
    """⚠️ Nasce com `status = 'inactive'`, como na origem: página criada de fora
    não entra no ar sozinha."""
    async with sessao(role="service_role") as conn:
        try:
            linha = await conn.fetchrow(
                """INSERT INTO pages (name, slug, component_name, page_type,
                                      template_base, config, status, description)
                   VALUES ($1, $2, $2, $3, $4, $5, 'inactive', $6)
                RETURNING id::text, name, slug, component_name, page_type,
                          status, config, template_base, description,
                          created_at::text, updated_at::text""",
                dados.title, dados.slug, dados.page_type,
                dados.template_base, dados.config, dados.description)
        except asyncpg.UniqueViolationError:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Já existe uma página com o slug '{dados.slug}'.")
    return {"success": True, "page": dict(linha)}


@router.patch("/paginas/{slug}")
async def atualizar_pagina_publico(slug: str, dados: PaginaPublicaPatch,
                                   _: ChaveApi = Depends(chave_api("write"))):
    """⚠️ FUNDE o config, ao contrário da rota de admin, que substitui. É o
    comportamento da `pages-api` e integrador externo depende dele.

    ⚠️ O link de UTM devolvido apontava para `https://dnia.ai/{slug}` — domínio
    da dn.ia, cravado no código da function. Aqui ele sai do host do próprio
    request, que é o único valor correto que a rota tem à mão enquanto o host
    de produção não estiver decidido (item 11 da lista do Erick).
    """
    async with sessao(role="service_role") as conn:
        atual = await conn.fetchrow(
            "SELECT id, config FROM pages WHERE slug = $1", slug)
        if atual is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Página não encontrada.")

        config = dict(atual["config"] or {})
        if dados.config:
            config.update(dados.config)
        link_utm = None
        if dados.utm_preset:
            presets = list(config.get("utm_presets") or [])
            presets.append(dados.utm_preset)
            config["utm_presets"] = presets
            partes = "&".join(
                f"{chave}={valor}"
                for chave in ("utm_source", "utm_medium", "utm_campaign",
                              "utm_term", "utm_content")
                if (valor := dados.utm_preset.get(chave)))
            link_utm = f"/{slug}?{partes}" if partes else f"/{slug}"

        mudou_config = bool(dados.config or dados.utm_preset)
        await conn.execute(
            """UPDATE pages
                  SET config = CASE WHEN $2 THEN $3::jsonb ELSE config END,
                      status = CASE WHEN $4::bool IS NULL THEN status
                                    WHEN $4 THEN 'active' ELSE 'inactive' END
                WHERE id = $1""",
            atual["id"], mudou_config, config, dados.active)

    resposta = {"success": True, "page_slug": slug}
    if link_utm:
        resposta["utm_link"] = link_utm
    return resposta
```

⚠️ **Ordem de declaração:** `GET /publico/paginas/{slug}` precisa vir DEPOIS de
`GET /publico/paginas`. Como estão, está certo — não reordene.

- [ ] **Passo 2: conferir por HTTP**

```bash
curl -s http://127.0.0.1:8100/publico/paginas -H "Authorization: Bearer $CHAVE"
# → {"data": []} — a tabela está vazia

curl -s -X POST http://127.0.0.1:8100/publico/paginas \
  -H "Authorization: Bearer $CHAVE" -H 'Content-Type: application/json' \
  -d '{"title":"Sonda pública","slug":"sonda-publica"}'
# → 201, status "inactive"

curl -s -X PATCH http://127.0.0.1:8100/publico/paginas/sonda-publica \
  -H "Authorization: Bearer $CHAVE" -H 'Content-Type: application/json' \
  -d '{"active":true,"utm_preset":{"utm_source":"instagram","utm_medium":"bio"}}'
# → {"success":true,"page_slug":"sonda-publica","utm_link":"/sonda-publica?utm_source=instagram&utm_medium=bio"}

curl -s http://127.0.0.1:8100/publico/paginas/sonda-publica -H "Authorization: Bearer $CHAVE"
# → active: true, e config com utm_presets

curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8100/publico/paginas/nao-existe \
  -H "Authorization: Bearer $CHAVE"
# → 404
```

⚠️ **Guarde esta página.** A Task 9 (o portão) precisa de uma linha em `pages`
para conferir a tela no navegador — ver o aviso lá sobre o `NewPageDialog`. Ela
será apagada no fim, pela própria tela.

- [ ] **Passo 3: commit**

```bash
git add backend/app/routers/publico.py
git commit -m "feat(7): /publico/paginas no lugar de pages-api

Mantém o vocabulário da function (title, active) porque é contrato que
integrador já usa. Funde o config, como a origem — a rota de admin
substitui, e as duas semânticas são preservadas de propósito.

O link de UTM deixa de apontar para dnia.ai, domínio da dn.ia cravado
no código da function. A contagem de leads por leads.source é mantida,
mesmo divergindo da view page_stats — registrado como pergunta."
```

---

### Task 6: A tela de Páginas passa a falar com a API

**Files:**
- Modify: `frontend/src/hooks/usePages.tsx`
- Modify: `frontend/src/components/admin/pages/PagesManagement.tsx` (linhas 53 e 65)
- Modify: `frontend/src/components/admin/pages/PageConfigEditor.tsx` (linha 114)

**Interfaces:**
- Consumes: as sete rotas da Task 1
- Produces: `usePages()` com as mesmas chaves de retorno de antes — `pages`,
  `pageStats`, `isLoading`, `refetch`, `createPage`, `updatePage`,
  `updatePageConfig`, `deletePage`, `toggleStatus`. **`toggleStatus.mutate`
  passa a receber `string` (o id), não `{ id, currentStatus }`.**

- [ ] **Passo 1: reescrever `frontend/src/hooks/usePages.tsx`**

Mantenha as interfaces `PageStat`, `Page` e `PageFormData` **exatamente como
estão** — cinco componentes as importam. Troque só o corpo:

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

// ... as três interfaces continuam iguais, sem alteração ...

export function usePages() {
  const queryClient = useQueryClient();

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ['pages'] });
    queryClient.invalidateQueries({ queryKey: ['page-stats'] });
  };

  const { data: pages = [], isLoading, refetch } = useQuery({
    queryKey: ['pages'],
    queryFn: () => api.get<Page[]>('/paginas'),
  });

  // A tabela da tela mostra a view page_stats; a edição usa a linha cheia.
  // São duas formas diferentes, e por isso duas queries — era assim antes.
  const { data: pageStats = [] } = useQuery({
    queryKey: ['page-stats'],
    queryFn: () => api.get<PageStat[]>('/paginas/estatisticas'),
  });

  const createPage = useMutation({
    mutationFn: (pageData: PageFormData) => api.post<Page>('/paginas', pageData),
    onSuccess: () => {
      invalidar();
      toast.success('Página criada com sucesso!');
    },
    onError: (error: Error) => {
      toast.error(`Erro ao criar página: ${error.message}`);
    },
  });

  const updatePage = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<PageFormData> }) =>
      api.patch<Page>(`/paginas/${id}`, data),
    onSuccess: invalidar,
    onError: (error: Error) => {
      toast.error(`Erro ao atualizar página: ${error.message}`);
    },
  });

  const updatePageConfig = useMutation({
    mutationFn: ({ slug, config }: { slug: string; config: Record<string, any> }) =>
      api.patch<Page>(`/paginas/por-slug/${encodeURIComponent(slug)}/config`, config),
    onSuccess: invalidar,
  });

  const deletePage = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/paginas/${id}`),
    onSuccess: () => {
      invalidar();
      toast.success('Página excluída com sucesso!');
    },
    onError: (error: Error) => {
      toast.error(`Erro ao excluir página: ${error.message}`);
    },
  });

  // ⚠️ Recebe só o id: quem inverte o status é o banco, na mesma instrução do
  // UPDATE. Antes o valor novo era calculado aqui e mandado pronto, e duas
  // abas abertas mandavam o mesmo valor.
  const toggleStatus = useMutation({
    mutationFn: (id: string) => api.patch<{ status: string }>(`/paginas/${id}/status`),
    onSuccess: () => {
      invalidar();
      toast.success('Status alterado com sucesso!');
    },
    onError: (error: Error) => {
      toast.error(`Erro ao alterar status: ${error.message}`);
    },
  });

  return {
    pages,
    pageStats,
    isLoading,
    refetch,
    createPage,
    updatePage,
    updatePageConfig,
    deletePage,
    toggleStatus,
  };
}
```

- [ ] **Passo 2: acertar as três chamadas de `toggleStatus`**

`frontend/src/components/admin/pages/PagesManagement.tsx`, linha 53:

```tsx
      toggleStatus.mutate(page.id);
```

Linha 65 (dentro de `handleConfirm`):

```tsx
      toggleStatus.mutate(confirmDialog.pageId);
```

`frontend/src/components/admin/pages/PageConfigEditor.tsx`, linha 114:

```tsx
    toggleStatus.mutate(page.id);
```

- [ ] **Passo 3: conferir a tipagem**

```bash
cd frontend && npx tsc --noEmit
```

Esperado: sem erro. Se aparecer erro em `PageConfigEditor.tsx` sobre
`data: { config } as any`, deixe o `as any` — ele já estava lá e tirá-lo é
mudança fora do escopo desta tarefa.

- [ ] **Passo 4: commit**

```bash
git add frontend/src/hooks/usePages.tsx \
        frontend/src/components/admin/pages/PagesManagement.tsx \
        frontend/src/components/admin/pages/PageConfigEditor.tsx
git commit -m "feat(7): a tela de Páginas sai do toco do Supabase

usePages passa a falar com /paginas. As três interfaces exportadas
(Page, PageStat, PageFormData) não mudam — cinco componentes as
importam.

A query de estatísticas chamava execute_readonly_query, que a migration
016 do lote 6 apagou: além do toco, essa metade já estava morta no
banco.

toggleStatus passa a receber só o id."
```

---

### Task 7: Apagar `leadConversion.ts`

**Files:**
- Delete: `frontend/src/lib/leadConversion.ts`

- [ ] **Passo 1: provar de novo que ninguém importa**

```bash
cd /home/ericks/github/MarketingHS
grep -rn "leadConversion" frontend/src
```

Esperado: **nenhuma linha**. O único import do arquivo está em
`docs/referencia/humanoseagentes/DiagnosticoModalHumanos.tsx`, que é o molde do
fluxo de captura guardado como referência — não entra no build. Confirme:

```bash
grep -rn "leadConversion" docs/referencia | head
```

- [ ] **Passo 2: apagar e conferir que o build continua de pé**

```bash
git rm frontend/src/lib/leadConversion.ts
cd frontend && npx tsc --noEmit && npx vite build
```

Esperado: build limpo.

- [ ] **Passo 3: commit**

```bash
git commit -m "chore(7): apaga leadConversion.ts, cliente sem chamador

Código de navegador escrito para as landing pages da dn.ia, que saíram
do repositório no lote 0. Ninguém em frontend/src o importa — o plano do
lote 1D já tinha registrado 'quem chama: ninguém'.

O que ele fazia vive agora em POST /publico/conversao, inclusive as
colunas ab_* que só ele gravava. A landing do próximo lote chama a rota."
```

---

### Task 8: A documentação — e as cinco URLs mortas herdadas

**Files:**
- Modify: `frontend/src/components/admin/settings/ApiDocumentation.tsx`
- Modify: `frontend/public/api/dnmarketing-api.yaml`

⚠️ Esta é a **oitava vez** no projeto que a documentação ensina URL morta a
integradores. Desta vez com um agravante: **a tela e o yaml discordam entre si**
— a tela já foi corrigida em lote anterior, o yaml não.

- [ ] **Passo 1: corrigir a tela de Documentação da API**

Em `ApiDocumentation.tsx`, troque os quatro blocos (`path`, o `curl` de exemplo
e o texto de `notes` quando citar a URL):

| Antes | Depois |
|---|---|
| `/register-conversion` | `/publico/conversao` (POST) |
| `/unregister-conversion` | `/publico/conversao` (DELETE) |
| `/update-conversion` | `/publico/conversao` (PATCH) |
| `/pages-api` | `/publico/paginas` |

A nota do bloco de páginas (linha ~717) diz "PATCH /pages-api?slug=xxx para
atualizar config e UTM presets" — vira `PATCH /publico/paginas/{slug}`.

- [ ] **Passo 2: corrigir o yaml, incluindo o que não é deste lote**

No `dnmarketing-api.yaml`, além dos quatro acima, **conserte as cinco entradas
que já estavam mortas antes deste lote** — conferido contra `publico.py` em
08/09/2026, nenhuma das cinco existe no backend:

| Caminho no yaml | O que responde de verdade |
|---|---|
| `/identity-lookup` | `GET /publico/identidade` |
| `/identity-upsert` | `POST /publico/identidade` |
| `/contacts-list` | `GET /publico/contatos` |
| `/contact-details` | `GET /publico/contato` |
| `/receive-contact-event` | `POST /publico/evento-de-contato` |

⚠️ **Não mexa** em `/lead-capture`, `/contact-update`, `/contact-status-update`
e `/contact-tags-sync`: essas quatro functions ainda existem e ainda não foram
portadas. Ensiná-las é correto.

- [ ] **Passo 3: provar que não sobrou URL morta**

```bash
cd /home/ericks/github/MarketingHS
grep -n "register-conversion\|unregister-conversion\|update-conversion\|pages-api\|identity-lookup\|identity-upsert\|contacts-list\|contact-details\|receive-contact-event" \
  frontend/src/components/admin/settings/ApiDocumentation.tsx \
  frontend/public/api/dnmarketing-api.yaml
```

Esperado: **nenhuma linha**.

- [ ] **Passo 4: conferir a tela no navegador**

Com o Vite em `127.0.0.1:8080`, abra Configurações → Documentação da API e leia
os blocos de conversão e de páginas. Os `curl` mostrados precisam ser os que
você acabou de rodar nas Tasks 3, 4 e 5 — se não forem, o exemplo está errado.

- [ ] **Passo 5: commit**

```bash
git add frontend/src/components/admin/settings/ApiDocumentation.tsx \
        frontend/public/api/dnmarketing-api.yaml
git commit -m "docs(7): a documentação ensina as rotas que existem

As quatro deste lote, e mais cinco que já estavam mortas no yaml desde
lotes anteriores: identity-lookup, identity-upsert, contacts-list,
contact-details e receive-contact-event. A TELA já tinha sido corrigida
e o yaml não — as duas fontes discordavam entre si.

Oitava vez que a documentação ensina URL morta a integrador."
```

---

### Task 9: O portão

Nenhuma function sai da pasta antes desta tarefa. As quatro condições do
`CLAUDE.md`, **com o passo 4 levado a sério**.

- [ ] **Passo 1: a tela não fala mais com o Supabase**

```bash
cd /home/ericks/github/MarketingHS
grep -rn "supabase" frontend/src/hooks/usePages.tsx \
                    frontend/src/components/admin/pages/
```

Esperado: nenhuma linha.

- [ ] **Passo 2: ninguém mais chama as cinco functions**

```bash
grep -rn "pages-api\|register-conversion\|unregister-conversion\|update-conversion\|apply-lead-tag" \
  frontend/src backend/app
```

Esperado: nenhuma linha. ⚠️ Este passo já pegou uma function que parecia órfã e
não era (`apply-lead-tag` no lote 1A) — não pule.

- [ ] **Passo 3: abrir e conferir no navegador**

```bash
cd backend && ./.venv/bin/python -m uvicorn app.main:app --port 8100 --reload
cd frontend && npx vite --port 8080
```

⚠️ **A tela não consegue criar a primeira página.** `NewPageDialog.tsx:52` exige
`cloneFrom` — o `isValid` só é verdadeiro com uma página de origem escolhida.
Com `pages` vazia, o botão "Nova Página" abre um diálogo que nunca pode ser
enviado. **Não é regressão deste lote e não é para consertar aqui** — é achado
para o Erick, registrado na Task 10. Use a página criada na Task 5
(`sonda-publica`) para conferir a tela.

Percorra, clicando:

- [ ] `/pages` lista a `sonda-publica`, com os cartões de contagem no topo
- [ ] a busca por nome e por slug filtra
- [ ] "Duplicar" cria a cópia (agora há duas páginas — e o `NewPageDialog` passa
      a funcionar, porque existe origem para clonar)
- [ ] "Editar" abre `/pages/sonda-publica/edit`, e salvar config persiste
      (recarregue e confira)
- [ ] o menu "Presets de UTM" salva um preset
- [ ] alternar status muda o selo, e desativar pede confirmação
- [ ] "Ver leads" navega para `/contacts?page_slug=sonda-publica`
- [ ] **excluir as duas páginas pela própria tela** — exercita o DELETE e não
      deixa linha de teste no banco

- [ ] **Passo 4: a tela ainda FAZ O QUE FAZIA**

```bash
git diff 717af11 -- frontend/src/hooks/usePages.tsx \
                    frontend/src/components/admin/pages/
```

Confira capacidade por capacidade, e escreva o resultado no relatório da
tarefa. As capacidades a conferir, uma a uma: listar · estatísticas (total de
leads, leads quentes, último lead) · criar · duplicar · editar campos · salvar
config · presets de UTM · alternar status · excluir · o bloqueio de excluir
página com lead (`PagesManagement.tsx:58`) · a navegação para os contatos da
página.

**Mudanças conscientes**, que devem aparecer no relatório e **não** como
regressão: `toggleStatus` recebe só o id, e a inversão é do banco.

⚠️ Três capacidades sumiram em silêncio no lote 6, e as três teriam passado
pelos passos 1, 2 e 3. Este passo é o que existe para pegá-las.

- [ ] **Passo 5: só então, apagar as cinco functions**

```bash
git rm -r backend/supabase/functions/pages-api \
          backend/supabase/functions/register-conversion \
          backend/supabase/functions/unregister-conversion \
          backend/supabase/functions/update-conversion \
          backend/supabase/functions/apply-lead-tag
```

- [ ] **Passo 6: a suíte e a tipagem, uma última vez**

```bash
cd backend && ./.venv/bin/pytest -q          # esperado: 137 passed
cd frontend && npx tsc --noEmit               # esperado: limpo
```

- [ ] **Passo 7: commit**

```bash
git commit -m "chore(7): o portão fecha — cinco functions saem da pasta

pages-api, register-conversion, unregister-conversion, update-conversion
e apply-lead-tag. As quatro condições conferidas, incluindo o passo 4
capacidade por capacidade contra 717af11.

Placar da pasta de especificação: 34 portadas, 7 descartadas, restam 13."
```

---

### Task 10: O placar honesto e o CONTINUAR-AQUI

**Files:**
- Modify: `docs/CONTINUAR-AQUI.md`

- [ ] **Passo 1: medir, com os dois métodos**

```bash
cd /home/ericks/github/MarketingHS
python3 -c "
import pathlib, re
n = sum(len(re.findall(r'supabase\s*\.?\s*\n?\s*\.(from|rpc)\(', f.read_text()))
        for f in pathlib.Path('frontend/src').rglob('*.ts*')
        if 'integrations/supabase' not in str(f))
print(n, 'pontos pelo script')"

grep -rn "supabase as any\|= supabase;" frontend/src --include=*.ts --include=*.tsx
```

Esperado: o script diz **0**; o grep acha **duas** linhas
(`useAbConfig.tsx:9` e `useAbTests.tsx:8`), que escondem **9 chamadas reais**.

- [ ] **Passo 2: reescrever a seção "Onde paramos" do `CONTINUAR-AQUI.md`**

O documento precisa dizer, em letra grande:

1. **O script marca zero e o toco NÃO pode ser apagado.** Sobram os 9 pontos do
   alias `const db = supabase as any` nas três telas de Experiments. "Zero
   pontos de acesso" é a frase mais fácil de ler errado deste projeto.
2. **A lista de telas liberadas para trabalho de visual estava errada.** Dizia
   quatorze de dezesseis; Experiments (três telas) estava na lista e ainda fala
   com o Supabase pelo alias. São **onze**, mais Páginas, que este lote libera:
   **doze**. Continuam fora: **Experiments** (três) e **Configurações** (espera
   o `NexusCard` do 5A, bloqueado).
3. **O lote 7 não é a captação pública da spec.** Landing modelo, OG estático e
   teste A/B ficam para o próximo lote. `pages` e `lead_conversions` seguem
   vazias.
4. **Placar:** 34 portadas, 7 descartadas, restam 13 (`ab-events`,
   `contact-status-update`, `contact-tags-sync`, `contact-update`,
   `get-nexus-stages`, `go`, `handoff-to-nexus`, `lead-capture`, `nexus-config`,
   `resend-config`, `resend-config-check`, `resend-webhook`,
   `validate-email-domain`).

- [ ] **Passo 3: acrescentar os três achados novos à lista do Erick**

Numerando a partir de 17:

17. **`page_stats` e `/publico/paginas` discordam sobre o que é "lead da
    página".** A view conta por `lead_conversions.page_slug`; a rota pública
    conta por `leads.source = slug`. As duas foram portadas como estavam,
    porque mudar qualquer uma alteraria número que alguém pode estar lendo.
    Qual das duas é a definição certa é pergunta de negócio.
18. **A tela de Páginas não consegue criar a primeira página.**
    `NewPageDialog.tsx:52` exige `cloneFrom`, e com a tabela vazia não há de
    onde clonar. Herdado — fazia sentido quando existiam 26 páginas da dn.ia.
    Some sozinho quando a landing da HS existir; até lá, página nova só por
    `POST /publico/paginas`.
19. **`frontend/index.html` continua mandando telemetria do admin para
    terceiros da dn.ia** (item 9, que segue aberto) — repetido aqui porque
    este lote passou perto e não o resolveu: não é escopo de nenhuma tarefa
    deste plano.

- [ ] **Passo 4: apontar o próximo passo**

O próximo lote é a **captação pública** que ficou de fora: landing modelo da
HS (com `/humanoseagentes` como molde), `lead-capture`,
`validate-email-domain`, OG estático, e o teste A/B (`go`, `ab-events`, as três
telas de Experiments e os 9 pontos do alias). ⚠️ Ele **precisa de brainstorm de
produto antes do plano** — a spec, na linha 439, diz explicitamente que não
decide o desenho da landing; e o A/B depende de conta Cloudflare da HS, que é
pendência do Erick.

- [ ] **Passo 5: commit**

```bash
git add docs/CONTINUAR-AQUI.md
git commit -m "docs: o lote 7 fechado, e o placar que marca zero mentindo

O script de contagem passa a marcar 0 pontos de acesso direto, e o toco
continua sem poder ser apagado: os 9 pontos do alias 'supabase as any'
das telas de Experiments nunca entraram na conta.

Corrige a lista de telas liberadas para visual, que contava Experiments
como portada. Eram onze, não quatorze."
```

---

## Autorrevisão deste plano

**Cobertura.** As cinco functions que a tela de Páginas segurava têm tarefa:
`pages-api` (Task 5), as três de conversão (Tasks 3 e 4), `apply-lead-tag`
(absorvida na Task 2). Os 8 pontos de acesso que o script mede têm tarefa
(Tasks 6 e 7). As quatro condições do portão têm tarefa (Task 9). A parte da
spec que este plano **não** cobre — landing modelo, OG estático, A/B — está
declarada em "O que este lote NÃO é" e reapontada na Task 10.

**Tipos.** `PageStat`, `Page` e `PageFormData` não mudam de forma; a Task 1
devolve exatamente as colunas de `COLUNAS` e da view, na ordem que essas
interfaces esperam. A única assinatura que muda é `toggleStatus.mutate`, de
`{ id, currentStatus }` para `string` — mudança declarada na Task 6 e com os
três call sites listados.

**O que este plano assume e pode estar errado:** que nenhum integrador externo
usa `session_id` na query string do `unregister-conversion` (a Task 4 diz o que
fazer se a conferência mostrar o contrário), e que não existe nada em
`contact_events` com `event_type` de conversão (medido: `lead_conversions` está
vazia, então não pode existir).
