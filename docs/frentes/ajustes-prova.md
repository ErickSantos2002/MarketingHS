# Frente `ajustes-prova` (22/10/2026)

Sobras da prova do RD (ver o bloco "✅ Prova de substituição do RD" no
`CONTINUAR-AQUI.md` e as perguntas 62 e 66). Uma frente só, dona da
migration **028** nesta rodada. n 20 · Vite 8100+? não sobe backend próprio
salvo necessidade (8120).

## Backlog (em ordem)
- [x] A1 Canal "campanha": UTM presente que não casa com pago/social/email/orgânico/referência vira `campanha`, não `direto` (servidor e rótulo nas telas de números).
- [x] A2 Prévia da landing no editor não conta visita.
- [x] A3 Receptor de teste devolve `card_id` distinto por `external_id` (estável).
- [x] A4 (pergunta 62) Jornada `form_submitted` **sem** filtro de página/formulário não matricula conversão vinda de site externo (`site_id`).
- [x] A5 (pergunta 66) Entrega ao CRM reconfere `allowed_emails` da jornada na hora de sair.
- [x] A6 Login preserva o destino (`/contacts?contato=<id>` abre a ficha depois do login).
- [x] A7 `validate_journey_graph`: `branch_attribute` sem `config.rules` é recusado (coalesce).
- [x] A8 Barra de filtros de Contatos aparecendo no cabeçalho do editor de página: investigar e corrigir se for vazamento de layout.

## Estado

Branch `ajustes-prova`, um commit por item (22/10).

| Item | Commit | O que entregou |
|---|---|---|
| A1 | `ff0e6a8` | `canal_do_toque`: `utm_source`/`utm_medium` presente que não caiu em pago/e-mail/social/orgânico/referência → `campanha` (antes `direto`). Visita e conversão (mesma função). Rótulo "Campanha" em `lib/numeros.ts`; contrato do card cita o valor novo. |
| A2 | `4b43db5` | Editor abre a prévia em `/p/<slug>?previa=1`; a casca (`landing.py`) não põe o `rastreio.js`; e o script, se vier, na landing (`data-pagina`, sem token) com `previa=1` não manda visita. Site de fora com `?previa=1` não muda. Formulário da prévia continua convertendo. "Abrir em nova aba" continua contando (é visita de verdade). |
| A3 | `9bbe0e3` | **Sem defeito no receptor**: ele já dá um `id` por `external_id`. Lido em produção: os 4 handoffs da prova tinham `card_id` 26 porque os 4 leads (gmail e healthsafetytech) têm o MESMO `dnia_id` (mesmo telefone → mesma pessoa) e `_ja_entregue` reaproveita o card da pessoa; só 1 pedido chegou ao receptor (`vezes = 1`). Teste que prova o receptor + nota no módulo. |
| A4 | `79a4ed4` | Migration **028** (b): `journey_enroll_event(uuid,text,jsonb)` copiada da 027, com `v_site` e `AND v_site IS NULL` no ramo "sem filtro". Texto das telas de jornada atualizado (`ModoTesteCampo.tsx`, `lib/journeys.ts`). |
| A5 | `43ffecf` | `crm/entrega.py`: `_lista_do_pedido` (pedido com `journey_run_id` → `allowed_emails` em vigor da jornada); fora da lista o pedido falha com `modo teste: fora da lista da jornada`, sem chamar o GrowthHS e sem reaproveitar card. Manual e regra não mudam. |
| A6 | `4255c2a` | `lib/destino.ts` (`destinoDoLogin`, `destinoSeguro`); `ProtectedRoute` põe caminho+query+âncora no `state`; `Login` volta a ele (ou a `?de=`) com `replace`. Só caminho interno: `//`, `/\`, caractere de controle/espaço e o próprio `/login` viram `/`. |
| A7 | `a63f2e4` | Migration **028** (a): `validate_journey_graph` copiada da 027 com `coalesce(jsonb_typeof(...rules), '')`. Nenhuma jornada de produção tem `branch_attribute` sem regra (lido em 22/10) — a 028 não trava pausa de ninguém. |
| A8 | `060e809` | Causa: `/pages` fora de `HIDE_GLOBAL_FILTERS` no `AdminLayout` — a barra do painel (que só filtra a Visão Geral) aparecia na lista e no editor. Conferido com `conferir-telas.mjs` (Vite 8140, backend 8120, só leitura). |

**Migration 028** (`backend/migrations/028_ajustes_prova.sql`): só `CREATE OR
REPLACE FUNCTION` + `GRANT`. Provada em dois Postgres 17.11 descartáveis
(`docker run --rm`, `marketinghs_app` criado antes), `000`…`027` em ordem e a
`028` **duas vezes** em cada; `test_migracao_028` + `test_migracao_027` +
`test_r5_jornadas` contra o local: 48 passed. Antes da 028 os dois testes de
site e o de `branch_attribute` com `{}` falhavam (vermelho conferido). No banco
de produção os testes de banco da 028 pulam até aplicar. Script:
`~/marketinghs-migration-028.sh` (o Erick roda; duas provas `true`).

**Testes (produção, transação revertida ou limpeza por id):**
`test_prova_captura` + `test_migracao_028` 26 passed / 9 skipped (028 não
aplicada); `test_prova_numeros` + `test_captura` 45; `test_prova_crm -k
receptor` 8; `test_crm_entrega` 21; `test_crm_caminhos` 15. Front: `tsc` 0,
guarda 0, `vite build` e `build:landing` ok, `node --test scripts/*.test.mjs`
69 passed.

## Perguntas / fora do território

- **A6 e o 401 (`lib/api.ts`, dono único — não editei).** Com token vencido,
  o `/auth/eu` volta 401 e `api.ts` faz `location.assign('/login')`: recarga
  sem `state`, o destino se perde. O login já aceita `?de=`. Spec de uma
  linha para a coordenadora, em `pedir()`:
  `location.assign('/login?de=' + encodeURIComponent(location.pathname + location.search + location.hash))`.
- **A3 — um card por pessoa.** Telefone igual junta e-mails diferentes no
  mesmo `dnia_id`, e o comercial recebe UM card. É o desenho do 8D (I2);
  registrar só se o Erick quiser card por e-mail.
- **A4 — ordem.** A 028 precisa estar aplicada antes de colar o snippet no
  site institucional; não depende de deploy.
