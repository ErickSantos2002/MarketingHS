# Inventário do RD Station (21/10/2026)

Levantamento só de leitura na conta RD Station Marketing da H&S (conta
565510-0000), feito pelo Claude no Chrome logado do Erick. Fecha o **D7** do
`raio-x-rd.md`. Nenhum botão de ação foi clicado.

## Em uma frase

O RD da H&S é, na prática, **um capturador de formulários do site + um
roteador de leads para o comercial (Pipedrive e Horus, via agência) + uma
nutrição de 17 e-mails**. Landing page, formulário do RD, lead scoring,
WhatsApp, SMS, Lead Ads e públicos **não são usados**. Quem opera é a agência
**Leão Marketeria** (4 dos 6 usuários; todas as importações e os webhooks são
dela).

## Números (outubro/2026, até dia 21)

| | |
|---|---|
| Leads na base | **14.643** — 12.329 ativos, 2.314 inativos |
| Hard bounce / soft bounce | 821 / 1.233 |
| Estágio no funil | todos "Lead"; **100 Oportunidades**; 0 Qualificados; 0 Clientes |
| Visitas no mês | 952 (480 direto, 406 orgânico, 33 pago, 8 social, 5 e-mail) |
| Conversões no mês | 76 (≈ 62 leads novos); meta do painel ≈ 105 |
| Páginas mais vistas | `/`, `/categoria.cfm`, `/iblow10pro.cfm`, `/suporte.cfm`, `/artigo.cfm`, `/contato.cfm`, `/phoebus.cfm` |

A maior parte da base veio de **listas importadas** (br-01, br-02, "Dezembro
Verde/Amarelo", "Lista Brevo", "Prospecção"), 2023–2026, pela agência — não
de captação. LGPD: a ficha do lead mostra **"sem histórico de proteção de
dados"**; não há aviso de cookies configurado.

## O que o RD faz hoje para a H&S (e precisa existir aqui)

### 1. Captura dos formulários do site — o essencial

O **código de monitoramento** do RD (`d335luupugsy2.cloudfront.net`) está em
`healthsafety.com.br` (ColdFusion) e no blog, e a **Integração de formulário**
está ativa: o script escuta o envio de qualquer `<form>` e manda a conversão
ao RD, sem mudar o formulário. **79 formulários** capturados:

| Página | Formulários | Identificador de conversão |
|---|---|---|
| `setorcliente.cfm` | 36 | `cap_setores` + `CFForm_*` |
| `/` (home) | 16 | `CFForm_*` |
| uma por produto (`phoebus`, `iblow`, `iblow10c`, `mercury`, `markx`, `jupiter`, `jupiterx`, `titan`, `helios`, `kital8800bt`, `al8800bt`, `interlock`, `interlockx8`, `ebs010`, `alcotorch`…) | 1 cada | `cap_<produto>` (a do Phoebus é `formcontato`) |
| `categoria.cfm`, `setor.cfm`, `contato.cfm`, blog | 8 | `CFForm_*`, `home` |

O formulário de cotação do produto (ex.: `phoebus.cfm`, `id="cap_phoebus"`)
posta em `contato.cfm` com `pnome`, `pemail`, `pwhatsapp`, `pmensagem`,
`passunto` (oculto) e reCAPTCHA. **O `id` do `<form>` vira o evento de
conversão**; form sem `id` vira `CFForm_<aleatório>` — por isso 52 nomes
inúteis.

→ **Precisamos de:** um script nosso, colado no site no lugar do do RD, que
(a) registra visita/origem (UTM, referrer, gclid/fbclid, primeiro e último
toque), (b) intercepta o `submit` dos formulários existentes, mapeia
`pnome/pemail/pwhatsapp/pmensagem` e manda a conversão com o `id` do form como
identificador, sem impedir o envio original ao `contato.cfm`. É o **R3**, com
o detalhe de que o RD **não exige mexer nos formulários do site**.

### 2. Landing do Lovable (`bafometro.healthsafety.com.br`)

É a fonte da maioria dos leads de outubro ("Lp Phoebus Lovable 001"). Tem
formulário próprio que posta **direto no endpoint público do RD**
(`cta-redirect.rdstation.com/v2/conversions`, com `token_rdstation` e
`conversion_identifier`). Campos: nome, e-mail, celular (com DDI), empresa,
"Já faz testagem na sua empresa?" (sim/não). A página também carrega GTM,
Google Ads, Meta Pixel, LinkedIn Insight, Bing e Clarity.

→ **Precisamos de:** endpoint de conversão por **token público** que aceite o
mesmo POST de formulário HTML (R3), e trocar o `action` do form na LP.

### 3. Roteamento para o comercial (via agência)

| Fluxo (ativo) | Gatilho | Ação |
|---|---|---|
| **CRM** | conversão em 19 eventos (todos os `cap_*`, `formcontato`, LPs) | webhook → n8n da agência → **Pipedrive** |
| **[CRM HeS]** | conversão na LP do Lovable | idem, Pipedrive |
| **Leads - Horus** | conversão em 21 eventos (os mesmos + LP Lovable) | webhook → "Horus" (laboratório da agência) |
| **[Horus] [Oportunidade] Agendamento** | evento `AGENDAMENTO` | webhook → Horus |
| **[Oportunidade] Agendamento → Pipedrive** | evento `AGENDAMENTO` (vem do n8n) | marcar Oportunidade |
| **[VENDA] Fechamento → Pipedrive** | evento `FECHAMENTO PIPEDRIVE` (vem do n8n) | marcar Venda |
| **site_hs** | formulário antigo do site | notificar por e-mail o Nicholson |

Ou seja: o comercial hoje trabalha **no Pipedrive**, e o Pipedrive devolve
"agendou" e "fechou" ao RD pela API (app "N8N | PIPEDRIVE", atualizado em
21/10). O RD não tem webhook de saída cadastrado — tudo passa pelo nó "Enviar
Leads para Integração" das automações.

→ **Precisamos de:** nó de jornada "enviar para webhook" (URL livre) e
"notificar por e-mail"; entrada de evento de conversão pela API vinda do n8n
(`AGENDAMENTO`, `FECHAMENTO`) que mude o estágio para Oportunidade/Cliente.
Isso **conflita com o plano do GrowthHS (5A)** — ver a pergunta abaixo.

### 4. Nutrição por e-mail

| Fluxo (ativo) | Gatilho | Passos |
|---|---|---|
| **BOAS-VINDAS** | conversão em 17 eventos do site/LP | e-mail "[01] Boas-Vindas" → 4 dias → entra na Nutrição |
| **Fluxo Nutrição - Base** | lista "BASE ATÉ 04/11" ou importação "CATACLIENTE" (+ quem vem do Boas-Vindas) | **16 e-mails**, 5 a 14 dias entre eles (41.428 entradas, 221 ativos agora) |
| **Lista Brevo Março.26** | listas "abriu/clicou e-mails Brevo" | 4 e-mails em 12 dias → entra na Nutrição |
| **Baixou Ficha Técnica Phoebus / Iblow Pro** | conversão "Baixou Ficha Técnica …" | 1 e-mail com a ficha |
| **Baixou Ebook - LP** | conversão "Ebook 001" | 1 e-mail com o e-book |
| **FLUXO FEV.25 Amarelo / LISTA FEV.25 Verde** | lista importada | cold mail com ramificação "abriu?" (resto parado) |

E-mail avulso: **20 disparos** na vida da conta, o último em **08/08/2025**
(22.982 destinatários, **15,8% de bounce — envio suspenso pelo RD**). Os de
2023–2025 com listas compradas também têm bounce de 2–11%. Remetente:
subdomínio **`email.healthsafety.com.br`** (validado em 21/10).

→ **Precisamos de:** recriar os **~23 e-mails** (Boas-Vindas, Nutrição 001–016,
Brevo 0001–0004, 2 fichas, e-book) como templates e as jornadas acima — o motor
existe (R5). O Resend gratuito (90/dia) aguenta a nutrição do fluxo atual;
**não** aguenta reenviar à base.

### 5. Base e segmentação

- **8 campos personalizados:** WhatsApp, Segmento da empresa, Número de
  funcionários, "Já faz testagem na sua empresa?" (duplicado em duas
  versões), Mensagem aberta, UTM campaign, UTM medium. → insumo direto para o
  **D2** (campos do formulário).
- **81 segmentações**, quase todas listas de campanha antigas; as que importam
  são as de higiene: Leads ativos/inativos, HARD BOUNCE (4 cópias, 821),
  SOFT BOUNCE (1.233), `querem_receber_email=nao`.
- Funil do RD: Lead → Lead Qualificado → Oportunidade → Cliente, movido só
  pelos eventos do Pipedrive. É o mesmo desenho proposto no **D1**.

→ **Precisamos de (R7):** exportação completa da base (todos os campos +
eventos de conversão + estágio + origem) e **das listas de supressão** (hard
bounce, descadastrados, "não quer receber"), importadas **sem disparar
jornada**. A exportação do RD vai por e-mail para quem pede — é o Erick quem
pede.

### 6. Medição

Painel do RD: visitantes → leads → oportunidades → vendas do mês, com meta;
análise por canal (visitas × conversões); páginas mais acessadas; lead
tracking (páginas por lead). Dados de visita vêm do código de monitoramento e
do GA4 conectado (`G-D9LDBR96FT`). → Depende do script do item 1 (R3 + R6).

## O que NÃO precisa vir

| Recurso | Estado no RD |
|---|---|
| Landing pages do RD | 10, todas de 2023–24 em `bafometrotech.healthsafety.com.br` |
| Formulários do RD | nenhum |
| Pop-ups | 2 publicados: pop-up de saída da LP e botão de WhatsApp na página de obrigado (o resto é rascunho) — se quiser manter, é um botão flutuante simples |
| Lead scoring | não configurado |
| WhatsApp, SMS, Web Push | não contratados |
| Lead Ads, Públicos para anúncios, Eventos do Facebook Ads | não conectados (Meta desconectada, Google Ads nunca ligado) |
| Postagem em redes, Link da bio | sem uso (LinkedIn expirou em 2023) |
| Integrações antigas | Meetime, GS Engage, Leadster, Pluga, stract, Gerenciador de Campanhas — sem sinal de uso recente; **Make (Integromat)** atualizado em 20/10 e o **n8n/Pipedrive** em 21/10 estão vivos |

## Ordem para desligar o RD

1. **R3** — endpoint por token público + script do site (rastreio + captura
   dos formulários existentes). Sem isso, desligar o RD **para a captação** do site inteiro.
2. **Saída para o comercial** — webhook (Pipedrive via n8n e Horus) *ou*
   GrowthHS, conforme a resposta abaixo; e a volta de AGENDAMENTO/FECHAMENTO.
3. **Templates + jornadas** — Boas-Vindas, Nutrição (16), fichas técnicas,
   e-book, notificação por e-mail.
4. **R7** — exportar e importar base + supressões (sem automação).
5. Trocar o script no site e o `action` da LP do Lovable; deixar os dois
   rodando em paralelo uma ou duas semanas e comparar contagem de conversões.
6. Remetente: decidir se continua `email.healthsafety.com.br` no Resend.

## Perguntas novas

- ~~**O CRM é o Pipedrive?**~~ Erick, 21/10: **o CRM é o GrowthHS.** A saída
  para o comercial é a do 5A. Fica a dúvida de quem ainda olha o Pipedrive,
  que o RD alimenta até hoje (n8n da agência ativo em 21/10) — pergunta à
  Leão Marketeria.
- **O que é o Horus** e quem depende dele (atendimento por IA/WhatsApp da
  agência?). Continua recebendo lead? Erick não sabe; perguntar à Leão.
- **A Leão Marketeria segue?** Ela opera o RD, as importações e os dois
  webhooks. Define o papel de operador (D6) e quem cola o script no site.
- **Quem mantém o site ColdFusion?** É lá que o script troca.
- **E-mails da nutrição:** reaproveitar os textos do RD como estão?
