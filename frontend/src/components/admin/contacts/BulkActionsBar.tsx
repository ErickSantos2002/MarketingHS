import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { X, ChevronDown, Download, Tag, Filter, GitMerge } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { STATUS_OPTIONS, STATUS_COLORS } from './StatusBadge';
import type { TagInfo, EnrichedLead } from '@/hooks/useContactsEnriched';
import { getTagColor } from './TagsCell';

// I3 (achado do review final): reatribui campaign_sends do lead descartado para
// o lead mantido, respeitando o indice unico parcial
// uniq_campaign_sends_email_campaign_lead (campaign_id, lead_id) WHERE
// channel='email' (migration 20260713210000). Um UPDATE em bloco sem esse
// cuidado falha por inteiro com 23505 sempre que os dois leads receberam a
// MESMA campanha de email -- exatamente o caso comum de leads quase-duplicados
// sendo mesclados -- e NENHUMA linha do lead descartado e movida. Como o passo
// seguinte apaga o lead descartado e campaign_sends.lead_id e ON DELETE SET
// NULL, isso orfanizaria em silencio todo o historico de email dele para sempre.
// Mesma logica de src/components/admin/contacts/ContactsBulkBar.tsx -- ver la
// se este arquivo for eventualmente removido (ambos renderizam a mesma barra
// de acoes em massa; ContactsBulkBar e o usado em Contacts.tsx, este e o usado
// em LeadsTable.tsx).
// Le todas as linhas de campaign_sends de um lead, paginando em blocos de
// 1000 (achado do review final): sem .range(), o PostgREST aplica o limite
// padrao de 1000 linhas e o restante e devolvido como se nao existisse. Para
// um lead com mais de 1000 envios isso deixava as linhas alem do limite
// FORA de discardSends/keepSends -- elas nunca eram reatribuidas nem
// contadas em existingKeys, e o delete do lead descartado (ON DELETE SET
// NULL em campaign_sends.lead_id) as orfanizava para sempre. Segue a mesma
// convencao de paginacao ja usada em useAgendamentos/useContactsEnriched.
//
// O .order('id') NAO e cosmetico: sem ORDER BY, o Postgres nao garante ordem
// estavel entre as paginas do .range() (mesma razao documentada em
// send-campaign/index.ts:225). Uma linha podia entao aparecer em DUAS paginas:
// a primeira ocorrencia era movida para o lead mantido e sua chave entrava em
// existingKeys; a segunda ocorrencia batia nessa chave e o codigo APAGAVA a
// linha que acabara de mover. E uma linha omitida por essa mesma instabilidade
// ficaria orfa no delete do lead descartado -- exatamente o defeito que esta
// paginacao existe para evitar.
async function fetchAllCampaignSends(leadId: string, columns: string): Promise<any[]> {
  const rows: any[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('campaign_sends')
      .select(columns)
      .eq('lead_id', leadId)
      .order('id')
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

async function reassignCampaignSends(keepId: string, discardId: string): Promise<void> {
  let discardSends: any[];
  try {
    discardSends = await fetchAllCampaignSends(discardId, 'id, campaign_id, channel');
  } catch (readDiscardErr: any) {
    throw new Error(`Falha ao ler envios do contato descartado: ${readDiscardErr.message}`);
  }
  if (!discardSends || discardSends.length === 0) return;

  let keepSends: any[];
  try {
    keepSends = await fetchAllCampaignSends(keepId, 'campaign_id, channel');
  } catch (readKeepErr: any) {
    throw new Error(`Falha ao ler envios do contato mantido: ${readKeepErr.message}`);
  }

  const existingKeys = new Set((keepSends ?? []).map((s) => `${s.campaign_id}:${s.channel}`));
  const failures: string[] = [];

  // Uma linha por vez, de proposito: um conflito num unico envio nunca pode
  // abortar os demais (o que aconteceria com um UPDATE em bloco).
  for (const send of discardSends) {
    const key = `${send.campaign_id}:${send.channel}`;
    // Correcao (achado do review final): o indice unico
    // uniq_campaign_sends_email_campaign_lead e PARCIAL -- so cobre
    // `WHERE channel='email' AND lead_id IS NOT NULL`. Linhas de WhatsApp
    // NAO tem nenhuma restricao de unicidade, entao um UPDATE simples
    // sempre teria sucesso e preservaria as duas linhas. Forcar o DELETE
    // aqui (como fazia o codigo antigo, independente do canal) apagava sem
    // necessidade o historico de envio de WhatsApp do lead descartado
    // sempre que os dois leads mesclados estavam na mesma campanha --
    // o caso comum ao mesclar quase-duplicados.
    if (existingKeys.has(key) && send.channel === 'email') {
      // O lead mantido ja tem uma linha para essa (campanha, canal='email'):
      // mover colidiria com o indice unico parcial. A linha do descartado e
      // redundante (o envio ja esta contabilizado no lead mantido) -- remove
      // em vez de deixar orfa.
      const { error: delErr } = await supabase.from('campaign_sends').delete().eq('id', send.id);
      if (delErr) failures.push(`envio ${send.id}: ${delErr.message}`);
      continue;
    }
    const { error: moveErr } = await supabase
      .from('campaign_sends')
      .update({ lead_id: keepId } as any)
      .eq('id', send.id);
    if (moveErr) {
      if ((moveErr as any).code === '23505') {
        // Corrida rara: outra linha ganhou essa chave entre a leitura e o UPDATE.
        // Mesmo tratamento do caso acima -- remove como redundante.
        const { error: delErr } = await supabase.from('campaign_sends').delete().eq('id', send.id);
        if (delErr) failures.push(`envio ${send.id}: ${delErr.message}`);
      } else {
        failures.push(`envio ${send.id}: ${moveErr.message}`);
      }
      continue;
    }
    existingKeys.add(key);
  }

  if (failures.length > 0) {
    throw new Error(`Falha ao reatribuir ${failures.length} envio(s) de campanha: ${failures.join('; ')}`);
  }
}

// Tabelas de juncao com PK COMPOSTA em (lead_id, <outra coluna>):
//   lead_tags        PRIMARY KEY (lead_id, tag_id)      -- migration 20260330003249:242
//   segment_contacts PRIMARY KEY (segment_id, lead_id)  -- migration 20260330011028:16
// Exatamente a mesma classe de defeito do campaign_sends acima: um
// `UPDATE ... SET lead_id = keep WHERE lead_id = discard` em bloco viola a PK
// assim que os dois leads compartilham UMA tag (ou UM segmento) -- o caso
// dominante ao mesclar leads quase-duplicados. Em Postgres o UPDATE e
// tudo-ou-nada: o 23505 derruba o statement inteiro e NENHUMA linha se move.
// Como as duas tabelas tem FK ON DELETE CASCADE, o delete do lead descartado
// logo em seguida DESTROI as tags/segmentos dele -- perda de dados silenciosa
// (o codigo antigo nem checava o erro).
type JunctionSpec =
  | { table: 'lead_tags'; otherKey: 'tag_id'; label: string }
  | { table: 'segment_contacts'; otherKey: 'segment_id'; label: string };

async function reassignJunction(
  spec: JunctionSpec,
  keepId: string,
  discardId: string,
): Promise<void> {
  const { table, otherKey, label } = spec;

  const { data: discardRows, error: readDiscardErr } = await (supabase.from(table) as any)
    .select(otherKey)
    .eq('lead_id', discardId);
  if (readDiscardErr) {
    throw new Error(`Falha ao ler ${label} do contato descartado: ${readDiscardErr.message}`);
  }
  if (!discardRows || discardRows.length === 0) return;

  const { data: keepRows, error: readKeepErr } = await (supabase.from(table) as any)
    .select(otherKey)
    .eq('lead_id', keepId);
  if (readKeepErr) {
    throw new Error(`Falha ao ler ${label} do contato mantido: ${readKeepErr.message}`);
  }

  const existing = new Set<string>((keepRows ?? []).map((r: any) => String(r[otherKey])));
  const failures: string[] = [];

  // Uma linha por vez: um conflito numa unica tag/segmento nunca pode abortar
  // os demais. Sem coluna `id` nestas tabelas -- a linha e endereçada pela
  // propria PK composta (lead_id + otherKey).
  for (const row of discardRows as any[]) {
    const key = String(row[otherKey]);

    // O lead mantido ja tem essa tag/segmento: mover colidiria com a PK. A
    // linha do descartado e redundante (a associacao ja existe no mantido) --
    // remove em vez de deixar o CASCADE destrui-la junto com o lead.
    const dropRedundant = async () => {
      const { error: delErr } = await (supabase.from(table) as any)
        .delete()
        .eq('lead_id', discardId)
        .eq(otherKey, key);
      if (delErr) failures.push(`${key}: ${delErr.message}`);
    };

    if (existing.has(key)) {
      await dropRedundant();
      continue;
    }

    const { error: moveErr } = await (supabase.from(table) as any)
      .update({ lead_id: keepId })
      .eq('lead_id', discardId)
      .eq(otherKey, key);
    if (moveErr) {
      // Corrida rara: a chave passou a existir no mantido entre a leitura e o
      // UPDATE. Mesmo tratamento -- remove como redundante.
      if ((moveErr as any).code === '23505') await dropRedundant();
      else failures.push(`${key}: ${moveErr.message}`);
      continue;
    }
    existing.add(key);
  }

  if (failures.length > 0) {
    throw new Error(`Falha ao reatribuir ${failures.length} ${label}: ${failures.join('; ')}`);
  }
}

// Tabelas SEM unique/PK envolvendo lead_id (PK = id proprio): lead_notes,
// contact_events e lead_conversions. Aqui o UPDATE em bloco NAO pode colidir --
// nada impede duas linhas com o mesmo lead_id -- entao a reatribuicao continua
// sendo um unico statement. O que faltava era so a CHECAGEM DE ERRO: o codigo
// antigo descartava o resultado, entao uma falha (RLS, rede, timeout) passava
// despercebida e o lead era apagado em seguida do mesmo jeito.
type BulkReassignTable = 'lead_notes' | 'contact_events' | 'lead_conversions';

async function bulkReassign(
  table: BulkReassignTable,
  label: string,
  keepId: string,
  discardId: string,
): Promise<void> {
  const { error: err } = await (supabase.from(table) as any)
    .update({ lead_id: keepId })
    .eq('lead_id', discardId);
  if (err) throw new Error(`Falha ao reatribuir ${label}: ${err.message}`);
}

interface BulkActionsBarProps {
  selectedLeads: EnrichedLead[];
  allTags: TagInfo[];
  onClear: () => void;
  onComplete: () => void;
}

export function BulkActionsBar({ selectedLeads, allTags, onClear, onComplete }: BulkActionsBarProps) {
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const [merging, setMerging] = useState(false);
  const [staticSegments, setStaticSegments] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    supabase
      .from('segments')
      .select('id, name')
      .eq('type', 'static')
      .order('name')
      .then(({ data }) => { if (data) setStaticSegments(data); });
  }, []);

  if (selectedLeads.length === 0) return null;

  const handleBulkStatus = async (newStatus: string) => {
    setUpdatingStatus(true);
    const ids = selectedLeads.map(l => l.id);
    
    // Batch update in chunks of 100
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      await supabase
        .from('leads')
        .update({ status: newStatus } as any)
        .in('id', batch);
    }
    
    if (newStatus === 'Lead Qualificado') {
      toast.success(`${ids.length} leads qualificados — prontos para o Nexus`, {
        icon: '➡️',
        style: { borderLeft: '4px solid #3B6D11' },
      });
    } else {
      toast.success(`${ids.length} contatos atualizados para "${newStatus}"`);
    }

    // Fire-and-forget: evaluate automations for each lead
    import('@/lib/automationEngine').then(async ({ evaluateAndExecute }) => {
      for (const lead of selectedLeads) {
        try {
          const { data: freshLead } = await supabase.from('leads').select('id, status, etiqueta, lead_score, dnia_id').eq('id', lead.id).single();
          if (freshLead) await evaluateAndExecute(freshLead);
        } catch {}
      }
    }).catch(() => {});

    setUpdatingStatus(false);
    onComplete();
  };

  const handleBulkTag = async (tagId: string, tagName: string) => {
    setAddingTag(true);
    const rows = selectedLeads.map(l => ({ lead_id: l.id, tag_id: tagId }));
    
    // Insert in chunks, ignore conflicts
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      await supabase
        .from('lead_tags')
        .upsert(batch, { onConflict: 'lead_id,tag_id' });
    }
    
    toast.success(`Tag "${tagName}" aplicada a ${selectedLeads.length} contatos`);
    setAddingTag(false);
    onComplete();
  };

  const handleExport = () => {
    const headers = [
      'Data', 'Tipo', 'Status', 'Nome', 'Email', 'WhatsApp', 'Empresa',
      'Cargo', 'Faturamento', 'UTM Source', 'UTM Medium', 'UTM Campaign',
    ];
    const rows = selectedLeads.map(lead => [
      new Date(lead.created_at).toLocaleString('pt-BR'),
      lead.tipo,
      lead.status || 'Lead',
      lead.nome || '',
      lead.email || '',
      lead.whatsapp || '',
      lead.empresa || '',
      lead.cargo || '',
      lead.faturamento || '',
      lead.utm_source || '',
      lead.utm_medium || '',
      lead.utm_campaign || '',
    ]);

    const csvContent = [
      headers.join(';'),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(';')),
    ].join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `leads_selecionados_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast.success(`${selectedLeads.length} contatos exportados`);
  };

  return (
    <div className="sticky bottom-0 z-30 bg-card border-t shadow-[0_-4px_12px_rgba(0,0,0,0.1)] p-3 flex items-center justify-between gap-3 overflow-x-auto">
      <span className="text-sm font-medium whitespace-nowrap">
        {selectedLeads.length} contato{selectedLeads.length > 1 ? 's' : ''} selecionado{selectedLeads.length > 1 ? 's' : ''}
      </span>

      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Bulk status change */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" disabled={updatingStatus} className="gap-1.5">
              Alterar status <ChevronDown className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-1" align="end">
            {STATUS_OPTIONS.map(s => (
              <button
                key={s}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted rounded-sm text-left"
                onClick={() => handleBulkStatus(s)}
              >
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[s] }} />
                {s}
              </button>
            ))}
          </PopoverContent>
        </Popover>

        {/* Bulk add tag */}
        {allTags.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" disabled={addingTag} className="gap-1.5">
                <Tag className="h-3 w-3" />
                Adicionar tag <ChevronDown className="h-3 w-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-1" align="end">
              {allTags.map(tag => (
                <button
                  key={tag.id}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted rounded-sm text-left"
                  onClick={() => handleBulkTag(tag.id, tag.name)}
                >
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getTagColor(tag.color) }} />
                  {tag.name}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        )}

        {/* Add to segment */}
        {staticSegments.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Filter className="h-3 w-3" />
                Adicionar a segmento <ChevronDown className="h-3 w-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-1" align="end">
              {staticSegments.map(seg => (
                <button
                  key={seg.id}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted rounded-sm text-left"
                  onClick={async () => {
                    const rows = selectedLeads.map(l => ({ segment_id: seg.id, lead_id: l.id }));
                    for (let i = 0; i < rows.length; i += 100) {
                      await supabase.from('segment_contacts').upsert(rows.slice(i, i + 100) as any, { onConflict: 'segment_id,lead_id' });
                    }
                    toast.success(`${selectedLeads.length} contatos adicionados ao segmento "${seg.name}"`);
                    onComplete();
                  }}
                >
                  {seg.name}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        )}

        {/* Merge contacts */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={selectedLeads.length !== 2 || merging}
                   onClick={async () => {
                    const sorted = [...selectedLeads].sort(
                      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
                    );
                    const keep = sorted[0];
                    const discard = sorted[1];

                    if (!window.confirm('Mesclar contatos? O mais antigo será mantido e o mais recente descartado.')) return;

                    setMerging(true);
                    try {
                      const sameDniaId = keep.dnia_id && discard.dnia_id && keep.dnia_id === discard.dnia_id;
                      const bothNoDnia = !keep.dnia_id && !discard.dnia_id;

                      if (sameDniaId || bothNoDnia) {
                        // Same identity or no dnia_id — merge lead records directly.
                        // Juncoes com PK composta em lead_id: reatribuicao tolerante a conflito.
                        await reassignJunction({ table: 'lead_tags', otherKey: 'tag_id', label: 'tag(s)' }, keep.id, discard.id);
                        await reassignJunction({ table: 'segment_contacts', otherKey: 'segment_id', label: 'segmento(s)' }, keep.id, discard.id);
                        await reassignCampaignSends(keep.id, discard.id);

                        // Sem unique em lead_id: UPDATE em bloco e seguro, so precisa checar o erro.
                        await bulkReassign('lead_notes', 'notas', keep.id, discard.id);
                        await bulkReassign('contact_events', 'eventos', keep.id, discard.id);
                        await bulkReassign('lead_conversions', 'conversões', keep.id, discard.id);

                        // Fill blank fields on keep from discard
                        const fillFields: Record<string, string | null> = {};
                        const fieldsToMerge = ['email', 'whatsapp', 'cargo', 'empresa', 'faturamento', 'funcionarios', 'desafios', 'dnia_id'] as const;
                        for (const f of fieldsToMerge) {
                          if (!keep[f] && discard[f]) {
                            fillFields[f] = discard[f] as string;
                          }
                        }

                        // ORDEM IMPORTA (mesma classe de defeito): `leads` tem
                        // `leads_email_unique UNIQUE (email)` (migration 20260317150419).
                        // Copiar o email do descartado para o mantido ENQUANTO o descartado
                        // ainda existe viola essa constraint com 23505 -- era exatamente o
                        // que o codigo antigo fazia, sem checar o erro: o preenchimento
                        // falhava em silencio e o email era destruido junto com o lead
                        // descartado no delete seguinte. Apagamos o descartado PRIMEIRO
                        // (liberando o email) e so entao preenchemos o mantido. Seguro nesta
                        // ordem: tudo que o CASCADE poderia levar junto ja foi reatribuido.
                        const { error: delErr } = await supabase.from('leads').delete().eq('id', discard.id);
                        if (delErr) throw new Error(`Falha ao apagar o contato descartado: ${delErr.message}`);

                        if (Object.keys(fillFields).length > 0) {
                          const { error: fillErr } = await supabase.from('leads').update(fillFields as any).eq('id', keep.id);
                          if (fillErr) throw new Error(`Falha ao preencher os campos do contato mantido: ${fillErr.message}`);
                        }
                        toast.success('Leads mesclados com sucesso');
                      } else if (keep.dnia_id && discard.dnia_id) {
                        // Different dnia_ids — merge ecosystem identities
                        const { error: mergeErr } = await supabase.functions.invoke('merge-identities', {
                          body: { keep_id: keep.dnia_id, discard_id: discard.dnia_id },
                        });
                        if (mergeErr) throw new Error(mergeErr.message);
                        toast.success('Identidades mescladas com sucesso');
                      } else {
                        // One has dnia_id, other doesn't — assign same dnia_id.
                        // `leads.dnia_id` NAO tem unique (auditado): este UPDATE nao pode
                        // colidir. Faltava apenas a checagem de erro.
                        const dniaId = keep.dnia_id || discard.dnia_id;
                        const target = !keep.dnia_id ? keep : discard;
                        const { error: linkErr } = await supabase.from('leads').update({ dnia_id: dniaId } as any).eq('id', target.id);
                        if (linkErr) throw new Error(`Falha ao vincular o dnia_id: ${linkErr.message}`);
                        toast.success('Contatos vinculados ao mesmo dnia_id');
                      }
                      onComplete();
                    } catch (err: any) {
                      toast.error(`Erro ao mesclar: ${err.message || 'Erro desconhecido'}`);
                    }
                    setMerging(false);
                  }}
                  className="gap-1.5"
                >
                  <GitMerge className="h-3 w-3" />
                  Mesclar
                </Button>
              </span>
            </TooltipTrigger>
            {selectedLeads.length !== 2 && (
              <TooltipContent>Selecione exatamente 2 contatos para mesclar</TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>

        <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5">
          <Download className="h-3 w-3" />
          Exportar
        </Button>

        <Button variant="ghost" size="sm" onClick={onClear} className="gap-1.5">
          <X className="h-3 w-3" />
          Cancelar
        </Button>
      </div>
    </div>
  );
}
