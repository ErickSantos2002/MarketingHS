# Continuar aqui

> ## 🌅 Comece por aqui — 25/09/2026
>
> **Onde tudo está:** branch **`visual-fase-1`** em `43d0b65`, com **45
> commits à frente da `main`** (`2e39aae`, igual ao `origin/main`) e **30 à
> frente do `origin/visual-fase-1`** — nada disso foi enviado. Ela carrega a
> Fase 1, a preparação da Fase 2, o G1 e o G2, todos com revisão por tarefa e
> revisão final. As branches `visual-fase-2` e `visual-fase-2-g2` foram
> mergeadas nela (avanço direto) e apagadas. **Push e merge na `main` são
> decisão do Erick.**
>
> **O que fazer hoje:** escrever o plano do **G3 — Campanhas e Templates**
> (`components/admin/campaigns/`, **65** no guarda; o conteúdo de e-mail fica
> de fora, Decisão 6 do spec) no molde de
> `docs/superpowers/plans/2026-09-24-marketinghs-visual-fase-2-g2-contatos.md`,
> numa branch nova a partir de `visual-fase-1`. Execução como nos dois grupos
> anteriores: `superpowers:subagent-driven-development`, um subagente e uma
> revisão por tarefa, revisão final da branch no modelo mais capaz.
>
> **Placar do guarda (24/09, fim do dia) — 338:** `settings` 122 ·
> `pages/admin` 68 · `campaigns` 65 · `automations` 45 · `admin/pages` 26 ·
> `segments` 10 · `ui` 2. Zerados: `dashboard`, `contacts`, raiz de
> `admin`, `hooks`, `lib`.
>
> **Levar para o plano do G3:**
> - apertar a regex `EFEITO` do guarda: `shadow-\[0_0_` casa o anel de 1px de
>   `ui/sidebar.tsx:421` (falso positivo; arquivo sem importador) — trocar por
>   `shadow-\[0_0_[1-9]`; os 2 de `ui` somem;
> - as regras aprendidas no G1/G2, que o plano precisa repetir: tradução por
>   **significado**, nunca pelo matiz; **nunca `` `${cor}NN` ``** (use
>   `color-mix`); cor que vem do banco passa por `src/lib/corDeDado.ts`; chip
>   clicável mantém hover (`hover:bg-x/20`); o brief autoriza "o que mais for
>   preciso para zerar o guarda nos arquivos da tarefa";
> - `segments` subiu de 6 para 10 porque o guarda passou a ver os brilhos do
>   `SegmentFormModal.tsx` (G4).
>
> **Decisões que esperam o Erick** (detalhe nos blocos abaixo):
> 1. **Push e merge** da `visual-fase-1` na `main`.
> 2. **Trocar a senha da conta admin do Claude** (`claude.dev@example.com`) —
>    ela apareceu na saída de uma ferramenta de subagente em 24/09 (não foi
>    para arquivo nem commit).
> 3. **Paleta de gráfico própria** no Design System oficial — hoje 6 cores,
>    3 delas semânticas; dela dependem P2×P3 com a mesma cor e os períodos do
>    dia repetindo cor (G1).
> 4. **Status com duas cores** — a lista, a barra de filtros e a barra em
>    massa usam `STATUS_COLORS` fixo; a ficha usa a cor do banco; 3 status
>    divergem (G2). Unificar é mudar a fonte do dado.
> 5. **Cores nomeadas de etiqueta** — das 6 do seletor, só 4 se distinguem
>    (roxo = azul, verde ≈ verde-azulado) (G2).
> 6. As da Fase 1 (altura botão × campo) e as seis de 23/09 (fluxo em
>    rascunho, recálculo disparando automação, peso 0 no A/B, conta Unlayer,
>    colunas de funil, cor do botão das landings).
>
> **Regra de processo nova (24/09):** subagente **não abre** o arquivo de
> credencial — reaproveita a sessão já logada do navegador do Playwright; se
> não houver sessão, para e pede. E ação negada pelo controle de permissão
> não se repete com outra descrição: relata.
>
> **Servidores:** o backend (8100) foi desligado; suba com
> `cd backend && ./.venv/bin/python -m uvicorn app.main:app --port 8100`
> (o worker de fila não sobe junto — seguro para conferência). O Vite (8080)
> estava no ar.

> ## ✅ Visual — Fase 2, G2 (Contatos, ficha, Importação), 24/09/2026
>
> **O G2 fechou.** Mesma branch `visual-fase-2-g2` (a partir de
> `visual-fase-1`, base `d4007e6`), **não mergeada** — como as fases e
> grupos anteriores, o merge é decisão do Erick. As seis tarefas do plano
> `docs/superpowers/plans/2026-09-24-marketinghs-visual-fase-2-g2-contatos.md`
> saíram; o spec que governa continua sendo
> `docs/superpowers/specs/2026-09-22-marketinghs-visual-design-system-design.md`.
>
> **O que entrou, tarefa a tarefa:**
>
> | Commit | O que entrou |
> |---|---|
> | `24ca424` | O guarda passa a contar gradiente/brilho com token (`bg-gradient-`, `drop-shadow(0 0`, `blur-*` fora de `backdrop-blur`); conserto do selo do medidor do G1, que tinha perdido o fundo por alfa concatenada em `var()` |
> | `d77f098` | Cor de status e etiqueta vira dado do banco, servida por `src/lib/corDeDado.ts` (`resolverCorDeDado`, `estiloDeCorDeDado`, `COR_DE_DADO_PADRAO`) — `StatusBadge`, `StatusDropdown`, `TagsCell`, `EcosystemPills`, `useLeadStatuses` |
> | `6acf735` | Lista de contatos (`ContactsTable` e as barras/painéis ao redor) sai do guarda — paginação em frase, `<h1>` duplicado sai de `/contacts` |
> | `08b0cb2` | `Badge` ganha `forwardRef` — some o aviso `Function components cannot be given refs` |
> | `2af9e52` | A ficha do contato (`LeadDetailSheet`, `DetailSections`, `EventsTimeline`) sai do guarda |
> | `8e2db5c` | Importação (`DatacoreImport`, `ImportPage`) e `LimiteDeErro` saem do guarda; `<h1>` duplicado sai de `/import` |
>
> **Placar do guarda: 463 → 332** (app inteiro). A Tarefa 1 mudou o que o
> guarda enxerga antes de tocar qualquer tela: a regex passou a contar
> gradiente e brilho decorativo (`bg-gradient-`, `drop-shadow(0 0`,
> `blur-*` fora de `backdrop-blur`), que somaram **+8** (463 → 471) — o
> mesmo tipo de ponto cego que a Fase 1 já tinha fechado para
> `white`/`black`. Por pasta, tarefa a tarefa: `src/components/admin/contacts`
> **105 → 86** (Tarefa 2, cor de status/etiqueta) **→ 14** (Tarefa 3,
> lista) **→ 0** (Tarefa 4, ficha — `DetailSections.tsx`/
> `EventsTimeline.tsx` eram os 14 que sobravam); `admin` (raiz —
> `LeadDetailSheet.tsx`, `DatacoreImport.tsx`, `LimiteDeErro.tsx`)
> **31 → 11** (Tarefa 4, sai a ficha) **→ 0** (Tarefa 5, sai a
> importação); `hooks` **1 → 0** (Tarefa 2, `FALLBACK_COLOR`);
> `dashboard` continua em **0** — sem regressão do G1; `lib` nasce em
> **0** (`corDeDado.ts`, novo). O que resta no app inteiro (332):
> `settings` 122, `pages/admin` 68, `campaigns` 65, `automations` 45,
> `components/admin/pages` 26, `segments` 6 — nenhuma pasta do G2.
>
> **Portão (Tarefa 6), conferido em 24/09:** `tsc --noEmit -p
> tsconfig.app.json` com os mesmos **4** erros pré-existentes
> (`LeadScoringSettings` ×1, `useJourneys` ×3), nenhum novo; `vite build`
> e `build:landing` passando; grep de alfa concatenada
> (`\$\{[^}]+\}[0-9]{2}\b`) em `src/**/*.tsx` — **zero linhas**; os
> **7 hashes** do Design System conferindo com o `ORIGEM.md` — nenhum
> arquivo de `design-system/` tocado. Capacidade por capacidade (`git
> diff d4007e6 -- frontend`, 23 arquivos incluindo `guarda-visual.mjs`,
> 206 inserções / 186 deleções): todo arquivo tocado é do escopo
> esperado (os arquivos das Tarefas 2-5, `corDeDado.ts` novo, `badge.tsx`
> e `QualificationGauge.tsx`/`guarda-visual.mjs` da Tarefa 1). Do que
> sobra do filtro de diff (165 linhas), nenhuma mexe em
> `useState`/`onClick`/chamada de API/condição — é tradução de cor
> (hex/literal → token), o módulo `corDeDado.ts` novo, o `forwardRef` do
> `Badge` e as duas exceções nomeadas no brief (paginação em frase,
> remoção do `<h1>` duplicado). **As seis telas** (`/contacts` com
> filtro, com o menu da linha aberto e na página 2; a ficha do contato;
> `/import` nas duas abas; `/`) abertas nos dois temas a 1440 px — zero
> erro de console novo; o aviso `Function components cannot be given
> refs` do `Badge` **sumiu** (confirmado nos dois contatos de teste da
> Tarefa 4 e de novo nesta conferência, abrindo a ficha de Carla
> Menezes). A 390 px, `/contacts` rola horizontalmente (162 px) — a
> tabela tem 20 colunas, pré-existente e não desta fase: o diff contra
> `d4007e6` em `ContactsTable.tsx` não toca largura nem grid, só cor.
>
> **O que cada Review Focus achou:** (1) cor do banco preservada nos
> dois temas — os 7 status reais e as etiquetas reais (`purple`/`blue`)
> não viraram cinza nem ficaram ilegíveis; mas nem todo ponto usa a cor
> do banco: só o `StatusBadge` (ficha) resolve `getColor()` e pinta
> borda/ponto/fundo de 12% com ela, texto sempre em `--text-heading`. O
> ponto da coluna Status da lista (`ContactsTable.tsx`), o da
> `ContactsBulkBar` e o da `ContactsFiltersBar` usam `STATUS_COLORS`
> fixo — ver a divergência registrada abaixo, em "Decisões que esperam
> o Erick"; (2) alfa
> concatenada — a única ocorrência do app inteiro era o selo do medidor
> do G1 (`` `${getColor()}20` ``), consertado na Tarefa 1; grep rodado
> em toda tarefa desde então, sempre zero; (3) ação destrutiva —
> "Apagar contato" (menu da linha) e "Apagar"/diálogo em massa da
> `ContactsBulkBar` continuam vermelhos nos dois temas; (4) paginação —
> "Mostrando X a Y de Z contatos" bate no primeiro bloco (1 a 15), no
> segundo (16 a 30) e no último (2071 a 2083 de 2083, página 139), e
> some com uma página só; (5) os avisos âmbar do `DatacoreImport` (503 e
> "sem e-mail") e o ícone do `LimiteDeErro` resolvem cor real (nunca
> `rgba(0, 0, 0, 0)`) nos dois temas, ao vivo e por elemento sintético.
>
> **O conserto do selo do medidor — regressão do G1 que as sete
> revisões por tarefa não viram:** `QualificationGauge.tsx` (medidor de
> meta em `/`, "Mostrar mais detalhes") usava
> `` backgroundColor: `${getColor()}20` `` — alfa concatenada numa cor
> que já vinha de `var(--color-*)` desde a Fase 1, não de hexadecimal.
> O sufixo `20` só funciona colado num hexadecimal; colado num
> `var(--...)` o CSS descarta a declaração inteira em silêncio, e o
> fundo do selo saía `rgba(0, 0, 0, 0)` nos dois temas — sem erro, sem
> aviso, só o selo sem fundo. Virou
> `` color-mix(in srgb, ${getColor()} 15%, transparent) ``, a mesma
> forma que este grupo passou a usar em toda cor de dado
> (`corDeDado.ts`). A lição, para qualquer fase futura: **nunca
> `` `${cor}NN` ``** — o guarda não pega isso (é `style={{}}`, não
> `className`), só o grep dedicado e o `getComputedStyle` do fundo
> pegam.
>
> ### Decisões tomadas nesta fase, reversíveis
>
> 1. **Cor de status e etiqueta é dado do banco**: fica a cor escolhida,
>    na borda, no ponto e num fundo de 12%; o texto passa para a cor de
>    título (`--text-heading`), não para a cor do dado.
> 2. **`STATUS_COLORS`** (reserva para quando o banco não responde) **e
>    as cores nomeadas de etiqueta viraram token**, pelo lugar no funil
>    ou pelo matiz (`purple`→primária, já que o DS não tem roxo).
> 3. **Pílulas de ecossistema**: MarketingHS = primária, GrowthHS =
>    sucesso escuro; a letra de 9 px dentro da pílula fica — é marca,
>    não texto corrido.
> 4. **`Badge` ganhou `forwardRef`** (mesma API, aditivo) — resolve o
>    aviso de ref que vinha desde a Fase 0, em todo `Badge` dentro de
>    `TooltipTrigger`/`asChild`.
> 5. **Paginação em frase e fim do `<h1>` duplicado** em `/contacts` e
>    `/import` — a topbar já escrevia o título, o corpo repetia.
> 6. **Borda de destaque cheia (ex.: `borderLeft` do toast "Lead
>    qualificado!") usa a cor cheia do token** (`var(--color-success-600)`),
>    não a tinta — é linha fina, não superfície.
> 7. **A célula de etiqueta do `ContactsTable` continua `<span>` com
>    classes de token, não virou `<Badge>`** — decisão do controlador
>    depois que o `Badge` ganhou `forwardRef` (Tarefa 4): o
>    comportamento visual já era equivalente, trocar de componente seria
>    mudança fora do escopo de cor.
> 8. **A letra do avatar de plataforma em `EventsTimeline` (`fontSize:
>    10` inline) fica** — mesma natureza da exceção das
>    `EcosystemPills` (marca dentro de um círculo de 24 px), não texto
>    corrido; subir para 12 px estouraria o círculo, mudança de leiaute
>    fora do escopo desta fase.
> 9. **Hot = success, Warm = warning** aplicado de novo em
>    `ContactsTable` e `LeadDetailSheet` (bolinha de score, ícone
>    `Flame`) — mesma convenção que o G1 já fixou em
>    `PriorityLeadsTable`, não a leitura literal da Tabela de tradução
>    (que leria vermelho→perigo para o hotlead, já que a cor de origem
>    era vermelha).
> 10. **Categorias sem hierarquia passam a dividir cor quando o Design
>     System não tem tom para todas**: em `EventsTimeline`,
>     `dnmarketing`/`marketinghs`/`website` (antes roxo e rosa, matizes
>     quase indistinguíveis) viraram todos `--color-primary-600` — a
>     letra do avatar (M/W) continua diferenciando qual é qual.
> 11. **Nunca `` `${cor}NN` `` para alfa** — só funciona com hexadecimal
>     e quebra em silêncio com `var(--...)` (foi assim que o selo do
>     medidor do G1 perdeu o fundo, ver acima). Usar sempre
>     `` color-mix(in srgb, ${cor} N%, transparent) ``.
>
> **Dívida anotada** (nada corrigido, registrada para quando alguém
> tocar o arquivo de novo):
> - ~~`ContactsBulkBar.tsx:240` — botão "Apagar" em `border-danger/40`,
>   enquanto os irmãos (menu da linha, etc.) usam `/30`.~~ Consertado na
>   Onda de conserto (24/09/2026, ver abaixo) — e era pior que a
>   divergência de opacidade: `text-danger` sobre o fundo
>   `var(--color-primary-600)` da barra dava ~1,4:1, ilegível.
> - `ContactsTable.tsx:694-698` — `EcosystemBadges` local com
>   `fontSize: 10` inline, implementação própria e gêmea do
>   `EcosystemPills` compartilhado (pré-existente, não desta fase).
> - `frontend/src/components/ui/alert.tsx` não tem variante `warning` —
>   os avisos âmbar do `DatacoreImport` e do `LimiteDeErro` seguem como
>   `<div>` com tinta manual, o mesmo padrão pré-existente do
>   `OverviewTab.tsx:449`. Criar a variante tocaria um arquivo fora do
>   escopo desta fase; decidir numa fase futura.
>
> ### Decisões que esperam o Erick (as duas novas são as primeiras)
>
> 1. **O ponto de status diverge em três lugares, não em dois.** Além da
>    `ContactsBulkBar` e da `ContactsFiltersBar`, a coluna Status da
>    própria lista (`ContactsTable.tsx:567`) também usa `STATUS_COLORS`
>    fixo (mapa por nome), não a cor real do banco. Só o `StatusBadge`
>    da ficha busca `getColor()`. Já era assim antes desta fase — o mapa
>    hex antigo também divergia da cor do banco, isto só trocou hex por
>    token no mesmo comportamento. Três status medidos divergem hoje
>    entre lista e ficha:
>
>    | Status | Lista (`STATUS_COLORS`) | Ficha (`getColor()`, cor do banco) |
>    |---|---|---|
>    | MQL | azul | verde (`#22c55e`) |
>    | Em contrato | verde | laranja (`#f97316`) |
>    | Iniciado | azul-escuro | violeta (`#a78bfa`) |
>
>    Unificar (`getColor(s) || STATUS_COLORS[s]`) é mudança de fonte de
>    dado — qual valor cada componente lê —, fora do escopo desta fase,
>    que só trocou apresentação. Decidir se vale a pena antes do G3.
> 2. **Nomes de cor de etiqueta colidem depois da tradução para token.**
>    `purple` virou primária (azul) e `blue` também é info (azul); o
>    seletor de cor da ficha oferece 6 amostras e só 4 se distinguem
>    (purple≈blue, green≈teal). Na base real, 3 etiquetas `purple` e 1
>    `#3b82f6` ficaram azul×azul — indistinguíveis no seletor e na
>    lista. Opções: (a) tratar nome de etiqueta como dado com paleta
>    própria fixa, fora dos 5 tokens semânticos do DS; (b) tirar do
>    seletor as amostras que colidem, ficando com menos de 6 cores; (c)
>    aceitar a colisão como está.
> 3. Continuam abertas as decisões dos blocos anteriores (Fase 1 e G1,
>    abaixo): o desencontro de altura botão×campo, as colisões de cor
>    de gráfico, e as seis de 23/09 (fluxo em rascunho, recálculo/sync
>    disparando automação, peso 0 no A/B, conta Unlayer `dnmkt`, colunas
>    de funil da dn.ia, cor do botão das landing pages).
>
> ### Onda de conserto — revisão final da branch, 24/09/2026
>
> A revisão final de toda a branch (`d4007e6..655b712`) achou três
> defeitos que as sete revisões por tarefa não pegaram, todos
> consertados nesta onda:
>
> 1. `ContactsBulkBar.tsx:240` — botão "Apagar" ilegível
>    (`text-danger` sobre `var(--color-primary-600)`, ~1,4:1) virou
>    botão de perigo cheio (`bg-destructive text-destructive-foreground`).
> 2. `ContactsTable.tsx` — a etiqueta pintava de âmbar qualquer valor
>    diferente de `hotlead`, inclusive desconhecido; devolvido o
>    terceiro ramo neutro (`hotlead`→success, `warm`→warning, resto→
>    neutro), comportamento de antes da fase.
> 3. `guarda-visual.mjs` — o `EFEITO` não pegava `shadow-[0_0_...]`,
>    `blur-[...]` fora de `backdrop-`, `drop-shadow-[...]` nem
>    `linear-/radial-gradient(...)`; alargado. `contacts`, `dashboard`,
>    `hooks` e `lib` continuam **0**; o novo total do app é **338**
>    (era 332), e `segments` passa de **6 para 10** — os dois aumentos
>    são brilho/gradiente que já estava lá (`SegmentFormModal.tsx`,
>    `sidebar.tsx`), fora do escopo desta onda e não desta fase.
>
> **Próximo passo: G3** — Campanhas e Templates.

> ## ✅ Visual — Fase 2, preparação e G1, 24/09/2026
>
> **O G1 fechou.** Branch `visual-fase-2` (a partir de `visual-fase-1`, base
> `b63640f`), **não mergeada** — como a Fase 1, o merge é decisão do Erick.
> As oito tarefas do plano
> `docs/superpowers/plans/2026-09-24-marketinghs-visual-fase-2-preparacao-e-g1.md`
> saíram; o spec que governa continua sendo
> `docs/superpowers/specs/2026-09-22-marketinghs-visual-design-system-design.md`.
>
> **O que entrou, tarefa a tarefa:**
>
> | Commit | O que entrou |
> |---|---|
> | `111de54` | O guarda passa a contar `white`/`black` sem número — o ponto cego que a Fase 1 tinha registrado fecha |
> | `f614aa2` | `chart.tsx`/`LeadsChart.tsx` órfãos apagados; `Badge` ganha `success`/`warning`/`info`; `drawer.tsx` sem `bg-black/80` |
> | `2311c2b` | `GlobalFilters`, `LeadDetailModal` e a aba Visão Geral (`/`) saem do guarda |
> | `2c4945d` | Abas Perfil e Tático do Analytics saem do guarda; `getPriorityColor`/`getQualificationColor` (hook compartilhado com o G2) traduzidos |
> | `87b624b` | Aba Operacional do Analytics sai do guarda |
> | `a8667e9` | Aba Desafios do Analytics sai do guarda |
> | `dac6013` + `9406fcf` | Aba Insights sai do guarda — `dashboard` inteiro em zero; correção de revisão: Grade D do ranking de campanhas passa a `danger`, não `warning` |
>
> **Placar do guarda: 888 → 463** (app inteiro; o "888" já é o ponto de
> partida com o ponto cego fechado pela Tarefa 1 — 825 da Fase 1 + 63 que o
> guarda não via). `src/components/admin/dashboard` (as 6 subpastas — 5
> abas do Analytics + a Visão Geral — mais a raiz): **398 → 0**, tarefa a
> tarefa: raiz + `overview` 398 → 292 (T3),
> `profile` + `tactical` 292 → 257 (T4), `operational` 257 → 211 (T5),
> `challenges` 211 → 95 (T6), `insights` 95 → 0 (T7). O que resta no app é
> inteiramente G2 em diante: `settings` 122, `contacts` 105, `pages/admin`
> 68, `campaigns` 65, `automations` 45, `admin` (raiz) 31, `pages` 26,
> `hooks` 1.
>
> **Portão (Tarefa 8), conferido em 24/09:** `tsc --noEmit -p
> tsconfig.app.json` com os mesmos **4** erros pré-existentes
> (`LeadScoringSettings` ×1, `useJourneys` ×3), nenhum novo; `vite build` e
> `build:landing` passando; os **7 hashes** do Design System conferindo com
> o `ORIGEM.md` — nenhum arquivo de `design-system/` tocado, nenhum defeito
> novo do Design System apareceu nas Tarefas 3-7. Capacidade por capacidade
> (`git diff --stat e9398f3 -- frontend/`, medido depois da onda de conserto
> de 24/09 abaixo: **50 arquivos, 423 inserções / 854 deleções** — inclui
> `frontend/scripts/guarda-visual.mjs`, que é o guarda em si, tocado pela
> Tarefa 1, não uma tela): todo arquivo tocado é do escopo esperado (as 6
> subpastas de `dashboard` + raiz, `useLeadQualification.tsx`, `badge.tsx`,
> `drawer.tsx`, `guarda-visual.mjs`, os dois arquivos mortos apagados); do
> que sobra do filtro de diff, nenhuma linha mexe em
> `useState`/`onClick`/chamada de API/condição/limiar — são strings de
> classe fora de `className=` (corpo de função `getXColor`), a remoção dos
> dois arquivos mortos, a troca `getScoreColor`→`getScoreVariant` (mesmo
> mapeamento, tipo de retorno diferente, de string CSS para nome de
> `variant`), o campo `textClass` novo em `SalesReadinessFunnel.tsx`
> (mesmo padrão do `color` que já existia, para resolver o item 8 da onda),
> `<Card>` simplificado, emoji removido e espaço em branco de editor. **As sete telas** (`/`, as cinco abas do Analytics, a ficha do
> lead) abertas nos dois temas a 1440 px — zero erro de console novo (os 2
> avisos de React Router e, na ficha do lead, 2 avisos Radix de
> acessibilidade — "Missing `Description` for `{DialogContent}`" —, todos
> pré-existentes). A 390 px, `/` e `/analytics?tab=insights` rolam
> horizontalmente, mas a rolagem já existia antes desta fase tocar os
> arquivos: `LeadsLineChart.tsx` (o toggle "Por Dia"/"Por Horário" do card
> "Agendamentos por Dia") não foi tocado por nenhuma tarefa; em
> `CampaignRankingTable.tsx`/`InsightsTab.tsx` (a tabela mais larga do G1),
> o diff contra `visual-fase-1` só tem classe/token de cor, nenhuma classe
> de layout, grid ou largura.
>
> ### Decisões tomadas nesta fase, reversíveis
>
> 1. **Roxo/violeta/índigo da dn.ia → tinta primária** (o Design System não
>    tem roxo).
> 2. **Verde do WhatsApp (`#25D366`) → tinta de sucesso**; não é exceção de
>    marca de terceiro.
> 3. **Emoji de fim de frase removido; emoji com sentido virou ícone
>    `lucide-react`** (`AlertTriangle`, `Gem`, `Check`, `BarChart3`...) — a
>    frase ao redor não mudou.
> 4. **`Badge` ganhou `success`, `warning`, `info`** — aditivo, nenhuma
>    variante existente mudou.
> 5. **Texto colorido solto usa `--on-tint-*`, não o `-500`** — garante
>    contraste AA nos dois temas.
> 6. **Ícone de ~16 px (ação, feedback ou indicador de categoria) pode usar
>    a cor cheia do token** (`text-success` etc.), mesmo fora de
>    `--on-tint-*` — o contraste exigido de elemento gráfico é 3:1, não o
>    4,5:1 de texto. Exemplos: os dois ícones "copiado" do
>    `LeadDetailModal`; `Flame`/`RefreshCw`/`Sparkles` em
>    `PriorityLeadsTable`. Texto solto continua em `--on-tint-*`. Custo se
>    errado: ícones um tom mais claros do que deveriam.
> 7. **P2 e P3 (prioridade de lead) ficam com a mesma cor — `warning`.** A
>    Tabela de tradução funde `amber/yellow/orange` num único significado
>    ("atenção"), e o badge já escreve "P2"/"P3" por extenso, então a ordem
>    não se perde, só a pista de cor redundante. Custo se errado: o
>    comercial perde a distinção P2×P3 de relance (vai para as perguntas ao
>    Erick, abaixo).
> 8. **`<linearGradient>` SVG dentro de gráfico recharts, com um token só
>    variando opacidade, fica** — é o tema de gráfico da Fase 1
>    (`chartTheme.ts`), não gradiente decorativo de superfície (a regra
>    global mira utilitário Tailwind `bg-gradient-*`/`from-*`). Custo se
>    errado: a revisão final pede chapar as fatias/áreas.
> 9. **`getPeriodColor` (Madrugada/Noite → `primary`, Manhã/Tarde →
>    `warning`) fica como está** — período do dia é categoria sem
>    significado de bom/ruim, e o chip escreve o nome do período por
>    extenso. Custo se errado: dois pares de período dividem cor; a
>    correção volta junto com a pergunta da paleta de gráfico própria
>    (decisão 2 da Fase 1, abaixo).
> 10. **`getPriorityColor`/`getQualificationColor`
>     (`src/hooks/useLeadQualification.tsx`) traduzidos nesta fase (Tarefa
>     4)** — é hook compartilhado; também alimenta `LeadDetailSheet.tsx`,
>     que é tela do **G2**. Custo se errado: o G2 herda badges já
>     traduzidos antes da hora (só visual, reversível).
> 11. **Escala ordinal Alta/Média/Baixa (`ThemeQualityHeatmap`) foi para
>     `success`/`warning`/`danger`**, não a leitura literal da Tabela (que
>     funde Média/`yellow` e Baixa/`orange` os dois em `warning`) — para
>     não perder a ordem visual de 3 degraus, exatamente o defeito que o
>     Review Focus 3 vigia. Custo se errado: reverter perde a distinção
>     Média×Baixa.
> 12. **Grade D do ranking de campanhas corrigida de `warning` para
>     `danger`** (fix da revisão da Tarefa 7) — a legenda do próprio
>     arquivo já agrupava "Grade D/F" num bullet e "Grade C" em outro; D e F
>     ficaram idênticos (`danger`), C sozinho em `warning`. Custo se errado:
>     o badge da grade discordaria da legenda escrita ao lado dela.
> 13. **Os dois ícones "copiado" do `LeadDetailModal` usam `text-success`
>     direto** (não `--on-tint-success`) — mesma exceção do item 6 (ícone
>     pequeno de ação/feedback), contraste gráfico 3:1 é suficiente ali.
>
> **Dívida anotada** (nada corrigido, registrada para quando alguém tocar o
> arquivo de novo):
> - `KPICards.tsx:56` — prop `glowColor` morta (pré-existente); tirar
>   mudaria a API do componente.
> - `OverviewTab.tsx` — imports/variáveis não usados, pré-existentes.
> - `ChannelInsights.tsx:246-247` — ramos `info`/`alert` em `bg-*/10
>   border-*/20` (pré-existente, já token, só fora do desenho canônico
>   `--tint-*`).
> - `CampaignTimeAnalysis.tsx:142` — ícone `Target` em `h-5 w-5`, não `h-4`.
> - ~~`ChallengesAIInsights.tsx:388-391`~~ — **corrigido na onda final de
>   24/09** (item 4): hover do botão "Respostas Destaque" virou
>   `hover:bg-warning/20` (era `hover:bg-[--tint-warning]`, igual à base,
>   sem mudar de tom).
> - `ThemeQualityHeatmap.tsx` — legenda numa rampa de `primary`, dissociada
>   das colunas `success/warning/danger` (pré-existente).
> - `ChallengeThemesChart.tsx:94` — destructure de `color` morto
>   (pré-existente).
> - `RecommendationsSection.tsx:88-90` — badge de impacto ficou maior (`span
>   text-[10px]` → `Badge text-xs`); sancionado pelo próprio brief.
> - **A 390 px, `/` e `/analytics?tab=insights` rolam horizontalmente** (169
>   px e 78 px) — pré-existente, não desta fase: `LeadsLineChart.tsx`
>   (toggle "Por Dia"/"Por Horário") não foi tocado por nenhuma tarefa;
>   `CampaignRankingTable.tsx` só mudou cor. Fica para quem mexer em layout
>   responsivo.
> - `src/hooks/useLeadStatuses.ts:6` — `FALLBACK_COLOR = '#888780'` (hex
>   fora de token), único ponto do guarda em `src/hooks`; fora do escopo de
>   telas do G1.
> - **O guarda não enxerga gradiente/brilho escrito com token** (`bg-gradient-*`,
>   `from-card`, `drop-shadow(0 0`) — foi assim que o `LeadsListSheet`
>   escapou até a revisão final. Proposta para o G2: contar isso no guarda
>   ou no portão do grupo.
> - **Chip clicável não tem padrão único** (`Badge` sem estado de hover) —
>   decidir antes do G2.
> - **`TopResponsesCard`: tema "Estratégia" em `destructive` (vermelho) por
>   matiz** — lê como alerta.
>
> ### Onda de conserto — revisão final da branch, 24/09/2026
>
> A revisão da branch inteira (`e9398f3..0d186d0`, 10 commits, 47 arquivos
> de `frontend/`) achou nove defeitos pequenos — só classe/token, nenhuma
> lógica — que as sete revisões por tarefa não viram. Todos corrigidos na
> própria branch:
>
> - `insights/TemporalHeatmap.tsx`: a faixa 30–39 saía mais clara que a
>   40–49 (`warning/70` < `warning/80`), invertendo a rampa — virou
>   crescente com a piora: 50–59 `bg-warning/60`, 40–49 `bg-warning/80`,
>   30–39 `bg-warning` cheio.
> - `LeadsListSheet.tsx`: gradiente (`from-card via-card to-primary/5
>   border-border/50`) e badge com cor solta (`bg-primary/10 text-primary`)
>   saíram — `SheetContent` ficou só com classe de layout e o badge virou
>   `variant="default"`, mesmo tratamento do `DialogContent` do
>   `LeadDetailModal`.
> - `GlobalFilters.tsx`: os chips de filtro ativo perderam o hover ao virar
>   `Badge` por variante — cada um ganhou o hover do seu par
>   (`hover:bg-info/20`, `hover:bg-success/20`, `hover:bg-warning/20`,
>   `hover:bg-primary/20`); o chip de Qualificação (mistura Hot/Warm/Raw,
>   sem significado único) virou `secondary` + `hover:bg-surface-elevated`.
> - `ChallengesAIInsights.tsx`: hover do botão "Respostas Destaque" virou
>   `hover:bg-warning/20` (era igual à base, não mudava de tom); o item de
>   histórico selecionado voltou a ter `border-primary` cheio, não `/30`.
> - `ChannelInsights.tsx`, `ChannelKPICards.tsx`, `HourlyConversionChart.tsx`:
>   ramos que ficaram fora do desenho canônico (`bg-x/10 border-x/20`)
>   normalizados para `bg-[--tint-x] border-x/30` (regra 9 do controlador).
> - Caixas de ícone de título em `bg-primary/20`/`bg-info/20` (8 arquivos
>   de `profile/`, `tactical/`, `operational/`) viraram
>   `bg-[--tint-primary]`/`bg-[--tint-info]`; os tooltips de gráfico (8
>   `CustomTooltip` de recharts em `challenges/`, `operational/` e
>   `profile/`) unificados num desenho só — `bg-popover border
>   border-border shadow-lg`, sem `/95` nem `bg-background` — mantendo
>   padding, raio e tipografia de cada um.
> - `PriorityLeadsTable.tsx`: o ícone `Flame` de hotlead estava em
>   `text-warning` — virou `text-success` (Hot = success em todo o app).
> - Texto branco sobre preenchimento claro (contraste abaixo de 3:1):
>   `SalesReadinessFunnel.tsx` (barras `warning-500`/`slate-400`, novo
>   campo `textClass` por estágio), `TopResponsesCard.tsx` (número do
>   ranking sobre `bg-warning`) e o ícone do KPI "Leads na Semana"
>   (`overview/KPICards.tsx`) trocaram `text-primary-foreground` por
>   `text-[--color-slate-900]` — contraste medido subiu de 2,15:1
>   (branco/warning) e 2,56:1 (branco/slate-400) para 8,31:1 e 6,96:1,
>   igual nos dois temas porque os dois tons são fixos por design.
> - `overview/QualificationGauge.tsx`, `SourceBarChart.tsx`,
>   `DistributionPieChart.tsx`: `drop-shadow(0 0 …)` de brilho decorativo
>   saiu dos arcos/barras/fatias.
>
> ### Decisões que esperam o Erick
>
> Continuam abertas as da Fase 1 (ver bloco "✅ Visual — Fase 1" abaixo): o
> desencontro de altura botão×campo, as duas colisões de cor de gráfico
> (paleta própria de 6 cores para 9+ categorias, com 3 delas coincidindo com
> tokens semânticos), e as seis de 23/09 (fluxo em rascunho, recálculo/sync
> disparando automação, peso 0 no A/B, conta Unlayer `dnmkt`, colunas de
> funil da dn.ia, cor do botão das landing pages). **Duas novas dependem da
> mesma pergunta da paleta de gráfico (decisão 2 da Fase 1):** P2×P3
> dividindo cor (item 7 acima) e os chips de período do dia dividindo cor
> (item 9 acima) — as duas só resolvem "de verdade" se o Design System
> ganhar mais tons semânticos ou uma paleta de categoria maior.
>
> **Próximo passo: G2** — Contatos, a ficha de contato e Importação, onde
> estão **26 dos 63** `white`/`black` que o guarda só passou a contar na
> Tarefa 1 desta fase.

> ## ✅ Visual — Fase 1 (casca, primitivos, gráficos), 23/09/2026
>
> **A Fase 1 fechou.** Branch `visual-fase-1` (a partir de `main` `2e39aae`),
> **não mergeada** — o merge é decisão do Erick. As sete tarefas do plano
> `docs/superpowers/plans/2026-09-22-marketinghs-visual-fase-1-casca-primitivos.md`
> saíram; o spec que governa continua sendo
> `docs/superpowers/specs/2026-09-22-marketinghs-visual-design-system-design.md`.
> O bloco "🌅 Comece por aqui — 23/09" logo abaixo descreve a manhã em que a
> fase ia **começar**; ela terminou no fim do mesmo dia.
>
> **O que entrou, tarefa a tarefa:**
>
> | Commit | O que entrou |
> |---|---|
> | `4267b03` | Primitivos de base — botão, card, badge, rótulo, aviso, progresso, esqueleto, separador |
> | `780a641` | Campos de formulário (10 arquivos) + conserto da geometria do interruptor (trilho 48×28, polegar 20 px, curso 20 px, recuo 4 px nos quatro lados) |
> | `aadae50` | Sobreposições, tabela e abas (13 arquivos) + conserto do contorno duplo do `Command` (a raiz não desenha mais borda/sombra; o hospedeiro é quem desenha) |
> | `6eaeef7` | A casca — sidebar 256/72 px, topbar de 64 px, `ChaveDeTema` — e 6 consertos: topbar `sticky top-0 z-30`, overlay em `--overlay`, gradiente fora da bolha do assistente, rodapé recolhido, divisor em `border-border`, hover com guarda de desabilitado |
> | `b9bf289` | `/login` e as duas telas de fora (`/descadastrar`, `/templates/:id/preview`) |
> | `a95e5dc` | Tema único de gráfico (`src/lib/chartTheme.ts` + `--grafico-1..6` no `index.css`, 14 gráficos) + conserto de Hot/Warm/Raw |
>
> **Uma mudança visível fora do escopo declarado:** a bolha do usuário no
> Assistente de dados trocou o gradiente (`from-primary to-info`) por
> `bg-action` chapado. Foi decisão do controlador na Tarefa 4 — o gradiente
> feria a regra global de cor e o guarda provadamente não o enxerga. É a única
> coisa que muda de aparência sem ter sido pedida; reversível numa linha.
>
> **Placar do guarda: 929 → 825.** Por área, o que mudou: `ui` 8 → **5**,
> `dashboard` (com as subpastas) 484 → **389** — os 14 gráficos foram de 99 a
> **0** —, `admin` (raiz) 35 → 31, `dashboard/profile` 33 → 7,
> `dashboard/overview` 94 → 61, `dashboard/operational` 68 → 46,
> `dashboard/challenges` 129 → 115, `src/pages` (raiz) 2 → **0**
> (`Descadastrar.tsx`). `src/pages/admin` segue **66**, intocado — é a Fase 2.
>
> **Portão (Tarefa 7), conferido em 23/09:** `tsc --noEmit -p tsconfig.app.json`
> com os mesmos **4** erros pré-existentes (`LeadScoringSettings` ×1,
> `useJourneys` ×3), nenhum novo; `vite build` e `build:landing` passando; os
> **7 hashes** do Design System conferindo com o `ORIGEM.md`; `card.tsx` sem
> nenhum `shadow-`; nenhum `active:scale`/`backdrop-blur` novo (os três
> `backdrop-blur-[4px]` que o diff acrescenta são o do overlay de modal, que a
> tabela oficial pede). **15 das 16 telas** abertas nos dois temas, a 1440 px
> — `/pages/<slug>/edit` ficou **sem dado** de novo (a tabela `pages` está
> vazia), como na Fase 0. Capacidade por capacidade (`git diff main`, 50
> arquivos): toda linha é classe, cor, medida ou comentário — **nenhuma
> mudança de API, de estrutura Radix ou de lógica**; nenhum `export`, nome de
> prop, nome de variante ou `displayName` foi tocado em `components/ui/`.
> Zero erro de console novo; o único visto é o `Function components cannot be
> given refs` do `DniaIdChip`, já registrado na Fase 0.
>
> ### Telas com título duplicado — insumo da Fase 2, não defeito
>
> A topbar nova escreve o título da rota; onze telas continuam escrevendo o
> seu no corpo. Não se mexeu em nenhuma: a remoção é trabalho da Fase 2.
>
> | Rota | Topbar | Corpo |
> |---|---|---|
> | `/contacts` | Contatos | "Contatos" |
> | `/segments` | Segmentos | "Segmentos" |
> | `/campaigns` | Campanhas | "Campanhas" |
> | `/automations` | Automações | "Automações" |
> | `/automations/fluxos/:id` | Fluxo | `{journey.name}` (textos diferentes, duas áreas de título) |
> | `/import` | Importar | "Importar" |
> | `/settings` | Configurações | "Configurações" |
> | `/templates` | Templates | "Templates de email" |
> | `/experiments` | Testes A/B | "Testes A/B" |
> | `/experiments/setup` | Configurar teste A/B | "Configuração & Instruções — Teste A/B" |
> | `/experiments/:id` | Teste A/B | `{test.name}` |
>
> Onde a tela não tem título próprio (`/`, `/analytics`, `/pages`,
> `/pages/:slug/edit`, `/templates/new`, `/templates/:id/edit`) não há
> duplicação.
>
> ### Dívida anotada
>
> **⚠️ O guarda visual tem ponto cego — o "0" dele não prova ausência de cor
> literal.** A regex `LITERAL` de `scripts/guarda-visual.mjs:36` exige família
> de cor **com número** (`bg-blue-600`), então `bg-white`, `bg-black`,
> `text-white`, `text-black` e as bordas equivalentes passam invisíveis.
> Descoberto duas vezes durante a fase (Tarefas 2 e 4) e confirmado no portão:
> um `grep` manual em `ui/`, `components/admin/` e `pages/` acha **43**
> ocorrências que o guarda nunca contou — nenhuma em arquivo que esta fase
> tocou. **Proposta para a Fase 2:** acrescentar `|white|black` à alternância
> de famílias da regex e tratar o número como opcional para esses dois, o que
> traz as 43 para o placar de uma vez (e sobe o número de partida da Fase 2).
> Enquanto isso, o `grep` manual continua obrigatório em toda tarefa:
> `grep -rn "bg-black\|bg-white\|text-white\|text-black\|border-white\|border-black" src/... --include=*.tsx`
>
> **✅ Resolvido em 24/09/2026, na Tarefa 1 da Fase 2** (branch
> `visual-fase-2`): a regex `LITERAL` passou a aceitar `white`/`black` sem
> número. Placar de partida da Fase 2, com o ponto cego agora visível: **888**
> no total do app (825 + 63 que o guarda não via) e **398** em
> `src/components/admin/dashboard`.
>
> - **Os 5 pontos que restam em `src/components/ui` são falso-positivo.** Os
>   cinco estão na mesma linha, `chart.tsx:48`, e são **seletores CSS** do
>   recharts (`[&_.recharts-cartesian-grid_line[stroke='#ccc']]`,
>   `[&_.recharts-dot[stroke='#fff']]`, `[&_.recharts-polar-grid_[stroke='#ccc']]`,
>   `[&_.recharts-reference-line_[stroke='#ccc']]`,
>   `[&_.recharts-sector[stroke='#fff']]`): casam a cor que o recharts desenha
>   sozinho para então sobrescrevê-la por token. Não é cor aplicada.
>   `chart.tsx` não entrou em nenhuma tarefa da fase. **Pergunta da Fase 2:**
>   o `ChartContainer` do shadcn ainda se justifica depois do `chartTheme.ts`?
>   Se não, o arquivo sai e os 5 somem juntos.
> - **`src/components/admin/LeadsChart.tsx` é código morto** — nenhum
>   importador, conferido com busca que não prende tipo de aspa. É o único
>   consumidor do `chart.tsx`. Candidato a remoção na Fase 2; as duas coisas
>   caem juntas.
> - **O gradiente banido sobrou no botão de enviar do assistente**
>   (`AIDataChat.tsx:128`, `bg-gradient-to-r from-primary to-info`). É irmão
>   do que foi tirado da bolha na Tarefa 4 e ficou fora do ruling, que falava
>   só da bolha. Mesmo arquivo, mesma família de defeito.
> - **As larguras de modal da tabela oficial não existem como variante.** A
>   tabela pede sm 384 · md 448 · lg 512 · xl 672 · 2xl 768; o `DialogContent`
>   tem `max-w-lg` fixo e cada tela sobrescreve por classe. Criar a variante
>   seria API nova, proibida nesta fase. Decisão da Fase 2.
> - **Card clicável sem afordância.** A tabela oficial diz que o card clicável
>   troca a borda por `--action` no hover; `card.tsx` não tem prop para isso e
>   criar uma feriria "a API não muda". Fica para a Fase 2, onde as telas
>   podem passar a classe elas mesmas.
> - `input.tsx` perdeu as classes `file:*` ao ser reescrito. Não quebra nada
>   hoje — o único `type="file"` do app (`LeadsImport.tsx:419`) é um `<input>`
>   cru e escondido, não o primitivo.
> - **⚠️ `popover.tsx` passou de `p-4` para `p-1`** (vocabulário de lista
>   flutuante, Tarefa 3) — e **um uso paga por isso**. Dos 25
>   `<PopoverContent>` do app, 24 passam o próprio `p-*` e o tailwind-merge
>   vence; o 25º, `SendTestEmailPopover.tsx:73`, passa só `w-80 space-y-3`.
>   Aquele popover tem formulário dentro (rótulo, campo de e-mail, texto de
>   ajuda e botão "Enviar") e hoje renderiza com 4 px de respiro em vez de 16:
>   o conteúdo encosta na borda. Não é capacidade perdida — é aperto visual —,
>   e não foi visto ao vivo porque os dois gatilhos dele
>   (`EmailTemplatePreviewDialog` e `/templates/:id/preview`) exigem um
>   template no banco, e a tabela está vazia. **Conserto de uma classe**
>   (`className="w-80 space-y-3 p-4"` no uso, ou devolver o padding ao
>   primitivo); deixado para o Erick decidir, porque mexer no primitivo agora
>   sairia do escopo do portão.
> - `select.tsx` — o item marcado perdeu o fundo `bg-primary/10`; hoje marca
>   só pela cor do texto e pelo tique. `command.tsx` — `CommandItem` perdeu
>   `data-[selected=true]:text-accent-foreground` sem substituto, enquanto o
>   `dropdown-menu` manteve o equivalente: vocabulário inconsistente entre as
>   três listas.
> - `alert.tsx` — a variante `default`, que era neutra
>   (`bg-background text-foreground`), virou tinta de informação
>   (`--tint-info`). É o que a tabela oficial pede para "Aviso", mas muda a
>   aparência de todo `<Alert>` sem variante explícita.
> - `table.tsx` — a borda do cabeçalho saiu de `[&_tr]:border-b` para o
>   próprio `thead`. Idêntico com uma linha de cabeçalho, diferente com duas
>   (não há nenhuma hoje).
> - Miudezas registradas e deixadas: `label.tsx` perdeu `leading-none`;
>   `button.tsx` deu borda ao `destructive`, que a tabela só especifica para o
>   primário (mesma cor do fundo, sem efeito); `switch.tsx` mantém `shadow-sm`
>   no polegar, que a tabela de medidas pede e a regra global de sombras não
>   prevê — contradição do próprio documento; `sheet.tsx` mantém duração
>   assimétrica (300 fecha / 500 abre) contra os "300 ms" da tabela;
>   `AIDataChat.tsx:64` usa `shadow-2xl` num painel flutuante (a lista
>   permitida diz `shadow-lg`); `AdminLayout.tsx:119` devolve `''` para rota
>   não mapeada, então rota nova nasce com `<h1>` vazio e sem aviso;
>   `MAIN_ITEMS`/`SYSTEM_ITEMS` e `TITULOS_ROTA` repetem 11 rótulos e podem
>   divergir; `GlobalFilters.tsx:132` ficou com um `div` raiz sem classe, onde
>   cabia fragmento; `Login.tsx:64` repete no `Card` classes que o primitivo
>   já aplica; `ChallengeThemesChart.tsx:181` tem `serie(9)` de fallback, que
>   resolve para `serie(3)` e nunca dispara — forma confusa de escrever "cor
>   de reserva"; a legenda "Volume/Hora" do `LeadsLineChart` trocou um
>   gradiente de duas cores por `serie(0)` sólido; e o aviso de console
>   `Function components cannot be given refs` (`Badge` sem `forwardRef`
>   dentro de `TooltipTrigger asChild`, `badge.tsx` + `DetailSections.tsx`)
>   continua lá, pré-existente.
>
> ### Lacunas de verificação — o que ninguém viu funcionando, e por quê
>
> Nenhuma destas é falha: em todas, ver custaria escrever no banco de
> produção, e a troca não compensa. Ficam para conferência oportunista.
>
> - **As fases com token do descadastro** (`conferindo`, `saindo`, `pronto` —
>   é a `pronto` que ganhou `--tint-success`/`--on-tint-success`). Sem token
>   assinado, `/descadastrar` só renderiza "Link inválido", que foi o que se
>   viu nos dois temas. Gerar token seria escrita.
> - **O cabeçalho preenchido do `TemplatePreview`** — a tabela
>   `email_templates` está vazia (confirmado por GET autenticado), então o
>   `<header>` nunca apareceu com nome e categoria de verdade.
> - **A variante `showHotMetrics` do `LeadsLineChart`** (o `ComposedChart` com
>   barra Hot e linha de Taxa Hot) — provada por leitura de código e pelo
>   diff; não houve combinação de filtro na base atual que a fizesse aparecer.
> - **O `AlertDialog` e o avisador (`sonner`)** — todo gatilho deles no app é
>   ação destrutiva (excluir, arquivar) ou de escrita, e a regra do navegador
>   proíbe clicar. Provados por leitura de código nas Tarefas 3 e 7.
> - **`/pages/<slug>/edit`** — sem dado (`pages` vazia), pulada, como na
>   Fase 0.
> - Em toda tela, "nenhuma capacidade sumiu" quer dizer **o botão existe, está
>   habilitado e no lugar** — não que ele funciona. Onde só o clique provaria,
>   o portão registra "presente, não exercitado".
>
> ### Onda de conserto — revisão final da branch, 23/09/2026
>
> A revisão da branch inteira (13 commits, 54 arquivos), antes do merge, achou
> **zero Crítico** — nenhuma API mudou, nenhum comportamento mudou — mas
> catorze regressões visuais que as sete revisões por tarefa não viram, quase
> todas a mesma família: um primitivo mudou de medida e o consumidor não
> acompanhou. Todas corrigidas na própria branch:
>
> - `ColumnSelector.tsx`: botão "Colunas" da barra de `/contacts` 6 px mais
>   baixo que os vizinhos — ganhou `h-9`, como os outros três.
> - `AdminSidebar.tsx`: item ativo perdia a tinta ao passar o mouse — o hover
>   agora só entra quando `!active`, igual ao submenu.
> - `checkbox.tsx`: tique de 16 px cortado numa caixa que encolheu para 14 —
>   virou `h-3 w-3`.
> - `DistributionPieChart.tsx`: halo da rosca em "/" virou cor cheia na troca
>   de tema de gráfico — voltou a ter 30% de alfa, via `color-mix`.
> - `AIDataChat.tsx`: o botão de enviar manteve o gradiente que a Tarefa 4
>   tirou da bolha — foi para `bg-action`.
> - `design-system/ORIGEM.md`: registrada a pergunta nova sobre a paleta de
>   série usar cores semânticas (ver decisão 2 abaixo).
> - `RevenueDistribution.tsx`: a faixa de faturamento (ordinal) tinha virado
>   paleta categórica — voltou a ser rampa de opacidade sobre `serie(0)`,
>   como o `TopKeywordsChart`; saiu também o gradiente e o `shadow-lg` do
>   `Card`.
> - `SendTestEmailPopover.tsx`: popover com formulário ficou com 4 px de
>   respiro quando `popover.tsx` virou lista flutuante — devolvido o `p-4`
>   no uso, como os outros 24 `<PopoverContent>` do app.
> - `table.tsx`: a régua do cabeçalho saía na cor errada porque a borda da
>   própria linha vencia a do `thead` — `TableHeader` ganhou
>   `[&_tr]:border-b-border`.
> - `select.tsx`: padding do viewport (`p-1.5`) fora de passo com
>   popover/dropdown/command (`p-1`) — igualado.
> - `dropdown-menu.tsx`, `select.tsx`, `command.tsx`: três vocabulários
>   diferentes para a cor do item realçado — todos foram para
>   `text-conteudo-heading`, sem trocar o modificador de cada um.
> - `badge.tsx`: anel de foco sem offset, terceira forma de anel do conjunto —
>   ganhou `ring-offset-2`/`ring-offset-background`.
> - `ChallengeThemesChart.tsx`: fallback de cor caía no vermelho de perigo
>   (`serie(9)`) — trocado por `serie(0)`.
> - `glowing-effect.tsx`: órfão que o spec já mandava tirar na Fase 1 e o
>   plano não abriu tarefa para isso — confirmado sem importador (grep sem
>   prender tipo de aspa) e apagado.
>
> **Fica para a Fase 2** (dívida registrada, nada mexido): o desencontro
> `leading-tight`/`text-sm` de botão e campo (decisão nova abaixo); o
> `shadow-2xl` do painel do assistente; as larguras de modal sem variante; a
> duração assimétrica da gaveta; o `p-6` do Content de modal/gaveta em vez de
> cabeçalho/corpo; os dois `<h1>` por página; o header de `sheet`/`dialog`; as
> duas fontes de verdade do mapa de rotas; os `YAxis` sem cor de série; o
> e-mail do usuário escondido abaixo de 640 px; a cor semântica em
> `style={{}}` inline em vez de classe; e o `Badge` sem `forwardRef`.
>
> **Contradição spec × plano, para a próxima pessoa não tropeçar:** o spec
> pede fundo `--surface-elevated` no cabeçalho da tabela; o plano pede "sem
> fundo". Implementou-se o plano — o `thead` de `table.tsx` não tem
> `bg-*` nenhum.
>
> ### Decisões que esperam o Erick (a nova é a primeira)
>
> 1. **Desencontro de altura entre botão e campo — 35,5 px contra 38 px.** O
>    `leading-tight` do botão e o `text-sm` do campo vêm os dois da tabela de
>    medidas oficial, e ela não concilia os dois. Hoje passa despercebido
>    porque toda tela que põe botão ao lado de campo passa `h-9` na mão nos
>    dois — é essa muleta que a Fase 2 remove; quando remover, o desencontro
>    aparece. Pergunta ao oficial, não conserto de código.
> 2. **Duas colisões de cor de gráfico — 9 categorias contra 6 cores.** Não é
>    descuido: o Design System oficial **não tem paleta de gráfico**, o
>    `chartTheme.ts` inventou seis (`--grafico-1..6`) e `serie(i)` usa
>    `i % 6`, então a 7ª, 8ª e 9ª categorias repetem a 1ª, 2ª e 3ª. Medido com
>    `getComputedStyle` nos dois temas: em **Desafios → Temas**
>    (`ChallengeThemesChart`) IA/Automação = Estratégia, Conhecimento =
>    Equipe, Ferramentas = Outros; em **Perfil → Setores Identificados**
>    (`SectorDistribution`) Outros = Consultoria, Tecnologia = Educação,
>    Indústria = 2º "Outros" (os nomes dependem da ordem do dado; a colisão,
>    não). Duas fatias de significados diferentes saem com o mesmo pixel.
>    Opções: pedir uma paleta de gráfico ao projeto oficial (o caminho certo,
>    e já registrado em `ORIGEM.md`); esticar as seis com variações de
>    luminosidade; ou aceitar a repetição e agrupar a cauda em "Outros" de
>    verdade. Nada foi mexido.
>    **Segundo defeito, achado na revisão final e diferente deste:** as
>    seis cores de série não são neutras — `--grafico-2/3/4` são
>    `warning-500`, `success-500` e `danger-500`. Em "Top 10 Cargos"
>    (`/analytics?tab=profile`), "Gerência" sai verde de sucesso e
>    "Especialista" sai vermelho de perigo, sem que o dado diga isso.
>    Registrado em `ORIGEM.md`; a pergunta ao oficial é a mesma dos dois
>    problemas: uma paleta de gráfico própria, sem as cores semânticas.
> 3. Continuam abertas as seis decisões listadas no bloco de 23/09 abaixo
>    (fluxo `d6bb2185…` em rascunho, recálculo/sync disparando automações,
>    peso 0 no A/B, conta Unlayer `dnmkt`, colunas de funil da dn.ia, cor do
>    botão das landing pages).
>
> **Próximo passo: Fase 2** — as telas. É onde entram os 825 pontos restantes
> do guarda (com `src/pages/admin` em 66 e `dashboard/challenges` em 115 na
> frente), a remoção dos onze títulos duplicados, a correção da regex do
> guarda e a limpeza do `chart.tsx`/`LeadsChart.tsx`.

> ## 🌅 Comece por aqui — 23/09/2026
>
> **O que fazer hoje:** executar a **Fase 1 do visual** (casca, login,
> primitivos, gráficos). O plano está escrito e commitado:
> `docs/superpowers/plans/2026-09-22-marketinghs-visual-fase-1-casca-primitivos.md`,
> na branch **`visual-fase-1`** (a partir de `main` `2e39aae`, só o commit do
> plano). Abra a sessão dentro do repo, use
> `superpowers:subagent-driven-development` e comece pela Tarefa 1.
> O spec que governa é
> `docs/superpowers/specs/2026-09-22-marketinghs-visual-design-system-design.md`.
>
> **Onde tudo está:** `main` = `2e39aae`, igual ao `origin/main` (nada
> pendente de push). A travessia do remix **acabou** no lote 8E; o que corre
> agora é o visual.
>
> **Regra nova, nascida de um acidente em 22/09:** no navegador, o Claude só
> navega por URL, lê, usa o console e abre diálogo/menu de visualização —
> **nunca clica em botão de ação** (salvar, arquivar, excluir, ativar, enviar,
> ícone sem rótulo em linha de lista). Id de registro se descobre por leitura
> (GET na API ou `SELECT` no psql), nunca clicando na tela.
>
> ### Decisões que esperam o Erick
>
> 1. **Fluxo "Conferência lote 4"** (`d6bb2185-c1b1-4a3c-a585-7d8ae173b180`):
>    estava **Pausado**, um clique acidental o arquivou, e "Desarquivar" o
>    deixou em **Rascunho** (`draft`), que é o estado de hoje. Rascunho não
>    dispara nada. Opções: deixar assim; o Erick ativar e pausar pela tela; ou
>    um script SQL `draft` → `paused` (sem passar por ativo, para não arriscar
>    disparo) que ele roda no Konsole.
> 2. **Recálculo de pontuação e sync do DataCore** disparam as regras de
>    automação e podem mandar muitos leads ao comercial de uma vez, inclusive
>    clientes do ERP (8D). Deve ser assim, ou os dois ficam fora?
> 3. **Peso 0 numa variante de teste A/B** vale 1, como na origem — deve
>    significar "sem tráfego"? (8C)
> 4. **Projeto Unlayer `dnmkt`** (id 288591), usado pelo editor de e-mail: a
>    conta é da Health & Safety ou da dn.ia? (8E)
> 5. **Colunas de funil da dn.ia** na tela de Contatos: viram assunto de outro
>    lote? (8E)
> 6. **Cor padrão do botão das landing pages** ainda é o vermelho da dn.ia
>    (`#E41A11`, `PageConfigEditor.tsx`): troca pelo azul da marca? Mexe na
>    landing, por isso é decisão do Erick (Fase 2 do visual, grupo G5).
>
> ### Pendências combinadas, para quando o sistema estiver no ar
>
> - **Apagar a conta admin do Claude** (`claude.dev@example.com`) — combinado
>   para o fim; o Erick pediu em 22/09 para manter até tudo estar pronto.
>   Redefinir também a senha de `erick@healthsafety.com.br`, que se perdeu.
> - **Ligar o GrowthHS** (chave, `board_id`, URL base em Configurações →
>   GrowthHS) quando o endpoint do lado dele existir — ver
>   `docs/contratos/2026-09-02-endpoint-card-comercial-growthhs.md`.
>
> ### O dia 22/09 em uma linha cada
>
> - **Lote 8D** (handoff ao GrowthHS): portão fechado e mergeado. Suíte
>   **360 testes**.
> - **Lote 8E** (limpeza final): portão fechado e mergeado — **a travessia
>   acabou**. Saíram o toco do Supabase, `backend/supabase/`, os rastreadores
>   de terceiro do `index.html`, as dependências e a marca dn.ia visível.
>   Placar final: **47 functions portadas, 7 descartadas, restam 0**.
> - **Visual, Fase 0** (fundação): tokens oficiais copiados do Claude Design,
>   ponte shadcn → tokens, tema claro/escuro, guarda visual. Mergeada.
> - **Visual, Fase 1**: spec e plano escritos; execução começa agora.

> ## ✅ Visual — Fase 0 (fundação), 22/09/2026
>
> **A fundação visual entrou.** O Design System oficial da Health & Safety
> (`frontend/src/design-system/`, cópia byte a byte do projeto
> `ef9f35f6-3af0-4651-9dee-45d08884432a`, `ORIGEM.md` com os hashes) está no
> repositório; `index.css` virou a ponte shadcn → tokens (de 885 para 53
> linhas); o Tailwind aponta pros tokens (`cor()`/`color-mix`); as classes de
> efeito da dn.ia saíram (`theme-dnmarketing`, `theme-fev2425`, `glass-card`,
> `ds-card`, `font-[Rajdhani]`); o tema tem claro por padrão e escuro pela
> classe `dark` no `<html>` (`src/lib/tema.ts`, chave `marketinghs-tema`,
> script anti-piscada no `index.html`); e o guarda visual
> (`npm run guarda:visual`) mede cor fora de token por pasta. Branch
> `visual-fase-0` (a partir de `main` `2ae02cf`) — **mergeada em 22/09**
> (fast-forward até `2e39aae`) e empurrada para o `origin/main`. Spec:
> `docs/superpowers/specs/2026-09-22-marketinghs-visual-design-system-design.md`;
> plano: `docs/superpowers/plans/2026-09-22-marketinghs-visual-fase-0-fundacao.md`.
>
> **Placar do guarda (22/09/2026, onda de correção I1): 929** pontos de cor
> fora de token no admin (subiu de 876 porque o guarda passou a contar cor
> numérica — `hsl(`/`hsla(`/`rgb(`/`rgba(` com dígito logo depois do
> parêntese —, além do hex e da paleta literal do Tailwind que já contava;
> exceções: `src/landing/`, `src/design-system/`, `emailEditorConfig.ts` —
> HTML de e-mail enviado). Por pasta:
> `dashboard/challenges` 129 · `settings` 108 · `dashboard/insights` 95 ·
> `dashboard/overview` 94 · `contacts` 79 · `dashboard/operational` 68 ·
> `pages/admin` (é `src/pages/admin`) 66 · `campaigns` 61 · `automations` 40 ·
> `dashboard` 38 · `admin` (raiz) 35 · `dashboard/profile` 33 ·
> `dashboard/tactical` 27 · `components/admin/pages` 24 (rótulo antigo "pages
> (admin)" trocado por este — ficava ambíguo ao lado de `pages/admin`) ·
> `hooks` 22 · `ui` 8 · `pages` (raiz) 2. É o número que as Fases 1 e 2 vão
> reduzir; `npm run guarda:visual -- <pasta>` audita uma área isolada (o
> argumento aceita `./` ou `frontend/` na frente, tira sozinho; código de
> saída 1 se houver dívida, **2** se a área não casar com nenhum arquivo
> `.ts`/`.tsx` — antes disso dava `0`/saída `0`, verde falso pego na revisão
> final, item I1).
>
> **A fonte.** Medido na Tarefa 2: a Plus Jakarta Sans chega ao navegador pelo
> `@import url(...)` de `tokens/typography.css`, sem precisar de `<link>`
> manual no `index.html` (`document.fonts.check('14px "Plus Jakarta Sans"')` =
> `true`, requisição a `fonts.googleapis.com` visível na rede). Não era
> defeito — o item provisório saiu da lista "Defeitos conhecidos" do
> `ORIGEM.md` e virou nota separada.
>
> **O portão da fase (Tarefa 5):** `tsc` com os mesmos 4 erros
> pré-existentes (nenhum novo); `vite build` e `build:landing` passando; os 7
> hashes do Design System conferem; `git diff main --stat` só lista arquivo
> novo em `design-system/`; nenhuma classe/cor da dn.ia restando
> (`theme-dnmarketing`, `glass-card`, `Rajdhani`… todos vazios); **15 das 16
> telas** abertas nos dois temas (Playwright, login com a conta admin do
> Claude) sem erro de console novo — `/pages/<slug>/edit` ficou sem dado no
> banco e foi pulada, o próprio relatório da Tarefa 5 já dizia isso; a frase
> "16 telas" aqui estava errada (item M2 da revisão final); `git diff main`
> fora de `design-system/`/`index.css` só tem classe, o mecanismo de tema
> (`src/lib/tema.ts`, `main.tsx`) ou comentário — nenhuma mudança de lógica,
> rota, API ou texto.
>
> **Onda de correção da revisão final (22/09/2026), 8 itens, todos
> feitos** (`.superpowers/sdd/2026-09-22-marketinghs-visual-fase-0-fundacao/final-review.md`
> → `final-fix-report.md`):
> - **C1** — `--accent` continua = `--surface-elevated` (é o que os
>   primitivos de `ui/` leem para hover de item); nas telas, todo uso de
>   `accent` como COR de marca/série virou `info`: 23 × `var(--accent)` →
>   `var(--color-info-500)` e ~29 classes `text-/bg-/from-/to-/border-accent`
>   → `…-info`, em `LeadsLineChart`, `AIDataChat`, `SegmentFormModal` e mais
>   uns 10 arquivos. Nenhum uso de `bg-accent` como fundo de hover de item foi
>   achado fora de `ui/` — não houve caso a manter. Conferido no navegador:
>   `/analytics` (legenda "Analista" e ícone "Tamanho das Empresas" visíveis)
>   e o cabeçalho do Assistente de dados (gradiente azul, texto branco
>   legível).
> - **C2** — `LeadGoalGauge.tsx` (medidor de meta em `/`, "Mostrar mais
>   detalhes") trocou `var(--chart-2..5)` (indefinidas desde que `--chart-*`
>   saiu do `index.css`) por tokens semânticos: `--color-success-500` (≥100%),
>   `--color-primary-500` (≥70%), `--color-warning-500` (≥40%),
>   `--color-danger-500` (resto). Conferido: o número da meta sai vermelho a
>   0%.
> - **I1** — o guarda (`guarda-visual.mjs`) normaliza o argumento (tira `./` e
>   `frontend/`, tira barra final), sai com código **2** e "Área não
>   encontrada: <área>" se nada casar, e passa a contar cor numérica
>   (`hsl(`/`hsla(`/`rgb(`/`rgba(` com dígito). Placar novo: **929** (era
>   876). Ver placar por pasta acima.
> - **I2** — refotografadas `/`, `/contacts` e `/settings` no viewport exato
>   do "antes" (1440 px em `/`, 1425 px em `/contacts` e `/settings` — os
>   PNGs originais não eram todos 1440), tema claro. Nenhum bloco mudou de
>   posição ou ordem nas três telas; a diferença de altura (`/settings`: 2901
>   → 2868 px, ~1%) é da tipografia do `base.css` oficial, não de layout.
>   Efeitos do `base.css` registrados como insumo da Fase 1 — corpo cai de 16
>   px (padrão do navegador) para 14 px (`body { font-size: var(--text-sm) }`
>   do DS); `h1–h4` ganham `color: var(--text-heading)` e
>   `letter-spacing: -0.01em`; `a:hover` ganha `text-decoration: underline`
>   (especificidade 0,1,1 vence classe de cor sem `hover:`) — todo link do
>   admin sublinha no hover. Nenhum ajustado aqui; decisão é da casca (Fase
>   1).
> - **M1** — `SegmentFormModal.tsx:501`: a sombra arbitrária com espaço
>   (`color-mix(in srgb, ...)`) virou `color-mix(in_srgb,var(--primary)_15%,transparent)`
>   com `_` — conferida presente em `dist/assets/*.css` depois do build.
> - **M2** — números do CONTINUAR corrigidos: `index.css` 885 → **53** linhas
>   (não 46); "16 telas" → "15 das 16 (uma sem dado)"; pasta `components/admin/pages`
>   com rótulo próprio (não mais "pages (admin)", ambíguo ao lado de
>   `src/pages/admin`).
> - **M3** — `--chart-1..5` saíram do `index.css` sem constar na tabela do
>   spec; depois do C2 não sobra consumidor real. `text-chart-2` em
>   `KPICards.tsx:188` e `LeadGoalGauge.tsx:170` nunca teve cor no Tailwind
>   (no-op já no `main`) — anotado para quando a Fase 2 mexer nesses
>   arquivos.
> - **M4** — contraste `--primary-foreground` (branco) sobre `--action` do
>   escuro (~2,7:1, abaixo do AA) registrado em "Defeitos conhecidos do
>   oficial" do `ORIGEM.md`, para o Erick levar ao projeto oficial. Tokens não
>   mudam.
>
> **Não entraram nesta onda** (decisão do controlador): **M5** —
> `/descadastrar` e `/templates/:id/preview` ficaram fora das 16 telas do
> portão; `Descadastrar.tsx` usa só classes de token (baixo risco). Fica como
> insumo para a Fase 1 dar uma olhada rápida no navegador. **M6** —
> `ui/sidebar.tsx:421` (`hsl(var(--sidebar-*))`, variáveis inexistentes, sem
> importador) segue adiado, como já estava.
>
> **Dívida visual anotada no Step 2** (não é falha desta fase — é insumo para
> a Fase 1/2, nada foi corrigido aqui):
> - `src/components/ui/sidebar.tsx:421` usa `hsl(var(--sidebar-border))` e
>   `hsl(var(--sidebar-accent))`, variáveis que não existem em `src/index.css`
>   nem em `design-system/` — mas o componente não tem importador em `src/`
>   hoje. Se algum dia for importado, resolver a sintaxe e as duas variáveis
>   juntas.
> - `src/components/admin/campaigns/CampaignWizard.tsx:647` —
>   `backgroundColor: '#075E54'` no preview de WhatsApp do wizard (mockup de
>   marca de terceiro, não e-mail nem landing). Fica contado no guarda;
>   decisão de tratar como exceção ou não fica para o grupo G3 da Fase 2.
> - `src/components/admin/pages/PageConfigEditor.tsx:209/214` —
>   `config.cta_color || '#E41A11'`, valor padrão (vermelho da dn.ia) do
>   color picker do CTA da landing pública. Fica contado no guarda; decisão de
>   mover para token ou manter como fallback de dado fica para o grupo G5 da
>   Fase 2.
> - Aviso de console pré-existente, sem relação com cor/tema: `Warning:
>   Function components cannot be given refs` ao abrir a ficha de um contato
>   (`Badge` dentro de `DniaIdChip`, `DetailSections.tsx`) — não foi tocado
>   por esta fase, registrado para o Erick decidir se abre item à parte.
>
> **Próximo passo: Fase 1** — casca (topbar, sidebar), `/login`, primitivos
> (os 5 portais — dialog/select/popover/dropdown-menu/sheet — já saíram do
> fundo cravado na Tarefa 2, mas seguem sem restilo próprio) e `chartTheme.ts`
> (paleta de gráfico que falta no Design System oficial, ver "Defeitos
> conhecidos" no `ORIGEM.md`).

> ## ✅ Sub-lote 8E (limpeza final) — portão fechado, 22/09/2026
>
> **A travessia acabou.** O MarketingHS não tem mais arquivo, dependência,
> chamada de rede nem marca da origem na tela — frase que só ficou verdadeira
> depois da onda de correção final (rodada 2, abaixo): faltava o `bun.lock`
> (texto, além do binário já apagado) e `docs/ROADMAP_dnmarketing.md`. Branch
> `lote-8e` (a partir de `main` `193bbcc`) — **mergeada em 22/09**
> (fast-forward até `193bbcc`) e empurrada para o `origin/main`. Plano:
> `docs/superpowers/plans/2026-09-22-marketinghs-lote-8e-limpeza-final.md`.
>
> **O que saiu — as cinco frentes:**
> 1. **A casca** — `index.html` reescrito do zero no molde do HS.OS (título
>    "MarketingHS — Marketing da Health &amp; Safety", ícone `hs.ico`); saíram
>    o Meta Pixel, o Google Analytics / Tag Manager, o rastreador do Supabase
>    (que disparava o `get-tests`) e o do Lovable, o CSS da landing da dn.ia,
>    `og:*`/`twitter:*`. `robots.txt` passou a `Disallow: /`. Saíram de
>    `public/` o `favicon.png`, o `placeholder.svg` e duas imagens da dn.ia.
> 2. **O toco** — `src/integrations/supabase/` apagada; o `LimiteDeErro` ficou
>    só como error boundary. `@supabase/supabase-js` e `lovable-tagger` saíram
>    do `package.json`; `bun.lockb` **e** `bun.lock` saíram (o lockfile é o
>    `package-lock.json` — o Lovable tinha deixado os dois, o binário e o de
>    texto; só o binário saiu na rodada 1); 34 arquivos sem importador saíram
>    de `src/assets` (fotos da dn.ia e `.asset.json` do Lovable).
> 3. **A marca** — logo da casa (`logo-hs-padrao.png` do HS.OS →
>    `frontend/src/assets/logo-hs.png`) na barra lateral, no login e na
>    Documentação da API; "Assistente de dados"; chip "ID do contato"; modelo
>    padrão de e-mail em nome da Health & Safety; card do webhook explicando
>    que o token é o `WEBHOOK_SECRET` do servidor; OpenAPI renomeado e movido
>    para `public/openapi/marketinghs-api.yaml` (nasceu em `public/api/`, que
>    colidia com o proxy `/api` do backend — os dois links da tela ("Swagger
>    UI", "OpenAPI YAML") davam 404; movido e conferido no navegador na rodada
>    2). No mesmo arquivo, o enum `action_type` de automações ainda
>    documentava as ações do Nexus — corrigido para as do GrowthHS
>    (`create_in_growthhs`, `move_stage_growthhs`, `block_growthhs`), que é o
>    que o backend aceita desde o 8D; o enum de `source_app` passou a listar
>    `marketinghs` (o backend já aceitava, a documentação não citava), e os
>    exemplos que respondiam `source_app: "nexus"` / `ecosystem.dnmarketing`
>    viraram `"website"` / `ecosystem.marketinghs`. Os guias "Nexus — passo a
>    passo" e "mentor.ia — passo a passo" saíram da tela de Documentação da
>    API.
> 4. **Nexus e mentor.ia fora da tela** — pílulas reduzidas a "M ·
>    MarketingHS" e "G · GrowthHS"; o filtro de histórico ficou `Todos` ·
>    `MarketingHS` · `Website`, e "MarketingHS" casa `source_app`
>    `marketinghs` **e** `dnmarketing` (os eventos herdados continuam no
>    filtro); o card "mentor.ia" de Configurações saiu. **Filtros que saíram:**
>    o controle "PLATAFORMA" inteiro do painel de filtros (Todas / No Nexus /
>    No mentor.ia / Nos dois) e os chips "Plataforma: Nexus/mentor.ia"; os
>    checkboxes "No Nexus" / "No mentor.ia" da barra de filtros. **Exportação:**
>    as flags N e M saíram da coluna combinada "Ecossistema" — que já era
>    sempre vazia antes (nenhum código preenche `has_nexus`/`has_mentoria`/
>    `has_dnia`). Também saíram: a seção "dn.nexus" da configuração do A/B
>    (`ExperimentsSetup.tsx`), "dnMarketing" e "DN.IA" da tela de chaves de
>    API, "(Nexus)" do evento "Atividade criada" nos segmentos, o domínio
>    `dnia.ai/` do preview de slug de página nova, e uma segunda
>    `EventsTimeline` morta em `DetailSections.tsx` (nunca importada).
> 5. **A especificação e a documentação da origem** — `backend/supabase/`
>    (o que restava: `config.toml` e `functions/_shared/`), `docs/ab-testing/`
>    (documentação do A/B da dn.ia, `go.dnia.ai`, Supabase) e
>    `docs/ROADMAP_dnmarketing.md` (roadmap do "AI Fastlane") apagados. O
>    `CLAUDE.md` registra o fim da travessia — inclusive onde o worker
>    realmente mora (`app/worker.py`, não a pasta `worker/` que nunca existiu)
>    e sem falar do motor de fila como futuro do lote 3, que já é passado.
>
> **Decisões do Erick (22/09):**
> - **E1** — nenhum rastreador do `index.html` é da Health & Safety; saem
>   todos. Rastreamento de landing continua por página (`pages.config`,
>   `useClarity`).
> - **E2** — Nexus e mentor.ia saem da interface; **colunas e dados do banco
>   ficam** (0 de 2.084 identidades com `nexus_contact_id` ou
>   `mentoria_client_id`; 2 de 3.303 `contact_events` com `source_app='nexus'`).
> - **E3** — modelo padrão de e-mail com "Health & Safety" e
>   `https://healthsafety.com.br` no lugar de "DN.IA" / `https://dnia.ai`.
> - **E4** — o assistente de IA do painel se chama "Assistente de dados".
>
> **Templates no banco com "DN.IA"/"dnia.ai": 0** — a tabela
> `email_templates` está vazia, então o número não prova nada sobre o
> passado. Nenhum dado foi tocado; banco e backend não mudaram neste lote.
>
> **Sobra deixada de propósito (decisão 12):** o backend ainda aceita e
> devolve os filtros/campos de Nexus e mentor.ia (`leitura_contatos.py`), e
> `/publico/*` ainda aceita `source_app` `nexus`/`mentoria` — tirar seria
> mudança de contrato. A tela só deixou de pedir e mostrar.
>
> **Onda de correção final (rodada 2, revisão em
> `.superpowers/sdd/2026-09-22-marketinghs-lote-8e-limpeza-final/final-review.md`),
> 14 itens, todos feitos:** `frontend/bun.lock` saiu; `ZAPI_INSTANCE_URL` e
> `ZAPI_TOKEN` saíram do card de variáveis de ambiente da Documentação da API
> (ninguém lê, e o `Settings` recusa chave desconhecida — seguir a instrução
> derrubava o boot); OpenAPI movido para `public/openapi/`, os dois links
> conferidos abrindo no navegador; `Segments.tsx:97` — "Enviar campanha" agora
> navega para `/campaigns` (**sem** `segment_id`: a tela de Campanhas nunca
> leu esse parâmetro, então prometê-lo seria mentira nova, não conserto);
> exportação de contatos — coluna "Ecossistema" agora preenche "M" sempre e
> "G" quando há `growthhs_card_id`, igual à pílula da tabela (antes ficava
> sempre vazia, com a letra "D" da dn.ia morta no código); exemplos da
> Documentação da API e enum do `marketinghs-api.yaml` sem `source_app:
> "nexus"`/`ecosystem.dnmarketing`, com `marketinghs` no enum;
> `docs/ROADMAP_dnmarketing.md` apagado; `CLAUDE.md` sem o futuro que já
> passou (worker, testes, lote 3); comentário de `index.html:11` em
> português; comentário do cabeçalho de e-mail em `emailEditorConfig.ts`
> reescrito para descrever o presente; comentários "DN.IA ID" em
> `DetailSections.tsx` e `LeadDetailSheet.tsx` viraram "ID do contato";
> imports sem uso saíram de `ApiDocumentation.tsx` e `DetailSections.tsx`
> (`AlertTriangle`, `Eye`, `EyeOff`, `TagIcon`, `StatusDropdown`); e, como
> item opcional (14), `programadeiaficacao`/`programa-iaficacao` (produto da
> dn.ia) viraram `landing-exemplo`/`campanha-exemplo` nos exemplos da
> Documentação da API e do yaml.
>
> **Achado ao clicar de fato no link (não estava na lista dos 14):**
> `/publico/contato` existia como **duas** chaves de mapa no
> `marketinghs-api.yaml` (uma para GET, outra para PATCH) — YAML não garante
> qual sobrevive, e o js-yaml do Swagger UI recusava o arquivo inteiro
> ("Parser error … duplicated mapping key", nenhum endpoint renderizava).
> Pré-existente a este lote (confirmado com `git show` em commit anterior ao
> 8E), só apareceu porque a rodada 2 abriu o link de verdade em vez de só
> `grep`ar. Corrigido juntando GET e PATCH sob a mesma chave.
>
> **Pequenos, registrados e deixados:** warning de React pré-existente no
> `DniaIdChip` (`TooltipTrigger asChild` + `Badge`).
>
> **Portão (Tarefa 6), fechado em 22/09:** as quatro buscas do brief rodaram
> limpas — a segunda achou só um comentário de linhagem novo (histórico do
> logo quebrado em `emailEditorConfig.ts:32`, mantido: conta o passado, não
> mente sobre o presente); a terceira (marca `dn.ia`) só achou comentário de
> paleta/tema (`index.css`, gráficos — visual não muda) e comentário de
> linhagem; a quarta (`supabase` em `src`) só achou dois comentários de
> linhagem em `api.ts`/`jornadas.ts`; a busca acrescentada
> (`programadeiaficacao|/adnia/campaigns`) veio vazia. `tsc --noEmit`: **4
> erros antes e depois** (`LeadScoringSettings` ×1, `useJourneys` ×3, os
> mesmos, pré-existentes ao lote). `vite build`: ok; `dist/` caiu de **3,0 MB
> para 2,7 MB** (2.633.949 → 2.368.283 bytes, medido contra o build da `main`
> em `193bbcc`). Backend: `git diff 193bbcc -- backend/app` só muda duas
> linhas de comentário/docstring (nome do arquivo OpenAPI) — a suíte
> `pytest` não rodou, por não se aplicar (nada de código mudou). Navegador
> (conta admin do Claude, backend :8100 + Vite 127.0.0.1:8080): título e
> ícone da aba corretos; rede em `/`, `/contacts` e navegação livre por 6 s+
> só bateu em `127.0.0.1` e `fonts.googleapis.com`/`fonts.gstatic.com` — zero
> rastreador; login, sidebar, "Assistente de dados", ficha de contato (pílulas
> `M`/`G`, "ID do contato"), filtros de Contatos (sem PLATAFORMA/Nexus/
> mentor.ia), exportação CSV (coluna "Ecossistema" só "M"/"M G" conforme
> `growthhs_card_id`), `/templates/new` (Unlayer carrega, nada salvo),
> Configurações (Webhook sem botão de revelar, GrowthHS, Meta, IA — sem
> card mentor.ia) e Documentação da API (os dois links, `/openapi/docs/
> index.html` e `/openapi/marketinghs-api.yaml`, abrindo 200, Swagger UI sem
> o erro de chave duplicada) — tudo conferido. Zero erro de console novo; o
> único visto (`Function components cannot be given refs` no `DniaIdChip`) é
> o mesmo pré-existente já registrado acima. Nenhuma escrita no banco.
> Capacidade por capacidade (`git diff 193bbcc --stat -- frontend/src`, 67
> arquivos): toda diferença é **(a)** marca/texto ou **(b)** corte
> autorizado (E2, decisão 5 do `LimiteDeErro` — que ainda tem
> `getDerivedStateFromError` e captura erro de verdade —, decisão 10 do
> webhook); **nenhuma "(c)" (corte sem decisão) encontrada.** Relatório
> completo: `.superpowers/sdd/2026-09-22-marketinghs-lote-8e-limpeza-final/task-6-report.md`.
>
> **Lembretes que passam a valer:**
> - **Apagar a conta admin do Claude** (`claude.dev@example.com`) — combinado
>   para o fim da travessia (item 25). Credencial em
>   `~/.config/marketinghs/claude-admin.env`.
> - **Perguntas abertas do 8D e do 8C:** o recálculo de pontuação e a
>   sincronização do DataCore disparando as regras de automação (devem?);
>   peso 0 numa variante de A/B valendo 1 (deve ser "sem tráfego"?); push da
>   `main` (217 commits à frente do `origin/main` em 22/09).
> - **Perguntas abertas da revisão final do 8E** (registro apenas — não é
>   correção, e não foram respondidas nesta rodada):
>   - o editor de e-mail autentica no projeto Unlayer `dnmkt` (id 288591,
>     `emailEditorConfig.ts:101`) — se essa conta Unlayer é da dn.ia, é
>     dependência viva da origem que nenhuma busca de código pega. De quem é
>     a conta?
>   - colunas de funil da dn.ia em Contatos ("Quem te indicou?", "Presença",
>     "Interesse Ecossistema/MTIA/Formação", "Data Interesse" —
>     `ColumnSelector.tsx:26,35,46-49`, campos do banco, fora do escopo do
>     8E) — viram backlog?

> ## ✅ Sub-lote 8D (handoff ao GrowthHS) — portão fechado, 22/09/2026
>
> **Branch `lote-8d` — mergeada em 22/09** (fast-forward até `193bbcc`) (a partir de `main`
> `883727b`). Plano:
> `docs/superpowers/plans/2026-09-21-marketinghs-lote-8d-handoff-growthhs.md`.
>
> **O que entrou:** migrations 018 (fila `crm_handoffs`, `growthhs_config`,
> colunas `growthhs_*`, vocabulário `create_in_growthhs` /
> `move_stage_growthhs` / `block_growthhs` / nó `handoff_growthhs`,
> `nexus_config` apagada), 019 (o avaliador de regras volta como gatilho,
> enfileirando) e 020 (lead já entregue não reentra na fila) — **as três já
> aplicadas no banco**; cliente `app/crm/growthhs.py`; fila com laço próprio
> no worker (`app/crm/entrega.py`); `POST /crm/enviar/{id}` e
> `GET /crm/estado`; `GrowthHSCard` no lugar do `NexusCard`; telas de
> automação, jornada e contato falando GrowthHS.
>
> **Decisões do Erick (21/09):** o avaliador de regras volta no 8D; o modo
> público `direct_stage` é descartado.
>
> **A revisão final pediu uma onda de correção, feita:** condição "tag" e
> regra "mover" recusadas ao salvar (nunca disparavam / não há rota);
> guarda contra card duplicado olha a pessoa (`dnia_id`), não só o lead;
> chave ou funil errado (401/403/404) **pausa** a fila em vez de falhar tudo;
> re-tentativa até ~24 h; botão "Reenfileirar falhas"; parada do worker não
> corta entre pedidos; telas avisam "GrowthHS ainda não configurado — o
> contato fica na fila".
>
> **Portão:** buscas limpas (o toco só é importado por `LimiteDeErro` — **é o
> critério do 8E**); 25 capacidades conferidas contra a origem, nenhuma
> perdida sem decisão; telas conferidas no navegador (6/6, zero erro de
> console); suíte inteira: **360 passaram**, 0 falhas (25 min). Banco
> conferido limpo depois de cada rodada.
>
> **Placar: 47 functions portadas, 7 descartadas, restam 0.** (O modo público
> `direct_stage` foi descartado *dentro* de uma function portada — não muda
> a contagem.) O **8E** é o próximo: apagar o toco do Supabase.
>
> **Para ligar o GrowthHS de verdade** (além do endpoint do lado dele — ver o
> contrato, que ganhou os pedidos do 8D): chave, `board_id` e URL base em
> Configurações → GrowthHS. Antes disso:
> - a corrida entre os testes e o worker de produção (um teste pode ter o
>   pedido reivindicado pelo worker real quando houver configuração);
> - o fallback de ambiente do `ler_segredo` torna "limpar chave" inócuo se
>   `GROWTHHS_API_KEY` existir no ambiente;
> - a função do gatilho é SECURITY DEFINER com dono superusuário.
>
> **Pequenos, registrados e deixados:** `fila.pausada.desde` avança a cada
> ciclo de 10 min (o aviso diz "desde agora" numa pausa longa); a proteção
> da gravação pós-2xx não sobrevive ao desligamento real do worker (janela
> pequena, fecha com a restrição do contrato); o contador de falhas inclui
> casos que "Reenfileirar" não pega (o número pode não cair); o card não tem
> botão de limpar a chave (a origem também não tinha; a rota aceita).
>
> **Perguntas abertas ao Erick:**
> - O **recálculo de pontuação** e a **sincronização do DataCore** agora
>   disparam as regras (o gatilho avalia em qualquer mudança de etiqueta,
>   status ou pontuação — conserto de um defeito herdado). Com uma regra
>   ativa, isso pode mandar muitos leads ao comercial de uma vez, inclusive
>   clientes do ERP. Deve ser assim, ou recálculo/sync ficam fora?
> - **Peso 0** numa variante de teste A/B vale 1 (como na origem) — deve
>   significar "sem tráfego"? (do 8C)
> - **Push**: a `main` está ~198 commits à frente do `origin/main`.
>
> Sobra antiga no banco (não é do 8D): identidade
> `sonda-captura@exemplo.invalid` (criada 21/09 07:28, sem lead) — o teste de
> captura não apaga a identidade que cria.

> ## ✅ Sub-lote 8C (Teste A/B) — portão fechado, 21/09/2026
>
> **Mergeado na `main` em 21/09** (fast-forward até `883727b`; o 8B entrou
> antes, até `dc64ef0`). Plano:
> `docs/superpowers/plans/2026-09-21-marketinghs-lote-8c-teste-ab.md`.
>
> **O que entrou:** `/ab/*` no admin (config, testes, ativação pela RPC
> `ab_activate_test`, eventos até 20.000 com aviso `truncado`);
> `/publico/ab/go/{slug}` (redirecionador) e `/publico/ab/eventos` (coletor),
> com gravação depois da resposta; migration 017 (`ab_config` sem o
> `DEFAULT 'dnia.ai'`, com `redirector_base`, linha única); as três telas de
> Experiments falando com `/ab`; `ab.js` sem nenhum padrão da dn.ia;
> `lib/ab.ts` apagado (sem importador desde o lote 7).
>
> **⚠️ O achado que importa: o funil do A/B não registrava conversão
> nenhuma.** O lote 1D portou `/publico/identidade` e
> `/publico/evento-de-contato` sem a costura do `_shared/ab.ts` (conversão
> `agendamento`), e o lote 7 apagou o `leadConversion.ts`, que gravava
> `lead_criado`, sem que `/publico/conversao` assumisse. Nenhuma TELA mudou,
> então o portão não tinha como pegar. `app/ab/costura.py` devolve as duas
> conversões, dentro de SAVEPOINT (falha no A/B nunca derruba o contato).
>
> **Portão:** buscas limpas (o toco agora só é importado por `LimiteDeErro` e
> `NexusCard`); ~35 capacidades conferidas contra a origem, nenhuma sem lugar;
> as três telas conferidas no navegador (5/5, zero erro de console); suíte
> inteira: **273 passaram**, 0 falhas, 4 avisos de biblioteca (18 min). A revisão final da branch pediu correções nas rotas
> públicas, feitas: o coletor e o redirecionador têm balde próprio de limite
> (120/min e 300/min, `LIMITE_COLETOR_POR_MINUTO` e
> `LIMITE_REDIRECIONADOR_POR_MINUTO` em `Settings`) — **a decisão 6 do plano
> mudou**: o redirecionador não é mais isento —, e o redirecionador guarda o
> domínio em memória para não dar 404 a clique pago com o banco fora.
>
> **Placar: 44 functions portadas, 7 descartadas, restam 3**
> (`get-nexus-stages`, `handoff-to-nexus`, `nexus-config` — o 8D). Telas
> migradas: as três de Experiments.
>
> **Antes de o A/B entrar no ar (não bloqueia o merge):**
> - verificar como o `X-Forwarded-For` que o Worker manda chega através do
>   Traefik do EasyPanel — se ele trocar o cabeçalho, todo visitante divide o
>   balde dos IPs do Cloudflare e os eventos somem em silêncio;
> - a fixture `config_ab` reescreve a `ab_config` de PRODUÇÃO durante a
>   suíte (e a devolve no fim) — com o A/B no ar, rodar a suíte contra o banco
>   de produção manda cliques de anúncio para `exemplo.invalid`. Mesma classe
>   do aviso do Resend.
>
> **Perguntas ao Erick:** peso 0 numa variante hoje vale 1, como na origem —
> deve significar "sem tráfego"?
>
> **Para o 8E:** `docs/ab-testing/` é a documentação da origem (dn.ia,
> `go.dnia.ai`, Supabase) e contradiz o código; a casca do app chama um
> endpoint supabase (`get-tests`) e `lovableproject.com` durante a navegação.
> → resolvido no 8E (22/09): `docs/ab-testing/` apagada; os rastreadores
> saíram do `index.html`.
>
> A conta admin do Claude foi **recriada** em 21/09 com ok do Erick — apagar
> no fim da travessia.

> ## ⚠️ Onde paramos — 10/09/2026, fim do dia
>
> **A VPS do EasyPanel (`62.72.11.28`) caiu no começo da tarde e voltou às
> 15:00 restaurada de backup.** Os 10 bancos da casa reiniciaram juntos; o do
> MarketingHS voltou ao estado de **04/09/2026, ~10:05** (último
> `contact_events` às 13:05 UTC). O Erick restaurou e confirmou que está tudo
> ok. **Nada do repositório se perdeu** — os commits são locais; o que voltou
> no tempo foi DADO de produção, não estrutura (a migration mais nova, 016, é
> de 03/09, anterior ao backup).
>
> Consequências para quem continuar:
>
> - a conta admin do Claude (`claude.dev@example.com`) **não existe mais** no
>   banco — o arquivo de credencial continua no disco; recriar pede ok do
>   Erick;
> - `journey_events` tem **740** linhas órfãs, não as 1.522 medidas no portão
>   do 8B (a restauração levou tudo o que era posterior a 04/09);
> - `RESEND_WEBHOOK_SECRET` e `UNSUBSCRIBE_SECRET` estão com a versão de
>   04/09; continua não havendo `RESEND_API_KEY` nem `EMAIL_FROM`.
>
> **O que falta para fechar o 8B** (branch `lote-8`, ponta `a409c4e`, NÃO
> mergeada):
>
> 1. Rodar os testes de banco da onda de correção da revisão final — o host
>    fora do ar não deixou; estão escritos e coletados, não executados:
>    `cd backend && ./.venv/bin/pytest -q tests/ -k "status or escrita or contato or painel"`
>    (46 de 219 coletados). Primeiro plano, nunca interromper.
> 2. A re-revisão escopada da correção (`bb80b37..a409c4e`).
> 3. Decidir o destino da branch `lote-8` (8A + 8B) — merge só com o Erick.
>
> Depois disso: escrever e executar os planos do 8C (telas de A/B), 8D
> (handoff para o GrowthHS) e 8E (limpeza final). O estado fino do trabalho —
> ledgers com cada decisão, relatórios das tarefas — está em
> `.superpowers/sdd/`, ignorado pelo git, só nesta máquina.

> ## 🟡 Sub-lote 8B (API de contato) — portão fechado, correção final à espera dos testes de banco (10/09/2026)
>
> **Branch `lote-8`, NÃO mergeada.** Reconstrói as três functions da API de
> contato para integrador externo: `PATCH /publico/contato` (era
> `contact-update`), `PATCH`/`POST /publico/contato/status` (era
> `contact-status-update`) e `PUT`/`POST /publico/contato/tags` (era
> `contact-tags-sync`) — as três em `backend/app/routers/api_contato.py`,
> reaproveitando `_registrar_mudanca` e `_resolver_status` de
> `escrita_contatos.py`. **218 medidos no portão + 1 teste da correção,
> rodados isoladamente** — ⚠️ não os 217 que o plano e a emenda previam; ver
> a nota abaixo, é achado de contagem antiga, não defeito do 8B. A onda de
> correção da revisão final (F1-F8) não pôde rodar contra o banco — o host
> do Postgres estava fora do ar em 10/09/2026; os testes novos e alterados
> ficaram escritos e coletados (`--collect-only`), não executados.
>
> **Placar da pasta de especificação: 42 functions portadas, 7 descartadas,
> restam 5** (`ab-events`, `get-nexus-stages`, `go`, `handoff-to-nexus`,
> `nexus-config`). O portão (Tarefa 5) conferiu capacidade por capacidade
> contra os três `index.ts` antes de apagar; nenhuma ficou sem lugar — ver o
> relatório da tarefa.
>
> **As sete decisões deste plano**
> (`docs/superpowers/plans/2026-09-10-marketinghs-lote-8b-api-de-contato.md`):
>
> 1. Status desconhecido responde **400** com a lista do que vale, não
>    criação automática como a origem fazia — decisão já tomada no lote 1D.
> 2. **O estágio da identidade NÃO avança para `opportunity` em "Lead
>    Qualificado".** A origem avançava, e a documentação prometia; ⚠️
>    pergunta ao Erick, na lista abaixo — vale para as duas portas de
>    escrita (admin e API) ao mesmo tempo.
> 3. `source_app = 'marketinghs'` nos três (a origem gravava `dnmarketing`
>    e, em `contact-tags-sync`, `nexus`).
>
>    ⚠️ Consequência: a rota de tags grava `source_app='marketinghs'` onde a
>    origem gravava `'nexus'`; o filtro "Plataforma: Nexus" da tela de
>    Contatos usa `tem_eventos_nexus = bool_or(source_app='nexus')`
>    (`leitura_contatos.py`) OU `nexus_contact_id` (`useContactsEnriched.tsx`).
>    Contato novo que só recebe sync de tags pelo CRM, sem `nexus_contact_id`,
>    deixa de aparecer no filtro. Linhas antigas não mudam.
> 4. Tag normalizada nas duas rotas que mexem em tag — sem `/` na frente,
>    sem espaço nas pontas, minúscula; busca por `lower(name)`.
> 5. Mudança de status pela rota geral (`PATCH /publico/contato` com
>    `status`) grava os mesmos eventos da rota de status — a origem gravava
>    o status cru, sem evento, o que hoje cairia na FK com 500.
> 6. `dnia_id` malformado dá **422** (validação do FastAPI), não 500.
> 7. `contact-status-update` com identidade cujo lead não existe mais dá
>    **404** — a origem respondia sucesso sem ter gravado nada.
>
> **O indicador de MQL estava cortado, e o 8B consertou:** o card
> `/painel/agendamentos/mql-hoje` lê `contact_updated` com
> `metadata->>'status_atual'`, e a mudança de status pela API não gravava
> esse campo. Hoje grava, em `_registrar_mudanca` e `status_em_lote`.
>
> ⚠️ **A suíte fechou em 218, não nos 217 previstos — e o motivo é anterior
> ao 8B.** O total de 197 registrado no fechamento do 8A (`91fdc39`,
> 11:17:13) já estava desatualizado 23 minutos depois: a `93504c3`
> ("revisão final" do 8A, 11:40:01) acrescentou um teste a
> `test_config_resend.py`
> (`test_ligar_rastreamento_com_chave_rejeitada_nao_desloga_o_admin`) sem
> ninguém recontar — o 8B, medido na ponta da branch em que começou, na
> verdade partiu de **198**. Os 20 testes próprios do 8B
> (`test_api_contato.py`) somam **218**: nenhum teste falhou, nenhum teste
> do 8B está fora do lugar — era a baseline que carregava um número velho.
>
> **`journey_events` tem 1.522 linhas órfãs**, medido depois da suíte
> completa deste portão rodar: o trigger `trg_contact_event_journey` copia
> cada `contact_events` para lá, a tabela não tem FK para `leads`, e
> limpezas antigas não apagavam a cópia. Só esta rodada acrescentou **27**
> (`form_submitted` 13, `email_sent` 7, `email_opened` 3, `email_bounced` 2,
> `contact_reactivated` 1, `email_complained` 1) — nenhuma com a assinatura
> do 8B: é o vazamento antigo das fixtures de captura/conversão/envio/
> webhook, ~27 por rodada completa da suíte. Inofensivas para o motor (lead
> inexistente), mas apagar é decisão do Erick — ver a lista abaixo. Duas
> formas de parar de crescer a cada rodada: limpeza numa fixture comum, ou
> banco de teste separado.
>
> ⚠️ Depois da restauração da VPS (10/09, 15:00) o banco voltou a 04/09 e as
> órfãs são **740** — a taxa de ~27 por rodada continua valendo.
>
> **Limitações conhecidas da API de contato, herdadas da origem ou de
> propósito:**
>
> - Tags que diferem só na caixa (`"VIP"`/`"vip"`) colapsam na sincronização.
> - `removed`/`kept` saem sem ordem definida — como na origem.
> - CORS só aceita `FRONTEND_URL` (a origem mandava `*`), de propósito: a
>   chave de escrita mora em servidor, não no navegador. Pauta do 8E.

> ## ✅ Sub-lote 8A (Resend) fechado (10/09/2026)
>
> **Branch `lote-8`, NÃO mergeada.** Restaura por inteiro a configuração do
> Resend que o lote 3C tinha cortado sem ninguém decidir: teste de chave,
> domínios, rastreamento (open/click) e diagnóstico. Suíte de backend em
> **197 testes**, `tsc -p tsconfig.app.json` com os mesmos 8 erros
> pré-existentes de sempre (nenhum novo, nenhum em `ResendConfigCard.tsx` nem
> em `lib/config.ts`), `tsc -p tsconfig.node.json` limpo, `vite build` limpo.
>
> **O defeito real, e que está consertado:** o 3C (`ecca32d`) tirou teste de
> chave, listagem de domínios e rastreamento — e junto, sem ninguém perceber,
> foi embora o único caminho para gravar o `UNSUBSCRIBE_SECRET` pela tela. Sem
> esse segredo o worker **não consome a fila** (`backend/app/worker.py:180-185`)
> — nenhum e-mail de campanha sai, nem sem `List-Unsubscribe`. Essa frase era o
> comportamento da ORIGEM (que enviava mesmo assim); hoje é diferente e mais
> seguro. O Erick decidiu em 10/09/2026 restaurar a tela inteira, não só o
> segredo.
>
> **Placar da pasta de especificação: 39 functions portadas, 7 descartadas,
> restam 8** (`ab-events`, `contact-status-update`, `contact-tags-sync`,
> `contact-update`, `get-nexus-stages`, `go`, `handoff-to-nexus`,
> `nexus-config`). `resend-config`, `resend-config-check` e `resend-webhook`
> saíram da pasta neste portão — a Tarefa 8 conferiu capacidade por
> capacidade contra os três arquivos antes de apagar; nenhuma ficou sem lugar.
>
> **As cinco decisões deste plano**
> (`docs/superpowers/plans/2026-09-10-marketinghs-lote-8a-resend.md`):
>
> 1. O remetente continua num segredo só, `EMAIL_FROM` — não em
>    `dashboard_settings.resend_from` como na origem. É o que o worker lê; as
>    três partes (nome, prefixo, domínio) são extraídas do próprio valor na
>    leitura, em vez de viverem em dois lugares.
> 2. As `action`s do corpo da origem viram rotas próprias (`/testar`,
>    `/diagnostico`, `/dominios/{id}`, `/dominios/{id}/rastreamento`) —
>    FastAPI autoriza por rota, e um `action` escondido no corpo escondia
>    justamente a autorização que difere entre elas.
> 3. Autorização como a origem: leitura aceita JWT de admin, `WEBHOOK_SECRET`
>    ou chave de API de leitura; escrita aceita **só** JWT de admin ou
>    `WEBHOOK_SECRET` — nunca uma chave de `api_keys`, mesmo com permissão de
>    escrita (vazada, ela poderia trocar a `RESEND_API_KEY` por uma de outra
>    conta e exfiltrar a base inteira de contatos).
> 4. O diagnóstico com chave *sending-only* responde `ok: true` com lista de
>    domínios vazia — a origem tratava isso como `api_error`, uma chave válida
>    acusada como falha.
> 5. Falha secundária de banco no webhook devolve **500**, não os 200 da
>    origem — o Svix reentrega e o `svix_id` deduplica; perder o evento em
>    silêncio é pior que reprocessar. Registrado, não corrigido para bater com
>    a origem.
>
> **O caminho com chave de verdade continua sem conferência ao vivo** até o
> Erick fornecer uma chave do Resend. O portão (passo 3, feito pelo
> controlador) confirmou os caminhos de erro e o diagnóstico contra o banco
> real — `RESEND_WEBHOOK_SECRET` e `UNSUBSCRIBE_SECRET` estão gravados hoje;
> nem `RESEND_API_KEY` nem `EMAIL_FROM` existem —; o caminho feliz (chave
> válida, domínio verificado, tracking ligado) segue provado só pelos testes
> das Tarefas 4 e 5, nunca clicado contra o Resend de verdade.
>
> ⚠️ **Antes de cadastrar o webhook no Resend em produção, resolver o
> `webhook_url`.** O card monta essa URL com `request.url_for` — atrás do proxy
> do EasyPanel ela provavelmente sai `http://` (não `https://`) e sem o
> prefixo `/api`, a não ser que o uvicorn suba com `--proxy-headers
> --forwarded-allow-ips` e um `root_path` correto, ou que exista um
> `PUBLIC_API_URL` declarado em `Settings`. Cadastrar a URL errada no Resend
> significa nenhum evento chegando, sem aviso nenhum.
>
> ⚠️ **Quando existir uma `RESEND_API_KEY` de verdade em produção, a suíte do
> backend NÃO PODE rodar contra o banco de produção.** As fixtures deste
> sub-lote (`segredos_resend` e as que gravam credenciais do Resend) escrevem
> segredos falsos-porém-completos direto em `integration_secrets` durante o
> teste — com uma chave real presente, um worker de produção rodando ao mesmo
> tempo poderia tentar enviar com a chave falsa da fixture. E um `pytest` morto
> no meio (a mesma regra de sempre: nunca interromper) apagaria de vez o
> `RESEND_API_KEY`/`UNSUBSCRIBE_SECRET` reais — todo link de descadastro já
> enviado passaria a falhar. Antes disso acontecer, apontar os testes para um
> banco de teste.
>
> ⚠️ **A verificação de tipos do frontend estava vazia desde sempre, em todo
> lote anterior.** `frontend/tsconfig.json` tem `"files": []` e só
> `references` para `tsconfig.app.json`/`tsconfig.node.json` — `npx tsc
> --noEmit` sem `-p` checa ZERO arquivos e sai 0, sempre. Todo "tsc limpo"
> anunciado antes deste sub-lote (inclusive neste documento e no `CLAUDE.md`
> do repo) não provava nada. **O comando que checa `src` de verdade:**
> `npx tsc --noEmit -p tsconfig.app.json` — daqui em diante é esse que todo
> portão e todo plano usa. Atrás do vazio estava um defeito real:
> `LeadScoringSettings.tsx:55` lê `result.updated` de uma resposta que vem
> `{ atualizados }` (é o que o `POST` de recálculo de score devolve,
> `backend/app/routers/contatos.py:184`) — o aviso na tela sai "Score
> recalculado para undefined leads!". Corte silencioso de porte anterior, sem
> relação com o 8A; ver o item na lista do Erick, abaixo.

> ## ✅ Subprojeto A da captação pública fechado (10/09/2026)
>
> **Branch `captacao-a`, NÃO mergeada.** O merge em `main` é decisão do Erick.
> Suíte em **160 testes**, `tsc` limpo, os dois builds limpos, bundle público
> em 144 KB.
>
> **Placar: 36 functions portadas, 7 descartadas, restam 11.** O toco do
> Supabase continua vivo: os 9 pontos do alias `const db = supabase as any`
> nas telas de Experiments não mudaram, e este subprojeto não os toca.
>
> **O portão foi conferido no navegador pelo próprio Claude.** O Playwright
> alcança `127.0.0.1` nesta máquina (a nota antiga de que não alcançava estava
> errada), e o admin foi aberto com uma conta temporária — item 25.
> Conferido contra o banco real: landing com título, CTA e `og:*` no HTML cru;
> envio redirecionando; `@mailinator.com` recusado com mensagem legível; o
> mesmo e-mail com maiúsculas trocadas não duplicando o contato; o contato na
> tela de Contatos com score 35, etiqueta, `dnia_id` e tag; contato e página
> apagados pela própria tela. Banco limpo no fim.
>
> **O que o portão pegou depois do encerramento de 08/09, todos corrigidos:**
>
> - `contact_reactivated` voltou a gravar `dnia_id` (`750f1dc`) — **provado
>   ao vivo**: contato apagado pela tela, reconvertido pela landing, e o evento
>   nasceu com o `dnia_id` do contato;
> - e-mail >320 caracteres dá 400, e `session_id` >100 é descartado sem
>   derrubar a captura — os dois contratos da origem (`750f1dc`);
> - saíram `leadCapture.ts`, `resolveIdentity.ts` e `emailValidation.ts`;
> - ⚠️ **cinco pontos do admin montavam o endereço da landing na raiz**
>   (`/${slug}`), herança de quando as landings da dn.ia moravam no SPA —
>   inclusive o **"Gerar link", o link colado em anúncio**, que mandaria o
>   tráfego para o 404 do admin. Tudo passa agora por `lib/landing.ts`, e o
>   Vite repassa `/p/` e `/landing/` ao backend (`c512118`). **É a segunda vez
>   que esse link sai errado** (a primeira, `dnia.ai` cravado, no lote 7) — e
>   de novo nenhum `grep` do portão o pegaria: só o clique.
>
> **A landing nasce sem oferta decidida** (item 22). É motor dirigido por
> `pages.config`, e **um template de página única não estica para diagnóstico
> multi-etapa** — se a oferta for essa, é outra construção.
>
> **Duas capacidades saíram de propósito:** `mode: "update_only"` e a projeção
> do lead na resposta da captura (a rota é anônima; até `isNew` seria oráculo
> de enumeração).
>
> **Faltam B e C da captação:** a imagem OG (e `pages.config` ainda não tem
> campo para ela) e o teste A/B, que segue esperando conta Cloudflare.
>
> ⚠️ **O design system da HS não foi consultado** para o `landing.css`. O CSS é
> sóbrio e **provisório**, não uma decisão visual tomada.


**Atualizado:** 10 de setembro de 2026
**Branch:** `captacao-a`, a partir de `main` — **não mergeada, nada pushado.**
A `lote-7` foi mergeada em `main` e apagada em 08/09.

⚠️ **A `lote-7` não existe mais.** Fechou com merge local em `main`
(fast-forward, sem commit de merge), suíte conferida no resultado mergeado
(**138 passed**) e `tsc` limpo, e a branch removida. Se precisar dela de volta:
`git branch lote-7 7ae95d2`. A `reconstrucao`, do lote 6, saiu do mesmo jeito:
`git branch reconstrucao 6926d4d`.

`main` está **140 commits à frente de `origin/main`** — o remoto continua parado
em 31/08, no último commit do Lovable, conferido com `fetch` antes do merge
(`origin/main` é ancestral de `main`; não há nada a puxar). O push segue sendo
decisão do Erick, com o mesmo alerta de sempre (item 6 abaixo).

## Onde paramos

### ✅ Lote 7 concluído (08/09/2026)

As dez tarefas fecharam. Suíte de backend em **137 testes** (127 do lote 6 +
10 novos, `test_conversao.py`), `tsc --noEmit` limpo, e o portão (tarefa 9)
abriu a tela de Páginas no navegador contra o banco real.

O que entrou:

| | |
|---|---|
| **1** | Rotas de admin do cadastro de páginas (`backend/app/routers/paginas.py`), com `admin_atual` + `sessao(role="authenticated")` — `pages` é admin-only por RLS e `page_stats` é view `security_invoker=true` |
| **2** | Resolução de lead, tag aplicada na mesma transação, recálculo de `last_conversion_date` |
| **3** | `POST /publico/conversao` no lugar de `register-conversion` |
| **4** | `PATCH` + `DELETE /publico/conversao`, com os aliases `POST /publico/conversao/atualizar` e `POST /publico/conversao/remover` |
| **5** | `/publico/paginas` no lugar de `pages-api` |
| **6** | `usePages.tsx` fora do toco do Supabase; a tela de Páginas portada |
| **7** | `leadConversion.ts` apagado — sem chamador |
| **8** | Documentação corrigida — na tela (`ApiDocumentation.tsx`, inclusive a navegação lateral) e no `dnmarketing-api.yaml` |
| **9** | O portão — cinco functions a menos |

⚠️ **O brief original deste lote listava três rotas de conversão. São
cinco.** `update-conversion` virou **duas** (`PATCH /publico/conversao` e o
alias `POST /publico/conversao/atualizar`); `unregister-conversion` virou
**duas** (`DELETE /publico/conversao` e o alias
`POST /publico/conversao/remover`). Os aliases existem porque a documentação
publicada já prometia "Aceita PATCH ou POST" / "Aceita DELETE ou POST" e a
portagem tinha derrubado isso em silêncio — restaurado numa rodada de
correção (`4d45d86`). Não couberam no mesmo caminho do método principal
porque `POST /publico/conversao` já é a criação. `DELETE /publico/conversao`
aceita `session_id` no corpo **ou** em query string, com o corpo vencendo
quando os dois vierem.

⚠️ **"Zero pontos de acesso" é a frase mais fácil de ler errado deste
projeto — em letra grande.** O script do placar agora marca **0**. Os 8
pontos que ele via no lote 6 eram exatamente `usePages` (6) e
`leadConversion` (2), e os dois saíram do código. Mas o toco
(`integrations/supabase/client.ts`) **continua sem poder ser apagado**:
sobram os **9 pontos reais** do alias `const db = supabase as any`, em
`useAbConfig.tsx:9` e `useAbTests.tsx:8` (as três telas de Experiments) — o
script não os enxerga. Medido em 08/09/2026:

```bash
python3 -c "
import pathlib, re
n = sum(len(re.findall(r'supabase\s*\.?\s*\n?\s*\.(from|rpc)\(', f.read_text()))
        for f in pathlib.Path('frontend/src').rglob('*.ts*')
        if 'integrations/supabase' not in str(f))
print(n, 'pontos pelo script')"
# → 0 pontos pelo script

grep -rn "supabase as any\|= supabase;" frontend/src --include=*.ts --include=*.tsx
# → useAbTests.tsx:8 e useAbConfig.tsx:9
```

⚠️ **A lista de telas liberadas para trabalho de visual estava errada.**
Dizia quatorze de dezesseis, contando Experiments como portada — não estava.
As três telas de Experiments ainda falam com o Supabase pelo alias. Eram
**onze**; com Páginas, que este lote libera, são **doze**. Continuam fora:
**Experiments** (três telas) e **Configurações** (espera o `NexusCard` do
5A, bloqueado). Lista atualizada mais abaixo.

⚠️ **A perna de A/B da conversão ficou pendente, e o commit `46f2a07`
generaliza demais.** `leadConversion.ts` fazia quatro coisas. Três têm
substituto em `POST /publico/conversao`, e duas ficaram melhores: a tag
agora é aplicada na mesma transação em vez do fire-and-forget que falhava
calada, e `last_conversion_date` agora vem de um gatilho `AFTER INSERT` com
`greatest()` — o que conserta a function original, que BAIXAVA a data
quando a conversão chegava com `converted_at` no passado. Mas a quarta —
`recordAbConversion("lead_criado", ...)`, o disparo de conversão A/B **no
navegador** — **não tem, e não pode ter, substituto numa rota de
servidor**. O commit diz "o que ele fazia vive agora em
`POST /publico/conversao`", e isso é verdade só para as colunas do banco
(`ab_*`, que a rota grava). Registrado aqui para ninguém ler o commit
sozinho no futuro e concluir paridade.

⚠️ **O lote 7 NÃO é a "Captação pública" que a spec descreve.** A spec
(linha 238) chama o lote 7 de "Captação pública — landing modelo da HS,
conversões, OG estático, teste A/B". Por decisão do Erick em 08/09/2026,
este lote foi **só o porte**. `pages` e `lead_conversions` seguem
**vazias**. "Lote 7 concluído" não quer dizer que a captação está de pé.

**O que a conferência no navegador provou (passo 3 do portão, 08/09/2026):**
listar, estatísticas, duplicar, busca, alternar status, editor de config
(com persistência após reload), presets de UTM, e excluir pela própria
tela — tudo contra o banco real, sem sobrar teste no banco.

⚠️ **E o clique achou o que nenhum `grep` acharia.**
`UTMPresetsModal.tsx:37` montava `https://dnia.ai/${page.slug}` cravado — o
link que o botão "Copiar link" entrega para colar em anúncio, mandando
**tráfego real para o domínio da dn.ia**. Corrigido para
`window.location.origin` no commit `dcc0742`. Vale registrar como lição
junto do portão: os passos 1 e 2 são `grep`, e esse defeito não era uma
chamada — era um literal montando uma URL. Só apareceu porque alguém abriu
a tela e clicou.

O portão fechou as cinco functions que a tela de Páginas e a conversão
seguravam (`pages-api`, `register-conversion`, `unregister-conversion`,
`update-conversion`, `apply-lead-tag`): pela **oitava vez** no projeto, a
documentação (tela + `dnmarketing-api.yaml`) ainda ensinava URL morta —
desta vez até na navegação lateral, que montava o rótulo visível a partir
do `id` do bloco em vez do `path`, sobrevivendo dentro da própria tarefa
que existia para eliminá-la (`b43ccc0`). Placar da pasta de especificação:
**34 functions portadas** e **7 descartadas** (números que não se somam),
restando **13**: `ab-events`, `contact-status-update`,
`contact-tags-sync`, `contact-update`, `get-nexus-stages`, `go`,
`handoff-to-nexus`, `lead-capture`, `nexus-config`, `resend-config`,
`resend-config-check`, `resend-webhook`, `validate-email-domain`.

### ✅ Lote 6 concluído (04/09/2026)

As nove tarefas fecharam, mais uma revisão final do lote inteiro (os 18 commits
lidos juntos) e uma onda de correção de 12 itens. Suíte de backend em **127
testes**, `tsc --noEmit` limpo, e o portão (tarefa 9) abriu a tela de
Documentação da API no navegador sem erro.

**As decisões tomadas durante a execução estão em
`docs/superpowers/plans/2026-09-04-lote-6-estado-da-execucao.md`** — inclusive
as seis vezes em que o plano errou e a execução pegou, e as três capacidades
que a portagem derrubou em silêncio. Vale ler antes do lote 7.

O que entrou:

| | |
|---|---|
| **1** | A migration 016 apagou a `execute_readonly_query` — a IA não escreve mais SQL |
| **2** | Cliente da API da Claude, com a chave configurável em Configurações → IA |
| **3** | As seis ferramentas nomeadas, com allowlist e teto |
| **4** | O laço de ferramentas e as cinco rotas do chat |
| **5** | As duas análises, com o formato de saída garantido pela API |
| **6** | Painel: metas, cartões e agendamentos, saindo do toco do Supabase |
| **7** | Telas de IA (chat e as duas análises) portadas |
| **8** | A tarja dos dez mil |
| **9** | O portão — quatro functions a menos, documentação sem URL morta |

**O buraco que o lote fechou:** `execute_readonly_query` era `SECURITY
DEFINER` de dono superusuário e executava qualquer SELECT que a IA gerasse; a
defesa era lista negra de palavras, que não bloqueia
`SELECT value FROM integration_secrets`. Não estava explorável (a tela morria
no toco antes), mas estava viva no banco. Apagada pela migration 016.

**O que substituiu:** seis ferramentas nomeadas com allowlist de campos,
executadas pela `sessao()` de quem perguntou. O modelo não escreve SQL.

⚠️ **A lição, para os próximos lotes:** o defeito não era o modelo escrever
SQL ruim — era a **lista negra**. Toda vez que a defesa for "proibir o que é
ruim" em vez de "permitir só o que é bom", é o mesmo desenho.

**Que a spec errava:** os painéis já estavam fora do Supabase desde o lote 1B;
o lote 6 foi IA e configuração, não Analytics.

**A tarja dos dez mil**, e que ela é um remendo honesto: a agregação no
servidor continua não existindo, e o dia que a base passar de 10 mil o painel
fica lento antes de ficar errado.

⚠️ **A IA não está provada de ponta a ponta, e não deve ser lida como se
estivesse.** Não há chave da Anthropic gravada — conferido na tela em
Configurações → IA, que mostra "não configurado" — então o chat e as duas
análises foram verificados só até a fronteira do `400 "não está
configurada"`. É o honesto-parcial mais importante do lote: o código está
pronto (rotas, ferramentas, formato de saída garantido), mas ninguém viu o
modelo responder de verdade.

**A tarefa 7 restaurou uma capacidade que a portagem tinha derrubado:** o
botão de apagar insight (ícone de lixeira + confirmação) na aba Desafios. A
tarefa 5 nunca escreveu a rota DELETE e o mapa de rotas do plano só listava
GET e POST — a portagem perdeu um botão que o usuário tinha, em silêncio.
Agora existe `DELETE /ia/insights-de-desafios/{id}`, devolvendo 404 (não um
200 sem efeito) quando o id não bate com nenhuma linha.

**A tarefa 6 introduziu um corte silencioso que a tarefa 8 desfez.** A nova
`GET /painel/agendamentos` nasceu com um `LIMIT 500` fixo; o hook do Supabase
que ela substituiu paginava até 20.000. A tarefa 8 restaurou o teto de 20.000
e fez a rota avisar quando corta. Vale registrar como padrão: é a própria
portagem que introduz teto silencioso.

**Duas linhas de dado de teste são hoje a configuração viva do painel.**
`dashboard_settings` guarda `lead_goal = {"monthly":100}` e `dashboard_cards
= {"overview":["leads","conversao"]}`, ambas criadas em 03/09 pelos próprios
curls do Passo 2 do plano, não por uma pessoa. O payload não tem a chave
`goal`, que é o que `useGoalSettings` lê, então o medidor de meta cai no
padrão de 1.000. É decisão do Erick: apagar as duas linhas de teste, ou
configurar a meta de verdade pela tela — ver a lista abaixo. (A terceira
linha, `...:colunas-contatos`, é preferência de usuário de verdade — não
mexer.)

**O item 9 da lista de pendências antiga está confirmado ao vivo — com a
contagem corrigida.** Reproduzido ao vivo em 04/09/2026: são **duas**
chamadas a `supabase.co` na tela do admin, não uma. `frontend/index.html:268`
carrega `luinwzmegsdjckjxoimx.supabase.co/functions/v1/tracker`, e é esse
script que dispara a segunda, `.../functions/v1/get-tests` — a versão
anterior deste parágrafo só via a segunda e não sabia de onde ela vinha. A
afirmação de fundo continua verdadeira e é o que sustenta o item 9 da lista
abaixo: nenhuma tela em `frontend/src` fala com o Supabase — é a casca da
página, em `index.html`, quem fala, antes de qualquer tela carregar.

**Um corte pequeno e silencioso, registrado para não ser redescoberto:** o
título das conversas. O código antigo gravava os 50 primeiros caracteres da
primeira pergunta em `ai_chat_conversations.title`; a rota do servidor só
toca `updated_at`. Zero efeito hoje porque não existe tela de lista de
conversas, mas vai importar para quem construir uma.

O portão apagou as quatro functions que sobravam
(`analytics-api`, `ai-data-analyst`, `analyze-leads`, `analyze-challenges`):
pela **sétima vez** no projeto, a documentação (tela de Documentação da API +
`dnmarketing-api.yaml`) ainda ensinava uma URL morta a integradores —
`/analytics-api`, checado e removido dos dois lugares antes de apagar a
function. Placar da pasta de especificação: **29 functions portadas** e **7
descartadas** (números que não se somam), restando **18**. Pontos de acesso
direto ao Supabase medidos pelo mesmo script do lote anterior: **8** (script
que não enxerga o alias `const db = supabase as any` das telas de
Experiments — ver a nota abaixo).

⚠️ **O script do placar tem um ponto cego.** `usePages.tsx` e
`leadConversion.ts` (lote 7) chamam `supabase.from(`/`.rpc(` direto, e o
script os conta. `useAbConfig.tsx` e `useAbTests.tsx` (as telas de
Experiments) chamam a mesma coisa por trás de `const db = supabase as any`,
e o script não reconhece o alias — são **9 pontos de acesso reais** que o
número 8 não inclui. Não são novos nem deste lote; estavam fora da vista do
script antes também. Registrado para quem for portar Experiments não se
surpreender com o número.

---

## 👉 O próximo passo — terminar a transformação

**Abrir a sessão dentro do repo:** `cl MarketingHS` (ou Meta+C), nunca de fora.

⚠️ **A prioridade, dita pelo Erick em 10/09/2026: primeiro transformar o remix
em sistema nosso; feature e decisão de produto vêm depois, com o sistema
inteiro portado.** Na hora de escolher o próximo passo, vence o que diminui o
que resta do remix.

O que resta, medido em 10/09/2026:

- **11 functions na pasta de especificação:** `contact-status-update`,
  `contact-tags-sync`, `contact-update` · `resend-config`,
  `resend-config-check`, `resend-webhook` · `get-nexus-stages`,
  `nexus-config`, `handoff-to-nexus` (as três do **5A**, bloqueado — ver
  abaixo) · `go`, `ab-events` (o **C** da captação, que espera conta
  Cloudflare).
- **O toco do Supabase**, vivo pelos 9 pontos do alias nas três telas de
  Experiments — também o C.
- **A marca da dn.ia no admin** (item 26) — independe de terceiro e pode ir
  já.

⚠️ Antes de apagar qualquer function, conferir `ApiDocumentation.tsx` e
`dnmarketing-api.yaml`: já ensinaram URL morta **oito vezes**.

---

## Onde paramos

**Lotes 0 a 4 fechados, mais o 5B, o 5C, o 5D, o 6 e o 7.** O lote 5 foi partido em quatro:

| | | |
|---|---|---|
| **5A** | Handoff → GrowthHS | ⏸ **bloqueado** — ver abaixo |
| **5B** | Contatos do DataCore | ✅ concluído (02/09/2026) |
| **5C** | Identidade unificada, Meta CAPI | ✅ concluído (03/09/2026) |
| **5D** | Limpeza das sobras | ✅ concluído (02/09/2026) |
| **6** | IA (chat, análises) e painel | ✅ concluído (04/09/2026) |
| **7** | Páginas e conversões | ✅ concluído (08/09/2026) — mergeado em `main` |
| **A** | Captação pública: landing e captura | ✅ concluído (10/09/2026) — branch `captacao-a`, não mergeada |

## 🎨 O trabalho de visual já pode começar

Era para isto que o 5D existiu, o lote 6 liberou mais duas, e o lote 7 libera
mais uma (Páginas). **Doze das dezesseis telas do admin estão 100% livres do
toco do Supabase** e podem ser redesenhadas agora:

> Automações · Campanhas · Contatos · Importar · Construtor de fluxo · Login ·
> Segmentos · Preview de template · Templates · Visão Geral · Analytics ·
> Páginas

⚠️ **A lista publicada até 04/09 estava errada — contava Experiments (as
três telas) como portada.** Não estava: `useAbConfig.tsx` e `useAbTests.tsx`
alcançam o Supabase pelo alias `const db = supabase as any`, que o script do
placar não enxerga. Eram onze telas livres, não quatorze.

⚠️ **Não redesenhe estas ainda:**

| Tela | Por quê |
|---|---|
| **Experiments** (as três) | ainda falam com o Supabase pelo alias `const db = supabase as any` — os 9 pontos que sobram no toco. Aguarda o próximo lote (captação pública / teste A/B) |
| **Configurações** | falta só o `NexusCard` (5A, bloqueado) — o `MetaCard` (5C) já chegou |

⚠️ O design system da HS **vive no Claude Design** — ler de lá (DesignSync)
antes de desenhar, em vez de inventar.

## ⏸ Por que o 5A está bloqueado

A spec deixava em aberto se a API do GrowthHS já criava card. **Não cria.**
Existe `POST /integration/service-cards` no `hsgrowth-sistema`, com o desenho
certo (chave de API, escopo, create-or-return idempotente), mas ele só cria card
de **serviço**, em board de serviço, com o `source` travado num `Literal` de três
valores do GestorHS. O handoff do marketing quer card **comercial**.

O contrato completo do endpoint que falta está em
**`docs/contratos/2026-09-02-endpoint-card-comercial-growthhs.md`** — é um pedido
ao `hsgrowth-sistema`, não trabalho para fazer aqui.

⚠️ **O contrato achou um buraco que a spec não previa:** `service_cards` tem
`external_source`/`external_id` com unicidade e o card comercial **não tem
nenhum dos dois**. Sem chave de idempotência, um retry nosso cria um segundo
card para o mesmo lead — e quem descobre é o vendedor.

**Para destravar, precisamos de volta:** a chave de API com escopo
`cards:create`, o `board_id` do funil, a URL base da API, e se `origin` é lista
fechada ou texto livre.

## O que o 5B entregou

Os 2.080 clientes do ERP entraram como contato. `stage='client'` na identidade,
`tipo='datacore'` no lead, e o construtor de segmentos recorta cliente contra
lead — conferido na tela, contando 2.080.

⚠️ **A spec errava o número central por onze vezes:** "2.077 clientes, todos com
e-mail" são, na real, **2.081 clientes e 183 com e-mail utilizável**. Unindo
nota fiscal e conta a receber o teto é 327, e isso está atrás de
`DATACORE_EMAIL_DE_NOTAS`, **desligada** — e-mail coletado para faturar não é
consentimento para marketing, e ligar é decisão do Erick e do Nicholson.

## O que o 5B ensinou, e vale para o 5C

1. **Três queries por linha não escalam para dois mil.** 400ms cada contra o
   Postgres remoto viram 14 minutos. Bloco de 500 com `unnest` levou a 3,1s. Se
   o 5C for casar identidades em massa, nasça em lote.
2. **`ON CONFLICT (email)` não é idempotência** quando o e-mail pode ser nulo:
   NULL não conflita com NULL. A chave tem de ser a que sempre existe.
3. **Lista de valores escrita à mão no frontend envelhece calada.** A de `tipo`
   era da dn.ia e já não tinha `csv_import`, do lote 1A — dava para importar
   contato que ninguém segmentava. Agora vem do banco (`/tipos-de-contato`).
4. **A spec erra vocabulário, não só número.** `stage` é em inglês; não existe
   status "Cliente". Conferir contra o banco antes de escrever.
5. **Matar o pytest no meio vaza dado.** A fixture do webhook commita e só
   desfaz no teardown; um `timeout` deixou a linha e o índice único derrubou a
   rodada seguinte inteira. A fixture agora limpa antes de inserir.

## O que o 5C entregou

O defeito dos 2.080 fechou por gatilho, não por backfill: a correção age em
toda escrita futura, não repontua o passado de uma vez só. `dndash_lead_id` é o
**contato canônico** de uma identidade, não uma cópia — e que N contatos
apontem para a mesma identidade é decisão já tomada no lote 1C, não algo que o
5C reabriu.

O Meta Conversions API nasce **parametrizado e desligado**: pixel, token e
`test_event_code` têm lugar na tela e no banco, mas sem credencial gravada
nada dispara. A pergunta "a HS faz anúncio no Meta?" continua em aberto — ver
"Antes de continuar, o que depende do Erick".

A tela de **Configurações** agora só espera o `NexusCard` (5A, bloqueado) para
liberar o trabalho de visual — o `MetaCard` do 5C já chegou.

O portão fechou as três functions de identidade e Meta
(`merge-identities`, `meta-config`, `send-to-meta-capi`): pela quarta vez no
projeto, a documentação (tela de Documentação da API + `dnmarketing-api.yaml`)
ainda ensinava uma URL morta a integradores depois de a tela real já ter
migrado. Placar da pasta de especificação: **26 functions portadas** e **6
descartadas** (números que não se somam), restando **22**.

## O que a revisão final do 5C achou

Seis achados. Nenhum vira código agora — todos descrevem comportamento herdado
que o 5C não piorou.

1. **I1** — A FK nova mudou o contrato de `POST /publico/identidade`. O
   `IdentidadeIn` (`backend/app/routers/publico.py:34-42`) não valida
   `source_app`, ao contrário do `EventoIn`, que tem `pattern`. Um integrador
   que omite `source_app` e manda o `local_id` do sistema dele cai no ramo
   `marketinghs` da `resolve_or_create_identity`, que grava esse id em
   `dndash_lead_id` — e agora leva `ForeignKeyViolationError` sem
   `try/except`, virando 500 com mensagem de Postgres. Antes da 015 isso
   gravava lixo em silêncio e a visão 360° vinha vazia, então falhar é melhor
   que o que havia; o que falta é falhar com 400 e mensagem. ⚠️ Esta nota
   previa "conserto natural no lote 7" — não aconteceu. Conferido em
   08/09/2026: `IdentidadeIn.source_app` (`publico.py:39`) continua
   `str | None = None`, sem o `pattern` que `EventoIn` já tem. Ainda em
   aberto para um próximo lote: o mesmo `pattern` do `EventoIn`, mais 400
   quando o `local_id` não resolve.
2. **I3** — A migration 015 promete uma guarda que outro caminho contorna. O
   comentário do gatilho diz que a guarda `dndash_lead_id IS NULL` impede
   roubar o canônico; mas a `resolve_or_create_identity` (migration 007), no
   passo 5, faz `dndash_lead_id = COALESCE(p_local_id, dndash_lead_id)` sem
   guarda nenhuma. Importar um CSV cuja linha case por telefone ou e-mail com
   identidade que já tem canônico troca o canônico em silêncio. Não é
   regressão do 5C — é herdado —, mas as duas implementações discordam sobre
   quem é dono do canônico.
3. **M1** — O gatilho não vê a exclusão pela ficha, que é soft delete
   (`escrita_contatos.py:379` faz `UPDATE leads SET deleted_at`). O gatilho é
   `UPDATE OF dnia_id` e não dispara, então a identidade segue apontando para
   contato excluído — e o `COMMENT ON FUNCTION` diz "apontando para um
   contato **vivo**". Zero casos hoje, conferido. Ampliar para
   `UPDATE OF dnia_id, deleted_at` resolveria, mas muda o significado de
   "canônico" e merece decisão própria.
4. **M2** — `apagar_segredo` documenta uma obrigação que seu único chamador
   ignora. O docstring avisa que apagar do banco não garante que o segredo
   sumiu (o `ler_segredo` cai para `os.environ`) e que quem chama precisa
   saber, "para não dizer ao usuário que removeu". O `gravar_config_meta`
   descarta o booleano e devolve `limpados` incondicionalmente; o card mostra
   "Valor removido". Com `META_ACCESS_TOKEN` no ambiente, a pessoa vê o card
   continuar "configurado" sem explicação.
5. **M4** — Sobrou um buraco na carga do DataCore que o gatilho não fecha. O
   passo 2 termina em `ON CONFLICT (email) DO NOTHING`: quando o e-mail
   colide, nenhuma linha é inserida, o gatilho não dispara, e aquela
   identidade fica sem canônico para sempre — e o backfill da 015 também não
   a alcança, porque o lead que existe está sob outra identidade. Zero casos
   hoje.
6. **M5** — A 015 inverteu a ordem de aquisição de lock dentro de
   `merge_identities` (antes K depois D; agora D depois K, adquirido dentro
   do gatilho). Não é classe nova de deadlock —
   `merge_identities(A,B)` concorrente com `(B,A)` já era simétrico —, mas
   agora o lock é invisível para quem lê o corpo da função.

⚠️ **Uma dependência de ordem que hoje só existe por sorte.** Na sincronização
do DataCore, o passo 1 insere as identidades e o passo 2 insere os leads. É
essa ordem que faz o gatilho funcionar — quando ele roda, a identidade já
existe. Se alguém inverter os dois passos, o gatilho não acha linha nenhuma e
o defeito dos 2.080 volta, calado.

## Migrations aplicadas

| | |
|---|---|
| **010–012** | lote 4 (jornadas) |
| **013** | `ecosystem_identities.datacore_cliente_id` + índice único parcial |
| **014** | lote 5D (imagens de e-mail) |
| **015** | lote 5C — gatilho do contato canônico (defeito dos 2.080) |

## Antes de continuar, o que depende do Erick

1. ~~Cadastrar `[marketinghs]` no cadastro de bancos~~ — **feito**
2. ~~Trocar a senha do superusuário do Postgres~~ — a ferramenta está pronta:
   `bash ~/trocar-senha-admin.sh marketinghs`. ⚠️ Depois, atualizar
   `POSTGRES_PASSWORD` no EasyPanel.
3. Preencher `POSTGRES_HOST_INTERNO` em `~/marketinghs.env`
4. **Passar o contrato do 5A** para o agente do `hsgrowth-sistema`
5. Decidir sobre `DATACORE_EMAIL_DE_NOTAS` (190 → 327 contatos alcançáveis)
6. Decidir sobre o **push do `main`** (era "push da branch", até o merge de
   04/09): ele é o que rompe o sync com o Lovable. São **123 commits** locais
   que o remoto não tem — e a branch `lote-7` soma mais **14** em cima disso,
   ainda não mergeada em `main` (08/09/2026).
   ⚠️ Antes de pushar, ver o `SETUP-CLAUDE.md` (não versionado): o `.env` da
   dn.ia com credenciais do Supabase está no histórico do git desde o commit
   inicial do remix. Pushar publica esse histórico — reescrevê-lo é mais
   barato antes do primeiro push que depois.
7. **Decidir se a HS faz anúncio no Meta** — sem isso o CAPI fica configurado e
   desligado, que é um estado válido.
8. ⚠️ **`scripts/aplicar-migrations.sh` não roda de novo.** Ele reaplica desde
   a `001_schema_origem.sql`, que é dump bruto do Supabase sem `IF NOT EXISTS`,
   e morre em `type "app_role" already exists`. O cabeçalho do próprio script
   diz "Idempotente: pode rodar de novo sem estragar o que já existe" — mentira,
   é o `CLAUDE.md` do repo que está certo ao dizer o contrário. A `015` deste
   lote foi aplicada direto por `psql` e conferida rodando duas vezes. Decidir:
   conserta o script, ou conserta o cabeçalho.
9. ⚠️ **`frontend/index.html` ainda manda telemetria do admin interno para
   terceiros da dn.ia**, nas linhas ~228-280, em toda página do admin: o
   tracker do Supabase **da dn.ia**
   (`luinwzmegsdjckjxoimx.supabase.co/functions/v1/tracker`, com o `pid` da
   dn.ia) e o tracker do **Lovable** (`lovableproject.com/api/v1/tracker.js`).
   Não são analytics — o `CLAUDE.md` do repo abre dizendo "o Lovable e o
   Supabase saíram" — saíram do código, não daqui, e isso também desmente ao
   pé da letra a frase do portão de que nenhuma tela fala com o Supabase: o
   `index.html` fala, antes de qualquer tela carregar. Estes dois saem sem
   discussão — não é decisão de marketing, é parar de mandar telemetria da
   casa para um terceiro. Nenhuma tarefa do lote 5C tem escopo sobre esse
   arquivo.
10. **Decidir sobre o Google Analytics (`G-P6GLV8VVNR`) e o GTM
    (`GTM-59T4XHKS`)**, no mesmo `frontend/index.html`. Ao contrário do item
    9, isto É decisão de negócio — alguém na casa pode ler aqueles
    relatórios. Empacotar os quatro rastreadores como um item só (como a
    versão anterior deste documento fazia) prende essa decisão de marketing a
    dois trackers que não têm nada a ver com ela.
11. **Preencher o host de produção do `frontend/public/api/dnmarketing-api.yaml`**
    — o bloco `servers:` hoje é um placeholder explícito
    (`PREENCHER-O-HOST-DE-PRODUCAO`) porque ninguém aqui sabia o host real.
    Até ele ser preenchido, o arquivo público que ensina a API a
    integradores externos aponta para um valor que não resolve — o que é
    melhor que ensinar o host morto do Supabase da dn.ia, mas ainda não é a
    resposta certa.
12. **Gravar a chave da Anthropic** em Configurações → IA — sem ela o chat de
    dados e as duas análises (leads e desafios) respondem 400. Custo
    estimado: **~$15/mês**, para saber o que esperar na fatura.
13. **Decidir sobre as duas linhas de teste em `dashboard_settings`**
    (`lead_goal` e `dashboard_cards`, gravadas em 03/09/2026 pelos curls do
    plano do lote 6, não por uma pessoa) — apagar as duas, ou configurar a
    meta de verdade pela tela. Enquanto ninguém decide, o medidor de meta do
    painel mostra o padrão de 1.000 porque o payload de teste não tem a
    chave `goal`.
14. ⚠️ **O modelo de permissão de `backend/app/routers/escrita_contatos.py`
    pede uma resposta de negócio, não de código.** `mudar_status`,
    `status_em_lote`, `tags_em_lote` e `editar_contato` autorizam por
    `usuario_atual` — QUALQUER usuário logado, não só admin — mas rodam sob
    `sessao(role="service_role")`, que tem `BYPASSRLS`; só `fundir_contatos`
    e `excluir_contato` exigem `admin_atual`. Uma revisão da tarefa 5
    apontou isso como Crítico; a decisão foi NÃO mexer, porque o corte é um
    modelo de permissão coerente — mudar status, tag e campo de um contato é
    trabalho do dia a dia de marketing, fundir e excluir são operação
    destrutiva de admin — e chamar isso de furo pressupõe uma resposta a uma
    pergunta de negócio que não é do código responder. Essa decisão
    permanece. O que fica em aberto para o Erick: **um usuário não-admin
    deveria poder mudar status, tag ou campo de um contato?** Fato, para a
    decisão: `service_role` tira a segunda linha de defesa (RLS) desses
    quatro caminhos, e `leads` não tem política de UPDATE nenhuma —
    conferido em `001_schema_origem.sql`, só há `Admins can delete leads` e
    `Admins can read all leads`. Hoje existe exatamente **um** usuário, e é
    admin — nada está exposto ainda, mas o dia que existir um segundo
    usuário não-admin (lote 0 já tem a tela de Usuários), a resposta importa.
15. **`dashboard_cards` virou preferência global; era por usuário.** Antes
    deste lote a chave era `card_prefs_${user.id}_${tabName}`, uma por
    pessoa; a portagem colapsou para uma chave só,
    `dashboard_cards`, compartilhada por todo mundo. O docstring do código
    (`useDashboardCards` / rota de `/painel`) chama isso de intencional —
    "escolha de cartões são do painel da empresa, não da pessoa" — mas essa é
    uma leitura de negócio de quem escreveu o plano, não uma decisão que o
    Erick tomou. Vale notar que o mecanismo por usuário já existe e não foi
    usado: `/preferencias/{chave}` (`configuracao.py`) compõe a chave com o
    id do usuário autenticado — é o que a linha sobrevivente
    `...:colunas-contatos` prova que funciona. Latente hoje, com um usuário
    só; no dia em que a tela de Usuários do lote 0 criar um segundo admin,
    um admin escondendo um cartão some com ele do painel do outro, sem
    explicação nenhuma na tela.
16. **O chat de IA segura uma conexão do pool e uma transação aberta durante
    a conversa inteira com o modelo.** O pool abre com `max_size=10`
    (`database.py:32`); `enviar_mensagem` (`/ia`) abre `sessao()` — uma
    transação — e só fecha depois de `analista.responder`, que encadeia até
    `MAX_VOLTAS = 8` idas e vindas ao modelo, cada uma com `TIMEOUT = 120`s,
    mais as re-tentativas do SDK, sem prazo total para a chamada inteira. Dez
    conversas de chat simultâneas esgotam o pool inteiro e travam qualquer
    outro request — inclusive login. Não alcançável hoje com um usuário só;
    merece decisão (prazo total, ou tirar a query do modelo de dentro da
    transação) antes de o sistema ter vários.
17. **`page_stats` e `/publico/paginas` discordam sobre o que é "lead da
    página".** A view conta por `lead_conversions.page_slug`; a rota pública
    conta por `leads.source = slug`. As duas foram portadas como estavam —
    mudar qualquer uma alteraria número que alguém pode estar lendo. Qual das
    duas é a definição certa é pergunta de negócio.
18. **A tela de Páginas não consegue criar a primeira página.**
    `NewPageDialog.tsx:52` exige `cloneFrom`, e com a tabela vazia não há de
    onde clonar. Herdado — fazia sentido com as 26 landings da dn.ia. Some
    sozinho quando a landing da HS existir; até lá, página nova só por
    `POST /publico/paginas`.
19. **`frontend/index.html` continua mandando telemetria do admin para
    terceiros da dn.ia** (item 9, que segue aberto) — repetido aqui porque
    este lote passou perto e não resolveu; não era escopo de nenhuma tarefa
    do plano do lote 7.
20. **Os presets de UTM são gravados em duas formas diferentes** no mesmo
    array `config.utm_presets`: a rota pública grava
    `utm_source`/`utm_medium`; a tela grava `source`/`medium`/`name`.
    Herdado da `pages-api`. Medido ao vivo em 08/09/2026.
    ⚠️ A consequência que não é óbvia: preset gravado pela rota pública
    aparece na tela com os **campos em branco**, e o botão "Copiar link"
    entrega uma URL sem parâmetro nenhum — o `UTMPresetsModal` lê
    `p.source`/`p.medium`, não `p.utm_source`/`p.utm_medium`.
21. **A fusão de contatos move as conversões e não recalcula a data.**
    `backend/app/routers/escrita_contatos.py:305` reatribui as
    `lead_conversions` do contato descartado para o mantido, mas
    `last_conversion_date` não está em `_CAMPOS_HERDAVEIS` e nada recalcula
    depois — o mantido fica com a data antiga mesmo herdando conversões mais
    recentes. **É anterior ao lote 7 e não é regressão dele**; entrou aqui
    porque a revisão final do lote o encontrou e porque agora existe
    `_recalcular_datas` (em `publico.py`), o que reduz a correção a uma
    chamada. Mesma família do defeito que o lote 7 consertou em
    `POST /publico/conversao`: neste banco, data de última conversão errada
    não dá erro, dá número de painel plausível.
22. **A oferta da landing** — o que o lead ganha ao preencher. Decisão do
    Nicholson; até ela existir, a landing mostra os textos padrão.
23. **Os sete campos da dn.ia na lista branca da captura**
    (`tipo_participante`, `presenca`, `indicacao`, `interesse_formacao`,
    `interesse_ecossistema`, `interesse_mtia`, `data_interesse`) — funil de
    evento e mentoria que a HS não tem. Ficam porque as colunas existem e
    integrador externo pode estar mandando. Tirá-los é decisão de negócio.
24. **A URL pública da landing** — hoje `/p/{slug}` no backend. A URL limpa do
    anúncio depende do host de produção, que é o item 11. ⚠️ **E o nginx de
    produção precisa rotear `/p/` e `/landing/` para o backend** — em
    desenvolvimento quem faz isso é o proxy do Vite (`vite.config.ts`); sem a
    regra no nginx, todo link de anúncio cai no 404 do admin.
25. **Apagar a conta admin do Claude** (`claude.dev@example.com`) quando o
    sistema estiver funcionando. Criada em 10/09/2026, com autorização do
    Erick, para o Claude conferir telas no navegador; a credencial fica fora
    do repositório, em `~/.config/marketinghs/claude-admin.env`. Aproveitar e
    redefinir a senha de `erick@healthsafety.com.br`, que se perdeu.
    ⚠️ A restauração da VPS em 10/09 (banco de volta a 04/09) já levou a
    conta; o arquivo de credencial ficou no disco. Recriar só com ok do Erick.
26. **A marca da dn.ia ainda aparece no admin** — trabalho de transformação,
    não de visual: a aba do navegador se chama **"dn.mkt"** (`index.html`,
    `<title>` e `og:title`); há um botão flutuante **"Abrir DNIA AI"**; a ficha
    do contato mostra **"DN.IA ID"** e filtros de histórico **dnMarketing /
    Nexus / mentor.ia**; e `public/ab.js` aponta para `dnmkt.dnia.ai`.
    → resolvido: o `ab.js` no 8C, o resto no 8E (22/09/2026).
27. **A timeline da ficha esconde reconversão feita em até 60 segundos** do
    cadastro — trata como duplicata do "Primeiro cadastro"
    (`LeadDetailSheet.tsx:130`). Herdado, intocado no porte; os dados estão
    certos no banco. Só aparece em teste ou em duplo envio.
28. **O preview do editor de Páginas é a landing de verdade** — enviar o
    formulário dentro dele cria contato e conversão reais. A origem passava
    `?preview=true`, que a casca não trata. Baixo risco, mas vale saber antes
    de alguém "testar" a página pelo preview.
29. ⚠️ **A verificação de tipos do frontend era vazia em todo lote até
    aqui** — `npx tsc --noEmit` sem `-p` checa zero arquivos e sai 0 sempre
    (`frontend/tsconfig.json` só tem `references`). Achado da Tarefa 8 do
    8A, em 10/09/2026. O comando certo é `npx tsc --noEmit -p
    tsconfig.app.json`; ele expôs um defeito real que o vazio escondia:
    `LeadScoringSettings.tsx:55` lê `result.updated` de uma resposta que vem
    `{ atualizados }` (`backend/app/routers/contatos.py:184`), e o aviso na
    tela sai "Score recalculado para undefined leads!". Uma palavra para
    consertar — não fiz porque é fora do escopo do 8A, mas é achado, não
    dúvida.
30. **Para o 8E (limpeza da marca dn.ia/Lovable):** três achados ao vivo do
    portão da Tarefa 8, em 10/09/2026. O rastreador do Lovable
    (`lovableproject.com/.../tracker.js`, em `frontend/index.html`) dispara
    de fato em toda carga do admin — hoje o navegador bloqueia a resposta
    por ORB, mas a chamada de saída da casa para um terceiro acontece
    mesmo assim. O card "Webhook de eventos", em Configurações, ainda diz
    "Configure WEBHOOK_SECRET no Supabase Secrets" — texto morto, o
    Supabase saiu e o segredo agora vive em `integration_secrets`. E há um
    card "mentor.ia" da dn.ia na mesma tela. Nenhuma tarefa do 8A tinha
    escopo sobre esses três. → resolvido no 8E (22/09/2026).
    ⚠️ Correção (22/09): o `WEBHOOK_SECRET` do webhook de eventos é variável
    de ambiente do backend (`app/config.py`), não `integration_secrets` —
    quem vive lá é o `RESEND_WEBHOOK_SECRET`. O card agora diz isso.
31. **Lead Qualificado avança o contato para `opportunity` no ecossistema?**
    A origem avançava (`resolve_or_create_identity` com `p_stage:
    'opportunity'`) e a documentação publicada prometia; a rota do admin já
    não avança (o comentário em `mudar_status`, `escrita_contatos.py`) e o
    8B manteve as duas portas de escrita concordando: nenhuma avança hoje. Se
    a resposta for sim, é uma linha nas duas rotas ao mesmo tempo — nunca
    numa só, para não reabrir a discordância entre portas que já mordeu este
    projeto.
32. **Apagar as linhas órfãs de `journey_events`** — 1.522 no portão do 8B,
    **740** depois da restauração da VPS de 10/09 (banco de volta a 04/09) —
    ou deixar como estão. Cada rodada da
    suíte inteira acrescenta ~27 (`form_submitted`, `email_sent`,
    `email_opened`, `email_bounced`, `contact_reactivated`,
    `email_complained`) — vazamento antigo das fixtures de captura/
    conversão/envio/webhook, não do 8B. Duas formas de parar de crescer:
    limpeza numa fixture comum, ou banco de teste separado.
33. **Sync de tags vindo do CRM deve continuar pondo o contato no filtro
    "Plataforma: Nexus"?** Se sim, a rota de tags (`sincronizar_tags`,
    `api_contato.py`) volta a gravar `source_app='nexus'` (uma palavra, como
    a origem); se não, o filtro passa a depender só de `nexus_contact_id`.
    Ver a consequência da decisão 3 do 8B, no topo deste documento.

## Como subir o que existe

```bash
cd backend && ./.venv/bin/python -m uvicorn app.main:app --port 8100 --reload
cd frontend && npx vite --port 8080
cd backend && ./.venv/bin/python -m app.worker    # jornadas + fila de e-mail
```

⚠️ A porta 8000 é do **TaskHS** nesta máquina; o MarketingHS usa 8100 no host.

⚠️ Sem `RESEND_API_KEY` o worker **não consome a fila de e-mail**, de propósito
(decisão do Erick, lote 3B). As jornadas rodam; só o envio espera.

⚠️ `DATACORE_URL` usa o papel **`leitura`**, e a pool abre em
`default_transaction_read_only=on`. A sincronização é de mão única e o servidor
é quem garante.

---

## Histórico dos lotes anteriores

### O que o lote 3 deixou pronto

| | |
|---|---|
| **3A** | CRUD de campanha e template, audiência ao vivo, acompanhamento |
| **3B** | Fila (visibility timeout, recuo, fila-morta), worker, montagem por destinatário, descadastro assinado |
| **3C** | Webhook do Resend, agendador, API pública, config do Resend e supressão pela tela |

**28 testes** cobrem o motor e o webhook — as duas partes que a spec manda
nascer com teste automatizado. `pytest` inteiro: 55.

### O que o portão pegou nestes lotes, e o plano não

Vale ler antes do próximo lote, porque o padrão se repete:

1. **A rota `/descadastrar` não existia.** O worker assinava um link para ela em
   todo e-mail e daria 404.
2. **`campaigns-api` e `templates-api` também serviam integrador externo** —
   portar as telas não as tornou órfãs.
3. **O webhook estava sob o limite de taxa de `/publico`** (30/min por IP). Uma
   campanha de mil e-mails geraria milhares de eventos, e o Resend levaria 429 e
   re-tentaria por 10 horas.
4. **As rotas de supressão aceitavam usuário sem papel**, que poderia desfazer
   descadastro e hard bounce.
5. **A documentação ensinava URLs mortas** — três vezes: a tela de Documentação
   da API, o `dnmarketing-api.yaml`, e o exemplo da merge tag no editor.

Nenhum desses estava no plano. Todos apareceram porque o portão tem três partes
e a terceira é abrir no navegador.

### O que era "o próximo passo" quando o lote 3 fechou

⚠️ **Histórico — não é o próximo passo de hoje.** O de hoje está lá em cima,
e é a captação pública. Os lotes 4, 5 e 7 já fecharam.

**Lote 4 (Jornadas)** ou **lote 5 (Integrações HS)**. O 4 depende do motor, que
agora existe; o 5 traz os 2.077 clientes do DataCore e ⚠️ **exige trocar a senha
do superusuário do Postgres antes**.

Para o lote 4, o que já está levantado: as quatro funções de fila de jornada
(`journey_queue_read`, `journey_queue_delete`, `journey_enqueue_email`,
`fn_contact_event_to_journey_queue`) e a `evaluate_automation_on_etiqueta` foram
removidas do schema no lote 0 e precisam voltar em Python. A tabela de fila
`journey_events` **não existe** — o 3B criou só a de e-mail, de propósito. As
funções de jornada que SOBREVIVERAM (`journey_claim_due_runs`,
`journey_enroll_event`, `journey_wake_on_event`, `validate_journey_graph`) não
se reimplementam.

### Lote 2 (Segmentos), antes disso

Segmento funciona de ponta a ponta pela tela: criar estático escolhendo contatos
na busca, criar dinâmico montando regras com a prévia contando ao vivo, editar,
duplicar, ver a lista de contatos, e excluir — com a guarda do banco recusando
quando o segmento está em uso e mostrando **qual campanha** o usa.

A API pública `/publico/segmentos` substituiu a `segments-api`. O portão pegou
duas chamadas mortas que nenhuma tela fazia: a tela de Documentação da API e a
especificação OpenAPI pública ainda ensinavam `/segments-api` aos integradores.

### Lote 1D (A porta pública), antes disso

A autenticação por chave de API existe: criar chave devolve a chave crua uma vez
e nunca mais, o escopo é aplicado nos dois sentidos, chave inválida e ausente
dão 401. Isso **destrava as 23 functions restantes** que dependiam dela.

⚠️ **Pendência honesta que continua aberta:** a tela de chaves nunca foi clicada
no navegador. O código está portado, tipado e compilando, e os endpoints foram
verificados por HTTP — mas um overlay de outra aba bloqueou o clique, e o portão
exige o clique. O lote 2 usou chaves de API de verdade contra os endpoints
públicos, o que aumenta a confiança no backend, mas **não** substitui abrir a
tela de Configurações → API Keys e criar uma chave clicando.

### Lote 1C (Escrita), antes disso

A barra de ações em massa funciona: alterar status, aplicar tag, exportar,
apagar e mesclar. A fusão acontece numa transação no servidor — provado forçando
uma falha no meio e conferindo que nada mudou.

O acesso direto ao banco caiu de 153 para **90 pontos**.

### Lote 1B (Leitura do admin), antes disso

A tela de Contatos lista os contatos, com tags, scores e pílulas de ecossistema.
A ficha abre com timeline de conversões, histórico de interações, notas e tags —
e criar nota pela ficha funciona (conferido clicando, não só pela API).

A barra de ações em massa aparece como "não portada" dentro do próprio limite de
erro, sem levar a tabela junto. É do lote 1C.

### Lote 1A (Entrada), antes disso

Funciona, conferido no navegador com um CSV real de 5 linhas: a tela de
Importar sobe o arquivo, deduplica por e-mail (inclusive maiúsculas), funde
linhas duplicadas do mesmo arquivo sem perder a mais completa, ignora linha sem
e-mail, normaliza status, aplica tag em lote e grava com score e etiqueta
calculados pelo trigger. Carla (Gerente de SESMT, site, WhatsApp, desafio
escrito) sai `hotlead` com 60; Elaine (Auxiliar, csv_import) sai com 0.

A régua de scoring é editável em Configurações → Lead Scoring, e a tela avisa
que salvar não repontua a base — para isso há o botão de recalcular.

### Lote 0 (Fundação), antes disso As nove tarefas fecharam. O que funciona de
verdade, conferido no navegador com Playwright e não só por teste:

- Login em `http://127.0.0.1:8080/login` com usuário do banco `marketinghs`
- A sidebar do admin abre
- A aba **Configurações → Usuários** lista, cria, promove, rebaixa, troca e-mail,
  reseta senha e exclui — tudo contra a API própria
- Tela não portada mostra "Tela ainda não portada: `<alvo>`" sem derrubar a casca

### O que o 1C fez, para referência

**Escrever o plano do lote 1C (Escrita).** As duas barras de ação em massa
somam 34 pontos de acesso direto — é o maior bloco isolado que resta — mais o
`StatusDropdown`. As functions são `contact-update`, `contact-status-update`,
`contact-tags-sync`, `apply-lead-tag` (que ficou desde o 1A) e `delete-contact`.

**Pronto quando:** você muda o status de um lote de contatos pela tela.

### O que o 1B fez, para referência

**Escrever o plano do lote 1B (Leitura).** Um plano por lote é o combinado.

O 1B mostra o que o 1A importou: `contacts-list` e `contact-details` como API
pública (autenticada por chave, não por JWT — é um segundo modelo de auth que o
backend ainda não tem), mais os endpoints de admin que substituem `useLeads`,
`useContactsEnriched` e a tabela de Contatos.

**Pronto quando:** a tela de Contatos lista os contatos importados e a ficha
360° abre com a timeline.

Uma decisão que nasce no 1B: a lista hoje ordena por `updated_at`, e recalcular
scores carimba esse campo em toda a base de uma vez, embaralhando a ordem.
Provavelmente deve passar a ordenar por `created_at`.

## Antes de começar, o que depende do Erick

1. ~~Cadastrar `[marketinghs]` no cadastro de bancos~~ — **feito**, o apelido
   já responde a `bancos.consultar`
2. Preencher `POSTGRES_HOST_INTERNO` em `~/marketinghs.env`
3. **Trocar a senha do superusuário do Postgres** — obrigatório antes do lote 5,
   não bloqueia o 3
4. Decidir sobre o **push da branch**: ele é o que rompe o sync com o Lovable.
   Está na spec e é intencional, mas nunca foi feito. ⚠️ Antes de pushar, ver o
   `SETUP-CLAUDE.md` (não versionado): o `.env` da dn.ia com credenciais do
   Supabase está no histórico do git desde o commit inicial do remix.

## Como subir o que existe

```bash
cd backend && ./.venv/bin/python -m uvicorn app.main:app --port 8100 --reload
cd frontend && npx vite --port 8080
```

⚠️ A porta 8000 é do **TaskHS** nesta máquina; o MarketingHS usa 8100 no host.
Dentro do contêiner o backend continua na 8000.

## O que o lote 0 ensinou, e que vale para os próximos

**A revisão pegou quatro defeitos no plano, não no trabalho.** A regex que
apagaria cinco funções a mais; o 503 prometido sem handler; a porta errada no
`.env.example`; e o `DELETE` que faltava no grant de `auth.users`. Planos deste
projeto merecem desconfiança na execução.

**O portão foi contado pela metade uma vez.** Na tarefa 6 as 6 functions saíram
da pasta enquanto a tela ainda as chamava. A tarefa 8 consertou, mas a lição é
que o portão só vale se as duas condições forem verificadas de fato.

**O motor do lote 3 é maior do que a spec estimou:** 14 funções e 2 triggers,
não 9 funções.
