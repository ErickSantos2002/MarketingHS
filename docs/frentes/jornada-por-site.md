# Frente `jornada-por-site` (23/11/2026)

n 35 · Vite 8115 · backend local 8135 (só para a conferência) · Postgres
local 5455 (`marketinghs-teste-35`). Nada em produção.

## Por quê

O site "Páginas da agência" (`e42d5d70-4124-46b5-a937-a7299625d425`,
www.healthsafety.com.br, healthsafety.com.br, contatos.healthsafety.com.br)
gera um `form_id` por página (`/#form1`, `/suporte#form1`,
`/solucoes/acessorios#form1`, `lp-contatos`… 10 hoje). A jornada "Páginas da
agência → comercial" (nó `handoff_growthhs`) vai substituir o n8n da agência
que cria o card no GrowthHS. Filtrando por lista de `form_ids`, página nova
da agência ficaria sem card, em silêncio. Agora dá para filtrar por **site**.

## Estado

Pronta para merge.

| Item | Commit |
|---|---|
| Migration 039, validação no router, seletor de sites, testes | `e6684d4` |
| Correções da revisão (contexto com site, `lower`, 400 fora do `form_submitted`, `/sites` sob demanda) + este arquivo | commit seguinte |

### O que mudou

- **`backend/migrations/039_jornada_por_site.sql`** — recria
  `journey_enroll_event(uuid, text, jsonb)` como cópia fiel da 036, com
  três mudanças (o `diff` contra a seção 4 da 036 mostra só elas):
  - `f_site`: o fluxo tem `entry_config.site_ids` não vazio. Boolean que
    nunca é NULL, mesmo `CASE` do `f_form`;
  - casa `f_site AND v_site IS NOT NULL AND site_ids ? v_site`, em **OU** com
    página e formulário (como página/formulário já eram);
  - "qualquer origem" passa a exigir também `NOT f_site`, e continua sem
    incluir conversão de site (028). Fluxo por site conta como filtrado: a
    reconversão entra nele (026). A regra da 036 (agendamento confirmado não
    entra em fluxo com `handoff_growthhs`) ficou igual.
  - `v_site` em minúsculas (defesa: o `site_ids` gravado é canônico) e o
    `context` da execução ganha `site_id` (por qual site entrou) — vieram
    da revisão.
  - O `site_id` já chegava no metadata pelos dois caminhos — gatilho de
    INSERT (`fn_lead_insert_event`, 036) e `publicar_conversao` da
    reconversão (`captura/evento.py`). Nada mudou neles; um teste prova os
    dois de ponta a ponta.
- **`routers/jornadas.py`** — `_normalizar_sites`, no POST e no PATCH:
  `site_ids` só como lista de uuid em texto (senão 400 "\"Sites\" do filtro
  de entrada precisa ser uma lista de ids de site (uuid em texto)."); sai
  canônico (minúsculo, sem repetido) porque o banco compara texto exato com o
  `sites.id::text` do metadata. Não confere se o site existe (site desligado
  continua filtro válido). `site_ids` fora do evento "Formulário enviado" é
  400 — só ele traz `site_id`, e o fluxo ficaria vazio em silêncio.
- **Front** — `buildEntryConfig(evento, página, formulários, sites)` e
  `readEntrySiteIds` (`lib/journeys.ts`); `EntrySitesCampo` +
  `useSitesDaEntrada` em `JourneyCreateDialog.tsx` (lista de sites com
  checkbox, carregada de `GET /sites` — a mesma API e a mesma `queryKey` de
  Configurações → Sites, nenhuma rota nova). Texto: "Qualquer formulário
  deste site, inclusive páginas novas". No construtor, o campo fica no
  diálogo da entrada e o card de entrada resume "… ou site <nome>" (a lista
  só é buscada quando o fluxo tem site no filtro).

## Portão (Postgres local 5455, com 000…039)

- 039 aplicada **duas vezes** no local (`CREATE FUNCTION` / `GRANT` nas duas).
- `pytest -q -rs`: **1512 passed, 9 skipped** (os 7 `base_real` + os 2 da
  032 já aplicada) — `tests/test_jornada_por_site.py` tem 29 casos, todos
  rodados (nenhum pulado) no local.
- `tsc --noEmit -p tsconfig.app.json`: 0 erros.
- `npm run guarda:visual` em `components/admin/automations`, `pages/admin`:
  0.
- Testes node (`scripts/*.test.mjs`): 128 pass, 1 skipped, 0 fail
  (`journeys-nos.test.mjs` ganhou 2).
- Navegador (`conferir-telas`, Vite 8115 + backend 8135): o construtor de
  um fluxo `form_submitted` abre sem erro novo nos dois temas e larguras. O
  seletor em si fica atrás do botão "Editar", que a ferramenta não clica
  (só leitura) — **conferir o diálogo com o Playwright da coordenadora**.

## Aplicar a 039 em produção (é o Erick quem roda)

```bash
cd ~/github/MarketingHS
set -a; . ~/marketinghs.env; set +a
for i in 1 2; do
  PGPASSWORD="$POSTGRES_PASSWORD" psql \
    "postgresql://${POSTGRES_USER}@${POSTGRES_HOST_EXTERNO}:${POSTGRES_PORTA_EXTERNA}/${POSTGRES_DB}" \
    -v ON_ERROR_STOP=1 -f backend/migrations/039_jornada_por_site.sql
done
# prova: deve dar t
PGPASSWORD="$POSTGRES_PASSWORD" psql \
  "postgresql://${POSTGRES_USER}@${POSTGRES_HOST_EXTERNO}:${POSTGRES_PORTA_EXTERNA}/${POSTGRES_DB}" \
  -tAc "SELECT position('f_site' in prosrc) > 0 FROM pg_proc WHERE proname = 'journey_enroll_event' AND pronargs = 3"
```

Ordem: aplicar a 039 **antes** do deploy do `marketinghs-api`/`sistema`. Se o
front for antes, um fluxo salvo com site_ids e sem a 039 vira fluxo "sem
filtro" (a 036 ignora a chave) — e conversão de site não entra nele (028), mas
landing entraria.

## Pendências e perguntas

- O texto de ajuda do `EntryFormIdsCampo` (`ModoTesteCampo.tsx`, fora do meu
  território) diz que formulário de site "só entra pelo identificador" —
  agora entra também pelo site. Sugestão: "…menos formulário de site, que só
  entra pelo identificador ou pelo site".
- Revisão final feita (subagente, só leitura): nenhum crítico; os menores
  2–5 corrigidos. Ficou de fora, de propósito: travar no router o
  `site_ids` enquanto a 039 não estiver no banco — basta a ordem de deploy
  acima.
- ⚠️ Os testes de banco de `test_jornada_por_site.py` **pulam** num banco sem
  a 039 (o de produção, até o Erick aplicar). Só provam no local.
- Usuário `leitura` abre o construtor mas `GET /sites` é só de admin: o
  campo mostra os ids gravados sem nome e o aviso "Não foi possível carregar
  os nomes dos sites". Ele não salva nada (servidor recusa), então é só
  cosmético. Se incomodar, a coordenadora decide abrir `GET /sites` para
  `admin_ou_leitura` (o token é público por desenho).
- Para montar a jornada "Páginas da agência → comercial": evento
  "Formulário enviado", marcar o site "Páginas da agência", nó "Enviar ao
  GrowthHS". Desligar o n8n da agência só depois do 1º card conferido.
