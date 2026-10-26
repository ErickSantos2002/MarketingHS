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

    # Balde PRÓPRIO da visita do `rastreio.js` (`/publico/site/visita`, prova
    # do RD): uma por carregamento de página, de todo visitante do site
    # cadastrado — dividir os 30/min do balde comum com `/publico/captura`
    # faria a navegação de um escritório atrás de NAT gastar a cota do
    # formulário.
    LIMITE_VISITA_POR_MINUTO: int = 120

    # Receptor de teste do contrato do GrowthHS e eco do formulário de teste;
    # desligado por padrão; liga só durante a prova (prova do RD, 21/10).
    PROVA_RECEPTOR_TESTE: bool = False

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

    # Controle de volume (R1, 02/10/2026) — ver app/ritmo.py. O valor que vale
    # é o de `integration_secrets` (mesmo nome), editável sem deploy; estes são
    # o padrão seguro. Teto por hora em janela móvel, por dia no dia civil de
    # Brasília; a rampa começa em ENVIO_AQUECIMENTO_DIA1 (0 desliga) e dobra
    # por dia a partir de ENVIO_AQUECIMENTO_INICIO (AAAA-MM-DD; vazio = dia do
    # primeiro envio real).
    ENVIO_POR_SEGUNDO: float = 2.0
    ENVIO_TETO_HORA: int = 500
    ENVIO_TETO_DIA: int = 2000
    ENVIO_AQUECIMENTO_DIA1: int = 50
    ENVIO_AQUECIMENTO_INICIO: str = ""

    # ⚠️ SEM USO desde 26/10/2026 (pergunta 80): a sincronização com o
    # DataCore (Tiny ERP) saiu da tela e da API, e nada lê estas duas chaves.
    # Ficam declaradas só porque o .env de produção ainda as tem — tirar daqui
    # antes de tirar de lá derruba o boot (ver o aviso no fim desta classe).
    # Ordem para remover: 1) tirar do .env da api e do worker; 2) tirar daqui.
    DATACORE_URL: str = ""

    # Sem uso (idem). Ligava a varredura de e-mail de nota fiscal na carga.
    DATACORE_EMAIL_DE_NOTAS: bool = False

    # ⚠️ Toda chave lida do ambiente PRECISA ser declarada aqui, mesmo que outro
    # módulo é que a leia: o pydantic-settings recusa chave desconhecida no .env
    # e derruba o boot inteiro. Isso já derrubou o HS.OS duas vezes.


settings = Settings()
