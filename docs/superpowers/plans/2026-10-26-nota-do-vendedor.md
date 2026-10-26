# Plano — nota do vendedor (pergunta 79)

Spec: `docs/superpowers/specs/2026-10-26-nota-do-vendedor-design.md`.
Testes no Postgres local (`marketinghs-teste-nota`, porta 5443). TDD: teste
vermelho → código → verde, por tarefa.

## Tarefa 1 — `anotar` em linhas (`growthhs.py`)

- Teste (`test_growthhs_cliente.py`): `anotar(id, ["a", "b\nc", "", "<img>"])`
  → `content == "a\nb c\n‹img>"`; `str` continua achatado; teto
  `TETO_DA_NOTA`.
- Código: `anotar(card_id, texto: str | list[str])`; `_sem_html`; corte.

## Tarefa 2 — `nota_de_abertura` (`growthhs.py`)

- Testes (`test_reconversao_dados.py`, puros): cabeçalho com origem e data;
  corpo = linhas de `montar_descricao` sem marca e sem link; linha de UTMs;
  link por último; valor com `\n` não forja linha; sem UTM não há linha.
- Código: `link_da_ficha(frontend_url, lead_id)`; `linha_de_utms(lead)`;
  `nota_de_abertura(lead, *, conversao, consentimento, frontend_url, quando)
  -> list[str]`.

## Tarefa 3 — `texto_da_nota` em linhas, sem a frase (`entrega.py`)

- Testes: sem "Descrição do card atualizada"; primeira linha; informados em
  "- Rótulo: valor"; link com `frontend_url`; corte em 200.
- Código: devolve `list[str]`; kwarg `frontend_url`. Ajustar `NOTA` e o
  `endswith` de `test_crm_entrega.py`.

## Tarefa 4 — nota de abertura na entrega (`entrega.py`)

- Testes (`test_crm_entrega.py`): card novo anota 1 nota com o conteúdo;
  `entregue` grava antes da nota (nota falhando com 422 ainda deixa
  `entregue` + `erro_da_nota`); 503+503 → entregue sem adiar, `erro_da_nota`;
  503 uma vez → 2 POSTs de nota, 1 nota; 2xx sem id → sem nota,
  `erro_da_nota`; reconhecido no retry → 1 nota; lead sem e-mail → 1 nota.
  Atualizar os `api.notas == []` dos caminhos de card novo.
- Código: `_anotar_abertura`; `_concluir(..., marcar=False)`.

## Tarefa 5 — fechamento

Suíte inteira no Postgres local; `docs/frentes/nota-do-vendedor.md`; commit +
push da branch; `docker rm -f marketinghs-teste-nota`.
