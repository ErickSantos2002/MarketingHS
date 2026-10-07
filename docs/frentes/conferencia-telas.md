# Frente `conferencia-telas` (achados da 1ª conferência com a conta do Claude, 07/10)

Origem: conferência de 07/10 em produção com `scripts/conferir-telas.mjs`
(conta `claude.dev@example.com`, permanente desde 07/10).

Território: `backend/app/routers/configuracao.py` (só o `webhook_url`) e o
teste dele; `frontend/src/components/admin/contacts/` (só a barra de
ferramentas e o que ela precisar); `pages/admin/` de Contatos;
`scripts/conferir-telas.mjs`. Nada de migration. **Não roda a suíte
inteira** (só o arquivo de teste tocado). Porta: Vite 8096, usa o backend
8100.

## Backlog (em ordem)

- [x] **URL do webhook do Resend errada na tela.** `configuracao.py:391` usa
  `request.url_for("resend_webhook")`, que atrás do proxy sai
  `http://…/publico/webhook/resend` (sem `https` e sem o `/api`). Montar a
  partir de `settings.FRONTEND_URL` + `/api/publico/webhook/resend` — o mesmo
  `FRONTEND_URL` que o worker usa para o link de descadastro (`worker.py`
  ~192). Conferir no `main.py`/proxy que o caminho público da API é mesmo
  `/api` (o cartão do webhook de eventos mostra
  `https://marketinghs.healthsafetytech.com/api/publico/evento-de-contato`).
  Teste do formato. ⚠️ O webhook cadastrado no Resend funciona — é só a tela.
- [x] **Contatos em 390 px estoura a página** (`scrollWidth` 542): a barra
  busca + Filtros + Colunas + atualizar + CSV não quebra linha e o botão CSV
  some. Fazer quebrar (ou recolher em ícones) no celular sem mudar o
  desktop. A tabela pode rolar dentro do próprio contêiner; a página não.
- [x] **`conferir-telas.mjs` abre painéis de leitura.** Opção nova, ex.
  `--abrir "<texto do botão>"` (repetível, em ordem), que clica em botão
  pelo texto/papel **só se o texto estiver numa lista permitida** de
  abridores (Filtros, Colunas, Novo fluxo, Nova campanha, abas, linha da
  tabela para abrir a ficha, "+"), e recusa qualquer coisa que pareça ação
  (Salvar, Enviar, Excluir, Apagar, Remover, Parar, Pausar, Testar,
  Gerar, Importar, Sincronizar, Confirmar…). A recusa aborta a rota com
  mensagem clara. Documentar no cabeçalho. Nada impresso da credencial.
  Também `--clicar-linha` (abre a 1ª linha da tabela = ficha), se
  simples. Rodar contra o Vite local (`--porta 8096`) logado com a conta
  do Claude: Contatos → Filtros (seletor Novos/Recorrentes), ficha de um
  contato (botão "Enviar ao comercial", sem P1–P4), Automações → Novo fluxo.
  Salvar os PNG e citar no Estado.
- [x] Portão: `tsc` 0, guarda 0 em `src`, `vite build`; pytest do arquivo de
  teste tocado.

## Estado

**✅ Pronto para merge** (07/10). Branch `worktree-agent-aaccedf18ea294440`.

Commits:
- `b916ef2` URL do webhook do Resend sai do `FRONTEND_URL` + `/api/publico/webhook/resend`
  (`url_do_webhook_resend` em `configuracao.py`; mesma convenção de
  `url_de_descadastro_um_clique`). Conferido: nginx e Vite repassam `/api/`;
  o router do webhook é `prefix="/publico"`. Teste do formato, com e sem `/` final.
- `723ec47` barra de Contatos com `flex-wrap`: em 390 a busca ocupa a linha e
  os botões descem. **scrollWidth 542 → 390**; o CSV voltou (só ícone no
  celular, como já era). Desktop igual. A tabela já rolava no próprio contêiner.
- `d6958ed` `conferir-telas.mjs`: `--abrir "<texto>"` (repetível; lista
  permitida Filtros, Colunas, Novo fluxo, Nova campanha, `+`, `aba:<nome>`) e
  `--clicar-linha` (1ª célula sem controle da 1ª linha = ficha). Texto com cara
  de ação é recusado **antes** de logar/abrir navegador (exit 2); nome achado
  na tela com cara de ação aborta a rota. Rede de segurança: todo não-GET para
  `/api/**` é **bloqueado** no navegador e vai ao `resumo.json` (`bloqueadas`),
  fora as duas leituras por POST de Contatos (`/contatos/enriquecimento`,
  `/contatos/tags-por-contato`, conferidas: só SELECT). PNG por passo.
  Nenhum log de credencial ou token.
- `d6fa774` itens da revisão: mais verbos no filtro de ação, opção
  desconhecida recusada (não engole a rota), saída 1 quando há passo abortado
  ou escrita bloqueada.

Recusas testadas: `Salvar`, `Enviar ao comercial`, `aba:Excluir`,
`aba:Executar`, `Limpar filtros` (ação), `Detalhes` (fora da lista),
`--clicar-linhas` (opção desconhecida); botão ausente → `✖ … não achado na tela`.

Portão: `tsc --noEmit -p tsconfig.app.json` **0 erros**; `guarda:visual -- src`
**0**; `vite build` ok; `pytest -q tests/test_config_resend.py` **29 passed**
(só o arquivo tocado). Revisão final (superpowers:requesting-code-review):
"with fixes" — feitos no `d6fa774`, sem crítico.

Conferência (Vite 8096 → backend próprio 8116, conta do Claude, só leitura;
claro/escuro × 1440/390, todos sem estouro, 0 escrita bloqueada):
- Contatos → Filtros (seletor Todos/Novos/Recorrentes presente):
  `/tmp/claude-1000/-home-ericks-github-MarketingHS/b2c3fa6d-9d01-48f4-a665-4f7df22282d0/scratchpad/conferencia/filtros/contacts-*-passo1-filtros.png` (+ `contacts-*.png` sem painel)
- Ficha de contato ("Enviar ao comercial" presente, sem P1–P4):
  `/tmp/claude-1000/-home-ericks-github-MarketingHS/b2c3fa6d-9d01-48f4-a665-4f7df22282d0/scratchpad/conferencia/ficha/contacts-*-passo1-linha.png`
- Automações → Novo fluxo (diálogo vazio, nada gravado):
  `/tmp/claude-1000/-home-ericks-github-MarketingHS/b2c3fa6d-9d01-48f4-a665-4f7df22282d0/scratchpad/conferencia/novo-fluxo/automations-*-passo1-novo_fluxo.png`

Observação (fora do território): ao abrir a ficha, o foco cai no botão
"Enviar ao comercial" (anel de foco visível na 1ª tela) — é o foco
automático do diálogo no 1º elemento focável. Inofensivo, mas um Enter
apertado sem querer manda ao comercial.

## Perguntas

- **CT-1. Foco inicial da ficha no "Enviar ao comercial".** Opções: (a)
  deixar; (b) mandar o foco para o título/fechar (`onOpenAutoFocus`).
  Assumida: (a), nada mudado — a ficha não é deste território. Sugiro (b)
  numa frente que tenha a ficha.
