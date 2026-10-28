# Agendamento de reunião na landing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o lead de empresa com mais de 400 funcionários marca sozinho, pela landing, uma reunião na sala de vídeo do GrowthHS com um vendedor livre; o card nasce na lista 28 com vendedor, nota, reunião e convite, e o vendedor recebe e-mail.

**Architecture:** o MarketingHS guarda a roleta de reunião e as reservas no próprio banco (decisão e trava num só lugar) e fala com o GrowthHS só pela API de integração: `/integration/vendedores`, `/integration/agenda`, `cards`, `card-notes`, `card-tasks`, `daily-room`. A confirmação grava a reserva numa transação; a criação no GrowthHS e os e-mails rodam num laço próprio do worker, passo a passo com estado gravado, como a entrega de hoje.

**Tech Stack:** FastAPI + asyncpg (backend), httpx (GrowthHS, Resend), React 18 sem shadcn no bundle da landing, React + shadcn no admin, pytest + `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-28-agendamento-reuniao-design.md` (inclui o contrato final do GrowthHS). Ler inteira antes da Task 1.

## Global Constraints

- Tudo em UTC explícito (`...Z`) entre MarketingHS e GrowthHS; a tela mostra Brasília (`America/Sao_Paulo`).
- Padrões: duração **60 min**, expediente **seg–sex 08:00–18:00** Brasília, antecedência **120 min**, janela **14 dias**, grade de início a cada **30 min**, abandono **30 min**. Todos vêm de `config.agendamento` da página, com esses padrões.
- `/integration/agenda` aceita período ≤ **15 dias** e ≤ **30** `user_ids`.
- Status do `getSchedule` que contam como ocupado: `busy`, `tentative`, `oof`, `workingElsewhere` — tudo que a rota devolve. Vendedor em `erros` = **ocupado** no período inteiro.
- Card novo: lista **28**, `assigned_to_id` = vendedor, `acquisition_channel="Inbound"`. Tarefa: `task_type="meeting"`, `meeting_kind` da config (Phoebus: `apresentacao_phoebus`), `invited_emails=[e-mail do lead]`.
- Uma reserva futura por e-mail (minúsculas, sem espaço) **por ambiente**.
- `sessao()` é o único caminho para dado; rotas públicas usam `role="service_role"` (como `captura.py`); rotas de admin usam `admin_atual`.
- Rede nunca dentro de transação (padrão `entrega.py`).
- Migration nova = **036**, reaplicável (rodar duas vezes). Funções copiadas da 027 são **cópia fiel** + a mudança, como a 027 fez com a 026.
- Sem hexadecimal/cor literal no JSX do admin (`npm run guarda:visual`). A landing é exceção (CSS próprio em `landing.css`).
- Arquivos `frontend/src/landing/*.ts` testados por `node --test`: sintaxe apagável, sem import de `@/`.
- Textos ao lead em português, tom da landing. Nenhuma credencial em log.

## Review Focus

1. **Dia em Brasília x UTC:** horário 21:00 Brasília é 00:00Z do dia seguinte — agrupar por dia de Brasília (Task 3 testa).
2. **Vendedor em `erros` da `/agenda`** (fora do grupo do Exchange, sem caixa): nunca vira "livre" (Task 3 e Task 5 testam).
3. **Clique duplo / duas abas confirmando:** mesma reserva, nunca duas (Task 5 testa).
4. **E-mail com maiúscula/espaço** (`Joao@X.com `): é o mesmo lead para "uma reserva futura" e para achar pessoa no GrowthHS (Task 5 testa).
5. **Convite cortado em silêncio:** `daily-room` 2xx com `convidados_removidos > 0` é falha que alerta o admin, não sucesso (Task 7 testa).

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `backend/migrations/036_agendamento_reuniao.sql` | tabelas `reuniao_roleta`, `reuniao_agendamentos`; marca `agendamento` no evento e filtro na matrícula |
| `backend/app/crm/growthhs.py` | métodos novos do `Cliente` |
| `backend/app/agendamento/__init__.py` | vazio |
| `backend/app/agendamento/config.py` | ler `config.agendamento` da página com padrões |
| `backend/app/agendamento/horarios.py` | grade de horários e escolha do vendedor (puro, sem I/O) |
| `backend/app/agendamento/reserva.py` | rascunho, horários disponíveis, confirmação com trava |
| `backend/app/agendamento/execucao.py` | fila: criar no GrowthHS, e-mail ao vendedor, alerta, abandono |
| `backend/app/routers/agendamento.py` | rotas públicas `/publico/agendamento/...` |
| `backend/app/routers/configuracao.py` | rotas de admin da roleta |
| `backend/app/captura/registro.py` | parâmetro `agendamento` em `registrar_captura` |
| `backend/app/main.py` / `backend/app/config.py` | router novo + balde de ritmo dos horários |
| `backend/app/worker.py` | laço `_laco_agendamentos` |
| `frontend/src/landing/agendamento.ts` | tipos + chamadas + regras puras do modal |
| `frontend/src/landing/Agendamento.tsx` | o modal em 4 etapas |
| `frontend/src/landing/Formulario.tsx`, `Landing.tsx`, `campos.ts`, `landing.css` | botão, oferta no obrigado, tipo da config |
| `frontend/src/components/admin/pages/PageConfigEditor.tsx` | bloco "Agendamento de reunião" |
| `frontend/src/components/admin/settings/RoletaReuniaoCard.tsx` | tela da roleta (novo), montado em `SettingsPage.tsx` abaixo de `<GrowthHSCard />` |

---

### Task 1: Migration 036

**Files:**
- Create: `backend/migrations/036_agendamento_reuniao.sql`
- Test: `backend/tests/test_migracao_036.py`

**Interfaces:**
- Produces:
  - `reuniao_roleta(ambiente text CHECK IN ('homologacao','producao'), user_id bigint, posicao int, nome text, email text, PRIMARY KEY (ambiente, user_id))` — fila: menor `posicao` = vez.
  - `reuniao_agendamentos(id uuid PK DEFAULT gen_random_uuid(), token text UNIQUE NOT NULL, ambiente text NOT NULL, page_slug text NOT NULL, email text NOT NULL, dados jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'rascunho' CHECK IN ('rascunho','reservada','criada','falhou','realizada','abandonada','lead_comum'), vendedor_id bigint, vendedor_nome text, vendedor_email text, inicio timestamptz, fim timestamptz, card_existente_id bigint, lead_id uuid REFERENCES leads ON DELETE SET NULL, person_id bigint, card_id bigint, task_id bigint, public_link text, email_vendedor_em timestamptz, alerta_em timestamptz, tentativas int NOT NULL DEFAULT 0, visivel_em timestamptz NOT NULL DEFAULT now(), erro text, criado_em timestamptz NOT NULL DEFAULT now(), atualizado_em timestamptz NOT NULL DEFAULT now())`.
  - Índices: `uniq_reuniao_vendedor_inicio (ambiente, vendedor_id, inicio) WHERE status IN ('reservada','criada','falhou')`; `uniq_reuniao_email_futura (ambiente, email) WHERE status IN ('reservada','criada','falhou')` — segura a corrida de "uma futura por e-mail"; reunião que já passou sai do índice porque a varredura da Task 7 a marca `realizada`; `idx_reuniao_a_executar (visivel_em) WHERE status = 'reservada'`; `idx_reuniao_rascunho (criado_em) WHERE status = 'rascunho'`.
  - Tabelas só de máquina: RLS ligado, sem política, `GRANT` só a `service_role` (molde `growthhs_receptor_pedidos`, 027:192). `reuniao_roleta` também `SELECT, INSERT, UPDATE, DELETE` a `service_role` (a rota de admin grava com `service_role` atrás de `admin_atual`, como `configuracao.py` faz com `growthhs_config`).
  - `fn_lead_insert_event` (cópia fiel da 027) acrescenta `'agendamento', NULLIF(current_setting('marketinghs.agendamento', true), '')` ao metadata.
  - `journey_enroll_event` (cópia fiel da 027): quando `p_metadata->>'agendamento' = 'true'`, **não matricula** em jornada cujo `nodes` tem nó `handoff_growthhs`; as demais seguem.

- [ ] **Step 1: Teste de reaplicação e de restrições**

```python
# test_migracao_036.py — molde: test_growthhs_ambientes.py::test_030_reaplicavel e test_handoff_banco.py
async def test_036_reaplicavel(conexao): ...           # aplica o arquivo 2x dentro da transação, sem erro
async def test_um_vendedor_um_horario(conexao):        # 2ª linha 'reservada' mesmo (ambiente, vendedor, inicio) -> UniqueViolationError
async def test_uma_reserva_por_email(conexao):         # 2ª 'reservada' mesmo (ambiente, email) -> UniqueViolationError; 'abandonada' não conta
async def test_marca_agendamento_nao_matricula_em_jornada_de_handoff(conexao):
    # jornada A ativa (page_slug 'x', nó handoff_growthhs), jornada B ativa (page_slug 'x', só nó email)
    # SELECT set_config('marketinghs.agendamento','true',true); INSERT lead com page_slug 'x'
    # -> journey_events processado: run em B, nenhum run em A
async def test_sem_marca_matricula_nas_duas(conexao): ...
```

- [ ] **Step 2: Rodar e ver falhar** — `cd backend && DATABASE_URL=<local> ./.venv/bin/pytest -q tests/test_migracao_036.py` → FAIL (arquivo não existe).
- [ ] **Step 3: Escrever a 036.** Cabeçalho no estilo da 027 (o porquê de cada bloco). Banco local: `bash scripts/banco-teste-local.sh` imprime a `DATABASE_URL`.
- [ ] **Step 4: Rodar e ver passar** — mesmo comando → PASS; aplicar o arquivo 2x no banco local com `psql -v ON_ERROR_STOP=1 -f` sem erro.
- [ ] **Step 5: Commit** — `git add backend/migrations/036_agendamento_reuniao.sql backend/tests/test_migracao_036.py && git commit -m "feat(agendamento): migration 036 — roleta, agendamentos e marca na matrícula"`

### Task 2: Cliente do GrowthHS — métodos de agendamento

**Files:**
- Modify: `backend/app/crm/growthhs.py` (classe `Cliente`, constantes de caminho em :57–60)
- Test: `backend/tests/test_growthhs_cliente.py` (estender o falso de lá), `backend/tests/growthhs_falso.py` (novo: extrair `GrowthHSFalso` de `test_crm_entrega.py:126` para cá e importar nos dois)

**Interfaces:**
- Produces (todos métodos de `Cliente`, erros pelas classes existentes):
  - `async def vendedores(self) -> list[dict]` — `GET /api/v1/integration/vendedores`; devolve só `ativo`.
  - `async def agenda(self, user_ids: list[int], inicio: datetime, fim: datetime) -> dict[int, list[tuple[datetime, datetime]] | None]` — `GET /api/v1/integration/agenda`; `None` = vendedor em `erros` (tratar como ocupado). Datas aware em UTC.
  - `async def buscar_pessoa(self, email: str) -> int | None` — só busca (o `_buscar_pessoa` existente, público), nunca cria.
  - `async def card_aberto(self, person_id: int) -> dict | None` — o mais recente de `cards_da_pessoa` com `not is_won and not is_lost`; devolve `{"id", "assigned_to_id"}` (se a listagem não trouxer `assigned_to_id`, `ler_card`).
  - `async def criar_tarefa(self, corpo: dict) -> dict` — `POST /api/v1/card-tasks`; mesma regra do `criar_card`: depois de 2xx nunca levanta.
  - `async def atribuir_vendedor(self, card_id: int, user_id: int) -> None` — `PUT /api/v1/cards/{id}` só com `assigned_to_id` (card existente sem vendedor).
  - `async def criar_sala(self, task_id: int) -> dict` — `POST /api/v1/card-tasks/{id}/daily-room` → `{"room_url","public_link","public_access_token","convidados_removidos"}`.

- [ ] **Step 1: Testes**

```python
async def test_vendedores_filtra_inativos(): ...          # falso devolve 3, 1 inativo -> 2
async def test_agenda_converte_utc_e_erros_viram_none():
    r = await cli.agenda([19, 3], ini, fim)
    assert r[19] == [(datetime(2026,10,29,13,tzinfo=UTC), datetime(2026,10,29,14,tzinfo=UTC))]
    assert r[3] is None
async def test_agenda_manda_datas_com_Z(): ...            # params inicio/fim terminam em "Z"
async def test_buscar_pessoa_nao_cria(): ...              # nenhum POST /persons
async def test_card_aberto_ignora_ganho_e_perdido(): ...
async def test_criar_tarefa_2xx_sem_corpo_nao_levanta(): ...
async def test_criar_sala_503_e_transitorio(): ...
```
- [ ] **Step 2: Rodar e ver falhar** — `./.venv/bin/pytest -q tests/test_growthhs_cliente.py` → FAIL (`AttributeError`).
- [ ] **Step 3: Implementar** os seis métodos e as rotas correspondentes no `GrowthHSFalso`.
- [ ] **Step 4: Rodar** `tests/test_growthhs_cliente.py tests/test_crm_entrega.py` → PASS (a extração do falso não quebra a entrega).
- [ ] **Step 5: Commit** — `feat(agendamento): cliente do GrowthHS com agenda, vendedores, tarefa e sala`

### Task 3: Config da página e regras puras

**Files:**
- Create: `backend/app/agendamento/__init__.py`, `backend/app/agendamento/config.py`, `backend/app/agendamento/horarios.py`
- Test: `backend/tests/test_agendamento_regras.py`

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) class ConfigAgendamento: ativo: bool; duracao_min: int = 60; meeting_kind: str = "apresentacao"; campo_porte: str = "funcionarios"; faixas_que_agendam: tuple[str, ...] = (); dias_uteis: tuple[int, ...] = (0,1,2,3,4); inicio_expediente: time = time(8); fim_expediente: time = time(18); antecedencia_min: int = 120; janela_dias: int = 14; grade_min: int = 30`
  - `def ler_config(config_da_pagina: dict | None) -> ConfigAgendamento` — lê `config["agendamento"]`; valor inválido cai no padrão; `ativo` falso sem `faixas_que_agendam`.
  - `def pode_agendar(cfg: ConfigAgendamento, campos: dict) -> bool` — `campos[cfg.campo_porte] in cfg.faixas_que_agendam`.
  - `def grade(cfg, agora: datetime, ocupado: dict[int, list[tuple[datetime, datetime]] | None]) -> dict[date, list[datetime]]` — chaves = dia **de Brasília**; valores = inícios em UTC onde ao menos um vendedor está livre do início ao fim (`None` = ocupado sempre); respeita expediente, antecedência, janela, grade.
  - `def escolher(fila: list[int], livres: set[int]) -> int | None` — primeiro da fila em `livres`.
  - `def fila_depois(fila: list[int], escolhido: int) -> list[int]` — escolhido vai para o fim; os pulados ficam onde estavam.

- [ ] **Step 1: Testes**

```python
def test_padroes(): assert ler_config({"agendamento": {"ativo": True, "faixas_que_agendam": ["401 a 1.000"]}}).duracao_min == 60
def test_sem_faixas_fica_desligado(): assert not ler_config({"agendamento": {"ativo": True}}).ativo
def test_pode_agendar_pela_faixa(): ...                         # "401 a 1.000" True, "101 a 400" False, ausente False
def test_grade_respeita_expediente_e_antecedencia():
    # agora = qua 28/10 10:00 BRT; ninguém ocupado; 60 min
    # 28/10: primeiro início 12:00 BRT (15:00Z), último 17:00 BRT; sábado/domingo ausentes; 14 dias
def test_grade_agrupa_por_dia_de_brasilia(): ...                # expediente até 22:00 -> 21:00 BRT (00:00Z do dia seguinte) fica no dia de Brasília
def test_um_livre_basta(): ...                                  # A ocupado 12-13, B livre -> 12:00 aparece
def test_none_e_ocupado_sempre(): ...                           # {A: None} -> grade vazia
def test_reuniao_que_encosta_no_ocupado(): ...                  # ocupado 13-14, 60 min: 12:00 ok, 12:30 não, 14:00 ok
def test_escolher_e_fila_depois():
    assert escolher([1,2,3,4,5], {4,5}) == 4
    assert fila_depois([1,2,3,4,5], 4) == [1,2,3,5,4]
```
- [ ] **Step 2: Rodar e ver falhar** — `./.venv/bin/pytest -q tests/test_agendamento_regras.py` → FAIL (import).
- [ ] **Step 3: Implementar** com `zoneinfo.ZoneInfo("America/Sao_Paulo")`; sem I/O.
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** — `feat(agendamento): config da página, grade de horários e regra da roleta`

### Task 4: `registrar_captura` com a marca de agendamento

**Files:**
- Modify: `backend/app/captura/registro.py:72` e `backend/app/captura/evento.py:51` (`publicar_conversao`)
- Test: `backend/tests/test_agendamento_captura.py`

**Interfaces:**
- Consumes: Task 1 (marca no gatilho e filtro).
- Produces: `registrar_captura(..., agendamento: bool = False)` — com `True`, emite `SELECT set_config('marketinghs.agendamento', 'true', true)` antes do INSERT/conversão, e `publicar_conversao` põe `"agendamento": true` no metadata do evento de reconversão.

- [ ] **Step 1: Testes** (fixture `conexao`, jornadas A com `handoff_growthhs` e B só e-mail, as duas no `page_slug` de teste)

```python
async def test_lead_novo_agendado_nao_entra_na_jornada_de_handoff(conexao): ...   # run só em B; nenhum crm_handoffs
async def test_lead_existente_agendado_tambem_nao(conexao): ...                   # caminho publicar_conversao
async def test_captura_comum_continua_entrando_nas_duas(conexao): ...
```
- [ ] **Step 2: Rodar e ver falhar** — `TypeError: unexpected keyword 'agendamento'`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** este arquivo + `tests/test_prova_captura.py tests/test_captura.py` → PASS.
- [ ] **Step 5: Commit** — `feat(agendamento): conversão marcada não matricula em jornada de handoff`

### Task 5: Reserva — rascunho, horários e confirmação

**Files:**
- Create: `backend/app/agendamento/reserva.py`
- Test: `backend/tests/test_agendamento_reserva.py`

**Interfaces:**
- Consumes: Task 1 (tabelas), Task 2 (`Cliente.agenda`, `buscar_pessoa`, `card_aberto`), Task 3 (regras), Task 4.
- Produces:
  - `async def criar_rascunho(conn, *, page_slug: str, email: str, dados: dict, ambiente: str) -> str` — devolve `token` (`secrets.token_urlsafe(24)`); e-mail normalizado.
  - `async def completar_rascunho(conn, token: str, dados: dict) -> dict` — mescla `dados`; devolve `{"pode_agendar": bool}`.
  - `async def horarios(token: str, *, agora: datetime, cliente) -> dict` — `{"dias": [{"data": "2026-10-29", "horarios": ["2026-10-29T15:00:00Z", ...]}], "duracao_min": 60}` ou `{"indisponivel": True}` (GrowthHS fora, roleta vazia, grade vazia). Card aberto com vendedor → só a agenda dele (grava `card_existente_id`/vendedor no rascunho). Desconta reservas do próprio banco (`reservada`/`criada`/`falhou` do mesmo ambiente) como ocupado.
  - `async def confirmar(token: str, inicio: datetime, *, agora: datetime, cliente) -> dict` — devolve `{"status": "reservada", "inicio", "fim", "vendedor_nome"}`, `{"status": "ja_tem", "inicio", "fim"}` (outra futura do mesmo e-mail) ou `{"status": "ocupado"}`. Ordem: (1) sem rede: conferir rascunho, `ja_tem`, horário na grade; (2) rede: `cliente.agenda` só daquele intervalo; (3) transação: `SELECT ... FROM reuniao_roleta WHERE ambiente=$1 ORDER BY posicao FOR UPDATE`, descontar reservas, `escolher`, `UPDATE reuniao_agendamentos SET status='reservada', vendedor_*, inicio, fim, visivel_em=now()`, regravar posições com `fila_depois` (card existente: não mexe na fila); `UniqueViolationError` → `ocupado` (ou `ja_tem` se o índice do e-mail). Depois do commit: `registrar_captura(..., agendamento=True)` com os dados do rascunho e grava `lead_id`.
  - `async def virar_lead_comum(token: str) -> None` — `registrar_captura` sem marca + `status='lead_comum'`; idempotente.

- [ ] **Step 1: Testes** (GrowthHS falso da Task 2; `agora` fixo)

```python
async def test_horarios_descontam_reserva_propria(): ...
async def test_vendedor_em_erros_nao_aparece_livre(): ...
async def test_card_aberto_mostra_so_o_vendedor_dele_e_nao_anda_a_fila(): ...
async def test_growthhs_fora_devolve_indisponivel(): ...
async def test_confirmar_escolhe_primeiro_livre_e_pulado_guarda_vez():
    # fila [A,B,C,D,E], A,B,C ocupados -> D; fila vira [A,B,C,E,D]
async def test_confirmar_duas_vezes_mesma_reserva(): ...          # 2ª chamada -> "ja_tem", mesma linha
async def test_email_com_maiuscula_e_espaco_e_o_mesmo(): ...
async def test_duas_confirmacoes_simultaneas_vendedores_diferentes():
    # 2 vendedores livres, asyncio.gather de 2 rascunhos no mesmo horário -> vendedores distintos
async def test_ultimo_livre_tomado_devolve_ocupado(): ...
async def test_horario_fora_da_grade_e_recusado(): ...
async def test_confirmado_grava_lead_com_marca_e_sem_handoff(): ...
```
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** — `feat(agendamento): rascunho, horários e confirmação com trava`

### Task 6: Rotas públicas

**Files:**
- Create: `backend/app/routers/agendamento.py`
- Modify: `backend/app/main.py` (include + balde), `backend/app/config.py` (`LIMITE_HORARIOS_POR_MINUTO: int = 60`)
- Test: `backend/tests/test_agendamento_rotas.py`

**Interfaces:**
- Consumes: Task 5. Ambiente = `ler_config().ambiente` (o ativo); sem ambiente ativo → `{"indisponivel": true}` nos horários e 503 nas outras.
- Produces (prefixo `/publico/agendamento`, `role="service_role"`):
  - `POST /dados` — corpo `{page_slug, email, nome, whatsapp, consentimento?, visitor_id?, website?}` → `{"token"}`. Página ativa com `agendamento.ativo`, senão 404. Honeypot (`_caiu_no_honeypot` de `captura.py`) → token falso aceito e nada gravado. `validar_dominio(email)`. Valida com `ler_definicoes`/`validar` só as chaves enviadas.
  - `POST /{token}/empresa` — `{fields: {...}}` → `{"pode_agendar": bool}`; valida com os `campos` da página (obrigatórios da etapa 2); `pode_agendar` falso → `virar_lead_comum` na hora.
  - `GET /{token}/horarios` → resultado de `horarios`. Balde próprio `LIMITE_HORARIOS_POR_MINUTO` (molde `main.py:136`).
  - `POST /{token}/confirmar` — `{inicio}` (ISO com fuso; sem fuso → 422) → resultado de `confirmar`; `ocupado` → **409**.
  - `POST /{token}/ligar` → `virar_lead_comum`; `{"ok": true}`.
  - Token desconhecido → 404 sem dizer mais nada.

- [ ] **Step 1: Testes** (fixture `cliente`, página de teste com `agendamento` e `campos`; GrowthHS falso via monkeypatch de `growthhs.Cliente` transporte)

```python
async def test_pagina_sem_agendamento_da_404(): ...
async def test_honeypot_responde_token_e_nao_grava(): ...
async def test_empresa_ate_400_vira_lead_comum(): ...           # pode_agendar False + lead em leads + status lead_comum
async def test_fluxo_completo_dados_empresa_horarios_confirmar(): ...
async def test_confirmar_sem_fuso_422(): ...
async def test_ocupado_409(): ...
async def test_horarios_tem_balde_proprio(): ...                # 31 GET /horarios não dão 429; /captura segue no balde comum
async def test_token_desconhecido_404(): ...
```
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** este arquivo + `tests/test_limite_descadastro.py` → PASS.
- [ ] **Step 5: Commit** — `feat(agendamento): rotas públicas do agendamento`

### Task 7: Execução no GrowthHS, e-mails e varreduras

**Files:**
- Create: `backend/app/agendamento/execucao.py`
- Modify: `backend/app/worker.py` (novo `_laco_agendamentos`, criado em `principal()` e incluído na tupla do `finally`; varredura no bloco do agendador, :576–588)
- Test: `backend/tests/test_agendamento_execucao.py`

**Interfaces:**
- Consumes: Task 2 (cliente), tabela da Task 1, `growthhs.nota_de_abertura`/`montar_card`/`marca_de_criacao`/`card_do_pedido`, `resend.enviar`, `integracoes.ler_segredo`.
- Produces:
  - `async def rodar_agendamentos(*, limite: int = 10, cfg=None, transporte=None, parar: asyncio.Event | None = None) -> dict` — reivindica `status='reservada' AND visivel_em <= now()` com `FOR UPDATE SKIP LOCKED` (molde `_reivindicar`, `entrega.py:207`) e executa por linha, **gravando cada id assim que existe**:
    1. pessoa (`achar_ou_criar_pessoa`) → `person_id`;
    2. card: `card_existente_id` se houver (e, sem vendedor, `atribuir_vendedor`), senão `criar_card` na lista 28 com `assigned_to_id` e a marca `marca_de_criacao(id)` na `description`; retry reconhece o card pela marca (molde `_entregar` :578–591) → `card_id`;
    3. nota (`anotar`) com `nota_de_abertura` + "Reunião agendada pelo lead: <dia> às <hora> (Brasília), <duração> min";
    4. tarefa (`criar_tarefa`) → `task_id`;
    5. sala (`criar_sala`) → `public_link`; `convidados_removidos > 0` → `ErroDefinitivo("convite cortado pelo GrowthHS")`;
    6. e-mail ao vendedor (abaixo) → `email_vendedor_em`; status `criada`.
    Erros: transitório → `visivel_em` com `espera_transitoria` de `entrega.py`, até `MAX_TENTATIVAS`; definitivo ou esgotado → `status='falhou'` (continua bloqueando o horário) + alerta.
  - `def montar_email_vendedor(ag: dict, lead: dict, url_card: str | None) -> tuple[str, str, str]` — `(assunto, html, texto)`; assunto `"Reunião agendada: <empresa> — <dd/mm> às <HH:MM>"`; corpo: data/hora Brasília, nome, empresa, cargo, e-mail, WhatsApp, funcionários, filiais, demais respostas, página de origem, botão "Abrir no GrowthHS" (`cfg.url_do_card`); tudo com `html.escape`.
  - `async def alertar_admins(ag: dict, motivo: str) -> None` — e-mail a todos os usuários `role='admin'` (`user_roles` + `auth.users`); grava `alerta_em` para não repetir.
  - `async def varrer(agora: datetime) -> dict` — rascunhos com `criado_em < agora - 30 min` e que passaram da etapa 1 → `virar_lead_comum`; os que nem completaram a etapa 1 → `abandonada`; `criada`/`falhou` com `fim < agora` → `realizada`.

- [ ] **Step 1: Testes** (molde `test_crm_entrega.py` + `resend_falso` de `test_prova_saidas.py:259`)

```python
async def test_cria_card_28_com_vendedor_nota_tarefa_sala_e_email(): ...
async def test_card_existente_recebe_nota_e_reuniao_sem_card_novo(): ...
async def test_201_perdido_no_card_nao_duplica(): ...           # retry acha pela marca
async def test_falha_na_sala_retoma_da_sala(): ...              # card/tarefa não são recriados
async def test_convite_cortado_falha_e_alerta(): ...            # convidados_removidos 1 -> falhou + alerta_em
async def test_falhou_continua_bloqueando_o_horario(): ...
async def test_email_do_vendedor_escapa_html(): ...
async def test_alerta_nao_repete(): ...
async def test_varrer_rascunho_de_31_min_vira_lead_comum(): ...
async def test_varrer_reuniao_passada_vira_realizada(): ...
```
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** `execucao.py` e o laço no worker (intervalo 15 s, molde `_laco_entregas` :507).
- [ ] **Step 4: Rodar** este arquivo + `tests/test_worker_*.py` → PASS.
- [ ] **Step 5: Commit** — `feat(agendamento): execução no GrowthHS, e-mail ao vendedor e alertas`

### Task 8: Roleta no admin

**Files:**
- Modify: `backend/app/routers/configuracao.py` (rotas novas ao lado das de `/config/growthhs`)
- Create: `frontend/src/components/admin/settings/RoletaReuniaoCard.tsx`
- Modify: `frontend/src/pages/admin/SettingsPage.tsx:148` (montar abaixo de `<GrowthHSCard />`)
- Test: `backend/tests/test_config_roleta.py`

**Interfaces:**
- Consumes: Task 2 (`vendedores`), tabela `reuniao_roleta`.
- Produces (`admin_atual`; leitor vê e não grava, como o resto):
  - `GET /config/growthhs/{ambiente}/roleta` → `{"fila": [{"user_id","nome","email","posicao"}], "vendedores": [...]}` (`vendedores` do GrowthHS daquele ambiente; GrowthHS fora → `vendedores: []` + `"aviso"`).
  - `PUT /config/growthhs/{ambiente}/roleta` — `{"user_ids": [5, 2, 3]}` (ordem = vez) → substitui a fila; ids fora da lista do GrowthHS → 422; nome/e-mail gravados do GrowthHS.
  - Tela: aba por ambiente (mesmo seletor do `GrowthHSCard`), lista ordenada com subir/descer/remover, "adicionar vendedor" a partir dos `vendedores`, salvar. Tokens de cor do `adocao.md`.

- [ ] **Step 1: Testes** — `test_roleta_exige_admin`, `test_put_grava_ordem_e_get_devolve`, `test_id_desconhecido_422`, `test_ambientes_separados`, `test_growthhs_fora_get_avisa`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** rotas e tela.
- [ ] **Step 4: Rodar** testes + `cd frontend && npx tsc --noEmit -p tsconfig.app.json && npm run guarda:visual -- src/components/admin/settings` → PASS / 0.
- [ ] **Step 5: Commit** — `feat(agendamento): roleta de reunião no admin`

### Task 9: Bloco "Agendamento de reunião" no editor da página

**Files:**
- Modify: `frontend/src/components/admin/pages/PageConfigEditor.tsx` (bloco novo no molde do consentimento, :364–420), `frontend/src/landing/campos.ts` (`ConfigDaPagina.agendamento?`)

**Interfaces:**
- Produces: `config.agendamento = {ativo: boolean, duracao_min: number, meeting_kind: string, campo_porte: string, faixas_que_agendam: string[], antecedencia_min: number, janela_dias: number}` — expediente fica no padrão (sem campo na tela no v1).
  - Tela: Switch "Permitir agendar reunião"; select "Campo do porte" (campos `lista` da página); checkboxes "Faixas que podem agendar" (opções do campo escolhido); select "Tipo da reunião" (`apresentacao_phoebus`, `duvidas_phoebus`, `apresentacao`, `duvidas`, `outra`); número "Duração (min)".

- [ ] **Step 1:** implementar e rodar `npx tsc --noEmit -p tsconfig.app.json` → 0 erros; `npm run guarda:visual -- src/components/admin/pages` → 0.
- [ ] **Step 2:** conferir no navegador: `node scripts/conferir-telas.mjs --porta <vite> --saida <pasta> /admin/paginas/<id>` e olhar o PNG.
- [ ] **Step 3: Commit** — `feat(agendamento): configuração do agendamento no editor da página`

### Task 10: O modal na landing

**Files:**
- Create: `frontend/src/landing/agendamento.ts`, `frontend/src/landing/Agendamento.tsx`, `frontend/scripts/landing-agendamento.test.mjs`
- Modify: `frontend/src/landing/Formulario.tsx` (oferta no obrigado), `frontend/src/landing/Landing.tsx` (botão "Agendar reunião" ao lado do formulário quando `config.agendamento?.ativo`), `frontend/src/landing/landing.css`

**Interfaces:**
- Consumes: Task 6 (rotas), Task 9 (`ConfigDaPagina.agendamento`).
- Produces (`agendamento.ts`, sem `@/`):
  - `export function agendamentoAtivo(config: ConfigDaPagina): boolean`
  - `export function podeAgendar(config: ConfigDaPagina, valores: Record<string, string>): boolean` — espelho de `pode_agendar`.
  - `export function camposDaEtapa2(config: ConfigDaPagina): CampoDaPagina[]` — todos os `campos` exceto `nome`, `email`, `whatsapp`.
  - `export function rotuloDoHorario(isoUtc: string): string` — `"15:00"` em Brasília; `export function rotuloDoDia(data: string): string` — `"quinta-feira, 29 de outubro"`.
  - Chamadas: `${BASE}/publico/agendamento/...` com `BASE = import.meta.env.VITE_API_URL ?? "/api"`.
- Modal (`Agendamento.tsx`): título "Agende sua reunião", "60 min · Sala de vídeo" (duração da config), passos 1–4 com indicador; etapa 2 reaproveita `Controle` de `Formulario.tsx` (exportar); etapa 3 calendário do mês com dias com vaga destacados + botões de horário, legenda "Horário de Brasília"; 409 → volta à etapa 3 com "Esse horário acabou de ser ocupado"; `ja_tem` → "Você já tem reunião dia X às Y"; `indisponivel` ou até 400 → "Nossa equipe vai entrar em contato" (+ `/ligar` quando indisponível). Fecha com Esc e no X; foco preso no modal; funciona a 375 px.
- Oferta no obrigado: depois de `/publico/captura` bem-sucedido, se `podeAgendar(config, valores)`, mostra "Quer adiantar? Agende sua reunião agora" que abre o modal **já com etapas 1–2 preenchidas** (chama `/dados` e `/empresa` com os valores do formulário e vai direto à etapa 3).

- [ ] **Step 1: Testes** (`node --test`)

```js
test("agendamentoAtivo exige ativo e faixas")
test("podeAgendar pela faixa do campo de porte")
test("camposDaEtapa2 tira nome, e-mail e WhatsApp")
test("rotuloDoHorario mostra Brasília: 2026-10-29T15:00:00Z -> 12:00")
test("rotuloDoDia: 2026-10-29 -> quinta-feira, 29 de outubro")
test("o modal chama /api/publico/agendamento")   // molde landing-caminhos.test.mjs:31
```
- [ ] **Step 2: Rodar e ver falhar** — `cd frontend && node --test scripts/landing-agendamento.test.mjs`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** `node --test scripts/landing-*.test.mjs`, `npx tsc --noEmit -p tsconfig.app.json`, `npm run build:landing` → PASS / 0 / build ok; conferir no navegador (desktop e 375 px) com `conferir-telas.mjs` na página de teste.
- [ ] **Step 5: Commit** — `feat(agendamento): modal de agendamento na landing`

### Task 11: Ponta a ponta na homologação (coordenadora, depois do merge)

Não é código. Com a 036 aplicada num banco local e o backend apontando para o GrowthHS de **homologação**:
- [ ] Roleta de homologação com o Erick (19) só; página de teste com `agendamento` ligado e faixa "401 a 1.000".
- [ ] Pela API pública: `/dados` → `/empresa` → `/horarios` (conferir que um compromisso de teste no Outlook do Erick some da grade) → `/confirmar`.
- [ ] Rodar `rodar_agendamentos(somente o agendamento de teste)`; conferir no GrowthHS de homologação: card na 28 com vendedor 19, nota, reunião; convite com link no `healthsafetyti+reuniaoN@gmail.com`; evento na agenda do `ti@`; e-mail ao vendedor.
- [ ] Script do Erick para produção: aplicar a 036; na config da página `phoebus`, campo `funcionarios` (lista, obrigatório: "Até 100", "101 a 400", "401 a 1.000", "Mais de 1.000"), campo `filiais` (lista, opcional: "Só a matriz", "2 a 5", "6 a 20", "Mais de 20") e `agendamento` com `faixas_que_agendam: ["401 a 1.000", "Mais de 1.000"]`, `meeting_kind: "apresentacao_phoebus"`.
- [ ] Registrar em `docs/CONTINUAR-AQUI.md`.
