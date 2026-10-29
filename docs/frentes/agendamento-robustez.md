# Frente `agendamento-robustez` (29/10/2026)

n 33 · Vite 8113 · backend 8133 · Postgres local 5453 (`marketinghs-teste-33`).
Backlog M4–M6 da revisão final da frente `agendamento`, antes dos leads reais
da `phoebus`. GrowthHS e Resend só os falsos dos testes; nada em produção.

## Estado

| Item | Estado | Commit |
|---|---|---|
| M4 Idempotência da tarefa e da sala | feito | `25adc3a` |
| M5 Alerta sem Resend | feito no território; painel fica com a coordenadora | `421af18` |
| M6 Token fora do caminho da URL | feito (rotas antigas ainda aceitas) | `2898ade` |

### M4 — como ficou (`app/agendamento/execucao.py`, `app/crm/growthhs.py`)

- A tarefa leva a marca `Pedido MarketingHS: <id da reserva>` em **`notes`**,
  numa linha própria, depois de "Reunião agendada pelo lead na landing
  (MarketingHS)." ⚠️ Nunca em `description`: lá ela vira a "Pauta" do
  convite que o LEAD recebe (`_montar_corpo_convite`). `notes` só aparece no
  CRM (conferido: a tela pública `public_meeting.py` não a expõe).
- `dados.tarefa_pedida` é gravado ANTES do `POST /card-tasks`. No retry com a
  marca, `Cliente.reunioes_do_card` (`GET /card-tasks?card_id=&task_type=meeting`,
  500 por página, teto de 20 páginas) procura a marca exata
  (`card_do_pedido`: `7` não casa `70`, texto do vendedor não casa). Achou →
  usa; não achou → cria.
- 2xx sem id na tarefa deixou de ser falha + alerta: é transitório, e o retry
  acha pela marca.
- `dados.sala_pedida` é gravado ANTES do `POST /daily-room`. No retry,
  `Cliente.ler_tarefa` (`GET /card-tasks/{id}`):
  - sem `daily_room_url` → a anterior não ficou (lá a rota desfaz a sala se o
    evento do Outlook falha): pede de novo;
  - sala + `teams_event_id` → pronta; o link é `<app_url>/entrar/<token>`, o
    mesmo que a rota devolve;
  - sala sem evento → a anterior ainda está rodando ou caiu no meio:
    transitório ("sala de vídeo criada sem o convite no Outlook (ainda)"), sem
    pedir outra (o Daily recusaria o nome repetido, `<prefixo>-<id>`).
- O falso (`tests/growthhs_falso.py`) agora grava a sala na tarefa, responde
  `GET /card-tasks` e `GET /card-tasks/{id}`, e dá 503 no segundo
  `daily-room` da mesma tarefa, como o GrowthHS de verdade.
- Reserva que já estava no meio no deploy (sem `tarefa_pedida`) segue o
  caminho antigo (cria). Nenhuma migration.

### M5 — como ficou

Caminho que já existe no sistema: o card do GrowthHS em **Configurações**
mostra a fila de entrega (`fila.falhas`, `ultimas_falhas`, "Fila pausada"),
servido por `routers/configuracao.py::_estado_growthhs`. É o lugar natural das
reuniões que falharam, mas o router e o `GrowthHSCard.tsx` não são desta
frente. Do lado de cá:

- Sem `RESEND_API_KEY` (ou sem admin com e-mail): `logger.error` com o texto
  fixo **`ALERTA NÃO ENVIADO`**, o motivo (Resend/admin), reserva, dia/hora,
  página, vendedor e o motivo da falha. `alerta_em` fica vazio.
- Resend falhando para TODOS os admins não grava mais `alerta_em` (antes
  gravava, e o alerta se perdia).
- A varredura reenvia o alerta de reserva `falhou` sem `alerta_em` (até 20
  por passada, reunião até 7 dias atrás) — o admin fica sabendo assim que o
  Resend estiver de pé. `resumo["alertas"]` conta os que saíram.
- `execucao.pendencias()` devolve `{falhas, sem_alerta, ultimas[5]}` (id,
  página, início, vendedor, card, erro, `alerta_em`; nunca o token) — pronto
  para o painel.

**Para a coordenadora (fora do território):** em `_estado_growthhs`, somar
`"agendamentos": await execucao.pendencias()` e, no `GrowthHSCard.tsx`, uma
faixa "N reuniões agendadas não ficaram prontas" com as últimas (mesmo molde
de `fila.ultimas_falhas`). Alternativa considerada e não feita: anotar a
falha no próprio card do GrowthHS — não serve quando o GrowthHS é o que caiu,
nem quando a falha é antes do card.

### M6 — como ficou (`routers/agendamento.py`, `landing/agendamento.ts`)

- Rotas novas, todas POST com `{"token": ...}` no corpo: `/empresa`,
  `/horarios/consultar`, `/confirmar`, `/ligar`. `/horarios/consultar` (não
  `/horarios`) para cair no prefixo `/publico/agendamento/horarios/` do balde
  próprio e da isenção do comum em `main.py` — sem mexer em `main.py`.
- Token desconhecido → 404 "Não encontrado."; sem token → 422.
- O modal (`agendamento.ts`) só usa as novas; teste no Node troca o `fetch` e
  confere que nenhuma URL leva o token.
- **Decisão: as rotas antigas ficam** (`deprecated=True`), só para quem
  abriu a página ANTES do deploy. O bundle da landing sai na imagem da API
  (`Dockerfile.api`), então front e back sobem juntos — mas a aba já aberta
  segue com o JS velho, e o rascunho vive até o `abandono_min` (30 min). As
  antigas não aparecem em nenhuma chamada nova. **Remover no deploy seguinte**
  (1 dia depois basta): os quatro `*_antiga` em `routers/agendamento.py` e
  `test_m6_rotas_antigas_ainda_aceitas`.

## Pedido ao GrowthHS

`docs/pedido-hsgrowth-2026-10-29-idempotencia.md` — não bloqueia. Gravar
`convidados_removidos` na tarefa, `daily-room` repetido devolver a sala
existente em vez de 503, `public_link` na resposta da tarefa; opcional
`Idempotency-Key` no `POST /card-tasks`.

## Riscos residuais

- **Sala recuperada não sabe do convite cortado:** se a resposta do
  `daily-room` se perde e a trava `DAILY_DEV_MODE` de lá cortou o lead, o
  retry acha a sala e marca `criada` (o `convidados_removidos` não é gravado
  lá — item 1 do pedido). Em produção a trava não corta; o risco é de
  homologação.
- Sala com evento faltando para sempre (queda de lá entre a sala e o evento)
  fica em transitório até a hora da reunião; o alerta sai na 2ª falha
  seguida, com o número da tarefa.
- Sem Resend, o alerta da reserva `reservada` (ainda tentando) repete no log
  a cada passada da fila — proposital, é o único rastro.

## Portão (Postgres local, 29/10)

pytest **1366 passed, 0 failed, 9 skipped** (7 `base_real` + 2 da 032; banco
recriado antes da suíte); `tsc --noEmit` 0 (`frontend` e `tsconfig.app.json`);
`node --test scripts/landing-*.test.mjs` 70/70 (depois do `build:landing`);
`npm run build` e `npm run build:landing` ok. Testes novos: 11 em
`test_agendamento_execucao.py` (7 M4, 4 M5), 3 em `test_agendamento_rotas.py`
(M6) e as rotas de lá passaram a usar o token no corpo; 1 no
`landing-agendamento.test.mjs`.
