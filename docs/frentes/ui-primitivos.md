# Frente `ui-primitivos`

Dívida dos primitivos anotada na Fase 1 (`CONTINUAR-AQUI.md`, bloco "Visual —
Fase 1", seção "Dívida anotada"). `components/ui/` é de dono único: nesta
rodada, a dona é esta frente. **A API dos primitivos não muda** (nenhuma prop
nova, nenhuma variante nova) — o que pedir API nova vira pergunta.

## Backlog (em ordem)

- [ ] Aviso do Radix `Missing Description or aria-describedby` no
  `DialogContent` (aparece ao abrir "Nova página", entre outros): achar os
  diálogos sem `DialogDescription` e resolver no uso (descrição real ou
  `aria-describedby={undefined}` explícito), sem mudar o visual.
- [ ] Vocabulário das três listas: `select.tsx` (item marcado perdeu o fundo
  `bg-primary/10`), `command.tsx` (`CommandItem` perdeu
  `data-[selected=true]:text-accent-foreground`) e `dropdown-menu.tsx`. Deixar
  as três com o mesmo estado de item marcado/realçado, por token.
- [ ] `input.tsx` perdeu as classes `file:*` ao ser reescrito: devolver por
  token (não há uso hoje; é para o primeiro `type="file"` não nascer cru).
- [ ] `components/admin/AdminLayout.tsx:~119` devolve `''` para rota não mapeada (rota nova
  nasce com `<h1>` vazio): devolver um título padrão e avisar no console em dev.
- [ ] Portão: guarda 0, `tsc` 0, `vite build`, telas com select/command/
  dropdown abertos (abrir lista é visualização, permitido) nos dois temas.

Fica de fora (API nova, vira pergunta): variante de largura do `Dialog`,
prop de card clicável, a mudança do `alert.tsx` default.

## Estado

## Perguntas
