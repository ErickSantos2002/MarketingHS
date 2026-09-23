# CLAUDE.md

Orientação para o Claude Code neste repositório.

## O que é isto

O **MarketingHS** é a plataforma de marketing da Health & Safety: capta lead,
qualifica, entrega o qualificado ao comercial, conversa com a base por e-mail e
mede o resultado. É o 9º sistema interno da casa.

Ele veio de um **remix do dn.marketing** ("AI Fastlane"), produto da dn.ia que
roda em `dnmkt.dnia.ai`, e foi reconstruído por dentro para virar produto
próprio — mesma travessia que o **TalentHS** e o **HS.OS** fizeram antes, e as
duas são a referência para as decisões daqui. A travessia acabou no lote 8E
(22/09/2026).

**O Lovable e o Supabase saíram.** Qualquer instrução herdada que fale em
`lovable-workflow`, sync com o Lovable, `supabase functions deploy` ou
`supabase db push` está morta. O repositório é a fonte da verdade — e desde o
8E não resta nele arquivo de nenhum dos dois.

- **Spec:** `docs/superpowers/specs/2026-08-31-marketinghs-design.md` — as 7
  decisões, os 8 lotes, os riscos. É a autoridade.
- **Onde parou:** `docs/CONTINUAR-AQUI.md`
- **Plano do lote atual:** `docs/superpowers/plans/`

## Estrutura

```
backend/     FastAPI + asyncpg
  app/       config · database · dependencies · auth/ · routers/ · middleware/
  migrations/  SQL numerado, aplicado por scripts/aplicar-migrations.sh
  app/worker.py  motor de fila e agendamento (laço asyncio), desde o lote 3
  tests/     só o que executar não prova
frontend/    React 18 + Vite + shadcn + TanStack Query
docs/referencia/  /humanoseagentes, molde do fluxo de captura
```

## Comandos

```bash
# backend (porta 8100 no host — a 8000 é do TaskHS nesta máquina)
cd backend && ./.venv/bin/python -m uvicorn app.main:app --port 8100 --reload
cd backend && ./.venv/bin/pytest -q

# frontend (127.0.0.1, padrão da casa para conferência com Playwright)
cd frontend && npx vite --port 8080

# migrations
bash scripts/aplicar-migrations.sh    # SÓ num banco vazio; ver o aviso abaixo
```

⚠️ **`aplicar-migrations.sh` não roda duas vezes.** Ele reaplica desde a
`001_schema_origem.sql`, que é dump bruto do Supabase sem `IF NOT EXISTS`, e
morre em `type "app_role" already exists`. **O cabeçalho do próprio script diz
"Idempotente" e mente.** Migration nova se aplica sozinha:

```bash
set -a; . ~/marketinghs.env; set +a
PGPASSWORD="$POSTGRES_PASSWORD" psql \
  "postgresql://${POSTGRES_USER}@${POSTGRES_HOST_EXTERNO}:${POSTGRES_PORTA_EXTERNA}/${POSTGRES_DB}" \
  -v ON_ERROR_STOP=1 -f backend/migrations/0NN_arquivo.sql
```

Ela ainda precisa tolerar reaplicação (`IF NOT EXISTS`, `DROP ... IF EXISTS`
antes de `ADD`) — rode duas vezes para provar.

## As regras que não se quebram

**`sessao()` é o único caminho para dado.** O backend conecta como
`marketinghs_app`, que é `NOINHERIT` e não tem privilégio em `public` por si.
Sem o `SET LOCAL ROLE` que a `sessao()` emite, a query falha com permissão
negada — isso é proposital, não um bug a contornar. Nunca dê privilégio direto
ao `marketinghs_app`, e nunca conecte como superusuário: **superusuário ignora
RLS por definição**, e as 65 políticas herdadas viram decoração.

**`role="service_role"` tem `BYPASSRLS`.** Só para operação interna (bootstrap,
job agendado). Nunca para request de usuário.

⚠️ **O padrão de `sessao()` é o papel `anon`.** `sessao()` sem argumento **não**
é "o papel de quem está logado" — é anônimo. E política escrita `TO
authenticated` **não se aplica** ao anônimo: a query devolve **zero linhas, sem
erro**. Medido em 03/09/2026: `count(*) FROM contact_events` dá 0 sob `anon` e
2.931 sob `authenticated`. Para request de usuário, escreva sempre
`sessao(role="authenticated", user_id=usuario.id)`.

⚠️ Esta regra é direção, não descrição do código de hoje. Medido em
04/09/2026: **128** pontos de acesso usam `role="service_role"` contra **16**
com `role="authenticated"` — a maioria dos 16 é do lote 6 (`/ia`, `/painel`).
O resto do repositório é anterior à regra e está sendo convertido lote a
lote; abrir `campanhas.py` (10 ocorrências de `service_role`) ou
`leitura_contatos.py` (13) e achar `service_role` não é sinal de que a regra
mudou.

⚠️ **Permissão, neste banco, falha devolvendo NADA — não devolvendo erro.** É o
mesmo desfecho para papel de banco errado e para usuário sem direito: zero
linhas. Num sistema de marketing isso é pior que quebrar, porque painel zerado
parece mês fraco e ninguém investiga. Por isso a regra abaixo ("cada rota
autoriza sozinha") não é burocracia: é o que transforma silêncio em 403. Se a
tabela tem política admin-only, a rota é `admin_atual` — senão o não-admin vê
zero e acredita.

**Nenhum endpoint depende do RLS para autorizar.** Cada rota autoriza sozinha,
via `usuario_atual` / `admin_atual`. O RLS é segunda linha. RLS que ninguém
verifica é RLS que não existe.

**O papel é `'admin'`**, não `'administrador'` — o enum é `public.app_role` e o
valor do HS.OS é outro. Confira antes de escrever query.

**Toda chave lida do ambiente precisa estar declarada em `Settings`.** O
pydantic-settings recusa chave desconhecida no `.env` e derruba o boot inteiro.
Isso já derrubou o HS.OS duas vezes.

**Não há recuperação de senha por e-mail.** Sistema interno, senha definida pelo
TI, admin reseta a de quem esquecer. Um caminho de acesso a menos.

**`.env` nunca é versionado.**

## Visual

O visual vem do **Design System da Health & Safety** (projeto
`ef9f35f6-3af0-4651-9dee-45d08884432a` no Claude Design), copiado em
`frontend/src/design-system/` — **não se edita ali**; ver `ORIGEM.md`. Só a
versão oficial vale, nunca a cópia do HelpHS.

Os primitivos de `components/ui/` carregam as medidas do Design System (raio,
padding, altura, peso, anel de foco): medida se muda lá, nunca na tela.

**Nenhum hexadecimal nem cor literal do Tailwind no JSX — cor sai de token.**
As classes do shadcn (`bg-primary`, `text-muted-foreground`…) já apontam para
os tokens pela ponte do `index.css`; para o resto, o vocabulário do
`adocao.md` (`bg-action`, `bg-surface`, `text-conteudo-muted`,
`border-borda`…). Exceções: HTML de e-mail e a landing pública.
`npm run guarda:visual -- <pasta>` diz se uma área está limpa.

Tema: claro por padrão; escuro pela classe `dark` no `<html>`
(`src/lib/tema.ts`) — nunca no `<body>`.

## O portão que fechou a travessia

A portagem acabou no lote 8E (22/09/2026): 47 functions portadas, 7
descartadas, nenhuma restando. Este é o registro do portão que cada tela
precisou passar — e as lições dele valem para qualquer reescrita futura,
porque o corte silencioso não é coisa do Supabase, é coisa de reescrever.

Uma tela só contava como portada quando **as quatro** condições valiam:

```bash
# 1. a tela não fala mais com o Supabase
grep -rn "supabase" frontend/src/<a tela>

# 2. NINGUÉM MAIS chama a function — inclusive de outra tela
grep -rn "<nome-da-function>" frontend/src

# 3. a tela foi aberta e conferida no navegador (Playwright, Vite em 127.0.0.1)

# 4. a tela ainda FAZ O QUE FAZIA — comparar capacidade por capacidade
git diff <commit antes do porte> -- frontend/src/<a tela>

# só então a function saía da especificação (backend/supabase/functions/<nome>)
```

A especificação era `backend/supabase/functions/`; a pasta não existe mais —
saiu inteira no 8E, e continua no histórico do git para quem precisar da
origem.

⚠️ **O passo 4 nasceu no lote 6, que o violou três vezes num lote só** — e os
três passariam pelos passos 1, 2 e 3 sem tropeço:

- o botão de **apagar insight** sumiu da aba Desafios porque não havia rota de
  DELETE e o mapa de rotas do plano só listava GET e POST;
- o teto de **agendamentos caiu de 20.000 para 500**, porque a rota nova nasceu
  com `LIMIT` fixo onde o hook antigo paginava;
- **`dashboard_cards` deixou de ser por usuário** e virou global.

O padrão: **é a própria portagem que introduz o corte silencioso.** Não é
código herdado ruim — é o substituto nascendo menor que o substituído, e o
portão como estava não fazia essa pergunta. Os dois primeiros foram desfeitos
dentro do lote; o terceiro virou pergunta ao Erick.

⚠️ **O passo 2 não é redundante.** No lote 1A a tela de importação estava
limpa, mas `apply-lead-tag` continuava sendo chamada pelo caminho de conversão
das landing pages — a function ficou na pasta. Portar a tela que você tinha em
mente não quer dizer que a function ficou órfã.

⚠️ **Cuidado com `grep` de linha única.** O padrão `supabase.from(` perde
`supabase\n  .from(`, que é como a maior parte do código herdado escreve. Uma
contagem por linha única deu 68 pontos de acesso direto ao banco; contando as
chamadas quebradas, são **153**. Use busca multilinha para medir progresso:

```bash
python3 -c "
import pathlib, re
n = sum(len(re.findall(r'supabase\s*\.?\s*\n?\s*\.(from|rpc)\(', f.read_text()))
        for f in pathlib.Path('frontend/src').rglob('*.ts*')
        if 'integrations/supabase' not in str(f))
print(n, 'pontos de acesso direto')"
```

⚠️ **E esse script AINDA subconta.** Medido em 04/09/2026: ele não reconhece o
alias `const db = supabase as any`, que é como `useAbConfig.tsx` e
`useAbTests.tsx` (telas de Experiments) alcançam o banco — **9 pontos reais**
fora da conta. Não é regressão nova: estavam invisíveis antes também, o que
significa que **os placares dos lotes anteriores também estavam otimistas**.
Ao medir progresso, procure o alias além do nome:

```bash
grep -rn "supabase as any\|= supabase;" frontend/src --include=*.ts --include=*.tsx
```

> **A lição do HS.OS, e que já se repetiu aqui.** Ter o substituto pronto não é
> o mesmo que a tela usar o substituto. Na tarefa 6 do lote 0 as 6 functions de
> usuário saíram da pasta enquanto a tela ainda as chamava — o portão existia e
> foi contado pela metade. A tarefa 8 consertou.

**O placar conta dois números e nunca os soma:** functions portadas *e* telas
migradas. Foi juntá-los num número só que escondeu telas quebradas no HS.OS.

Desde o lote 8E (22/09/2026) não há toco: `integrations/supabase/` foi
apagada; o `LimiteDeErro` segue como error boundary da casca.

## Banco

Serviço Postgres próprio no EasyPanel, versão 17.11. Credenciais em
`~/marketinghs.env` (fora do repositório, `600`). Externo `62.72.11.28:3377`
para migration e para o cadastro `bancos`; interno pelo nome do serviço, que é o
que vai no `DATABASE_URL` de produção — e é ele que faz o tráfego backend↔banco
não sair do host.

**Nenhuma extensão é necessária.** `gen_random_uuid()` é core desde o Postgres
13; não há uso de `pgcrypto` nem de `uuid_generate_v4()`. Não escreva
`CREATE EXTENSION`.

**Três índices únicos parciais são intocáveis** —
`uniq_campaign_sends_email_campaign_lead`, `uniq_campaign_sends_journey_node` e
`uniq_journey_runs_open`. Eles são a garantia, no nível do banco, de não
disparar e-mail duplicado. Não relaxe nenhum deles.

## O motor de fila (lote 3)

O motor de fila e agendamento morava no Postgres do Supabase e não veio: 14
funções e 2 triggers foram removidos do schema por dependerem de `pgmq`,
`pg_cron`, `pg_net` ou `vault`. As duas filas (`email_send_queue` e
`journey_events`) são hoje tabela comum + `FOR UPDATE SKIP LOCKED`, e o
agendador é o laço `asyncio` de `app/worker.py`.

O `invoke_edge_function` não voltou: era o banco chamando a aplicação por
HTTP, indireção que só existia porque o Supabase separa os dois.

Essa é a única parte do projeto que nasceu com teste automatizado. Um e-mail
enviado duas vezes para a base inteira queima o domínio.
