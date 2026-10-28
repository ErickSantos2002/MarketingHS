# Agendamento de reunião na landing — design

28/10/2026 · conversa com o Erick (sessão da coordenadora) · referência visual:
o agendamento de `dnia.ai` (modal em etapas: dados → … → calendário com horários).

## Intenção

Hoje a landing do Phoebus capta o lead e o GrowthHS sorteia um vendedor, que
depois liga para marcar a conversa. O lead quente quer marcar **na hora**. O
agendamento deixa o próprio lead escolher dia e horário de uma **sala de vídeo
do GrowthHS** com um vendedor que esteja livre de verdade, e o card já nasce
em **Reunião Agendada** com o vendedor, a reunião e o convite prontos.

Sucesso: um lead entra na landing, escolhe um horário, e sem ninguém tocar em
nada o vendedor tem o compromisso no Outlook, o card no GrowthHS com nota e
reunião, e um e-mail avisando; o lead tem o convite com o link da sala.

## Decidido com o Erick

1. **Disponibilidade sai da agenda real** — ninguém cadastra horário livre.
   Os vendedores registram compromisso no Teams/Outlook e pelo próprio
   GrowthHS, e **toda reunião criada no GrowthHS já vira evento no Outlook do
   vendedor** (`card_tasks.py:_agendar_evento_daily_no_outlook`). O Outlook é a
   fonte única de livre/ocupado.
2. **Um horário aparece para o lead se pelo menos um vendedor da roleta está
   livre** nele.
3. **Roleta de reunião própria, no MarketingHS.** A roleta do GrowthHS
   (automação de vendedor) continua valendo para o lead comum; para
   agendamento quem decide o vendedor é o MarketingHS, e o card nasce com ele.
4. **O card nasce direto na lista 28 (Reunião Agendada) com `assigned_to_id`.**
   Provado em homologação em 28/10: card 11244, board 7, lista 28, vendedor 19
   (Erick Santos); nenhuma automação mexeu nele depois. Por nascer na 28 (e não
   *chegar* nela), o webhook de volta `meeting_scheduled` **não dispara** — o
   MarketingHS registra o status sozinho, porque foi ele que criou.
5. **A reunião é a sala de vídeo do GrowthHS (Daily)**, não Teams.
6. **Tudo que é Microsoft fica no GrowthHS.** Ele já tem o aplicativo no Azure,
   cria as salas e monta o convite. O MarketingHS só fala com o GrowthHS. O
   Erick administra o Microsoft 365/Azure e libera a permissão.
7. **O vendedor recebe e-mail** com a reunião (só ele — nem gestor, nem SDR).
   O Outlook não avisa o organizador do evento que foi criado na agenda dele,
   então o MarketingHS manda.
8. **Entrega em etapas, cada uma testada na homologação** do GrowthHS antes da
   próxima.

## Regra da roleta de reunião

Fila ordenada de vendedores (ids do GrowthHS), configurada no MarketingHS.
No horário escolhido, a reunião vai para **o primeiro da fila que está livre**;
ele vai para o fim da fila. **Quem foi pulado por estar ocupado guarda a
vez** (continua na frente). *Decisão minha, proposta ao Erick sem objeção;
reversível.*

Exemplo: fila A→B→C→D→E; ao meio-dia A, B e C ocupados → vai para D; fila
vira A→B→C→E→D.

## Corrida

Dois leads confirmando o mesmo horário ao mesmo tempo não podem cair no mesmo
vendedor. Na confirmação, numa transação só no banco do MarketingHS:

1. trava a roleta (`SELECT … FOR UPDATE` na linha da fila);
2. pergunta de novo ao GrowthHS o livre/ocupado **daquele horário** (a agenda
   pode ter mudado desde que a tela abriu);
3. desconta as reservas do próprio MarketingHS que ainda não viraram evento
   no Outlook;
4. escolhe o vendedor pela regra, grava a reserva e anda a fila.

Índice único parcial em `(vendedor, início)` das reservas não canceladas é a
garantia no banco (no espírito dos três índices de envio). Se nenhum vendedor
está livre no momento da confirmação, o lead volta à escolha de horário com
"esse horário acabou de ser ocupado".

Clique duplo/re-envio da mesma confirmação devolve a mesma reserva (chave de
idempotência por contato + início).

## O fluxo, de ponta a ponta

**Formulário normal** (o de hoje) ganha o campo obrigatório **"Quantos
funcionários a empresa tem?"**. Quem marca mais de 400 vê, no obrigado, um
"Quer adiantar? Agende sua reunião agora" que abre o modal já na etapa 3
(*decisão minha*).

**Botão "Agendar reunião"** (modal em etapas, como a referência):
1. **Seus dados** — nome, e-mail corporativo, WhatsApp. O contato já é
   gravado aqui (lead que desiste no meio não se perde: vira lead comum em
   30 min).
2. **Sua empresa** — empresa, cargo, nº de funcionários (obrigatório), nº de
   filiais (opcional), e os campos extras da landing (no Phoebus, testes por
   dia).
3. **Horário** — **só com mais de 400 funcionários.** Calendário com os dias
   que têm vaga; ao escolher o dia, os horários. Fuso de Brasília, explícito.
   **Até 400:** o modal agradece ("nossa equipe vai entrar em contato") e o
   lead vira lead comum na hora. Sem horário nos 14 dias, ou GrowthHS fora do
   ar: "deixe que a gente liga" e o lead vira lead comum.
4. **Confirmado** — dia, hora, "o convite com o link da sala chegou no seu
   e-mail".

Faixas (*decisão minha*; o corte de 400 precisa cair entre duas faixas):
- funcionários: Até 100 · 101 a 400 · 401 a 1.000 · Mais de 1.000
- filiais: Só a matriz · 2 a 5 · 6 a 20 · Mais de 20

O corte (400) e as faixas ficam na configuração da landing, não no código.

**Lead com card aberto no GrowthHS** (procurado pelo e-mail exato, como a
entrega faz hoje, já ao abrir a etapa 3): a etapa 3 mostra só os horários do
vendedor desse card; a roleta não anda; o passo 1 abaixo vira "usar o card
existente" (nota + reunião nele). Card aberto **sem vendedor**: segue a
roleta de reunião e o card ganha o vendedor escolhido (*decisão minha*). O
card existente **não muda de lista** no v1 (a entrega de hoje não move card,
ver `MOTIVO_MOVER` em `entrega.py`); a nota diz "reunião agendada pelo lead"
e o vendedor move.

**No servidor, ao confirmar** (depois da reserva):
1. `POST /api/v1/cards` — lista 28, `assigned_to_id` = vendedor escolhido,
   `person_id`, origem/UTMs como no handoff de hoje.
2. `POST /api/v1/card-notes` — a nota de abertura que já existe
   (`nota_de_abertura`), mais data e hora da reunião.
3. `POST /api/v1/card-tasks` — `task_type=meeting`, `meeting_kind` conforme a
   landing (Phoebus: `apresentacao_phoebus`), `assigned_to_id`, `due_date`,
   `duration_minutes`, `invited_emails=[e-mail do lead]`.
4. `POST /api/v1/card-tasks/{id}/daily-room` — sala + link público + evento no
   Outlook **do vendedor**, com o lead convidado (precisa da mudança no
   GrowthHS, abaixo).
5. E-mail ao vendedor pelo Resend: data/hora, nome, empresa, cargo, e-mail,
   WhatsApp, respostas do formulário, landing/campanha de origem, botão "Abrir
   no GrowthHS".

Passos 1–4 são uma sequência com estado gravado a cada passo (como a fila de
entrega faz hoje): falha no meio é retomada do passo seguinte, nunca refaz o
card. O lead vê "confirmado" quando a reserva está gravada; os passos 1–5
rodam na fila. *Decisão minha: o lead não espera 4 chamadas HTTP; a reserva
já garante o vendedor e o horário.*

## Respondido pelo Erick depois da revisão (28/10)

1. **Lead que já tem card aberto no GrowthHS:** a reunião é marcada **no card
   existente, com o vendedor dele** — a roleta de reunião não entra, e o lead
   só vê os horários desse vendedor. Nada de segundo card.
2. **Só agenda quem tem mais de 400 funcionários** (pedido do Nicholson). Até
   400, o lead vira lead comum. Agendar pede mais informação que o lead comum.
3. **Dois caminhos separados na landing:** o formulário normal continua para
   quem só quer deixar o contato; o agendamento é um botão próprio, com mais
   etapas.
4. **Lead que desiste no meio do agendamento:** seguir a recomendação — vira
   lead comum se não confirmar horário em **30 min** (fluxo normal: jornada,
   roleta do GrowthHS). Quem confirma **não** passa pela jornada "lead para o
   comercial" (senão nasceriam dois cards).
5. **Filiais:** o Nicholson quer saber quantas, opcional.

## O que muda no GrowthHS (outra sessão — spec entregue, não editado daqui)

**A. Livre/ocupado para integração.** Rota nova, autenticada por
client-credentials (o mesmo cliente `integracao2`): recebe ids de usuários do
GrowthHS e um período, devolve os blocos ocupados de cada um. Por dentro é o
mesmo `getSchedule` da tela do SDR (`microsoft_graph_service.get_schedule`),
mas com **token de aplicativo** (client credentials da Microsoft, permissão de
aplicativo) em vez do token delegado do usuário logado — o `integracao2` não
tem conta Microsoft. O GrowthHS resolve id → e-mail corporativo.

**B. Sala de vídeo criada por integração.** Hoje `POST /{task_id}/daily-room`
manda o convite pelo Outlook *de quem chama* e, sem conta Microsoft, desfaz a
sala e devolve 400. Para chamador `is_integracao`, o evento é criado **na
agenda do vendedor da tarefa** (`/users/{email}/events`, organizador = o
vendedor) com token de aplicativo, convidando o lead. O resto (sala, link
público, `teams_event_id`) igual.

**C. Vendedores para integração.** Rota de leitura que lista os usuários
vendedores (id, nome, e-mail corporativo, ativo), para a tela da roleta e o
e-mail ao vendedor. O MarketingHS não cadastra vendedor à mão.

**Contrato final, como o GrowthHS implementou (28/10)** — spec de lá:
`hsgrowth-sistema/docs/superpowers/specs/2026-10-28-agendamento-integracao.md`.

- Autenticação das três: o mesmo JWT do `client-credentials` do
  `integracao2`; exige `is_integracao` (humano → 403). Sem chave nem escopo
  novo.
- **A.** `GET /api/v1/integration/agenda?user_ids=19,3&inicio=…Z&fim=…Z` →
  `{"vendedores":[{"user_id","email","ocupado":[{"inicio","fim","status"}]}],
  "erros":[{"user_id","motivo"}]}`. 422 para data sem fuso, `fim<=inicio`,
  período > 15 dias, `user_ids` vazio/inválido/> 30. 503 se o token de
  aplicativo da Microsoft falhar (resposta inteira). Uma chamada
  `getSchedule` por vendedor; vendedor fora do grupo vem em `erros`
  ("Access is denied.").
- **B.** `POST /api/v1/card-tasks/{id}/daily-room` — mesma resposta de hoje
  (`room_url`, `public_link`, `public_access_token`, `convidados_removidos`).
  422 antes de criar a sala se a tarefa não tem vendedor com e-mail. Falha no
  Graph → sala desfeita e 503 (re-tentável). `end` = `due_date +
  duration_minutes` (60 se nulo); convite assinado pelo vendedor.
  ⚠️ `DAILY_DEV_MODE` ligado corta convidado de fora do domínio (o lead) e
  devolve `convidados_removidos: 1` — **a fila deve tratar
  `convidados_removidos > 0` como falha a alertar**, senão o lead fica sem
  convite em silêncio. Remarcar/cancelar pela integração não existe (PATCH
  de `due_date` não atualiza o Outlook).
- **C.** `GET /api/v1/integration/vendedores` → `[{"id","nome","email",
  "ativo"}]`, papel `salesperson`, ativos e inativos (filtrar `ativo` aqui),
  por nome.

**Azure (Erick, uma vez):** no aplicativo que o GrowthHS já usa
(`MS_CLIENT_ID`), adicionar permissão **de aplicativo** de calendário
(leitura de disponibilidade e escrita de evento — a permissão exata se
confirma na doc da Microsoft na implementação) e dar consentimento de
administrador. **Restringir às caixas dos vendedores** com política de acesso
de aplicativo do Exchange (grupo de e-mail com os vendedores da roleta) —
sem isso a permissão de aplicativo vale para o tenant inteiro.

## No MarketingHS

- Configuração da roleta de reunião (admin): quais vendedores, em que ordem,
  ambiente do GrowthHS (homologação/produção, como o resto da integração).
- Configuração do agendamento por landing: ligado/desligado, duração, tipo da
  reunião (`meeting_kind`), expediente.
- Rotas públicas da landing: horários disponíveis (período) e confirmar.
- Tabelas novas: fila da roleta, reservas. Migration nova, reaplicável.
- O passo-a-passo de criação no GrowthHS (fila) e o e-mail ao vendedor.

## Decisões minhas depois da revisão de construtor

- **Roleta:** uma fila global **por ambiente** do GrowthHS (os ids de
  vendedor de homologação e produção são outros). Reservas também carregam o
  ambiente, como `crm_handoffs`.
- **Nome e e-mail do vendedor:** vêm do GrowthHS, nunca cadastrados à mão —
  item **C** na spec de lá: rota de integração que lista os usuários
  vendedores (id, nome, e-mail corporativo, ativo).
- **Reserva cuja criação falhou de vez** (ex.: o B devolve 400): a reserva
  **continua bloqueando** o vendedor (o lead já leu "confirmado"), a fila
  re-tenta como a entrega de hoje, e falha definitiva manda e-mail de alerta
  ao admin do MarketingHS com o lead, o horário e o vendedor. Não troca de
  vendedor sozinha.
- **Abuso nas rotas públicas:** no máximo **uma reserva futura por e-mail**
  (confirmar de novo devolve a existente: "você já tem reunião dia X às Y");
  mesma trava de ritmo por IP e o mesmo honeypot do formulário da landing.
  Chave de idempotência = e-mail + ambiente.
- **`getSchedule`:** `busy`, `tentative`, `oof` e `workingElsewhere` contam
  como ocupado; só `free` é livre.
- **Fuso:** tudo trafega em UTC explícito; a duração vai explícita ao Graph
  (o `create_calendar_event` de lá assume 1 h quando falta `end_dt`).

## Padrões (decisão minha, todos configuráveis)

- Expediente: seg–sex, 8h às 18h, Brasília. Feriado não é tratado à parte
  (vendedor bloqueia no Outlook).
- Duração: 60 min (a da referência).
- Antecedência mínima: 2 h; janela: próximos 14 dias.
- Grade: horários cheios e meias (início a cada 30 min) que caibam inteiros
  no expediente e no livre de alguém.

## Fora deste trabalho

- Lead remarcar ou cancelar pela página (no v1 ele responde o convite; o
  vendedor ajusta no GrowthHS).
- Teams como opção.
- Aviso a gestor ou SDR.
- Sincronizar recusa do convite pelo lead de volta ao MarketingHS.

## Anti-objetivos

- Oferecer horário em que ninguém está livre, ou dar dois leads ao mesmo
  vendedor no mesmo horário.
- Card sem vendedor, ou card duplicado por re-tentativa.
- Card criado sem a reunião e sem o convite chegando ao lead.
- O MarketingHS ganhar uma segunda integração Microsoft.

## Ordem de entrega (cada etapa testada na homologação)

1. **GrowthHS A + Azure** — rota de livre/ocupado; teste: pedir a agenda dos
   vendedores de homologação e conferir com o Outlook.
2. **GrowthHS B** — sala por integração; teste: criar card + reunião pela API
   (como o card 11244) e ver o convite chegar a um e-mail de teste.
3. **MarketingHS — backend**: roleta, reservas, rotas públicas, fila de
   criação, e-mail ao vendedor; teste ponta a ponta na homologação pela API.
4. **MarketingHS — tela** do agendamento na landing e configuração no admin;
   teste no navegador, celular incluído.

## Deixado ao construtor

Nomes de tabela e rota, formato exato das respostas, como a tela mostra
"carregando horários", textos de erro.
