# Continuar aqui

**Atualizado:** 1º de setembro de 2026
**Branch:** `reconstrucao` — **ainda não pushada**

## Onde paramos

**Lote 4 (Jornadas) na metade: tarefas 1, 2 e 3 de 5.** Lotes 0 a 3 fechados.

### O que já roda

Um fluxo completo funciona de ponta a ponta, provado: contato entra pelo
segmento → `delay` → condicional dá verdadeiro → e-mail enfileirado com
`journey_run_id` e campanha nula → o worker do 3B aceita → sai "Bem-vindo Carla
Menezes" com o corpo do template.

- **migration 010** — fila de eventos, o trigger que a alimenta, e
  `journey_enqueue_email`
- **`/jornadas`** — CRUD, detalhe com métricas do banco, execuções
- **`app/jornadas/executor.py`** — sete tipos de nó, o fencing token, a espera
  escopada por nó
- **o laço de jornadas no worker** — matrícula, fila de eventos, runs vencidos

### O que falta

**Tarefa 4 — as telas.** `useJourneys` (5 invokes), `useJourneyRuns` (1 ponto),
`JourneyBuilder` (711 linhas, 1 invoke), `NodeConfigDialog` (1+1),
`useAutomationRules` (5 pontos), `AutomationRuleForm` (1+1). O cliente vai em
`frontend/src/lib/jornadas.ts`, no molde de `lib/segmentos.ts`.

⚠️ **Uma decisão a tomar na tarefa 4:** `evaluate_automation_on_etiqueta` e o
trigger `trg_automation_on_etiqueta_change` foram removidos no lote 0. Se a tela
de automações permite criar regra que dependa deles, **ou** a função volta como
trigger, **ou** a tela diz que aquele gatilho não está ligado. Não deixe a tela
oferecer o que não roda.

⚠️ `JourneyBuilder` tem 711 linhas e é o editor visual do grafo — **não o
reescreva**, troque só os pontos de acesso.

**Tarefa 5 — fechar:** portão (documentação incluída), placar, e os documentos.

### O que o lote 4 já ensinou

- **`journey_claim_due_runs` já é o motor de reivindicação.** A jornada não
  precisa de fila para os runs — só para os eventos. Dez funções de jornada
  sobreviveram ao port e não se reimplementam.
- **O `JOIN` com `campaigns` no worker do 3B era `JOIN`, não `LEFT JOIN`.**
  E-mail de jornada não tem campanha: a linha não voltava, o envio era
  concluído como se tivesse saído, e o fluxo pareceria funcionar enquanto
  ninguém recebia. Estava mapeado no plano e era real.
- **Tag de valor nulo faz o Resend recusar o envio inteiro**, não só a tag.
  Esse não estava no plano — apareceu porque o ensaio quebrou ao imprimir.

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
