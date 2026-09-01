import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
  adicionarContatos,
  contatosDoSegmento,
  criarSegmento,
  duplicarSegmento,
  editarSegmento,
  excluirSegmento,
  listarSegmentos,
  type Segment,
  type SegmentRule,
} from '@/lib/segmentos';

export type { Segment, SegmentRule };

export function useSegments() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Record<string, number>>({});

  // A contagem vem dentro da própria lista: o servidor resolve estático e
  // dinâmico numa consulta só. Antes eram N+1 idas ao banco — dez segmentos,
  // onze consultas. `counts` continua existindo porque cinco telas o
  // consomem; o que mudou é de onde ele sai.
  const fetchSegments = useCallback(async () => {
    setLoading(true);
    try {
      const lista = await listarSegmentos();
      setSegments(lista);
      setCounts(Object.fromEntries(lista.map(s => [s.id, s.contactCount ?? 0])));
    } catch {
      toast.error('Erro ao carregar segmentos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSegments(); }, [fetchSegments]);

  // ⚠️ As mutações NÃO recarregam a lista sozinhas. Quem as chama de dentro do
  // modal usa uma instância própria do hook, cuja lista ninguém mostra: o
  // recarregamento interno era trabalho jogado fora, e somado ao `onSaved` da
  // página virava duas buscas seguidas a cada gravação. Quem precisa da lista
  // atualizada chama `refetch`.
  const createSegment = async (
    name: string,
    description: string,
    type: 'static' | 'dynamic',
    rules: SegmentRule[],
    staticLeadIds: string[],
    logic: 'and' | 'or' = 'and',
  ) => {
    try {
      const { id } = await criarSegmento({
        nome: name,
        descricao: description || null,
        tipo: type,
        regras: rules,
        logica: logic,
        lead_ids: type === 'static' ? staticLeadIds : null,
      });
      const n = type === 'static' ? staticLeadIds.length : 0;
      toast.success(`Segmento criado com ${n > 0 ? n + ' contatos' : 'sucesso'}`);
      return { id };
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao criar segmento');
      return null;
    }
  };

  const updateSegment = async (
    id: string,
    name: string,
    description: string,
    type: 'static' | 'dynamic',
    rules: SegmentRule[],
    staticLeadIds?: string[],
    logic: 'and' | 'or' = 'and',
  ) => {
    try {
      await editarSegmento(id, {
        nome: name,
        descricao: description || null,
        tipo: type,
        regras: rules,
        logica: logic,
        // undefined preserva os membros; lista vazia esvazia de propósito.
        lead_ids: type === 'static' ? (staticLeadIds ?? null) : null,
      });
      toast.success('Segmento atualizado');
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao atualizar segmento');
      return false;
    }
  };

  const duplicateSegment = async (segment: Segment) => {
    try {
      await duplicarSegmento(segment.id);
      toast.success('Segmento duplicado');
      await fetchSegments();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao duplicar segmento');
    }
  };

  const deleteSegment = async (id: string) => {
    try {
      await excluirSegmento(id);
      toast.success('Segmento excluído');
      await fetchSegments();
    } catch (e) {
      // A guarda do banco (guard_segment_delete) recusa apagar um segmento usado
      // por campanha não enviada ou fluxo ativo, e a mensagem dela já nomeia quem
      // está usando -- é a única informação acionável que o admin recebe. O
      // backend a devolve como 409, e a ErroApi traz o texto inteiro.
      toast.error(e instanceof Error ? e.message : 'Erro ao excluir segmento');
    }
  };

  // A assinatura mantém `segmentType` porque cinco chamadas a passam; hoje o
  // servidor resolve o tipo sozinho e o parâmetro não é mais usado.
  const getSegmentContacts = async (segmentId: string, _segmentType?: string) => {
    try {
      return await contatosDoSegmento(segmentId);
    } catch {
      toast.error('Erro ao carregar contatos do segmento');
      return [];
    }
  };

  const addLeadsToSegment = async (
    segmentId: string, leadIds: string[], segmentName: string,
  ) => {
    try {
      await adicionarContatos(segmentId, leadIds);
      toast.success(`${leadIds.length} contatos adicionados ao segmento "${segmentName}"`);
      await fetchSegments();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao adicionar contatos');
    }
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
