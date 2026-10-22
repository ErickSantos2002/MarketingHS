# Roteiro da prova de substituição do RD

Os 12 passos da spec (`docs/superpowers/specs/2026-10-21-prova-substituir-rd-design.md`,
§7), em produção, **só com e-mails nossos**. Cada passo diz o que fazer, o que
se espera ver e a consulta que prova. Cada linha vira ✅/❌ no
`docs/CONTINUAR-AQUI.md`.

Os scripts: `scripts/prova-rd/` (semear, receptor, conferir, limpeza), chamados
pelo `~/marketinghs-prova-rd.sh`. As consultas abaixo são **só leitura** e
estão todas no `conferir.sql` (`bash ~/marketinghs-prova-rd.sh conferir` roda
tudo de uma vez); avulsas, rodam também pelo perfil de leitura:
`~/projetos/bancos/.venv/bin/python -c "import bancos; print(bancos.consultar('marketinghs', '...'))"`.

**Identificadores fixos:** página `phoebus-prova` · formulário de cotação
`prova_cap_phoebus` (não `cap_phoebus` — spec 9.1) · formulário da ficha
`prova_ficha_phoebus` · tag `prova-rd` · consentimento versão
`provisoria-2026-10` · política `https://www.healthsafety.com.br/privacidade.cfm`.

**A lista.** Três e-mails nossos, que o Erick escolhe — chamados aqui de **E1**
(recebe também o aviso ao comercial), **E2** (entra pela página de teste) e
**E3** (o do descadastro). Todo e-mail da prova sai só para eles: as jornadas
nascem em **modo teste** (`journeys.allowed_emails`) e o aviso só vai para
endereço da lista.

---

## Antes (Erick, uma vez)

- [ ] **Merge e deploy.** As cinco branches da prova na `main`
  (`prova-captura`, `prova-jornadas`, `prova-landing`, `prova-telas`,
  `prova-roteiro`) e deploy de **api**, **worker** e **sistema** no EasyPanel.
  A migration 027 já está aplicada (21/10).
- [ ] **`PROVA_RECEPTOR_TESTE=true`** no ambiente da **API** (só nela; o worker
  não precisa). ⚠️ O `~/gerar-env-marketinghs-producao.sh` ainda não conhece a
  chave: acrescentar a linha no `.env` da API no painel e fazer deploy da API.
  Fora da prova ela fica `false` — o receptor e o `action` da página de teste
  respondem 404.
- [ ] **Serviço estático da página de teste.** Um serviço novo no EasyPanel
  servindo a pasta `prova-site/` do repositório (nginx estático), com
  **domínio próprio** — nunca o `marketinghs-sistema` nem um subdomínio dele
  (ver `prova-site/LEIAME.md`: o script do RD roda nessa página).
- [ ] **Chave de API de escrita** para o passo 9: Configurações → Chaves de
  API → nova, escopo **escrita**. Guardar a chave; ela vai no `curl` como
  `Authorization: Bearer`.
- [ ] **Semente:** `bash ~/marketinghs-prova-rd.sh semear <dominio-da-pagina-de-teste> E1,E2,E3`
  (opcional, 3º argumento: o número do botão de WhatsApp, só dígitos com DDI).
  No fim ele mostra o **token do site** e o **link da página de teste**
  (`https://<dominio>/site-teste.html?token=pub_…`). Esperar **1 minuto**: o
  CORS dos sites e a casca da landing têm cache de 60 s.
- [ ] **Receptor:** `bash ~/marketinghs-prova-rd.sh receptor` — aponta a
  entrega ao GrowthHS para o receptor de teste
  (`http://erick_marketinghs-api:8000/teste/growthhs`, `board_id = 1`) e
  guarda o valor de antes para a limpeza.
- [ ] **PDF da ficha:** Templates → Arquivos → subir o PDF da ficha técnica do
  Phoebus → "Link". Abrir o template **"Prova RD — Ficha técnica"** e trocar
  `{{LINK_DO_PDF}}` por esse link.
- [ ] **Conferência de tela (só leitura, sessão coordenadora):** editor da
  página (`/pages/phoebus-prova/edit`), `/p/phoebus-prova`, Sites, Números e
  o construtor das três jornadas — nos dois temas e larguras
  (`scripts/conferir-telas.mjs`). Ficou pendente das frentes porque o banco
  não tinha página nem jornada.

Prova de que o "Antes" está certo:

```sql
SELECT slug, status, config->'tags' AS tags, config->>'noindex' AS noindex
  FROM pages WHERE slug = 'phoebus-prova';                       -- active, ["prova-rd"], true
SELECT name, status, entry_config, reentry, allowed_emails
  FROM journeys WHERE name LIKE 'Prova RD — %' ORDER BY name;      -- 3 linhas, active, lista = E1,E2,E3
SELECT name, html LIKE '%{{LINK_DO_PDF}}%' AS falta_link
  FROM email_templates WHERE name LIKE 'Prova RD — %';            -- falta_link = f nas 4
SELECT nome, dominios, ativo FROM sites WHERE nome = 'Site de teste da prova';
SELECT base_url, board_id FROM growthhs_config;                   -- o receptor, 1
```

As jornadas que a semente monta (nenhuma por segmento):

| Jornada | Entra por (`form_submitted`) | Passos | Reentrada |
|---|---|---|---|
| Prova RD — Boas-vindas e nutrição | página `phoebus-prova` **ou** form `prova_cap_phoebus` | Boas-vindas → 10 min → Nutrição 1 → 10 min → Nutrição 2 | `once` |
| Prova RD — Ficha técnica | form `prova_ficha_phoebus` | Ficha técnica (link do PDF) | `allowed`, 1 h |
| Prova RD — Aviso ao comercial | página `phoebus-prova` **ou** os dois forms | aviso por e-mail para E1 → card no GrowthHS | `allowed`, 1 h |

---

## Os 12 passos

### - [ ] 1. A visita aparece nos números da página

**Fazer:** abrir, numa janela anônima,
`https://marketinghs.healthsafetytech.com/p/phoebus-prova?utm_source=prova&utm_medium=teste&utm_campaign=prova-rd`.
Anotar quantas vezes abriu (para o passo 11).

**Esperar:** a landing nova (corpo, formulário com Nome, E-mail, Celular,
Empresa, "Já faz testagem na sua empresa?", caixa de consentimento com o
link da política). Em Páginas → Números, `phoebus-prova` com 1 visita e 1
visitante. O código-fonte da página tem `noindex`.

```sql
SELECT count(*) AS visitas, count(DISTINCT visitor_id) AS visitantes, max(criado_em)
  FROM visitas WHERE page_slug = 'phoebus-prova' AND criado_em >= current_date;
```

### - [ ] 2. Consentimento: sem ele, recusa; com ele, lead completo

**Fazer:** preencher com **E1** e **não** marcar o consentimento → enviar.
Depois marcar → enviar. Testar também um celular digitado "torto"
(`(31) 99999-9999`).

**Esperar:** sem a caixa, a página recusa (mensagem no campo) e **nenhum lead
é criado**. Com a caixa, a mensagem de obrigado na própria página; o lead
existe com as UTMs da URL, `whatsapp` normalizado (`+5531999999999`),
`campos_extras.ja_faz_testagem`, as tags `prova-rd` e `phoebus-prova`, e um
consentimento com texto, versão `provisoria-2026-10`, `provisoria = t` e IP.

```sql
SELECT l.email, l.whatsapp, l.empresa, l.campos_extras, l.utm_source, l.utm_medium,
       l.utm_campaign, array(SELECT t.name FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id
                              WHERE lt.lead_id = l.id) AS tags, l.created_at
  FROM leads l
 WHERE EXISTS (SELECT 1 FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id
                WHERE lt.lead_id = l.id AND t.name = 'prova-rd');
SELECT l.email, c.base_legal, c.versao, c.provisoria, c.ip, c.origem_tipo, c.page_slug,
       left(c.texto, 60) AS texto, c.criado_em
  FROM lead_consents c JOIN leads l ON l.id = c.lead_id
 ORDER BY c.criado_em DESC LIMIT 10;
```

### - [ ] 3. Boas-vindas, e depois as duas nutrições no intervalo

**Fazer:** esperar na caixa de **E1**.

**Esperar:** "Recebemos o seu pedido, <nome>" em até ~1 min; "Por que testar a
equipe?" ~10 min depois; "Testagem na rotina" ~10 min depois dessa. Cada um
com o rodapé de descadastro.

```sql
SELECT l.email, j.name AS jornada, cs.journey_node_id AS no, cs.status, cs.error,
       cs.created_at, cs.sent_at, cs.opened_at
  FROM campaign_sends cs
  JOIN journey_runs r ON r.id = cs.journey_run_id
  JOIN journeys j ON j.id = r.journey_id
  JOIN leads l ON l.id = cs.lead_id
 WHERE j.name LIKE 'Prova RD — %'
 ORDER BY cs.created_at;                              -- bv, n1, n2 com status sent
SELECT l.email, j.name, r.state, r.current_node_id, r.wakeup_at
  FROM journey_runs r JOIN journeys j ON j.id = r.journey_id JOIN leads l ON l.id = r.lead_id
 WHERE j.name LIKE 'Prova RD — %' ORDER BY r.entered_at;
```

### - [ ] 4. O aviso interno com os dados do lead

**Fazer:** olhar a caixa de **E1** (é o destinatário do aviso).

**Esperar:** "[Prova RD] Lead novo do Phoebus" com nome, e-mail, celular,
empresa, página/formulário, a resposta do "já faz testagem" e o link para a
ficha do contato (`/contacts?contato=<id>`), que abre a ficha.

```sql
SELECT l.email AS contato, s.destino, s.status, s.tentativas, s.erro,
       s.payload->'enviados' AS enviados, s.payload->'pulados' AS pulados, s.enviado_em
  FROM journey_saidas s LEFT JOIN leads l ON l.id = s.lead_id
 WHERE s.tipo = 'aviso_email' ORDER BY s.criado_em;      -- enviado, enviados = [E1]
```

### - [ ] 5. O card chega ao GrowthHS — **receptor de teste; GrowthHS: pendente do endpoint**

O `POST /api/v1/integration/cards` ainda não existe no `hsgrowth-sistema`. A
fila real (`crm_handoffs`) entrega ao receptor nosso, que valida o corpo pelo
contrato e guarda o pedido.

**Fazer:** nada — a jornada de aviso já pediu o card. Conferir na ficha de E1
a linha do tempo da entrega; ou `GET /api/teste/growthhs/pedidos` (admin).

**Esperar:** `crm_handoffs` `entregue` com `card_id`; o pedido no receptor
com `title`, `contact.email`, `custom_fields.ja_faz_testagem`, `conversion`
(`page_slug = phoebus-prova`, canal) e `consent` (`version =
provisoria-2026-10`).

```sql
SELECT l.email, h.origem, h.status, h.tentativas, h.erro, h.card_id, h.criado_em
  FROM crm_handoffs h JOIN leads l ON l.id = h.lead_id
 WHERE h.criado_em >= current_date ORDER BY h.criado_em;
SELECT external_id, corpo->>'title' AS titulo, corpo#>>'{contact,email}' AS email,
       corpo->'custom_fields' AS custom_fields, corpo->'conversion' AS conversao,
       corpo#>>'{consent,version}' AS versao, vezes, recebido_em
  FROM growthhs_receptor_pedidos ORDER BY recebido_em;
```

### - [ ] 6. A ficha técnica chega com o PDF que abre

**Fazer:** abrir o **link da página de teste** (o que o `semear` mostrou) e
enviar o formulário **"Ficha técnica"** (`prova_ficha_phoebus`) com **E1**.

**Esperar:** o envio original acontece (o `action` vai para
`/api/publico/prova/recebido`, que responde). Chega "A ficha técnica do
Phoebus" com o botão; o PDF **abre/baixa** (`Content-Disposition:
attachment`). Uma conversão nova de E1 com `form_id = prova_ficha_phoebus`.
O aviso **não** se repete para E1 nesta hora (reentrada de 1 h).

```sql
SELECT l.email, cs.journey_node_id, cs.status, cs.error, cs.sent_at
  FROM campaign_sends cs JOIN journey_runs r ON r.id = cs.journey_run_id
  JOIN journeys j ON j.id = r.journey_id JOIN leads l ON l.id = cs.lead_id
 WHERE j.name = 'Prova RD — Ficha técnica';               -- ficha, sent
SELECT name, html LIKE '%{{LINK_DO_PDF}}%' AS falta_link
  FROM email_templates WHERE name = 'Prova RD — Ficha técnica';  -- f
```

### - [ ] 7. Formulário de outro site: envio original intacto e lead aqui

**Fazer:** na página de teste, enviar o formulário de **cotação**
(`prova_cap_phoebus`, campos `pnome`/`pemail`/`pwhatsapp`/`pmensagem`) com
**E2**. Abrir com `&debug=true` no fim do link para ver o log do
`rastreio.js` no console.

**Esperar:** o envio original acontece normalmente (a resposta do
`/api/publico/prova/recebido` aparece). O lead E2 aparece aqui com
`form_id = prova_cap_phoebus` (**não** `cap_phoebus` — spec 9.1), o site
"Site de teste da prova", a URL da página, o canal, a tag `prova-rd`, e um
consentimento `legitimo_interesse_pedido_contato`. Dispara a mesma jornada de
boas-vindas (E2 recebe o Boas-vindas) e o aviso para E1. Efeito no RD: um lead
com e-mail nosso e um formulário novo na lista — nada roteado à agência.

```sql
SELECT l.email, lc.converted_at, lc.page_slug, lc.form_id, s.nome AS site,
       lc.page_url, lc.page_path, lc.canal
  FROM lead_conversions lc JOIN leads l ON l.id = lc.lead_id
  LEFT JOIN sites s ON s.id = lc.site_id
 WHERE lc.converted_at >= current_date ORDER BY lc.converted_at;
SELECT l.email, j.name, r.context->>'form_id' AS form_id, r.state
  FROM journey_runs r JOIN journeys j ON j.id = r.journey_id JOIN leads l ON l.id = r.lead_id
 WHERE j.name LIKE 'Prova RD — %' AND l.email ILIKE '<E2>';
```

### - [ ] 8. O mesmo e-mail de novo: não duplica, não sobrescreve, conta conversão

**Fazer:** repetir o formulário de cotação da página de teste com **E2**, com
outro nome e outra mensagem.

**Esperar:** continua **um** lead E2, com o nome da primeira vez; **duas**
conversões de E2. Boas-vindas não reenvia (`once`); o aviso não se repete
dentro de 1 h.

```sql
SELECT lower(email) AS email, count(*) AS leads
  FROM leads WHERE deleted_at IS NULL AND lower(email) IN ('<e1>', '<e2>', '<e3>')
 GROUP BY 1;                                           -- 1 cada
SELECT l.email, l.nome, count(lc.id) AS conversoes
  FROM leads l LEFT JOIN lead_conversions lc ON lc.lead_id = l.id
 WHERE lower(l.email) = '<e2>' GROUP BY l.email, l.nome;     -- nome da 1ª vez, 2 conversões
```

### - [ ] 9. Volta do CRM: "reunião agendada" e "venda fechada" mudam o estágio

**Fazer** (no Konsole; a chave é a de escrita criada no "Antes" — `read -s`
não a mostra na tela nem no histórico):

```bash
read -rs CHAVE   # cole a chave de API de escrita e Enter
curl -sS -X POST https://marketinghs.healthsafetytech.com/api/publico/evento-de-contato \
  -H "Authorization: Bearer $CHAVE" -H 'Content-Type: application/json' \
  -d '{"source_app":"growthhs","event_type":"meeting_scheduled","title":"Reunião agendada no GrowthHS","email":"<E1>","metadata":{"card_id":1}}'
curl -sS -X POST https://marketinghs.healthsafetytech.com/api/publico/evento-de-contato \
  -H "Authorization: Bearer $CHAVE" -H 'Content-Type: application/json' \
  -d '{"source_app":"growthhs","event_type":"deal_won","title":"Venda fechada no GrowthHS","email":"<E1>","metadata":{"card_id":1}}'
unset CHAVE
```

**Esperar:** a primeira responde `200` com `status_atual: "MQL - Reunião
agendada"`, `mudou: true`; a segunda, `"Venda realizada"`, `mudou: true`.
Repetir a primeira depois da segunda responde `mudou: false` (só avança).

```sql
SELECT l.email, l.status FROM leads l WHERE lower(l.email) = '<e1>';   -- Venda realizada
SELECT ce.event_type, ce.source_app, ce.metadata->>'status_atual' AS status_atual,
       ce.metadata->>'source' AS source, ce.occurred_at
  FROM contact_events ce JOIN leads l ON l.id = ce.lead_id
 WHERE lower(l.email) = '<e1>' AND (ce.source_app = 'growthhs' OR ce.metadata->>'source' = 'crm')
 ORDER BY ce.occurred_at;
```

### - [ ] 10. Descadastro para a nutrição

**Fazer:** converter na landing com **E3** (consentimento marcado). Quando
chegar o Boas-vindas de E3, clicar em "Não quero mais receber estes e-mails".

**Esperar:** a página de descadastro confirma. E3 entra em
`email_suppressions`; a Nutrição 1 e a Nutrição 2 de E3 ficam
`suppressed` — não chegam.

```sql
SELECT email, reason, source, created_at FROM email_suppressions
 WHERE lower(email) = '<e3>';                                  -- unsubscribe
SELECT cs.journey_node_id, cs.status, cs.error
  FROM campaign_sends cs JOIN leads l ON l.id = cs.lead_id
 WHERE lower(l.email) = '<e3>' ORDER BY cs.created_at;       -- bv sent; n1, n2 suppressed
```

### - [ ] 11. Números: visitas, conversões e taxa batem com o que foi feito

**Fazer:** Páginas → Números (hoje). Comparar com o que se fez: as visitas
abertas na landing (passos 1, 2 e 10), as conversões da landing (E1 no passo
2, E3 no passo 10 — o envio recusado não conta), e no site de teste as
conversões de `prova_cap_phoebus` (2, passos 7 e 8) e de
`prova_ficha_phoebus` (1, passo 6).

**Esperar:** a tela e a consulta dão o mesmo; taxa = conversões ÷ visitantes
únicos. Os leads da prova **entram** na conta (spec 9.4) até a limpeza.

```sql
WITH v AS (SELECT visitor_id FROM visitas
            WHERE page_slug = 'phoebus-prova' AND criado_em >= current_date),
     c AS (SELECT 1 FROM lead_conversions lc JOIN leads l ON l.id = lc.lead_id
            WHERE l.deleted_at IS NULL AND lc.page_slug = 'phoebus-prova'
              AND lc.converted_at >= current_date)
SELECT (SELECT count(*) FROM v) AS visitas,
       (SELECT count(DISTINCT visitor_id) FROM v) AS visitantes,
       (SELECT count(*) FROM c) AS conversoes;
SELECT lc.form_id, count(*) AS conversoes
  FROM lead_conversions lc JOIN sites s ON s.id = lc.site_id
 WHERE s.nome = 'Site de teste da prova' AND lc.converted_at >= current_date
 GROUP BY lc.form_id;
```

(`current_date` é o dia do servidor, em UTC; o `conferir.sql` usa 0h de
Brasília, como a tela.)

### - [ ] 12. Antimeta conferida e limpeza

**Fazer:**
1. `bash ~/marketinghs-prova-rd.sh conferir` — o bloco **"Passo 12:
   ANTIMETA"** tem que dar **0 linhas**: nenhum e-mail (campanha ou
   jornada), nenhum aviso e nenhum card do dia para endereço fora da lista.
2. `bash ~/marketinghs-prova-rd.sh limpar` (pede para digitar `LIMPAR`).
3. `bash ~/marketinghs-prova-rd.sh conferir E1,E2,E3` de novo.

**Esperar:** depois da limpeza, os leads da prova com `excluido = t` (contato
que já existia antes da prova e converteu nela **não** é excluído — a limpeza
lista quem é, para decidir na tela); as 3 jornadas `archived` com 0 runs
abertos; a página `inactive`; o site desligado; `growthhs_config` como era
antes do `receptor` (hoje: sem linha) e a `GROWTHHS_API_KEY` que a prova criou,
removida. O `conferir` depois do `limpar` roda sem erro.

A antimeta, avulsa (lista lida das jornadas da prova):

```sql
WITH lista AS (SELECT DISTINCT lower(btrim(e)) AS e
                 FROM journeys j, unnest(j.allowed_emails) e
                WHERE j.name LIKE 'Prova RD — %')
SELECT 'campaign_sends' AS origem, lower(btrim(l.email)) AS destinatario, cs.status, cs.created_at
  FROM campaign_sends cs JOIN leads l ON l.id = cs.lead_id
 WHERE cs.created_at >= current_date AND cs.status NOT IN ('failed', 'suppressed')
   AND lower(btrim(l.email)) NOT IN (SELECT e FROM lista)
UNION ALL
SELECT 'journey_saidas', lower(btrim(x)), s.status, s.criado_em
  FROM journey_saidas s, jsonb_array_elements_text(coalesce(s.payload->'enviados', '[]'::jsonb)) x
 WHERE s.tipo = 'aviso_email' AND s.criado_em >= current_date
   AND lower(btrim(x)) NOT IN (SELECT e FROM lista);       -- 0 linhas
```

---

## Depois

- [ ] `PROVA_RECEPTOR_TESTE=false` no ambiente da API e deploy (o receptor e o
  `action` da página de teste voltam a 404).
- [ ] Desligar o serviço estático da página de teste no EasyPanel (o site já
  está `ativo = false`: a API recusa o domínio).
- [ ] A chave de API de escrita do passo 9: revogar em Configurações → Chaves
  de API, se não for virar a do GrowthHS.
- [ ] Resultado ✅/❌ por passo no `docs/CONTINUAR-AQUI.md`, com o que falhou.

Rodar o `semear` de novo depois da limpeza reativa página, site e jornadas
(mesmo token, templates intactos) — serve para repetir a prova.
