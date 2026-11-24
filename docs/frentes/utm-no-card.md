# Frente `utm-no-card`

Aberta em 24/11/2026, depois da virada do n8n da agência (jornada "Páginas
da agência — lead para o comercial", nó `handoff_growthhs`, ativa desde
24/11 15:51).

## Estado

✅ Pronta para merge (24/11). Branch `worktree-agent-abfbfe884954af61a`.
Sem migration, sem frontend. Só `backend/app/crm/growthhs.py` e
`backend/app/crm/entrega.py`, mais testes.

## O problema (medido em produção, só leitura)

O 1º card da virada (13088, form `lp-contatos`, site "Páginas da agência")
nasceu certo na lista 22, mas **sem UTMs e sem gclid** — o card que o n8n
criava levava o gclid; perdíamos a atribuição do Google Ads.

- `montar_card` lia as UTMs de `leads.utm_*`, que é NULL em lead criado por
  conversão de site/LP — as UTMs estão em `lead_conversions.utm_*`.
- `origem_do_card` só tirava o gclid de `visitas` pelo `visitor_id`. A LP
  `contatos.healthsafety.com.br` posta direto em
  `/api/publico/site/conversao`, sem `rastreio.js`: não há visita, e o gclid
  só existe na `page_url` da conversão.

## O que entrou

- **`entrega.origem_do_card`** traz `utm_source/medium/campaign/term/content`
  da última conversão. Sem gclid de visita, usa
  `growthhs.gclid_da_url(page_url)`; o da visita continua vencendo.
- **`growthhs.utms_do_card(lead, conversao)`** — a regra única, usada por
  `montar_card` (campos `utm_*` e `utm_params`), `montar_descricao` (linha
  `Campanha:`, que vale também para `bloco_de_atualizacao` e para a nota de
  abertura) e `linha_de_utms` (linha `UTMs:` da nota de abertura). O
  agendamento (`agendamento/execucao.py`) recebe a conversão de
  `origem_do_card` e passa a levar as mesmas UTMs sem mudança lá.
- **`growthhs.gclid_da_url`**: primeiro `gclid` não vazio da query
  (`urlsplit` + `parse_qsl`); fragmento não conta; valor com caractere fora
  de `[A-Za-z0-9_-.~]` ou maior que `MAX_GCLID` (500) é descartado inteiro
  (gclid cortado não atribui); URL torta → `None`, nunca exceção.

## Decisões assumidas (reversíveis)

- **Precedência por conjunto, não campo a campo.** Se a conversão tem
  QUALQUER `utm_*`, vai o conjunto da conversão inteiro; só sem nenhuma lá
  caem as do contato. Misturar o `utm_source` de um toque com o
  `utm_campaign` de outro inventaria uma campanha — mesma regra que
  `captura/registro.py` já segue ao gravar as do contato.
- **Só a última conversão.** Se a última não tem UTM, não se procura uma
  conversão anterior que tenha: cai nas do contato (o comportamento de
  antes). Procurar a anterior seria atribuir ao card um toque que não foi o
  que trouxe o lead agora.
- gclid inválido/comprido vira `None` (antes, o da visita era cortado em 500
  por `_cortar` — isso não mudou).

## Testes

- `tests/test_growthhs_cliente.py`: 4 testes de precedência + 16 casos de
  `gclid_da_url`.
- `tests/test_prova_crm.py::test_origem_do_card_traz_utms_e_gclid_da_url_da_conversao`
  (banco): UTMs da conversão, gclid da URL, e visita com gclid vencendo a URL.
- Suíte no Postgres local (`marketinghs-teste-utm`, 5461):
  **1533 passed, 9 skipped** (os 7 `base_real` + 2 da 032), sem falha.

## Para depois (fora do território)

- Os cards já criados desde a virada (a partir do 13088) seguem sem UTM e
  sem gclid; corrigir lá é escrita no GrowthHS — decisão do Erick.
