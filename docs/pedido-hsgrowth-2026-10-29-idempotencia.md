# Pedido ao HSGrowth — idempotência da reunião agendada (29/10/2026)

Para uma sessão aberta em `~/github/hsgrowth-sistema` (`cl hsgrowth-sistema`).

**Não bloqueia nada.** O MarketingHS já não duplica tarefa nem sala quando
a resposta se perde (frente `agendamento-robustez`, M4): a tarefa vai com
`notes` = `Pedido MarketingHS: <id da reserva>` e, no retry, ele procura em
`GET /card-tasks?card_id=&task_type=meeting`; a sala, ele lê em
`GET /card-tasks/{id}` (`daily_room_url` + `teams_event_id` = pronta). Ficam
três pontas que só o GrowthHS fecha:

1. **`convidados_removidos` não fica gravado.** Só vem na resposta do
   `POST /card-tasks/{id}/daily-room`. Se essa resposta se perde, o
   MarketingHS recupera a sala pelo `GET` e não tem como saber se a trava de
   ambiente (`DAILY_DEV_MODE`) cortou o lead do convite — assume 0. Pedido:
   gravar o número na tarefa e devolvê-lo no `CardTaskResponse` (o campo já
   existe no schema, sempre 0 hoje — `services/card_task_service.py`
   `_build_response` não o preenche).

2. **`POST /card-tasks/{id}/daily-room` repetido numa tarefa que já tem sala
   devolve 503 para sempre.** O nome da sala é `<prefixo>-<id da tarefa>`; o
   Daily recusa o nome repetido e `create_room` vira `ValueError` → 503
   (`api/v1/endpoints/card_tasks.py`, `create_daily_room`). Pedido: se a
   tarefa já tem `daily_room_url` e `teams_event_id`, devolver 200 com a sala
   existente (mesmo corpo, `convidados_removidos` gravado) em vez de tentar
   criar.

3. **O link público não vem na tarefa.** O MarketingHS remonta
   `<app_url>/entrar/<public_access_token>` — acoplado à rota do frontend de
   lá. Pedido: devolver `public_link` pronto no `CardTaskResponse` quando
   houver `public_access_token`.

Opcional, mais limpo que a marca em `notes`: aceitar um cabeçalho
`Idempotency-Key` no `POST /card-tasks` (mesma chave → a mesma tarefa, 200),
como o `POST /integration/cards` já faz por `(source, external_id)`.

Testes de lá: tarefa com sala → segundo `POST daily-room` é 200 com a mesma
sala e não chama o Daily nem o Graph; `GET /card-tasks/{id}` traz
`convidados_removidos` e `public_link`. Deploy de homologação e produção é
do Erick.
