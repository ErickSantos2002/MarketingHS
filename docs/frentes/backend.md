# Frente `backend`

Dona única de `backend/**`: migrations, `config.py`, routers, worker, testes.
Não encosta em `frontend/`. Backend próprio na **8104**; o worker de fila
**nunca** sobe nesta frente.

## Backlog (em ordem)

- [ ] **Campanhas presas em "Enviando..."** (pergunta 7 do `CONTINUAR-AQUI`).
  As 2 de produção ("teste de webhook", 02/09) estão em `sending` sem
  `sent_at`, 1 envio cada, 0 pendentes. Diagnosticar por leitura (código do
  worker + `SELECT`) por que a campanha não fecha quando a fila drena; teste
  que reproduz; conserto no código. A correção **do dado** é script SQL que o
  Erick roda no Konsole — a frente escreve o script e para ali.
- [ ] Docstring de `backend/app/routers/landing.py:~52-57` ainda cita
  `PageFormDialog.tsx`, apagado no G5.
- [ ] **`service_role` → `authenticated` em request de usuário**, router por
  router (a regra do `CLAUDE.md`; 128 × 16 em 04/09). Primeiro medir de novo
  e escrever o plano com a ordem. Para cada rota convertida, teste que prova
  que **não zerou**: a contagem sob `authenticated` com o usuário admin bate
  com a de antes. Política admin-only → rota `admin_atual`. Rota que zera e
  não tem conserto óbvio vira pergunta, não conversão.
- [ ] Ao fim de cada router: `pytest -q`, push, marcar "pronto para merge"
  (merge por router, não no fim de tudo).

## Estado

## Perguntas
