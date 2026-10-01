# Frente `sobras-h9`

Sobra da `primitivos-cta` (#4): com o primitivo em 36 px, o `h-9` manual
destas linhas virou redundante. Território: só estas linhas.

## Backlog

- [x] Tirar o `h-9` redundante de botão/campo de tamanho padrão em
  `contacts/ContactsFilterPanel.tsx:~362`, `contacts/StatusDropdown.tsx:~70`,
  `contacts/ContactsToolbar.tsx:~50`, `settings/ApiKeysManagement.tsx:~273,
  ~288, ~323`, `settings/SuppressionList.tsx:~190, ~325`. **Não** tirar o
  `h-9` que estica botão `size="sm"` (pergunta 32) nem o de `TabsList`/`TableHead`.
- [x] Medir a altura antes/depois (deve ficar 36 px igual) em `/contacts` e
  `/settings` (abas API Keys e Supressão), dois temas.
- [x] Guarda 0, `tsc` 0, `vite build`.

## Estado

**Pronto para merge** (01/10/2026).

- 8 linhas, 5 arquivos: `ContactsFilterPanel.tsx:362` (SelectTrigger),
  `StatusDropdown.tsx:71` (ramo padrão), `ContactsToolbar.tsx:50` (Input),
  `ApiKeysManagement.tsx:273, 288, 323` (Input, SelectTrigger, Button
  padrão), `SuppressionList.tsx:190, 325` (Input). Ficaram os `h-9` de
  `size="sm"` (pergunta 32) e de `TableHead`.
- Medida (1440 px, claro e escuro), antes → depois: busca de /contacts
  36 → 36; select do painel de filtros 36 → 36; busca da aba Supressão
  36 → 36. Os campos dos diálogos de API Keys (273/288/323) e o de adicionar
  e-mail da Supressão (325) não foram abertos (só leitura); valem pelo
  primitivo, que já é `h-9` em Input, SelectTrigger e Button `default`.
  `StatusDropdown` não é renderizado em nenhuma tela hoje (só citado em
  comentário de `DetailSections.tsx`).
- Guarda 0, `tsc` 0, `vite build` ok.
- Observação, fora do território: `/contacts` a 390 px estoura
  (scrollWidth 542); não vem desta mudança (só altura mudou de dono).
