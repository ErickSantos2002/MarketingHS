# Frente `cores-decisoes`

Decisões do Erick de 01/10 (`docs/perguntas-abertas.md`, itens 13, 15, 16, 19).
Território: o que cada item nomeia. **Não toca** em `components/admin/contacts/`
(da `contatos-decisoes`) nem em `components/ui/` (da `primitivos-cta`).

## Backlog (em ordem)

- [x] **#13** Texto destrutivo `text-destructive` → `text-[--on-tint-danger]` no
  app inteiro (menus "Excluir", mensagens de erro, gatilhos), **fora** de
  `contacts/` e `ui/`. Botão destrutivo cheio (`variant="destructive"`,
  `bg-danger`) não muda. Liste no Estado os de `contacts/` que ficaram, para a
  coordenadora repassar.
- [x] **#15** Quadrado de marca do GrowthHS (`settings/GrowthHSCard.tsx`) em
  `--color-success-700`, como a pílula do GrowthHS em Contatos.
- [x] **#16** "Descadastrou" da supressão (`settings/SuppressionList.tsx`) vira
  atenção (variante `warning`), igual ao "Descadastrado" de Campanhas.
- [x] **#19** Permissão de API Key (`settings/ApiKeysManagement.tsx`): Leitura
  neutra (`secondary`), Escrita e Leitura + Escrita em `warning`.
- [x] Portão: guarda 0, `tsc` 0, `vite build`, telas nos dois temas.

## Estado

**01/10 — pronto para merge.** Branch `worktree-agent-a01a292978cf5984e`.
Guarda `src` 0, `tsc` 0, `vite build` ok.

- **#13** — 21 pontos em 18 arquivos (menus Excluir de Campanhas, Templates,
  Páginas e Segmentos; lixeiras de Automações/fluxos/regras/UTM/insights;
  erros de importação e da exclusão de campanha; "Acesso Negado"; "Erro na
  Análise"; X de cancelar dos cartões do painel). Onde havia opacidade sobre a
  cor (`text-destructive/60`, `hover:text-destructive/80`) virou `opacity-*`:
  o Tailwind 3 descarta o `/NN` em `text-[--var]` (medido). `hover:bg-destructive/10`
  (fundo) ficou.
  **Ficaram para a `contatos-decisoes`:** `components/admin/contacts/ContactsTable.tsx:368`
  (`text-destructive focus:text-destructive`, item Excluir) e
  `pages/admin/Contacts.tsx:108` ("Exibindo apenas apagados" — é tela de
  Contatos, território dela). **E para a dona de `ui/`:** `components/ui/form.tsx:81`
  e `:121` (rótulo e mensagem de erro de formulário).
- **#15** — quadrado "G" do `GrowthHSCard` de `--color-info-700` para
  `--color-success-700`, a cor do `EcosystemPills`.
- **#16** — "Descadastrou" de `secondary` para `warning`. Agora "Marcou spam" e
  "Descadastrou" têm a mesma cor (a decisão foi âmbar nos dois; o texto distingue).
- **#19** — Leitura `info` → `secondary`; Escrita já era `warning`; Leitura +
  Escrita `success` → `warning`.
- **Visto** (1440, claro e escuro): `/settings` (quadrado verde do GrowthHS),
  abas API Keys e Supressão, `/automations` (lixeira em danger-700 no claro,
  danger-400 no escuro), `/campaigns`, `/templates`. Produção não tem chave de
  API, supressão, campanha nem template: os badges de #16/#19 e os menus
  Excluir só foram conferidos por código (variantes `secondary`/`warning`
  existem em `ui/badge.tsx`; `twMerge` troca `text-conteudo-muted` do ghost
  pelo token, medido).

## Perguntas
