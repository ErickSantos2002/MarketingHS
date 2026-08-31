import { useState, useRef, useEffect } from 'react';
import dnMarketingLogo from '@/assets/dnmarketing-logo.png';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Copy, Check, AlertTriangle, ChevronRight, ExternalLink, Eye, EyeOff, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID || '[PROJECT_ID]'}.supabase.co`;
const BASE_URL = `${supabaseUrl}/functions/v1`;

/* ── Copiable Code Block ── */
function CodeBlock({ code, className = '' }: { code: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success('Copiado!');
    setTimeout(() => setCopied(false), 2000);
  };

  const highlighted = code
    .replace(/\[PROJECT_ID\]/g, '§PID§')
    .replace(/\[WEBHOOK_SECRET\]/g, '§WHS§');

  const parts = highlighted.split(/(§PID§|§WHS§)/);

  return (
    <div className={`relative rounded-lg overflow-hidden ${className}`} style={{ background: '#1E1E2E' }}>
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-2 right-2 h-7 text-[10px] gap-1 text-[#A9B1D6] hover:text-white hover:bg-white/10 z-10"
        onClick={handleCopy}
      >
        {copied ? <><Check className="h-3 w-3" /> Copiado ✓</> : <><Copy className="h-3 w-3" /> Copiar</>}
      </Button>
      <pre className="p-4 pr-24 overflow-x-auto text-xs font-mono whitespace-pre-wrap" style={{ color: '#A9B1D6' }}>
        {parts.map((part, i) =>
          part === '§PID§' ? <span key={i} style={{ color: '#EF9F27' }}>[PROJECT_ID]</span> :
          part === '§WHS§' ? <span key={i} style={{ color: '#EF9F27' }}>[WEBHOOK_SECRET]</span> :
          <span key={i}>{part}</span>
        )}
      </pre>
    </div>
  );
}

/* ── Method Badge ── */
function MethodBadge({ method }: { method: string }) {
  const colors = method === 'GET'
    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
    : method === 'PATCH'
    ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
    : method === 'DELETE'
    ? 'bg-red-500/15 text-red-400 border-red-500/30'
    : 'bg-blue-500/15 text-blue-400 border-blue-500/30';
  return <Badge variant="outline" className={`text-[10px] font-mono font-bold ${colors}`}>{method}</Badge>;
}

/* ── Param Table ── */
function ParamTable({ params }: { params: { name: string; type: string; required: string; description: string }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/40">
            <th className="text-left py-2 px-3 font-medium text-muted-foreground">Nome</th>
            <th className="text-left py-2 px-3 font-medium text-muted-foreground">Tipo</th>
            <th className="text-left py-2 px-3 font-medium text-muted-foreground">Obrigatório</th>
            <th className="text-left py-2 px-3 font-medium text-muted-foreground">Descrição</th>
          </tr>
        </thead>
        <tbody>
          {params.map(p => (
            <tr key={p.name} className="border-b border-border/20">
              <td className="py-2 px-3 font-mono text-primary">{p.name}</td>
              <td className="py-2 px-3 text-muted-foreground">{p.type}</td>
              <td className="py-2 px-3">{p.required === 'Sim' ? <Badge variant="destructive" className="text-[9px] h-4">Sim</Badge> : <span className="text-muted-foreground">{p.required}</span>}</td>
              <td className="py-2 px-3 text-muted-foreground">{p.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Endpoint Sections Data ── */
const ENDPOINTS = [
  {
    id: 'identity-lookup',
    method: 'GET',
    path: '/identity-lookup',
    title: 'Buscar identidade',
    description: 'Busca uma identidade unificada por telefone, email ou dnia_id.',
    params: [
      { name: 'phone', type: 'string', required: 'Condicional', description: 'Telefone no formato +55...' },
      { name: 'email', type: 'string', required: 'Condicional', description: 'Email do contato' },
      { name: 'dnia_id', type: 'uuid', required: 'Condicional', description: 'DN.IA ID do ecossistema' },
    ],
    curl: `curl -X GET \\
  '${BASE_URL}/identity-lookup?phone=+5511999999999' \\
  -H 'Authorization: Bearer [WEBHOOK_SECRET]'`,
    response: JSON.stringify({
      dnia_id: "uuid",
      phone: "+5511999999999",
      email: "joao@empresa.com",
      nome: "João Silva",
      stage: "opportunity",
      first_touch_source: "instagram",
      first_touch_app: "dndash",
      dndash_lead_id: "uuid",
      nexus_contact_id: null,
      mentoria_client_id: null,
      lead: {
        cargo: "CEO",
        faturamento: "100k-500k",
        funcionarios: "11-50",
        etiqueta: "hotlead",
        status: "Qualificado",
        utm_source: "instagram",
        utm_campaign: "programa-iaficacao",
        page_slug: "programadeiaficacao",
        created_at: "2026-03-29T20:00:00Z"
      },
      last_seen_at: "2026-03-30T10:00:00Z",
      created_at: "2026-03-01T10:00:00Z"
    }, null, 2),
    notes: 'Pelo menos um dos parâmetros (phone, email, dnia_id) deve ser informado.',
  },
  {
    id: 'contact-details',
    method: 'GET',
    path: '/contact-details',
    title: 'Contexto completo do contato',
    description: 'Retorna tudo sobre um contato em uma única chamada: dados, score, tags, notas, timeline, campanhas e presença no ecossistema. Endpoint principal para agentes de IA.',
    params: [
      { name: 'phone', type: 'string', required: 'Condicional', description: 'Telefone no formato +55...' },
      { name: 'email', type: 'string', required: 'Condicional', description: 'Email do contato' },
      { name: 'dnia_id', type: 'uuid', required: 'Condicional', description: 'DN.IA ID do ecossistema' },
    ],
    curl: `curl -X GET \\
  '${BASE_URL}/contact-details?phone=+5511999999999' \\
  -H 'Authorization: Bearer [WEBHOOK_SECRET]'`,
    response: JSON.stringify({
      dnia_id: "uuid",
      stage: "opportunity",
      first_touch_app: "dndash",
      first_touch_source: "instagram",
      last_seen_at: "2026-03-30T10:00:00Z",
      lead: {
        id: "uuid",
        nome: "João Silva",
        email: "joao@empresa.com",
        whatsapp: "+5511999999999",
        phone_normalized: "+5511999999999",
        cargo: "CEO",
        empresa: "Empresa X",
        faturamento: "100k-500k",
        funcionarios: "11-50",
        etiqueta: "hotlead",
        lead_score: 85,
        status: "Qualificado",
        utm_source: "instagram",
        utm_campaign: "programa-iaficacao",
        page_slug: "programadeiaficacao",
        created_at: "2026-03-01T10:00:00Z"
      },
      scoring: { score: 85, etiqueta: "hotlead", faixa: "hotlead" },
      tags: [{ id: "uuid", name: "VIP", color: "purple" }],
      segments: [{ id: "uuid", name: "Hot Leads", type: "dynamic" }],
      notes: [{ id: "uuid", content: "Interessado no programa", created_at: "2026-03-29T20:00:00Z" }],
      ecosystem: {
        dnmarketing: true,
        nexus: true,
        mentoria: false,
        nexus_contact_id: "uuid",
        mentoria_client_id: null
      },
      timeline: [{
        id: "uuid",
        source_app: "nexus",
        event_type: "meeting_scheduled",
        title: "Reunião agendada",
        description: null,
        metadata: { date: "2026-04-01" },
        occurred_at: "2026-03-30T10:00:00Z"
      }],
      conversions: [{ page_slug: "programadeiaficacao", tipo: "lead", utm_source: "instagram", utm_campaign: "programa-iaficacao", converted_at: "2026-03-01T10:00:00Z" }],
      campaigns_received: [{
        campaign_name: "Convite Evento VIP",
        channel: "email",
        status: "opened",
        sent_at: "2026-03-28T14:00:00Z",
        opened_at: "2026-03-28T15:30:00Z",
        clicked_at: null
      }]
    }, null, 2),
    notes: 'Pelo menos um dos parâmetros (phone, email, dnia_id) deve ser informado. Retorna dados de 7 tabelas em paralelo para máxima performance.',
  },
  {
    id: 'lead-capture',
    method: 'POST',
    path: '/lead-capture',
    title: 'Captura de lead (formulários públicos)',
    description: 'Endpoint usado pelos formulários públicos do site. Resolve a identidade automaticamente (gera/encontra dnia_id). Idempotente por email: se já existir lead com o mesmo email, atualiza.',
    params: [
      { name: 'email', type: 'string', required: 'Sim', description: 'Email do lead (chave de idempotência)' },
      { name: 'sessionId', type: 'string', required: 'Não', description: 'ID da sessão (max 100 chars)' },
      { name: 'fields', type: 'object', required: 'Não', description: 'Objeto com campos do lead (whitelist abaixo). Chaves fora da whitelist são silenciosamente descartadas.' },
    ],
    curl: `curl -X POST \\
  '${BASE_URL}/lead-capture' \\
  -H 'Authorization: Bearer [WEBHOOK_SECRET]' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "email": "joao@empresa.com",
    "sessionId": "abc123",
    "fields": {
      "nome": "João Silva",
      "whatsapp": "(11) 99999-9999",
      "cargo": "CEO",
      "empresa": "Empresa X",
      "faturamento": "100k-500k",
      "funcionarios": "11-50",
      "desafios": "Escalar vendas",
      "source": "programadeiaficacao",
      "utm_source": "instagram",
      "utm_campaign": "abr-2026"
    }
  }'`,
    response: JSON.stringify({
      id: "uuid",
      dnia_id: "uuid",
      phone_normalized: "+5511999999999",
      etiqueta: "warm"
    }, null, 2),
    notes: 'Whitelist de fields: nome, whatsapp, cargo, empresa, faturamento, funcionarios, desafios, tipo, tipo_participante, source, presenca, origem_campanha, indicacao, interesse_formacao, interesse_ecossistema, interesse_mtia, data_interesse, status, utm_source, utm_medium, utm_campaign, utm_term, utm_content, ab_test, ab_var, ab_vid.',
  },
  {
    id: 'identity-upsert',
    method: 'POST',
    path: '/identity-upsert',
    title: 'Criar ou atualizar identidade',
    description: 'Cria uma nova identidade ou atualiza uma existente. Usado pelo Nexus ao criar contatos.',
    params: [
      { name: 'phone', type: 'string', required: 'Condicional', description: 'Telefone (preferencial)' },
      { name: 'email', type: 'string', required: 'Condicional', description: 'Email (fallback se phone ausente)' },
      { name: 'nome', type: 'string', required: 'Não', description: 'Nome do contato' },
      { name: 'source_app', type: 'string', required: 'Sim', description: '"nexus", "mentoria", "dnmarketing" ou "website"' },
      { name: 'local_id', type: 'uuid', required: 'Sim', description: 'ID do contato no sistema de origem' },
      { name: 'stage', type: 'string', required: 'Não', description: 'Stage — só avança (nunca retrocede)' },
      { name: 'source', type: 'string', required: 'Não', description: 'Origem de negócio (ex: nome da landing). Grava em leads.source; em lead existente só preenche se vazio.' },
      { name: 'utm_source', type: 'string', required: 'Não', description: 'UTM source. Grava em leads.utm_source e ecosystem_identities.first_touch_source (apenas na primeira aparição).' },
      { name: 'utm_medium', type: 'string', required: 'Não', description: 'UTM medium' },
      { name: 'utm_campaign', type: 'string', required: 'Não', description: 'UTM campaign' },
      { name: 'utm_term', type: 'string', required: 'Não', description: 'UTM term' },
      { name: 'utm_content', type: 'string', required: 'Não', description: 'UTM content' },
      { name: 'ab_vid', type: 'string', required: 'Não', description: 'Teste A/B: ID anônimo do visitante. Costurado a ab_identities (histórico, nunca sobrescreve). Aceito no top-level ou em metadata.' },
      { name: 'ab_test', type: 'string', required: 'Não', description: 'Teste A/B: slug do teste.' },
      { name: 'ab_var', type: 'string', required: 'Não', description: 'Teste A/B: variante atribuída (A, B, ...).' },
      { name: 'contact_fields', type: 'object', required: 'Não', description: 'Enriquece lead com cargo, empresa, faturamento, funcionarios, desafios. Modo enriquecimento: só grava se vazio.' },
      { name: 'metadata', type: 'object', required: 'Não', description: 'Dados extras livres. Pode conter contact_fields (mesma semântica).' },
    ],
    curl: `curl -X POST \\
  '${BASE_URL}/identity-upsert' \\
  -H 'Authorization: Bearer [WEBHOOK_SECRET]' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "phone": "+5511999999999",
    "source_app": "nexus",
    "local_id": "uuid-do-nexus",
    "stage": "opportunity",
    "source": "programadeiaficacao",
    "utm_source": "instagram",
    "utm_campaign": "abr-2026"
  }'`,
    response: JSON.stringify({
      dnia_id: "uuid",
      is_new: false,
      stage: "opportunity",
      phone_normalized: "+5511999999999",
      dndash_lead_id: "uuid",
      nexus_contact_id: "uuid",
      mentoria_client_id: null,
      first_touch_app: "dndash"
    }, null, 2),
    notes: 'UTMs e source são incluídos no metadata do evento contact_synced/contact_updated. Em leads existentes, só preenchem campos vazios (imutabilidade CRM).',
  },
  {
    id: 'merge-identities',
    method: 'POST',
    path: '/merge-identities',
    title: 'Mesclar duas identidades',
    description: 'Unifica dois registros mantendo o keep_id. Re-aponta leads, eventos e campanhas para a identidade preservada.',
    params: [
      { name: 'keep_id', type: 'uuid', required: 'Sim', description: 'DN.IA ID que será mantido' },
      { name: 'discard_id', type: 'uuid', required: 'Sim', description: 'DN.IA ID que será descartado e mesclado' },
    ],
    curl: `curl -X POST \\
  '${BASE_URL}/merge-identities' \\
  -H 'Authorization: Bearer [WEBHOOK_SECRET]' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "keep_id": "uuid-a-manter",
    "discard_id": "uuid-a-descartar"
  }'`,
    response: JSON.stringify({
      dnia_id: "uuid-a-manter",
      merged_from: "uuid-a-descartar",
      stage: "opportunity"
    }, null, 2),
    notes: 'Operação irreversível. Requer permissão admin.',
  },
  {
    id: 'contacts-list',
    method: 'GET',
    path: '/contacts-list',
    title: 'Listar contatos',
    description: 'Lista leads com filtros, busca e paginação. Inclui dados do ecossistema.',
    params: [
      { name: 'q', type: 'string', required: 'Não', description: 'Busca por nome, email ou telefone' },
      { name: 'etiqueta', type: 'string', required: 'Não', description: 'hotlead | warm | raw' },
      { name: 'status', type: 'string', required: 'Não', description: 'Status do lead' },
      { name: 'stage', type: 'string', required: 'Não', description: 'Stage no ecosystem_identities' },
      { name: 'page', type: 'number', required: 'Não', description: 'Página (default: 1)' },
      { name: 'limit', type: 'number', required: 'Não', description: 'Itens por página (default: 20, max: 100)' },
    ],
    curl: `curl -X GET \\
  '${BASE_URL}/contacts-list?etiqueta=hotlead&status=Qualificado&limit=20' \\
  -H 'Authorization: Bearer [WEBHOOK_SECRET]'`,
    response: JSON.stringify({
      data: [{
        id: "uuid",
        dnia_id: "uuid",
        nome: "João Silva",
        email: "joao@empresa.com",
        whatsapp: "+5511999999999",
        cargo: "CEO",
        faturamento: "100k-500k",
        etiqueta: "hotlead",
        status: "Qualificado",
        stage: "opportunity",
        utm_source: "instagram",
        page_slug: "programadeiaficacao",
        nexus_contact_id: null,
        mentoria_client_id: null,
        created_at: "2026-03-01T10:00:00Z"
      }],
      pagination: { page: 1, limit: 20, total: 1247, pages: 63 }
    }, null, 2),
    notes: null,
  },
  {
    id: 'receive-contact-event',
    method: 'POST',
    path: '/receive-contact-event',
    title: 'Registrar evento na timeline',
    description: 'Registra um evento na timeline unificada do contato. Usado por Nexus e mentor.ia.',
    params: [
      { name: 'phone', type: 'string', required: 'Condicional', description: 'Telefone do contato' },
      { name: 'email', type: 'string', required: 'Condicional', description: 'Email do contato' },
      { name: 'dnia_id', type: 'uuid', required: 'Condicional', description: 'DN.IA ID' },
      { name: 'source_app', type: 'string', required: 'Sim', description: '"nexus", "mentoria", "dnmarketing" ou "website"' },
      { name: 'event_type', type: 'string', required: 'Sim', description: 'Tipo do evento (ver tabela abaixo)' },
      { name: 'title', type: 'string', required: 'Sim', description: 'Título descritivo do evento' },
      { name: 'description', type: 'string', required: 'Não', description: 'Descrição detalhada' },
      { name: 'contact_fields', type: 'object', required: 'Não', description: 'Enriquece o lead vinculado com cargo, empresa, faturamento, funcionarios, desafios. Modo enriquecimento: só grava se vazio.' },
      { name: 'ab_vid', type: 'string', required: 'Não', description: 'Teste A/B: ID anônimo do visitante. Em meeting_scheduled/scheduling_widget_booked registra a conversão "agendamento". Aceito no top-level ou em metadata.' },
      { name: 'ab_test', type: 'string', required: 'Não', description: 'Teste A/B: slug do teste.' },
      { name: 'ab_var', type: 'string', required: 'Não', description: 'Teste A/B: variante atribuída (A, B, ...).' },
      { name: 'metadata', type: 'object', required: 'Não', description: 'Dados extras (JSON). Pode conter contact_fields e/ou ab_vid/ab_test/ab_var.' },
      { name: 'occurred_at', type: 'ISO 8601', required: 'Não', description: 'Data do evento (default: agora)' },
    ],
    curl: `curl -X POST \\
  '${BASE_URL}/receive-contact-event' \\
  -H 'Authorization: Bearer [WEBHOOK_SECRET]' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "phone": "+5511999999999",
    "source_app": "nexus",
    "event_type": "meeting_scheduled",
    "title": "Reunião agendada",
    "metadata": { "date": "2026-04-01", "channel": "zoom" }
  }'`,
    response: JSON.stringify({
      success: true,
      event_id: "uuid",
      dnia_id: "uuid"
    }, null, 2),
    notes: 'deal_won avança o stage automaticamente para "client".',
    extra: (
      <div className="mt-3">
        <p className="text-xs font-medium text-foreground mb-2">Tipos de evento válidos:</p>
        <div className="grid grid-cols-2 gap-1">
          {[
            'opportunity_created', 'meeting_scheduled', 'deal_moved',
            'proposal_sent', 'deal_won', 'deal_lost',
            'onboarding_started', 'onboarding_completed',
            'health_updated', 'checkin_done'
          ].map(t => (
            <code key={t} className="text-[10px] bg-muted/40 px-2 py-1 rounded font-mono">{t}</code>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: 'contact-update',
    method: 'PATCH',
    path: '/contact-update',
    title: 'Atualizar contato',
    description: 'Atualiza campos do lead, gerencia tags e adiciona notas. Registra evento contact_updated na timeline.',
    params: [
      { name: 'phone', type: 'string', required: 'Condicional', description: 'Telefone do contato' },
      { name: 'email', type: 'string', required: 'Condicional', description: 'Email do contato' },
      { name: 'dnia_id', type: 'uuid', required: 'Condicional', description: 'DN.IA ID' },
      { name: 'status', type: 'string (body)', required: 'Não', description: 'Novo status' },
      { name: 'nome', type: 'string (body)', required: 'Não', description: 'Nome' },
      { name: 'cargo', type: 'string (body)', required: 'Não', description: 'Cargo' },
      { name: 'whatsapp', type: 'string (body)', required: 'Não', description: 'WhatsApp/telefone' },
      { name: 'empresa', type: 'string (body)', required: 'Não', description: 'Empresa' },
      { name: 'faturamento', type: 'string (body)', required: 'Não', description: 'Faturamento' },
      { name: 'funcionarios', type: 'string (body)', required: 'Não', description: 'Nº de funcionários' },
      { name: 'desafios', type: 'string (body)', required: 'Não', description: 'Desafios do contato' },
      { name: 'tags_add', type: 'string[] (body)', required: 'Não', description: 'Tags a adicionar' },
      { name: 'tags_remove', type: 'string[] (body)', required: 'Não', description: 'Tags a remover' },
      { name: 'note', type: 'string (body)', required: 'Não', description: 'Nota a adicionar' },
    ],
    curl: `curl -X PATCH \\
  '${BASE_URL}/contact-update?email=joao@empresa.com' \\
  -H 'Authorization: Bearer [WEBHOOK_SECRET]' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "status": "Qualificado",
    "tags_add": ["VIP", "Evento Abril"],
    "note": "Demonstrou interesse no programa"
  }'`,
    response: JSON.stringify({
      success: true,
      dnia_id: "uuid",
      updated_fields: ["status", "tags", "note"],
      lead_score: 75,
      etiqueta: "hotlead"
    }, null, 2),
    notes: 'Pelo menos um query param (phone, email, dnia_id) é obrigatório para identificar o contato.',
  },
  {
    id: 'register-conversion',
    method: 'POST',
    path: '/register-conversion',
    title: 'Registrar conversão',
    description: 'Registra uma nova conversão para um lead existente. Atualiza last_conversion_date e aplica tag automaticamente.',
    params: [
      { name: 'lead_id', type: 'uuid', required: 'Condicional', description: 'ID do lead (preferencial)' },
      { name: 'dnia_id', type: 'uuid', required: 'Condicional', description: 'DN.IA ID do ecossistema' },
      { name: 'email', type: 'string', required: 'Condicional', description: 'Email para resolver o lead' },
      { name: 'phone', type: 'string', required: 'Condicional', description: 'Telefone/WhatsApp para resolver o lead' },
      { name: 'tipo', type: 'string', required: 'Sim', description: 'Tipo da conversão (ex: modal_pago)' },
      { name: 'page_slug', type: 'string', required: 'Sim', description: 'Slug da página. Vira tag se apply_tag=true' },
      { name: 'session_id', type: 'string', required: 'Não', description: 'ID da sessão' },
      { name: 'converted_at', type: 'ISO 8601', required: 'Não', description: 'Data da conversão (default: agora)' },
      { name: 'utm_source', type: 'string', required: 'Não', description: 'UTM source' },
      { name: 'utm_medium', type: 'string', required: 'Não', description: 'UTM medium' },
      { name: 'utm_campaign', type: 'string', required: 'Não', description: 'UTM campaign' },
      { name: 'utm_term', type: 'string', required: 'Não', description: 'UTM term' },
      { name: 'utm_content', type: 'string', required: 'Não', description: 'UTM content' },
      { name: 'source', type: 'string', required: 'Não', description: 'Origem da conversão (ex: programadeiaficacao)' },
      { name: 'apply_tag', type: 'boolean', required: 'Não', description: 'Aplica tag do page_slug (default: true)' },
    ],
    curl: `curl -X POST \\
  '${BASE_URL}/register-conversion' \\
  -H 'Authorization: Bearer [WEBHOOK_SECRET]' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "dnia_id": "uuid-do-contato",
    "tipo": "modal_pago",
    "page_slug": "programadeiaficacao",
    "utm_source": "instagram"
  }'`,
    response: JSON.stringify({
      success: true,
      lead_id: "uuid",
      conversion: {
        id: "uuid",
        lead_id: "uuid",
        tipo: "modal_pago",
        page_slug: "programadeiaficacao",
        converted_at: "2026-03-29T20:00:00Z",
        session_id: null,
        source: null,
        utm_source: "instagram",
        utm_medium: null,
        utm_campaign: null,
        utm_term: null,
        utm_content: null,
        created_at: "2026-03-29T20:00:00Z"
      }
    }, null, 2),
    notes: 'Pelo menos um identificador (lead_id, dnia_id, email ou phone) é obrigatório.',
  },
  {
    id: 'unregister-conversion',
    method: 'DELETE',
    path: '/unregister-conversion',
    title: 'Remover conversão',
    description: 'Remove uma conversão pelo session_id. Recalcula automaticamente o last_conversion_date do lead. Útil para corrigir conversões enviadas incorretamente. Aceita DELETE ou POST.',
    params: [
      { name: 'session_id', type: 'string', required: 'Sim', description: 'ID da sessão da conversão a remover (body ou query param)' },
    ],
    curl: `curl -X DELETE \\
  '${BASE_URL}/unregister-conversion' \\
  -H 'Authorization: Bearer [WEBHOOK_SECRET]' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "session_id": "uuid-da-sessao"
  }'`,
    response: JSON.stringify({
      success: true,
      affected: 1,
      deleted: [{
        id: "uuid",
        lead_id: "uuid",
        converted_at: "2026-06-05T10:00:00Z",
        tipo: "modal_pago",
        page_slug: "programadeiaficacao",
        session_id: "uuid-da-sessao"
      }]
    }, null, 2),
    notes: 'Retorna 404 se nenhuma conversão for encontrada para o session_id. Todas as linhas com aquele session_id são removidas. Um evento conversion_unregistered é registrado na timeline do contato para auditoria.',
  },
  {
    id: 'update-conversion',
    method: 'PATCH',
    path: '/update-conversion',
    title: 'Atualizar data da conversão',
    description: 'Atualiza o converted_at de uma conversão existente pelo session_id. Recalcula automaticamente o last_conversion_date do lead. Útil para corrigir datas enviadas incorretamente sem perder o registro. Aceita PATCH ou POST.',
    params: [
      { name: 'session_id', type: 'string', required: 'Sim', description: 'ID da sessão da conversão a atualizar' },
      { name: 'converted_at', type: 'ISO 8601', required: 'Sim', description: 'Nova data/hora da conversão (timestamp ISO 8601)' },
    ],
    curl: `curl -X PATCH \\
  '${BASE_URL}/update-conversion' \\
  -H 'Authorization: Bearer [WEBHOOK_SECRET]' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "session_id": "uuid-da-sessao",
    "converted_at": "2026-05-12T10:00:00Z"
  }'`,
    response: JSON.stringify({
      success: true,
      affected: 1,
      updated: [{
        id: "uuid",
        lead_id: "uuid",
        converted_at: "2026-05-12T10:00:00Z",
        tipo: "modal_pago",
        page_slug: "programadeiaficacao",
        session_id: "uuid-da-sessao"
      }]
    }, null, 2),
    notes: 'Retorna 404 se nenhuma conversão for encontrada. Um evento conversion_updated com os valores antigo e novo é registrado na timeline para auditoria.',
  },
  {
    id: 'contact-status-update',
    method: 'PATCH',
    path: '/contact-status-update',
    title: 'Atualizar status do contato',
    description: 'Atualiza o status do lead via dnia_id. Registra evento contact_updated e, quando status = "Lead Qualificado", dispara handoff para o Nexus CRM.',
    params: [
      { name: 'dnia_id', type: 'uuid (body)', required: 'Sim', description: 'Identificador único do contato' },
      { name: 'status', type: 'string (body)', required: 'Sim', description: 'Qualquer status válido (máx. 60 caracteres). Status não cadastrados são criados automaticamente sem duplicar (match case-insensitive). Padrões pré-cadastrados: Lead | Iniciado | Lead Qualificado | MQL - Reunião agendada | SQL - Em negociação | Em contrato | Venda realizada' },
    ],
    curl: `curl -X PATCH \\
  '${BASE_URL}/contact-status-update' \\
  -H 'Authorization: Bearer [WEBHOOK_SECRET]' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "dnia_id": "uuid-do-contato",
    "status": "Lead Qualificado"
  }'`,
    response: JSON.stringify({
      success: true,
      dnia_id: "uuid",
      lead_id: "uuid",
      status_anterior: "Lead",
      status_atual: "Lead Qualificado",
      status_created: false
    }, null, 2),
    notes: 'Status novos são auto-cadastrados (cor padrão #888780, sem duplicar — comparação case-insensitive). Quando o valor canônico for "Lead Qualificado", o contato é automaticamente avançado para stage "opportunity" no ecossistema e enviado ao Nexus. O campo status_created indica se um status novo foi criado nesta chamada.',
  },
  {
    id: 'contact-tags-sync',
    method: 'PUT / POST',
    path: '/contact-tags-sync',
    title: 'Sincronizar tags do contato (substituição total)',
    description: 'Espelha o conjunto completo de tags de um contato. Envie sempre TODAS as tags — o endpoint adiciona as novas, mantém as existentes e remove as que não vieram. Use tags: [] para limpar tudo. Tags inexistentes são criadas automaticamente. Aceita PUT (semântica padrão) ou POST (alias para clientes que não suportam PUT). Ideal para sincronização contínua a partir do Nexus.',
    params: [
      { name: 'dnia_id', type: 'uuid (body)', required: 'Um dos 3', description: 'Identificador único do contato (preferencial)' },
      { name: 'nexus_contact_id', type: 'uuid (body)', required: 'Um dos 3', description: 'ID do contato no Nexus CRM' },
      { name: 'email', type: 'string (body)', required: 'Um dos 3', description: 'Email do contato (fallback)' },
      { name: 'tags', type: 'string[] (body)', required: 'Sim', description: 'Lista completa de tags. Strings normalizadas (trim + lowercase). [] remove todas.' },
    ],
    curl: `# PUT (recomendado)
curl -X PUT \\
  '${BASE_URL}/contact-tags-sync' \\
  -H 'Authorization: Bearer [WEBHOOK_SECRET]' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "dnia_id": "uuid-do-contato",
    "tags": ["cliente-vip", "evento-maio", "interessado-formacao"]
  }'

# POST (alias — mesma semântica)
curl -X POST \\
  '${BASE_URL}/contact-tags-sync' \\
  -H 'Authorization: Bearer [WEBHOOK_SECRET]' \\
  -H 'Content-Type: application/json' \\
  -d '{ "dnia_id": "uuid-do-contato", "tags": [] }'`,
    response: JSON.stringify({
      success: true,
      dnia_id: "uuid",
      lead_id: "uuid",
      tags_final: ["cliente-vip", "evento-maio", "interessado-formacao"],
      added: ["evento-maio"],
      removed: ["antiga-tag"],
      kept: ["cliente-vip", "interessado-formacao"],
      created_tags: ["evento-maio"]
    }, null, 2),
    notes: 'Substituição total (PUT semântico, POST aceito como alias). Registra evento "tags_synced" na timeline com source_app=nexus. Para mutações parciais (adicionar OU remover tags individualmente), use /contact-update com tags_add / tags_remove.',
  },
  {
    title: 'Listar segmentos',
    description: 'Lista segmentos com contagem de contatos. POST para criar segmentos ou adicionar contatos.',
    params: [
      { name: 'id', type: 'uuid', required: 'Não', description: 'ID do segmento para detalhes' },
      { name: 'type', type: 'string', required: 'Não', description: 'dynamic ou static' },
      { name: 'page', type: 'number', required: 'Não', description: 'Página (default: 1)' },
      { name: 'limit', type: 'number', required: 'Não', description: 'Itens por página (default: 20)' },
    ],
    curl: `curl -X GET \\
  '${BASE_URL}/segments-api?type=dynamic&limit=10' \\
  -H 'Authorization: Bearer [WEBHOOK_SECRET]'`,
    response: JSON.stringify({
      data: [{
        id: "uuid",
        name: "Hotleads Janeiro",
        type: "dynamic",
        rules: [{ field: "etiqueta", operator: "is", value: "hotlead" }],
        contacts_count: 47,
        created_at: "2026-03-01T10:00:00Z"
      }],
      pagination: { page: 1, limit: 10, total: 5, pages: 1 }
    }, null, 2),
    notes: 'POST /segments-api para criar. POST ?action=add_contacts&id=uuid para adicionar contatos a segmentos estáticos.',
  },
  {
    id: 'campaigns-api',
    method: 'GET',
    path: '/campaigns-api',
    title: 'Listar campanhas',
    description: 'Lista campanhas com stats. POST para criar e disparar campanhas.',
    params: [
      { name: 'id', type: 'uuid', required: 'Não', description: 'ID da campanha para detalhes' },
      { name: 'status', type: 'string', required: 'Não', description: 'draft, sent, sending' },
      { name: 'channel', type: 'string', required: 'Não', description: 'email ou whatsapp' },
      { name: 'page', type: 'number', required: 'Não', description: 'Página (default: 1)' },
      { name: 'limit', type: 'number', required: 'Não', description: 'Itens por página (default: 20)' },
    ],
    curl: `curl -X GET \\
  '${BASE_URL}/campaigns-api?status=sent&channel=email' \\
  -H 'Authorization: Bearer [WEBHOOK_SECRET]'`,
    response: JSON.stringify({
      data: [{
        id: "uuid",
        name: "Email Janeiro",
        channel: "email",
        status: "sent",
        segment_name: "Hotleads",
        stats: { sent: 150, opened: 45, clicked: 12, failed: 3 },
        sent_at: "2026-03-15T14:00:00Z"
      }],
      pagination: { page: 1, limit: 20, total: 8, pages: 1 }
    }, null, 2),
    notes: 'POST /campaigns-api para criar. POST ?action=send&id=uuid para disparar uma campanha em draft.',
  },
  {
    id: 'pages-api',
    method: 'GET',
    path: '/pages-api',
    title: 'Listar páginas',
    description: 'Lista landing pages com métricas de leads. POST para criar, PATCH para atualizar config e UTMs.',
    params: [
      { name: 'slug', type: 'string', required: 'Não', description: 'Slug da página para detalhes' },
    ],
    curl: `curl -X GET \\
  '${BASE_URL}/pages-api' \\
  -H 'Authorization: Bearer [WEBHOOK_SECRET]'`,
    response: JSON.stringify({
      data: [{
        id: "uuid",
        slug: "programadeiaficacao",
        title: "Programa de IAficação",
        active: true,
        total_leads: 347,
        hot_leads: 89,
        last_lead_at: "2026-03-30T10:00:00Z"
      }]
    }, null, 2),
    notes: 'PATCH /pages-api?slug=xxx para atualizar config e UTM presets.',
  },
  {
    id: 'automations-api',
    method: 'GET',
    path: '/automations-api',
    title: 'Listar automações',
    description: 'Lista regras de automação. POST para criar, PATCH para ativar/desativar.',
    params: [],
    curl: `curl -X GET \\
  '${BASE_URL}/automations-api' \\
  -H 'Authorization: Bearer [WEBHOOK_SECRET]'`,
    response: JSON.stringify({
      data: [{
        id: "uuid",
        name: "Hotleads → Diagnóstico",
        is_active: true,
        priority: 10,
        condition: "etiqueta is hotlead",
        action: "create_in_nexus em Diagnóstico",
        condition_type: "etiqueta",
        condition_value: "hotlead",
        action_type: "create_in_nexus",
        action_metadata: { stage_name: "Diagnóstico" }
      }]
    }, null, 2),
    notes: 'PATCH /automations-api?id=uuid para ativar/desativar regras.',
  },
  {
    id: 'analytics-api',
    method: 'GET',
    path: '/analytics-api',
    title: 'KPIs e métricas',
    description: 'Retorna métricas agregadas. Tipos: overview, leads, sources, pages. Suporta filtro de período.',
    params: [
      { name: 'type', type: 'string', required: 'Sim', description: 'overview | leads | sources | pages' },
      { name: 'period', type: 'string', required: 'Não', description: '7d | 15d | 30d | 90d | all (default: 30d)' },
    ],
    curl: `curl -X GET \\
  '${BASE_URL}/analytics-api?type=overview' \\
  -H 'Authorization: Bearer [WEBHOOK_SECRET]'`,
    response: JSON.stringify({
      total_leads: 1247,
      hotleads: 89,
      warm_leads: 312,
      raw_leads: 846,
      leads_hoje: 12,
      leads_semana: 67,
      score_medio: 42,
      taxa_hotlead: "7.1%",
      leads_no_nexus: 45,
      clientes_ativos: 23
    }, null, 2),
    notes: 'Tipos disponíveis: overview (KPIs gerais), leads (evolução por dia), sources (por utm_source), pages (por página).',
  },
];

const ENV_VARS = [
  { name: 'WEBHOOK_SECRET', desc: 'Token de autenticação compartilhado com Nexus e mentor.ia' },
  { name: 'RESEND_API_KEY', desc: 'Chave Resend para envio de emails' },
  { name: 'EMAIL_FROM', desc: 'Remetente. Ex: DN.IA <noreply@dnia.ai>' },
  { name: 'ZAPI_INSTANCE_URL', desc: 'URL da instância Z-API (WhatsApp)' },
  { name: 'ZAPI_TOKEN', desc: 'Token Z-API' },
];

const RESPONSE_CODES = [
  { code: '200', desc: 'Sucesso', color: 'text-emerald-500' },
  { code: '400', desc: 'Dados inválidos', color: 'text-yellow-500' },
  { code: '401', desc: 'Token inválido ou ausente', color: 'text-red-500' },
  { code: '404', desc: 'Não encontrado', color: 'text-orange-500' },
  { code: '422', desc: 'Não foi possível processar', color: 'text-orange-500' },
  { code: '500', desc: 'Erro interno', color: 'text-red-500' },
];

const NAV_SECTIONS = [
  {
    title: 'Visão Geral',
    items: [
      { id: 'overview', label: 'Introdução' },
      { id: 'base-url', label: 'URL Base' },
      { id: 'auth', label: 'Autenticação' },
      { id: 'response-codes', label: 'Códigos de resposta' },
    ],
  },
  {
    title: 'Endpoints',
    items: ENDPOINTS.map(e => ({ id: e.id, label: `${e.method} /${e.id}` })),
  },
  {
    title: 'Guia de Integração',
    items: [
      { id: 'guide-nexus', label: 'Nexus — passo a passo' },
      { id: 'guide-mentoria', label: 'mentor.ia — passo a passo' },
    ],
  },
  {
    title: 'Configuração',
    items: [{ id: 'env-vars', label: 'Variáveis de Ambiente' }],
  },
];

const ALL_NAV_ITEMS = NAV_SECTIONS.flatMap(s => s.items);

/* ── Integration Step ── */
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 mb-6">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 text-primary font-bold text-sm flex items-center justify-center">{n}</div>
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-semibold mb-1">{title}</h4>
        <div className="text-xs text-muted-foreground space-y-2">{children}</div>
      </div>
    </div>
  );
}

export default function ApiDocumentation() {
  const [activeSection, setActiveSection] = useState('overview');
  const contentRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  const scrollToSection = (id: string) => {
    setActiveSection(id);
    const el = document.getElementById(`doc-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Track scroll position to update active nav
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const handleScroll = () => {
      const sections = ALL_NAV_ITEMS.map(i => document.getElementById(`doc-${i.id}`)).filter(Boolean) as HTMLElement[];
      for (let i = sections.length - 1; i >= 0; i--) {
        const rect = sections[i].getBoundingClientRect();
        if (rect.top <= 120) {
          setActiveSection(ALL_NAV_ITEMS[i].id);
          break;
        }
      }
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  const NavContent = () => (
    <nav className="space-y-4">
      {NAV_SECTIONS.map(section => (
        <div key={section.title}>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">{section.title}</p>
          <ul className="space-y-0.5">
            {section.items.map(item => (
              <li key={item.id}>
                <button
                  onClick={() => scrollToSection(item.id)}
                  className={`w-full text-left text-xs px-2.5 py-1.5 rounded-md transition-colors ${
                    activeSection === item.id
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex gap-6 h-[calc(100vh-12rem)]">
      {/* Sidebar — desktop only */}
      {!isMobile && (
        <div className="w-[200px] flex-shrink-0 overflow-y-auto pr-2 border-r border-border/30">
          <NavContent />
        </div>
      )}

      {/* Main content */}
      <div ref={contentRef} className="flex-1 overflow-y-auto pr-2 space-y-10 scroll-smooth">
        {/* Mobile nav */}
        {isMobile && (
          <Select value={activeSection} onValueChange={scrollToSection}>
            <SelectTrigger className="text-xs h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALL_NAV_ITEMS.map(item => (
                <SelectItem key={item.id} value={item.id} className="text-xs">{item.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* ═══ VISÃO GERAL ═══ */}
        <section id="doc-overview">
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <img src={dnMarketingLogo} alt="dnMarketing" className="h-14 w-auto" />
            <span className="text-lg font-bold">API</span>
            <Badge variant="outline" className="text-[10px]">v1.0</Badge>
            <Badge className="text-[10px] bg-primary/15 text-primary border-0">Interno</Badge>
            <div className="ml-auto flex gap-2">
              <a
                href="/api/docs/index.html"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="default" size="sm" className="gap-1.5 text-xs h-7">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Swagger UI
                </Button>
              </a>
              <a
                href="/api/dnmarketing-api.yaml"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline" size="sm" className="gap-1.5 text-xs h-7">
                  <ExternalLink className="h-3.5 w-3.5" />
                  OpenAPI YAML
                </Button>
              </a>
            </div>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            O dnMarketing é o master de identidade do ecossistema DN.IA. Esta API permite que o Nexus e o mentor.ia se integrem para buscar identidades, listar leads e registrar eventos na timeline unificada de cada contato.
          </p>
        </section>

        <section id="doc-base-url">
          <h3 className="text-sm font-semibold mb-2">URL Base</h3>
          <CodeBlock code={BASE_URL} />
        </section>

        <section id="doc-auth">
          <h3 className="text-sm font-semibold mb-2">Autenticação</h3>
          <p className="text-xs text-muted-foreground mb-3">
            A API do dnMarketing aceita dois tipos de chave de autenticação:
          </p>
          <CodeBlock code={`Authorization: Bearer <SUA_CHAVE>\nContent-Type: application/json`} />
          <div className="mt-3 space-y-3">
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
              <div className="flex items-center gap-2 mb-2">
                <KeyRound className="h-4 w-4 text-primary" />
                <span className="text-xs font-semibold">1. WEBHOOK_SECRET</span>
                <Badge variant="outline" className="text-[9px] h-4">Master</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Chave master configurada nos Secrets do backend (Lovable Cloud). Use para integrações de sistema de alta confiança.
              </p>
            </div>
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
              <div className="flex items-center gap-2 mb-2">
                <KeyRound className="h-4 w-4 text-emerald-500" />
                <span className="text-xs font-semibold">2. API Keys</span>
                <Badge variant="outline" className="text-[9px] h-4 bg-emerald-500/10 text-emerald-400 border-emerald-500/30">Recomendado</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Chaves individuais criadas em Settings → API Keys. Recomendado para agentes e projetos específicos. Cada chave tem permissões granulares e pode ser revogada independentemente.
              </p>
              <Button
                variant="link"
                size="sm"
                className="h-6 text-[11px] px-0 text-primary mt-1"
                onClick={() => {
                  // Navigate to API Keys tab
                  const tabTrigger = document.querySelector('[value="apikeys"]') as HTMLButtonElement;
                  tabTrigger?.click();
                }}
              >
                Gerenciar API Keys →
              </Button>
            </div>
          </div>
        </section>

        <section id="doc-response-codes">
          <h3 className="text-sm font-semibold mb-2">Códigos de resposta</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/40">
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Código</th>
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Descrição</th>
                </tr>
              </thead>
              <tbody>
                {RESPONSE_CODES.map(c => (
                  <tr key={c.code} className="border-b border-border/20">
                    <td className={`py-2 px-3 font-mono font-bold ${c.color}`}>{c.code}</td>
                    <td className="py-2 px-3 text-muted-foreground">{c.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ═══ ENDPOINTS ═══ */}
        {ENDPOINTS.map(ep => (
          <section key={ep.id} id={`doc-${ep.id}`} className="border border-border/30 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-1">
              <MethodBadge method={ep.method} />
              <code className="text-sm font-mono font-semibold">{ep.path}</code>
            </div>
            <p className="text-xs text-muted-foreground mb-4">{ep.description}</p>

            <Tabs defaultValue="params" className="w-full">
              <TabsList className="h-8 bg-muted/30">
                <TabsTrigger value="params" className="text-xs h-6">Parâmetros</TabsTrigger>
                <TabsTrigger value="example" className="text-xs h-6">Exemplo</TabsTrigger>
                <TabsTrigger value="response" className="text-xs h-6">Resposta</TabsTrigger>
              </TabsList>

              <TabsContent value="params" className="mt-3">
                <ParamTable params={ep.params} />
                {ep.extra}
              </TabsContent>

              <TabsContent value="example" className="mt-3">
                <CodeBlock code={ep.curl} />
              </TabsContent>

              <TabsContent value="response" className="mt-3">
                <CodeBlock code={ep.response} />
              </TabsContent>
            </Tabs>

            {ep.notes && (
              <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <ChevronRight className="h-3.5 w-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-blue-600 dark:text-blue-400">{ep.notes}</p>
              </div>
            )}
          </section>
        ))}

        {/* ═══ GUIA NEXUS ═══ */}
        <section id="doc-guide-nexus">
          <h3 className="text-base font-bold mb-4">Integrando o Nexus</h3>

          <Step n={1} title="Obter credenciais">
            <p>Solicite o WEBHOOK_SECRET e a URL base ao time do dnMarketing.</p>
          </Step>

          <Step n={2} title="Ao criar um contato no Nexus">
            <p className="mb-2">Envie os dados do contato para criar/vincular a identidade unificada:</p>
            <CodeBlock code={`POST /identity-upsert
{
  "phone": "+5511999999999",
  "email": "joao@empresa.com",
  "nome": "João Silva",
  "source_app": "nexus",
  "local_id": "[ID-NO-NEXUS]",
  "stage": "opportunity"
}`} />
            <p className="mt-2 text-[11px] text-primary font-medium">Guarde o dnia_id retornado. Use em todas as chamadas futuras.</p>
          </Step>

          <Step n={3} title="Registrar atividades">
            <p>Chame <code className="bg-muted/50 px-1 py-0.5 rounded font-mono">/receive-contact-event</code> para cada evento relevante: reunião agendada, proposta enviada, deal movido.</p>
          </Step>

          <Step n={4} title="Ao fechar um deal">
            <CodeBlock code={`POST /receive-contact-event
{
   "dnia_id": "[DNIA_ID]",
  "source_app": "nexus",
  "event_type": "deal_won",
  "title": "Negócio fechado",
  "metadata": { "value": 15000 }
}`} />
            <p className="mt-2 text-[11px] text-primary font-medium">O stage avança para "client" automaticamente.</p>
          </Step>
        </section>

        {/* ═══ GUIA MENTORIA ═══ */}
        <section id="doc-guide-mentoria">
          <h3 className="text-base font-bold mb-4">Integrando o mentor.ia</h3>

          <Step n={1} title="Obter credenciais">
            <p>Solicite o WEBHOOK_SECRET e a URL base ao time do dnMarketing.</p>
          </Step>

          <Step n={2} title="Ao receber um cliente fechado">
            <CodeBlock code={`POST /identity-upsert
{
  "phone": "+5511999999999",
  "source_app": "mentoria",
  "local_id": "[ID-NO-MENTORIA]",
  "stage": "client"
}`} />
          </Step>

          <Step n={3} title="Ao iniciar onboarding">
            <CodeBlock code={`POST /receive-contact-event
{
   "dnia_id": "[DNIA_ID]",
  "source_app": "mentoria",
  "event_type": "onboarding_started",
  "title": "Onboarding iniciado"
}`} />
          </Step>

          <Step n={4} title="Atualizações periódicas de health score">
            <CodeBlock code={`POST /receive-contact-event
{
  "dnia_id": "[DNIA_ID]",
  "source_app": "mentoria",
  "event_type": "health_updated",
  "title": "Health score atualizado",
  "metadata": { "score": 85, "status": "saudavel" }
}`} />
          </Step>
        </section>

        {/* ═══ VARIÁVEIS DE AMBIENTE ═══ */}
        <section id="doc-env-vars">
          <h3 className="text-sm font-semibold mb-3">Variáveis de Ambiente</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/40">
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Variável</th>
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Descrição</th>
                </tr>
              </thead>
              <tbody>
                {ENV_VARS.map(v => (
                  <tr key={v.name} className="border-b border-border/20">
                    <td className="py-2 px-3 font-mono text-primary text-[11px]">{v.name}</td>
                    <td className="py-2 px-3 text-muted-foreground">{v.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">
            Configurar em: <strong>Backend → Settings → Edge Functions → Secrets</strong>
          </p>
        </section>

        {/* Bottom padding */}
        <div className="h-16" />
      </div>
    </div>
  );
}
