# MarketingHS — Lote 1D: A porta pública — Plano

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — `superpowers:subagent-driven-development`
> ou `superpowers:executing-plans`. Os passos usam caixa (`- [ ]`).

**Objetivo:** o segundo modelo de autenticação — chave de API — e os endpoints
que sistemas externos usam para ler e escrever contatos.

**Arquitetura:** uma dependência FastAPI que valida chave de API por hash, com
escopo e expiração, mais os endpoints de ingestão e leitura pública que a usam.

**Stack:** FastAPI, asyncpg, pytest · React 18, Vite

**Spec:** `docs/superpowers/specs/2026-08-31-marketinghs-design.md`
**Lotes anteriores:** `…-lote-0`, `…-1a-entrada`, `…-1b-leitura`, `…-1c-escrita`

---

## Por que este lote deixou de ser "identidade e captura"

O anúncio original do 1D era `lead-capture`, `identity-lookup`,
`identity-upsert`, `receive-contact-event`, `merge-identities` e
`validate-email-domain`. A investigação derrubou esse recorte por dois motivos.

### A captura não tem chamador

**As landing pages foram apagadas no lote 0.** Com elas foi todo consumidor da
cadeia de captura. Verificado:

| Módulo | Quem importa |
|---|---|
| `lib/leadCapture.ts` | só `lib/resolveIdentity.ts` |
| `lib/resolveIdentity.ts` | **ninguém** |
| `lib/leadConversion.ts` | **ninguém** |
| `lib/metaCapi.ts`, `lib/metaTracking.ts` | **ninguém** |

Os três lugares onde `lead-capture` e `identity-upsert` "aparecem" no frontend
são **strings de documentação** — URLs mostradas na tela para sistemas externos
saberem onde postar.

Portar `lead-capture` agora seria construir o substituto sem consumidor: o
placar subiria e nada funcionaria a mais. É exatamente a falha que este projeto
inteiro existe para evitar. **`lead-capture` e `validate-email-domain` vão para
o lote 7**, junto com a landing page que os chama.

### Metade do que resta está bloqueada numa peça só

Das 46 functions ainda na pasta de especificação, **23 usam `validateAuth`** —
a autenticação por chave de API. Enquanto ela não existir, nenhuma delas pode
ser portada:

```
analytics-api · automations-api · campaigns-api · contact-details ·
contacts-list · contact-status-update · contact-tags-sync · contact-update ·
email-unsubscribe · identity-lookup · identity-upsert · journeys-api ·
pages-api · receive-contact-event · register-conversion · resend-config ·
resend-config-check · segments-api · send-campaign · send-test-email ·
templates-api · unregister-conversion · update-conversion
```

Eu havia empurrado isso para um "lote 1E" no fim. Estava errado: é
infraestrutura, e infraestrutura que trava metade do trabalho vem antes.

### E existe uma tela para conferir

`components/admin/settings/ApiKeysManagement.tsx` (423 linhas, 3 pontos de
acesso direto) cria, lista e revoga chaves. Ela é o consumidor que torna este
lote verificável no navegador, e não só por contrato de API.

---

## O que você precisa saber antes de começar

### A chave é gerada com `Math.random()`

```js
function generateApiKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = 'dnk_';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  ...
```

Trinta e dois caracteres de um alfabeto de 36 parecem muita entropia, e não são:
`Math.random()` no V8 é um **xorshift128+**, gerador não-criptográfico com
estado interno recuperável a partir de algumas saídas observadas. Quem receber
duas ou três chaves consegue prever as seguintes.

Uma chave de API dá acesso de leitura ou escrita à base inteira de contatos.

**Neste lote a chave passa a ser gerada no servidor, com `secrets.token_urlsafe`.**
Isso muda o desenho: hoje o navegador gera a chave, calcula o SHA-256 e manda só
o hash — o servidor nunca vê a chave. Passando a gerar no servidor, ela volta na
resposta **uma única vez** e nunca mais. É o padrão de toda API de chave, e o
motivo é este: ninguém consegue garantir a qualidade de um segredo que não gerou.

O prefixo `dnk_` também sai. Vira `mhs_`.

### O modelo de autenticação, como a origem o desenhou

`_shared/auth.ts` aceita **duas** credenciais no mesmo header `Authorization: Bearer`:

1. O `WEBHOOK_SECRET` — um segredo global, sem escopo nem expiração
2. Uma chave da tabela `api_keys`, buscada pelo **SHA-256 do token**

E aplica escopo: `permissions` é `'read'`, `'write'` ou `'read_write'`, e a
função recusa se a permissão exigida não bater. Também desativa a chave quando
`expires_at` passou, e atualiza `last_used_at` sem esperar o resultado.

⚠️ **O `last_used_at` era gravado sem `await`.** Numa Edge Function isso pode
simplesmente não acontecer — o processo termina antes. Em Python é pior: uma
corrotina não aguardada vira aviso e nunca roda. Grave de verdade, mas fora do
caminho crítico da resposta.

⚠️ **Comparação de hash em tempo constante.** A origem usa `.eq('key_hash', …)`
no banco, o que é uma busca por índice e não vaza tempo de forma útil. Se você
comparar em Python, use `hmac.compare_digest`.

---

## Restrições globais

- **`sessao()` é o único caminho para dado.**
- **A chave de API NÃO é sessão de usuário.** Endpoint autenticado por chave não
  tem `usuario_atual`, e não deve fingir que tem.
- **Escopo é obrigatório:** toda rota declara se exige `read` ou `write`.
- **O portão tem TRÊS partes** (ver `CLAUDE.md`).
- **Backend na porta 8100 no host.**
- **Comentário e nome de módulo em português.**

---

## Tarefa 1: A dependência de chave de API

**Arquivos:**
- Cria: `backend/app/chave_api.py`, `backend/tests/test_chave_api.py`

**Interfaces:**
- Produz: `chave_api(permissao: str)` — fábrica de dependência FastAPI que
  devolve `ChaveApi(id, nome, permissoes)`; `gerar_chave() -> tuple[str, str, str]`
  devolvendo (chave_crua, hash, prefixo)

- [ ] **Passo 1: escrever o teste que falha**

`backend/tests/test_chave_api.py`:

```python
"""A geração e o hash da chave de API.

Testado porque são funções puras e porque o erro é invisível: uma chave com
entropia fraca funciona exatamente como uma forte, até alguém adivinhar a
próxima.
"""
import hashlib

import pytest

from app.chave_api import PREFIXO, gerar_chave, hash_da_chave


def test_a_chave_tem_prefixo_do_sistema():
    crua, _, prefixo = gerar_chave()
    assert crua.startswith(PREFIXO)
    assert prefixo == crua[:12]


def test_o_hash_e_sha256_do_texto_da_chave():
    crua, digest, _ = gerar_chave()
    assert digest == hashlib.sha256(crua.encode()).hexdigest()
    assert len(digest) == 64


def test_duas_chaves_nunca_se_repetem():
    chaves = {gerar_chave()[0] for _ in range(500)}
    assert len(chaves) == 500


def test_a_chave_tem_entropia_de_segredo_de_verdade():
    # 32 bytes de os.urandom em base64url. O teste não prova aleatoriedade —
    # isso nenhum teste prova — mas trava o tamanho, que é o que alguém
    # reduziria sem perceber ao "simplificar".
    crua, _, _ = gerar_chave()
    corpo = crua[len(PREFIXO):]
    assert len(corpo) >= 40


def test_hash_da_chave_e_estavel():
    assert hash_da_chave("mhs_abc") == hash_da_chave("mhs_abc")
    assert hash_da_chave("mhs_abc") != hash_da_chave("mhs_abd")
```

- [ ] **Passo 2: rodar e ver falhar** — `ModuleNotFoundError: app.chave_api`

- [ ] **Passo 3: `backend/app/chave_api.py`**

```python
"""Autenticação por chave de API — o segundo modelo, para chamador máquina.

Não confundir com `app/dependencies.py`, que autentica USUÁRIO por JWT. Aqui é
sistema externo falando com o nosso: sem sessão, sem papel, com escopo próprio.
"""

import hashlib
import hmac
import logging
import secrets

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings
from app.database import sessao

logger = logging.getLogger(__name__)

# `mhs_` e não `dnk_`: o prefixo identifica o sistema a quem lê a chave num log
# ou num painel de terceiro, e o `dnk_` é da dn.ia.
PREFIXO = "mhs_"

_bearer = HTTPBearer(auto_error=False)


def hash_da_chave(crua: str) -> str:
    return hashlib.sha256(crua.encode("utf-8")).hexdigest()


def gerar_chave() -> tuple[str, str, str]:
    """Devolve (chave_crua, hash, prefixo_visivel).

    ⚠️ `secrets`, nunca `random`. A tela original gerava a chave no navegador
    com Math.random() — xorshift128+, cujo estado se recupera a partir de
    algumas saídas. Quem recebesse duas ou três chaves preveria as seguintes, e
    uma chave dá acesso de leitura ou escrita à base inteira de contatos.

    A chave crua existe UMA vez, aqui. O banco guarda só o hash; o prefixo
    serve para a pessoa reconhecer qual chave é qual na tela.
    """
    crua = PREFIXO + secrets.token_urlsafe(32)
    return crua, hash_da_chave(crua), crua[:12]


class ChaveApi:
    def __init__(self, id: str, nome: str, permissoes: str):
        self.id = id
        self.nome = nome
        self.permissoes = permissoes

    def __repr__(self) -> str:
        return f"ChaveApi({self.nome}, {self.permissoes})"


def chave_api(permissao: str):
    """Fábrica de dependência: `Depends(chave_api('write'))`.

    Aceita duas credenciais no mesmo header, como a origem:
      - o WEBHOOK_SECRET, segredo global sem escopo nem expiração
      - uma chave da tabela api_keys, buscada pelo SHA-256 do token
    """
    if permissao not in ("read", "write"):
        raise ValueError(f"permissão inválida: {permissao!r}")

    async def dependencia(
        cred: HTTPAuthorizationCredentials | None = Depends(_bearer),
    ) -> ChaveApi:
        if cred is None:
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED, "Chave de API necessária.",
                headers={"WWW-Authenticate": "Bearer"})

        token = cred.credentials

        # O segredo global. compare_digest e não `==`: comparação de string em
        # Python sai no primeiro byte diferente, e isso é medível.
        if settings.WEBHOOK_SECRET and hmac.compare_digest(token, settings.WEBHOOK_SECRET):
            return ChaveApi(id="webhook", nome="webhook", permissoes="read_write")

        digest = hash_da_chave(token)
        async with sessao(role="service_role") as conn:
            linha = await conn.fetchrow(
                """SELECT id::text, name, permissions, expires_at, is_active
                     FROM api_keys WHERE key_hash = $1""", digest)

        if linha is None or not linha["is_active"]:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Chave inválida.")

        if linha["expires_at"] is not None:
            from datetime import datetime, timezone
            if linha["expires_at"] < datetime.now(timezone.utc):
                # A origem desativava a chave ao encontrá-la vencida. Mantido:
                # uma chave vencida não volta a valer, e desativar evita
                # reconsultar a data em toda requisição futura.
                async with sessao(role="service_role") as conn:
                    await conn.execute(
                        "UPDATE api_keys SET is_active = false WHERE id = $1::uuid",
                        linha["id"])
                raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Chave expirada.")

        permissoes = linha["permissions"]
        if permissoes != "read_write" and permissoes != permissao:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Esta chave tem permissão de {permissoes!r} e a operação exige {permissao!r}.")

        # ⚠️ Com await. A origem gravava sem esperar, e numa Edge Function isso
        # pode simplesmente não acontecer — o processo termina antes. Em Python
        # uma corrotina não aguardada vira aviso e nunca roda.
        async with sessao(role="service_role") as conn:
            await conn.execute(
                "UPDATE api_keys SET last_used_at = now() WHERE id = $1::uuid", linha["id"])

        return ChaveApi(id=linha["id"], nome=linha["name"], permissoes=permissoes)

    return dependencia
```

⚠️ **`WEBHOOK_SECRET` precisa ser declarado em `Settings`** (`app/config.py`).
O pydantic-settings recusa chave desconhecida no `.env` e derruba o boot — isso
já derrubou o HS.OS duas vezes.

- [ ] **Passo 4: rodar e ver passar** — 5 testes

- [ ] **Passo 5: commit**

---

## Tarefa 2: A tela de chaves

**Arquivos:**
- Cria: `backend/app/routers/chaves.py`
- Modifica: `frontend/src/components/admin/settings/ApiKeysManagement.tsx`

**Interfaces:**
- Produz: `GET /chaves`, `POST /chaves` (devolve a chave crua **uma vez**),
  `PATCH /chaves/{id}` (ativar/desativar), `DELETE /chaves/{id}`

- [ ] **Passo 1: os endpoints**

```python
"""Administração das chaves de API. Toda rota exige admin: quem cria chave cria
acesso à base inteira de contatos."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.chave_api import gerar_chave
from app.database import sessao
from app.dependencies import Usuario, admin_atual

router = APIRouter(prefix="/chaves", tags=["chaves"])


class ChaveIn(BaseModel):
    nome: str = Field(min_length=1, max_length=100)
    descricao: str | None = None
    permissoes: str = Field(default="read", pattern="^(read|write|read_write)$")
    expira_em: datetime | None = None


class ChaveOut(BaseModel):
    id: str
    name: str
    key_prefix: str
    permissions: str
    expires_at: str | None
    is_active: bool
    created_at: str


class ChaveCriadaOut(ChaveOut):
    # ⚠️ Só existe na resposta da criação. Nunca é lida de volta do banco,
    # porque o banco guarda apenas o hash.
    chave: str


@router.post("", response_model=ChaveCriadaOut, status_code=status.HTTP_201_CREATED)
async def criar_chave(dados: ChaveIn, _: Usuario = Depends(admin_atual)):
    """Cria uma chave. A chave crua volta AQUI e nunca mais.

    ⚠️ Quem gera é o servidor. A tela original gerava no navegador com
    Math.random() e mandava só o hash — o servidor nunca via a chave e portanto
    não podia garantir nada sobre ela. Ninguém garante a qualidade de um
    segredo que não gerou.
    """
    crua, digest, prefixo = gerar_chave()
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            """INSERT INTO api_keys (name, description, key_hash, key_prefix,
                                     permissions, expires_at)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING id::text, name, key_prefix, permissions,
                         expires_at::text, is_active, created_at::text""",
            dados.nome.strip(), dados.descricao, digest, prefixo,
            dados.permissoes, dados.expira_em)
    # `chave` só aparece nesta resposta. Deixe isso explícito na tela.
    return ChaveCriadaOut(**dict(linha), chave=crua)
```

⚠️ **Criar chave exige `admin_atual`** — é uma tela de administração, e quem
cria chave de API cria acesso à base inteira.

- [ ] **Passo 2: a tela.** Troque os 3 pontos. `generateApiKey` e
  `generateKeyHash` **saem do arquivo** — a chave agora vem do servidor. A tela
  passa a exibir `resposta.chave` no diálogo de "copie agora, não será mostrada
  de novo".

- [ ] **Passo 3: conferir no navegador** — crie uma chave, copie, e confirme
  que ela **não** aparece na listagem depois (só o prefixo).

- [ ] **Passo 4: commit**

---

## Tarefa 3: A ingestão de identidade e evento

**Interfaces:**
- Produz: `GET /publico/identidade`, `POST /publico/identidade`,
  `POST /publico/evento-de-contato`

Estes são os endpoints que **outros sistemas** chamam. Vão sob o prefixo
`/publico`, que o limite de taxa do lote 0 já cobre.

- [ ] **Passo 1: ler as três functions inteiras antes de escrever**

```bash
cat backend/supabase/functions/identity-lookup/index.ts
cat backend/supabase/functions/identity-upsert/index.ts
cat backend/supabase/functions/receive-contact-event/index.ts
```

⚠️ O CLAUDE.md herdado avisa: `identity-upsert` e `receive-contact-event`
**criam lead automaticamente** quando a identidade não tem `dndash_lead_id`, e
enriquecem os campos de qualificação **de forma não destrutiva — só preenchem
o que está vazio, nunca sobrescrevem**. Essa é a mesma regra da importação do
lote 1A, e pelo mesmo motivo. Confirme lendo, e reaproveite
`campos_para_gravar` de `app/dominio/importacao.py` se o formato bater.

- [ ] **Passo 2: os endpoints**, cada um declarando o escopo:
  `Depends(chave_api('read'))` para o lookup, `'write'` para os outros.

- [ ] **Passo 3: conferir por contrato**, com uma chave real criada na tarefa 2:

```bash
CHAVE=...   # a que você copiou da tela
curl -s "localhost:8100/publico/identidade?email=carla@transportadora.com.br" \
     -H "Authorization: Bearer $CHAVE"
# chave de leitura tentando escrever: espera 403
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:8100/publico/identidade \
     -H "Authorization: Bearer $CHAVE_SO_LEITURA" -d '{}'
```

- [ ] **Passo 4: commit**

---

## Tarefa 4: A leitura pública de contatos

**Interfaces:**
- Produz: `GET /publico/contatos`, `GET /publico/contato`,
  `PATCH /publico/contato/status`

- [ ] **Passo 1: `contacts-list` — e a decisão que a spec já tomou**

A function monta **SQL cru por concatenação** e executa via
`execute_readonly_query`, uma RPC `SECURITY DEFINER`. A spec decidiu **não
portar isso**: era dívida, não ativo. Use consultas parametrizadas do asyncpg,
que eliminam a classe inteira de problema.

Preserve os dois modos de paginação (deslocamento com total, e cursor por
`(created_at, id)` codificado em base64) e os filtros: `q`, `etiqueta`,
`status`, `stage`, as quatro datas e `status_changed_after`.

⚠️ O `status_changed_at` é uma subconsulta correlacionada sobre `contact_events`
filtrando por sete tipos de evento — a mesma lista que o lote 1C passou a
alimentar. Não invente a lista: copie da function.

- [ ] **Passo 2: `contact-details`** — a visão 360° por `phone`, `email` ou
  `dnia_id`, com o `status_history` inferido dos eventos. É a mesma informação
  da ficha do lote 1B, com chave e formato diferentes: **não reaproveite o
  endpoint do admin**, que é por `lead_id` e responde a outra necessidade.

- [ ] **Passo 3: `contact-status-update`** — o irmão externo do que o 1C fez.
  Chaveado por `dnia_id`. ⚠️ A migration 005 tornou `lead_statuses` a fonte de
  verdade com FK: este endpoint **valida**, não cria, igual ao do 1C.

- [ ] **Passo 4: conferir por contrato e commitar**

---

## Tarefa 5: A documentação que aponta para o lugar errado

**Arquivos:** `ApiDocumentation.tsx`, `SettingsPage.tsx`, `ExperimentsSetup.tsx`,
`public/api/dnmarketing-api.yaml`

Três telas mostram ao usuário URLs de endpoint para sistemas externos usarem — e
todas apontam para `${SUPABASE_FUNCTIONS_URL}/...`, que não existe mais.

- [ ] **Passo 1: achar todas**

```bash
grep -rn "SUPABASE_FUNCTIONS_URL\|supabase.co/functions" frontend/src
```

- [ ] **Passo 2: trocar pela URL da nossa API.** Ela vem de `VITE_API_URL` —
  ⚠️ resolvida em **build time**, o gotcha registrado no `api.ts`.

- [ ] **Passo 3: o `dnmarketing-api.yaml`.** É a especificação OpenAPI servida
  como arquivo estático. Ou atualize, ou **apague** — uma spec pública que
  descreve endpoints que não existem é pior que nenhuma. Decida e registre.

- [ ] **Passo 4: commit**

---

## Tarefa 6: Fechar o lote

- [ ] **Passo 1: o portão, as três partes** — a tela de chaves limpa, ninguém
  mais chamando as functions portadas, e a tela conferida no navegador.

- [ ] **Passo 2: as functions saem.** Devem sair: `identity-lookup`,
  `identity-upsert`, `receive-contact-event`, `contacts-list`,
  `contact-details`, `contact-status-update`.

  ⚠️ `apply-lead-tag` continua na pasta desde o lote 1A porque
  `lib/leadConversion.ts` a chama — e esse arquivo vai para o lote 7. Não é
  falha deste lote.

- [ ] **Passo 3: o placar.** Esperado: **14/48** functions e acesso direto perto
  de 87.

- [ ] **Passo 4: `ROADMAP.md` e `CONTINUAR-AQUI.md`**, registrando que
  `lead-capture` e `validate-email-domain` foram para o lote 7.

- [ ] **Passo 5: commit**

---

## Definição de pronto do lote 1D

- [ ] `pytest` passa, com os 5 testes novos da chave
- [ ] Criar chave pela tela devolve a chave crua **uma vez** e nunca mais
- [ ] A chave é gerada no servidor, com `secrets` — não com `Math.random()`
- [ ] Chave de leitura recebe 403 ao tentar escrever
- [ ] Chave expirada recebe 401 e fica desativada
- [ ] O `WEBHOOK_SECRET` funciona como credencial alternativa
- [ ] `last_used_at` é gravado de verdade
- [ ] As três telas de documentação apontam para a nossa API
- [ ] 6 functions saíram de `backend/supabase/functions/`

## O que este lote destrava

As 23 functions que dependem de `validateAuth` deixam de estar bloqueadas.
Depois dele, os lotes de campanhas, jornadas, segmentos e analytics podem
avançar sem esbarrar em autenticação.

## O que este lote deixa aberto

1. **`lead-capture` e `validate-email-domain`** foram para o lote 7, com a
   landing page que os chama.
2. **O `WEBHOOK_SECRET` não tem escopo nem expiração.** É um segredo global que
   vale tudo. A origem fez assim; vale decidir se continua.
3. **A especificação OpenAPI pública** precisa de uma decisão: atualizar ou
   apagar.
