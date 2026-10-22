# Frente `prova-jornadas`

Plano: `docs/superpowers/plans/2026-10-21-prova-substituir-rd.md` — Tarefas
7, 8 e 9. Território: linha `prova-jornadas` da seção "Frentes" do plano.
n 18 · Vite 8098 · backend 8118. Branch `prova-jornadas`.

## Estado (21/10)
- [x] Tarefa 7 — modo teste da jornada (`8ce8ef9`)
- [x] Tarefa 8 — nós "avisar por e-mail" e "enviar para webhook" pela caixa de saída (`d95caf6`)
- [x] Tarefa 9 — PDF para a ficha técnica (`d1cd202`)
- [x] Correção de segurança pedida pela coordenadora: SSRF no webhook (`7ee3a0e`)
- [x] Segunda rodada: DNS rebinding — o POST vai para o IP conferido (`b5af490`)
- [x] Revisão da branch, 7 itens (`20f917e`…`75f7c21`, um commit por item — ver abaixo)
- **Pronto para merge.**

## O que entrou

**Tarefa 7.** `JornadaIn`/`JornadaPatch` ganham `allowed_emails` (aparado,
minúsculo, sem repetidos, formato de e-mail, no máximo 50; `[]` vira NULL);
volta no `GET /jornadas` e no detalhe. `executor.NOS_COM_EFEITO` (`send_email`,
`handoff_growthhs`, `notify_email`, `webhook`) e `executor.contato_permitido`
(lido uma vez por run): fora da lista, o passo vira `skipped` com
`{"motivo": "modo teste: contato fora da lista"}`, nada é criado e o fluxo
segue. Segunda trava no `worker._processar`: e-mail de jornada para fora da
lista vira `failed` / `modo teste: fora da lista`, sem chamar o Resend.

**Tarefa 8.** `app/jornadas/saidas.py`: `enfileirar`, `dados_do_lead`,
`montar_aviso` (todo valor com `html.escape`), `montar_webhook`,
`rodar_saidas`; `worker._laco_saidas` ao lado do `_laco_entregas`, com o
mesmo `_compasso` do envio. `ritmo.SQL_USO`/`SQL_PRIMEIRO_DIA` contam os
avisos enviados (um por id do Resend).

**Tarefa 9.** `POST /arquivos`, `GET /arquivos`, `GET /publico/arquivo/{id}`
em `routers/imagens.py`. Desde a revisão (item 6) o PDF sai como
`attachment` com `nosniff`, sem `CSP: sandbox`.

**SSRF (pedido da coordenadora).** `saidas.conferir_forma_da_url` (sem DNS: rota
e nó) e `saidas.conferir_destino` (com DNS: worker, antes de conectar). Recusa
loopback, privado, ULA, link-local (169.254.169.254), CGNAT 100.64/10,
multicast, reservado, não especificado, não global, IPv4 mapeado em IPv6,
`localhost`, nome sem ponto, credencial na URL e qualquer coisa sem `https://`.
Recusa = `falhou` sem nova tentativa; DNS fora do ar reagenda; redirecionamento
não é seguido. A rota que salva a jornada responde 400 com o motivo.

**DNS rebinding (segunda rodada).** `conferir_destino` resolve UMA vez e
devolve o IP conferido; o POST vai para `https://<ip>[:porta]/<caminho>` (IPv6
entre colchetes) com `Host: <nome original>` e `extensions={"sni_hostname":
<nome>}` — o TLS valida o certificado do nome (o `httpcore` instalado lê a
extensão em `_async/connection.py`). Teste com resolvedor que responde IP
público na 1ª consulta e interno nas seguintes: o pedido sai para o IP público,
com Host/SNI do nome, e o nome é resolvido uma vez só.

**Revisão da branch (21/10, noite) — um commit por item, todos com teste.**
1. `20f917e` — reivindicação só com `tentativas < MAX_TENTATIVAS`; pendente
   vencida que esgotou vira `falhou` (falha depois da chamada, ex.
   `_marcar_enviado` estourando, não reenvia sem fim).
2. `b578625` — teto do Resend: aviso reivindicado por **destinatários** que
   faltam; `SQL_USO` conta aviso com `resend_email_id` mesmo sem
   `enviado_em` (`coalesce(enviado_em, atualizado_em)`); `Uso.reservados`
   (fila de e-mail reivindicada + destinatários de aviso reivindicado) e
   `ritmo.cota_de`, que desconta; `ritmo.travar_cota`
   (`pg_advisory_xact_lock(7270027018)`) em volta de medir + reivindicar no
   `worker._tick` **e** no laço das saídas.
3. `e92189d` — modo teste ligado: cada destinatário do `notify_email` tem de
   estar na lista. A rota (POST e PATCH, com lista e nós **em vigor**)
   responde 400 `nó <id>: com o modo teste ligado, o aviso só pode ir para
   e-mails da lista — fora dela: …`; `_mandar_aviso` relê a lista, pula quem
   está fora (`payload.pulados`) e falha se não sobrar ninguém. Sem modo
   teste, qualquer endereço. Regra única em `app/jornadas/modo_teste.py`.
4. `363f0e6` — aviso e webhook reconferem o **contato** na hora de sair
   (`modo_teste.na_lista` sobre a lista em vigor): fora, `falhou` com `modo
   teste: contato fora da lista`. **A entrega ao CRM (`app/crm/entrega.py`)
   é da `prova-captura`** — não mexi; ver pergunta 4.
5. `ef90a12` — webhook por `stream`, só o status (corpo nunca lido; sair do
   bloco fecha); prazo total `asyncio.wait_for(…, 15)`; avisos drenados
   antes dos webhooks.
6. `75f7c21` — PDF: `Content-Disposition: attachment`, `nosniff`, sem CSP.
7. **Rotas admin de PDF continuam em `service_role`:** `email_assets` não tem
   RLS nem política, e `authenticated` não tem GRANT nela (conferido no banco
   pelo perfil de leitura: `relrowsecurity = false`, 0 políticas). Trocar para
   `authenticated` derrubaria a rota. Ver pergunta 5.

## Desvios do plano (todos pequenos, todos para o lado seguro)

1. **Tolerância à falta da 027.** Leitura de `allowed_emails` por
   `to_jsonb(j)->'allowed_emails'` (rota, executor, worker) e `ritmo.medir`
   escolhendo o SQL conforme `journey_saidas` exista: um banco sem a 027 segue
   como antes, em vez de derrubar a listagem de jornadas, todo nó com efeito e
   o worker inteiro. Com a 027 o comportamento é o do plano.
2. **`rodar_saidas` ganhou `compasso=` e `somente=`.** `compasso` é o do
   worker (um 429 segura os dois laços); `somente` é para os testes não
   reivindicarem saída real de produção (molde do `somente_lead` da entrega).
3. **Aviso para vários endereços:** uma chamada ao Resend por destinatário
   (o cliente do Resend manda para um só, e `app/email/` não é desta frente).
   Cada envio é anotado na hora (`payload.enviados`, `resend_email_id`
   acumulado por vírgula): a volta depois de uma falha não reenvia a quem já
   recebeu, e o teto conta um por id.
4. **3xx do webhook = `falhou`** (o plano só falava de 2xx/4xx/5xx):
   redirecionamento não é seguido de propósito, e re-tentar não muda nada.
   O mesmo vale para erro HTTP do Resend no aviso (4xx falha, 5xx reagenda).
5. **A rota de imagem deixa de servir o que está em `pasta = 'arquivos'`**
   (espelho do "a rota de arquivo não serve imagem"): sem isso o PDF sairia
   por `/publico/imagem/<id>` sem `nosniff` nem `attachment`.
6. **Lista vazia gravada direto no banco (`{}`) não libera ninguém.** Só a
   rota transforma `[]` em "sem modo teste" (NULL) — Review Focus 4.

## Portão

- `count(*) FROM leads`: **2.107 antes e 2.107 depois** de cada tentativa de
  suíte (inclusive as interrompidas).
- 027 aplicada em produção (conferido `to_regclass('public.journey_saidas')`
  pelo perfil de leitura): os testes desta frente rodaram **sem pular**.
- Arquivos tocados, no banco de produção: `test_prova_jornadas.py` 25 passed;
  `test_prova_saidas` + `test_prova_jornadas` + `test_ritmo` +
  `test_worker_ritmo` + `test_worker_aviso` + `test_ritmo_envio` 104 passed
  (antes do SSRF); `test_prova_arquivos.py` 15 passed. Num Postgres 17 local
  descartável com 000…027: os mesmos, mais `test_migracao_027`, 123 passed;
  depois do SSRF, `test_prova_saidas` + `test_prova_jornadas` 86 passed.
- Arquivos tocados depois da revisão (Postgres 17 local com 000…027):
  `test_prova_saidas` + `test_prova_jornadas` 108 passed; `test_prova_arquivos`
  15 passed; `test_prova_saidas` + `test_worker_ritmo` + `test_ritmo` +
  `test_ritmo_envio` + `test_worker_aviso` 120 passed (no item 2).
- **Suíte inteira: NÃO fechou nesta frente.** 1ª tentativa morta no
  `timeout 3600` (rodou em paralelo com a da `prova-captura`); 2ª interrompida
  por mim (SIGINT, a pedido, para a revisão) com 74 passed; 3ª (17:08 de 21/10,
  sozinha ao começar) parou com a suspensão da máquina à noite e foi morta pela
  coordenadora (`saida=143`), ~25% feita, tudo verde até ali. Por ordem da
  coordenadora, a suíte inteira da branch fica com ela (uma por vez, com a
  suspensão bloqueada).
- Nada em `frontend/`: `tsc`, guarda e builds não se aplicam a esta frente.

## Perguntas / fora do território

1. ~~DNS rebinding no webhook~~ — fechado na segunda rodada (IP fixado).
2. **`resend.enviar` com vários destinatários** (`app/email/resend.py`, fora
   do território) deixaria o aviso para N endereços numa chamada só. Assumido:
   um envio por destinatário, sem mexer no cliente.
3. A tela (`prova-telas`) precisa saber: `allowed_emails` volta em
   `GET /jornadas` e no detalhe; `PATCH` com `[]` desliga o modo teste; a rota
   recusa webhook interno com 400 e `detail` começando por `nó <id>: webhook
   recusado: …`, e aviso para fora da lista do modo teste com 400 `nó <id>:
   com o modo teste ligado, …`; `POST /arquivos` devolve `url_publica`.
4. **Entrega ao CRM reconferindo o modo teste na hora de sair** (item 4 da
   revisão) — `app/crm/entrega.py` é território da `prova-captura`. Hoje o
   nó `handoff_growthhs` já é barrado no executor para contato fora da lista
   (nada é enfileirado), mas a fila `crm_handoffs` não relê a lista ao
   entregar. Para a `prova-captura`: em `_entregar`, se `pedido.journey_run_id`
   não for nulo, ler `journeys.allowed_emails` pelo run e falhar o pedido com
   `modo teste: contato fora da lista` quando `modo_teste.na_lista(lista,
   lead.email)` for falso.
5. **RLS em `email_assets`** para as rotas admin de imagem/PDF poderem usar
   `authenticated`: exigiria migration (política admin + GRANT), que não é
   desta frente. Assumido: `service_role` com `admin_atual` na rota.
