# Frente `proteger-envio` (R1 do `docs/raio-x-rd.md`)

Território: `backend/**` (worker, fila, envio, campanhas, captura) e, no front,
só o detalhe/lista de campanha para o botão de pausar
(`pages/admin/CampaignDetail.tsx`, `Campaigns.tsx` e o hook delas).
**Não tocar** `frontend/src/landing/`, `email/montagem.py`, `routers/publico.py`,
`routers/contatos.py`, `lib/journeys.ts` — são da `consertos-urgentes` até ela
fechar. Migration: pode, se for indispensável (numerar a partir de 026,
idempotente, NÃO aplicar; montar `~/marketinghs-migration-0NN.sh` no molde do
`~/marketinghs-migration-025.sh`).

## Backlog (em ordem)

- [x] **Controle de volume no worker.** Envios por segundo (padrão alinhado ao
  limite do Resend, 2/s), teto por hora e por dia, e rampa de aquecimento do
  domínio novo (ex.: dia 1 = 50, dobra por dia até o teto). Configurável
  (`Settings` ou `integration_secrets`/config no banco — preferir config no
  banco editável depois; padrão seguro no código). 429 do Resend respeita
  `retry-after` e não conta como tentativa perdida. Teste sem banco do laço de
  ritmo. **O que excede o teto do dia fica na fila para o dia seguinte**, nunca
  vira `failed`.
- [x] **Pausar / retomar / parar campanha.** O estado `paused` existe e nenhuma
  rota leva a ele. Pausar: o worker deixa de reivindicar mensagens dela;
  retomar: volta a enviar; parar: cancela o que falta (status final claro,
  pendentes viram `cancelled`/`suppressed` — escolher o que as estatísticas já
  entendem). Botão na tela de detalhe, com confirmação. Teste.
- [x] **Captura não destrutiva.** `captura.py:215` (`_atualizar`) sobrescreve
  nome, cargo, empresa, whatsapp e UTMs de contato existente a partir de
  formulário anônimo. Passar a só preencher o que está vazio (COALESCE), como
  `/publico/identidade`. UTMs da reconversão continuam em `lead_conversions`.
- [x] **Primeiro toque congelado.** A origem da primeira conversão não pode ser
  apagada pela última. Se der sem migration (derivar de `lead_conversions`),
  melhor; senão, colunas `first_*` na 026.
- [x] **Honeypot (lado servidor).** A captura aceita um campo-isca opcional
  (ex.: `website`); se vier preenchido, responde `ok` e não grava nada. O
  campo no formulário da landing fica para depois que a `consertos-urgentes`
  fechar (anotar no Estado).
- [ ] Portão: pytest inteiro uma vez no fim, sozinho (~33 min; banco é
  PRODUÇÃO — só apagar o que o teste criou, por id; `count(*) FROM leads`
  igual antes e depois); `tsc` 0, guarda 0, `vite build` se tocar front.

## Estado

**02/10 — backlog inteiro feito, sem migration.** Commits na branch
`worktree-agent-a88c027e2b7e0f11c`:

1. **Controle de volume** (`app/ritmo.py`, `worker._tick`, `fila.adiar`,
   `fila.ha_pronta`, `resend.LimiteDoResend`). Cota por passada = menor de
   lote, teto da hora (janela móvel), teto do dia (dia civil de Brasília) com
   a rampa, e o que cabe em metade da visibilidade. O teto limita o que se
   **reivindica**: o excedente fica na fila, intocado. Ritmo de 2/s só nas
   chamadas ao Resend (`Compasso`, sem crédito acumulado). 429: a mensagem e
   o resto do lote voltam pelo `fila.adiar` (sem gastar tentativa) com o
   `retry-after` (máx. 1 h) e ninguém reivindica até passar. Fila vazia não
   mede nada (`ha_pronta`). Config em `integration_secrets` (`ENVIO_POR_SEGUNDO`,
   `ENVIO_TETO_HORA`, `ENVIO_TETO_DIA`, `ENVIO_AQUECIMENTO_DIA1` — 0 desliga —,
   `ENVIO_AQUECIMENTO_INICIO` AAAA-MM-DD), padrão no código e em `Settings`:
   2/s, 500/h, 2.000/dia, rampa 50→100→200… O dia 1 da rampa, sem
   `ENVIO_AQUECIMENTO_INICIO`, é o do primeiro envio real — em produção,
   **02/10** (3 envios): 03/10 = 100, 04/10 = 200, … 08/10 = 2.000.
   Ainda sem tela para editar (gravar por SQL em `integration_secrets`).
2. **Pausar / retomar / parar** (`app/dominio/controle_campanha.py`, rotas
   `POST /campanhas/{id}/pausar|retomar|parar`, `admin_atual`). Pausar:
   `fila.reivindicar` ignora a campanha pausada; a mensagem reivindicada antes
   do clique volta sem gastar tentativa (`worker._processar`, em vez de virar
   `failed`). Retomar: volta a `sending` e republica pendente órfão. Parar:
   esvazia a fila, pendentes → `suppressed` com erro `envio interrompido pelo
   admin`, fecha pelo `finalize_campaign_if_drained` (status final `sent`;
   ver pergunta P2). Estatística ao vivo ganhou `interrompidos`. Tela:
   botões "Pausar envio"/"Retomar envio"/"Parar de vez" com confirmação no
   detalhe, cartão "Envio pausado", selo "Interrompida", e "Excluir" some da
   lista para campanha pausada (o banco recusaria).
3. **Captura não destrutiva** (`routers/captura.py::_atualizar`): só preenche
   o que está NULL ou `''`; `status`/`tipo` continuam fora.
4. **Primeiro toque congelado, sem migration:** os UTMs andam em bloco — com
   qualquer `utm_*` já gravado no contato, nenhum é tocado; sem nenhum, entra o
   bloco da conversão. `leads.utm_*` = primeiro toque com origem;
   `lead_conversions` tem todos (o último toque é a linha mais recente).
   ⚠️ **Falta um caminho:** `POST /publico/conversao` (`routers/publico.py`
   ~1188, chave de API) ainda faz `utm_* = COALESCE($novo, utm_*)` — ou seja,
   sobrescreve com o último toque. O arquivo é da `consertos-urgentes`; alinhar
   ao mesmo bloco quando ela fechar.
5. **Honeypot no servidor:** campo `website` (no corpo ou em `fields`)
   preenchido → responde o mesmo `{ok, redirect_url}` do sucesso e não grava
   nada. ⚠️ **Falta o campo no formulário da landing** (`frontend/src/landing/`,
   da `consertos-urgentes`): `<input name="website">` escondido por CSS (não
   `type=hidden`), `tabindex=-1`, `autocomplete=off`, mandado em `fields.website`.

**Portão:** ver o fim do relatório (pytest, `tsc`, guarda, `vite build`).

**Telas a conferir** (sem conta admin do Claude): detalhe de uma campanha em
`sending` (botões Pausar/Parar), em `paused` (cartão + Retomar/Parar) e uma
`sent` interrompida (selo + "Não enviados (campanha parada)"); lista de
campanhas (menu sem "Excluir" para pausada). Os três diálogos de confirmação,
claro e escuro.

**Para depois:** índice em `campaign_sends (sent_at) WHERE resend_email_id IS
NOT NULL` se a tabela crescer — a medição do ritmo varre por `sent_at` a cada
passada com fila não vazia. Tela para editar o ritmo (Configurações → Resend).

## Perguntas

- **P1. Tetos padrão.** Assumi 2/s, 500/h, 2.000/dia, rampa começando em 50
  e dobrando (padrão no código, editável em `integration_secrets`). Opções:
  manter; baixar o teto do dia (se o plano do Resend for o gratuito, o limite
  dele é 100/dia e 3.000/mês); subir depois do aquecimento. Assumida: manter
  (é o mais conservador que ainda esgota a base atual — ~300 e-mails — no 3º
  dia).
- **P2. Status final da campanha parada.** Os triggers `validate_campaign_status`
  e `validate_campaign_send_status` só aceitam os estados herdados. Opções:
  (a) sem migration — campanha fecha em `sent`, pendentes em `suppressed` com
  erro "envio interrompido pelo admin", tela mostra "Interrompida" pelo
  contador; (b) migration com `cancelled` nos dois triggers. Assumida: (a),
  reversível e sem tocar no banco.
- **P3. Editar campanha pausada.** `EDITAVEL` já incluía `paused` (herdado).
  Editar o corpo no meio faz parte da base receber uma versão e o resto
  outra. Opções: manter (dá para pausar, corrigir um erro e retomar);
  bloquear. Assumida: manter, sem mudança de código.
- **P4. Dia 1 da rampa.** Sem `ENVIO_AQUECIMENTO_INICIO`, é o dia do primeiro
  envio real (02/10 em produção). Se o domínio for trocado, gravar
  `ENVIO_AQUECIMENTO_INICIO` com a data da troca para a rampa recomeçar.
- **P5. Rotas de pausa com `service_role`.** `authenticated` só tem
  SELECT/UPDATE em `email_send_queue`; retomar (INSERT) e parar (DELETE)
  precisam da mesma transação da troca de status. Assumido: `service_role`
  com `admin_atual`, como o `/enviar`. Alternativa: migration com GRANT
  INSERT/DELETE para `authenticated`.
