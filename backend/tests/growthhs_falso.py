"""O GrowthHS em memória, servido por `httpx.MockTransport`.

Saiu de `test_crm_entrega.py` (frente agendamento, 28/10/2026) para a fila de
entrega e o agendamento usarem o MESMO falso. Ganhou as rotas do agendamento
(contrato final do GrowthHS, spec 2026-10-28-agendamento-reuniao-design.md):
`/integration/vendedores`, `/integration/agenda`, `card-tasks`,
`card-tasks/{id}/daily-room` e o PUT de `assigned_to_id`.
"""

import itertools
import json
from urllib.parse import parse_qs, urlsplit

import httpx

LISTA_DE_ENTRADA, BOARD_DE_ENTRADA = 22, 6
CARDS, NOTAS, PESSOAS = "/api/v1/cards", "/api/v1/card-notes", "/api/v1/persons"
TAREFAS = "/api/v1/card-tasks"
VENDEDORES = "/api/v1/integration/vendedores"
AGENDA = "/api/v1/integration/agenda"
ANTIGO = "2026-01-01T10:00:00"  # ingênuo, como o GrowthHS serializa
# O `FRONTEND_URL` de lá: o link público é `<app>/entrar/<public_access_token>`.
APP_URL = "https://app.exemplo.invalid"


class GrowthHSFalso:
    """O GrowthHS em memória, com o comportamento de §8 de lá que importa:
    busca de pessoa PARCIAL e sem `email_alternative`; `POST /persons` 400
    para e-mail repetido em qualquer dos quatro campos; listagem de cards por
    board + pessoa SEM a descrição (por isso a entrega lê o card).

    Defeitos sob encomenda:
    - `forcar[(método, prefixo do caminho)]`: respostas devolvidas ANTES do
      comportamento normal, consumidas em ordem (a rota volta ao normal
      quando a lista acaba);
    - `perder[(método, prefixo)] = n`: faz a operação e PERDE a resposta
      (timeout) n vezes — o 201/200 que nunca chegou;
    - `corpo_do_post_card`: bytes no lugar do JSON do 201 (o card é criado);
    - `corpo_do_post_tarefa`: idem para a tarefa (a tarefa é criada);
    - `ao_criar_card`: chamado depois de criar um card.
    `agora` é o `created_at` dos cards criados por `POST` — fixo no passado
    por padrão, para o teste não depender do relógio desta máquina contra o
    do banco (que dá o `criado_em` do pedido)."""

    def __init__(self):
        self.pessoas: dict[int, dict] = {}
        self.cards: dict[int, dict] = {}
        self.notas: list[dict] = []
        self.pedidos: list[httpx.Request] = []
        self.forcar: dict[tuple[str, str], list] = {}
        self.perder: dict[tuple[str, str], int] = {}
        self.corpo_do_post_card: bytes | None = None
        self.ao_criar_card = None
        self.agora = "2026-10-01T12:00:00"
        self._ids = itertools.count(7001)
        # Agendamento: vendedores (como a rota devolve), blocos ocupados por
        # vendedor (UTC, texto ISO), quem vem em `erros`, as tarefas e as
        # salas criadas, e o `convidados_removidos` da próxima sala.
        self.vendedores: list[dict] = []
        self.ocupado: dict[int, list[tuple[str, str]]] = {}
        self.erros_agenda: set[int] = set()
        self.tarefas: dict[int, dict] = {}
        self.salas: list[int] = []
        self.convidados_removidos = 0
        self.corpo_do_post_tarefa: bytes | None = None

    # ── semear ──
    def pessoa(self, **campos) -> int:
        pid = next(self._ids)
        self.pessoas[pid] = {"id": pid, "name": "Pessoa", **campos}
        return pid

    def card(self, person_id, *, descricao="", board=BOARD_DE_ENTRADA, is_won=False,
             is_lost=False, created_at=ANTIGO) -> int:
        cid = next(self._ids)
        self.cards[cid] = {"id": cid, "person_id": person_id, "list_id": LISTA_DE_ENTRADA,
                           "board_id": board, "title": "Card do vendedor",
                           "description": descricao, "is_won": is_won, "is_lost": is_lost,
                           "created_at": created_at}
        return cid

    def ocupar(self, user_id: int, inicio: str, fim: str) -> None:
        self.ocupado.setdefault(int(user_id), []).append((inicio, fim))

    # ── olhar ──
    def de(self, metodo, caminho):
        return [p for p in self.pedidos if p.method == metodo and p.url.path == caminho]

    def puts(self):
        return [p for p in self.pedidos if p.method == "PUT"]

    def transporte(self):
        return httpx.MockTransport(self)

    # ── servir ──
    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.pedidos.append(request)
        caminho = request.url.path
        for (metodo, prefixo), fila in self.forcar.items():
            if metodo == request.method and caminho.startswith(prefixo) and fila:
                resposta = fila.pop(0)
                if isinstance(resposta, Exception):
                    raise resposta
                return resposta
        resposta = self._servir(request, caminho)
        for (metodo, prefixo), n in self.perder.items():
            if metodo == request.method and caminho.startswith(prefixo) and n > 0:
                self.perder[(metodo, prefixo)] = n - 1
                raise httpx.ReadTimeout("resposta perdida", request=request)
        return resposta

    def _servir(self, request, caminho) -> httpx.Response:
        metodo = request.method
        corpo = json.loads(request.content) if request.content else {}
        params = {k: v[0] for k, v in parse_qs(urlsplit(str(request.url)).query).items()}
        if (metodo, caminho) == ("POST", "/api/v1/auth/client-credentials"):
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 28800})
        if (metodo, caminho) == ("GET", PESSOAS):
            termo = params.get("search", "").lower()
            campos = ("name", "email", "email_commercial", "email_personal",
                      "phone", "phone_commercial", "phone_whatsapp")
            achadas = [p for p in self.pessoas.values()
                       if any(termo in str(p.get(c) or "").lower() for c in campos)]
            return httpx.Response(200, json={"persons": achadas, "total": len(achadas),
                                             "page": 1, "page_size": 100, "total_pages": 1})
        if (metodo, caminho) == ("POST", PESSOAS):
            email = (corpo.get("email") or "").lower()
            for p in self.pessoas.values():
                if email and email in [str(p.get(c) or "").lower() for c in
                                       ("email", "email_commercial", "email_personal",
                                        "email_alternative")]:
                    return httpx.Response(400, json={"detail": "E-mail já cadastrado"})
            pid = self.pessoa(**corpo)
            return httpx.Response(201, json=self.pessoas[pid])
        if (metodo, caminho) == ("GET", CARDS):
            board, pessoa = int(params["board_id"]), int(params["person_id"])
            achados = [{k: v for k, v in c.items() if k != "description"}
                       for c in self.cards.values()
                       if c["board_id"] == board and c["person_id"] == pessoa]
            return httpx.Response(200, json={"cards": achados, "total": len(achados),
                                             "page": 1, "page_size": 100, "total_pages": 1})
        if (metodo, caminho) == ("POST", CARDS):
            cid = self.card(corpo["person_id"], descricao=corpo.get("description") or "",
                            created_at=self.agora)
            self.cards[cid].update({k: v for k, v in corpo.items() if k != "description"})
            if self.ao_criar_card:
                self.ao_criar_card()
            if self.corpo_do_post_card is not None:
                return httpx.Response(201, content=self.corpo_do_post_card)
            return httpx.Response(201, json=self.cards[cid])
        if caminho.startswith(CARDS + "/"):
            cid = int(caminho.rsplit("/", 1)[1])
            if cid not in self.cards:
                return httpx.Response(404, json={"detail": "Card não encontrado"})
            if metodo == "GET":
                return httpx.Response(200, json=self.cards[cid])
            if metodo == "PUT":
                for chave in ("description", "assigned_to_id"):
                    if chave in corpo:
                        self.cards[cid][chave] = corpo[chave]
                return httpx.Response(200, json=self.cards[cid])
        if (metodo, caminho) == ("POST", NOTAS):
            self.notas.append(corpo)
            return httpx.Response(201, json={"id": len(self.notas), **corpo})
        if (metodo, caminho) == ("GET", VENDEDORES):
            return httpx.Response(200, json=self.vendedores)
        if (metodo, caminho) == ("GET", AGENDA):
            ids = [int(i) for i in params["user_ids"].split(",")]
            assert params["inicio"].endswith("Z") and params["fim"].endswith("Z")
            return httpx.Response(200, json={
                "vendedores": [{"user_id": i, "email": f"v{i}@hs.invalid",
                                "ocupado": [{"inicio": a, "fim": b, "status": "busy"}
                                            for a, b in self.ocupado.get(i, [])]}
                               for i in ids if i not in self.erros_agenda],
                "erros": [{"user_id": i, "motivo": "Access is denied."}
                          for i in ids if i in self.erros_agenda]})
        if (metodo, caminho) == ("POST", TAREFAS):
            tid = next(self._ids)
            self.tarefas[tid] = {"id": tid, "notes": None, "daily_room_url": None,
                                 "public_access_token": None, "teams_event_id": None,
                                 "meeting_provider": None, **corpo}
            if self.corpo_do_post_tarefa is not None:
                return httpx.Response(201, content=self.corpo_do_post_tarefa)
            return httpx.Response(201, json=self.tarefas[tid])
        if (metodo, caminho) == ("GET", TAREFAS):
            # Como `list_tasks` de lá: filtros `card_id`/`task_type`, paginado.
            achadas = [t for t in self.tarefas.values()
                       if str(t.get("card_id")) == params.get("card_id", str(t.get("card_id")))
                       and t.get("task_type") == params.get("task_type", t.get("task_type"))]
            tamanho, pagina = int(params.get("page_size", 50)), int(params.get("page", 1))
            fatia = achadas[(pagina - 1) * tamanho:pagina * tamanho]
            return httpx.Response(200, json={
                "tasks": fatia, "total": len(achadas), "page": pagina, "page_size": tamanho,
                "total_pages": -(-len(achadas) // tamanho)})
        if metodo == "GET" and caminho.startswith(TAREFAS + "/"):
            tid = int(caminho.rsplit("/", 1)[1])
            if tid not in self.tarefas:
                return httpx.Response(404, json={"detail": "Tarefa não encontrada"})
            return httpx.Response(200, json=self.tarefas[tid])
        if metodo == "POST" and caminho.startswith(TAREFAS + "/") and \
                caminho.endswith("/daily-room"):
            tid = int(caminho.split("/")[-2])
            if tid not in self.tarefas:
                return httpx.Response(404, json={"detail": "Tarefa não encontrada"})
            tarefa = self.tarefas[tid]
            if tarefa.get("daily_room_url"):
                # Como lá: a sala se chama `<prefixo>-<id da tarefa>`; o Daily
                # recusa o nome repetido e a rota devolve 503.
                return httpx.Response(503, json={"detail": "Não foi possível criar a reunião"})
            self.salas.append(tid)
            tarefa.update({"daily_room_url": f"https://hs.daily.co/sala-{tid}",
                           "public_access_token": f"tok-{tid}",
                           "teams_event_id": f"evento-{tid}", "meeting_provider": "daily"})
            return httpx.Response(200, json={
                "room_url": tarefa["daily_room_url"],
                "public_link": f"{APP_URL}/entrar/tok-{tid}",
                "public_access_token": f"tok-{tid}",
                "convidados_removidos": self.convidados_removidos})
        return httpx.Response(599, json={"detail": f"rota não prevista {metodo} {caminho}"})
