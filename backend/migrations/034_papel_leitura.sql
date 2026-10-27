-- 034 — papel `leitura` (frente papel-leitura, 27/10/2026)
--
-- Conta para quem só olha (o Sergio, da agência): vê as telas do admin, não
-- grava nada. Três camadas, da de fora para a de dentro:
--
--   1. a rota: `admin_ou_leitura` só nos GET de leitura; `usuario_atual`
--      recusa (403) todo método que não seja GET/HEAD/OPTIONS do leitor;
--   2. a transação: `database.sessao(role="authenticated", user_id=<leitor>)`
--      marca a transação READ ONLY — o próprio Postgres recusa INSERT,
--      UPDATE, DELETE, nextval, o que for;
--   3. esta função: só DENTRO de uma transação READ ONLY o leitor passa por
--      `has_role(uid, 'admin')`.
--
-- ⚠️ Por que mexer no `has_role`. As 65 políticas herdadas (e as RPCs de
-- segmento, jornada e agendamento) são TODAS `has_role(auth.uid(), 'admin')`.
-- Sem esta mudança o leitor levaria ZERO linhas em toda lista, sem erro — o
-- painel zerado que parece mês fraco. As alternativas eram piores: abrir
-- `service_role` (BYPASSRLS, sem segunda linha nenhuma) nas rotas de leitura,
-- ou uma política de SELECT por tabela (dezenas, e cada uma esquecida vira
-- zero silencioso). Aqui o leitor ganha a VISÃO do admin e, pela condição do
-- READ ONLY, nunca a escrita: as políticas de escrita usam o mesmo
-- `has_role`, mas numa transação READ ONLY nenhuma escrita chega a elas.
-- Pergunta registrada em docs/frentes/papel-leitura.md.
--
-- Reaplicável: `ADD VALUE IF NOT EXISTS` + `CREATE OR REPLACE`. Para desfazer,
-- recriar `has_role` com o corpo da 001 (o valor do enum pode ficar: sem
-- ninguém com ele, não faz nada).
--
-- ⚠️ `ALTER TYPE ... ADD VALUE` não pode ser usado na mesma transação em que
-- foi criado. O psql roda cada comando em autocommit, então a função abaixo
-- (que cita 'leitura') já o encontra comitado. NÃO envolva este arquivo em
-- BEGIN/COMMIT nem rode com `--single-transaction`.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'leitura';

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
    RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
  OR (
    _role = 'admin'::public.app_role
    AND current_setting('transaction_read_only') = 'on'
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = _user_id
        AND role = 'leitura'::public.app_role
    )
  )
$$;
