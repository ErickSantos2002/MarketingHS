# Frente `primeiro-nome` (n 24)

**Objetivo:** os 25 e-mails trazidos do RD saúdam com `*|PRIMEIRO_NOME|*`, que a
importação virou `{{primeiro_nome}}`. O MarketingHS passa a trocar a tag.

## Estado (27/10) — ✅ pronta para merge

- `backend/app/email/montagem.py`: `primeiro_nome(nome)` (primeira palavra
  depois de tirar os espaços, caixa preservada; vazio/`None`/só espaços → `""`)
  e `aplicar_merge_tags` troca `{{primeiro_nome}}`. Vale para corpo **e**
  assunto: o `worker.py` já passa `nome` no dict e chama a mesma função nos
  dois — não precisou mexer nele.
- `backend/app/routers/envio.py`: `AMOSTRA_MERGE_TAGS` ganha
  `"{{primeiro_nome}}": "João"`. É substituição simples, e `{{nome}}` não é
  substring de `{{primeiro_nome}}`, então a ordem do dict não importa.
- `frontend/.../emailEditorConfig.ts`: `primeiro_nome` em `EMAIL_MERGE_TAGS`,
  logo depois de `nome`. A prévia (`lib/emailPreview.ts`) lê essa lista, então
  já troca pela amostra sem mudança.
- Não existe validação de "tag desconhecida" no backend nem no front.

## Portão

- `tests/test_montagem.py`: 17 passed (7 novos; RED antes, pela tag crua).
- Vizinhos (montagem, meta_capi, sem_sql_do_modelo, descadastro_um_clique,
  campanha_pausa, fila, ritmo_envio, worker_aviso, worker_ritmo) no Postgres
  local `marketinghs-teste-24:5464`: **90 passed**.
- `tsc --noEmit -p frontend/tsconfig.app.json`: 0 erros.

## Para a coordenadora (fora do território)

- `frontend/src/components/admin/campaigns/CampaignWizard.tsx:592` — o texto
  de ajuda do assunto lista `{{nome}}`, `{{email}}`, `{{empresa}}`; não cita
  `{{primeiro_nome}}`. Vale acrescentar.
- `CampaignWizard.tsx:44` — `WA_VARIABLES` (WhatsApp) também não tem a tag.
  O caminho de envio de WhatsApp não passa por `aplicar_merge_tags`; não
  conferi se ele troca variáveis em outro lugar.
