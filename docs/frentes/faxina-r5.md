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

- [ ] **`change_status` olha `deleted_at`.** Contato apagado: passo
  `skipped`, nada gravado. Teste.
- [ ] **Status inexistente falha na hora.** Hoje re-tenta 3× um erro que não
  se cura sozinho. Falha definitiva no 1º erro, com o motivo no run. Teste.
- [ ] **`_aplicar_tag` compara sem caixa**, como o `remove_tag` (não criar
  "Cliente" se existe "cliente"). Teste.
- [ ] **Tela para editar o ritmo de envio** (Configurações → Resend, ou
  cartão vizinho): `ENVIO_POR_SEGUNDO`, `ENVIO_TETO_HORA`, `ENVIO_TETO_DIA`,
  `ENVIO_AQUECIMENTO_DIA1`, `ENVIO_AQUECIMENTO_INICIO` em
  `integration_secrets`. Rota `admin_atual`, validação (inteiros ≥ 0, data
  AAAA-MM-DD), leitura mostra o valor em vigor e de onde veio (banco ou
  padrão do código), e o teto do dia de hoje já com a rampa. ⚠️ Em produção
  o Erick gravou 90/dia e 90/h (`~/marketinghs-teto-envio.sh`); a tela tem
  que mostrar isso e não pode zerar nada que não foi editado. Teste da rota.
- [ ] **`ApiDocumentation.tsx`:** descrever que `POST /publico/conversao` não
  troca a origem (UTMs/`source` só preenchem o vazio; primeiro toque fica) e
  publica `form_submitted` com `page_slug` (sem `converted_at`). **Só texto
  explicativo — nunca mexer em URL nem em exemplo de payload** (essa tela já
  ensinou URL morta oito vezes; conferir cada URL contra o router se tocar
  perto).
- [ ] **Pequenos do front:** comentário velho em `dashboard/pontuacao.ts`
  (linhas 8–9, ainda fala do P1–P4 na ficha); `onlyReconversions` órfão em
  `useDashboardFilters` (tirar, mantendo a migração do localStorage antigo
  para `recorrencia`); `deleted_at` no tipo `Lead` de `useLeads.tsx` e tirar
  o cast da ficha.
- [ ] Portão: `tsc` 0, guarda 0 em `src`, `vite build` e `build:landing`;
  pytest dos arquivos tocados com `-x`, depois a suíte inteira **uma vez,
  sozinha**, `timeout -s KILL 3600 ... -o faulthandler_timeout=300`.
  ⚠️ Banco de **PRODUÇÃO com dado real**: só apagar o que o teste criou, por
  id; `count(*) FROM leads` antes e depois (2.107 em 07/10).

## Estado

(vazio)

## Perguntas

(dúvida de produto: opções + a assumida, a mais segura e reversível)
