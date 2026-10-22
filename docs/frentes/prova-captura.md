# Frente `prova-captura`

Plano: `docs/superpowers/plans/2026-10-21-prova-substituir-rd.md` — Tarefas
1 (Fase 0) e 2–6 (Fase 1). Território: linha `prova-captura` da seção
"Frentes" do plano. n 17 · Vite 8097 · backend 8117. Branch `prova-captura`.

## Estado
- [x] Fase 0 — Tarefa 1 (migration 027 + `~/marketinghs-migration-027.sh`) — **pronto para merge** (21/10)
- [x] Fase 0 mergeada na `main` (`b80b9de`)
- [x] Migration 027 aplicada em produção pelo Erick (21/10) — conferido
  `to_regclass('public.journey_saidas')` e `lead_consents` pelo perfil de
  leitura; os testes da Fase 1 rodaram de verdade, sem pular
- [x] Fase 1 — Tarefas 2–6 (branch `prova-captura-f1`) — ver "Fase 1" abaixo

**Para o Erick, depois do merge:** `bash ~/marketinghs-migration-027.sh`
(aditiva; pode ir antes de qualquer deploy). Aplica duas vezes e imprime três
`true`. Sem ela, os 18 testes de banco de `test_migracao_027.py` pulam.

## Tarefa 1 — migration 027

Arquivos: `backend/migrations/027_prova_substituir_rd.sql`,
`backend/tests/test_migracao_027.py`, `~/marketinghs-migration-027.sh` (fora
do repositório, molde da 026).

**Prova local (21/10).** Postgres 17.11 descartável em container
(`docker run --rm`, porta 55427, papel `marketinghs_app` criado antes),
`000`…`027` em ordem num banco vazio e a `027` de novo: **as duas aplicações
passaram sem erro** (a segunda só com os NOTICE de "already exists,
skipping"). Feito em dois containers do zero — o segundo com o arquivo final.
As três provas do script deram `true` no local. Container derrubado no fim.

**Testes.**
- `test_migracao_027.py` no Postgres local com a 027: **19 passed**; junto
  com `test_r5_jornadas.py` (a 026, cujas funções a 027 recria): **38 passed**.
- No banco de produção (sem a 027): **1 passed, 18 skipped** com o motivo
  "migration 027 ainda não aplicada neste banco".
- Suíte inteira no local, com e sem a 027 (dois containers, 000…026 contra
  000…027): **o mesmo conjunto de 21 falhas** nos dois — são do banco vazio
  (sem admin, sem dado, limite de taxa), não da 027 — e com a 027 passam 18 a
  mais (os pulados). Nenhuma regressão das funções recriadas.
- Suíte inteira no banco de produção: ver "Portão" abaixo.

**Decisões tomadas (a mais segura e reversível):**
1. `form_ids` que **não é lista** (texto, objeto) conta como filtro que não
   casa com nada — um erro de forma não vira "qualquer origem". Lista vazia
   (`[]`) = sem filtro de formulário.
2. `campo_extra` sem `value` vale como texto vazio: `quote_literal(NULL)` é
   NULL, e condição NULL é **descartada** pelo `evaluate_rules_for_lead` — a
   regra sumiria do AND e alargaria o público. Operador desconhecido e chave
   fora do padrão viram `FALSE` (inclusive em `is_not`).
3. `webhook` exige `https://` **com host** (`https://` sozinho é recusado).
4. `journey_saidas` sem FK para `journey_runs`/`leads`, como o plano descreve
   (a saída é registro de envio; o (run, nó) único é a garantia).
5. `growthhs_receptor_pedidos` tem RLS ligado e **nenhuma** política: só o
   `service_role` (BYPASSRLS) lê e grava.
6. GRANT a `authenticated` exatamente como o plano: ALL em `sites`, SELECT em
   `lead_consents` e `visitas`. `journey_saidas` tem a política de SELECT do
   admin mas **não** tem GRANT a `authenticated` — se a Tarefa 15 precisar ler
   a caixa de saída sob `authenticated`, o GRANT entra numa migration nova.

## Perguntas / fora do território
- **Para a Tarefa 3 (coordenadora, 21/10):** ao salvar/servir `pages.config`,
  recusar `consentimento.link`, `imagem_url` e `redirect_url` que não sejam
  `http(s)` (ou caminho relativo `/publico/...`) — revisão de segurança achou
  `javascript:` possível no href do consentimento. O front já filtra (frente
  `prova-landing`); o servidor é a segunda linha.
- **Para as Tarefas 2–3 (vindo da `prova-landing`, 21/10):** o servidor
  descarta o que `frontend/src/landing/campos.ts::camposDaConfig` descarta
  (chave inválida, tipo desconhecido, lista sem opção, chave repetida,
  `website`) e normaliza o celular igual a `normalizarCelular`. O envio da
  landing manda `visitor_id` (cookie `mhs_vid`) e `consentimento` só quando a
  página tem o bloco. Erro aceito pelo front: `detail` texto, `{mensagem,
  campos}` ou a lista do 422.
- **Para as Tarefas 3 e 5 (revisão da `prova-landing`, 21/10):** a conversão
  da landing passa a mandar `referrer`, `gclid` e `fbclid` além das UTMs — o
  servidor usa para o canal (sem isso, Google Ads sem UTM cai em "direto").
  Consentimento: decidir pela **presença** do bloco na config, não pelo
  texto (texto vazio = texto padrão), igual ao front.

- (achado, não mexido) Na `validate_journey_graph`, o ramo `branch_attribute`
  usa `jsonb_typeof(...) <> 'array'` sem `coalesce`: nó sem `config.rules`
  dá NULL e passa calado. Vem da 018/026; a 027 copiou fiel. Os nós novos da
  027 usam `coalesce`. Corrigir é uma linha, mas muda o que o banco aceita
  hoje — fica para decisão.

## Portão (Tarefa 1)

- Suíte inteira no banco de produção (sozinha, `timeout -s KILL 3600`, 21/10):
  **530 passed, 18 skipped** (os 18 da 027), 36 min 50 s, exit 0.
- `count(*) FROM leads` no banco de produção: **2107 antes, 2107 depois**.
- `git diff --stat`: só os três arquivos da Tarefa 1; nenhum `.env` nem
  credencial no diff. Sem mudança de front (tsc/guarda/build não se aplicam).

## Fase 1 — Tarefas 2–6 (21/10, branch `prova-captura-f1`)

A 027 já estava aplicada em produção quando a Fase 1 rodou: **nenhum teste
pulou** por falta dela (os guardas `_exigir_027` continuam nos arquivos).

| Commit | O que entregou |
|---|---|
| `7369198` T2 | `campos.py`: `TIPOS_DE_CAMPO`, `CHAVE_EXTRA`, `DefinicaoCampo`, `ler_definicoes` (descarta igual a `camposDaConfig`: chave inválida/reservada/repetida, tipo desconhecido, lista sem opção; e-mail sempre e-mail+obrigatório; sem `campos` cai em `visible_fields` → `legado`, sem validação), `validar`, `normalizar_celular_br` (igual a `normalizarCelular`). 22 testes puros. |
| `944a311` T3 | `captura/registro.py` (o corpo de `capturar()` movido sem mudar + extras, colunas novas da conversão, consentimento, tags), `captura/canal.py`, `captura/urls.py`; `evento.py` com `form_id`/`site_id`; `CapturaIn` com `consentimento`, `visitor_id`, `referrer`, `gclid`, `fbclid`; erro `400 {mensagem, campos}`; `GET /contatos/{id}/consentimentos` e `campos_extras` na ficha. URLs da config (`redirect_url`, `imagem_url`, `consentimento.link`) recusadas ao salvar (400 em `paginas.py` e nas rotas de página da chave de API) e descartadas ao servir. |
| `d1e7cb7` extensão | `segmentos.py`: `RegraIn.key` (o pydantic descartava a chave e o segmento por `campo_extra` contava zero calado). |
| `4a996d8` T4 | `mapa.py`, `routers/rastreio.py` (visita, conversão, `/publico/prova/recebido`), `middleware/cors_sites.py`, `routers/sites.py`, `Settings` (`LIMITE_VISITA_POR_MINUTO`, `PROVA_RECEPTOR_TESTE`), `main.py` (balde da visita, CORS dos sites por último), `limpeza.apagar_visitas`. |
| `c512706` T5 | `GET /paginas/numeros` (duas queries, agregação no SQL), casca com `noindex` opcional, `rastreio.js` e config com URLs seguras. |
| `5158efb` T6 | `crm/retorno.py`, `growthhs` no `evento-de-contato`, `contato/status` por `lead_id`/e-mail, card com `custom_fields`/`conversion`/`consent`, `routers/receptor_growthhs.py`, contrato com "Acréscimos de 21/10". |
| `963cdd1` segurança | cache do token: formato exato (`fullmatch`), sem negativo, teto 256 com despejo do mais antigo. |
| `cbb84c9` teste | fixture do receptor limpa os pedidos da sonda nos dois lados (um teste que falhou deixou 1 pedido; removido pela própria fixture). |

**Testes por arquivo (produção, 027 aplicada):** `test_prova_campos` 22 ·
`test_prova_captura` 23 · `test_prova_segmento` 3 · `test_prova_site` 25 ·
`test_prova_numeros` 13 · `test_prova_crm` 19 — todos passando. Regressões
pedidas pelo plano: T3 (`test_captura`, `test_r5_jornadas`, `test_conversao`,
`test_migracao_027`) 80 passed; T4 (+ `test_ab_publico`, `test_security`)
72 passed; T5 (`-k casca`) 19 passed; T6 (`test_api_contato`,
`test_crm_entrega`, `test_growthhs_cliente`, `test_handoff_banco`) 110 com o
de `test_prova_crm` corrigido depois.

### Costura com o front (conferida contra a `main` em 21/10)
`lib/sites.ts` (`Site`: lista crua, objeto inteiro nas escritas — o backend
devolve também `atualizado_em`), `lib/numeros.ts`, `lib/leitura.ts`
(`Consentimento`, `campos_extras` na ficha), `SegmentFormModal` (`key`) e o
corpo de `Formulario.tsx`/`rastreio.js` — casam.

### Decisões tomadas (a mais segura e reversível)
1. **Um evento de reunião, não dois.** O plano mandava gravar a mudança do
   CRM com `_registrar_mudanca`, que grava também o evento específico do
   estágio (`meeting_scheduled`/`deal_won`). Como o evento do GrowthHS JÁ é
   esse, o painel contaria cada reunião em dobro. `retorno.avancar_status`
   grava só o `contact_updated` (mesmas chaves de metadata, `source: crm`).
2. **A volta do CRM se autentica com `Authorization: Bearer`**, não
   `X-API-Key` como o plano escreveu: é o que `chave_api` aceita. Contrato
   corrigido nesse ponto.
3. **Formulário de site: só campo mapeado entra.** Campo sem destino no mapa
   (padrão ou do site) é descartado; mapa não escreve `status`, `tipo`,
   `source`, UTMs nem `ab_*`. Telefone que não normaliza fica como digitado.
   A regra de campo proibido é a do `rastreio.js` (mais larga que a do plano).
4. **UTMs da conversão de site:** primeiro toque → contato (bloco
   congelado), toque atual → `lead_conversions`.
5. **Landing:** `page_url` da conversão fica nulo (o front não manda a URL);
   canal pelo host do `FRONTEND_URL`. Consentimento com `versao` vazia grava
   `sem-versao`; `obrigatorio: false` sem aceite não grava registro.
6. **`contato/status` por e-mail/`lead_id` pode voltar o estágio** (é a rota
   de "pôr neste status", como a do `dnia_id`); só a volta automática do CRM
   é "só avança".
7. **`/sites` sem DELETE** — desligar é `ativo = false` (ver pergunta 1).

## Perguntas da Fase 1
1. **Apagar site com visita falha.** `visitas.site_id` é `ON DELETE SET
   NULL`, mas o CHECK `visitas_com_origem` exige site ou página: o DELETE
   de um site com visitas de site estoura. Hoje não há rota de DELETE (só
   desligar). Se um dia houver: `ON DELETE CASCADE` ou apagar as visitas
   antes — migration nova.
2. **Token negativo não é guardado** (correção de segurança): token bem
   formado e inexistente custa uma consulta por pedido, dentro do balde da
   rota (visita 120/min/IP; conversão 30/min/IP).
3. O achado da Fase 0 (`branch_attribute` sem `coalesce`) continua aberto.

## Portão (Fase 1, 21/10)

- `git merge origin/main` antes do portão (trouxe só front/docs das outras
  frentes; nenhum conflito).
- Suíte inteira no banco de produção (sozinha, `timeout -s KILL 3600`,
  `-rs`): **653 passed, 0 skipped**, 47 min 38 s, exit 0 (antes: 530 passed /
  18 skipped — os 18 da 027 agora rodam, mais os 105 novos).
- `count(*) FROM leads`: **2107 antes, 2107 depois**. `sites`, `visitas`,
  `lead_consents`, `growthhs_receptor_pedidos`: 0 depois.
- `git diff --stat origin/main...HEAD`: 30 arquivos, todos de `backend/` no
  território da frente (+ `segmentos.py`, extensão da coordenadora) e o
  contrato; nenhum `.env` nem credencial. Sem mudança de front
  (`tsc`/guarda/build não se aplicam).

**Pronto para merge** (`prova-captura-f1`). Ao Erick, para a prova:
`PROVA_RECEPTOR_TESTE=true` no ambiente da API só durante o roteiro.

## Sobras da revisão (21–22/10, branch `prova-captura-f2`)

Um commit por item, TDD (cada teste visto falhando antes do conserto):

| Commit | Item |
|---|---|
| `586e002` | Retorno do CRM acha o lead na ordem do contrato: `lead_id` → e-mail → `dnia_id`, cada um só se o anterior não achou; `lead_id` inexistente cai para o e-mail (`api_contato.lead_do_crm`). `_lead_por_identificador` voltou a ser o da origem. Contrato: frase da ordem/fallback. |
| `ee6a0bc` | `dnia_id` mal formado no `evento-de-contato` → 400 nos dois caminhos (growthhs e os outros `source_app`); antes, 500 de cast. O `/contato/status` já dava 422 pelo pydantic (teste antigo `test_status_dnia_id_malformado_e_422`, mantido). |
| `9a9032d` | Contato com `deleted_at` não é achado pelo retorno do CRM nem pelo `/contato/status` (por `lead_id`, e-mail ou `dnia_id`) → 404, estágio intacto. |
| `8bba85b` | `rastreio.py`: `Content-Length` > 16 KB → 413 sem ler; inválido → 400; sem ele, leitura em pedaços que para no teto. |
| `15c4bc3` | `primeiro_toque` da visita passa por `_toque()` (que agora guarda também `url` e `ts`, cortados). |
| `2dea8d1` | `UUID` no caminho de `/sites/{id}`, `/sites/{id}/token`, `/contatos/{id}/consentimentos` → 422, não 500. |

**Testes:** os de cada item rodaram verdes no banco de produção
(`test_prova_crm` 24 + `test_api_contato` 29 = 53 passed depois do item 3;
`test_prova_site` `-k "corpo"` 4, `-k "visita or conversao"` 8, item 6 5).
A rodada conjunta dos arquivos tocados e a suíte inteira **não terminaram
aqui**: a máquina suspendeu à noite e a coordenadora matou os pytest (banco
conferido por ela: 2.107 leads, sem sobra). **A suíte inteira fica com a
coordenadora**, uma por vez.
