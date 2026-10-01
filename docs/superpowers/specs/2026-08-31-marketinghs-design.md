# MarketingHS — Design

**Data:** 31 de agosto de 2026
**Status:** design aprovado, aguardando plano de implementação
**Autor:** Erick Santos + Claude

---

## 1. O que é

O MarketingHS é a plataforma de marketing da Health & Safety: capta lead, qualifica,
entrega o qualificado ao comercial, conversa com a base por e-mail e mede o resultado.
Seria o **9º sistema interno** da casa.

Ele não nasce do zero. Vem de um **remix do dn.marketing** ("AI Fastlane"), produto da
dn.ia que roda em produção em `dnmkt.dnia.ai`. É a terceira travessia desse tipo na
empresa — o [TalentHS] fez antes, o [HS.OS] está fazendo agora — e as duas anteriores
são a referência para cada decisão aqui.

**As quatro frentes que ele cobre**, todas confirmadas como escopo:

1. E-mail marketing para a base — campanha, jornada, template
2. Captação de lead novo — landing page, UTM, Meta CAPI, scoring
3. Qualificação e handoff para o CRM — a ponte marketing → comercial
4. Analytics de marketing — painel, funil, origem, análise por IA

---

## 2. Decisões tomadas

| # | Decisão | Motivo |
|---|---|---|
| 1 | **Sair do Supabase por completo.** Banco no Postgres da HS, backend FastAPI próprio, deploy na nossa VPS. Sem Supabase nem provisoriamente. | Mesma decisão de agosto/2026 no HS.OS. Banco da empresa não fica na conta de terceiro. |
| 2 | **Apagar as landing pages da dn.ia** (106 componentes + 26 páginas), preservando `/humanoseagentes` como referência do fluxo de captura. | 17.600 linhas e 38 MB de conteúdo de outra empresa. Nada aproveitável em produção. |
| 3 | **Fatia vertical** como formato da travessia, ordenada pelo espinho do dado (contato → segmento → campanha → jornada). | Foi o que o HS.OS acabou adotando. Backend-first não entrega nada verificável por meses. |
| 4 | **Substituir as extensões do Supabase por Python**, não instalá-las no nosso Postgres. | Apaga o `invoke_edge_function` em vez de portá-lo. `pg_cron` exigiria reiniciar um Postgres que serve 9 bancos de produção. |
| 5 | **Chamar o GrowthHS pela API**, não por SQL direto, mesmo estando no mesmo servidor. | `INSERT` cru em `cards` pula histórico, automação, gamificação e notificação do CRM. |
| 6 | **Acaba a recuperação de senha por e-mail.** | Sistema interno; senha definida pelo TI. Mesma decisão do HS.OS. Um caminho de acesso a menos. |
| 7 | **Worker em contêiner separado**, divergindo do HS.OS (que roda os laços dentro da API). | Reiniciar a API não pode pausar disparo em andamento; exceção no envio não pode derrubar o admin. |

---

## 3. Inventário do que veio no remix

### Código

| Camada | Tamanho | Destino |
|---|---|---|
| Admin (o produto) | 118 arquivos, 27.000 linhas | **Fica** |
| Componentes shadcn | 50 arquivos, 4.100 linhas | Fica |
| Hooks | 30 arquivos, 5.300 linhas | Fica |
| `src/lib` (domínio) | 20 arquivos, 1.650 linhas | Fica |
| Landing pages dn.ia | 106 arquivos, 14.000 linhas | **Sai** |
| Páginas públicas dn.ia | 26 arquivos, ~3.600 linhas | Sai |
| Assets (Rodrigo Nascimento, vídeos) | 38 MB | Sai |
| Edge Functions | 55 (Deno/TS) | Especificação, não código vivo |

**Fica ~44.400 linhas. Sai ~17.600 linhas + 38 MB.**

### Acoplamento ao Supabase no frontend

| Padrão | Ocorrências | Observação |
|---|---|---|
| `supabase.functions.invoke(` | 52 | Vira chamada à API própria |
| `supabase.from(` | 60 | Vira endpoint |
| `supabase.rpc(` | 8 | Vira endpoint |
| `supabase.auth` | 17 | Vira auth própria |
| `supabase.storage` | 2 | Praticamente nada |
| `supabase.channel(` | **0** | **Não há tempo real. Eles usam polling de 60s.** |

Apenas **20 arquivos** falam direto com o banco (68 pontos). O HS.OS tinha 185 — este
projeto chega numa posição bem melhor.

### Banco (do dump `docs/63cb903c-…_260831.backup`)

Dump `pg_dump` custom, Postgres 17.6, 571 KB, **todas as tabelas vazias**:

- 36 tabelas + 1 view (`page_stats`)
- 61 funções no schema `public`
- 37 triggers
- 65 políticas de RLS
- 133 índices, 93 constraints, 48 chaves estrangeiras
- 16 tipos/enums

Extensões exigidas: `pg_cron`, `pg_net`, `pgmq`, `supabase_vault` (substituídas — ver §6)
e `pgcrypto`, `uuid-ossp`, `pg_stat_statements` (padrão, já temos).

Supabase-ismos no schema `public`: 69 `auth.uid()`, 6 FKs para `auth.users`,
42 referências ao papel `authenticated`, 13 ao `anon`, 10 chamadas a `pgmq.*`,
7 a `vault.*`, 2 a `net.http_*`.

**`cron.job` está vazia** — não há agendamento dentro do banco. O agendamento real é
o cron do Lovable batendo nas Edge Functions por HTTP (`LOVABLE_CRON_SECRET`).

---

## 4. Forma do repositório e stack

Reestruturação do repositório que já existe (`ErickSantos2002/MarketingHS`), no formato
do HS.OS:

```
MarketingHS/
├── backend/
│   ├── app/              FastAPI
│   ├── migrations/       SQL numerado, 000_… em diante
│   ├── supabase/         as 55 functions originais, como especificação
│   └── requirements.txt
├── frontend/             o app React de hoje
├── docs/
└── docker-compose.yml    backend · frontend · worker
```

Mover `src/` para `frontend/src/` **quebra o sync com o Lovable** de forma difícil de
reverter. É intencional — é o commit em que saímos do Lovable. Saem junto:
`.claude/skills/lovable-workflow`, o `lovable-tagger` da cadeia do Vite, `.lovable/`, e o
`README.md` (que é um prompt de landing page perdido, não um README).

**Stack**, espelhando o HS.OS para não criar um segundo padrão na casa:

- **Backend:** FastAPI, asyncpg, PyJWT, bcrypt, httpx, pydantic
- **Frontend:** React 18, Vite, shadcn/ui, TanStack Query, Tailwind — como já está
- **Worker:** Python, mesmo `requirements.txt`, contêiner próprio

### Onde mora

Servidor **62.72.11.28**, o mesmo dos 9 bancos da empresa e do HS.OS.

⚠️ **Não é preferência de arquitetura.** Aquele Postgres não aceita TLS. Backend e banco
no mesmo servidor é o que impede senha e dado de lead trafegarem em texto claro pela
internet. Vale para o HS.OS e para o TalentHS também.

Consequência boa: `datacore` e `hsgrowth` ficam no mesmo servidor. As duas integrações
não atravessam a internet.

O banco vira `marketinghs`, **10º apelido do cadastro** (`~/projetos/bancos/`), com
usuário de leitura criado pelo `criar_leitura.py` e um `marketinghs_app` sem superpoderes
para o backend — porque **superusuário ignora RLS por definição** no Postgres.

---

## 5. O banco

### Recuperação

O dump está em `docs/63cb903c-ece5-4157-8f7f-e7dc4686df2d_260831.backup`. Extração:

```bash
pg_restore --schema=public --no-owner --no-privileges \
           -f docs/schema-original.sql docs/63cb903c-*.backup
```

Ele traz os corpos que o `types.ts` não teria dado, incluindo os que importam:
`build_segment_condition` (193 linhas), `evaluate_segment_rules` (190),
`score_lead_from_config` (171), `classify_lead_etiqueta` (46),
`resolve_or_create_identity` (145).

### Adaptação

| O que | Ocorrências | Vira |
|---|---|---|
| `auth.uid()` | 69 | Função própria; receita do `000_compat_supabase.sql` do HS.OS |
| FK para `auth.users` | 6 | Tabela de usuário própria |
| Papéis `authenticated` / `anon` | 42 / 13 | `marketinghs_app` |
| `pgmq.*` | 10 | §6 |
| `vault.*` | 7 | `integracoes.py` (já escrito no HS.OS) |
| `net.http_*` | 2 | `httpx` no backend |

### Mudanças de propósito

**`ecosystem_identities`** troca as chaves: sai `dndash_lead_id`, `nexus_contact_id`,
`mentoria_client_id`; entra `growthhs_person_id`, `growthhs_card_id`,
`datacore_cliente_id`, com espaço para `chamadoshs_id`. O `dnia_id` vira `hs_id`.

**`scoring_config` e `lead_statuses` vieram vazias.** Os critérios de qualificação do
original foram calibrados para vender imersão de R$47 a CEO de empresa de R$2–50 mi —
não descrevem quem compra bafômetro e contrato de calibração. Como as duas são tabela e
não código, semeamos direto com a régua da HS, em vez de portar a régua do infoproduto e
trocar depois. **O mecanismo porta fiel; os valores são decisão de produto.**

### RLS

No original as Edge Functions usam service-role e **ignoram o RLS por completo** — ele só
protege os 68 pontos em que o navegador fala direto com o banco. Quando esses pontos
virarem endpoint, o RLS deixa de ser a autorização e passa a ser rede de segurança.

Mantemos as 65 políticas e conectamos como `marketinghs_app` sem superpoderes, pela mesma
razão do HS.OS: vem de graça no dump e o custo de errar é vazar a base de leads inteira.
**Com a regra explícita de que nenhum endpoint depende delas** — cada rota autoriza
sozinha. RLS que ninguém verifica é RLS que não existe.

---

## 6. O motor: fila, agendamento e segredos

O Supabase provê quatro extensões que não temos. Duas descobertas encolheram o problema:
**`cron.job` está vazia** (não há job para portar) e **são só duas filas**
(`email_send_queue` e `journey_events`, 8 pontos de chamada).

| Supabase | Vira |
|---|---|
| `pgmq` | Duas tabelas comuns + `SELECT … FOR UPDATE SKIP LOCKED`. É o que o pgmq faz por dentro. |
| `pg_cron` | Laço `asyncio` no worker — padrão do `guardiao_crons.py` do HS.OS |
| `pg_net` + `invoke_edge_function` (337 linhas) | **Somem.** O agendador chama a função Python direto |
| `supabase_vault` | `integracoes.py` do HS.OS, portado do mesmo `_shared/integration-secret.ts` |

O trigger `fn_contact_event_to_journey_queue`, que hoje faz `pgmq.send()`, vira um
`INSERT` na tabela de fila. Fica mais simples do que está.

**Por que não instalar as extensões:** `pgmq` é extensão em Rust (pgrx), precisa de pacote
ou compilação; `pg_cron` exige `shared_preload_libraries` e portanto **reiniciar um
Postgres que serve os 9 bancos da empresa** — para zero jobs. Mas o argumento decisivo é
outro: o caminho Python **apaga** o `invoke_edge_function` em vez de portá-lo. Aquela
indireção existe só porque o Supabase separa banco de aplicação. Nós não separamos.

**O custo honesto:** reimplementar *visibility timeout*, retentativa e fila-morta é onde
mora bug de sistema de envio. Por isso essa é a **única parte do projeto que nasce com
teste automatizado** (§10).

**Onde roda:** contêiner `worker` no `docker-compose`, ao lado de `backend` e `frontend`.

---

## 7. Os lotes

Oito lotes. Cada um leva um domínio de ponta a ponta e **só fecha com a tela funcionando
no navegador** — nunca com "a rota existe".

| # | Lote | Functions | O que entra | Pronto quando |
|---|---|---|---|---|
| **0** | Fundação | 6 | Repo reestruturado, schema no `marketinghs`, auth própria, admin de usuários, limite de taxa | Login com usuário do **nosso** banco e a sidebar abre |
| **1** | **Contatos** | 15 | Captura, identidade, listagem, ficha 360°, tags, status, notas, duplicatas, import CSV, scoring | Importa um CSV real e a timeline da ficha mostra o histórico |
| **2** | Segmentos | 1 | Construtor de regras, audiência, prévia | Segmento novo dá a contagem certa e lista as pessoas certas |
| **3** | **Campanhas + o motor** | 8 | Templates (Unlayer), agendamento, fila, worker, Resend, webhook, descadastro, supressão | **Uma campanha de teste sai de verdade** e a abertura aparece na timeline |
| **4** | Jornadas | 2 | Board, gatilhos, esperas, condicionais, worker de jornada | Jornada de 2 passos com condicional roda ponta a ponta |
| **5** | Integrações HS | 6 | Handoff → GrowthHS, contatos do DataCore, identidade unificada, Meta CAPI, automações | Um lead qualificado **vira card no GrowthHS** sozinho |
| **6** | Analytics + IA | 4 | Painéis, funil, origem, AI Data Analyst | Os números batem com conferência manual no banco |
| **7** | Captação pública | 6 | Landing modelo da HS, conversões, OG estático, teste A/B | Um lead entra pela landing e chega qualificado no lote 5 |

**Seis functions são descartadas, não portadas:** `send-to-ticketia` e as cinco de
`pingback` (`send-to-pingback`, `-paid`, `-modal`, `-convidado`, `pingback-config`). São
o sistema de ingresso e o rastreador da dn.ia; não têm equivalente na HS.

A conta fecha assim: **48 portadas + 6 descartadas = 54**. A 55ª entrada de
`supabase/functions/` é `_shared/`, que é biblioteca comum, não function.

### Por que essa ordem

O contato vem primeiro porque tudo pendura nele — segmento é recorte de contato, campanha
é envio para segmento, jornada é campanha com condicional, analytics é contagem de
contato. Começar por outro lugar obriga a criar contato de mentira para testar.

O motor do §6 **não é construído num lote próprio de infraestrutura.** Ele nasce dentro do
lote 3, sendo usado. Essa é a resposta direta à lição que custou caro no HS.OS.

### Critério de pronto, mecanicamente

> **A lição do HS.OS:** ter o substituto pronto não é o mesmo que a tela usar o
> substituto. Durante dias o placar contou functions portadas enquanto telas chamavam
> coisas já apagadas — quebradas sem ninguém notar, porque o número dizia que estava bem.

Um lote fecha quando **as duas** condições valem:

```bash
# 1. Nenhuma tela do domínio fala mais com o Supabase
grep -rn "supabase\." frontend/src/components/admin/contacts frontend/src/hooks/useLeads*

# 2. A tela foi aberta e conferida no navegador (Playwright, Vite em 127.0.0.1)

# Só então a function sai da pasta de especificação
git rm backend/supabase/functions/contacts-list
```

O placar conta **duas coisas separadas** — functions portadas *e* telas migradas. Foi
juntar as duas num número só que escondeu telas quebradas no HS.OS.

---

## 8. Integrações HS

### A. Handoff → GrowthHS

O `handoff-to-nexus` (786 linhas, a maior function do repo) vira `handoff-to-growthhs`.
O encaixe é bom: a tabela `cards` do GrowthHS **já tem os campos que o handoff preenche** —
`utm_source`, `utm_campaign`, `utm_term`, `utm_params`, `origin`, `acquisition_channel`,
`person_id`, `list_id`, `contact_info`. A regra herdada ("origem = Tráfego pago se houver
qualquer UTM, ignorando o `source` do corpo") porta quase literal.

**Chamada pela API do GrowthHS, não por SQL.** Os dois bancos estão no mesmo servidor, o
que torna o `INSERT` direto tentador e errado: `cards` tem 38 colunas e o GrowthHS pendura
nela `card_list_history`, `automations`, `automation_executions`, `gamification_points` e
`notifications`. Um insert cru cria um card que o próprio sistema não sabe que nasceu.

A porta já existe: a tabela **`integration_clients`** do GrowthHS (`client_id`,
`client_secret_hash`, `api_key_hash`, `scopes`, `impersonate_user_id`) é o mecanismo de
autenticação máquina-a-máquina dele. Cadastramos o MarketingHS ali.

⚠️ **A confirmar na implementação:** se o endpoint de criação de card já existe na API do
GrowthHS ou se precisa ser escrito no `hsgrowth-sistema`.

O `nexus_config` vira `growthhs_config` — board, lista, dono padrão. Tabela, não código.

### B. Contatos vindos do DataCore

`tiny.clientes`: **2.077 clientes, todos os 2.077 com e-mail.** Chave natural `cpf_cnpj`.

Sincronização **de mão única e só leitura** — o ERP manda, o MarketingHS obedece, nunca
escreve de volta. Cada cliente vira uma linha em `leads` com `source='datacore'` mais uma
em `ecosystem_identities` com `stage='cliente'`. Uma tabela de contato só, e o segmento
passa a conseguir recortar "cliente" contra "lead".

⚠️ **Entregabilidade.** Disparar para 2.077 endereços frios de um domínio recém-autenticado
queima a reputação do remetente na primeira campanha. Aquecimento não é opcional — semanas
subindo volume aos poucos. O roadmap herdado põe isso como princípio, e o design concorda.

⚠️ **LGPD.** E-mail de nota fiscal no ERP é dado coletado para faturar, não consentimento
para marketing. Comunicação transacional e de relacionamento com cliente ativo tem base
legal; campanha promocional para a base inteira é outra conversa — **decisão do Erick e do
Nicholson, não do sistema.** O produto entrega o mecanismo (descadastro em 1 clique,
supressão automática, registro de origem e data).

### C. Identidade unificada

Chaves de casamento: e-mail normalizado, telefone via `normalize_phone_br` (já no dump) e
`cpf_cnpj` do lado do DataCore. O GrowthHS já tem uma `external_client_refs(source,
external_id, client_id)` — mesma ideia do lado dele; as duas conversam.

---

## 9. Travas de terceiro

Equivalente às 9 functions travadas do HS.OS. Aqui são menos, e quase todas já têm resposta
na casa.

| Serviço | Onde | Vira |
|---|---|---|
| **Lovable AI Gateway** | 3 functions de IA | **API da Claude direto** — troca de provedor, não de arquitetura |
| **Z-API** (WhatsApp) | 1 function | **Evolution API**, que a HS já roda (com o gotcha do `@lid`) |
| **Resend** | envio de e-mail | Resend mesmo — o HelpHS já usa. Domínio e chave novos |
| **Unlayer** | editor de e-mail | Conta própria (tem plano gratuito). Aponta, desde 01/10/2026, para o projeto `289750` da HS (antes, `288591` da dn.ia) |
| **Meta CAPI** | pixel + token | Pixel da HS — **e a resposta se a HS faz anúncio no Meta** |
| **Microsoft Clarity** | `useClarity` por página | Projeto próprio, ou remove |
| **Cloudflare Worker** | teste A/B (lote 7) | Conta Cloudflare da HS |
| Nexus, Ticketia, Pingback | 6 functions | **Descartadas** |

Regra herdada do HS.OS, mantida: **portar tudo menos a chamada ao provedor, deixando-a
parametrizada** — para que a decisão vire configuração e não código novo.

---

## 10. Auth, erro e verificação

### Duas superfícies de autenticação

**Usuário do admin** — hoje Supabase Auth com sessão em `localStorage`. Vira tabela
própria + `bcrypt` + `PyJWT`, padrão do HS.OS. **Acaba a recuperação de senha por e-mail:**
a `ResetPassword.tsx` é autosserviço (escuta o evento `PASSWORD_RECOVERY` do hash
fragment). Sistema interno, senha definida pelo TI, admin reseta a de quem esquecer.

**Chamador máquina** — `_shared/auth.ts`, chave na tabela `api_keys` (hash SHA-256,
permissões por escopo) ou `WEBHOOK_SECRET`. Não é Supabase: porta quase literal.

Uma classe de bug some de graça: a armadilha documentada no CLAUDE.md herdado — functions
fora do `config.toml` caindo no `verify_jwt = true` e devolvendo 401 para chave válida — é
conceito do gateway do Supabase. Fora dele, não existe.

⚠️ **O que passa a ser nosso problema:** `lead-capture`, `email-unsubscribe`,
`resend-webhook`, `ab-events` e `go` são **endpoints públicos sem autenticação, por
desenho** — é a landing page chamando. O gateway do Supabase fazia alguma contenção na
borda; o FastAPI não faz nenhuma. **Limite de taxa entra no lote 0**, como middleware.

### Erro

**A falha característica é tela chamando rota que ainda não existe.** Dois mecanismos, em
lados opostos:

1. O portão do §7 (`grep` + navegador), antes de fechar o lote
2. `src/integrations/supabase/client.ts` substituído por um **toco que estoura com
   mensagem clara** (`"não portado: contacts-list"`). Quebra silenciosa vira erro alto na
   primeira vez que alguém abre a tela.

**E-mail duplicado** — o erro caro do lote 3 — já está resolvido pelo schema, no nível do
banco:

```
uniq_campaign_sends_email_campaign_lead  (campaign_id, lead_id) WHERE channel='email'
uniq_campaign_sends_journey_node         (journey_run_id, journey_node_id)
uniq_journey_runs_open                   (journey_id, lead_id) WHERE state IN (active, waiting)
```

A garantia **não depende de o worker acertar** — é constraint. O worker pode reprocessar a
mesma mensagem; o segundo `INSERT` bate no índice e falha. Isso muda a política de
retentativa de "cuidadosa" para "à vontade". **Preservar os três ao pé da letra na
migração e não relaxá-los.**

### Verificação

Não existe test runner no projeto hoje, e não vamos cobrir 62 mil linhas herdadas. A régua:

- **pytest só onde executar não prova**: o motor de fila e envio do lote 3 — retentativa,
  *visibility timeout*, fila-morta, comportamento sob reprocessamento
- **Todo o resto no navegador**, com Playwright e Vite em `127.0.0.1` — padrão firmado no
  DataCoreHS. Não a extensão do Chrome
- `docs/ROADMAP.md` e `docs/CONTINUAR-AQUI.md`, mesma convenção do HS.OS, para qualquer
  sessão retomar sem arqueologia

### Segredos

⚠️ **Dívida herdada a não repetir:** o `.env` está versionado no repositório — não está no
`.gitignore`, e as chaves do Supabase da dn.ia estão no histórico do git. Nossos segredos
vão para `integracoes.py` (banco primeiro, ambiente como reserva), e `.env` entra no
`.gitignore` no lote 0.

---

## 11. Riscos e pontos abertos

| Risco | Gravidade | Mitigação |
|---|---|---|
| Fila própria com bug de duplicidade | Alta — queima domínio | Os três índices únicos do §10 + pytest no lote 3 |
| Endpoint público sem limite de taxa | Alta — base poluída | Middleware no lote 0 |
| Disparo para base fria do DataCore | Alta — reputação | Aquecimento de domínio antes da primeira campanha |
| Duas travessias abertas em paralelo (HS.OS + MarketingHS) | Média — atenção dividida | Reconhecido e aceito na decisão de apetite |
| Endpoint de card na API do GrowthHS pode não existir | Média | Verificar no início do lote 5; se faltar, escrever no `hsgrowth-sistema` |
| 69 substituições de `auth.uid()` | Baixa — mecânico | `sed` com revisão arquivo a arquivo |

**Aberto, a decidir depois:**

- Régua de scoring e funil da HS (`scoring_config`, `lead_statuses`) — decisão de produto,
  melhor tomada com a base real na tela
- A HS faz anúncio no Meta? Decide se o CAPI fica ou sai
- Microsoft Clarity: projeto próprio ou remover

---

## 12. O que este documento não decide

- **A ordem interna de cada lote.** Vai no plano de implementação
- **O desenho da landing modelo da HS.** Lote 7, com o `/humanoseagentes` como molde
- **Os critérios de qualificação.** Mecanismo porta fiel; valores são conversa de produto
- **Se a HS pode mandar campanha promocional para a base do ERP.** Decisão de negócio

---

## Notas relacionadas

- [[HS-OS]] — a travessia irmã, e a fonte de `integracoes.py`, do
  `000_compat_supabase.sql` e da lição do placar
- [[TalentHS]] — o primeiro remix da dn.ia a fazer esse caminho
- Cadastro de bancos: `~/projetos/bancos/README.md`
