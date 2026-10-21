# Prova de substituição do RD — o desenho

**Data:** 21 de outubro de 2026
**Pedido (Erick, 21/10):** "não vamos simplesmente substituir de uma vez, mas
vamos ter certeza que conseguimos fazer tudo: criar uma landing page e provar
que ela funcionalmente consegue lead para o GrowthHS e também consegue fazer os
disparos de e-mails e tudo que a RD faz." A prova é **interna**, só com
e-mails nossos.
**Base:** `docs/inventario-rd.md` (o que o RD faz de fato), `docs/raio-x-rd.md`
(lotes R0–R10). Este documento puxa para a frente pedaços do R2, R3, R5, R6 e
do 5A, na medida da prova.

---

## 1. Por que

O Nicholson quer parar de pagar o RD e **tirar a dependência da agência Leão
Marketeria** (21/10: a agência fica por enquanto, a dependência não). Antes de
mexer no site ou desligar qualquer coisa, queremos ver o MarketingHS fazer,
ponta a ponta, as três coisas que o RD faz hoje para a H&S:

1. **pegar o lead** — da landing e dos formulários do site, com origem;
2. **entregar ao comercial** — hoje vai ao Pipedrive/Horus pelo n8n da
   agência; o CRM da empresa é o **GrowthHS** (Erick, 21/10);
3. **nutrir por e-mail** — boas-vindas, sequência, ficha técnica, aviso ao
   comercial.

E medir: visitas, conversões e taxa por página e por canal.

**Sucesso:** um roteiro (seção 7) executado em produção com e-mails nossos,
em que cada passo que o RD faz hoje tem o seu equivalente funcionando aqui —
com a única exceção declarada do card no GrowthHS, se o endpoint do lado de lá
ainda não existir (seção 4.6).

## 2. Metas, não-metas, antimetas

**Metas**
- Landing **"Phoebus"** no MarketingHS (`/p/<slug>`), equivalente à do Lovable
  (`bafometro.healthsafety.com.br`): mesmos campos, imagem, texto, mensagem de
  obrigado, consentimento.
- Captura de formulário **de outro domínio** sem mudar o formulário — o que o
  "código de monitoramento" do RD faz no `healthsafety.com.br`.
- Rastreio de visita (página, referrer, UTMs, gclid/fbclid, primeiro e último
  toque) na landing e no site de teste.
- Consentimento LGPD registrado por lead.
- Jornadas da prova: boas-vindas → nutrição, ficha técnica, aviso ao
  comercial, envio ao GrowthHS.
- Volta do CRM: "agendou" e "fechou" mudam o estágio do lead.
- Números da página: visitas, conversões, taxa, por canal.

**Depois da prova interna (Erick, 21/10):** liberar externamente **com o RD
ainda rodando** — o nosso script no site real e a nossa landing recebendo
tráfego de verdade, em paralelo, para comparar contagens. Não é desta rodada,
mas o desenho tem que permitir: o nosso script **convive com o do RD** na
mesma página (os dois escutam o mesmo envio, nenhum atrapalha o outro), e a
landing pode deixar de ser `noindex` sem mudança de código.

**Não-metas (vêm depois, com a prova aprovada)**
- Desligar o RD, colar o script no site real, mexer na landing do Lovable.
- Importar a base do RD (R7).
- Recriar os 16 e-mails da nutrição com os textos do RD (a prova usa 2–3).
- Editor de landing por blocos, pop-up de saída, A/B novo.
- Pixel/CAPI/Google Ads (R10).
- Papel de operador de marketing (D6).

**Antimetas — se acontecer, a prova falhou mesmo "funcionando"**
- **Qualquer e-mail sair para alguém fora da lista de e-mails nossos.** As
  jornadas da prova só podem matricular quem converteu na página da prova
  (filtro por página, que já existe) — nunca por segmento da base.
- Lead de teste sumir no meio dos números reais sem marca: todo lead da prova
  leva a tag `prova-rd` e sai do painel/limpa no fim.
- O script de captura **impedir ou atrasar** o envio do formulário original do
  site. No site real, o formulário de cotação manda e-mail ao comercial pelo
  `contato.cfm`; se o nosso script quebrar isso, perdemos lead.
- Chave secreta no navegador. A captura externa usa **token público**, que só
  cria/atualiza lead e conversão — nunca dispara campanha nem lê dado.

## 3. Restrições

- **O banco é o de produção.** Migration nova tolera reaplicação (`IF NOT
  EXISTS`), é aplicada pelo comando do `CLAUDE.md`; deploy no EasyPanel é do
  Erick. Nenhum botão de ação clicado no navegador fora do roteiro da seção 7.
- **Resend no plano gratuito** (teto 90/dia, 90/h): a prova cabe com folga
  (≈ 10 contatos × ≈ 5 e-mails).
- Regras do `CLAUDE.md` valem inteiras: `sessao(role="authenticated", …)` em
  rota de usuário, cada rota autoriza sozinha, toda chave nova em `Settings`,
  cor só de token, os três índices únicos intocáveis.
- O GrowthHS é **outro repositório** (`hsgrowth-sistema`): daqui só se lê e se
  entrega especificação.
- Política de privacidade do site já existe: `https://www.healthsafety.com.br/privacidade.cfm`
  (o D3 continua aberto; a prova usa o link e marca a versão do texto como
  provisória).

## 4. O que se constrói

### 4.1 Campos do formulário com tipo

Hoje todo campo é texto livre de uma lista fixa (`captura/campos.py`) e só o
e-mail é obrigatório. A landing do Phoebus precisa de:

| Campo | Tipo | Obrigatório |
|---|---|---|
| Nome | texto | sim |
| E-mail | e-mail | sim |
| Celular | telefone (Brasil, com DDD; DDI fixo +55 na prova) | sim |
| Empresa | texto | sim |
| Já faz testagem na sua empresa? | sim/não | não |

O editor da página passa a escolher, para cada campo: rótulo, tipo (texto,
e-mail, telefone, lista, sim/não, texto longo), obrigatório, e as opções da
lista. **Campos que não existem como coluna** (como "já faz testagem") vão para
os dados personalizados do contato e **têm que ser usáveis em condição de
jornada e em segmento** — senão o campo não serve para nada. A validação do
obrigatório e do formato acontece **no servidor também**.

### 4.2 Landing com cara de landing

Além dos campos: imagem de destaque (o upload de imagem já existe),
um texto de corpo (parágrafos e lista simples), a **mensagem de obrigado na
própria página** depois do envio (a rota `/obrigado` não existe — não depender
dela) e, opcional, botão flutuante de WhatsApp com número e mensagem
configuráveis (o RD tem um na página de obrigado). A página da prova fica com
`noindex`.

### 4.3 Consentimento (LGPD mínimo)

- Checkbox **não marcado** no formulário: texto curto + link da política.
  Sem marcar, o lead é gravado? **Não** — na prova o consentimento é
  obrigatório para enviar (é a opção segura; o D3 pode mudar).
- Registro por conversão: lead, base legal (`consentimento`), texto exibido,
  versão do texto, data/hora, IP, user-agent, origem (página ou site +
  identificador do formulário).
- A ficha do contato mostra o histórico de consentimento.
- Na captura de site externo (4.4) o formulário do site **não tem** checkbox:
  o registro sai com base legal `legitimo_interesse_pedido_contato` (a pessoa
  pediu cotação) e a versão marcada como provisória. Fica como pergunta ao
  Nicholson junto do D3.

### 4.4 Captura de formulário de outro site (o "código de monitoramento")

É a peça que o RD tem e nós não. Um script nosso, colado no `<head>` do site,
que:

1. **Registra a visita**: página, título, referrer, UTMs, `gclid`/`fbclid`,
   um id de visitante em cookie primário do site, primeiro e último toque.
2. **Escuta o envio de qualquer `<form>`** da página que tenha um campo de
   e-mail, lê os campos, e manda a conversão ao MarketingHS **sem bloquear nem
   atrasar o envio original** (`sendBeacon`/`fetch keepalive`). Se o nosso
   servidor estiver fora, o site segue funcionando.
3. Usa como **identificador da conversão** o `id` do form; sem `id`, um nome
   estável (caminho da página + posição do form) — nunca aleatório como o
   `CFForm_*` do RD.
4. **Mapeia os campos por nome**: um mapa padrão que já cobre o site da H&S
   (`pnome`→nome, `pemail`→e-mail, `pwhatsapp`→celular, `pmensagem`→mensagem,
   `passunto`→assunto) e os nomes comuns (`name`, `email`, `phone`…), e um
   mapa editável por site. Campo de senha, cartão e oculto de captcha nunca
   são lidos.

Do lado do servidor:
- **"Sites"** cadastrados no MarketingHS: nome, domínios permitidos, **token
  público**, mapa de campos, ativo/inativo. O token só vale vindo de um
  domínio permitido (CORS por domínio + checagem do `Origin`).
- Endpoint público de visita e de conversão por token, com o mesmo cuidado da
  captura de hoje: limite por IP, campo-isca, não sobrescreve dado existente,
  primeiro toque congelado, tag e evento `form_submitted` com o identificador
  (para jornada filtrar por formulário, como hoje filtra por página).
- A landing `/p/<slug>` carrega o mesmo script para ter visitas.
- Tela para cadastrar o site e copiar o snippet.

**Para provar** sem tocar no site real: uma página de teste, servida em
**outra origem** que não a da API, com uma cópia do formulário de cotação do
Phoebus (mesmos `name`s, `id="cap_phoebus"`, `action` para um endereço que
apenas responde "recebido") **e com o script do RD carregado junto**, para
provar que os dois convivem. Onde hospedar é decisão de quem constrói (seção 6).

### 4.5 Jornadas: o que falta

Nós novos no construtor de jornada:
- **Avisar por e-mail** (interno): para um ou mais endereços fixos, com nome,
  e-mail, celular, empresa, página/formulário, mensagem e link para a ficha do
  contato. É o que o fluxo `site_hs` do RD faz para o Nicholson. Não conta
  para supressão nem descadastro do lead, mas conta no teto de envio.
- **Enviar para webhook**: POST JSON para uma URL configurada, com tentativas.
  Cobre o que o RD faz com o n8n e o Horus, sem depender deles.

E arquivo para a ficha técnica: aceitar **PDF** (até 10 MB) no armazenamento
que hoje só aceita imagem, com link público estável para pôr no e-mail.

Jornadas montadas para a prova (todas com entrada **evento `form_submitted`
filtrado pela página/formulário da prova**):

| Jornada | Gatilho | Passos |
|---|---|---|
| Boas-vindas + nutrição | landing Phoebus ou form do site de teste | e-mail Boas-vindas → espera → Nutrição 1 → espera → Nutrição 2 (esperas curtas na prova, ex.: 10 min) |
| Ficha técnica | conversão "Baixou ficha técnica Phoebus" (um segundo formulário na landing ou no site de teste) | e-mail com link do PDF |
| Aviso ao comercial | as mesmas conversões | avisar por e-mail (endereço nosso) + enviar ao GrowthHS |

Textos dos e-mails: escritos para a prova, curtos, com a marca. Os do RD vêm
na migração.

### 4.6 GrowthHS

O lado do MarketingHS está pronto desde o 8D (fila `crm_handoffs`, nó
`handoff_growthhs`, cliente em `app/crm/growthhs.py`). Falta o
`POST /api/v1/integration/cards` no `hsgrowth-sistema` — contrato em
`docs/contratos/2026-09-02-endpoint-card-comercial-growthhs.md`, ainda não
implementado (conferido em 21/10).

- Este trabalho **atualiza o contrato** com o que a prova adicionar ao card
  (consentimento, formulário de origem, campos personalizados) e o entrega.
  Construir lá é uma sessão aberta no `hsgrowth-sistema`.
- Até lá, a prova do handoff é **até a porta**: o card sai da fila e chega a
  um receptor de teste que registra o pedido; o roteiro marca "GrowthHS:
  pendente do endpoint".

**Volta do CRM:** o GrowthHS (ou, na prova, um `curl`) avisa "reunião
agendada" e "venda fechada"; o MarketingHS muda o estágio do lead
(`MQL - Reunião agendada`, `Venda realizada`). Hoje a rota de status só aceita
`dnia_id` e a de evento recusa `growthhs` como origem: aceitar e-mail ou id do
lead e a origem `growthhs`.

### 4.7 Números da página

Na tela de Páginas (e no painel, se couber sem refazer o painel): visitas,
visitantes únicos, conversões, taxa de conversão, por página e por canal,
no período. Mesma régua para "site" (4.4) — por formulário. A agregação é no
servidor.

## 5. O que já existe e só se usa

Captura com primeiro toque congelado, não sobrescrever, campo-isca e limite
(R1/R5); evento `form_submitted` filtrado por página (026); envio pelo Resend
com ritmo, supressão, descadastro de um clique e webhook de entrega; editor de
templates (Unlayer); upload de imagem; estágios em `lead_statuses`; fila de
handoff ao GrowthHS.

## 6. Deixado para quem constrói

- Modelo de dados dos campos tipados, dos sites e do consentimento (tabelas,
  nomes), respeitando: migration com dono único, reaplicável.
- Onde hospedar a página de teste de outra origem (um subcaminho servido por
  outro serviço, um arquivo no próprio `frontend/public` aberto por outro
  host, etc.) — desde que a origem seja diferente da API e o CORS seja provado
  de verdade.
- Nome e formato do script e do endpoint público.
- Divisão em frentes e ordem, desde que a migration seja de uma frente só.
- Se o botão de WhatsApp entra nesta rodada ou fica para depois.

## 7. O roteiro da prova

Executado em produção depois do deploy, com e-mails nossos (o Erick indica
quais). Cada linha vira ✅/❌ no `CONTINUAR-AQUI.md`.

1. Abrir a landing da prova; a visita aparece nos números da página.
2. Enviar sem marcar o consentimento → recusado. Marcar → lead criado, com
   UTMs da URL, tag `prova-rd`, consentimento registrado (texto, versão, IP).
3. Chega o e-mail de boas-vindas; depois as duas da nutrição, no intervalo.
4. Chega o aviso interno com os dados do lead.
5. O card chega ao GrowthHS (ou ao receptor de teste, com "pendente do
   endpoint").
6. Pedir a ficha técnica → chega o e-mail com o PDF que abre.
7. Na página de teste de outra origem, enviar o formulário de cotação → o
   envio original acontece normalmente **e** o lead aparece aqui com o
   identificador `cap_phoebus`, a página e a origem; dispara a mesma jornada.
8. Repetir o envio com o mesmo e-mail → não duplica lead, não sobrescreve
   dado, conta nova conversão.
9. `curl` de "reunião agendada" e "venda fechada" → estágio do lead muda.
10. Descadastrar pelo link do e-mail → a nutrição para para esse contato.
11. Números: visitas, conversões e taxa batem com o que foi feito.
12. Limpeza: leads com `prova-rd` arquivados; nenhum e-mail saiu para fora da
    lista (conferir o log de envios do dia).

## 8. Perguntas que ficam (vão para `perguntas-abertas.md`)

- **Base legal no formulário do site sem checkbox** (4.3): assumido
  "legítimo interesse — pediu contato"; alternativa é pôr checkbox no site.
- **Consentimento obrigatório na landing** (4.3): assumido sim.
- **Quem recebe o aviso interno** de lead novo em produção (na prova, um
  e-mail nosso).
- **Horus**: continua? (perguntar à Leão).

## 9. Decisões da revisão (21/10)

Um revisor leu o desenho como quem vai construir. O que ele perguntou, e como
ficou — tudo **decisão do Claude**, para o Erick conferir:

1. **Script do RD na página de teste.** Carrega o script real da conta da
   H&S, mas o formulário de teste usa `id="prova_cap_phoebus"` (com os mesmos
   `name`s do site), **não** `cap_phoebus`: os fluxos do RD que mandam ao
   Pipedrive, ao Horus e às boas-vindas escutam identificadores listados um a
   um, e este não está em nenhum. Efeito no RD: um lead com e-mail nosso e um
   formulário novo na lista de integrados — nada roteado à agência. No roteiro,
   o passo 7 confere o identificador `prova_cap_phoebus`.
2. **Trava contra e-mail para fora.** `noindex` não impede acesso. A jornada
   ganha um **modo teste**: uma lista de e-mails permitidos; com ela
   preenchida, o executor **não envia** (nem e-mail, nem aviso, nem handoff,
   nem webhook) para quem não está na lista — registra como pulado. As
   jornadas da prova nascem nesse modo. Vale para a fase externa também: tira
   a lista quando for liberar.
3. **Outras jornadas pegando o lead da prova.** Conferido no banco em 21/10:
   **nenhuma jornada, nenhuma regra de automação**, 3 envios na vida. Nada a
   excluir. A tag `prova-rd` é aplicada na captura, como a tag do slug hoje.
4. **Limpeza = `deleted_at`** (exclusão lógica que já existe). Durante a
   prova os números **incluem** os leads da prova (o passo 11 confere isso);
   a limpeza é o último passo.
5. **Volta do CRM:** chave de API que já existe, escopo de escrita, origem
   `growthhs` aceita; lead achado por id, e-mail ou `dnia_id`. Estágio **só
   avança** (pela ordem de `lead_statuses`), nunca volta por evento do CRM. O
   contrato entregue ao `hsgrowth-sistema` descreve essa chamada. Na prova,
   `curl` com uma chave nossa.
6. **Receptor de teste do handoff:** a fila `crm_handoffs` real, com a URL
   base do GrowthHS (Configurações → GrowthHS, tabela `growthhs_config`, sem
   deploy) apontando para um **receptor nosso** que implementa o contrato do
   `POST /integration/cards`: valida o corpo, responde como o GrowthHS
   responderia e guarda o pedido para conferência. Serve depois como teste do
   contrato. Fica atrás de uma chave em `Settings`, desligado por padrão.
7. **Teto do Resend:** nada mais envia hoje (item 3); a prova cabe nos 90/dia.
