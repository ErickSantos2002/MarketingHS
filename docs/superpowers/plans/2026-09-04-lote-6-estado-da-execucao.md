# Lote 6 — estado da execução

**Concluído em:** 4 de setembro de 2026.
**Plano:** `2026-09-03-marketinghs-lote-6-analytics-e-ia.md`, no mesmo diretório.
**Intervalo:** `c8f063b..c458b37`, 18 commits, **127 testes** passando.

Este arquivo existe porque o ledger da execução
(`.superpowers/sdd/…/progress.md`) **fica fora do git** e some num `git clean`.
As decisões tomadas durante a execução estão aqui — sem elas, o próximo a
mexer nisto tem de adivinhar por que o código diverge do plano.

---

## As nove tarefas

| | Tarefa | Commits |
|---|---|---|
| **1** | A porta de superusuário se fecha | `f737844`, `bba24ca` |
| **2** | O cliente da Claude e a chave | `c5ecc18` |
| **3** | As seis ferramentas | `32be256`, `5ee21cb` |
| **4** | O laço e o chat | `4a2b6d7` |
| **5** | As duas análises | `579ecb1`, `5864cca` |
| **6** | O painel — metas, cartões, agendamentos | `4e5db30` |
| **7** | As telas de IA | `e34fc6a`, `73ff149` |
| **8** | A tarja dos dez mil | `976e853` |
| **9** | O portão | `5c70c2b` |
| — | A onda de correção da revisão final | `c458b37` |

Todas passaram por revisão própria, e o lote inteiro por uma revisão final que
leu os 18 commits juntos.

---

## O plano errou seis vezes, e a execução pegou todas

Vale mais que o resto deste arquivo: **planos deste projeto merecem
desconfiança na execução**, e a prova é que nenhuma das seis apareceu na
leitura do plano — todas apareceram quando alguém mediu contra o banco ou
contra o código real.

1. **`_conferir_data` devolvia `str`** e o codec do asyncpg recusa `str` em
   `$n::date` — todo filtro `desde`/`ate` estava quebrado em silêncio.
2. **`SET LOCAL ROLE` fora de transação** no trecho do Passo 5 da tarefa 3.
3. **`sessao(usuario_id=…)` não existe** — a assinatura real é
   `sessao(role=…, user_id=…)`. Estava em dois briefs.
4. **`json.dumps(valor)` dobraria a codificação** no `PUT /painel/config`:
   `database.py:17` já registra o codec de `jsonb` com `encoder=json.dumps`.
5. **`contact_events` não tem coluna `created_at`** — é `occurred_at`.
6. **`hasMore` cru daria falso negativo na tarja** exatamente no teto, que é o
   único momento em que ela precisa aparecer. Virou `temMaisNoServidor`.

E uma sétima, de forma: o bullet "Interfaces" da tarefa 8 prometia um
`totalNoServidor` que o código concreto do próprio plano nunca produzia e para
o qual não há fonte — `PaginaContatos<T>` só carrega `{itens, tem_mais}`.
Omitido por YAGNI.

---

## A portagem foi onde os defeitos nasceram

Três capacidades caíram **durante o porte**, não antes dele. Duas foram pegas e
desfeitas dentro do lote; a terceira virou pergunta.

- **O botão de apagar insight** (aba Desafios) sumiu porque a tarefa 5 nunca
  escreveu rota de DELETE e o mapa de rotas do plano só listava GET e POST.
  Devolvido na tarefa 7: `DELETE /ia/insights-de-desafios/{id}`, com 404 em vez
  de um 200 sem efeito.
- **O teto de agendamentos caiu de 20.000 para 500.** A tarefa 6 trocou um hook
  que paginava em lotes de 1.000 por um `LIMIT 500` chapado. A tarefa 8
  restaurou os 20.000 e fez a rota avisar quando corta.
- **`dashboard_cards` deixou de ser por usuário e virou global.** Continua
  assim, de propósito, mas é decisão que ninguém validou com o Erick — está na
  lista de pendências do `CONTINUAR-AQUI`.

**A lição:** o portão de pronto do `CLAUDE.md` pergunta se a tela ainda fala
com o Supabase e se alguém mais chama a function. Não pergunta **se a tela
ainda faz o que fazia**. Esses três passariam pelo portão como está escrito.

---

## As decisões tomadas na execução

Agrupadas por assunto, com o custo de cada uma estar errada.

### Sobre a chave da Anthropic

**Seguir sem ela**, provando o caminho de "não configurado" (400 com mensagem)
e parando o portão explicitamente nos passos que dependem do modelo, em vez de
marcá-los como verdes. Nos despachos, os subagentes foram **proibidos** de
procurar chave em `admin.toml` ou em arquivos de ambiente.
*Custo:* o chat não está provado de ponta a ponta — a primeira pergunta de
verdade só acontece quando a chave for gravada.

### Sobre permissão

- **O router `/ia` inteiro é `admin_atual`**, inclusive o CRUD de conversa.
  Toda operação com sentido ali lê dado restrito a admin; deixar o CRUD aberto
  permitiria a um não-admin criar conversa que nunca poderá usar.
- **Nunca `sessao()` sem argumento** nestas rotas: o padrão é o papel `anon`, e
  sob `anon` o `contact_events` devolve **0** contra 2.931 sob `authenticated`.
- **`escrita_contatos.py` não foi consertado**, contra a opinião de um revisor
  que o marcou como Critical. A divisão é coerente como modelo de permissão —
  `fundir` e `excluir` são de admin; status, tags e edição são trabalho de
  marketing do dia a dia. Chamar isso de brecha supõe uma resposta a uma
  pergunta de negócio. *A pergunta está no `CONTINUAR-AQUI`.*
- **Os outros 107 `service_role` não foram unificados.** Todos estão atrás de
  `usuario_atual`/`admin_atual`, então a autorização não se perde — só a
  segunda linha de RLS. Unificar 107 pontos dentro de um lote sobre IA seria a
  contagem-num-número-só que este projeto já documentou. O `CLAUDE.md` passou a
  dizer que a regra é direção, não descrição.

### Sobre o que o modelo vê

- **`listar_contatos` perde a coluna `nome` e mantém `empresa`.** O resultado
  da ferramenta entra no contexto do modelo **e** fica gravado em
  `ai_chat_messages` — nome de pessoa não precisa estar nos dois. `empresa`
  fica porque em B2B é a unidade de análise.
- **`minimum`/`maximum` saíram dos esquemas** enviados à API: não dava para
  verificar suporte a constraint numérica sob `strict: true` sem chave, e
  descobrir na primeira pergunta real seria o pior momento. O teto continua
  dito na `description` e imposto no servidor, que tem teste.

### Sobre o 502 do chat

O comentário prometia que a pergunta sobrevive à falha da IA. Não sobrevive —
tudo está numa transação só. **Corrigido o comentário, não o código:** gravar a
pergunta em transação própria deixaria duas mensagens de usuário seguidas e
quebraria a alternância estrita de que a janela de histórico depende. A
correção óbvia trocaria uma mentira de comentário por um defeito real.

### Sobre medir em vez de prever

- Os números do placar no plano eram **previsão, não gabarito**. Ajustar
  qualquer coisa para bater com eles foi explicitamente proibido.
- A mensagem de commit do plano já afirmava que o portão pegaria documentação
  ensinando URL morta "pela sétima vez", escrita antes de alguém olhar. Ficou
  porque a medição confirmou — se não confirmasse, sairia.

---

## O ponto cego da régua

O script que conta pontos de acesso direto ao Supabase **subconta**.
`useAbConfig.tsx` e `useAbTests.tsx` alcançam o banco por
`const db = supabase as any`, e o regex não reconhece o alias; ele também perde
chamadas quebradas em várias linhas (`db\n  .from(`). São **9 pontos reais**
que o número publicado não inclui.

Não é deste lote e não é novo — estava invisível antes também, o que significa
que **as contagens dos lotes anteriores também estavam otimistas**.

---

## O que ficou conhecido e não consertado

- **`ia.py:228`** — o 502 de `_analisar` ainda devolve
  `f"A IA não respondeu: {e}"`, exatamente o padrão que a onda de correção
  consertou no `enviar_mensagem`, uma função ao lado. Higiene numa rota admin,
  não buraco; consertar um e deixar o gêmeo é assimetria que confunde quem ler.
- **O chat segura conexão do pool e transação aberta** durante toda a conversa
  com o modelo (`max_size=10`, até 8 idas de 120s, sem prazo global).
  Inalcançável com um usuário. Está no `CONTINUAR-AQUI` como pergunta.
- **`desempenho_de_campanhas` não tem teste** e nunca foi executada — é a única
  das seis ferramentas nessa situação, e só sai dela com a chave configurada.
- **`build_segment_condition`** não é `SECURITY DEFINER`, então a guarda nova
  não a cobre. Auditada (`quote_literal` + `CASE` de coluna fixa) e nomeada no
  próprio arquivo de teste como o primeiro lugar a olhar quando o motor de
  segmentos for mexido.

## Notas relacionadas

- `docs/CONTINUAR-AQUI.md` — onde o projeto parou, e o que depende do Erick
- `docs/superpowers/plans/2026-09-03-marketinghs-lote-6-analytics-e-ia.md` — o plano
- `docs/superpowers/specs/2026-08-31-marketinghs-design.md` — a spec
