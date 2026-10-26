# Reconversão com dados diferentes — design

**Data:** 26/10/2026 · **Frente:** `reconversao-dados` · **Pergunta:** 73 de
`docs/perguntas-abertas.md`.

## O problema

No teste de leads de 26/10, um contato que já existia
(`healthsafetyti+lead1@gmail.com`, "Empresa Teste HS Filial Sul",
(11) 99999-0002) reconverteu pela `phoebus-prova` digitando "Empresa Teste HS
Matriz" e (11) 99999-0003.

1. `captura/registro.py::_atualizar` não sobrescreve o contato. **Certo e
   deliberado** (R1, 02/10: a rota é anônima; quem sabe o e-mail não pode
   trocar dado de cliente). Não muda.
2. O comentário dali dizia que o que a pessoa digitou "continua registrado
   onde é histórico: `lead_conversions`". **Falso**: `lead_conversions` só
   guarda origem (UTMs, página, formulário, site, visitante, URL, canal, A/B).
   O evento `form_submitted` de reconversão também não guarda os valores.
   Os valores digitados se perdiam.
3. A jornada mandou o lead ao GrowthHS pelo caminho "outro card aberto → anexa
   bloco + nota". O bloco é montado do CONTATO e mostra Filial Sul/0002 sob o
   cabeçalho "(dados informados no formulário, não verificados)"; a nota não
   traz dado nenhum. O vendedor não vê o que o lead escreveu.

## Decisão (assumida — a mais segura e reversível)

Guardar o que veio em **cada** conversão e **mostrar** onde a divergência
importa; o contato e a pessoa do GrowthHS continuam **sem** ser sobrescritos.
A alternativa (sobrescrever o contato) reabre o furo do R1.

### 1. Migration 031 — `lead_conversions.dados_informados jsonb`

`ALTER TABLE public.lead_conversions ADD COLUMN IF NOT EXISTS
dados_informados jsonb;` — nula, sem default, sem índice (ninguém filtra por
ela; é lida por linha). Reaplicável. Sem `CREATE EXTENSION`. A coluna herda o
GRANT e as políticas da tabela (que são de tabela, não de coluna).

### 2. O que entra — `captura/informados.py::dados_informados`

Só os **campos de contato** que já passaram pela lista branca (`higienizar` /
`validar` / `mapear`):

| chave | rótulo |
|---|---|
| `nome` | Nome |
| `empresa` | Empresa |
| `cargo` | Cargo |
| `whatsapp` | Telefone |
| `faturamento` | Faturamento |
| `funcionarios` | Funcionários |
| `desafios` | Desafios |
| `indicacao` | Indicação |

Mais os **extras** (`leads.campos_extras` da conversão), num objeto aninhado
`campos_extras` — a mesma regra de "o que já existe vence" do `_atualizar`
perde os extras novos do mesmo jeito.

Ficam de fora, de propósito: `status` e `tipo` (estado de CRM — nada de
status/tipo, mesma razão do `_atualizar`); `source`, `utm_*` e `ab_*` (já são
colunas da própria conversão); o vocabulário da dn.ia (`tipo_participante`,
`presenca`, `interesse_*`, `data_interesse`, `origem_campanha`) — não é dado
de contato da HS e o card não o mostra.

**Teto:** cada valor é cortado em 500 caracteres (o que o card mostra:
`MAX_VALOR_EXTRA`/`MAX_DESAFIOS`), no máximo 30 extras, e se o JSON passar de
16 KB (o `CORPO_MAXIMO` da porta do site) os extras saem e ficam só as
colunas. Nunca recusa a captura — "nenhum caminho de falha nosso pode recusar
um lead real".

### 3. Gravação — as duas portas, um lugar só

`registrar_captura` (usado pela landing `POST /publico/captura` e pelo
formulário de site `POST /publico/site/conversao`) monta `dados_informados`
de `campos` + `extras` e grava na conversão que acabou de inserir, **em toda
conversão** (contato novo também: é histórico, e um contato novo pode depois
ser editado pelo admin).

⚠️ **Tolerante à ordem do deploy.** A gravação é um `UPDATE` separado, feito
só se a coluna existe (`pg_attribute` sobre `'lead_conversions'::regclass` —
resolvido pelo `search_path`, como o INSERT). Sem a 031, a captura segue
exatamente como hoje. Custo: uma consulta ao catálogo por captura.

### 4. A divergência — `captura/informados.py::divergencias`

`divergencias(contato, informados) -> [{chave, rotulo, valor}]`, na ordem da
tabela e depois os extras. Diverge quando o valor informado não é vazio e,
normalizado, difere do valor do contato:

- texto: `uma_linha` + `casefold` (caixa e espaços não contam);
- telefone: `normalizar_celular_br` dos dois lados (cai para "só dígitos"
  quando um não normaliza); o lado do contato é `whatsapp`, ou
  `phone_normalized` quando `whatsapp` está vazio;
- extra: contra `contato.campos_extras[chave]`; rótulo = a chave.

Contato vazio e valor informado = diverge (é informação nova que o contato não
tem — no caminho normal o `_atualizar` já teria preenchido, então isso só
aparece depois de alguém apagar o campo à mão).

### 5. Linha do tempo

O `form_submitted` de reconversão (`evento.publicar_conversao`) ganha
`metadata.informados_diferentes` (a lista acima, calculada contra o contato
**depois** do `_atualizar`, para o que só preencheu vazio não aparecer como
divergência). Não precisa de migration: `contact_events.metadata` é jsonb.
Sem divergência, a chave não entra.

`EventsTimeline.tsx` mostra, no evento que a tiver, um quadro "Informou nesta
conversão (não verificado)" com `Rótulo: valor` — cor só por token
(`text-muted-foreground`, `border-border`, `bg-muted`). O "ver detalhes" deixa
de listar essa chave (sairia `[object Object]`).

### 6. Card do GrowthHS

`entrega.origem_do_card` passa a ler `to_jsonb(lc) -> 'dados_informados'` —
tolerante: sem a 031 dá `NULL` em vez de quebrar a entrega (o worker em
produção pode subir antes da migration).

`growthhs.montar_descricao`: quando `conversao.dados_informados` diverge do
lead, abre com

```
Informou nesta conversão (não verificado):
- Empresa: Empresa Teste HS Matriz
- Telefone: +5511999990003
Cadastro no MarketingHS:
Empresa: Empresa Teste HS Filial Sul
...
```

Sem divergência, a descrição é **byte a byte a de antes**.

Travas mantidas: todo valor e rótulo passa por `uma_linha` e é cortado
(`MAX_VALOR_EXTRA`, `MAX_ROTULO_EXTRA`); as linhas de fora começam com "- ",
então nenhuma forja o cabeçalho do bloco, a assinatura `Pedido MarketingHS`
nem "Ver no MarketingHS"; o PUT continua só com `description`, só anexando;
o teto `TETO_DA_DESCRICAO` vale com o bloco maior; a marca do bloco
(idempotência) não muda.

**Nota** (`texto_da_nota(conversao, quando, lead)`): ganha, no fim,
"Informou nesta conversão (não verificado): Empresa: …; Telefone: …." (cada
valor cortado em 200). Sem divergência, o texto é o de antes. Vantagem
extra: com a descrição no teto (bloco não entra), a nota ainda leva os
valores.

**Card NOVO.** `montar_card` usa `montar_descricao`, então mostra a
divergência quando houver — e isso é deliberado: "card novo" não é só
"contato novo". Um contato antigo cujos cards estão todos ganhos/perdidos
reconverte e ganha card novo, e aí a divergência existe e o vendedor precisa
vê-la. Para contato novo de fato, `dados_informados` é igual ao contato e
nada muda.

### 7. O comentário falso

`registro.py::_atualizar` passa a dizer onde o valor digitado fica:
`lead_conversions.dados_informados` (031) e `metadata.informados_diferentes`
do evento.

## Fora do escopo

- Botão "adotar o que o lead informou" na ficha (seria escrita por admin
  autenticado — o caminho seguro para atualizar o contato; vira pergunta).
- Mostrar `dados_informados` no endpoint de conversões da ficha
  (`leitura_contatos.py` não é território desta frente).

## Testes

- puro: `dados_informados` (lista, corte, teto), `divergencias` (caixa,
  espaço, telefone, extras, vazio), descrição/bloco/nota com e sem
  divergência, valor com quebra de linha não forja linha;
- banco (transação revertida): a 031 duas vezes numa cópia temporária;
  `registrar_captura` reconvertendo com outra empresa/telefone grava
  `dados_informados`, não mexe no contato e põe `informados_diferentes` no
  evento; sem a coluna, a captura segue; `origem_do_card` lê a coluna (cópia
  temporária) e não quebra sem ela;
- entrega: card aberto recebe bloco e nota com os valores informados.
