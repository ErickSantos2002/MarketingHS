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

- [ ] **Controle de volume no worker.** Envios por segundo (padrão alinhado ao
  limite do Resend, 2/s), teto por hora e por dia, e rampa de aquecimento do
  domínio novo (ex.: dia 1 = 50, dobra por dia até o teto). Configurável
  (`Settings` ou `integration_secrets`/config no banco — preferir config no
  banco editável depois; padrão seguro no código). 429 do Resend respeita
  `retry-after` e não conta como tentativa perdida. Teste sem banco do laço de
  ritmo. **O que excede o teto do dia fica na fila para o dia seguinte**, nunca
  vira `failed`.
- [ ] **Pausar / retomar / parar campanha.** O estado `paused` existe e nenhuma
  rota leva a ele. Pausar: o worker deixa de reivindicar mensagens dela;
  retomar: volta a enviar; parar: cancela o que falta (status final claro,
  pendentes viram `cancelled`/`suppressed` — escolher o que as estatísticas já
  entendem). Botão na tela de detalhe, com confirmação. Teste.
- [ ] **Captura não destrutiva.** `captura.py:215` (`_atualizar`) sobrescreve
  nome, cargo, empresa, whatsapp e UTMs de contato existente a partir de
  formulário anônimo. Passar a só preencher o que está vazio (COALESCE), como
  `/publico/identidade`. UTMs da reconversão continuam em `lead_conversions`.
- [ ] **Primeiro toque congelado.** A origem da primeira conversão não pode ser
  apagada pela última. Se der sem migration (derivar de `lead_conversions`),
  melhor; senão, colunas `first_*` na 026.
- [ ] **Honeypot (lado servidor).** A captura aceita um campo-isca opcional
  (ex.: `website`); se vier preenchido, responde `ok` e não grava nada. O
  campo no formulário da landing fica para depois que a `consertos-urgentes`
  fechar (anotar no Estado).
- [ ] Portão: pytest inteiro uma vez no fim, sozinho (~33 min; banco é
  PRODUÇÃO — só apagar o que o teste criou, por id; `count(*) FROM leads`
  igual antes e depois); `tsc` 0, guarda 0, `vite build` se tocar front.

## Estado

## Perguntas
