# Perguntas abertas

Dúvidas de produto que o modo autônomo não parou para perguntar (ver
`CLAUDE.md`, "Modo autônomo"). Cada uma diz as opções e **qual foi assumida**,
para o Erick confirmar ou trocar. Só a coordenadora edita este arquivo; as
frentes anotam no próprio `docs/frentes/<frente>.md`.

Quando o Erick responde, a pergunta sai daqui e a resposta vai para o bloco do
dia no `CONTINUAR-AQUI.md`.

## Respondidas pelo Erick em 01/10/2026

| # | Decisão | Vira |
|---|---|---|
| 1 | Paleta de gráfico: **aceitar as 6 cores** (7ª+ repete) | nada |
| 2 | Status: **mapa fixo por token em todo lugar** (ficha deixa de ler o hex do banco) | frente `contatos-decisoes` |
| 3 | Etiquetas: **reduzir o seletor para as 4 distinguíveis**; antigas remapeadas | frente `contatos-decisoes` |
| 4 | Altura: **`h-9` nos primitivos** (botão e campo 36 px), tirar o `h-9` manual das telas | frente `primitivos-cta` |
| 5 | Fluxo "Conferência lote 4": **fica em rascunho** | nada |
| 6 | Recálculo e sync do DataCore **não disparam automação** | frente `backend` |
| 7 | A/B: **peso 0 = sem tráfego** | frente `backend` |
| 8 | Unlayer: **criar projeto próprio da HS** | ✅ projeto `289750`, padrão em `emailEditorConfig.ts` (01/10) |
| 9 | Colunas de funil da dn.ia em Contatos: **remover** | frente `contatos-decisoes` |
| 10 | CTA das landings: **azul da marca**, uma constante para editor e landing | frente `primitivos-cta` |
| 11 | Campanhas presas | ✅ resolvida (script rodado) |
| 12 | Contrastes do DS: **aceitar como está** | nada |
| 13 | Texto destrutivo: **`--on-tint-danger` no app todo** | frente `cores-decisoes` |
| 14 | Bloco de código: **bloco da casa** (fica) | nada |
| 15 | Quadrado de marca: **GrowthHS verde** (`success-700`) | frente `cores-decisoes` |
| 16 | Descadastro: **âmbar nos dois** (supressão e campanhas) | frente `cores-decisoes` |
| 17 | Hotlead **verde** (fica) | nada |
| 18 | Toast do recálculo **fica** | nada |
| 19 | Permissão de API Key: **escala própria** (Leitura neutra, qualquer escrita âmbar) | frente `cores-decisoes` |
| 20 | Migration 021 | ✅ aplicada |
| 21 | Rotas convertidas: **só admin** (fica) | nada |
| 22 | Fixture `envio` | ✅ feita |
| 23+24 | Fusão: **migration 022 + reatribuir todo o histórico** — a 022 passa pelo Erick antes de aplicar | frente `backend` |
| 25 | Checkbox de menu: **só o indicador** (fica) | nada |
| 26 | Título padrão **"MarketingHS"** (fica) | nada |
| 27 | Suítes em paralelo: **fazer** (trava no banco + e-mail único nos leads) | frente `backend` |

## Respondidas pelo Erick em 02/10/2026

| # | Decisão | Vira |
|---|---|---|
| 28+29 | Funil da dn.ia: **tirar tudo** — a coluna "Participante" (já saiu) e os cartões "Tipo Participante" e "Presença" da ficha e do modal do painel | rodada 6, front |
| 30 | `LeadsExport.tsx`: **apagar** (código morto) | rodada 6, front |
| 31+33 | Landings: **`#1a71a8` em tudo** — botão, foco de campo e confirmação na mesma constante (fica) | nada |
| 32 | Botão `sm` com `h-9` ao lado de campo: **deixar** | nada |
| 34 | Variante nova de A/B: dividir igual | ✅ rodada 5 |
| 35 | Migrations 022 e 023 | ✅ aplicadas |
| 36 | Matrícula por segmento olha o estado: **não mexer agora** — volta à pauta antes de ativar jornada por segmento | nada |
| 37 | `pagina_sonda` limpa o que cria | ✅ rodada 5 |
| 38 | Eventos órfãos: **(a) cada fixture apaga os eventos do seu lead antes do lead** | rodada 6, backend |
| 40 | Fusão × `journey_events` do descartado: **(a) a fusão apaga** | rodada 7, backend |
| 39 | Pesos A/B ao adicionar variante: **(b) a nova entra com a parte igual e as outras encolhem na proporção** (70/30 → 47/20/33) | rodada 6 |

## Novas

41. **Painel — "Insights de Canais" no Operacional** ficou (saiu só o insight
    de horário). **Assumido: fica.** (frente `painel-limpeza`)
42. **Seletor Novos/Recorrentes vaza para Contatos**, que só conhece o
    interruptor antigo. **Assumido:** trocar pelo mesmo seletor na próxima
    frente que tocar Contatos (R5).
43. **Rotas `/ia/analisar-desafios` e `/ia/insights-de-desafios`** ficaram sem
    quem as chame. **Assumido: manter** até a limpeza do backend da dn.ia.
44. **`whatsapp_group` em `lead_goal`** é preservado no PUT. **Assumido:** sai
    num reset/limpeza futura.

45. **Tetos de envio** (R1): assumido 2/s, 500/h, 2.000/dia, rampa a partir de
    50 dobrando por dia desde 02/10. ⚠️ Se o plano do Resend for o gratuito
    (100/dia, 3.000/mês), baixar `ENVIO_TETO_DIA` em `integration_secrets`.
46. **Campanha parada**: assumido `sent` + pendentes `suppressed` + contador
    `interrompidos` (sem migration). Alternativa: status `cancelled` (migration).
47. **Editar campanha pausada**: assumido continuar editável (como já era).
48. **Rampa ao trocar domínio**: gravar `ENVIO_AQUECIMENTO_INICIO` com a data.
49. **Pausar/retomar/parar em `service_role`** com `admin_atual`, igual ao
    `/enviar` vizinho (`authenticated` não pode mexer em `email_send_queue`).
    Fica na conversão lote a lote; alternativa: migration com GRANT.
50. **Pendentes do R1:** `POST /publico/conversao` ainda sobrescreve UTMs com o
    último toque; campo-isca `website` falta no formulário da landing.
51. **Botão "Enviar ao comercial" do qualificado** (R5, `r5-contatos`): o
    botão vale para qualquer etiqueta e ficou só no cabeçalho da ficha; o
    `QualifiedBanner` virou destaque sem botão. **Assumido:** (a) só no
    cabeçalho. Alternativas: (b) nos dois lugares; (c) esconder o do cabeçalho
    quando o banner aparece. Reverter = devolver o botão ao banner.
52. **Campo-isca × gerenciador de senha** (R5): se um preenchimento automático
    encher o `website` escondido, o lead real é descartado com resposta de
    sucesso e só um log `info`. **Assumido:** manter (`autocomplete=off`,
    fora da tela); se aparecer reclamação, logar em `warning` com o e-mail.
53. **Reconversão e jornada** (R5J-1): contato que já existia e converte de
    novo só entra em fluxo **filtrado por página**; fluxo sem filtro segue só
    com lead novo. Reverter = uma linha em `journey_enroll_event`.
54. **`tipo` na conversão pela API** (R5J-2): continua sobrescrito, como antes.
55. **Conversão com `converted_at`** (R5J-3): carga de histórico não matricula
    em jornada.
56. **Filtro de página guarda o slug** (R5J-4): trocar o slug da página
    desliga o fluxo até escolher a página de novo (a tela avisa).
57. **"Aguardar evento" de formulário** (R5J-5): quem está esperando agora
    segue também quando reconverte.
58. **Teto de envio 0** (faxina-r5, FR5-1): recusado na tela e na rota — o
    worker trata 0 como inválido e cairia no padrão de 2.000/dia. Para parar,
    "Pausar envio" na campanha. A rampa aceita 0 (desliga).
59. **Voltar ao padrão no ritmo** (FR5-2): digita-se o padrão (a tela mostra);
    sem botão "restaurar". Alternativa: botão por campo.
60. **Tag do slug sem caixa** (FR5-3): `/webinar` usa a tag "Webinar" existente
    em vez de criar outra.
61. **Foco inicial da ficha** (CT-1): caía no "Enviar ao comercial" (sem
    confirmação) — um Enter mandava o contato à fila. **Assumido:** foco no
    título/fechar (consertado em 07/10). Alternativa extra: pedir confirmação
    no botão.
62. **Jornada sem filtro × captura do site** (prova do RD, revisão 22/10):
    todo lead novo vindo do snippet publica `form_submitted`; uma jornada
    `form_submitted` **sem** filtro de página/formulário matricularia cliente
    real do site. Hoje não há jornada nenhuma. **Assumido:** antes de colar o
    snippet no `healthsafety.com.br`, barrar no código jornada sem filtro para
    evento com `site_id` (ou exigir modo teste). Não bloqueia a prova interna.
63. **Base legal do formulário do site** (spec §4.3): sem checkbox no site,
    o registro sai `legitimo_interesse_pedido_contato`, versão provisória.
    **Assumido** até o D3. Alternativa: pôr checkbox no site.
64. **Consentimento obrigatório na landing** (spec §4.3). **Assumido:** sim.
65. **Campo-isca na conversão de site:** a spec pedia, o plano tirou (o
    formulário do site é do site; o token + `Origin` + limite seguram).
    **Assumido:** sem campo-isca; reavaliar se aparecer spam.
66. **Entrega ao CRM e modo teste na saída** (revisão da `prova-jornadas`):
    aviso e webhook reconferem `allowed_emails` na hora de sair; a entrega ao
    GrowthHS (`crm/entrega.py`) só confere no nó. **Assumido:** basta para a
    prova (a lista não muda no meio); fazer antes da fase externa.
67. **Limpeza da prova não apaga contato que já existia** (`limpeza.sql`):
    só lista. **Assumido:** um contato real que converteu na prova não vai
    para a lixeira.
68. **Destinatário do aviso na prova** = 1º e-mail da lista do `semear`.
69. **"Aviso" de card atualizado** (integração real com o GrowthHS, 22/10):
    o Erick pediu que o card aberto seja atualizado "e deixe um aviso". O
    GrowthHS não manda push de anotação. **Assumido:** o aviso é uma nota
    (`POST /card-notes`) no histórico do card. Alternativa: pedir ao GrowthHS
    notificação ao responsável quando o integracao2 anota.
70. **`origin` de lead sem conversão** (envio manual, regra sobre a base):
    **Assumido:** `MarketingHS`. Alternativa: `Contato pelo Site`.
71. **Pessoa só com cards ganhos/perdidos:** **Assumido:** cria card novo
    (nova oportunidade). Só card aberto é atualizado.
72. **Lead entregue na homologação depois da troca para produção** (frente
    `growthhs-ambientes`, 23/10): o gatilho de regra (020/023) não
    reenfileira lead já `entregue` em ambiente nenhum, mas a prévia agora só
    conta `entregue` do ambiente ativo. **Assumido:** (c) deixar — trocar de
    ambiente não reenvia nada (decisão 7 da spec); os poucos leads da prova
    vão por jornada ou pelo botão "Enviar ao comercial". Alternativas: (a)
    uma 031 em que o gatilho olha só o ambiente ativo; (b) a prévia volta a
    imitar o gatilho.
73. **Reconversão com dados diferentes** (teste de leads, 26/10): o lead
    reconverteu pela `phoebus-prova` com outra empresa e outro telefone; a
    captura não sobrescreve (R1, certo), mas os valores digitados **não
    ficam em lugar nenhum** — `lead_conversions` não tem as colunas, ao
    contrário do que diz o comentário de `captura/registro.py::_atualizar`.
    O bloco do card mostra os dados antigos do contato. O Erick: "seria bom
    atualizar". **Assumido (o mais seguro):** guardar o que veio em cada
    conversão (031) e mostrar no bloco e na nota do card e na linha do tempo
    como "informou nesta conversão" — o contato e a pessoa do GrowthHS
    continuam sem ser sobrescritos. Alternativa: sobrescrever o contato
    (reabre o furo do R1 — qualquer um que saiba o e-mail troca os dados).
74. **Perdido e No Show voltando do GrowthHS** (teste de leads, 26/10):
    **Respondida pelo Erick (26/10):** perdido vira status novo
    **"Negócio perdido"** (fim do funil, evento na linha do tempo, conta no
    painel e serve para segmento de renutrição); No Show (card movido para
    "Reagendamento") é **só evento** na linha do tempo — o status continua
    "MQL - Reunião agendada", e o reagendamento traz outro "Reunião agendada".
75. **"Em contrato" recebendo perdido** (frente `growthhs-perdido`, 26/10):
    **Assumido:** vira "Negócio perdido" (na régua da 005 vem antes da
    venda). Se "Em contrato" for pós-venda, protegê-lo como a venda — uma
    linha em `retorno.avancar_status`.
76. **Lead perdido com reunião nova volta ao funil** (idem): **Assumido:**
    sim (reunião → MQL, venda → Venda realizada). Alternativa: só a mudança
    manual tira alguém de "Negócio perdido".
77. **Lista 26 "Agendado" (board 6) fora de `listas_reuniao`** (só a 28):
    anterior à frente; ver na prova se reagendamento no board 6 chega.
78. **Adotar o que o lead informou** (frente `reconversao-dados`, 26/10): um
    botão na ficha, só para admin autenticado, que copia para o contato o
    que veio numa reconversão — o caminho seguro para atualizar dado que a
    captura pública não sobrescreve. **Assumido:** fica para depois. Idem a
    aba de conversões da ficha mostrar `dados_informados`.
79. **A descrição do card não aparece no GrowthHS** (Erick, 26/10): a tela
    do card (`hsgrowth-sistema/frontend/src/pages/CardDetails.tsx`) não
    renderiza `description` — só o `CardDetailModal`, que não é usado. Tudo
    o que o card novo leva na descrição (conversão, UTMs, consentimento,
    link da ficha) é invisível ao vendedor. **Decidido com o Erick:** o que
    é para o vendedor vai em NOTA (nota de abertura no card novo; a da
    reconversão sem a frase sobre a descrição); a descrição segue só como
    engrenagem (marca de idempotência). Pedido opcional ao HSGrowth: mostrar
    a descrição na tela do card.
