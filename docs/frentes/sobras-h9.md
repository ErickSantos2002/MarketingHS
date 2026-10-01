# Frente `sobras-h9`

Sobra da `primitivos-cta` (#4): com o primitivo em 36 px, o `h-9` manual
destas linhas virou redundante. Território: só estas linhas.

## Backlog

- [ ] Tirar o `h-9` redundante de botão/campo de tamanho padrão em
  `contacts/ContactsFilterPanel.tsx:~362`, `contacts/StatusDropdown.tsx:~70`,
  `contacts/ContactsToolbar.tsx:~50`, `settings/ApiKeysManagement.tsx:~273,
  ~288, ~323`, `settings/SuppressionList.tsx:~190, ~325`. **Não** tirar o
  `h-9` que estica botão `size="sm"` (pergunta 32) nem o de `TabsList`/`TableHead`.
- [ ] Medir a altura antes/depois (deve ficar 36 px igual) em `/contacts` e
  `/settings` (abas API Keys e Supressão), dois temas.
- [ ] Guarda 0, `tsc` 0, `vite build`.

## Estado
