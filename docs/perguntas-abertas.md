# Perguntas abertas

Dúvidas de produto que o modo autônomo não parou para perguntar (ver
`CLAUDE.md`, "Modo autônomo"). Cada uma diz as opções e **qual foi assumida**,
para o Erick confirmar ou trocar. Só a coordenadora edita este arquivo; as
frentes anotam no próprio `docs/frentes/<frente>.md`.

Quando o Erick responde, a pergunta sai daqui e a resposta vai para o bloco do
dia no `CONTINUAR-AQUI.md`.

## Herdadas (antes de 01/10) — detalhe no topo do `CONTINUAR-AQUI.md`

Nenhuma destas teve opção assumida: esperam o Erick e nenhuma frente depende
delas.

1. Paleta de gráfico própria no Design System oficial.
2. Status com duas cores (lista × ficha), 3 divergentes.
3. Cores nomeadas de etiqueta — 4 de 6 se distinguem.
4. Altura botão × campo (Fase 1).
5. Fluxo "Conferência lote 4" em rascunho.
6. Recálculo de pontuação e sync do DataCore disparando automação.
7. Peso 0 numa variante de A/B.
8. Conta Unlayer `dnmkt`: HS ou dn.ia?
9. Colunas de funil da dn.ia em Contatos.
10. Cor padrão do botão das landings (`#E41A11` no editor × `#1e3a5f` na landing).
11. Campanhas presas em "Enviando..." — **a frente `backend` investiga o
    motivo; a correção do dado continua sendo do Erick.**
12. Contrastes do DS oficial abaixo de 4,5:1 — pedir ajuste ao Design System?
13. Regra do texto destrutivo (`text-destructive` dá ~3,76:1) no app inteiro (G5).

## Novas

### G6 (01/10) — já aplicadas com a opção assumida; trocar é uma classe

14. **Bloco de código** em Documentação da API e API Keys: era um editor escuro
    fixo da dn.ia (`#1E1E2E`) nos dois temas. **Assumido:** o bloco da casa
    (`bg-muted/50`, borda, texto do tema), igual ao `ExperimentsSetup`.
    Alternativa: pedir ao DS oficial um token de "superfície de código" escura.
15. **Quadrado de marca** dos cartões (G do GrowthHS, M do Meta, IA).
    **Assumido:** pelo matiz da origem — G e M em `info-700`, IA em
    `warning-700`. Alternativa: GrowthHS em `success-700`, como a pílula em Contatos.
16. **"Descadastrou" na lista de supressão** ficou neutro (`secondary`), como na
    origem; em Campanhas (G3) "Descadastrado" é atenção. Unificar?
17. **Hotlead na barra de faixas do Lead Scoring** passou de vermelho para
    verde (regra Hot = sucesso do G1/G2). Confirmar.
18. **Toast do "Recalcular agora"** dizia "undefined leads" (o front lia
    `result.updated`, a API devolve `atualizados`). **Assumido:** corrigido
    dentro do G6; revert de uma linha se preferir fora.
19. **Badge de permissão das API Keys** (revisão final do G6): "Leitura +
    Escrita" é `success`, o mesmo verde de "Ativa" ao lado, enquanto "Escrita"
    sozinha é âmbar — o acesso mais amplo parece o mais "seguro". **Mantido**
    como veio da origem (pelo matiz). Alternativa: escala própria para
    permissão (ex.: neutro para Leitura, âmbar para qualquer escrita).
