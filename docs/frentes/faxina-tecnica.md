# Frente `faxina-tecnica` (29/10/2026)

n 36 · Vite 8116 · backend local 8136 (só para a conferência) · Postgres
local 5456 (`marketinghs-teste-36`). Branch `faxina-tecnica`. Seção C de
`docs/arrumar-a-casa.md`, menos `DATACORE_*` (o env de produção ainda tem as
chaves; tirar do `config.py` antes derruba o boot) e a chave de API de
eventos (dado de produção). Nada em produção.

## Estado

| Item | Estado | Commit |
|---|---|---|
| 1 Régua do servidor para `arquivo_url` (salvar recusa, servir descarta) | feito | `6429638` |
| 2 `DELETE /videos/{id}` (admin, 409 se usado) + `DELETE /videos/orfaos` + botão no editor | feito | `da03f8d` |
| 3 Descrição do tipo `video` no `SecoesEditor.tsx` | feito | `86ee410` |
| 4 Rótulo (não a chave) do campo extra na nota da captura normal | feito | `554a026` |

## Como ficou

**1. `arquivo_url`** (`app/captura/urls.py`): `video_hospedado(valor)` é a
régua do cliente (`secoes.ts::VIDEO_HOSPEDADO`): `/publico/video/<uuid>`,
aparado, uuid em qualquer caixa. Entra em `_videos_ruins` ao lado da `url`
do YouTube: ao salvar, `secoes.N.arquivo_url` no detalhe do erro; ao servir,
sai o `arquivo_url` e a página cai no YouTube da `url`. Vazio/ausente passa
(é "sem arquivo"). Só no tipo `video`.

**2. Apagar vídeo** (`app/routers/videos.py`):
- `DELETE /videos/{id}` — `admin_atual` (comum e `leitura` 403; sem token
  401). 204 se apagou; **409** "Este vídeo ainda está em uso na página: X.
  Troque ou tire o vídeo lá e salve antes de apagar."; 404 se não existe ou
  id malformado. Conferência e DELETE num comando só
  (`DELETE … WHERE NOT EXISTS (página que usa)`), sem janela.
- "Usa" = `lower(pages.config::text) LIKE '%/publico/video/<id>%'` — em
  qualquer lugar da config, rascunho conta, uuid em qualquer caixa. Só
  `pages.config` guarda config de página (`page_stats` é view).
- `DELETE /videos/orfaos` — admin; apaga os que nenhuma página usa **e têm
  mais de 1 h** (`CARENCIA`); devolve `{"apagados": n}`. Declarada antes da
  `{id}`.
- Editor (`EditoresDeSecao.tsx::CampoDeVideo`): "Trocar vídeo"/"Tirar" não
  apagam nada. Abaixo do aviso de formato, uma linha discreta: "Trocar ou
  tirar não apaga o vídeo anterior do servidor. *Apagar vídeos que nenhuma
  página usa*" → `window.confirm` → `DELETE /videos/orfaos` → toast com
  quantos.

**3.** "Vídeo subido aqui ou do YouTube; só carrega quando a pessoa clica."

**4. Rótulo na nota** — as peças saíram do agendamento para um lugar comum,
sem duplicar:
- `app/captura/campos.py`: `rotulos_dos_campos(config)` (chave → rótulo de
  `ler_definicoes`; aceita a config em texto) e `trocar_chaves(respostas,
  rotulos)` (rótulo repetido ou igual a outra chave fica na chave).
- `app/captura/informados.py`: `com_rotulos(lead, conversao, rotulos)` —
  cópias com o rótulo nos `campos_extras` do contato **e** de
  `conversao.dados_informados`, senão o "Informou nesta conversão" via
  divergência onde não há.
- `app/agendamento/execucao.py`: `rotulos_dos_campos` agora = perguntas só
  do modal + `captura.campos.rotulos_dos_campos`; `_nota` usa `com_rotulos`
  (o `_trocar_chaves` local saiu).
- `app/crm/entrega.py`: `rotulos_da_conversao(conn, conversao)` lê a config
  da página da última conversão (`page_slug`); sem página (site, manual) ou
  página apagada, vazio → fica a chave. Aplicado **só nas notas** (abertura
  e atualização); o `lead` original segue para o registro.

## Decisões

1. **400, não 422**, no `arquivo_url` ruim: o pedido dizia 422 e "siga o
   padrão de lá"; o padrão (`paginas.py::recusar_urls_inseguras`, também
   usado pela chave de API) é 400 com os caminhos no detalhe. Fiquei no
   padrão; o detalhe ganhou uma frase própria quando o caminho ruim é
   `arquivo_url` ("só aceita o caminho que o upload devolve
   (/publico/video/<id>): suba o vídeo pelo editor").
2. **Faxina: rota de órfãos + botão discreto**, e não apagar o anterior ao
   trocar. Mais simples (um botão, nenhum estado de "qual era o anterior") e
   mais seguro: a carência de 1 h protege o vídeo que outro admin acabou de
   subir numa página ainda não salva. `DELETE /videos/{id}` existe também
   (pedido), mas o editor não o usa.
3. **Descrição do card fica com a chave.** Só as notas mudaram, como no
   agendamento: a tela do card do GrowthHS não mostra a `description`, e
   ela participa da idempotência (marca do pedido/bloco) — mexer nela não
   paga o risco.
4. Rótulo vem da página da **última** conversão. Resposta em
   `campos_extras` vinda de outra página (o contato converteu em duas) fica
   na chave se a última página não define aquele campo.

## Testes

- `backend/tests/test_faxina_tecnica.py` (20): régua `video_hospedado`
  (3 aceitos, 11 recusados), caminhos ruins (outro tipo não lê, vazio
  passa, número recusa), 400 com caminho e dica, servir descarta e mantém o
  YouTube sem mexer na original; `rotulos_dos_campos` (texto, nulo, JSON
  ruim), `trocar_chaves` sem juntar respostas, `com_rotulos` nos dois lados
  sem mexer nas originais.
- `backend/tests/test_videos.py` (+6): órfão → 204 e some; referenciado (uuid
  em caixa alta) → 409 e fica; 404 (inexistente e malformado); 401/403
  comum/403 `leitura` nas duas rotas; faxina apaga o órfão velho, fica o
  usado e o recente; carência de 1 h. ⚠️ A 037 não dá UPDATE em
  `landing_videos`: o teste da faxina move o corte (`_corte`) em vez de
  envelhecer o vídeo.
- `backend/tests/test_crm_entrega.py` (+3): nota de abertura com
  "- Sua empresa já faz testagem?: Sim" e "- sem_definicao: x"; nota de
  atualização com o rótulo no "Informou nesta conversão"; conversão de
  página inexistente → chave.

## Conferência (Chrome próprio, Postgres local 5456)

Script descartável no scratchpad (`faxina/conferir.mjs`, `playwright-core`
da `.ferramentas`, `/usr/bin/google-chrome`; sem Playwright MCP, sem
`claude-admin.env`). Admin descartável no container + `JWT_SECRET`
descartável no backend 8136; Vite 8116. Página `faxina-36` com um vídeo
usado (MP4 de 3 s gerado no ffmpeg) e um órfão com 2 h. Tudo apagado no fim.
Escritas bloqueadas fora de `DELETE /api/videos/orfaos` e `/api/paginas`.

- **curl pelo proxy do Vite**: `DELETE /videos/<usado>` → 409 "Este vídeo
  ainda está em uso na página: faxina-36. …"; sem token → 401; `PATCH
  /paginas/<id>` com `arquivo_url` de fora → 400 com `secoes.0.arquivo_url`
  e a dica do upload.
- **Editor claro/escuro, 1440/390**: o seletor do "Adicionar seção" mostra
  "Vídeo subido aqui ou do YouTube; só carrega quando a pessoa clica." (o
  texto antigo não aparece); seção Vídeo aberta com a prévia e a linha
  "Trocar ou tirar não apaga o vídeo anterior do servidor. *Apagar vídeos
  que nenhuma página usa*". Clique (claro 1440) → `confirm` → toast "1 vídeo
  sem uso apagado." — o órfão saiu, o usado ficou (conferido no banco);
  segundo clique (escuro 1440) → "Nenhum vídeo sem uso para apagar.". Sem
  rolagem lateral, sem erro de página (só o `POST /api/ia/conversas` do
  layout bloqueado).
- PNG: `/tmp/claude-1000/-home-ericks-github-MarketingHS/d0ad6f20-2d2e-46a0-a353-191b2ad332b2/scratchpad/faxina/png/`
  (`tipos-*`, `editor-{claro,escuro}-{1440,390}.png`, `*-faxina.png`,
  `resumo.json`) — pasta temporária da sessão.
- ⚠️ Achado no caminho: o pool codifica `jsonb` (`json.dumps`), então
  passar `json.dumps(config)` num `$1::jsonb` grava **string JSON**, não
  objeto. Meus fixtures nasceram assim (os testes passavam porque
  `rotulos_dos_campos` aceita texto e o `LIKE` lê o texto) — corrigido em
  `196927b` para objeto, como em produção.

## Portão (Postgres local 5456, 29/10)

pytest **1437 passed, 0 failed, 9 skipped** (7 `base_real` + 2 da 032);
`tsc --noEmit` 0 erros (raiz e `tsconfig.app.json`); `node --test
scripts/landing-*.test.mjs` 79 testes, 0 falhas; `npm run build` e `npm run
build:landing` ok; `guarda:visual` em `src/components/admin/pages` 0.

## Para a coordenadora (fora do território)

- Nada fora do território foi tocado (`main.py`, `config.py`, migrations,
  `lib/api*` intocados; o editor usa o `api.delete` que já existia).
- `DATACORE_*` e a chave de API de eventos seguem pendentes (ver acima).
- O nginx do sistema (`client_max_body_size`) não muda: `DELETE` não tem
  corpo.

## Perguntas

1. **Carência da faxina = 1 h.** Assumi: basta para subir e salvar; quem
   quiser apagar um vídeo recém-trocado espera 1 h ou usa `DELETE
   /videos/{id}` (sem botão hoje).
