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
  | 'remove_tag'
  | 'change_status'
  | 'handoff_growthhs'
  // Prova do RD (migration 027): aviso interno por e-mail e POST para uma URL.
  // Os dois saem pela caixa de saída `journey_saidas`, drenada pelo worker.
  | 'notify_email'
  | 'webhook';

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
  // Modo teste (prova do RD): com lista, nó com efeito (e-mail, aviso,
  // webhook, GrowthHS) só age para contato cujo e-mail está nela; o resto
  // passa como "pulado". `null` = sem modo teste. Pode faltar enquanto o
  // backend não devolver a coluna — ler sempre com `?? null`.
  allowed_emails?: string[] | null;
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
  remove_tag: 'Remover tag',
  change_status: 'Mudar status',
  handoff_growthhs: 'Enviar ao GrowthHS',
  notify_email: 'Avisar por e-mail',
  webhook: 'Enviar para webhook',
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
  // `form_submitted`, e não `lead_created`: é o que `fn_lead_insert_event`
  // grava em todo INSERT de lead (captura, API, manual). `lead_created` não
  // tem emissor, e a jornada que entrava por ele ficava vazia para sempre
  // (U4, raio-x de 02/10). Guardado por scripts/journeys-eventos.test.mjs.
  { value: 'form_submitted', label: 'Formulário enviado / lead criado' },
  { value: 'contact_updated', label: 'Contato atualizado' },
];

// Filtro de página do gatilho (R5, migration 026). Só o `form_submitted`
// carrega a página — é o evento da captura e de `POST /publico/conversao`.
// Sem `page_slug` no entry_config = qualquer página (o comportamento de antes).
export const EVENTO_COM_PAGINA = 'form_submitted';

/**
 * `entry_config` de um fluxo por evento. Só o `form_submitted` filtra:
 * `page_slug` (a página da casa) e `form_ids` (formulários de site de fora,
 * migration 027) valem em OU — entra quem converter na página OU em qualquer
 * um dos formulários. Sem nenhum dos dois = qualquer origem.
 */
export function buildEntryConfig(eventType: string, pageSlug?: string, formIds?: string[]): Record<string, any> {
  const cfg: Record<string, any> = { event_type: eventType };
  if (eventType !== EVENTO_COM_PAGINA) return cfg;
  if (pageSlug) cfg.page_slug = pageSlug;
  const ids = (formIds ?? []).map((f) => f.trim()).filter(Boolean);
  if (ids.length) cfg.form_ids = [...new Set(ids)];
  return cfg;
}

/** Os `form_ids` gravados, aceitando só lista de texto (como o banco). */
export function readEntryFormIds(cfg: any): string[] {
  return Array.isArray(cfg?.form_ids) ? cfg.form_ids.filter((f: unknown) => typeof f === 'string') : [];
}

// Mesmo critério de formato do servidor (é ele quem decide; aqui é só para
// avisar antes de salvar).
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Lista de e-mails digitada (vírgula, ponto e vírgula, espaço ou linha):
 * aparada, minúscula, sem repetidos. O que não parece e-mail volta em
 * `invalidos` — nunca é descartado em silêncio: lista do modo teste que perde
 * um endereço por erro de digitação ainda trava, mas a que vira vazia por erro
 * de leitura desliga a trava.
 */
export function lerListaDeEmails(texto: string): { validos: string[]; invalidos: string[] } {
  const validos: string[] = [];
  const invalidos: string[] = [];
  for (const parte of texto.split(/[\s,;]+/)) {
    const e = parte.trim().toLowerCase();
    if (!e) continue;
    if (!EMAIL.test(e)) { if (!invalidos.includes(parte.trim())) invalidos.push(parte.trim()); continue; }
    if (!validos.includes(e)) validos.push(e);
  }
  return { validos, invalidos };
}

/** O webhook só aceita `https://` (o banco recusa o resto). */
export function webhookValido(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return u.protocol === 'https:' && !!u.hostname;
  } catch {
    return false;
  }
}

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
