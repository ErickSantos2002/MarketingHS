# Frente `prova-captura`

Plano: `docs/superpowers/plans/2026-10-21-prova-substituir-rd.md` — Tarefas
1 (Fase 0) e 2–6 (Fase 1). Território: linha `prova-captura` da seção
"Frentes" do plano. n 17 · Vite 8097 · backend 8117.

## Estado
- [ ] Fase 0 — Tarefa 1 (migration 027 + `~/marketinghs-migration-027.sh`) → para e marca "pronto para merge"
- [ ] Fase 1 — Tarefas 2–6 (abrem depois do merge da 027)

## Perguntas / fora do território
- **Para a Tarefa 3 (coordenadora, 21/10):** ao salvar/servir `pages.config`,
  recusar `consentimento.link`, `imagem_url` e `redirect_url` que não sejam
  `http(s)` (ou caminho relativo `/publico/...`) — revisão de segurança achou
  `javascript:` possível no href do consentimento. O front já filtra (frente
  `prova-landing`); o servidor é a segunda linha.
- **Para as Tarefas 2–3 (vindo da `prova-landing`, 21/10):** o servidor
  descarta o que `frontend/src/landing/campos.ts::camposDaConfig` descarta
  (chave inválida, tipo desconhecido, lista sem opção, chave repetida,
  `website`) e normaliza o celular igual a `normalizarCelular`. O envio da
  landing manda `visitor_id` (cookie `mhs_vid`) e `consentimento` só quando a
  página tem o bloco. Erro aceito pelo front: `detail` texto, `{mensagem,
  campos}` ou a lista do 422.
