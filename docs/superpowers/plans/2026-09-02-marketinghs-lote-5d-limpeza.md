# MarketingHS — Lote 5D: Limpeza — Plano

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — `superpowers:executing-plans`.
> Os passos usam caixa (`- [ ]`).

**Objetivo:** tirar as sobras pequenas e espalhadas que prendem **Contatos,
Segmentos, Campanhas e o construtor de fluxo** ao toco do Supabase, para que o
trabalho de visual possa começar por essas telas enquanto os lotes 6 e 7 seguem.

**Arquitetura:** nada de novo. Cinco trocas de ponto de acesso, uma exclusão, e
uma decisão de armazenamento que ficou pendurada desde a origem.

**Stack:** FastAPI, asyncpg, React 18

**Spec:** `docs/superpowers/specs/2026-08-31-marketinghs-design.md`
**Lote anterior:** `docs/superpowers/plans/2026-09-02-marketinghs-lote-5b-datacore.md`

---

## Por que este lote existe

Medido em 02/09/2026, seguindo os imports de cada página até o fim:

| Tela | O que a prende |
|---|---|
| Contatos | `useLeadStatuses` · `ContactsTable` |
| Segmentos | `useLeadStatuses` |
| Campanhas | `emailEditorConfig` · `useSocialLinks` |
| Construtor de fluxo | `emailEditorConfig` · `SendTestEmailPopover` |
| Configurações | `PingbackCard` (+ `NexusCard` do 5A, `MetaCard` do 5C) |

São **onze pontos em seis arquivos**. Nenhum deles é lote grande; são restos que
nunca tiveram dono porque não pertenciam ao domínio de nenhum lote anterior.

⚠️ **Configurações NÃO fica limpa neste lote** — `NexusCard` é do 5A (bloqueado)
e `MetaCard` é do 5C. O 5D tira só o `PingbackCard`, que não é portagem: a spec
manda **descartar** o Pingback.

---

## Restrições globais

- **`sessao()` é o único caminho para dado.**
- **`role="service_role"` + autorização explícita na rota.**
- **O portão tem TRÊS partes**, e a documentação conta.
- **Comentário e nome de módulo em português.**
- ⚠️ **Laço dentro de `sessao()` precisa de SAVEPOINT.**

---

## Tarefa 1: O Pingback sai inteiro

O caminho mais barato do lote, e o único que **remove** em vez de portar.

**Arquivos:**
- Apaga: `frontend/src/components/admin/settings/PingbackCard.tsx`,
  `frontend/src/lib/metaTracking.ts` (se só o Pingback o usar),
  `backend/supabase/functions/send-to-pingback{,-convidado,-modal,-paid}`,
  `backend/supabase/functions/pingback-config`,
  `backend/supabase/functions/send-to-ticketia`
- Modifica: `frontend/src/pages/admin/SettingsPage.tsx`

- [ ] **Passo 1: confirme que a spec manda descartar**

`docs/superpowers/specs/2026-08-31-marketinghs-design.md`, seção 9, tabela de
travas de terceiro: *"Nexus, Ticketia, Pingback | 6 functions | **Descartadas**"*.
Pingback é o rastreador da dn.ia e Ticketia o sistema de ingresso dela — nenhum
dos dois tem equivalente na HS.

- [ ] **Passo 2: veja quem mais chama**

```bash
grep -rn "pingback\|Pingback\|ticketia" frontend/src backend/app --include=*.ts --include=*.tsx --include=*.py
```

⚠️ Se alguma tela de captura ainda chamar `send-to-pingback*`, ela é do lote 7 —
**pare e registre**, não apague o consumidor junto.

- [ ] **Passo 3: apague o card e o registro dele no SettingsPage**

- [ ] **Passo 4: apague as seis functions**

```bash
git rm -r backend/supabase/functions/send-to-pingback \
          backend/supabase/functions/send-to-pingback-convidado \
          backend/supabase/functions/send-to-pingback-modal \
          backend/supabase/functions/send-to-pingback-paid \
          backend/supabase/functions/pingback-config \
          backend/supabase/functions/send-to-ticketia
```

- [ ] **Passo 5: a documentação.** Confira que nenhuma delas está ensinada na
  tela de Documentação da API nem no `dnmarketing-api.yaml`. Já mordeu quatro
  vezes neste projeto.

- [ ] **Passo 6: abra Configurações no navegador** e confirme que a tela monta
  sem o card.

- [ ] **Passo 7: commit**

---

## Tarefa 2: `lead_statuses` pela API

Prende **duas** telas (Contatos e Segmentos) com um ponto só — o melhor
custo-benefício do lote.

**Arquivos:**
- Modifica: `backend/app/routers/configuracao.py`,
  `frontend/src/lib/contatos.ts`, `frontend/src/hooks/useLeadStatuses.ts`

**Interfaces:**
- Produz: `GET /lead-statuses` → `[{id, name, color, sort_order, is_system}]`

- [ ] **Passo 1: a rota**, ao lado de `/tipos-de-contato`, que é o molde:

```python
@router.get("/lead-statuses")
async def listar_status_de_lead(_: Usuario = Depends(usuario_atual)):
    """O funil, na ordem em que a tela desenha.

    ⚠️ `leads.status` é FK para `lead_statuses(name)`. Quem inventar um status
    novo no cliente toma erro de integridade do banco — o que é o certo.
    """
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            """SELECT id::text, name, color, sort_order, is_system
                 FROM lead_statuses ORDER BY sort_order, name""")
    return [dict(l) for l in linhas]
```

- [ ] **Passo 2: o cliente**, em `lib/contatos.ts`:

```ts
export interface StatusDeLead {
  id: string; name: string; color: string;
  sort_order: number; is_system: boolean;
}
export const listarStatusDeLead = () => api.get<StatusDeLead[]>('/lead-statuses');
```

- [ ] **Passo 3: o hook.** `useLeadStatuses` mantém a assinatura
  (`{ statuses, options, colors, getColor, isLoading }`) — quem consome não muda.
  Troque só o `queryFn` por `listarStatusDeLead`.

- [ ] **Passo 4: confira no navegador.** Abra Contatos e mude o status de um
  contato pelo dropdown: as cores e a ordem têm de vir iguais.

- [ ] **Passo 5: commit**

---

## Tarefa 3: A exclusão de contato usa a rota que já existe

**O endpoint já foi escrito no lote 1C** — `DELETE /contatos/{lead_id}` em
`app/routers/escrita_contatos.py:362`. A `ContactsTable` simplesmente nunca foi
apontada para ele e continuou chamando `delete-contact`.

**Arquivos:**
- Modifica: `frontend/src/components/admin/contacts/ContactsTable.tsx`
- Apaga: `backend/supabase/functions/delete-contact` (se ficar órfã)

- [ ] **Passo 1: veja o que `lib/contatos.ts` já expõe** para exclusão. Se
  houver função, use-a; se não, escreva-a no molde das outras.

- [ ] **Passo 2: troque o `supabase.functions.invoke('delete-contact', ...)`**
  (linha ~469) pela chamada da API. ⚠️ A tela hoje lê `data?.error` do corpo; com
  o `ErroApi` a mensagem vem em `e.message` — mostre a mensagem do servidor, não
  um genérico.

- [ ] **Passo 3: `grep -rn "delete-contact" frontend/src`** — se ninguém mais
  chamar, `git rm -r backend/supabase/functions/delete-contact`.

- [ ] **Passo 4: confira no navegador excluindo um contato de teste** que você
  mesmo criou. ⚠️ A exclusão é lógica (`deleted_at`), então confira que ele some
  da lista e continua no banco.

- [ ] **Passo 5: commit**

---

## Tarefa 4: As redes sociais da marca

**Arquivos:**
- Modifica: `backend/app/routers/configuracao.py`,
  `frontend/src/lib/config.ts`, `frontend/src/hooks/useSocialLinks.tsx`

**Interfaces:**
- Produz: `GET /config/redes-sociais`, `PUT /config/redes-sociais`

⚠️ **Não reuse `/preferencias/{chave}`.** Aquela rota compõe a chave com o id de
quem está autenticado, de propósito — é preferência POR USUÁRIO. Rede social da
marca é global; passar por lá guardaria uma config diferente para cada admin e
o rodapé do e-mail mudaria conforme quem editou por último.

- [ ] **Passo 1: as rotas.** Leitura em `usuario_atual` (o editor de e-mail
  precisa), escrita em `admin_atual` (é config de marca).

- [ ] **Passo 2: o cliente e o hook**, mantendo a assinatura do hook.

- [ ] **Passo 3: confira no navegador** — abra o editor de e-mail e veja os
  ícones de rede social aparecerem no rodapé.

- [ ] **Passo 4: commit**

---

## Tarefa 5: O envio de teste

**Arquivos:**
- Modifica: `backend/app/routers/envio.py`,
  `frontend/src/lib/campanhas.ts`,
  `frontend/src/components/admin/campaigns/SendTestEmailPopover.tsx`
- Apaga: `backend/supabase/functions/send-test-email` (se ficar órfã)

**Interfaces:**
- Produz: `POST /envio/teste` `{template_id, to}` → `{enviado: bool, motivo?: str}`

- [ ] **Passo 1: leia `send-test-email/index.ts` ANTES de escrever.** Função
  herdada se copia, não se lembra — foi assim que o lote 3B quase perdeu o HMAC
  do descadastro.

- [ ] **Passo 2: a rota**, reusando a montagem por destinatário que o 3B já
  escreveu. ⚠️ Sem `RESEND_API_KEY` ela responde **503 com motivo**, não 500: o
  envio real está adiado por decisão, e isso não é defeito.

- [ ] **Passo 3: o popover.** ⚠️ O comentário no arquivo explica por que ele NÃO
  reusa `validateEmailFormat` (o destinatário de teste pode ser um endereço
  temporário, de propósito). Preserve isso.

- [ ] **Passo 4: confira no navegador**, abrindo o preview de um template e
  clicando em "Enviar teste". Sem chave do Resend, o esperado é a mensagem
  explicando — não um erro genérico.

- [ ] **Passo 5: commit**

---

## Tarefa 6: O upload de imagem do editor de e-mail

⚠️ **A maior das seis, e a única que não é troca de ponto: é decisão.**

`emailEditorConfig.ts` sobe imagem para `supabase.storage.from('email-assets')`.
Não há Supabase, então **hoje todo upload de imagem no editor falha** — a tela
mostra "Erro ao fazer upload da imagem" e segue.

**A imagem precisa de URL pública**: ela vai dentro de um e-mail que chega na
caixa de outra pessoa, e o cliente de e-mail busca a imagem de fora.

- [ ] **Passo 1: escolha o armazenamento.** A recomendação é **guardar no
  Postgres** (`email_assets(id, nome, tipo, bytes, criado_em)`) e servir por uma
  rota pública `GET /publico/imagem/{id}`:
  - não exige decisão de infraestrutura do Erick (volume, bucket, S3);
  - é autocontido — backup do banco leva as imagens junto;
  - imagem de e-mail é pequena e são poucas.

  ⚠️ **Se um dia forem muitas**, isto vira migração; anote a troca no ROADMAP em
  vez de deixar a decisão implícita.

- [ ] **Passo 2: a migration** com a tabela e o `GRANT` para `service_role`.

- [ ] **Passo 3: a rota de upload** (`POST /imagens`, admin) e a **pública de
  leitura**. ⚠️ A pública serve bytes sem autenticação — limite tipo
  (`image/png|jpeg|gif|webp`) e tamanho, e devolva `Content-Type` correto e
  `Cache-Control` longo.

- [ ] **Passo 4: troque o callback do Unlayer** para a rota nova.

- [ ] **Passo 5: confira no navegador** subindo uma imagem no editor de e-mail e
  vendo-a aparecer no corpo. Depois **abra a URL da imagem numa aba anônima** —
  se ela exigir login, o e-mail chega quebrado para quem recebe.

- [ ] **Passo 6: commit**

---

## Tarefa 7: Fechar

- [ ] **Passo 1: o portão, as três partes**, documentação incluída.
- [ ] **Passo 2: o placar**, com o comando canônico do `CLAUDE.md`.
- [ ] **Passo 3: prove o objetivo do lote.** Rode a análise por tela e confirme
  que **Contatos, Segmentos, Campanhas e o construtor de fluxo** não têm mais
  nenhum caminho até o toco.
- [ ] **Passo 4: `ROADMAP.md` e `CONTINUAR-AQUI.md`.**
- [ ] **Passo 5: commit**

---

## Definição de pronto

- [ ] Contatos, Segmentos, Campanhas e o construtor de fluxo: **zero** caminhos
      até `integrations/supabase/client.ts`
- [ ] O dropdown de status mostra as mesmas cores e a mesma ordem de antes
- [ ] Excluir contato pela tabela funciona, e a exclusão continua lógica
- [ ] O editor de e-mail sobe imagem, e a imagem abre sem login
- [ ] "Enviar teste" explica a falta da chave do Resend em vez de erro genérico
- [ ] Pelo menos 7 functions saíram da pasta (6 do Pingback/Ticketia + as órfãs)
- [ ] `pytest` continua passando

## O que fica fora

- **`NexusCard`** (lote 5A, bloqueado) e **`MetaCard`** (5C) — Configurações só
  fica limpa quando esses dois entrarem.
- **Visão Geral e Analytics** — `useGoalSettings`, `useDashboardCardSettings`,
  `useAgendamentos`, `useAIChat`. São do lote 6, que **reescreve essas telas por
  dentro**: portar agora seria trabalho jogado fora.
- **`useClarity`** — a spec manda decidir entre projeto próprio e remover; é
  decisão, não limpeza.
