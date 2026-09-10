# MarketingHS — Lote 8A: Resend — Plano

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para executar tarefa a tarefa.
> Os passos usam caixa de seleção (`- [ ]`) para acompanhamento.

**Objetivo:** devolver à configuração do Resend tudo o que a origem fazia — teste
de chave, domínio verificado, remetente validado, segredo de descadastro com
regra, rastreamento de abertura e clique, checagem de saúde, acesso servidor a
servidor — e fechar o portão das três functions do Resend.

**Arquitetura:** o cliente HTTP do Resend (`app/email/resend.py`) ganha as
chamadas de domínio. A rota `/config/resend` volta a validar como a origem, e
ganha quatro vizinhas (testar, diagnóstico, ler domínio, ligar rastreamento).
Uma dependência nova aceita **JWT de admin ou chamador máquina**, como a origem.
O card da tela é reconstruído a partir do original de 938 linhas.

**Stack:** FastAPI + asyncpg + httpx · React 18 + shadcn · pytest

**Spec:** `docs/superpowers/specs/2026-08-31-marketinghs-design.md`
**Documento-mãe:** `docs/superpowers/plans/2026-09-10-marketinghs-lote-8-fechamento.md`

---

## Por que este lote existe

Medido em 10/09/2026, comparando as três functions com o substituto capacidade
por capacidade:

| Function | Estado do substituto |
|---|---|
| `resend-webhook` (262 linhas) | **Completo** — `POST /publico/webhook/resend`, 10 testes. Só falta fechar o portão, e há um detalhe: timestamp `nan` passa pela janela anti-replay. |
| `resend-config-check` (103 linhas) | **Nenhum.** |
| `resend-config` (568 linhas) | **Parcial, por decisão do 3C** (`ecca32d`): só leitura de status e gravação de segredo. Faltam teste de chave, escopo, lista de domínios, validação do remetente, domínio verificado, regras do segredo de descadastro, `webhook_url`, rastreamento, `domain_info`, acesso máquina. |

⚠️ **E um defeito que não era decisão de ninguém:** `gravarConfigResend`
(`frontend/src/lib/config.ts:16-20`) nem tem o campo `unsubscribe_secret`. **A
tela não consegue gravar o segredo de descadastro**, e sem ele o worker não
consome a fila (`backend/app/worker.py:180-185`). Hoje não existe caminho pela
interface para o sistema enviar e-mail.

O Erick decidiu em 10/09/2026: **restaurar tudo.**

---

## Restrições globais

Valem para **toda** tarefa deste plano.

- **`sessao()` é o único caminho para dado.** O backend conecta como
  `marketinghs_app`, `NOINHERIT`. Nunca superusuário.
- **`role="service_role"` + autorização explícita na rota.** Nenhum endpoint
  depende do RLS para autorizar.
- **O papel é `'admin'`**, não `'administrador'`.
- **Toda chave lida do ambiente precisa estar declarada em `Settings`**
  (`backend/app/config.py`). Este plano não lê chave nova do ambiente.
- **Segredo nunca volta para a tela.** Leitura devolve `configurado` e, para a
  chave da API, os últimos quatro caracteres. `EMAIL_FROM` é a exceção: não é
  segredo.
- **Segredos moram em `integration_secrets`**, via `app/integracoes.py`
  (`ler_segredo`, `gravar_segredo`). Nunca leia `integration_secrets` direto.
- **Campo em branco é "não mexi", não "apague"** — regra do 3C, mantida.
- **Comentário e nome em português.** Chaves de resposta desta rota em
  português, como já estão (`configurado`, `ultimos4`).
- ⚠️ **Os testes gravam no banco real, e este plano mexe em segredos.** Toda
  fixture que toca `integration_secrets` guarda o valor anterior e o **devolve
  no teardown** — padrão da fixture `segredo` em `backend/tests/conftest.py:86`.
  **Nunca mate o pytest no meio.** A suíte leva ~5 minutos (160 testes hoje);
  use timeout ≥600s.
- **Nenhum teste faz rede.** O cliente do Resend é testado com
  `httpx.MockTransport` (padrão de `tests/test_meta_capi.py:128-155`); as rotas
  são testadas trocando as funções do cliente por `monkeypatch`.
- **`pytest.ini` tem `asyncio_mode = auto`.** Não use `pytestmark` em arquivo
  com teste síncrono.
- **Não escreva migration.** Nada neste plano muda schema.
- **Backend na porta 8100**; admin em `127.0.0.1:8080`.

---

## Decisões tomadas neste plano

| # | Decisão | Motivo |
|---|---|---|
| 1 | O remetente continua no segredo **`EMAIL_FROM`**, não em `dashboard_settings.resend_from` como na origem | É o que o worker lê (`worker.py:50-54`). Dois lugares para o remetente é o defeito que o `integracoes.py` existe para acabar. As três partes (nome, prefixo, domínio) são extraídas do próprio `EMAIL_FROM` na leitura. |
| 2 | As `action`s da origem viram **rotas próprias** (`/testar`, `/diagnostico`, `/dominios/{id}`, `/dominios/{id}/rastreamento`) | FastAPI é por rota; um `action` no corpo esconderia a autorização por operação, que é justamente o que difere entre elas. |
| 3 | **Autorização como a origem:** leitura aceita JWT de admin, `WEBHOOK_SECRET` ou chave de API de leitura; escrita aceita **só** JWT de admin ou `WEBHOOK_SECRET` | Comentário I2 da origem (`resend-config/index.ts:50-60`): uma chave da tabela `api_keys` que vazasse poderia trocar a `RESEND_API_KEY` por uma de outra conta e exfiltrar a base inteira. |
| 4 | Diagnóstico com chave *sending-only* responde `ok: true` com lista de domínios vazia | A origem respondia `api_error: "Resend respondeu 401"` — tratava chave válida como falha. O próprio `resend-config` da origem já sabia distinguir. |
| 5 | Falha secundária de banco no webhook continua devolvendo **500** (a origem devolvia 200) | O Svix reentrega, e o `svix_id` deduplica. Perder o evento em silêncio é pior que reprocessar. Registrado, não alterado. |

---

## O que já existe e não se reimplementa

| | |
|---|---|
| `ler_segredo(nome)`, `gravar_segredo(nome, valor)`, `esquecer(nome)` | `backend/app/integracoes.py` — banco primeiro, ambiente como reserva, cache de 60s |
| `chave_api(permissao)`, `ChaveApi`, `gerar_chave()`, `hash_da_chave()` | `backend/app/chave_api.py` |
| `usuario_atual`, `admin_atual`, `Usuario` | `backend/app/dependencies.py` |
| `emitir_token(user_id, papel, email) -> (token, expira)`, `gerar_hash(senha)` | `backend/app/auth/security.py` |
| `POST /publico/webhook/resend` (função `resend_webhook`) | `backend/app/routers/webhook.py:226` |
| fixtures `cliente`, `segredo`, `conexao` | `backend/tests/conftest.py` |
| o card original, de 938 linhas | `git show 817d15c:frontend/src/components/admin/settings/ResendConfigCard.tsx` |

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| **Modificar** `backend/app/email/resend.py` | + `testar_chave`, `ler_dominio`, `alterar_dominio`, `restrita`, `FalhaDeRede` |
| **Criar** `backend/tests/test_resend_cliente.py` | o cliente, contra `MockTransport` |
| **Modificar** `backend/app/chave_api.py` | + `admin_ou_maquina(permissao)` |
| **Modificar** `backend/tests/conftest.py` | + fixtures `token_admin`, `segredos_resend`, `chave_de` |
| **Modificar** `backend/app/routers/configuracao.py:292-364` | `/config/resend` restaurado + as quatro rotas novas |
| **Criar** `backend/tests/test_config_resend.py` | as rotas |
| **Modificar** `backend/app/routers/webhook.py:73-88` | timestamp não finito é recusado |
| **Modificar** `backend/tests/test_webhook.py` | + um teste |
| **Modificar** `frontend/src/lib/config.ts:5-20` | tipos e chamadas novos |
| **Reescrever** `frontend/src/components/admin/settings/ResendConfigCard.tsx` | o card restaurado |
| **Apagar** `backend/supabase/functions/resend-config`, `resend-config-check`, `resend-webhook` | no portão |

---

### Tarefa 1: O cliente do Resend fala com a API de domínios

**Arquivos:**
- Modificar: `backend/app/email/resend.py`
- Criar: `backend/tests/test_resend_cliente.py`

**Interfaces:**
- Produz:
  - `testar_chave(chave: str) -> dict` — `{"valida": True, "escopo": "full"|"sending_only", "dominios": list[dict]}` ou `{"valida": False, "motivo": "invalid_api_key"|"network"|"unknown"}`. Cada domínio: `{"id", "name", "status", "capabilities"}`.
  - `ler_dominio(chave: str, dominio_id: str) -> dict` — `{"ok": True, "open_tracking": bool, "click_tracking": bool, "tracking_subdomain": str|None, "status": str|None, "records": list}` ou `{"ok": False, "motivo": "restricted_api_key"|"not_found"|"network"|"unknown"}`. `records` só os de `record == "Tracking"`.
  - `alterar_dominio(chave: str, dominio_id: str, corpo: dict) -> httpx.Response` — levanta `FalhaDeRede` se a rede falhar.
  - `restrita(resposta: httpx.Response) -> bool` — o 401 é de chave *sending-only*.
  - `class FalhaDeRede(Exception)`.

- [ ] **Passo 1: escrever os testes que falham**

```python
"""O cliente do Resend, sem rede.

A classificação da chave é o que a origem acertou e o 3C perdeu: 200 é chave
completa; 401 com `restricted_api_key` é chave VÁLIDA de envio; 403 é chave
inválida. Testar só "deu 200?" reprovaria uma chave de envio perfeita.
"""

import httpx
import pytest

from app.email import resend


def _trocar_transporte(monkeypatch, handler):
    transporte = httpx.MockTransport(handler)

    class ClienteFalso(httpx.AsyncClient):
        def __init__(self, *args, **kwargs):
            kwargs["transport"] = transporte
            super().__init__(*args, **kwargs)

    monkeypatch.setattr(resend.httpx, "AsyncClient", ClienteFalso)


async def test_chave_completa_lista_os_dominios(monkeypatch):
    def handler(request):
        assert request.url == httpx.URL(resend.DOMINIOS)
        assert request.headers["authorization"] == "Bearer re_completa"
        return httpx.Response(200, json={"data": [
            {"id": "d1", "name": "hs.com.br", "status": "verified",
             "capabilities": {"sending": "enabled"}}]})
    _trocar_transporte(monkeypatch, handler)

    r = await resend.testar_chave("re_completa")

    assert r == {"valida": True, "escopo": "full", "dominios": [
        {"id": "d1", "name": "hs.com.br", "status": "verified",
         "capabilities": {"sending": "enabled"}}]}


async def test_chave_de_envio_e_valida(monkeypatch):
    _trocar_transporte(monkeypatch, lambda r: httpx.Response(
        401, json={"name": "restricted_api_key", "message": "..."}))
    assert await resend.testar_chave("re_envio") == {
        "valida": True, "escopo": "sending_only", "dominios": []}


async def test_401_sem_restricted_e_chave_invalida(monkeypatch):
    _trocar_transporte(monkeypatch, lambda r: httpx.Response(
        401, json={"name": "missing_api_key"}))
    assert await resend.testar_chave("re_x") == {
        "valida": False, "motivo": "invalid_api_key"}


async def test_403_e_chave_invalida(monkeypatch):
    _trocar_transporte(monkeypatch, lambda r: httpx.Response(
        403, json={"name": "invalid_api_key"}))
    assert await resend.testar_chave("re_x") == {
        "valida": False, "motivo": "invalid_api_key"}


async def test_rede_fora_do_ar_nao_levanta(monkeypatch):
    def handler(request):
        raise httpx.ConnectError("sem rede")
    _trocar_transporte(monkeypatch, handler)
    assert await resend.testar_chave("re_x") == {"valida": False, "motivo": "network"}


async def test_ler_dominio_filtra_so_os_registros_de_tracking(monkeypatch):
    def handler(request):
        assert request.url == httpx.URL(f"{resend.DOMINIOS}/d1")
        return httpx.Response(200, json={
            "open_tracking": True, "click_tracking": False,
            "tracking_subdomain": "links", "status": "verified",
            "records": [{"record": "SPF", "name": "x"},
                        {"record": "Tracking", "name": "links", "type": "CNAME",
                         "value": "links1.resend-dns.com", "status": "pending"}]})
    _trocar_transporte(monkeypatch, handler)

    r = await resend.ler_dominio("re_completa", "d1")

    assert r["ok"] is True
    assert r["open_tracking"] is True and r["click_tracking"] is False
    assert [x["record"] for x in r["records"]] == ["Tracking"]


async def test_ler_dominio_com_chave_de_envio(monkeypatch):
    _trocar_transporte(monkeypatch, lambda r: httpx.Response(
        401, json={"name": "restricted_api_key"}))
    assert await resend.ler_dominio("re_envio", "d1") == {
        "ok": False, "motivo": "restricted_api_key"}


async def test_ler_dominio_inexistente(monkeypatch):
    _trocar_transporte(monkeypatch, lambda r: httpx.Response(404, json={}))
    assert await resend.ler_dominio("re_x", "d9") == {"ok": False, "motivo": "not_found"}


async def test_alterar_dominio_manda_patch_com_o_corpo(monkeypatch):
    visto = {}

    def handler(request):
        visto["metodo"] = request.method
        visto["corpo"] = request.read()
        return httpx.Response(200, json={"object": "domain"})
    _trocar_transporte(monkeypatch, handler)

    r = await resend.alterar_dominio("re_x", "d1", {"open_tracking": True})

    assert r.status_code == 200
    assert visto["metodo"] == "PATCH"
    assert b'"open_tracking":true' in visto["corpo"].replace(b" ", b"")


async def test_alterar_dominio_sem_rede_levanta_falha_de_rede(monkeypatch):
    def handler(request):
        raise httpx.ConnectError("sem rede")
    _trocar_transporte(monkeypatch, handler)
    with pytest.raises(resend.FalhaDeRede):
        await resend.alterar_dominio("re_x", "d1", {})
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_resend_cliente.py`
Expected: FAIL — `AttributeError: module 'app.email.resend' has no attribute 'DOMINIOS'`

- [ ] **Passo 3: implementar**

Acrescente ao fim de `backend/app/email/resend.py` (e `import json` no topo, junto
do `import httpx`):

```python
# ── Domínios ─────────────────────────────────────────────────────────────────
# Restaurado no lote 8A: a origem (`resend-config`) testava a chave, listava e
# exigia domínio verificado, e ligava open/click tracking. O 3C tirou tudo; o
# Erick decidiu devolver.

DOMINIOS = "https://api.resend.com/domains"


class FalhaDeRede(Exception):
    """A API do Resend não respondeu. Quem chama decide se é 502 ou degradação."""


def restrita(resposta: httpx.Response) -> bool:
    """O 401 é de chave *sending-only* — VÁLIDA, só não pode ler domínio.

    ⚠️ Qualquer outro 401 (corpo diferente, ou não-JSON) NÃO é restrita: não
    classificamos chave como válida por omissão.
    """
    try:
        corpo = resposta.json()
    except ValueError:
        return False
    if isinstance(corpo, dict) and corpo.get("name") == "restricted_api_key":
        return True
    return "restricted_api_key" in json.dumps(corpo)


async def testar_chave(chave: str) -> dict:
    """Classifica a chave sem gravá-la. NUNCA levanta."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as cliente:
            resposta = await cliente.get(
                DOMINIOS, headers={"Authorization": f"Bearer {chave}"})
    except httpx.HTTPError:
        return {"valida": False, "motivo": "network"}

    if resposta.status_code == 200:
        try:
            corpo = resposta.json()
        except ValueError:
            return {"valida": False, "motivo": "network"}
        dados = corpo.get("data") if isinstance(corpo, dict) else None
        return {"valida": True, "escopo": "full", "dominios": [
            {"id": d.get("id"), "name": d.get("name"), "status": d.get("status"),
             "capabilities": d.get("capabilities")}
            for d in (dados or []) if isinstance(d, dict)]}

    if resposta.status_code == 401:
        if restrita(resposta):
            return {"valida": True, "escopo": "sending_only", "dominios": []}
        return {"valida": False, "motivo": "invalid_api_key"}
    if resposta.status_code == 403:
        return {"valida": False, "motivo": "invalid_api_key"}
    return {"valida": False, "motivo": "unknown"}


async def ler_dominio(chave: str, dominio_id: str) -> dict:
    """O estado REAL do rastreamento, pelo GET de domínio único. NUNCA levanta.

    ⚠️ A listagem (`GET /domains`) não garante trazer open/click tracking por
    item; o GET de domínio único sempre traz. É o que permite avisar o caso
    traiçoeiro: tracking ligado na conta e o CNAME nunca adicionado no DNS.
    """
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as cliente:
            resposta = await cliente.get(
                f"{DOMINIOS}/{dominio_id}",
                headers={"Authorization": f"Bearer {chave}"})
    except httpx.HTTPError:
        return {"ok": False, "motivo": "network"}

    if resposta.status_code == 401:
        return {"ok": False, "motivo": "restricted_api_key" if restrita(resposta)
                else "unknown"}
    if resposta.status_code == 404:
        return {"ok": False, "motivo": "not_found"}
    if not resposta.is_success:
        return {"ok": False, "motivo": "unknown"}
    try:
        corpo = resposta.json()
    except ValueError:
        return {"ok": False, "motivo": "unknown"}

    registros = corpo.get("records") if isinstance(corpo.get("records"), list) else []
    return {
        "ok": True,
        "open_tracking": bool(corpo.get("open_tracking")),
        "click_tracking": bool(corpo.get("click_tracking")),
        "tracking_subdomain": corpo.get("tracking_subdomain"),
        "status": corpo.get("status"),
        "records": [r for r in registros
                    if isinstance(r, dict) and r.get("record") == "Tracking"],
    }


async def alterar_dominio(chave: str, dominio_id: str, corpo: dict) -> httpx.Response:
    """PATCH no domínio. Devolve a resposta crua — quem chama interpreta.
    Levanta `FalhaDeRede` se não houver resposta."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as cliente:
            return await cliente.patch(
                f"{DOMINIOS}/{dominio_id}",
                headers={"Authorization": f"Bearer {chave}"}, json=corpo)
    except httpx.HTTPError as e:
        raise FalhaDeRede(str(e)) from e
```

- [ ] **Passo 4: rodar e ver passar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_resend_cliente.py`
Expected: 10 passed

- [ ] **Passo 5: commit**

```bash
git add backend/app/email/resend.py backend/tests/test_resend_cliente.py
git commit -m "feat(8A): o cliente do Resend volta a falar com a API de domínios"
```

---

### Tarefa 2: Admin ou máquina — a autorização da origem

**Arquivos:**
- Modificar: `backend/app/chave_api.py`
- Modificar: `backend/tests/conftest.py`
- Criar: `backend/tests/test_config_resend.py` (começa aqui, cresce nas tarefas 3 a 5)

**Interfaces:**
- Consome: `usuario_atual` (`app/dependencies.py`), `ler_token` (`app/auth/security.py`), `chave_api`.
- Produz:
  - `admin_ou_maquina(permissao: str)` — fábrica de dependência, `permissao` em `("read", "write")`. Devolve `"admin"`, `"webhook"` ou `"chave"`.
  - Fixtures em `conftest.py`: `token_admin` (str), `segredos_resend` (limpa e restaura os 4 segredos), `chave_de` (fábrica: `await chave_de("read")` devolve a chave crua; limpa no teardown).

- [ ] **Passo 1: as fixtures**

Acrescente ao fim de `backend/tests/conftest.py`:

```python
@pytest_asyncio.fixture
async def token_admin():
    """Um JWT de administrador de verdade, para as rotas com `admin_atual`.

    ⚠️ Cria usuário em `auth.users` do banco real. Limpa antes (pytest morto no
    meio deixa a linha e o e-mail único derruba a rodada seguinte) e depois.
    """
    from app.auth.security import emitir_token, gerar_hash

    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")
    email = "admin-teste-8a@exemplo.invalid"
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            "DELETE FROM public.user_roles WHERE user_id IN "
            "(SELECT id FROM auth.users WHERE email = $1)", email)
        await conn.execute("DELETE FROM auth.users WHERE email = $1", email)
        uid = await conn.fetchval(
            "INSERT INTO auth.users (email, password_hash) VALUES ($1, $2) "
            "RETURNING id::text", email, gerar_hash("senha-de-teste-8a"))
        await conn.execute(
            "INSERT INTO public.user_roles (user_id, role) VALUES ($1::uuid, 'admin')",
            uid)
    token, _ = emitir_token(uid, "admin", email)
    yield token
    async with db.sessao(role="service_role") as conn:
        await conn.execute("DELETE FROM public.user_roles WHERE user_id = $1::uuid", uid)
        await conn.execute("DELETE FROM auth.users WHERE id = $1::uuid", uid)


SEGREDOS_DO_RESEND = ("RESEND_API_KEY", "EMAIL_FROM", "UNSUBSCRIBE_SECRET",
                      "RESEND_WEBHOOK_SECRET")


@pytest_asyncio.fixture
async def segredos_resend(monkeypatch):
    """Começa o teste SEM nenhum segredo do Resend, e devolve os que havia.

    ⚠️ O banco é o de produção. Se houver segredo de verdade gravado, ele sai
    durante o teste e VOLTA no teardown — por isso nunca mate o pytest no meio.
    O ambiente também é esvaziado: `ler_segredo` cai para `os.environ`.
    """
    from app import integracoes

    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")
    async with db.sessao(role="service_role") as conn:
        antes = {r["name"]: r["value"] for r in await conn.fetch(
            "SELECT name, value FROM integration_secrets WHERE name = ANY($1::text[])",
            list(SEGREDOS_DO_RESEND))}
        await conn.execute(
            "DELETE FROM integration_secrets WHERE name = ANY($1::text[])",
            list(SEGREDOS_DO_RESEND))
    for nome in SEGREDOS_DO_RESEND:
        monkeypatch.delenv(nome, raising=False)
        integracoes.esquecer(nome)
    yield
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            "DELETE FROM integration_secrets WHERE name = ANY($1::text[])",
            list(SEGREDOS_DO_RESEND))
        for nome, valor in antes.items():
            await conn.execute(
                "INSERT INTO integration_secrets (name, value, updated_at) "
                "VALUES ($1, $2, now())", nome, valor)
    for nome in SEGREDOS_DO_RESEND:
        integracoes.esquecer(nome)


@pytest_asyncio.fixture
async def chave_de():
    """Fábrica de chave de API: `crua = await chave_de("read")`."""
    from app.chave_api import gerar_chave

    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")
    hashes = []

    async def _criar(permissao: str) -> str:
        crua, hash_, prefixo = gerar_chave()
        async with db.sessao(role="service_role") as conn:
            await conn.execute(
                "INSERT INTO api_keys (name, key_hash, key_prefix, permissions) "
                "VALUES ('teste 8A', $1, $2, $3)", hash_, prefixo, permissao)
        hashes.append(hash_)
        return crua

    yield _criar
    async with db.sessao(role="service_role") as conn:
        await conn.execute("DELETE FROM api_keys WHERE key_hash = ANY($1::text[])", hashes)
```

- [ ] **Passo 2: escrever os testes que falham**

Crie `backend/tests/test_config_resend.py`:

```python
"""A configuração do Resend, restaurada no lote 8A.

As rotas chamam a API do Resend; aqui as funções do cliente são trocadas por
monkeypatch — o cliente em si é testado em `test_resend_cliente.py`.
"""

import pytest

from app.email import resend as cliente_resend

ROTA = "/config/resend"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _resend_falso(monkeypatch, teste=None, dominio=None):
    async def testar_chave(chave):
        return teste or {"valida": True, "escopo": "full", "dominios": []}

    async def ler_dominio(chave, dominio_id):
        return dominio or {"ok": False, "motivo": "not_found"}

    monkeypatch.setattr(cliente_resend, "testar_chave", testar_chave)
    monkeypatch.setattr(cliente_resend, "ler_dominio", ler_dominio)


async def test_leitura_sem_credencial_da_401(cliente):
    r = await cliente.get(ROTA)
    assert r.status_code == 401


async def test_leitura_aceita_chave_de_api_de_leitura(cliente, chave_de,
                                                      segredos_resend, monkeypatch):
    _resend_falso(monkeypatch)
    r = await cliente.get(ROTA, headers=_auth(await chave_de("read")))
    assert r.status_code == 200, r.text


async def test_escrita_recusa_chave_de_api_mesmo_de_escrita(cliente, chave_de,
                                                            segredos_resend):
    """Comentário I2 da origem: chave da tabela `api_keys` que vazasse poderia
    trocar a RESEND_API_KEY por uma de outra conta e exfiltrar a base."""
    r = await cliente.put(ROTA, headers=_auth(await chave_de("write")), json={
        "from_name": "HS", "from_prefix": "contato", "from_domain": "hs.com.br"})
    assert r.status_code == 401
```

- [ ] **Passo 3: rodar e ver falhar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_config_resend.py`
Expected: FAIL — `test_leitura_aceita_chave_de_api_de_leitura` dá 401 (a rota hoje é `admin_atual`) e o de escrita dá 401 pelo motivo errado ou 422. Confira que ao menos o de leitura falha.

- [ ] **Passo 4: implementar a dependência**

Acrescente ao fim de `backend/app/chave_api.py`:

```python
def admin_ou_maquina(permissao: str):
    """Fábrica de dependência para a configuração de integração.

    A origem (`resend-config`, `resend-config-check`) aceitava o navegador do
    admin E o chamador máquina — mas não do mesmo jeito:

      - leitura: JWT de admin, `WEBHOOK_SECRET` ou chave de API de leitura
      - escrita: JWT de admin ou `WEBHOOK_SECRET` — NUNCA chave da tabela
        `api_keys`, mesmo com permissão de escrita

    ⚠️ A assimetria é o ponto. Uma chave de `api_keys` que vazasse poderia
    trocar a RESEND_API_KEY por uma de outra conta: toda campanha passaria a
    sair — e ser lida — pela conta de terceiro. Não "simplifique" para
    `chave_api("write")`.

    Devolve quem autorizou: "admin", "webhook" ou "chave".
    """
    if permissao not in ("read", "write"):
        raise ValueError(f"permissão inválida: {permissao!r}")

    async def dependencia(
        cred: HTTPAuthorizationCredentials | None = Depends(_bearer),
    ) -> str:
        if cred is None:
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED, "Credencial necessária.",
                headers={"WWW-Authenticate": "Bearer"})
        token = cred.credentials

        if settings.WEBHOOK_SECRET and hmac.compare_digest(token, settings.WEBHOOK_SECRET):
            return "webhook"

        # Parece JWT? Então é o navegador — e tem de ser admin.
        from app.auth.security import ler_token
        from app.dependencies import usuario_atual
        import jwt

        try:
            ler_token(token)
            eh_jwt = True
        except jwt.PyJWTError:
            eh_jwt = False
        if eh_jwt:
            usuario = await usuario_atual(cred)
            if usuario.papel != "admin":
                raise HTTPException(status.HTTP_403_FORBIDDEN,
                                    "Esta ação exige perfil de administrador.")
            return "admin"

        if permissao == "write":
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED,
                "Esta operação aceita só o login de administrador ou o WEBHOOK_SECRET.")
        await chave_api("read")(cred)
        return "chave"

    return dependencia
```

⚠️ Os imports ficam **dentro** da função: `app.dependencies` não importa
`app.chave_api`, mas importar no topo acoplaria os dois módulos de autenticação
na carga, e o docstring de `chave_api.py` diz que eles são modelos separados.

Troque a autorização das duas rotas existentes em
`backend/app/routers/configuracao.py` — o resto delas muda na Tarefa 3 e 4:

```python
# no topo, junto dos imports de app.dependencies:
from app.chave_api import admin_ou_maquina

# ler_config_resend:
async def ler_config_resend(_: str = Depends(admin_ou_maquina("read"))):
# gravar_config_resend:
async def gravar_config_resend(dados: ResendIn, _: str = Depends(admin_ou_maquina("write"))):
```

- [ ] **Passo 5: rodar e ver passar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_config_resend.py`
Expected: 3 passed. (O de escrita pode dar 401 antes de validar o corpo — é o
esperado: a dependência roda antes.)

- [ ] **Passo 6: commit**

```bash
git add backend/app/chave_api.py backend/app/routers/configuracao.py \
        backend/tests/conftest.py backend/tests/test_config_resend.py
git commit -m "feat(8A): a configuração do Resend aceita admin ou máquina, como a origem"
```

---

### Tarefa 3: Ler, testar e diagnosticar

**Arquivos:**
- Modificar: `backend/app/routers/configuracao.py:292-336`
- Modificar: `backend/tests/test_config_resend.py`

**Interfaces:**
- Consome: `cliente_resend.testar_chave`, `admin_ou_maquina`, `ler_segredo`.
- Produz:
  - `GET /config/resend` → `{"resend_api_key": {"configurado", "ultimos4", "escopo"}, "email_from": str|None, "remetente": {"nome","prefixo","dominio"}|None, "unsubscribe_secret": {"configurado"}, "webhook_secret": {"configurado"}, "dominios": list, "webhook_url": str}`
  - `POST /config/resend/testar` `{"api_key": str}` → o dict de `testar_chave`
  - `GET /config/resend/diagnostico` → `{"ok": bool, "faltando": list[str], "segredo_descadastro_faltando": bool, "remetente"?: str, "dominios"?: list[{"name","status"}], "erro_api"?: str}`
  - `partes_do_remetente(email_from: str|None) -> dict|None` (função de módulo)

- [ ] **Passo 1: escrever os testes que falham**

Acrescente a `backend/tests/test_config_resend.py`:

```python
from app import integracoes
from app.routers.configuracao import partes_do_remetente


def test_partes_do_remetente():
    assert partes_do_remetente("Health & Safety <contato@hs.com.br>") == {
        "nome": "Health & Safety", "prefixo": "contato", "dominio": "hs.com.br"}
    assert partes_do_remetente("contato@hs.com.br") is None
    assert partes_do_remetente(None) is None


async def test_leitura_devolve_escopo_dominios_e_webhook_url_e_nunca_o_segredo(
        cliente, token_admin, segredos_resend, monkeypatch):
    await integracoes.gravar_segredo("RESEND_API_KEY", "re_segredo_de_teste_1234")
    await integracoes.gravar_segredo("EMAIL_FROM", "HS <contato@hs.com.br>")
    _resend_falso(monkeypatch, teste={"valida": True, "escopo": "full", "dominios": [
        {"id": "d1", "name": "hs.com.br", "status": "verified", "capabilities": None}]})

    r = await cliente.get(ROTA, headers=_auth(token_admin))

    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["resend_api_key"] == {"configurado": True, "ultimos4": "1234",
                                       "escopo": "full"}
    assert corpo["remetente"] == {"nome": "HS", "prefixo": "contato",
                                  "dominio": "hs.com.br"}
    assert corpo["dominios"][0]["id"] == "d1"
    assert corpo["webhook_url"].endswith("/publico/webhook/resend")
    assert "re_segredo_de_teste" not in r.text


async def test_testar_classifica_sem_gravar(cliente, token_admin, segredos_resend,
                                            monkeypatch):
    _resend_falso(monkeypatch, teste={"valida": True, "escopo": "sending_only",
                                      "dominios": []})
    r = await cliente.post(f"{ROTA}/testar", headers=_auth(token_admin),
                           json={"api_key": "re_nova"})
    assert r.json() == {"valida": True, "escopo": "sending_only", "dominios": []}
    assert await integracoes.ler_segredo("RESEND_API_KEY") is None


async def test_diagnostico_aponta_o_que_falta(cliente, token_admin, segredos_resend):
    r = await cliente.get(f"{ROTA}/diagnostico", headers=_auth(token_admin))
    corpo = r.json()
    assert corpo["ok"] is False
    assert corpo["faltando"] == ["RESEND_API_KEY", "EMAIL_FROM", "RESEND_WEBHOOK_SECRET"]
    assert corpo["segredo_descadastro_faltando"] is True


async def test_diagnostico_completo(cliente, token_admin, segredos_resend, monkeypatch):
    for nome, valor in (("RESEND_API_KEY", "re_x"), ("EMAIL_FROM", "HS <c@hs.com.br>"),
                        ("RESEND_WEBHOOK_SECRET", "whsec_eA=="),
                        ("UNSUBSCRIBE_SECRET", "u" * 32)):
        await integracoes.gravar_segredo(nome, valor)
    _resend_falso(monkeypatch, teste={"valida": True, "escopo": "full", "dominios": [
        {"id": "d1", "name": "hs.com.br", "status": "verified", "capabilities": None}]})

    corpo = (await cliente.get(f"{ROTA}/diagnostico", headers=_auth(token_admin))).json()

    assert corpo == {"ok": True, "faltando": [], "segredo_descadastro_faltando": False,
                     "remetente": "HS <c@hs.com.br>",
                     "dominios": [{"name": "hs.com.br", "status": "verified"}]}
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_config_resend.py`
Expected: FAIL — `ImportError: cannot import name 'partes_do_remetente'`

- [ ] **Passo 3: implementar**

Em `backend/app/routers/configuracao.py`, acrescente aos imports:

```python
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from app.email import resend as cliente_resend
from app.integracoes import gravar_segredo, ler_segredo
```

e **substitua** o bloco que vai de `# ── Configuração do Resend` até o fim de
`ler_config_resend` (hoje linhas 292-336) por:

```python
# ── Configuração do Resend ───────────────────────────────────────────────────
# Os segredos moram em `integration_secrets` (ver app/integracoes.py), não no
# repositório e não no .env de produção.
#
# ⚠️ Restaurado por inteiro no lote 8A. O 3C (`ecca32d`) tinha tirado teste de
# chave, domínios, rastreamento e diagnóstico, e — sem ninguém decidir isso — a
# tela perdeu o caminho para gravar o UNSUBSCRIBE_SECRET, sem o qual o worker
# não consome a fila. O Erick decidiu em 10/09/2026 restaurar tudo.

SEGREDOS_RESEND = {
    "api_key": "RESEND_API_KEY",
    "email_from": "EMAIL_FROM",
    "unsubscribe_secret": "UNSUBSCRIBE_SECRET",
    "webhook_secret": "RESEND_WEBHOOK_SECRET",
}

_REMETENTE = re.compile(r"^\s*(.+?)\s*<([^@\s<>]+)@([^\s<>]+)>\s*$")


def partes_do_remetente(email_from: str | None) -> dict | None:
    """`"Nome <prefixo@dominio>"` → as três partes que a tela edita.

    ⚠️ O remetente mora no segredo EMAIL_FROM, que é o que o worker lê — não em
    `dashboard_settings.resend_from` como na origem. Dois lugares para o
    remetente é o defeito que o `integracoes.py` existe para acabar; as partes
    saem do próprio valor.
    """
    if not email_from:
        return None
    achado = _REMETENTE.match(email_from)
    if not achado:
        return None
    return {"nome": achado[1], "prefixo": achado[2], "dominio": achado[3]}


@router.get("/config/resend")
async def ler_config_resend(request: Request,
                            _: str = Depends(admin_ou_maquina("read"))):
    """O que está configurado — NUNCA o valor de um segredo.

    ⚠️ Devolver o valor colocaria a RESEND_API_KEY no HTML de qualquer admin
    logado, e num log de proxy no caminho. `EMAIL_FROM` é a exceção: não é
    segredo, é o endereço que aparece na caixa de entrada de quem recebe.

    Com chave gravada, testa a chave de novo — é o que dá o escopo e a lista de
    domínios. A origem fazia o mesmo a cada leitura.
    """
    valores = {campo: await ler_segredo(nome)
               for campo, nome in SEGREDOS_RESEND.items()}
    chave = valores["api_key"] or ""

    escopo, dominios = None, []
    if chave:
        teste = await cliente_resend.testar_chave(chave)
        if teste["valida"]:
            escopo, dominios = teste["escopo"], teste["dominios"]

    return {
        "resend_api_key": {"configurado": bool(chave),
                           "ultimos4": chave[-4:] if len(chave) >= 4 else None,
                           "escopo": escopo},
        "email_from": valores["email_from"],
        "remetente": partes_do_remetente(valores["email_from"]),
        "unsubscribe_secret": {"configurado": bool(valores["unsubscribe_secret"])},
        "webhook_secret": {"configurado": bool(valores["webhook_secret"])},
        "dominios": dominios,
        # Montado pelo próprio request: o host de produção ainda não foi
        # decidido (item 11), e cravar um aqui repetiria o link de anúncio que
        # o subprojeto A pegou apontando para o lugar errado.
        "webhook_url": str(request.url_for("resend_webhook")),
    }


class TesteDeChaveIn(BaseModel):
    api_key: str = Field(min_length=1, max_length=500)


@router.post("/config/resend/testar")
async def testar_chave_resend(dados: TesteDeChaveIn,
                              _: str = Depends(admin_ou_maquina("read"))):
    """Classifica a chave SEM gravar. É leitura: não muda nada."""
    return await cliente_resend.testar_chave(dados.api_key.strip())


@router.get("/config/resend/diagnostico")
async def diagnostico_resend(_: str = Depends(admin_ou_maquina("read"))):
    """O que era `resend-config-check`: está tudo no lugar, e o Resend responde?

    ⚠️ O segredo de descadastro vem num campo PRÓPRIO, fora de `faltando`: a
    ausência dele não afeta a conexão com o Resend, mas faz o worker não
    consumir a fila. A tela mostra os dois avisos separados.

    Diferente da origem: chave *sending-only* responde `ok: true` com lista de
    domínios vazia. A origem tratava como `api_error` — chave válida acusada
    como falha.
    """
    chave = await ler_segredo("RESEND_API_KEY")
    remetente = await ler_segredo("EMAIL_FROM")
    segredo_webhook = await ler_segredo("RESEND_WEBHOOK_SECRET")
    sem_descadastro = not await ler_segredo("UNSUBSCRIBE_SECRET")

    faltando = [nome for nome, valor in (("RESEND_API_KEY", chave),
                                         ("EMAIL_FROM", remetente),
                                         ("RESEND_WEBHOOK_SECRET", segredo_webhook))
                if not valor]
    if faltando:
        return {"ok": False, "faltando": faltando,
                "segredo_descadastro_faltando": sem_descadastro}

    teste = await cliente_resend.testar_chave(chave)
    if not teste["valida"]:
        return {"ok": False, "faltando": [],
                "segredo_descadastro_faltando": sem_descadastro,
                "erro_api": f"O Resend recusou a chave ({teste['motivo']})."}
    return {"ok": True, "faltando": [],
            "segredo_descadastro_faltando": sem_descadastro,
            "remetente": remetente,
            "dominios": [{"name": d["name"], "status": d["status"]}
                         for d in teste["dominios"]]}
```

⚠️ `cliente_resend.testar_chave`, **não** `from app.email.resend import
testar_chave`: o teste troca a função no módulo com monkeypatch, e um import
por nome ficaria com a referência antiga.

Apague os `from app.integracoes import ...` que ficavam **dentro** de
`ler_config_resend` e `gravar_config_resend` — agora estão no topo.

- [ ] **Passo 4: rodar e ver passar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_config_resend.py`
Expected: 8 passed

- [ ] **Passo 5: commit**

```bash
git add backend/app/routers/configuracao.py backend/tests/test_config_resend.py
git commit -m "feat(8A): ler, testar e diagnosticar o Resend — o resend-config-check volta"
```

---

### Tarefa 4: Gravar como a origem gravava

**Arquivos:**
- Modificar: `backend/app/routers/configuracao.py` (`ResendIn` e `gravar_config_resend`)
- Modificar: `backend/tests/test_config_resend.py`

**Interfaces:**
- Consome: `cliente_resend.testar_chave`, `gravar_segredo`, `ler_segredo`.
- Produz: `PUT /config/resend` com corpo `{"api_key"?, "from_name", "from_prefix", "from_domain", "unsubscribe_secret"?, "webhook_secret"?}` → `{"gravados": list[str], "email_from": str, "aviso": str|None}`. ⚠️ **O campo `email_from` do corpo sai**; o remetente vem em três partes, como na origem.

- [ ] **Passo 1: escrever os testes que falham**

```python
REMETENTE = {"from_name": "Health & Safety", "from_prefix": "contato",
             "from_domain": "hs.com.br"}
VERIFICADO = {"valida": True, "escopo": "full", "dominios": [
    {"id": "d1", "name": "hs.com.br", "status": "verified",
     "capabilities": {"sending": "enabled"}}]}


async def test_gravar_recusa_chave_invalida_e_nao_grava_nada(
        cliente, token_admin, segredos_resend, monkeypatch):
    _resend_falso(monkeypatch, teste={"valida": False, "motivo": "invalid_api_key"})
    r = await cliente.put(ROTA, headers=_auth(token_admin), json={
        **REMETENTE, "api_key": "re_ruim", "unsubscribe_secret": "u" * 32})
    assert r.status_code == 400
    assert await integracoes.ler_segredo("RESEND_API_KEY") is None
    assert await integracoes.ler_segredo("UNSUBSCRIBE_SECRET") is None


async def test_gravar_exige_o_dominio_na_conta(cliente, token_admin, segredos_resend,
                                               monkeypatch):
    _resend_falso(monkeypatch, teste={"valida": True, "escopo": "full", "dominios": []})
    r = await cliente.put(ROTA, headers=_auth(token_admin), json={
        **REMETENTE, "api_key": "re_ok", "unsubscribe_secret": "u" * 32})
    assert r.status_code == 400
    assert "não encontrado" in r.json()["detail"]


async def test_gravar_exige_dominio_verificado(cliente, token_admin, segredos_resend,
                                               monkeypatch):
    _resend_falso(monkeypatch, teste={"valida": True, "escopo": "full", "dominios": [
        {"id": "d1", "name": "hs.com.br", "status": "pending", "capabilities": None}]})
    r = await cliente.put(ROTA, headers=_auth(token_admin), json={
        **REMETENTE, "api_key": "re_ok", "unsubscribe_secret": "u" * 32})
    assert r.status_code == 400
    assert "não está verificado" in r.json()["detail"]


async def test_parcialmente_verificado_com_envio_ligado_passa(
        cliente, token_admin, segredos_resend, monkeypatch):
    _resend_falso(monkeypatch, teste={"valida": True, "escopo": "full", "dominios": [
        {"id": "d1", "name": "hs.com.br", "status": "partially_verified",
         "capabilities": {"sending": "enabled"}}]})
    r = await cliente.put(ROTA, headers=_auth(token_admin), json={
        **REMETENTE, "api_key": "re_ok", "unsubscribe_secret": "u" * 32})
    assert r.status_code == 200, r.text


async def test_gravar_monta_o_remetente_e_grava(cliente, token_admin, segredos_resend,
                                               monkeypatch):
    _resend_falso(monkeypatch, teste=VERIFICADO)
    r = await cliente.put(ROTA, headers=_auth(token_admin), json={
        **REMETENTE, "api_key": "re_ok", "unsubscribe_secret": "u" * 32,
        "webhook_secret": "whsec_eA=="})
    assert r.status_code == 200, r.text
    assert r.json()["email_from"] == "Health & Safety <contato@hs.com.br>"
    assert r.json()["aviso"] is None
    assert await integracoes.ler_segredo("EMAIL_FROM") == \
        "Health & Safety <contato@hs.com.br>"
    assert await integracoes.ler_segredo("RESEND_API_KEY") == "re_ok"


async def test_chave_de_envio_grava_com_aviso(cliente, token_admin, segredos_resend,
                                              monkeypatch):
    _resend_falso(monkeypatch, teste={"valida": True, "escopo": "sending_only",
                                      "dominios": []})
    r = await cliente.put(ROTA, headers=_auth(token_admin), json={
        **REMETENTE, "api_key": "re_envio", "unsubscribe_secret": "u" * 32})
    assert r.status_code == 200, r.text
    assert "confira manualmente" in r.json()["aviso"]


async def test_segredo_de_descadastro_e_obrigatorio_na_primeira_vez(
        cliente, token_admin, segredos_resend, monkeypatch):
    """Sem ele o worker não consome a fila (`worker.py:180`) — e o 3C deixou a
    tela sem caminho para gravá-lo."""
    _resend_falso(monkeypatch, teste=VERIFICADO)
    r = await cliente.put(ROTA, headers=_auth(token_admin),
                          json={**REMETENTE, "api_key": "re_ok"})
    assert r.status_code == 400
    assert "descadastro" in r.json()["detail"]


async def test_segredo_de_descadastro_curto_e_recusado(cliente, token_admin,
                                                       segredos_resend, monkeypatch):
    _resend_falso(monkeypatch, teste=VERIFICADO)
    r = await cliente.put(ROTA, headers=_auth(token_admin), json={
        **REMETENTE, "api_key": "re_ok", "unsubscribe_secret": "curto"})
    assert r.status_code == 400
    assert "32" in r.json()["detail"]


async def test_com_segredo_ja_gravado_so_o_remetente_basta(
        cliente, token_admin, segredos_resend, monkeypatch):
    await integracoes.gravar_segredo("UNSUBSCRIBE_SECRET", "u" * 40)
    await integracoes.gravar_segredo("RESEND_API_KEY", "re_ja_gravada")
    _resend_falso(monkeypatch, teste=VERIFICADO)
    r = await cliente.put(ROTA, headers=_auth(token_admin),
                          json={**REMETENTE, "api_key": "", "unsubscribe_secret": ""})
    assert r.status_code == 200, r.text
    assert r.json()["gravados"] == ["email_from"]
    assert await integracoes.ler_segredo("UNSUBSCRIBE_SECRET") == "u" * 40


async def test_webhook_sem_whsec_e_recusado(cliente, token_admin, segredos_resend,
                                            monkeypatch):
    _resend_falso(monkeypatch, teste=VERIFICADO)
    r = await cliente.put(ROTA, headers=_auth(token_admin), json={
        **REMETENTE, "api_key": "re_ok", "unsubscribe_secret": "u" * 32,
        "webhook_secret": "sem-prefixo"})
    assert r.status_code == 400
    assert await integracoes.ler_segredo("RESEND_API_KEY") is None
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_config_resend.py -k gravar or descadastro or whsec or envio or verificado`
Expected: FAIL — o PUT de hoje não conhece `from_name` e grava sem validar.

- [ ] **Passo 3: implementar**

Substitua a classe `ResendIn` e a função `gravar_config_resend` inteiras por:

```python
_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
TAMANHO_MINIMO_DESCADASTRO = 32


class ResendIn(BaseModel):
    # O remetente vem em três partes, como na origem: é o que permite conferir
    # o domínio contra a conta do Resend.
    from_name: str = Field(min_length=1, max_length=100)
    from_prefix: str = Field(min_length=1, max_length=64)
    from_domain: str = Field(min_length=1, max_length=253)
    # Opcionais: a tela manda vazio quando o admin não digitou. Vazio é "não
    # mexi", não "apague".
    api_key: str | None = None
    unsubscribe_secret: str | None = None
    webhook_secret: str | None = None


def _preenchido(valor: str | None) -> str | None:
    return valor.strip() if valor and valor.strip() else None


def _verificado(dominio: dict) -> bool:
    envio_ligado = (dominio.get("capabilities") or {}).get("sending") == "enabled"
    situacao = dominio.get("status") or ""
    return situacao == "verified" or (situacao.startswith("partially_") and envio_ligado)


@router.put("/config/resend")
async def gravar_config_resend(dados: ResendIn,
                               _: str = Depends(admin_ou_maquina("write"))):
    """Grava a configuração, na ordem da origem: TUDO é validado antes de
    qualquer coisa ser gravada.

    ⚠️ O segredo de descadastro é obrigatório — vindo agora OU já gravado. Sem
    ele o worker não consome a fila, e e-mail de campanha sem link de
    descadastro viola a exigência de one-click do Gmail e do Yahoo.
    """
    nome = dados.from_name.strip()
    prefixo = dados.from_prefix.strip()
    dominio = dados.from_domain.strip().lower()
    chave_nova = _preenchido(dados.api_key)
    descadastro = _preenchido(dados.unsubscribe_secret)
    segredo_webhook = _preenchido(dados.webhook_secret)

    # 1. Chave nova é testada antes de qualquer coisa. Sem chave nova, a
    #    gravada serve só para conferir o domínio.
    if chave_nova:
        teste = await cliente_resend.testar_chave(chave_nova)
        if not teste["valida"]:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Chave do Resend inválida ou inacessível ({teste['motivo']}).")
    else:
        gravada = await ler_segredo("RESEND_API_KEY")
        teste = await cliente_resend.testar_chave(gravada) if gravada else None

    # 2. Domínio verificado — só dá para exigir com chave de escopo completo.
    aviso = None
    if teste and teste["valida"] and teste["escopo"] == "full":
        achado = next((d for d in teste["dominios"]
                       if (d.get("name") or "").lower() == dominio), None)
        if achado is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                f'Domínio "{dominio}" não encontrado na conta Resend.')
        if not _verificado(achado):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f'Domínio "{dominio}" não está verificado (status: {achado.get("status")}).')
    else:
        aviso = ("Não foi possível confirmar a verificação do domínio (chave "
                 "somente-envio ou ainda não testada) — confira manualmente em "
                 "resend.com/domains.")

    # 3. O remetente final.
    endereco = f"{prefixo}@{dominio}"
    if not _EMAIL.match(endereco):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Prefixo e domínio formam um endereço de remetente inválido.")
    remetente = f"{nome} <{endereco}>"

    # 4. Os segredos, antes de gravar qualquer um.
    if descadastro is not None and len(descadastro) < TAMANHO_MINIMO_DESCADASTRO:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"O segredo de descadastro precisa de pelo menos "
            f"{TAMANHO_MINIMO_DESCADASTRO} caracteres.")
    if descadastro is None and not await ler_segredo("UNSUBSCRIBE_SECRET"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "O segredo de descadastro é obrigatório. Sem ele os e-mails saem sem "
            "link de descadastro e o worker não envia nada.")
    if segredo_webhook and not segredo_webhook.startswith("whsec_"):
        # A chave do HMAC é o base64 do segredo SEM o prefixo. Sem `whsec_`
        # toda assinatura falharia e os eventos seriam rejeitados em silêncio.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            'O segredo do webhook começa com "whsec_" — é o signing secret que '
            "o Resend mostra ao criar o webhook.")

    # 5. Grava — só depois de tudo validado.
    gravados = []
    for campo, valor in (("api_key", chave_nova), ("unsubscribe_secret", descadastro),
                         ("webhook_secret", segredo_webhook)):
        if valor:
            await gravar_segredo(SEGREDOS_RESEND[campo], valor)
            gravados.append(campo)
    await gravar_segredo("EMAIL_FROM", remetente)
    gravados.append("email_from")

    return {"gravados": gravados, "email_from": remetente, "aviso": aviso}
```

⚠️ A ordem de `gravados` é `api_key, unsubscribe_secret, webhook_secret,
email_from` — o teste `test_com_segredo_ja_gravado_so_o_remetente_basta` depende
dela.

- [ ] **Passo 4: rodar e ver passar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_config_resend.py`
Expected: 18 passed

- [ ] **Passo 5: commit**

```bash
git add backend/app/routers/configuracao.py backend/tests/test_config_resend.py
git commit -m "feat(8A): gravar o Resend valida como a origem — chave, domínio, remetente, descadastro"
```

---

### Tarefa 5: Domínio e rastreamento de abertura e clique

**Arquivos:**
- Modificar: `backend/app/routers/configuracao.py` (acrescenta depois de `gravar_config_resend`)
- Modificar: `backend/tests/test_config_resend.py`

**Interfaces:**
- Consome: `cliente_resend.ler_dominio`, `cliente_resend.alterar_dominio`, `cliente_resend.restrita`, `cliente_resend.FalhaDeRede`.
- Produz:
  - `GET /config/resend/dominios/{dominio_id}` → **sempre 200**: `{"disponivel": True, "open_tracking", "click_tracking", "tracking_subdomain", "status", "records"}` ou `{"disponivel": False, "motivo": str}`. Só 400 se não houver chave.
  - `POST /config/resend/dominios/{dominio_id}/rastreamento` `{"subdominio": "links", "abertura": true, "clique": true}` → `{"sucesso": True, "open_tracking", "click_tracking", "tracking_subdomain", "status", "records"}`. Erros: 400 sem chave ou PATCH recusado; 403 chave sending-only; 401 chave rejeitada; 502 sem rede ou sem confirmação.

- [ ] **Passo 1: escrever os testes que falham**

```python
import httpx

INFO = {"ok": True, "open_tracking": True, "click_tracking": True,
        "tracking_subdomain": "links", "status": "verified",
        "records": [{"record": "Tracking", "name": "links", "type": "CNAME",
                     "value": "links1.resend-dns.com", "status": "pending"}]}


async def test_ler_dominio_sem_chave_da_400(cliente, token_admin, segredos_resend):
    r = await cliente.get(f"{ROTA}/dominios/d1", headers=_auth(token_admin))
    assert r.status_code == 400


async def test_ler_dominio_restrito_e_200_indisponivel(cliente, token_admin,
                                                       segredos_resend, monkeypatch):
    await integracoes.gravar_segredo("RESEND_API_KEY", "re_envio")
    _resend_falso(monkeypatch, dominio={"ok": False, "motivo": "restricted_api_key"})
    r = await cliente.get(f"{ROTA}/dominios/d1", headers=_auth(token_admin))
    assert r.status_code == 200
    assert r.json() == {"disponivel": False, "motivo": "restricted_api_key"}


async def test_ligar_rastreamento_devolve_os_registros_dns(cliente, token_admin,
                                                          segredos_resend, monkeypatch):
    await integracoes.gravar_segredo("RESEND_API_KEY", "re_ok")
    enviado = {}

    async def alterar_dominio(chave, dominio_id, corpo):
        enviado.update(corpo)
        return httpx.Response(200, json={"object": "domain"})

    _resend_falso(monkeypatch, dominio=INFO)
    monkeypatch.setattr(cliente_resend, "alterar_dominio", alterar_dominio)

    r = await cliente.post(f"{ROTA}/dominios/d1/rastreamento",
                           headers=_auth(token_admin), json={})

    assert r.status_code == 200, r.text
    assert enviado == {"open_tracking": True, "click_tracking": True,
                       "tracking_subdomain": "links"}
    assert r.json()["records"][0]["type"] == "CNAME"


async def test_ligar_rastreamento_com_chave_de_envio_da_403(cliente, token_admin,
                                                           segredos_resend, monkeypatch):
    await integracoes.gravar_segredo("RESEND_API_KEY", "re_envio")

    async def alterar_dominio(chave, dominio_id, corpo):
        return httpx.Response(401, json={"name": "restricted_api_key"})

    monkeypatch.setattr(cliente_resend, "alterar_dominio", alterar_dominio)
    r = await cliente.post(f"{ROTA}/dominios/d1/rastreamento",
                           headers=_auth(token_admin), json={})
    assert r.status_code == 403
    assert "somente envio" in r.json()["detail"]


async def test_ligar_rastreamento_recusa_chave_de_api(cliente, chave_de, segredos_resend):
    r = await cliente.post(f"{ROTA}/dominios/d1/rastreamento",
                           headers=_auth(await chave_de("write")), json={})
    assert r.status_code == 401
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_config_resend.py -k dominio or rastreamento`
Expected: FAIL — 404 nas rotas que ainda não existem.

- [ ] **Passo 3: implementar**

Acrescente depois de `gravar_config_resend`:

```python
class RastreamentoIn(BaseModel):
    subdominio: str = Field(default="links", min_length=1, max_length=63,
                            pattern=r"^[a-z0-9-]+$")
    abertura: bool = True
    clique: bool = True


async def _chave_gravada() -> str:
    chave = await ler_segredo("RESEND_API_KEY")
    if not chave:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "RESEND_API_KEY não configurada — salve a chave antes.")
    return chave


def _info_do_dominio(info: dict) -> dict:
    return {k: info[k] for k in ("open_tracking", "click_tracking",
                                 "tracking_subdomain", "status", "records")}


@router.get("/config/resend/dominios/{dominio_id}")
async def ler_dominio_resend(dominio_id: str,
                             _: str = Depends(admin_ou_maquina("read"))):
    """O estado real do rastreamento de um domínio (`domain_info` da origem).

    ⚠️ Chave *sending-only* ou domínio inexistente NÃO é erro: é um estado que
    a tela mostra ("não dá para consultar por aqui"). Responde 200 com
    `disponivel: false`, como a origem.
    """
    info = await cliente_resend.ler_dominio(await _chave_gravada(), dominio_id)
    if not info["ok"]:
        return {"disponivel": False, "motivo": info["motivo"]}
    return {"disponivel": True, **_info_do_dominio(info)}


@router.post("/config/resend/dominios/{dominio_id}/rastreamento")
async def ligar_rastreamento_resend(dominio_id: str, dados: RastreamentoIn,
                                    _: str = Depends(admin_ou_maquina("write"))):
    """Liga open/click tracking no domínio (`enable_tracking` da origem).

    O Resend vem com os dois DESLIGADOS — é por isso que o webhook recebe
    `email.delivered` mas nunca `email.opened`. Ligar exige um CNAME novo no
    DNS, que só quem administra o domínio aplica: a resposta devolve os
    registros para a tela mostrar.
    """
    chave = await _chave_gravada()
    try:
        resposta = await cliente_resend.alterar_dominio(chave, dominio_id, {
            "open_tracking": dados.abertura, "click_tracking": dados.clique,
            "tracking_subdomain": dados.subdominio})
    except cliente_resend.FalhaDeRede:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                            "Não foi possível conectar à API do Resend.")

    if resposta.status_code == 401:
        if cliente_resend.restrita(resposta):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                'A chave configurada é do tipo "somente envio", e o Resend não '
                "permite alterar domínios com ela. Gere uma chave de acesso "
                "completo em resend.com/api-keys, salve-a aqui e tente de novo.")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                            "Chave rejeitada pelo Resend ao ativar o rastreamento.")
    if not resposta.is_success:
        try:
            mensagem = resposta.json().get("message")
        except ValueError:
            mensagem = None
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            mensagem or f"O Resend recusou a alteração (status {resposta.status_code}).")

    info = await cliente_resend.ler_dominio(chave, dominio_id)
    if not info["ok"]:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "O rastreamento foi ativado, mas não deu para confirmar o estado. "
            "Recarregue a página.")
    return {"sucesso": True, **_info_do_dominio(info),
            "tracking_subdomain": info["tracking_subdomain"] or dados.subdominio}
```

- [ ] **Passo 4: rodar e ver passar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_config_resend.py`
Expected: 23 passed

- [ ] **Passo 5: commit**

```bash
git add backend/app/routers/configuracao.py backend/tests/test_config_resend.py
git commit -m "feat(8A): domínio e rastreamento de abertura e clique pela configuração"
```

---

### Tarefa 6: O webhook recusa timestamp não finito

**Arquivos:**
- Modificar: `backend/app/routers/webhook.py:83-85`
- Modificar: `backend/tests/test_webhook.py`

**Interfaces:** nenhuma nova.

- [ ] **Passo 1: escrever o teste que falha**

Acrescente a `backend/tests/test_webhook.py`:

```python
async def test_timestamp_nao_numerico_devolve_401(cliente, segredo):
    """A origem recusava timestamp não finito. `float("nan")` passa pela
    comparação da janela — toda comparação com NaN é falsa, inclusive `> 300`
    — e só a assinatura segurava. A janela anti-replay não pode depender disso."""
    r = await _postar(cliente, segredo, "msg_nan", _corpo("email.opened"), ts="nan")
    assert r.status_code == 401
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_webhook.py -k nao_numerico`
Expected: FAIL — `assert 200 == 401` (a assinatura é calculada com o mesmo `ts="nan"` e bate).

- [ ] **Passo 3: implementar**

Em `backend/app/routers/webhook.py`, acrescente `import math` aos imports e troque:

```python
    try:
        if abs(time.time() - float(ts)) > JANELA_SEGUNDOS:
            return False
```

por:

```python
    try:
        instante = float(ts)
        # ⚠️ `nan` e `inf` passariam: toda comparação com NaN é falsa,
        # inclusive `> JANELA_SEGUNDOS`. A origem recusava não finito.
        if not math.isfinite(instante) or abs(time.time() - instante) > JANELA_SEGUNDOS:
            return False
```

- [ ] **Passo 4: rodar e ver passar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_webhook.py`
Expected: 11 passed

- [ ] **Passo 5: commit**

```bash
git add backend/app/routers/webhook.py backend/tests/test_webhook.py
git commit -m "fix(8A): o webhook recusa timestamp não finito, como a origem"
```

---

### Tarefa 7: A tela restaurada

**Arquivos:**
- Modificar: `frontend/src/lib/config.ts:5-20`
- Reescrever: `frontend/src/components/admin/settings/ResendConfigCard.tsx`

**Interfaces:**
- Consome: as rotas das Tarefas 3, 4 e 5.
- Produz: o card, montado por `pages/admin/SettingsPage.tsx:150` (não muda).

**Referência de comportamento:** `git show 817d15c:frontend/src/components/admin/settings/ResendConfigCard.tsx`
— o card da origem, 938 linhas. O que ele fazia e este card precisa fazer:
testar a chave e mostrar o escopo; escolher o domínio numa lista quando a chave
é completa (e digitar quando é de envio); remetente em nome, prefixo e domínio;
segredo de descadastro com botão **Gerar** (48 caracteres, `crypto.getRandomValues`,
nunca `Math.random`), regra de 32 caracteres e o aviso de que **trocar invalida
os links já enviados**; segredo do webhook; a URL do webhook com botão de copiar;
estado do rastreamento do domínio, botão para ativar com o subdomínio, e a
tabela dos registros DNS pendentes com copiar; e o diagnóstico.

- [ ] **Passo 1: `lib/config.ts`**

Substitua o bloco de `ConfigResend` até `gravarConfigResend` (linhas 5-20) por:

```ts
export interface DominioResend {
  id: string;
  name: string;
  status: string;
  capabilities?: { sending?: string } | null;
}

export interface ConfigResend {
  resend_api_key: { configurado: boolean; ultimos4: string | null;
                    escopo: 'full' | 'sending_only' | null };
  email_from: string | null;
  remetente: { nome: string; prefixo: string; dominio: string } | null;
  unsubscribe_secret: { configurado: boolean };
  webhook_secret: { configurado: boolean };
  dominios: DominioResend[];
  webhook_url: string;
}

export type TesteDeChave =
  | { valida: true; escopo: 'full' | 'sending_only'; dominios: DominioResend[] }
  | { valida: false; motivo: 'invalid_api_key' | 'network' | 'unknown' };

export interface RegistroDns {
  record: string;
  name: string;
  type: string;
  value: string;
  status?: string;
  ttl?: string | number;
}

export interface InfoDominio {
  disponivel: boolean;
  motivo?: string;
  open_tracking?: boolean;
  click_tracking?: boolean;
  tracking_subdomain?: string | null;
  status?: string | null;
  records?: RegistroDns[];
}

export interface DiagnosticoResend {
  ok: boolean;
  faltando: string[];
  segredo_descadastro_faltando: boolean;
  remetente?: string | null;
  dominios?: { name: string; status: string }[];
  erro_api?: string;
}

export const lerConfigResend = () => api.get<ConfigResend>('/config/resend');

export const testarChaveResend = (api_key: string) =>
  api.post<TesteDeChave>('/config/resend/testar', { api_key });

// ⚠️ Campo em branco é "não mexi", não "apague". O servidor ignora vazio —
// apagar a chave por engano pararia todo envio em silêncio.
export const gravarConfigResend = (dados: {
  from_name: string;
  from_prefix: string;
  from_domain: string;
  api_key?: string;
  unsubscribe_secret?: string;
  webhook_secret?: string;
}) => api.put<{ gravados: string[]; email_from: string; aviso: string | null }>(
  '/config/resend', dados);

export const lerDominioResend = (id: string) =>
  api.get<InfoDominio>(`/config/resend/dominios/${encodeURIComponent(id)}`);

export const ligarRastreamentoResend = (id: string, subdominio: string) =>
  api.post<InfoDominio & { sucesso: true }>(
    `/config/resend/dominios/${encodeURIComponent(id)}/rastreamento`, { subdominio });

export const lerDiagnosticoResend = () =>
  api.get<DiagnosticoResend>('/config/resend/diagnostico');
```

Confira que `api.post` existe em `lib/api.ts` com a assinatura
`post<T>(caminho, corpo)`; se o nome for outro, use o que existe — não crie um
segundo cliente.

- [ ] **Passo 2: o card**

Substitua `frontend/src/components/admin/settings/ResendConfigCard.tsx` inteiro por:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CheckCircle2, AlertTriangle, KeyRound, Copy, Wand2, Activity } from 'lucide-react';
import { toast } from 'sonner';
import {
  gravarConfigResend, lerConfigResend, lerDiagnosticoResend, lerDominioResend,
  ligarRastreamentoResend, testarChaveResend,
  type ConfigResend, type DiagnosticoResend, type DominioResend, type InfoDominio,
  type TesteDeChave,
} from '@/lib/config';

// Configuração do Resend pela interface — restaurada por inteiro no lote 8A.
//
// ⚠️ Este card NUNCA recebe um segredo de volta do servidor: só
// `configurado: true/false` e os últimos quatro caracteres da chave.
//
// ⚠️ O 3C tinha tirado domínios, rastreamento e teste de chave, e com eles o
// campo do segredo de descadastro — sem o qual o worker não consome a fila. O
// Erick decidiu em 10/09/2026 restaurar tudo. A referência de comportamento é
// o card original: `git show 817d15c:<este arquivo>`.

const MINIMO_DESCADASTRO = 32;

// crypto.getRandomValues, NUNCA Math.random: Math.random não é criptográfico, e
// este segredo assina todo link de descadastro.
function gerarSegredo(tamanho = 48): string {
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(tamanho);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join('');
}

async function copiar(texto: string) {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success('Copiado');
  } catch {
    toast.error('Erro ao copiar');
  }
}

export default function ResendConfigCard() {
  const [config, setConfig] = useState<ConfigResend | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const [apiKey, setApiKey] = useState('');
  const [teste, setTeste] = useState<TesteDeChave | null>(null);
  const [testando, setTestando] = useState(false);

  const [nome, setNome] = useState('');
  const [prefixo, setPrefixo] = useState('');
  const [dominio, setDominio] = useState('');

  const [descadastro, setDescadastro] = useState('');
  const [segredoWebhook, setSegredoWebhook] = useState('');

  const [info, setInfo] = useState<InfoDominio | null>(null);
  const [lendoInfo, setLendoInfo] = useState(false);
  const [subdominio, setSubdominio] = useState('links');
  const [ativando, setAtivando] = useState(false);

  const [diagnostico, setDiagnostico] = useState<DiagnosticoResend | null>(null);
  const [diagnosticando, setDiagnosticando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const c = await lerConfigResend();
      setConfig(c);
      if (c.remetente) {
        setNome(c.remetente.nome);
        setPrefixo(c.remetente.prefixo);
        setDominio(c.remetente.dominio);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao carregar a configuração');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // O escopo e os domínios vêm do teste da chave nova, se houve; senão, da
  // chave gravada.
  const escopo = teste?.valida ? teste.escopo : config?.resend_api_key.escopo ?? null;
  const dominios: DominioResend[] = teste?.valida ? teste.dominios : config?.dominios ?? [];
  const dominioEscolhido = useMemo(
    () => dominios.find((d) => d.name.toLowerCase() === dominio.trim().toLowerCase()),
    [dominios, dominio]);

  // O estado REAL do rastreamento, só com chave completa e domínio da lista.
  useEffect(() => {
    if (escopo !== 'full' || !dominioEscolhido?.id || !config?.resend_api_key.configurado) {
      setInfo(null);
      return;
    }
    let cancelado = false;
    setLendoInfo(true);
    lerDominioResend(dominioEscolhido.id)
      .then((i) => {
        if (cancelado) return;
        setInfo(i);
        // O subdomínio já configurado vence: digitar outro reconfiguraria o
        // CNAME à toa.
        if (i.tracking_subdomain) setSubdominio(i.tracking_subdomain);
      })
      .catch(() => { if (!cancelado) setInfo({ disponivel: false, motivo: 'network' }); })
      .finally(() => { if (!cancelado) setLendoInfo(false); });
    return () => { cancelado = true; };
  }, [escopo, dominioEscolhido?.id, config?.resend_api_key.configurado]);

  const testar = async () => {
    if (!apiKey.trim()) return;
    setTestando(true);
    try {
      const r = await testarChaveResend(apiKey.trim());
      setTeste(r);
      if (r.valida && r.escopo === 'full' && r.dominios.length > 0 && !dominio) {
        setDominio(r.dominios[0].name);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao testar a chave');
    } finally {
      setTestando(false);
    }
  };

  const descadastroConfigurado = !!config?.unsubscribe_secret.configurado;
  const descadastroOk = descadastroConfigurado
    ? descadastro.length === 0 || descadastro.length >= MINIMO_DESCADASTRO
    : descadastro.length >= MINIMO_DESCADASTRO;

  const salvar = async () => {
    setSalvando(true);
    try {
      const r = await gravarConfigResend({
        from_name: nome.trim(),
        from_prefix: prefixo.trim(),
        from_domain: dominio.trim(),
        api_key: apiKey,
        unsubscribe_secret: descadastro,
        webhook_secret: segredoWebhook,
      });
      toast.success(`Configuração salva — remetente: ${r.email_from}`);
      if (r.aviso) toast.warning(r.aviso);
      setApiKey('');
      setDescadastro('');
      setSegredoWebhook('');
      setTeste(null);
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  };

  const ativarRastreamento = async () => {
    if (!dominioEscolhido?.id) return;
    setAtivando(true);
    try {
      const r = await ligarRastreamentoResend(dominioEscolhido.id, subdominio.trim() || 'links');
      setInfo({ ...r, disponivel: true });
      toast.success('Rastreamento ativado no Resend. Falta adicionar o registro DNS abaixo.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao ativar o rastreamento');
    } finally {
      setAtivando(false);
    }
  };

  const diagnosticar = async () => {
    setDiagnosticando(true);
    try {
      setDiagnostico(await lerDiagnosticoResend());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro no diagnóstico');
    } finally {
      setDiagnosticando(false);
    }
  };

  const selo = (ok: boolean) =>
    ok ? <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" /> configurado</Badge>
       : <Badge variant="outline">não configurado</Badge>;

  if (carregando) {
    return (
      <Card>
        <CardContent className="py-10 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const rastreamentoPendente = info?.disponivel
    && (info.open_tracking || info.click_tracking)
    && (info.records ?? []).some((r) => (r.status ?? '').toLowerCase() !== 'verified');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4" /> Resend
        </CardTitle>
        <CardDescription>
          O serviço que entrega os e-mails de campanha. Os segredos ficam no
          banco, nunca no repositório — e nunca voltam para esta tela.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Estado */}
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-muted-foreground">Chave da API</span>
            {selo(!!config?.resend_api_key.configurado)}
            {config?.resend_api_key.ultimos4 && (
              <code className="text-xs text-muted-foreground">…{config.resend_api_key.ultimos4}</code>
            )}
            {escopo === 'full' && <Badge variant="secondary">acesso completo</Badge>}
            {escopo === 'sending_only' && <Badge variant="outline">somente envio</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-muted-foreground">Segredo de descadastro</span>
            {selo(descadastroConfigurado)}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-muted-foreground">Segredo do webhook</span>
            {selo(!!config?.webhook_secret.configurado)}
          </div>
        </div>

        {(!config?.resend_api_key.configurado || !descadastroConfigurado) && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Sem a chave da API <strong>e</strong> o segredo de descadastro, o
              worker <strong>não consome a fila</strong> — de propósito. Campanha
              enfileirada fica esperando; nada é perdido e nada é enviado.
            </AlertDescription>
          </Alert>
        )}

        {/* Chave */}
        <div className="space-y-2">
          <Label htmlFor="resend-key">Chave da API</Label>
          <div className="flex gap-2">
            <Input
              id="resend-key" type="password" autoComplete="off"
              placeholder={config?.resend_api_key.configurado ? 'deixe em branco para manter' : 're_...'}
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setTeste(null); }}
            />
            <Button variant="outline" onClick={testar} disabled={testando || !apiKey.trim()}>
              {testando ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Testar chave'}
            </Button>
          </div>
          {teste?.valida && teste.escopo === 'full' && (
            <p className="text-xs text-green-600">Chave válida, acesso completo — {teste.dominios.length} domínio(s) na conta.</p>
          )}
          {teste?.valida && teste.escopo === 'sending_only' && (
            <p className="text-xs text-amber-600">
              Chave válida, <strong>somente envio</strong>: ela não lista domínios nem liga o
              rastreamento. Digite o domínio à mão e confira a verificação em resend.com/domains.
            </p>
          )}
          {teste && !teste.valida && (
            <p className="text-xs text-destructive">
              {teste.motivo === 'network' ? 'Não foi possível falar com o Resend.' : 'Chave inválida.'}
            </p>
          )}
        </div>

        {/* Remetente */}
        <div className="space-y-2">
          <Label>Remetente</Label>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
            <Input placeholder="Nome (ex: Health & Safety)" value={nome}
                   onChange={(e) => setNome(e.target.value)} />
            <span className="hidden sm:inline text-muted-foreground">&lt;</span>
            <Input placeholder="prefixo (ex: contato)" value={prefixo}
                   onChange={(e) => setPrefixo(e.target.value)} />
            <span className="hidden sm:inline text-muted-foreground">@</span>
            {escopo === 'full' && dominios.length > 0 ? (
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={dominioEscolhido?.name ?? ''}
                onChange={(e) => setDominio(e.target.value)}
              >
                <option value="" disabled>escolha o domínio</option>
                {dominios.map((d) => (
                  <option key={d.id} value={d.name}>{d.name} — {d.status}</option>
                ))}
              </select>
            ) : (
              <Input placeholder="dominio.com.br" value={dominio}
                     onChange={(e) => setDominio(e.target.value)} />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Com chave de acesso completo, o domínio precisa estar verificado na conta do Resend.
          </p>
        </div>

        {/* Segredo de descadastro */}
        <div className="space-y-2">
          <Label htmlFor="resend-descadastro">Segredo de descadastro</Label>
          <div className="flex gap-2">
            <Input
              id="resend-descadastro" type="password" autoComplete="off"
              placeholder={descadastroConfigurado ? 'configurado — digite só para trocar'
                                                  : `gere ou cole um valor com ${MINIMO_DESCADASTRO}+ caracteres`}
              value={descadastro}
              onChange={(e) => setDescadastro(e.target.value)}
            />
            <Button variant="outline" className="gap-1" onClick={() => setDescadastro(gerarSegredo(48))}>
              <Wand2 className="h-3.5 w-3.5" /> Gerar
            </Button>
          </div>
          {descadastro.length > 0 && descadastro.length < MINIMO_DESCADASTRO && (
            <p className="text-xs text-destructive">Precisa de pelo menos {MINIMO_DESCADASTRO} caracteres.</p>
          )}
          {descadastroConfigurado && descadastro.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Trocar este segredo <strong>invalida todos os links de descadastro já enviados</strong> —
                quem clicar num e-mail antigo vai receber erro em vez de sair da lista.
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Webhook */}
        <div className="space-y-2">
          <Label htmlFor="resend-webhook">Segredo do webhook</Label>
          <Input
            id="resend-webhook" type="password" autoComplete="off"
            placeholder={config?.webhook_secret.configurado ? 'deixe em branco para manter' : 'whsec_...'}
            value={segredoWebhook}
            onChange={(e) => setSegredoWebhook(e.target.value)}
          />
          {config?.webhook_url && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">URL para cadastrar no Resend:</span>
              <code className="truncate">{config.webhook_url}</code>
              <Button size="icon" variant="ghost" className="h-6 w-6"
                      onClick={() => copiar(config.webhook_url)}>
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>

        <Button onClick={salvar}
                disabled={salvando || !nome.trim() || !prefixo.trim() || !dominio.trim() || !descadastroOk}
                className="gap-2">
          {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
          Salvar
        </Button>

        {/* Rastreamento */}
        {escopo === 'full' && dominioEscolhido && (
          <div className="space-y-3 border-t pt-4">
            <h4 className="text-sm font-medium">Rastreamento de abertura e clique</h4>
            {lendoInfo && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {info && !info.disponivel && (
              <p className="text-xs text-muted-foreground">
                Não foi possível consultar o domínio por aqui ({info.motivo}).
              </p>
            )}
            {info?.disponivel && !(info.open_tracking || info.click_tracking) && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Desligado neste domínio — por isso aberturas e cliques não voltam pelo webhook.
                </p>
                <div className="flex gap-2 items-center">
                  <Input className="w-40" value={subdominio}
                         onChange={(e) => setSubdominio(e.target.value)} />
                  <span className="text-xs text-muted-foreground">.{dominioEscolhido.name}</span>
                  <Button variant="outline" onClick={ativarRastreamento} disabled={ativando}>
                    {ativando ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Ativar rastreamento'}
                  </Button>
                </div>
              </div>
            )}
            {info?.disponivel && (info.open_tracking || info.click_tracking) && (
              <p className="text-xs">
                Abertura: <strong>{info.open_tracking ? 'ligada' : 'desligada'}</strong> ·
                Clique: <strong>{info.click_tracking ? 'ligado' : 'desligado'}</strong>
              </p>
            )}
            {rastreamentoPendente && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Ligado na conta, mas o registro DNS abaixo ainda não foi verificado.
                  Até ele existir, nenhuma abertura chega — e nada avisa.
                </AlertDescription>
              </Alert>
            )}
            {info?.disponivel && (info.records ?? []).length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="pr-2">Tipo</th><th className="pr-2">Nome</th>
                      <th className="pr-2">Valor</th><th className="pr-2">Status</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {(info.records ?? []).map((r) => (
                      <tr key={`${r.type}-${r.name}`}>
                        <td className="pr-2">{r.type}</td>
                        <td className="pr-2 font-mono">{r.name}</td>
                        <td className="pr-2 font-mono break-all">{r.value}</td>
                        <td className="pr-2">{r.status ?? '—'}</td>
                        <td>
                          <Button size="icon" variant="ghost" className="h-6 w-6"
                                  onClick={() => copiar(r.value)}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Diagnóstico */}
        <div className="space-y-2 border-t pt-4">
          <Button variant="outline" className="gap-2" onClick={diagnosticar} disabled={diagnosticando}>
            {diagnosticando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
            Verificar conexão
          </Button>
          {diagnostico && (
            <div className="text-xs space-y-1">
              {diagnostico.ok
                ? <p className="text-green-600">Conectado. Remetente: {diagnostico.remetente}</p>
                : <p className="text-destructive">
                    {diagnostico.erro_api ?? `Faltando: ${diagnostico.faltando.join(', ')}`}
                  </p>}
              {diagnostico.segredo_descadastro_faltando && (
                <p className="text-amber-600">
                  Sem segredo de descadastro: o worker não envia nada.
                </p>
              )}
              {(diagnostico.dominios ?? []).map((d) => (
                <p key={d.name}>{d.name} — {d.status}</p>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Passo 3: tipagem e build**

Run: `cd frontend && npx tsc --noEmit && npx vite build`
Expected: sem erro. (`toast.warning` existe no `sonner`; se o `tsc` acusar, use
`toast.message`.)

- [ ] **Passo 4: commit**

```bash
git add frontend/src/lib/config.ts frontend/src/components/admin/settings/ResendConfigCard.tsx
git commit -m "feat(8A): o card do Resend volta a fazer o que fazia — e grava o segredo de descadastro"
```

---

### Tarefa 8: O portão

**Arquivos:**
- Apagar: `backend/supabase/functions/resend-config`, `resend-config-check`, `resend-webhook`
- Modificar: `docs/CONTINUAR-AQUI.md`

- [ ] **Passo 1: ninguém chama as três**

```bash
grep -rn "resend-config\|resend-config-check\|resend-webhook" frontend/src frontend/public backend/app
```

Expected: nenhuma **chamada**. Comentário "era a function X" e `id` de input
(`resend-webhook` é o `htmlFor` do campo do segredo do webhook) não contam —
confira um a um.

- [ ] **Passo 2: a suíte e os builds**

```bash
cd backend && ./.venv/bin/pytest -q          # ⚠️ timeout ≥600s — nunca mate no meio
cd ../frontend && npx tsc --noEmit && npx vite build
```

Expected: 160 + 10 (cliente) + 23 (config) + 1 (webhook) = **194 passed**.

- [ ] **Passo 3: a tela, no navegador**

Suba o backend (`--host 127.0.0.1 --port 8100`) e o Vite (`--host 127.0.0.1
--port 8080`), entre com a conta de trabalho do Claude
(`~/.config/marketinghs/claude-admin.env`) e abra Configurações. Confira,
clicando:

- [ ] o card carrega, com os três selos e o aviso da fila parada
- [ ] "Testar chave" com `re_invalida` responde "Chave inválida" (esta chamada vai ao Resend de verdade — é inofensiva)
- [ ] "Gerar" preenche 48 caracteres; apagar até 31 mostra o erro de tamanho
- [ ] a URL do webhook aparece e o botão copia
- [ ] "Verificar conexão" lista o que falta
- [ ] "Salvar" sem domínio fica desabilitado; com os campos e sem chave, o servidor devolve o erro do segredo de descadastro legível

⚠️ **Não grave segredo de verdade pela tela sem o Erick pedir.** O banco é o de
produção: um `UNSUBSCRIBE_SECRET` gravado agora passa a assinar os links reais.
O portão confere os caminhos de erro e o diagnóstico; o caminho feliz é provado
pelos testes das Tarefas 4 e 5. Se o Erick fornecer a chave do Resend, aí sim
se confere o fluxo completo.

- [ ] **Passo 4: a capacidade, contra a origem**

Abra `backend/supabase/functions/resend-config/index.ts` e marque, item a item,
onde cada capacidade vive agora: GET com escopo/domínios/`webhook_url`;
`action: test`; `action: save` (chave re-testada, domínio na conta e
verificado, remetente montado e validado, descadastro obrigatório e ≥32,
`whsec_`); `enable_tracking`; `domain_info`; autorização dupla. Idem para
`resend-config-check`. **Qualquer item sem lugar para o `git rm`.**

- [ ] **Passo 5: só então, apagar**

```bash
git rm -r backend/supabase/functions/resend-config \
          backend/supabase/functions/resend-config-check \
          backend/supabase/functions/resend-webhook
```

- [ ] **Passo 6: o CONTINUAR-AQUI**

Acrescente a seção do 8A ao topo de `docs/CONTINUAR-AQUI.md`: placar **39
portadas, 7 descartadas, restam 8**; o defeito do segredo de descadastro e que
ele está consertado; as cinco decisões deste plano; e que o fluxo com chave de
verdade continua sem conferência ao vivo até o Erick fornecer a chave.

- [ ] **Passo 7: commit**

```bash
git add -A backend/supabase/functions docs/CONTINUAR-AQUI.md
git commit -m "chore(8A): o portão fecha — as três functions do Resend saem

Placar da pasta de especificação: 39 portadas, 7 descartadas, restam 8."
```

---

## Autorrevisão deste plano

**Cobertura, contra a comparação de 10/09/2026.** `resend-config`: auth dupla →
T2; GET escopo/domínios/`webhook_url` → T3; `test` → T3; `save` inteiro → T4;
`enable_tracking` e `domain_info` → T5. `resend-config-check` → T3.
`resend-webhook`: completo; o `nan` → T6; o 500 transacional → decisão 5. O
defeito do segredo de descadastro → T4 (servidor) e T7 (tela). As capacidades
que o card perdeu (teste de chave, escopo, lista de domínios, remetente em
partes, rastreamento, registros DNS, `webhook_url` com copiar, segredo com
Gerar e aviso) → T7.

**Sem placeholders.** Todo passo de código tem código. O único ponto de
verificação no ambiente é o nome de `api.post` em `lib/api.ts`, que a Tarefa 7
manda conferir.

**Consistência de tipos.** `testar_chave` devolve `valida/escopo/dominios` ou
`valida/motivo` (T1) e é consumida assim em T3 e T4 e no tipo `TesteDeChave`
(T7). `ler_dominio` devolve `ok/...` (T1); as rotas traduzem para `disponivel`
(T5) e a tela lê `disponivel` (T7). `partes_do_remetente` produz
`nome/prefixo/dominio` (T3), que é o `remetente` do tipo `ConfigResend` (T7).

**O que este plano assume e pode estar errado:** que `request.url_for("resend_webhook")`
monta a URL certa atrás do proxy do Vite (em desenvolvimento ele entrega
`http://localhost:8100/...`, que é o correto para o backend; em produção depende
dos cabeçalhos do nginx — item 11 da lista do Erick). E que a forma do corpo de
erro do Resend (`name: "restricted_api_key"`) segue a da documentação citada na
origem.
