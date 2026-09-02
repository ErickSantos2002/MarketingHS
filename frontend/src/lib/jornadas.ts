// Cliente de jornadas (fluxos). Substitui a `journeys-api` e a leitura direta
// de `journey_runs` — os 7 pontos de useJourneys, useJourneyRuns, JourneyBuilder
// e NodeConfigDialog.
//
// O contrato do grafo continua em `lib/journeys.ts`: ele espelha o que
// `validate_journey_graph` aceita no banco e não muda por causa do transporte.
// Aqui mora só a conversa com a API — e a tradução dos poucos campos em que a
// API e a tela discordam de forma.
import { api } from '@/lib/api';
import type { Journey, JourneyNodeMetrics } from '@/lib/journeys';

/** Contagem de execuções por estado, como a API devolve junto de cada fluxo. */
export interface ContagemDeExecucoes {
  active: number;
  waiting: number;
  done: number;
  failed: number;
  exited: number;
}

export const listarJornadas = () =>
  api.get<{ data: (Journey & { runs: ContagemDeExecucoes })[] }>('/jornadas')
    .then(r => r.data);

export interface DetalheDeJornada {
  data: Journey;
  metrics: Record<string, JourneyNodeMetrics>;
  runs: ContagemDeExecucoes;
}

export const obterJornada = (id: string) =>
  api.get<DetalheDeJornada>(`/jornadas/${id}`);

// O que o POST aceita. `status` NÃO entra: o fluxo nasce sempre em 'draft', e
// quem decide isso é o servidor.
export interface JornadaEntrada {
  name: string;
  description?: string | null;
  entry_type: 'segment' | 'event';
  entry_config?: Record<string, unknown>;
  reentry?: 'once' | 'allowed';
  reentry_cooldown_hours?: number | null;
  entry_node_id?: string | null;
  nodes?: Record<string, unknown>[];
}

export const criarJornada = (dados: JornadaEntrada) =>
  api.post<{ success: boolean; journey: { id: string } }>('/jornadas', dados)
    .then(r => r.journey);

// PATCH parcial: só o que vem é escrito. `status` entra aqui (ativar, pausar,
// arquivar) — é a única rota que muda o estado do fluxo.
export type JornadaPatch = Partial<JornadaEntrada> & {
  status?: 'draft' | 'active' | 'paused' | 'archived';
};

export const editarJornada = (id: string, dados: JornadaPatch) =>
  api.patch<{ id: string }>(`/jornadas/${id}`, dados);

export const excluirJornada = (id: string) =>
  api.delete<void>(`/jornadas/${id}`);

/** Um run = um contato dentro de um fluxo. */
export interface ExecucaoDeJornada {
  id: string;
  lead_id: string;
  current_node_id: string | null;
  state: 'active' | 'waiting' | 'done' | 'failed' | 'exited';
  waiting_event: string | null;
  wakeup_at: string | null;
  entered_at: string;
  updated_at: string;
  leads: { nome: string | null; email: string | null } | null;
}

interface ExecucaoApi {
  id: string;
  lead_id: string;
  current_node_id: string | null;
  state: ExecucaoDeJornada['state'];
  waiting_event: string | null;
  wakeup_at: string | null;
  entered_at: string;
  updated_at: string;
  lead_name: string;
  lead_email: string;
}

// A API devolve o contato achatado (`lead_name`/`lead_email`); a tela lê a forma
// aninhada que o supabase-js entregava. A tradução fica aqui para o drawer não
// precisar saber que o transporte mudou.
const daApi = (e: ExecucaoApi): ExecucaoDeJornada => ({
  id: e.id,
  lead_id: e.lead_id,
  current_node_id: e.current_node_id,
  state: e.state,
  waiting_event: e.waiting_event,
  wakeup_at: e.wakeup_at,
  entered_at: e.entered_at,
  updated_at: e.updated_at,
  leads: { nome: e.lead_name, email: e.lead_email },
});

// ⚠️ O servidor devolve no máximo 200 execuções, as mais recentes. A origem
// paginava de 1000 em 1000 no navegador e somava até 20 mil linhas para
// desenhar uma lista — o teto agora é do servidor, e é ele que decide.
export const execucoesDaJornada = (id: string) =>
  api.get<ExecucaoApi[]>(`/jornadas/${id}/execucoes`).then(l => l.map(daApi));
