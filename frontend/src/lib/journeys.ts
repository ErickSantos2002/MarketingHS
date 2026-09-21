// Contrato do grafo de fluxo. ESPELHA exatamente o que validate_journey_graph
// aceita no banco e o que o executor sabe rodar — que agora é
// `backend/app/jornadas/executor.py`, não mais a `journey-worker`.
// Mudar aqui sem mudar lá = fluxo que a UI deixa salvar e o banco rejeita.

export type JourneyStatus = 'draft' | 'active' | 'paused' | 'archived';
export type JourneyEntryType = 'segment' | 'event';
export type JourneyReentry = 'once' | 'allowed';

export type JourneyNodeType =
  | 'send_email'
  | 'delay'
  | 'wait_for_event'
  | 'branch_attribute'
  | 'branch_segment'
  | 'branch_email_event'
  | 'apply_tag'
  | 'handoff_growthhs';

export interface JourneyNode {
  id: string;
  type: JourneyNodeType;
  config: Record<string, any>;
  next?: string | null;
  next_false?: string | null;   // branch_*: ramo "não"
  next_timeout?: string | null; // wait_for_event: ramo do timeout
}

export interface Journey {
  id: string;
  name: string;
  description: string | null;
  status: JourneyStatus;
  entry_type: JourneyEntryType;
  entry_config: Record<string, any>;
  reentry: JourneyReentry;
  // C1: só usado quando reentry='allowed'. Um run TERMINADO (done/failed/exited)
  // só deixa de bloquear reinscrição depois deste número de horas (padrão do
  // banco: 168h = 7 dias). Sem isso, reentry='allowed' com entrada por segmento
  // permanente reinscreve o mesmo lead a cada tick do cron e reenvia os mesmos
  // emails para sempre -- ver journey_enroll_segment/_event (20260714101500).
  reentry_cooldown_hours: number;
  entry_node_id: string | null;
  nodes: JourneyNode[];
  created_at: string;
  updated_at: string;
  runs?: Record<string, number>;
}

export interface JourneyNodeMetrics {
  entered: number;
  emails: { enqueued: number; sent: number; opened: number; clicked: number; failed: number };
}

export const NODE_LABELS: Record<JourneyNodeType, string> = {
  send_email: 'Enviar email',
  delay: 'Esperar',
  wait_for_event: 'Aguardar evento',
  branch_attribute: 'Condição (atributo)',
  branch_segment: 'Condição (segmento)',
  branch_email_event: 'Condição (email)',
  apply_tag: 'Aplicar tag',
  handoff_growthhs: 'Enviar ao GrowthHS',
};

// Tipos de nó cujo consumidor AINDA NÃO EXISTE neste produto. A tela não pode
// oferecer o que não roda: o executor registra `failed` com a razão em vez de
// fingir sucesso (um fluxo que "entregou ao comercial" sem entregar nada é pior
// que um que falhou visivelmente), e o construtor não deixa montar o passo.
//
// Desde o lote 8D `handoff_growthhs` tem consumidor (executor +
// `POST /crm/enviar`) e saiu daqui. O mapa fica vazio até o próximo tipo de
// nó sem consumidor existir — não apagar o tipo, só a entrada dele aqui.
export const NODE_NAO_LIGADO: Partial<Record<JourneyNodeType, string>> = {};

export const BRANCH_TYPES: JourneyNodeType[] = ['branch_attribute', 'branch_segment', 'branch_email_event'];
export const isBranch = (t: JourneyNodeType) => BRANCH_TYPES.includes(t);

export const STATUS_LABELS: Record<JourneyStatus, string> = {
  draft: 'Rascunho',
  active: 'Ativo',
  paused: 'Pausado',
  archived: 'Arquivado',
};

// Eventos de contact_events que fazem sentido no builder (entrada e espera).
// Os de email vêm de fn_campaign_send_event; os demais, da timeline unificada.
export const EVENT_OPTIONS: { value: string; label: string }[] = [
  // Ordem do funil de email: entregue -> aberto -> clicado.
  { value: 'email_delivered', label: 'Recebeu o email (entregue)' },
  { value: 'email_opened', label: 'Abriu o email' },
  { value: 'email_clicked', label: 'Clicou no email' },
  // Rotulo antes era 'Recebeu um email' -- colidia com o novo 'email_delivered'
  // e enganava: email_sent = despachamos com sucesso, nao "chegou na caixa".
  { value: 'email_sent', label: 'Enviamos o email (despachado)' },
  { value: 'email_bounced', label: 'Email retornou (bounce)' },
  { value: 'email_unsubscribed', label: 'Descadastrou-se' },
  { value: 'lead_created', label: 'Lead criado' },
  { value: 'contact_updated', label: 'Contato atualizado' },
];

export function newNodeId(): string {
  return `n${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
}

/** Percorre o grafo a partir da entrada, na ordem em que o builder desenha. */
export function orderedNodes(nodes: JourneyNode[], entryId: string | null): JourneyNode[] {
  if (!entryId) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: JourneyNode[] = [];
  const seen = new Set<string>();
  const walk = (id: string | null | undefined) => {
    if (!id || seen.has(id)) return;
    const n = byId.get(id);
    if (!n) return;
    seen.add(id);
    out.push(n);
    walk(n.next);
    walk(n.next_false);
    walk(n.next_timeout);
  };
  walk(entryId);
  return out;
}

// Entrada por segmento aceita N inclusões e N exclusões. Fluxos criados antes
// dessa mudança guardam { segment_id }; a leitura converte no formato novo sem
// precisar de backfill no banco.
export function readEntrySegments(cfg: any): { include: string[]; exclude: string[] } {
  return {
    include: Array.isArray(cfg?.segment_ids)
      ? cfg.segment_ids
      : (cfg?.segment_id ? [cfg.segment_id] : []),
    exclude: Array.isArray(cfg?.excluded_segment_ids) ? cfg.excluded_segment_ids : [],
  };
}
