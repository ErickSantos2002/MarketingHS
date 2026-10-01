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
