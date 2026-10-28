# Pedido ao HSGrowth — agendamento de reunião pelo MarketingHS (28/10/2026)

Para uma sessão aberta em `~/github/hsgrowth-sistema` (`cl hsgrowth-sistema`).
O MarketingHS só lê aquele repositório; quem escreve é a sessão de lá.

Design completo do lado do MarketingHS:
`~/github/MarketingHS/docs/superpowers/specs/2026-10-28-agendamento-reuniao-design.md`.

## O que é

A landing do MarketingHS vai deixar o lead (empresa com mais de 400
funcionários) marcar sozinho uma reunião na **sala de vídeo do GrowthHS
(Daily)** com um vendedor livre. O MarketingHS escolhe o vendedor (roleta de
reunião própria) e cria, pela API e com o cliente `integracao2` (id 28,
`is_integracao = true`):

1. `POST /api/v1/cards` na lista 28 com `assigned_to_id` — **já funciona**
   (provado em homologação, card 11244);
2. `POST /api/v1/card-notes` — já funciona;
3. `POST /api/v1/card-tasks` (`task_type=meeting`,
   `meeting_kind=apresentacao_phoebus`, `assigned_to_id`, `due_date`,
   `duration_minutes`, `invited_emails=[lead]`) — já funciona;
4. `POST /api/v1/card-tasks/{id}/daily-room` — **não funciona para
   integração** (item B).

Faltam três coisas no GrowthHS. Tudo que fala com a Microsoft fica aí — o
MarketingHS não terá integração Microsoft própria.

## A. Livre/ocupado dos vendedores, para integração

Hoje: `GET /api/v1/auth/me/seller-schedule` usa o token Microsoft **delegado**
do usuário logado (`microsoft_graph_service.get_schedule`). O `integracao2`
não tem conta Microsoft.

Pedido: rota nova, autenticada como as outras que o `integracao2` usa,
restrita a usuário `is_integracao`:

```
GET /api/v1/integration/agenda?user_ids=19,3,9&inicio=<ISO UTC>&fim=<ISO UTC>
→ 200 {
    "vendedores": [
      { "user_id": 19, "email": "...", "ocupado": [
          { "inicio": "<ISO UTC>", "fim": "<ISO UTC>", "status": "busy" } ] },
      ...
    ],
    "erros": [ { "user_id": 3, "motivo": "sem caixa de e-mail" } ]
  }
```

- Por dentro: `getSchedule` com **token de aplicativo** (MSAL
  `acquire_token_for_client(["https://graph.microsoft.com/.default"])`, o
  mesmo `MS_CLIENT_ID`/`MS_CLIENT_SECRET`/`MS_TENANT_ID`), em
  `POST /users/{email-de-um-vendedor-da-lista}/calendar/getSchedule`, com
  `schedules` = e-mails dos vendedores (resolvidos de `user_ids` aqui).
- Devolver só os itens **não-`free`** (`busy`, `tentative`, `oof`,
  `workingElsewhere` vão como estão; o MarketingHS decide). Sem `subject`
  nem `location`: o MarketingHS não precisa saber o que é o compromisso.
- Período máximo de 15 dias por chamada (a landing mostra 14). Datas sempre
  UTC explícito na entrada e na saída.
- Vendedor sem caixa ou fora do escopo da permissão vai em `erros`, não
  derruba a resposta inteira.
- ⚠️ Confirmar no teste: com permissão de aplicativo, o `getSchedule` de
  **outros** usuários depende de o usuário do caminho estar no escopo e de a
  política de compartilhamento de livre/ocupado da organização (padrão:
  liberado dentro do tenant). Se não vier, chamar uma vez por vendedor
  (`/users/{email}/calendar/getSchedule` com `schedules=[o próprio]`).

## B. Sala de vídeo criada por integração

Hoje: `POST /api/v1/card-tasks/{task_id}/daily-room` cria a sala e chama
`_agendar_evento_daily_no_outlook`, que manda o convite pelo Outlook **de
quem chama** (`current_user`). Sem conta Microsoft → desfaz a sala e devolve
400. O `integracao2` sempre cai aí.

Pedido: quando `current_user.is_integracao`:

- o evento é criado **na agenda do vendedor da tarefa**
  (`task.assigned_to`) com token de aplicativo:
  `POST /users/{email-do-vendedor}/events` — organizador = o vendedor;
- convidados = `task.invited_emails` (o lead). O vendedor não entra como
  convidado (é o organizador);
- `start` = `task.due_date`, `end` = `due_date + duration_minutes` —
  **explícito** (hoje `end_dt=None` vira 1 h);
- corpo do convite = o mesmo `_montar_corpo_convite`, com o link público;
- guardar `teams_event_id` como hoje (remarcar continua funcionando);
- falhou a criação do evento → mesmo comportamento de hoje: desfaz a sala e
  devolve erro (400/503), para o MarketingHS re-tentar;
- validar que a tarefa é de card que o `integracao2` criou ou recebeu dele
  não é necessário — ele é manager; mas a tarefa precisa ter
  `assigned_to_id` com e-mail, senão 422 com mensagem clara.

Usuário humano continua exatamente como hoje (token delegado).

## C. Vendedores, para integração

```
GET /api/v1/integration/vendedores
→ 200 [ { "id": 19, "nome": "Erick Santos", "email": "...", "ativo": true }, ... ]
```

Usuários com papel `salesperson` (e `ativo`). O MarketingHS usa para montar
a roleta na tela dele e para o e-mail que avisa o vendedor da reunião.

## Permissão na Microsoft (o Erick faz, uma vez)

Recomendação da Microsoft desde 2025: **RBAC para aplicativos no Exchange
Online** (substitui a Application Access Policy). Ele dá a permissão **já
restrita** às caixas escolhidas.

⚠️ **Não** adicionar `Calendars.ReadWrite` *de aplicativo* no Entra ID
(Registros de aplicativo → Permissões de API). Lá ela vale para **todas** as
caixas do tenant, e a restrição do Exchange deixa de valer (as duas se
somam). As permissões **delegadas** que o app já tem (login dos vendedores)
continuam como estão.

1. **Grupo dos vendedores.** No Exchange admin center, criar um grupo de
   segurança habilitado para e-mail (ou lista de distribuição), por exemplo
   `agenda-vendedores@healthsafetytech.com`, com os vendedores da roleta
   como **membros diretos** (grupo dentro de grupo não conta).
2. **Ids do aplicativo.** No Entra ID → **Aplicativos empresariais** (não
   "Registros de aplicativo") → o app do GrowthHS: anotar **ID do
   aplicativo** e **ID do objeto**.
3. **PowerShell do Exchange** (`Connect-ExchangeOnline` com conta de admin):

   ```powershell
   New-ServicePrincipal -AppId <ID do aplicativo> -ObjectId <ID do objeto> -DisplayName "GrowthHS"

   $dn = (Get-Group agenda-vendedores).DistinguishedName
   New-ManagementScope -Name "Agenda dos vendedores" `
     -RecipientRestrictionFilter "MemberOfGroup -eq '$dn'"

   New-ManagementRoleAssignment -App <ID do objeto> `
     -Role "Application Calendars.ReadWrite" `
     -CustomResourceScope "Agenda dos vendedores"
   ```

4. **Conferir:**

   ```powershell
   Test-ServicePrincipalAuthorization -Identity "GrowthHS" -Resource <e-mail de um vendedor>
   # InScope = True
   Test-ServicePrincipalAuthorization -Identity "GrowthHS" -Resource <e-mail de quem NÃO é vendedor>
   # InScope = False
   ```

A mudança leva de 30 min a 2 h para valer nas chamadas reais (cache da
Microsoft); o `Test-` não espera.

Vendedor novo na roleta = entrar no grupo. Vendedor que sai = sair do grupo.

## Testes na homologação (cada um antes do próximo)

1. **Permissão:** os dois `Test-ServicePrincipalAuthorization` acima.
2. **A:** pedir a agenda do Erick (19) para amanhã e conferir com o Outlook
   dele — marcar um compromisso de teste e ver aparecer.
3. **B:** pelo `integracao2`, criar card (lista 28, vendedor 19) + tarefa de
   reunião com `invited_emails=["healthsafetyti+reuniao2@gmail.com"]` +
   `daily-room`; conferir: evento na agenda do Erick com ele como
   organizador, convite com o link público chegando no Gmail, sala abrindo.
4. **C:** a lista bate com os vendedores ativos da tela de usuários.
