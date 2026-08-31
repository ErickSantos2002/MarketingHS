# MarketingHS — Roadmap da reconstrução

Oito lotes verticais. Cada um leva um domínio de ponta a ponta e **só fecha com
a tela funcionando no navegador** — nunca com "a rota existe".

A spec que justifica esta ordem:
`docs/superpowers/specs/2026-08-31-marketinghs-design.md`

| # | Lote | Functions | Estado |
|---|---|---|---|
| **0** | **Fundação** — repo, schema, auth, usuários, limite de taxa | 6 | ✅ **concluído** (31/08/2026) |
| **1A** | **Entrada** — importar, pontuar, etiquetar | 3 | ✅ **concluído** (31/08/2026) |
| **1B** | **Leitura do admin** — lista e ficha 360° inteira | 0 | ✅ **concluído** (31/08/2026) |
| **1C** | **Escrita** — status, tags em lote, fusão, exclusão | 0 | ✅ **concluído** (31/08/2026) |
| 1E | **A API pública** — `api_keys`, `contacts-list`, `contact-details` | 2 | a fazer |
| 1D | Identidade e captura — dedupe, fusão, captura externa | 5 | a fazer |
| 2 | Segmentos — construtor de regras, audiência | 1 | a fazer |
| 3 | **Campanhas + o motor** — templates, agendamento, fila, worker, Resend | 8 | a fazer |
| 4 | Jornadas — board, gatilhos, condicionais | 2 | a fazer |
| 5 | Integrações HS — GrowthHS, DataCore, identidade, Meta CAPI | 6 | a fazer |
| 6 | Analytics + IA | 4 | a fazer |
| 7 | Captação pública — landing da HS, conversões, A/B | 6 | a fazer |

Seis functions são **descartadas, não portadas**: `send-to-ticketia` e as cinco
de `pingback`. São o sistema de ingresso e o rastreador da dn.ia.

## Placar

Dois números, nunca somados. Foi juntá-los que escondeu telas quebradas no HS.OS.

```
functions portadas          : 8/48
telas migradas              : 17
acesso direto ao banco      : 90 pontos  (eram 153 antes do 1B)
```

⚠️ **A spec dizia 68 pontos em 20 arquivos. Estava errado** — a medição usou um
`grep` de linha única, que perde `supabase\n  .from(`. O comando correto está no
`CLAUDE.md`. O número não muda nenhuma decisão da spec, mas muda a expectativa
de quanto trabalho falta: é mais que o dobro.

## O lote 1C entregou

Status individual e em lote, tags em lote, edição, exclusão lógica e **a fusão
de contatos dentro de uma transação**. Antes ela fundia dois leads em sete
operações independentes a partir do navegador, sem rollback: falhar no meio
deixava tags e segmentos já migrados, o descartado ainda existindo, e os dois
apontando para os mesmos dados.

Apagada a cadeia morta do Dashboard — 1.185 linhas que ninguém alcançava e que
carregavam 17 pontos de acesso direto.

A migration 005 resolveu duas incoerências herdadas: o funil agora tem uma
fonte de verdade só (`lead_statuses`, com FK), e o `source_app` dos eventos
passou de `dnmarketing` para `marketinghs`.

## O lote 1B entregou

A tela de Contatos lista, e a ficha 360° abre com timeline, notas e tags — tudo
contra a API própria. A API pública (`contacts-list`, `contact-details`) virou o
lote 1E: serve chamador externo, e a HS não tem nenhum hoje.

**O scoring do cliente foi arrancado.** Existiam duas implementações — o trigger
do banco e 75 linhas de TypeScript refazendo a conta no navegador — e a segunda
gravava `lead_score` e `etiqueta` direto, colunas que o trigger não vigia. O
valor do navegador vencia o do banco. Agora quem pontua é o banco, e a ficha
mostra o número dele.

## O lote 1A entregou

O scoring passou a existir: `scoring_config` veio vazia no dump e nada era
pontuado. A régua agora é da HS, mora numa linha de tabela e trocá-la é um
`UPDATE`. Sai o `classify_lead_etiqueta`, que já chegou desabilitado mas
continuava no schema com o ICP da dn.ia dentro.

Importação de CSV pela tela, com deduplicação por e-mail, fusão de linhas
duplicadas no mesmo arquivo, aplicação de tag em lote e recálculo de scores.

## O lote 0 entregou

Login com usuário do nosso Postgres, sidebar abrindo, e a tela de usuários
operando contra a API própria. Zero Supabase no caminho da autenticação.

O que existe: repositório em `backend/` + `frontend/` + `worker/`; schema de 36
tabelas, 65 políticas de RLS e 47 funções no Postgres do EasyPanel; auth com
bcrypt e JWT; as 6 rotas de administração de usuário; limite de taxa na borda
pública; e o toco do Supabase com o `LimiteDeErro`, que juntos transformam
quebra silenciosa em erro visível sem derrubar a casca do admin.

## Pendências que atravessam lotes

- [ ] **Trocar a senha do superusuário do Postgres.** Hoje é igual ao nome de
  usuário, numa porta exposta. Rodar assim durante a construção foi decisão do
  Erick, com o risco explicado. **Obrigatório antes do lote 5**, que traz os
  2.077 clientes do DataCore para dentro. A troca é pela interface do EasyPanel,
  não por `ALTER USER`.
- [ ] Preencher `POSTGRES_HOST_INTERNO` em `~/marketinghs.env` — necessário no deploy.
- [ ] Cadastrar `[marketinghs]` no `~/.config/bancos/admin.toml` (host
  `62.72.11.28`, porta `3377`) e rodar `criar_leitura.py marketinghs`.
- [ ] `JWT_SECRET` de produção precisa ser gerado, não o texto do exemplo.
- [ ] Identidade visual: o `index.html`, os logos e o tema ainda são da dn.ia.
- [ ] Régua de scoring da HS (`scoring_config`) — decisão de produto, melhor
  tomada com a base real na tela. **O funil já virou dado**: `lead_statuses` é
  a fonte de verdade e trocar os status é um INSERT, não uma migration.
- [ ] **Quais status avançam o estágio da identidade.** O original avançava
  para `opportunity` ao qualificar; a régua da HS não existe, e avançar por
  engano é pior que não avançar.
- [ ] **Quem limpa os contatos com `deleted_at` antigo.** A exclusão é lógica e
  nada os remove de vez; a lixeira cresce para sempre.
- [ ] **Teto de 10.000 leads na memória do navegador.** O `AdminDataProvider`
  carrega a base inteira e filtra no cliente. Portado fiel de propósito no 1B;
  quando a base da HS se aproximar disso, mover o filtro para o servidor deixa
  de ser opcional — e vai cascatear em toda tela que usa `useAdminData`.
- [ ] **O detalhamento de score na ficha ainda é calculado no cliente.** Ele não
  grava mais nada, e o número exibido é o do banco, mas a lista de "quais
  critérios bateram" repete em TypeScript a conta do PL/pgSQL e pode divergir.
  O certo é vir do servidor.

## Decisões de produto que ainda faltam

- A HS faz anúncio no Meta? Decide se o CAPI fica ou sai (lote 5).
- Microsoft Clarity: projeto próprio ou remover.
- A HS pode mandar campanha promocional para a base do ERP? Decisão do Erick e
  do Nicholson, não do sistema (ver §8-B da spec).
