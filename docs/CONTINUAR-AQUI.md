# Continuar aqui

**Atualizado:** 3 de setembro de 2026
**Branch:** `reconstrucao` — **ainda não pushada**

## Onde paramos

### ⏸ Lote 6 em andamento — parado no meio (03/09/2026)

**Cinco das nove tarefas do lote 6 estão prontas e revisadas.** O trabalho
segue no `HEAD` da `reconstrucao` (`5864cca`), que é commit coerente e verde:
**122 testes passando**.

O que já entrou:

| | |
|---|---|
| **1** | A migration 016 apagou a `execute_readonly_query` — a IA não escreve mais SQL |
| **2** | Cliente da API da Claude, com a chave configurável em Configurações → IA |
| **3** | As seis ferramentas nomeadas, com allowlist e teto |
| **4** | O laço de ferramentas e as cinco rotas do chat |
| **5** | As duas análises, com o formato de saída garantido pela API |

⚠️ **A Task 6 foi interrompida no meio.** O trabalho parcial está em
`git stash@{0}` e **não compila** — `useAgendamentos.tsx` ainda referencia o
toco do Supabase. Ou se retoma com `git stash pop`, ou se descarta o stash e
se redespacha a tarefa do zero.

**O mapa para retomar** está em
`.superpowers/sdd/2026-09-03-marketinghs-lote-6-analytics-e-ia/progress.md`
(fora do git). Ele tem o estado tarefa a tarefa, as decisões que foram tomadas
no caminho, e — importante — **duas correções ao plano da Task 6** que só
aparecem se alguém medir contra o banco. Ler antes de retomar.

Faltam as tarefas **6** (painel: metas, cartões, agendamentos), **7** (telas de
IA), **8** (a tarja dos dez mil) e **9** (o portão).

⚠️ **Nada da IA foi provado de ponta a ponta**, porque não há chave da
Anthropic gravada. O caminho de "não configurado" está testado e responde 400
com mensagem que explica; o resto espera a chave.

---

## Onde paramos

**Lotes 0 a 4 fechados, mais o 5B, o 5C e o 5D.** O lote 5 foi partido em quatro:

| | | |
|---|---|---|
| **5A** | Handoff → GrowthHS | ⏸ **bloqueado** — ver abaixo |
| **5B** | Contatos do DataCore | ✅ concluído (02/09/2026) |
| **5C** | Identidade unificada, Meta CAPI | ✅ concluído (03/09/2026) |
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
| **Configurações** | falta só o `NexusCard` (5A, bloqueado) — o `MetaCard` (5C) já chegou |

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

## O que o 5C entregou

O defeito dos 2.080 fechou por gatilho, não por backfill: a correção age em
toda escrita futura, não repontua o passado de uma vez só. `dndash_lead_id` é o
**contato canônico** de uma identidade, não uma cópia — e que N contatos
apontem para a mesma identidade é decisão já tomada no lote 1C, não algo que o
5C reabriu.

O Meta Conversions API nasce **parametrizado e desligado**: pixel, token e
`test_event_code` têm lugar na tela e no banco, mas sem credencial gravada
nada dispara. A pergunta "a HS faz anúncio no Meta?" continua em aberto — ver
"Antes de continuar, o que depende do Erick".

A tela de **Configurações** agora só espera o `NexusCard` (5A, bloqueado) para
liberar o trabalho de visual — o `MetaCard` do 5C já chegou.

O portão fechou as três functions de identidade e Meta
(`merge-identities`, `meta-config`, `send-to-meta-capi`): pela quarta vez no
projeto, a documentação (tela de Documentação da API + `dnmarketing-api.yaml`)
ainda ensinava uma URL morta a integradores depois de a tela real já ter
migrado. Placar da pasta de especificação: **26 functions portadas** e **6
descartadas** (números que não se somam), restando **22**.

## O que a revisão final do 5C achou

Seis achados. Nenhum vira código agora — todos descrevem comportamento herdado
que o 5C não piorou.

1. **I1** — A FK nova mudou o contrato de `POST /publico/identidade`. O
   `IdentidadeIn` (`backend/app/routers/publico.py:34-42`) não valida
   `source_app`, ao contrário do `EventoIn`, que tem `pattern`. Um integrador
   que omite `source_app` e manda o `local_id` do sistema dele cai no ramo
   `marketinghs` da `resolve_or_create_identity`, que grava esse id em
   `dndash_lead_id` — e agora leva `ForeignKeyViolationError` sem
   `try/except`, virando 500 com mensagem de Postgres. Antes da 015 isso
   gravava lixo em silêncio e a visão 360° vinha vazia, então falhar é melhor
   que o que havia; o que falta é falhar com 400 e mensagem. Conserto natural
   no lote 7: o mesmo `pattern` do `EventoIn`, mais 400 quando o `local_id`
   não resolve.
2. **I3** — A migration 015 promete uma guarda que outro caminho contorna. O
   comentário do gatilho diz que a guarda `dndash_lead_id IS NULL` impede
   roubar o canônico; mas a `resolve_or_create_identity` (migration 007), no
   passo 5, faz `dndash_lead_id = COALESCE(p_local_id, dndash_lead_id)` sem
   guarda nenhuma. Importar um CSV cuja linha case por telefone ou e-mail com
   identidade que já tem canônico troca o canônico em silêncio. Não é
   regressão do 5C — é herdado —, mas as duas implementações discordam sobre
   quem é dono do canônico.
3. **M1** — O gatilho não vê a exclusão pela ficha, que é soft delete
   (`escrita_contatos.py:379` faz `UPDATE leads SET deleted_at`). O gatilho é
   `UPDATE OF dnia_id` e não dispara, então a identidade segue apontando para
   contato excluído — e o `COMMENT ON FUNCTION` diz "apontando para um
   contato **vivo**". Zero casos hoje, conferido. Ampliar para
   `UPDATE OF dnia_id, deleted_at` resolveria, mas muda o significado de
   "canônico" e merece decisão própria.
4. **M2** — `apagar_segredo` documenta uma obrigação que seu único chamador
   ignora. O docstring avisa que apagar do banco não garante que o segredo
   sumiu (o `ler_segredo` cai para `os.environ`) e que quem chama precisa
   saber, "para não dizer ao usuário que removeu". O `gravar_config_meta`
   descarta o booleano e devolve `limpados` incondicionalmente; o card mostra
   "Valor removido". Com `META_ACCESS_TOKEN` no ambiente, a pessoa vê o card
   continuar "configurado" sem explicação.
5. **M4** — Sobrou um buraco na carga do DataCore que o gatilho não fecha. O
   passo 2 termina em `ON CONFLICT (email) DO NOTHING`: quando o e-mail
   colide, nenhuma linha é inserida, o gatilho não dispara, e aquela
   identidade fica sem canônico para sempre — e o backfill da 015 também não
   a alcança, porque o lead que existe está sob outra identidade. Zero casos
   hoje.
6. **M5** — A 015 inverteu a ordem de aquisição de lock dentro de
   `merge_identities` (antes K depois D; agora D depois K, adquirido dentro
   do gatilho). Não é classe nova de deadlock —
   `merge_identities(A,B)` concorrente com `(B,A)` já era simétrico —, mas
   agora o lock é invisível para quem lê o corpo da função.

⚠️ **Uma dependência de ordem que hoje só existe por sorte.** Na sincronização
do DataCore, o passo 1 insere as identidades e o passo 2 insere os leads. É
essa ordem que faz o gatilho funcionar — quando ele roda, a identidade já
existe. Se alguém inverter os dois passos, o gatilho não acha linha nenhuma e
o defeito dos 2.080 volta, calado.

## Migrations aplicadas

| | |
|---|---|
| **010–012** | lote 4 (jornadas) |
| **013** | `ecosystem_identities.datacore_cliente_id` + índice único parcial |
| **014** | lote 5D (imagens de e-mail) |
| **015** | lote 5C — gatilho do contato canônico (defeito dos 2.080) |

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
7. **Decidir se a HS faz anúncio no Meta** — sem isso o CAPI fica configurado e
   desligado, que é um estado válido.
8. ⚠️ **`scripts/aplicar-migrations.sh` não roda de novo.** Ele reaplica desde
   a `001_schema_origem.sql`, que é dump bruto do Supabase sem `IF NOT EXISTS`,
   e morre em `type "app_role" already exists`. O cabeçalho do próprio script
   diz "Idempotente: pode rodar de novo sem estragar o que já existe" — mentira,
   é o `CLAUDE.md` do repo que está certo ao dizer o contrário. A `015` deste
   lote foi aplicada direto por `psql` e conferida rodando duas vezes. Decidir:
   conserta o script, ou conserta o cabeçalho.
9. ⚠️ **`frontend/index.html` ainda manda telemetria do admin interno para
   terceiros da dn.ia**, nas linhas ~228-280, em toda página do admin: o
   tracker do Supabase **da dn.ia**
   (`luinwzmegsdjckjxoimx.supabase.co/functions/v1/tracker`, com o `pid` da
   dn.ia) e o tracker do **Lovable** (`lovableproject.com/api/v1/tracker.js`).
   Não são analytics — o `CLAUDE.md` do repo abre dizendo "o Lovable e o
   Supabase saíram" — saíram do código, não daqui, e isso também desmente ao
   pé da letra a frase do portão de que nenhuma tela fala com o Supabase: o
   `index.html` fala, antes de qualquer tela carregar. Estes dois saem sem
   discussão — não é decisão de marketing, é parar de mandar telemetria da
   casa para um terceiro. Nenhuma tarefa do lote 5C tem escopo sobre esse
   arquivo.
10. **Decidir sobre o Google Analytics (`G-P6GLV8VVNR`) e o GTM
    (`GTM-59T4XHKS`)**, no mesmo `frontend/index.html`. Ao contrário do item
    9, isto É decisão de negócio — alguém na casa pode ler aqueles
    relatórios. Empacotar os quatro rastreadores como um item só (como a
    versão anterior deste documento fazia) prende essa decisão de marketing a
    dois trackers que não têm nada a ver com ela.
11. **Preencher o host de produção do `frontend/public/api/dnmarketing-api.yaml`**
    — o bloco `servers:` hoje é um placeholder explícito
    (`PREENCHER-O-HOST-DE-PRODUCAO`) porque ninguém aqui sabia o host real.
    Até ele ser preenchido, o arquivo público que ensina a API a
    integradores externos aponta para um valor que não resolve — o que é
    melhor que ensinar o host morto do Supabase da dn.ia, mas ainda não é a
    resposta certa.

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
