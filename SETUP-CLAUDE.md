# Automações do Claude Code para o MarketingHS

Recomendações sob medida para este repositório: hooks, subagentes, skills e MCP
servers, com configuração pronta para colar.

> **Este documento só documenta.** Nada em `.claude/` foi criado, nenhum outro
> arquivo do projeto foi tocado. Cada bloco abaixo diz onde salvar; é você quem
> decide o que entra.

---

## ALERTA DE SEGURANÇA

Três achados. O primeiro é o que importa antes do push.

### 1. O `.env` da origem está no histórico do git — e a branch nunca foi pushada

O commit inicial do remix versionou o `.env` com credenciais do Supabase da dn.ia:

```
commit 7e229dc  "Initial commit from remix"
  .env
    VITE_SUPABASE_PROJECT_ID="geoollqophgfsdmdtah…"
    VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_…"
    VITE_SUPABASE_URL="https://geoollqophgfsdmdtah….supabase.co"
    VITE_UNLAYER_PROJECT_ID="288591"
```

O arquivo saiu do índice depois e o `.gitignore` já o cobre (o próprio comentário
lá registra o motivo: *"o .env desta origem estava versionado, com chaves de
terceiro"*). Mas **remover do índice não remove do histórico** — os 36 commits
desta branch carregam o blob.

**Severidade: média, não crítica.** Uma `publishable key` do Supabase é desenhada
para viver no bundle do navegador; ela não é uma `service_role key`. O que vaza
de fato é o *identificador do projeto Supabase de um terceiro* (a dn.ia), o que
dá a qualquer um a URL exata para bater na API deles com o que a RLS de lá
permitir ao papel `anon`.

**O que faz esta pendência ser urgente e não crônica:** `docs/CONTINUAR-AQUI.md`
registra que a branch `reconstrucao` **ainda não foi pushada**. Enquanto isso for
verdade, o histórico é local e reescrevê-lo custa nada. Depois do push para o
GitHub, custa coordenação e o blob já terá sido indexado.

Verificar e decidir **antes** do push:

```bash
git log --all --oneline --diff-filter=A -- .env    # confirma o commit
git show 7e229dc:.env                              # confirma o conteúdo
```

Três saídas, em ordem de esforço:

1. **Aceitar** — registrar a decisão no `CONTINUAR-AQUI.md` e avisar a dn.ia
   para rotacionarem a `publishable key` do projeto deles. É chave de terceiro:
   a decisão de aceitar não é só sua.
2. **Reescrever o histórico** antes do push, com `git filter-repo --path .env
   --invert-paths`. Barato agora, caro depois.
3. **Começar do zero** — `reconstrucao` como órfã, um commit inicial limpo. O
   histórico do remix é da dn.ia, não seu; a spec já diz que romper o sync com o
   Lovable é intencional.

### 2. Dump binário do Postgres versionado em `docs/`

```
docs/63cb903c-ece5-4157-8f7f-e7dc4686df2d_260831.backup   558 KB
PostgreSQL custom database dump — v1.16-0 (origem: PG 17.6)
```

Formato `custom`, ou seja **comprimido** — grep não enxerga o conteúdo, e a
ausência de e-mails em texto plano no arquivo **não prova nada**. Não consegui
inspecionar nesta sessão (o `pg_restore -l` precisa de aprovação). Rode você:

```bash
pg_restore -l docs/63cb903c-*.backup | grep -c "TABLE DATA"
pg_restore -l docs/63cb903c-*.backup | grep "TABLE DATA" | head -30
```

- **Zero `TABLE DATA`** → é dump só de schema. Fica onde está; talvez valha um
  `README` ao lado dizendo o que é.
- **Qualquer `TABLE DATA`** → há linhas de `contacts`, `leads` ou das tabelas de
  configuração de integração dentro de um arquivo versionado. Isso é PII de lead
  (LGPD) e possivelmente token de Resend/Meta em tabela de config, num blob que
  vai para o GitHub junto com o resto. Nesse caso: tirar do repositório, guardar
  fora (`~/`), e resolver junto com o item 1 — os dois pedem reescrita de
  histórico, então faça uma vez só.

### 3. Nenhuma credencial embutida no código-fonte rastreado

Varri os 300+ arquivos versionados atrás de JWT/anon-key (`eyJ…`), chave Resend
(`re_…`), `sk-…`, `AIza…`, token Meta (`EAA…`), chave privada PEM e URL com
senha embutida. **Uma única ocorrência, e é placeholder:**

```
docs/superpowers/plans/…lote-0-fundacao.md:695
  DATABASE_URL=postgresql://marketinghs_app:TROCAR@62.72.11.28:3377/marketinghs
```

`backend/.env.example` também só tem placeholder. O padrão de segredo do projeto
(`~/marketinghs.env` fora do repo, `600`) está sendo seguido. Bom.

---

## Perfil do projeto

| | |
|---|---|
| **Backend** | FastAPI + asyncpg puro (sem ORM) · 7 routers · 3 arquivos de teste |
| **Frontend** | React 18 + Vite + TypeScript + shadcn/Radix + TanStack Query v5 · ~300 arquivos em `src/` |
| **Banco** | Postgres 17.11 no EasyPanel · 8 migrations SQL numeradas · RLS com 65 políticas herdadas |
| **Testes** | pytest no backend (`tests/`) · **nada no frontend** |
| **Lint** | ESLint 9 flat config no frontend · sem Prettier · `strict: false` no tsconfig |
| **Infra** | Docker Compose (backend/frontend/worker) · `worker/` vazio até o lote 3 |

**O estado que define tudo:** este repositório está no meio de uma travessia.
Números de hoje:

- **42** edge functions ainda em `backend/supabase/functions/` (especificação, não código vivo)
- **42** arquivos do frontend ainda importam o toco `integrations/supabase/client.ts`
- **24** arquivos ainda têm `.from(` / `.rpc(` direto (~90 pontos, segundo o `CONTINUAR-AQUI`, contra 153 no início)
- **39** chamadas a `functions.invoke` restantes
- **2** imports diretos de `@supabase/supabase-js` (`ResendConfigCard.tsx:22`, `useAIChat.tsx:4`)

Toda recomendação abaixo existe para servir a essa travessia. Quando ela acabar
— quando `client.ts` puder ser apagado — metade disto deixa de fazer sentido, e
tudo bem.

---

## ⚡ Hooks

### 1. Guarda do `.env` — bloqueia leitura, escrita e `git add` de segredo

**Por quê:** a regra `.env nunca é versionado` está no CLAUDE.md, mas o achado de
segurança acima mostra que uma regra escrita não impede um `git add .` distraído.
O `~/.config/bancos/admin.toml` é superusuário e o CLAUDE.md da máquina já diz
que o Claude não o lê — um hook transforma as duas frases em mecanismo.

**Salvar em** `scripts/hooks/guarda-env.sh` (`chmod +x`):

```bash
#!/usr/bin/env bash
# Segredo não se lê, não se escreve e não se comita. Regra do CLAUDE.md,
# aqui virada mecanismo.
entrada=$(cat)
alvo=$(jq -r '.tool_input.file_path // .tool_input.path // ""' <<<"$entrada")
cmd=$(jq  -r '.tool_input.command // ""' <<<"$entrada")

eh_segredo() {
  case "$1" in
    *.env.example|*.env.exemplo|*.env.sample) return 1 ;;
    *.env|*.env.*|*/marketinghs.env|*/bancos/admin.toml) return 0 ;;
  esac
  return 1
}

if [ -n "$alvo" ] && eh_segredo "$alvo"; then
  echo "BLOQUEADO: '$alvo' guarda segredo — o agente não lê nem escreve nele." >&2
  echo "Para saber quais chaves existem, use backend/.env.example." >&2
  echo "Se a tarefa exige escrita/DDL, monte um script que leia o arquivo sozinho e o Erick roda no Konsole." >&2
  exit 2
fi

if grep -qE '(^|[^[:alnum:]])git[[:space:]]+add' <<<"$cmd" && grep -qE '\.env([[:space:]]|$)' <<<"$cmd"; then
  echo "BLOQUEADO: 'git add' de .env. O .env desta origem já foi versionado uma vez, com chaves de terceiro." >&2
  exit 2
fi
exit 0
```

### 2. Guarda das regras do banco — as invariantes que o CLAUDE.md lista

**Por quê:** o CLAUDE.md tem seis regras absolutas sobre banco, e cada uma existe
porque já custou caro em algum lugar (`'admin'` vs `'administrador'` no HS.OS; a
chave desconhecida no `.env` que derrubou o boot duas vezes; o portão contado
pela metade). Elas dependem hoje de o agente ter lido e lembrado. Um hook checa
sempre.

**Salvar em** `scripts/hooks/guarda-banco.sh` (`chmod +x`):

```bash
#!/usr/bin/env bash
# As invariantes de banco do MarketingHS, verificadas a cada edição.
entrada=$(cat)
alvo=$(jq -r '.tool_input.file_path // ""' <<<"$entrada")
[ -f "$alvo" ] || exit 0
case "$alvo" in
  *.sql|*/backend/app/*.py|*/backend/app/*/*.py) ;;
  *) exit 0 ;;
esac

p=()

grep -qiE '^[^-]*CREATE[[:space:]]+EXTENSION' "$alvo" &&
  p+=("CREATE EXTENSION — nenhuma extensão é necessária. gen_random_uuid() é core desde o PG 13.")

grep -qiE 'GRANT[^;]*[[:space:]]TO[[:space:]]+marketinghs_app' "$alvo" &&
  p+=("GRANT direto ao marketinghs_app — ele é NOINHERIT de propósito. O privilégio vem do SET LOCAL ROLE que a sessao() emite.")

grep -qiE 'DROP[[:space:]]+INDEX[^;]*(uniq_campaign_sends_email_campaign_lead|uniq_campaign_sends_journey_node|uniq_journey_runs_open)' "$alvo" &&
  p+=("DROP INDEX num dos três índices únicos parciais — são a garantia, no nível do banco, de não disparar e-mail duplicado. Intocáveis.")

grep -qE "['\"]administrador['\"]" "$alvo" &&
  p+=("O papel aqui é 'admin'. 'administrador' é o valor do HS.OS, e o enum é public.app_role.")

case "$alvo" in
  */backend/app/database.py) ;;
  *) grep -qE '_pool\.acquire\(|create_pool\(' "$alvo" &&
       p+=("Conexão fora da database.py — sessao() é o único caminho para dado. Sem o SET LOCAL ROLE a query falha por permissão, e isso é proposital.") ;;
esac

grep -qE 'sessao\([^)]*service_role' "$alvo" &&
  p+=("AVISO: role=\"service_role\" tem BYPASSRLS. Só para operação interna (bootstrap, job agendado) — nunca num caminho de request de usuário. Confirme qual é o caso.")

if [ ${#p[@]} -gt 0 ]; then
  printf 'Regras do MarketingHS em %s:\n' "$alvo" >&2
  printf '  - %s\n' "${p[@]}" >&2
  exit 2
fi
exit 0
```

> A última checagem (`service_role`) dispara também em uso legítimo — é
> deliberadamente barulhenta, porque um `service_role` num caminho de request de
> usuário anula as 65 políticas de RLS de uma vez. Se incomodar, apague as três
> linhas; o resto continua valendo.

### Configuração — colar em `.claude/settings.json`

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|Read|NotebookEdit|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR/scripts/hooks/guarda-env.sh\"",
            "timeout": 5
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR/scripts/hooks/guarda-banco.sh\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

`jq`, `python3` e `psql` já estão instalados nesta máquina — nenhum hook precisa
de dependência nova.

### Outros hooks que valem, sem a config completa

- **`Settings` × `.env.example`** — `PostToolUse` em `backend/app/config.py` e
  `backend/.env.example`: compara as chaves `MAIÚSCULA=` do exemplo com os campos
  declarados em `Settings` e reclama do que só existe num lado. É exatamente a
  falha que derrubou o HS.OS duas vezes, e é trivial de detectar.
- **ESLint no arquivo editado** — `PostToolUse` rodando `npx eslint <arquivo>` só
  no `.tsx` tocado (~2s). Com `strict: false` e `noUnusedVars: off` o tsconfig
  pega pouco; o ESLint pelo menos pega hook de React fora de ordem.
- **`pytest -q` após editar `backend/app/`** — a suíte é de 3 arquivos, roda em
  menos de um segundo. Vira caro no lote 3, que é o lote que nasce com teste.

---

## 🤖 Subagentes

### 1. `guardiao-do-portao` — verifica o portão de pronto, sem contar pela metade

**Por quê:** este é o subagente que este projeto pede em voz alta. O portão tem
três condições, o CLAUDE.md avisa duas vezes que ele já foi contado pela metade
(tarefa 6 do lote 0), e explica em detalhe por que o `grep` de linha única mente.
É um ritual mecânico, verificável e que o agente que acabou de portar a tela tem
todo incentivo de declarar cumprido. Delegar para um segundo par de olhos que não
escreveu o código é o ponto.

**Salvar em** `.claude/agents/guardiao-do-portao.md`:

```markdown
---
name: guardiao-do-portao
description: Verifica o portão de pronto do MarketingHS para uma tela portada. Use SEMPRE antes de declarar uma tela pronta ou de remover uma edge function de backend/supabase/functions/. Recebe o nome da tela e as functions envolvidas.
tools: Bash, Read, Glob
model: sonnet
---

Você verifica o portão de pronto. Você não porta código, não conserta nada e
não tem interesse em que a resposta seja "sim".

Recebe: o caminho da tela e os nomes das edge functions que ela deveria ter
aposentado.

## As três condições

**1. A tela não fala mais com o Supabase.**

    grep -rn "supabase" frontend/src/<caminho da tela>

Zero linhas. Qualquer ocorrência reprova, inclusive comentário — comentário
mencionando supabase numa tela portada é sinal de trabalho pela metade.

**2. NINGUÉM MAIS chama a function — inclusive de outra tela.**

    grep -rn "<nome-da-function>" frontend/src

Esta é a condição que já falhou. No lote 1A a tela de importação estava limpa,
mas `apply-lead-tag` continuava sendo chamada pelo caminho de conversão das
landing pages. Você procura no `frontend/src` inteiro, nunca só na pasta da
tela. Uma única chamada viva em qualquer lugar reprova.

**3. A tela foi aberta e conferida no navegador.**

Você não consegue verificar isto sozinho. Pergunte explicitamente: a tela foi
aberta no Playwright, com o Vite em 127.0.0.1:8080, e o caminho principal foi
clicado? "Compila", "os endpoints respondem por HTTP" e "está tipado" **não
são** esta condição. Se a resposta for qualquer coisa menos um sim direto,
reprove — e diga que reprovou por falta do clique, não por defeito no código.

## O placar

Conte e reporte **dois números, sempre separados, nunca somados**:

    # functions ainda na especificação
    ls -d backend/supabase/functions/*/ | grep -v _shared | wc -l

    # arquivos do frontend que ainda importam o toco
    grep -rl "integrations/supabase" --include=*.ts --include=*.tsx frontend/src | wc -l

    # pontos de acesso direto — busca MULTILINHA, o grep de linha única mente
    grep -rlz --include=*.ts --include=*.tsx -P 'supabase\s*\.?\s*\n?\s*\.(from|rpc)\(' frontend/src \
      | tr '\0' '\n' | grep -v integrations/supabase | wc -l

Somar os dois números foi o que escondeu telas quebradas no HS.OS. Não some.

## Sua resposta

Um veredito por condição — APROVADO / REPROVADO — com a evidência colada
(a saída real do comando, não a sua descrição dela). Depois o placar. Depois,
só se as três passarem, a frase: "a function pode sair da especificação".
```

### 2. `revisor-de-acesso-a-dado` — RLS, autorização e `sessao()`

**Por quê:** o CLAUDE.md diz que **nenhum endpoint depende do RLS para autorizar**
e que cada rota autoriza sozinha — e que "RLS que ninguém verifica é RLS que não
existe". São 7 routers hoje e serão muitos mais até o lote 8. Essa é uma revisão
de segurança específica demais para um code-reviewer genérico, e regular demais
para depender de lembrança.

**Salvar em** `.claude/agents/revisor-de-acesso-a-dado.md`:

```markdown
---
name: revisor-de-acesso-a-dado
description: Revisa rotas do backend do MarketingHS quanto a autorização, uso da sessao() e papéis de RLS. Use ao criar ou alterar qualquer arquivo em backend/app/routers/ ou backend/app/auth/, antes de commitar.
tools: Read, Glob, Bash
model: sonnet
---

Você revisa acesso a dado no backend do MarketingHS. Só isso — não comenta
estilo, nomes nem organização.

Leia `backend/app/database.py` e `backend/app/dependencies.py` antes de julgar
qualquer rota: eles definem o contrato.

## O que verificar, rota por rota

**Autoriza sozinha?** Toda rota depende de `usuario_atual` ou `admin_atual`
(ou, na borda pública, de chave de API com escopo). O RLS é segunda linha, nunca
a primeira. Uma rota que só confia no RLS está errada mesmo que funcione.

**Passa pela `sessao()`?** Nenhum `_pool.acquire()` fora da `database.py`. O
`marketinghs_app` é NOINHERIT e sem privilégio em `public`: sem o
`SET LOCAL ROLE` a query falha com permissão negada, e isso é proposital.

**Qual papel?** `service_role` tem `BYPASSRLS`. Num caminho de request de
usuário isso anula as 65 políticas de uma vez. Só vale para operação interna:
bootstrap, job agendado. Se aparecer numa rota que um usuário alcança, é o
achado mais grave que você pode reportar.

**O `user_id` certo chega?** `sessao(role=..., user_id=...)` alimenta
`app.current_user_id`. Uma rota autenticada que chama `sessao()` sem passar o
`user_id` deixa as políticas cegas.

**O papel é `'admin'`.** Nunca `'administrador'` — esse é o valor do HS.OS.
O enum é `public.app_role`.

**Escopo da chave de API** é aplicado nos dois sentidos: o que a chave pode ler
e o que ela pode escrever. Chave ausente e chave inválida dão 401, não 403.

## Sua resposta

Só o que for defeito real, com `arquivo:linha` e o cenário concreto de falha —
que entrada, de que chamador, alcança que dado que não deveria. Ordene por
gravidade. Se não houver defeito, diga isso em uma linha e pare; não invente
achado para justificar a revisão.
```

### Outros subagentes que valem

- **`arqueologo-de-function`** — recebe o nome de uma das 42 edge functions e
  produz o contrato exato dela (entrada, saída, tabelas tocadas, papel de RLS
  usado, erros) lendo o `index.ts` e os `_shared/`. É o trabalho de leitura que
  antecede cada lote, e é 100% delegável. Especialmente valioso para o lote 3:
  `journey-worker`, `send-campaign` e o `_shared/secrets.ts` são densos.
- **`revisor-de-plano`** — o `CONTINUAR-AQUI.md` registra que a revisão do lote 0
  *"pegou quatro defeitos no plano, não no trabalho"*, e conclui que "planos deste
  projeto merecem desconfiança na execução". Um agente que lê o plano do lote
  contra o schema real antes de executar tem retorno comprovado aqui.

---

## 🎯 Skills

### 1. `/portar-tela` — o ritual completo, do inventário ao portão

**Por quê:** portar uma tela é a única coisa que este projeto faz, lote após
lote, sempre com os mesmos passos e as mesmas armadilhas. Uma skill invocável
por você (`/portar-tela Campaigns`) carrega o ritual inteiro em vez de depender
de o agente reler o CLAUDE.md e lembrar de tudo.

**Salvar em** `.claude/skills/portar-tela/SKILL.md`:

```markdown
---
name: portar-tela
description: Porta uma tela do MarketingHS do Supabase para o backend próprio — inventário, endpoint, troca, conferência no navegador e portão de pronto.
disable-model-invocation: true
---

# Portar uma tela

Argumento: o nome ou caminho da tela (ex.: `Campaigns`, `admin/segments`).

Leia o plano do lote atual em `docs/superpowers/plans/` antes de começar. Ele
manda mais que esta skill — mas desconfie dele: a revisão do lote 0 achou quatro
defeitos no plano, não no trabalho.

## 1. Inventário

O que a tela usa hoje:

    grep -rn "supabase" frontend/src/<caminho>
    grep -rn "functions.invoke" frontend/src/<caminho>

Para cada function encontrada, leia `backend/supabase/functions/<nome>/index.ts`
e os `_shared/` que ela importa. Aquilo é **especificação**, não código a
traduzir linha a linha: o objetivo é o contrato, não o Deno.

## 2. O endpoint

No `backend/app/routers/`, seguindo o que já existe:

- Toda query de dado por `sessao()`. Nada de `_pool.acquire()` fora da `database.py`.
- A rota autoriza sozinha, via `usuario_atual` ou `admin_atual`. O RLS é segunda linha.
- Papel `'admin'`, nunca `'administrador'`.
- `service_role` só para operação interna. Numa rota de usuário, nunca.
- Chave nova de ambiente? Declare em `Settings` **e** no `.env.example`. O
  pydantic-settings recusa chave desconhecida e derruba o boot inteiro.
- Router novo entra no `app.include_router` da `main.py`.

## 3. A troca no frontend

`@/lib/api` no lugar do `supabase`. Mantenha o formato que a tela já consome —
adaptar no cliente e não na tela reduz a superfície de mudança.

Se algo da tela ainda não estiver portado, deixe estourar pelo toco: o
`LimiteDeErro` contém a explosão e a casca do admin sobrevive. Não invente
fallback silencioso — a falha silenciosa é justamente o que custou caro no HS.OS.

## 4. A conferência

    cd backend && ./.venv/bin/python -m uvicorn app.main:app --port 8100 --reload
    cd frontend && npx vite --port 8080

Abra `http://127.0.0.1:8080` no Playwright e **clique o caminho principal**.
A porta 8000 é do TaskHS nesta máquina.

"Compila", "está tipado" e "o endpoint responde por HTTP" não substituem o
clique. O `CONTINUAR-AQUI` do lote 1D registra uma tela dada como portada sem
ele; a pendência ficou aberta.

## 5. O portão

Chame o subagente `guardiao-do-portao`. Não avalie o próprio trabalho aqui.
Só depois de APROVADO nas três condições:

    git rm -r backend/supabase/functions/<nome>

## 6. Registrar

Atualize `docs/CONTINUAR-AQUI.md`: o que funciona *de verdade*, o placar em dois
números separados, e as pendências honestas — inclusive as feias.
```

### 2. `/placar` — os dois números, e a foto do que falta

**Por quê:** o CLAUDE.md dedica um parágrafo inteiro a como medir progresso e um
aviso em destaque sobre o `grep` de linha única que subcontou 153 pontos como 68.
Uma medição que precisa de um script Python de cinco linhas escrito na hora é uma
medição que vai ser feita errado ou não ser feita.

**Salvar em** `.claude/skills/placar/SKILL.md`:

```markdown
---
name: placar
description: Mede o progresso da portagem do MarketingHS — functions na especificação, telas ainda no Supabase e pontos de acesso direto. Nunca soma os números.
disable-model-invocation: true
---

# Placar da portagem

Rode os quatro, colando a saída real:

    # 1. functions ainda na especificação
    ls -d backend/supabase/functions/*/ | grep -v _shared | wc -l

    # 2. arquivos do frontend que ainda importam o toco
    grep -rl "integrations/supabase" --include=*.ts --include=*.tsx frontend/src | wc -l

    # 3. pontos de acesso direto — MULTILINHA. O grep de linha única mente:
    #    contou 68 quando eram 153, porque o código herdado quebra a chamada
    #    em "supabase\n  .from(".
    python3 -c "
    import pathlib, re
    n = sum(len(re.findall(r'supabase\s*\.?\s*\n?\s*\.(from|rpc)\(', f.read_text()))
            for f in pathlib.Path('frontend/src').rglob('*.ts*')
            if 'integrations/supabase' not in str(f))
    print(n, 'pontos de acesso direto')"

    # 4. chamadas a edge function que sobraram
    grep -rn "functions.invoke" --include=*.ts --include=*.tsx frontend/src | wc -l

Reporte cada número **separado e rotulado**. Nunca some functions portadas com
telas migradas: foi juntá-los num número só que escondeu telas quebradas no
HS.OS.

Liste também os arquivos por trás do número 3, ordenados por quantidade —
é a fila de trabalho dos próximos lotes, e o maior bloco isolado costuma ser o
melhor candidato ao lote seguinte.

Quando `frontend/src/integrations/supabase/client.ts` puder ser apagado sem
quebrar nada, a portagem acabou. Diga quanto falta para isso.
```

### Outras skills que valem

- **`/nova-migration`** — próximo número na sequência (hoje `008_`), cabeçalho no
  estilo das existentes, e a lista do proibido: `CREATE EXTENSION`, `GRANT` ao
  `marketinghs_app`, `DROP INDEX` nos três parciais. Termina lembrando que o
  `aplicar-migrations.sh` roda **todas** as migrations de novo, do zero.
- **`/motor-de-fila`** (para o lote 3) — empacota a decisão já tomada: as duas
  filas viram tabela comum com `FOR UPDATE SKIP LOCKED`, o agendador vira laço
  `asyncio` no `worker/`, `invoke_edge_function` não volta, e são **14** funções
  de banco, não as 9 que a spec estimou. É a única parte do projeto que nasce com
  teste automatizado — a skill deve exigir o teste antes do código.

---

## 🔌 MCP servers

### 1. Playwright — já instalado, e o portão depende dele

O plugin `playwright` está ativo nesta sessão. Não é uma instalação a fazer; é um
uso a formalizar. A condição 3 do portão de pronto — *"a tela foi aberta e
conferida no navegador"* — só existe através dele, e é a condição que mais falha.

Convenções da casa, que valem repetir onde o agente vai ler:

```bash
cd frontend && npx vite --port 8080        # 127.0.0.1, não localhost
cd backend  && ./.venv/bin/python -m uvicorn app.main:app --port 8100 --reload
```

O `CONTINUAR-AQUI` do lote 1D registra a falha característica: *"um overlay de
outra aba bloqueou o clique depois de três tentativas"*. A lição prática é fechar
a página entre telas em vez de acumular abas.

### 2. GitHub MCP — está configurado e **quebrado**

Nesta sessão o servidor falhou ao conectar:

```
plugin:github:github (400)
  "Error POSTing to endpoint: bad request: Authorization header is badly formatted"
```

Não é ausência de configuração, é credencial mal formada. Vale consertar agora,
porque o push da branch `reconstrucao` — a decisão pendente nº 3 do
`CONTINUAR-AQUI` — é o próximo marco do projeto, e PR/issue passam a fazer parte
do fluxo a partir dele. Diagnóstico: `claude mcp list`, depois `claude --mcp-debug`.
O `gh` CLI cobre boa parte do mesmo terreno enquanto isso.

### Sobre acesso ao banco: não instale um MCP de Postgres

O CLAUDE.md da máquina é explícito — *"nunca montar conexão na mão nem ler `.env`
de projeto"* — e a casa já tem o cadastro `bancos` com usuário sem permissão de
escrita para os 9 sistemas. Um MCP de Postgres criaria um segundo caminho de
credencial, competindo com o padrão, sem ganhar nada.

O que falta é registrar o MarketingHS lá, e isso já é a pendência nº 1 do
`CONTINUAR-AQUI`:

```bash
# preencher o bloco [marketinghs] em ~/.config/bancos/admin.toml, depois:
python3 ~/projetos/bancos/criar_leitura.py marketinghs
```

Feito isso, `bancos.consultar("marketinghs", sql)` responde, sem MCP nenhum e
sem risco de o agente cair num superusuário — que ignoraria RLS por definição e
tornaria as 65 políticas decoração.

**`context7` também já está instalado** e é genuinamente útil aqui: asyncpg,
TanStack Query v5 e o `react-email-editor` (Unlayer) são as três bibliotecas
deste projeto sobre as quais um modelo mais provavelmente inventa API.

---

## 🧩 Plugins

O `superpowers` já está instalado e em uso de verdade — `docs/superpowers/specs/`
e `docs/superpowers/plans/` são a espinha do projeto, e o fluxo
brainstorm → spec → plano → execução por lote está funcionando. Não há o que
adicionar aí.

O `hookify` (também já instalado) fecha o ciclo com este documento: quando uma
sessão repetir um erro que os hooks acima não cobrem, `/hookify` transforma o
erro numa regra em vez de numa linha a mais no CLAUDE.md. Este projeto tem um
histórico visível de aprendizados virando prosa; alguns deles cabem melhor como
código.

---

## Ordem de adoção sugerida

1. **Resolver o alerta de segurança** — inspecionar o `.backup`, decidir sobre o
   histórico. Antes do push, enquanto ainda é barato.
2. **Os dois hooks.** Meia hora, e transformam seis regras escritas em mecanismo.
3. **`guardiao-do-portao`.** É a automação de maior retorno do repositório: o
   erro que ela previne já aconteceu, está documentado, e custou uma tarefa
   inteira para consertar.
4. **`/portar-tela` e `/placar`** — antes de começar o lote 2, para que o lote 2
   já use.
5. **Consertar o GitHub MCP** — antes do push, não depois.
6. **Cadastrar `marketinghs` no `bancos`** — destrava consulta ao banco em
   qualquer sessão.

## O que eu deliberadamente não recomendo

**Hook de formatação automática.** Não há Prettier configurado e o código herdado
tem estilo próprio. Um formatador entrando agora produziria diffs enormes no meio
de uma portagem, misturando ruído com trabalho real numa revisão que precisa ser
lida linha a linha. Depois que `client.ts` for apagado, reconsidere.

**Hook de type-check a cada edição.** Com `strict: false`, `noImplicitAny: false`
e `noUnusedLocals: false`, o `tsc` deste projeto pega quase nada — e cobra
segundos por edição num projeto de 300 arquivos. Apertar o tsconfig é um trabalho
que vale por si, mas não durante a travessia.

**Subagente genérico de code review.** Já existem vários instalados
(`pr-review-toolkit`, `feature-dev:code-reviewer`) e o `/code-review` cobre o
caso geral. O que falta aqui é específico — o portão e o acesso a dado — e é
exatamente o que os dois subagentes acima fazem.

**Mais um lugar para guardar contexto.** O `CONTINUAR-AQUI.md` funciona, é lido e
é honesto sobre pendências. Não crie um segundo painel de estado.

---

## Nota fora de escopo

`CLAUDE.md` diz sobre o script de migrations:

> ```bash
> bash scripts/aplicar-migrations.sh    # NÃO é idempotente; ver o cabeçalho
> ```

O cabeçalho do script diz o contrário:

> ```bash
> # Aplica as migrations no Postgres do MarketingHS (serviço próprio no EasyPanel).
> # Idempotente: pode rodar de novo sem estragar o que já existe.
> ```

Um dos dois está desatualizado. Como o CLAUDE.md manda explicitamente "ver o
cabeçalho" e o cabeçalho contradiz a advertência, quem ler os dois fica sem saber
se pode rodar de novo. Vale um minuto para alinhar — não mexi em nenhum dos dois.
