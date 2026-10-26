# Frente `growthhs-perdido`

Pergunta 74 (respondida pelo Erick em 26/10). Spec:
`docs/superpowers/specs/2026-10-26-growthhs-perdido-design.md`. Plano:
`docs/superpowers/plans/2026-10-26-growthhs-perdido.md`. Branch
`worktree-agent-a5869da27fa16c9cd` (subagente com worktree).

## Estado (26/10)

- [x] Migration 032 (`listas_perdido`, `listas_no_show`, status "Negócio perdido")
- [x] `Config`/`ler_config` com as listas novas, tolerante à 032 ausente
- [x] Volta: `?evento=deal_lost` e `?evento=no_show`; regra do perdido em `retorno.avancar_status`
- [x] Configuração (API): campos, URLs, recusa de lista em dois eventos
- [x] Status novo em todas as listas (`importacao`, `escrita_contatos`, `StatusBadge`, `AutomationRuleForm`, `ApiDocumentation`)
- [x] Tela do GrowthHS: dois campos + duas URLs (conferida com `conferir-telas`, claro/escuro, 1440/390)
- **A 032 NÃO foi aplicada.** Ver "Para a coordenadora".

## O que entrou

- `deal_lost`: prova = `card.list_id` em `listas_perdido` (padrão {27, 33}).
  Evento "Negócio perdido no GrowthHS" + status "Negócio perdido" — **menos**
  para quem está em "Venda realizada" (só o evento). Lead perdido que tem
  reunião nova ou venda volta ao funil (perdido conta como começo da régua).
- `no_show`: prova = `card.list_id` em `listas_no_show` (padrão {25}). Só o
  evento "No Show no GrowthHS"; status não muda. Repetido é por (ambiente,
  card, **evento**, timestamp): o reagendamento (outro `meeting_scheduled`)
  nunca é engolido.
- A regra mora em `avancar_status`: o `/publico/evento-de-contato` com
  `source_app=growthhs` e `event_type=deal_lost` dá o mesmo resultado.
- Painel/API: escolher "Negócio perdido" à mão grava `contact_updated` +
  `deal_lost` ("Negócio perdido").
- Cor: `--color-danger-600` no `StatusBadge` (a coluna `color` da tabela,
  `#ef4444`, a tela ignora).
- `ler_config` lê `SELECT *` e usa os padrões sem as colunas da 032 — um
  deploy antes da migration não derruba a fila nem a volta (conferido: a
  tela, com o backend desta branch no banco de produção sem a 032, mostrou
  27, 33 e 25).

## Para a coordenadora

**1. Aplicar a 032 ANTES do deploy** (sem ela a tela não grava as listas novas
e "Negócio perdido" é recusado pela FK `leads_status_fkey`). Com o dono das
tabelas, duas vezes para provar:

```bash
set -a; . ~/marketinghs.env; set +a
for i in 1 2; do
PGPASSWORD="$POSTGRES_PASSWORD" psql \
  "postgresql://${POSTGRES_USER}@${POSTGRES_HOST_EXTERNO}:${POSTGRES_PORTA_EXTERNA}/${POSTGRES_DB}" \
  -1 -v ON_ERROR_STOP=1 -f backend/migrations/032_growthhs_perdido.sql
done
# prova: as duas linhas com {27,33}/{25}, e o status uma vez só
PGPASSWORD="$POSTGRES_PASSWORD" psql \
  "postgresql://${POSTGRES_USER}@${POSTGRES_HOST_EXTERNO}:${POSTGRES_PORTA_EXTERNA}/${POSTGRES_DB}" \
  -c "SELECT ambiente, listas_perdido, listas_no_show FROM growthhs_config" \
  -c "SELECT name, sort_order FROM lead_statuses WHERE name = 'Negócio perdido'"
```

Depois: deploy de api + sistema (o worker não muda de comportamento, mas lê
a mesma `Config` — pode ir junto).

**2. Automações no GrowthHS da homologação** (o Erick, na tela de Automações
de cada board; molde do doc de lá, §4 e §8.5). As URLs exatas estão em
Configurações → Integrações → GrowthHS → Homologação, com botão de copiar.
Em todas: ação **`send_webhook`**, **Secret** = o segredo do webhook da
Homologação (o mesmo das automações de reunião e ganho), auto-desligar no
padrão (5 falhas).

- **Negócio perdido — board 7 (Aquisição):** gatilho **`card_lost`** →
  `send_webhook` → `https://<sistema>/api/publico/growthhs/webhook/homologacao?evento=deal_lost`.
- **Negócio perdido — board 6:** a mesma automação no board 6 (a automação
  é por board; o perdido do board 6 vai para a lista 27).
- **No Show — board 6:** gatilho **`card_moved`** para a lista **25
  "Reagendamento"** → `send_webhook` →
  `https://<sistema>/api/publico/growthhs/webhook/homologacao?evento=no_show`.
- Prova curta: um card de lead nosso em "Reunião Agendada" → mover para 25
  (linha do tempo: "No Show no GrowthHS", status continua MQL) → voltar para
  28 (outra "Reunião agendada") → "Perdido" (status "Negócio perdido",
  evento "Negócio perdido no GrowthHS").

⚠️ Se as listas da homologação não forem 25/27/33 (os ids citados são os do
GrowthHS informados na pergunta), corrigir os campos "Listas de perdido" e
"Listas de No Show" na aba da Homologação antes da prova — lista errada é
ignorada em silêncio (200 `{"ignorado": true}`, nada no contato).

**3. Testes** — no banco local (`scripts/banco-teste-local.sh`, depois do
merge da `ef1266b`), nunca em produção. A suíte inteira é sua.

- Com a 032 (o script aplica todas as migrations; reaplicada 2× à mão com
  `psql -1`, sem erro, status 1×): `test_growthhs_perdido` (32 novos) +
  `webhook`, `config_growthhs`, `ambientes`, `config_029`, `prova_crm`,
  `leitura_growthhs` → **169 passed, 2 skipped** (os 2 são os que só fazem
  sentido sem a 032 no banco, e pulam explicando).
- Sem a 032 (colunas e status retirados no banco local): `perdido` +
  `webhook` + `config_growthhs` + `ambientes` → **139 passed, 0 skipped**
  (aí os 2 rodam: reaplicável em cópia temporária e `ler_config` com os
  padrões).
- `importacao`, `api_contato`, `contato_canonico` → 46 passed;
  `perdido` + `faxina_r5` + `crm_caminhos` + `crm_entrega` → 111 passed, 2 skipped.
- `tsc` 0; `guarda:visual` 0 em `settings/`, `contacts/`, `automations/`;
  `node --test scripts/regra-sem-tag.test.mjs` 2/2.
- Teste existente ajustado: `test_config_growthhs.py` usava `[32, 33]` como
  listas de ganho — 33 é a lista de perdido padrão, e lista em dois eventos
  agora é recusada; virou `[32, 34]`. A URL do webhook esperada ganhou
  `deal_lost` e `no_show`.

## Perguntas / fora do território

- **`EventsTimeline.tsx`** (território da `reconversao-dados`): não há ícone
  para `deal_lost` nem `no_show`; caem no genérico, com o título certo.
  Sugestão: `deal_lost: XCircle`, `no_show: CalendarX`.
- **"Em contrato" + perdido:** assumi que perdido leva "Em contrato" para
  "Negócio perdido" (na régua da 005, "Em contrato" vem antes da venda). Se
  "Em contrato" for pós-venda (cliente), ele deveria ser protegido como a
  venda — é uma linha em `retorno.avancar_status`. Reversível.
- **Perdido → reunião nova volta ao funil:** assumido (sem isso a
  `sort_order` 8 prenderia o lead em perdido). Se o Erick preferir que só
  mudança manual tire do perdido, é a mesma função.
- **`card_lost` sem mudar de lista:** o GrowthHS também dispara `card_lost`
  quando o card é marcado perdido por edição (`is_lost` no PATCH) sem ir para
  a lista de perda; aí o `list_id` do corpo não prova e o evento é ignorado.
  O botão "Perdido" (que move) é o caminho normal.
- O board 6 "Agendado" (26) não está em `listas_reuniao` (só 28) — é
  anterior a esta frente; anotado caso a prova mostre reagendamento no
  board 6.
