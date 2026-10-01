# Plano — `service_role` → `authenticated` nas rotas de usuário (frente backend, 01/10/2026)

A regra do `CLAUDE.md`: request de usuário roda como
`sessao(role="authenticated", user_id=usuario.id)`; `service_role` (BYPASSRLS)
fica para operação interna. O risco da conversão é o deste banco: permissão
errada devolve **zero linhas, sem erro**. Por isso cada router convertido
ganha teste em `backend/tests/test_conversao_authenticated.py` que prova:

1. **não zerou** — a contagem que a rota devolve ao admin, sob
   `authenticated`, bate com a contagem sob `service_role`. Onde produção tem
   0 linhas (templates, regras), o teste semeia uma, porque 0 == 0 não prova
   nada;
2. **escrita passa** — criar/editar/apagar pela rota (o `WITH CHECK` e o
   UPDATE/DELETE que afetaria 0 linhas);
3. **não-admin leva 403** — as políticas são todas admin-only; rota em
   `usuario_atual` vira `admin_atual` (todos os usuários reais são admin em
   01/10: 2 de 2, então nenhum usuário perde acesso).

## Medição (01/10/2026, `grep -c 'role="service_role"'` em `app/routers/`)

**128 × 33** nos routers (era 128 × 16 em 04/09 — o lote 6 e o 8C entraram
com `authenticated`). Fora dos routers: `worker.py` 10, `crm/entrega.py` 8,
`auth/router.py` 4, `integracoes.py` 3, `chave_api.py` 3, os demais 1 — todos
operação interna, ficam.

| Router | service_role | Destino | Por quê |
|---|---|---|---|
| `templates.py` | 5 | **converter** (1º) | `email_templates` ALL admin |
| `chaves.py` | 4 | **converter** (2º) | `api_keys` ALL admin |
| `automacoes.py` | 5 | **converter** (3º) | `automation_rules` ALL admin; a escrita compartilhada com `/publico` continua máquina quando não há usuário |
| `segmentos.py` | 9 | **converter** (4º) | `segments`/`segment_contacts` ALL admin; funções de segmento são SECURITY DEFINER |
| `campanhas.py` | 10 | converter (5º) | `campaigns`/`campaign_sends` ALL admin; conferir `email_send_queue` (sem GRANT a `authenticated`) no cancelar |
| `jornadas.py` | 6 | converter (6º) | `journeys` ALL; `journey_runs`/`journey_step_log` só SELECT — só leitura neles |
| `leitura_contatos.py` | 13 | converter (7º) | `leads` SELECT admin; conferir cada tabela do JOIN |
| `escrita_contatos.py` | 6 | **pergunta** | `leads` NÃO tem política de INSERT/UPDATE: sob `authenticated` o UPDATE afeta 0 linhas calado. Precisa de migration (política admin de escrita em `leads`) antes |
| `contatos.py` | 3 | **pergunta** | mesma razão (importar insere em `leads`) |
| `usuarios.py` | 6 | fica | `auth.users` sem GRANT; `user_roles` tem política `false` para escrita — administração de conta é operação de máquina por desenho |
| `configuracao.py` | 17 | fica | `integration_secrets`/`growthhs_config` sem GRANT a `authenticated`; metade das rotas é de máquina (chave) |
| `crm.py` | 1 | fica | `crm_handoffs` sem GRANT |
| `imagens.py` | 2 | fica | `email_assets` sem GRANT |
| `envio.py` | 2 | fica | `enfileirar` é do worker também; `email_send_queue` sem GRANT |
| `datacore.py` | 2 | fica | sincronização, operação de máquina |
| `publico.py`, `ab_publico.py`, `captura.py`, `api_contato.py`, `webhook.py`, `landing.py` | 37 | fica | não há usuário: chave de API, webhook ou página pública |

## Ordem e entrega

Um router por commit, com o teste dele; `pytest -q` e push ao fim de cada um
(ou de um bloco, quando a suíte inteira — ~40 min contra o banco remoto —
cobre mais de um). Estado e "pronto para merge" em `docs/frentes/backend.md`.

⚠️ **Nunca duas rodadas de pytest ao mesmo tempo.** As fixtures `token_admin`
e `token_usuario` usam e-mail fixo e apagam o usuário no setup: uma rodada
apaga o usuário da outra, e os testes falham com 401 apontando para o lugar
errado. Medido em 01/10.
