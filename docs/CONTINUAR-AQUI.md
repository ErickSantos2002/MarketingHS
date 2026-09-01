# Continuar aqui

**Atualizado:** 1º de setembro de 2026
**Branch:** `reconstrucao` — **ainda não pushada**

## Onde paramos

**Lote 3A (Campanhas e templates) concluído.** ⚠️ **O lote 3 NÃO fechou** — ele
foi partido em 3A/3B/3C, e o "pronto" que a spec define ("uma campanha de teste
sai de verdade e a abertura aparece na timeline") é a soma de 3B e 3C.

O que funciona pela tela agora: criar campanha escolhendo template e segmentos,
com a audiência contando ao vivo; editar; duplicar; excluir; e acompanhar pela
gaveta de detalhe, com a tabela de envios e as métricas. Template tem CRUD
próprio. **Nada é enviado** — o botão avisa que o envio chega no 3B e a campanha
fica salva em rascunho.

Conferido no navegador: a lista com os rótulos de audiência certos ("Todos os
contatos", "Quentes"), o wizard contando 3 → 1 ao escolher o segmento, o
template aparecendo no seletor, o fluxo até "Confirmar envio" terminando com a
campanha em rascunho, e a gaveta mostrando 2 enviados / 2 abertos (100%) /
1 clicado (50%) / 1 bounce a partir de envios semeados.

O acesso direto ao banco caiu de 68 para **51 pontos**.

### As três coisas que o 3A ensinou

**`campaigns.stats` é congelada.** Só é escrita uma vez, quando a fila drena,
antes de qualquer abertura. O frontend já sabia e contornava com
`execute_readonly_query` — SQL por concatenação numa função SECURITY DEFINER que
aceita consulta arbitrária do navegador. A agregação veio para o servidor, com
os MESMOS filtros de `finalize_campaign_if_drained`. Resta um chamador daquela
RPC: `usePages`.

**O portão pegou o plano de novo.** Ele dizia que `campaigns-api` e
`templates-api` sairiam da pasta. Não saíram: as duas aceitam chave de API — ou
seja, servem integrador externo — e o 3A portou só a metade do admin. A
`campaigns-api` ainda carrega o `?action=send`. **A metade pública das duas é
tarefa do 3B**, e por isso a documentação pública ficou como está.

**Duas correções vieram da execução, não da revisão:** `scheduled_at` como `str`
derrubava o POST com 500 (o asyncpg exige `datetime` em `timestamptz`, e o cast
`::timestamptz` não salva), e o plano descrevia errado o `guard_campaign_delete`
— ele recusa `sending` e envios `pending`, não campanha `sent`.

## O próximo passo

**Escrever o plano do 3B (O motor), e executá-lo.** É o coração do projeto e o
único lugar que a spec manda nascer com teste automatizado — um e-mail enviado
duas vezes para a base inteira queima o domínio.

O que o 3B tem de resolver, já levantado e verificado:

1. **`process-email-queue` NÃO EXISTE.** O worker que de fato envia é citado por
   sete arquivos e não está no repositório nem no histórico do git. A lógica por
   destinatário — supressão, merge tags, URL de descadastro assinada, rodapé,
   cabeçalhos RFC 8058 — terá de ser **derivada de quem a verifica**:
   `email-unsubscribe` (que confere o HMAC), `send-test-email` (credenciais e
   merge tags) e `_shared/secrets.ts` (ordem de resolução do segredo).
2. **As tabelas de fila não existem.** `email_send_queue` e `journey_events`
   eram do `pgmq`. Viram tabela comum + `FOR UPDATE SKIP LOCKED`.
3. **Sete funções de banco a reimplementar:** `email_queue_read`,
   `email_queue_delete`, `email_queue_send_batch`, `reset_stuck_campaigns` e as
   três de segredo de integração. As outras sete da lista original são do lote 4
   (jornadas) ou não voltam (`invoke_edge_function`).
4. **A metade pública de `campaigns-api` e `templates-api`**, mais o
   `?action=send`.
5. O `worker/` na raiz está vazio, mas o `docker-compose.yml` já aponta o
   serviço para `python -m app.worker` na imagem do backend.

### Depois do 3B

**3C** — webhook do Resend (assinatura Svix), métricas e agendamento.
⚠️ `promote_scheduled_campaigns` está **quebrada e o defeito é latente**: ela
chama `invoke_edge_function`, que o lote 0 apagou. Devolve 0 sem erro hoje
porque o laço não roda sem campanha agendada; estoura com `UndefinedFunctionError`
no instante em que uma vence. Provado.

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
