# Captação pública A — Landing e captura

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para executar tarefa a tarefa.
> Os passos usam caixa de seleção (`- [ ]`) para acompanhamento.

**Objetivo:** fazer um lead entrar pela landing pública da HS e chegar
qualificado no admin — página servida, formulário enviado, contato pontuado,
conversão registrada.

**Arquitetura:** o FastAPI serve uma **casca HTML** por slug, com as meta tags e
as `og:*` preenchidas de `pages.config` e a config inteira embutida como JSON —
porque o Meta e o WhatsApp leem o HTML cru, e porque a rota que serviria essa
config exige chave de API que um navegador anônimo não pode carregar. O corpo da
página é React, num **segundo bundle do Vite** que não carrega o admin. O
formulário chama `POST /publico/captura`, que numa transação valida o e-mail,
resolve a identidade, grava o lead (os gatilhos pontuam sozinhos), **registra a
conversão** e aplica a tag do slug.

**Stack:** FastAPI + asyncpg · `dnspython` (novo) · React 18 + Vite (segunda
entrada) · pytest

**Spec:** `docs/superpowers/specs/2026-09-08-marketinghs-captacao-publica-design.md`
— e, acima dela, `docs/superpowers/specs/2026-08-31-marketinghs-design.md`.

---

## Restrições globais

Valem para **toda** tarefa deste plano.

- **`sessao()` é o único caminho para dado.** O backend conecta como
  `marketinghs_app`, `NOINHERIT`, sem privilégio em `public`. Nunca superusuário.
- ⚠️ **O padrão de `sessao()` é o papel `anon`, e política `TO authenticated` não
  se aplica ao anônimo — a query devolve zero linhas, SEM ERRO.**
- **`role="service_role"` tem `BYPASSRLS`.** É o papel destas rotas: o chamador é
  a landing anônima, não há `user_id` para `auth.uid()`, e quem autoriza é a
  própria rota.
- **Nenhum endpoint depende do RLS para autorizar.**
- **O papel é `'admin'`**, não `'administrador'`.
- **Toda chave lida do ambiente precisa estar declarada em `Settings`**
  (`backend/app/config.py`). O pydantic-settings recusa chave desconhecida no
  `.env` e derruba o boot inteiro.
- **`.env` nunca é versionado.** Nenhum segredo no código.
- **Não escreva `CREATE EXTENSION`.**
- **Os três índices únicos parciais são intocáveis.**
- ⚠️ **Timestamp que chega como texto vai ao SQL como `$N::text::timestamptz`,
  nunca `$N::timestamptz`** — só o cast direto faz o asyncpg exigir `datetime` do
  Python e derrubar a rota. `$N::uuid` com string funciona.
- **Backend na porta 8100**; frontend do admin em `127.0.0.1:8080`.
- **Testes:** `cd backend && ./.venv/bin/pytest -q`. ⚠️ A suíte leva **~3,5
  minutos** (138 testes hoje); use timeout ≥600s e **nunca mate o pytest no
  meio** — já vazou dado neste projeto e derrubou a rodada seguinte.
- **`pytest.ini` tem `asyncio_mode = auto`.**
- **Fixtures:** `conexao` abre transação com `SET LOCAL ROLE service_role` e
  **sempre reverte**; `cliente` é um cliente ASGI que **grava de verdade**, e
  quem o usa limpa o que escreveu (padrão da fixture `envio`).
- **Migration:** este plano **não tem migration**. Todas as tabelas, colunas e
  gatilhos já existem.
- ⚠️ **Nenhum caminho de falha nosso pode recusar um lead real.** É a regra que
  resolve todo caso duvidoso deste plano.

---

## O que já existe e não se reimplementa

Conferido no banco em 08/09/2026:

| | |
|---|---|
| `resolve_or_create_identity(p_phone, p_email, p_nome, p_source_app, p_local_id, p_utm_source, p_stage)` | identidade unificada (lote 5C) |
| `trg_score_lead_on_change` | **BEFORE INSERT OR UPDATE OF** `cargo, faturamento, funcionarios, desafios, whatsapp` — pontua e etiqueta sozinho |
| `trg_lead_insert_event` | AFTER INSERT — cria o evento de contato |
| `trg_leads_contato_canonico` | contato canônico (lote 5C) |
| `leads_email_unique` | `UNIQUE (email)` sobre a coluna **crua** |
| `_aplicar_tag_do_slug(conn, lead_id, page_slug)` | em `publico.py` (lote 7) |
| `_recalcular_datas(conn, lead_ids)` | em `publico.py` (lote 7) |
| `LimiteTaxaMiddleware` | 30/min por IP em `/publico` |

⚠️ **Os cinco campos do gatilho de pontuação são o que qualifica um lead neste
sistema.** Formulário que não colete nenhum deles gera lead com score zero.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| **Criar** `backend/app/captura/__init__.py` | pacote |
| **Criar** `backend/app/captura/email.py` | validação de domínio: descartáveis, MX com cache, *fail-open* |
| **Criar** `backend/app/captura/campos.py` | a lista branca e a higienização do payload |
| **Criar** `backend/app/routers/captura.py` | `POST /publico/captura` e `POST /publico/validar-email` |
| **Criar** `backend/app/routers/landing.py` | `GET /p/{slug}` — a casca HTML |
| **Criar** `backend/tests/test_captura.py` | e-mail, higienização, captura ponta a ponta |
| Modificar `backend/app/main.py` | registrar os dois routers e montar o `StaticFiles` |
| Modificar `backend/requirements.txt` | `dnspython` |
| **Criar** `frontend/vite.landing.config.ts` | segunda entrada, bundle público |
| **Criar** `frontend/src/landing/main.tsx` | ponto de montagem, lê o JSON da casca |
| **Criar** `frontend/src/landing/Landing.tsx` | hero, prova, CTA — dirigido pela config |
| **Criar** `frontend/src/landing/Formulario.tsx` | campos de `visible_fields`, envio, redirect |
| Modificar `frontend/package.json` | script de build da landing |
| Modificar `frontend/src/components/admin/settings/ApiDocumentation.tsx` | `/lead-capture` → `/publico/captura` |
| Modificar `frontend/public/api/dnmarketing-api.yaml` | idem |
| **Apagar** `backend/supabase/functions/{lead-capture,validate-email-domain}` | no portão, por último |

---

### Task 1: Validação de domínio de e-mail

**Files:**
- Create: `backend/app/captura/__init__.py` (vazio)
- Create: `backend/app/captura/email.py`
- Modify: `backend/requirements.txt`
- Test: `backend/tests/test_captura.py`

**Interfaces:**
- Produces: `async def validar_dominio(email: str) -> tuple[bool, str | None]` —
  devolve `(valido, motivo)`; `motivo` é `None` quando válido.
  `def formato_ok(email: str) -> bool`. `DESCARTAVEIS: frozenset[str]`.
  `TTL_SEGUNDOS = 3600`. `def _limpar_cache() -> None` (só para os testes).

- [ ] **Passo 1: acrescentar a dependência**

Em `backend/requirements.txt`, depois de `bcrypt>=4.0.0`:

```
# Consulta MX na validação de e-mail da captura. A function original chamava
# dns.google por HTTPS; resolver nativo tira um terceiro do caminho crítico.
dnspython>=2.6.0
```

Instale: `cd backend && ./.venv/bin/pip install -r requirements.txt`

- [ ] **Passo 2: escrever os testes que falham**

Crie `backend/tests/test_captura.py`:

```python
"""A captação pública — o que clicar não prova.

A validação de e-mail é ***fail-open*** por decisão: DNS instável ou fora do ar
NÃO pode recusar um lead real. Testar isso é o ponto do arquivo — é um caminho
que só aparece quando a rede falha, e ninguém percebe se ele inverter.

A captura em si é testada ponta a ponta porque o modo de falhar dela é gravar
lead sem pontuação, sem identidade ou sem conversão — tudo silencioso.
"""

import pytest

from app.captura import email as vemail

# ⚠️ SEM `pytestmark = pytest.mark.asyncio` neste arquivo, ao contrário do
# `test_conversao.py`. O `pytest.ini` tem `asyncio_mode = auto`, que já marca as
# funções `async def` sozinho — e aqui há testes SÍNCRONOS misturados
# (`test_formato_recusa_o_obvio`, e os três da Task 2). O marcador de módulo
# alcançaria também os síncronos, e o pytest-asyncio recusa marcar função que
# não é corrotina.


def test_formato_recusa_o_obvio():
    assert vemail.formato_ok("erick@healthsafety.com.br")
    assert not vemail.formato_ok("sem-arroba")
    assert not vemail.formato_ok("dois@@arrobas.com")
    assert not vemail.formato_ok("sem@tld")
    assert not vemail.formato_ok("")


async def test_descartavel_conhecido_e_recusado():
    vemail._limpar_cache()
    valido, motivo = await vemail.validar_dominio("alguem@mailinator.com")
    assert valido is False
    assert motivo


async def test_dns_fora_do_ar_deixa_passar(monkeypatch):
    """⚠️ O teste mais importante do arquivo. Se ele inverter, uma instabilidade
    de DNS passa a recusar lead de verdade — e ninguém descobre, porque o
    formulário só diz 'e-mail inválido' e a pessoa vai embora."""
    vemail._limpar_cache()

    async def explodir(_dominio):
        raise OSError("resolver indisponível")

    monkeypatch.setattr(vemail, "_tem_mx", explodir)
    valido, motivo = await vemail.validar_dominio("alguem@empresa-real.com.br")
    assert valido is True
    assert motivo is None


async def test_dominio_sem_mx_e_recusado(monkeypatch):
    vemail._limpar_cache()

    async def sem_mx(_dominio):
        return False

    monkeypatch.setattr(vemail, "_tem_mx", sem_mx)
    valido, motivo = await vemail.validar_dominio("alguem@dominio-inexistente.tld")
    assert valido is False
    assert motivo


async def test_o_cache_evita_a_segunda_consulta(monkeypatch):
    vemail._limpar_cache()
    chamadas = []

    async def contar(dominio):
        chamadas.append(dominio)
        return True

    monkeypatch.setattr(vemail, "_tem_mx", contar)
    await vemail.validar_dominio("a@empresa.com.br")
    await vemail.validar_dominio("b@empresa.com.br")
    assert chamadas == ["empresa.com.br"], "o domínio deveria ser consultado uma vez"
```

- [ ] **Passo 3: rodar e ver falhar**

```bash
cd backend && ./.venv/bin/pytest tests/test_captura.py -q
```

Esperado: falha no import — `No module named 'app.captura'`.

- [ ] **Passo 4: escrever `backend/app/captura/email.py`**

```python
"""Validação de domínio de e-mail na captura pública.

⚠️ ***Fail-open* por decisão, não por descuido.** Erro de resolver, tempo
esgotado ou exceção inesperada devolvem VÁLIDO. A regra da spec é que nenhum
caminho de falha nosso pode recusar um lead real: uma instabilidade de DNS
recusando lead é invisível — o formulário diz "e-mail inválido", a pessoa vai
embora, e ninguém descobre.

O que é recusado, portanto, é só o que temos certeza: formato quebrado,
descartável conhecido, e domínio que o resolver respondeu NÃO TER como receber
e-mail.

⚠️ **E-mail gratuito (gmail, hotmail) NUNCA é recusado.** Na base da HS —
siderúrgica, mineradora, transporte — o corporativo é a norma, mas
transportadora pequena usa gmail de verdade. O sinal, se importar, vira
pontuação na régua de Configurações → Lead Scoring.
"""

import asyncio
import logging
import re
import time

import dns.asyncresolver
import dns.exception
# ⚠️ Explícito: o código abaixo usa `dns.resolver.NoAnswer` e
# `dns.resolver.NXDOMAIN`. O `dns.asyncresolver` importa o `dns.resolver` por
# dentro, então sem esta linha o atributo até resolve — por acidente. Depender
# disso quebra no dia em que a biblioteca reorganizar os módulos.
import dns.resolver

logger = logging.getLogger(__name__)

# Lista herdada da function `validate-email-domain`, ao pé da letra.
DESCARTAVEIS = frozenset({
    "mailinator.com", "tempmail.com", "10minutemail.com", "guerrillamail.com",
    "yopmail.com", "trashmail.com", "throwawaymail.com", "sharklasers.com",
    "getnada.com", "dispostable.com", "maildrop.cc", "fakeinbox.com",
    "tempail.com", "temp-mail.org", "temp-mail.io", "discard.email",
})

# Mesma regex prática da origem: local@domínio.tld, TLD com 2+ caracteres.
_FORMATO = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")

TTL_SEGUNDOS = 3600
TEMPO_LIMITE = 2.5

# domínio -> (valido, motivo, expira_em)
_cache: dict[str, tuple[bool, str | None, float]] = {}


def _limpar_cache() -> None:
    """Só para os testes. Cache de processo não tem invalidação em produção —
    o TTL de uma hora é a invalidação."""
    _cache.clear()


def formato_ok(email: str) -> bool:
    return bool(_FORMATO.match(email or ""))


async def _tem_mx(dominio: str) -> bool:
    """MX, com A como plano B — há domínio que recebe e-mail sem MX.

    Levanta em falha de rede; quem chama trata como *fail-open*.
    """
    resolver = dns.asyncresolver.Resolver()
    resolver.lifetime = TEMPO_LIMITE
    try:
        resposta = await resolver.resolve(dominio, "MX")
        if len(resposta) > 0:
            return True
    except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN):
        pass
    try:
        resposta = await resolver.resolve(dominio, "A")
        return len(resposta) > 0
    except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN):
        return False


async def validar_dominio(email: str) -> tuple[bool, str | None]:
    """`(valido, motivo)`. `motivo` é None quando válido."""
    normalizado = (email or "").strip().lower()
    if not formato_ok(normalizado):
        return False, "Formato de e-mail inválido."

    dominio = normalizado.split("@", 1)[1]

    if dominio in DESCARTAVEIS:
        return False, "Use um e-mail corporativo ou pessoal real."

    em_cache = _cache.get(dominio)
    if em_cache and em_cache[2] > time.monotonic():
        return em_cache[0], em_cache[1]

    try:
        tem = await _tem_mx(dominio)
    except (dns.exception.DNSException, asyncio.TimeoutError, OSError) as exc:
        # ⚠️ Fail-open. NÃO troque por `return False` — ver o cabeçalho.
        logger.warning("MX indisponível para %s (%s) — deixando passar", dominio, exc)
        return True, None

    if tem:
        resultado = (True, None)
    else:
        resultado = (False, "Este domínio não recebe e-mails. Confira o endereço.")

    _cache[dominio] = (resultado[0], resultado[1], time.monotonic() + TTL_SEGUNDOS)
    return resultado
```

- [ ] **Passo 5: rodar e ver passar**

```bash
cd backend && ./.venv/bin/pytest tests/test_captura.py -q
```

Esperado: **5 passed**.

- [ ] **Passo 6: commit**

```bash
git add backend/app/captura backend/requirements.txt backend/tests/test_captura.py
git commit -m "feat(A): validação de domínio de e-mail, fail-open por decisão

Porta validate-email-domain para Python, com resolver nativo no lugar da
chamada HTTPS ao dns.google — some um terceiro do caminho crítico da
captura.

O fail-open tem teste próprio porque é o caminho que só aparece quando a
rede falha: se ele inverter, instabilidade de DNS passa a recusar lead
real e ninguém descobre, porque o formulário só diz 'e-mail inválido'."
```

---

### Task 2: A lista branca e a higienização do payload

**Files:**
- Create: `backend/app/captura/campos.py`
- Test: `backend/tests/test_captura.py` (acrescentar)

**Interfaces:**
- Consumes: nada
- Produces: `CAMPOS_PERMITIDOS: frozenset[str]`,
  `def higienizar(bruto: dict) -> dict`

- [ ] **Passo 1: escrever os testes que falham**

Acrescente a `backend/tests/test_captura.py`:

```python
from app.captura import campos as vcampos


def test_higienizar_descarta_campo_fora_da_lista():
    saida = vcampos.higienizar({"nome": "Carla", "lead_score": 999, "etiqueta": "hotlead"})
    assert saida == {"nome": "Carla"}, "score e etiqueta são do gatilho, não do formulário"


def test_higienizar_apara_e_descarta_vazio():
    saida = vcampos.higienizar({"nome": "  Carla  ", "cargo": "", "empresa": None})
    assert saida == {"nome": "Carla"}


def test_higienizar_corta_texto_gigante():
    saida = vcampos.higienizar({"desafios": "x" * 5000})
    assert len(saida["desafios"]) == 2000


def test_higienizar_aceita_numero_e_booleano():
    saida = vcampos.higienizar({"funcionarios": "500", "interesse_formacao": True})
    assert saida["funcionarios"] == "500"
    assert saida["interesse_formacao"] is True
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
cd backend && ./.venv/bin/pytest tests/test_captura.py -q
```

Esperado: falha no import — `cannot import name 'campos'`.

- [ ] **Passo 3: escrever `backend/app/captura/campos.py`**

```python
"""A lista branca do que um formulário público pode escrever em `leads`.

⚠️ Lista branca, e não lista negra. A lição do lote 6: toda vez que a defesa
for "proibir o que é ruim" em vez de "permitir só o que é bom", é o desenho
errado. Aqui a consequência de errar é um formulário anônimo escrevendo
`lead_score`, `etiqueta` ou `deleted_at` direto.

⚠️ Sete campos desta lista são vocabulário da dn.ia — `tipo_participante`,
`presenca`, `indicacao`, `interesse_formacao`, `interesse_ecossistema`,
`interesse_mtia`, `data_interesse`. São funil de evento e mentoria, que a HS
não tem. Ficam porque as COLUNAS existem e integrador externo pode estar
mandando; tirá-los é decisão de negócio, não de código, e está registrada como
pergunta no CONTINUAR-AQUI.
"""

# Herdada da function `lead-capture`, ao pé da letra.
CAMPOS_PERMITIDOS = frozenset({
    "nome", "whatsapp", "cargo", "empresa", "faturamento", "funcionarios",
    "desafios", "tipo", "tipo_participante", "source", "presenca",
    "origem_campanha", "indicacao", "interesse_formacao",
    "interesse_ecossistema", "interesse_mtia", "data_interesse", "status",
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "ab_test", "ab_var", "ab_vid",
})

TAMANHO_MAXIMO = 2000


def higienizar(bruto: dict) -> dict:
    """Só o que está na lista, aparado, sem vazio e sem texto gigante.

    ⚠️ `""` é DESCARTADO, não gravado como string vazia — é o comportamento da
    origem, e o lote 7 já pagou o preço de os dois lados discordarem sobre isso
    (o INSERT gravava `''` onde o UPDATE gravava NULL).
    """
    saida: dict = {}
    if not isinstance(bruto, dict):
        return saida
    for chave, valor in bruto.items():
        if chave not in CAMPOS_PERMITIDOS or valor is None:
            continue
        if isinstance(valor, bool):
            saida[chave] = valor
        elif isinstance(valor, (int, float)):
            saida[chave] = str(valor)
        elif isinstance(valor, str):
            aparado = valor.strip()[:TAMANHO_MAXIMO]
            if aparado:
                saida[chave] = aparado
    return saida
```

⚠️ Note a diferença deliberada da origem: número vira **string**, porque
`funcionarios` e `faturamento` são colunas de texto em `leads` — passar `int`
ao asyncpg numa coluna `text` levanta erro de tipo.

- [ ] **Passo 4: rodar e ver passar**

```bash
cd backend && ./.venv/bin/pytest tests/test_captura.py -q
```

Esperado: **9 passed**.

- [ ] **Passo 5: commit**

```bash
git add backend/app/captura/campos.py backend/tests/test_captura.py
git commit -m "feat(A): a lista branca do que o formulário público pode escrever

Lista branca e não lista negra — a lição do lote 6. A consequência de
errar aqui é formulário anônimo escrevendo lead_score, etiqueta ou
deleted_at direto na tabela.

Número vira string, diferente da origem: funcionarios e faturamento são
colunas de texto, e passar int ao asyncpg numa coluna text levanta."
```

---

### Task 3: `POST /publico/captura` e `POST /publico/validar-email`

O coração do subprojeto.

**Files:**
- Create: `backend/app/routers/captura.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_captura.py` (acrescentar)

**Interfaces:**
- Consumes: `app.captura.email.validar_dominio`, `app.captura.campos.higienizar`,
  `app.routers.publico._aplicar_tag_do_slug` e `_recalcular_datas` (lote 7)
- Produces: `POST /publico/captura` → `200 {"ok": true, "redirect_url": str | null}`;
  `POST /publico/validar-email` → `200 {"valido": bool, "motivo": str | null}`

- [ ] **Passo 1: escrever o teste de ponta a ponta que falha**

Acrescente a `backend/tests/test_captura.py`:

```python
import pytest_asyncio

from app import database as db

EMAIL_SONDA = "sonda-captura@exemplo.invalid"
SLUG_SONDA = "sonda-captura"


@pytest_asyncio.fixture
async def pagina_sonda():
    """Uma página real para a captura ter slug, apagada no fim.

    ⚠️ Limpa ANTES de inserir, como a fixture `envio`: esta fixture COMMITA e
    só desfaz no teardown; se o pytest morrer no meio, a linha fica e o
    `pages_slug_key` derruba a rodada seguinte no setup.
    """
    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")

    async def limpar():
        async with db.sessao(role="service_role") as conn:
            await conn.execute(
                "DELETE FROM lead_conversions WHERE lead_id IN "
                "(SELECT id FROM leads WHERE email = $1)", EMAIL_SONDA)
            await conn.execute("DELETE FROM leads WHERE email = $1", EMAIL_SONDA)
            await conn.execute("DELETE FROM pages WHERE slug = $1", SLUG_SONDA)
            await conn.execute("DELETE FROM tags WHERE name = $1", SLUG_SONDA)

    await limpar()
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            """INSERT INTO pages (name, slug, component_name, page_type, status, config)
               VALUES ('Sonda da captura', $1, 'SondaCaptura', 'landing', 'active', $2)""",
            SLUG_SONDA, {"redirect_url": "https://exemplo.invalid/obrigado"})
    yield SLUG_SONDA
    await limpar()
    # ⚠️ NÃO chame `db.close_db()` aqui. A fixture `cliente` já fecha o pool no
    # teardown dela, e a `envio` — o padrão desta casa para fixture que commita
    # — deliberadamente não fecha. Fechar nas duas faz o teardown fechar um pool
    # já fechado quando a função usa as duas ao mesmo tempo, que é exatamente o
    # caso de todos os testes desta tarefa.


async def test_captura_cria_lead_pontuado_com_conversao_e_tag(cliente, pagina_sonda):
    """O caminho inteiro numa chamada — é o que a landing faz.

    O modo de falhar é silencioso em cada etapa: lead sem score (o gatilho não
    viu campo que pontua), sem identidade (a visão 360° vem vazia), sem
    conversão (o painel não conta o lead) ou sem tag (o segmento não o pega).
    """
    resposta = await cliente.post("/publico/captura", json={
        "email": EMAIL_SONDA,
        "page_slug": pagina_sonda,
        "fields": {"nome": "Carla Sonda", "cargo": "Gerente de SESMT",
                   "empresa": "Transportes Exemplo", "whatsapp": "85999991234"},
    })
    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["ok"] is True
    assert corpo["redirect_url"] == "https://exemplo.invalid/obrigado"

    async with db.sessao(role="service_role") as conn:
        lead = await conn.fetchrow(
            "SELECT id, nome, lead_score, etiqueta, dnia_id FROM leads WHERE email = $1",
            EMAIL_SONDA)
        assert lead is not None, "a captura não gravou o contato"
        assert lead["nome"] == "Carla Sonda"
        assert lead["lead_score"] > 0, "o gatilho de pontuação não viu campo que pontua"
        assert lead["dnia_id"] is not None, "a identidade não foi resolvida"

        conversoes = await conn.fetchval(
            "SELECT count(*) FROM lead_conversions WHERE lead_id = $1", lead["id"])
        assert conversoes == 1, "a conversão não foi registrada"

        tags = await conn.fetchval(
            "SELECT count(*) FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id "
            "WHERE lt.lead_id = $1 AND t.name = $2", lead["id"], pagina_sonda)
        assert tags == 1, "a tag do slug não foi aplicada"


async def test_captura_nao_devolve_dado_pessoal(cliente, pagina_sonda):
    """⚠️ A rota é ANÔNIMA. Se ela devolver o lead, qualquer pessoa extrai nome,
    telefone e empresa da base mandando e-mails, um por vez."""
    await cliente.post("/publico/captura", json={
        "email": EMAIL_SONDA, "page_slug": pagina_sonda,
        "fields": {"nome": "Carla Sonda", "whatsapp": "85999991234"}})
    resposta = await cliente.post("/publico/captura", json={
        "email": EMAIL_SONDA, "page_slug": pagina_sonda, "fields": {}})
    corpo = resposta.json()
    assert set(corpo.keys()) <= {"ok", "redirect_url"}
    texto = resposta.text.lower()
    assert "carla" not in texto and "85999991234" not in texto


async def test_captura_recusa_descartavel(cliente, pagina_sonda):
    resposta = await cliente.post("/publico/captura", json={
        "email": "alguem@mailinator.com", "page_slug": pagina_sonda, "fields": {}})
    assert resposta.status_code == 400


async def test_captura_reativa_contato_excluido(cliente, pagina_sonda):
    await cliente.post("/publico/captura", json={
        "email": EMAIL_SONDA, "page_slug": pagina_sonda, "fields": {"nome": "Carla"}})
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            "UPDATE leads SET deleted_at = now(), deleted_by = 'teste' WHERE email = $1",
            EMAIL_SONDA)

    await cliente.post("/publico/captura", json={
        "email": EMAIL_SONDA, "page_slug": pagina_sonda, "fields": {"nome": "Carla"}})

    async with db.sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            "SELECT id, deleted_at FROM leads WHERE email = $1", EMAIL_SONDA)
        assert linha["deleted_at"] is None, "reconverter deveria reativar o contato"
        evento = await conn.fetchval(
            "SELECT count(*) FROM contact_events "
            "WHERE lead_id = $1 AND event_type = 'contact_reactivated'", linha["id"])
        assert evento == 1, "a reativação precisa deixar rastro"
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
cd backend && ./.venv/bin/pytest tests/test_captura.py -q
```

Esperado: os quatro testes novos falham com **404** — a rota não existe.

- [ ] **Passo 3: escrever `backend/app/routers/captura.py`**

```python
"""A porta da landing: captura anônima de lead.

⚠️ **Esta rota não tem autenticação, por desenho** — é a landing pública
chamando, e qualquer credencial que chegasse ao navegador estaria publicada. É
por isso que ela mora sob `/publico`, dentro do limite de 30/min por IP do
middleware do lote 0.

⚠️ **E é por isso que ela não devolve NADA sobre o lead.** A function
`lead-capture` que ela substitui devolvia o registro projetado (id, etiqueta,
dnia_id e booleanos de completude) para chamador não privilegiado — mas ela
exigia a chave publicável do Supabase. Sem nenhuma credencial, até a projeção é
demais: `isNew` sozinho já é um oráculo de enumeração, que responde "este
e-mail está na base?" para quem perguntar. A resposta daqui é `{ok, redirect_url}`
e mais nada.

⚠️ A conversão é registrada AQUI, no servidor. O `leadConversion.ts`, apagado
no lote 7, fazia isso do navegador; `POST /publico/conversao` exige chave de
API. Fechar o laço aqui é o único caminho que não expõe credencial.
"""

import logging

from fastapi import APIRouter, Body, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.captura.campos import higienizar
from app.captura.email import validar_dominio
from app.database import sessao
from app.routers.publico import _aplicar_tag_do_slug

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/publico", tags=["captura"])


class CapturaIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    page_slug: str = Field(min_length=1, max_length=200)
    session_id: str | None = Field(default=None, min_length=1, max_length=100)
    fields: dict = Field(default_factory=dict)


class EmailIn(BaseModel):
    email: str = Field(min_length=1, max_length=320)


@router.post("/validar-email")
async def validar_email(dados: EmailIn):
    """Conferência inline do formulário, antes do envio.

    Devolve 200 sempre — inclusive quando inválido. Um 4xx aqui viraria erro no
    console do navegador a cada tecla digerida por quem preenche.
    """
    valido, motivo = await validar_dominio(dados.email)
    return {"valido": valido, "motivo": motivo}


@router.post("/captura")
async def capturar(dados: CapturaIn):
    email = dados.email.strip().lower()

    valido, motivo = await validar_dominio(email)
    if not valido:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, motivo or "E-mail inválido.")

    campos = higienizar(dados.fields)

    async with sessao(role="service_role") as conn:
        pagina = await conn.fetchrow(
            "SELECT slug, config FROM pages WHERE slug = $1", dados.page_slug)
        if pagina is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Página não encontrada.")

        existente = await conn.fetchrow(
            "SELECT id::text AS id, session_id, deleted_at, deleted_by, dnia_id::text "
            "AS dnia_id FROM leads WHERE email = $1", email)

        if existente is None:
            lead_id = await _inserir(conn, email, dados.session_id, campos)
        else:
            lead_id = existente["id"]
            await _atualizar(conn, existente, dados.session_id, campos)

        await _resolver_identidade(conn, lead_id, email, campos)

        await conn.execute(
            """INSERT INTO lead_conversions
                   (lead_id, tipo, converted_at, page_slug, session_id,
                    utm_source, utm_medium, utm_campaign, utm_term, utm_content,
                    source, ab_test, ab_var, ab_vid)
               VALUES ($1::uuid, $2, now(), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)""",
            lead_id, campos.get("tipo") or "lead", dados.page_slug,
            dados.session_id, campos.get("utm_source"), campos.get("utm_medium"),
            campos.get("utm_campaign"), campos.get("utm_term"),
            campos.get("utm_content"), campos.get("source"),
            campos.get("ab_test"), campos.get("ab_var"), campos.get("ab_vid"))

        await _aplicar_tag_do_slug(conn, lead_id, dados.page_slug)

        config = pagina["config"] or {}

    return {"ok": True, "redirect_url": config.get("redirect_url") or None}


async def _inserir(conn, email: str, session_id: str | None, campos: dict) -> str:
    """⚠️ `tipo` é NOT NULL sem default em `leads`; o padrão da origem é 'lead'.

    As colunas saem das chaves de `campos`, que vêm da lista branca — nunca do
    corpo do request. Chave desconhecida o `higienizar` já descartou.
    """
    colunas = ["email", "session_id", "tipo"]
    valores = [email, session_id, campos.get("tipo") or "lead"]
    for chave, valor in campos.items():
        if chave == "tipo":
            continue
        colunas.append(chave)
        valores.append(valor)
    marcas = ", ".join(f"${i}" for i in range(1, len(valores) + 1))
    return await conn.fetchval(
        f"INSERT INTO leads ({', '.join(colunas)}) VALUES ({marcas}) RETURNING id::text",
        *valores)


async def _atualizar(conn, existente, session_id: str | None, campos: dict) -> None:
    """Atualiza o que veio, adota o `session_id` se ainda não havia, e REATIVA
    contato excluído — reconverter é sinal de que a pessoa voltou.

    ⚠️ A exclusão aqui é lógica (`deleted_at`), e o índice `leads_email_unique`
    não olha `deleted_at`: sem reativar, a segunda conversão da mesma pessoa
    bateria no índice e a captura falharia.
    """
    atribuicoes = dict(campos)
    if session_id and not existente["session_id"]:
        atribuicoes["session_id"] = session_id

    estava_excluido = existente["deleted_at"] is not None
    if estava_excluido:
        atribuicoes["deleted_at"] = None
        atribuicoes["deleted_by"] = None

    if atribuicoes:
        nomes = list(atribuicoes)
        sets = ", ".join(f"{nome} = ${i}" for i, nome in enumerate(nomes, start=2))
        await conn.execute(
            f"UPDATE leads SET {sets} WHERE id = $1::uuid",
            existente["id"], *[atribuicoes[n] for n in nomes])

    if estava_excluido:
        await conn.execute(
            """INSERT INTO contact_events
                   (lead_id, source_app, event_type, title, metadata)
               VALUES ($1::uuid, 'marketinghs', 'contact_reactivated',
                       'Contato reativado por nova conversão', $2)""",
            existente["id"],
            {"previous_deleted_at": str(existente["deleted_at"]),
             "previous_deleted_by": existente["deleted_by"],
             "reason": "captura_reconversao"})


async def _resolver_identidade(conn, lead_id: str, email: str, campos: dict) -> None:
    """Chama `resolve_or_create_identity` e escreve de volta o que ela resolveu.

    ⚠️ Não levanta: identidade é enriquecimento, e derrubar a captura por causa
    dela seria recusar um lead real por falha nossa.
    """
    try:
        linha = await conn.fetchrow(
            "SELECT * FROM resolve_or_create_identity($1, $2, $3, $4, $5::uuid, $6, $7)",
            campos.get("whatsapp"), email, campos.get("nome"),
            "marketinghs", lead_id, campos.get("utm_source") or campos.get("source"),
            "lead")
        if linha is None or not linha.get("dnia_id"):
            return
        await conn.execute(
            """UPDATE leads
                  SET dnia_id = $2::uuid,
                      phone_normalized = COALESCE($3, phone_normalized)
                WHERE id = $1::uuid""",
            lead_id, str(linha["dnia_id"]), linha.get("phone_normalized"))
    except Exception as exc:  # noqa: BLE001 — ver o docstring
        logger.error("captura: identidade não resolvida para %s: %s", lead_id, exc)
```

✅ **A assinatura de `resolve_or_create_identity` foi conferida no banco em
08/09/2026** e é exatamente a de sete parâmetros usada acima, nesta ordem:

```
p_phone text, p_email text, p_nome text, p_source_app text,
p_local_id uuid, p_utm_source text, p_stage text DEFAULT 'lead'
```

⚠️ **`p_source_app = "marketinghs"` não é escolha estética.** É o ramo da função
que grava `p_local_id` em `dndash_lead_id` — ou seja, é o que faz o lead recém-
criado virar o **contato canônico** da identidade. A function original passava
`"dnmarketing"`, que é o vocabulário da dn.ia. Confira as colunas de retorno
antes de escrever (`\df+ resolve_or_create_identity`); se `dnia_id` ou
`phone_normalized` tiverem outro nome, **o banco é a autoridade**.

- [ ] **Passo 4: registrar o router em `backend/app/main.py`**

Import junto dos outros, em ordem alfabética (entre `campanhas` e `chaves`):

```python
from app.routers.captura import router as captura_router
```

E o registro, **antes** de `publico_router`:

```python
app.include_router(captura_router)
```

- [ ] **Passo 5: rodar os testes**

```bash
cd backend && ./.venv/bin/pytest tests/test_captura.py -q
```

Esperado: **13 passed**.

- [ ] **Passo 6: rodar a suíte inteira**

```bash
cd backend && ./.venv/bin/pytest -q     # ⚠️ timeout ≥600s. Esperado: 151 passed
```

- [ ] **Passo 7: commit**

```bash
git add backend/app/routers/captura.py backend/app/main.py backend/tests/test_captura.py
git commit -m "feat(A): POST /publico/captura — a porta da landing

Substitui lead-capture. Sem autenticação, por desenho: é a landing
anônima chamando, e credencial que chega ao navegador está publicada.

E por isso não devolve NADA sobre o lead. A function original projetava
o registro para chamador não privilegiado, mas exigia a chave publicável
do Supabase. Sem credencial nenhuma, até a projeção é demais — 'isNew'
sozinho já responde 'este e-mail está na base?' para quem perguntar.

A conversão é registrada aqui, no servidor: /publico/conversao exige
chave de API, e o cliente de navegador que fazia isso saiu no lote 7."
```

---

### Task 4: A casca HTML — `GET /p/{slug}`

**Files:**
- Create: `backend/app/routers/landing.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_captura.py` (acrescentar)

**Interfaces:**
- Produces: `GET /p/{slug}` → `HTMLResponse`; 404 quando a página não existe ou
  não está `active`

- [ ] **Passo 1: escrever os testes que falham**

Acrescente a `backend/tests/test_captura.py`:

```python
async def test_casca_traz_as_meta_tags_da_config(cliente, pagina_sonda):
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            "UPDATE pages SET config = $2 WHERE slug = $1", pagina_sonda,
            {"meta_title": "Bafômetro conectado", "headline": "Registre e prove",
             "meta_description": "Teste de alcoolemia com registro auditável"})

    resposta = await cliente.get(f"/p/{pagina_sonda}")
    assert resposta.status_code == 200
    assert "text/html" in resposta.headers["content-type"]
    corpo = resposta.text
    assert "<title>Bafômetro conectado</title>" in corpo
    assert 'property="og:title" content="Bafômetro conectado"' in corpo
    assert "Teste de alcoolemia com registro auditável" in corpo


async def test_casca_escapa_conteudo_do_admin(cliente, pagina_sonda):
    """⚠️ A config é campo EDITÁVEL na tela indo para dentro de HTML.

    O `</script>` é o caso que mais morde: ele fecha o bloco JSON embutido e o
    resto vira marcação executável na página.
    """
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            "UPDATE pages SET config = $2 WHERE slug = $1", pagina_sonda,
            {"meta_title": '"><script>alert(1)</script>',
             "headline": "</script><img src=x onerror=alert(1)>"})

    corpo = (await cliente.get(f"/p/{pagina_sonda}")).text
    assert "<script>alert(1)</script>" not in corpo
    assert "</script><img" not in corpo
    assert "onerror=alert(1)" not in corpo


async def test_casca_embute_a_config_como_json(cliente, pagina_sonda):
    corpo = (await cliente.get(f"/p/{pagina_sonda}")).text
    assert 'id="config-da-pagina"' in corpo
    assert 'type="application/json"' in corpo


async def test_casca_404_para_pagina_inexistente(cliente):
    assert (await cliente.get("/p/nao-existe-mesmo")).status_code == 404


async def test_casca_404_para_rascunho(cliente, pagina_sonda):
    """Página em rascunho não está no ar — servir seria publicar o que ninguém
    publicou."""
    async with db.sessao(role="service_role") as conn:
        await conn.execute("UPDATE pages SET status = 'draft' WHERE slug = $1",
                           pagina_sonda)
    assert (await cliente.get(f"/p/{pagina_sonda}")).status_code == 404
```

- [ ] **Passo 2: rodar e ver falhar**

Esperado: os cinco falham com 404 — a rota não existe.

- [ ] **Passo 3: escrever `backend/app/routers/landing.py`**

```python
"""A casca HTML da landing pública.

Serve um HTML pequeno com as meta tags e as `og:*` já preenchidas, mais a
config embutida como JSON. O corpo da página é React, montado no cliente.

⚠️ **Por que servida e não montada no cliente:** anunciar exige preview de link
correto, e o Meta e o WhatsApp leem o HTML CRU da resposta — nunca executam o
JavaScript. Um SPA entrega a eles o mesmo `index.html` para toda página, e o
preview sai genérico.

⚠️ **Por que a config vem embutida:** `GET /publico/paginas/{slug}` existe desde
o lote 7 e exige `chave_api("read")`. Um navegador anônimo não pode carregar
chave — qualquer credencial que chegue à landing está publicada. Embutir
resolve isso e ainda tira uma ida ao servidor.

⚠️ **`/p/{slug}` e não `/{slug}`:** um catch-all na raiz sombrearia `/paginas`,
`/publico` e `/auth`. A URL limpa do anúncio é problema do nginx em produção.
"""

import html
import json
import logging
import time

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import HTMLResponse

from app.database import sessao

logger = logging.getLogger(__name__)
router = APIRouter(tags=["landing"])

# A landing é anônima e não passa pelo limite de taxa — visitante atrás de NAT
# corporativo divide IP, e limitar visualização derrubaria gente de verdade. O
# cache de processo é o que impede uma ida ao banco por acesso.
TTL_SEGUNDOS = 60
_cache: dict[str, tuple[dict, float]] = {}


def _limpar_cache() -> None:
    _cache.clear()


async def _config_da_pagina(slug: str) -> dict:
    em_cache = _cache.get(slug)
    if em_cache and em_cache[1] > time.monotonic():
        return em_cache[0]

    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            "SELECT name, config FROM pages WHERE slug = $1 AND status = 'active'",
            slug)
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Página não encontrada.")

    config = dict(linha["config"] or {})
    config.setdefault("nome_da_pagina", linha["name"])
    _cache[slug] = (config, time.monotonic() + TTL_SEGUNDOS)
    return config


def _json_seguro(dados: dict) -> str:
    """JSON para dentro de `<script type="application/json">`.

    ⚠️ `</script>` digitado numa headline fecha o bloco e o resto da string vira
    marcação. Escapar `<` resolve, e continua sendo JSON válido — `\\u003c` é o
    mesmo caractere para qualquer parser.
    """
    return (json.dumps(dados, ensure_ascii=False)
            .replace("<", "\\u003c")
            .replace(">", "\\u003e")
            .replace("&", "\\u0026"))


def montar_casca(slug: str, config: dict) -> str:
    """⚠️ Todo valor que sai daqui veio de campo EDITÁVEL na tela de Páginas.
    `html.escape(..., quote=True)` em tudo — inclusive, e principalmente, no que
    vai dentro de atributo, que é onde as `og:*` vivem."""
    titulo = html.escape(str(config.get("meta_title")
                             or config.get("nome_da_pagina") or "Health & Safety"),
                         quote=True)
    descricao = html.escape(str(config.get("meta_description") or ""), quote=True)

    return f"""<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{titulo}</title>
<meta name="description" content="{descricao}">
<meta property="og:type" content="website">
<meta property="og:title" content="{titulo}">
<meta property="og:description" content="{descricao}">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/landing/main.css">
</head>
<body>
<div id="landing" data-slug="{html.escape(slug, quote=True)}"></div>
<script type="application/json" id="config-da-pagina">{_json_seguro(config)}</script>
<script type="module" src="/landing/main.js"></script>
</body>
</html>"""


@router.get("/p/{slug}", response_class=HTMLResponse)
async def landing(slug: str):
    config = await _config_da_pagina(slug)
    return HTMLResponse(montar_casca(slug, config))
```

⚠️ **A imagem `og:image` não entra aqui.** Ela é o subsistema B e `pages.config`
ainda não tem campo para ela. Deixar a meta tag fora é melhor que apontá-la para
um lugar que não existe.

- [ ] **Passo 4: registrar o router e montar os arquivos estáticos**

Em `backend/app/main.py`, import junto dos outros (entre `jornadas` e
`leitura_contatos`):

```python
from app.routers.landing import router as landing_router
```

E, junto dos `include_router`:

```python
app.include_router(landing_router)
```

E o mount dos arquivos do bundle da landing, **depois** de todos os
`include_router` (o `StaticFiles` vem do Starlette, que já é dependência do
FastAPI — não instale nada):

```python
from pathlib import Path
from fastapi.staticfiles import StaticFiles

# O bundle público da landing, construído por `npm run build:landing`. Fora do
# ar em desenvolvimento até alguém rodar o build — a casca continua servindo, a
# página fica em branco, e isso é honesto.
_LANDING = Path(__file__).resolve().parents[2] / "frontend" / "dist-landing"
if _LANDING.is_dir():
    app.mount("/landing", StaticFiles(directory=_LANDING), name="landing")
else:
    logger.warning("dist-landing não existe — rode `npm run build:landing`")
```

⚠️ Confira que existe um `logger` no escopo de `main.py`; se não houver, use
`logging.getLogger(__name__)`.

- [ ] **Passo 5: rodar os testes**

```bash
cd backend && ./.venv/bin/pytest tests/test_captura.py -q
```

Esperado: **18 passed**.

- [ ] **Passo 6: commit**

```bash
git add backend/app/routers/landing.py backend/app/main.py backend/tests/test_captura.py
git commit -m "feat(A): a casca HTML da landing, com meta tags servidas

O Meta e o WhatsApp leem o HTML cru e nunca executam JavaScript — um SPA
entrega a eles o mesmo index.html para toda página e o preview do link
sai genérico. A casca resolve isso sem mover a renderização da página
para o backend.

A config vai embutida porque /publico/paginas/{slug} exige chave de API,
e navegador anônimo não pode carregar credencial.

Tudo que vem da config é campo editável no admin indo para dentro de
HTML: escape de atributo, e `<` escapado no JSON embutido, porque
`</script>` numa headline fecha o bloco."
```

---

### Task 5: A segunda entrada do Vite

**Files:**
- Create: `frontend/vite.landing.config.ts`
- Create: `frontend/src/landing/main.tsx`
- Modify: `frontend/package.json`

**Interfaces:**
- Produces: `frontend/dist-landing/main.js` e `main.css`; o global
  `window.__CONFIG_DA_PAGINA__` não é usado — a config é lida do `<script>`

- [ ] **Passo 1: criar `frontend/vite.landing.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// O bundle PÚBLICO. Separado do admin de propósito: quem cai na landing por um
// anúncio não deve baixar o painel inteiro para ver um formulário.
//
// ⚠️ Nomes de arquivo fixos, sem hash: a casca HTML servida pelo FastAPI
// referencia /landing/main.js literalmente. Se um dia isso virar problema de
// cache, a saída é versionar pela query (?v=updated_at da página), não voltar
// a hashear.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: {
    outDir: "dist-landing",
    emptyOutDir: true,
    target: "es2020",
    rollupOptions: {
      input: path.resolve(__dirname, "src/landing/main.tsx"),
      output: {
        entryFileNames: "main.js",
        assetFileNames: "main.[ext]",
      },
    },
  },
});
```

- [ ] **Passo 2: acrescentar o script em `frontend/package.json`**

Na seção `"scripts"`:

```json
"build:landing": "vite build --config vite.landing.config.ts"
```

- [ ] **Passo 3: criar `frontend/src/landing/main.tsx`**

```tsx
import { createRoot } from "react-dom/client";
import { Landing, type ConfigDaPagina } from "./Landing";
import "./landing.css";

// A config vem embutida na casca servida pelo FastAPI — sem segunda ida ao
// servidor, e sem precisar de chave de API para ler a própria página.
function lerConfig(): ConfigDaPagina {
  const bloco = document.getElementById("config-da-pagina");
  if (!bloco?.textContent) return {};
  try {
    return JSON.parse(bloco.textContent) as ConfigDaPagina;
  } catch {
    // Não derrubar a página por config quebrada: o formulário ainda funciona
    // com os campos padrão, e um lead vale mais que uma headline.
    console.error("[landing] config ilegível");
    return {};
  }
}

const alvo = document.getElementById("landing");
if (alvo) {
  const slug = alvo.dataset.slug ?? "";
  createRoot(alvo).render(<Landing slug={slug} config={lerConfig()} />);
}
```

- [ ] **Passo 4: provar que o build fecha**

O `Landing.tsx` ainda não existe — este passo **deve falhar**, e é o ponto:

```bash
cd frontend && npx vite build --config vite.landing.config.ts
```

Esperado: erro de módulo não encontrado (`./Landing`). A Task 6 o cria.

- [ ] **Passo 5: commit**

```bash
git add frontend/vite.landing.config.ts frontend/src/landing/main.tsx frontend/package.json
git commit -m "chore(A): segunda entrada do Vite para o bundle público

Quem cai na landing por um anúncio não deve baixar o painel inteiro para
ver um formulário. Nomes de arquivo fixos porque a casca servida pelo
FastAPI referencia /landing/main.js literalmente."
```

---

### Task 6: O renderizador da landing

⚠️ **Esta tarefa tem desenho visual dentro.** O design system da HS **vive no
Claude Design** — leia de lá (DesignSync) antes de inventar cor, tipografia ou
espaçamento. O molde `docs/referencia/humanoseagentes/` serve como **estrutura**
(hero, prova, qualificação, CTA); **nada do conteúdo dele se aproveita** — é uma
consultoria de agentes de IA, e a HS vende bafômetro para indústria pesada.

**Files:**
- Create: `frontend/src/landing/Landing.tsx`
- Create: `frontend/src/landing/Formulario.tsx`
- Create: `frontend/src/landing/landing.css`

**Interfaces:**
- Consumes: a config lida em `main.tsx`
- Produces: `export type ConfigDaPagina`, `export function Landing({slug, config})`

- [ ] **Passo 1: criar `frontend/src/landing/Landing.tsx`**

```tsx
import { Formulario } from "./Formulario";

export type ConfigDaPagina = {
  nome_da_pagina?: string;
  headline?: string;
  subheadline?: string;
  cta_text?: string;
  cta_color?: string;
  visible_fields?: string[];
  redirect_url?: string;
};

export function Landing({ slug, config }: { slug: string; config: ConfigDaPagina }) {
  // Os padrões existem para a página nunca nascer vazia: enquanto o Nicholson
  // não decide a oferta, a landing mostra o que a HS vende de fato.
  const headline = config.headline || "Registre e prove cada teste de alcoolemia";
  const subheadline = config.subheadline ||
    "Bafômetro conectado para indústria e logística — o teste vira registro auditável.";

  return (
    <main className="landing">
      <section className="hero">
        <h1>{headline}</h1>
        <p className="sub">{subheadline}</p>
        <Formulario slug={slug} config={config} />
      </section>
    </main>
  );
}
```

- [ ] **Passo 2: criar `frontend/src/landing/Formulario.tsx`**

```tsx
import { useState } from "react";
import type { ConfigDaPagina } from "./Landing";

// Os cinco campos que o gatilho `trg_score_lead_on_change` observa são o que
// qualifica um lead neste sistema: cargo, faturamento, funcionarios, desafios e
// whatsapp. Um formulário que não colete nenhum deles gera lead com score zero.
const ROTULOS: Record<string, string> = {
  nome: "Nome",
  email: "E-mail corporativo",
  whatsapp: "WhatsApp",
  cargo: "Cargo",
  empresa: "Empresa",
  funcionarios: "Número de colaboradores",
  faturamento: "Faturamento anual",
  desafios: "Qual o seu desafio hoje?",
};

const PADRAO = ["nome", "email", "whatsapp", "cargo", "empresa"];

function utmDaUrl(): Record<string, string> {
  const p = new URLSearchParams(window.location.search);
  const saida: Record<string, string> = {};
  for (const chave of ["utm_source", "utm_medium", "utm_campaign", "utm_term",
                       "utm_content", "ab_test", "ab_var", "ab_vid"]) {
    const v = p.get(chave);
    if (v) saida[chave] = v;
  }
  return saida;
}

export function Formulario({ slug, config }: { slug: string; config: ConfigDaPagina }) {
  const campos = config.visible_fields?.length ? config.visible_fields : PADRAO;
  const [valores, setValores] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const { email, ...resto } = valores;
      const r = await fetch("/publico/captura", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email, page_slug: slug,
          fields: { ...resto, ...utmDaUrl(), source: slug },
        }),
      });
      if (!r.ok) {
        const corpo = await r.json().catch(() => ({}));
        setErro(corpo.detail || "Não conseguimos registrar agora. Tente de novo.");
        return;
      }
      const corpo = await r.json();
      if (corpo.redirect_url) window.location.assign(corpo.redirect_url);
      else setErro(null);
    } catch {
      setErro("Não conseguimos registrar agora. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="captura">
      {campos.map((campo) => (
        <label key={campo}>
          <span>{ROTULOS[campo] ?? campo}</span>
          <input
            name={campo}
            type={campo === "email" ? "email" : "text"}
            required={campo === "email"}
            value={valores[campo] ?? ""}
            onChange={(e) => setValores({ ...valores, [campo]: e.target.value })}
          />
        </label>
      ))}
      {erro && <p className="erro" role="alert">{erro}</p>}
      <button type="submit" disabled={enviando}
              style={config.cta_color ? { background: config.cta_color } : undefined}>
        {enviando ? "Enviando..." : (config.cta_text || "Quero falar com um especialista")}
      </button>
    </form>
  );
}
```

⚠️ **`email` é o único campo obrigatório**, mesmo que a config peça outros. A
regra da spec — nenhum caminho de falha nosso pode recusar um lead real — vale
também para atrito de formulário: campo obrigatório a mais é lead a menos.

- [ ] **Passo 3: criar `frontend/src/landing/landing.css`**

Escreva o estilo depois de ler o design system no Claude Design. O mínimo que
esta tarefa exige: a página tem de ser legível no celular (a maior parte do
tráfego de anúncio é móvel), o formulário tem de ter alvo de toque de pelo menos
44px, e o contraste do CTA precisa funcionar com a `cta_color` que vier da
config — inclusive uma cor clara.

- [ ] **Passo 4: provar que o build fecha**

```bash
cd frontend && npx vite build --config vite.landing.config.ts && ls -la dist-landing/
```

Esperado: `main.js` e `main.css` em `dist-landing/`.

- [ ] **Passo 5: conferir o tamanho do bundle**

```bash
du -h frontend/dist-landing/main.js
```

⚠️ Se passar de **150 KB**, alguma coisa do admin entrou junto. Investigue antes
de seguir — o motivo inteiro da segunda entrada é o visitante não baixar o
painel.

- [ ] **Passo 6: commit**

```bash
git add frontend/src/landing/
git commit -m "feat(A): o renderizador da landing, dirigido pela config

Hero e formulário saem de pages.config — headline, CTA e quais campos
aparecem são o que a tela de Páginas já edita. Os padrões existem para a
página nunca nascer vazia enquanto a oferta não é decidida.

Só e-mail é obrigatório, mesmo que a config peça mais campos: campo
obrigatório a mais é lead a menos, e a regra do lote é que nenhum
caminho nosso recusa lead real."
```

---

### Task 7: A documentação

**Files:**
- Modify: `frontend/src/components/admin/settings/ApiDocumentation.tsx`
- Modify: `frontend/public/api/dnmarketing-api.yaml`

⚠️ Esta é a **nona vez** neste projeto que a documentação ensina URL morta.

- [ ] **Passo 1: trocar `/lead-capture` nos dois arquivos**

| Antes | Depois |
|---|---|
| `/lead-capture` | `POST /publico/captura` |

⚠️ **O contrato mudou, e a documentação tem de dizer a verdade nova:**

- a rota **não exige autenticação** (a antiga exigia chave publicável);
- o corpo é `{email, page_slug, fields}` — `page_slug` é **novo e obrigatório**;
- a resposta é `{"ok": true, "redirect_url": ...}` e **não devolve o lead**;
- **`mode: "update_only"` não existe mais** — era do fluxo de reconversão da
  dn.ia e não tem consumidor conhecido. Se algum integrador depender disso, ele
  precisa reaparecer como rota autenticada, e isso é decisão do Erick.

Documente também `POST /publico/validar-email`, que é novo:
corpo `{email}`, resposta `{"valido": bool, "motivo": str | null}`, sempre 200.

⚠️ **`validate-email-domain` nunca esteve documentada** — conferi: não aparece
em nenhum dos dois arquivos. Não invente uma entrada de despedida para ela.

- [ ] **Passo 2: provar que não sobrou URL morta**

```bash
cd /home/ericks/github/MarketingHS
grep -n "lead-capture\|validate-email-domain" \
  frontend/src/components/admin/settings/ApiDocumentation.tsx \
  frontend/public/api/dnmarketing-api.yaml
```

Esperado: no máximo campos `id:` de âncora — **nenhum** `path`, `label`, `curl`
ou texto de guia. ⚠️ O `label` da navegação lateral sai do `path` desde o lote
7; confira que continua assim.

- [ ] **Passo 3: validar o YAML e a tipagem**

```bash
./backend/.venv/bin/python -c "import yaml; yaml.safe_load(open('frontend/public/api/dnmarketing-api.yaml')); print('yaml ok')"
cd frontend && npx tsc --noEmit
```

- [ ] **Passo 4: commit**

```bash
git add frontend/src/components/admin/settings/ApiDocumentation.tsx \
        frontend/public/api/dnmarketing-api.yaml
git commit -m "docs(A): a documentação ensina /publico/captura

Nona vez que a documentação ensinava URL morta. E o contrato mudou de
verdade: a rota não exige autenticação, page_slug é novo e obrigatório,
a resposta não devolve o lead, e mode=update_only não existe mais."
```

---

### Task 8: O portão

- [ ] **Passo 1: a tela não fala mais com o Supabase**

```bash
grep -rn "supabase" frontend/src/landing/
```

Esperado: nenhuma linha.

- [ ] **Passo 2: ninguém mais chama as duas functions**

```bash
grep -rn "lead-capture\|validate-email-domain" frontend/src backend/app
```

Esperado: nenhuma **chamada**. Campos `id:` e comentários "era a function X" não
contam — mas confira um a um, não por contagem.

- [ ] **Passo 3: abrir e conferir no navegador**

⚠️ **O Chrome desta máquina não alcança servidor rodando no sandbox do agente.**
Se a conferência ao vivo não for possível de dentro, **peça ao Erick** — não
conclua o portão sem ela, e não invente um substituto por leitura de código.

```bash
cd backend && ./.venv/bin/python -m uvicorn app.main:app --port 8100 --reload
cd frontend && npm run build:landing
```

Crie uma página de teste (a tela de Páginas não cria a primeira — use
`POST /publico/paginas` com chave de escrita), ative-a, e abra
`http://127.0.0.1:8100/p/<slug>`. Confira, clicando:

- [ ] a página carrega, com headline e CTA da config
- [ ] o `<title>` e as `og:*` estão no **HTML cru** (`curl` e leia, não confie na aba)
- [ ] enviar o formulário redireciona para o `redirect_url`
- [ ] **o contato aparece na tela de Contatos, com score e etiqueta**
- [ ] a conversão aparece na ficha do contato
- [ ] enviar de novo o mesmo e-mail não cria contato duplicado
- [ ] e-mail `@mailinator.com` é recusado, com mensagem legível
- [ ] apagar a página e o contato de teste pela tela

- [ ] **Passo 4: a captura ainda FAZ O QUE FAZIA**

Compare com a function apagada — `git show HEAD:backend/supabase/functions/lead-capture/index.ts`
— capacidade por capacidade: higienização por lista branca · upsert por e-mail ·
adoção do `session_id` · reativação de contato excluído com evento ·
`resolve_or_create_identity` com escrita de volta de `dnia_id` e
`phone_normalized` · `tipo` padrão `'lead'`.

⚠️ **Duas capacidades saem de propósito** e devem aparecer no relatório como
decisão, não como regressão: `mode: "update_only"` e a projeção do lead na
resposta (agora não se devolve nada).

- [ ] **Passo 5: só então, apagar as duas functions**

```bash
git rm -r backend/supabase/functions/lead-capture \
          backend/supabase/functions/validate-email-domain
```

- [ ] **Passo 6: a suíte e a tipagem**

```bash
cd backend && ./.venv/bin/pytest -q      # ⚠️ timeout ≥600s
cd frontend && npx tsc --noEmit && npx vite build && npm run build:landing
```

- [ ] **Passo 7: commit**

```bash
git commit -m "chore(A): o portão fecha — lead-capture e validate-email-domain saem

Placar da pasta de especificação: 36 portadas, 7 descartadas, restam 11."
```

---

### Task 9: O CONTINUAR-AQUI

- [ ] **Passo 1: medir**

```bash
python3 -c "
import pathlib, re
n = sum(len(re.findall(r'supabase\s*\.?\s*\n?\s*\.(from|rpc)\(', f.read_text()))
        for f in pathlib.Path('frontend/src').rglob('*.ts*')
        if 'integrations/supabase' not in str(f))
print(n, 'pontos pelo script')"
grep -rn "supabase as any\|= supabase;" frontend/src --include=*.ts --include=*.tsx
ls backend/supabase/functions/
```

- [ ] **Passo 2: escrever a seção do subprojeto A**

O documento precisa dizer:

1. **Placar: 36 portadas, 7 descartadas, restam 11.**
2. **O toco continua vivo** — os 9 pontos do alias nas telas de Experiments não
   mudaram, e este subprojeto não os toca.
3. **A landing nasce sem oferta decidida.** Ela é motor dirigido por
   `pages.config`; o conteúdo é decisão do Nicholson. E **um template de página
   única não estica para diagnóstico multi-etapa** — se a oferta for essa, é
   outra construção.
4. **Duas capacidades saíram de propósito:** `mode: "update_only"` e a projeção
   do lead na resposta da captura.
5. **Faltam B e C:** a imagem OG (e `pages.config` ainda não tem campo para ela)
   e o teste A/B, que segue esperando conta Cloudflare.

- [ ] **Passo 3: acrescentar à lista do Erick, a partir do item 22**

⚠️ Os itens 1 a 21 já existem e **o Erick se refere a eles por número** — não
renumere nem remova.

22. **A oferta da landing** — o que o lead ganha ao preencher. Decisão do
    Nicholson; até ela existir, a landing mostra os textos padrão.
23. **Os sete campos da dn.ia na lista branca da captura**
    (`tipo_participante`, `presenca`, `indicacao`, `interesse_formacao`,
    `interesse_ecossistema`, `interesse_mtia`, `data_interesse`) — funil de
    evento e mentoria que a HS não tem. Ficam porque as colunas existem e
    integrador externo pode estar mandando. Tirá-los é decisão de negócio.
24. **A URL pública da landing** — hoje `/p/{slug}` no backend. A URL limpa do
    anúncio depende do host de produção, que é o item 11.

- [ ] **Passo 4: commit**

```bash
git add docs/CONTINUAR-AQUI.md
git commit -m "docs: o subprojeto A fechado — a landing existe e captura"
```

---

## Autorrevisão deste plano

**Cobertura da spec.** §5.1 casca HTML → Task 4. §5.2 config embutida → Task 4.
§5.3 segunda entrada do Vite → Tasks 5 e 6. §5.4 captura com conversão → Task 3.
§5.5 e-mail *fail-open*, gratuito nunca bloqueado → Task 1. §5.6 o que já existe
→ consumido nas Tasks 3 e 4, listado em "O que já existe". §5.7 colunas de A/B
viajando → Task 6 (`utmDaUrl`) e Task 3 (o INSERT). §6 abuso → o limite de taxa
vem de graça por a rota estar sob `/publico`, declarado na Task 3. §7
verificação e portão → Tasks 3, 4 e 8.

**Sem placeholders.** Todo passo de código tem código. O único passo que pede
julgamento é o CSS da Task 6, e ele traz critério objetivo (legível no celular,
alvo de toque de 44px, contraste com a `cta_color`) em vez de "estilize
apropriadamente".

**Consistência de tipos.** `validar_dominio` devolve `(bool, str | None)` na
Task 1 e é consumida com essa forma na Task 3. `higienizar(dict) -> dict` idem.
`ConfigDaPagina` é definida na Task 6 e importada na Task 5 — ⚠️ **a Task 5 é
escrita antes e o build dela falha de propósito**, o que está declarado no seu
Passo 4.

**O que este plano assume e pode estar errado:** que
`resolve_or_create_identity` tem a assinatura de sete parâmetros que a function
usava e devolve `dnia_id` e `phone_normalized`. A Task 3 manda conferir no banco
antes de escrever, e tratar o banco como autoridade.
