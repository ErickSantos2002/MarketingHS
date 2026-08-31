# CLAUDE.md

Orientação para o Claude Code neste repositório.

## O que é isto

O **MarketingHS** é a plataforma de marketing da Health & Safety: capta lead,
qualifica, entrega o qualificado ao comercial, conversa com a base por e-mail e
mede o resultado. É o 9º sistema interno da casa.

Ele veio de um **remix do dn.marketing** ("AI Fastlane"), produto da dn.ia que
roda em `dnmkt.dnia.ai`, e está sendo reconstruído por dentro para virar produto
próprio — mesma travessia que o **TalentHS** e o **HS.OS** fizeram antes, e as
duas são a referência para as decisões daqui.

**O Lovable e o Supabase saíram.** Qualquer instrução herdada que fale em
`lovable-workflow`, sync com o Lovable, `supabase functions deploy` ou
`supabase db push` está morta. O repositório é a fonte da verdade.

- **Spec:** `docs/superpowers/specs/2026-08-31-marketinghs-design.md` — as 7
  decisões, os 8 lotes, os riscos. É a autoridade.
- **Onde parou:** `docs/CONTINUAR-AQUI.md`
- **Plano do lote atual:** `docs/superpowers/plans/`

## Estrutura

```
backend/     FastAPI + asyncpg
  app/       config · database · dependencies · auth/ · routers/ · middleware/
  migrations/  SQL numerado, aplicado por scripts/aplicar-migrations.sh
  supabase/  as edge functions da origem — ESPECIFICAÇÃO, não código vivo
  tests/     só o que executar não prova (hoje: security.py)
frontend/    React 18 + Vite + shadcn + TanStack Query
worker/      vazio até o lote 3 (motor de fila e agendamento)
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
bash scripts/aplicar-migrations.sh    # NÃO é idempotente; ver o cabeçalho
```

## As regras que não se quebram

**`sessao()` é o único caminho para dado.** O backend conecta como
`marketinghs_app`, que é `NOINHERIT` e não tem privilégio em `public` por si.
Sem o `SET LOCAL ROLE` que a `sessao()` emite, a query falha com permissão
negada — isso é proposital, não um bug a contornar. Nunca dê privilégio direto
ao `marketinghs_app`, e nunca conecte como superusuário: **superusuário ignora
RLS por definição**, e as 65 políticas herdadas viram decoração.

**`role="service_role"` tem `BYPASSRLS`.** Só para operação interna (bootstrap,
job agendado). Nunca para request de usuário.

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

## O portão de pronto

Uma tela só está portada quando **as duas** condições valem:

```bash
# 1. a tela não fala mais com o Supabase
grep -rn "supabase" frontend/src/<a tela>

# 2. NINGUÉM MAIS chama a function — inclusive de outra tela
grep -rn "<nome-da-function>" frontend/src

# 3. a tela foi aberta e conferida no navegador (Playwright, Vite em 127.0.0.1)

# só então a function sai da especificação
git rm -r backend/supabase/functions/<nome>
```

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

> **A lição do HS.OS, e que já se repetiu aqui.** Ter o substituto pronto não é
> o mesmo que a tela usar o substituto. Na tarefa 6 do lote 0 as 6 functions de
> usuário saíram da pasta enquanto a tela ainda as chamava — o portão existia e
> foi contado pela metade. A tarefa 8 consertou.

**O placar conta dois números e nunca os soma:** functions portadas *e* telas
migradas. Foi juntá-los num número só que escondeu telas quebradas no HS.OS.

## Quando algo não estiver portado

`frontend/src/integrations/supabase/client.ts` é um **toco**: qualquer uso
estoura com `[MarketingHS] não portado: <alvo>`. O `LimiteDeErro` contém a
explosão para que a casca do admin sobreviva e dê para navegar até uma tela que
funciona. **Quando esse arquivo puder ser apagado sem quebrar nada, a portagem
acabou.**

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

## O que o lote 3 vai ter de reimplementar

O motor de fila e agendamento mora no Postgres do Supabase e não veio: 14
funções e 2 triggers foram removidos do schema por dependerem de `pgmq`,
`pg_cron`, `pg_net` ou `vault`. São duas filas (`email_send_queue` e
`journey_events`), que viram tabela comum + `FOR UPDATE SKIP LOCKED`, e o
agendador vira laço `asyncio` no `worker/`.

O `invoke_edge_function` **não volta**: era o banco chamando a aplicação por
HTTP, indireção que só existia porque o Supabase separa os dois.

Essa é a única parte do projeto que nasce com teste automatizado. Um e-mail
enviado duas vezes para a base inteira queima o domínio.
