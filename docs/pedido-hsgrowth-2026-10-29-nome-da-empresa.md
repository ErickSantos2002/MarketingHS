# Pedido ao HSGrowth — nome da empresa no convite (29/10/2026)

Para uma sessão aberta em `~/github/hsgrowth-sistema` (`cl hsgrowth-sistema`).

O nome da empresa é **"Health & Safety"**, não "Health & Safety Tech" ("Tech"
é só do segundo domínio, `healthsafetytech.com`). O convite que o lead
recebe ao agendar diz "Sua reunião com a Health & Safety Tech está agendada."

Trocar para "Health & Safety" em tudo que sai para cliente, e no rodapé
interno por coerência:

- `backend/app/api/v1/endpoints/card_tasks.py:33` — `MENSAGEM_PADRAO_DO_CONVITE`
- `backend/app/api/v1/endpoints/card_tasks.py:1330` — corpo do convite
- `backend/app/api/v1/endpoints/card_tasks.py:1375` — assinatura do convite
- `backend/app/services/notificacoes/lembrete_reuniao.py:163` — assinatura do lembrete
- `frontend/src/pages/MeetingGate.tsx:200` — tela pública de entrada na sala
- `frontend/src/layouts/MainLayout.tsx:293` — rodapé interno

Conferir outras ocorrências com `grep -rn "Safety Tech"`, inclusive testes que
comparem o texto. Deploy de homologação e produção é do Erick.
