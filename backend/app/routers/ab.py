"""O módulo de teste A/B no admin — o que as telas de Experiments faziam
direto no banco, pelo alias `const db = supabase as any`.

⚠️ As cinco tabelas `ab_*` são admin-only por RLS (`has_role(auth.uid(),
'admin')`, `001_schema_origem.sql:4673-4715`). Por isso toda rota é
`admin_atual` — um autenticado sem o papel levaria zero linhas, não erro — e
roda em `sessao(role="authenticated", user_id=...)`, que é o que põe o id em
`auth.uid()`. `ab_activate_test` confere o mesmo papel por dentro.
"""

import re

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator

from app.ab.dominio import normalizar_dominio
from app.database import sessao
from app.dependencies import Usuario, admin_atual

router = APIRouter(prefix="/ab", tags=["ab"])


class ConfigAbIn(BaseModel):
    production_domain: str | None = None
    redirector_base: str | None = None

    @field_validator("redirector_base")
    @classmethod
    def _endereco_completo(cls, valor):
        """Vazio apaga; o resto precisa do protocolo — é o que monta o link
        que o time cola no anúncio."""
        if valor is None or not valor.strip():
            return None
        valor = valor.strip().rstrip("/")
        if not re.match(r"^https?://[^/\s]+", valor, re.I):
            raise ValueError("use o endereço completo, com https://")
        return valor


@router.get("/config")
async def ler_config(usuario: Usuario = Depends(admin_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            "SELECT production_domain, redirector_base FROM ab_config LIMIT 1")
    if linha is None:
        return {"production_domain": None, "redirector_base": None}
    return dict(linha)


@router.put("/config")
async def gravar_config(dados: ConfigAbIn, usuario: Usuario = Depends(admin_atual)):
    """Grava só o que veio. A tabela é uma linha só (índice em `(true)`,
    migration 017), e é ele o alvo do ON CONFLICT."""
    enviados = dados.model_dump(exclude_unset=True)
    if "production_domain" in enviados:
        dominio = normalizar_dominio(enviados["production_domain"])
        if not dominio:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "Informe um domínio válido (ex.: exemplo.com.br).")
        enviados["production_domain"] = dominio
    if not enviados:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nada para gravar.")

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            """INSERT INTO ab_config (production_domain, redirector_base)
               VALUES ($1, $2)
               ON CONFLICT ((true)) DO UPDATE SET
                 production_domain = CASE WHEN $3 THEN EXCLUDED.production_domain
                                          ELSE ab_config.production_domain END,
                 redirector_base   = CASE WHEN $4 THEN EXCLUDED.redirector_base
                                          ELSE ab_config.redirector_base END
               RETURNING production_domain, redirector_base""",
            enviados.get("production_domain"), enviados.get("redirector_base"),
            "production_domain" in enviados, "redirector_base" in enviados)
    return dict(linha)
