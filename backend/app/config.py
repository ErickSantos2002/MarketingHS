from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # Postgres da HS. Sem TLS por limitação do servidor — por isso backend e
    # banco moram na mesma máquina (62.72.11.28).
    DATABASE_URL: str = ""

    # Auth própria — substitui supabase.auth
    JWT_SECRET: str = "dev-only-trocar-em-producao"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_HOURS: int = 24

    FRONTEND_URL: str = "http://127.0.0.1:8080"

    # Limite de taxa da borda pública (lead-capture e afins não têm auth).
    LIMITE_PUBLICO_POR_MINUTO: int = 30

    # Credencial alternativa à chave de API, para chamador máquina que não
    # tem chave própria. ⚠️ É global: vale tudo, não tem escopo nem expiração.
    # Herdado da origem; ver a pendência no ROADMAP.
    WEBHOOK_SECRET: str = ""

    # ⚠️ Toda chave lida do ambiente PRECISA ser declarada aqui, mesmo que outro
    # módulo é que a leia: o pydantic-settings recusa chave desconhecida no .env
    # e derruba o boot inteiro. Isso já derrubou o HS.OS duas vezes.


settings = Settings()
