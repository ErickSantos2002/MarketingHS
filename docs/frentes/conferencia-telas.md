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

- [ ] **URL do webhook do Resend errada na tela.** `configuracao.py:391` usa
  `request.url_for("resend_webhook")`, que atrás do proxy sai
  `http://…/publico/webhook/resend` (sem `https` e sem o `/api`). Montar a
  partir de `settings.FRONTEND_URL` + `/api/publico/webhook/resend` — o mesmo
  `FRONTEND_URL` que o worker usa para o link de descadastro (`worker.py`
  ~192). Conferir no `main.py`/proxy que o caminho público da API é mesmo
  `/api` (o cartão do webhook de eventos mostra
  `https://marketinghs.healthsafetytech.com/api/publico/evento-de-contato`).
  Teste do formato. ⚠️ O webhook cadastrado no Resend funciona — é só a tela.
- [ ] **Contatos em 390 px estoura a página** (`scrollWidth` 542): a barra
  busca + Filtros + Colunas + atualizar + CSV não quebra linha e o botão CSV
  some. Fazer quebrar (ou recolher em ícones) no celular sem mudar o
  desktop. A tabela pode rolar dentro do próprio contêiner; a página não.
- [ ] **`conferir-telas.mjs` abre painéis de leitura.** Opção nova, ex.
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
- [ ] Portão: `tsc` 0, guarda 0 em `src`, `vite build`; pytest do arquivo de
  teste tocado.

## Estado

(vazio)

## Perguntas

(dúvida de produto: opções + a assumida, a mais segura e reversível)
