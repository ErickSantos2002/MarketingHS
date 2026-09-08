# Captação pública — o desenho

**Data:** 8 de setembro de 2026
**Autoridade acima deste documento:** `docs/superpowers/specs/2026-08-31-marketinghs-design.md`
**Estado do projeto quando isto foi escrito:** lote 7 fechado e mergeado em `main`
(`7ae95d2`). 34 functions portadas, 7 descartadas, restam 13.

---

## 1. Por que este documento existe

A spec de 31/08 descreve o lote 7 como **"Captação pública — landing modelo da
HS, conversões, OG estático, teste A/B"**, e na linha 439 diz, explicitamente,
que **não decide o desenho da landing**. Este documento decide a parte que dá
para decidir, e diz em voz alta a parte que não é nossa.

O lote 7 executado em 08/09/2026 foi **só o porte** (páginas e conversões), por
decisão do Erick. A captação pública ficou inteira para depois — é ela que este
documento desenha.

---

## 2. A decomposição, e por que ela veio antes de tudo

"Captação pública" não é um subsistema. São três, e dois não dependem do
terceiro:

| | O que é | Entrega sozinho? |
|---|---|---|
| **A** | Landing + captura: a página pública, o formulário, `lead-capture`, `validate-email-domain`, e a conversão | **Sim** — um lead entra e chega qualificado |
| **B** | OG estático: a imagem de preview do link compartilhado | Não — precisa de página para prever |
| **C** | Teste A/B: `go`, `ab-events`, o Worker do Cloudflare, as três telas de Experiments | Não — precisa de variante para testar |

⚠️ **O C é o que mantém o toco do Supabase vivo** — os 9 pontos do alias
`const db = supabase as any` em `useAbConfig.tsx` e `useAbTests.tsx`. Há a
tentação de atacá-lo primeiro por isso. **Não vale:** ele depende de uma conta
Cloudflare que a HS não tem, e testar A contra B sem ter A é impossível.

**Este documento desenha o A.** B e C ganham spec própria quando chegar a vez.

A lição vem do lote 5, que virou 5A/5B/5C/5D **depois** de já ter começado.
Decompor antes custa uma conversa; decompor no meio custa um plano.

---

## 3. O que a HS vende, e por que isso muda a landing

Da base de conhecimento (`Health-Safety/Empresa/`): a HS é **revendedora de
bafômetros para indústria pesada e logística** — siderúrgica, mineradora,
transporte. B2B, nunca consumidor final. O time inteiro são duas pessoas
técnicas, e a decisão de produto é do Nicholson.

A dor do cliente **não é testar — é registrar e provar**. Teste de alcoolemia
antes do turno já é obrigação por regulamentação, exigência de seguradora ou
política interna de SST; o que falta é o registro auditável. É por isso que o
bafômetro conectado a uma plataforma faz sentido para esse público.

⚠️ **Consequência direta para este desenho:** o molde `/humanoseagentes`, que a
spec manda usar como referência, é a landing de uma consultoria de agentes de
IA. Ele serve como **estrutura** — hero, prova, qualificação, CTA — e **nada do
conteúdo dele se aproveita**. São 3.426 linhas de TSX que são exemplo, não
matéria-prima.

---

## 4. A decisão que não é nossa

**Qual é a oferta da landing** — o que o lead ganha ao preencher — é decisão do
Nicholson, e o Erick não a cravou em 08/09/2026.

Isso não bloqueia o subprojeto, porque muda o que ele é:

> **A "landing modelo da HS" é um motor de template, não um conteúdo.**

Headline, subheadline, texto e cor do CTA, quais campos o formulário mostra,
para onde redireciona depois e o SEO **já são editáveis** na tela de Páginas,
que o lote 7 portou. A oferta vira configuração, digitada por quem decide.

⚠️ **O limite disso, cravado agora para não ser descoberto no meio:** um
template de página única com um formulário **não estica** para o formato
diagnóstico — várias perguntas encadeadas com resultado calculado, que é o que
o molde `/humanoseagentes` faz. Se a oferta escolhida for essa, é outra
construção, não outra configuração.

---

## 5. As decisões deste desenho

### 5.1 A casca HTML é servida pelo FastAPI

`GET /p/{slug}` responde um HTML pequeno, com `<title>`, `meta description` e
as `og:*` preenchidas de `pages.config`, **e a config inteira embutida** num
`<script type="application/json">`.

**Por que servida, e não montada no cliente:** anunciar exige preview de link
correto, e o Meta e o WhatsApp leem o **HTML cru** da resposta. Um SPA entrega
a eles o mesmo `index.html` para toda página, então o preview sai genérico ou
errado.

**Por que casca fina, e não renderização completa:** o backend não tem Jinja,
`TemplateResponse`, `HTMLResponse` nem `StaticFiles` — medido em 08/09/2026.
Renderizar a página inteira no servidor significa introduzir stack de template
**e** reescrever em Jinja o que é React. A casca entrega o motivo da escolha (o
preview correto) sem pagar isso.

⚠️ **`/p/{slug}` e não `/{slug}`.** Um catch-all na raiz sombrearia `/paginas`,
`/publico`, `/auth`. A URL limpa para anúncio é problema do nginx em produção —
e o host de produção ainda é o item 11 da lista de pendências.

⚠️ **A config embutida vem de campo editável no admin, e vai para dentro de
HTML.** Escapar é requisito, não zelo — inclusive escape de atributo, que é
onde as `og:*` vivem, e escape do JSON embutido, que fecha `</script>` se
alguém digitar isso numa headline.

### 5.2 A config vai embutida porque a landing não pode carregar chave

`GET /publico/paginas/{slug}` existe desde o lote 7, e exige
`chave_api("read")`. **Um navegador anônimo não pode carregar chave de API** —
qualquer credencial que chegue à landing está publicada. Embutir a config na
casca resolve isso sem inventar um segundo endpoint público e sem segunda ida
ao servidor.

### 5.3 O renderizador é uma segunda entrada do Vite

`frontend/src/landing/`, com build próprio. O visitante **não** baixa o bundle
do admin. Lê o JSON da casca e monta hero, formulário e CTA a partir da config.

### 5.4 A captura é `POST /publico/captura`, e ela registra a conversão

Substitui `lead-capture` e `validate-email-domain`. **Sem autenticação, por
desenho** — é a landing anônima chamando — e por isso sob `/publico`, dentro do
limite de taxa. O `main.py` já antecipa isso: o comentário do middleware diz
que os prefixos crescem "conforme os lotes 3 e 7 trouxerem as rotas de
captura".

Numa transação: valida o e-mail → `resolve_or_create_identity` → insere o lead
→ **registra a conversão** → aplica a tag derivada do slug.

⚠️ **A conversão é registrada no servidor, e isso é decisão, não detalhe.** O
`frontend/src/lib/leadConversion.ts`, apagado no lote 7, fazia isso do
navegador. A rota `POST /publico/conversao` exige chave de API — ver 5.2.
Fechar o laço dentro da captura é o único caminho que não expõe credencial.

### 5.5 E-mail: descartável é recusado, gratuito não

Lista de descartáveis conhecidos + consulta MX, ***fail-open*** como no
original: erro de rede ou DNS instável **deixa passar**.

⚠️ **E-mail gratuito (gmail, hotmail) nunca é bloqueado.** Numa base de
siderúrgica e mineradora o e-mail corporativo é a norma, mas transportadora
pequena usa gmail de verdade — bloquear perde lead real. O sinal, se importar,
vira **pontuação** na régua que já existe em Configurações → Lead Scoring.

**Nenhum caminho de falha nosso pode recusar um lead real.** É a regra que
resolve todo caso duvidoso desta seção.

Em Python a consulta MX é DNS nativo, não HTTP para o `dns.google` como a
function original fazia — some um terceiro do caminho crítico da captura.

### 5.6 O que já existe e só precisa ser ligado

| | |
|---|---|
| Identidade unificada | `resolve_or_create_identity` (lote 5C) |
| Pontuação e etiqueta | `trg_score_lead_on_change`, **BEFORE INSERT** em `cargo, faturamento, funcionarios, desafios, whatsapp` |
| Evento de contato | `trg_lead_insert_event` |
| Contato canônico | `trg_leads_contato_canonico` (lote 5C) |
| Conversão | `_recalcular_datas`, `_aplicar_tag_do_slug` (lote 7) |
| Meta CAPI | parametrizado e **desligado** (lote 5C) |

⚠️ **Os cinco campos do gatilho de pontuação são, na prática, o que qualifica um
lead neste sistema.** Um formulário que não colete nenhum deles gera lead com
score zero. Se a oferta do Nicholson pedir campo que não existe como coluna
(por exemplo "quantos operadores testam por turno"), isso é **migration mais
alteração da função de score** — não é configuração.

### 5.7 As colunas de A/B viajam desde já

`ab_test`, `ab_var` e `ab_vid` existem em `leads` e em `lead_conversions`, e a
rota de conversão do lote 7 já as aceita. O formulário repassa o que vier na
URL. Assim, quando o subsistema C chegar, o dado já está fluindo — e não haverá
uma base histórica sem atribuição.

---

## 6. Abuso

Formulário público é superfície de spam, e este nasce sem CAPTCHA — por
desenho, porque CAPTCHA em landing B2B derruba conversão real.

| Camada | O que faz |
|---|---|
| Limite de taxa `/publico` | 30/min por IP, middleware do lote 0 |
| `leads_email_unique` | índice único, já existente — o mesmo e-mail não vira dois contatos |
| Descartáveis | lista conhecida, recusada na captura |

⚠️ **Se isso não bastar, a resposta não é CAPTCHA primeiro.** É medir o que
está entrando (a tela de Contatos mostra origem e UTM) antes de pôr atrito num
funil que ainda não tem volume.

---

## 7. Verificação

Pela régua da casa — **pytest só onde executar não prova**:

- a captura ponta a ponta: lead criado, pontuado, etiquetado, com conversão e
  tag, tudo numa transação;
- o ***fail-open*** da validação de e-mail (DNS fora do ar não recusa lead);
- descartável conhecido recusado.

O renderizador não ganha teste automatizado — abrir a página prova.

**O portão**, com o que o lote 7 ensinou: além dos quatro passos, **abrir a
landing no navegador e enviar o formulário de verdade**, conferindo que o
contato aparece na tela de Contatos com score e etiqueta.

⚠️ A lição do lote 7, que vale aqui: os passos de `grep` não pegam defeito que
não é chamada. O `https://dnia.ai/` cravado no `UTMPresetsModal` só apareceu
porque alguém abriu a tela e clicou.

---

## 8. O que este documento não decide

- **A oferta da landing** — o que o lead ganha ao preencher. Decisão do
  Nicholson. Até ela existir, a landing nasce como motor sem conteúdo.
- **O desenho visual.** O design system da HS vive no Claude Design e deve ser
  lido de lá, não inventado.
- **O host de produção** — item 11 da lista de pendências, e é ele que define a
  URL que vai no anúncio.
- **A imagem OG** (subsistema B) e o **teste A/B** (subsistema C).
- **Se a HS faz anúncio no Meta** — item 7 da lista. Sem essa resposta o CAPI
  segue configurado e desligado, que é um estado válido.

---

## Notas relacionadas

- `docs/superpowers/specs/2026-08-31-marketinghs-design.md` — a spec do projeto,
  autoridade acima desta
- `docs/CONTINUAR-AQUI.md` — onde o projeto parou
- `docs/referencia/humanoseagentes/` — o molde estrutural, conteúdo descartável
- `docs/ab-testing/` — o subsistema C, quando chegar a vez
