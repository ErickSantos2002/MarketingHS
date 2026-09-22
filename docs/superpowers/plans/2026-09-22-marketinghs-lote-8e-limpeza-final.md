# MarketingHS — Lote 8E: Limpeza final — Plano

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para executar tarefa a tarefa.
> Os passos usam caixa de seleção (`- [ ]`) para acompanhamento.

**Objetivo:** o MarketingHS deixa de carregar qualquer coisa da origem que não
seja dele: sai o toco do Supabase (`integrations/supabase/`), a pasta de
especificação `backend/supabase/`, os rastreadores de terceiro do
`index.html`, as dependências mortas, os arquivos órfãos do Lovable e a marca
dn.ia visível ao usuário. **Quando este lote fechar, a travessia acabou.**

**Arquitetura:** não há arquitetura nova. É remoção e troca de texto, em
quatro frentes independentes (casca HTML, toco, marca, ecossistema) e um
portão. Nada de backend muda além de comentário e nome de arquivo servido.

**Stack:** React 18 + Vite + TypeScript · Playwright (conferência)

**Spec:** `docs/superpowers/specs/2026-08-31-marketinghs-design.md`
**Documento-mãe:** `docs/superpowers/plans/2026-09-10-marketinghs-lote-8-fechamento.md` (seção "8E — Limpeza final")
**Inventário que fundamenta o plano:** feito em 22/09/2026, resumido abaixo em "O que foi achado".

---

## Restrições globais

- ⚠️ **Visual NÃO muda.** Paleta, fontes, tema (`theme-dnmarketing`,
  `text-gradient-dnia` e demais nomes de classe) e layout ficam como estão —
  decisão do Erick de 10/09: primeiro a transformação, depois o visual. O que
  muda é **marca** (nome, logo, texto que diz "dn.ia") e **lixo** (código,
  arquivo e chamada de rede da origem).
- **Nomes internos ficam.** `dnia_id`, `ecosystem_identities`,
  `nexus_contact_id`, `mentoria_client_id`, `source_app`, `DniaIdChip` e afins
  são estrutura de banco ou nome de código — não são alvo. Só muda o que o
  usuário **lê** na tela.
- **Banco não muda.** Nenhuma migration neste lote. Nenhuma coluna sai,
  nenhum dado é apagado.
- **Backend não muda comportamento.** Só comentário e o nome do arquivo
  OpenAPI servido pelo frontend. Se uma tarefa achar que precisa mudar código
  Python, pare e relate (NEEDS_CONTEXT).
- **Comentário de linhagem fica.** "Portado de `supabase/functions/X`", "era o
  `pg_cron` do Supabase" etc. contam a história do código e não são lixo. Sai
  só comentário que **mente sobre o presente** (ex.: "ainda fala com o
  Supabase").
- **Comentário, nome e mensagem em português.**
- **Frontend:** `cd frontend && npx tsc --noEmit -p tsconfig.app.json && npx vite build`.
  O `tsc` tem erros **pré-existentes** — anote a contagem antes da primeira
  mudança (medido em 22/09: 4 erros, em `LeadScoringSettings` ×1 e
  `useJourneys` ×3). Nenhum erro novo.
- Existem outras sessões Claude na máquina em outros repositórios; não edite
  nada fora deste repo. **Copiar** arquivo de outro repo para dentro deste é
  permitido (logo e ícone da casa, Tarefa 3).

## Decisões do Erick (22/09/2026)

| # | Decisão |
|---|---|
| E1 | **Nenhum rastreador do `index.html` é da Health & Safety.** Saem todos: Meta Pixel `1441054460977757`, Google Analytics `G-P6GLV8VVNR`, Tag Manager `GTM-59T4XHKS`, o rastreador do Supabase (`luinwzmegsdjckjxoimx.supabase.co/functions/v1/tracker`) e o do Lovable (`lovableproject.com/.../tracker.js`). O painel é interno; rastreamento de landing é configurado por página (`pages.config`, `useClarity`), e isso não muda. |
| E2 | **Nexus (agendamento da dn.ia) e mentor.ia saem da interface**: pílulas, filtros, card vazio de Configurações, colunas de exportação e menção na documentação da API. **As colunas e os dados do banco ficam.** Medido em 22/09: 0 de 2.084 identidades com `nexus_contact_id` ou `mentoria_client_id`; 2 de 3.303 `contact_events` com `source_app='nexus'`, nenhum de mentoria. ⚠️ Isto **substitui** a restrição do 8D "não tocar nas pílulas Nexus". |
| E3 | **Modelo padrão de e-mail:** cabeçalho e rodapé com **"Health & Safety"** e link para **`https://healthsafety.com.br`** no lugar de "DN.IA" / `https://dnia.ai`. |
| E4 | **O assistente de IA do painel se chama "Assistente de dados"** (era "DNIA AI"). |

## Decisões tomadas neste plano

| # | Decisão | Motivo |
|---|---|---|
| 1 | **Marca da casa = a do HS.OS e do TalentHS.** `<title>` "MarketingHS — Marketing da Health &amp; Safety"; ícone `hs.ico` copiado de `~/github/HS.OS/frontend/public/hs.ico`; logo da casa copiado de um dos dois repos (Tarefa 3 escolhe a variante legível no fundo atual). | Precedente das duas travessias anteriores; nenhuma decisão nova de marca. |
| 2 | **`index.html` reescrito do zero, mínimo**, no molde do HS.OS: `<head>` com charset, viewport, título, descrição, ícone, o carregador de fonte do Google Fonts (visual fica), e `<div id="root">` + `main.tsx`. Sai o "Critical CSS Inline" da landing da dn.ia (`/programadeiaficacao`), `og:*`, `twitter:*`, `author` "Buscar ID", `dns-prefetch` de rastreador e todos os `<noscript>` de rastreamento. | O arquivo é a casca da landing de evento da dn.ia; o painel só precisa do `root`. ⚠️ Se a conferência visual (Tarefa 1, passo 5) mostrar diferença na tela, o bloco de CSS que a causou volta — só ele — e isso vira ruling. |
| 3 | **`robots.txt` passa a `Disallow: /` para todos.** | Sistema interno; hoje convida Googlebot, Bingbot, Twitterbot e facebookexternalhit. |
| 4 | **Assets sem importador saem** — 34 arquivos em `src/assets` (fotos de pessoas e eventos da dn.ia, ~23 MB) e 5 `.asset.json` do Lovable; em `public/`: `images/mentor-p1g.webp`, `og/ianamesa170626.png`, `placeholder.svg`, `favicon.png`. | Nenhum `import` os referencia (conferido por nome em 22/09). Fotos de terceiros num repositório nosso são passivo, não só peso. |
| 5 | **`LimiteDeErro` fica**, sem o ramo "Tela ainda não portada". | É o error boundary genérico da casca (envolve o outlet de rota e o `AIDataChat` em `AdminLayout.tsx`, e a barra de ações em massa em `Contacts.tsx`). Só o ramo do toco perde sentido. |
| 6 | **`bun.lockb` sai.** O lockfile da casa é o `package-lock.json` (npm). | Dois lockfiles divergem; o `bun.lockb` é do Lovable. |
| 7 | **O OpenAPI servido muda de nome**: `public/api/dnmarketing-api.yaml` → `public/api/marketinghs-api.yaml`, `info` reescrito (título "MarketingHS API", descrição sem ecossistema DN.IA, contato Health & Safety), sem menção a Nexus/mentor.ia. As rotas do arquivo já são as do MarketingHS (`/publico/*`) e não mudam. | O conteúdo técnico foi portado no 8B; só a capa ficou da origem. |
| 8 | **Pílula do próprio sistema:** a "D · dnMarketing" (sempre acesa) vira **"M · MarketingHS"**; ficam só ela e a "G · GrowthHS". | E2 tira N e M(entor); a letra M fica livre. |
| 9 | **Filtro de histórico por origem** (linha do tempo do contato): "dnMarketing" vira **"MarketingHS"** e casa `source_app` `marketinghs` **e** `dnmarketing` (733 eventos herdados da origem são do mesmo sistema, antes da troca de nome); Nexus e mentor.ia saem (E2). Eventos de outras origens (`website`, os 2 `nexus`) continuam aparecendo em "Todos". | Sem isso os 733 eventos antigos sumiriam do filtro do próprio sistema — corte silencioso. |
| 10 | **Card "Webhook de eventos"**: o campo que dizia "Configure WEBHOOK_SECRET no Supabase Secrets" vira texto explicativo: o token é o `WEBHOOK_SECRET` **do servidor** (variável de ambiente do backend, `app/config.py`), definido pelo TI; a tela não o mostra. Sai o botão de revelar (revelava uma frase, não um segredo). | O Supabase saiu; o segredo mora no `.env` do backend e não há rota que o leia — de propósito. |
| 11 | **"DN.IA ID" (chip na ficha)** vira **"ID do contato"**. | É o id da identidade; a marca não diz nada ao usuário. |
| 12 | **O backend não perde os filtros/campos de Nexus e mentor.ia** em `leitura_contatos.py`. A tela deixa de pedir e mostrar. | Banco e backend não mudam (restrições); tirar parâmetro de rota é mudança de contrato. Registrar como sobra no CONTINUAR. |

## O que foi achado (inventário de 22/09)

- **O toco** (`integrations/supabase/client.ts`, 37 linhas) só é importado por
  `LimiteDeErro.tsx` (`MARCA_NAO_PORTADO`). Na mesma pasta, `types.ts` (1.910
  linhas) e `previewAuthStorage.ts` (88, do editor do Lovable) não têm
  importador nenhum.
- **`@supabase/supabase-js`** e **`lovable-tagger`** no `package.json`:
  nenhum import, nenhum uso no `vite.config.ts`.
- **`SettingsPage.tsx:20`** lê `VITE_SUPABASE_PROJECT_ID` numa variável que
  ninguém usa.
- **`index.html`**: título "dn.mkt", descrição "Evento ao vivo de empresário
  para empresário.", `author` "Buscar ID", imagem OG no R2 do Lovable, Meta
  Pixel no `<head>`, e GA + GTM + Lovable + Supabase no carregador por
  interação (linhas ~227-290).
- **Marca visível:** `AIDataChat.tsx:56,69` e `useAIChat.tsx:24` ("DNIA AI");
  `DetailSections.tsx:95` ("DN.IA ID"); `DniaLogo.tsx` e
  `dnmarketing-logo.png` em `AdminSidebar.tsx:5-6,184-189`; `dnia-logo.png` em
  `Login.tsx:10,68`; `ApiDocumentation.tsx:930,936,946,958` (logo, links do
  OpenAPI, texto "master de identidade do ecossistema DN.IA");
  `emailEditorConfig.ts:45,74,91` (DN.IA e `https://dnia.ai` no modelo
  padrão); `SettingsPage.tsx:105-130` (webhook) e `:164-174` (card
  mentor.ia vazio).
- **Ecossistema:** `EcosystemPills.tsx:14-19` e os consumidores
  `ContactsTable.tsx`, `LeadDetailSheet.tsx`, `DetailSections.tsx`,
  `ContactsFiltersBar.tsx`, `ContactsFilterPanel.tsx`, `EventsTimeline.tsx`,
  `ContactsExport.tsx`, `useContactsEnriched.tsx`, `lib/leitura.ts`,
  `Contacts.tsx`.
- **Backend:** `backend/supabase/` tem `config.toml` e 7 arquivos em
  `functions/_shared/` — nenhum lido por código, teste ou script.
  `docs/ab-testing/` (8 arquivos) é a documentação da origem e contradiz o
  código.

---

### Tarefa 1: A casca — `index.html`, `robots.txt` e `public/`

**Arquivos:**
- Reescrever: `frontend/index.html`
- Modificar: `frontend/public/robots.txt`
- Criar: `frontend/public/hs.ico` (cópia de `~/github/HS.OS/frontend/public/hs.ico`)
- Apagar: `frontend/public/favicon.png`, `frontend/public/placeholder.svg`,
  `frontend/public/images/mentor-p1g.webp`, `frontend/public/og/ianamesa170626.png`
  (e as pastas `images/` e `og/` se ficarem vazias)

**Interfaces:**
- Produz: `/hs.ico` servido pelo Vite (a Tarefa 3 não depende dele).

- [ ] **Step 1: Registrar o "antes"**

Suba backend e frontend (comandos no `CLAUDE.md`; backend na 8100, Vite em
`127.0.0.1:8080`), entre com a conta admin do Claude
(`~/.config/marketinghs/claude-admin.env`) e tire screenshot de: `/login`
(antes de entrar), `/` (visão geral), `/contacts`, `/settings`. Guarde em
`/tmp/claude-1000/-home-ericks-github-MarketingHS/82732417-1d1f-4eac-89ae-4a0a1d208031/scratchpad/8e-antes/`.
Anote também a lista de domínios que a rede pediu ao carregar `/` e clicar
uma vez na página (Playwright `browser_network_requests`): é a prova do
problema.

- [ ] **Step 2: Reescrever o `index.html`**

Conteúdo inteiro do arquivo novo (a URL do Google Fonts é a mesma do arquivo
atual — copie-a do `<script>` do carregador de fontes existente, sem mudar
família nem peso):

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MarketingHS — Marketing da Health &amp; Safety</title>
    <meta name="description" content="MarketingHS — plataforma de marketing da Health &amp; Safety." />
    <meta name="robots" content="noindex, nofollow" />
    <link rel="icon" type="image/x-icon" href="/hs.ico" />

    <!-- Fontes do tema — carregadas por script para não bloquear a renderização -->
    <script>
      (function () {
        var l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = '<A MESMA URL DO GOOGLE FONTS DO ARQUIVO ATUAL>';
        document.head.appendChild(l);
      })();
    </script>
    <noscript>
      <link rel="stylesheet" href="<A MESMA URL DO GOOGLE FONTS DO ARQUIVO ATUAL>" />
    </noscript>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Se o arquivo atual tiver `preconnect` para `fonts.googleapis.com` /
`fonts.gstatic.com`, eles ficam (servem à fonte). Qualquer outro
`preconnect`/`dns-prefetch` sai.

- [ ] **Step 3: `robots.txt`**

```
User-agent: *
Disallow: /
```

- [ ] **Step 4: Ícone e arquivos órfãos de `public/`**

```bash
cd /home/ericks/github/MarketingHS/frontend
cp ~/github/HS.OS/frontend/public/hs.ico public/hs.ico
grep -rn "favicon.png\|placeholder.svg\|mentor-p1g\|ianamesa170626" src index.html   # tem de sair vazio
git rm -q public/favicon.png public/placeholder.svg public/images/mentor-p1g.webp public/og/ianamesa170626.png
```

- [ ] **Step 5: Conferir "depois" contra "antes"**

Recarregue as mesmas quatro telas, tire os mesmos screenshots em
`.../scratchpad/8e-depois/` e compare olhando. Esperado: **idênticas**, exceto
o título da aba e o ícone. Se algo mudou (fundo, fonte, cor antes da
hidratação), identifique a regra do "Critical CSS" antigo que fazia falta,
devolva **só ela** ao `index.html` num `<style>` com um comentário dizendo por
quê, e registre no relatório.

Rede ao carregar `/` e clicar uma vez: **só** `127.0.0.1` e
`fonts.googleapis.com`/`fonts.gstatic.com`. Nenhum `facebook`,
`googletagmanager`, `google-analytics`, `clarity.ms`, `lovableproject.com`,
`supabase.co`, `r2.dev`.

- [ ] **Step 6: Build**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.app.json; npx vite build
```

Esperado: mesma contagem de erros de `tsc` de antes; build ok.

- [ ] **Step 7: Commit**

```bash
git add -A frontend/index.html frontend/public
git commit -m "chore(8E): a casca deixa de chamar terceiros — rastreadores da dn.ia, Lovable e Supabase saem do index.html"
```

---

### Tarefa 2: O toco, as dependências mortas e os órfãos do Lovable

**Arquivos:**
- Apagar: `frontend/src/integrations/supabase/` (inteira: `client.ts`,
  `types.ts`, `previewAuthStorage.ts`)
- Modificar: `frontend/src/components/admin/LimiteDeErro.tsx`
- Modificar: `frontend/src/pages/admin/SettingsPage.tsx:20` (só a variável morta)
- Modificar: `frontend/src/pages/admin/Contacts.tsx:~179` (comentário que mente)
- Modificar: `frontend/package.json`, `frontend/package-lock.json` (via npm)
- Apagar: `frontend/bun.lockb`
- Apagar: os 5 `frontend/src/assets/*.asset.json` e os 34 arquivos de
  `frontend/src/assets/` sem importador (lista no Step 5)

**Interfaces:**
- Consome: nada.
- Produz: `LimiteDeErro` com a mesma API de props de hoje (só perde o ramo do
  toco). A Tarefa 3 apaga `dnia-logo.png` e `dnmarketing-logo.png` — **esta
  tarefa não toca neles**.

- [ ] **Step 1: `LimiteDeErro` sem o toco**

Remova o `import { MARCA_NAO_PORTADO } ...` e o ramo que mostra "Tela ainda
não portada". O comportamento que fica: qualquer erro de render mostra "Algo
quebrou nesta tela" — exatamente o texto e o layout do ramo genérico de hoje.
Ajuste o comentário do topo do componente para descrever o que ele é agora
(error boundary da casca), sem mencionar o toco como presente.

- [ ] **Step 2: Apagar o toco**

```bash
cd /home/ericks/github/MarketingHS/frontend
grep -rn "integrations/supabase" src     # esperado: vazio depois do Step 1
git rm -r -q src/integrations/supabase
```

Se `src/integrations/` ficar vazia, ela some junto.

- [ ] **Step 3: Variável morta e comentário que mente**

- `SettingsPage.tsx:20`: apague `const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID || '';`
  (confira antes que `projectId` não é lido em lugar nenhum do arquivo).
- `Contacts.tsx:~179`: o comentário diz que a barra de ações em massa "ainda
  fala com o Supabase". Confira na barra que não fala (ela usa `lib/api`);
  reescreva o comentário para dizer só por que o `LimiteDeErro` a envolve, ou
  apague-o se não houver motivo a registrar.

- [ ] **Step 4: Dependências**

```bash
cd /home/ericks/github/MarketingHS/frontend
grep -rn "@supabase/supabase-js\|lovable-tagger" src vite.config.ts   # esperado: vazio
npm uninstall @supabase/supabase-js lovable-tagger
git rm -q bun.lockb
```

- [ ] **Step 5: Assets sem importador**

```bash
cd /home/ericks/github/MarketingHS/frontend
# confira de novo, um por um, antes de apagar — tem de dar 0 para cada
for f in src/assets/*; do b=$(basename "$f"); \
  n=$(grep -rl --include=*.ts --include=*.tsx --include=*.css "$b" src | wc -l); \
  echo "$n $b"; done | sort -n
```

Apague com `git rm` **todo arquivo com contagem 0** (esperado em 22/09: 34
arquivos + os 5 `.asset.json`; ficam só `dnia-logo.png` e
`dnmarketing-logo.png`, que a Tarefa 3 troca). Se algum tiver contagem > 0 e
não for um dos dois logos, pare e relate.

- [ ] **Step 6: Build e navegação**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.app.json; npx vite build
```

Esperado: mesma contagem de erros; build ok. Abra `/`, `/contacts`,
`/settings` no navegador: sem erro de console.

- [ ] **Step 7: Commit**

```bash
git add -A frontend
git commit -m "chore(8E): o toco do Supabase sai — LimiteDeErro vira só error boundary; dependências e assets da origem saem"
```

---

### Tarefa 3: A marca — logo, assistente, e-mail, webhook, documentação da API

**Arquivos:**
- Criar: `frontend/src/assets/<logo da casa>` (copiado de `~/github/HS.OS/frontend/public/`
  ou `~/github/talenths/frontend/public/`)
- Modificar: `frontend/src/components/admin/AdminSidebar.tsx`
- Apagar: `frontend/src/components/admin/DniaLogo.tsx`,
  `frontend/src/assets/dnia-logo.png`, `frontend/src/assets/dnmarketing-logo.png`
- Modificar: `frontend/src/pages/admin/Login.tsx`
- Modificar: `frontend/src/components/admin/AIDataChat.tsx`, `frontend/src/hooks/useAIChat.tsx`
- Modificar: `frontend/src/components/admin/contacts/DetailSections.tsx` (só o texto do chip)
- Modificar: `frontend/src/components/admin/campaigns/emailEditorConfig.ts`
- Modificar: `frontend/src/pages/admin/SettingsPage.tsx` (card do webhook)
- Renomear e modificar: `frontend/public/api/dnmarketing-api.yaml` → `frontend/public/api/marketinghs-api.yaml`
- Modificar: `frontend/public/api/docs/index.html` (se apontar para o yaml pelo nome)
- Modificar: `frontend/src/components/admin/settings/ApiDocumentation.tsx`
- Modificar (só comentário): `frontend/src/components/admin/pages/UTMPresetsModal.tsx:~39`,
  `backend/app/routers/publico.py:~919,~1473` (nome do yaml)

**Interfaces:**
- Consome: nada das outras tarefas.
- Produz: o logo novo importado em `AdminSidebar` e `Login`.
- ⚠️ `ApiDocumentation.tsx` também menciona Nexus e mentor.ia — **esta tarefa
  reescreve o parágrafo de apresentação inteiro** (Step 7) já sem eles; a
  Tarefa 4 não volta a esse arquivo.

- [ ] **Step 1: Logo da casa**

Olhe (Read da imagem) os candidatos: `~/github/HS.OS/frontend/public/logo-hs-padrao.png`,
`~/github/talenths/frontend/public/logo.svg`, `logo-dark.svg`, `logo.png`.
Escolha a variante **legível no fundo atual** da barra lateral e da tela de
login (confira no screenshot "antes" da Tarefa 1, ou abra as telas). Copie
para `frontend/src/assets/` com um nome sem marca de terceiro (ex.
`logo-hs.svg` / `logo-hs.png`). Se nenhuma variante for legível num dos dois
fundos, use a melhor e registre no relatório — **não** mude o fundo.

- [ ] **Step 2: Barra lateral e login**

- `AdminSidebar.tsx`: sai o `DniaLogo` + `dnMarketingLogo`; entra o logo da
  casa com `alt="MarketingHS"`, ocupando o mesmo espaço (altura parecida com a
  do conjunto atual; confira no navegador).
- `Login.tsx`: `dniaLogo` → logo da casa, `alt="MarketingHS"`.
- Apague `DniaLogo.tsx`, `dnia-logo.png`, `dnmarketing-logo.png` depois de
  conferir com `grep -rn "DniaLogo\|dnia-logo\|dnmarketing-logo" frontend/src`
  (vazio).

- [ ] **Step 3: Assistente de dados (decisão E4)**

- `AIDataChat.tsx:56`: `aria-label="Abrir Assistente de dados"`.
- `AIDataChat.tsx:69`: o título exibido vira `Assistente de dados`.
- `useAIChat.tsx:24`: a saudação troca **só a apresentação**:
  "Sou o **DNIA AI**, seu analista de dados superinteligente" →
  "Sou o **Assistente de dados** do MarketingHS". O resto da mensagem (o que
  ele sabe fazer, exemplos) fica igual.
- Procure outros textos visíveis do assistente com "DNIA"/"dn.ia" (título do
  painel, placeholder do campo) com `grep -rni "dnia ai\|dn\.ia" frontend/src/components/admin/AIDataChat.tsx frontend/src/hooks/useAIChat.tsx`
  e troque do mesmo jeito. ⚠️ Se o **prompt de sistema** mandado ao modelo
  estiver no frontend ou no backend e disser "DNIA AI", troque também (é o
  nome com que ele se apresenta) — se estiver no backend, é mudança de texto,
  não de comportamento; registre.

- [ ] **Step 4: Chip "ID do contato"**

`DetailSections.tsx:95`: `DN.IA ID · {short}` → `ID do contato · {short}`. O
componente, o nome `DniaIdChip` e a cópia para a área de transferência ficam.

- [ ] **Step 5: Modelo padrão de e-mail (decisão E3)**

`emailEditorConfig.ts`:
- linha ~45 (cabeçalho): o texto `DN.IA` vira `Health &amp; Safety` (é HTML
  dentro de string — use a entidade, confira como o arquivo já escapa outros
  caracteres e siga o mesmo padrão).
- linha ~74: `href: 'https://dnia.ai'` → `href: 'https://healthsafety.com.br'`;
  o comentário acima (linha ~70) que fala de `https://dnia.ai` passa a falar
  do endereço novo.
- linha ~91 (rodapé): `DN.IA — Você está recebendo este email pois se
  cadastrou em um de nossos eventos.` → `Health &amp; Safety — Você está
  recebendo este e-mail porque se cadastrou em um de nossos canais.`
  ("eventos" era o negócio da dn.ia).
- linha ~101: o comentário que cita o projeto `dnmkt` — leia o contexto; se
  for um id de projeto de serviço externo (editor de e-mail), **não mude o
  valor**, só relate o que é.

Templates **já gravados no banco** não mudam (o banco não muda neste lote).
Conte quantos têm "DN.IA" ou "dnia.ai" no design, só leitura:

```bash
set -a; . ~/marketinghs.env; set +a
PGPASSWORD="$POSTGRES_PASSWORD" psql "postgresql://${POSTGRES_USER}@${POSTGRES_HOST_EXTERNO}:${POSTGRES_PORTA_EXTERNA}/${POSTGRES_DB}" \
  -Atc "select count(*) from email_templates where design::text ilike '%dn.ia%' or design::text ilike '%dnia.ai%' or html ilike '%dnia.ai%'"
```

(ajuste os nomes de coluna ao schema real; se a tabela tiver outro nome,
procure em `backend/app/routers/templates.py`). O número vai para o relatório
e para o CONTINUAR.

- [ ] **Step 6: Card do webhook (decisão 10 do plano)**

`SettingsPage.tsx:~119-130`: o bloco "Token de autenticação" deixa de ser um
`<Input>` com botão de revelar. Fica o rótulo "Token de autenticação" e um
parágrafo:

> O token é o `WEBHOOK_SECRET` do servidor — definido pelo TI no ambiente do
> backend. Por segurança, esta tela não o mostra.

seguido da linha que já existe ("Envie como header: `Authorization: Bearer
SEU_TOKEN`"). Remova o estado `tokenRevealed` e os ícones `Eye`/`EyeOff` se
ficarem sem uso.

- [ ] **Step 7: Documentação da API (decisão 7 do plano)**

```bash
cd /home/ericks/github/MarketingHS/frontend
git mv public/api/dnmarketing-api.yaml public/api/marketinghs-api.yaml
grep -rn "dnmarketing-api" . --include=*.html --include=*.ts --include=*.tsx ../backend/app
```

- No yaml, o bloco `info`:
  ```yaml
  info:
    title: MarketingHS API
    version: '2.0.0'
    description: |
      API pública do MarketingHS, a plataforma de marketing da Health & Safety.
      Permite a sistemas integrados gerenciar contatos, segmentos, campanhas,
      páginas, automações e conversões.
    contact:
      name: Health & Safety
      url: https://healthsafety.com.br
  ```
  Procure no resto do yaml `dnMarketing`, `DN.IA`, `dnia`, `Nexus`,
  `mentor.ia`, `mentoria` em **texto descritivo** (`description`, `summary`)
  e troque por MarketingHS / tire a menção. ⚠️ **Não** mude nome de campo,
  enum ou exemplo de valor que a API de fato aceita (ex. um `source_app`
  aceito pela rota) — isso é contrato; relate o que achou.
- `public/api/docs/index.html`: aponte para `marketinghs-api.yaml`; título
  sem marca de terceiro.
- `ApiDocumentation.tsx`: `href` dos dois links (`:936`, `:946`) com o nome
  novo; o logo (`:930`) vira o logo da casa (mesmo import da Step 2) com
  `alt="MarketingHS"`; o parágrafo de apresentação (`:958`) vira:
  > O MarketingHS é a plataforma de marketing da Health & Safety. Esta API
  > permite que outros sistemas integrem contatos, segmentos, campanhas,
  > páginas, automações e conversões.

  Procure no arquivo outros textos visíveis com `dnMarketing`, `DN.IA`,
  `Nexus`, `mentor.ia` e aplique o mesmo critério do yaml (texto sai;
  valor de contrato fica e é relatado).
- Comentários que citam `dnmarketing-api.yaml` (`UTMPresetsModal.tsx:~39`,
  `publico.py:~919,~1473`): nome novo.

- [ ] **Step 8: Build e navegação**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.app.json; npx vite build
```

Abra `/login`, `/` (barra lateral), o assistente (botão flutuante), a ficha de
um contato (chip), `/templates/new` (modelo padrão), `/settings` (webhook e
Documentação da API, inclusive os dois links do OpenAPI abrindo). Zero erro de
console.

- [ ] **Step 9: Commit**

```bash
git add -A frontend backend/app/routers/publico.py
git commit -m "chore(8E): a marca da dn.ia sai do admin — logo da casa, Assistente de dados, e-mail e API em nome da Health & Safety"
```

---

### Tarefa 4: O ecossistema da dn.ia sai da tela (decisão E2)

**Arquivos:**
- Modificar: `frontend/src/components/admin/contacts/EcosystemPills.tsx`
- Modificar: `frontend/src/components/admin/contacts/ContactsTable.tsx`
- Modificar: `frontend/src/components/admin/LeadDetailSheet.tsx`
- Modificar: `frontend/src/components/admin/contacts/DetailSections.tsx`
- Modificar: `frontend/src/components/admin/contacts/ContactsFiltersBar.tsx`
- Modificar: `frontend/src/components/admin/contacts/ContactsFilterPanel.tsx`
- Modificar: `frontend/src/components/admin/contacts/EventsTimeline.tsx`
- Modificar: `frontend/src/components/admin/contacts/ContactsExport.tsx`
- Modificar: `frontend/src/hooks/useContactsEnriched.tsx`, `frontend/src/lib/leitura.ts`
- Modificar: `frontend/src/pages/admin/Contacts.tsx`
- Modificar: `frontend/src/pages/admin/SettingsPage.tsx` (card mentor.ia, `:~164-174`)
- **Não tocar:** `backend/` (decisão 12), `ApiDocumentation.tsx` (Tarefa 3),
  `DuplicatesPanel.tsx` (usa `dnia_id`, nome interno).

**Interfaces:**
- Consome: nada.
- Produz: `EcosystemPills` com duas pílulas — `{ label: 'M', app: 'MarketingHS', alwaysActive: true }`
  (mesma cor `#534AB7` da antiga "D") e a "G · GrowthHS" como está hoje.

- [ ] **Step 1: Mapear antes de cortar**

```bash
cd /home/ericks/github/MarketingHS/frontend
grep -rn "hasNexus\|hasMentoria\|mentor\.ia\|mentoria\|'Nexus'\|\"Nexus\"\|dnMarketing\|dnmarketing\|nexus_contact_id\|mentoria_client_id" src --include=*.ts --include=*.tsx
```

Para cada ocorrência, classifique no relatório: **pílula**, **filtro**,
**coluna de exportação**, **campo lido da API**, **texto**, ou **outro**. O
"outro" — qualquer coisa que não seja interface de Nexus/mentor.ia (ex. o
`source_app` gravado pelo próprio sistema, o GrowthHS) — **fica**.

- [ ] **Step 2: Pílulas**

`EcosystemPills.tsx`: a lista fica com as duas pílulas da seção Interfaces.
Remova as props/campos que só alimentavam N e M(entor). Nos consumidores
(`ContactsTable`, `LeadDetailSheet`, `DetailSections`), tire o que só passava
`hasNexus*`/`hasMentoria*` para as pílulas. O `GrowthHSLink` e a pílula G não
mudam.

- [ ] **Step 3: Filtros**

`ContactsFilterPanel.tsx` (opção "No mentor.ia" `:~297`, chip
"Plataforma: mentor.ia" `:~590`, e o equivalente de Nexus) e
`ContactsFiltersBar.tsx` (`:~118`): saem as opções e chips de Nexus e
mentor.ia. Se o filtro "Plataforma" ficar só com opções do próprio sistema /
GrowthHS, mantenha o controle com o que sobrou; se ficar vazio, o controle
sai. Em `Contacts.tsx` e `lib/leitura.ts`, pare de **enviar** os parâmetros
de filtro de Nexus/mentor.ia ao backend (o backend continua aceitando —
decisão 12). Confira que um filtro salvo/URL antiga com esses parâmetros não
quebra a tela (é ignorado).

- [ ] **Step 4: Linha do tempo (decisão 9 do plano)**

`EventsTimeline.tsx`: o filtro por origem fica "Todos" · "MarketingHS"
(`source_app` em `['marketinghs', 'dnmarketing']`) · e as demais origens que
o componente já trate e que não sejam Nexus/mentor.ia (ex. GrowthHS, se
houver). Evento com `source_app` `nexus` continua aparecendo em "Todos" com o
rótulo genérico que o componente já usa para origem desconhecida (confira qual
é; se o rótulo for "Nexus", troque pelo próprio valor `nexus` sem marca).

- [ ] **Step 5: Exportação**

`ContactsExport.tsx`: saem as colunas de Nexus e mentor.ia (se existirem).
Registre no relatório quais colunas saíram — é corte de capacidade autorizado
pela E2, e o portão vai perguntar.

- [ ] **Step 6: Leitura enriquecida**

`useContactsEnriched.tsx` / `lib/leitura.ts`: remova os campos
`hasNexus*`/`hasMentoria*` dos tipos e do mapeamento **se nenhum consumidor
restar**. O backend continua devolvendo-os (decisão 12); o frontend ignora.

- [ ] **Step 7: Card mentor.ia**

`SettingsPage.tsx:~164-174`: o card "mentor.ia — Gestão de mentorias" sai
inteiro. Se a aba Integrações tinha um card equivalente de Nexus, sai também.

- [ ] **Step 8: Build e navegação**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.app.json; npx vite build
grep -rn "mentor\.ia\|hasMentoria\|hasNexus" src --include=*.ts --include=*.tsx   # esperado: vazio
```

No navegador: `/contacts` (tabela com as pílulas M e G; painel de filtros
abrindo e aplicando um filtro qualquer; exportar CSV baixando), a ficha de um
contato (pílulas, linha do tempo com o filtro "MarketingHS" mostrando
eventos), `/settings` aba Integrações. Zero erro de console.

- [ ] **Step 9: Commit**

```bash
git add -A frontend/src
git commit -m "chore(8E): Nexus e mentor.ia saem da tela — pílulas, filtros, exportação e card; o banco fica"
```

---

### Tarefa 5: A pasta de especificação, a documentação da origem e o registro

**Arquivos:**
- Apagar: `backend/supabase/` (inteira)
- Apagar: `docs/ab-testing/` (inteira)
- Modificar: `CLAUDE.md`
- Modificar: `docs/CONTINUAR-AQUI.md`
- Modificar: `docs/superpowers/plans/2026-09-10-marketinghs-lote-8-fechamento.md` (placar)

**Interfaces:**
- Consome: o resultado das Tarefas 1-4 (commits).

- [ ] **Step 1: Ninguém lê as pastas**

```bash
cd /home/ericks/github/MarketingHS
grep -rn "backend/supabase\|supabase/functions\|supabase/config" backend/app backend/tests scripts frontend/src
grep -rln "docs/ab-testing" . --include=*.md --include=*.ts --include=*.tsx --include=*.py | grep -v "^./docs/superpowers/"
```

Esperado: na primeira, só comentários de linhagem (`meta_capi.py:3`,
`importacao.py:3`, `ab/dominio.py:3` e afins) — eles **ficam**, contam de onde
o código veio e o caminho continua existindo no histórico do git. Na segunda,
só o `docs/CONTINUAR-AQUI.md`. Planos antigos em `docs/superpowers/` que citam
as pastas ficam como estão (são registro).

- [ ] **Step 2: Apagar**

```bash
git rm -r -q backend/supabase docs/ab-testing
```

- [ ] **Step 3: `CLAUDE.md`**

A portagem acabou; o guia deixa de descrever a travessia como em curso:
- **Estrutura:** sai a linha `supabase/  as edge functions da origem —
  ESPECIFICAÇÃO, não código vivo`.
- **"O Lovable e o Supabase saíram."** — fica (é aviso contra instrução
  herdada), acrescentando que desde o 8E não resta arquivo deles no repo.
- **"O portão de pronto"**: o bloco inteiro fala de portar tela e apagar
  function da especificação. Reescreva o título e a abertura como registro
  ("O portão que fechou a travessia") mantendo **as lições** (passo 4 do lote
  6, passo 2 do lote 1A, `grep` de linha única, alias `supabase as any`, a
  lição do HS.OS) — elas valem para qualquer reescrita futura — e troque os
  comandos que citam `backend/supabase/functions` por uma frase dizendo que a
  pasta não existe mais.
- **"Quando algo não estiver portado"**: a seção inteira sai, trocada por uma
  linha: "Desde o lote 8E (22/09/2026) não há toco: `integrations/supabase/`
  foi apagada; o `LimiteDeErro` segue como error boundary da casca."
- ⚠️ A regra de `sessao()`, a de `service_role`, os três índices únicos, o
  banco, o worker e todo o resto **não mudam**.

- [ ] **Step 4: `docs/CONTINUAR-AQUI.md`**

Bloco novo no topo, `> ## ✅ Sub-lote 8E (limpeza final) — portão fechado, <data>`,
com: o que saiu (as cinco frentes), as decisões E1-E4 do Erick, o número de
templates no banco com "DN.IA"/"dnia.ai" (Tarefa 3, Step 5) — que **não**
foram tocados —, a sobra da decisão 12 (backend ainda aceita/devolve os
campos de Nexus e mentor.ia) e **"a travessia acabou"**. Na entrada antiga do
8C (a que diz "Para o 8E: ... a casca do app chama um endpoint supabase
(`get-tests`) e `lovableproject.com`"), acrescente uma linha "→ resolvido no
8E" — não apague o registro.

Lembretes que passam a valer (copie para o bloco novo):
- **Apagar a conta admin do Claude** (`claude.dev@example.com`) — combinado
  para o fim da travessia (item 25).
- As perguntas abertas do 8D e do 8C (recálculo/sync disparando regras; peso
  0 no A/B; push da `main`).

- [ ] **Step 5: Placar no documento-mãe**

`2026-09-10-marketinghs-lote-8-fechamento.md`, tabela "Placar esperado":
marque a linha do 8E como cumprida (a pasta `backend/supabase/` não existe;
47 portadas, 7 descartadas).

- [ ] **Step 6: Commit**

```bash
git add -A CLAUDE.md docs backend/supabase
git commit -m "chore(8E): backend/supabase e docs/ab-testing saem; CLAUDE.md registra o fim da travessia"
```

---

### Tarefa 6: O portão

- [ ] **Step 1: Buscas**

```bash
cd /home/ericks/github/MarketingHS
ls frontend/src/integrations backend/supabase docs/ab-testing 2>&1          # as três: "No such file"
grep -rniE "lovable|supabase\.co|functions/v1|VITE_SUPABASE|@supabase" frontend/src frontend/index.html frontend/public frontend/package.json frontend/vite.config.ts
grep -rniE "dn\.ia|dnia ai|dnia\.ai|dn\.mkt|dnmkt|mentor\.ia|buscar ?id|1441054460977757|G-P6GLV8VVNR|GTM-59T4XHKS" frontend/src frontend/index.html frontend/public
grep -rn "supabase" frontend/src --include=*.ts --include=*.tsx
```

Esperado: a segunda vazia; a terceira só comentários de paleta/tema em
`index.css` e nos gráficos (visual fica — restrição global) — liste-os; a
quarta só comentários de linhagem — liste-os.

- [ ] **Step 2: Build** — `cd frontend && npx tsc --noEmit -p tsconfig.app.json && npx vite build`:
  mesma contagem de erros pré-existentes; build ok. Anote o tamanho do `dist/`
  antes (build da `main` em `193bbcc`) e depois.

- [ ] **Step 3: Suíte do backend** — só se alguma tarefa mudou arquivo em
  `backend/app` além de comentário (confira com
  `git diff 193bbcc -- backend/app | grep "^[+-]" | grep -v "^[+-]\s*#"`). Se
  mudou, `cd backend && ./.venv/bin/pytest -q`, primeiro plano, nunca
  interromper; anote o número.

- [ ] **Step 4: No navegador** (conta admin do Claude; Vite em
  `127.0.0.1:8080`, backend na 8100):
  1. Rede: carregar `/`, clicar, rolar, esperar 6 s — **só** `127.0.0.1` e as
     fontes do Google. Compare com a lista do "antes" (Tarefa 1, Step 1).
  2. Aba com "MarketingHS — Marketing da Health & Safety" e o ícone da casa.
  3. Login, barra lateral, assistente, ficha de contato, contatos com
     filtros e exportação, modelo novo de template, Configurações (webhook,
     Integrações, Documentação da API com os dois links abrindo).
  4. Zero erro de console.
  5. Nada gravado no banco (a conferência só lê; se abrir `/templates/new`,
     não salve).

- [ ] **Step 5: Capacidade por capacidade** contra `193bbcc` (a `main` antes do 8E):

```bash
git diff 193bbcc --stat -- frontend/src
git diff 193bbcc -- frontend/src/components/admin/contacts frontend/src/pages/admin/Contacts.tsx frontend/src/pages/admin/SettingsPage.tsx
```

Para cada tela tocada: o que ela fazia, o que faz agora, e se a diferença é
**(a)** marca/texto, **(b)** corte autorizado (E2, com a lista das colunas de
exportação e filtros que saíram), ou **(c)** corte **sem** decisão — este
último é defeito e volta para a tarefa de origem. Em especial: o
`LimiteDeErro` ainda contém erro (provoque um, se houver jeito barato, ou leia
o código); a linha do tempo ainda mostra os 733 eventos `dnmarketing` sob
"MarketingHS"; o filtro de contatos por GrowthHS e por status ainda funciona.

- [ ] **Step 6: Commit do registro** — números do portão no bloco do 8E do
  `CONTINUAR-AQUI.md`:

```bash
git add docs/CONTINUAR-AQUI.md
git commit -m "docs(8E): portão fechado — a travessia acabou"
```
