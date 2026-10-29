# Arrumar a casa antes de divulgar (29/10/2026)

Levantamento só de leitura (código + banco + nomes de chave no ambiente da
api/worker, sem valores). Ordem = o que mais pesa para divulgar a `phoebus`.

## A. Rastreio e mídia paga — o maior buraco

| Item | Hoje | Falta |
|---|---|---|
| Meta Pixel (navegador) | não existe | criar, com `event_id` igual ao do CAPI, condicionado ao consentimento |
| Meta Conversions API | código em `dominio/meta_capi.py` e tela MetaCard com "Testar", mas **ninguém chama** fora do teste; Graph v18.0; `META_*` vazios no env e ausentes do banco | ligar na captura e no agendamento (`Lead`/`Schedule`), `fbc`/`fbp`, IP/UA; subir a versão do Graph; Pixel ID + token |
| Meta Lead Ads | não existe | opcional (R10): webhook `leadgen`, app aprovado, token de página |
| `fbclid` / `gclid` | lidos e gravados em `visitas`, entram no `canal`; não vão para o lead | guardar no lead (`_fbc`, gclid) para conversão |
| GA4 / Google Ads | não existe | tag com Consent Mode; conversão no Ads |
| Clarity | campo no editor, nada renderiza | implementar ou tirar o campo |
| `noindex` da `phoebus` | ligado | tirar se a página deve aparecer no Google |

Depende de: credenciais da Meta/Google (quem opera as contas — Sergio/agência?)
e da decisão D5 (mídia paga) e D3/63-64 (base legal e consentimento).

## B. Configuração que falta preencher (Erick, pela tela)

- Redes sociais do rodapé dos e-mails (`social_links` não existe).
- Chave da IA (`ANTHROPIC_API_KEY` vazia no env e ausente do banco) — só se for usar o chat/análises.
- Esconder "Notificações"/"Conta" (cards "Em construção")?
- Teto de envio × plano gratuito do Resend (100/dia) — pergunta 45 / D8.

## C. Faxina técnica (eu)

- Vídeo: régua do servidor para `arquivo_url`; rota para apagar vídeo; texto "Vídeo do YouTube…" no `SecoesEditor.tsx`.
- Nota do formulário normal ainda mostra a chave do campo extra.
- `DATACORE_*` ainda no env da api/worker e no `config.py` (rota removida em 26/10).
- Chave de API de eventos: 1 cadastrada, 0 ativas — apagar se não há uso.

## D. Pedidos ao HSGrowth (sessão do `hsgrowth-sistema`)

- Nome "Health & Safety" no convite (em andamento 29/10).
- Idempotência (`docs/pedido-hsgrowth-2026-10-29-idempotencia.md`), não bloqueia.
- XSS nas anotações do card (`docs/pedido-hsgrowth-2026-10-26.md`) — sem baixa registrada.

## E. Decisões abertas que pesam

- LGPD do papel leitura (mascarar e-mail/telefone?).
- Perguntas 62 (barrar jornada sem filtro antes do snippet no site), 63/64 (base legal), 66 (CRM não reconfere `allowed_emails`).
- `raio-x-rd.md`: D1 funil, D2 campos, D3 base legal, D5 mídia paga, D6 quem opera, D8 provedor de envio.

## Conferido e ok

GrowthHS em produção (lista 22, roleta de 5); Resend com chave, webhook,
remetente e reply-to; `UNSUBSCRIBE_SECRET` e `WEBHOOK_SECRET` preenchidos no
env; `PROVA_RECEPTOR_TESTE=false`; `phoebus` ativa, `phoebus-prova` inativa;
jornadas da prova arquivadas; balde das imagens corrigido.
