# Frente `agendamento` (28/10/2026)

n 30 · Vite 8110 · backend 8130 · Postgres local 5450 (`marketinghs-teste-30`).
Spec `docs/superpowers/specs/2026-10-28-agendamento-reuniao-design.md`, plano
`docs/superpowers/plans/2026-10-28-agendamento-reuniao.md` — Tasks 1–10 (a 11 é
da coordenadora). GrowthHS só o falso dos testes; nada em produção.

## Estado por task

| Task | Estado | Commit |
|---|---|---|
| 1 Migration 036 | feito | (ver git log) |
| 2 Cliente do GrowthHS | — | |
| 3 Config e regras puras | — | |
| 4 Marca na captura | — | |
| 5 Reserva | — | |
| 6 Rotas públicas | — | |
| 7 Execução, e-mails, varredura | — | |
| 8 Roleta no admin | — | |
| 9 Bloco no editor da página | — | |
| 10 Modal na landing | — | |

## Decisões

- **Task 1:** a reaplicação do arquivo inteiro não roda dentro do pytest — o
  `marketinghs_app` não tem DDL. O teste `test_036_reaplicavel` confere o
  TEXTO (como o da 028) e a prova real foi `psql -v ON_ERROR_STOP=1 -f` duas
  vezes no Postgres local como superusuário (as duas sem erro, a segunda só
  com NOTICE de "already exists"). As funções são cópia fiel conferida por
  `difflib`: `journey_enroll_event` da **028** (a vigente; a 027 foi
  substituída pela 028) e `fn_lead_insert_event` da 027.
- **Task 1:** `tem_handoff` usa `nodes @> '[{"type":"handoff_growthhs"}]'`
  só quando `nodes` é lista (nunca NULL, mesmo motivo do `f_pagina`).

## Fora deste trabalho / para a coordenadora

## Perguntas
