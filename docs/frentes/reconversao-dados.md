# Frente `reconversao-dados` (pergunta 73)

Aberta em 26/10/2026. Spec:
`docs/superpowers/specs/2026-10-26-reconversao-dados-design.md`; plano:
`docs/superpowers/plans/2026-10-26-reconversao-dados.md`.

## Estado

✅ Pronta para merge (26/10). Branch `worktree-agent-ae7d2d7d3cd374bd5`.

## O que entrou

- **Migration 031** (`backend/migrations/031_dados_informados.sql`):
  `lead_conversions.dados_informados jsonb` (nula, sem índice, reaplicável).
  **Não aplicada.**
- **`backend/app/captura/informados.py`** (novo, puro):
  `dados_informados(campos, extras)` — nome, empresa, cargo, whatsapp,
  faturamento, funcionarios, desafios, indicacao + extras; sem status/tipo/
  UTM/A/B/vocabulário dn.ia; valor ≤ 500, ≤ 30 extras, teto de 16 KB (passou,
  os extras saem). `divergencias(contato, informados)` — caixa/espaço não
  contam, telefone comparado normalizado.
- **`registro.py`**: toda conversão grava `dados_informados` (se a coluna
  existe — tolerante à ordem do deploy); a reconversão põe
  `metadata.informados_diferentes` no `form_submitted` (contra o contato
  depois do `_atualizar`). O contato continua sem ser sobrescrito. O
  comentário falso do `_atualizar` foi corrigido.
- **`evento.py`**: `publicar_conversao(..., informados=)`.
- **CRM**: `origem_do_card` lê `to_jsonb(lc)->'dados_informados'` (sem a 031
  dá NULL, não quebra); `montar_descricao` abre com "Informou nesta conversão
  (não verificado):" + "- Rótulo: valor" + "Cadastro no MarketingHS:" quando
  há divergência (sem divergência, byte a byte igual); vale para o bloco do
  card aberto e para card novo (card novo de contato antigo com cards só
  ganhos/perdidos). `texto_da_nota(conversao, quando, lead)` termina com os
  valores. Travas intactas: `uma_linha`, cortes, PUT só `description`,
  `TETO_DA_DESCRICAO`, marca do bloco.
- **`EventsTimeline.tsx`**: quadro "Informou nesta conversão (não
  verificado)" no evento com `informados_diferentes`; o "ver detalhes" não
  lista mais essa chave. Só token; guarda 0; `tsc` 0.

## Testes

- `tests/test_reconversao_dados.py` (novo, 25): puros + banco em transação
  revertida com `lead_conversions` TEMPORÁRIA (o `pg_temp` vem antes do
  `public`; a 031 é aplicada nela, duas vezes).
- `tests/test_crm_entrega.py`: +1 (bloco e nota com os valores informados).

## Perguntas

- **Adotar o que o lead informou** (botão na ficha, admin autenticado): é o
  caminho seguro para atualizar o contato, se o Erick quiser — não feito
  (fora do território: `escrita_contatos`/ficha).
- **Ficha → aba de conversões** (`leitura_contatos.py`, fora do território)
  poderia mostrar `dados_informados` de cada conversão.

## Para a coordenadora

1. Aplicar a 031 (duas vezes, para provar que é reaplicável):

   ```bash
   set -a; . ~/marketinghs.env; set +a
   PGPASSWORD="$POSTGRES_PASSWORD" psql \
     "postgresql://${POSTGRES_USER}@${POSTGRES_HOST_EXTERNO}:${POSTGRES_PORTA_EXTERNA}/${POSTGRES_DB}" \
     -1 -v ON_ERROR_STOP=1 -f backend/migrations/031_dados_informados.sql
   ```

   Ordem com o deploy: tanto faz (o código tolera a coluna ausente). Sem a
   031, só a linha do tempo mostra a divergência (`informados_diferentes`
   é `metadata` do evento); o bloco e a nota do card dependem da coluna.
2. Deploy de api, worker e sistema.
3. Prova: reconverter um lead de teste com outra empresa/telefone → ficha
   mostra o quadro; card aberto ganha o bloco com "Informou nesta conversão".
