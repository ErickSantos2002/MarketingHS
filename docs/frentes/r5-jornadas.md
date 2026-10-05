# Frente `r5-jornadas` ("R5 sem decisão", parte backend + automações)

Origem: `docs/raio-x-rd.md` (R5) e perguntas 50 do `docs/perguntas-abertas.md`.
Só o que **não depende** de D1 (funil) nem do R4 (campos B2B).

Território: `backend/**` inteiro (dona única de migration, `config.py`,
routers e testes nesta rodada), `frontend/src/lib/journeys.ts`,
`frontend/src/components/admin/automations/`, `frontend/src/hooks/useJourneys*`.
**Não tocar:** `components/admin/contacts/`, `LeadDetailSheet.tsx`,
`hooks/useLeadQualification.tsx`, `components/admin/dashboard/`,
`frontend/src/landing/` — são da `r5-contatos`.
Migration: só se indispensável (numerar a partir da próxima livre,
idempotente, rodar duas vezes para provar, **NÃO aplicar em produção**;
montar `~/marketinghs-migration-0NN.sh` no molde do
`~/marketinghs-migration-025.sh` e anotar no Estado).
Portas: Vite 8093, backend 8113.

## Backlog (em ordem)

- [ ] **Nó de jornada "mudar status".** Configura um status de
  `lead_statuses`; o motor grava em `leads.status` (e registra evento, como os
  outros nós). Construtor: tipo novo no `journeys.ts`, rótulo, ícone e
  configuração no `NodeConfigDialog`. Teste do motor.
- [ ] **Nó de jornada "remover tag".** Espelho do `apply_tag`. Remover tag que
  o contato não tem não é erro. Teste.
- [ ] **Evento de conversão por página.** "Pediu demonstração" tem que poder
  disparar jornada **na hora** da conversão numa página específica: o gatilho
  `form_submitted` ganha filtro opcional por página (`page_slug`/id), e o
  evento publicado pela captura carrega a página. Sem filtro = qualquer página
  (comportamento de hoje). Construtor: seletor de página no gatilho. Teste:
  conversão na página A dispara a jornada filtrada por A e não a filtrada por B.
- [ ] **`POST /publico/conversao` não sobrescreve UTMs** (pergunta 50): mesmo
  bloco da captura (`routers/captura.py::_atualizar`, R1) — com qualquer
  `utm_*` já gravado, nenhum é tocado; sem nenhum, entra o bloco. Campos de
  perfil só preenchem o vazio. Teste.
- [ ] Portão: `tsc` sem erro novo, guarda 0 em `src`, `vite build`; pytest
  dos arquivos tocados com `-x` e depois a suíte inteira **uma vez, sozinha,
  com `timeout 3600`** (~35 min). ⚠️ Banco é **PRODUÇÃO com dado real**: só
  apagar o que o teste criou, por id; `count(*) FROM leads` igual antes e
  depois (anotar os dois números). Nunca duas suítes ao mesmo tempo — a
  `r5-contatos` não roda pytest.

## Estado

(vazio)

## Perguntas

(dúvida de produto: opções + a assumida, a mais segura e reversível)
