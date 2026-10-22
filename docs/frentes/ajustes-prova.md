# Frente `ajustes-prova` (22/10/2026)

Sobras da prova do RD (ver o bloco "✅ Prova de substituição do RD" no
`CONTINUAR-AQUI.md` e as perguntas 62 e 66). Uma frente só, dona da
migration **028** nesta rodada. n 20 · Vite 8100+? não sobe backend próprio
salvo necessidade (8120).

## Backlog (em ordem)
- [ ] A1 Canal "campanha": UTM presente que não casa com pago/social/email/orgânico/referência vira `campanha`, não `direto` (servidor e rótulo nas telas de números).
- [ ] A2 Prévia da landing no editor não conta visita.
- [ ] A3 Receptor de teste devolve `card_id` distinto por `external_id` (estável).
- [ ] A4 (pergunta 62) Jornada `form_submitted` **sem** filtro de página/formulário não matricula conversão vinda de site externo (`site_id`).
- [ ] A5 (pergunta 66) Entrega ao CRM reconfere `allowed_emails` da jornada na hora de sair.
- [ ] A6 Login preserva o destino (`/contacts?contato=<id>` abre a ficha depois do login).
- [ ] A7 `validate_journey_graph`: `branch_attribute` sem `config.rules` é recusado (coalesce).
- [ ] A8 Barra de filtros de Contatos aparecendo no cabeçalho do editor de página: investigar e corrigir se for vazamento de layout.

## Estado

## Perguntas / fora do território
