# MarketingHS — Roadmap da reconstrução

Oito lotes verticais. Cada um leva um domínio de ponta a ponta e **só fecha com
a tela funcionando no navegador** — nunca com "a rota existe".

A spec que justifica esta ordem:
`docs/superpowers/specs/2026-08-31-marketinghs-design.md`

| # | Lote | Functions | Estado |
|---|---|---|---|
| **0** | **Fundação** — repo, schema, auth, usuários, limite de taxa | 6 | ✅ **concluído** (31/08/2026) |
| **1A** | **Entrada** — importar, pontuar, etiquetar | 3 | ✅ **concluído** (31/08/2026) |
| **1B** | **Leitura do admin** — lista e ficha 360° inteira | 0 | ✅ **concluído** (31/08/2026) |
| **1C** | **Escrita** — status, tags em lote, fusão, exclusão | 0 | ✅ **concluído** (31/08/2026) |

| **1D** | **A porta pública** — chave de API, ingestão e leitura externa | 5 | ✅ **concluído** (31/08/2026) |
| **2** | **Segmentos** — construtor de regras, audiência | 1 | ✅ **concluído** (01/09/2026) |
| **3A** | **Campanhas e templates** — CRUD, audiência, acompanhamento (sem envio) | 0 | ✅ **concluído** (01/09/2026) |
| **3B** | **O motor** — filas, worker, Resend, descadastro | 2 | ✅ **concluído** (01/09/2026) — envio real adiado por decisão |
| **3C** | **O retorno** — webhook, agendamento, API pública, config e supressão | 4 | ✅ **concluído** (01/09/2026) |
| 4 | Jornadas — board, gatilhos, condicionais | 2 | a fazer |
| 5 | Integrações HS — GrowthHS, DataCore, identidade, Meta CAPI | 6 | a fazer |
| 6 | Analytics + IA | 4 | a fazer |
| 7 | Captação pública — landing da HS, conversões, A/B | 6 | a fazer |

Seis functions são **descartadas, não portadas**: `send-to-ticketia` e as cinco
de `pingback`. São o sistema de ingresso e o rastreador da dn.ia.

## Placar

Dois números, nunca somados. Foi juntá-los que escondeu telas quebradas no HS.OS.

```
functions portadas          : 18/48
telas migradas              : 27
acesso direto ao banco      : 48 pontos  (eram 51 antes do 3C, 68 antes do 3A, 153 antes do 1B)
```

⚠️ **A spec dizia 68 pontos em 20 arquivos. Estava errado** — a medição usou um
`grep` de linha única, que perde `supabase\n  .from(`. O comando correto está no
`CLAUDE.md`. O número não muda nenhuma decisão da spec, mas muda a expectativa
de quanto trabalho falta: é mais que o dobro.

⚠️ **Coincidência que confunde:** o placar acima voltou a marcar 68 depois do
lote 2. É outro 68 — este é medido pelo comando multilinha, o da spec era a
contagem errada de linha única no início de tudo. Não é sinal de que nada andou:
eram 153.

## O lote 3C entregou — e o lote 3 fechou

O retorno: o que acontece com o e-mail depois de sair volta para dentro.

**O webhook do Resend**, com dez testes. A assinatura Svix é provada
localmente calculando o HMAC com o mesmo segredo — mesmo método que provou o
HMAC do descadastro no 3B. Cobre o dedupe (evento repetido devolve 200, porque
500 faria o Svix reentregar por 10 horas), o avanço monotônico de status
(`delivered` tardio não rebaixa `opened`; `opened` tardio não sobrescreve
`bounced`), a supressão automática só em hard bounce, e a escada de degradação
para evento de campanha excluída.

**O agendador.** `promote_scheduled_campaigns` chamava `invoke_edge_function`,
apagada no lote 0 — defeito latente que só quebraria em produção, no instante em
que uma campanha vencesse. Agora ela só seleciona, e quem dispara é o laço
`asyncio` do worker, reusando o MESMO enfileirador da rota e da API pública.

**A metade pública** de campanhas e templates, que o 3A descobriu faltando —
com isso `campaigns-api` e `templates-api` saíram da pasta. **A configuração do
Resend** pela tela (938 linhas viraram 181) e **a lista de supressão**.

⚠️ **Dois defeitos que o portão pegou, não o plano:**

- o webhook ficava sob o limite de taxa de `/publico` (30/min por IP). Uma
  campanha de mil e-mails gera milhares de eventos, e o Resend levaria 429 e
  re-tentaria por 10 horas. Isento agora — a assinatura Svix é a proteção dele.
- as três rotas de supressão estavam em `usuario_atual`, e este sistema tem
  usuário autenticado sem papel. Ele poderia ler a lista inteira (que diz quem
  marcou a gente como spam) e REMOVER supressões, desfazendo descadastro e hard
  bounce. Todas em `admin_atual`, provado com um token sem papel.

## O lote 3B entregou

O motor. `pgmq` virou `email_send_queue` (tabela comum + `FOR UPDATE SKIP
LOCKED`), `pg_cron` virou laço `asyncio` no worker, `supabase_vault` virou
`integration_secrets`, e o `invoke_edge_function` **não voltou** — o worker
chama a função Python direto.

É o único lote com teste automatizado, e a spec diz por quê. **17 testes**:
seis do motor de fila (reivindicação sob concorrência, visibility timeout, recuo
progressivo, fila-morta, republicação idempotente), onze da parte `text/plain`,
oito da montagem por destinatário.

⚠️ **A função de referência não existia.** `process-email-queue` é citada por
sete arquivos e não está no repositório nem no histórico do git. A lógica por
destinatário foi **derivada de quem a verifica** — e a prova é que o token
gerado pelo nosso worker foi conferido contra o `computeToken` do
`email-unsubscribe/index.ts` rodando de verdade: confere em endereço comum, com
acento e com maiúsculas.

O que foi provado sem enviar um byte: modo degradado (sem `RESEND_API_KEY` o
worker não consome a fila e diz por quê), o pipeline inteiro com o Resend
substituído (3 mensagens, 2 enviadas, 1 suprimida, fila a zero, campanha
fechada pelo `finalize` do banco), e a recuperação de órfãs (fila apagada com as
linhas `pending` de pé → 3 republicadas, nenhuma duplicata).

**A página `/descadastrar` não existia** e o link assinado ia para um 404 — o
portão pegou. Foi criada, pública, e conferida no navegador: valida, descadastra
ao confirmar, e um token adulterado mostra "Link inválido" sem jogar o visitante
no login.

**O primeiro envio real foi ADIADO, por decisão do Erick** (01/09/2026): o
sistema ainda não tem usuário, e configurar domínio e chave agora não paga o
trabalho. Não é pendência do lote — é uma decisão consciente de quando ligar.

Quando for a hora: `bash ~/marketinghs-configurar-resend.sh`, subir o worker
(`python -m app.worker`) e mandar uma campanha para um contato de teste.

⚠️ Enquanto a chave não existir, o worker **não consome a fila** — de propósito.
Campanha enfileirada fica esperando, e nada é perdido.

## O lote 3A entregou

Campanhas e templates de ponta a ponta pela tela — **sem enviar nada**. CRUD dos
dois, audiência, acompanhamento com a tabela de envios, e a trava que impede
editar campanha que já saiu.

O lote 3 foi partido em **3A / 3B / 3C**, pelo mesmo motivo que partiu o lote 1.
A decisão da spec de que o motor nasce sendo usado (§6) não se reabre: o que
mudou foi o tamanho do plano. **O lote 3 continua aberto** — o "pronto" da spec
("uma campanha de teste sai de verdade e a abertura aparece na timeline") é a
soma de 3B e 3C.

**A correção que mais importa: `campaigns.stats` é congelada.** Ela só é escrita
uma vez, quando a fila drena, antes de qualquer abertura ou clique — servir a
coluna mostraria ~0% de abertura para sempre. O frontend já sabia e contornava
com `execute_readonly_query`: SQL por concatenação numa função SECURITY DEFINER
que aceita consulta arbitrária do navegador. A agregação veio para o servidor,
com os MESMOS filtros de `finalize_campaign_if_drained` (provado comparando as
duas depois de um finalize). Resta um chamador daquela RPC: `usePages`.

Duas viagens a menos: `getCampaignStats` fazia dez consultas de contagem, uma
por status; `getCampaignSends` buscava os envios e depois os leads em lotes de
200.

⚠️ **Nenhuma function saiu da pasta**, e o portão é que pegou isso: tanto
`campaigns-api` quanto `templates-api` aceitam chave de API — servem integrador
externo, e o 3A portou só a metade do admin. A `campaigns-api` ainda carrega o
`?action=send`. **A metade pública das duas é tarefa do 3B.**

## O lote 2 entregou

Segmentos de ponta a ponta: criar, editar, duplicar, excluir, listar contatos,
prévia de regras ainda não salvas e audiência de vários segmentos com exclusão.
A tela de Segmentos, o construtor de regras e a API pública saíram do acesso
direto ao banco — 19 pontos, o maior bloco isolado que restava.

**A lógica de regra continua no Postgres.** As oito funções de segmento
sobreviveram ao port do schema, estão em produção há meses e os endpoints só as
expõem. Prévia, audiência e envio de campanha chamam as MESMAS funções — é o que
faz o número mostrado no construtor ser o número que a campanha envia.

Quatro defeitos herdados morreram no caminho:

- **A contagem era N+1.** Dez segmentos eram onze idas ao banco; agora é uma
  consulta, com `LEFT JOIN LATERAL` resolvendo estático e dinâmico juntos.
- **Criar e editar não eram transacionais.** Os membros iam em lotes de 100
  depois do segmento, e editar apagava todos antes de reinserir — falhar no meio
  deixava um segmento pela metade ou vazio para sempre. Provado com uma falha
  forçada: a edição que estourou deixou nome e membros intactos.
- **Contato na lixeira continuava no segmento**, porque o vínculo em
  `segment_contacts` sobrevive à exclusão lógica — e entraria numa campanha.
- **Segmento dinâmico buscava contatos em RPC + N lotes de 200.** Virou um JOIN.

A ação "adicionar a segmento" da barra de ações em massa, desativada desde o
lote 1C esperando o endpoint, **voltou a funcionar**.

⚠️ O portão pegou duas chamadas mortas que nenhuma tela fazia: a **Documentação
da API** e a **especificação OpenAPI pública** ainda ensinavam `/segments-api`
aos integradores. As duas foram atualizadas.

## O lote 1D entregou

O segundo modelo de autenticação — chave de API com hash, escopo e expiração —
que **destrava as 23 functions restantes que dependiam dele**, metade do port
que falta.

A chave passou a ser gerada no servidor com `secrets`: a tela gerava no
navegador com `Math.random()`, previsível a partir de algumas saídas.

`lead-capture` e `validate-email-domain` foram para o **lote 7**, com a landing
page que os chama — hoje não têm chamador nenhum.

## O lote 1C entregou

Status individual e em lote, tags em lote, edição, exclusão lógica e **a fusão
de contatos dentro de uma transação**. Antes ela fundia dois leads em sete
operações independentes a partir do navegador, sem rollback: falhar no meio
deixava tags e segmentos já migrados, o descartado ainda existindo, e os dois
apontando para os mesmos dados.

Apagada a cadeia morta do Dashboard — 1.185 linhas que ninguém alcançava e que
carregavam 17 pontos de acesso direto.

A migration 005 resolveu duas incoerências herdadas: o funil agora tem uma
fonte de verdade só (`lead_statuses`, com FK), e o `source_app` dos eventos
passou de `dnmarketing` para `marketinghs`.

## O lote 1B entregou

A tela de Contatos lista, e a ficha 360° abre com timeline, notas e tags — tudo
contra a API própria. A API pública (`contacts-list`, `contact-details`) virou o
lote 1E: serve chamador externo, e a HS não tem nenhum hoje.

**O scoring do cliente foi arrancado.** Existiam duas implementações — o trigger
do banco e 75 linhas de TypeScript refazendo a conta no navegador — e a segunda
gravava `lead_score` e `etiqueta` direto, colunas que o trigger não vigia. O
valor do navegador vencia o do banco. Agora quem pontua é o banco, e a ficha
mostra o número dele.

## O lote 1A entregou

O scoring passou a existir: `scoring_config` veio vazia no dump e nada era
pontuado. A régua agora é da HS, mora numa linha de tabela e trocá-la é um
`UPDATE`. Sai o `classify_lead_etiqueta`, que já chegou desabilitado mas
continuava no schema com o ICP da dn.ia dentro.

Importação de CSV pela tela, com deduplicação por e-mail, fusão de linhas
duplicadas no mesmo arquivo, aplicação de tag em lote e recálculo de scores.

## O lote 0 entregou

Login com usuário do nosso Postgres, sidebar abrindo, e a tela de usuários
operando contra a API própria. Zero Supabase no caminho da autenticação.

O que existe: repositório em `backend/` + `frontend/` + `worker/`; schema de 36
tabelas, 65 políticas de RLS e 47 funções no Postgres do EasyPanel; auth com
bcrypt e JWT; as 6 rotas de administração de usuário; limite de taxa na borda
pública; e o toco do Supabase com o `LimiteDeErro`, que juntos transformam
quebra silenciosa em erro visível sem derrubar a casca do admin.

## Pendências que atravessam lotes

- [ ] **Trocar a senha do superusuário do Postgres.** Hoje é igual ao nome de
  usuário, numa porta exposta. Rodar assim durante a construção foi decisão do
  Erick, com o risco explicado. **Obrigatório antes do lote 5**, que traz os
  2.077 clientes do DataCore para dentro. A troca é pela interface do EasyPanel,
  não por `ALTER USER`.
- [ ] Preencher `POSTGRES_HOST_INTERNO` em `~/marketinghs.env` — necessário no deploy.
- [x] ~~Cadastrar `[marketinghs]` no cadastro de bancos~~ — feito; o apelido
  `marketinghs` responde a `bancos.consultar`.
- [ ] `JWT_SECRET` de produção precisa ser gerado, não o texto do exemplo.
- [ ] Identidade visual: o `index.html`, os logos e o tema ainda são da dn.ia.
- [ ] Régua de scoring da HS (`scoring_config`) — decisão de produto, melhor
  tomada com a base real na tela. **O funil já virou dado**: `lead_statuses` é
  a fonte de verdade e trocar os status é um INSERT, não uma migration.
- [ ] **Quais status avançam o estágio da identidade.** O original avançava
  para `opportunity` ao qualificar; a régua da HS não existe, e avançar por
  engano é pior que não avançar.
- [ ] **O `WEBHOOK_SECRET` não tem escopo nem expiração.** É um segredo global
  que vale tudo, herdado da origem. Vale decidir se continua.
- [ ] **A especificação OpenAPI pública** (`public/api/dnmarketing-api.yaml`)
  descreve os endpoints antigos. Atualizar ou apagar. **Segmentos já foi** (lote
  2); o resto continua com as URLs das Edge Functions — inclusive campanhas e
  templates, de propósito: a API pública dos dois ainda não foi portada.
- [ ] **A tela de chaves não foi conferida no navegador.** O código está portado,
  tipado e compilando, e os endpoints foram verificados por HTTP ponta a ponta —
  mas um overlay de outra aba impediu o clique, e o portão exige o clique.
- [ ] **Quem limpa os contatos com `deleted_at` antigo.** A exclusão é lógica e
  nada os remove de vez; a lixeira cresce para sempre.
- [ ] **Teto de 10.000 leads na memória do navegador.** O `AdminDataProvider`
  carrega a base inteira e filtra no cliente. Portado fiel de propósito no 1B;
  quando a base da HS se aproximar disso, mover o filtro para o servidor deixa
  de ser opcional — e vai cascatear em toda tela que usa `useAdminData`.
- [ ] **O detalhamento de score na ficha ainda é calculado no cliente.** Ele não
  grava mais nada, e o número exibido é o do banco, mas a lista de "quais
  critérios bateram" repete em TypeScript a conta do PL/pgSQL e pode divergir.
  O certo é vir do servidor.

## Decisões de produto que ainda faltam

- A HS faz anúncio no Meta? Decide se o CAPI fica ou sai (lote 5).
- Microsoft Clarity: projeto próprio ou remover.
- A HS pode mandar campanha promocional para a base do ERP? Decisão do Erick e
  do Nicholson, não do sistema (ver §8-B da spec).
