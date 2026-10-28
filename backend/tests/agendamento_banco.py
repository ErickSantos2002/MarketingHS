"""O que os testes do agendamento gravam FORA de transação, e como desfazem.

As funções de `app/agendamento` abrem as próprias sessões (a confirmação
precisa de duas conexões de verdade para provar a trava da roleta), então os
testes COMITAM. Esta fixture:

- cria uma página ativa com `agendamento` e `campos` (slug único por rodada);
- guarda a roleta de HOMOLOGAÇÃO, deixa-a vazia e a devolve no fim;
- apaga, no fim, os agendamentos da página e os leads dos e-mails usados.

⚠️ E-mails sempre `@exemplo.invalid` (o worker de produção nunca reivindica
agendamento de teste — `execucao.AGENDAMENTO_DE_TESTE`).
"""

import uuid

import pytest
import pytest_asyncio

import app.database as db
from limpeza import apagar_leads

AMBIENTE = "homologacao"
FAIXAS_FUNCIONARIOS = ["Até 100", "101 a 400", "401 a 1.000", "Mais de 1.000"]
FAIXAS_FILIAIS = ["Só a matriz", "2 a 5", "6 a 20", "Mais de 20"]


def config_da_pagina(**agendamento) -> dict:
    return {
        "campos": [
            {"chave": "nome", "rotulo": "Nome", "tipo": "texto", "obrigatorio": True},
            {"chave": "email", "rotulo": "E-mail", "tipo": "email", "obrigatorio": True},
            {"chave": "whatsapp", "rotulo": "WhatsApp", "tipo": "telefone",
             "obrigatorio": True},
            {"chave": "empresa", "rotulo": "Empresa", "tipo": "texto", "obrigatorio": True},
            {"chave": "cargo", "rotulo": "Cargo", "tipo": "texto", "obrigatorio": True},
            {"chave": "funcionarios", "rotulo": "Quantos funcionários a empresa tem?",
             "tipo": "lista", "obrigatorio": True, "opcoes": FAIXAS_FUNCIONARIOS},
            {"chave": "filiais", "rotulo": "Quantas filiais?", "tipo": "lista",
             "obrigatorio": False, "opcoes": FAIXAS_FILIAIS},
        ],
        "agendamento": {"ativo": True, "faixas_que_agendam": ["401 a 1.000", "Mais de 1.000"],
                        "meeting_kind": "apresentacao_phoebus", **agendamento},
    }


DADOS_COMPLETOS = {
    "colunas": {"nome": "Joana Lead", "whatsapp": "+5581999990000", "empresa": "Acme <b>",
                "cargo": "Diretora", "funcionarios": "401 a 1.000"},
    "extras": {"filiais": "2 a 5"},
}


class Cenario:
    def __init__(self, slug: str):
        self.slug = slug
        self.emails: list[str] = []

    def email(self, nome: str = "lead") -> str:
        e = f"ag-{nome}-{uuid.uuid4().hex[:8]}@exemplo.invalid"
        self.emails.append(e)
        return e

    async def roleta(self, *ids: int) -> None:
        async with db.sessao(role="service_role") as conn:
            await conn.execute("DELETE FROM reuniao_roleta WHERE ambiente = $1", AMBIENTE)
            for posicao, uid in enumerate(ids):
                await conn.execute(
                    "INSERT INTO reuniao_roleta (ambiente, user_id, posicao, nome, email) "
                    "VALUES ($1, $2, $3, $4, $5)",
                    AMBIENTE, uid, posicao, f"Vendedor {uid}", f"v{uid}@hs.invalid")

    async def fila(self) -> list[int]:
        async with db.sessao(role="service_role") as conn:
            return [r["user_id"] for r in await conn.fetch(
                "SELECT user_id FROM reuniao_roleta WHERE ambiente = $1 "
                "ORDER BY posicao", AMBIENTE)]

    async def rascunho(self, email: str | None = None, dados: dict | None = None) -> str:
        from app.agendamento.reserva import criar_rascunho
        email = email or self.email()
        if email.strip().lower() not in self.emails:
            self.emails.append(email.strip().lower())
        async with db.sessao(role="service_role") as conn:
            return await criar_rascunho(conn, page_slug=self.slug, email=email,
                                        dados=DADOS_COMPLETOS if dados is None else dados,
                                        ambiente=AMBIENTE)

    async def linha(self, token: str):
        async with db.sessao(role="service_role") as conn:
            return await conn.fetchrow(
                "SELECT * FROM reuniao_agendamentos WHERE token = $1", token)

    async def trocar_config(self, config: dict) -> None:
        async with db.sessao(role="service_role") as conn:
            await conn.execute("UPDATE pages SET config = $2 WHERE slug = $1",
                               self.slug, config)


async def _limpar(slug: str, emails: list[str]) -> None:
    async with db.sessao(role="service_role") as conn:
        await conn.execute("DELETE FROM reuniao_agendamentos WHERE page_slug = $1", slug)
        ids = [r["id"] for r in await conn.fetch(
            "SELECT id FROM leads WHERE lower(email) = ANY($1::text[])", emails)]
        if ids:
            await conn.execute(
                "DELETE FROM crm_handoffs WHERE lead_id = ANY($1::uuid[])", ids)
            await conn.execute(
                "DELETE FROM journey_runs WHERE lead_id = ANY($1::uuid[])", ids)
        await apagar_leads(conn, ids)
        await conn.execute("DELETE FROM pages WHERE slug = $1", slug)


@pytest_asyncio.fixture
async def cenario():
    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")
    async with db.sessao(role="service_role") as conn:
        if await conn.fetchval("SELECT to_regclass('public.reuniao_agendamentos')") is None:
            pytest.skip("migration 036 ainda não aplicada neste banco")
        roleta_antes = [dict(r) for r in await conn.fetch(
            "SELECT * FROM reuniao_roleta WHERE ambiente = $1", AMBIENTE)]
    c = Cenario(f"agendamento-teste-{uuid.uuid4().hex[:8]}")
    async with db.sessao(role="service_role") as conn:
        await conn.execute("DELETE FROM reuniao_roleta WHERE ambiente = $1", AMBIENTE)
        await conn.execute(
            """INSERT INTO pages (name, slug, component_name, page_type, status, config)
               VALUES ('Agendamento (teste)', $1, 'Agendamento', 'landing', 'active', $2)""",
            c.slug, config_da_pagina())
    try:
        yield c
    finally:
        # A fixture `cliente` pode ter fechado a pool antes desta.
        await db.init_db()
        await _limpar(c.slug, c.emails)
        async with db.sessao(role="service_role") as conn:
            await conn.execute("DELETE FROM reuniao_roleta WHERE ambiente = $1", AMBIENTE)
            for r in roleta_antes:
                await conn.execute(
                    "INSERT INTO reuniao_roleta (ambiente, user_id, posicao, nome, email) "
                    "VALUES ($1, $2, $3, $4, $5)",
                    r["ambiente"], r["user_id"], r["posicao"], r["nome"], r["email"])
        await db.close_db()
