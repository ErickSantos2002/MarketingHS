# MarketingHS — Lote 8C: Teste A/B — Plano

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para executar tarefa a tarefa.
> Os passos usam caixa de seleção (`- [ ]`) para acompanhamento.

**Objetivo:** portar o módulo de teste A/B inteiro — o redirecionador (`go`), o
coletor de eventos (`ab-events`), as três telas de Experiments e o `ab.js` —
e **devolver ao servidor a costura e as conversões do A/B que os lotes 1D e 7
cortaram sem perceber**, para que o funil volte a registrar conversão.

**Arquitetura:** dois routers novos. `app/routers/ab.py` (`/ab`, admin) é o que
as telas faziam direto no banco pelo alias `const db = supabase as any`.
`app/routers/ab_publico.py` (`/publico/ab`) é o redirecionador e o coletor,
públicos, com gravação em `BackgroundTasks` (o `waitUntil` da origem). As regras
puras (domínio, user-agent, sorteio, normalização de evento) ficam num pacote
`app/ab/`, e a costura do `_shared/ab.ts` vira `app/ab/costura.py`, chamada por
`/publico/identidade`, `/publico/evento-de-contato`, `/publico/conversao` e
`/publico/captura`. A configuração que morava no `localStorage` vai para
`ab_config` (migration 017).

**Stack:** FastAPI + asyncpg · pytest · React 18 + TanStack Query

**Spec:** `docs/superpowers/specs/2026-08-31-marketinghs-design.md`
**Documento-mãe:** `docs/superpowers/plans/2026-09-10-marketinghs-lote-8-fechamento.md`

---

## Restrições globais

Valem para **toda** tarefa deste plano.

- **`sessao()` é o único caminho para dado.** Nunca superusuário.
- **Rota de admin:** `Depends(admin_atual)` + `sessao(role="authenticated",
  user_id=usuario.id)`. As cinco tabelas `ab_*` são admin-only por RLS
  (`001_schema_origem.sql:4673-4715`): sob `anon`, ou com usuário sem o papel,
  a query devolve **zero linhas, sem erro**. `ab_activate_test` confere
  `has_role(auth.uid(), 'admin')` por dentro — sem `user_id` na sessão ela
  levanta `permission denied`.
- **Rota pública e escrita em segundo plano:** `sessao(role="service_role")`.
  Não há usuário; quem autoriza é a natureza da rota (pública por desenho),
  como `/publico/captura`.
- **Nenhum endpoint depende do RLS para autorizar.**
- **O papel é `'admin'`** (enum `public.app_role` = `admin`, `user`).
- **Toda chave lida do ambiente precisa estar declarada em `Settings`.** Este
  plano não lê chave nova.
- **Comentário, nome e mensagem em português.** Chaves de resposta do coletor
  como na origem (`accepted`, `skipped`); das rotas de admin, como as colunas
  do banco (a tela já usa esses nomes).
- **Colunas de INSERT/UPDATE vêm de lista fechada no código**, nunca das chaves
  do corpo.
- ⚠️ **asyncpg é estrito com tipo:** `str` num parâmetro `timestamptz` estoura
  antes de chegar ao banco. Data que chega como texto vai com
  `$n::text::timestamptz` (padrão de `publico.py:1133`).
- ⚠️ **`contact_events` alimenta as jornadas** (`trg_contact_event_journey`
  copia cada linha para `journey_events`, que não tem FK). Teste que cria evento
  de contato apaga o `journey_events` correspondente.
- ⚠️ **Os testes gravam no banco real.** Fixture que usa o `cliente` limpa o que
  escreveu, **antes e depois**. **Nunca mate o pytest no meio.** Timeout ≥600s
  na suíte inteira; rode em primeiro plano.
- ⚠️ **`ab_config` é uma linha só e é a configuração de produção.** Teste que a
  altera guarda o que havia e devolve no fim (fixture `config_ab`, Tarefa 1).
- **`pytest.ini` tem `asyncio_mode = auto`.**
- **Migration nova se aplica sozinha, e duas vezes** (`CLAUDE.md`, seção
  Comandos). `aplicar-migrations.sh` **não** — ele morre na 001.
- **Frontend:** `cd frontend && npx tsc --noEmit -p tsconfig.app.json && npx vite build`
  tem de passar ao fim de cada tarefa que mexe em `frontend/`.

---

## O que a leitura achou (21/09/2026)

Estes achados mudam o escopo em relação ao documento-mãe, que listava só `go`,
`ab-events`, três telas, `lib/ab.ts` e `public/ab.js`.

1. **O funil do A/B não registra conversão nenhuma hoje, e ninguém percebe.**
   Quem gravava conversão eram três caminhos, e os três foram portados sem ela:
   - `identity-upsert` e `receive-contact-event` chamavam
     `_shared/ab.ts` (`attachVisitorToContact`, `recordConversion`) — portados
     no lote 1D (`7a2a1b2`) como `/publico/identidade` e
     `/publico/evento-de-contato`, **sem a costura**. A conversão `agendamento`
     sumiu.
   - `frontend/src/lib/leadConversion.ts:50` chamava
     `recordAbConversion("lead_criado")` — apagado no lote 7 (`46f2a07`) quando
     `/publico/conversao` assumiu. **A rota nova grava `ab_*` em
     `lead_conversions` mas não em `ab_events`.** A conversão `lead_criado`
     (a métrica primária padrão de todo teste) sumiu.

   A tela de relatório mostraria exposição e **zero conversão** — que parece
   variante ruim, não defeito. É o corte silencioso do `CLAUDE.md` pela quarta
   vez, e ele passa pelos quatro passos do portão porque nenhuma TELA mudou.

2. **`frontend/src/lib/ab.ts` não tem importador** desde `46f2a07`. É código
   morto que ainda importa o toco.

3. **`ab_config.production_domain` tem `DEFAULT 'dnia.ai'`** no banco. A
   primeira linha criada sem domínio validaria as variantes contra o domínio de
   outra empresa.

4. **O domínio do redirecionador mora no `localStorage`** de cada navegador
   (`lib/abConfig.ts:9`, padrão `https://go.dnia.ai`): cada admin pode ver um
   link de distribuição diferente.

5. **O CORS global recusaria o coletor.** `CORSMiddleware` só aceita
   `FRONTEND_URL`; o coletor é chamado das landing pages, em outro domínio. E o
   `ab.js` manda `application/json` por `sendBeacon`, o que exige preflight.

6. **As cinco tabelas `ab_*` estão vazias** (medido em 21/09/2026). Não há dado
   a migrar nem a preservar.

---

## Decisões tomadas neste plano

| # | Decisão | Motivo |
|---|---|---|
| 1 | **`go` vira `GET /publico/ab/go/{public_slug}` (e `GET /publico/ab/go?t=`); `ab-events` vira `POST /publico/ab/eventos`.** O Worker do Cloudflare aponta para elas. | Regra do Erick de 10/09: dependência de terceiro não bloqueia portar. O Worker é configuração, e seu código já é gerado pela tela de Configuração. |
| 2 | **Destino de reserva = `https://{domínio de produção}`.** Sem domínio configurado, **404 curto em texto**. | A origem usava `AB_FALLBACK_URL` com padrão `https://dnia.ai`. Uma chave de ambiente a mais por um valor que já está em `ab_config` não compensa. Sem configuração não há para onde mandar. |
| 3 | **Cookie com `Domain=.{domínio de produção}`**; sem domínio, cookie só do host. | A origem cravava `.dnia.ai`. |
| 4 | **Migration 017:** `production_domain` perde o `DEFAULT 'dnia.ai'` e o `NOT NULL`; nasce `redirector_base`; índice único em `(true)` faz da tabela uma linha só. | Achados 3 e 4. NULL é "não configurado", e a tela manda configurar. |
| 5 | **O coletor tem CORS próprio** (middleware só para `/publico/ab/eventos`, `Access-Control-Allow-Origin: *`) **e o `ab.js` passa a mandar `text/plain`.** | Achado 5. Com `text/plain` não há preflight e o `sendBeacon` aceita sem ressalva; o middleware cobre quem ainda manda JSON (o agendamento). O corpo não carrega credencial, então `*` não expõe nada. |
| 6 | **O redirecionador fica isento do limite de taxa; o coletor, não.** O Worker repassa o IP real (`X-Forwarded-For` ← `CF-Connecting-IP`). | Clique de anúncio nunca pode levar 429 — a origem mandava pôr o limite na camada do Cloudflare. O coletor é escrita anônima: fica sob os 30/min por IP, que comportam os ~7 eventos de uma visita. Sem repassar o IP, todo visitante chegaria com o IP do Cloudflare. |
| 7 | **A costura e as duas conversões voltam, no servidor:** costura em `/publico/identidade` e `/publico/evento-de-contato`; `agendamento` em `/publico/evento-de-contato`; `lead_criado` em `/publico/conversao` **e** em `/publico/captura`. | Achado 1. `/publico/captura` entra porque é o caminho da landing do lote 7 — que substituiu o `leadConversion.ts`. |
| 8 | **A costura roda num SAVEPOINT e nunca propaga erro.** | Na origem ela era "não bloqueante" porque rodava fora de transação. Aqui roda dentro da transação de quem chama: um erro de SQL abortaria a transação e levaria junto o contato, o evento ou a conversão. |
| 9 | **Teste só nasce `draft`, e `PATCH` não aceita `status = running`.** Ativar é só por `POST /ab/testes/{id}/ativar`. | A tela sempre cria rascunho e sempre ativa pela RPC `ab_activate_test`, que é quem garante um teste rodando por slug. Aceitar `running` no PATCH seria um caminho que pula essa garantia e estoura no índice único. |
| 10 | **Eventos do relatório: teto de 20.000, com aviso `truncado`.** | É o teto da origem (`useAbEvents` paginava até 20.000). O lote 6 já cortou um teto desses para 500 sem perceber; padrão de `/painel/agendamentos`. |
| 11 | **`occurred_at` inválido vira "agora" e `lead_id` inválido vira nulo**, em vez de perder o evento. | Na origem, o texto ia cru para colunas `timestamptz`/`uuid`, o insert falhava e o evento era descartado com um log. |
| 12 | **`lib/ab.ts` é apagado.** | Achado 2. A landing do lote 7 já lê `ab_*` da URL (`landing/Formulario.tsx:24`) e manda na captura, que agora registra a conversão. |
| 13 | **`ab.js` sem nenhum padrão da dn.ia:** `data-endpoint` passa a ser obrigatório; domínio do cookie e iframe de agendamento viram atributos (`data-cookie-domain`, `data-iframe-match`). | O iframe reescrito era `nexus.dnia.ai/schedule`, fixo. |
| 14 | **A seção "dn.nexus" da tela de Configuração fica como está.** | Nexus → GrowthHS é o 8D. Mexer nela aqui seria decidir o 8D por antecipação. |
| 15 | **Peso ≤ 0 ou ausente vale 1**, como na origem. | ⚠️ A tela deixa digitar peso 0 esperando "0% do tráfego", e a origem dava peso 1. É comportamento herdado, preservado; fica registrado como pergunta ao Erick no portão. |

---

## O que já existe e não se reimplementa

- `ab_activate_test(uuid, boolean)` — a ativação atômica, no banco
  (`001_schema_origem.sql:36-89`). A rota só chama.
- `uq_ab_tests_public_slug_running` (um `running` por slug) e
  `uq_ab_events_dedupe` (idempotência dos eventos) — índices da origem. Não
  relaxe nenhum dos dois.
- O codec de `jsonb` do pool (`app/database.py:17`): dict/list entram e saem
  como Python.
- `token_admin` e `chave_de` (`tests/conftest.py`).
- `lib/abStats.ts` — estatística do relatório. Não fala com o banco; fica.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `backend/migrations/017_ab_config.sql` (novo) | `ab_config` sem a dn.ia, com `redirector_base` e linha única |
| `backend/app/ab/__init__.py` (novo) | pacote |
| `backend/app/ab/dominio.py` (novo) | regras puras: domínio, user-agent, sorteio |
| `backend/app/ab/eventos.py` (novo) | normalização de evento, chave de dedupe, `inserir()` |
| `backend/app/ab/costura.py` (novo) | porte de `_shared/ab.ts` |
| `backend/app/routers/ab.py` (novo) | `/ab` — admin: testes, ativação, eventos, config |
| `backend/app/routers/ab_publico.py` (novo) | `/publico/ab` — redirecionador e coletor |
| `backend/app/middleware/cors_coletor.py` (novo) | CORS só do coletor |
| `backend/app/main.py` | registra routers e middleware; isenta o redirecionador do limite |
| `backend/app/routers/publico.py` | costura em `/identidade` e `/evento-de-contato`; `lead_criado` em `/conversao` |
| `backend/app/routers/captura.py` | `lead_criado` em `/captura` |
| `backend/tests/conftest.py` | fixtures `token_usuario`, `config_ab`, `limpar_ab` |
| `backend/tests/test_ab_dominio.py` (novo) | regras puras |
| `backend/tests/test_ab_admin.py` (novo) | rotas `/ab` |
| `backend/tests/test_ab_publico.py` (novo) | redirecionador e coletor |
| `backend/tests/test_ab_costura.py` (novo) | costura, `agendamento`, identidade |
| `backend/tests/test_conversao.py`, `test_captura.py` | um teste de `lead_criado` em cada |
| `frontend/src/lib/abConfig.ts` | sem `localStorage`, sem padrão da dn.ia |
| `frontend/src/hooks/useAbConfig.tsx`, `useAbTests.tsx` | falam com `/ab` |
| `frontend/src/pages/admin/Experiments.tsx`, `ExperimentDetail.tsx`, `ExperimentsSetup.tsx` | usam a config do banco |
| `frontend/public/ab.js` | sem padrão da dn.ia, `text/plain` |
| `frontend/src/lib/ab.ts` | **apagado** |

---

### Tarefa 1: Configuração do A/B — migration 017 e `GET|PUT /ab/config`

**Files:**
- Create: `backend/migrations/017_ab_config.sql`
- Create: `backend/app/ab/__init__.py`, `backend/app/ab/dominio.py`
- Create: `backend/app/routers/ab.py`
- Modify: `backend/app/main.py` (registrar o router)
- Modify: `backend/tests/conftest.py` (fixtures `token_usuario`, `config_ab`)
- Test: `backend/tests/test_ab_dominio.py`, `backend/tests/test_ab_admin.py`

**Interfaces:**
- Produces: `app.ab.dominio.normalizar_dominio(entrada: str | None) -> str`,
  `host_no_dominio(host: str | None, dominio: str | None) -> bool`,
  `ler_user_agent(ua: str | None) -> dict` (chaves `device_type`, `os`,
  `browser`, `browser_version`), `sortear(variantes: list[dict], aleatorio:
  Callable[[], float] | None = None) -> dict`.
- Produces: `app.routers.ab.router` (prefixo `/ab`), com `GET /ab/config` →
  `{"production_domain": str | None, "redirector_base": str | None}` e
  `PUT /ab/config` (corpo parcial, mesma resposta).
- Produces (conftest): `token_usuario` (JWT de usuário com papel `user`),
  `config_ab` (fábrica `await config_ab(dominio, base=None)`, devolve a linha
  original no teardown).

- [ ] **Step 1: Escrever a migration**

`backend/migrations/017_ab_config.sql`:

```sql
-- 017 — `ab_config` deixa de apontar para a dn.ia e guarda o redirecionador.
--
-- ⚠️ O DEFAULT 'dnia.ai' de `production_domain` veio da origem: com ele, a
-- primeira linha criada sem domínio validaria as variantes dos testes contra
-- o domínio de outra empresa. Sem default e sem NOT NULL, "não configurado" é
-- NULL, e a tela manda configurar.
--
-- `redirector_base` morava no localStorage de cada navegador (chave
-- `ab-redirector-base`, padrão https://go.dnia.ai): cada admin podia ver um
-- link de distribuição diferente. Vira coluna, compartilhada pelo time.
--
-- O índice em `(true)` faz da tabela uma linha só, e é o alvo do ON CONFLICT
-- de `PUT /ab/config`. A tabela estava vazia em 21/09/2026, então criá-lo não
-- esbarra em linha duplicada.
--
-- Reaplicável: rode duas vezes para provar.

ALTER TABLE public.ab_config ALTER COLUMN production_domain DROP DEFAULT;
ALTER TABLE public.ab_config ALTER COLUMN production_domain DROP NOT NULL;
ALTER TABLE public.ab_config ADD COLUMN IF NOT EXISTS redirector_base text;
CREATE UNIQUE INDEX IF NOT EXISTS ab_config_linha_unica ON public.ab_config ((true));
```

- [ ] **Step 2: Aplicar duas vezes**

```bash
cd /home/ericks/github/MarketingHS
set -a; . ~/marketinghs.env; set +a
for i in 1 2; do PGPASSWORD="$POSTGRES_PASSWORD" psql \
  "postgresql://${POSTGRES_USER}@${POSTGRES_HOST_EXTERNO}:${POSTGRES_PORTA_EXTERNA}/${POSTGRES_DB}" \
  -v ON_ERROR_STOP=1 -f backend/migrations/017_ab_config.sql; done
```

Esperado: as duas rodadas terminam sem erro (a segunda com `NOTICE ... already exists, skipping`).

- [ ] **Step 3: Escrever os testes das regras puras**

`backend/tests/test_ab_dominio.py`:

```python
"""As regras puras do A/B — o que decide para onde vai o clique do anúncio.

O modo de falhar é mandar o clique para fora do domínio (reprovação por
"Destination mismatch" no Google/Meta) ou sortear fora do peso combinado.
Nenhum dos dois aparece na tela: o anúncio só deixa de rodar.
"""

from app.ab.dominio import host_no_dominio, ler_user_agent, normalizar_dominio, sortear


def test_normaliza_o_que_o_admin_digita():
    assert normalizar_dominio(" https://www.Exemplo.com.br/lp?x=1 ") == "exemplo.com.br"
    assert normalizar_dominio("exemplo.com:8080") == "exemplo.com"
    assert normalizar_dominio("exemplo.com.") == "exemplo.com"
    assert normalizar_dominio(None) == ""


def test_subdominio_pertence_e_sufixo_parecido_nao():
    assert host_no_dominio("exemplo.com", "exemplo.com")
    assert host_no_dominio("promo.exemplo.com", "https://www.exemplo.com")
    assert not host_no_dominio("exemplo.com.evil.io", "exemplo.com")
    assert not host_no_dominio("outroexemplo.com", "exemplo.com")
    assert not host_no_dominio("exemplo.com", "")


IPHONE = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
          "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
CHROME_WIN = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
TABLET_ANDROID = ("Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")


def test_user_agent():
    assert ler_user_agent(IPHONE) == {"device_type": "mobile", "os": "iOS",
                                      "browser": "Safari", "browser_version": "17.0"}
    assert ler_user_agent(CHROME_WIN) == {"device_type": "desktop", "os": "Windows",
                                          "browser": "Chrome", "browser_version": "128.0.0.0"}
    assert ler_user_agent(CHROME_WIN + " Edg/128.0.1.2")["browser"] == "Edge"
    assert ler_user_agent(TABLET_ANDROID)["device_type"] == "tablet"
    assert ler_user_agent(TABLET_ANDROID)["os"] == "Android"
    assert ler_user_agent(None) == {"device_type": "desktop", "os": "unknown",
                                    "browser": "unknown", "browser_version": ""}


def test_sorteio_respeita_o_peso():
    variantes = [{"key": "A", "weight": 30}, {"key": "B", "weight": 70}]
    assert sortear(variantes, lambda: 0.0)["key"] == "A"
    assert sortear(variantes, lambda: 0.29)["key"] == "A"
    assert sortear(variantes, lambda: 0.31)["key"] == "B"


def test_peso_zero_ou_ausente_vale_um_como_na_origem():
    """⚠️ A tela deixa digitar 0 esperando "sem tráfego"; a origem dava peso 1.
    Preservado de propósito — decisão 15 do plano, pergunta ao Erick."""
    variantes = [{"key": "A", "weight": 0}, {"key": "B"}]
    assert sortear(variantes, lambda: 0.49)["key"] == "A"
    assert sortear(variantes, lambda: 0.51)["key"] == "B"
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_ab_dominio.py`
Esperado: FAIL com `ModuleNotFoundError: No module named 'app.ab'`.

- [ ] **Step 5: Escrever `app/ab/`**

`backend/app/ab/__init__.py`:

```python
"""Teste A/B — o que eram as functions `go`, `ab-events` e `_shared/ab.ts`."""
```

`backend/app/ab/dominio.py`:

```python
"""Regras puras do teste A/B: domínio, user-agent e sorteio. Sem banco.

Porte de `backend/supabase/functions/go/index.ts` e `ab-events/index.ts`, que
tinham cada uma a sua cópia destas funções (Edge Function não importava de
`src/`). O frontend tem o espelho da parte de domínio em `lib/abConfig.ts`.
"""

import random
import re
from collections.abc import Callable


def normalizar_dominio(entrada: str | None) -> str:
    """Sem protocolo, sem `www.`, sem caminho/porta/query, minúsculo."""
    s = (entrada or "").strip().lower()
    s = re.sub(r"^https?://", "", s)
    s = re.sub(r"^www\.", "", s)
    s = re.sub(r"[/:?#].*$", "", s)
    return re.sub(r"\.+$", "", s)


def host_no_dominio(host: str | None, dominio: str | None) -> bool:
    """`host` é o próprio domínio ou um subdomínio dele?

    `promo.exemplo.com` em `exemplo.com`, sim; `exemplo.com.evil.io`, não.
    """
    h = (host or "").lower()
    d = normalizar_dominio(dominio)
    if not d or not h:
        return False
    return h == d or h.endswith("." + d)


# (padrão, nome). A ORDEM importa e é a da origem: iPhone tem "Mac OS X" no
# user-agent, e Edge tem "Chrome/".
_SISTEMAS = ((r"Windows NT", "Windows"), (r"iPhone|iPad|iPod", "iOS"),
             (r"Mac OS X", "macOS"), (r"Android", "Android"), (r"Linux", "Linux"))
_NAVEGADORES = ((r"Edg/", "Edge", r"Edg/([\d.]+)"),
                (r"OPR/|Opera", "Opera", r"(?:OPR|Opera)/([\d.]+)"),
                (r"Chrome/", "Chrome", r"Chrome/([\d.]+)"),
                (r"Firefox/", "Firefox", r"Firefox/([\d.]+)"),
                (r"Safari/", "Safari", r"Version/([\d.]+)"))


def ler_user_agent(ua: str | None) -> dict:
    """Leitura leve, no servidor. A resolução de tela chega depois, pelo coletor."""
    s = ua or ""
    if re.search(r"\bMobile\b|Android.+Mobile|iPhone|iPod|Windows Phone", s, re.I):
        aparelho = "mobile"
    elif re.search(r"\biPad\b|Tablet|Android(?!.*Mobile)", s, re.I):
        aparelho = "tablet"
    else:
        aparelho = "desktop"

    sistema = next((nome for padrao, nome in _SISTEMAS if re.search(padrao, s, re.I)),
                   "unknown")

    navegador, versao = "unknown", ""
    for padrao, nome, padrao_versao in _NAVEGADORES:
        if re.search(padrao, s, re.I):
            achado = re.search(padrao_versao, s, re.I)
            navegador, versao = nome, achado.group(1) if achado else ""
            break

    return {"device_type": aparelho, "os": sistema, "browser": navegador,
            "browser_version": versao}


def _peso(variante: dict) -> float:
    """⚠️ Peso ausente, não numérico ou <= 0 vale 1 — como na origem."""
    peso = variante.get("weight")
    if isinstance(peso, bool) or not isinstance(peso, (int, float)) or peso <= 0:
        return 1
    return peso


def sortear(variantes: list[dict],
            aleatorio: Callable[[], float] | None = None) -> dict:
    """Sorteio por peso. `aleatorio` existe para o teste; o padrão é
    `random.random`, lido na hora da chamada (e não na definição) para que o
    `monkeypatch` do teste alcance."""
    aleatorio = aleatorio or random.random
    pesos = [_peso(v) for v in variantes]
    r = aleatorio() * sum(pesos)
    for variante, peso in zip(variantes, pesos):
        r -= peso
        if r < 0:
            return variante
    return variantes[-1]
```

- [ ] **Step 6: Rodar e ver passar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_ab_dominio.py`
Esperado: `5 passed`.

- [ ] **Step 7: Acrescentar as fixtures ao `conftest.py`**

No fim de `backend/tests/conftest.py`:

```python
@pytest_asyncio.fixture
async def token_usuario():
    """JWT de um usuário SEM papel de admin — para provar os 403.

    ⚠️ Sem esta prova, uma rota que esquecesse o `admin_atual` passaria: o
    usuário comum levaria zero linhas do RLS, não erro, e ninguém notaria.
    """
    from app.auth.security import emitir_token, gerar_hash

    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")
    email = "usuario-teste-8c@exemplo.invalid"

    async def limpar():
        async with db.sessao(role="service_role") as conn:
            await conn.execute(
                "DELETE FROM public.user_roles WHERE user_id IN "
                "(SELECT id FROM auth.users WHERE email = $1)", email)
            await conn.execute("DELETE FROM auth.users WHERE email = $1", email)

    await limpar()
    async with db.sessao(role="service_role") as conn:
        uid = await conn.fetchval(
            "INSERT INTO auth.users (email, password_hash) VALUES ($1, $2) "
            "RETURNING id::text", email, gerar_hash("senha-de-teste-8c"))
        await conn.execute(
            "INSERT INTO public.user_roles (user_id, role) VALUES ($1::uuid, 'user')", uid)
    token, _ = emitir_token(uid, "user", email)
    yield token
    await limpar()


@pytest_asyncio.fixture
async def config_ab():
    """Põe `ab_config` num estado conhecido: `await config_ab("exemplo.invalid")`.

    ⚠️ `ab_config` é UMA linha, global — é a configuração de PRODUÇÃO do A/B.
    A fixture guarda o que havia e devolve no teardown, mesmo que o teste
    falhe. `config_ab(None)` deixa a tabela vazia (nada configurado).
    """
    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")
    async with db.sessao(role="service_role") as conn:
        antes = await conn.fetchrow(
            "SELECT production_domain, redirector_base FROM ab_config LIMIT 1")

    async def gravar(dominio, base=None):
        async with db.sessao(role="service_role") as conn:
            await conn.execute("DELETE FROM ab_config")
            if dominio is not None or base is not None:
                await conn.execute(
                    "INSERT INTO ab_config (production_domain, redirector_base) "
                    "VALUES ($1, $2)", dominio, base)

    yield gravar
    await gravar(antes["production_domain"] if antes else None,
                 antes["redirector_base"] if antes else None)


# Tudo o que os testes do 8C gravam em `ab_*` começa com isto — é o que a
# limpeza apaga. `ab_vid` de teste começa com "v_teste8c".
PREFIXO_AB = "teste-8c"


@pytest_asyncio.fixture
async def limpar_ab():
    """Apaga, antes e depois, o que os testes do A/B gravaram."""
    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")

    async def limpar():
        async with db.sessao(role="service_role") as conn:
            for tabela in ("ab_events", "ab_assignments"):
                await conn.execute(f"DELETE FROM {tabela} WHERE ab_test LIKE $1",
                                   PREFIXO_AB + "%")
            await conn.execute("DELETE FROM ab_identities WHERE ab_vid LIKE 'v_teste8c%'")
            await conn.execute("DELETE FROM ab_tests WHERE public_slug LIKE $1",
                               PREFIXO_AB + "%")

    await limpar()
    yield PREFIXO_AB
    await limpar()
```

- [ ] **Step 8: Escrever os testes da configuração**

`backend/tests/test_ab_admin.py`:

```python
"""As rotas de admin do A/B — o que as telas de Experiments faziam direto no
banco pelo alias `const db = supabase as any`.

O modo de falhar é o do `CLAUDE.md`: permissão errada devolve NADA, não erro.
Um admin veria testes; um usuário comum veria uma tela vazia e acharia que
ninguém criou teste. Por isso o primeiro teste prova o 403.
"""

from uuid import uuid4

import app.database as db

ALGUM_ID = str(uuid4())


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def test_rotas_de_ab_exigem_admin(cliente, token_usuario):
    rotas = [("GET", "/ab/config", None), ("PUT", "/ab/config", {"production_domain": "x.com"})]
    for metodo, caminho, corpo in rotas:
        r = await cliente.request(metodo, caminho, json=corpo, headers=_auth(token_usuario))
        assert r.status_code == 403, (metodo, caminho, r.text)


async def test_config_vazia_devolve_nulos(cliente, token_admin, config_ab):
    await config_ab(None)
    r = await cliente.get("/ab/config", headers=_auth(token_admin))
    assert r.status_code == 200
    assert r.json() == {"production_domain": None, "redirector_base": None}


async def test_config_normaliza_o_dominio_e_grava_parcial(cliente, token_admin, config_ab):
    await config_ab(None)
    r = await cliente.put("/ab/config", headers=_auth(token_admin),
                          json={"production_domain": " https://www.Exemplo.invalid/lp "})
    assert r.status_code == 200, r.text
    assert r.json() == {"production_domain": "exemplo.invalid", "redirector_base": None}

    # Só o redirecionador: o domínio fica como estava.
    r = await cliente.put("/ab/config", headers=_auth(token_admin),
                          json={"redirector_base": "https://go.exemplo.invalid/"})
    assert r.json() == {"production_domain": "exemplo.invalid",
                        "redirector_base": "https://go.exemplo.invalid"}

    async with db.sessao(role="service_role") as conn:
        assert await conn.fetchval("SELECT count(*) FROM ab_config") == 1


async def test_config_recusa_dominio_vazio_e_redirecionador_sem_protocolo(
        cliente, token_admin, config_ab):
    await config_ab(None)
    r = await cliente.put("/ab/config", headers=_auth(token_admin),
                          json={"production_domain": "   "})
    assert r.status_code == 422
    r = await cliente.put("/ab/config", headers=_auth(token_admin),
                          json={"redirector_base": "go.exemplo.invalid"})
    assert r.status_code == 422
```

- [ ] **Step 9: Rodar e ver falhar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_ab_admin.py`
Esperado: FAIL — `/ab/config` devolve 404.

- [ ] **Step 10: Escrever o router com a configuração**

`backend/app/routers/ab.py`:

```python
"""O módulo de teste A/B no admin — o que as telas de Experiments faziam
direto no banco, pelo alias `const db = supabase as any`.

⚠️ As cinco tabelas `ab_*` são admin-only por RLS (`has_role(auth.uid(),
'admin')`, `001_schema_origem.sql:4673-4715`). Por isso toda rota é
`admin_atual` — um autenticado sem o papel levaria zero linhas, não erro — e
roda em `sessao(role="authenticated", user_id=...)`, que é o que põe o id em
`auth.uid()`. `ab_activate_test` confere o mesmo papel por dentro.
"""

import re

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator

from app.ab.dominio import normalizar_dominio
from app.database import sessao
from app.dependencies import Usuario, admin_atual

router = APIRouter(prefix="/ab", tags=["ab"])


class ConfigAbIn(BaseModel):
    production_domain: str | None = None
    redirector_base: str | None = None

    @field_validator("redirector_base")
    @classmethod
    def _endereco_completo(cls, valor):
        """Vazio apaga; o resto precisa do protocolo — é o que monta o link
        que o time cola no anúncio."""
        if valor is None or not valor.strip():
            return None
        valor = valor.strip().rstrip("/")
        if not re.match(r"^https?://[^/\s]+", valor, re.I):
            raise ValueError("use o endereço completo, com https://")
        return valor


@router.get("/config")
async def ler_config(usuario: Usuario = Depends(admin_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            "SELECT production_domain, redirector_base FROM ab_config LIMIT 1")
    if linha is None:
        return {"production_domain": None, "redirector_base": None}
    return dict(linha)


@router.put("/config")
async def gravar_config(dados: ConfigAbIn, usuario: Usuario = Depends(admin_atual)):
    """Grava só o que veio. A tabela é uma linha só (índice em `(true)`,
    migration 017), e é ele o alvo do ON CONFLICT."""
    enviados = dados.model_dump(exclude_unset=True)
    if "production_domain" in enviados:
        dominio = normalizar_dominio(enviados["production_domain"])
        if not dominio:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "Informe um domínio válido (ex.: exemplo.com.br).")
        enviados["production_domain"] = dominio
    if not enviados:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nada para gravar.")

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            """INSERT INTO ab_config (production_domain, redirector_base)
               VALUES ($1, $2)
               ON CONFLICT ((true)) DO UPDATE SET
                 production_domain = CASE WHEN $3 THEN EXCLUDED.production_domain
                                          ELSE ab_config.production_domain END,
                 redirector_base   = CASE WHEN $4 THEN EXCLUDED.redirector_base
                                          ELSE ab_config.redirector_base END
               RETURNING production_domain, redirector_base""",
            enviados.get("production_domain"), enviados.get("redirector_base"),
            "production_domain" in enviados, "redirector_base" in enviados)
    return dict(linha)
```

Em `backend/app/main.py`, junto dos outros imports de router:

```python
from app.routers.ab import router as ab_router
```

e, antes de `app.include_router(publico_router)`:

```python
app.include_router(ab_router)
```

- [ ] **Step 11: Rodar e ver passar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_ab_dominio.py tests/test_ab_admin.py`
Esperado: `9 passed`.

- [ ] **Step 12: Commit**

```bash
git add backend/migrations/017_ab_config.sql backend/app/ab backend/app/routers/ab.py \
        backend/app/main.py backend/tests/conftest.py backend/tests/test_ab_dominio.py \
        backend/tests/test_ab_admin.py
git commit -m "feat(8C): ab_config sem a dn.ia, com o redirecionador — GET|PUT /ab/config"
```

---

### Tarefa 2: Testes A/B no admin — listar, criar, editar, ativar, eventos

**Files:**
- Modify: `backend/app/routers/ab.py`
- Test: `backend/tests/test_ab_admin.py`

**Interfaces:**
- Consumes: `router`, `_auth`, fixtures `token_admin`, `token_usuario`, `limpar_ab` (Tarefa 1).
- Produces (usadas pela Tarefa 5, frontend):
  - `GET /ab/testes` → `list[AbTest]`, mais novo primeiro
  - `GET /ab/testes/{id}` → `AbTest` ou 404
  - `POST /ab/testes` → 201 + `AbTest` (só nasce `draft`)
  - `PATCH /ab/testes/{id}` → `AbTest` (status aceito: `draft`, `paused`, `completed`, `archived`)
  - `POST /ab/testes/{id}/ativar` corpo `{"force": bool}` → `{"activated": bool, "conflict_id"?, "conflict_name"?, "completed_id"?, "completed_name"?}`; 409 se perdeu a corrida
  - `GET /ab/testes/{id}/eventos` → `{"events": list[AbEventRow], "truncado": bool, "teto": 20000}`
  - `AbTest` tem as chaves: `id, slug, public_slug, name, hypothesis, status, variants, control_variant, winner_variant, primary_metric, guardrail_metric, target_sample_per_variant, starts_at, ends_at, created_at, updated_at`.

- [ ] **Step 1: Escrever os testes**

No topo de `backend/tests/test_ab_admin.py`, junto dos imports:

```python
import app.routers.ab as rotas_ab
```

E no fim do arquivo:

```python
VARIANTES = [{"key": "A", "url": "https://lp.exemplo.invalid/a", "weight": 50, "label": "Controle"},
             {"key": "B", "url": "https://lp.exemplo.invalid/b", "weight": 50}]


def _novo(prefixo: str, sufixo: str = "lp", **extra) -> dict:
    publico = f"{prefixo}-{sufixo}"
    return {"slug": f"{publico}-{uuid4().hex[:4]}", "public_slug": publico,
            "name": f"Teste {sufixo}", "variants": VARIANTES, "control_variant": "A",
            "starts_at": "2026-09-21", **extra}


async def _criar(cliente, token, corpo) -> dict:
    r = await cliente.post("/ab/testes", headers=_auth(token), json=corpo)
    assert r.status_code == 201, r.text
    return r.json()


async def test_rotas_de_teste_exigem_admin(cliente, token_usuario):
    rotas = [("GET", "/ab/testes", None), ("POST", "/ab/testes", {}),
             ("GET", f"/ab/testes/{ALGUM_ID}", None),
             ("PATCH", f"/ab/testes/{ALGUM_ID}", {"name": "x"}),
             ("POST", f"/ab/testes/{ALGUM_ID}/ativar", {"force": False}),
             ("GET", f"/ab/testes/{ALGUM_ID}/eventos", None)]
    for metodo, caminho, corpo in rotas:
        r = await cliente.request(metodo, caminho, json=corpo, headers=_auth(token_usuario))
        assert r.status_code == 403, (metodo, caminho, r.text)


async def test_criar_listar_e_obter(cliente, token_admin, limpar_ab):
    criado = await _criar(cliente, token_admin, _novo(limpar_ab))
    assert criado["status"] == "draft"
    assert criado["variants"][0]["label"] == "Controle"
    assert criado["starts_at"].startswith("2026-09-21")

    lista = (await cliente.get("/ab/testes", headers=_auth(token_admin))).json()
    assert criado["id"] in [t["id"] for t in lista]

    r = await cliente.get(f"/ab/testes/{criado['id']}", headers=_auth(token_admin))
    assert r.json()["public_slug"] == f"{limpar_ab}-lp"
    r = await cliente.get(f"/ab/testes/{ALGUM_ID}", headers=_auth(token_admin))
    assert r.status_code == 404


async def test_criar_recusa_status_que_nao_e_rascunho_e_slug_publico_invalido(
        cliente, token_admin, limpar_ab):
    r = await cliente.post("/ab/testes", headers=_auth(token_admin),
                           json=_novo(limpar_ab, status="running"))
    assert r.status_code == 422
    r = await cliente.post("/ab/testes", headers=_auth(token_admin),
                           json={**_novo(limpar_ab), "public_slug": "Com Espaço"})
    assert r.status_code == 422


async def test_editar_pausar_concluir_e_recusas(cliente, token_admin, limpar_ab):
    teste = await _criar(cliente, token_admin, _novo(limpar_ab))
    caminho = f"/ab/testes/{teste['id']}"

    r = await cliente.patch(caminho, headers=_auth(token_admin), json={"status": "paused"})
    assert r.status_code == 200 and r.json()["status"] == "paused"

    r = await cliente.patch(caminho, headers=_auth(token_admin), json={
        "status": "completed", "winner_variant": "B", "ends_at": "2026-09-30T12:00:00Z"})
    assert r.json()["winner_variant"] == "B"
    assert r.json()["ends_at"].startswith("2026-09-30")

    # `running` só pela ativação — decisão 9 do plano.
    r = await cliente.patch(caminho, headers=_auth(token_admin), json={"status": "running"})
    assert r.status_code == 422
    # Coluna NOT NULL não aceita nulo explícito.
    r = await cliente.patch(caminho, headers=_auth(token_admin), json={"name": None})
    assert r.status_code == 422
    r = await cliente.patch(caminho, headers=_auth(token_admin), json={"ends_at": "ontem"})
    assert r.status_code == 422
    r = await cliente.patch(f"/ab/testes/{ALGUM_ID}", headers=_auth(token_admin),
                            json={"name": "x"})
    assert r.status_code == 404


async def test_ativar_recusa_conflito_e_forca_conclui_o_anterior(
        cliente, token_admin, limpar_ab):
    primeiro = await _criar(cliente, token_admin, _novo(limpar_ab, name="Primeiro"))
    segundo = await _criar(cliente, token_admin, _novo(limpar_ab, name="Segundo"))

    r = await cliente.post(f"/ab/testes/{primeiro['id']}/ativar",
                           headers=_auth(token_admin), json={"force": False})
    assert r.status_code == 200, r.text
    assert r.json()["activated"] is True

    r = await cliente.post(f"/ab/testes/{segundo['id']}/ativar",
                           headers=_auth(token_admin), json={"force": False})
    assert r.json() == {"activated": False, "conflict_id": primeiro["id"],
                        "conflict_name": "Primeiro"}

    r = await cliente.post(f"/ab/testes/{segundo['id']}/ativar",
                           headers=_auth(token_admin), json={"force": True})
    assert r.json()["activated"] is True
    assert r.json()["completed_name"] == "Primeiro"

    anterior = (await cliente.get(f"/ab/testes/{primeiro['id']}",
                                  headers=_auth(token_admin))).json()
    assert anterior["status"] == "completed"

    r = await cliente.post(f"/ab/testes/{ALGUM_ID}/ativar",
                           headers=_auth(token_admin), json={"force": False})
    assert r.status_code == 404


async def test_eventos_do_teste_com_teto_e_aviso(cliente, token_admin, limpar_ab, monkeypatch):
    teste = await _criar(cliente, token_admin, _novo(limpar_ab))
    async with db.sessao(role="service_role") as conn:
        for i in range(3):
            await conn.execute(
                "INSERT INTO ab_events (ab_test, ab_var, ab_vid, event_type) "
                "VALUES ($1, 'A', $2, 'behavior')", teste["slug"], f"v_teste8c-ev{i}")

    caminho = f"/ab/testes/{teste['id']}/eventos"
    corpo = (await cliente.get(caminho, headers=_auth(token_admin))).json()
    assert len(corpo["events"]) == 3
    assert corpo["truncado"] is False and corpo["teto"] == 20000

    monkeypatch.setattr(rotas_ab, "TETO_EVENTOS", 2)
    corpo = (await cliente.get(caminho, headers=_auth(token_admin))).json()
    assert len(corpo["events"]) == 2 and corpo["truncado"] is True
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_ab_admin.py`
Esperado: os 6 testes novos falham com 404 (rotas inexistentes).

- [ ] **Step 3: Escrever as rotas**

Em `backend/app/routers/ab.py`, trocar os imports do topo por:

```python
import re
from typing import Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
```

e acrescentar, depois de `router = ...`:

```python
# Teto de `/eventos`. A origem paginava de 1000 em 1000 até 20.000
# (`useAbEvents`); o lote 6 já cortou um teto desses para 500 sem perceber.
# 20.000 fica, e a rota AVISA quando bate — padrão de `/painel/agendamentos`.
TETO_EVENTOS = 20000

_COLUNAS_TESTE = """id::text, slug, public_slug, name, hypothesis, status,
    variants, control_variant, winner_variant, primary_metric, guardrail_metric,
    target_sample_per_variant, starts_at::text, ends_at::text,
    created_at::text, updated_at::text"""

_COLUNAS_EVENTO = """id::text, ab_test, ab_var, ab_vid, event_type, event_name,
    occurred_at::text, page_slug, url, referrer, utm_source, utm_medium,
    utm_campaign, utm_term, utm_content, gclid, fbclid, ttclid, msclkid,
    device_type, browser, os, language, screen_resolution, metadata"""

# O `PUBLIC_SLUG_RE` de `useAbTests.tsx` — o endereço que vai no anúncio.
SLUG_PUBLICO = r"^[a-z0-9]+(-[a-z0-9]+)*$"


class VarianteIn(BaseModel):
    key: str = Field(min_length=1, max_length=40)
    url: str = Field(min_length=1, max_length=2000)
    weight: float = 0
    label: str | None = Field(default=None, max_length=200)


class TesteIn(BaseModel):
    slug: str = Field(min_length=1, max_length=200)
    public_slug: str = Field(pattern=SLUG_PUBLICO, max_length=80)
    name: str = Field(min_length=1, max_length=200)
    hypothesis: str | None = None
    # ⚠️ Só nasce rascunho: `running` passa pela ativação (decisão 9).
    status: Literal["draft"] = "draft"
    variants: list[VarianteIn] = Field(min_length=1, max_length=6)
    control_variant: str | None = None
    primary_metric: str = Field(default="lead_criado", min_length=1, max_length=80)
    guardrail_metric: str | None = Field(default="agendamento", max_length=80)
    target_sample_per_variant: int | None = Field(default=None, ge=0)
    # Texto: a tela manda `YYYY-MM-DD` do <input type="date">, e quem converte
    # é o Postgres (`::text::timestamptz`) — asyncpg recusa str em timestamptz.
    starts_at: str | None = None
    ends_at: str | None = None


class TestePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    hypothesis: str | None = None
    status: Literal["draft", "paused", "completed", "archived"] | None = None
    variants: list[VarianteIn] | None = Field(default=None, min_length=1, max_length=6)
    control_variant: str | None = None
    winner_variant: str | None = None
    primary_metric: str | None = Field(default=None, min_length=1, max_length=80)
    guardrail_metric: str | None = Field(default=None, max_length=80)
    target_sample_per_variant: int | None = Field(default=None, ge=0)
    starts_at: str | None = None
    ends_at: str | None = None


# Colunas NOT NULL de `ab_tests` que o PATCH alcança: nulo explícito é 422,
# não NotNullViolation (500).
_NAO_NULOS = {"name", "status", "variants", "primary_metric"}
_CONVERSOES = {"variants": "::jsonb", "starts_at": "::text::timestamptz",
               "ends_at": "::text::timestamptz"}


class AtivacaoIn(BaseModel):
    force: bool = False


def _data_invalida() -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                         "Data inválida — use AAAA-MM-DD ou ISO 8601.")


@router.get("/testes")
async def listar_testes(usuario: Usuario = Depends(admin_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            f"SELECT {_COLUNAS_TESTE} FROM ab_tests ORDER BY created_at DESC")
    return [dict(l) for l in linhas]


@router.get("/testes/{teste_id}")
async def obter_teste(teste_id: UUID, usuario: Usuario = Depends(admin_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            f"SELECT {_COLUNAS_TESTE} FROM ab_tests WHERE id = $1::uuid", str(teste_id))
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Teste não encontrado.")
    return dict(linha)


@router.post("/testes", status_code=status.HTTP_201_CREATED)
async def criar_teste(dados: TesteIn, usuario: Usuario = Depends(admin_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        try:
            linha = await conn.fetchrow(
                f"""INSERT INTO ab_tests
                        (slug, public_slug, name, hypothesis, status, variants,
                         control_variant, primary_metric, guardrail_metric,
                         target_sample_per_variant, starts_at, ends_at, created_by)
                    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10,
                            $11::text::timestamptz, $12::text::timestamptz, $13::uuid)
                    RETURNING {_COLUNAS_TESTE}""",
                dados.slug, dados.public_slug, dados.name, dados.hypothesis,
                dados.status, [v.model_dump() for v in dados.variants],
                dados.control_variant, dados.primary_metric, dados.guardrail_metric,
                dados.target_sample_per_variant, dados.starts_at, dados.ends_at,
                usuario.id)
        except asyncpg.UniqueViolationError:
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "Já existe um teste com essa chave interna.")
        except asyncpg.DataError:
            raise _data_invalida()
    return dict(linha)


@router.patch("/testes/{teste_id}")
async def editar_teste(teste_id: UUID, dados: TestePatch,
                       usuario: Usuario = Depends(admin_atual)):
    """Pausar, concluir (com a vencedora), arquivar, editar.

    ⚠️ `running` NÃO passa aqui (o `Literal` recusa com 422): ativar é
    `POST /ab/testes/{id}/ativar`, que é quem garante um teste rodando por slug.
    """
    enviados = dados.model_dump(exclude_unset=True)
    nulos = sorted(c for c in _NAO_NULOS if c in enviados and enviados[c] is None)
    if nulos:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"Estes campos não aceitam nulo: {', '.join(nulos)}.")
    if not enviados:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nada para alterar.")

    # Os nomes de coluna vêm dos campos de `TestePatch` — lista fechada.
    atribuicoes = ", ".join(f"{c} = ${i + 2}{_CONVERSOES.get(c, '')}"
                            for i, c in enumerate(enviados))
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        try:
            linha = await conn.fetchrow(
                f"UPDATE ab_tests SET {atribuicoes} WHERE id = $1::uuid "
                f"RETURNING {_COLUNAS_TESTE}", str(teste_id), *enviados.values())
        except asyncpg.DataError:
            raise _data_invalida()
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Teste não encontrado.")
    return dict(linha)


@router.post("/testes/{teste_id}/ativar")
async def ativar_teste(teste_id: UUID, dados: AtivacaoIn,
                       usuario: Usuario = Depends(admin_atual)):
    """A ativação é a RPC `ab_activate_test`, atômica: sem `force`, recusa e
    devolve quem já roda na slug; com `force`, conclui esse e ativa este na
    mesma transação."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        try:
            return await conn.fetchval("SELECT ab_activate_test($1::uuid, $2)",
                                       str(teste_id), dados.force)
        except asyncpg.UniqueViolationError:
            # Perdeu a corrida contra `uq_ab_tests_public_slug_running`.
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "Outro teste foi ativado nesta slug agora mesmo. "
                                "Recarregue a página.")
        except asyncpg.RaiseError as erro:
            if "test not found" in str(erro):
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Teste não encontrado.")
            raise


@router.get("/testes/{teste_id}/eventos")
async def eventos_do_teste(teste_id: UUID, usuario: Usuario = Depends(admin_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        slug = await conn.fetchval(
            "SELECT slug FROM ab_tests WHERE id = $1::uuid", str(teste_id))
        if slug is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Teste não encontrado.")
        total = await conn.fetchval(
            "SELECT count(*) FROM ab_events WHERE ab_test = $1", slug)
        linhas = await conn.fetch(
            f"""SELECT {_COLUNAS_EVENTO} FROM ab_events WHERE ab_test = $1
                 ORDER BY occurred_at DESC LIMIT $2""", slug, TETO_EVENTOS)
    return {"events": [dict(l) for l in linhas],
            "truncado": total > TETO_EVENTOS, "teto": TETO_EVENTOS}
```

⚠️ `TETO_EVENTOS` é lido **dentro** da função (nome global do módulo), e é isso
que deixa o `monkeypatch` do teste funcionar.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_ab_admin.py`
Esperado: `10 passed`.

Se `test_ativar...` falhar com `permission denied`, a sessão não levou o
`user_id` — confira que a rota usa `sessao(role="authenticated", user_id=usuario.id)`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/ab.py backend/tests/test_ab_admin.py
git commit -m "feat(8C): /ab/testes — listar, criar, editar, ativar e eventos no lugar do alias"
```

---

### Tarefa 3: O redirecionador — `GET /publico/ab/go/{public_slug}`

**Files:**
- Create: `backend/app/ab/eventos.py` (só `ORIGEM` e `inserir()` nesta tarefa)
- Create: `backend/app/routers/ab_publico.py`
- Modify: `backend/app/main.py` (registrar router, isentar do limite)
- Test: `backend/tests/test_ab_publico.py`

**Interfaces:**
- Consumes: `normalizar_dominio`, `host_no_dominio`, `ler_user_agent`, `sortear` (Tarefa 1); fixtures `config_ab`, `limpar_ab`.
- Produces: `app.ab.eventos.ORIGEM: tuple[str, ...]` (as 9 colunas utm/click id),
  `app.ab.eventos.inserir(conn, tabela: str, linha: dict, conflito: str = "") -> None`,
  `app.ab.eventos.SEM_DUPLICATA: str`; `app.routers.ab_publico.router` (prefixo `/publico/ab`).

- [ ] **Step 1: Escrever os testes**

`backend/tests/test_ab_publico.py`:

```python
"""O redirecionador e o coletor do A/B — o que eram as functions `go` e
`ab-events`. Ninguém abre estas rotas na tela: quem chama é o clique do
anúncio e o `ab.js` da landing.

O modo de falhar do redirecionador é mandar o clique para o lugar errado (fora
do domínio, variante trocada entre visitas) ou deixar o visitante numa página
de erro. O do coletor é perder evento, ou contar a mesma exposição duas vezes
— e o relatório mente para os dois lados.
"""

import json
from urllib.parse import parse_qsl, urlsplit
from uuid import uuid4

import app.database as db
from app.ab import dominio

CHROME_WIN = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
VARIANTES = [{"key": "A", "url": "https://lp.exemplo.invalid/a", "weight": 50},
             {"key": "B", "url": "https://lp.exemplo.invalid/b?x=1", "weight": 50}]


async def _teste(prefixo, status="running", sufixo="lp", variantes=None,
                 vencedora=None) -> str:
    """Grava um teste direto no banco e devolve a chave interna (`slug`)."""
    publico = f"{prefixo}-{sufixo}"
    slug = f"{publico}-{uuid4().hex[:4]}"
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            """INSERT INTO ab_tests (slug, public_slug, name, status, variants,
                                     control_variant, winner_variant)
               VALUES ($1, $2, 'Teste 8C', $3, $4::jsonb, 'A', $5)""",
            slug, publico, status, variantes or VARIANTES, vencedora)
    return slug


def _query(resposta) -> tuple[str, dict]:
    destino = urlsplit(resposta.headers["location"])
    return f"{destino.netloc}{destino.path}", dict(parse_qsl(destino.query))


async def _contar(tabela: str, slug: str, extra: str = "") -> int:
    async with db.sessao(role="service_role") as conn:
        return await conn.fetchval(
            f"SELECT count(*) FROM {tabela} WHERE ab_test = $1 {extra}", slug)


async def test_primeiro_clique_sorteia_grava_e_redireciona(
        cliente, config_ab, limpar_ab, monkeypatch):
    await config_ab("exemplo.invalid")
    slug = await _teste(limpar_ab)
    monkeypatch.setattr(dominio.random, "random", lambda: 0.9)

    r = await cliente.get(f"/publico/ab/go/{limpar_ab}-lp",
                          params={"utm_source": "google", "gclid": "abc"},
                          headers={"user-agent": CHROME_WIN})

    assert r.status_code == 302
    assert r.headers["cache-control"].startswith("no-store")
    lugar, q = _query(r)
    assert lugar == "lp.exemplo.invalid/b"
    assert q["x"] == "1" and q["utm_source"] == "google" and q["gclid"] == "abc"
    assert q["ab_test"] == slug and q["ab_var"] == "B" and q["ab_vid"].startswith("v_")

    cookies = r.headers.get_list("set-cookie")
    assert any(c.startswith(f"ab_{slug}=B%7C{q['ab_vid']}") and
               "Domain=.exemplo.invalid" in c and "Max-Age=7776000" in c for c in cookies)
    assert any(c.startswith(f"ab_vid={q['ab_vid']}") for c in cookies)

    async with db.sessao(role="service_role") as conn:
        atribuicao = await conn.fetchrow(
            "SELECT utm_source, gclid, device_type, browser FROM ab_assignments "
            "WHERE ab_test = $1", slug)
        evento = await conn.fetchrow(
            "SELECT event_type, event_name FROM ab_events WHERE ab_test = $1", slug)
    assert dict(atribuicao) == {"utm_source": "google", "gclid": "abc",
                                "device_type": "desktop", "browser": "Chrome"}
    assert dict(evento) == {"event_type": "assignment", "event_name": "new"}


async def test_volta_do_mesmo_visitante_mantem_a_variante(cliente, config_ab, limpar_ab):
    await config_ab("exemplo.invalid")
    slug = await _teste(limpar_ab)
    r = await cliente.get(f"/publico/ab/go/{limpar_ab}-lp", headers={
        "cookie": f"ab_vid=v_teste8c1; ab_{slug}=A%7Cv_teste8c1"})

    _, q = _query(r)
    assert q["ab_var"] == "A" and q["ab_vid"] == "v_teste8c1"
    # O visitante já tinha `ab_vid`: só o cookie do teste é regravado.
    assert not any(c.startswith("ab_vid=") for c in r.headers.get_list("set-cookie"))
    # A primeira atribuição não se repete; o clique, sim.
    assert await _contar("ab_assignments", slug) == 0
    assert await _contar("ab_events", slug, "AND event_name = 'sticky'") == 1


async def test_pausado_manda_tudo_para_o_controle_e_concluido_para_a_vencedora(
        cliente, config_ab, limpar_ab, monkeypatch):
    await config_ab("exemplo.invalid")
    monkeypatch.setattr(dominio.random, "random", lambda: 0.9)

    await _teste(limpar_ab, status="paused", sufixo="pausado")
    _, q = _query(await cliente.get(f"/publico/ab/go/{limpar_ab}-pausado"))
    assert q["ab_var"] == "A"

    await _teste(limpar_ab, status="completed", sufixo="concluido", vencedora="B")
    _, q = _query(await cliente.get(f"/publico/ab/go/{limpar_ab}-concluido"))
    assert q["ab_var"] == "B"


async def test_o_que_esta_rodando_vence_o_concluido_na_mesma_slug(
        cliente, config_ab, limpar_ab, monkeypatch):
    await config_ab("exemplo.invalid")
    monkeypatch.setattr(dominio.random, "random", lambda: 0.0)
    await _teste(limpar_ab, status="completed", vencedora="B")
    rodando = await _teste(limpar_ab)
    _, q = _query(await cliente.get(f"/publico/ab/go/{limpar_ab}-lp"))
    assert q["ab_test"] == rodando and q["ab_var"] == "A"


async def test_slug_por_query_e_t_nao_vai_para_o_destino(cliente, config_ab, limpar_ab):
    await config_ab("exemplo.invalid")
    slug = await _teste(limpar_ab)
    r = await cliente.get("/publico/ab/go", params={"t": f"{limpar_ab}-lp", "utm_medium": "cpc"})
    _, q = _query(r)
    assert q["ab_test"] == slug and q["utm_medium"] == "cpc" and "t" not in q


async def test_slug_desconhecida_vai_para_o_dominio_de_producao(cliente, config_ab, limpar_ab):
    await config_ab("exemplo.invalid")
    r = await cliente.get(f"/publico/ab/go/{limpar_ab}-nao-existe")
    assert r.status_code == 302
    assert r.headers["location"] == "https://exemplo.invalid"


async def test_sem_configuracao_e_sem_teste_e_404_curto(cliente, config_ab, limpar_ab):
    await config_ab(None)
    r = await cliente.get(f"/publico/ab/go/{limpar_ab}-nao-existe")
    assert r.status_code == 404


async def test_destino_fora_do_dominio_cai_na_reserva_sem_gravar(
        cliente, config_ab, limpar_ab):
    await config_ab("exemplo.invalid")
    slug = await _teste(limpar_ab, variantes=[
        {"key": "A", "url": "https://outro.invalid/a", "weight": 1}])
    r = await cliente.get(f"/publico/ab/go/{limpar_ab}-lp")
    assert r.headers["location"] == "https://exemplo.invalid"
    assert await _contar("ab_events", slug) == 0


async def test_redirecionador_nao_leva_429(cliente, config_ab, limpar_ab):
    """Clique de anúncio nunca pode levar 429 — decisão 6 do plano."""
    await config_ab(None)
    for _ in range(35):
        r = await cliente.get(f"/publico/ab/go/{limpar_ab}-nao-existe")
        assert r.status_code == 404
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_ab_publico.py`
Esperado: FAIL — as rotas devolvem 404 do FastAPI; o primeiro teste falha em `status_code == 302`.

- [ ] **Step 3: Escrever `app/ab/eventos.py` (parte do redirecionador)**

```python
"""Escrita nas tabelas de eventos do A/B, comum ao redirecionador e ao coletor."""

# As colunas de origem do clique, na ordem da origem: UTMs e click ids.
ORIGEM = ("utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
          "gclid", "fbclid", "ttclid", "msclkid")

# Reenvio de exposição/conversão é absorvido pelo índice parcial da origem
# (`uq_ab_events_dedupe`). A origem tratava o 23505 como sucesso; aqui nem chega
# a ser erro.
SEM_DUPLICATA = "ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING"


async def inserir(conn, tabela: str, linha: dict, conflito: str = "") -> None:
    """INSERT de uma linha.

    ⚠️ `tabela` e as CHAVES de `linha` vêm do código, nunca do request — é o
    que deixa montar o SQL por f-string. Os VALORES vão como parâmetro.
    """
    colunas = list(linha)
    marcas = ", ".join(f"${i + 1}" for i in range(len(colunas)))
    await conn.execute(
        f"INSERT INTO {tabela} ({', '.join(colunas)}) VALUES ({marcas}) {conflito}",
        *linha.values())
```

- [ ] **Step 4: Escrever o router do redirecionador**

`backend/app/routers/ab_publico.py`:

```python
"""O redirecionador e o coletor do teste A/B — o que eram as functions `go` e
`ab-events`. Públicos, sem autenticação: o redirecionador é navegação de quem
clicou no anúncio; o coletor é chamado pelo `ab.js` nas landing pages.

⚠️ Os dois NUNCA atrapalham o visitante. O redirecionador não mostra página de
erro enquanto houver para onde mandar (cai no domínio de produção); o coletor
responde na hora. Gravação vai em `BackgroundTasks`, que roda DEPOIS da
resposta sair — o `waitUntil` da origem.

⚠️ `role="service_role"`: não há usuário. Quem autoriza é a natureza da rota,
pública por desenho, como `/publico/captura`.

Em produção os dois ficam atrás do Worker do Cloudflare no subdomínio do
redirecionador (o código está na tela de Configuração do A/B). É isso que faz o
navegador aceitar o cookie `Domain=.<domínio de produção>`: batendo direto no
backend, o cookie é recusado e não há permanência na variante — só serve para
conferência.
"""

import logging
from urllib.parse import parse_qsl, quote, unquote, urlencode, urlsplit, urlunsplit
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Request, Response, status

from app.ab.dominio import host_no_dominio, ler_user_agent, normalizar_dominio, sortear
from app.ab.eventos import ORIGEM, inserir
from app.database import sessao

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/publico/ab", tags=["ab-publico"])

VALIDADE_COOKIE = 60 * 60 * 24 * 90  # 90 dias
# Parâmetro de uso interno do redirecionador, que não vai para o destino.
PARAMETROS_INTERNOS = {"t"}
_SEM_CACHE = {"Cache-Control": "no-store, no-cache, must-revalidate",
              "X-Robots-Tag": "noindex, nofollow",
              "Referrer-Policy": "no-referrer-when-downgrade"}


def _redirecionar(destino: str, cookies: list[str] | None = None) -> Response:
    resposta = Response(status_code=status.HTTP_302_FOUND,
                        headers={"Location": destino, **_SEM_CACHE})
    for cookie in cookies or []:
        resposta.headers.append("set-cookie", cookie)
    return resposta


def _reserva(dominio: str) -> Response:
    """Para onde vai o clique sem teste. A origem usava `AB_FALLBACK_URL`
    (padrão https://dnia.ai); aqui é o domínio de produção (decisão 2). Sem
    domínio configurado não há para onde mandar: 404 curto, sem página."""
    if dominio:
        return _redirecionar(f"https://{dominio}")
    return Response("Link de teste indisponível.", status_code=404,
                    headers=_SEM_CACHE, media_type="text/plain")


def _cookie(nome: str, valor: str, dominio: str) -> str:
    partes = [f"{nome}={quote(valor, safe='')}", "Path=/",
              f"Max-Age={VALIDADE_COOKIE}", "SameSite=Lax", "Secure"]
    if dominio:
        partes.insert(1, f"Domain=.{dominio}")
    return "; ".join(partes)


def _definir(pares: list[tuple[str, str]], chave: str, valor: str) -> list[tuple[str, str]]:
    """O `URLSearchParams.set` do JS: troca a primeira ocorrência, apaga as
    outras, acrescenta no fim se não havia."""
    saida, posto = [], False
    for k, v in pares:
        if k != chave:
            saida.append((k, v))
        elif not posto:
            saida.append((chave, valor))
            posto = True
    if not posto:
        saida.append((chave, valor))
    return saida


def _escolher_teste(linhas):
    """Quem responde pela slug pública:
    1. o que está `running` (no máximo um — índice único parcial);
    2. sem ele, o mais recente que JÁ RODOU, servindo a vencedora (ou o
       controle) a 100% — o link do anúncio nunca quebra entre testes;
    3. por último, um rascunho (100% controle)."""
    return (next((t for t in linhas if t["status"] == "running"), None)
            or next((t for t in linhas
                     if t["status"] in ("completed", "paused", "archived")), None)
            or (linhas[0] if linhas else None))


@router.get("/go")
@router.get("/go/{public_slug}")
async def redirecionar(request: Request, tarefas: BackgroundTasks,
                       public_slug: str | None = None):
    """O que era a function `go`. O slug vem do caminho ou de `?t=` (que vence)."""
    dominio = ""
    try:
        async with sessao(role="service_role") as conn:
            dominio = normalizar_dominio(await conn.fetchval(
                "SELECT production_domain FROM ab_config LIMIT 1"))
            slug_publico = (request.query_params.get("t") or "").strip() or public_slug
            if not slug_publico:
                return _reserva(dominio)
            # A mesma slug pública pode ter vários testes ao longo do tempo;
            # por isso lista, em vez de pegar um.
            linhas = await conn.fetch(
                """SELECT slug, status, variants, control_variant, winner_variant
                     FROM ab_tests WHERE public_slug = $1
                    ORDER BY updated_at DESC LIMIT 20""", slug_publico)
        return _decidir(request, tarefas, dominio, _escolher_teste(linhas))
    except Exception:
        logger.exception("[ab/go] falha — o visitante vai para a reserva")
        return _reserva(dominio)


def _decidir(request: Request, tarefas: BackgroundTasks, dominio: str, teste) -> Response:
    if teste is None:
        return _reserva(dominio)
    # Chave INTERNA do teste: é ela que circula em cookie, `ab_test`, eventos.
    # Nunca se repete entre testes, então reusar a slug pública não mistura
    # permanência nem dedupe.
    slug = teste["slug"]
    variantes = teste["variants"] if isinstance(teste["variants"], list) else []
    if not variantes:
        return _reserva(dominio)
    controle = next((v for v in variantes if v.get("key") == teste["control_variant"]),
                    variantes[0])

    cookies = {k: unquote(v) for k, v in request.cookies.items()}
    # Visitante compartilhado entre testes — ajuda a costura de identidade.
    vid = cookies.get("ab_vid")
    vid_novo = not vid
    if vid_novo:
        vid = f"v_{uuid4().hex}"

    # `running`: permanece na variante do cookie ou sorteia. Qualquer outro
    # status: 100% numa variante — a vencedora se o teste foi concluído com
    # uma, senão o controle (o "kill switch" do `paused`).
    escolhida, fixa = None, False
    if teste["status"] == "running":
        anterior = cookies.get(f"ab_{slug}")  # formato "{variante}|{vid}"
        if anterior:
            chave = anterior.split("|")[0]
            escolhida = next((v for v in variantes if v.get("key") == chave), None)
            fixa = escolhida is not None
        if escolhida is None:
            escolhida = sortear(variantes)
    else:
        escolhida = next((v for v in variantes if v.get("key") == teste["winner_variant"]),
                         None) or controle

    partes = urlsplit(str(escolhida.get("url") or ""))
    if partes.scheme not in ("http", "https") or not partes.hostname:
        return _reserva(dominio)
    # Defesa em profundidade: a validação primária é no cadastro. Destino fora
    # do domínio de produção vira cross-domain redirect no anúncio (reprovação
    # "Destination mismatch"). Sem domínio configurado, segue (fail-open).
    if dominio and not host_no_dominio(partes.hostname, dominio):
        logger.warning("[ab/go] destino fora do domínio de produção: %s não "
                       "pertence a %s (teste=%s, variante=%s)",
                       partes.hostname, dominio, slug, escolhida.get("key"))
        return _reserva(dominio)

    pares = parse_qsl(partes.query, keep_blank_values=True)
    for k, v in request.query_params.multi_items():
        if k not in PARAMETROS_INTERNOS:
            pares = _definir(pares, k, v)
    for k, v in (("ab_test", slug), ("ab_var", escolhida["key"]), ("ab_vid", vid)):
        pares = _definir(pares, k, v)
    destino = urlunsplit(partes._replace(query=urlencode(pares)))

    novos = [_cookie(f"ab_{slug}", f"{escolhida['key']}|{vid}", dominio)]
    if vid_novo:
        novos.append(_cookie("ab_vid", vid, dominio))

    ua = request.headers.get("user-agent") or ""
    lido = ler_user_agent(ua)
    comum = {
        "ab_test": slug, "ab_var": escolhida["key"], "ab_vid": vid,
        "referrer": request.headers.get("referer"),
        **{c: request.query_params.get(c) for c in ORIGEM},
        "raw_query": request.url.query or None,
        "device_type": lido["device_type"], "browser": lido["browser"],
        "browser_version": lido["browser_version"] or None, "os": lido["os"],
        "language": (request.headers.get("accept-language") or "").split(",")[0] or None,
    }
    tarefas.add_task(_registrar_clique, comum, destino, ua or None, fixa)
    return _redirecionar(destino, novos)


async def _registrar_clique(comum: dict, destino: str, ua: str | None, fixa: bool) -> None:
    """Roda depois do 302 sair. Nunca propaga: o visitante já foi."""
    try:
        async with sessao(role="service_role") as conn:
            # `ab_assignments` só na PRIMEIRA atribuição — guarda a origem de
            # first-touch.
            if not fixa:
                await inserir(conn, "ab_assignments",
                              {**comum, "landing_url": destino, "user_agent": ua},
                              "ON CONFLICT (ab_vid, ab_test) DO NOTHING")
            # Um evento `assignment` por clique: é o volume de cliques.
            await inserir(conn, "ab_events",
                          {**comum, "event_type": "assignment",
                           "event_name": "sticky" if fixa else "new", "url": destino})
    except Exception:
        logger.exception("[ab/go] falha ao registrar o clique — o redirecionamento já saiu")
```

- [ ] **Step 5: Registrar o router e isentar do limite**

Em `backend/app/main.py`:

```python
from app.routers.ab_publico import router as ab_publico_router
```

`app.include_router(ab_publico_router)` logo depois de `app.include_router(ab_router)`.

No `LimiteTaxaMiddleware`, trocar `isentos=("/publico/webhook/", "/publico/validar-email"),`
por `isentos=("/publico/webhook/", "/publico/validar-email", "/publico/ab/go"),`
e acrescentar ao comentário que já existe ali:

```python
    # ⚠️ `/publico/ab/go` também é isento: é o clique do anúncio, e um 429 ali
    # joga fora uma visita paga. A origem mandava pôr o limite dessa rota na
    # camada do Cloudflare (regra de Rate Limiting do Worker).
```

- [ ] **Step 6: Rodar e ver passar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_ab_publico.py`
Esperado: `9 passed`.

- [ ] **Step 7: Commit**

```bash
git add backend/app/ab/eventos.py backend/app/routers/ab_publico.py backend/app/main.py \
        backend/tests/test_ab_publico.py
git commit -m "feat(8C): /publico/ab/go no lugar da function go"
```

---

### Tarefa 4: O coletor — `POST /publico/ab/eventos`

**Files:**
- Modify: `backend/app/ab/eventos.py` (normalização e dedupe)
- Modify: `backend/app/routers/ab_publico.py`
- Create: `backend/app/middleware/cors_coletor.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_ab_publico.py`, `backend/tests/test_ab_dominio.py`

**Interfaces:**
- Consumes: `ORIGEM`, `inserir`, `SEM_DUPLICATA` (Tarefa 3), `ler_user_agent` (Tarefa 1).
- Produces: `app.ab.eventos.chave_de_dedupe(evento: dict) -> str | None`,
  `normalizar_evento(evento, ua_lido: dict, referer: str | None, idioma: str | None) -> dict | None`,
  `TIPOS: set[str]`, `MAX_EVENTOS = 50`. `chave_de_dedupe` usa o formato
  `"{vid}:{teste}:conversion:{nome}"` — o mesmo que a Tarefa 5 grava no
  servidor, para as duas portas deduplicarem juntas.

- [ ] **Step 1: Escrever os testes puros**

Acrescentar a `backend/tests/test_ab_dominio.py`:

```python
from app.ab.eventos import chave_de_dedupe, normalizar_evento

LIDO = {"device_type": "desktop", "os": "Windows", "browser": "Chrome", "browser_version": "1"}


def test_chave_de_dedupe_como_na_origem():
    base = {"ab_vid": "v1", "ab_test": "t1"}
    assert chave_de_dedupe({**base, "event_type": "exposure"}) == "v1:t1:exposure"
    assert chave_de_dedupe({**base, "event_type": "conversion"}) == "v1:t1:conversion:default"
    assert (chave_de_dedupe({**base, "event_type": "schedule_step", "metadata": {"step": 2}})
            == "v1:t1:schedule_step:2")
    assert chave_de_dedupe({**base, "event_type": "behavior"}) is None


def test_normalizacao_descarta_o_invalido_e_nao_perde_evento_por_campo_ruim():
    assert normalizar_evento("texto", LIDO, None, None) is None
    assert normalizar_evento({"ab_test": "t", "ab_vid": "v", "event_type": "x"},
                             LIDO, None, None) is None
    assert normalizar_evento({"ab_test": "", "ab_vid": "v", "event_type": "exposure"},
                             LIDO, None, None) is None

    linha = normalizar_evento(
        {"ab_test": "t" * 300, "ab_vid": "v", "event_type": "exposure",
         "lead_id": "não-é-uuid", "occurred_at": "ontem", "metadata": [1]},
        LIDO, "https://ref.invalid", "pt-BR")
    assert len(linha["ab_test"]) == 200
    # Decisão 11: a origem perdia o evento inteiro por um destes campos.
    assert linha["lead_id"] is None and linha["occurred_at"] is not None
    assert linha["metadata"] is None
    assert linha["referrer"] == "https://ref.invalid" and linha["language"] == "pt-BR"
    assert linha["browser"] == "Chrome" and linha["browser_version"] is None

    quando = normalizar_evento({"ab_test": "t", "ab_vid": "v", "event_type": "exposure",
                                "occurred_at": "2026-09-01T12:00:00Z"}, LIDO, None, None)
    assert quando["occurred_at"].isoformat() == "2026-09-01T12:00:00+00:00"
```

- [ ] **Step 2: Escrever os testes de rota**

Acrescentar a `backend/tests/test_ab_publico.py`:

```python
async def _eventos(slug: str):
    async with db.sessao(role="service_role") as conn:
        return await conn.fetch(
            "SELECT event_type, event_name, dedupe_key, browser, lead_id, occurred_at "
            "FROM ab_events WHERE ab_test = $1 ORDER BY event_type", slug)


async def test_coletor_aceita_texto_puro_e_absorve_exposicao_repetida(cliente, limpar_ab):
    """O `ab.js` manda `text/plain` (decisão 5) — o corpo é JSON do mesmo jeito."""
    slug = f"{limpar_ab}-coletor"
    exposicao = {"ab_test": slug, "ab_var": "A", "ab_vid": "v_teste8c-col",
                 "event_type": "exposure"}
    corpo = {"events": [exposicao, exposicao,
                        {"ab_test": slug, "ab_vid": "v_teste8c-col", "event_type": "behavior",
                         "event_name": "scroll", "metadata": {"depth": 50}},
                        {"ab_test": slug, "ab_vid": "v_teste8c-col", "event_type": "inventado"}]}
    r = await cliente.post("/publico/ab/eventos", content=json.dumps(corpo),
                           headers={"content-type": "text/plain;charset=UTF-8",
                                    "user-agent": CHROME_WIN})
    assert r.status_code == 202 and r.json() == {"accepted": 3}

    linhas = await _eventos(slug)
    assert [l["event_type"] for l in linhas] == ["behavior", "exposure"]
    exposicao_gravada = linhas[1]
    assert exposicao_gravada["dedupe_key"] == f"v_teste8c-col:{slug}:exposure"
    assert exposicao_gravada["browser"] == "Chrome"


async def test_coletor_aceita_evento_solto_e_lista(cliente, limpar_ab):
    slug = f"{limpar_ab}-formatos"
    um = {"ab_test": slug, "ab_vid": "v_teste8c-f", "event_type": "behavior"}
    assert (await cliente.post("/publico/ab/eventos", json=um)).json() == {"accepted": 1}
    assert (await cliente.post("/publico/ab/eventos", json=[um, um])).json() == {"accepted": 2}
    assert len(await _eventos(slug)) == 3


async def test_coletor_corta_em_cinquenta(cliente, limpar_ab):
    slug = f"{limpar_ab}-teto"
    um = {"ab_test": slug, "ab_vid": "v_teste8c-t", "event_type": "behavior"}
    r = await cliente.post("/publico/ab/eventos", json={"events": [um] * 60})
    assert r.json() == {"accepted": 50}


async def test_coletor_descarta_robo_e_recusa_json_quebrado(cliente, limpar_ab):
    slug = f"{limpar_ab}-robo"
    um = {"ab_test": slug, "ab_vid": "v_teste8c-r", "event_type": "exposure"}
    r = await cliente.post("/publico/ab/eventos", json=um,
                           headers={"user-agent": "Googlebot/2.1"})
    assert r.status_code == 200 and r.json() == {"accepted": 0, "skipped": "bot"}
    assert await _eventos(slug) == []

    r = await cliente.post("/publico/ab/eventos", content="{quebrado",
                           headers={"content-type": "text/plain"})
    assert r.status_code == 400


async def test_coletor_responde_preflight_de_qualquer_origem(cliente):
    """Sem o middleware próprio, o `CORSMiddleware` global devolveria 400: ele
    só aceita o `FRONTEND_URL`, e a landing mora em outro domínio."""
    r = await cliente.options("/publico/ab/eventos", headers={
        "origin": "https://lp.exemplo.invalid",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type"})
    assert r.status_code == 204
    assert r.headers["access-control-allow-origin"] == "*"
    assert "POST" in r.headers["access-control-allow-methods"]
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_ab_dominio.py tests/test_ab_publico.py`
Esperado: os puros falham com `ImportError` (`chave_de_dedupe`); os de rota, com 404/405.

- [ ] **Step 4: Completar `app/ab/eventos.py`**

Acrescentar ao topo os imports e, no fim, as funções:

```python
import re
from datetime import datetime, timezone
from uuid import UUID
```

```python
TIPOS = {"assignment", "exposure", "behavior", "schedule_step", "conversion"}
MAX_EVENTOS = 50
# Robôs que executam JS são raros; os conhecidos ficam de fora para a
# exposição ficar limpa. Lista da origem, inteira.
ROBO = re.compile(r"bot|crawler|spider|crawling|slurp|bingpreview|facebookexternalhit"
                  r"|whatsapp|telegrambot|preview|headless|lighthouse|pingdom|gtmetrix"
                  r"|monitor", re.I)


def chave_de_dedupe(evento: dict) -> str | None:
    """Idempotência da origem. `None` deixa repetir (behavior, assignment).

    ⚠️ Usa os valores CRUS do evento, antes de truncar — como a origem.
    """
    vid, teste = evento.get("ab_vid"), evento.get("ab_test")
    tipo, nome = evento.get("event_type"), evento.get("event_name")
    metadata = evento.get("metadata")
    passo = metadata.get("step") if isinstance(metadata, dict) else None
    if tipo == "exposure":
        return f"{vid}:{teste}:exposure"
    if tipo == "conversion":
        return f"{vid}:{teste}:conversion:{nome or 'default'}"
    if tipo == "schedule_step":
        return f"{vid}:{teste}:schedule_step:{nome or passo or ''}"
    return None


def _texto(valor, maximo: int = 2000) -> str | None:
    """Trunca para não aceitar payload abusivo. `""` continua `""`."""
    return None if valor is None else str(valor)[:maximo]


def _quando(valor) -> datetime:
    """Decisão 11: data ilegível vira agora, em vez de derrubar o evento."""
    try:
        data = datetime.fromisoformat(str(valor)[:40])
    except ValueError:
        return datetime.now(timezone.utc)
    return data if data.tzinfo else data.replace(tzinfo=timezone.utc)


def _uuid_ou_nada(valor) -> str | None:
    """Decisão 11: `lead_id` é uuid no banco; lixo vira nulo, não evento perdido."""
    try:
        return str(UUID(str(valor))) if valor is not None else None
    except ValueError:
        return None


def normalizar_evento(evento, ua_lido: dict, referer: str | None,
                      idioma: str | None) -> dict | None:
    """Uma linha de `ab_events`, ou `None` se o evento não serve.

    Inválido é descartado em silêncio — o coletor é fire-and-forget e nunca
    falha o request por um evento ruim. Aparelho, navegador e sistema que o
    cliente não mandar saem do user-agent do request.
    """
    if not isinstance(evento, dict):
        return None
    ab_test = _texto(evento.get("ab_test"), 200)
    ab_vid = _texto(evento.get("ab_vid"), 200)
    tipo = _texto(evento.get("event_type"), 40)
    if not ab_test or not ab_vid or tipo not in TIPOS:
        return None
    metadata = evento.get("metadata")
    return {
        "ab_test": ab_test, "ab_var": _texto(evento.get("ab_var"), 40), "ab_vid": ab_vid,
        "event_type": tipo, "event_name": _texto(evento.get("event_name"), 200),
        "occurred_at": _quando(evento.get("occurred_at")),
        "page_slug": _texto(evento.get("page_slug"), 400),
        "url": _texto(evento.get("url")),
        "referrer": _texto(evento.get("referrer")) or referer,
        "lead_id": _uuid_ou_nada(evento.get("lead_id")),
        "dnia_id": _texto(evento.get("dnia_id"), 100),
        **{c: _texto(evento.get(c), 400) for c in ORIGEM},
        "raw_query": _texto(evento.get("raw_query"), 4000),
        "device_type": _texto(evento.get("device_type"), 40) or ua_lido["device_type"],
        "browser": _texto(evento.get("browser"), 80) or ua_lido["browser"],
        "browser_version": _texto(evento.get("browser_version"), 40),
        "os": _texto(evento.get("os"), 80) or ua_lido["os"],
        "language": _texto(evento.get("language"), 40) or idioma,
        "screen_resolution": _texto(evento.get("screen_resolution"), 40),
        "metadata": metadata if isinstance(metadata, dict) else None,
        "dedupe_key": chave_de_dedupe(evento),
    }
```

- [ ] **Step 5: Escrever a rota do coletor**

Em `backend/app/routers/ab_publico.py`, trocar a linha de import de
`app.ab.eventos` e acrescentar `json`, `HTTPException` e `JSONResponse`:

```python
import json
...
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
...
from app.ab.eventos import (MAX_EVENTOS, ORIGEM, ROBO, SEM_DUPLICATA, inserir,
                            normalizar_evento)
```

E no fim do arquivo:

```python
@router.post("/eventos", status_code=status.HTTP_202_ACCEPTED)
async def coletar(request: Request, tarefas: BackgroundTasks):
    """O que era a function `ab-events`. Aceita um evento, uma lista ou
    `{"events": [...]}`, com qualquer `content-type` — o `ab.js` manda
    `text/plain` para não disparar preflight (decisão 5)."""
    ua = request.headers.get("user-agent") or ""
    if ROBO.search(ua):
        # 200, e não erro, para o robô não re-tentar.
        return JSONResponse({"accepted": 0, "skipped": "bot"})
    try:
        corpo = json.loads(await request.body())
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "JSON inválido.")

    if isinstance(corpo, list):
        brutos = corpo
    elif isinstance(corpo, dict) and isinstance(corpo.get("events"), list):
        brutos = corpo["events"]
    elif isinstance(corpo, dict):
        brutos = [corpo]
    else:
        brutos = []

    lido = ler_user_agent(ua)
    referer = request.headers.get("referer")
    idioma = (request.headers.get("accept-language") or "").split(",")[0] or None
    linhas = [linha for evento in brutos[:MAX_EVENTOS]
              if (linha := normalizar_evento(evento, lido, referer, idioma))]
    if linhas:
        tarefas.add_task(_gravar_eventos, linhas)
    return {"accepted": len(linhas)}


async def _gravar_eventos(linhas: list[dict]) -> None:
    """Linha a linha, cada uma no seu SAVEPOINT: um evento ruim não leva os
    outros. Duplicata é absorvida pelo índice (`SEM_DUPLICATA`)."""
    try:
        async with sessao(role="service_role") as conn:
            for linha in linhas:
                try:
                    async with conn.transaction():
                        await inserir(conn, "ab_events", linha, SEM_DUPLICATA)
                except Exception:
                    logger.exception("[ab/eventos] evento descartado (%s)",
                                     linha["event_type"])
    except Exception:
        logger.exception("[ab/eventos] banco indisponível — lote de %d perdido",
                         len(linhas))
```

- [ ] **Step 6: Escrever o middleware de CORS do coletor**

`backend/app/middleware/cors_coletor.py`:

```python
"""CORS só do coletor do A/B.

O `CORSMiddleware` global aceita apenas o `FRONTEND_URL`, e responde 400 ao
preflight de qualquer outra origem. O coletor é chamado pelas landing pages,
em outro domínio — e quem manda `application/json` (o agendamento, por
exemplo) dispara preflight.

`*` é seguro aqui: a rota não lê credencial nem devolve dado — só `accepted`.

⚠️ Precisa ser o middleware MAIS DE FORA (registrado por último em
`main.py`): o Starlette executa do último registrado para o primeiro, e o
preflight tem de ser respondido antes do `CORSMiddleware` recusá-lo.
"""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

_CABECALHOS = {"Access-Control-Allow-Origin": "*",
               "Access-Control-Allow-Methods": "POST, OPTIONS",
               "Access-Control-Allow-Headers": "content-type",
               "Access-Control-Max-Age": "86400"}


class CorsDoColetorMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, caminho: str):
        super().__init__(app)
        self.caminho = caminho

    async def dispatch(self, request: Request, call_next):
        if request.url.path != self.caminho:
            return await call_next(request)
        if request.method == "OPTIONS":
            return Response(status_code=204, headers=_CABECALHOS)
        resposta = await call_next(request)
        resposta.headers.update(_CABECALHOS)
        return resposta
```

Em `backend/app/main.py`, import:

```python
from app.middleware.cors_coletor import CorsDoColetorMiddleware
```

e **depois** do `app.add_middleware(LimiteTaxaMiddleware, ...)`:

```python
# ⚠️ Por último de propósito: é o mais de fora, e responde o preflight do
# coletor antes do CORSMiddleware global recusá-lo (ver o módulo).
app.add_middleware(CorsDoColetorMiddleware, caminho="/publico/ab/eventos")
```

- [ ] **Step 7: Rodar e ver passar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_ab_dominio.py tests/test_ab_publico.py`
Esperado: `21 passed` (7 puros + 14 de rota).

- [ ] **Step 8: Commit**

```bash
git add backend/app/ab/eventos.py backend/app/routers/ab_publico.py \
        backend/app/middleware/cors_coletor.py backend/app/main.py \
        backend/tests/test_ab_dominio.py backend/tests/test_ab_publico.py
git commit -m "feat(8C): /publico/ab/eventos no lugar da function ab-events"
```

---

### Tarefa 5: A costura e as conversões voltam ao servidor

**Files:**
- Create: `backend/app/ab/costura.py`
- Modify: `backend/app/routers/publico.py` (`IdentidadeIn`, `EventoIn`, `gravar_identidade`, `receber_evento`, `registrar_conversao`)
- Modify: `backend/app/routers/captura.py`
- Test: `backend/tests/test_ab_costura.py` (novo), `backend/tests/test_conversao.py`, `backend/tests/test_captura.py`

**Interfaces:**
- Consumes: `SEM_DUPLICATA` (Tarefa 3), fixture `limpar_ab`, `chave_de` (conftest), `chamador` (`test_conversao.py`), `pagina_sonda`/`EMAIL_SONDA` (`test_captura.py`).
- Produces: `app.ab.costura.Ab(ab_vid, ab_test, ab_var)` (dataclass congelada),
  `extrair_ab(topo: dict, metadata: dict | None) -> Ab`,
  `costurar_visitante(conn, ab, *, email, phone, phone_normalized, lead_id, dnia_id, source_app, metadata) -> Ab`,
  `registrar_conversao_ab(conn, ab, nome, *, lead_id=None, dnia_id=None, page_slug=None, metadata=None) -> None`.

- [ ] **Step 1: Escrever os testes da costura**

`backend/tests/test_ab_costura.py`:

```python
"""A costura do A/B no servidor — o que era `_shared/ab.ts`.

⚠️ O modo de falhar é o pior do projeto: sem costura, o relatório do teste
mostra exposição e ZERO conversão, que parece variante ruim, não defeito. Foi
o que aconteceu entre os lotes 1D e 8C, e nenhuma tela acusou.
"""

import pytest_asyncio

import app.database as db
from app.ab.costura import Ab, costurar_visitante, extrair_ab, registrar_conversao_ab


def test_extrai_do_topo_antes_do_metadata_e_vazio_vira_nada():
    ab = extrair_ab({"ab_vid": " v1 ", "ab_test": None, "ab_var": ""},
                    {"ab_test": "t1", "ab_var": "B"})
    # `""` no topo NÃO cai para o metadata — o `??` da origem só pula nulo.
    assert ab == Ab("v1", "t1", None)
    assert extrair_ab({}, None) == Ab(None, None, None)


async def test_falha_na_costura_nao_derruba_a_transacao_de_quem_chama(conexao):
    """Decisão 8: sem o SAVEPOINT, este erro abortaria a transação e o contato
    que a rota acabou de gravar iria junto — o `SELECT 1` abaixo estouraria
    com `InFailedSQLTransactionError`. O erro é do SERVIDOR (cast
    `::text::uuid`); ver o docstring de `app/ab/costura.py`."""
    ab = await costurar_visitante(conexao, Ab("v_teste8c-x", "teste-8c-t", "A"),
                                  email=None, phone=None, phone_normalized=None,
                                  lead_id="não-é-uuid", dnia_id=None,
                                  source_app="marketinghs", metadata=None)
    assert ab == Ab("v_teste8c-x", "teste-8c-t", "A")
    assert await conexao.fetchval("SELECT 1") == 1


async def test_sem_vid_acha_pelo_email_e_completa_pelo_ultimo_clique(conexao):
    await conexao.execute(
        "INSERT INTO ab_assignments (ab_test, ab_var, ab_vid) "
        "VALUES ('teste-8c-t', 'B', 'v_teste8c-f')")
    await conexao.execute(
        "INSERT INTO ab_identities (ab_vid, email, source_app) "
        "VALUES ('v_teste8c-f', 'fallback-8c@exemplo.invalid', 'nexus')")
    ab = await costurar_visitante(conexao, Ab(), email="Fallback-8C@exemplo.invalid",
                                  phone=None, phone_normalized=None, lead_id=None,
                                  dnia_id=None, source_app="nexus", metadata=None)
    assert ab == Ab("v_teste8c-f", "teste-8c-t", "B")
    # Já havia a costura por esse e-mail: não duplica.
    assert await conexao.fetchval(
        "SELECT count(*) FROM ab_identities WHERE ab_vid = 'v_teste8c-f'") == 1


async def test_conversao_so_uma_vez_e_so_com_teste(conexao):
    ab = Ab("v_teste8c-c", "teste-8c-t", "A")
    for _ in range(2):
        await registrar_conversao_ab(conexao, ab, "lead_criado", page_slug="lp")
    await registrar_conversao_ab(conexao, Ab("v_teste8c-c", None, None), "lead_criado")
    linhas = await conexao.fetch(
        "SELECT event_type, event_name, dedupe_key FROM ab_events WHERE ab_vid = 'v_teste8c-c'")
    assert [dict(l) for l in linhas] == [{
        "event_type": "conversion", "event_name": "lead_criado",
        "dedupe_key": "v_teste8c-c:teste-8c-t:conversion:lead_criado"}]


EMAIL_AB = "ab-8c@exemplo.invalid"


@pytest_asyncio.fixture
async def contato_ab(chave_de, limpar_ab):
    """Chave `write` e limpeza do contato que as rotas criam pelo e-mail.

    ⚠️ `journey_events` não tem FK: `trg_contact_event_journey` copia todo
    `contact_events`, e a cópia fica se não for apagada aqui.
    """
    async def limpar():
        async with db.sessao(role="service_role") as conn:
            leads = await conn.fetch("SELECT id FROM leads WHERE lower(email) = $1", EMAIL_AB)
            ids = [l["id"] for l in leads]
            identidades = await conn.fetch(
                "SELECT dnia_id FROM ecosystem_identities WHERE lower(email) = $1", EMAIL_AB)
            dnias = [i["dnia_id"] for i in identidades]
            await conn.execute("DELETE FROM journey_events WHERE lead_id = ANY($1::uuid[])", ids)
            await conn.execute("DELETE FROM contact_events WHERE lead_id = ANY($1::uuid[]) "
                               "OR dnia_id = ANY($2::uuid[])", ids, dnias)
            await conn.execute("DELETE FROM ab_identities WHERE lower(email) = $1", EMAIL_AB)
            await conn.execute("DELETE FROM ecosystem_identities WHERE lower(email) = $1",
                               EMAIL_AB)
            await conn.execute("DELETE FROM leads WHERE id = ANY($1::uuid[])", ids)

    await limpar()
    yield await chave_de("write")
    await limpar()


async def test_identidade_costura_o_visitante_ao_contato_uma_vez(cliente, contato_ab):
    corpo = {"email": EMAIL_AB, "nome": "Visitante 8C", "source_app": "nexus",
             "metadata": {"ab_vid": "v_teste8c-id", "ab_test": "teste-8c-id", "ab_var": "A"}}
    for _ in range(2):
        r = await cliente.post("/publico/identidade", json=corpo,
                               headers={"Authorization": f"Bearer {contato_ab}"})
        assert r.status_code == 200, r.text
    lead_id = r.json()["lead_id"]
    async with db.sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            "SELECT lead_id::text, source_app FROM ab_identities WHERE ab_vid = 'v_teste8c-id'")
    assert [dict(l) for l in linhas] == [{"lead_id": lead_id, "source_app": "nexus"}]


async def test_agendamento_vira_conversao_do_teste(cliente, contato_ab):
    r = await cliente.post("/publico/evento-de-contato", headers={
        "Authorization": f"Bearer {contato_ab}"}, json={
        "source_app": "nexus", "event_type": "meeting_scheduled",
        "title": "Reunião agendada", "email": EMAIL_AB,
        "metadata": {"ab_vid": "v_teste8c-ag", "ab_test": "teste-8c-ag", "ab_var": "B"}})
    assert r.status_code == 200, r.text
    async with db.sessao(role="service_role") as conn:
        conversao = await conn.fetchrow(
            "SELECT event_name, ab_var, metadata FROM ab_events "
            "WHERE ab_test = 'teste-8c-ag' AND event_type = 'conversion'")
        costurado = await conn.fetchval(
            "SELECT count(*) FROM ab_identities WHERE ab_vid = 'v_teste8c-ag'")
    assert conversao["event_name"] == "agendamento" and conversao["ab_var"] == "B"
    assert conversao["metadata"] == {"event_type": "meeting_scheduled"}
    assert costurado == 1


async def test_evento_que_nao_e_agendamento_costura_mas_nao_converte(cliente, contato_ab):
    r = await cliente.post("/publico/evento-de-contato", headers={
        "Authorization": f"Bearer {contato_ab}"}, json={
        "source_app": "nexus", "event_type": "deal_moved", "title": "Moveu",
        "email": EMAIL_AB, "ab_vid": "v_teste8c-mv", "ab_test": "teste-8c-mv"})
    assert r.status_code == 200, r.text
    async with db.sessao(role="service_role") as conn:
        assert await conn.fetchval(
            "SELECT count(*) FROM ab_events WHERE ab_test = 'teste-8c-mv'") == 0
        assert await conn.fetchval(
            "SELECT count(*) FROM ab_identities WHERE ab_vid = 'v_teste8c-mv'") == 1
```

Em `backend/tests/test_conversao.py`, no fim:

```python
async def test_conversao_com_teste_ab_registra_lead_criado_uma_vez(
        cliente, chamador, limpar_ab):
    """O `leadConversion.ts` gravava `lead_criado` no coletor; o lote 7 o
    apagou e esta rota não assumiu. Decisão 7 do plano do 8C.

    `apply_tag: False` porque a fixture `chamador` não apaga a tag criada."""
    lead_id, chave = chamador
    corpo = {"lead_id": lead_id, "tipo": "lead", "page_slug": "lp-8c",
             "ab_test": "teste-8c-conv", "ab_var": "A", "ab_vid": "v_teste8c-conv",
             "apply_tag": False}
    for _ in range(2):
        r = await cliente.post("/publico/conversao", json=corpo,
                               headers={"Authorization": f"Bearer {chave}"})
        assert r.status_code == 201, r.text
    async with db.sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            "SELECT event_name, lead_id::text, page_slug FROM ab_events "
            "WHERE ab_test = 'teste-8c-conv'")
    assert [dict(l) for l in linhas] == [
        {"event_name": "lead_criado", "lead_id": lead_id, "page_slug": "lp-8c"}]
```

Em `backend/tests/test_captura.py`, no fim:

```python
async def test_captura_com_teste_ab_registra_lead_criado(cliente, pagina_sonda, limpar_ab):
    """A landing do lote 7 lê `ab_*` da URL e manda aqui. Sem isto, o teste A/B
    de uma landing nunca teria conversão — decisão 7 do plano do 8C."""
    r = await cliente.post("/publico/captura", json={
        "email": EMAIL_SONDA, "page_slug": pagina_sonda,
        "fields": {"nome": "Carla Sonda", "cargo": "Gerente de SESMT",
                   "empresa": "Transportes Exemplo", "whatsapp": "85999991234",
                   "ab_test": "teste-8c-captura", "ab_var": "B",
                   "ab_vid": "v_teste8c-cap"}})
    assert r.status_code == 200, r.text
    async with db.sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            "SELECT event_name, ab_var, page_slug, lead_id FROM ab_events "
            "WHERE ab_test = 'teste-8c-captura'")
    assert linha["event_name"] == "lead_criado" and linha["ab_var"] == "B"
    assert linha["page_slug"] == pagina_sonda and linha["lead_id"] is not None
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_ab_costura.py tests/test_conversao.py tests/test_captura.py`
Esperado: `test_ab_costura.py` falha no import (`app.ab.costura`); os de conversão e captura falham em `linhas == [...]` (nenhuma linha em `ab_events`).

- [ ] **Step 3: Escrever `app/ab/costura.py`**

```python
"""A costura do teste A/B no servidor — porte de `_shared/ab.ts`.

Quem chamava: `identity-upsert` e `receive-contact-event` (costura + conversão
`agendamento`) e o `leadConversion.ts` do cliente (conversão `lead_criado`).
⚠️ Os três foram portados SEM isto — lotes 1D (`7a2a1b2`) e 7 (`46f2a07`) — e o
funil do A/B ficou sem conversão nenhuma, em silêncio.

⚠️ NÃO BLOQUEIA, como na origem: erro é logado e engolido. Mas a origem rodava
fora de transação, e aqui a escrita roda DENTRO da transação de quem chama —
um erro de SQL a abortaria e levaria junto o contato, o evento ou a conversão.
Por isso cada função abre um SAVEPOINT (`conn.transaction()` aninhada): a falha
desfaz só o que é do A/B.

⚠️ `lead_id` vai como `$n::text::uuid`, e não `$n::uuid`: com `::uuid` o
asyncpg valida no CLIENTE e o erro nunca chega ao banco — o SAVEPOINT não
seria exercitado, e o teste que o prova passaria por acaso.
"""

import logging
from dataclasses import dataclass

from app.ab.eventos import SEM_DUPLICATA

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Ab:
    ab_vid: str | None = None
    ab_test: str | None = None
    ab_var: str | None = None


def extrair_ab(topo: dict, metadata: dict | None) -> Ab:
    """`ab_vid`/`ab_test`/`ab_var` do topo do corpo ou de `metadata`.

    ⚠️ Como o `??` da origem: só NULO no topo cai para o `metadata`; texto
    vazio no topo vira `None` e para ali.
    """
    md = metadata if isinstance(metadata, dict) else {}

    def pegar(chave: str) -> str | None:
        valor = topo.get(chave)
        if valor is None:
            valor = md.get(chave)
        if valor is None:
            return None
        return str(valor).strip() or None

    return Ab(pegar("ab_vid"), pegar("ab_test"), pegar("ab_var"))


async def costurar_visitante(conn, ab: Ab, *, email: str | None, phone: str | None,
                             phone_normalized: str | None, lead_id: str | None,
                             dnia_id: str | None, source_app: str,
                             metadata: dict | None) -> Ab:
    """Liga o visitante anônimo (`ab_vid`) ao contato, em `ab_identities`.

    Sem `ab_vid`, procura uma costura anterior pelo e-mail, depois pelo
    telefone. Sem teste/variante, completa pelo último clique do visitante.
    Não grava de novo o que já está lá; guarda o histórico entre `ab_vid`s.
    Devolve o que conseguiu resolver — é o que a conversão usa.
    """
    vid, teste, variante = ab.ab_vid, ab.ab_test, ab.ab_var
    email = email.strip().lower() if email else None
    telefone = phone_normalized or phone or None
    try:
        async with conn.transaction():
            if not vid and email:
                vid = await conn.fetchval(
                    "SELECT ab_vid FROM ab_identities WHERE lower(email) = $1 "
                    "ORDER BY linked_at DESC LIMIT 1", email)
            if not vid and telefone:
                vid = await conn.fetchval(
                    "SELECT ab_vid FROM ab_identities WHERE phone_normalized = $1 "
                    "ORDER BY linked_at DESC LIMIT 1", telefone)
            if not vid:
                return Ab(None, teste, variante)

            if not teste or not variante:
                clique = await conn.fetchrow(
                    "SELECT ab_test, ab_var FROM ab_assignments WHERE ab_vid = $1 "
                    "ORDER BY assigned_at DESC LIMIT 1", vid)
                if clique:
                    teste = teste or clique["ab_test"]
                    variante = variante or clique["ab_var"]

            if lead_id:
                existe = await conn.fetchval(
                    "SELECT 1 FROM ab_identities WHERE ab_vid = $1 AND lead_id = $2::text::uuid "
                    "LIMIT 1", vid, lead_id)
            elif email:
                existe = await conn.fetchval(
                    "SELECT 1 FROM ab_identities WHERE ab_vid = $1 AND lower(email) = $2 "
                    "LIMIT 1", vid, email)
            else:
                existe = None

            if not existe:
                await conn.execute(
                    """INSERT INTO ab_identities (ab_vid, email, phone, phone_normalized,
                                                  lead_id, dnia_id, source_app, metadata)
                       VALUES ($1, $2, $3, $4, $5::text::uuid, $6, $7, $8)""",
                    vid, email, phone, phone_normalized, lead_id, dnia_id,
                    source_app, metadata)
    except Exception:
        logger.exception("[ab] a costura falhou — o contato segue sem ela")
    return Ab(vid, teste, variante)


async def registrar_conversao_ab(conn, ab: Ab, nome: str, *, lead_id: str | None = None,
                                 dnia_id: str | None = None, page_slug: str | None = None,
                                 metadata: dict | None = None) -> None:
    """Conversão nomeada em `ab_events`, uma vez por visitante e teste.

    A chave de dedupe é a mesma que o coletor calcula para uma conversão
    vinda do navegador (`app/ab/eventos.py:chave_de_dedupe`): as duas portas
    deduplicam juntas.
    """
    if not ab.ab_vid or not ab.ab_test:
        return
    try:
        async with conn.transaction():
            await conn.execute(
                f"""INSERT INTO ab_events (ab_test, ab_var, ab_vid, event_type, event_name,
                                           lead_id, dnia_id, page_slug, metadata, dedupe_key)
                    VALUES ($1, $2, $3, 'conversion', $4, $5::text::uuid, $6, $7, $8, $9)
                    {SEM_DUPLICATA}""",
                ab.ab_test, ab.ab_var, ab.ab_vid, nome, lead_id, dnia_id, page_slug,
                metadata, f"{ab.ab_vid}:{ab.ab_test}:conversion:{nome}")
    except Exception:
        logger.exception("[ab] a conversão %s não foi registrada", nome)
```

- [ ] **Step 4: Ligar a costura em `/publico/identidade` e `/publico/evento-de-contato`**

Em `backend/app/routers/publico.py`, import:

```python
from app.ab.costura import Ab, costurar_visitante, extrair_ab, registrar_conversao_ab
```

Acrescentar a `IdentidadeIn` (depois de `contact_fields`):

```python
    # Teste A/B, no topo ou em `metadata` — como a origem
    # (`_shared/ab.ts:extractAbParams`). Ver `app/ab/costura.py`.
    ab_vid: str | None = None
    ab_test: str | None = None
    ab_var: str | None = None
    metadata: dict | None = None
```

Acrescentar a `EventoIn` (depois de `occurred_at`):

```python
    ab_vid: str | None = None
    ab_test: str | None = None
    ab_var: str | None = None
```

E, perto de `SOURCE_APPS`:

```python
# Os eventos que contam como a conversão `agendamento` do teste A/B — a lista
# de `receive-contact-event`.
EVENTOS_DE_AGENDAMENTO = ("meeting_scheduled", "scheduling_widget_booked")
```

Em `gravar_identidade`, dentro do `async with`, depois do bloco de
enriquecimento (antes do `return`):

```python
        # Costura A/B o mais cedo possível: atribui até quem abandona nas
        # etapas seguintes do agendamento. Só com sinal de A/B no corpo, como
        # na origem.
        ab = extrair_ab(dados.model_dump(), dados.metadata)
        if ab.ab_vid or ab.ab_test:
            await costurar_visitante(
                conn, ab, email=dados.email, phone=dados.phone,
                phone_normalized=resultado.get("phone_normalized"),
                lead_id=str(lead_id), dnia_id=str(dnia_id),
                source_app=dados.source_app or "marketinghs",
                metadata={"origin": "identity-upsert"})
```

Em `receber_evento`, trocar a busca do lead:

```python
        lead_id = await conn.fetchval(
            "SELECT dndash_lead_id FROM ecosystem_identities WHERE dnia_id = $1::uuid", dnia_id)
```

por:

```python
        identidade = await conn.fetchrow(
            "SELECT dndash_lead_id, email, phone FROM ecosystem_identities "
            "WHERE dnia_id = $1::uuid", dnia_id)
        lead_id = identidade["dndash_lead_id"] if identidade else None
```

e, depois do `INSERT INTO contact_events ...` (ainda dentro do `async with`):

```python
        # Costura A/B + conversão de agendamento. Sem `ab_vid`, a costura
        # procura pelo e-mail/telefone — da chamada ou, na falta, da
        # identidade (como a origem).
        ab = await costurar_visitante(
            conn, extrair_ab(dados.model_dump(), dados.metadata),
            email=dados.email or (identidade["email"] if identidade else None),
            phone=dados.phone or (identidade["phone"] if identidade else None),
            phone_normalized=identidade["phone"] if identidade else None,
            lead_id=str(lead_id) if lead_id else None, dnia_id=str(dnia_id),
            source_app=dados.source_app,
            metadata={"origin": "receive-contact-event", "event_type": dados.event_type})
        if dados.event_type in EVENTOS_DE_AGENDAMENTO:
            await registrar_conversao_ab(
                conn, ab, "agendamento", lead_id=str(lead_id) if lead_id else None,
                dnia_id=str(dnia_id), metadata={"event_type": dados.event_type})
```

- [ ] **Step 5: Ligar `lead_criado` em `/publico/conversao` e `/publico/captura`**

Em `registrar_conversao` (`publico.py`), depois do `UPDATE leads SET ...` e
antes de `tag = None`:

```python
        # `lead_criado` no teste A/B — era o `leadConversion.ts` do cliente,
        # apagado no lote 7 sem que esta rota assumisse.
        await registrar_conversao_ab(
            conn, Ab(dados.ab_vid, dados.ab_test, dados.ab_var), "lead_criado",
            lead_id=lead_id, page_slug=dados.page_slug)
```

Em `backend/app/routers/captura.py`, import:

```python
from app.ab.costura import Ab, registrar_conversao_ab
```

e depois do `INSERT INTO lead_conversions ...` (antes de `_aplicar_tag_do_slug`):

```python
        # `lead_criado` no teste A/B: a landing lê `ab_*` da URL e manda aqui.
        await registrar_conversao_ab(
            conn, Ab(campos.get("ab_vid"), campos.get("ab_test"), campos.get("ab_var")),
            "lead_criado", lead_id=lead_id, page_slug=dados.page_slug)
```

- [ ] **Step 6: Rodar e ver passar**

Run: `cd backend && ./.venv/bin/pytest -q tests/test_ab_costura.py tests/test_conversao.py tests/test_captura.py`
Esperado: tudo passa — os 7 novos de `test_ab_costura.py`, o novo de
`test_conversao.py` e o novo de `test_captura.py`, sem quebrar nenhum dos
existentes dos dois arquivos.

- [ ] **Step 7: Documentação da API**

Os campos `ab_vid`/`ab_test`/`ab_var` de `/publico/identidade` e
`/publico/evento-de-contato` já estavam documentados em
`frontend/src/components/admin/settings/ApiDocumentation.tsx:284` e `:369` —
**prometendo o que a API não fazia desde o lote 1D**. Confira que o texto das
duas linhas descreve o que agora acontece (costura em `ab_identities`;
conversão `agendamento` em `meeting_scheduled`/`scheduling_widget_booked`) e
acerte se não descrever. Faça o mesmo em
`frontend/public/api/dnmarketing-api.yaml`:

```bash
grep -n "ab_vid\|ab_test\|ab_var" frontend/public/api/dnmarketing-api.yaml
```

Se `/publico/identidade` ou `/publico/evento-de-contato` não declararem os três
campos, acrescente-os às propriedades do corpo, com a mesma descrição da tela.
Valide: `backend/.venv/bin/python -c "import yaml; yaml.safe_load(open('frontend/public/api/dnmarketing-api.yaml'))"`.

- [ ] **Step 8: Commit**

```bash
git add backend/app/ab/costura.py backend/app/routers/publico.py backend/app/routers/captura.py \
        backend/tests/test_ab_costura.py backend/tests/test_conversao.py \
        backend/tests/test_captura.py frontend/src/components/admin/settings/ApiDocumentation.tsx \
        frontend/public/api/dnmarketing-api.yaml
git commit -m "fix(8C): a costura e as conversões do A/B voltam — cortadas nos lotes 1D e 7"
```

---

### Tarefa 6: As telas falam com `/ab`, e o `ab.js` sem a dn.ia

**Files:**
- Modify: `frontend/src/lib/abConfig.ts`
- Modify: `frontend/src/hooks/useAbConfig.tsx`, `frontend/src/hooks/useAbTests.tsx`
- Modify: `frontend/src/pages/admin/Experiments.tsx`, `ExperimentDetail.tsx`, `ExperimentsSetup.tsx`
- Modify: `frontend/public/ab.js`
- Delete: `frontend/src/lib/ab.ts`

**Interfaces:**
- Consumes: as rotas das Tarefas 1 e 2.
- Produces: `useAbConfig()` → `{ productionDomain: string, redirectorBase: string | null, loading, saving, save(domain), saveRedirector(base): Promise<boolean>, refetch }`;
  `useAbEvents(testId)` → `{ events, truncado, teto }`;
  `abDistributionLink(base: string | null, slug)`, `abCollectorUrl(base)`, `abBaseHost(base)`.

- [ ] **Step 1: `lib/abConfig.ts`**

Substituir tudo do começo do arquivo até o fim de `abBaseHost` (linhas 1-47) por:

```ts
// Configuração do módulo A/B. O domínio de produção e o do redirecionador
// moram em `ab_config` (compartilhados pelo time) — ver useAbConfig. Até o
// lote 8C o redirecionador ficava no localStorage de cada navegador, com
// padrão https://go.dnia.ai: cada admin podia ver um link diferente.
//
// O "domínio do redirecionador" é o Custom Domain do Cloudflare Worker. Ele
// monta o Link de Distribuição e o endpoint do coletor.

// Link de Distribuição de um teste: {base}/{slug}. Vazio sem redirecionador.
export function abDistributionLink(base: string | null, slug: string): string {
  return base ? `${base}/${slug}` : "";
}

// Endpoint do coletor: {base}/e (o Worker leva para /publico/ab/eventos).
export function abCollectorUrl(base: string | null): string {
  return base ? `${base}/e` : "";
}

// Rótulo sem protocolo, para exibição compacta.
export function abBaseHost(base: string | null): string {
  return base ? base.replace(/^https?:\/\//i, "") : "(redirecionador não configurado)";
}
```

No restante do arquivo: apagar a linha `export const AB_PROD_DOMAIN_DEFAULT = "dnia.ai";`
e o comentário acima dela que fala do "fallback de UI"; nos comentários de
exemplo, trocar `dnia.ai` por `exemplo.com.br` (ex.: `isHostInDomain("promo.exemplo.com.br", "exemplo.com.br") === true`).

- [ ] **Step 2: `hooks/useAbConfig.tsx`** — substituir o arquivo inteiro:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { normalizeProductionDomain } from "@/lib/abConfig";

export interface AbConfig {
  production_domain: string | null;
  redirector_base: string | null;
}

// Configuração compartilhada do módulo A/B (linha única em `ab_config`): o
// domínio de produção, que valida as URLs de variante, e o redirecionador,
// que monta os links. Vazio = não configurado — a tela manda configurar.
export function useAbConfig() {
  const qc = useQueryClient();
  const consulta = useQuery({
    queryKey: ["ab_config"],
    queryFn: () => api.get<AbConfig>("/ab/config"),
  });
  const gravar = useMutation({
    mutationFn: (patch: Partial<AbConfig>) => api.put<AbConfig>("/ab/config", patch),
    onSuccess: (dados) => qc.setQueryData(["ab_config"], dados),
  });

  const save = async (domain: string) => {
    const clean = normalizeProductionDomain(domain);
    if (!clean) {
      toast.error("Informe um domínio válido (ex.: exemplo.com.br).");
      return;
    }
    try {
      await gravar.mutateAsync({ production_domain: clean });
      toast.success("Domínio de produção salvo.");
    } catch (e) {
      toast.error("Erro ao salvar o domínio de produção: " + (e as Error).message);
    }
  };

  const saveRedirector = async (base: string): Promise<boolean> => {
    try {
      await gravar.mutateAsync({ redirector_base: base || null });
      toast.success("Redirecionador salvo.");
      return true;
    } catch (e) {
      toast.error("Erro ao salvar o redirecionador: " + (e as Error).message);
      return false;
    }
  };

  return {
    productionDomain: consulta.data?.production_domain ?? "",
    redirectorBase: consulta.data?.redirector_base ?? null,
    loading: consulta.isLoading,
    saving: gravar.isPending,
    save,
    saveRedirector,
    refetch: consulta.refetch,
  };
}
```

- [ ] **Step 3: `hooks/useAbTests.tsx`**

Trocar as linhas 1-8 (import do supabase, comentário do alias e `const db`) por:

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ErroApi } from "@/lib/api";
```

As interfaces e os helpers (`publicSlugify`, `internalSlug`, `PUBLIC_SLUG_RE`,
`runningTestForSlug`) **ficam como estão**. Substituir do `export function useAbTests()`
até o fim do arquivo por:

```ts
export function useAbTests() {
  return useQuery({
    queryKey: ["ab_tests"],
    queryFn: () => api.get<AbTest[]>("/ab/testes"),
  });
}

export function useAbTest(id: string | undefined) {
  return useQuery({
    queryKey: ["ab_test", id],
    enabled: !!id,
    queryFn: async (): Promise<AbTest | null> => {
      try {
        return await api.get<AbTest>(`/ab/testes/${id}`);
      } catch (e) {
        // A tela trata "não existe" como null, como o maybeSingle() de antes.
        if (e instanceof ErroApi && e.status === 404) return null;
        throw e;
      }
    },
  });
}

export function useCreateAbTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<AbTest>) => api.post<AbTest>("/ab/testes", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ab_tests"] }),
  });
}

export function useUpdateAbTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<AbTest> }) =>
      api.patch<AbTest>(`/ab/testes/${id}`, patch),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["ab_tests"] });
      qc.invalidateQueries({ queryKey: ["ab_test", vars.id] });
    },
  });
}

export interface ActivateResult {
  activated: boolean;
  conflict_id?: string | null;
  conflict_name?: string | null;
  completed_id?: string | null;
  completed_name?: string | null;
}

// Ativação de um teste. A RPC é atômica: sem `force`, recusa e devolve o teste
// que já está rodando na mesma slug; com `force`, conclui esse teste e ativa o
// novo na mesma transação. Se outro admin ganhar a corrida, a rota devolve 409
// com a mensagem pronta para o toast.
export function useActivateAbTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) =>
      api.post<ActivateResult>(`/ab/testes/${id}/ativar`, { force: !!force }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["ab_tests"] });
      qc.invalidateQueries({ queryKey: ["ab_test", vars.id] });
    },
  });
}

export interface AbEventsPage {
  events: AbEventRow[];
  // true quando o teste tem mais eventos que o teto — o relatório é parcial.
  truncado: boolean;
  teto: number;
}

// Eventos do teste, mais novos primeiro, até 20.000 (o teto da origem).
export function useAbEvents(testId: string | undefined) {
  return useQuery({
    queryKey: ["ab_events", testId],
    enabled: !!testId,
    refetchInterval: 60000,
    queryFn: () => api.get<AbEventsPage>(`/ab/testes/${testId}/eventos`),
  });
}
```

Nos comentários de `AbTest.public_slug`, trocar `go.dnia.ai/{public_slug}` por `{redirecionador}/{public_slug}`.

- [ ] **Step 4: `Experiments.tsx`**

1. Import: `import { abDistributionLink, abBaseHost, normalizeProductionDomain, domainOf, isHostInDomain } from "@/lib/abConfig";` fica; trocar `const { productionDomain } = useAbConfig();` por `const { productionDomain, redirectorBase } = useAbConfig();`.
2. Em `handleCreate`, logo depois de `const prod = normalizeProductionDomain(productionDomain);`:

```ts
    if (!prod) {
      return toast.error("Configure o domínio de produção em Configuração do A/B antes de criar um teste.");
    }
```

3. `copyLink`:

```ts
  const copyLink = (slug: string) => {
    if (!redirectorBase) {
      toast.error("Configure o redirecionador em Configuração do A/B.");
      return;
    }
    navigator.clipboard.writeText(abDistributionLink(redirectorBase, slug));
    toast.success("Link de distribuição copiado.");
  };
```

4. As quatro chamadas `abBaseHost()` viram `abBaseHost(redirectorBase)`.
5. O placeholder `"https://dnia.ai/pagina"` vira `` {`https://${productionDomain || "exemplo.com.br"}/pagina`} ``.

- [ ] **Step 5: `ExperimentDetail.tsx`**

1. Import: `import { useAbConfig } from "@/hooks/useAbConfig";`.
2. Trocar `const { data: events, isLoading: loadingEvents } = useAbEvents(test?.slug);` por:

```ts
  const { data: eventosDoTeste, isLoading: loadingEvents } = useAbEvents(test?.id);
  const { redirectorBase } = useAbConfig();
```

3. Trocar `const rows = useMemo(() => events || [], [events]);` por `const rows = useMemo(() => eventosDoTeste?.events || [], [eventosDoTeste]);`.
   Conferir: `grep -n "\bevents\b" frontend/src/pages/admin/ExperimentDetail.tsx` não pode mostrar outro uso da variável antiga.
4. `copyLink`: a mesma guarda do passo anterior, com `abDistributionLink(redirectorBase, test.public_slug)`; `abBaseHost()` → `abBaseHost(redirectorBase)`.
5. Logo abaixo da linha que mostra `{abBaseHost(redirectorBase)}/{test.public_slug} · {test.status}`, o aviso do teto:

```tsx
            {eventosDoTeste?.truncado && (
              <p className="text-xs text-amber-600 mt-1">
                Mostrando os {eventosDoTeste.teto.toLocaleString("pt-BR")} eventos mais recentes — o
                relatório está parcial.
              </p>
            )}
```

- [ ] **Step 6: `ExperimentsSetup.tsx`**

1. Import: `import { abCollectorUrl, domainOf, isHostInDomain, normalizeProductionDomain } from "@/lib/abConfig";`.
2. `WORKER_CODE` inteiro:

```ts
// Código exato do Cloudflare Worker. As linhas de `target` usam template
// literals — por isso os crases e ${...} estão escapados aqui dentro.
const WORKER_CODE = `// Cloudflare Worker do Teste A/B — ligado ao Custom Domain do redirecionador
//   https://<redirecionador>/{slug}  -> ${API_URL}/publico/ab/go/{slug}
//   https://<redirecionador>/e       -> ${API_URL}/publico/ab/eventos

const API = '${API_URL}';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    let target;

    if (path === '/e' || path === '/e/') {
      target = \`\${API}/publico/ab/eventos\${url.search}\`;
    } else if (path === '/' || path === '') {
      target = \`\${API}/publico/ab/go\${url.search}\`;
    } else {
      target = \`\${API}/publico/ab/go\${path}\${url.search}\`;
    }

    const proxied = new Request(target, request);
    // O backend limita requisições por IP. Sem isto, todo visitante chegaria
    // com o IP do Cloudflare e dividiria o mesmo limite.
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip) proxied.headers.set('X-Forwarded-For', ip);

    // redirect:'manual' => o 302 do redirecionador vai INTACTO para o navegador.
    const resp = await fetch(proxied, { redirect: 'manual' });
    return new Response(resp.body, resp);
  },
};`;
```

3. Estado e derivados (substitui de `const [base, setBase] = useState(getAbBaseUrl());` até a linha do `snippet`):

```ts
  const abConfig = useAbConfig();
  const [base, setBase] = useState("");
  const [prodDomain, setProdDomain] = useState("");
  useEffect(() => {
    if (!abConfig.loading) {
      setProdDomain(abConfig.productionDomain);
      setBase(abConfig.redirectorBase ?? "");
    }
  }, [abConfig.loading, abConfig.productionDomain, abConfig.redirectorBase]);
  const cleanBase = base.trim().replace(/\/+$/, "");
  const collector = abCollectorUrl(cleanBase || null) || "<configure o redirecionador>";
  const prodNormalized = normalizeProductionDomain(abConfig.productionDomain);
  // Exemplos nos textos: o domínio de verdade quando configurado.
  const exemploDominio = prodNormalized || "exemplo.com.br";
  const exemploRedirecionador = domainOf(cleanBase) || `go.${exemploDominio}`;
  const snippet = `<script src="${window.location.origin}/ab.js" async data-endpoint="${collector}" data-cookie-domain=".${exemploDominio}"></script>`;
```

   E apagar a declaração antiga de `prodNormalized` mais abaixo (a que vem junto de `redirectorHost`), para não haver duas.

4. `save`: manter as validações; trocar as três últimas linhas (`setAbBaseUrl(cleanBase); setBase(cleanBase); toast.success("Configuração salva.");`) por `await abConfig.saveRedirector(cleanBase);`, tornar a função `async`, e o botão vira `<Button onClick={save} disabled={abConfig.saving || abConfig.loading}>`.
5. Textos: `"Salvo neste navegador."` → `"Salvo no banco, compartilhado pelo time."`; `placeholder={AB_BASE_DEFAULT}` → `` placeholder={`https://${exemploRedirecionador}`} ``; `placeholder="dnia.ai"` → `placeholder="exemplo.com.br"`. Nas explicações dos cards 1 e 2, do card "Por que um subdomínio dedicado", do card do Cloudflare/rate limit e do card do snippet: `go.dnia.ai` → `{exemploRedirecionador}`, `.dnia.ai` → `.{exemploDominio}`, `dnia.ai` → `{exemploDominio}`, e a regra de rate limit fica `(http.host eq "{exemploRedirecionador}" and http.request.uri.path eq "/e")`.
6. No card "Por que um subdomínio dedicado": **apagar** as frases sobre o app ser servido "pelo Lovable via Cloudflare for SaaS" e sobre não dar para interceptar `dnmkt.dnia.ai/go/*` — não valem mais. Fica o motivo que continua verdadeiro: o redirecionador precisa estar sob o domínio de produção para o cookie ser same-site.
7. No card do snippet, acrescentar ao texto: `Para levar o teste até um agendamento em iframe, acrescente data-iframe-match="<trecho da URL do iframe>" ao script.`
8. **O card "dn.nexus" não muda** (decisão 14).

Aceite:

```bash
grep -n "dnia\|dnmkt\|Lovable\|AB_BASE_DEFAULT\|getAbBaseUrl\|setAbBaseUrl" \
  frontend/src/pages/admin/ExperimentsSetup.tsx
```

Só pode sobrar linha **dentro do card "dn.nexus"** (do título `dn.nexus — configuração no agendamento` em diante).

- [ ] **Step 7: `public/ab.js`**

1. Cabeçalho: "script leve do Teste A/B da dn.ia (v1)" → "script leve do Teste A/B do MarketingHS". A linha de instalação vira
   `<script src="https://<app>/ab.js" async data-endpoint="https://<redirecionador>/e" data-cookie-domain=".<domínio>"></script>`.
   O item do iframe vira "Reescreve o src de TODO iframe cujo endereço contenha `data-iframe-match`...". A lista de atributos vira:

```
 *   data-endpoint        OBRIGATÓRIO — o coletor (https://<redirecionador>/e). Sem ele, nada é enviado.
 *   data-cookie-domain   ex.: .exemplo.com.br — sem ele, o cookie fica só no host da página
 *   data-iframe-match    trecho do src do iframe de agendamento que recebe o tracking
 *   data-require-consent "true" para exigir consentimento
```

2. Configuração:

```js
  var ENDPOINT = cfg.endpoint || null;
  var COOKIE_DOMAIN = cfg.cookieDomain || null;
  var IFRAME_MATCH = cfg.iframeMatch || null;
  var REQUIRE_CONSENT = String(cfg.requireConsent || '') === 'true';
  var COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 dias
  if (!ENDPOINT && window.console) console.warn('[ab.js] sem data-endpoint: nenhum evento será enviado.');
```

3. `canScopeDomain`:

```js
  function canScopeDomain() {
    // Só usa Domain= quando a página está de fato sob esse domínio (em
    // localhost/preview grava sem domain para não falhar em silêncio).
    if (!COOKIE_DOMAIN) return false;
    var d = COOKIE_DOMAIN.replace(/^\./, '').toLowerCase();
    var h = location.hostname.toLowerCase();
    return h === d || h.slice(-(d.length + 1)) === '.' + d;
  }
```

4. `send`: `if (!CONSENT || !ENDPOINT) return;`; o `Blob` passa a `{ type: 'text/plain;charset=UTF-8' }` e o `fetch` a `headers: { 'content-type': 'text/plain;charset=UTF-8' }`, com o comentário `// text/plain: sem preflight de CORS, e o sendBeacon aceita (decisão 5 do 8C).`
5. `rewriteNexusIframe` → `rewriteIframe`, com `if (!HAS_ASSIGNMENT || !IFRAME_MATCH || !iframe || iframe.__abRewritten) return;` e `if (src.indexOf(IFRAME_MATCH) === -1) return;`; atualizar as duas chamadas em `rewriteAllIframes`.

Aceite: `grep -n "dnia\|nexus" frontend/public/ab.js` não devolve nada.

- [ ] **Step 8: Apagar `lib/ab.ts`**

```bash
grep -rn 'lib/ab"' frontend/src     # tem de voltar vazio — só abStats/abConfig importam de lib/ab*
git rm frontend/src/lib/ab.ts
```

- [ ] **Step 9: Tipos e build**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.app.json && npx vite build`
Esperado: sem erro.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/lib/abConfig.ts frontend/src/hooks/useAbConfig.tsx \
        frontend/src/hooks/useAbTests.tsx frontend/src/pages/admin/Experiments.tsx \
        frontend/src/pages/admin/ExperimentDetail.tsx \
        frontend/src/pages/admin/ExperimentsSetup.tsx frontend/public/ab.js
git commit -m "feat(8C): as telas de Experiments falam com /ab; ab.js sem a dn.ia"
```

---

### Tarefa 7: O portão

**Files:**
- Delete: `backend/supabase/functions/go/`, `backend/supabase/functions/ab-events/`, `backend/supabase/functions/_shared/ab.ts`
- Modify: `docs/CONTINUAR-AQUI.md`, `docs/superpowers/plans/2026-09-10-marketinghs-lote-8-fechamento.md` (placar)

- [ ] **Step 1: As telas não falam mais com o Supabase**

```bash
cd /home/ericks/github/MarketingHS
grep -rn "supabase" frontend/src/pages/admin/Experiment*.tsx frontend/src/hooks/useAb*.tsx \
  frontend/src/lib/abConfig.ts frontend/public/ab.js
grep -rn "supabase as any\|= supabase;" frontend/src --include=*.ts --include=*.tsx
```

Esperado: as duas buscas vazias. (O alias não existe mais em lugar nenhum —
os 9 pontos invisíveis do placar antigo eram todos daqui.)

- [ ] **Step 2: Ninguém mais chama as functions**

```bash
grep -rn "ab-events\|functions.invoke\|SUPABASE_FUNCTIONS" frontend/src frontend/public backend/app
grep -rln "integrations/supabase" frontend/src
grep -rl "_shared/ab" backend/supabase/functions
```

Esperado: a primeira vazia; a segunda só `LimiteDeErro.tsx` e `NexusCard.tsx`
(o 8D tira o segundo); a terceira vazia.

- [ ] **Step 3: A suíte inteira, contra o banco**

Run (primeiro plano, **nunca interromper**):
`cd backend && timeout 590 ./.venv/bin/pytest -q`
Esperado: tudo passa. Anote o número — é o placar de testes do 8C.

- [ ] **Step 4: A tela no navegador**

⚠️ A conta admin do Claude (`claude.dev@example.com`) **não existe mais no
banco** — a restauração da VPS de 10/09 levou. Recriar pede **ok do Erick**.
Com ela, Vite em `127.0.0.1:8080` e backend na 8100, conferir no Playwright:

1. `/experiments/setup`: salvar domínio `exemplo.com.br` e redirecionador
   `https://go.exemplo.com.br`; recarregar a página e ver os dois voltarem
   (vêm do banco, não do navegador); o código do Worker aponta para
   `/publico/ab/go` e `/publico/ab/eventos`; o snippet traz `data-endpoint` e
   `data-cookie-domain`.
2. `/experiments`: criar um teste com duas variantes em `exemplo.com.br`
   (e ver a recusa de uma URL fora dele); ativar; criar outro na mesma slug e
   ver o diálogo de conflito; forçar; pausar; concluir com vencedora;
   arquivar; copiar o link (vem com `go.exemplo.com.br/<slug>`).
3. `/experiments/<id>`: o relatório abre sem erro no console; mandar dois
   eventos com `curl -X POST http://127.0.0.1:8100/publico/ab/eventos` para o
   `slug` do teste e vê-los aparecer (espera até 60s, ou recarregar); exportar CSV.
4. Fazer um `curl -i http://127.0.0.1:8100/publico/ab/go/<slug>` e conferir o
   302 e os `Set-Cookie`.
5. **Apagar tudo o que a conferência criou** (testes, eventos, e voltar
   `ab_config` para o que era — hoje, vazia).

- [ ] **Step 5: A tela ainda FAZ o que fazia — capacidade por capacidade**

Contra as **functions** e os arquivos de antes do porte, não contra este plano:

```bash
git show 57c9470:backend/supabase/functions/go/index.ts
git show 57c9470:backend/supabase/functions/ab-events/index.ts
git show 57c9470:backend/supabase/functions/_shared/ab.ts
git diff 57c9470 -- frontend/src/pages/admin/ frontend/src/hooks/useAb*.tsx frontend/public/ab.js
```

Marcar cada linha com onde ela mora agora, ou por que mudou (com o número da decisão):

- `go`: slug por caminho e por `?t=`; resolução running > já rodou > rascunho;
  permanência pelo cookie do teste; `ab_vid` compartilhado; sorteio por peso
  (≤0 vale 1); pausado/rascunho → controle; concluído → vencedora; trava de
  domínio (sem config, segue); query preservada menos `t`; `ab_test`/`ab_var`/`ab_vid`;
  cookies 90 dias, `SameSite=Lax`, `Secure`, `Domain`; `no-store`,
  `noindex`, `Referrer-Policy`; `ab_assignments` só no primeiro clique;
  evento `assignment` `new`/`sticky`; user-agent; nunca página de erro
  (dec. 2: 404 só sem configuração).
- `ab-events`: só POST; CORS (dec. 5); robô → 200 `skipped`; JSON quebrado →
  400; os três formatos de corpo; 50 por request; tipos válidos; truncamentos;
  aparelho/navegador/SO/idioma/referer de reserva; chaves de dedupe;
  duplicata absorvida; 202 `accepted`; gravação depois da resposta.
- `_shared/ab.ts`: topo antes de `metadata`; busca por e-mail e telefone;
  teste/variante pelo último clique; não duplica; `recordConversion` com
  dedupe. Chamadores: identidade, evento de contato, conversão, captura (dec. 7).
- Telas: listar; criar (validação de domínio, slug pública, amostra);
  pausar; ativar com conflito e `force`; concluir com vencedora; arquivar;
  copiar link; relatório (eventos até 20.000, filtros, CSV, veredito);
  configuração (domínio, redirecionador, Worker, snippet, card do Nexus).

Qualquer linha sem lugar é defeito do 8C — corrigir antes do `git rm`.

- [ ] **Step 6: As functions saem**

```bash
git rm -r backend/supabase/functions/go backend/supabase/functions/ab-events \
          backend/supabase/functions/_shared/ab.ts
ls backend/supabase/functions/
```

Esperado: sobram `get-nexus-stages`, `handoff-to-nexus`, `nexus-config` e `_shared`.

- [ ] **Step 7: Placar e registro**

- `docs/CONTINUAR-AQUI.md`: bloco do 8C no topo — o que entrou, os achados 1-5
  deste plano (em especial o corte das conversões), o número de testes, e as
  perguntas ao Erick abaixo.
- Placar do documento-mãe e do `CONTINUAR-AQUI`: **44 functions portadas, 7
  descartadas, restam 3** (`get-nexus-stages`, `handoff-to-nexus`,
  `nexus-config`). Telas migradas: as três de Experiments. (Os dois números
  nunca se somam.)
- Anotar para o 8E: `docs/ab-testing/` é a documentação da origem (dn.ia,
  `go.dnia.ai`, Supabase) e contradiz o código a partir de agora.

**Perguntas ao Erick, registradas no portão:**

1. **Peso 0 numa variante** (decisão 15): hoje vale 1, como na origem. Deve
   passar a significar "sem tráfego"?
2. **Recriar a conta admin do Claude** para a conferência no navegador (passo 4).

- [ ] **Step 8: Commit**

```bash
git add -A docs/ backend/supabase/functions/
git commit -m "chore(8C): o portão fecha — go, ab-events e _shared/ab.ts saem"
```

---

## Autorrevisão deste plano

**Cobertura do documento-mãe (§8C):** `go` → Tarefa 3; `ab-events` → Tarefa 4;
as três telas → Tarefa 6; `lib/ab.ts` → Tarefa 6, passo 8 (apagado, não
portado: achado 2); `public/ab.js` → Tarefa 6, passo 7; os 9 pontos do alias →
Tarefa 6, passo 3, conferidos na Tarefa 7, passo 1; `go.dnia.ai` em
`abConfig.ts` → Tarefa 6, passo 1; domínio do Worker vira campo de `ab_config`
→ Tarefa 1 (`redirector_base`). Fora do documento-mãe e trazido pela leitura:
a costura e as conversões (Tarefa 5), o `DEFAULT 'dnia.ai'` (Tarefa 1), o
CORS do coletor (Tarefa 4).

**Nomes entre tarefas:** `normalizar_dominio`, `host_no_dominio`,
`ler_user_agent`, `sortear` (T1) → usados em T3/T4. `ORIGEM`, `inserir`,
`SEM_DUPLICATA` (T3) → T4/T5. `Ab`, `extrair_ab`, `costurar_visitante`,
`registrar_conversao_ab` (T5) → só T5. `TETO_EVENTOS` e o formato
`{events, truncado, teto}` (T2) → `AbEventsPage` (T6). `redirector_base` (T1) →
`redirectorBase` (T6). `PREFIXO_AB`/`limpar_ab` (T1) → T2-T5; todo `ab_test`
de teste começa com `teste-8c` e todo `ab_vid` com `v_teste8c`.

**Riscos conhecidos:**
- `ON CONFLICT ((true))` depende do Postgres inferir o índice de expressão da
  migration 017. Se não inferir, `test_config_normaliza_o_dominio_e_grava_parcial`
  falha na Tarefa 1 — é ali que se descobre, não em produção.
- O `BackgroundTasks` roda antes do `httpx.ASGITransport` devolver a resposta
  ao teste; é isso que deixa os testes lerem o que o redirecionador e o
  coletor gravaram. Se um dia não rodar, os testes de gravação falham em vez
  de passar vazios.
- O cookie `Domain=.<domínio>` só é aceito quando o navegador fala com o
  subdomínio do Worker. Na conferência local (backend direto) o cookie é
  recusado — esperado, não defeito (docstring de `ab_publico.py`).
- Os testes do coletor passam pelo limite de taxa de `/publico` (30/min por
  IP, balde compartilhado com os testes de captura e conversão, todos com o
  mesmo IP do cliente ASGI). Se a suíte inteira começar a levar 429 no
  coletor, é esse balde — não o coletor. Não isente o coletor para "consertar"
  o teste (decisão 6); espace ou agrupe os eventos do teste.
