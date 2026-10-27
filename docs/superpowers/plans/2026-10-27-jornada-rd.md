# Plano — frente `jornada-rd` (27/10/2026)

> Execução: inline pela própria frente (subagente da coordenadora), TDD.

**Objetivo.** Duas regras da Nutrição do RD que o motor de jornada não tinha:
espera contada só em dias úteis e saída da jornada quando o contato vira venda.

**Arquitetura.** Sem migration: as opções moram na config do nó `delay` e no
`entry_config` da jornada. O worker (`app/worker.py`) não é desta frente e não
passa o `entry_config` ao executor — então o executor lê a lista de saída do
banco, uma vez por run (molde do `contato_permitido`).

## Spec curta

1. **Nó `delay`.** Config aceita `minutes` (como hoje), `days` (inteiro 1–365)
   e `dias_uteis` (bool, só vale com `days`).
   - `days` + `dias_uteis: true` → despertar N dias úteis depois, contados em
     `America/Sao_Paulo`, mantendo o horário do dia. Sábado e domingo não
     contam; o resultado é sempre seg–sex (partida no fim de semana: o 1º dia
     útil é a segunda). Feriados FORA (pergunta aberta).
   - `days` sem `dias_uteis` → N dias corridos.
   - só `minutes` → igual a hoje.
   - Função pura `somar_dias_uteis(inicio, dias)` no executor.
   - ⚠️ O trigger `validate_journey_graph` (028) exige `config.minutes > 0` em
     todo `delay`. Sem migration, a rota grava `minutes = days × 1440` junto
     com `days` (o executor usa `days` quando existe). Jornada salva fora da
     rota com `days` e sem `minutes` o trigger já recusa.
2. **Saída por status.** `entry_config.saida_status`: lista de nomes de
   `lead_statuses`. Antes de executar cada nó, se o status atual do contato
   está na lista (sem caixa), o run vai para `exited` com
   `context.encerrado_por = "saida_status"` e o status; o passo fica no
   `journey_step_log` como `exited` (o executor não escreve evento de
   encerramento em `contact_events` — nada a seguir ali). Lista vazia ou
   ausente = hoje.
3. **Validação na rota** (`POST`/`PATCH /jornadas`): `days` inteiro 1–365 (não
   bool), `dias_uteis` bool, `minutes` > 0 quando não há `days`;
   `saida_status` lista de strings, cada uma um status existente (devolvida
   com o nome canônico) — 400 legível com a lista do que vale.
4. **Tela.** `NodeConfigDialog`: com a unidade "dias", o interruptor "Só dias
   úteis". `JourneyCreateDialog` e `JourneyBuilder`: "Sair da jornada quando
   o status for…" com os status de `useLeadStatuses`. Rótulo do card do
   delay diz "dias úteis".

## Tarefas (TDD)

1. Teste → `somar_dias_uteis` + `instante_de_despertar(cfg, agora)`
   (sexta+1 = segunda; sábado/domingo de partida; 5 e 14 dias úteis; horário
   mantido; corridos; só minutos igual).
2. Teste → nó `delay` grava `wakeup_at` conforme `days`/`dias_uteis`; config
   antiga só `minutes` igual.
3. Teste → `rodar_cadeia` encerra com `exited` quando o status do contato
   está em `saida_status` (contato vira "Venda realizada" no meio da jornada e
   não recebe o próximo e-mail); sem lista, segue.
4. Teste → validação da rota (unidade das funções + rota com `cliente`).
5. Tela: diálogo do nó, criação, construtor. `tsc` 0, guarda sem piorar.
6. Portão: pytest local (5467), `tsc`, guarda, revisão do diff.
