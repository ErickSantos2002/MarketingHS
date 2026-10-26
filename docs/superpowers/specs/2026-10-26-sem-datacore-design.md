# Sem DataCore — design (pergunta 80)

26/10/2026, frente `sem-datacore`. Decisão do Erick (pergunta 80, não se
reabre): nada que veio do DataCore (Tiny ERP, base de clientes) vai ao CRM nem
volta para o MarketingHS. Só vai ao comercial o que veio de landing,
formulário de site ou import manual (CSV). Os 2.104 contatos
`leads.source = 'datacore'` saem do banco por script à parte (coordenadora).

## 1. A sincronização sai da tela e da API

Levantamento (`grep -rni datacore backend/app frontend/src`) e o destino de
cada ocorrência:

| Onde | O que é | Destino |
|---|---|---|
| `backend/app/routers/datacore.py` | `GET /datacore/previa`, `POST /datacore/sincronizar` | **sai** (arquivo apagado; as rotas passam a 404) |
| `backend/app/dominio/sincronizacao_datacore.py` | a carga em `leads` + `ecosystem_identities` | **sai** |
| `backend/app/dominio/datacore.py` | a leitura do ERP (`clientes_do_datacore`, `ClienteErp`) | **sai** |
| `backend/app/main.py` | `include_router(datacore_router)` e `init_datacore`/`close_datacore` no lifespan | **sai** — a pool do DataCore não abre mais no boot |
| `backend/app/database.py` | `_pool_datacore`, `init_datacore`, `close_datacore`, `sessao_datacore` | **sai** |
| `backend/app/config.py` | `DATACORE_URL`, `DATACORE_EMAIL_DE_NOTAS` | **fica, inerte** — o `.env` de produção ainda as tem e o pydantic-settings derrubaria o boot se saíssem de `Settings`. Comentário diz que não têm uso. Saem depois que o Erick tirar do `.env` (ver "Para a coordenadora") |
| `backend/app/dominio/automacao.py` | docstring: "recálculo e sincronização do DataCore não disparam automação" | **muda o texto** — a sincronização não existe mais; a marca segue para recálculo e importação |
| `backend/app/routers/contatos.py:110` | comentário "como o recálculo e o DataCore (decisão 6)" | **fica** — comentário histórico de uma decisão; não é código. Fora do território |
| `backend/app/routers/configuracao.py:123,139` | docstrings históricas (status "Cliente" não criado; lista de tipos que não incluía `datacore`) | **fica** — histórico; a lista de tipos vem do banco (`DISTINCT tipo`), então `datacore` some sozinho quando os contatos forem apagados |
| `backend/app/ia/analista.py:44` | exemplo no prompt: "2.080 contatos do tipo datacore" | **muda** — exemplo passa a ser `csv_import`; com os contatos apagados, o exemplo induziria o modelo a citar um recorte que não existe |
| `frontend/src/components/admin/DatacoreImport.tsx` | a aba "DataCore (ERP)" | **sai** |
| `frontend/src/lib/datacore.ts` | cliente HTTP de `/datacore/*` | **sai** |
| `frontend/src/pages/admin/ImportPage.tsx` | as abas CSV / DataCore | **muda** — sai o `Tabs` (uma aba só não é aba); fica o `LeadsImport` direto |
| `frontend/src/components/admin/segments/SegmentFormModal.tsx:140`, `frontend/src/lib/contatos.ts:63` | comentários históricos | **ficam** — a lista de tipos é a do banco |
| `frontend/src/design-system/ORIGEM.md` | "DataCoreHS" é outro sistema (cópia do DS) | **fica** — não é o DataCore ERP, e não se edita ali |
| `backend/migrations/013, 015, 019, 023, 026` | schema (`ecosystem_identities.datacore_cliente_id`, comentários) | **fica** — migration aplicada não se reescreve; a coluna fica sem escritor (inerte) |
| `backend/tests/test_datacore_leitura.py`, `test_datacore_pool.py`, `test_sincronizacao_datacore.py` | testes do que saiu | **saem** |
| `backend/tests/test_automacao_em_massa.py` | caso "sincronização não dispara regra" e a lista de quem chama `marcar_sem_automacao` | **muda** — o caso sai; a lista perde `sincronizar` |

**Corte silencioso — o que mais usava o DataCore:**

- **Segmento por tipo `datacore`**: o construtor de segmentos lista os tipos
  do banco. Sem os contatos, o tipo some da lista; um segmento JÁ salvo com
  `tipo = datacore` passa a contar **zero** — o que é verdade (não há mais
  esses contatos), não um defeito. Campanha agendada para esse segmento sai
  para ninguém. Anotado para a coordenadora conferir se há segmento salvo
  assim antes de apagar os contatos.
- **IA (analista)**: só o exemplo do prompt; a ferramenta conta pelo banco.
- **Pontuação/etiqueta, painel**: leem `leads`; os números caem os 2.104
  quando o script apagar — esperado, é a decisão.
- **Nenhum worker** sincronizava o DataCore (a carga era só pelo botão).

## 2. A trava no envio ao CRM (segunda linha)

Quem cria pedido em `crm_handoffs` (levantamento):

| Caminho | Onde | Trava |
|---|---|---|
| Botão "Enviar ao comercial" | `routers/crm.py` → `entrega.enfileirar` | `enfileirar` levanta `ContatoRecusado`; a rota responde **409** com a mensagem |
| Nó de jornada `handoff_growthhs` | `jornadas/executor.py` → `entrega.enfileirar` | o nó pega `ContatoRecusado`, registra o passo `skipped` com o motivo e **segue** o fluxo (um CRM recusado não pode parar a jornada, mesma regra do CRM fora do ar) |
| Regra de automação | gatilho `evaluate_automation_on_etiqueta` (019/020/023) — **só banco** | **migration 033**: gatilho `BEFORE INSERT` em `crm_handoffs` que descarta (RETURN NULL) o pedido de lead `source = 'datacore'` |
| Reenfileirar falhas | `configuracao.py` (UPDATE de falhou → pendente, não cria) | não cria pedido; um pedido `datacore` que volte à fila é recusado de novo pela entrega |
| A entrega | `crm/entrega.py:_entregar` | pedido de lead `datacore` (criado antes da 033, ou contato que mudou de origem) **falha** com motivo legível, `crm_handoff_falhou` na linha do tempo, GrowthHS nem é consultado |

Por que a 033 é um gatilho em `crm_handoffs` e não uma linha a mais no
`evaluate_automation_on_etiqueta`: reescrever a função inteira (220 linhas,
já recriada três vezes) para uma condição é o risco de regressão que o
CLAUDE.md descreve; o gatilho na tabela é pequeno, cobre **todo** caminho de
escrita (inclusive um futuro) e não depende de ninguém lembrar. Ele é
silencioso de propósito: erguer exceção abortaria o UPDATE do lead que
disparou a regra. O barulho fica na aplicação (409, passo `skipped`, falha
na linha do tempo).

A origem recusada é `ORIGENS_RECUSADAS = ("datacore",)` em `crm/entrega.py`,
comparada sem caixa e sem espaço (`lower(btrim(source))`), igual no gatilho.

## 3. Testes

`backend/tests/test_sem_datacore.py` (+ um caso em `test_crm_entrega.py`):

- `/datacore/previa` e `/datacore/sincronizar` → 404; `app.database` não tem
  mais `init_datacore`; os módulos de sincronização não importam.
- `enfileirar` recusa contato `datacore` (e `" DataCore "`); aceita
  `csv_import`, landing e sem origem.
- Botão manual: 409 com a mensagem; contato de landing → 202.
- Nó de jornada: passo `skipped` com motivo, avança, nenhum pedido.
- Regra: contato `datacore` que casa com regra ativa → nenhum pedido;
  INSERT direto em `crm_handoffs` → nenhuma linha (033).
- Entrega: pedido de contato que virou `datacore` → `falhou`, motivo no
  pedido e na linha do tempo, nenhuma chamada ao GrowthHS.

## Para a coordenadora

- **033** (`backend/migrations/033_crm_recusa_datacore.sql`): aplicar e
  aplicar de novo (reaplicável).
- Tirar `DATACORE_URL` e `DATACORE_EMAIL_DE_NOTAS` do `.env` de produção da
  api (e do worker, se tiver); **só depois** tirá-las de `Settings`.
- Antes de apagar os contatos: conferir segmento salvo com `tipo = datacore`
  e campanha/jornada que o use.
