# MarketingHS — Lote 8: Fechamento da travessia

> Documento-mãe do lote. Não tem tarefa: tem a decomposição, a ordem e o
> critério de fim. Cada sub-lote tem plano próprio.

**Objetivo:** terminar a reconstrução. Ao fim do lote 8, **nada do Lovable e
nada do Supabase sobra no MarketingHS** — nem function na pasta de
especificação, nem tela falando com o toco, nem pacote, nem script de terceiro.

**Critério de fim, mecânico** (spec, §10): `frontend/src/integrations/supabase/`
e `backend/supabase/` podem ser apagados **sem quebrar nada**.

**Spec:** `docs/superpowers/specs/2026-08-31-marketinghs-design.md`
**Lote anterior:** subprojeto A da captação pública (`2026-09-08-marketinghs-captacao-a-landing.md`)

---

## A regra que muda este lote

Dita pelo Erick em 10/09/2026:

> **Dependência de terceiro não bloqueia portar.** Conta Cloudflare, endpoint do
> GrowthHS, chave do Resend — nada disso impede reconstruir o código. Porta-se
> tudo agora, com a chamada ao provedor **parametrizada**; deixar funcional
> (credencial, conta, deploy) é a fase seguinte, com o sistema inteiro portado.

Consequência: o 5A **deixa de ser "bloqueado"** e vira o 8D, e o A/B deixa de
esperar a conta Cloudflare e vira o 8C. É a mesma regra que o HS.OS usou para as
travas de terceiro (spec, §9): *portar tudo menos a chamada ao provedor, deixando-a
parametrizada*.

E uma segunda decisão, do mesmo dia: **o `resend-config` é restaurado por
inteiro.** O lote 3C o portou menor de propósito (commit `ecca32d`). O Erick
escolheu restaurar.

---

## O que resta, medido em 10/09/2026

**11 functions** na pasta de especificação, **5 arquivos** importando o toco, e
os restos do Lovable fora das duas coisas.

| Sub-lote | O que entra | Origem | Plano |
|---|---|---|---|
| **8A** | Resend: `resend-config` restaurado inteiro, `resend-config-check`, `resend-webhook` (só fechar o portão) e o segredo de descadastro pela tela | ~930 linhas | `2026-09-10-marketinghs-lote-8a-resend.md` |
| **8B** | API de contato por chave: `contact-update`, `contact-status-update`, `contact-tags-sync` | ~480 linhas | `2026-09-10-marketinghs-lote-8b-api-de-contato.md` |
| **8C** | Teste A/B: `go`, `ab-events`, as três telas de Experiments, `lib/ab.ts`, `public/ab.js` | ~540 linhas + 3 telas | `2026-09-21-marketinghs-lote-8c-teste-ab.md` — portão fechado em 21/09 |
| **8D** | Handoff → GrowthHS: `handoff-to-nexus`, `nexus-config`, `get-nexus-stages`, o `NexusCard` | ~990 linhas | a escrever quando o 8C fechar |
| **8E** | Limpeza final: Lovable e dn.ia no `index.html`, `lovable-tagger` e `@supabase/supabase-js` no `package.json`, a marca da dn.ia no admin (item 26 do CONTINUAR), `integrations/supabase/`, `backend/supabase/` | — | por último |

### Por que esta ordem

- **8A primeiro** porque achou um defeito, não só uma function: a tela **não
  consegue gravar o `UNSUBSCRIBE_SECRET`**, e sem ele o worker não consome a
  fila (`worker.py:180-185`). Hoje não existe caminho pela interface para o
  sistema enviar um e-mail.
- **8B** é o menor e o mais parecido com o que já foi feito (rotas por chave em
  `/publico`, padrão do lote 1D e do 7). Fecha seis das onze functions junto com
  o 8A.
- **8C antes do 8D** porque o 8C é o que tira os 9 pontos do alias
  `const db = supabase as any` — o maior uso vivo do toco. O 8D tira só o
  `NexusCard`.
- **8E por último**, e só quando `grep -rln "integrations/supabase" frontend/src`
  devolver apenas o `LimiteDeErro.tsx` — que existe para capturar o erro do toco
  e sai junto com ele.

⚠️ **Os planos do 8C, 8D e 8E não estão escritos, de propósito.** A lição do
lote 5 foi que cada sub-lote ensina o seguinte ("o que o 5B ensinou, e vale
para o 5C"); escrever os cinco planos hoje congelaria o que o 8A e o 8B ainda
vão descobrir. O que cada um precisa saber antes de começar está abaixo.

---

## O que já se sabe dos sub-lotes sem plano

### 8C — Teste A/B

- As cinco tabelas existem no banco e estão **vazias**: `ab_tests`,
  `ab_config`, `ab_events`, `ab_assignments`, `ab_identities`, mais a função
  `ab_activate_test`. O sub-lote porta código, não migra dado.
- Quem fala com o toco: `useAbTests.tsx` e `useAbConfig.tsx` (pelo alias, 9
  pontos), `lib/ab.ts:67` (`supabase.functions.invoke("ab-events")`), e o
  `ExperimentsSetup.tsx`, que monta URL de function (`SUPABASE_FUNCTIONS`).
- `lib/abConfig.ts:9` crava `https://go.dnia.ai` como base padrão, e
  `public/ab.js` aponta para `dnmkt.dnia.ai` — domínio de outra empresa, mesma
  classe do link de anúncio que o subprojeto A pegou.
- O Worker do Cloudflare (`docs/ab-testing/cloudflare-worker.js`) é
  **configuração**, não código do repositório: pela regra acima, o `go` e o
  `ab-events` são portados como rotas do backend, e o domínio do Worker vira
  campo de `ab_config`.

### 8D — Handoff → GrowthHS

- O contrato do endpoint que falta no GrowthHS está escrito:
  `docs/contratos/2026-09-02-endpoint-card-comercial-growthhs.md`
  (`POST /integration/cards`, especificado, **não implementado** no
  `hsgrowth-sistema`).
- Pela regra acima, o handoff é construído **contra o contrato**, com URL base,
  chave, `board_id` e dono padrão em configuração. Funciona quando o GrowthHS
  implementar o endpoint.
- ⚠️ O contrato achou o buraco da idempotência: o card comercial não tem
  `external_source`/`external_id`. O handoff precisa mandar uma chave de
  idempotência mesmo que o GrowthHS ainda não a honre — senão um retry nosso
  cria dois cards para o mesmo lead.
- Existe `nexus_config` no banco; a `growthhs_config` que a spec prevê (§8.A)
  ainda não.
- `StatusDropdown.tsx:55` e `DetailSections.tsx:161` já tiveram a chamada ao
  `handoff-to-nexus` retirada (com comentário); o `NexusCard.tsx` ainda chama
  `nexus-config` e `get-nexus-stages` pelo toco. `Automations.tsx:38-40` tem as
  ações `create_in_nexus`, `move_stage_nexus`, `block_nexus`.

### 8E — Limpeza final

- `frontend/index.html:260-264` carrega o **rastreador do Lovable**
  (`lovableproject.com/.../tracker.js`) e as linhas 28 e 34 usam imagem de
  preview hospedada em `lovable.app`. O `<title>` é "dn.mkt".
- `frontend/package.json:47` `@supabase/supabase-js` e `:89` `lovable-tagger`
  (que nenhuma config do Vite usa mais).
- `frontend/src/integrations/supabase/types.ts` não tem **nenhum** importador.
- `SettingsPage.tsx:20` lê `VITE_SUPABASE_PROJECT_ID`.

---

## O portão, que vale para todo sub-lote

As quatro condições do `CLAUDE.md`, e o passo 3 agora é feito pelo próprio
Claude: **o Playwright alcança `127.0.0.1` nesta máquina**, e há uma conta admin
de trabalho (`claude.dev@example.com`, credencial em
`~/.config/marketinghs/claude-admin.env`, a apagar no fim da travessia).

```bash
# 1. a tela não fala mais com o Supabase
grep -rn "supabase" frontend/src/<a tela>
# 2. NINGUÉM MAIS chama a function — inclusive a documentação
grep -rn "<nome-da-function>" frontend/src frontend/public backend/app
# 3. a tela foi aberta e conferida no navegador
# 4. a tela ainda FAZ O QUE FAZIA — capacidade por capacidade contra a origem
git show <commit antes do porte>:<arquivo>
# só então
git rm -r backend/supabase/functions/<nome>
```

⚠️ **O 8A existe porque o passo 4 foi pulado no 3C.** A function tinha 568
linhas; o substituto nasceu com 50 e o portão não perguntou o que ficou para
trás. Ao fechar cada sub-lote, compare **com a function**, não com o plano.

---

## Placar esperado

| Ao fechar | Portadas | Descartadas | Restam |
|---|---|---|---|
| hoje | 36 | 7 | 11 |
| 8A | 39 | 7 | 8 |
| 8B | 42 | 7 | 5 |
| 8C | 44 | 7 | 3 |
| 8D | 47 | 7 | 0 |
| 8E ✅ | 47 | 7 | cumprido em 22/09/2026 — a pasta `backend/supabase/` não existe |

(Os dois números nunca se somam — regra do `CLAUDE.md`.)
