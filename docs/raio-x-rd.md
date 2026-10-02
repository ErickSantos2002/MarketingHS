# Raio-x: MarketingHS × RD Station (02/10/2026)

**Objetivo (Erick/Nicholson, 02/10):** substituir o RD Station Marketing, com
foco em **captar leads novos** — a base de clientes do DataCore é secundária.
O RD está ativo hoje no site `healthsafety.com.br` (script
`d335luupugsy2.cloudfront.net/.../46bacd8c-...-loader.js`).

Quatro análises só de leitura (captação, qualificação, medição, e-mail/LGPD),
com evidência em arquivo:linha nos relatórios das frentes. Este documento é a
síntese e a ordem de trabalho.

## Em uma frase

O **motor** é bom (fila, worker, Resend, segmentos, jornadas, A/B, handoff
pronto do nosso lado). O que está torto é **a ponta**: a captura está quebrada,
o site não tem como mandar lead sem o RD, não há registro de consentimento, e
o painel e a pontuação medem o funil da dn.ia (evento de IA para pessoa
física), não o da H&S (bafômetro B2B).

## Confirmado em produção (02/10)

| | Achado | Estado |
|---|---|---|
| 🔴 | **Landing não capta lead.** O formulário posta em `/publico/captura` → **405** (o certo é `/api/publico/captura`). Toda landing publicada recusa o lead e mostra "Não conseguimos registrar agora". | frente `consertos-urgentes` (U1) |
| 🔴 | **Descadastro de um clique (Gmail/Yahoo) quebrado.** `POST /descadastrar` → **405**. Só o link do rodapé funciona. Sem isso o destinatário marca spam e o domínio novo queima. | frente `consertos-urgentes` (U2) |

## Achados que derrubam em silêncio

- **Importar CSV dispara automação** (U3): subir a base do RD matricularia todo
  mundo em jornada e poderia mandar cards em massa ao GrowthHS.
- **Jornada "Lead criado" nunca dispara** (U4): o seletor oferece um evento que
  o banco não emite.
- **Regra de automação por tag** (U5): a prévia conta, o gatilho ignora.
- **Captura anônima sobrescreve dados** de um contato real só por saber o
  e-mail; `leads.utm_*` é sobrescrito a cada reconversão (perde-se a origem do
  primeiro toque).
- **Duas pontuações na tela:** P1–P4 / "Decisão" calculadas no navegador com o
  perfil da dn.ia (faturamento ≥ R$ 1,5M, "IA/automação", mentor/freelancer
  como decisor) × `lead_score` do banco (régua da H&S, provisória).
- **Worker sem controle de volume:** lotes de 20 sem intervalo nem teto diário;
  domínio novo + disparo para a base inteira no dia 1 é o pior cenário.
- **Sem botão de pausar** campanha já enfileirada.
- **Painel conta no navegador**, com teto de 10.000 contatos.

## RD × MarketingHS

| Recurso do RD | Aqui | |
|---|---|---|
| Landing page | Existe (`/p/<slug>`), editor fraco (só título, CTA e campos texto) — e **quebrada** (acima) | 🔴 |
| Formulário / pop-up no site do cliente | Não existe. Só API com chave secreta, que não pode ir ao navegador (dispara campanha) | ❌ |
| Script de rastreio do site (visitas, origem, primeiro toque) | Não existe (o `ab.js` só age dentro de teste A/B) | ❌ |
| Consentimento LGPD (base legal, opt-in, prova) | Não existe — zero colunas, zero checkbox | ❌ |
| Direitos do titular (exportar, eliminar) | Exclusão só lógica; eventos guardam e-mail para sempre | ❌ |
| Base de leads, segmentação | Existe, boa (estático e dinâmico, ~15 tipos de regra) | ✅ |
| Lead scoring perfil × interesse | Um eixo só, teto 85, quase sem comportamento, não decai | ⚠️ |
| Estágio do funil (Lead → Qualificado → Oportunidade) | `lead_statuses` existe, só manual, nenhuma tela mostra | ⚠️ |
| Automação de marketing | Jornadas visuais boas (e-mail, espera, condição, tag, handoff); faltam "mudar status" e "remover tag" | ✅/⚠️ |
| E-mail marketing | Bom (fila, Resend, supressão, webhook, estatística ao vivo); faltam volume, pausa, remetente por campanha | ✅/⚠️ |
| Relatórios de captação | Painel da dn.ia; sem canal, sem taxa de conversão de página, sem funil, sem custo | ⚠️ |
| Integração com CRM | Pronta do nosso lado; espera o endpoint do GrowthHS | ⏳ |
| Usuários | Só admin — não há papel de operador de marketing | ⚠️ |
| Importação de outra ferramenta | CSV ingênuo, perde histórico, tags, consentimento, supressão | ⚠️ |

## Ordem de trabalho proposta

Régua: primeiro o que **perde lead ou queima o domínio**, depois o que **traz
lead novo pelo site**, depois o que **qualifica e mede**.

| Lote | O quê | Esforço | Depende de |
|---|---|---|---|
| **R0 Consertos urgentes** ✅ | U1 captura da landing · U2 descadastro de um clique · U3 importação sem automação · U4 gatilho "Lead criado" · U5 regra por tag | P | ✅ 02/10, em produção |
| **R1 Proteger envio e base** ✅ | Controle de volume no worker (por segundo, teto diário, rampa de aquecimento) · pausar/parar campanha · captura não destrutiva (não sobrescreve o que já existe) · honeypot anti-robô · congelar a origem do primeiro toque | P–M | ✅ 02/10, em produção. Sobra: campo-isca no formulário; `POST /publico/conversao` ainda sobrescreve UTMs (pergunta 50) |
| **R2 LGPD mínima** | Base legal e consentimento por contato (texto, versão, data, IP, página) · checkbox e link da política no formulário · rodapé com razão social e motivo · exportar e eliminar dados de um titular | M | decisão D3 |
| **R3 Captura no site (troca o RD)** | Endpoint de formulário por token público, CORS por domínio, aceita POST de formulário HTML · snippet para colar no WordPress (formulário embutido e pop-up) · script de rastreio leve (visita, referrer, UTMs, gclid/fbclid, primeiro e último toque) | M–G | R2 |
| **R4 Perfil B2B** | Campos: setor, porte (faixas), UF/cidade, CNPJ, nº de motoristas/operadores, produto de interesse · formulário configurável (lista, máscara, obrigatório) · limpar os campos da dn.ia da captura · alinhar editor e landing | M | decisão D2 |
| **R5 Qualificação H&S** | Funil H&S explícito, movido por regra/jornada · régua perfil × interesse com decaimento · evento de conversão por página ("pediu demonstração" dispara na hora) · nós "mudar status"/"remover tag" · modelo pronto "pediu demonstração" · uma pontuação só (sai o P1–P4 do navegador) · "Enviar ao comercial" para qualquer etiqueta | M | D1, R4 |
| **R6 Painel H&S** (parte 1 ✅) | Tirar o funil da dn.ia (Grupo WhatsApp, Modal, Faturamento, Tema de Desafio, aba Desafios, recomendações sem custo) · "Leads novos" como número principal · agregação no servidor (acaba o teto de 10 mil) · por canal e por página · funil · visitas → taxa de conversão · custo manual → custo por lead | P→M | parte 1 (limpeza, leads novos, meta, pontuação do banco) ✅ 02/10; resto depende do R3 |
| **R7 Migração do RD** | Importação de verdade (CSV real, mapeamento de colunas, consentimento, supressão em lote, data/origem da primeira conversão) · papel de operador de marketing | M | acesso ao RD, R0 (U3), R2 |
| **R8 Depois** | Editor de landing com blocos/imagem/página de obrigado · Pixel/CAPI/Clarity condicionados ao consentimento · escopo de chave de API · central de preferências · A/B de assunto | M–G | R2 |
| **R9 Provedor de envio** | Se o Nicholson escolher o **Amazon SES** (D8): adaptador de envio no lugar do Resend (o código isola o envio em `app/email/`), eventos de entrega/abertura/clique/bounce/reclamação pelo SNS no lugar do webhook do Resend, pedido de saída do sandbox na AWS, DNS do domínio no SES, rampa recomeçando (`ENVIO_AQUECIMENTO_INICIO`) | M | D8 |
| Fora | Endpoint de card no GrowthHS (5A) e volta ganho/perdido | M | repositório do GrowthHS |

Em paralelo (até 4 frentes): R1 + R2 + limpeza do R6 logo depois do R0; R3 e
R4 quando a migration do R2 estiver na `main` (migration tem dono único).

## Decisões para o Nicholson / Erick

- **D1 Funil da H&S.** Proposta: Lead → Lead Qualificado → Oportunidade
  (enviado ao comercial) → Cliente / Perdido. Quem pediu demonstração ou
  orçamento já entra como Qualificado?
- **D2 O que perguntar no formulário.** Mínimo proposto: nome, e-mail
  corporativo, WhatsApp, empresa, cargo, setor (lista), UF. Opcionais: CNPJ,
  nº de motoristas/operadores, produto de interesse. Cada campo a mais derruba
  conversão.
- **D3 Base legal e política.** Para lead que chega pelo formulário:
  consentimento (checkbox). Para cliente atual: legítimo interesse, com opt-out
  fácil. Precisa da URL da política de privacidade do site.
- **D4 E-mail de nota fiscal.** Ligamos `DATACORE_EMAIL_DE_NOTAS` em 02/10
  (184 → 295 com e-mail). ⚠️ É endereço de faturamento que não pediu marketing:
  mais bounce, mais spam e desvio de finalidade pela LGPD. Recomendação:
  **não mandar campanha para eles** até a decisão (ou desligar de novo).
- **D5 Mídia paga.** A H&S anuncia (Google/Meta)? Define se Pixel/CAPI e custo
  por lead entram cedo ou tarde.
- **D6 Quem opera.** Uma pessoa de marketing/comercial vai usar o sistema?
  Define a urgência do papel de operador (hoje só admin).
- **D8 Provedor de envio.** Hoje: Resend **plano gratuito** (100/dia, 3.000/mês
  — teto do worker em 90/dia por `~/marketinghs-teto-envio.sh`), só para teste.
  O Nicholson pensa em AWS. Fato: o Resend roda sobre o Amazon SES —
  **trocar não melhora a entrega**, melhora o **preço** (SES ≈ US$ 0,10/mil ×
  Resend Pro US$ 20/mês até 50 mil). Spam se evita com domínio autenticado
  (feito), aquecimento (R1), descadastro de um clique (R0), base com permissão
  (D4) e consentimento (R2). Opções: Resend Pro (zero trabalho) ou SES (R9).
- **D7 Acesso de leitura ao RD.** Para o inventário (leads, formulários, LPs,
  automações, volume mensal) e a migração.
