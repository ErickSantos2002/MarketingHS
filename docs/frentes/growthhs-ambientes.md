# Frente `growthhs-ambientes`

Spec: `docs/superpowers/specs/2026-10-23-growthhs-dois-ambientes-design.md`.
Plano: `docs/superpowers/plans/2026-10-23-growthhs-ambientes.md`. Branch
`worktree-agent-a171e791231ba01e0` (subagente com worktree).

## Estado (23/10)

- [x] Tarefa 1 — migration 030 e `Config` por ambiente
- [x] Tarefa 2 — rotas de configuração por ambiente + ativar
- [x] Tarefa 3 — entrega carimba o ambiente
- [x] Tarefa 4 — webhook por ambiente; leitura do card id só no ativo
- [x] Tarefa 5 — tela com abas
- [x] Revisão da branch — ver "Revisão" abaixo
- **A 030 NÃO foi aplicada.** Ver "Para a coordenadora".

## O que entrou

**Banco (030).** `growthhs_config` vira uma linha por ambiente:
`ambiente text NOT NULL CHECK (homologacao|producao)` com índice único
(`growthhs_config_um_por_ambiente`), `ativo boolean NOT NULL DEFAULT false`
com índice único parcial `WHERE ativo` (`growthhs_config_um_ativo`); o índice
de linha única da 018 (`growthhs_config_linha_unica`) sai. Linha que já
exista sem ambiente vira `homologacao` **inativa**. `crm_handoffs.ambiente` e
`ecosystem_identities.growthhs_ambiente` (texto, NULL permitido = "não
confiável", CHECK nos dois valores). Reaplicável (provada duas vezes em
temporária: `test_030_reaplicavel`).

**Segredos.** `GROWTHHS_CLIENT_SECRET_<AMBIENTE>` e
`GROWTHHS_WEBHOOK_SECRET_<AMBIENTE>` (`growthhs.segredo_cliente/webhook`). Os
antigos sem sufixo não são lidos por ninguém.

**Leitura.** `ler_config()` = o ativo (`Config.ambiente`); nenhum ativo =
"não configurado". `Config.configurado` exige `ambiente`; `Config.completo` é
só os campos (o que "Usar este ambiente" exige).
`ler_config_do_ambiente(amb)` serve à tela e ao Testar.

**API.** `GET /config/growthhs` → `{ativo, configurado, ambientes:
{homologacao, producao}, fila}`; `PUT /config/growthhs/{ambiente}`;
`POST /config/growthhs/{ambiente}/testar`; `POST /config/growthhs/ativar`
`{ambiente}` (400 com o que falta se incompleto; trava consultiva contra dois
admins ao mesmo tempo); `reenfileirar` igual. Ambiente desconhecido → 404.
As rotas antigas `PUT /config/growthhs` e `POST /config/growthhs/testar`
saíram.

**Entrega.** Grava `ambiente` no pedido (entregue e pessoa criada para lead
sem e-mail) e na identidade; identidade de outro ambiente (ou NULL) é
sobrescrita, do mesmo ambiente só preenche (como antes). `person_id` do
pedido só é reusado no mesmo ambiente. O evento `crm_handoff` leva
`ambiente`.

**Volta.** `POST /publico/growthhs/webhook/{ambiente}`; segredo daquele
ambiente; ambiente inativo com assinatura válida → `200 {"ignorado": true,
"inativo": true}`; rota antiga sem ambiente → 404. `lead_do_card` só casa id
gravado no ambiente do webhook; a deduplicação inclui o ambiente; o evento
leva `metadata.ambiente`. Isenção do limite por IP: prefixo
`/publico/growthhs/webhook/` (cobre os dois).

**Leituras do card id.** `/contatos/enriquecimento` só devolve
`growthhs_card_id`/link se o ambiente da identidade é o ativo; a prévia de
automação só exclui quem tem card no ambiente ativo.

**Tela.** Duas abas (Homologação/Produção, a ativa marcada), cada uma com os
campos, Salvar, Testar e as URLs do webhook dela; no topo, faixa verde "Os
leads vão para a X" ou faixa amarela "Nenhum ambiente ativo"; badge do card
diz qual está ativo. "Usar este ambiente" na aba inativa, com confirmação
("Os leads passam a ir para a Produção do GrowthHS… nada é reenviado"),
desabilitado se incompleto ou com alteração não salva (e o texto diz o que
falta). Aviso se o ativo ficar incompleto. Fila embaixo, comum aos dois.
Conferida com `conferir-telas.mjs` (claro/escuro, 1440/390) sobre um backend
de conferência com estado fixo — a leitura real precisa da 030.

## Decisões assumidas (seguras e reversíveis)

1. Linha antiga sem ambiente na hora da 030 → `homologacao`, **inativa**
   (nada é entregue até alguém escolher). Em 23/10 a tabela estava vazia.
2. Trocar de ambiente apaga, na identidade, o card/pessoa do outro ambiente
   (sobrescreve na próxima entrega). Voltar ao ambiente anterior não recupera
   o id antigo da identidade (o histórico continua em `crm_handoffs`).
3. Sem rota de "desativar" (nenhum ambiente ativo): a spec só pede a troca.
   Para parar a entrega, como antes, apagar o secret do ativo.
4. Webhook com ambiente desconhecido no caminho → 404 (só um GrowthHS
   desconfigurado chega lá).

## Perguntas

1. **Gatilho da 020 não sabe de ambiente.** A regra de automação não
   reenfileira lead que já tem `crm_handoffs` `entregue` — de QUALQUER
   ambiente. Lead entregue na homologação durante a prova não vai sozinho
   para a produção pela regra depois da troca (jornada e botão manual vão).
   A prévia de automação agora conta esse lead como "pegaria" (spec), então
   prévia e gatilho divergem para ele. **Assumido:** não mexer na função do
   gatilho (fora do pedido; mudar exige recriar a função de ~160 linhas da
   023 na 030 — e a decisão 7 da spec, "trocar não reenvia nada", sustenta
   o comportamento de hoje). A revisão classificou como importante: depois
   da troca, lead já entregue na homologação só chega à produção por jornada
   ou botão. Opções: (a) gatilho olhar só `entregue` com `ambiente` = ativo
   (031); (b) a prévia voltar a imitar o gatilho (contrária à decisão 5 da
   spec); (c) deixar e reenviar à mão os poucos da prova.

## Para a coordenadora

- **Aplicar a 030 ANTES do deploy**, com o dono das tabelas (o
  `marketinghs_app` não é dono). Depois dela, o código antigo não grava mais
  a configuração (perde o `ON CONFLICT ((true))`) e o worker antigo cai em
  "não configurado" — então 030 e deploy de api + worker + sistema juntos.
  Rodar duas vezes para provar.
- ⚠️ **Bloqueia o MERGE, não só o deploy:** sem a 030 no banco, o código
  novo dá 500 no enriquecimento da lista de contatos, na prévia de
  automação e na tela do GrowthHS. Aplicar a 030 antes (ou junto) do merge.
- **Testes que precisam da 030 aplicada** (fora do meu território, não os
  rodei): `test_regra_sem_tag.py::test_previa_sem_tag_continua_contando` e,
  em `test_conversao_authenticated.py`, a prévia e o
  enriquecimento — sem a coluna, `UndefinedColumnError`. Atualizei a consulta
  esperada da prévia em `test_conversao_authenticated.py` (anotado aqui por
  estar fora da lista de arquivos). Os de CRM/GrowthHS rodam antes e depois
  da 030 (`growthhs_banco.aplicar_030` e o `_banco_da_030` de
  `test_crm_entrega.py` copiam as tabelas para `pg_temp` só enquanto ela não
  existe).
- Depois do deploy: configurar a Homologação, "Usar este ambiente", e
  recadastrar no GrowthHS as URLs novas (`/webhook/homologacao?evento=…`)
  com o segredo novo — os nomes de segredo mudaram.
- Os ids da prova (21–22/10) ficam NULL de ambiente = ignorados pela volta e
  pelo link; o script de limpeza continua valendo, mas deixou de ser
  bloqueante.

## Revisão (revisor independente, fim da branch)

Nada crítico. Tratados:
- **Ativar conferia fora da trava** → reconfere dentro da trava consultiva,
  direto no banco (linha `FOR UPDATE` + segredo sem cache), 409 se mudou; o
  PUT toma a mesma trava.
- **Pausa do ambiente anterior sobrevivia à troca** → ativar solta os
  pedidos pausados (`erro` da pausa zerado, visíveis na hora).
- **Webhook com config ilegível virava "inativo" em INFO** → sem ambiente
  ativo é `warning` (continua 200).
- **CHECK nas tabelas grandes** → `NOT VALID` + `VALIDATE`; aplicar com
  `psql -1`.
- **Fixture `_banco_da_030`** → `MonkeyPatch` próprio; documentado que a
  trava não é reentrante e que o gatilho grava em `public.crm_handoffs`;
  não segura conexão quando o teste usa `conexao` (travava o `close_db`).

Não tratados (registrados):
- **Gatilho da regra x ambiente** — ver Pergunta 1.
- **Troca no meio de um ciclo do worker:** o ciclo lê a config uma vez;
  até `limite` (20) pedidos já reivindicados no momento do clique ainda vão
  para o ambiente anterior — com o carimbo certo (o do ambiente usado), sem
  corromper nada. A confirmação diz "passam a ir"; é questão de segundos.
- **Segredos antigos no ambiente do EasyPanel:** se `GROWTHHS_CLIENT_SECRET`
  / `GROWTHHS_WEBHOOK_SECRET` existirem no env de api/worker, ficam órfãos
  (ninguém lê). Conferir por script sem imprimir valor e remover.
- **Testes de `banco_growthhs` seguram lock em linha real** (`DELETE FROM
  growthhs_config`) enquanto rodam, depois da 030 aplicada — padrão que já
  existia; um "Salvar" real durante a suíte espera.
