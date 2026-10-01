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

## Novas

28. **"Participante" saiu junto com o funil da dn.ia** (#9) — a lista do 8E
    tinha 6 colunas, mas o campo é do mesmo funil. **Assumido: sai** (revert de
    uma linha).
29. **Ficha e modal do painel** ainda mostram os cartões "Tipo Participante" e
    "Presença" (dn.ia). **Assumido: ficam** (a decisão falava de colunas).
    Tirar também?
30. **`LeadsExport.tsx`** não tem importador (código morto). Apagar?
31. **Azul do botão das landings:** **assumido `#1a71a8`** (`primary-600`, o
    `--action`); o `primary-500` daria texto branco a ~3,8:1. Uma linha em
    `src/landing/padroes.ts`.
32. **Botão `sm` esticado com `h-9` ao lado de campo** (`LeadsExport`,
    `ColumnSelector`, `GlobalFilters`, e casos em contatos/configurações).
    **Assumido: deixar.** Alternativas: passar essas telas ao tamanho padrão,
    ou dar ao `sm` altura fixa no primitivo.
33. **A cor de destaque da landing inteira** (foco de campo, confirmação)
    passou a seguir a mesma constante do botão. **Assumido: é o desejado.**
34. ✅ **Variante nova de A/B** (com peso 0 = sem tráfego): **dividir igual**
    (Erick, 01/10). → rodada 5.
35. ✅ **Migrations 022 e 023 aplicadas** (Erick aprovou, 01/10): 023 conferida
    contra o banco vivo (só as 3 linhas de trava por função); 022 liga RLS em
    `crm_handoffs`/`email_send_queue`/`email_send_dead` — worker e `leitura`
    têm BYPASSRLS, conferido. → a fusão vai para `authenticated` na rodada 5.
36. **Recálculo pode pôr contato num segmento de jornada** e a matrícula por
    segmento olha o estado, não o evento (hoje: 1 fluxo por segmento, em
    rascunho). **Assumido: não mexer.**
37. **`pagina_sonda` (`test_captura.py`) cria identidade e nunca apaga.**
    ✅ O teste passa a limpar o que cria (rodada 5). A identidade de 21/09
    era a mesma que a captura reusa pelo telefone e saiu na primeira rodada,
    com 20 eventos órfãos dela. As 2 chaves `teste 8B` ficam para o reset.
38. **Eventos de contato órfãos crescem ~24 por suíte inteira** (`contact_events`
    com `lead_id` NULL: 1.492 → 1.516; 1.307 `journey_events` sem lead):
    fixtures que comitam apagam o lead e deixam o evento. Apagar por
    `lead_id IS NULL` levaria junto eventos de contatos reais apagados.
    Opções: (a) cada fixture apaga os eventos do seu lead antes do lead;
    (b) deixar para o reset. **Assumido: (b)** até o Erick decidir.
39. **Adicionar variante no A/B redistribui TODOS os pesos** (rodada 5):
    um 70/30 ajustado à mão vira 34/33/33 ao adicionar a terceira. A decisão
    34 falava da variante nova. Opções: (a) fica assim; (b) só a nova entra
    com a parte igual e as outras encolhem na proporção (70/30 → 47/20/33).
