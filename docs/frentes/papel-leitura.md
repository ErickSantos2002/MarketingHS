# Frente `papel-leitura` (n 28 · Vite 8108 · backend 8128 · Postgres local 5448)

**Objetivo:** papel novo `leitura` no `public.app_role`. Quem tem esse papel
vê as telas do admin e não altera nada, porque o servidor recusa. Não vê
Configurações nem exportação. Pedido do Nicholson: conta para o Sergio
(agência do Leão) "dar uma olhada em tudo".

## Estado (27/10): ✅ pronta para merge

**Portão local** (Postgres 5448, do zero com 000–034):

- `pytest`: **1226 passed, 9 skipped**. Os 9 são os conhecidos: 7
  `base_real` e 2 da 032.
- `tsc`: 0.
- `guarda:visual -- src`: 0.
- `vite build`: ok.
- node: 93 + 1 skip.

**034 NÃO aplicada em produção.** Aplicada 2× no local; a segunda deu só o
NOTICE do `IF NOT EXISTS`. Ela tem que rodar com `psql -f` em autocommit e
nunca com `--single-transaction` (o `ADD VALUE` precisa estar comitado antes
da função que o cita). A ordem de deploy é livre: o backend novo funciona sem
a 034, porque compara `role::text = 'leitura'`, e a 034 sem o backend novo
não faz nada, porque ninguém tem o papel.

**Conferência de tela como admin** (`conferir-telas`, backend 8128 → produção,
só leitura):

- Telas: `/`, `/contacts`, `/campaigns`, `/segments`, `/templates`,
  `/automations`, `/experiments`, `/pages`, `/pages/phoebus/edit`, `/settings`.
- Nenhum botão do admin sumiu.
- `/automations` a 390 px dá scrollWidth 438. Já era assim antes: a frente não
  mexeu no layout do admin ali.

A visão do leitor está provada pelos testes, não pelo navegador. A conta do
`conferir-telas` é admin.

## Como ficou

### Três camadas

1. **Rota.** A trava é única, em `usuario_atual` (`dependencies.py`).
   - O leitor leva 403 ("Acesso somente leitura…") em todo método que não seja
     GET/HEAD/OPTIONS.
   - Quando `usuario_atual` é chamado sem a requisição (caso do
     `admin_ou_maquina`), a trava falha fechada.
   - `admin_atual`, `admin_ou_leitura` e `admin_ou_maquina` passam todos por
     ela, então rota nova já nasce protegida.
   - `admin_ou_leitura` fica só nos GET de leitura.
2. **Transação.** `database.sessao(role="authenticated", user_id=<leitor>)`
   liga `transaction_read_only`. A partir daí o próprio Postgres recusa
   qualquer escrita.
3. **Banco.** O `has_role(uid, 'admin')` da 034 também responde sim para o
   leitor, mas **só dentro de uma transação READ ONLY**.

### Testes (`backend/tests/test_papel_leitura.py`)

- Varre `app.routes` e exige 403 **com a mensagem da trava** em toda escrita
  não pública.
- O inventário exato das rotas com `admin_ou_leitura` fica num teste.
- Toda rota aberta ao leitor só abre sessão `authenticated`.
- O leitor vê **o mesmo JSON que o admin** em todas as rotas abertas, sobre
  uma base semeada.
- As listas principais não vêm vazias.
- A sessão do leitor é READ ONLY e um INSERT dá `ReadOnlySQLTransactionError`.
  A do admin continua de escrita.
- `usuarios` aceita os três papéis.
- Prova de que os testes pegam o defeito: com o `has_role` antigo, 3 deles
  falham.

### Rotas abertas a `leitura` (`admin_ou_leitura`)

- **A/B:** `GET /ab/config`, `/ab/testes`, `/ab/testes/{id}`,
  `/ab/testes/{id}/eventos`
- **Automações:** `GET /automacoes`
- **Campanhas:** `GET /campanhas`, `/campanhas/{id}`,
  `/campanhas/{id}/audiencia`, `/campanhas/{id}/envios`
- **Jornadas:** `GET /jornadas`, `/jornadas/{id}`, `/jornadas/{id}/execucoes`
- **Contatos:**
  - `GET /contatos` (só `visao=ativos` para o leitor: `apagados` e `todos`
    dão 403)
  - `GET /contatos/busca`, `/contatos/conversoes-utm`, `/contatos/duplicatas`
  - `GET /contatos/{id}`, `/{id}/consentimentos`, `/{id}/conversoes`,
    `/{id}/conversoes-lista`, `/{id}/eventos`
- **Páginas:** `GET /paginas`, `/paginas/estatisticas`, `/paginas/numeros`
- **Painel:** `GET /painel/agendamentos`, `/painel/agendamentos/mql-hoje`,
  `/painel/config/{chave}`
- **Segmentos:** `GET /segmentos`, `/segmentos/{id}/contatos`
- **Templates:** `GET /templates`, `/templates/{id}`
- **Exceções da trava** (POST que é leitura pura; ids demais para a URL):
  - `POST /contatos/enriquecimento`
  - `POST /contatos/tags-por-contato`

  Sem as duas, a tabela de Contatos perde as colunas de ecossistema e as tags.
  O hook engole o 403, e as tags aparecem **vazias, sem aviso**.

### Continuam só de admin

- **Configuração e integração:**
  - `/config/growthhs`, `/config/ia`, `/config/meta`, `/config/resend*`
  - `/config/envio/ritmo`
  - `/chaves`
  - `/sites` (token de rastreio)
  - `/supressoes`
- **Pessoas e arquivos:** `/usuarios`, `/arquivos`
- **IA:** `/ia/*` (conversas, insights, análises: gastam IA)
- **Teste:** `/teste/growthhs/pedidos`
- **Toda escrita.** Isso inclui as prévias por POST (`/segmentos/previa`,
  `/segmentos/audiencia`, `/automacoes/previa`). Nas telas do leitor elas não
  disparam.

Já eram de qualquer logado e seguem assim:

- `/auth/eu`, `/config/redes-sociais`, `/config/scoring`
- `/lead-statuses`, `/tags`, `/tipos-de-contato`
- `GET /preferencias/{chave}`, `/crm/estado`

### Frontend

- **`useAuth`** expõe `papel`, `isLeitura` e `podeVerAdmin`. O helper central
  é `usePodeEditar()`.
- **`ProtectedRoute`** aceita admin ou leitura.
- **`AdminLayout`:**
  - redireciona o leitor de `/settings`, `/import`, `/templates/new` e
    `/experiments/setup`;
  - mostra o selo "Acesso somente leitura";
  - não monta o chat de IA para o leitor.
- **Sidebar:** some o grupo Sistema (Importar e Configurações).
- **Botões de ação:** somem nas telas de Contatos, Segmentos, Campanhas,
  Templates, Automações/Fluxos, A/B, Páginas e Painel.
  - Os switches ficam desabilitados.
  - Os editores abrem só para ver.
  - Exportação CSV some em Contatos, no drawer de Segmentos e no detalhe do A/B.
  - O seletor de "Visualização" (apagados) some.
- **`UserManagement`:** tem seletor de três papéis, na lista e na criação.

## Fora do território (tocado por ser central)

- `backend/app/database.py`: as linhas do READ ONLY em `sessao()`.
- `backend/app/routers/leitura_contatos.py`: além da troca de dependência, o
  403 de `visao != ativos` para o leitor. É autorização, não lógica de dado.

## Perguntas abertas

1. **O RLS foi "afrouxado" para o leitor, mas só para leitura.** O despacho
   pedia para não afrouxar. Só que **toda** política e toda RPC de leitura é
   `has_role(…,'admin')`, e assim o leitor veria zero em todas as telas.
   - **Assumida:** `has_role` aceita o leitor só em transação READ ONLY. A
     escrita continua impossível no banco e na rota.
   - **Alternativas:**
     - (a) `service_role` nas rotas de leitura: sem segunda linha nenhuma;
     - (b) uma política de SELECT por tabela: dezenas, e cada esquecida vira
       zero silencioso;
     - (c) desistir do papel.
   - **Para desfazer:** recriar o `has_role` da 001.
2. **LGPD: a tela não exporta, mas a API entrega a base ativa inteira.**
   - O leitor pode paginar `GET /contatos` (até 1000 por página), e
     `/segmentos/{id}/contatos` e `/campanhas/{id}/envios` não têm teto.
   - Esconder o CSV não impede quem usa a API com o token.
   - Contato excluído já ficou de fora (403).
   - Se a agência não deve ter os dados pessoais, as opções são:
     - mascarar e-mail e telefone para o leitor;
     - ou limitar o tamanho da página.

   Confirmar com o Nicholson o que o Sergio pode ver.
3. **O leitor vê consentimentos, notas e eventos da ficha.** Assumido: sim,
   porque é "ver tudo".
4. **No editor de template, o leitor pode mexer nos blocos (nada grava).** O
   upload de imagem do editor visual leva 403 com toast de erro. É experiência
   ruim, não furo.
