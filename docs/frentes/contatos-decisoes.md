# Frente `contatos-decisoes`

Decisões do Erick de 01/10 (`docs/perguntas-abertas.md`, itens 2, 3, 9).
Território: `components/admin/contacts/`, `pages/admin/` da tela de Contatos e
a ficha, os hooks/libs de status e etiqueta que só elas usam. **Não toca** em
`components/ui/` nem em `settings/`.

## Backlog (em ordem)

- [x] **#2** Status com uma cor só: a ficha (`StatusBadge`, que hoje lê
  `getColor()` do banco) passa a usar o mesmo mapa por token da lista
  (`STATUS_COLORS`). Nenhuma escrita no banco; o hex gravado fica ignorado.
- [x] **#3** Etiquetas: o seletor oferece só as 4 cores distinguíveis; as
  etiquetas já gravadas com roxo/verde-azulado são **mapeadas na renderização**
  para a mais próxima (sem escrever no banco). Conferir quantas existem em
  produção por leitura.
- [x] **#9** Remover da tela de Contatos as colunas de funil herdadas da dn.ia
  (o dado fica no banco). Identificar quais são pelo `CONTINUAR-AQUI.md`
  (pergunta "Colunas de funil da dn.ia", 8E) e pelo código.
- [x] **#13 na sua área:** `text-destructive` → `text-[--on-tint-danger]` em
  `contacts/` (o resto do app é da `cores-decisoes`).
- [x] Portão: guarda 0, `tsc` 0, `vite build`, `/contacts` e a ficha nos dois
  temas, sem clicar ação; capacidade por capacidade no diff.

## Estado

**✅ Pronto para merge (01/10/2026)** — branch
`worktree-agent-a7658532c6cd34e9d`, base `6a4d3fa`. Nenhuma escrita no banco;
nada em `backend/`, `components/ui/` nem `settings/`.

| Commit | Item |
|---|---|
| `b553d8a` | **#2** `corDoStatus()` (em `contacts/StatusBadge.tsx`) é a fonte única da cor de status: lista, barra em massa, filtros, ficha (`StatusBadge`) e `StatusDropdown`. `useLeadStatuses` deixa de expor `getColor`/`colors`; `lead_statuses.color` continua vindo da API e é ignorada. |
| `a0453fe` | **#3** `CORES_DE_ETIQUETA` = azul, verde, âmbar, vermelho em `lib/corDeDado.ts`; o seletor da ficha oferece só essas (com `aria-label`/`title`/`aria-pressed`), tag nova nasce azul. `purple`→azul e `teal`→verde **na renderização** (`resolverCorDeDado`). Produção (leitura de 01/10): 3 tags `purple`, 1 `#3b82f6`, 0 `teal`. |
| `48cd5fe` | **#9** Saem do seletor de colunas, da tabela e do CSV de Contatos as 7 colunas do funil da dn.ia: Participante (`tipo_participante`), Quem te indicou?, Presença, Interesse Ecossistema/MTIA/Formação, Data Interesse. Leitura de 01/10: **0 de 2.083** contatos com qualquer uma preenchida. Preferência salva que as liste é filtrada ao carregar (comportamento que já existia). |
| `dd0a7d2` | **#13** `text-[--on-tint-danger]` em "Apagar contato" (menu da linha, `ContactsTable`) e no aviso "Exibindo/Incluindo apagados" (`pages/admin/Contacts.tsx:108`). Botões destrutivos cheios (`bg-danger`/`bg-destructive`) ficam. |

**Portão:** `guarda:visual -- src` **0**; `tsc --noEmit -p tsconfig.app.json`
**0** erros; `vite build` ok. `conferir-telas.mjs /contacts` nos dois temas a
1440 e 390 px: só os 2 avisos do React Router, nenhum erro; a 390 px a tabela
ainda rola na horizontal (542 px, pré-existente). Script de visualização
próprio (busca, abre a ficha da Carla Menezes, abre o popover de colunas e o
mini-formulário de tag nova; nenhum clique em Criar/Salvar/Apagar), dois
temas: ponto de status da lista **e** `StatusBadge` da ficha em MQL =
`rgb(26,113,168)` (primária; antes a ficha era verde `#22c55e`); tag `purple`
pintada `rgb(37,99,235)`, idêntica à amostra "Azul"; seletor com 4 amostras;
popover de colunas sem as 7. Zero erro de console.

**Capacidade por capacidade (`git diff 6a4d3fa -- frontend`, 9 arquivos,
+61/−63):** mudar status, aplicar/remover/criar tag, busca de tag, exportar
CSV, ordenar, escolher/reordenar colunas — intactos; o que sai é só o que as
decisões mandam tirar (cor do banco no status, 2 amostras, 7 colunas).

**Para a coordenadora / outras frentes:**
- `ColumnSelector.tsx` tem um `h-9` manual no botão "Colunas" — é da
  `primitivos-cta`; não toquei. Mexi só no `ALL_COLUMNS` (outra região do
  arquivo).
- `pages/admin/Contacts.tsx:108` pode ser tocado também pela `cores-decisoes`
  (#13 "fora de contacts/"); a troca é idêntica, o merge resolve sozinho.
- **Backend (não mexi):** a API continua mandando `lead_statuses.color` (agora
  ignorada) e `tags.color` tem `DEFAULT 'purple'` no banco (ver docstring de
  `criar_tag`, `configuracao.py`) — tag criada sem cor nasce `purple` e é
  pintada de azul. Trocar o default para `'blue'` seria migration da frente
  `backend`, se quiserem o banco coerente com o seletor.
- `settings/ApiDocumentation.tsx:175` traz `color: "purple"` como exemplo de
  payload — fora do meu território (e a regra lá é não mexer em exemplo).

## Perguntas

1. **`tipo_participante` (Participante) entrou no #9?** A pergunta do 8E
   listava 6 colunas (`ColumnSelector.tsx:26,35,46-49`); o item 23 do 8E põe
   `tipo_participante` entre os 7 campos do funil de evento da dn.ia, e ele
   estava 0/2.083 preenchido. **Assumido: sai também** (reversível — uma
   linha no `ALL_COLUMNS`).
2. **A ficha ainda mostra "Tipo Participante" e "Presença"**
   (`LeadDetailSheet.tsx:477,479`, cartões de informação, não coluna), e o
   modal do dashboard (`LeadDetailModal.tsx:208`) também. A decisão 9 fala de
   colunas; **assumido: ficam** até o Erick dizer. Presença só aparece se
   preenchida; "Tipo Participante" aparece sempre (vazio).
3. **Etiqueta com hexadecimal gravado** (`#3b82f6`, 1 em produção, veio por
   API/importação) passa crua, sem remapeamento para as 4. **Assumido: fica
   como está** (é azul e não colide); remapear hex por matiz é mudança maior.
4. `components/admin/LeadsExport.tsx` (export antigo, ainda com os campos do
   funil) não é importado por ninguém — código morto; não apaguei.
