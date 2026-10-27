# Frente `responder-para` (n 26)

Reply-to configurável nos e-mails. Brief no despacho (27/10): os e-mails saem
de `contato@mkt.healthsafetytech.com` e as respostas dos leads devem cair em
`hs@healthsafety.com.br`, como no RD.

## Estado (27/10) — ✅ pronta para merge

- **Segredo novo `EMAIL_REPLY_TO`** em `integration_secrets` (mesmo
  `ler_segredo`/`gravar_segredo` do `EMAIL_FROM`; cache de 60 s). Sem
  migration. Opcional: vazio/ausente = sem reply-to, o comportamento de antes.
- `backend/app/email/resend.py::enviar(..., responder_para=None)` — preenchido,
  vai como `reply_to` (string) no corpo da API do Resend; vazio, o campo não vai.
- **Os três pontos de envio** leem o segredo do mesmo jeito que leem o
  remetente, uma vez por passada (nunca por e-mail):
  - `worker.py` — `_responder_para()` ao lado de `_remetente()` no `_tick`,
    passado a `_processar(..., responder_para=)` (campanhas **e** e-mails de
    jornada, que também passam pela fila);
  - `jornadas/saidas.py` — lido em `_drenar_avisos` junto do `EMAIL_FROM`,
    passado a `_mandar_aviso(..., responder_para=)` (aviso ao comercial);
  - `routers/envio.py` — `_responder_para()` no envio de teste.
- `routers/configuracao.py` (bloco Resend):
  - `GET /config/resend` devolve `reply_to` em claro (`null` se vazio);
  - `PUT /config/resend` aceita `reply_to`: **ausente = não mexe** (cliente
    antigo), **vazio = apaga**, valor = valida e grava. A validação
    (`responder_para_valido`, `fullmatch`) aceita só `algo@dominio.tld` — sem
    nome de exibição, vírgula, ponto e vírgula, aspas, espaço ou quebra de
    linha — e recusa com 400 legível **antes de gravar qualquer coisa** (passo 4
    do PUT, junto dos outros segredos). Resposta ganha `reply_to`.
  - ⚠️ Vazio-apaga é exceção à regra "vazio é não mexi" dos segredos do card;
    o motivo está comentado em `ResendIn` e em `lib/config.ts`.
- Tela `ResendConfigCard.tsx`: campo "Responder para" logo abaixo do
  remetente, com a ajuda pedida, aviso em `--on-tint-danger` e o Salvar
  desabilitado se o endereço não passa no mesmo critério do servidor. Tipo
  `reply_to` em `ConfigResend` e no `gravarConfigResend`.

## Portão

- RED antes: 7 falhas + erro de import em `test_config_resend.py`.
- Postgres local `marketinghs-teste-26:5466`: arquivos tocados
  (`test_resend_cliente`, `test_config_resend`, `test_worker_ritmo`,
  `test_prova_saidas`, `test_envio_teste_responder` novo) **155 passed**;
  suíte inteira **1149 passed, 9 skipped**.
- `tsc --noEmit -p frontend/tsconfig.app.json`: 0. `guarda:visual` em
  `src/components/admin/settings`: 0.

## Para a coordenadora

- **Fora do território, uma linha:** `tests/conftest.py` — `EMAIL_REPLY_TO`
  entrou em `SEGREDOS_DO_RESEND`, para a fixture `segredos_resend` limpar e
  devolver o segredo como faz com os outros.
- **Também fora do bloco, uma linha:** o import de `apagar_segredo` no topo de
  `configuracao.py`.
- **Tela não conferida no navegador** (a frente não subiu backend). Vale um
  `conferir-telas` de `/settings` depois do merge.
- **Depois do deploy de api, worker e sistema:** gravar
  `hs@healthsafety.com.br` em Configurações → Resend → "Responder para" e
  mandar um e-mail de teste para conferir o cabeçalho `Reply-To`.
- O aviso ao comercial (`saidas.py`) também leva o reply-to, como pedido. Se
  o Erick preferir que a resposta ao aviso vá ao próprio lead (ou a ninguém),
  é trocar só aquela chamada.
- `diagnostico_resend` não cita o reply-to (é opcional, não falta).
