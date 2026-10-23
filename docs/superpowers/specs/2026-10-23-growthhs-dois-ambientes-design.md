# GrowthHS — homologação e produção salvos lado a lado

**Pedido do Erick (23/10/2026):** "configurar um espaço para o ambiente de
homologação e o ambiente de produção separados mas deixar salvo logo? para
não ter que ficar trocando um pelo outro".

Base: `docs/superpowers/specs/2026-10-22-growthhs-real-design.md` e o que a
frente `growthhs-real` entregou (`app/crm/growthhs.py`, `entrega.py`,
`volta.py`, `routers/configuracao.py`, `routers/publico.py`,
`GrowthHSCard.tsx`, migration 029).

## O que é

Duas configurações completas do GrowthHS guardadas ao mesmo tempo —
**Homologação** e **Produção** — e um seletor de **ambiente ativo**. Trocar de
ambiente é um clique (com confirmação), sem redigitar nada.

Estado de hoje: `growthhs_config` está **vazia** e não há nenhum segredo
`GROWTHHS_*` em `integration_secrets` — nada a migrar.

## Decisões (da coordenadora; reversíveis)

1. **Banco (migration 030, reaplicável):** `growthhs_config` ganha
   `ambiente text NOT NULL` com `CHECK (ambiente IN ('homologacao','producao'))`
   e `UNIQUE`, e `ativo boolean NOT NULL DEFAULT false` com índice único
   parcial `WHERE ativo` (no máximo um ativo). Uma linha por ambiente.
2. **Segredos por ambiente** em `integration_secrets`:
   `GROWTHHS_CLIENT_SECRET_HOMOLOGACAO`, `GROWTHHS_CLIENT_SECRET_PRODUCAO`,
   `GROWTHHS_WEBHOOK_SECRET_HOMOLOGACAO`, `GROWTHHS_WEBHOOK_SECRET_PRODUCAO`.
   A regra "trocar o endereço sem mandar o secret apaga o secret" vale por
   ambiente.
3. **`ler_config()` devolve a do ambiente ativo** (e `Config` passa a saber
   `ambiente`). Nenhum ativo = "não configurado" (a fila espera, como hoje).
   Uma função para ler um ambiente específico serve à tela e ao "Testar".
4. **Webhook da volta com um endereço por ambiente:**
   `POST /publico/growthhs/webhook/{ambiente}`; a assinatura é conferida com o
   segredo **daquele** ambiente (é isso que amarra o evento ao ambiente — o
   caminho sozinho não é assinado). Evento válido de um ambiente **inativo**
   responde **200 e é ignorado** (o GrowthHS desliga a automação depois de 5
   respostas não-2xx). A rota antiga sem `{ambiente}` sai (nada aponta para
   ela ainda). Ambiente sem segredo → 503, como hoje. A isenção do limite por
   IP em `app/main.py` passa a cobrir o prefixo.
5. **Ids do GrowthHS carimbados com o ambiente.** Card 26 da homologação não é
   o card 26 da produção. `crm_handoffs` ganha `ambiente text` e
   `ecosystem_identities` ganha `growthhs_ambiente text` (preenchidos na
   entrega). Leitura de card id (volta, link "Ver no GrowthHS",
   `automacoes.py:249`, `leitura_contatos.py`) só confia no id cujo ambiente é
   o ativo; na entrega, identidade carimbada com **outro** ambiente pode ser
   sobrescrita (hoje é `coalesce`, só preenche NULL). Linhas antigas com
   ambiente NULL: tratadas como "não confiável" (são só as 4 da prova, que o
   script de limpeza zera).
6. **Tela (Configurações → GrowthHS):** duas abas, Homologação e Produção,
   cada uma com os campos de hoje, o próprio "Testar" e o próprio endereço do
   webhook para copiar. No topo, o ambiente ativo em destaque e o botão
   "Usar este ambiente" na aba do outro, com confirmação que diz o que muda
   ("os leads passam a ir para a Produção do GrowthHS"). Ativar ambiente
   incompleto é recusado (400), não silencioso. Sem ambiente ativo, um aviso
   claro.
7. **Trocar de ambiente não reenvia nada.** Pedidos já entregues ficam onde
   estão; os pendentes vão para o ativo no momento da entrega.

## Fora

- Não muda o desenho da entrega (pessoa por e-mail, card aberto atualizado +
  nota, card novo na lista de entrada) nem o da volta (lista assinada,
  replay ±10 min).
- Não mexe no `hsgrowth-sistema`.

## Prova de que funciona

Testes: ativar ambiente incompleto recusa; um ativo por vez; `ler_config` só
devolve o ativo; segredo de um ambiente não vale no webhook do outro; evento do
inativo dá 200 e não muda status; card id de outro ambiente não casa na volta
nem vira link; identidade de outro ambiente é sobrescrita na entrega.
Migration 030 aplicada duas vezes numa temporária.
