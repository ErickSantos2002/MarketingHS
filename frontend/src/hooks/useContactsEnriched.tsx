import { useState, useEffect, useCallback, useMemo } from 'react';
import { enriquecerContatos, tagsPorContato, listarTags } from '@/lib/leitura';
import type { Lead } from '@/hooks/useLeads';

export interface EcosystemInfo {
  nexus_contact_id: string | null;
  mentoria_client_id: string | null;
  growthhs_card_id: number | null;
  growthhs_card_url: string | null;
  hasNexusEvents?: boolean;
  hasMentoriaEvents?: boolean;
  hasScheduledMeeting?: boolean;
}

export interface TagInfo {
  id: string;
  name: string;
  color: string;
}

export interface EnrichedLead extends Lead {
  dnia_id: string | null;
  phone_normalized: string | null;
  status: string | null;
  ecosystem?: EcosystemInfo;
  tags?: TagInfo[];
}

export interface ContactsFilters {
  statuses: string[];
  tagIds: string[];
  hasNexus: boolean;
  hasMentoria: boolean;
  hasScheduled: boolean;
}

export function useContactsEnriched(leads: Lead[]) {
  const [ecosystemMap, setEcosystemMap] = useState<Record<string, EcosystemInfo>>({});
  const [tagsMap, setTagsMap] = useState<Record<string, TagInfo[]>>({});
  const [allTags, setAllTags] = useState<TagInfo[]>([]);
  const [contactsFilters, setContactsFilters] = useState<ContactsFilters>({
    statuses: [],
    tagIds: [],
    hasNexus: false,
    hasMentoria: false,
    hasScheduled: false,
  });

  // O mapa de ecossistema vem pronto do servidor. A regra de "agendamento em
  // aberto" — que casa activity_created de meeting/demo com os eventos de
  // fechamento pelo activity_id — foi para SQL: era o único pedaço de lógica de
  // negócio que morava no navegador aqui.
  const fetchEcosystem = useCallback(async () => {
    const dniaIds = [...new Set(
      leads.map((l) => (l as unknown as { dnia_id?: string }).dnia_id).filter(Boolean) as string[],
    )];
    if (dniaIds.length === 0) { setEcosystemMap({}); return; }

    try {
      const sinais = await enriquecerContatos(dniaIds);
      const map: Record<string, EcosystemInfo> = {};
      for (const [dnia, s] of Object.entries(sinais)) {
        map[dnia] = {
          nexus_contact_id: s.nexus_contact_id,
          mentoria_client_id: s.mentoria_client_id,
          growthhs_card_id: s.growthhs_card_id,
          growthhs_card_url: s.growthhs_card_url,
          hasNexusEvents: s.tem_eventos_nexus,
          hasMentoriaEvents: s.tem_eventos_mentoria,
          hasScheduledMeeting: s.tem_agendamento_aberto,
        };
      }
      setEcosystemMap(map);
    } catch {
      setEcosystemMap({});
    }
  }, [leads]);

  const fetchTags = useCallback(async () => {
    const leadIds = leads.map((l) => l.id);
    if (leadIds.length === 0) { setTagsMap({}); return; }
    try {
      const mapa = await tagsPorContato(leadIds);
      const map: Record<string, TagInfo[]> = {};
      for (const [leadId, tags] of Object.entries(mapa)) {
        map[leadId] = tags.map((t) => ({ id: t.id, name: t.nome, color: t.cor ?? 'purple' }));
      }
      setTagsMap(map);
    } catch {
      setTagsMap({});
    }
  }, [leads]);

  const fetchAllTags = useCallback(async () => {
    try {
      const tags = await listarTags();
      setAllTags(tags.map((t) => ({ id: t.id, name: t.nome, color: t.cor ?? 'purple' })));
    } catch {
      setAllTags([]);
    }
  }, []);

  useEffect(() => {
    fetchEcosystem();
    fetchTags();
    fetchAllTags();
  }, [fetchEcosystem, fetchTags, fetchAllTags]);

  // Enrich leads with ecosystem and tags
  const enrichedLeads = useMemo((): EnrichedLead[] => {
    return leads.map(lead => {
      const dniaId = (lead as any).dnia_id;
      return {
        ...lead,
        dnia_id: dniaId || null,
        phone_normalized: (lead as any).phone_normalized || null,
        status: (lead as any).status || 'Lead',
        ecosystem: dniaId ? ecosystemMap[dniaId] : undefined,
        tags: tagsMap[lead.id] || [],
      };
    });
  }, [leads, ecosystemMap, tagsMap]);

  // Apply contacts-specific filters
  const filteredEnrichedLeads = useMemo(() => {
    let result = enrichedLeads;

    if (contactsFilters.statuses.length > 0) {
      result = result.filter(l => contactsFilters.statuses.includes(l.status || 'Lead'));
    }

    if (contactsFilters.tagIds.length > 0) {
      result = result.filter(l =>
        l.tags?.some(t => contactsFilters.tagIds.includes(t.id))
      );
    }

    if (contactsFilters.hasNexus) {
      result = result.filter(l => l.ecosystem?.nexus_contact_id || l.ecosystem?.hasNexusEvents);
    }

    if (contactsFilters.hasMentoria) {
      result = result.filter(l => l.ecosystem?.mentoria_client_id || l.ecosystem?.hasMentoriaEvents);
    }

    if (contactsFilters.hasScheduled) {
      result = result.filter(l => l.ecosystem?.hasScheduledMeeting);
    }

    return result;
  }, [enrichedLeads, contactsFilters]);

  const refetchTags = useCallback(() => {
    fetchTags();
    fetchAllTags();
  }, [fetchTags, fetchAllTags]);

  return {
    enrichedLeads: filteredEnrichedLeads,
    allEnrichedLeads: enrichedLeads,
    allTags,
    contactsFilters,
    setContactsFilters,
    refetchTags,
    refetchEcosystem: fetchEcosystem,
  };
}
