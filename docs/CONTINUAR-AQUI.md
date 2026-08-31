# Continuar aqui

**Atualizado:** 31 de agosto de 2026
**Branch:** `reconstrucao` — **ainda não pushada**

## Onde paramos

**Lote 0 (Fundação) concluído.** As nove tarefas fecharam. O que funciona de
verdade, conferido no navegador com Playwright e não só por teste:

- Login em `http://127.0.0.1:8080/login` com usuário do banco `marketinghs`
- A sidebar do admin abre
- A aba **Configurações → Usuários** lista, cria, promove, rebaixa, troca e-mail,
  reseta senha e exclui — tudo contra a API própria
- Tela não portada mostra "Tela ainda não portada: `<alvo>`" sem derrubar a casca

## O próximo passo

**Escrever o plano do lote 1 (Contatos).** Um plano por lote é o combinado — o
do lote 1 deve ser escrito agora, com o que o lote 0 ensinou, e não antes.

O lote 1 é o espinho do sistema: tudo pendura no contato. São 15 functions
(`lead-capture`, `identity-lookup`, `identity-upsert`, `merge-identities`,
`receive-contact-event`, `validate-email-domain`, `contacts-list`,
`contact-details`, `contact-update`, `contact-status-update`,
`contact-tags-sync`, `apply-lead-tag`, `delete-contact`, `import-leads-csv`,
`recalculate-all-scores`) e a maior parte dos 68 pontos de acesso direto ao banco.

**Pronto quando:** você importa um CSV de verdade e a timeline da ficha de um
contato mostra o histórico.

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
