# Frente `agendamento` (28/10/2026)

n 30 · Vite 8110 · backend 8130 · Postgres local 5450 (`marketinghs-teste-30`).
Spec `docs/superpowers/specs/2026-10-28-agendamento-reuniao-design.md`, plano
`docs/superpowers/plans/2026-10-28-agendamento-reuniao.md` — Tasks 1–10 (a 11 é
da coordenadora). GrowthHS só o falso dos testes; Resend só o falso; nada em
produção (a 036 foi aplicada só no Postgres local, duas vezes).

## Estado por task

| Task | Estado | Commit |
|---|---|---|
| 1 Migration 036 | feito | `d7fb384` |
| 2 Cliente do GrowthHS | feito | `e7043ba` |
| 3 Config e regras puras | feito | `3740cbd` |
| 4 Marca na captura | feito | `2d11748` |
| 5 Reserva | feito (+ correção de segurança `ec641ab`) | `c391d47` |
| 6 Rotas públicas | feito | `e9edc7f` |
| 7 Execução, e-mails, varredura | feito | `553d537` |
| 8 Roleta no admin | feito | `1b4b749` |
| 9 Bloco no editor da página | feito | `582e484` |
| 10 Modal na landing | feito | `d11b841` |

Portão (Postgres local): pytest **1327 passed, 0 failed, 9 skipped** (7
`base_real` + 2 da 032 já aplicada); `tsc` 0 erros; `node --test
scripts/landing-*.test.mjs` 62/62; `npm run build:landing` ok; `guarda:visual`
0 em `settings` e `pages`.

## Decisões

- **Task 1:** a reaplicação do arquivo inteiro não roda dentro do pytest — o
  `marketinghs_app` não tem DDL. O teste `test_036_reaplicavel` confere o
  TEXTO (como o da 028) e a prova real foi `psql -v ON_ERROR_STOP=1 -f` duas
  vezes no Postgres local como superusuário (a segunda só com NOTICE de
  "already exists"). As funções são cópia fiel conferida por `difflib`:
  `journey_enroll_event` da **028** (a vigente; o plano dizia "da 027", mas a
  028 a substituiu) e `fn_lead_insert_event` da 027.
- **Task 1:** `tem_handoff` = `nodes @> '[{"type":"handoff_growthhs"}]'` só
  quando `nodes` é lista (nunca NULL, mesmo motivo do `f_pagina`).
- **Task 2:** `GrowthHSFalso` saiu para `tests/growthhs_falso.py` (com as
  constantes `CARDS`, `NOTAS`, `PESSOAS`, `ANTIGO`, `LISTA/BOARD_DE_ENTRADA`)
  e ganhou as rotas novas. `agenda()` divide em lotes de 30 ids; vendedor que
  não vem nem em `vendedores` nem em `erros`, ou com bloco ilegível, é `None`
  (ocupado). `criar_tarefa` usa um helper novo `_corpo_depois_do_2xx` (o
  `criar_card` ficou intocado).
- **Task 3:** `ConfigAgendamento` ganhou `abandono_min` (padrão 30), além do
  contrato. Janela = `janela_dias` dias contando hoje (14 → 28/10…10/11);
  limite 14 (a `/agenda` aceita ≤ 15). Duração 15–240.
- **Task 4:** a marca é `SET LOCAL` posta antes e tirada depois do
  `registrar_captura` (sem `finally`, como a marca da página em `_inserir`).
- **Task 5:**
  - `dados` do rascunho: `{colunas, extras, consentimento, tags, session_id,
    origem: {visitor_id, canal, page_url, gclid}}` — o que a captura precisa
    para registrar o lead depois.
  - Card aberto **com** vendedor: só a agenda dele; a fila não anda. Card
    aberto **sem** vendedor: segue a roleta E a fila anda (é uma vez da
    roleta como outra qualquer) — o plano dizia "card existente: não mexe na
    fila" sem separar os dois casos; fiquei com o mais coerente com a regra.
  - GrowthHS fora na hora de confirmar → `{"status": "indisponivel"}` (o
    plano só previa reservada/ja_tem/ocupado); a rota devolve 200 com esse
    status e o modal chama `/ligar`.
  - Horário fora da grade → `HorarioInvalido` (rota: 422). Token desconhecido
    ou rascunho que já virou lead comum → `TokenDesconhecido` (rota: 404).
  - O GrowthHS ativo ser de outro ambiente que o do rascunho → indisponível.
  - Lead não registrado depois da reserva (erro raro): a reserva vale e a
    execução (Task 7) registra o lead antes de seguir.
- **Correção de segurança (coordenadora, 28/10):** `ja_tem` não leva
  `inicio`/`fim` (o e-mail digitado não é verificado — quem digitasse o
  e-mail de outra pessoa descobriria o horário da reunião dela); a resposta
  de `confirmar` não leva `vendedor_nome`; o log usa o `id` da linha, nunca o
  token. Teste `test_ja_tem_nao_devolve_horario`. O modal mostra "Você já tem
  uma reunião marcada — o convite com dia, hora e link está no seu e-mail."
- **Task 6:** a rota dos horários é **`GET /publico/agendamento/horarios/{token}`**
  (o plano escrevia `/{token}/horarios`): o limite de taxa casa por PREFIXO,
  e só assim o balde próprio (`LIMITE_HORARIOS_POR_MINUTO = 60`) funciona
  sem mexer no middleware. O prefixo entrou nos `isentos` do balde comum.
  `/dados` aceita também `fields` (UTMs/`source`/`ab_*`), `session_id`,
  `referrer`, `gclid`, `fbclid`, `page_url` — os mesmos da captura. Na etapa 1
  só se validam as definições de `nome`/`email`/`whatsapp` da página; na 2,
  todas as outras.
- **Task 7:**
  - A nota não tem coluna própria: `dados.nota_enviada = true` marca o passo
    (sem isso o retry depois da tarefa repetiria a nota).
  - O retry do card procura a assinatura `Pedido MarketingHS: <id da
    reserva>` em TODOS os cards abertos da pessoa (não só os mais novos que a
    reserva, como `_separar` faz) — a assinatura é um uuid, não há falso
    positivo, e o custo é um `ler_card` por card aberto.
  - Tarefa criada com 2xx sem `id` → falha definitiva + alerta (re-tentar
    criaria a segunda tarefa).
  - Status 401/403/404 e erro "de configuração" do GrowthHS são tratados como
    transitórios (re-tenta com espera), sem a "pausa da fila" da entrega.
  - E-mail ao vendedor sem Resend configurado ou com o Resend fora:
    transitório (só o e-mail é repetido). Sem e-mail do vendedor no GrowthHS:
    falha + alerta.
  - O e-mail ao vendedor NÃO passa pelo `ritmo`/`compasso` do worker (volume
    de poucas reuniões por dia).
  - Agendamento de teste (`@exemplo.invalid`) nunca sai por passada sem
    `somente` (worker de produção), nem pela varredura sem
    `somente_paginas` — a mesma lição de `entrega.LEAD_DE_TESTE`.
  - Varredura: todo rascunho tem a etapa 1 (é ela que o cria), então o
    rascunho de > 30 min vira lead comum; `abandonada` só se isso falhar. O
    corte de 30 min é constante (não lê o `abandono_min` da página).
  - Laço próprio no worker, a cada 15 s; varredura no bloco do agendador.
- **Task 8:** as duas rotas são `admin_atual` (como todo `/config/growthhs`;
  o leitor não vê Configurações). PUT com o GrowthHS fora → 502, nada muda.
  O transporte do teste entra por `configuracao.TRANSPORTE_ROLETA`.
- **Task 9:** o bloco mora dentro do próprio `PageConfigEditor.tsx` (o
  território não incluía arquivo novo em `pages/`). Ao ligar, grava
  `antecedencia_min: 120` e `janela_dias: 14` junto; expediente fica no
  padrão do servidor. Sem nenhuma faixa marcada a tela avisa que fica
  desligado.
- **Task 10:** o modal é renderizado dentro do `<main>` (sem portal), para
  herdar `--landing-accent`; as cores usam `var(--landing-accent, #1a71a8)`
  como reserva. Etapa 1 pede nome, e-mail e WhatsApp sempre obrigatórios,
  mesmo se a página os define como opcionais. Calendário começa no domingo.
  Indisponível (GrowthHS fora, sem horário) → chama `/ligar` e mostra "deixe
  que a gente liga".

## Riscos residuais

- **Conjunto de horários com card aberto:** quem digita o e-mail de um lead
  que tem card aberto vê só os horários do vendedor daquele card — a grade
  diferente revela que existe card (não revela quem). Aceito pela
  coordenadora (28/10).
- A sala de vídeo (`daily-room`) não é idempotente do nosso lado: se a
  resposta 2xx se perder, o retry pede outra sala ao GrowthHS. Depende de
  como o GrowthHS trata a segunda chamada na mesma tarefa.

## Fora deste trabalho / para a coordenadora

- **Conferência do modal no navegador:** o `conferir-telas.mjs` só abre os
  painéis da lista `ABRIDORES` — não abre o modal. Conferi a landing de
  teste (botão "Agendar reunião" a 390 e 1440 px, sem estouro, sem erro de
  console) e o editor da página (bloco desligado, contra o banco de
  produção, só leitura). As etapas do modal e o bloco do editor LIGADO ficam
  para a Task 11 (Playwright da sessão).
- A Task 11 inteira (homologação, script de produção, CONTINUAR-AQUI).
- Na Task 11: a página `phoebus` precisa dos campos `funcionarios`
  (obrigatório) e `filiais` e do bloco `agendamento`; e a roleta de
  homologação precisa ser salva na tela nova.

## Perguntas

1. **Confirmação com o GrowthHS fora:** assumi "indisponível → deixe que a
   gente liga" (o lead vira lead comum). Alternativa: deixar o lead tentar de
   novo. Reversível no modal.
2. **Card aberto sem vendedor:** assumi que a roleta anda (o vendedor
   escolhido vai para o fim). Alternativa: não andar a fila nesse caso.
