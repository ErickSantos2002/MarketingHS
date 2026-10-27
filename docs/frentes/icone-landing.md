# Frente `icone-landing` (n 25)

**Objetivo:** a landing pública (`/p/{slug}`) mostra o ícone da H&S na aba, e o
texto de ajuda do assunto da campanha cita `{{primeiro_nome}}`.

## Estado (27/10) — ✅ pronta para merge

- `backend/app/routers/landing.py`: `montar_casca` ganha
  `<link rel="icon" type="image/x-icon" href="/hs.ico">` no `<head>`, logo
  depois do `<title>` — o mesmo do `frontend/index.html`. Caminho absoluto
  fixo, sem config: `/hs.ico` é servido pelo mesmo domínio. Vale para a
  página publicada e para a prévia.
- `frontend/.../CampaignWizard.tsx`: a ajuda do assunto lista
  `{{nome}}, {{primeiro_nome}}, {{email}}, {{empresa}}`. Só texto;
  `WA_VARIABLES` intocado.

## Portão

- `tests/test_landing_icone.py` (novo, puro, sem banco): 2 testes, RED antes
  pela ausência do `<link>`.
- `tests/test_landing_*.py` (icone, confianca, secoes): **62 passed** — todos
  puros, não precisou de Postgres.
- `tsc --noEmit -p frontend/tsconfig.app.json`: 0 erros.
- `guarda:visual -- src/components/admin/campaigns`: 0.
