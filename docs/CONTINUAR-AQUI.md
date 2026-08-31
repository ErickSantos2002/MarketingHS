# Continuar aqui

**Atualizado:** 31 de agosto de 2026
**Branch:** `reconstrucao` — **ainda não pushada**

## Onde paramos

**Lote 1C (Escrita) concluído**, em cima do 1B, 1A e do lote 0.

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

**Escrever o plano do lote 1D (Identidade e captura).** As functions são
`lead-capture`, `identity-lookup`, `identity-upsert`, `receive-contact-event` e
`validate-email-domain` — a porta de entrada externa do sistema, que é também a
superfície pública sem autenticação. O limite de taxa do lote 0 já está lá
esperando pelo prefixo `/publico`.

Depois dele, o **1E**: a API pública por chave (`api_keys`, `contacts-list`,
`contact-details`), que traz o segundo modelo de autenticação.

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

## Antes de começar, três coisas do Erick

1. Cadastrar `[marketinghs]` no `~/.config/bancos/admin.toml` e rodar
   `criar_leitura.py marketinghs` — é o que faz `bancos.consultar` funcionar
2. Preencher `POSTGRES_HOST_INTERNO` em `~/marketinghs.env`
3. Decidir sobre o **push da branch**: ele é o que rompe o sync com o Lovable.
   Está na spec e é intencional, mas nunca foi feito.

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
