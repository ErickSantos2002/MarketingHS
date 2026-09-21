# Continuar aqui

> ## ⏸️ Onde paramos — 21/09/2026, fim do dia: 8D implementado, portão NO MEIO
>
> **Branch `lote-8d`, NÃO mergeada** (a partir de `main` `883727b`). Plano:
> `docs/superpowers/plans/2026-09-21-marketinghs-lote-8d-handoff-growthhs.md`.
> Estado fino (ledger com cada decisão, relatórios, pacotes de revisão):
> `.superpowers/sdd/2026-09-21-marketinghs-lote-8d-handoff-growthhs/`
> (ignorado pelo git, só nesta máquina) — **o `progress.md` de lá é o mapa;
> confie nele e no `git log`.**
>
> **Feito (tarefas 1-7, todas revisadas e aprovadas):** migration 018 (fila
> `crm_handoffs`, `growthhs_config`, colunas `growthhs_*`, vocabulário novo,
> `nexus_config` apagada); cliente do GrowthHS (`app/crm/growthhs.py`); config
> + `GrowthHSCard` no lugar do `NexusCard`; fila de entrega com laço próprio no
> worker (`app/crm/entrega.py`); migration 019 (o avaliador de regras volta
> como gatilho, enfileirando); nó de jornada e botão "Enviar ao comercial"
> (`POST /crm/enviar/{id}`); telas de automação/jornada/contato falando
> GrowthHS. Decisões do Erick de 21/09: avaliador de regras volta no 8D; modo
> público `direct_stage` descartado.
>
> **⚠️ Produção já está à frente do código da `main`:** 018 e 019 estão
> APLICADAS no banco (fila, gatilho vivo, `nexus_config` apagada), mas a
> `main` ainda escreve `create_in_nexus`/`handoff_nexus`. Salvar regra de
> automação ou jornada com nó de handoff falha até o 8D entrar e ser
> implantado. Hoje há 0 regras e 0 jornadas com esse nó. (Mesma defasagem da
> 017 no 8C.)
>
> **O que falta, em ordem:**
>
> 1. **Onda de correção da revisão final** — a lista, com as decisões já
>    tomadas, está em `.superpowers/sdd/2026-09-21-marketinghs-lote-8d-handoff-growthhs/final-review-findings.md`:
>    I1 condição "tag" nunca dispara (recusar ao salvar); I2 guarda de card
>    duplicado por identidade; I3 erro de configuração pausa a fila em vez de
>    falhar tudo + re-tentativa de ~24 h + "reenfileirar falhas" + teste não
>    sobrescreve chave real; I4 migration 020 (lead já entregue não reentra na
>    fila) + recusar regra "mover"; I5 parada do worker não corta entrega
>    depois do 2xx; I6 telas avisam quando o GrowthHS não está configurado;
>    mais 5 menores. Um subagente só, depois re-revisão escopada.
> 2. **Suíte inteira** — a de hoje foi **interrompida** a ~90% (parada pedida
>    no fim do dia; o agente caiu e levou o pytest junto). Conferido depois no
>    banco: nada ficou para trás (growthhs_config, chave, fila, regras, leads,
>    ab_* e usuários de teste = 0). Rodar de novo depois da onda, até o fim.
> 3. **Navegador** (passo 3 da Tarefa 8 do plano) — conta admin do Claude
>    existe (recriada hoje).
> 4. **Capacidade por capacidade** contra a origem (passo 4) — ainda não foi
>    feita; o agente que ia fazê-la foi parado junto com a suíte.
> 5. `git rm` de `handoff-to-nexus`, `nexus-config`, `get-nexus-stages` e
>    `_shared/nexusConfig.ts`; acrescentar ao contrato os três pedidos do 8D
>    (rota de mover card, o que fazer ao excluir contato, rota de leitura
>    autenticada); placar **47 portadas, 7 descartadas, restam 0**; commit.
> 6. Finalizar a branch (merge com o Erick) e seguir para o **8E**.
>
> **Perguntas abertas ao Erick:**
> - O **recálculo de pontuação** e a **sincronização do DataCore** agora
>   disparam as regras (o gatilho avalia em qualquer mudança de etiqueta,
>   status ou pontuação — conserto de um defeito herdado). Com uma regra
>   ativa, isso pode mandar muitos leads ao comercial de uma vez, inclusive
>   clientes do ERP. Deve ser assim, ou recálculo/sync ficam fora?
> - **Peso 0** numa variante de teste A/B vale 1 (como na origem) — deve
>   significar "sem tráfego"? (do 8C)
> - **Push**: a `main` está ~198 commits à frente do `origin/main`.
>
> **Antes de ligar o GrowthHS de verdade** (além do endpoint do lado dele):
> a corrida entre os testes e o worker de produção (um teste pode ter o
> pedido reivindicado pelo worker real); o fallback de ambiente do
> `ler_segredo` torna "limpar chave" inócuo se `GROWTHHS_API_KEY` existir no
> ambiente; a função do gatilho é SECURITY DEFINER com dono superusuário.
>
> Sobra antiga no banco (não é de hoje): identidade
> `sonda-captura@exemplo.invalid` (criada 21/09 07:28, sem lead) — o teste de
> captura não apaga a identidade que cria.

> ## ✅ Sub-lote 8C (Teste A/B) — portão fechado, 21/09/2026
>
> **Mergeado na `main` em 21/09** (fast-forward até `883727b`; o 8B entrou
> antes, até `dc64ef0`). Plano:
> `docs/superpowers/plans/2026-09-21-marketinghs-lote-8c-teste-ab.md`.
>
> **O que entrou:** `/ab/*` no admin (config, testes, ativação pela RPC
> `ab_activate_test`, eventos até 20.000 com aviso `truncado`);
> `/publico/ab/go/{slug}` (redirecionador) e `/publico/ab/eventos` (coletor),
> com gravação depois da resposta; migration 017 (`ab_config` sem o
> `DEFAULT 'dnia.ai'`, com `redirector_base`, linha única); as três telas de
> Experiments falando com `/ab`; `ab.js` sem nenhum padrão da dn.ia;
> `lib/ab.ts` apagado (sem importador desde o lote 7).
>
> **⚠️ O achado que importa: o funil do A/B não registrava conversão
> nenhuma.** O lote 1D portou `/publico/identidade` e
> `/publico/evento-de-contato` sem a costura do `_shared/ab.ts` (conversão
> `agendamento`), e o lote 7 apagou o `leadConversion.ts`, que gravava
> `lead_criado`, sem que `/publico/conversao` assumisse. Nenhuma TELA mudou,
> então o portão não tinha como pegar. `app/ab/costura.py` devolve as duas
> conversões, dentro de SAVEPOINT (falha no A/B nunca derruba o contato).
>
> **Portão:** buscas limpas (o toco agora só é importado por `LimiteDeErro` e
> `NexusCard`); ~35 capacidades conferidas contra a origem, nenhuma sem lugar;
> as três telas conferidas no navegador (5/5, zero erro de console); suíte
> inteira: **273 passaram**, 0 falhas, 4 avisos de biblioteca (18 min). A revisão final da branch pediu correções nas rotas
> públicas, feitas: o coletor e o redirecionador têm balde próprio de limite
> (120/min e 300/min, `LIMITE_COLETOR_POR_MINUTO` e
> `LIMITE_REDIRECIONADOR_POR_MINUTO` em `Settings`) — **a decisão 6 do plano
> mudou**: o redirecionador não é mais isento —, e o redirecionador guarda o
> domínio em memória para não dar 404 a clique pago com o banco fora.
>
> **Placar: 44 functions portadas, 7 descartadas, restam 3**
> (`get-nexus-stages`, `handoff-to-nexus`, `nexus-config` — o 8D). Telas
> migradas: as três de Experiments.
>
> **Antes de o A/B entrar no ar (não bloqueia o merge):**
> - verificar como o `X-Forwarded-For` que o Worker manda chega através do
>   Traefik do EasyPanel — se ele trocar o cabeçalho, todo visitante divide o
>   balde dos IPs do Cloudflare e os eventos somem em silêncio;
> - a fixture `config_ab` reescreve a `ab_config` de PRODUÇÃO durante a
>   suíte (e a devolve no fim) — com o A/B no ar, rodar a suíte contra o banco
>   de produção manda cliques de anúncio para `exemplo.invalid`. Mesma classe
>   do aviso do Resend.
>
> **Perguntas ao Erick:** peso 0 numa variante hoje vale 1, como na origem —
> deve significar "sem tráfego"?
>
> **Para o 8E:** `docs/ab-testing/` é a documentação da origem (dn.ia,
> `go.dnia.ai`, Supabase) e contradiz o código; a casca do app chama um
> endpoint supabase (`get-tests`) e `lovableproject.com` durante a navegação.
>
> A conta admin do Claude foi **recriada** em 21/09 com ok do Erick — apagar
> no fim da travessia.

> ## ⚠️ Onde paramos — 10/09/2026, fim do dia
>
> **A VPS do EasyPanel (`62.72.11.28`) caiu no começo da tarde e voltou às
> 15:00 restaurada de backup.** Os 10 bancos da casa reiniciaram juntos; o do
> MarketingHS voltou ao estado de **04/09/2026, ~10:05** (último
> `contact_events` às 13:05 UTC). O Erick restaurou e confirmou que está tudo
> ok. **Nada do repositório se perdeu** — os commits são locais; o que voltou
> no tempo foi DADO de produção, não estrutura (a migration mais nova, 016, é
> de 03/09, anterior ao backup).
>
> Consequências para quem continuar:
>
> - a conta admin do Claude (`claude.dev@example.com`) **não existe mais** no
>   banco — o arquivo de credencial continua no disco; recriar pede ok do
>   Erick;
> - `journey_events` tem **740** linhas órfãs, não as 1.522 medidas no portão
>   do 8B (a restauração levou tudo o que era posterior a 04/09);
> - `RESEND_WEBHOOK_SECRET` e `UNSUBSCRIBE_SECRET` estão com a versão de
>   04/09; continua não havendo `RESEND_API_KEY` nem `EMAIL_FROM`.
>
> **O que falta para fechar o 8B** (branch `lote-8`, ponta `a409c4e`, NÃO
> mergeada):
>
> 1. Rodar os testes de banco da onda de correção da revisão final — o host
>    fora do ar não deixou; estão escritos e coletados, não executados:
>    `cd backend && ./.venv/bin/pytest -q tests/ -k "status or escrita or contato or painel"`
>    (46 de 219 coletados). Primeiro plano, nunca interromper.
> 2. A re-revisão escopada da correção (`bb80b37..a409c4e`).
> 3. Decidir o destino da branch `lote-8` (8A + 8B) — merge só com o Erick.
>
> Depois disso: escrever e executar os planos do 8C (telas de A/B), 8D
> (handoff para o GrowthHS) e 8E (limpeza final). O estado fino do trabalho —
> ledgers com cada decisão, relatórios das tarefas — está em
> `.superpowers/sdd/`, ignorado pelo git, só nesta máquina.

> ## 🟡 Sub-lote 8B (API de contato) — portão fechado, correção final à espera dos testes de banco (10/09/2026)
>
> **Branch `lote-8`, NÃO mergeada.** Reconstrói as três functions da API de
> contato para integrador externo: `PATCH /publico/contato` (era
> `contact-update`), `PATCH`/`POST /publico/contato/status` (era
> `contact-status-update`) e `PUT`/`POST /publico/contato/tags` (era
> `contact-tags-sync`) — as três em `backend/app/routers/api_contato.py`,
> reaproveitando `_registrar_mudanca` e `_resolver_status` de
> `escrita_contatos.py`. **218 medidos no portão + 1 teste da correção,
> rodados isoladamente** — ⚠️ não os 217 que o plano e a emenda previam; ver
> a nota abaixo, é achado de contagem antiga, não defeito do 8B. A onda de
> correção da revisão final (F1-F8) não pôde rodar contra o banco — o host
> do Postgres estava fora do ar em 10/09/2026; os testes novos e alterados
> ficaram escritos e coletados (`--collect-only`), não executados.
>
> **Placar da pasta de especificação: 42 functions portadas, 7 descartadas,
> restam 5** (`ab-events`, `get-nexus-stages`, `go`, `handoff-to-nexus`,
> `nexus-config`). O portão (Tarefa 5) conferiu capacidade por capacidade
> contra os três `index.ts` antes de apagar; nenhuma ficou sem lugar — ver o
> relatório da tarefa.
>
> **As sete decisões deste plano**
> (`docs/superpowers/plans/2026-09-10-marketinghs-lote-8b-api-de-contato.md`):
>
> 1. Status desconhecido responde **400** com a lista do que vale, não
>    criação automática como a origem fazia — decisão já tomada no lote 1D.
> 2. **O estágio da identidade NÃO avança para `opportunity` em "Lead
>    Qualificado".** A origem avançava, e a documentação prometia; ⚠️
>    pergunta ao Erick, na lista abaixo — vale para as duas portas de
>    escrita (admin e API) ao mesmo tempo.
> 3. `source_app = 'marketinghs'` nos três (a origem gravava `dnmarketing`
>    e, em `contact-tags-sync`, `nexus`).
>
>    ⚠️ Consequência: a rota de tags grava `source_app='marketinghs'` onde a
>    origem gravava `'nexus'`; o filtro "Plataforma: Nexus" da tela de
>    Contatos usa `tem_eventos_nexus = bool_or(source_app='nexus')`
>    (`leitura_contatos.py`) OU `nexus_contact_id` (`useContactsEnriched.tsx`).
>    Contato novo que só recebe sync de tags pelo CRM, sem `nexus_contact_id`,
>    deixa de aparecer no filtro. Linhas antigas não mudam.
> 4. Tag normalizada nas duas rotas que mexem em tag — sem `/` na frente,
>    sem espaço nas pontas, minúscula; busca por `lower(name)`.
> 5. Mudança de status pela rota geral (`PATCH /publico/contato` com
>    `status`) grava os mesmos eventos da rota de status — a origem gravava
>    o status cru, sem evento, o que hoje cairia na FK com 500.
> 6. `dnia_id` malformado dá **422** (validação do FastAPI), não 500.
> 7. `contact-status-update` com identidade cujo lead não existe mais dá
>    **404** — a origem respondia sucesso sem ter gravado nada.
>
> **O indicador de MQL estava cortado, e o 8B consertou:** o card
> `/painel/agendamentos/mql-hoje` lê `contact_updated` com
> `metadata->>'status_atual'`, e a mudança de status pela API não gravava
> esse campo. Hoje grava, em `_registrar_mudanca` e `status_em_lote`.
>
> ⚠️ **A suíte fechou em 218, não nos 217 previstos — e o motivo é anterior
> ao 8B.** O total de 197 registrado no fechamento do 8A (`91fdc39`,
> 11:17:13) já estava desatualizado 23 minutos depois: a `93504c3`
> ("revisão final" do 8A, 11:40:01) acrescentou um teste a
> `test_config_resend.py`
> (`test_ligar_rastreamento_com_chave_rejeitada_nao_desloga_o_admin`) sem
> ninguém recontar — o 8B, medido na ponta da branch em que começou, na
> verdade partiu de **198**. Os 20 testes próprios do 8B
> (`test_api_contato.py`) somam **218**: nenhum teste falhou, nenhum teste
> do 8B está fora do lugar — era a baseline que carregava um número velho.
>
> **`journey_events` tem 1.522 linhas órfãs**, medido depois da suíte
> completa deste portão rodar: o trigger `trg_contact_event_journey` copia
> cada `contact_events` para lá, a tabela não tem FK para `leads`, e
> limpezas antigas não apagavam a cópia. Só esta rodada acrescentou **27**
> (`form_submitted` 13, `email_sent` 7, `email_opened` 3, `email_bounced` 2,
> `contact_reactivated` 1, `email_complained` 1) — nenhuma com a assinatura
> do 8B: é o vazamento antigo das fixtures de captura/conversão/envio/
> webhook, ~27 por rodada completa da suíte. Inofensivas para o motor (lead
> inexistente), mas apagar é decisão do Erick — ver a lista abaixo. Duas
> formas de parar de crescer a cada rodada: limpeza numa fixture comum, ou
> banco de teste separado.
>
> ⚠️ Depois da restauração da VPS (10/09, 15:00) o banco voltou a 04/09 e as
> órfãs são **740** — a taxa de ~27 por rodada continua valendo.
>
> **Limitações conhecidas da API de contato, herdadas da origem ou de
> propósito:**
>
> - Tags que diferem só na caixa (`"VIP"`/`"vip"`) colapsam na sincronização.
> - `removed`/`kept` saem sem ordem definida — como na origem.
> - CORS só aceita `FRONTEND_URL` (a origem mandava `*`), de propósito: a
>   chave de escrita mora em servidor, não no navegador. Pauta do 8E.

> ## ✅ Sub-lote 8A (Resend) fechado (10/09/2026)
>
> **Branch `lote-8`, NÃO mergeada.** Restaura por inteiro a configuração do
> Resend que o lote 3C tinha cortado sem ninguém decidir: teste de chave,
> domínios, rastreamento (open/click) e diagnóstico. Suíte de backend em
> **197 testes**, `tsc -p tsconfig.app.json` com os mesmos 8 erros
> pré-existentes de sempre (nenhum novo, nenhum em `ResendConfigCard.tsx` nem
> em `lib/config.ts`), `tsc -p tsconfig.node.json` limpo, `vite build` limpo.
>
> **O defeito real, e que está consertado:** o 3C (`ecca32d`) tirou teste de
> chave, listagem de domínios e rastreamento — e junto, sem ninguém perceber,
> foi embora o único caminho para gravar o `UNSUBSCRIBE_SECRET` pela tela. Sem
> esse segredo o worker **não consome a fila** (`backend/app/worker.py:180-185`)
> — nenhum e-mail de campanha sai, nem sem `List-Unsubscribe`. Essa frase era o
> comportamento da ORIGEM (que enviava mesmo assim); hoje é diferente e mais
> seguro. O Erick decidiu em 10/09/2026 restaurar a tela inteira, não só o
> segredo.
>
> **Placar da pasta de especificação: 39 functions portadas, 7 descartadas,
> restam 8** (`ab-events`, `contact-status-update`, `contact-tags-sync`,
> `contact-update`, `get-nexus-stages`, `go`, `handoff-to-nexus`,
> `nexus-config`). `resend-config`, `resend-config-check` e `resend-webhook`
> saíram da pasta neste portão — a Tarefa 8 conferiu capacidade por
> capacidade contra os três arquivos antes de apagar; nenhuma ficou sem lugar.
>
> **As cinco decisões deste plano**
> (`docs/superpowers/plans/2026-09-10-marketinghs-lote-8a-resend.md`):
>
> 1. O remetente continua num segredo só, `EMAIL_FROM` — não em
>    `dashboard_settings.resend_from` como na origem. É o que o worker lê; as
>    três partes (nome, prefixo, domínio) são extraídas do próprio valor na
>    leitura, em vez de viverem em dois lugares.
> 2. As `action`s do corpo da origem viram rotas próprias (`/testar`,
>    `/diagnostico`, `/dominios/{id}`, `/dominios/{id}/rastreamento`) —
>    FastAPI autoriza por rota, e um `action` escondido no corpo escondia
>    justamente a autorização que difere entre elas.
> 3. Autorização como a origem: leitura aceita JWT de admin, `WEBHOOK_SECRET`
>    ou chave de API de leitura; escrita aceita **só** JWT de admin ou
>    `WEBHOOK_SECRET` — nunca uma chave de `api_keys`, mesmo com permissão de
>    escrita (vazada, ela poderia trocar a `RESEND_API_KEY` por uma de outra
>    conta e exfiltrar a base inteira de contatos).
> 4. O diagnóstico com chave *sending-only* responde `ok: true` com lista de
>    domínios vazia — a origem tratava isso como `api_error`, uma chave válida
>    acusada como falha.
> 5. Falha secundária de banco no webhook devolve **500**, não os 200 da
>    origem — o Svix reentrega e o `svix_id` deduplica; perder o evento em
>    silêncio é pior que reprocessar. Registrado, não corrigido para bater com
>    a origem.
>
> **O caminho com chave de verdade continua sem conferência ao vivo** até o
> Erick fornecer uma chave do Resend. O portão (passo 3, feito pelo
> controlador) confirmou os caminhos de erro e o diagnóstico contra o banco
> real — `RESEND_WEBHOOK_SECRET` e `UNSUBSCRIBE_SECRET` estão gravados hoje;
> nem `RESEND_API_KEY` nem `EMAIL_FROM` existem —; o caminho feliz (chave
> válida, domínio verificado, tracking ligado) segue provado só pelos testes
> das Tarefas 4 e 5, nunca clicado contra o Resend de verdade.
>
> ⚠️ **Antes de cadastrar o webhook no Resend em produção, resolver o
> `webhook_url`.** O card monta essa URL com `request.url_for` — atrás do proxy
> do EasyPanel ela provavelmente sai `http://` (não `https://`) e sem o
> prefixo `/api`, a não ser que o uvicorn suba com `--proxy-headers
> --forwarded-allow-ips` e um `root_path` correto, ou que exista um
> `PUBLIC_API_URL` declarado em `Settings`. Cadastrar a URL errada no Resend
> significa nenhum evento chegando, sem aviso nenhum.
>
> ⚠️ **Quando existir uma `RESEND_API_KEY` de verdade em produção, a suíte do
> backend NÃO PODE rodar contra o banco de produção.** As fixtures deste
> sub-lote (`segredos_resend` e as que gravam credenciais do Resend) escrevem
> segredos falsos-porém-completos direto em `integration_secrets` durante o
> teste — com uma chave real presente, um worker de produção rodando ao mesmo
> tempo poderia tentar enviar com a chave falsa da fixture. E um `pytest` morto
> no meio (a mesma regra de sempre: nunca interromper) apagaria de vez o
> `RESEND_API_KEY`/`UNSUBSCRIBE_SECRET` reais — todo link de descadastro já
> enviado passaria a falhar. Antes disso acontecer, apontar os testes para um
> banco de teste.
>
> ⚠️ **A verificação de tipos do frontend estava vazia desde sempre, em todo
> lote anterior.** `frontend/tsconfig.json` tem `"files": []` e só
> `references` para `tsconfig.app.json`/`tsconfig.node.json` — `npx tsc
> --noEmit` sem `-p` checa ZERO arquivos e sai 0, sempre. Todo "tsc limpo"
> anunciado antes deste sub-lote (inclusive neste documento e no `CLAUDE.md`
> do repo) não provava nada. **O comando que checa `src` de verdade:**
> `npx tsc --noEmit -p tsconfig.app.json` — daqui em diante é esse que todo
> portão e todo plano usa. Atrás do vazio estava um defeito real:
> `LeadScoringSettings.tsx:55` lê `result.updated` de uma resposta que vem
> `{ atualizados }` (é o que o `POST` de recálculo de score devolve,
> `backend/app/routers/contatos.py:184`) — o aviso na tela sai "Score
> recalculado para undefined leads!". Corte silencioso de porte anterior, sem
> relação com o 8A; ver o item na lista do Erick, abaixo.

> ## ✅ Subprojeto A da captação pública fechado (10/09/2026)
>
> **Branch `captacao-a`, NÃO mergeada.** O merge em `main` é decisão do Erick.
> Suíte em **160 testes**, `tsc` limpo, os dois builds limpos, bundle público
> em 144 KB.
>
> **Placar: 36 functions portadas, 7 descartadas, restam 11.** O toco do
> Supabase continua vivo: os 9 pontos do alias `const db = supabase as any`
> nas telas de Experiments não mudaram, e este subprojeto não os toca.
>
> **O portão foi conferido no navegador pelo próprio Claude.** O Playwright
> alcança `127.0.0.1` nesta máquina (a nota antiga de que não alcançava estava
> errada), e o admin foi aberto com uma conta temporária — item 25.
> Conferido contra o banco real: landing com título, CTA e `og:*` no HTML cru;
> envio redirecionando; `@mailinator.com` recusado com mensagem legível; o
> mesmo e-mail com maiúsculas trocadas não duplicando o contato; o contato na
> tela de Contatos com score 35, etiqueta, `dnia_id` e tag; contato e página
> apagados pela própria tela. Banco limpo no fim.
>
> **O que o portão pegou depois do encerramento de 08/09, todos corrigidos:**
>
> - `contact_reactivated` voltou a gravar `dnia_id` (`750f1dc`) — **provado
>   ao vivo**: contato apagado pela tela, reconvertido pela landing, e o evento
>   nasceu com o `dnia_id` do contato;
> - e-mail >320 caracteres dá 400, e `session_id` >100 é descartado sem
>   derrubar a captura — os dois contratos da origem (`750f1dc`);
> - saíram `leadCapture.ts`, `resolveIdentity.ts` e `emailValidation.ts`;
> - ⚠️ **cinco pontos do admin montavam o endereço da landing na raiz**
>   (`/${slug}`), herança de quando as landings da dn.ia moravam no SPA —
>   inclusive o **"Gerar link", o link colado em anúncio**, que mandaria o
>   tráfego para o 404 do admin. Tudo passa agora por `lib/landing.ts`, e o
>   Vite repassa `/p/` e `/landing/` ao backend (`c512118`). **É a segunda vez
>   que esse link sai errado** (a primeira, `dnia.ai` cravado, no lote 7) — e
>   de novo nenhum `grep` do portão o pegaria: só o clique.
>
> **A landing nasce sem oferta decidida** (item 22). É motor dirigido por
> `pages.config`, e **um template de página única não estica para diagnóstico
> multi-etapa** — se a oferta for essa, é outra construção.
>
> **Duas capacidades saíram de propósito:** `mode: "update_only"` e a projeção
> do lead na resposta da captura (a rota é anônima; até `isNew` seria oráculo
> de enumeração).
>
> **Faltam B e C da captação:** a imagem OG (e `pages.config` ainda não tem
> campo para ela) e o teste A/B, que segue esperando conta Cloudflare.
>
> ⚠️ **O design system da HS não foi consultado** para o `landing.css`. O CSS é
> sóbrio e **provisório**, não uma decisão visual tomada.


**Atualizado:** 10 de setembro de 2026
**Branch:** `captacao-a`, a partir de `main` — **não mergeada, nada pushado.**
A `lote-7` foi mergeada em `main` e apagada em 08/09.

⚠️ **A `lote-7` não existe mais.** Fechou com merge local em `main`
(fast-forward, sem commit de merge), suíte conferida no resultado mergeado
(**138 passed**) e `tsc` limpo, e a branch removida. Se precisar dela de volta:
`git branch lote-7 7ae95d2`. A `reconstrucao`, do lote 6, saiu do mesmo jeito:
`git branch reconstrucao 6926d4d`.

`main` está **140 commits à frente de `origin/main`** — o remoto continua parado
em 31/08, no último commit do Lovable, conferido com `fetch` antes do merge
(`origin/main` é ancestral de `main`; não há nada a puxar). O push segue sendo
decisão do Erick, com o mesmo alerta de sempre (item 6 abaixo).

## Onde paramos

### ✅ Lote 7 concluído (08/09/2026)

As dez tarefas fecharam. Suíte de backend em **137 testes** (127 do lote 6 +
10 novos, `test_conversao.py`), `tsc --noEmit` limpo, e o portão (tarefa 9)
abriu a tela de Páginas no navegador contra o banco real.

O que entrou:

| | |
|---|---|
| **1** | Rotas de admin do cadastro de páginas (`backend/app/routers/paginas.py`), com `admin_atual` + `sessao(role="authenticated")` — `pages` é admin-only por RLS e `page_stats` é view `security_invoker=true` |
| **2** | Resolução de lead, tag aplicada na mesma transação, recálculo de `last_conversion_date` |
| **3** | `POST /publico/conversao` no lugar de `register-conversion` |
| **4** | `PATCH` + `DELETE /publico/conversao`, com os aliases `POST /publico/conversao/atualizar` e `POST /publico/conversao/remover` |
| **5** | `/publico/paginas` no lugar de `pages-api` |
| **6** | `usePages.tsx` fora do toco do Supabase; a tela de Páginas portada |
| **7** | `leadConversion.ts` apagado — sem chamador |
| **8** | Documentação corrigida — na tela (`ApiDocumentation.tsx`, inclusive a navegação lateral) e no `dnmarketing-api.yaml` |
| **9** | O portão — cinco functions a menos |

⚠️ **O brief original deste lote listava três rotas de conversão. São
cinco.** `update-conversion` virou **duas** (`PATCH /publico/conversao` e o
alias `POST /publico/conversao/atualizar`); `unregister-conversion` virou
**duas** (`DELETE /publico/conversao` e o alias
`POST /publico/conversao/remover`). Os aliases existem porque a documentação
publicada já prometia "Aceita PATCH ou POST" / "Aceita DELETE ou POST" e a
portagem tinha derrubado isso em silêncio — restaurado numa rodada de
correção (`4d45d86`). Não couberam no mesmo caminho do método principal
porque `POST /publico/conversao` já é a criação. `DELETE /publico/conversao`
aceita `session_id` no corpo **ou** em query string, com o corpo vencendo
quando os dois vierem.

⚠️ **"Zero pontos de acesso" é a frase mais fácil de ler errado deste
projeto — em letra grande.** O script do placar agora marca **0**. Os 8
pontos que ele via no lote 6 eram exatamente `usePages` (6) e
`leadConversion` (2), e os dois saíram do código. Mas o toco
(`integrations/supabase/client.ts`) **continua sem poder ser apagado**:
sobram os **9 pontos reais** do alias `const db = supabase as any`, em
`useAbConfig.tsx:9` e `useAbTests.tsx:8` (as três telas de Experiments) — o
script não os enxerga. Medido em 08/09/2026:

```bash
python3 -c "
import pathlib, re
n = sum(len(re.findall(r'supabase\s*\.?\s*\n?\s*\.(from|rpc)\(', f.read_text()))
        for f in pathlib.Path('frontend/src').rglob('*.ts*')
        if 'integrations/supabase' not in str(f))
print(n, 'pontos pelo script')"
# → 0 pontos pelo script

grep -rn "supabase as any\|= supabase;" frontend/src --include=*.ts --include=*.tsx
# → useAbTests.tsx:8 e useAbConfig.tsx:9
```

⚠️ **A lista de telas liberadas para trabalho de visual estava errada.**
Dizia quatorze de dezesseis, contando Experiments como portada — não estava.
As três telas de Experiments ainda falam com o Supabase pelo alias. Eram
**onze**; com Páginas, que este lote libera, são **doze**. Continuam fora:
**Experiments** (três telas) e **Configurações** (espera o `NexusCard` do
5A, bloqueado). Lista atualizada mais abaixo.

⚠️ **A perna de A/B da conversão ficou pendente, e o commit `46f2a07`
generaliza demais.** `leadConversion.ts` fazia quatro coisas. Três têm
substituto em `POST /publico/conversao`, e duas ficaram melhores: a tag
agora é aplicada na mesma transação em vez do fire-and-forget que falhava
calada, e `last_conversion_date` agora vem de um gatilho `AFTER INSERT` com
`greatest()` — o que conserta a function original, que BAIXAVA a data
quando a conversão chegava com `converted_at` no passado. Mas a quarta —
`recordAbConversion("lead_criado", ...)`, o disparo de conversão A/B **no
navegador** — **não tem, e não pode ter, substituto numa rota de
servidor**. O commit diz "o que ele fazia vive agora em
`POST /publico/conversao`", e isso é verdade só para as colunas do banco
(`ab_*`, que a rota grava). Registrado aqui para ninguém ler o commit
sozinho no futuro e concluir paridade.

⚠️ **O lote 7 NÃO é a "Captação pública" que a spec descreve.** A spec
(linha 238) chama o lote 7 de "Captação pública — landing modelo da HS,
conversões, OG estático, teste A/B". Por decisão do Erick em 08/09/2026,
este lote foi **só o porte**. `pages` e `lead_conversions` seguem
**vazias**. "Lote 7 concluído" não quer dizer que a captação está de pé.

**O que a conferência no navegador provou (passo 3 do portão, 08/09/2026):**
listar, estatísticas, duplicar, busca, alternar status, editor de config
(com persistência após reload), presets de UTM, e excluir pela própria
tela — tudo contra o banco real, sem sobrar teste no banco.

⚠️ **E o clique achou o que nenhum `grep` acharia.**
`UTMPresetsModal.tsx:37` montava `https://dnia.ai/${page.slug}` cravado — o
link que o botão "Copiar link" entrega para colar em anúncio, mandando
**tráfego real para o domínio da dn.ia**. Corrigido para
`window.location.origin` no commit `dcc0742`. Vale registrar como lição
junto do portão: os passos 1 e 2 são `grep`, e esse defeito não era uma
chamada — era um literal montando uma URL. Só apareceu porque alguém abriu
a tela e clicou.

O portão fechou as cinco functions que a tela de Páginas e a conversão
seguravam (`pages-api`, `register-conversion`, `unregister-conversion`,
`update-conversion`, `apply-lead-tag`): pela **oitava vez** no projeto, a
documentação (tela + `dnmarketing-api.yaml`) ainda ensinava URL morta —
desta vez até na navegação lateral, que montava o rótulo visível a partir
do `id` do bloco em vez do `path`, sobrevivendo dentro da própria tarefa
que existia para eliminá-la (`b43ccc0`). Placar da pasta de especificação:
**34 functions portadas** e **7 descartadas** (números que não se somam),
restando **13**: `ab-events`, `contact-status-update`,
`contact-tags-sync`, `contact-update`, `get-nexus-stages`, `go`,
`handoff-to-nexus`, `lead-capture`, `nexus-config`, `resend-config`,
`resend-config-check`, `resend-webhook`, `validate-email-domain`.

### ✅ Lote 6 concluído (04/09/2026)

As nove tarefas fecharam, mais uma revisão final do lote inteiro (os 18 commits
lidos juntos) e uma onda de correção de 12 itens. Suíte de backend em **127
testes**, `tsc --noEmit` limpo, e o portão (tarefa 9) abriu a tela de
Documentação da API no navegador sem erro.

**As decisões tomadas durante a execução estão em
`docs/superpowers/plans/2026-09-04-lote-6-estado-da-execucao.md`** — inclusive
as seis vezes em que o plano errou e a execução pegou, e as três capacidades
que a portagem derrubou em silêncio. Vale ler antes do lote 7.

O que entrou:

| | |
|---|---|
| **1** | A migration 016 apagou a `execute_readonly_query` — a IA não escreve mais SQL |
| **2** | Cliente da API da Claude, com a chave configurável em Configurações → IA |
| **3** | As seis ferramentas nomeadas, com allowlist e teto |
| **4** | O laço de ferramentas e as cinco rotas do chat |
| **5** | As duas análises, com o formato de saída garantido pela API |
| **6** | Painel: metas, cartões e agendamentos, saindo do toco do Supabase |
| **7** | Telas de IA (chat e as duas análises) portadas |
| **8** | A tarja dos dez mil |
| **9** | O portão — quatro functions a menos, documentação sem URL morta |

**O buraco que o lote fechou:** `execute_readonly_query` era `SECURITY
DEFINER` de dono superusuário e executava qualquer SELECT que a IA gerasse; a
defesa era lista negra de palavras, que não bloqueia
`SELECT value FROM integration_secrets`. Não estava explorável (a tela morria
no toco antes), mas estava viva no banco. Apagada pela migration 016.

**O que substituiu:** seis ferramentas nomeadas com allowlist de campos,
executadas pela `sessao()` de quem perguntou. O modelo não escreve SQL.

⚠️ **A lição, para os próximos lotes:** o defeito não era o modelo escrever
SQL ruim — era a **lista negra**. Toda vez que a defesa for "proibir o que é
ruim" em vez de "permitir só o que é bom", é o mesmo desenho.

**Que a spec errava:** os painéis já estavam fora do Supabase desde o lote 1B;
o lote 6 foi IA e configuração, não Analytics.

**A tarja dos dez mil**, e que ela é um remendo honesto: a agregação no
servidor continua não existindo, e o dia que a base passar de 10 mil o painel
fica lento antes de ficar errado.

⚠️ **A IA não está provada de ponta a ponta, e não deve ser lida como se
estivesse.** Não há chave da Anthropic gravada — conferido na tela em
Configurações → IA, que mostra "não configurado" — então o chat e as duas
análises foram verificados só até a fronteira do `400 "não está
configurada"`. É o honesto-parcial mais importante do lote: o código está
pronto (rotas, ferramentas, formato de saída garantido), mas ninguém viu o
modelo responder de verdade.

**A tarefa 7 restaurou uma capacidade que a portagem tinha derrubado:** o
botão de apagar insight (ícone de lixeira + confirmação) na aba Desafios. A
tarefa 5 nunca escreveu a rota DELETE e o mapa de rotas do plano só listava
GET e POST — a portagem perdeu um botão que o usuário tinha, em silêncio.
Agora existe `DELETE /ia/insights-de-desafios/{id}`, devolvendo 404 (não um
200 sem efeito) quando o id não bate com nenhuma linha.

**A tarefa 6 introduziu um corte silencioso que a tarefa 8 desfez.** A nova
`GET /painel/agendamentos` nasceu com um `LIMIT 500` fixo; o hook do Supabase
que ela substituiu paginava até 20.000. A tarefa 8 restaurou o teto de 20.000
e fez a rota avisar quando corta. Vale registrar como padrão: é a própria
portagem que introduz teto silencioso.

**Duas linhas de dado de teste são hoje a configuração viva do painel.**
`dashboard_settings` guarda `lead_goal = {"monthly":100}` e `dashboard_cards
= {"overview":["leads","conversao"]}`, ambas criadas em 03/09 pelos próprios
curls do Passo 2 do plano, não por uma pessoa. O payload não tem a chave
`goal`, que é o que `useGoalSettings` lê, então o medidor de meta cai no
padrão de 1.000. É decisão do Erick: apagar as duas linhas de teste, ou
configurar a meta de verdade pela tela — ver a lista abaixo. (A terceira
linha, `...:colunas-contatos`, é preferência de usuário de verdade — não
mexer.)

**O item 9 da lista de pendências antiga está confirmado ao vivo — com a
contagem corrigida.** Reproduzido ao vivo em 04/09/2026: são **duas**
chamadas a `supabase.co` na tela do admin, não uma. `frontend/index.html:268`
carrega `luinwzmegsdjckjxoimx.supabase.co/functions/v1/tracker`, e é esse
script que dispara a segunda, `.../functions/v1/get-tests` — a versão
anterior deste parágrafo só via a segunda e não sabia de onde ela vinha. A
afirmação de fundo continua verdadeira e é o que sustenta o item 9 da lista
abaixo: nenhuma tela em `frontend/src` fala com o Supabase — é a casca da
página, em `index.html`, quem fala, antes de qualquer tela carregar.

**Um corte pequeno e silencioso, registrado para não ser redescoberto:** o
título das conversas. O código antigo gravava os 50 primeiros caracteres da
primeira pergunta em `ai_chat_conversations.title`; a rota do servidor só
toca `updated_at`. Zero efeito hoje porque não existe tela de lista de
conversas, mas vai importar para quem construir uma.

O portão apagou as quatro functions que sobravam
(`analytics-api`, `ai-data-analyst`, `analyze-leads`, `analyze-challenges`):
pela **sétima vez** no projeto, a documentação (tela de Documentação da API +
`dnmarketing-api.yaml`) ainda ensinava uma URL morta a integradores —
`/analytics-api`, checado e removido dos dois lugares antes de apagar a
function. Placar da pasta de especificação: **29 functions portadas** e **7
descartadas** (números que não se somam), restando **18**. Pontos de acesso
direto ao Supabase medidos pelo mesmo script do lote anterior: **8** (script
que não enxerga o alias `const db = supabase as any` das telas de
Experiments — ver a nota abaixo).

⚠️ **O script do placar tem um ponto cego.** `usePages.tsx` e
`leadConversion.ts` (lote 7) chamam `supabase.from(`/`.rpc(` direto, e o
script os conta. `useAbConfig.tsx` e `useAbTests.tsx` (as telas de
Experiments) chamam a mesma coisa por trás de `const db = supabase as any`,
e o script não reconhece o alias — são **9 pontos de acesso reais** que o
número 8 não inclui. Não são novos nem deste lote; estavam fora da vista do
script antes também. Registrado para quem for portar Experiments não se
surpreender com o número.

---

## 👉 O próximo passo — terminar a transformação

**Abrir a sessão dentro do repo:** `cl MarketingHS` (ou Meta+C), nunca de fora.

⚠️ **A prioridade, dita pelo Erick em 10/09/2026: primeiro transformar o remix
em sistema nosso; feature e decisão de produto vêm depois, com o sistema
inteiro portado.** Na hora de escolher o próximo passo, vence o que diminui o
que resta do remix.

O que resta, medido em 10/09/2026:

- **11 functions na pasta de especificação:** `contact-status-update`,
  `contact-tags-sync`, `contact-update` · `resend-config`,
  `resend-config-check`, `resend-webhook` · `get-nexus-stages`,
  `nexus-config`, `handoff-to-nexus` (as três do **5A**, bloqueado — ver
  abaixo) · `go`, `ab-events` (o **C** da captação, que espera conta
  Cloudflare).
- **O toco do Supabase**, vivo pelos 9 pontos do alias nas três telas de
  Experiments — também o C.
- **A marca da dn.ia no admin** (item 26) — independe de terceiro e pode ir
  já.

⚠️ Antes de apagar qualquer function, conferir `ApiDocumentation.tsx` e
`dnmarketing-api.yaml`: já ensinaram URL morta **oito vezes**.

---

## Onde paramos

**Lotes 0 a 4 fechados, mais o 5B, o 5C, o 5D, o 6 e o 7.** O lote 5 foi partido em quatro:

| | | |
|---|---|---|
| **5A** | Handoff → GrowthHS | ⏸ **bloqueado** — ver abaixo |
| **5B** | Contatos do DataCore | ✅ concluído (02/09/2026) |
| **5C** | Identidade unificada, Meta CAPI | ✅ concluído (03/09/2026) |
| **5D** | Limpeza das sobras | ✅ concluído (02/09/2026) |
| **6** | IA (chat, análises) e painel | ✅ concluído (04/09/2026) |
| **7** | Páginas e conversões | ✅ concluído (08/09/2026) — mergeado em `main` |
| **A** | Captação pública: landing e captura | ✅ concluído (10/09/2026) — branch `captacao-a`, não mergeada |

## 🎨 O trabalho de visual já pode começar

Era para isto que o 5D existiu, o lote 6 liberou mais duas, e o lote 7 libera
mais uma (Páginas). **Doze das dezesseis telas do admin estão 100% livres do
toco do Supabase** e podem ser redesenhadas agora:

> Automações · Campanhas · Contatos · Importar · Construtor de fluxo · Login ·
> Segmentos · Preview de template · Templates · Visão Geral · Analytics ·
> Páginas

⚠️ **A lista publicada até 04/09 estava errada — contava Experiments (as
três telas) como portada.** Não estava: `useAbConfig.tsx` e `useAbTests.tsx`
alcançam o Supabase pelo alias `const db = supabase as any`, que o script do
placar não enxerga. Eram onze telas livres, não quatorze.

⚠️ **Não redesenhe estas ainda:**

| Tela | Por quê |
|---|---|
| **Experiments** (as três) | ainda falam com o Supabase pelo alias `const db = supabase as any` — os 9 pontos que sobram no toco. Aguarda o próximo lote (captação pública / teste A/B) |
| **Configurações** | falta só o `NexusCard` (5A, bloqueado) — o `MetaCard` (5C) já chegou |

⚠️ O design system da HS **vive no Claude Design** — ler de lá (DesignSync)
antes de desenhar, em vez de inventar.

## ⏸ Por que o 5A está bloqueado

A spec deixava em aberto se a API do GrowthHS já criava card. **Não cria.**
Existe `POST /integration/service-cards` no `hsgrowth-sistema`, com o desenho
certo (chave de API, escopo, create-or-return idempotente), mas ele só cria card
de **serviço**, em board de serviço, com o `source` travado num `Literal` de três
valores do GestorHS. O handoff do marketing quer card **comercial**.

O contrato completo do endpoint que falta está em
**`docs/contratos/2026-09-02-endpoint-card-comercial-growthhs.md`** — é um pedido
ao `hsgrowth-sistema`, não trabalho para fazer aqui.

⚠️ **O contrato achou um buraco que a spec não previa:** `service_cards` tem
`external_source`/`external_id` com unicidade e o card comercial **não tem
nenhum dos dois**. Sem chave de idempotência, um retry nosso cria um segundo
card para o mesmo lead — e quem descobre é o vendedor.

**Para destravar, precisamos de volta:** a chave de API com escopo
`cards:create`, o `board_id` do funil, a URL base da API, e se `origin` é lista
fechada ou texto livre.

## O que o 5B entregou

Os 2.080 clientes do ERP entraram como contato. `stage='client'` na identidade,
`tipo='datacore'` no lead, e o construtor de segmentos recorta cliente contra
lead — conferido na tela, contando 2.080.

⚠️ **A spec errava o número central por onze vezes:** "2.077 clientes, todos com
e-mail" são, na real, **2.081 clientes e 183 com e-mail utilizável**. Unindo
nota fiscal e conta a receber o teto é 327, e isso está atrás de
`DATACORE_EMAIL_DE_NOTAS`, **desligada** — e-mail coletado para faturar não é
consentimento para marketing, e ligar é decisão do Erick e do Nicholson.

## O que o 5B ensinou, e vale para o 5C

1. **Três queries por linha não escalam para dois mil.** 400ms cada contra o
   Postgres remoto viram 14 minutos. Bloco de 500 com `unnest` levou a 3,1s. Se
   o 5C for casar identidades em massa, nasça em lote.
2. **`ON CONFLICT (email)` não é idempotência** quando o e-mail pode ser nulo:
   NULL não conflita com NULL. A chave tem de ser a que sempre existe.
3. **Lista de valores escrita à mão no frontend envelhece calada.** A de `tipo`
   era da dn.ia e já não tinha `csv_import`, do lote 1A — dava para importar
   contato que ninguém segmentava. Agora vem do banco (`/tipos-de-contato`).
4. **A spec erra vocabulário, não só número.** `stage` é em inglês; não existe
   status "Cliente". Conferir contra o banco antes de escrever.
5. **Matar o pytest no meio vaza dado.** A fixture do webhook commita e só
   desfaz no teardown; um `timeout` deixou a linha e o índice único derrubou a
   rodada seguinte inteira. A fixture agora limpa antes de inserir.

## O que o 5C entregou

O defeito dos 2.080 fechou por gatilho, não por backfill: a correção age em
toda escrita futura, não repontua o passado de uma vez só. `dndash_lead_id` é o
**contato canônico** de uma identidade, não uma cópia — e que N contatos
apontem para a mesma identidade é decisão já tomada no lote 1C, não algo que o
5C reabriu.

O Meta Conversions API nasce **parametrizado e desligado**: pixel, token e
`test_event_code` têm lugar na tela e no banco, mas sem credencial gravada
nada dispara. A pergunta "a HS faz anúncio no Meta?" continua em aberto — ver
"Antes de continuar, o que depende do Erick".

A tela de **Configurações** agora só espera o `NexusCard` (5A, bloqueado) para
liberar o trabalho de visual — o `MetaCard` do 5C já chegou.

O portão fechou as três functions de identidade e Meta
(`merge-identities`, `meta-config`, `send-to-meta-capi`): pela quarta vez no
projeto, a documentação (tela de Documentação da API + `dnmarketing-api.yaml`)
ainda ensinava uma URL morta a integradores depois de a tela real já ter
migrado. Placar da pasta de especificação: **26 functions portadas** e **6
descartadas** (números que não se somam), restando **22**.

## O que a revisão final do 5C achou

Seis achados. Nenhum vira código agora — todos descrevem comportamento herdado
que o 5C não piorou.

1. **I1** — A FK nova mudou o contrato de `POST /publico/identidade`. O
   `IdentidadeIn` (`backend/app/routers/publico.py:34-42`) não valida
   `source_app`, ao contrário do `EventoIn`, que tem `pattern`. Um integrador
   que omite `source_app` e manda o `local_id` do sistema dele cai no ramo
   `marketinghs` da `resolve_or_create_identity`, que grava esse id em
   `dndash_lead_id` — e agora leva `ForeignKeyViolationError` sem
   `try/except`, virando 500 com mensagem de Postgres. Antes da 015 isso
   gravava lixo em silêncio e a visão 360° vinha vazia, então falhar é melhor
   que o que havia; o que falta é falhar com 400 e mensagem. ⚠️ Esta nota
   previa "conserto natural no lote 7" — não aconteceu. Conferido em
   08/09/2026: `IdentidadeIn.source_app` (`publico.py:39`) continua
   `str | None = None`, sem o `pattern` que `EventoIn` já tem. Ainda em
   aberto para um próximo lote: o mesmo `pattern` do `EventoIn`, mais 400
   quando o `local_id` não resolve.
2. **I3** — A migration 015 promete uma guarda que outro caminho contorna. O
   comentário do gatilho diz que a guarda `dndash_lead_id IS NULL` impede
   roubar o canônico; mas a `resolve_or_create_identity` (migration 007), no
   passo 5, faz `dndash_lead_id = COALESCE(p_local_id, dndash_lead_id)` sem
   guarda nenhuma. Importar um CSV cuja linha case por telefone ou e-mail com
   identidade que já tem canônico troca o canônico em silêncio. Não é
   regressão do 5C — é herdado —, mas as duas implementações discordam sobre
   quem é dono do canônico.
3. **M1** — O gatilho não vê a exclusão pela ficha, que é soft delete
   (`escrita_contatos.py:379` faz `UPDATE leads SET deleted_at`). O gatilho é
   `UPDATE OF dnia_id` e não dispara, então a identidade segue apontando para
   contato excluído — e o `COMMENT ON FUNCTION` diz "apontando para um
   contato **vivo**". Zero casos hoje, conferido. Ampliar para
   `UPDATE OF dnia_id, deleted_at` resolveria, mas muda o significado de
   "canônico" e merece decisão própria.
4. **M2** — `apagar_segredo` documenta uma obrigação que seu único chamador
   ignora. O docstring avisa que apagar do banco não garante que o segredo
   sumiu (o `ler_segredo` cai para `os.environ`) e que quem chama precisa
   saber, "para não dizer ao usuário que removeu". O `gravar_config_meta`
   descarta o booleano e devolve `limpados` incondicionalmente; o card mostra
   "Valor removido". Com `META_ACCESS_TOKEN` no ambiente, a pessoa vê o card
   continuar "configurado" sem explicação.
5. **M4** — Sobrou um buraco na carga do DataCore que o gatilho não fecha. O
   passo 2 termina em `ON CONFLICT (email) DO NOTHING`: quando o e-mail
   colide, nenhuma linha é inserida, o gatilho não dispara, e aquela
   identidade fica sem canônico para sempre — e o backfill da 015 também não
   a alcança, porque o lead que existe está sob outra identidade. Zero casos
   hoje.
6. **M5** — A 015 inverteu a ordem de aquisição de lock dentro de
   `merge_identities` (antes K depois D; agora D depois K, adquirido dentro
   do gatilho). Não é classe nova de deadlock —
   `merge_identities(A,B)` concorrente com `(B,A)` já era simétrico —, mas
   agora o lock é invisível para quem lê o corpo da função.

⚠️ **Uma dependência de ordem que hoje só existe por sorte.** Na sincronização
do DataCore, o passo 1 insere as identidades e o passo 2 insere os leads. É
essa ordem que faz o gatilho funcionar — quando ele roda, a identidade já
existe. Se alguém inverter os dois passos, o gatilho não acha linha nenhuma e
o defeito dos 2.080 volta, calado.

## Migrations aplicadas

| | |
|---|---|
| **010–012** | lote 4 (jornadas) |
| **013** | `ecosystem_identities.datacore_cliente_id` + índice único parcial |
| **014** | lote 5D (imagens de e-mail) |
| **015** | lote 5C — gatilho do contato canônico (defeito dos 2.080) |

## Antes de continuar, o que depende do Erick

1. ~~Cadastrar `[marketinghs]` no cadastro de bancos~~ — **feito**
2. ~~Trocar a senha do superusuário do Postgres~~ — a ferramenta está pronta:
   `bash ~/trocar-senha-admin.sh marketinghs`. ⚠️ Depois, atualizar
   `POSTGRES_PASSWORD` no EasyPanel.
3. Preencher `POSTGRES_HOST_INTERNO` em `~/marketinghs.env`
4. **Passar o contrato do 5A** para o agente do `hsgrowth-sistema`
5. Decidir sobre `DATACORE_EMAIL_DE_NOTAS` (190 → 327 contatos alcançáveis)
6. Decidir sobre o **push do `main`** (era "push da branch", até o merge de
   04/09): ele é o que rompe o sync com o Lovable. São **123 commits** locais
   que o remoto não tem — e a branch `lote-7` soma mais **14** em cima disso,
   ainda não mergeada em `main` (08/09/2026).
   ⚠️ Antes de pushar, ver o `SETUP-CLAUDE.md` (não versionado): o `.env` da
   dn.ia com credenciais do Supabase está no histórico do git desde o commit
   inicial do remix. Pushar publica esse histórico — reescrevê-lo é mais
   barato antes do primeiro push que depois.
7. **Decidir se a HS faz anúncio no Meta** — sem isso o CAPI fica configurado e
   desligado, que é um estado válido.
8. ⚠️ **`scripts/aplicar-migrations.sh` não roda de novo.** Ele reaplica desde
   a `001_schema_origem.sql`, que é dump bruto do Supabase sem `IF NOT EXISTS`,
   e morre em `type "app_role" already exists`. O cabeçalho do próprio script
   diz "Idempotente: pode rodar de novo sem estragar o que já existe" — mentira,
   é o `CLAUDE.md` do repo que está certo ao dizer o contrário. A `015` deste
   lote foi aplicada direto por `psql` e conferida rodando duas vezes. Decidir:
   conserta o script, ou conserta o cabeçalho.
9. ⚠️ **`frontend/index.html` ainda manda telemetria do admin interno para
   terceiros da dn.ia**, nas linhas ~228-280, em toda página do admin: o
   tracker do Supabase **da dn.ia**
   (`luinwzmegsdjckjxoimx.supabase.co/functions/v1/tracker`, com o `pid` da
   dn.ia) e o tracker do **Lovable** (`lovableproject.com/api/v1/tracker.js`).
   Não são analytics — o `CLAUDE.md` do repo abre dizendo "o Lovable e o
   Supabase saíram" — saíram do código, não daqui, e isso também desmente ao
   pé da letra a frase do portão de que nenhuma tela fala com o Supabase: o
   `index.html` fala, antes de qualquer tela carregar. Estes dois saem sem
   discussão — não é decisão de marketing, é parar de mandar telemetria da
   casa para um terceiro. Nenhuma tarefa do lote 5C tem escopo sobre esse
   arquivo.
10. **Decidir sobre o Google Analytics (`G-P6GLV8VVNR`) e o GTM
    (`GTM-59T4XHKS`)**, no mesmo `frontend/index.html`. Ao contrário do item
    9, isto É decisão de negócio — alguém na casa pode ler aqueles
    relatórios. Empacotar os quatro rastreadores como um item só (como a
    versão anterior deste documento fazia) prende essa decisão de marketing a
    dois trackers que não têm nada a ver com ela.
11. **Preencher o host de produção do `frontend/public/api/dnmarketing-api.yaml`**
    — o bloco `servers:` hoje é um placeholder explícito
    (`PREENCHER-O-HOST-DE-PRODUCAO`) porque ninguém aqui sabia o host real.
    Até ele ser preenchido, o arquivo público que ensina a API a
    integradores externos aponta para um valor que não resolve — o que é
    melhor que ensinar o host morto do Supabase da dn.ia, mas ainda não é a
    resposta certa.
12. **Gravar a chave da Anthropic** em Configurações → IA — sem ela o chat de
    dados e as duas análises (leads e desafios) respondem 400. Custo
    estimado: **~$15/mês**, para saber o que esperar na fatura.
13. **Decidir sobre as duas linhas de teste em `dashboard_settings`**
    (`lead_goal` e `dashboard_cards`, gravadas em 03/09/2026 pelos curls do
    plano do lote 6, não por uma pessoa) — apagar as duas, ou configurar a
    meta de verdade pela tela. Enquanto ninguém decide, o medidor de meta do
    painel mostra o padrão de 1.000 porque o payload de teste não tem a
    chave `goal`.
14. ⚠️ **O modelo de permissão de `backend/app/routers/escrita_contatos.py`
    pede uma resposta de negócio, não de código.** `mudar_status`,
    `status_em_lote`, `tags_em_lote` e `editar_contato` autorizam por
    `usuario_atual` — QUALQUER usuário logado, não só admin — mas rodam sob
    `sessao(role="service_role")`, que tem `BYPASSRLS`; só `fundir_contatos`
    e `excluir_contato` exigem `admin_atual`. Uma revisão da tarefa 5
    apontou isso como Crítico; a decisão foi NÃO mexer, porque o corte é um
    modelo de permissão coerente — mudar status, tag e campo de um contato é
    trabalho do dia a dia de marketing, fundir e excluir são operação
    destrutiva de admin — e chamar isso de furo pressupõe uma resposta a uma
    pergunta de negócio que não é do código responder. Essa decisão
    permanece. O que fica em aberto para o Erick: **um usuário não-admin
    deveria poder mudar status, tag ou campo de um contato?** Fato, para a
    decisão: `service_role` tira a segunda linha de defesa (RLS) desses
    quatro caminhos, e `leads` não tem política de UPDATE nenhuma —
    conferido em `001_schema_origem.sql`, só há `Admins can delete leads` e
    `Admins can read all leads`. Hoje existe exatamente **um** usuário, e é
    admin — nada está exposto ainda, mas o dia que existir um segundo
    usuário não-admin (lote 0 já tem a tela de Usuários), a resposta importa.
15. **`dashboard_cards` virou preferência global; era por usuário.** Antes
    deste lote a chave era `card_prefs_${user.id}_${tabName}`, uma por
    pessoa; a portagem colapsou para uma chave só,
    `dashboard_cards`, compartilhada por todo mundo. O docstring do código
    (`useDashboardCards` / rota de `/painel`) chama isso de intencional —
    "escolha de cartões são do painel da empresa, não da pessoa" — mas essa é
    uma leitura de negócio de quem escreveu o plano, não uma decisão que o
    Erick tomou. Vale notar que o mecanismo por usuário já existe e não foi
    usado: `/preferencias/{chave}` (`configuracao.py`) compõe a chave com o
    id do usuário autenticado — é o que a linha sobrevivente
    `...:colunas-contatos` prova que funciona. Latente hoje, com um usuário
    só; no dia em que a tela de Usuários do lote 0 criar um segundo admin,
    um admin escondendo um cartão some com ele do painel do outro, sem
    explicação nenhuma na tela.
16. **O chat de IA segura uma conexão do pool e uma transação aberta durante
    a conversa inteira com o modelo.** O pool abre com `max_size=10`
    (`database.py:32`); `enviar_mensagem` (`/ia`) abre `sessao()` — uma
    transação — e só fecha depois de `analista.responder`, que encadeia até
    `MAX_VOLTAS = 8` idas e vindas ao modelo, cada uma com `TIMEOUT = 120`s,
    mais as re-tentativas do SDK, sem prazo total para a chamada inteira. Dez
    conversas de chat simultâneas esgotam o pool inteiro e travam qualquer
    outro request — inclusive login. Não alcançável hoje com um usuário só;
    merece decisão (prazo total, ou tirar a query do modelo de dentro da
    transação) antes de o sistema ter vários.
17. **`page_stats` e `/publico/paginas` discordam sobre o que é "lead da
    página".** A view conta por `lead_conversions.page_slug`; a rota pública
    conta por `leads.source = slug`. As duas foram portadas como estavam —
    mudar qualquer uma alteraria número que alguém pode estar lendo. Qual das
    duas é a definição certa é pergunta de negócio.
18. **A tela de Páginas não consegue criar a primeira página.**
    `NewPageDialog.tsx:52` exige `cloneFrom`, e com a tabela vazia não há de
    onde clonar. Herdado — fazia sentido com as 26 landings da dn.ia. Some
    sozinho quando a landing da HS existir; até lá, página nova só por
    `POST /publico/paginas`.
19. **`frontend/index.html` continua mandando telemetria do admin para
    terceiros da dn.ia** (item 9, que segue aberto) — repetido aqui porque
    este lote passou perto e não resolveu; não era escopo de nenhuma tarefa
    do plano do lote 7.
20. **Os presets de UTM são gravados em duas formas diferentes** no mesmo
    array `config.utm_presets`: a rota pública grava
    `utm_source`/`utm_medium`; a tela grava `source`/`medium`/`name`.
    Herdado da `pages-api`. Medido ao vivo em 08/09/2026.
    ⚠️ A consequência que não é óbvia: preset gravado pela rota pública
    aparece na tela com os **campos em branco**, e o botão "Copiar link"
    entrega uma URL sem parâmetro nenhum — o `UTMPresetsModal` lê
    `p.source`/`p.medium`, não `p.utm_source`/`p.utm_medium`.
21. **A fusão de contatos move as conversões e não recalcula a data.**
    `backend/app/routers/escrita_contatos.py:305` reatribui as
    `lead_conversions` do contato descartado para o mantido, mas
    `last_conversion_date` não está em `_CAMPOS_HERDAVEIS` e nada recalcula
    depois — o mantido fica com a data antiga mesmo herdando conversões mais
    recentes. **É anterior ao lote 7 e não é regressão dele**; entrou aqui
    porque a revisão final do lote o encontrou e porque agora existe
    `_recalcular_datas` (em `publico.py`), o que reduz a correção a uma
    chamada. Mesma família do defeito que o lote 7 consertou em
    `POST /publico/conversao`: neste banco, data de última conversão errada
    não dá erro, dá número de painel plausível.
22. **A oferta da landing** — o que o lead ganha ao preencher. Decisão do
    Nicholson; até ela existir, a landing mostra os textos padrão.
23. **Os sete campos da dn.ia na lista branca da captura**
    (`tipo_participante`, `presenca`, `indicacao`, `interesse_formacao`,
    `interesse_ecossistema`, `interesse_mtia`, `data_interesse`) — funil de
    evento e mentoria que a HS não tem. Ficam porque as colunas existem e
    integrador externo pode estar mandando. Tirá-los é decisão de negócio.
24. **A URL pública da landing** — hoje `/p/{slug}` no backend. A URL limpa do
    anúncio depende do host de produção, que é o item 11. ⚠️ **E o nginx de
    produção precisa rotear `/p/` e `/landing/` para o backend** — em
    desenvolvimento quem faz isso é o proxy do Vite (`vite.config.ts`); sem a
    regra no nginx, todo link de anúncio cai no 404 do admin.
25. **Apagar a conta admin do Claude** (`claude.dev@example.com`) quando o
    sistema estiver funcionando. Criada em 10/09/2026, com autorização do
    Erick, para o Claude conferir telas no navegador; a credencial fica fora
    do repositório, em `~/.config/marketinghs/claude-admin.env`. Aproveitar e
    redefinir a senha de `erick@healthsafety.com.br`, que se perdeu.
    ⚠️ A restauração da VPS em 10/09 (banco de volta a 04/09) já levou a
    conta; o arquivo de credencial ficou no disco. Recriar só com ok do Erick.
26. **A marca da dn.ia ainda aparece no admin** — trabalho de transformação,
    não de visual: a aba do navegador se chama **"dn.mkt"** (`index.html`,
    `<title>` e `og:title`); há um botão flutuante **"Abrir DNIA AI"**; a ficha
    do contato mostra **"DN.IA ID"** e filtros de histórico **dnMarketing /
    Nexus / mentor.ia**; e `public/ab.js` aponta para `dnmkt.dnia.ai`.
27. **A timeline da ficha esconde reconversão feita em até 60 segundos** do
    cadastro — trata como duplicata do "Primeiro cadastro"
    (`LeadDetailSheet.tsx:130`). Herdado, intocado no porte; os dados estão
    certos no banco. Só aparece em teste ou em duplo envio.
28. **O preview do editor de Páginas é a landing de verdade** — enviar o
    formulário dentro dele cria contato e conversão reais. A origem passava
    `?preview=true`, que a casca não trata. Baixo risco, mas vale saber antes
    de alguém "testar" a página pelo preview.
29. ⚠️ **A verificação de tipos do frontend era vazia em todo lote até
    aqui** — `npx tsc --noEmit` sem `-p` checa zero arquivos e sai 0 sempre
    (`frontend/tsconfig.json` só tem `references`). Achado da Tarefa 8 do
    8A, em 10/09/2026. O comando certo é `npx tsc --noEmit -p
    tsconfig.app.json`; ele expôs um defeito real que o vazio escondia:
    `LeadScoringSettings.tsx:55` lê `result.updated` de uma resposta que vem
    `{ atualizados }` (`backend/app/routers/contatos.py:184`), e o aviso na
    tela sai "Score recalculado para undefined leads!". Uma palavra para
    consertar — não fiz porque é fora do escopo do 8A, mas é achado, não
    dúvida.
30. **Para o 8E (limpeza da marca dn.ia/Lovable):** três achados ao vivo do
    portão da Tarefa 8, em 10/09/2026. O rastreador do Lovable
    (`lovableproject.com/.../tracker.js`, em `frontend/index.html`) dispara
    de fato em toda carga do admin — hoje o navegador bloqueia a resposta
    por ORB, mas a chamada de saída da casa para um terceiro acontece
    mesmo assim. O card "Webhook de eventos", em Configurações, ainda diz
    "Configure WEBHOOK_SECRET no Supabase Secrets" — texto morto, o
    Supabase saiu e o segredo agora vive em `integration_secrets`. E há um
    card "mentor.ia" da dn.ia na mesma tela. Nenhuma tarefa do 8A tinha
    escopo sobre esses três.
31. **Lead Qualificado avança o contato para `opportunity` no ecossistema?**
    A origem avançava (`resolve_or_create_identity` com `p_stage:
    'opportunity'`) e a documentação publicada prometia; a rota do admin já
    não avança (o comentário em `mudar_status`, `escrita_contatos.py`) e o
    8B manteve as duas portas de escrita concordando: nenhuma avança hoje. Se
    a resposta for sim, é uma linha nas duas rotas ao mesmo tempo — nunca
    numa só, para não reabrir a discordância entre portas que já mordeu este
    projeto.
32. **Apagar as linhas órfãs de `journey_events`** — 1.522 no portão do 8B,
    **740** depois da restauração da VPS de 10/09 (banco de volta a 04/09) —
    ou deixar como estão. Cada rodada da
    suíte inteira acrescenta ~27 (`form_submitted`, `email_sent`,
    `email_opened`, `email_bounced`, `contact_reactivated`,
    `email_complained`) — vazamento antigo das fixtures de captura/
    conversão/envio/webhook, não do 8B. Duas formas de parar de crescer:
    limpeza numa fixture comum, ou banco de teste separado.
33. **Sync de tags vindo do CRM deve continuar pondo o contato no filtro
    "Plataforma: Nexus"?** Se sim, a rota de tags (`sincronizar_tags`,
    `api_contato.py`) volta a gravar `source_app='nexus'` (uma palavra, como
    a origem); se não, o filtro passa a depender só de `nexus_contact_id`.
    Ver a consequência da decisão 3 do 8B, no topo deste documento.

## Como subir o que existe

```bash
cd backend && ./.venv/bin/python -m uvicorn app.main:app --port 8100 --reload
cd frontend && npx vite --port 8080
cd backend && ./.venv/bin/python -m app.worker    # jornadas + fila de e-mail
```

⚠️ A porta 8000 é do **TaskHS** nesta máquina; o MarketingHS usa 8100 no host.

⚠️ Sem `RESEND_API_KEY` o worker **não consome a fila de e-mail**, de propósito
(decisão do Erick, lote 3B). As jornadas rodam; só o envio espera.

⚠️ `DATACORE_URL` usa o papel **`leitura`**, e a pool abre em
`default_transaction_read_only=on`. A sincronização é de mão única e o servidor
é quem garante.

---

## Histórico dos lotes anteriores

### O que o lote 3 deixou pronto

| | |
|---|---|
| **3A** | CRUD de campanha e template, audiência ao vivo, acompanhamento |
| **3B** | Fila (visibility timeout, recuo, fila-morta), worker, montagem por destinatário, descadastro assinado |
| **3C** | Webhook do Resend, agendador, API pública, config do Resend e supressão pela tela |

**28 testes** cobrem o motor e o webhook — as duas partes que a spec manda
nascer com teste automatizado. `pytest` inteiro: 55.

### O que o portão pegou nestes lotes, e o plano não

Vale ler antes do próximo lote, porque o padrão se repete:

1. **A rota `/descadastrar` não existia.** O worker assinava um link para ela em
   todo e-mail e daria 404.
2. **`campaigns-api` e `templates-api` também serviam integrador externo** —
   portar as telas não as tornou órfãs.
3. **O webhook estava sob o limite de taxa de `/publico`** (30/min por IP). Uma
   campanha de mil e-mails geraria milhares de eventos, e o Resend levaria 429 e
   re-tentaria por 10 horas.
4. **As rotas de supressão aceitavam usuário sem papel**, que poderia desfazer
   descadastro e hard bounce.
5. **A documentação ensinava URLs mortas** — três vezes: a tela de Documentação
   da API, o `dnmarketing-api.yaml`, e o exemplo da merge tag no editor.

Nenhum desses estava no plano. Todos apareceram porque o portão tem três partes
e a terceira é abrir no navegador.

### O que era "o próximo passo" quando o lote 3 fechou

⚠️ **Histórico — não é o próximo passo de hoje.** O de hoje está lá em cima,
e é a captação pública. Os lotes 4, 5 e 7 já fecharam.

**Lote 4 (Jornadas)** ou **lote 5 (Integrações HS)**. O 4 depende do motor, que
agora existe; o 5 traz os 2.077 clientes do DataCore e ⚠️ **exige trocar a senha
do superusuário do Postgres antes**.

Para o lote 4, o que já está levantado: as quatro funções de fila de jornada
(`journey_queue_read`, `journey_queue_delete`, `journey_enqueue_email`,
`fn_contact_event_to_journey_queue`) e a `evaluate_automation_on_etiqueta` foram
removidas do schema no lote 0 e precisam voltar em Python. A tabela de fila
`journey_events` **não existe** — o 3B criou só a de e-mail, de propósito. As
funções de jornada que SOBREVIVERAM (`journey_claim_due_runs`,
`journey_enroll_event`, `journey_wake_on_event`, `validate_journey_graph`) não
se reimplementam.

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
