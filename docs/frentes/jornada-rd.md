# Frente `jornada-rd` (n 27)

**Objetivo:** as duas regras da Nutrição do RD que o motor de jornada não
tinha — espera contada só em dias úteis e saída da jornada quando o contato
vira venda. Plano: `docs/superpowers/plans/2026-10-27-jornada-rd.md`.

## Estado (27/10) — ✅ pronta para merge

- **Nó `delay`** (`executor.py`): config aceita `days` (1–365) e `dias_uteis`.
  `somar_dias_uteis(inicio, dias)` (pura) conta seg–sex em
  `America/Sao_Paulo`, mantendo o horário de parede; partir de sábado/domingo
  conta a segunda como 1º dia útil; o resultado nunca cai em fim de semana.
  `instante_de_despertar(cfg, agora)`: `days` manda quando existe (úteis ou
  corridos); sem `days`, `minutes` como sempre. O passo grava no
  `journey_step_log` `days`/`dias_uteis`/`wakeup_at` (ou `minutes`, o antigo).
- **Saída por status** (`executor.status_de_saida` + `rodar_cadeia`):
  `entry_config.saida_status` é lido uma vez por run (o worker não passa o
  `entry_config`); o status do contato é lido a cada nó, ANTES do efeito.
  Na lista (sem caixa) → run `exited`, `context.encerrado_por =
  "saida_status"` + `status`, passo `exited` no `journey_step_log`. Lista
  vazia/ausente = como antes. Não há evento de encerramento em
  `contact_events` no executor (nem para `done`), então não criei um.
- **Rota** (`routers/jornadas.py`): `_normalizar_delays` (400 para `days`
  fora de 1–365, não inteiro ou bool; `dias_uteis` não bool; `dias_uteis`
  sem `days`; sem `days` e `minutes` ≤ 0) e `_normalizar_saida` (lista de
  textos; cada um precisa existir em `lead_statuses`; volta com o nome
  canônico; 400 com a lista do que vale). POST e PATCH.
- **Tela:** `NodeConfigDialog` — com a unidade "Dias", interruptor "Só dias
  úteis" (e teto de 365). `JourneyCreateDialog` — `SaidaStatusCampo`
  (caixas de seleção com os status de `useLeadStatuses`), exportado e usado
  também no diálogo "Entrada do fluxo" do `JourneyBuilder`; o card de entrada
  mostra "Sai quando o status for: …"; o card do delay diz "Esperar 5 dias
  úteis".

## Decisões assumidas

1. **`minutes = days × 1440` gravado junto com `days`.** O trigger
   `validate_journey_graph` (028) exige `config.minutes > 0` em todo delay e
   a frente é sem migration. A rota sempre recalcula `minutes` a partir de
   `days`; o executor ignora `minutes` quando há `days`. Reversível: uma
   migration futura pode afrouxar o trigger.
2. **Dias corridos (`days` sem `dias_uteis`) contam no fuso de SP**, mantendo
   o horário — hoje igual a `minutes` (o Brasil não tem horário de verão).
3. **Saída vale para os dois tipos de entrada** (segmento e evento).
4. **Comparação sem caixa** no executor; a rota grava o nome canônico.
5. **Quem saiu por venda pode ser matriculado de novo** (jornada com
   reentrada e o contato ainda no segmento/evento, depois do cooldown) — e sai
   no primeiro nó, sem efeito. Inofensivo; não mexi na matrícula (é do banco).

## Perguntas abertas (para `perguntas-abertas.md`)

- **Feriados.** A espera em dias úteis não conhece feriado: o e-mail pode sair
  num feriado nacional. Opções: (a) assim, como está; (b) tabela de feriados
  (nacionais + SP) mantida à mão; (c) lib `holidays`. Assumi (a).
- **Horário de envio.** O RD também restringe a janela do dia? Hoje o
  despertar mantém o horário em que o contato chegou ao delay (pode ser 23h).

## Portão

- `tests/test_jornada_rd.py`: 46 testes (RED antes: 38 de 41 falhando; +5
  depois da revisão).
- Suíte inteira no Postgres local `marketinghs-teste-27:5467`: **1169 passed,
  9 skipped** (os 7 `base_real` + 2 da 032).
- `node --test` dos `frontend/scripts/*.test.mjs`: 93 passed.
- `tsc --noEmit -p frontend/tsconfig.app.json`: 0.
- `guarda:visual` em `src/components/admin/automations` e no
  `JourneyBuilder.tsx`: 0 (era 0).
- `eslint` nos 3 arquivos: mesmos erros de antes (`any` herdado) + 2 avisos
  novos de fast-refresh (`lerSaidaStatus`/`comSaidaStatus` exportados de um
  arquivo de componente — mesmo padrão do `ModoTesteCampo`).

## Revisão do diff (subagente revisor)

Nada crítico. Consertado:
- a rota recusava `minutes` decimal — a tela antiga gravava `2,3 × 1440 =
  3311.9999…` e o trigger aceita; uma jornada antiga ficaria sem conseguir
  salvar. Agora aceita número positivo (int ou float), como o trigger;
- a tela deixava `days` fracionado passar (1,5 dia) e a rota recusava: agora
  `step=1` e o salvar trava com aviso;
- passo `exited` falso com lease perdido: confere o `gravar_run` (vira
  `failed`, como o delay);
- `detalhe` do delay e o cálculo usam o mesmo `dias_do_delay`.

Registrado, sem mudança (limitações):
- **A saída só acontece quando o run acorda.** Quem vira Venda durante um
  delay de 14 dias úteis não recebe nada (a checagem é antes do efeito), mas
  o run aparece "aguardando" até o `wakeup_at`. No RD a saída é imediata.
  Encerrar na hora pediria gancho na troca de status (`escrita_contatos.py`,
  `growthhs` webhook) — fora do território.
- `journey_node_metrics` só conta `entered`: as saídas por status entram só
  no contador `exited` da jornada, junto com as da fusão de contatos.
- Status renomeado/apagado em `lead_statuses` faz o salvar do construtor dar
  400 até desmarcar (a tela mostra o sumido e deixa desmarcar).

## Para a coordenadora

- **Telas não conferidas no navegador.** O `conferir-telas.mjs` na 8107 deu
  `login falhou: HTTP 500` (sem backend atrás do Vite da frente). Conferir
  depois do merge: `/automations` → "Novo fluxo" e um fluxo → "Editar"
  entrada e um nó de espera.
- Fora do território: os helpers `lerSaidaStatus`/`comSaidaStatus` caberiam
  melhor em `frontend/src/lib/journeys.ts` (junto de `buildEntryConfig`).
