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

    # Baldes PRÓPRIOS do A/B público (revisão final do 8C, I1 e I4) — nenhum
    # dos dois pode dividir cota com `/publico/captura`, que é onde mora o
    # lead de verdade.
    #
    # O coletor (`/publico/ab/eventos`): o `ab.js` manda vários eventos por
    # visita (troca de aba, pagehide, scroll, clique em CTA) — 30/min do
    # balde comum estoura fácil com poucas visitas simultâneas, ou várias
    # atrás do mesmo NAT corporativo.
    LIMITE_COLETOR_POR_MINUTO: int = 120

    # O redirecionador (`/publico/ab/go`): antes ficava TOTALMENTE isento
    # (decisão 6 do plano); um balde alto substitui a isenção total, porque
    # isenção total deixa qualquer GET em loop na URL pública (a tela de
    # configuração a imprime) enfileirar duas escritas por acesso no pool de
    # 10 sem limite nenhum. Ninguém clica 300 anúncios por minuto, nem atrás
    # de NAT de operadora.
    LIMITE_REDIRECIONADOR_POR_MINUTO: int = 300

    # Credencial alternativa à chave de API, para chamador máquina que não
    # tem chave própria. ⚠️ É global: vale tudo, não tem escopo nem expiração.
    # Herdado da origem; ver a pendência no ROADMAP.
    WEBHOOK_SECRET: str = ""

    # Envio de e-mail (lote 3B). Os valores podem vir daqui OU da tabela
    # integration_secrets — ver app/integracoes.py, que lê o banco primeiro e
    # cai para o ambiente. Declarar aqui é o que permite o fallback existir.
    RESEND_API_KEY: str = ""
    EMAIL_FROM: str = ""
    UNSUBSCRIBE_SECRET: str = ""
    RESEND_WEBHOOK_SECRET: str = ""

    # Meta (Conversions API). Como os do Resend: o valor de verdade mora em
    # `integration_secrets` e é gravado pela tela; declarar aqui é o que impede
    # o pydantic-settings de derrubar o boot se alguém puser a chave no .env.
    META_PIXEL_ID: str = ""
    META_ACCESS_TOKEN: str = ""
    META_TEST_EVENT_CODE: str = ""

    # IA (API da Claude). Como as do Resend e do Meta: o valor de verdade mora
    # em `integration_secrets` e é gravado pela tela; declarar aqui é o que
    # impede o pydantic-settings de derrubar o boot se a chave estiver no .env.
    #
    # ⚠️ A chave se configura em Configurações → IA — colocá-la em `.env` NÃO
    # FUNCIONA por este caminho. `ler_segredo` (app/integracoes.py) cai para
    # `os.environ` quando `integration_secrets` está vazio, mas ninguém aqui
    # chama `load_dotenv()`: o pydantic-settings lê `.env` e preenche este
    # `Settings.ANTHROPIC_API_KEY`, não o `os.environ` do processo. Uma chave
    # só em `.env` fica invisível pelos dois caminhos, e o chat continua
    # respondendo `400 "não está configurada"`.
    ANTHROPIC_API_KEY: str = ""

    # O motor de fila. Visibilidade é por quanto tempo uma mensagem reivindicada
    # fica escondida dos outros workers; se o envio demorar mais que isso, outro
    # worker a pega — e o índice único de campaign_sends é o que impede o e-mail
    # duplicado nesse caso.
    FILA_VISIBILIDADE_SEGUNDOS: int = 120
    FILA_MAX_TENTATIVAS: int = 5
    FILA_LOTE: int = 20
    WORKER_INTERVALO_SEGUNDOS: float = 2.0

    # DataCore (Tiny ERP), o banco de onde vêm os clientes. SOMENTE LEITURA:
    # a sincronização é de mão única, o ERP manda e o MarketingHS obedece.
    # Vazio = sincronização desligada, e a rota responde 503 em vez de estourar.
    DATACORE_URL: str = ""

    # ⚠️ Ligado, faz a sincronização varrer e-mail de nota fiscal e conta a
    # receber, além do cadastro do cliente. Medido em 02/09/2026: sobe o alcance
    # de 190 para 327 clientes. É decisão do Erick e do Nicholson, não do
    # sistema — e-mail de nota fiscal foi coletado para faturar, não para
    # marketing. Nasce desligado de propósito.
    DATACORE_EMAIL_DE_NOTAS: bool = False

    # ⚠️ Toda chave lida do ambiente PRECISA ser declarada aqui, mesmo que outro
    # módulo é que a leia: o pydantic-settings recusa chave desconhecida no .env
    # e derruba o boot inteiro. Isso já derrubou o HS.OS duas vezes.


settings = Settings()
