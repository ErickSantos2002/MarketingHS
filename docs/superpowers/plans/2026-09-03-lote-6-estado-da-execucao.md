# Lote 6 — estado da execução

**Parado em:** 3 de setembro de 2026, fim do dia, a pedido do Erick.
**Plano:** `2026-09-03-marketinghs-analytics-e-ia.md` → na verdade
`2026-09-03-marketinghs-lote-6-analytics-e-ia.md`, no mesmo diretório.
**`HEAD` quando parou:** `5864cca` — commit coerente, **122 testes passando**.

Este arquivo existe porque o ledger da execução
(`.superpowers/sdd/2026-09-03-marketinghs-lote-6-analytics-e-ia/progress.md`)
**está fora do git** e some num `git clean`. O que não pode se perder está aqui.

---

## Onde parou

| | Tarefa | Estado | Commits |
|---|---|---|---|
| **1** | A porta de superusuário se fecha | ✅ revisada | `f737844`, `bba24ca` |
| **2** | O cliente da Claude e a chave | ✅ revisada | `c5ecc18` |
| **3** | As seis ferramentas | ✅ revisada | `32be256`, `5ee21cb` |
| **4** | O laço e o chat | ✅ revisada | `4a2b6d7` |
| **5** | As duas análises | ✅ revisada | `579ecb1`, `5864cca` |
| **6** | O painel | ⏸ **interrompida no meio** | — |
| **7** | As telas de IA | a fazer | — |
| **8** | A tarja dos dez mil | a fazer | — |
| **9** | O portão | a fazer | — |

### A Task 6 está no stash, e não compila

O trabalho parcial (rotas do painel, três hooks trocados, `useClarity` apagado)
está em **`git stash@{0}`**. Ele **não compila** — `useAgendamentos.tsx` ainda
referencia o toco do Supabase. Foi para o stash, e não para um commit, porque
esta branch nunca teve commit quebrado e não vale começar agora.

Duas saídas: `git stash pop` e terminar, ou descartar e redespachar a tarefa. O
plano **já foi corrigido** com o que a execução descobriu, então redespachar do
brief é seguro.

---

## O que a execução descobriu, e que o plano não sabia

Estas quatro coisas foram medidas contra o banco durante a execução. As três
primeiras **já estão corrigidas no plano**; ficam aqui porque explicam o porquê.

**1. `sessao()` sem argumento usa o papel `anon`.** Medido: sob `anon`,
`SELECT count(*) FROM contact_events` devolve **0**; sob `authenticated`,
**2.931** — a política é `TO authenticated` e sob `anon` nem se aplica. O plano
escrevia `sessao()` puro nas rotas do painel; teria feito o painel mostrar zero
reunião **sem erro nenhum**.

**2. A assinatura real é `sessao(role="anon", user_id=None)`.** O rascunho do
plano escrevia `sessao(usuario_id=...)`, que não existe.

**3. `_conferir_data` precisa devolver `datetime.date`, não `str`.** O Postgres
descreve o parâmetro de `$n::date` como tipo `date`, e o codec do asyncpg recusa
`str`. O plano devolvia `str` — **todo filtro `desde`/`ate` estava quebrado em
silêncio**.

**4. `leads` tem um gatilho `BEFORE INSERT` que sobrescreve `etiqueta`.**
`score_lead_from_config` faz `NEW.etiqueta := v_etiqueta`. Testes que usem
`etiqueta` como marcador falham apontando para o código errado. O marcador dos
testes é `tipo`.

---

## As decisões tomadas no caminho

Cada uma foi registrada quando tomada. Se alguma estiver errada, desfazer é
barato — todas cabem num commit.

**O router `/ia` inteiro exige `admin_atual`**, inclusive o CRUD de conversa.
O RLS de `leads` e `challenge_insights` é admin-only, então um não-admin não
levaria 403 — levaria zero linhas, e o modelo afirmaria o zero como fato. As
Edge Functions de origem **já chamavam `requireAdmin`**: portar com
`usuario_atual` era regressão frente ao sistema sendo portado. Um teste varre
`ia.router.routes` e trava isso.

**`listar_contatos` não devolve `nome`; devolve `empresa`.** O resultado de uma
ferramenta entra no contexto do modelo **e fica gravado em `ai_chat_messages`**.
O modelo não precisa do nome da pessoa para raciocinar sobre perfil. A empresa
fica porque em B2B ela é a unidade de análise e não há dimensão `empresa` para
agrupar. O teste afirma os dois lados, para a decisão não ser desfeita por
engano.

**Os esquemas não declaram `minimum`/`maximum`.** Constraints numéricas podem
não ser suportadas em schema com `strict: true`, e isso não dá para verificar
sem chave da Anthropic. Se não forem, a primeira pergunta de verdade volta 400.
A defesa real é a validação de servidor, que tem teste provando o teto no SQL.

**`analytics-api` foi descartada** (decisão do Erick), como Nexus, Ticketia e
Pingback. Placar do lote, quando fechar: **29 portadas + 7 descartadas**, 18 na
especificação. Os dois números nunca se somam.

**A migration nova se aplica sozinha, por `psql`.** O
`scripts/aplicar-migrations.sh` reaplica desde a `001`, que é dump bruto sem
`IF NOT EXISTS`, e morre em `type "app_role" already exists`. O cabeçalho do
próprio script diz "Idempotente" e mente.

---

## O que ainda depende do Erick

1. **A chave da Anthropic.** Sem ela o chat e as duas análises respondem 400 com
   mensagem que explica — o caminho de "não configurado" está testado, mas
   **nada da IA foi provado de ponta a ponta**. Grava-se em Configurações → IA.
   Custo estimado: ~US$ 15/mês.
2. **O modelo de permissão de `escrita_contatos.py`.** Mudar status, aplicar
   tags e editar contato aceitam **qualquer usuário autenticado**; só `fundir` e
   `excluir` exigem admin. Isso é coerente se a intenção for "o irreversível é
   do admin, o dia a dia é de quem opera" — e aí não há nada a fazer. Se a
   intenção era restringir, são quatro rotas para trocar. ⚠️ Hoje não expõe
   nada: existe um único usuário e ele é admin.
3. **Os 107 usos de `sessao(role="service_role")`** atrás de
   `usuario_atual`/`admin_atual`, espalhados por quase todos os routers. O
   `CLAUDE.md` diz que `service_role` nunca vale para request de usuário, porque
   ele tem `BYPASSRLS` e transforma as 65 políticas em decoração. O `ia.py`
   deste lote é o **único** arquivo do repo que segue essa regra. Uniformizar é
   auditoria com escopo próprio, rota por rota — não cabe de passagem.

---

## Como retomar

1. Ler este arquivo e o `docs/CONTINUAR-AQUI.md`.
2. Se o ledger ainda existir em
   `.superpowers/sdd/2026-09-03-marketinghs-lote-6-analytics-e-ia/progress.md`,
   ele tem o detalhe tarefa a tarefa e os briefs já extraídos.
3. Decidir sobre o `git stash@{0}`.
4. Retomar pela Task 6 do plano — **que já está corrigido**.

## Notas relacionadas

- `2026-09-03-marketinghs-lote-6-analytics-e-ia.md` — o plano
- `2026-08-31-marketinghs-design.md` — a spec, em `../specs/`
- `../../CONTINUAR-AQUI.md` — o estado geral da reconstrução
