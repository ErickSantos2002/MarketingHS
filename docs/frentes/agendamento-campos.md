# Frente `agendamento-campos` (29/10/2026)

n 32 · Vite 8112 · backend local 8132 · Postgres local 5452
(`marketinghs-teste-32`). Pedido do Erick: na `phoebus`, o formulário normal
fica com Nome, E-mail corporativo, WhatsApp, Empresa e Cargo; porte, testes
por dia e filiais só para quem clica em agendar. Nada em produção.

## Estado

| Item | Estado |
|---|---|
| 1 Front: `camposDaEtapa2` = página (menos etapa 1) + `agendamento.campos` (`camposSoDoAgendamento`, reusa `camposDaConfig`) | feito |
| 2 Back: `etapa_empresa` valida com `definicoes_da_etapa_2` (`app/agendamento/config.py`) | feito |
| 3 `rotulos_dos_campos` inclui os rótulos de `agendamento.campos` | feito |
| 4 Captura normal não vê a lista (só confirmado por teste, nada mudou lá) | feito |
| 5 Editor: "Perguntas só do agendamento" (reusa `CamposEditor`); seletor de porte com as listas das duas origens | feito |
| 6 Oferta pós-envio do formulário normal | não mexido — pergunta abaixo |
| 7 Conferência no navegador (Postgres local) | feito |
| 8 SQL de produção | abaixo, **não rodado** |

### Como ficou

- **`config.agendamento.campos`**: mesmo formato de `config.campos`. Etapa 2
  do modal = campos da página menos nome/e-mail/WhatsApp, depois os do
  agendamento. Chave repetida: fica a da página. Nome/e-mail/WhatsApp na
  lista do agendamento são ignorados (a etapa 1 é sempre da página).
- ⚠️ `ler_definicoes`/`camposDaConfig` devolvem os campos padrão (`legado`)
  quando a lista não tem nada válido, e põem o e-mail na frente. Para a lista
  do agendamento os dois são descartados: lista vazia/inválida = nenhuma
  pergunta. Teste nas duas pontas.
- `ler_config` não precisou saber da lista: `pode_agendar` lê o valor do
  porte das respostas, venha de onde vier.
- `CHAVES_DA_ETAPA_1` do backend mudou de `routers/agendamento.py` para
  `app/agendamento/config.py` (a rota importa de lá).
- **Editor, ao ligar o agendamento**: se não há nenhum campo de lista (nem no
  formulário nem nas perguntas do agendamento), nasce em `agendamento.campos`
  a pergunta do porte padrão (`funcionarios`, as 4 faixas, obrigatória). Com
  alguma lista, a pessoa escolhe no seletor. `AGENDAMENTO_PADRAO` ficou como
  estava (pôr `campos` nele faria toda página já ligada mostrar a pergunta
  padrão no editor). A lista do agendamento não oferece Nome nem WhatsApp em
  "Grava em".

### Fora da lista de arquivos (mexi, avisando)

- `frontend/src/components/admin/pages/CamposEditor.tsx`: duas props
  opcionais, `prefixoDoId` (padrão `campo`, sem mudança para o formulário) e
  `colunasFora`. Sem o prefixo, os dois editores na mesma tela repetiam ids
  (`campo-0-rotulo`…) e o `<label for>` de um apontava para o outro.
- **Não mexi** em `frontend/src/landing/campos.ts` (tipo `AgendamentoDaPagina`
  sem `campos`): `agendamento.ts` lê a lista como desconhecida e o editor usa
  um tipo local `AgendamentoComCampos`. Se a coordenadora preferir, é uma
  linha no tipo compartilhado (`campos?: CampoDaPagina[]`).

## Perguntas para o Erick

- **Oferta pós-envio do formulário normal** (`Formulario.tsx`,
  `podeAgendar(config, valores)`): sem o porte no formulário, a oferta
  "agende sua reunião" depois do envio nunca aparece na phoebus. Assumido:
  deixar assim — o botão "Agende sua reunião" da página continua. Opções:
  (a) assim; (b) depois do envio, oferecer o agendamento a todos (o modal
  pergunta o porte e corta quem não passa); (c) tirar a oferta de vez.

## SQL de produção (não rodado — o Erick roda no Konsole)

Idempotente: `jsonb_set` grava sempre o mesmo valor; rodar duas vezes dá o
mesmo. Exige o bloco `agendamento` já existente (a phoebus tem).

```sql
UPDATE pages
SET config = jsonb_set(config, '{agendamento,campos}', '[
  {"chave": "funcionarios", "rotulo": "Quantos funcionários a empresa tem?",
   "tipo": "lista", "obrigatorio": true,
   "opcoes": ["Até 100", "101 a 400", "401 a 1.000", "Mais de 1.000"]},
  {"chave": "testes_por_dia", "rotulo": "Quantas pessoas passariam pelo teste por dia?",
   "tipo": "lista", "obrigatorio": false,
   "opcoes": ["Até 50", "51 a 200", "201 a 1.000", "Mais de 1.000"]},
  {"chave": "filiais", "rotulo": "Quantas filiais?",
   "tipo": "lista", "obrigatorio": false,
   "opcoes": ["Só a matriz", "2 a 5", "6 a 20", "Mais de 20"]}
]'::jsonb, true),
    updated_at = now()
WHERE slug = 'phoebus' AND jsonb_typeof(config->'agendamento') = 'object';

-- conferência
SELECT config->'agendamento'->>'campo_porte' AS porte,
       jsonb_path_query_array(config, '$.agendamento.campos[*].chave') AS so_do_agendamento,
       jsonb_path_query_array(config, '$.campos[*].chave') AS da_pagina
FROM pages WHERE slug = 'phoebus';
```

Esperado: `porte = funcionarios`, `so_do_agendamento = ["funcionarios",
"testes_por_dia", "filiais"]`, `da_pagina` = os 5. Só faz efeito depois do
deploy desta branch (o código de antes ignora a chave). Ordem: deploy, depois
o SQL.

## Conferência no navegador (Postgres local)

Página `phoebus-teste` semeada no banco local como a phoebus (5 campos na
página, 3 em `agendamento.campos`). Backend local na 8132 serve a landing
(`dist-landing`); Vite na 8112 serve o editor.

⚠️ Não usei o `conferir-telas.mjs`: ele loga com a conta real do Claude, que
não existe no banco local, e não abre o modal ("agendar" está na lista de
ações recusadas). Fiz como a `landing-secoes`: script descartável no
scratchpad, Chrome próprio, só GET para a API; o POST `/dados` do modal foi
respondido pelo próprio navegador (token falso) para chegar à etapa 2; o
editor logou com o admin semeado no container local (senha descartável).

Resultado (1440 e 390 px): formulário da página com `nome, email, whatsapp,
empresa, cargo`; etapa 1 do modal `nome, email, whatsapp`; etapa 2
`empresa, cargo, funcionarios*, testes_por_dia, filiais` com os rótulos das
perguntas; sem rolagem horizontal. Editor (claro/escuro 1440, claro 390):
bloco lista as 3 perguntas, seletor de porte mostra "Quantos funcionários a
empresa tem?", 4 faixas, nenhum id repetido na tela, sem estouro.

## Portão (Postgres local, 29/10)

pytest **1352 passed, 0 failed, 9 skipped** (7 `base_real` + 2 da 032;
banco recriado antes da suíte); `tsc` 0 erros (`-p frontend` e
`tsconfig.app.json`); `node --test scripts/landing-*.test.mjs` 69/69;
`npm run build` e `npm run build:landing` ok; `guarda:visual` 0 em
`components/admin/pages`.

Testes novos: `test_agendamento_regras.py` (5: etapa 2 junta, chave
repetida, lista vazia sem padrão, captura normal não vê, `pode_agendar` com
porte só do agendamento), `test_agendamento_rotas.py::
test_empresa_valida_perguntas_so_do_agendamento` (obrigatório faltando →
400 no campo, opção fora da lista → 400, completo → `pode_agendar: true` e
`testes_por_dia`/`filiais` em extras), `test_agendamento_execucao.py::
test_rotulos_incluem_as_perguntas_so_do_agendamento`; 4 no
`landing-agendamento.test.mjs`.

## Desfecho (coordenadora, 29/10)

Mergeada (`0d65148`), SQL rodado pelo Erick, deploy de api/worker/sistema às
08:40. Pergunta da oferta pós-envio: o Erick ficou com a opção (a) — o botão
"Agende sua reunião" da página sempre aparece.
