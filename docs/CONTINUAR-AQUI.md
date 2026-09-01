# Continuar aqui

**Atualizado:** 1º de setembro de 2026
**Branch:** `reconstrucao` — **ainda não pushada**

## Onde paramos

**Lote 3B (O motor) concluído.** O envio de e-mail existe de ponta a ponta:
enfileirador, fila com visibility timeout e fila-morta, worker que drena,
montagem por destinatário, supressão respeitada e descadastro assinado
funcionando na tela.

**O primeiro envio real foi adiado por decisão** (01/09/2026): o sistema ainda
não tem usuário, e configurar domínio e chave do Resend agora não paga o
trabalho. ⚠️ Enquanto a chave não existir, o worker **não consome a fila** — de
propósito. Campanha enfileirada fica esperando, nada é perdido, nada mente.

Quando for a hora, são três passos:

```bash
bash ~/marketinghs-configurar-resend.sh          # pede chave e remetente
cd ~/github/MarketingHS/backend && ./.venv/bin/python -m app.worker
# na tela: campanha para UM contato de teste, enviar
```

### O que já está de pé

`pgmq` virou `email_send_queue` (tabela + `FOR UPDATE SKIP LOCKED`), `pg_cron`
virou laço `asyncio` no worker, `supabase_vault` virou `integration_secrets`, e
o `invoke_edge_function` não voltou. **17 testes** cobrem o motor.

Provado sem enviar um byte:

- **modo degradado**: sem `RESEND_API_KEY` o worker fica de pé, avisa e **não**
  consome a fila. Fingir que enviou seria o pior desfecho — as linhas sairiam de
  `pending`, a campanha fecharia como enviada e ninguém receberia nada.
- **pipeline inteiro** com o Resend substituído: 3 mensagens, 2 enviadas, 1
  virando `suppressed` (não `failed`), fila a zero, campanha fechada pelo
  `finalize` do banco, cabeçalhos RFC 8058 com one-click.
- **recuperação de órfãs**: fila apagada com as linhas `pending` de pé, e o
  re-enfileiramento republicou as 3 sem criar nenhuma duplicata.
- **as duas pontas do HMAC concordam**: o token do nosso worker foi conferido
  contra o `computeToken` do `email-unsubscribe/index.ts` **rodando de verdade**
  — endereço comum, com acento e com maiúsculas.

### As duas coisas que o portão pegou

**A página `/descadastrar` não existia.** O worker assina um link para
`{FRONTEND_URL}/descadastrar` e essa rota não estava no `App.tsx` — todo link de
descadastro daria 404. Foi criada, pública, e conferida clicando: valida sem
descadastrar (RFC 8058), descadastra ao confirmar, e token adulterado mostra
"Link inválido" **sem** jogar o visitante no login.

**`process-email-queue` não existe.** Sete arquivos a citam e ela não está no
repositório nem no histórico do git. Toda a lógica por destinatário foi derivada
de quem a verifica. Está registrado no plano do 3B, tabela por tabela.

## O próximo passo, depois do envio

**Lote 3C.** O que ficou de fora:

- **webhook do Resend** — abertura e clique não voltam sem ele. Assinatura Svix:
  HMAC-SHA256 sobre `"{svix-id}.{svix-timestamp}.{corpo}"`, chave = base64 do
  `RESEND_WEBHOOK_SECRET` sem o prefixo `whsec_`, janela anti-replay de 5 min.
- **agendamento.** ⚠️ `promote_scheduled_campaigns` está quebrada e o defeito é
  latente: chama `invoke_edge_function`, que o lote 0 apagou. Devolve 0 sem erro
  hoje porque o laço não roda sem campanha agendada; estoura com
  `UndefinedFunctionError` no instante em que uma vence. O conserto é o
  agendador Python fazer a seleção e chamar `/campanhas/{id}/enviar` direto — é
  isso que apaga a indireção em vez de portá-la.
- **a tela de configuração do Resend** (`resend-config`, 568 linhas) e a **lista
  de supressão** na interface.
- **a metade pública de `campaigns-api` e `templates-api`**, que o 3A descobriu
  que ainda não tinha substituto.

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
