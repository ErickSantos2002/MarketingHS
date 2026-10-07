# Frente `faxina-r5` (sobras de R1 e R5, sem decisão de ninguém)

Origem: bloco "Comece por aqui — 07/10" do `docs/CONTINUAR-AQUI.md` e os
Estados de `r5-jornadas.md`, `r5-contatos.md` e `proteger-envio.md`.

Território: `backend/**` inteiro (dona única de migration, `config.py`,
routers e testes nesta rodada) e, no front, só:
`components/admin/settings/ApiDocumentation.tsx`,
`components/admin/settings/ResendConfigCard.tsx` (ou um cartão novo em
`settings/` para o ritmo), `components/admin/dashboard/pontuacao.ts`,
`hooks/useDashboardFilters.tsx`, `hooks/useLeads.tsx`,
`components/admin/LeadDetailSheet.tsx` (só para tirar o cast de
`deleted_at`). Migration: evitar; se indispensável, idempotente, rodar duas
vezes num Postgres local descartável, **NÃO aplicar**, montar
`~/marketinghs-migration-0NN.sh` no molde do `~/marketinghs-migration-026.sh`.
Portas: Vite 8095, backend 8115.

## Backlog (em ordem)

- [x] **`change_status` olha `deleted_at`.** Contato apagado: passo
  `skipped`, nada gravado. Teste.
- [x] **Status inexistente falha na hora.** Hoje re-tenta 3× um erro que não
  se cura sozinho. Falha definitiva no 1º erro, com o motivo no run. Teste.
- [x] **`_aplicar_tag` compara sem caixa**, como o `remove_tag` (não criar
  "Cliente" se existe "cliente"). Teste.
- [x] **Tela para editar o ritmo de envio** (Configurações → Resend, ou
  cartão vizinho): `ENVIO_POR_SEGUNDO`, `ENVIO_TETO_HORA`, `ENVIO_TETO_DIA`,
  `ENVIO_AQUECIMENTO_DIA1`, `ENVIO_AQUECIMENTO_INICIO` em
  `integration_secrets`. Rota `admin_atual`, validação (inteiros ≥ 0, data
  AAAA-MM-DD), leitura mostra o valor em vigor e de onde veio (banco ou
  padrão do código), e o teto do dia de hoje já com a rampa. ⚠️ Em produção
  o Erick gravou 90/dia e 90/h (`~/marketinghs-teto-envio.sh`); a tela tem
  que mostrar isso e não pode zerar nada que não foi editado. Teste da rota.
- [x] **`ApiDocumentation.tsx`:** descrever que `POST /publico/conversao` não
  troca a origem (UTMs/`source` só preenchem o vazio; primeiro toque fica) e
  publica `form_submitted` com `page_slug` (sem `converted_at`). **Só texto
  explicativo — nunca mexer em URL nem em exemplo de payload** (essa tela já
  ensinou URL morta oito vezes; conferir cada URL contra o router se tocar
  perto).
- [x] **Pequenos do front:** comentário velho em `dashboard/pontuacao.ts`
  (linhas 8–9, ainda fala do P1–P4 na ficha); `onlyReconversions` órfão em
  `useDashboardFilters` (tirar, mantendo a migração do localStorage antigo
  para `recorrencia`); `deleted_at` no tipo `Lead` de `useLeads.tsx` e tirar
  o cast da ficha.
- [x] Portão: `tsc` 0, guarda 0 em `src`, `vite build` e `build:landing`;
  pytest dos arquivos tocados com `-x`, depois a suíte inteira **uma vez,
  sozinha**, `timeout -s KILL 3600 ... -o faulthandler_timeout=300`.
  ⚠️ Banco de **PRODUÇÃO com dado real**: só apagar o que o teste criou, por
  id; `count(*) FROM leads` antes e depois (2.107 em 07/10).

## Estado

**07/10 — ✅ Pronto para merge** (branch `worktree-agent-ad56b3640e6681341`).
Commits: `d6e0054` (jornadas), `953d391` (rota do ritmo), `73b3da4` (tela do
ritmo), `95a8fb9` (texto da API), `572c0fa` (pequenos do front), `e97aec4`
(itens da revisão), mais o deste registro. **Sem migration.**

- [x] **`change_status` × `deleted_at`** (`app/jornadas/executor.py`):
  contato excluído (ou sumido) = passo `skipped` com `motivo: "contato
  excluído"`, nenhum UPDATE nem evento.
- [x] **Erro definitivo falha na hora.** `ErroDefinitivo(ValueError)` para
  status inexistente, tag vazia e tipo de nó desconhecido: `rodar_cadeia` põe
  o run em `failed` na 1ª tentativa com o motivo em `context.error`. Erro de
  rede/banco continua re-tentando 3× (teste dos dois lados).
- [x] **Tag sem caixa.** `_aplicar_tag` (nó de jornada) e também
  `_aplicar_tag_do_slug` (captura e `POST /publico/conversao`, mesmo defeito)
  procuram por `lower(name)`, grafia exata primeiro quando há as duas; só
  criam se nenhuma grafia existir.
- [x] **Ritmo de envio.** Rota nova `GET/PUT /config/envio/ritmo`
  (`app/routers/ritmo_envio.py`, `admin_atual`; `service_role` no banco
  porque `integration_secrets` só tem GRANT para ele, como o Resend). A
  leitura repete a ordem do worker (banco → ambiente → padrão), diz a origem
  de cada valor, mostra o texto gravado inválido, o teto de hoje com a rampa,
  o dia 1 da rampa e o uso de hoje/última hora. O PUT grava **só as chaves
  enviadas** (`exclude_unset`, chave desconhecida = 422, número `null` = 422).
  Tela: seção "Ritmo de envio" dentro do cartão do Resend
  (`settings/RitmoEnvio.tsx`), que manda só os campos editados. Vale no
  worker em até 1 min (cache do `ler_segredo`). Testes em transação revertida;
  pela rota só 401/403/422 e a leitura — nenhum PUT válido chega ao banco.
- [x] **`ApiDocumentation.tsx`:** descrição, parâmetros e notas de `POST
  /publico/conversao` (UTMs em bloco só no contato sem origem, `source` só no
  vazio, `converted_at` = histórico sem automação, `form_submitted` com
  `page_slug` só entra em fluxo filtrado por página, `tipo` continua
  sobrescrito). Nenhuma URL, curl ou payload tocado (conferido no diff).
- [x] **Pequenos do front:** `onlyReconversions` saiu de `useDashboardFilters`
  (a preferência antiga com ele ligado ainda vira `recorrencia: 'recorrentes'`);
  `deleted_at: string | null` no tipo `Lead` e a ficha sem o cast; comentário
  de `dashboard/pontuacao.ts` corrigido.

**Revisão final** (superpowers:requesting-code-review): sem crítico; os
menores aplicados em `e97aec4` (validação de máximo e formato no front, linha
só de espaços no banco tratada como o worker, texto da API mais preciso).
Ficou: `lower(name)` sem índice funcional em `tags` (tabela pequena).

**Portão (07/10):**
- pytest dos tocados com `-x` (`test_faxina_r5`, `test_ritmo_envio`,
  `test_r5_jornadas`, `test_captura`, `test_conversao`, `test_montagem`):
  104 passed.
- suíte inteira, sozinha, `timeout -s KILL 3600`, `faulthandler_timeout=300`:
  **527 passed, 0 failed, 0 skipped**, 37 min 14 s, exit 0 (os 7 da 026 já
  passam — ela está aplicada).
- `count(*) FROM leads`: **2107 antes, 2107 depois**.
- `tsc --noEmit -p tsconfig.app.json`: 0. Guarda `src`: 0. `vite build` e
  `build:landing`: ok.

**Telas a conferir** (sem conta admin do Claude — não conferi no navegador):
Configurações → cartão do Resend → seção "Ritmo de envio": tem que mostrar
**90** em teto por dia e por hora com o selo "gravado", o teto de hoje ≤ 90;
editar só "Envios por segundo" e conferir que os 90 continuam; claro/escuro,
1024 e celular. ⚠️ Salvar ali grava em produção — conferir só a leitura.

## Perguntas

- **FR5-1. Teto 0.** O backlog dizia "inteiros ≥ 0", mas o worker trata teto
  0 como inválido e cai no padrão (2.000/dia) — gravar 0 achando que parou o
  envio mandaria 2.000. Opções: (a) recusar teto 0 (tela e rota); (b) fazer o
  worker entender 0 como "parado". **Assumido (a)**; parar envio é o "Pausar
  envio" da campanha. A rampa (dia 1) continua aceitando 0 (= desligada).
- **FR5-2. Voltar ao padrão.** Número não aceita `null` (apagar a linha
  trocaria 90 por 2.000 sem ninguém digitar 2.000); para voltar, grava-se o
  valor padrão, que a tela mostra embaixo do campo. Só a data do dia 1 aceita
  vazio (= dia do primeiro envio real, com aviso na tela). Alternativa: botão
  "restaurar padrão" por campo. **Assumido: sem botão.**
- **FR5-3. Tag do slug sem caixa.** Fora do backlog, mesmo defeito do
  `_aplicar_tag`: a página `/webinar` passa a usar a tag "Webinar" criada no
  painel em vez de criar "webinar". Reversível numa consulta.
