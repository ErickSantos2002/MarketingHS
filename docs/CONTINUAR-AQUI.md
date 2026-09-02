# Continuar aqui

**Atualizado:** 2 de setembro de 2026
**Branch:** `reconstrucao` — **ainda não pushada**

## Onde paramos

**Lote 4 fechado.** Lotes 0 a 4 concluídos. O próximo é o **lote 5
(Integrações HS)**, e ⚠️ **ele exige trocar a senha do superusuário do Postgres
antes**.

### O que o lote 4 entregou

Jornadas e automações. Três telas migradas, três functions fora da pasta
(`journeys-api`, `journey-worker`, `automations-api`), **48 → 30** pontos de
acesso direto ao banco.

Um fluxo de dois passos roda de ponta a ponta pela tela: criado, salvo, ativado
com os contatos inscritos, o `delay` gravando `wakeup_at`, o worker acordando
os runs e a tag saindo do outro lado. As regras de automação têm CRUD completo,
prévia de quantos contatos pegam, e metade pública com chave de API.

### O que NÃO roda, de propósito, e onde está escrito

`handoff_nexus` (o nó) e as três ações de regra (`create_in_nexus`,
`move_stage_nexus`, `block_nexus`) dependem do GrowthHS, que é o lote 5. A tela
diz isso em vez de oferecer o que não roda:

| Onde | Constante |
|---|---|
| nó de fluxo | `NODE_NAO_LIGADO` em `frontend/src/lib/journeys.ts` |
| regra de automação | `AUTOMACAO_NAO_LIGADA` em `frontend/src/lib/automacoes.ts` |

**Apagar a entrada de `NODE_NAO_LIGADO` religa o nó nos três lugares que leem o
mapa** — menu do "+", diálogo de configuração e validação. É o primeiro passo
do lote 5.

⚠️ `evaluate_automation_on_etiqueta` e `trg_automation_on_etiqueta_change`
continuam removidos, e é decisão, não esquecimento: um trigger que avalia
regras cuja única ação não existe é trigger sem consumidor. Ele volta no lote
5, junto do Nexus — e a avaliação volta **no servidor**, servida por
`_condicao_sql` em `app/routers/automacoes.py`, não por uma segunda cópia no
navegador.

### O que o lote 4 ensinou, e vale para o 5

Três defeitos, nenhum no plano, todos achados por abrir no navegador e rodar o
worker de verdade. Dois deles **nunca funcionaram desde a origem**:

1. **Sobreviver ao port não é prova de que roda.** `journey_wake_on_event`
   estava na lista de "não reimplemente" e levantava erro em toda chamada —
   `LATERAL` no `FROM` de um `UPDATE` referenciando a tabela-alvo. Nenhum
   `wait_for_event` jamais acordou. Exercitar o caminho é a única prova.
2. **Duas funções do banco podem discordar entre si.** `journey_enroll_segment`
   lia `segment_ids`; `fn_journeys_validate` exigia `segment_id`. Nenhum fluxo
   com entrada por segmento podia ser ativado. Quando um guard e um executor
   olham o mesmo campo, conferir se olham do mesmo jeito.
3. **`sessao()` é UMA transação para o laço inteiro.** `try/except` por item não
   protege: o primeiro erro aborta a transação e todo o resto morre com
   "current transaction is aborted" — inclusive o `DELETE` que reivindicou o
   lote, que volta atrás e devolve tudo à fila para falhar de novo, para
   sempre. Laço dentro de uma `sessao()` precisa de SAVEPOINT
   (`async with conn.transaction()` aninhado). **Vale para todo laço do worker.**

E, pela quarta vez, **a tela limpa não era o portão inteiro**: `automations-api`
servia chave de API e estava ensinada na tela de Documentação da API e no
`dnmarketing-api.yaml`.

### Migrations aplicadas no lote 4

| | |
|---|---|
| **010** | fila de eventos, o trigger que a alimenta, `journey_enqueue_email` |
| **011** | `fn_journeys_validate` aceita entrada por vários segmentos |
| **012** | `journey_wake_on_event` volta a ser executável |

## O próximo passo — lote 5 (Integrações HS)

Traz os 2.077 clientes do DataCore, o GrowthHS e a identidade. É o lote que
**liga** o que o 4 deixou desligado de propósito.

⚠️ **Exige trocar a senha do superusuário do Postgres antes.**

As functions que sobram desse domínio: `handoff-to-nexus`, `get-nexus-stages`,
`nexus-config`, `merge-identities`, `identity-lookup`/`identity-upsert`. O
`NexusCard` em Configurações ainda fala com as duas primeiras — é o único
consumidor vivo delas.

## Antes de começar, o que depende do Erick

1. ~~Cadastrar `[marketinghs]` no cadastro de bancos~~ — **feito**
2. Preencher `POSTGRES_HOST_INTERNO` em `~/marketinghs.env`
3. **Trocar a senha do superusuário do Postgres** — obrigatório para o lote 5
4. Decidir sobre o **push da branch**: ele é o que rompe o sync com o Lovable.
   Está na spec e é intencional, mas nunca foi feito. ⚠️ Antes de pushar, ver o
   `SETUP-CLAUDE.md` (não versionado): o `.env` da dn.ia com credenciais do
   Supabase está no histórico do git desde o commit inicial do remix.

## Como subir o que existe

```bash
cd backend && ./.venv/bin/python -m uvicorn app.main:app --port 8100 --reload
cd frontend && npx vite --port 8080
cd backend && ./.venv/bin/python -m app.worker    # jornadas + fila de e-mail
```

⚠️ A porta 8000 é do **TaskHS** nesta máquina; o MarketingHS usa 8100 no host.
Dentro do contêiner o backend continua na 8000.

⚠️ Sem `RESEND_API_KEY` o worker **não consome a fila de e-mail**, de propósito
(decisão do Erick, lote 3B). As jornadas rodam normalmente; só o envio espera.

---

## Histórico dos lotes anteriores

### O que o lote 3 deixou pronto

| | |
|---|---|
| **3A** | CRUD de campanha e template, audiência ao vivo, acompanhamento |
| **3B** | Fila (visibility timeout, recuo, fila-morta), worker, montagem por destinatário, descadastro assinado |
| **3C** | Webhook do Resend, agendador, API pública, config do Resend e supressão pela tela |

**28 testes** cobrem o motor e o webhook — as duas partes que a spec manda
nascer com teste automatizado. `pytest` inteiro: 55.

### O que o portão pegou nestes lotes, e o plano não

Vale ler antes do próximo lote, porque o padrão se repete:

1. **A rota `/descadastrar` não existia.** O worker assinava um link para ela em
   todo e-mail e daria 404.
2. **`campaigns-api` e `templates-api` também serviam integrador externo** —
   portar as telas não as tornou órfãs.
3. **O webhook estava sob o limite de taxa de `/publico`** (30/min por IP). Uma
   campanha de mil e-mails geraria milhares de eventos, e o Resend levaria 429 e
   re-tentaria por 10 horas.
4. **As rotas de supressão aceitavam usuário sem papel**, que poderia desfazer
   descadastro e hard bounce.
5. **A documentação ensinava URLs mortas** — três vezes: a tela de Documentação
   da API, o `dnmarketing-api.yaml`, e o exemplo da merge tag no editor.

Nenhum desses estava no plano. Todos apareceram porque o portão tem três partes
e a terceira é abrir no navegador.

## O próximo passo

**Lote 4 (Jornadas)** ou **lote 5 (Integrações HS)**. O 4 depende do motor, que
agora existe; o 5 traz os 2.077 clientes do DataCore e ⚠️ **exige trocar a senha
do superusuário do Postgres antes**.

Para o lote 4, o que já está levantado: as quatro funções de fila de jornada
(`journey_queue_read`, `journey_queue_delete`, `journey_enqueue_email`,
`fn_contact_event_to_journey_queue`) e a `evaluate_automation_on_etiqueta` foram
removidas do schema no lote 0 e precisam voltar em Python. A tabela de fila
`journey_events` **não existe** — o 3B criou só a de e-mail, de propósito. As
funções de jornada que SOBREVIVERAM (`journey_claim_due_runs`,
`journey_enroll_event`, `journey_wake_on_event`, `validate_journey_graph`) não
se reimplementam.

### Lote 2 (Segmentos), antes disso

Segmento funciona de ponta a ponta pela tela: criar estático escolhendo contatos
na busca, criar dinâmico montando regras com a prévia contando ao vivo, editar,
duplicar, ver a lista de contatos, e excluir — com a guarda do banco recusando
quando o segmento está em uso e mostrando **qual campanha** o usa.

A API pública `/publico/segmentos` substituiu a `segments-api`. O portão pegou
duas chamadas mortas que nenhuma tela fazia: a tela de Documentação da API e a
especificação OpenAPI pública ainda ensinavam `/segments-api` aos integradores.

### Lote 1D (A porta pública), antes disso

A autenticação por chave de API existe: criar chave devolve a chave crua uma vez
e nunca mais, o escopo é aplicado nos dois sentidos, chave inválida e ausente
dão 401. Isso **destrava as 23 functions restantes** que dependiam dela.

⚠️ **Pendência honesta que continua aberta:** a tela de chaves nunca foi clicada
no navegador. O código está portado, tipado e compilando, e os endpoints foram
verificados por HTTP — mas um overlay de outra aba bloqueou o clique, e o portão
exige o clique. O lote 2 usou chaves de API de verdade contra os endpoints
públicos, o que aumenta a confiança no backend, mas **não** substitui abrir a
tela de Configurações → API Keys e criar uma chave clicando.

### Lote 1C (Escrita), antes disso

A barra de ações em massa funciona: alterar status, aplicar tag, exportar,
apagar e mesclar. A fusão acontece numa transação no servidor — provado forçando
uma falha no meio e conferindo que nada mudou.

O acesso direto ao banco caiu de 153 para **90 pontos**.

### Lote 1B (Leitura do admin), antes disso

A tela de Contatos lista os contatos, com tags, scores e pílulas de ecossistema.
A ficha abre com timeline de conversões, histórico de interações, notas e tags —
e criar nota pela ficha funciona (conferido clicando, não só pela API).

A barra de ações em massa aparece como "não portada" dentro do próprio limite de
erro, sem levar a tabela junto. É do lote 1C.

### Lote 1A (Entrada), antes disso

Funciona, conferido no navegador com um CSV real de 5 linhas: a tela de
Importar sobe o arquivo, deduplica por e-mail (inclusive maiúsculas), funde
linhas duplicadas do mesmo arquivo sem perder a mais completa, ignora linha sem
e-mail, normaliza status, aplica tag em lote e grava com score e etiqueta
calculados pelo trigger. Carla (Gerente de SESMT, site, WhatsApp, desafio
escrito) sai `hotlead` com 60; Elaine (Auxiliar, csv_import) sai com 0.

A régua de scoring é editável em Configurações → Lead Scoring, e a tela avisa
que salvar não repontua a base — para isso há o botão de recalcular.

### Lote 0 (Fundação), antes disso As nove tarefas fecharam. O que funciona de
verdade, conferido no navegador com Playwright e não só por teste:

- Login em `http://127.0.0.1:8080/login` com usuário do banco `marketinghs`
- A sidebar do admin abre
- A aba **Configurações → Usuários** lista, cria, promove, rebaixa, troca e-mail,
  reseta senha e exclui — tudo contra a API própria
- Tela não portada mostra "Tela ainda não portada: `<alvo>`" sem derrubar a casca

### O que o 1C fez, para referência

**Escrever o plano do lote 1C (Escrita).** As duas barras de ação em massa
somam 34 pontos de acesso direto — é o maior bloco isolado que resta — mais o
`StatusDropdown`. As functions são `contact-update`, `contact-status-update`,
`contact-tags-sync`, `apply-lead-tag` (que ficou desde o 1A) e `delete-contact`.

**Pronto quando:** você muda o status de um lote de contatos pela tela.

### O que o 1B fez, para referência

**Escrever o plano do lote 1B (Leitura).** Um plano por lote é o combinado.

O 1B mostra o que o 1A importou: `contacts-list` e `contact-details` como API
pública (autenticada por chave, não por JWT — é um segundo modelo de auth que o
backend ainda não tem), mais os endpoints de admin que substituem `useLeads`,
`useContactsEnriched` e a tabela de Contatos.

**Pronto quando:** a tela de Contatos lista os contatos importados e a ficha
360° abre com a timeline.

Uma decisão que nasce no 1B: a lista hoje ordena por `updated_at`, e recalcular
scores carimba esse campo em toda a base de uma vez, embaralhando a ordem.
Provavelmente deve passar a ordenar por `created_at`.

## Antes de começar, o que depende do Erick

1. ~~Cadastrar `[marketinghs]` no cadastro de bancos~~ — **feito**, o apelido
   já responde a `bancos.consultar`
2. Preencher `POSTGRES_HOST_INTERNO` em `~/marketinghs.env`
3. **Trocar a senha do superusuário do Postgres** — obrigatório antes do lote 5,
   não bloqueia o 3
4. Decidir sobre o **push da branch**: ele é o que rompe o sync com o Lovable.
   Está na spec e é intencional, mas nunca foi feito. ⚠️ Antes de pushar, ver o
   `SETUP-CLAUDE.md` (não versionado): o `.env` da dn.ia com credenciais do
   Supabase está no histórico do git desde o commit inicial do remix.

## Como subir o que existe

```bash
cd backend && ./.venv/bin/python -m uvicorn app.main:app --port 8100 --reload
cd frontend && npx vite --port 8080
```

⚠️ A porta 8000 é do **TaskHS** nesta máquina; o MarketingHS usa 8100 no host.
Dentro do contêiner o backend continua na 8000.

## O que o lote 0 ensinou, e que vale para os próximos

**A revisão pegou quatro defeitos no plano, não no trabalho.** A regex que
apagaria cinco funções a mais; o 503 prometido sem handler; a porta errada no
`.env.example`; e o `DELETE` que faltava no grant de `auth.users`. Planos deste
projeto merecem desconfiança na execução.

**O portão foi contado pela metade uma vez.** Na tarefa 6 as 6 functions saíram
da pasta enquanto a tela ainda as chamava. A tarefa 8 consertou, mas a lição é
que o portão só vale se as duas condições forem verificadas de fato.

**O motor do lote 3 é maior do que a spec estimou:** 14 funções e 2 triggers,
não 9 funções.
