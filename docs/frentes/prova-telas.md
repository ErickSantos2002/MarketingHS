# Frente `prova-telas`

Plano: `docs/superpowers/plans/2026-10-21-prova-substituir-rd.md` — Tarefas
13, 14, 15, 16 e 17. Território: linha `prova-telas` da seção "Frentes" do plano.
n 14 · Vite 8094 · usa o backend da 8100.

## Estado — 21/10: **pronto para merge** (branch `prova-telas`)

- [x] **T13 Sites** (`5fc976e`) — `lib/sites.ts` (`Site`, `listarSites`,
  `criarSite`, `atualizarSite`, `rotacionarToken`, `snippetDoSite`,
  `normalizarDominio`), `settings/SitesSettings.tsx`, aba "Sites" em
  Configurações. Lista com snippet copiável, criar/editar (nome, domínios um
  por linha já normalizados na tela, tags, ativo, mapa `name → campo` com
  chave validada), rotacionar token com `AlertDialog` ("o snippet antigo para
  de funcionar").
- [x] **T14 Números** (`9fd2f1c`) — `lib/numeros.ts` (`NumerosDoPeriodo`,
  `lerNumeros`, `formatarTaxa` com `null → "—"`, período em dia civil de
  Brasília), `pages/NumerosDasPaginas.tsx` abaixo dos cartões de Páginas:
  7/30/90 dias, tabela por página com linha expansível por canal, tabela de
  formulários de site. Painel intocado.
- [x] **T15 Construtor** (`e31fdef`) — `notify_email` e `webhook` em
  `JourneyNodeType`/`NODE_LABELS`/ícones/menu "+"; diálogo com lista de
  e-mails validada (inválido trava o salvar) e URL `https://` com aviso
  inline. `buildEntryConfig(eventType, pageSlug?, formIds?)` substitui o
  `entryEventConfig`; campo "Ou nestes formulários de site" no gatilho
  `form_submitted` (criação e entrada). Modo teste: campo na criação e cartão
  próprio no construtor; selo "Modo teste · N" no cabeçalho do fluxo e no
  cartão da lista; a cópia ("Clonar") herda a lista. Esvaziar a lista de um
  fluxo que tinha modo teste pede confirmação ("Desligar o modo teste?") e
  manda `[]`; fluxo sem lista manda `null`.
  `scripts/journeys-nos.test.mjs` (7 testes): todo `JourneyNodeType` está no
  `NOT IN` de `validate_journey_graph` da migration mais nova que a define
  (027), todo tipo tem rótulo, e as funções puras novas.
- [x] **T16 Campo personalizado / ficha / link** (`7af923e`) — "Campo
  personalizado" (`campo_extra` + `key` + `is`/`is_not`/`contains`/`not_contains`)
  no segmento e na condição de fluxo; ficha com "Campos personalizados" (de
  `GET /contatos/{id}`, só aparece com dado) e "Consentimento" (data, base
  legal, versão, selo "provisória", origem, IP, texto);
  `listarConsentimentos`/`camposExtrasDoContato` em `lib/leitura.ts` (o lib que
  a ficha usa). `/contacts?contato=<uuid>` abre a ficha (procura na lista;
  senão lê a ficha do servidor; contato inexistente avisa por toast).
- [x] **T17 Arquivos** (`ce07a92`) — `subirArquivo`/`listarArquivos`/`Arquivo`
  em `lib/config.ts`, `templates/ArquivosDialog.tsx` (só `.pdf`, aviso de
  vazio e de >10 MB antes de mandar, "Link" copia `url_publica`), botão
  "Arquivos" em Templates.

### Portão (21/10, antes do push)
- `npx tsc --noEmit -p tsconfig.app.json`: **0 erros**.
- `npm run guarda:visual -- src`: **0**.
- `node --test scripts/*.test.mjs`: **50 testes, 50 passam** (inclui os 7 de
  `journeys-nos` e os 2 de `journeys-eventos`). Depois do commit do `ErroApi`:
  **55 testes, 55 passam** (tsc 0, guarda 0, builds ok).
- `npx vite build` e `npm run build:landing`: ok.
- `git diff --stat main...`: 21 arquivos de `frontend/` + este; nenhum `.env`
  nem credencial.

### Conferência de tela (`conferir-telas.mjs --porta 8094`, só leitura)
Claro/escuro × 1440/390, sem estouro de largura em nenhuma:
- `/settings` + `aba:Sites`: backend sem `/sites` ainda → cartão de erro
  "Não foi possível carregar os sites (Not Found)". Esperado.
- `/pages`: Números com cartão de erro (`/paginas/numeros` ainda não existe →
  405, a rota cai em `/{pagina_id}`). Esperado. (A lista de páginas do banco de
  produção está vazia hoje.)
- `/automations` + "Novo fluxo": diálogo com o modo teste. O **construtor** não
  foi conferido: não há nenhuma jornada no banco (consulta só de leitura) e
  criar uma é escrita.
- `/contacts?contato=<id>`: a ficha abre direto. Os blocos novos ficam abaixo
  da dobra do diálogo e o script não rola; Consentimento sem backend mostra
  "Não foi possível carregar o consentimento."
- `/segments`, `/templates`: ok. O diálogo "Arquivos" não abre pelo script
  ("Arquivos" não está na lista `ABRIDORES` de `conferir-telas.mjs`).

## Desvios do plano
- **Backend da conferência na 8114, não na 8100.** Não havia backend na 8100;
  subi `uvicorn` da própria worktree (código da `main`) na 8114, sem worker,
  e o Vite com `MKT_BACKEND_PORT=8114`. Só leitura.
- `ModoTesteCampo.tsx` (novo, em `automations/`) concentra o campo do modo
  teste, o selo e o campo de formulários — usado pela criação e pelo
  construtor. Dentro do território (`automations/**`).
- `entryEventConfig` saiu de `lib/journeys.ts` (trocado por `buildEntryConfig`
  nos dois únicos chamadores).

## Perguntas / fora do território
1. ⚠️ **`campo_extra` em SEGMENTO perde a `key` no servidor.**
   `backend/app/routers/segmentos.py::RegraIn` tem só `field`, `operator`,
   `value`; o pydantic descarta `key`, e `build_segment_condition` devolve
   `FALSE` sem chave — **segmento por campo personalizado salva e dá zero, sem
   erro** (vale para a prévia também). Precisa de `key: str | None = None` em
   `RegraIn` e de mandá-la ao banco (`model_dump(exclude_none=True)`). A
   condição de **fluxo** não sofre disso (`nodes: list[dict]`). Nenhuma frente
   da prova tem `segmentos.py` no território — a coordenadora decide quem faz.
   → **Decidido (coordenadora):** fica com a `prova-captura`.
2. ✅ `allowed_emails?: string[] | null` declarado em `JornadaEntrada`
   (`lib/jornadas.ts`; extensão de território dada pela coordenadora).
3. ✅ `ErroApi` não mostra mais "[object Object]": `mensagemDoDetalhe` em
   `lib/api.ts` (extensão de território) usa `detail` texto, `detail.mensagem`
   ou junta os `msg` da lista do 422; vale também para os uploads multipart de
   `lib/config.ts`. `scripts/api-erro.test.mjs` (5 testes). Os contornos das
   telas desta frente saíram. Para o Node importar o `api.ts` no teste:
   `import.meta.env?.` e o `status` do `ErroApi` como campo declarado (a
   propriedade de parâmetro não é sintaxe apagável).
4. (Para depois, decisão da coordenadora) `conferir-telas.mjs` não tem "arquivos" em `ABRIDORES` — para conferir o
   diálogo de Arquivos, acrescentar (abre só leitura).
5. Ao conferir Contatos vi 3 leads "Semente / teste-conversao-semente-…@exemplo.invalid"
   (tipo `teste`, 21/10 14:48) na lista de produção; minutos depois a lista
   voltou a 2.107. Parecem linhas de teste de outra frente em andamento, já
   limpas — anotado só para a contagem `count(*) FROM leads` da suíte.
