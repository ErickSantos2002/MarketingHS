# Aviso de lead por e-mail — design (18/11/2026)

## Intenção

Pedido do Erick (18/11): **toda vez que o MarketingHS recebe um lead, um
e-mail vai para `vendas@healthsafetytech.com` com os dados desse lead**, pelo
Resend. É o aviso que a caixa de vendas recebia da RD/da agência; com as
páginas da agência passando pelo MarketingHS (decisão de 16/11), o aviso
precisa nascer aqui — senão, quando a agência desligar o envio direto, vendas
deixa de saber que chegou lead.

## O que conta como "receber um lead"

Toda **conversão de formulário** — os três caminhos que chamam
`registrar_captura` (`backend/app/captura/registro.py`):

| Caminho | Router | Marca |
|---|---|---|
| Landing própria | `routers/captura.py` | `page_slug` |
| Site de fora (`rastreio.js`) | `routers/rastreio.py` | `site_id` + `form_id` |
| Agendamento confirmado | `agendamento/reserva.py` | `agendamento` |

Contato **novo e contato que volta** (reconversão) avisam igual — vendas quer
saber de quem levantou a mão de novo. O e-mail diz qual dos dois é.

**Fora:** importação de planilha, API de contato (`api_contato.py`), edição
manual, retorno do GrowthHS. Não são "lead que chegou por formulário".
(Pergunta 81.)

## Abordagens

1. **Fila própria na mesma transação + worker envia** (escolhida). A captura
   insere uma linha em `avisos_de_lead` dentro da transação de
   `registrar_captura` (`UNIQUE (conversao_id)`); um laço do worker reivindica
   com `FOR UPDATE SKIP LOCKED`, monta e envia, com retentativa crescente.
   Atômico com o lead (sem lead, sem aviso; com lead, aviso garantido),
   não atrasa nem derruba a captura, e é o padrão da casa (`crm_handoffs`,
   `reuniao_agendamentos`, `email_send_queue`).
2. **Enviar direto na requisição da captura.** Simples, mas põe rede externa
   no caminho do lead: Resend lento atrasa o formulário, Resend fora perde o
   aviso. Viola "nenhum caminho de falha nosso pode recusar um lead real".
3. **Nó de jornada "avisar por e-mail".** Flexível, mas depende de alguém
   montar jornada para cada origem; um lead de origem sem jornada fica sem
   aviso — o silêncio que o pedido quer evitar.

## Como funciona

- **Migration 038** (`IF NOT EXISTS`, reaplicável): tabela
  `avisos_de_lead (id uuid pk, conversao_id uuid UNIQUE REFERENCES
  lead_conversions ON DELETE CASCADE, lead_id uuid, status text
  ['pendente','enviado','falhou'], tentativas int, visivel_em timestamptz,
  erro text, resend_id text, enviado_em, criado_em, atualizado_em)`, RLS
  ligado sem política para `anon`/`authenticated` (só `service_role`).
  Índice parcial em `(visivel_em) WHERE status = 'pendente'`.
- **Enfileirar:** no fim de `_registrar`, depois de gravar a conversão,
  `INSERT … ON CONFLICT (conversao_id) DO NOTHING` — **só se o aviso estiver
  ligado** (lido da configuração; desligado = não enfileira). Não enfileira
  quando a captura é de teste (`saidas.NO_DE_TESTE`/modo teste, se o caminho
  marcar), para a suíte não lotar a caixa de vendas.
- **Enviar:** laço novo no `worker.py`, mesmo ritmo das outras filas.
  Reivindica até N, lê lead + conversão (+ site/página, rótulos dos campos via
  `rotulos_dos_campos`), monta o e-mail e chama `resend.enviar`. 429 →
  devolve sem gastar tentativa (`LimiteDoResend`). Falha → `visivel_em`
  crescente; depois de 8 tentativas, `falhou` + log `AVISO DE LEAD NÃO
  ENVIADO` (mesmo padrão do `ALERTA NÃO ENVIADO` do agendamento). Sem
  `RESEND_API_KEY`: não gasta tentativa, adia e loga.
- **Para quem:** um ou mais endereços, configuráveis. Padrão
  `vendas@healthsafetytech.com`.
- **Remetente:** o mesmo `EMAIL_FROM` dos outros e-mails. **`reply_to` = o
  e-mail do lead** — quem está em vendas responde e fala direto com ele.
- **Configuração:** dois segredos novos em `integration_secrets`, lidos por
  `integracoes.ler_segredo`: `AVISO_LEAD_PARA` (lista separada por vírgula) e
  `AVISO_LEAD_LIGADO` (`"1"`/`"0"`). Editáveis num card "Aviso de lead" em
  Configurações (admin), ao lado do Resend, com botão "Enviar teste" que manda
  um aviso de exemplo (sem lead real). Sem segredo gravado: ligado, para
  `vendas@healthsafetytech.com`.

## O e-mail

Assunto: `Novo lead: <nome> — <empresa>` (reconversão: `Lead voltou: …`;
agendamento: `Reunião agendada: …`).

Corpo (HTML simples + texto), só linhas com valor, todo valor escapado
(`html.escape`) e em uma linha (`growthhs.uma_linha`):

- Nome, e-mail, WhatsApp, empresa, cargo
- Campos extras com **rótulo** (setor, funcionários…), não a chave
- Onde: landing `<slug>` ou site `<nome do site>` + URL da página
- Canal (pago/orgânico/direto…) e UTMs da conversão
- Data e hora (America/Sao_Paulo)
- Contato novo ou que voltou
- Link para o contato no MarketingHS (`FRONTEND_URL`)

Nada de consentimento/IP/user-agent no e-mail (não é para vendas).

## Metas, não-metas, anti-metas

- **Meta:** todo lead de formulário gera exatamente um aviso, mesmo com o
  Resend fora por um tempo.
- **Não-meta:** template editável pelo admin; aviso por WhatsApp; regras por
  origem (mandar para endereços diferentes por página).
- **Anti-meta:** aviso duplicado (o `UNIQUE (conversao_id)` garante);
  captura que falha ou demora por causa do aviso; lead de teste da suíte
  chegando na caixa de vendas; dado sensível (consentimento, IP) no e-mail.

## Riscos

- **Homologação restaurada de produção** herda os segredos e mandaria aviso
  de lead de teste para vendas. Ao restaurar o homo, desligar
  (`AVISO_LEAD_LIGADO=0`) — anotar no script de restore/memória do homo.
- **Volume:** cada conversão é um e-mail. Hoje são poucos por dia; não pesa
  na cota do Resend.

## Fica para quem constrói

Nome dos arquivos (`backend/app/avisos/`?), tamanho do lote e ritmo do laço,
forma exata do card no front (seguir `ResendConfigCard.tsx` e os tokens do
Design System).
