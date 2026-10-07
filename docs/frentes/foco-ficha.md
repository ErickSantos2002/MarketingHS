# Frente foco-ficha (CT-1)

## Estado

✅ Pronta para merge (07/10/2026).

- **Problema:** ao abrir a ficha do contato, o Radix focava o primeiro focável —
  o botão "Enviar ao comercial", que desde o R5 aparece para qualquer contato e
  não tem confirmação. Um Enter sem querer mandava o contato para a fila.
- **Conserto:** `LeadDetailSheet.tsx` — `onOpenAutoFocus` com `preventDefault`
  e foco no `DialogTitle` (`tabIndex={-1}`, `outline-none`); se o título não
  existir, foca o próprio conteúdo da ficha. Botão sem mudança de visual nem de
  comportamento.
- **Portão:** `tsc -p tsconfig.app.json` 0 erros · `guarda:visual -- src` 0 ·
  `vite build` ok.
- **Conferência:** local (Vite 8097 → backend 8117), `conferir-telas
  --clicar-linha /contacts`, 4 PNGs da ficha aberta (claro/escuro × 1440/390):
  o botão aparece sem anel de foco. Produção não foi conferida — ainda não tem
  o conserto.
- A branch foi avançada (fast-forward) para a `main` de 07/10 antes do
  commit, para ter o `--clicar-linha` do `conferir-telas`.
