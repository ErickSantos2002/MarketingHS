# GrowthHS — homologação e produção lado a lado — plano

> **Para quem executa:** execução nativa (modo autônomo da frente), TDD tarefa
> por tarefa, commit por tarefa, revisão da branch no fim.

**Objetivo:** duas configurações completas do GrowthHS (homologação e
produção) salvas ao mesmo tempo, um ambiente ativo, e todo id do GrowthHS
carimbado com o ambiente.

**Arquitetura:** `growthhs_config` vira uma linha por ambiente (`ambiente`,
`ativo`); os segredos ganham sufixo do ambiente; `ler_config()` devolve o
ativo; o webhook ganha `{ambiente}` no caminho; `crm_handoffs.ambiente` e
`ecosystem_identities.growthhs_ambiente` dizem de que GrowthHS é cada id.

**Spec:** `docs/superpowers/specs/2026-10-23-growthhs-dois-ambientes-design.md`

## Restrições globais

- Ambientes: exatamente `'homologacao'` e `'producao'`.
- Segredos: `GROWTHHS_CLIENT_SECRET_HOMOLOGACAO`, `GROWTHHS_CLIENT_SECRET_PRODUCAO`,
  `GROWTHHS_WEBHOOK_SECRET_HOMOLOGACAO`, `GROWTHHS_WEBHOOK_SECRET_PRODUCAO`.
- Webhook: `POST /publico/growthhs/webhook/{ambiente}?evento=`; ambiente
  inativo com assinatura válida → 200 ignorado; sem segredo → 503.
- Ativar ambiente incompleto → 400. Trocar não reenvia nada.
- Id com ambiente NULL ou diferente do ativo = não confiável.
- 030 reaplicável; provada em temporária dentro do teste; quem aplica em
  produção é o Erick.
- pytest só nos arquivos tocados, um por vez, com `systemd-inhibit`.

## Como os testes enxergam a 030 antes de ela existir em produção

`tests/growthhs_banco.py` ganha `aplicar_030(conexao)`: se a coluna
`growthhs_config.ambiente` não existe, cria cópias TEMPORÁRIAS
(`LIKE ... INCLUDING ALL`) de `growthhs_config`, `crm_handoffs` e
`ecosystem_identities` e aplica o SQL da 030 nelas (nome trocado para
`pg_temp`). `test_crm_entrega.py` grava fora de transação; enquanto a 030
não existe, um fixture autouse desvia `sessao` (de `app.database`,
`app.crm.entrega`, `app.crm.growthhs`, `app.integracoes`) para UMA conexão
em transação revertida com as cópias, serializada por `asyncio.Lock`.
Depois da 030 aplicada de verdade, nada disso roda.

## Review Focus

1. Pedido de lead sem e-mail com `person_id` gravado em OUTRO ambiente —
   não pode ser reusado (pessoa de outro GrowthHS). Teste na Tarefa 3.
2. Webhook repetido do mesmo card/timestamp em ambientes diferentes — a
   deduplicação inclui o ambiente. Teste na Tarefa 4.
3. Ambiente ativo que fica incompleto depois (secret apagado pela troca de
   endereço) — continua ativo, `configurado` falso, fila espera, tela avisa.
   Teste na Tarefa 5.
4. Linha antiga de `growthhs_config` sem ambiente na hora da 030 — vira
   `homologacao`, **inativa** (não entrega para lugar nenhum até alguém
   escolher). Teste na Tarefa 1.
5. Prévia de automação: identidade de outro ambiente não exclui o lead.
   Teste na Tarefa 4.

---

### Tarefa 1: migration 030 e `Config` por ambiente

**Arquivos:** `backend/migrations/030_growthhs_ambientes.sql`,
`backend/app/crm/growthhs.py`, `backend/tests/growthhs_banco.py`,
`backend/tests/test_growthhs_ambientes.py` (novo),
`backend/tests/test_growthhs_config_029.py`.

**Produz:** `growthhs.AMBIENTES = ("homologacao", "producao")`;
`segredo_cliente(amb) -> str`, `segredo_webhook(amb) -> str`;
`Config.ambiente: str | None = None` (e `configurado` exige ambiente);
`ler_config() -> Config` (o ativo; nenhum = vazio, listas padrão);
`ler_config_do_ambiente(amb) -> Config`.

- [ ] Teste `test_030_reaplicavel`: temporárias com a forma pós-029 (incl.
  índice `((true))`), uma linha sem ambiente; aplica 2×; confere colunas,
  linha velha = `homologacao`/inativa, duas linhas cabem (índice único
  antigo saiu), `UNIQUE(ambiente)`, segundo ativo recusado, `CHECK` recusa
  `'teste'`.
- [ ] Testes `test_ler_config_so_devolve_o_ativo`, `test_sem_ativo_nao_configurado`,
  `test_segredo_e_do_ambiente`, `test_ler_config_do_ambiente`.
- [ ] Falham → implementar → passam → commit.

### Tarefa 2: rotas de configuração por ambiente

**Arquivos:** `backend/app/routers/configuracao.py`,
`backend/tests/test_config_growthhs.py`.

**API:** `GET /config/growthhs` → `{ativo, ambientes: {homologacao: {...},
producao: {...}}, fila}`; `PUT /config/growthhs/{ambiente}` (corpo de hoje);
`POST /config/growthhs/{ambiente}/testar`; `POST /config/growthhs/ativar`
`{ambiente}` (400 se incompleto); `POST /config/growthhs/reenfileirar`
igual. `webhook_urls` de cada ambiente com `/webhook/{ambiente}?evento=`.

- [ ] Testes: gravar um ambiente não mexe no outro; troca de endereço sem
  secret apaga só o secret daquele ambiente; ativar incompleto 400; ativar
  troca (um ativo por vez); testar usa o do ambiente; ambiente inválido 404.
- [ ] Commit.

### Tarefa 3: entrega carimba o ambiente

**Arquivos:** `backend/app/crm/entrega.py`, `backend/tests/test_crm_entrega.py`.

- `_marcar_entregue` e `_gravar_pessoa_do_pedido` gravam `ambiente`.
- `person_id` do pedido só é reusado se `pedido.ambiente == cfg.ambiente`.
- Identidade: ambiente diferente (ou NULL) do atual → card, pessoa e
  ambiente sobrescritos; mesmo ambiente → `coalesce` de hoje.
- [ ] Testes: entrega grava ambiente no pedido e na identidade; identidade
  de outro ambiente é sobrescrita; mesmo ambiente não; `person_id` de outro
  ambiente não é reusado.
- [ ] Commit.

### Tarefa 4: leitura do card id e webhook por ambiente

**Arquivos:** `backend/app/crm/volta.py`, `backend/app/routers/publico.py`,
`backend/app/main.py` (comentário da isenção),
`backend/app/routers/leitura_contatos.py`, `backend/app/routers/automacoes.py`,
`backend/tests/test_growthhs_webhook.py`, `backend/tests/test_leitura_growthhs.py`,
`backend/tests/test_conversao_authenticated.py` (só a consulta esperada da prévia).

- [ ] Testes: segredo de um ambiente não vale no outro (401); evento do
  inativo 200 sem mudar status; card id de outro ambiente não casa (cai no
  e-mail); dedup por ambiente; enriquecimento esconde card de outro ambiente;
  rota antiga sem ambiente 404/405; isenção do limite cobre o prefixo.
- [ ] Commit.

### Tarefa 5: tela com duas abas

**Arquivos:** `frontend/src/components/admin/settings/GrowthHSCard.tsx`.

- Abas Homologação/Produção (primitivo `Tabs`), cada uma com os campos, o
  Testar e as URLs do webhook dela; topo com o ativo em destaque; "Usar este
  ambiente" na aba inativa com `AlertDialog` ("os leads passam a ir para a
  Produção do GrowthHS"); aviso sem ativo; aviso de ativo incompleto.
- [ ] `tsc` sem erro novo; `guarda:visual` limpo no arquivo; conferir-telas.
- [ ] Commit.

### Tarefa 6: registro e revisão

- [ ] `docs/frentes/growthhs-ambientes.md` (estado, decisões, perguntas).
- [ ] Revisão da branch (superpowers:requesting-code-review), correções, push.
