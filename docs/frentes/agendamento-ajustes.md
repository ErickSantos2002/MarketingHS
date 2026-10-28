# Frente `agendamento-ajustes` (28/10/2026)

n 31 · Postgres local 5451 (`marketinghs-teste-31`). Ajustes vindos do teste
ponta a ponta do agendamento na homologação. GrowthHS e Resend só os falsos
dos testes; nada em produção.

## Estado

| Ajuste | Estado | Commit |
|---|---|---|
| 1 Confirmação: "vai chegar no seu e-mail em instantes" (`MENSAGEM_CONVITE`) | feito | `0fd98e7` |
| 2 Ids próprios no modal: `Controle` aceita `prefixoDoId` (padrão `campo-`), o modal passa `agendamento-campo-` (`idDoCampo`, `PREFIXO_DO_ID_NO_MODAL` em `agendamento.ts`) | feito | `0fd98e7` |
| 3 Rótulo do campo extra (não a chave) na nota e no e-mail ao vendedor | feito | `c39a4ff` |
| 4 Nota sem "Filiais: 2 a 5" repetida no fim | feito | `c39a4ff` |

### Como ficou o 3 e o 4 (`backend/app/agendamento/execucao.py`)

- `rotulos_dos_campos(config)` = chave → rótulo de `ler_definicoes` da config
  da página; `_lead_e_origem` guarda em `ag["_rotulos"]`. Sem definição, vai
  a chave.
- E-mail ao vendedor: `montar_email_vendedor(..., rotulos=)` usa o rótulo nas
  respostas avulsas.
- Nota: as "Respostas do formulário" da nota padrão vêm de
  `growthhs.nota_de_abertura` (fora do território). Em vez de mexer lá, a
  execução passa um `lead` com as chaves de `campos_extras` trocadas pelo
  rótulo — e troca também as de `conversao.dados_informados.campos_extras`,
  senão o "Informou nesta conversão" via divergência onde não há (medido no
  primeiro verde). Rótulo repetido entre campos, ou igual à chave de outro
  campo, fica na chave (duas respostas não viram uma).
- A linha extra da nota só acrescenta resposta da reserva que não chegou a
  `campos_extras` e não é coluna já mostrada (`CAMPOS_INFORMADOS`), e-mail ou
  chave de controle (UTM, `source`, A/B). "Filiais" saía de novo; não sai.
  "Reunião agendada pelo lead…" continua no topo.

### Para a coordenadora (fora do território)

- O card **novo** (`growthhs.montar_card` → `montar_descricao`) e o handoff da
  captura normal continuam com a chave do campo extra na `description` e na
  nota de abertura deles. A tela do card não mostra a `description`; a nota
  do handoff normal mostra. Se quiser o rótulo lá também, o lugar é
  `app/crm/growthhs.py` / `app/crm/entrega.py`.

## Portão (Postgres local, 28/10)

pytest **1345 passed, 0 failed, 9 skipped** (7 `base_real` + 2 da 032);
`tsc` 0 erros; `node --test scripts/landing-*.test.mjs` 65/65;
`npm run build:landing` ok.
