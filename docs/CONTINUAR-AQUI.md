# Continuar aqui

**Atualizado:** 2 de setembro de 2026
**Branch:** `reconstrucao` — **ainda não pushada**

## Onde paramos

**Lotes 0 a 4 fechados, mais o 5B e o 5D.** O lote 5 foi partido em quatro:

| | | |
|---|---|---|
| **5A** | Handoff → GrowthHS | ⏸ **bloqueado** — ver abaixo |
| **5B** | Contatos do DataCore | ✅ concluído (02/09/2026) |
| **5C** | Identidade unificada, Meta CAPI | a fazer |
| **5D** | Limpeza das sobras | ✅ concluído (02/09/2026) |

## 🎨 O trabalho de visual já pode começar

Era para isto que o 5D existiu. **Doze das dezesseis telas do admin estão 100%
livres do toco do Supabase** e podem ser redesenhadas agora:

> Automações · Campanhas · Contatos · Experiments (as três) · Importar ·
> Construtor de fluxo · Login · Segmentos · Preview de template · Templates

⚠️ **Não redesenhe estas quatro ainda:**

| Tela | Por quê |
|---|---|
| **Visão Geral** e **Analytics** | o lote 6 as reescreve por dentro — trabalho de visual agora seria refeito |
| **Páginas** | lote 7 |
| **Configurações** | falta o `NexusCard` (5A, bloqueado) e o `MetaCard` (5C) |

⚠️ O design system da HS **vive no Claude Design** — ler de lá (DesignSync)
antes de desenhar, em vez de inventar.

## ⏸ Por que o 5A está bloqueado

A spec deixava em aberto se a API do GrowthHS já criava card. **Não cria.**
Existe `POST /integration/service-cards` no `hsgrowth-sistema`, com o desenho
certo (chave de API, escopo, create-or-return idempotente), mas ele só cria card
de **serviço**, em board de serviço, com o `source` travado num `Literal` de três
valores do GestorHS. O handoff do marketing quer card **comercial**.

O contrato completo do endpoint que falta está em
**`docs/contratos/2026-09-02-endpoint-card-comercial-growthhs.md`** — é um pedido
ao `hsgrowth-sistema`, não trabalho para fazer aqui.

⚠️ **O contrato achou um buraco que a spec não previa:** `service_cards` tem
`external_source`/`external_id` com unicidade e o card comercial **não tem
nenhum dos dois**. Sem chave de idempotência, um retry nosso cria um segundo
card para o mesmo lead — e quem descobre é o vendedor.

**Para destravar, precisamos de volta:** a chave de API com escopo
`cards:create`, o `board_id` do funil, a URL base da API, e se `origin` é lista
fechada ou texto livre.

## O que o 5B entregou

Os 2.080 clientes do ERP entraram como contato. `stage='client'` na identidade,
`tipo='datacore'` no lead, e o construtor de segmentos recorta cliente contra
lead — conferido na tela, contando 2.080.

⚠️ **A spec errava o número central por onze vezes:** "2.077 clientes, todos com
e-mail" são, na real, **2.081 clientes e 183 com e-mail utilizável**. Unindo
nota fiscal e conta a receber o teto é 327, e isso está atrás de
`DATACORE_EMAIL_DE_NOTAS`, **desligada** — e-mail coletado para faturar não é
consentimento para marketing, e ligar é decisão do Erick e do Nicholson.

## O que o 5B ensinou, e vale para o 5C

1. **Três queries por linha não escalam para dois mil.** 400ms cada contra o
   Postgres remoto viram 14 minutos. Bloco de 500 com `unnest` levou a 3,1s. Se
   o 5C for casar identidades em massa, nasça em lote.
2. **`ON CONFLICT (email)` não é idempotência** quando o e-mail pode ser nulo:
   NULL não conflita com NULL. A chave tem de ser a que sempre existe.
3. **Lista de valores escrita à mão no frontend envelhece calada.** A de `tipo`
   era da dn.ia e já não tinha `csv_import`, do lote 1A — dava para importar
   contato que ninguém segmentava. Agora vem do banco (`/tipos-de-contato`).
4. **A spec erra vocabulário, não só número.** `stage` é em inglês; não existe
   status "Cliente". Conferir contra o banco antes de escrever.
5. **Matar o pytest no meio vaza dado.** A fixture do webhook commita e só
   desfaz no teardown; um `timeout` deixou a linha e o índice único derrubou a
   rodada seguinte inteira. A fixture agora limpa antes de inserir.

## Migrations aplicadas

| | |
|---|---|
| **010–012** | lote 4 (jornadas) |
| **013** | `ecosystem_identities.datacore_cliente_id` + índice único parcial |

## Antes de continuar, o que depende do Erick

1. ~~Cadastrar `[marketinghs]` no cadastro de bancos~~ — **feito**
2. ~~Trocar a senha do superusuário do Postgres~~ — a ferramenta está pronta:
   `bash ~/trocar-senha-admin.sh marketinghs`. ⚠️ Depois, atualizar
   `POSTGRES_PASSWORD` no EasyPanel.
3. Preencher `POSTGRES_HOST_INTERNO` em `~/marketinghs.env`
4. **Passar o contrato do 5A** para o agente do `hsgrowth-sistema`
5. Decidir sobre `DATACORE_EMAIL_DE_NOTAS` (190 → 327 contatos alcançáveis)
6. Decidir sobre o **push da branch**: ele é o que rompe o sync com o Lovable.
   ⚠️ Antes de pushar, ver o `SETUP-CLAUDE.md` (não versionado): o `.env` da
   dn.ia com credenciais do Supabase está no histórico do git.

## Como subir o que existe

```bash
cd backend && ./.venv/bin/python -m uvicorn app.main:app --port 8100 --reload
cd frontend && npx vite --port 8080
cd backend && ./.venv/bin/python -m app.worker    # jornadas + fila de e-mail
```

⚠️ A porta 8000 é do **TaskHS** nesta máquina; o MarketingHS usa 8100 no host.

⚠️ Sem `RESEND_API_KEY` o worker **não consome a fila de e-mail**, de propósito
(decisão do Erick, lote 3B). As jornadas rodam; só o envio espera.

⚠️ `DATACORE_URL` usa o papel **`leitura`**, e a pool abre em
`default_transaction_read_only=on`. A sincronização é de mão única e o servidor
é quem garante.

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
