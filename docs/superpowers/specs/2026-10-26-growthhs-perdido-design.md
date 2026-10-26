# GrowthHS: "Negócio perdido" e "No Show" na volta — design

**Data:** 26/10/2026 · **Frente:** `growthhs-perdido` · **Origem:** pergunta 74
(respondida pelo Erick em 26/10, não se reabre).

## O que muda

A volta do GrowthHS (`POST /publico/growthhs/webhook/{ambiente}?evento=…`)
passa a entender dois eventos novos, com a mesma prova dos existentes: o
`event` do corpo assinado é `card.list_changed` e o `card.list_id` está numa
das listas configuradas para aquele evento.

| `?evento=` | prova (`card.list_id` em) | padrão | linha do tempo | status |
|---|---|---|---|---|
| `meeting_scheduled` | `listas_reuniao` | {28} | "Reunião agendada no GrowthHS" | → MQL (só avança) |
| `deal_won` | `listas_ganho` | {32} | "Venda fechada no GrowthHS" | → Venda realizada (só avança) |
| **`deal_lost`** | **`listas_perdido`** | **{27, 33}** | "Negócio perdido no GrowthHS" | → **Negócio perdido** (regra abaixo) |
| **`no_show`** | **`listas_no_show`** | **{25}** | "No Show no GrowthHS" | **não muda** |

No GrowthHS: o botão "Perdido" move o card para a lista `is_lost_stage` do
board (27 no board 6, 33 no board 7) e dispara `card_lost`; "No Show" é o
vendedor mover o card para 25 "Reagendamento" (`card_moved`).

## Decisões

1. **"Negócio perdido" é status novo em `lead_statuses`** (migration 032),
   `sort_order = 8`, `is_system = true`. Fica no fim da lista do funil (é fim
   de funil), e a FK `leads_status_fkey` passa a aceitá-lo. Cor gravada
   `#ef4444` (vermelho, mesma família de hexadecimais da 005); a tela ignora
   essa coluna de propósito e pinta por token — `--color-danger-600` no
   `StatusBadge`, o único vermelho do mapa (perdido é o único estágio
   "negativo").
2. **Perdido NÃO rebaixa venda.** Lead em "Venda realizada" que recebe
   `deal_lost` (outro card, ou o ganho e depois perdido) só ganha o evento na
   linha do tempo; o status fica. É o mais seguro: venda é fato do ERP,
   perdido de um card pode ser de outra oportunidade. Qualquer outro status
   (inclusive "Em contrato", que na régua da 005 vem antes da venda) vai para
   "Negócio perdido".
3. **Perdido não é "mais para a frente" que o funil.** O estágio só avança
   pela `sort_order` — mas "Negócio perdido" é tratado como fora do funil:
   lead perdido que tem reunião nova ou venda (negócio novo, card novo) volta
   para o funil (MQL / Venda realizada). Sem isso, o `sort_order = 8`
   travaria o lead em perdido para sempre e a renutrição não teria saída.
4. **No Show é só evento.** `ESTAGIO_POR_EVENTO` não tem `no_show`. O
   reagendamento (card de volta a "Reunião Agendada") chega como outro
   `meeting_scheduled`: a deduplicação é por (ambiente, card, **evento**,
   timestamp), então nem o no_show engole a reunião nova, nem a reunião
   nova (timestamp outro) é tomada por repetida da primeira.
5. **As regras moram em `retorno.avancar_status`**, não em `volta.py`: o
   `/publico/evento-de-contato` (`publico._evento_do_growthhs`, cópia que o
   docstring de `retorno` manda andar junto) usa a mesma `avancar_status` e o
   mesmo `ESTAGIO_POR_EVENTO`, então o `deal_lost` pelas duas portas dá o
   mesmo resultado sem tocar a cópia.
6. **As quatro listas não se cruzam.** O PUT da configuração já recusava a
   mesma lista em reunião e em ganho; agora recusa qualquer interseção entre
   reunião, ganho, perdido e no show (uma lista provando dois eventos faria
   um corpo assinado servir para os dois). Lista vazia continua recusada.
7. **A leitura da configuração tolera a 032 ausente.** `ler_config` lê a
   linha inteira e, sem as colunas novas, usa os padrões. Sem isso, um deploy
   antes da migration faria `ler_config` cair no "não configurado" — e a fila
   de entrega inteira pararia junto com a volta. (Gravar as listas novas pela
   tela sem a 032 ainda falha: a ordem continua sendo 032 antes do deploy.)
8. **Status pelo painel/API:** escolher "Negócio perdido" à mão grava
   `contact_updated` + `deal_lost` ("Negócio perdido"), como Venda realizada
   grava `deal_won` — `deal_lost` já é um dos sete tipos que o
   `status_changed_at` soma e que o construtor de segmento oferece ("Deal
   perdido"). Pelo GrowthHS, como nos outros, só sai o `contact_updated`
   (o específico é o próprio evento que veio), sem contagem em dobro.

## Onde o status aparece (portão do corte silencioso)

`grep -rn "Venda realizada"` em `backend/app`, `frontend/src` e
`backend/migrations` — cada lugar que lista status recebe o novo:

- `backend/migrations/032_growthhs_perdido.sql` — `lead_statuses`.
- `backend/app/crm/retorno.py` — `ESTAGIO_POR_EVENTO` e a regra.
- `backend/app/dominio/importacao.py` — `STATUS_VALIDOS` (CSV).
- `backend/app/routers/escrita_contatos.py` — `_EVENTO_POR_STATUS`.
- `frontend/.../contacts/StatusBadge.tsx` — `STATUS_OPTIONS` (alimenta
  filtros, ação em massa e segmento) e `STATUS_COLORS`.
- `frontend/.../automations/AutomationRuleForm.tsx` — `STATUS_VALUES`.
- `frontend/.../settings/ApiDocumentation.tsx` — lista de status padrão.
- Sem lista: `painel.py` (só conta MQL), `sincronizacao_datacore.py` (só
  docstring), `/config/lead-statuses` (lê a tabela). O CHECK antigo de
  `leads.status` (001) saiu na 005 e nenhuma migration o recria.

## Fora do território (anotado para a coordenadora)

- `EventsTimeline.tsx` (da `reconversao-dados`) não tem ícone para
  `deal_lost` nem `no_show`: caem no genérico; o título aparece.

## Testes

`backend/tests/test_growthhs_perdido.py`, com a 032 aplicada dentro da
transação revertida (cópia temporária de `growthhs_config`; o status entra em
`lead_statuses` e sai no rollback): reaplicável 2×; `deal_lost` muda status e
grava evento; venda não é rebaixada; perdido volta ao funil com reunião;
`no_show` só evento; lista errada ignorada; no_show + reagendamento não se
engolem; config lê/grava as listas novas, recusa cruzamento, mostra as URLs;
`ler_config` sem a 032 usa os padrões.
