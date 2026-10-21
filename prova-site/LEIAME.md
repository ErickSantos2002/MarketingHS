# prova-site — a página de teste de outra origem

`site-teste.html` faz o papel do site da H&S na prova de substituição do RD
(Tarefa 11 do plano `docs/superpowers/plans/2026-10-21-prova-substituir-rd.md`):
cópia do formulário de cotação do Phoebus (`prova_cap_phoebus`), o da ficha
técnica (`prova_ficha_phoebus`), o nosso `rastreio.js` e o script do RD.

## Por que fora de `frontend/public/`

Tudo em `frontend/public/` vai para o `dist/` do admin e seria servido em
`marketinghs.healthsafetytech.com/...`. Lá o script do RD (terceiro) rodaria na
mesma origem que guarda a sessão do admin no `localStorage`. Esta pasta não
entra em build nenhum.

## Como servir

1. No EasyPanel, um **serviço estático separado** (ex.: nginx com esta pasta
   copiada para a raiz), com **domínio próprio** — nunca um subdomínio que
   compartilhe cookie com o admin, nunca o serviço `marketinghs-sistema`.
2. Nada de sessão, cookie ou credencial do admin nesse serviço. Só arquivo
   estático.
3. Cadastrar esse domínio em **Configurações → Sites** (os domínios do site da
   prova), senão a API responde 403 e o `rastreio.js` não grava nada.
4. Ligar `PROVA_RECEPTOR_TESTE` na API durante a prova (o `action` dos forms é
   `/api/publico/prova/recebido`, que fora disso dá 404).
5. Abrir `https://<domínio>/site-teste.html?token=pub_…` com o token do site
   cadastrado. `&debug=true` liga o log do `rastreio.js` no console.

O endereço do sistema é a constante `MHS_SISTEMA` no topo do `<head>` do HTML
— o único lugar a trocar (ex.: para o Homo).
