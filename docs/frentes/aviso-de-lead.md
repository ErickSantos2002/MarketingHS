# Frente `aviso-de-lead` (18/11/2026)

n 34 · Vite 8114 · backend local 8134 (só para a conferência) · Postgres
local 5454 (`marketinghs-teste-34`). Spec
`docs/superpowers/specs/2026-11-18-aviso-de-lead-design.md`, plano
`docs/superpowers/plans/2026-11-18-aviso-de-lead.md`. Resend só o falso dos
testes; nada em produção.

## Estado

Pronta para merge.

| Item | Commit |
|---|---|
| Plano | `71369b6` |
| 1. Migration 038 (`avisos_de_lead`) e enfileirar na captura | `3ad5136` |
| 2. Montagem do e-mail (`avisos/email.py`) | `38a8fd6` |
| 3. Envio pela fila e laço do worker (`avisos/fila.py`, `_laco_avisos`) | `7f66a6b`, `47ec4a9` |
| 4. Rotas `/config/aviso-lead` (GET, PUT) e `/config/aviso-lead/testar` | `cf966e8`, `72dc19c` |
| 5. Card "Aviso de lead" em Configurações → Integrações | `1387fd8` |
| Correções da revisão final | `905a66e` |

### Como ficou

- **Enfileirar** (`avisos/fila.py::enfileirar`, chamado no fim de
  `captura/registro.py::_registrar`): uma linha em `avisos_de_lead` na
  mesma transação da conversão, num SAVEPOINT, com
  `ON CONFLICT (conversao_id) DO NOTHING`. O "ligado" é lido pela própria
  conexão da captura, sem pedir uma segunda conexão ao pool. Qualquer erro
  só é logado e a captura segue. Os três caminhos (landing, site,
  agendamento) passam por ali.
- **Enviar** (`avisos/fila.py::rodar_avisos`, laço `_laco_avisos` do
  worker, a cada 15 s): reivindica com `FOR UPDATE OF a SKIP LOCKED` e
  monta o e-mail fora de transação. Manda um e-mail por destinatário, com
  `reply_to` = e-mail do lead, e marca cada um em `enviados`.
  - Falha: tenta de novo em `min(1 min × 2^(t−1), 60 min)`. Na 8ª, o aviso
    vira `falhou` com o log `AVISO DE LEAD NÃO ENVIADO`.
  - 429: o aviso volta sem gastar tentativa e segura o `_compasso` do
    worker.
  - Sem `RESEND_API_KEY` ou com o aviso desligado: não reivindica nada.
  - Tabela ausente (038 não aplicada): loga uma vez só.
- **E-mail** (`avisos/email.py::montar_aviso`):
  - Assunto: `Novo lead:` / `Lead voltou:` / `Reunião agendada:`.
  - Corpo: nome, e-mail, WhatsApp, empresa, cargo e extras com o rótulo da
    página. Depois Onde, Página, Canal, UTMs, Quando (Brasília), contato
    novo ou que voltou, e o link para o contato.
  - Tudo passa por `uma_linha` e `html.escape`. Sem IP, user-agent nem
    consentimento.
- **Configuração:** segredos `AVISO_LEAD_LIGADO` (`"0"` desliga, qualquer
  outro valor ou ausente liga) e `AVISO_LEAD_PARA` (lista separada por
  vírgula, até 10, cada um validado). Vazio volta ao padrão
  `vendas@healthsafetytech.com`. "Enviar teste" manda um aviso de exemplo
  com `[TESTE]` no assunto e não grava nada no banco.

## Decisões tomadas pela frente (opção mais segura e reversível)

1. **Lead de teste nunca sai pela passada normal.** Fica de fora quem tem
   `tipo = 'teste'` ou e-mail `.invalid`. Os testes usam `somente=`, que
   levanta essa exclusão, ou `escopo=`, que só limita a passada aos ids.
   Nenhum teste comita aviso que o worker de produção possa reivindicar, e
   nenhum teste grava segredo real (os de configuração usam um dict em
   memória).
2. **O aviso nasce com 60 s de atraso.** Assim um teste que comita uma
   captura e apaga o lead logo depois leva o aviso junto (CASCADE).
3. **Duplo clique** (a corrida perdida no `_inserir`) não enfileira: o
   pedido que venceu a corrida já enfileirou.
4. **Aviso desligado na hora de enviar:** o que já estava pendente espera,
   não é descartado.
5. **Vários destinatários:** a coluna `enviados text[]` impede reenviar a
   quem já recebeu quando há retentativa.
6. **Ordem do deploy:** a captura funciona sem a 038.
7. **Colunas além da spec:** `contato_novo`, `agendamento`, `enviados`.
   Guardam se o contato era novo e se veio de agendamento, e não deixam
   repetir envio.
8. **`resend_id`** guarda só o id do último destinatário. Quem recebeu
   está em `enviados`.

## Perguntas (para `perguntas-abertas.md`, a coordenadora consolida)

- **Queda do Resend maior que ~2 h.** As 8 tentativas que a spec pede
  cobrem cerca de 2 h. Uma queda maior deixa o aviso em `falhou` para
  sempre, só com o log. Assumido: manter 8, como a spec. Opções: mais
  tentativas (30 ≈ 1 dia), ou erro de rede/5xx não gastar tentativa
  depois do teto, ou um botão "reenviar falhos".
- **Ritmo de envio:** o `ritmo.SQL_USO` não conta os avisos de lead (o
  arquivo está fora do território). Com poucos por dia, o efeito é
  desprezível. Assumido: não contar.
- **Homologação restaurada com aviso ligado** recebe os pendentes que
  vieram de produção se alguém religar o aviso lá. Assumido: desligar no
  homo (ver abaixo).

## Portão (Postgres local, 18/11)

- pytest: **1483 passed, 0 failed, 9 skipped** (suíte inteira, depois da onda final `905a66e`). A base da `main` era 1437 passed, 9 skipped.
  Os 9 skipped são 7 `base_real` + 2 da 032.
- `tsc --noEmit` 0 · `guarda:visual` 0 em `src/components/admin/settings` ·
  `npm run build` ok.
- Conferência visual: `/settings` → Integrações, claro e escuro, 1440 e
  390 px, sem rolagem horizontal. Script descartável com Chrome próprio,
  admin descartável no Postgres local, só GET, sem clicar em Salvar nem
  Enviar teste. Não usei o `conferir-telas.mjs` porque a conta do Claude
  não existe no banco local.
- Migration 038 aplicada duas vezes no Postgres local, sem erro.

## Fora do território

Nenhum arquivo.

Observação: o commit `3ad5136` saiu com o trailer `Co-Authored-By` do
Sonnet. Não reescrevi, porque reescrever exigiria `push --force`.

## O que falta para produção (coordenadora / Erick)

1. **Desligar no homo antes de tudo.** Gravar
   `AVISO_LEAD_LIGADO=0` em `integration_secrets` do homo, e acrescentar
   isso ao script de restore do homo e à memória do homo. Sem isso, os
   leads de teste do homo vão para vendas.
2. **Aplicar a 038 em produção duas vezes**, pelo comando do `CLAUDE.md`
   (seção Comandos), antes do deploy.
3. **Deploy de api, worker e sistema.** Sem segredo gravado o aviso já
   nasce ligado, indo para `vendas@healthsafetytech.com`.
4. **Conferir:** "Enviar teste" no card, e depois uma conversão real. O
   aviso sai uns 60 s depois.
