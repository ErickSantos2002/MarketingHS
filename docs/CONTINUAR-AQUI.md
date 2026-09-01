# Continuar aqui

**Atualizado:** 1º de setembro de 2026
**Branch:** `reconstrucao` — **ainda não pushada**

## Onde paramos

**Lote 2 (Segmentos) concluído**, em cima do 1D, 1C, 1B, 1A e do lote 0.

Segmento funciona de ponta a ponta pela tela: criar estático escolhendo contatos
na busca, criar dinâmico montando regras com a prévia contando ao vivo, editar,
duplicar, ver a lista de contatos, e excluir — com a guarda do banco recusando
quando o segmento está em uso e mostrando **qual campanha** o usa.

Tudo conferido no navegador, clicando: a lista com as contagens certas, a gaveta
de contatos, a prévia mostrando "1 contato — Carla Menezes" enquanto a regra era
montada, o salvamento, o 409 da exclusão aparecendo como aviso na tela, e a
barra de ações em massa inserindo um contato novo (confirmado no banco).

A API pública `/publico/segmentos` substituiu a `segments-api`, com escopo de
chave aplicado nos dois sentidos.

O acesso direto ao banco caiu de 87 para **68 pontos**.

### O que valeu a pena e não estava no plano

O portão encontrou **duas chamadas mortas que nenhuma tela fazia**: a tela de
Documentação da API e a especificação OpenAPI pública ainda ensinavam
`/segments-api` aos integradores. Portar a tela não bastava — quem integra lê a
documentação, não o código. As duas foram atualizadas.

Também virou 400 (com mensagem) o que era 500 quando alguém manda um `lead_id`
que não existe, e duplicar segmento estático passou a levar os membros junto: a
tela duplicava com a lista vazia, devolvendo uma casca.

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

## O próximo passo

**Executar o lote 3 (Campanhas + o motor).** É o maior valor de negócio do
projeto e a parte que a spec diz nascer com teste automatizado — um e-mail
enviado duas vezes para a base inteira queima o domínio.

⚠️ **O plano do lote 3 ainda não está escrito.** Um plano por lote é o
combinado, e ele merece atenção extra: são **14 funções de banco e 2 triggers** a
reimplementar em Python, não 9 como a spec estimou. Duas filas
(`email_send_queue` e `journey_events`) viram tabela comum com
`FOR UPDATE SKIP LOCKED`, e o agendador vira laço `asyncio` no `worker/`, que
está vazio até aqui.

O lote 2 entregou o que o 3 precisava: campanha já tem como escolher público.
`useSegmentAudience` e `SegmentMultiSelect` funcionam contra a API própria, e a
contagem que o assistente de campanha mostra vem das mesmas funções que o envio
usa.

### O panorama

- **Lote 3 (Campanhas + o motor)** — o maior valor, e o único que nasce com
  teste automatizado. Depende do `worker/`, que ainda não existe.
- **Lote 5 (Integrações HS)** — handoff para o GrowthHS e os 2.077 clientes do
  DataCore. ⚠️ Exige trocar a senha do superusuário antes.
- **Lote 4 (Jornadas)** — depende do motor do lote 3.

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
