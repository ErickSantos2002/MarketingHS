# Pedido ao HSGrowth (26/10/2026) — para uma sessão aberta em `~/github/hsgrowth-sistema`

Escrito pela coordenadora do MarketingHS. Território: o MarketingHS só lê o
repo do HSGrowth; quem corrige é uma sessão de lá.

## 1. XSS nas anotações do card (segurança — prioridade)

`frontend/src/components/cardDetails/NoteRenderer.tsx` renderiza com
`dangerouslySetInnerHTML` toda nota que contenha uma `<tag>`, passando antes
por `sanitizeHTML` (linha ~212), que é feito de regex:

- `on\w+\s*=\s*["'][^"']*["']` só remove handler **entre aspas** —
  `<img src=x onerror=alert(1)>` passa inteiro;
- regex não é sanitizador de HTML (aninhamento, entidades, `<svg>`,
  `<iframe srcdoc>`, `javascript:` sem aspas, etc.).

Qualquer nota — de usuário, de integração, de automação — com HTML vira
script na tela de quem abrir o card. A nota vem de fora em pelo menos um
caminho: o MarketingHS anota dados de formulário PÚBLICO (nome/empresa que o
lead digita). Do lado do MarketingHS o `<` já sai trocado por `‹` (commit
`653c81e`), mas a defesa tem de estar no renderizador.

**Correção sugerida:** DOMPurify (`DOMPurify.sanitize(html, {USE_PROFILES:
{html: true}})`) no lugar de `sanitizeHTML`, ou não renderizar HTML em nota
(texto puro com `whitespace-pre-wrap`, que já é o caminho sem tag). Teste com
`<img src=x onerror=alert(1)>`, `<svg onload=alert(1)>` e
`<a href=javascript:alert(1)>x</a>`.

## 2. A descrição do card não aparece (opcional)

`pages/CardDetails.tsx` não mostra `card.description` — só o
`components/kanban/CardDetailModal.tsx`, que não é usado. O MarketingHS
passou a mandar o resumo do lead em nota (que aparece), então isto é
melhoria, não bloqueio.
