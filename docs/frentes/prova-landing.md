# Frente `prova-landing`

Plano: `docs/superpowers/plans/2026-10-21-prova-substituir-rd.md` — Tarefas
10, 11 e 12. Território: linha `prova-landing` da seção "Frentes" do plano,
com a troca de 21/10 abaixo (`prova-site/` no lugar de `frontend/public/prova/**`).
n 19 · Vite 8099 · usa o backend da 8100. Branch `prova-landing`.

## Estado — pronto para merge (21/10)
- [x] Tarefa 10 — landing com cara de landing (`src/landing/campos.ts`,
  `Formulario.tsx`, `Landing.tsx`, `landing.css`; `scripts/landing-campos.test.mjs`)
- [x] Correção de segurança (coordenadora): URL da config só `http(s)` em
  `href`/`src`/redirect (`urlSegura`), com teste de `javascript:` e `data:`
- [x] Tarefa 11 — `frontend/public/rastreio.js` e a página de teste de outra
  origem (`scripts/rastreio.test.mjs`, 18 testes)
- [x] Correção de segurança (coordenadora): a página de teste saiu de
  `frontend/public/prova/` para `prova-site/` (fora do `dist/` do admin);
  `prova-site/LEIAME.md` diz como servir. `npx vite build` conferido: `dist/`
  sem `prova/`.
- [x] Tarefa 12 — editor da página (`CamposEditor.tsx` novo, `PageConfigEditor.tsx`)
- [x] Ajustes da revisão da coordenadora (21/10), com teste para cada um:
  1. Consentimento vale pela **presença** do bloco (`consentimentoDaConfig`);
     texto vazio usa "Li e aceito a política de privacidade.". O editor nunca
     grava texto vazio (`textoDoConsentimentoParaGravar`: fica o anterior ou o
     padrão; o rascunho vazio fica só na tela, com aviso).
  2. Página antiga (`visible_fields`): `desafios` vira `texto_longo` e o limite
     do texto é 2000 (`TAMANHO_MAXIMO` do servidor), marcado por `legado`, que
     só existe no cliente — `camposParaGravar` o tira antes de gravar.
  3. `POST /publico/captura` manda também `referrer`, `gclid` e `fbclid`
     (`toqueDaCaptura`), no topo do corpo, só quando existem. **Para a
     `prova-captura`:** o `CapturaIn` precisa aceitar esses três campos.
  4. `rastreio.js`: o PROIBIDO ganhou `^cc[_-]?(num|number|exp|cvv|cvc)`,
     `turnstile`, `csrf`, `_token`, `authenticity_token`.
  5. `textoDaConfig` antes de `.trim()`/`.replace()` em `imagem_url`,
     `whatsapp.numero`/`mensagem`, `mensagem_obrigado` e `corpo`.

## Decisões tomadas (a mais segura e reversível)
- **Contrato do erro da captura:** a landing trata `detail` string, `detail =
  {mensagem, campos}` e a lista do 422 do FastAPI, sem renderizar objeto.
- **`camposDaConfig`** espelha o `ler_definicoes` que a `prova-captura` vai
  escrever: entrada inválida descartada (chave fora de `^[a-z][a-z0-9_]{0,39}$`,
  tipo desconhecido, lista sem opção, chave repetida); `website` recusado como
  chave (é o campo-isca); o e-mail sempre presente, tipo e-mail, obrigatório.
  Sem `campos`, `visible_fields` (ou os 5 padrões de antes) — tudo texto.
  ⚠️ A `prova-captura` deve conferir que o servidor descarta as mesmas coisas.
- **Celular:** a regra de `normalizar_celular_br` foi copiada no cliente
  (`normalizarCelular`), com os mesmos casos do Review Focus 2.
- **Página antiga** (sem imagem nem corpo) mantém o cartão único de antes; com
  imagem ou corpo, grade de duas colunas (conteúdo + formulário fixo).
- **Imagem:** o upload devolve `/publico/imagem/<id>`; a landing e a prévia do
  editor prefixam `/api` (sem isso, em produção cairia no SPA).
- **Consentimento:** ligar o bloco no editor já grava os valores da prova
  (link da política do site, versão `provisoria-2026-10`, provisória,
  obrigatório). Desligar remove a chave.
- **Chip "Obrigado padrão" (`/obrigado`) saiu do editor:** a rota não existe.
- **`rastreio.js` embrulha `HTMLFormElement.prototype.submit`** para pegar
  `form.submit()` por JavaScript (Review Focus 1): manda a conversão e chama o
  original na hora, sempre, mesmo se a nossa parte falhar.
- **Último toque** em cookie `mhs_ut` (365 dias), ao lado de `mhs_vid` e `mhs_pt`.
- **`form_id` sem id:** `<pathname>#form<n>`, com `n` começando em 1.
- **Página de teste:** `passunto` do form de cotação copiado do site real
  (`Captura pelo site [PHOEBUS]`), não `Phoebus` como dizia o plano — é cópia.
  O reCAPTCHA ficou de fora (chave presa ao domínio da H&S). O script do RD
  vai sem `integrity`: o loader do RD muda de conteúdo, SRI o quebraria.
  `MHS_SISTEMA` (topo do `<head>`) aponta para
  `https://marketinghs.healthsafetytech.com`; o `action` dos forms e o
  `rastreio.js` saem dele.

## Conferência de tela
- `conferir-telas.mjs --porta 8099 /pages` rodou (backend da worktree na 8100,
  derrubado no fim): **não há nenhuma página no banco**, então o editor
  (`/pages/<slug>/edit`) e a landing nova não puderam ser abertos — criar
  página seria escrita em produção. **Fica para a coordenadora/Tarefa 18**,
  depois do seed da página `phoebus-prova`: abrir o editor e `/p/phoebus-prova`
  nos dois temas e larguras.

## Perguntas / fora do território
- **Casca da landing (Tarefa 5, `prova-captura`):** o `<script src="/rastreio.js">`
  da casca depende do nginx do `marketinghs-sistema` servir `/rastreio.js` do
  `dist/` (é estático do admin; a casca vem por `/p/`). Conferir no deploy.
- **CORS da página de teste:** o domínio do serviço estático de `prova-site/`
  precisa estar em `sites.dominios` do site da prova.
- **Dependência:** nenhuma nova; `package.json` intocado.
