# Prova de substituição do RD — plano de implementação

> **Para quem executa (agente):** SUB-SKILL OBRIGATÓRIA: `superpowers:subagent-driven-development`
> (padrão do repositório, ver "Modo autônomo" no `CLAUDE.md`) ou
> `superpowers:executing-plans`. Os passos usam caixa (`- [ ]`) para
> acompanhamento.

**Objetivo:** o MarketingHS faz, ponta a ponta e só com e-mails nossos, as três
coisas que o RD faz hoje para a H&S — pegar o lead (landing e formulário de
outro site), entregar ao comercial (GrowthHS, ou o receptor de teste) e nutrir
por e-mail — e mede visitas, conversões e taxa por página e por canal.

**Arquitetura:** uma migration (027) traz todo o schema novo de uma vez. O
backend ganha campos tipados com validação no servidor, consentimento por
conversão, "sites" com token público + endpoints de visita/conversão com CORS
por domínio, números por página, a volta do CRM e um receptor de teste do
contrato do GrowthHS. As jornadas ganham modo teste, os nós "avisar por
e-mail" e "enviar para webhook" (por uma caixa de saída drenada pelo worker) e
arquivo PDF. No front: a landing com cara de landing, o script `rastreio.js`
(convive com o do RD), a página de teste de outra origem, e as telas.

**Tech stack:** FastAPI + asyncpg (`backend/`), Postgres 17 do EasyPanel
(produção), React 18 + Vite + shadcn + TanStack Query (`frontend/`), JS puro
sem dependência no `frontend/public/rastreio.js`, `node --test` (Node 24, que
tira tipos de `.ts` com sintaxe apagável) e `pytest`.

**Spec:** `docs/superpowers/specs/2026-10-21-prova-substituir-rd-design.md`
(inclusive a seção 9, decisões da revisão). Lidos junto: `CLAUDE.md`,
`docs/inventario-rd.md`, `docs/frentes/README.md`,
`docs/contratos/2026-09-02-endpoint-card-comercial-growthhs.md`.

## Global Constraints

- **O banco é o de produção.** Nenhum agente aplica migration, escreve no banco
  fora de teste, faz deploy ou clica em ação no navegador. Migration, seed,
  configuração e deploy saem como script que o **Erick** roda no Konsole.
- Migration nova é **uma só, `backend/migrations/027_prova_substituir_rd.sql`**,
  da frente `prova-captura`. Reaplicável: `CREATE TABLE IF NOT EXISTS`,
  `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP POLICY IF
  EXISTS` antes de `CREATE POLICY`. Provada **duas vezes** num Postgres 17
  local descartável com as 27 migrations. **Nenhum `CREATE EXTENSION`.**
- **Os três índices únicos são intocáveis:** `uniq_campaign_sends_email_campaign_lead`,
  `uniq_campaign_sends_journey_node`, `uniq_journey_runs_open`.
- Rota de usuário: `admin_atual` + `sessao(role="authenticated", user_id=usuario.id)`.
  Rota pública/máquina e worker: `sessao(role="service_role")`. Cada rota
  autoriza sozinha; o RLS é segunda linha. Papel é `'admin'`.
- **Toda chave nova de ambiente em `Settings`** (`backend/app/config.py`):
  `PROVA_RECEPTOR_TESTE: bool = False` e `LIMITE_VISITA_POR_MINUTO: int = 120`.
  Nenhuma outra.
- **Antimeta nº 1:** nenhum e-mail sai para fora da lista. As jornadas da prova
  entram só por evento `form_submitted` **filtrado** por página/formulário da
  prova, nascem em **modo teste** (`journeys.allowed_emails`), e nunca por
  segmento.
- **Antimeta do script:** o `rastreio.js` nunca chama `preventDefault`, nunca
  espera rede antes do envio original (`navigator.sendBeacon`, recuo para
  `fetch(..., {keepalive: true})`), e todo o código roda em `try/catch`.
- **Token público** (`sites.token`, prefixo `pub_`) só cria/atualiza lead,
  conversão e visita. Nunca lê dado, nunca dispara campanha. Só vale com
  `Origin` de domínio cadastrado.
- Cor no JSX do admin **só de token** (`npm run guarda:visual -- <pasta>` = 0).
  Exceções: a landing pública (`src/landing/`), o `rastreio.js` e a página de
  teste.
- Identificadores fixos da prova: página `phoebus-prova`; formulário de cotação
  `prova_cap_phoebus`; formulário da ficha `prova_ficha_phoebus`; tag
  `prova-rd`; base legal do site `legitimo_interesse_pedido_contato`, versão
  `provisoria-2026-10`; política `https://www.healthsafety.com.br/privacidade.cfm`.
- Estágios do CRM: `meeting_scheduled` → `MQL - Reunião agendada`; `deal_won` →
  `Venda realizada`. **Só avança** pela `lead_statuses.sort_order`.
- **Testes de backend batem no banco de produção.** Escrita só em transação
  revertida (`conexao`) ou com `cliente` + limpeza por id (`tests/limpeza.py`).
  Fixture local que comita depende de `cliente` ou leva
  `@pytest.mark.trava_global`. Teste que depende da 027 **pula** com motivo
  enquanto ela não estiver aplicada (molde `_exigir_026` de
  `tests/test_r5_jornadas.py`). `count(*) FROM leads` igual antes e depois da
  suíte, anotado no arquivo da frente.
- Portão de cada frente antes do push: `git diff --stat`, nenhum
  `.env`/credencial no diff, `pytest` dos arquivos tocados e a suíte inteira
  **uma vez** (`timeout 3600`), `npx tsc --noEmit -p tsconfig.app.json` sem
  erro novo além dos 4 conhecidos, `npm run guarda:visual -- src` sem subir,
  `npx vite build` e `npm run build:landing`.
- Frente commita e faz push **da própria branch**, nunca faz merge na `main`,
  nunca mexe em `CONTINUAR-AQUI.md`. Pergunta de produto vai para
  `docs/frentes/<frente>.md` com a opção assumida (a mais segura e reversível).

## O contrato da config da página (`pages.config`)

Compartilhado por `prova-captura` (lê no servidor), `prova-landing` (desenha e
edita). Chaves novas; as antigas (`headline`, `subheadline`, `cta_text`,
`cta_color`, `visible_fields`, `redirect_url`, `meta_*`, `clarity`) continuam.

```ts
campos?: { chave: string; rotulo: string;
           tipo: 'texto'|'email'|'telefone'|'lista'|'sim_nao'|'texto_longo';
           obrigatorio: boolean; opcoes?: string[] }[];
corpo?: string;             // parágrafos separados por linha em branco; linha "- x" vira item de lista
imagem_url?: string;        // /publico/imagem/<id> ou URL absoluta
mensagem_obrigado?: string; // mostrada na própria página depois do envio
consentimento?: { texto: string; link: string; versao: string;
                  provisoria: boolean; obrigatorio: boolean };
whatsapp?: { numero: string; mensagem: string };   // número só dígitos, com DDI
noindex?: boolean;
tags?: string[];            // aplicadas na captura, além da tag do slug
```

`chave` de campo: coluna da lista branca (`app/captura/campos.py::CAMPOS_PERMITIDOS`)
ou `email` → vai para a coluna; qualquer outra chave casando
`^[a-z][a-z0-9_]{0,39}$` → `leads.campos_extras`. Sem `campos`, vale
`visible_fields` (tudo texto, só e-mail obrigatório) — comportamento de hoje.

## Frentes

| Frente | n | Vite | Backend | Território (escreve só aqui + `docs/frentes/<frente>.md`) | Quando |
|---|---|---|---|---|---|
| `prova-captura` | 17 | 8097 | **8117** | `backend/migrations/027_*`, `backend/app/config.py`, `backend/app/main.py`, `backend/app/middleware/`, `backend/app/captura/**`, `backend/app/crm/**`, routers `captura.py`, `landing.py`, `paginas.py`, `publico.py`, `api_contato.py`, `leitura_contatos.py` e os novos `sites.py`, `rastreio.py`, `receptor_growthhs.py`; `backend/tests/limpeza.py`, `tests/test_migracao_027.py`, `tests/test_prova_{campos,captura,site,numeros,crm}.py`; o contrato do GrowthHS; `~/marketinghs-migration-027.sh` | **Fase 0** (Tarefa 1) e depois Fase 1 |
| `prova-jornadas` | 18 | 8098 | **8118** | `backend/app/jornadas/**`, `backend/app/worker.py`, `backend/app/ritmo.py`, routers `jornadas.py`, `imagens.py`; `tests/test_prova_{jornadas,saidas,arquivos}.py` | Fase 1, depois do merge da Tarefa 1 |
| `prova-landing` | 19 | 8099 | usa a 8100 | `frontend/src/landing/**`, `frontend/public/rastreio.js`, `frontend/public/prova/**`, `components/admin/pages/PageConfigEditor.tsx`, `components/admin/pages/CamposEditor.tsx` (novo), `frontend/scripts/{landing-campos,rastreio}.test.mjs` | Fase 1 (não depende da 027) |
| `prova-telas` | 14 | 8094 | usa a 8100 | `frontend/src/lib/{sites,numeros,journeys,config}.ts`, `components/admin/settings/SitesSettings.tsx`, `pages/admin/SettingsPage.tsx`, `components/admin/pages/PagesManagement.tsx`, `components/admin/pages/NumerosDasPaginas.tsx`, `components/admin/automations/**`, `pages/admin/JourneyBuilder.tsx`, `hooks/useJourneys*`, `components/admin/segments/SegmentFormModal.tsx`, `components/admin/LeadDetailSheet.tsx`, a página de Contatos (`pages/admin/` da rota `contacts`), `components/admin/templates/ArquivosDialog.tsx` (novo) e quem o abre, `frontend/scripts/journeys-nos.test.mjs` | Fase 1; se já houver 4 abertas, abre quando a primeira fechar |
| `coordenadora` | 0 | — | — | `docs/frentes/README.md`, merge, `docs/prova-rd/**`, `scripts/prova-rd/**`, `~/marketinghs-prova-rd.sh`, `CONTINUAR-AQUI.md`, `perguntas-abertas.md` | Fase 2 (Tarefa 18) |

**Ordem.** Fase 0: `prova-captura` faz só a Tarefa 1 e marca "pronto para
merge"; a coordenadora mergeia e entrega ao Erick `bash
~/marketinghs-migration-027.sh` (aditiva: tabelas e colunas novas, funções
recriadas — pode ir antes do deploy; sem ela os testes da Fase 1 pulam).
Fase 1: as quatro frentes em paralelo. Fase 2: depois dos quatro merges, a
Tarefa 18.

**Pontos de costura entre frentes** (cada lado só conhece o outro por aqui):
corpo de `POST /publico/captura` e `POST /publico/site/*` (Tarefas 3 e 4 ×
Tarefas 10 e 11); config da página (acima); `GET /sites*`, `GET
/paginas/numeros`, `GET /contatos/{id}/consentimentos`, `POST /arquivos`,
`journeys.allowed_emails`, nós `notify_email`/`webhook`, regra `campo_extra`
(Tarefas 1, 4–9 × 13–17).

## Review Focus

1. **Formulário enviado por JavaScript ou por AJAX** (`form.submit()` não
   dispara `submit`; AJAX chama `preventDefault`) e **reenvio depois de erro de
   validação do próprio site** — o envio original nunca é afetado; o script
   manda a conversão no evento `submit` mesmo com `defaultPrevented`, e
   descarta repetição do mesmo (`form_id`, e-mail) em 10 s. Teste na Tarefa 11.
2. **Celular digitado de qualquer jeito** — `+55 (31) 99999-9999`,
   `5531999999999`, `031 99999 9999`, `(31) 3333-4444` — vira `+5531999999999`
   / `+553133334444`; 8 ou 9 dígitos depois do DDD; DDD inválido (`00`) e
   número curto são recusados com mensagem no campo. Teste na Tarefa 2.
3. **Navegador que não manda `Origin`** (extensão de privacidade, `file://`) ou
   manda `Origin` de domínio não cadastrado — 403, nada gravado, e o site
   segue funcionando. Teste na Tarefa 4.
4. **Lista do modo teste com caixa e espaço** (`" Erick@HealthSafety.com.br "`)
   e contato gravado com caixa diferente — a comparação é sem caixa e aparada
   dos dois lados; a lista vazia (`[]`) vale como "sem modo teste" só quando o
   admin a apaga de propósito, nunca por erro de parse. Teste na Tarefa 7.
5. **Página antiga, sem nenhuma chave nova na config** — a landing renderiza e
   capta como hoje (só e-mail obrigatório, sem consentimento, sem extras), e a
   casca não ganha `noindex`. Testes nas Tarefas 3 e 10.

---

## Fase 0 — `prova-captura`

### Tarefa 1: Migration 027 — todo o schema da prova

**Files:**
- Create: `backend/migrations/027_prova_substituir_rd.sql`
- Create: `backend/tests/test_migracao_027.py`
- Create: `~/marketinghs-migration-027.sh` (molde: `~/marketinghs-migration-026.sh`)
- Modify: `docs/frentes/prova-captura.md` (estado + prova local)

**Interfaces — Produces (o schema que todas as frentes usam):**
- `leads.campos_extras jsonb NOT NULL DEFAULT '{}'`.
- `lead_conversions` + `form_id text`, `site_id uuid`, `visitor_id text`,
  `page_url text`, `page_path text`, `canal text`.
- `lead_consents (id uuid pk, lead_id uuid FK leads ON DELETE CASCADE,
  conversao_id uuid NULL, base_legal text CHECK IN ('consentimento',
  'legitimo_interesse_pedido_contato'), texto text NOT NULL, versao text NOT
  NULL, provisoria bool NOT NULL DEFAULT false, ip text, user_agent text,
  origem_tipo text CHECK IN ('pagina','site'), page_slug text, site_id uuid,
  form_id text, page_url text, criado_em timestamptz DEFAULT now())`, índice
  `(lead_id, criado_em DESC)`.
- `sites (id uuid pk, nome text NOT NULL, dominios text[] NOT NULL DEFAULT '{}',
  token text NOT NULL UNIQUE, mapa_campos jsonb NOT NULL DEFAULT '{}', tags
  text[] NOT NULL DEFAULT '{}', ativo bool NOT NULL DEFAULT true, criado_em,
  atualizado_em)`.
- `visitas (id bigint identity pk, criado_em timestamptz DEFAULT now(),
  visitor_id text NOT NULL, site_id uuid NULL FK sites ON DELETE SET NULL,
  page_slug text NULL, url text, path text, titulo text, referrer text,
  utm_source…utm_content text, gclid text, fbclid text, canal text NOT NULL,
  primeiro_toque jsonb, CHECK (site_id IS NOT NULL OR page_slug IS NOT NULL))`,
  índices `(page_slug, criado_em)`, `(site_id, path, criado_em)`, `(visitor_id)`.
- `journeys.allowed_emails text[] NULL` (NULL = sem modo teste).
- `journey_saidas (id bigint identity pk, journey_id uuid, journey_run_id uuid
  NOT NULL, journey_node_id text NOT NULL, lead_id uuid, tipo text CHECK IN
  ('aviso_email','webhook'), destino text NOT NULL, payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pendente' CHECK IN ('pendente','enviado',
  'falhou'), tentativas int NOT NULL DEFAULT 0, visivel_em timestamptz NOT
  NULL DEFAULT now(), erro text, resend_email_id text, enviado_em
  timestamptz, criado_em, atualizado_em)`, `CONSTRAINT
  uniq_journey_saidas_run_node UNIQUE (journey_run_id, journey_node_id)`,
  índice parcial `(visivel_em) WHERE status = 'pendente'`.
- `growthhs_receptor_pedidos (id bigint identity pk, external_id text NOT NULL
  UNIQUE, corpo jsonb NOT NULL, vezes int NOT NULL DEFAULT 1, recebido_em,
  atualizado_em)`.
- Funções (cópia fiel da versão vigente + o mínimo):
  - `build_segment_condition` (001): `WHEN 'campo_extra'` com `p_rule->>'key'`
    (validado `^[a-z][a-z0-9_]{0,39}$`, senão `'FALSE'`), operadores `is`,
    `is_not`, `contains`, `not_contains` sobre `campos_extras->>key`
    (comparação sem caixa; `is_not`/`not_contains` incluem a chave ausente).
    Vale para segmento **e** para o ramo `branch_attribute` (mesma função).
  - `validate_journey_graph` (026): aceita `notify_email` (exige
    `config.emails` array não vazio) e `webhook` (exige `config.url` começando
    por `https://`).
  - `fn_lead_insert_event` (026): metadata ganha `form_id` e `site_id` de
    `current_setting('marketinghs.form_id'|'marketinghs.site_id', true)`.
  - `journey_enroll_event(uuid, text, jsonb)` (026): filtro passa a ser "sem
    `page_slug` e sem `form_ids` = qualquer origem; senão casa se `page_slug =
    metadata.page_slug` **ou** `metadata.form_id ∈ entry_config.form_ids`"
    (`jsonb_typeof = 'array'` antes de usar). Reconversão só entra em fluxo
    filtrado (por um ou outro). Contexto do run ganha `form_id`.
  - `validate_contact_event_source_app` (006): aceita `'growthhs'`.
- RLS ligado nas cinco tabelas novas; políticas admin
  (`has_role(auth.uid(), 'admin'::app_role)`, molde da 021): `sites` ALL;
  `lead_consents`, `visitas`, `journey_saidas` SELECT. GRANT a
  `service_role` (tudo + sequências) e `SELECT` a `authenticated` em
  `lead_consents`, `visitas`; ALL a `authenticated` em `sites`.

- [ ] **Passo 1: testes que falham.** `tests/test_migracao_027.py`:

```python
def test_027_reaplicavel_no_texto():
    sql = ARQUIVO.read_text()
    assert "CREATE EXTENSION" not in sql
    assert not re.search(r"CREATE TABLE (?!IF NOT EXISTS)", sql)
    assert not re.search(r"ADD COLUMN (?!IF NOT EXISTS)", sql)
    for nome in ("uniq_campaign_sends_email_campaign_lead",
                 "uniq_campaign_sends_journey_node", "uniq_journey_runs_open"):
        assert nome not in sql
    assert sql.count("CREATE POLICY") == sql.count("DROP POLICY IF EXISTS")

async def test_027_campo_extra_no_segmento(conexao):      # pula sem a 027
    lead = ...  # INSERT com campos_extras = '{"ja_faz_testagem": "sim"}'
    regra = [{"field": "campo_extra", "key": "ja_faz_testagem", "operator": "is", "value": "Sim"}]
    assert await conexao.fetchval("SELECT evaluate_rules_for_lead($1::uuid, $2::jsonb, 'and')", lead, regra) is True
    regra[0]["operator"] = "is_not"
    assert ... is False
    regra[0]["key"] = "x; DROP TABLE leads"
    assert ... is False                                     # chave inválida vira FALSE

async def test_027_grafo_aceita_notify_e_webhook(conexao): ...   # validate_journey_graph sem exceção
async def test_027_grafo_recusa_webhook_sem_https(conexao): ...  # asyncpg.RaiseError
async def test_027_grafo_recusa_notify_sem_emails(conexao): ...
async def test_027_matricula_por_form_id(conexao):
    # jornada A: entry_config {event_type: form_submitted, form_ids: ["prova_cap_phoebus"]}
    # jornada B: {form_ids: ["outro"]}; jornada C: {page_slug: "phoebus-prova"}
    n = await conexao.fetchval("SELECT journey_enroll_event($1::uuid, 'form_submitted', $2::jsonb)",
                               lead, {"form_id": "prova_cap_phoebus"})
    assert n == 1   # só A
async def test_027_reconversao_por_form_so_em_fluxo_filtrado(conexao): ...
async def test_027_evento_de_insert_leva_form_id(conexao):
    # set_config('marketinghs.form_id','prova_cap_phoebus', true); INSERT lead
    assert metadata["form_id"] == "prova_cap_phoebus"
async def test_027_source_app_growthhs_aceito(conexao): ...
```

Guarda de pulo: `_exigir_027(conexao)` = `pytest.skip` se
`to_regclass('public.journey_saidas')` for nulo.

- [ ] **Passo 2:** `./.venv/bin/pytest -q tests/test_migracao_027.py` → o teste
  de texto FALHA (arquivo não existe); os de banco PULAM.
- [ ] **Passo 3:** escrever a 027 (cabeçalho no molde da 026: o que faz, "O
  ERICK RODA", "rode duas vezes", cada função dizendo de qual migration foi
  copiada e o que mudou).
- [ ] **Passo 4: prova local.** Postgres 17 descartável em container
  (`docker run --rm`, porta livre), aplicar `000`…`027` em ordem, a `027`
  **duas vezes**; rodar os testes de banco desse arquivo contra ele
  (`DATABASE_URL` só na linha de comando, nunca em arquivo). Esperado: todos
  PASSAM. Anotar em `docs/frentes/prova-captura.md`.
- [ ] **Passo 5:** escrever `~/marketinghs-migration-027.sh` (aplica duas vezes
  e imprime três provas: `to_regclass` das tabelas novas, `campo_extra` em
  `build_segment_condition`, `growthhs` em `validate_contact_event_source_app`).
- [ ] **Passo 6: commit + push + "pronto para merge".**

```bash
git add backend/migrations/027_prova_substituir_rd.sql backend/tests/test_migracao_027.py docs/frentes/prova-captura.md
git commit -m "feat(prova-rd): migration 027 — campos extras, consentimento, sites, visitas, saídas de jornada, receptor"
```

---

## Fase 1 — `prova-captura` (backend da captura, medição e CRM)

### Tarefa 2: Campos tipados com validação no servidor

**Files:**
- Modify: `backend/app/captura/campos.py`
- Test: `backend/tests/test_prova_campos.py` (puro, sem banco)

**Interfaces — Produces:**
- `TIPOS_DE_CAMPO = frozenset({"texto","email","telefone","lista","sim_nao","texto_longo"})`
- `CHAVE_EXTRA = re.compile(r"^[a-z][a-z0-9_]{0,39}$")`
- `@dataclass(frozen=True) class DefinicaoCampo: chave: str; rotulo: str; tipo: str; obrigatorio: bool; opcoes: tuple[str, ...] = ()`
- `def ler_definicoes(config: dict) -> list[DefinicaoCampo]` — de `config["campos"]`
  (entradas inválidas descartadas); sem elas, de `visible_fields` (tipo
  `texto`, `email` tipo `email` obrigatório).
- `@dataclass class CamposValidados: colunas: dict; extras: dict; erros: dict[str, str]`
- `def validar(definicoes: list[DefinicaoCampo], bruto: dict) -> CamposValidados`
  — campos fora das definições não entram em `extras` (só os de
  `higienizar` entram em `colunas`, como hoje); `telefone` passa por
  `normalizar_celular_br`; `sim_nao` aceita `sim`/`nao` (e `true`/`false`) e
  grava `"sim"`/`"nao"`; `lista` exige valor ∈ `opcoes`; `texto` ≤ 200,
  `texto_longo` ≤ 2000. Mensagens em pt-BR ("Informe o celular com DDD.").
- `def normalizar_celular_br(valor: str) -> str | None` — tira tudo que não é
  dígito, remove `55` inicial quando sobram 12–13 dígitos e `0` inicial do DDD;
  aceita 10 ou 11 dígitos com DDD 11–99; devolve `"+55" + dígitos`.

- [ ] **Passo 1: testes que falham** — `test_celular_formatos_diversos_normalizam`
  (`"+55 (31) 99999-9999"`, `"5531999999999"`, `"031 99999 9999"` →
  `"+5531999999999"`; `"(31) 3333-4444"` → `"+553133334444"`),
  `test_celular_invalido_e_none` (`"999"`, `"(00) 99999-9999"`, `""`),
  `test_obrigatorio_ausente_vira_erro_no_campo`,
  `test_email_tipo_recusa_formato`, `test_lista_fora_das_opcoes_e_erro`,
  `test_sim_nao_normaliza`, `test_chave_extra_vai_para_extras_e_coluna_para_colunas`
  (`empresa` → colunas, `ja_faz_testagem` → extras),
  `test_chave_extra_invalida_descartada_da_definicao`,
  `test_sem_campos_na_config_cai_em_visible_fields`,
  `test_status_e_tipo_nunca_entram_em_extras`.
- [ ] **Passo 2:** `./.venv/bin/pytest -q tests/test_prova_campos.py` → FAIL (nomes não existem).
- [ ] **Passo 3:** implementar em `campos.py`, sem mexer em `higienizar` nem em
  `CAMPOS_PERMITIDOS`.
- [ ] **Passo 4:** mesmo comando → PASS; `tests/test_captura.py -k higienizar` → PASS.
- [ ] **Passo 5: commit** `feat(prova-rd): campos tipados com validação no servidor`.

### Tarefa 3: Captura com campos extras, consentimento, origem e tags; ficha lê consentimento

**Files:**
- Create: `backend/app/captura/registro.py`, `backend/app/captura/canal.py`
- Modify: `backend/app/captura/evento.py`, `backend/app/routers/captura.py`,
  `backend/app/routers/leitura_contatos.py`, `backend/tests/limpeza.py`
  (apaga `visitas` por `visitor_id`, se precisar)
- Test: `backend/tests/test_prova_captura.py` (fixture de página no molde de
  `pagina_sonda` de `tests/test_captura.py`, com o `_tem_mx` trocado e o cache
  da casca limpo)

**Interfaces — Consumes:** Tarefa 2 (`ler_definicoes`, `validar`); schema da Tarefa 1.
**Interfaces — Produces:**
- `evento.marcar_pagina(conn, page_slug: str | None, *, form_id: str | None = None, site_id: str | None = None) -> None`
  (marca/desmarca as três chaves `marketinghs.page_slug|form_id|site_id`).
- `evento.publicar_conversao(conn, lead_id: str, page_slug: str | None, *, origem: str, form_id: str | None = None, site_id: str | None = None) -> None`
  (metadata ganha `form_id`, `site_id`; título "Nova conversão no formulário
  <form_id>" quando não há página).
- `registro.Origem` (frozen dataclass): `page_slug, form_id, site_id, page_url, page_path, visitor_id, canal` — todos `str | None`.
- `registro.Consentimento` (frozen dataclass): `base_legal: str, texto: str, versao: str, provisoria: bool, ip: str | None, user_agent: str | None`.
- `async def registro.registrar_captura(conn, *, email: str, campos: dict, extras: dict, origem: Origem, session_id: str | None, consentimento: Consentimento | None, tags: list[str], utm_da_conversao: dict | None = None) -> str`
  — o corpo de hoje de `capturar()` (achar/inserir/atualizar, identidade,
  `lead_conversions`, A/B, tag do slug) movido para cá **sem mudar o
  comportamento**, mais: `campos_extras` no INSERT; no UPDATE
  `campos_extras = $n::jsonb || campos_extras` (o que já existe vence);
  colunas novas de `lead_conversions`; `gravar_consentimento`; cada tag de
  `tags` pelo `_aplicar_tag_do_slug`. Devolve o `lead_id`.
- `async def registro.gravar_consentimento(conn, lead_id: str, conversao_id: str, c: Consentimento, origem: Origem) -> None`.
- `canal.canal_do_toque(*, utm_source: str | None, utm_medium: str | None, referrer: str | None, gclid: str | None, fbclid: str | None, host_da_pagina: str | None) -> str`
  — um de `pago | social | email | organico | referencia | direto`. Ordem:
  `gclid` ou `utm_medium ∈ {cpc, ppc, paid, pago, ads}` → `pago`; `utm_medium
  = email` → `email`; `fbclid` ou `utm_source`/referrer de rede social →
  `social`; referrer de buscador → `organico`; referrer de outro host →
  `referencia`; resto (inclusive referrer do próprio host) → `direto`.
  Testes puros dele neste arquivo: `test_canal_do_toque_pago_por_gclid_e_por_cpc`,
  `test_canal_social_por_fbclid`, `test_canal_organico_por_google`,
  `test_canal_direto_sem_referrer_ou_mesmo_host`, `test_canal_email`.
- `def registro.ip_do_pedido(request) -> str | None` — 1º do `X-Forwarded-For`,
  senão `request.client.host` (mesma regra de `LimiteTaxaMiddleware._cliente`).
- `CapturaIn` ganha `consentimento: bool | None = None` e `visitor_id: str | None`
  (≤ 64, inválido vira `None` como o `session_id`).
- Erro de validação: `400` com `detail = {"mensagem": str, "campos": {chave: mensagem}}`.
  Sem consentimento quando a página exige: `400` com
  `detail = {"mensagem": "Para enviar, aceite a política de privacidade.", "campos": {"consentimento": "..."}}`.
  O **texto e a versão** do consentimento saem de `pages.config.consentimento`,
  nunca do corpo do pedido. `obrigatorio` ausente no bloco = `true`.
- `GET /contatos/{lead_id}/consentimentos` (`admin_atual`, `authenticated`) →
  `[{id, base_legal, texto, versao, provisoria, ip, user_agent, origem_tipo, page_slug, site_id, form_id, page_url, criado_em}]`
  mais recente primeiro; e `campos_extras` passa a vir em `GET /contatos/{lead_id}`.

- [ ] **Passo 1: testes que falham** (`cliente`, limpeza por id no fim):
  `test_captura_recusa_sem_consentimento_e_nao_grava` (400, `detail.campos.consentimento`,
  nenhum lead com o e-mail), `test_captura_grava_consentimento_com_texto_da_config_ip_e_ua`
  (corpo manda `consentimento: true` e um texto falso em `fields`; a linha de
  `lead_consents` tem o texto **da config**, `versao`, `base_legal =
  'consentimento'`, `ip` do `X-Forwarded-For` mandado, `user_agent`),
  `test_captura_campo_obrigatorio_ausente_da_400_com_campos`,
  `test_captura_celular_normalizado_e_extra_em_campos_extras`
  (`whatsapp = '+5531999999999'`, `campos_extras = {"ja_faz_testagem": "sim"}`),
  `test_reconversao_nao_sobrescreve_extra_existente`,
  `test_captura_aplica_tags_da_config` (`prova-rd` + a tag do slug),
  `test_captura_grava_visitor_id_e_canal_na_conversao`,
  `test_captura_sem_bloco_novo_continua_como_antes` (página só com
  `visible_fields`: sem consentimento, 200, sem linha em `lead_consents`),
  `test_ficha_lista_consentimentos_e_nao_admin_leva_403`.
- [ ] **Passo 2:** `pytest -q tests/test_prova_captura.py` → FAIL.
- [ ] **Passo 3:** implementar. `capturar()` fica: honeypot → e-mail → página →
  definições → validação → consentimento → `registrar_captura(...)`.
  `canal` da landing vem de `canal_do_toque` (acima), com o host do `FRONTEND_URL`.
- [ ] **Passo 4:** `pytest -q tests/test_prova_captura.py tests/test_captura.py tests/test_r5_jornadas.py tests/test_conversao.py` → PASS.
- [ ] **Passo 5: commit** `feat(prova-rd): captura com extras, consentimento, origem e tags`.

### Tarefa 4: Sites, token público, visita e conversão de outro domínio

**Files:**
- Create: `backend/app/captura/mapa.py`,
  `backend/app/routers/sites.py`, `backend/app/routers/rastreio.py`,
  `backend/app/middleware/cors_sites.py`
- Modify: `backend/app/config.py` (`LIMITE_VISITA_POR_MINUTO: int = 120` e
  `PROVA_RECEPTOR_TESTE: bool = False`, com o comentário "receptor de teste do
  contrato do GrowthHS e eco do formulário de teste; desligado por padrão;
  liga só durante a prova"),
  `backend/app/main.py` (routers; balde próprio de `/publico/site/visita`, que
  fica isento do comum; `CorsDosSitesMiddleware` por último, depois do do coletor)
- Test: `backend/tests/test_prova_site.py`

**Interfaces — Produces:**
- `mapa.MAPA_PADRAO: dict[str, str]` — `pnome→nome`, `pemail→email`,
  `pwhatsapp→whatsapp`, `pmensagem→mensagem` (extra), `passunto→assunto`
  (extra), `name|nome→nome`, `email|e-mail→email`, `phone|telefone|celular|whatsapp→whatsapp`,
  `empresa|company→empresa`, `cargo→cargo`, `mensagem|message→mensagem`.
- `mapa.CAMPO_PROIBIDO = re.compile(r"senha|password|card|cartao|cvv|cvc|captcha", re.I)`
- `mapa.mapear(brutos: dict[str, str], mapa_do_site: dict[str, str]) -> tuple[str | None, dict, dict]`
  → `(email, colunas, extras)`; o mapa do site vence o padrão; nome proibido
  nunca entra; extras só com chave que casa `CHAVE_EXTRA`.
- `rastreio.origem_permitida(origin: str | None, dominios: list[str]) -> bool` — host exato; `https`, ou `http` só para `localhost`/`127.0.0.1`.
- `POST /publico/site/visita` e `POST /publico/site/conversao`: corpo lido de
  `await request.body()` (≤ 16 KB, JSON; aceita `text/plain`, que é o que o
  `sendBeacon` manda sem preflight).
  - Visita: `{token? , pagina?, visitor_id, url, titulo, referrer, utm: {...}, gclid, fbclid, primeiro_toque: {...}}`.
    Com `token`: site ativo e `Origin` permitido. Com `pagina`: página
    `active` e `Origin` igual ao de `FRONTEND_URL`. → `202 {"ok": true}`.
  - Conversão: `{token, visitor_id, form_id (≤120), url, campos: {nome: valor} (≤60, valor ≤2000), toque: {...}, primeiro_toque: {...}}`.
    `mapear` → `validar_dominio(email)` → `registrar_captura` com `Origem(form_id, site_id, page_url, page_path, visitor_id, canal do toque)`,
    UTMs do **primeiro toque** no lead (regra do bloco) e do **toque** na
    conversão (`utm_da_conversao`), `tags = sites.tags`, consentimento
    `Consentimento("legitimo_interesse_pedido_contato", "Formulário do site sem caixa de consentimento: a pessoa pediu contato.", "provisoria-2026-10", True, ip, ua)`.
    → `202 {"ok": true}`. Erros: `403` token/`Origin`/site inativo; `400` sem e-mail ou e-mail inválido. Sem campo-isca.
- `POST /publico/prova/recebido` → HTML "Recebido." (200) se
  `settings.PROVA_RECEPTOR_TESTE`, senão 404 — é o `action` do formulário de teste.
- `CorsDosSitesMiddleware(app, prefixo="/publico/site/")`: `OPTIONS` e resposta
  ganham `Access-Control-Allow-Origin: <origin>` + `Vary: Origin` só se o
  `Origin` está em algum site ativo (cache de 60 s, recarregado de
  `sites`) ou é o `FRONTEND_URL`; nunca `*`, nunca `Allow-Credentials`.
- `sites.py` (`prefix="/sites"`, `admin_atual`, `authenticated`): `GET ""`,
  `POST ""` (`{nome, dominios, mapa_campos?, tags?}`; gera
  `token = "pub_" + secrets.token_urlsafe(24)`), `PATCH /{id}` (nome,
  dominios, mapa_campos, tags, ativo), `POST /{id}/token` (rotaciona).
  Domínio normalizado: minúsculo, sem esquema nem caminho.

- [ ] **Passo 1: testes que falham:** puros —
  `test_mapear_campos_do_site_da_hs`
  (`{"pnome": "Ana", "pemail": "a@x.com", "pwhatsapp": "31999999999", "pmensagem": "oi", "passunto": "Phoebus"}`
  → `("a@x.com", {"nome": "Ana", "whatsapp": ...}, {"mensagem": "oi", "assunto": "Phoebus"})`),
  `test_mapear_ignora_senha_cartao_e_captcha`, `test_mapa_do_site_vence_o_padrao`,
  `test_origem_permitida`; com `cliente` —
  `test_conversao_de_site_cria_lead_com_form_id_e_evento` (lead com tag
  `prova-rd`, `lead_conversions.form_id = 'prova_cap_phoebus'`, `contact_events`
  `form_submitted` com `metadata.form_id`, linha em `lead_consents` com a base
  legal do site), `test_conversao_de_site_repetida_nao_duplica_e_conta_nova_conversao`
  (1 lead, nome antigo preservado, 2 conversões, 2º evento com `reconversao: true`),
  `test_conversao_sem_origin_da_403_e_nao_grava`,
  `test_conversao_com_origin_de_outro_dominio_da_403`, `test_site_inativo_recusa`,
  `test_corpo_text_plain_e_aceito`, `test_visita_grava_canal_visitor_e_primeiro_toque`,
  `test_visita_por_pagina_exige_origin_do_frontend`,
  `test_cors_reflete_so_dominio_cadastrado` (`OPTIONS` com origem cadastrada →
  `ACAO` = origem; com outra → sem `ACAO`), `test_rotas_de_sites_exigem_admin`,
  `test_token_rotacionado_invalida_o_antigo`, `test_recebido_desligado_da_404`.
- [ ] **Passo 2:** `pytest -q tests/test_prova_site.py` → FAIL.
- [ ] **Passo 3:** implementar. Cache de token→site em processo (60 s), como
  o de `landing.py`; `_limpar_cache()` para os testes.
- [ ] **Passo 4:** `pytest -q tests/test_prova_site.py tests/test_prova_captura.py tests/test_ab_publico.py tests/test_security.py` → PASS.
- [ ] **Passo 5: commit** `feat(prova-rd): sites com token público, visita e conversão de outro domínio`.

### Tarefa 5: Números da página e a casca que mede

**Files:**
- Modify: `backend/app/routers/paginas.py`, `backend/app/routers/landing.py`
- Test: `backend/tests/test_prova_numeros.py`

**Interfaces — Produces:**
- `GET /paginas/numeros?de=AAAA-MM-DD&ate=AAAA-MM-DD` (`admin_atual`,
  `authenticated`; declarada **acima** de qualquer `/{pagina_id}`; padrão:
  últimos 30 dias; dias civis de Brasília, `ate` inclusivo; `de > ate` → 400):

```json
{"de": "...", "ate": "...",
 "paginas": [{"slug": "", "nome": "", "visitas": 0, "visitantes": 0, "conversoes": 0, "taxa": 0.0,
              "por_canal": [{"canal": "pago", "visitas": 0, "visitantes": 0, "conversoes": 0, "taxa": 0.0}]}],
 "formularios": [{"site_id": "", "site_nome": "", "form_id": "", "page_path": "", "visitantes": 0,
                  "conversoes": 0, "taxa": 0.0, "por_canal": [...]}]}
```

  `taxa = conversoes / visitantes` (visitantes únicos por `visitor_id`), `null`
  quando `visitantes = 0`. Conversão = linha de `lead_conversions` cujo lead
  tem `deleted_at IS NULL`. Formulário: visitantes do mesmo `site_id` + `path`.
  Canal da conversão = `lead_conversions.canal`, `null` vira `"desconhecido"`.
- `landing.montar_casca(slug, config)`: `<meta name="robots" content="noindex,nofollow">`
  só se `config.get("noindex")`; sempre
  `<script src="/rastreio.js" defer data-pagina="<slug>" data-api="/api" data-captura="off"></script>`
  (slug escapado como os outros valores).

- [ ] **Passo 1: testes que falham** (dados semeados com `cliente`/sessão
  comitada e apagados por id): `test_numeros_contam_visitas_visitantes_conversoes_e_taxa`
  (3 visitas de 2 visitantes, 1 conversão → `taxa == 0.5`),
  `test_numeros_por_canal`, `test_numeros_taxa_nula_sem_visitante`,
  `test_numeros_ignoram_lead_excluido`, `test_numeros_de_formulario_de_site`,
  `test_numeros_periodo_invertido_400`, `test_numeros_nao_admin_403`,
  `test_casca_noindex_quando_config_manda`, `test_casca_sem_noindex_por_padrao`,
  `test_casca_carrega_rastreio_com_a_pagina`.
- [ ] **Passo 2:** `pytest -q tests/test_prova_numeros.py` → FAIL.
- [ ] **Passo 3:** implementar (uma query por bloco, agregação no SQL).
- [ ] **Passo 4:** `pytest -q tests/test_prova_numeros.py tests/test_captura.py -k casca` → PASS.
- [ ] **Passo 5: commit** `feat(prova-rd): números por página e por formulário; casca com noindex e rastreio`.

### Tarefa 6: Volta do CRM, receptor de teste, card ampliado e contrato

**Files:**
- Create: `backend/app/crm/retorno.py`, `backend/app/routers/receptor_growthhs.py`
- Modify: `backend/app/routers/publico.py` (`SOURCE_APPS`, `EventoIn`,
  `receber_evento`), `backend/app/routers/api_contato.py`
  (`_lead_por_identificador`, `StatusApiIn`, `atualizar_status`),
  `backend/app/crm/growthhs.py` (`montar_card`), `backend/app/crm/entrega.py`
  (`_COLUNAS_LEAD` + leitura da última conversão e do último consentimento),
  `backend/app/main.py`,
  `docs/contratos/2026-09-02-endpoint-card-comercial-growthhs.md`
- Test: `backend/tests/test_prova_crm.py`

**Interfaces — Produces:**
- `retorno.ESTAGIO_POR_EVENTO = {"meeting_scheduled": "MQL - Reunião agendada", "deal_won": "Venda realizada"}`
- `async def retorno.avancar_status(conn, lead_id: str, novo: str, *, metadata_extra: dict) -> tuple[str | None, str, bool]`
  → `(anterior, atual, mudou)`; só grava se `sort_order(novo) > sort_order(anterior)`;
  grava com `_registrar_mudanca(origem="crm", descricao="Mudança de status pelo CRM", ...)`.
- `EventoIn.source_app` aceita `growthhs`; `EventoIn` ganha `lead_id: str | None`.
  Com `source_app == "growthhs"`: lead por `lead_id` → `email` → `dnia_id`
  (404 se nenhum), `contact_events` com `source_app = 'growthhs'`, estágio
  por `ESTAGIO_POR_EVENTO`, conversão A/B `agendamento` mantida para
  `meeting_scheduled`. Resposta: `{evento_id, lead_id, dnia_id, status_anterior, status_atual, mudou}`.
  Sem `growthhs`, a rota se comporta como hoje.
- `_lead_por_identificador(conn, dnia_id, email, phone, lead_id: str | None = None)`;
  `StatusApiIn`: `dnia_id`, `lead_id`, `email` opcionais, um obrigatório (400).
- `growthhs.montar_card(lead: dict, board_id: int, *, conversao: dict | None = None, consentimento: dict | None = None) -> dict`
  — acrescenta `custom_fields` (= `campos_extras`), `conversion`
  (`{page_slug, form_id, site_name, page_url, converted_at, canal}`) e
  `consent` (`{legal_basis, version, provisional, recorded_at}`); sem dados,
  as chaves vêm `{}`/`null`. Nada do que já existe muda.
- `receptor_growthhs.py` (sempre incluído; dependência `_ligado()` → 404 com
  `PROVA_RECEPTOR_TESTE` falso): `GET /teste/growthhs/health` → 200;
  `POST /teste/growthhs/api/v1/integration/cards` — `X-API-Key` igual a
  `ler_segredo("GROWTHHS_API_KEY")` senão 401; corpo validado pelo contrato
  (`source == "marketinghs"`, `external_id` uuid, `board_id` int, `title`,
  `contact.email` ou `contact.phone`) senão 422; grava em
  `growthhs_receptor_pedidos` (1ª vez 201, repetição 200 com o mesmo `id`,
  `vezes + 1`, corpo intacto); resposta no formato do contrato
  (`{id, list_id: null, title, external_source, external_id, client_id: null, person_id: null, created}`);
  `GET /teste/growthhs/pedidos` (`admin_atual`, `service_role`) → últimos 50.

- [ ] **Passo 1: testes que falham:** `test_evento_growthhs_reuniao_avanca_para_mql`,
  `test_evento_growthhs_venda_fechada_avanca`,
  `test_evento_growthhs_nao_volta_estagio` (lead em `Venda realizada` +
  `meeting_scheduled` → `mudou is False`, status igual, evento gravado),
  `test_evento_growthhs_acha_por_email_e_por_lead_id`,
  `test_evento_growthhs_lead_inexistente_404`,
  `test_evento_growthhs_exige_chave_write` (chave `read` → 403),
  `test_evento_de_outro_source_app_continua_como_antes`,
  `test_status_aceita_email_e_lead_id`, `test_status_sem_identificador_400`,
  `test_receptor_desligado_da_404`, `test_receptor_sem_chave_certa_401`,
  `test_receptor_corpo_sem_external_id_422`, `test_receptor_cria_201_e_repete_200_mesmo_id`,
  `test_criar_card_ponta_a_ponta_pelo_receptor` (`growthhs.criar_card` com
  `httpx.ASGITransport(app)` e `base_url="http://teste/teste/growthhs"` → dict com `id`),
  `test_card_leva_consentimento_conversao_e_campos_extras` (puro).
- [ ] **Passo 2:** `pytest -q tests/test_prova_crm.py` → FAIL.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** `pytest -q tests/test_prova_crm.py tests/test_api_contato.py tests/test_crm_entrega.py tests/test_growthhs_cliente.py tests/test_handoff_banco.py` → PASS.
- [ ] **Passo 5: contrato.** Em `docs/contratos/2026-09-02-endpoint-card-comercial-growthhs.md`,
  seção nova "Acréscimos de 21/10 (prova de substituição do RD)": (a) as três
  chaves novas do corpo, com exemplo JSON e "podem ser ignoradas — o card
  nasce sem elas"; (b) **a volta**: `POST {MarketingHS}/api/publico/evento-de-contato`,
  `X-API-Key` (chave de API do MarketingHS com escopo `write`), corpo
  `{"source_app": "growthhs", "event_type": "meeting_scheduled"|"deal_won", "title": "...", "lead_id": "<external_id do card>", "email": "...", "metadata": {"card_id": 4821}}`,
  resposta e a regra "estágio só avança"; (c) quando chamar (reunião
  agendada; venda ganha); (d) o receptor de teste existe e é o teste do
  contrato do nosso lado. Atualizar a linha **Estado** do topo.
- [ ] **Passo 6: commit + suíte inteira + push + "pronto para merge".**

```bash
git add backend/app backend/tests docs/contratos/2026-09-02-endpoint-card-comercial-growthhs.md docs/frentes/prova-captura.md
git commit -m "feat(prova-rd): volta do CRM, receptor de teste do contrato e card ampliado"
```

---

## Fase 1 — `prova-jornadas` (backend das jornadas)

### Tarefa 7: Modo teste da jornada

**Files:**
- Modify: `backend/app/routers/jornadas.py`, `backend/app/jornadas/executor.py`,
  `backend/app/worker.py` (`_processar`)
- Test: `backend/tests/test_prova_jornadas.py` (jornada e run **reais** dentro
  da transação de `conexao` — `journey_step_log` e `campaign_sends` têm FK)

**Interfaces — Produces:**
- `JornadaIn`/`JornadaPatch`: `allowed_emails: list[str] | None` — aparado,
  minúsculo, sem repetidos, formato de e-mail (422 se inválido), máximo 50;
  `[]` → `NULL`. `CASTS["allowed_emails"] = "::text[]"`; volta nas leituras.
- `NOS_COM_EFEITO = frozenset({"send_email", "handoff_growthhs", "notify_email", "webhook"})`
- `async def executor.contato_permitido(conn, run: dict) -> bool` — lê
  `journeys.allowed_emails` uma vez por run (guardado em `run["_permitido"]`);
  `NULL` → `True`; senão `lower(btrim(leads.email)) = ANY(lista)`.
- Em `executar_no`, antes de qualquer nó de `NOS_COM_EFEITO`: se não permitido,
  `registrar_passo(..., "skipped", {"motivo": "modo teste: contato fora da lista"})`
  e `{"tipo": "avancar", "proximo": no.get("next")}` — nada é criado.
- `worker._processar`: na consulta do conteúdo de fluxo, `j.allowed_emails`; se
  não nulo e o e-mail não está → `campaign_sends.status = 'failed'`,
  `error = 'modo teste: fora da lista'`, sem chamar o Resend (segunda trava).

- [ ] **Passo 1: testes que falham:** `test_modo_teste_pula_send_email_de_quem_nao_esta_na_lista`
  (nenhuma linha em `campaign_sends` para o run; passo `skipped`),
  `test_modo_teste_envia_para_quem_esta_na_lista` (linha criada),
  `test_modo_teste_compara_sem_caixa_e_espaco` (lista `[" Erick@X.com "]` normalizada pela rota; lead `erick@x.COM`),
  `test_modo_teste_pula_handoff` (nenhuma linha em `crm_handoffs`),
  `test_sem_lista_comportamento_de_antes`, `test_rota_recusa_email_invalido_na_lista_422`,
  `test_rota_lista_vazia_vira_null`,
  `test_worker_recusa_envio_de_jornada_fora_da_lista` (`resend.enviar`
  trocado por um que falha o teste se chamado; linha `failed`).
- [ ] **Passo 2:** `pytest -q tests/test_prova_jornadas.py` → FAIL.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** `pytest -q tests/test_prova_jornadas.py tests/test_r5_jornadas.py tests/test_worker_ritmo.py tests/test_fila.py` → PASS.
- [ ] **Passo 5: commit** `feat(prova-rd): modo teste da jornada (lista de e-mails permitidos)`.

### Tarefa 8: Nós "avisar por e-mail" e "enviar para webhook" pela caixa de saída

**Files:**
- Create: `backend/app/jornadas/saidas.py`
- Modify: `backend/app/jornadas/executor.py`, `backend/app/worker.py`
  (`_laco_saidas`, criado em `principal()` ao lado de `_laco_entregas`),
  `backend/app/ritmo.py` (`SQL_USO` e `SQL_PRIMEIRO_DIA` contam também
  `journey_saidas` com `tipo = 'aviso_email'` e `resend_email_id IS NOT NULL`)
- Test: `backend/tests/test_prova_saidas.py`

**Interfaces — Produces:**
- Config dos nós: `notify_email` → `{"emails": ["a@x"], "assunto"?: str}`;
  `webhook` → `{"url": "https://..."}`.
- `async def saidas.enfileirar(conn, run: dict, no: dict, tipo: str, destino: str, payload: dict) -> int | None`
  — `ON CONFLICT ON CONSTRAINT uniq_journey_saidas_run_node DO NOTHING RETURNING id`.
- `async def saidas.dados_do_lead(conn, lead_id: str) -> tuple[dict, dict | None]`
  → (lead com `campos_extras` e tags, última conversão).
- `def saidas.montar_aviso(lead: dict, conversao: dict | None, url_da_ficha: str, assunto: str | None = None) -> tuple[str, str]`
  → `(assunto, html)`; assunto padrão `"[MarketingHS] Novo lead: {nome} — {empresa}"`;
  html com nome, e-mail, celular, empresa, página/formulário, mensagem
  (`campos_extras.mensagem`), demais extras e o link; **todo valor com
  `html.escape`**. `url_da_ficha = f"{settings.FRONTEND_URL}/contacts?contato={lead_id}"`.
- `def saidas.montar_webhook(lead: dict, conversao: dict | None, run: dict, no: dict) -> dict`
  → `{"evento": "journey.webhook", "journey_id", "run_id", "node_id", "lead": {...}, "conversao": {...}, "gerado_em"}`.
- `async def saidas.rodar_saidas(*, parar: asyncio.Event | None = None, transporte: httpx.AsyncBaseTransport | None = None) -> dict`
  — reivindica pendentes vencidas (`FOR UPDATE SKIP LOCKED`, `visivel_em =
  now() + 5 min`, `tentativas + 1`) numa sessão curta, chama a rede **fora**
  de transação, grava o resultado em outra (molde de `app/crm/entrega.py`).
  Aviso: só com `RESEND_API_KEY`; quantos saem = `ritmo.cota(...)` da passada
  (0 → nenhum); `resend.enviar(...)` sem cabeçalho de descadastro (é interno);
  `resend.LimiteDoResend` devolve sem gastar tentativa. Webhook: `httpx` POST
  JSON, timeout 10 s, `https` reconferido; 2xx → `enviado`; 4xx (menos 408/429)
  → `falhou`; 5xx/408/429/sem resposta → reagenda com espera
  `min(1 min × 2^(t−1), 60 min)`; `MAX_TENTATIVAS = 5` → `falhou`. Devolve
  `{"enviados": n, "reagendados": n, "falhos": n}`.
- `executar_no`: `notify_email` → monta o aviso agora (retrato do lead) e
  `enfileirar(..., "aviso_email", ",".join(emails), {"assunto", "html", "texto"})`;
  `webhook` → URL sem `https://` levanta `ErroDefinitivo`; senão
  `enfileirar(..., "webhook", url, montar_webhook(...))`. Passo `enqueued`,
  segue para `next`. Aviso não passa por supressão nem descadastro do lead.

- [ ] **Passo 1: testes que falham:** `test_notify_email_enfileira_uma_vez_por_run_e_no`
  (executar o nó duas vezes → 1 linha), `test_aviso_escapa_html_do_lead`
  (nome `<script>x</script>` não aparece cru), `test_aviso_tem_link_da_ficha_e_dados`,
  `test_webhook_sem_https_e_erro_definitivo`, `test_webhook_2xx_marca_enviado`,
  `test_webhook_5xx_reagenda_e_4xx_falha` (`httpx.MockTransport`),
  `test_webhook_desiste_na_quinta`, `test_aviso_conta_no_teto` (linha
  `aviso_email` enviada agora com `resend_email_id` → `ritmo.medir` soma 1),
  `test_aviso_nao_sai_com_cota_zero`, `test_saida_reivindicada_nao_volta_antes_do_prazo`.
  As que chamam `rodar_saidas` gravam fora de `conexao`: usam uma fixture
  local marcada `trava_global` que apaga as linhas criadas por id.
- [ ] **Passo 2:** `pytest -q tests/test_prova_saidas.py` → FAIL.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** `pytest -q tests/test_prova_saidas.py tests/test_prova_jornadas.py tests/test_ritmo.py tests/test_worker_ritmo.py tests/test_worker_aviso.py` → PASS.
- [ ] **Passo 5: commit** `feat(prova-rd): nós avisar por e-mail e webhook, drenados pelo worker`.

### Tarefa 9: Arquivo PDF para a ficha técnica

**Files:**
- Modify: `backend/app/routers/imagens.py`
- Test: `backend/tests/test_prova_arquivos.py`

**Interfaces — Produces:**
- `TIPOS_DE_ARQUIVO = {"application/pdf"}`, `TAMANHO_MAXIMO_ARQUIVO = 10 * 1024 * 1024`.
- `POST /arquivos` (`admin_atual`, multipart `arquivo`) — tipo declarado PDF
  **e** bytes começando por `%PDF-` (400 senão), vazio 400, acima de 10 MB 413;
  grava em `email_assets` com `pasta = 'arquivos'` →
  `201 {"id", "nome", "tamanho", "url": "/publico/arquivo/<id>", "url_publica": f"{FRONTEND_URL}/api/publico/arquivo/<id>"}`.
- `GET /arquivos` (`admin_atual`) → `[{id, nome, tamanho, url, url_publica, criado_em}]` de `pasta = 'arquivos'`.
- `GET /publico/arquivo/{arquivo_id}` — só `pasta = 'arquivos'`; id malformado
  ou outra pasta → 404; cabeçalhos `Content-Type: application/pdf`,
  `Content-Disposition: inline; filename="<nome seguro>.pdf"`,
  `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`,
  `Cache-Control: public, max-age=31536000, immutable`.
- `POST /imagens` continua recusando PDF.

- [ ] **Passo 1: testes que falham:** `test_sobe_pdf_e_serve_inline_com_cabecalhos`,
  `test_recusa_pdf_falso`, `test_recusa_acima_de_10mb`, `test_arquivo_exige_admin`,
  `test_imagens_continua_recusando_pdf`, `test_servir_id_malformado_404`,
  `test_rota_de_arquivo_nao_serve_imagem` (id de imagem → 404). `cliente`
  comita: apagar de `email_assets` por id no fim.
- [ ] **Passo 2:** `pytest -q tests/test_prova_arquivos.py` → FAIL.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** mesmo comando → PASS.
- [ ] **Passo 5: commit + suíte inteira + push + "pronto para merge"**
  `feat(prova-rd): PDF no armazenamento, com link público estável`.

---

## Fase 1 — `prova-landing` (a landing, o script e a página de teste)

### Tarefa 10: Landing com cara de landing

**Files:**
- Create: `frontend/src/landing/campos.ts` (só sintaxe apagável, sem import)
- Modify: `frontend/src/landing/Landing.tsx`, `Formulario.tsx`, `landing.css`
- Test: `frontend/scripts/landing-campos.test.mjs`

**Interfaces — Consumes:** o contrato da config (acima); `POST /api/publico/captura`
da Tarefa 3 (`fields`, `consentimento`, `visitor_id`; erro `detail.mensagem` +
`detail.campos`, ou `detail` string — os dois formatos tratados).
**Interfaces — Produces:**
- `export type CampoDaPagina`, `export type ConfigDaPagina` (todas as chaves do contrato).
- `export function camposDaConfig(config: ConfigDaPagina): CampoDaPagina[]` — mesma regra de `ler_definicoes`.
- `export function validarNoCliente(campos: CampoDaPagina[], valores: Record<string, string>): Record<string, string>`
- `export function paragrafosDoCorpo(corpo: string): ({ tipo: 'p'; texto: string } | { tipo: 'lista'; itens: string[] })[]`
- `export function linkDoWhatsapp(numero: string, mensagem: string): string` → `https://wa.me/<dígitos>?text=<encode>`.
- `export function lerVisitante(cookie: string): string | null` (cookie `mhs_vid`).
- Formulário: cada tipo vira o controle certo (`email`→`type=email`,
  `telefone`→`type=tel` com `inputMode=tel`, `lista`→`select`,
  `sim_nao`→dois rádios, `texto_longo`→`textarea`); erro por campo ao lado do
  campo (`aria-describedby`); checkbox de consentimento **desmarcado** com o
  texto e o link da config; sucesso mostra `mensagem_obrigado` (ou o texto
  de hoje) na própria página quando não há `redirect_url`. Landing: imagem
  de destaque com `alt` = headline, corpo por `paragrafosDoCorpo` (texto
  puro, nunca `dangerouslySetInnerHTML`), botão flutuante de WhatsApp só
  com `whatsapp.numero`.

- [ ] **Passo 1: testes que falham:** `camposDaConfig cai em visible_fields`,
  `validarNoCliente exige obrigatório e formato de e-mail`,
  `celular com DDD passa e sem DDD não`, `paragrafosDoCorpo separa parágrafo e lista`,
  `linkDoWhatsapp codifica a mensagem`, `lerVisitante acha mhs_vid entre outros cookies`.
- [ ] **Passo 2:** `node --test scripts/landing-campos.test.mjs` → FAIL.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** `node --test scripts/landing-campos.test.mjs scripts/landing-caminhos.test.mjs`
  → PASS; `npm run build:landing` sem erro; `npx tsc --noEmit -p tsconfig.app.json` sem erro novo.
- [ ] **Passo 5: commit** `feat(prova-rd): landing com campos tipados, consentimento, corpo, imagem e obrigado`.

### Tarefa 11: `rastreio.js` e a página de teste de outra origem

**Files:**
- Create: `frontend/public/rastreio.js`, `frontend/public/prova/site-teste.html`
- Test: `frontend/scripts/rastreio.test.mjs` (`node:vm` com `window`,
  `document`, `navigator.sendBeacon` falsos)

**Interfaces — Consumes:** `POST /api/publico/site/visita|conversao` (Tarefa 4).
**Interfaces — Produces:**
- Instalação: `<script src="https://<app>/rastreio.js" async data-token="pub_…" data-api="https://<app>/api"></script>`;
  na landing, `data-pagina="<slug>" data-captura="off"` (Tarefa 5).
- Cookies primários no host da página (`SameSite=Lax`, `Secure` em https):
  `mhs_vid` (uuid, 365 dias), `mhs_pt` (primeiro toque JSON: utm, referrer,
  gclid, fbclid, url, ts — gravado uma vez), último toque recalculado a cada
  visita com UTM/clid ou referrer externo.
- Visita: um POST por carregamento. Captura (sem `data-captura="off"`):
  `document.addEventListener('submit', fn, true)`; lê o formulário com
  `FormData` **na hora**, só se houver campo de e-mail com valor; nunca chama
  `preventDefault`/`stopPropagation`; manda mesmo com `defaultPrevented`;
  descarta repetição do mesmo `form_id` + e-mail em 10 s; ignora campo
  `type=password`, `autocomplete` `cc-*` e nome que casa
  `/senha|password|card|cartao|cvv|cvc|captcha/i`.
- `form_id` = `form.id` ou `<pathname>#form<índice entre os forms>`.
- Envio: `navigator.sendBeacon(url, new Blob([json], {type: 'text/plain'}))`,
  recuo `fetch(url, {method: 'POST', body: json, keepalive: true, mode: 'no-cors'})`;
  tudo em `try/catch`, nada no console fora `data-debug="true"`.
- `window.__mhsTeste` (só quando `window.__MHS_TESTE__` existe antes do
  script): `{idDoFormulario, campoProibido, lerCampos, toqueDaUrl}`.
- `site-teste.html` (sem dependência, outra origem): cópia do formulário de
  cotação do Phoebus — `id="prova_cap_phoebus"`, `name`s `pnome`, `pemail`,
  `pwhatsapp`, `pmensagem`, `passunto` (oculto, `"Phoebus"`),
  `action="/api/publico/prova/recebido"`, `method="post"`; um segundo form
  `id="prova_ficha_phoebus"` (`pnome`, `pemail`, `passunto="Ficha técnica Phoebus"`)
  com o mesmo `action`; o nosso `rastreio.js` com `data-token` lido de
  `?token=` da URL (para não versionar token); e o `<script>` do RD
  **copiado exatamente** do HTML público de `https://www.healthsafety.com.br/phoebus.cfm`
  (`curl` só de leitura), com comentário dizendo de onde veio.
  Faixa no topo: "Página de teste da prova — não é o site da H&S".

- [ ] **Passo 1: testes que falham:** `não chama preventDefault e o envio segue`,
  `manda conversão com form_id e campos mapeáveis`, `form sem id ganha nome estável`,
  `ignora senha, cartão e captcha`, `repetição em 10 s não manda de novo`,
  `envia mesmo com defaultPrevented`, `sem sendBeacon usa fetch keepalive`,
  `erro no envio não sobe exceção`, `primeiro toque é gravado uma vez só`,
  `data-captura=off só registra visita`, `site-teste tem prova_cap_phoebus com os names do site`
  (lê o HTML como texto).
- [ ] **Passo 2:** `node --test scripts/rastreio.test.mjs` → FAIL.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** mesmo comando → PASS; `npx vite build` e `dist/rastreio.js` existe.
- [ ] **Passo 5: commit** `feat(prova-rd): rastreio.js (visita + captura de form) e página de teste`.

### Tarefa 12: Editor da página — campos, corpo, consentimento, obrigado, WhatsApp, noindex, tags

**Files:**
- Create: `frontend/src/components/admin/pages/CamposEditor.tsx`
- Modify: `frontend/src/components/admin/pages/PageConfigEditor.tsx`

**Interfaces — Consumes:** `CampoDaPagina`, `ConfigDaPagina` de `@/landing/campos`;
`subirImagemDeEmail(arquivo, 'campaigns')` de `@/lib/config` (já existe).
**Interfaces — Produces:** `export function CamposEditor({ campos, onChange }: { campos: CampoDaPagina[]; onChange: (c: CampoDaPagina[]) => void })`
— linha por campo: rótulo, chave (das colunas conhecidas ou "personalizado"
com chave validada por `^[a-z][a-z0-9_]{0,39}$`), tipo, obrigatório, opções
(para `lista`), subir/descer, remover; o e-mail não sai e é sempre
obrigatório. O editor substitui `FORM_FIELDS`/`visible_fields` por
`campos` (página antiga: o editor converte `visible_fields` na primeira
edição) e ganha blocos para `corpo`, `imagem_url` (upload), `mensagem_obrigado`,
`consentimento` (texto, link, versão, provisória, obrigatório), `whatsapp`,
`noindex`, `tags`. Primitivos de `components/ui/`, cor só de token.

- [ ] **Passo 1:** implementar.
- [ ] **Passo 2:** `npx tsc --noEmit -p tsconfig.app.json` sem erro novo;
  `npm run guarda:visual -- src/components/admin/pages` → 0.
- [ ] **Passo 3:** `node scripts/conferir-telas.mjs --porta 8099 --saida <pasta de saída> pages` e
  abrir o editor de uma página existente (só navegar e ler; nada salvo);
  conferir os PNGs nos dois temas e nas larguras.
- [ ] **Passo 4: commit + portão + push + "pronto para merge"**
  `feat(prova-rd): editor da página com campos tipados e os blocos da landing`.

---

## Fase 1 — `prova-telas` (as telas do admin)

### Tarefa 13: Sites — cadastro e snippet

**Files:**
- Create: `frontend/src/lib/sites.ts`, `frontend/src/components/admin/settings/SitesSettings.tsx`
- Modify: `frontend/src/pages/admin/SettingsPage.tsx` (aba "Sites")

**Interfaces — Consumes:** `GET/POST /sites`, `PATCH /sites/{id}`, `POST /sites/{id}/token` (Tarefa 4).
**Interfaces — Produces:** `type Site = { id; nome; dominios: string[]; token; mapa_campos: Record<string,string>; tags: string[]; ativo; criado_em }`;
`listarSites()`, `criarSite(dados)`, `atualizarSite(id, dados)`, `rotacionarToken(id)` via `api`;
`snippetDoSite(site: Site, origem: string): string` (a linha de instalação da Tarefa 11).
Tela: lista, criar/editar (nome, domínios, tags, ativo, mapa de campos
`name do site → campo`), copiar snippet, rotacionar token com confirmação
("o snippet antigo para de funcionar").

- [ ] **Passo 1:** implementar. **Passo 2:** `tsc` sem erro novo, guarda 0 em
  `src/components/admin/settings`. **Passo 3:** `conferir-telas.mjs --porta 8094 … settings`
  (só leitura). **Passo 4: commit** `feat(prova-rd): tela de Sites com snippet`.

### Tarefa 14: Números na tela de Páginas

**Files:**
- Create: `frontend/src/lib/numeros.ts`, `frontend/src/components/admin/pages/NumerosDasPaginas.tsx`
- Modify: `frontend/src/components/admin/pages/PagesManagement.tsx`

**Interfaces — Consumes:** `GET /paginas/numeros` (Tarefa 5).
**Interfaces — Produces:** `type NumerosDoPeriodo` (forma da Tarefa 5);
`lerNumeros(de: string, ate: string): Promise<NumerosDoPeriodo>`;
`formatarTaxa(taxa: number | null): string` (`null` → "—"). Componente:
seletor de período (7/30/90 dias), tabela por página (visitas, visitantes,
conversões, taxa) com linha expansível por canal, e tabela de formulários de
site. Painel fica como está (a spec só pede "se couber sem refazer").

- [ ] **Passo 1:** implementar. **Passo 2:** `tsc`, guarda 0. **Passo 3:**
  `conferir-telas.mjs --porta 8094 … pages`. **Passo 4: commit** `feat(prova-rd): visitas, conversões e taxa por página e canal`.

### Tarefa 15: Construtor de jornada — nós novos, modo teste, filtro por formulário

**Files:**
- Modify: `frontend/src/lib/journeys.ts`, `components/admin/automations/NodeConfigDialog.tsx`,
  `JourneyNodeCard.tsx`, `EntryPageSelect.tsx`, `JourneyCreateDialog.tsx`,
  `frontend/src/pages/admin/JourneyBuilder.tsx`, `hooks/useJourneys*`
- Create: `frontend/scripts/journeys-nos.test.mjs`

**Interfaces — Consumes:** nós `notify_email` (`config.emails`, `config.assunto?`),
`webhook` (`config.url`); `journeys.allowed_emails`; `entry_config.form_ids` (Tarefas 1, 7, 8).
**Interfaces — Produces:** `JourneyNodeType` ganha `'notify_email' | 'webhook'`;
`NODE_LABELS`: "Avisar por e-mail", "Enviar para webhook"; `Journey.allowed_emails: string[] | null`;
`buildEntryConfig(eventType, pageSlug?, formIds?)`. Diálogo: lista de
e-mails (validados) e URL (`https://` obrigatório, aviso inline). Construtor:
campo "Modo teste — só envia para estes e-mails" no cabeçalho do fluxo e na
criação, com selo visível no cartão do fluxo quando ligado; no gatilho por
evento, além da página, "identificadores de formulário" (lista livre).

- [ ] **Passo 1: teste que falha:** `journeys-nos.test.mjs` — todo
  `JourneyNodeType` de `src/lib/journeys.ts` aparece como literal em
  `validate_journey_graph` da migration mais nova que a define; e todo tipo
  tem rótulo em `NODE_LABELS`. `node --test scripts/journeys-nos.test.mjs` → FAIL.
- [ ] **Passo 2:** implementar. **Passo 3:** o teste → PASS; `node --test scripts/journeys-eventos.test.mjs` → PASS;
  `tsc`, guarda 0 em `src/components/admin/automations`. **Passo 4:**
  `conferir-telas.mjs … automations` (só leitura). **Passo 5: commit**
  `feat(prova-rd): construtor com avisar por e-mail, webhook, modo teste e filtro por formulário`.

### Tarefa 16: Campo personalizado em segmento e condição; ficha com consentimento; link para a ficha

**Files:**
- Modify: `components/admin/segments/SegmentFormModal.tsx`, `components/admin/automations/NodeConfigDialog.tsx`
  (`ATTRIBUTE_FIELD_OPTIONS`), `components/admin/LeadDetailSheet.tsx`, a página
  de Contatos (rota `contacts`), `frontend/src/lib/contatos.ts` (ou o lib de
  leitura que a ficha usa)

**Interfaces — Consumes:** regra `{field: 'campo_extra', key, operator, value}` (Tarefa 1);
`GET /contatos/{id}/consentimentos` e `campos_extras` em `GET /contatos/{id}` (Tarefa 3).
**Interfaces — Produces:** opção "Campo personalizado" nos dois seletores,
com chave + operadores `is`/`is_not`/`contains`/`not_contains`;
`listarConsentimentos(leadId)`; na ficha, bloco "Campos personalizados" e
"Consentimento" (data, base legal, versão, "provisória", origem, IP);
Contatos abre a ficha com `?contato=<id>` (é o link do aviso por e-mail).

- [ ] **Passo 1:** implementar. **Passo 2:** `tsc`, guarda 0 nas pastas tocadas.
  **Passo 3:** `conferir-telas.mjs … contacts segments` (só leitura).
  **Passo 4: commit** `feat(prova-rd): campo personalizado em regra, consentimento na ficha, link direto`.

### Tarefa 17: Arquivos (PDF) para o e-mail

**Files:**
- Create: `frontend/src/components/admin/templates/ArquivosDialog.tsx`
- Modify: `frontend/src/lib/config.ts` (`subirArquivo(arquivo: File): Promise<Arquivo>`
  no molde de `subirImagemDeEmail`; `listarArquivos(): Promise<Arquivo[]>`), a
  tela de Templates (botão "Arquivos")

**Interfaces — Consumes:** `POST/GET /arquivos` (Tarefa 9).
**Interfaces — Produces:** `type Arquivo = { id; nome; tamanho; url; url_publica; criado_em }`;
diálogo com lista, upload (só `.pdf`, aviso de 10 MB antes de mandar) e
"copiar link" (`url_publica`).

- [ ] **Passo 1:** implementar. **Passo 2:** `tsc`, guarda 0. **Passo 3:**
  `conferir-telas.mjs … templates` (só leitura). **Passo 4: commit + portão +
  push + "pronto para merge"** `feat(prova-rd): arquivos PDF para a ficha técnica`.

---

## Fase 2 — coordenadora (depois dos quatro merges)

### Tarefa 18: O roteiro da prova, o seed e a limpeza

**Files:**
- Create: `docs/prova-rd/roteiro.md`, `scripts/prova-rd/semear.sql`,
  `scripts/prova-rd/receptor.sql`, `scripts/prova-rd/conferir.sql`,
  `scripts/prova-rd/limpeza.sql`, `~/marketinghs-prova-rd.sh`
- Modify: `docs/perguntas-abertas.md` (as quatro da seção 8 da spec e as
  anotadas pelas frentes), `docs/CONTINUAR-AQUI.md`

**Interfaces — Consumes:** tudo acima. Nenhum agente roda estes scripts.

- `semear.sql` (psql com `-v emails='{a@x,b@y}'` e `-v aviso='a@x'`, reaplicável
  por `ON CONFLICT`/`WHERE NOT EXISTS`): a página `phoebus-prova` (`landing`,
  `active`, config com os 5 campos da spec 4.1 — `nome`/`email`/`whatsapp`
  (rótulo "Celular", `telefone`)/`empresa` obrigatórios e `ja_faz_testagem`
  `sim_nao` opcional —, corpo, `consentimento` com a política e
  `versao = 'provisoria-2026-10'`, `provisoria = true`, `noindex = true`,
  `tags = ['prova-rd']`); o site "Site de teste da prova" (domínio da página
  de teste, `tags = ['prova-rd']`); 4 templates curtos com a marca
  (Boas-vindas, Nutrição 1, Nutrição 2, Ficha técnica com marcador
  `{{LINK_DO_PDF}}` que o Erick troca depois do upload); as 3 jornadas da
  spec 4.5, **ativas, em modo teste com `:emails`**, todas por
  `form_submitted` filtrado: Boas-vindas+nutrição (`page_slug =
  'phoebus-prova'`, `form_ids = ['prova_cap_phoebus']`, `once`, esperas de 10
  min), Ficha (`form_ids = ['prova_ficha_phoebus']`, `allowed`, 1 h), Aviso
  ao comercial (`page_slug` + os dois `form_ids`, `allowed`, 1 h: `notify_email`
  para `:aviso` → `handoff_growthhs`). Nenhuma jornada por segmento.
- `receptor.sql`: `growthhs_config` → `base_url = 'http://erick_marketinghs-api:8000/teste/growthhs'`,
  `board_id = 1`, guardando a linha anterior numa tabela temporária do
  script; `GROWTHHS_API_KEY` em `integration_secrets` só se vazia, gerada
  no script sem imprimir.
- `conferir.sql` (só leitura): por passo do roteiro — lead, tags, conversões,
  consentimentos, eventos, runs e passos, `journey_saidas`,
  `growthhs_receptor_pedidos`, estágio; e **a conferência da antimeta**:
  `campaign_sends` + `journey_saidas` do dia com destinatário fora de
  `:emails` ∪ `:aviso` → tem que dar **0 linhas**.
- `limpeza.sql`: leads com a tag `prova-rd` → `deleted_at = now()`; jornadas
  da prova → `archived`; `growthhs_config` de volta; página → `inactive`; site → `ativo = false`.
- `~/marketinghs-prova-rd.sh semear|receptor|conferir|limpar` — molde do
  `~/marketinghs-migration-026.sh` (lê `~/marketinghs.env`, `ON_ERROR_STOP`).
- `roteiro.md`: **Antes** (Erick): migration 027 aplicada; deploy de api,
  worker e sistema; `PROVA_RECEPTOR_TESTE=true` no `.env` da API (via
  `~/gerar-env-marketinghs-producao.sh`); segundo domínio no serviço
  `marketinghs-sistema` para a página de teste (outra origem que a da API);
  chave de API `write` para o `curl` do CRM; `semear` e `receptor`; upload do
  PDF pela tela de Arquivos e o link no template. **Os 12 passos da spec
  seção 7**, cada um como `- [ ]` com: o que fazer, o que se espera ver, e a
  consulta de `conferir.sql` que prova — com o passo 5 marcado "receptor de
  teste — GrowthHS: pendente do endpoint", o passo 7 conferindo
  `prova_cap_phoebus` — não `cap_phoebus` (decisão 9.1 da spec: o RD não
  roteia esse identificador à agência), o passo 9
  com os dois `curl` do contrato, o passo 12 com `conferir` (antimeta) e
  `limpar`. **Depois**: `PROVA_RECEPTOR_TESTE=false`, resultado ✅/❌ por linha
  no `CONTINUAR-AQUI.md`.

- [ ] **Passo 1:** escrever os arquivos.
- [ ] **Passo 2:** provar `semear.sql`, `conferir.sql` e `limpeza.sql` duas
  vezes no Postgres 17 local descartável com as 27 migrations (o mesmo da
  Tarefa 1); `conferir` depois de `limpar` não pode quebrar.
- [ ] **Passo 3: commit + push** `docs(prova-rd): roteiro da prova, seed e limpeza`.

---

## Decisões tomadas onde a spec deixou aberto (seção 6)

Registradas também em `docs/frentes/prova-captura.md` para o Erick conferir.

1. **Página de teste de outra origem:** arquivo estático em
   `frontend/public/prova/site-teste.html`, servido pelo nginx do
   `marketinghs-sistema` num **segundo domínio** do mesmo serviço (o Erick o
   adiciona no EasyPanel). O `action` aponta para `/api/publico/prova/recebido`,
   atrás de `PROVA_RECEPTOR_TESTE`.
2. **Ficha técnica:** o segundo formulário (`prova_ficha_phoebus`) fica na
   página de teste, não na landing — a landing segue com um formulário só.
3. **Filtro por formulário na jornada:** `entry_config.form_ids` (lista),
   em OU com `page_slug`, para uma jornada poder entrar pela landing **ou**
   pelo form do site.
4. **Tag `prova-rd`:** `pages.config.tags` e `sites.tags`, aplicadas na
   captura pelo mesmo caminho da tag do slug.
5. **Texto do consentimento** sai da config da página no servidor; o
   navegador só diz "aceitou".
6. **Aviso e webhook** viajam por uma caixa de saída (`journey_saidas`)
   drenada num laço próprio do worker; o aviso conta no teto do Resend pelo
   `ritmo.SQL_USO`.
7. **Modo teste** compara o e-mail **do contato** com a lista; nó com efeito
   fora da lista vira `skipped` e o fluxo segue; o worker confere de novo
   antes do Resend.
8. **Volta do CRM** pela rota de evento existente com `source_app =
   'growthhs'`; `/publico/contato/status` também aceita `lead_id` e e-mail.
9. **Taxa** = conversões ÷ visitantes únicos; lead excluído sai da conta.
10. **Botão de WhatsApp** entra nesta rodada (é pequeno e o RD tem).
11. **Script** manda `text/plain` por `sendBeacon` (sem preflight) e exige
    `Origin`.
