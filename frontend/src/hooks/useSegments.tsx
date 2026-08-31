import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface SegmentRule {
  field: string;
  operator: string;
  value: string;
}

export interface Segment {
  id: string;
  name: string;
  description: string | null;
  type: 'static' | 'dynamic';
  rules: SegmentRule[];
  logic: 'and' | 'or';
  created_at: string;
  updated_at: string;
  contactCount?: number;
}

export function useSegments() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const fetchSegments = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('segments')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      toast.error('Erro ao carregar segmentos');
      setLoading(false);
      return;
    }

    const parsed: Segment[] = (data || []).map((s: any) => ({
      ...s,
      rules: Array.isArray(s.rules) ? s.rules : JSON.parse(s.rules || '[]'),
      // types.ts ainda não conhece a coluna `logic` (Fase 5) — default 'and'
      // preserva o comportamento de segmentos criados antes desta migration.
      logic: s.logic === 'or' ? 'or' : 'and',
    }));
    setSegments(parsed);

    // Fetch counts for each segment
    const countsMap: Record<string, number> = {};
    for (const seg of parsed) {
      if (seg.type === 'dynamic') {
        const { data: rpcData } = await supabase.rpc('evaluate_segment_rules', { p_segment_id: seg.id });
        countsMap[seg.id] = rpcData?.length || 0;
      } else {
        const { count } = await supabase
          .from('segment_contacts')
          .select('lead_id', { count: 'exact', head: true })
          .eq('segment_id', seg.id);
        countsMap[seg.id] = count || 0;
      }
    }
    setCounts(countsMap);
    setLoading(false);
  }, []);

  useEffect(() => { fetchSegments(); }, [fetchSegments]);

  const createSegment = async (
    name: string,
    description: string,
    type: 'static' | 'dynamic',
    rules: SegmentRule[],
    staticLeadIds: string[],
    logic: 'and' | 'or' = 'and'
  ) => {
    const { data, error } = await supabase
      .from('segments')
      // `logic` (Fase 5) ainda não está em types.ts — cast sancionado.
      .insert({ name, description: description || null, type, rules: rules as any, logic } as any)
      .select()
      .single();

    if (error || !data) {
      toast.error('Erro ao criar segmento');
      return null;
    }

    if (type === 'static' && staticLeadIds.length > 0) {
      const rows = staticLeadIds.map(lid => ({
        segment_id: (data as any).id,
        lead_id: lid,
      }));
      for (let i = 0; i < rows.length; i += 100) {
        await supabase.from('segment_contacts').insert(rows.slice(i, i + 100) as any);
      }
    }

    const count = type === 'static' ? staticLeadIds.length : 0;
    toast.success(`Segmento criado com ${count > 0 ? count + ' contatos' : 'sucesso'}`);
    fetchSegments();
    return data;
  };

  const updateSegment = async (
    id: string,
    name: string,
    description: string,
    type: 'static' | 'dynamic',
    rules: SegmentRule[],
    staticLeadIds?: string[],
    logic: 'and' | 'or' = 'and'
  ) => {
    const { error } = await supabase
      .from('segments')
      // `logic` (Fase 5) ainda não está em types.ts — cast sancionado.
      .update({ name, description: description || null, type, rules: rules as any, logic, updated_at: new Date().toISOString() } as any)
      .eq('id', id);

    if (error) {
      toast.error('Erro ao atualizar segmento');
      return false;
    }

    if (type === 'static' && staticLeadIds) {
      await supabase.from('segment_contacts').delete().eq('segment_id', id);
      const rows = staticLeadIds.map(lid => ({ segment_id: id, lead_id: lid }));
      for (let i = 0; i < rows.length; i += 100) {
        await supabase.from('segment_contacts').insert(rows.slice(i, i + 100) as any);
      }
    }

    toast.success('Segmento atualizado');
    fetchSegments();
    return true;
  };

  const duplicateSegment = async (segment: Segment) => {
    await createSegment(
      segment.name + ' (cópia)',
      segment.description || '',
      segment.type,
      segment.rules,
      [],
      segment.logic
    );
  };

  const deleteSegment = async (id: string) => {
    const { error } = await supabase.from('segments').delete().eq('id', id);
    if (error) {
      // A guarda do banco (guard_segment_delete) recusa apagar um segmento usado
      // por campanha não enviada ou fluxo ativo, e a mensagem dela já nomeia quem
      // está usando -- é a única informação acionável que o admin recebe.
      toast.error(error.message || 'Erro ao excluir segmento');
      return;
    }
    toast.success('Segmento excluído');
    fetchSegments();
  };

  const getSegmentContacts = async (segmentId: string, segmentType: string) => {
    if (segmentType === 'dynamic') {
      const { data } = await supabase.rpc('evaluate_segment_rules', { p_segment_id: segmentId });
      if (!data || data.length === 0) return [];
      const ids = data.map((r: any) => r.lead_id);
      const allLeads: any[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const batch = ids.slice(i, i + 200);
        const { data: leads } = await supabase.from('leads').select('*').in('id', batch);
        if (leads) allLeads.push(...leads);
      }
      return allLeads;
    } else {
      const { data } = await supabase
        .from('segment_contacts')
        .select('lead_id, leads(*)')
        .eq('segment_id', segmentId);
      return (data || []).map((r: any) => r.leads).filter(Boolean);
    }
  };

  const addLeadsToSegment = async (segmentId: string, leadIds: string[], segmentName: string) => {
    const rows = leadIds.map(lid => ({ segment_id: segmentId, lead_id: lid }));
    for (let i = 0; i < rows.length; i += 100) {
      await supabase.from('segment_contacts').upsert(rows.slice(i, i + 100) as any, { onConflict: 'segment_id,lead_id' });
    }
    toast.success(`${leadIds.length} contatos adicionados ao segmento "${segmentName}"`);
    fetchSegments();
  };

  return {
    segments,
    counts,
    loading,
    refetch: fetchSegments,
    createSegment,
    updateSegment,
    duplicateSegment,
    deleteSegment,
    getSegmentContacts,
    addLeadsToSegment,
  };
}
