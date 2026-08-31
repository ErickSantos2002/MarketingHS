import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Lead } from '@/hooks/useLeads';

export interface EcosystemInfo {
  nexus_contact_id: string | null;
  mentoria_client_id: string | null;
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

  // Fetch ecosystem data for leads that have dnia_id
  const fetchEcosystem = useCallback(async () => {
    const dniaIds = leads
      .map(l => (l as any).dnia_id)
      .filter(Boolean) as string[];
    
    if (dniaIds.length === 0) return;

    // Deduplicate
    const uniqueIds = [...new Set(dniaIds)];
    
    // Fetch in batches of 200
    const map: Record<string, EcosystemInfo> = {};
    for (let i = 0; i < uniqueIds.length; i += 200) {
      const batch = uniqueIds.slice(i, i + 200);
      const { data } = await supabase
        .from('ecosystem_identities')
        .select('dnia_id, nexus_contact_id, mentoria_client_id')
        .in('dnia_id', batch);
      
      if (data) {
        for (const row of data) {
          map[row.dnia_id] = {
            nexus_contact_id: row.nexus_contact_id,
            mentoria_client_id: row.mentoria_client_id,
            hasNexusEvents: false,
            hasMentoriaEvents: false,
          };
        }
      }
    }

    // Check for cross-platform events + open meeting/demo activities
    // Rule: show scheduled icon when there is at least one activity_created
    // (type=meeting|demo) WITHOUT a matching close event
    // (activity_completed/cancelled/no_show/deleted) on the same activity_id.
    const openByDnia: Record<string, Map<string, boolean>> = {}; // dnia -> activity_id -> open?

    for (let i = 0; i < uniqueIds.length; i += 200) {
      const batch = uniqueIds.slice(i, i + 200);
      const { data: events } = await supabase
        .from('contact_events')
        .select('dnia_id, source_app, event_type, metadata')
        .in('dnia_id', batch);

      if (events) {
        for (const evt of events) {
          const dnia = evt.dnia_id as string | null;
          if (!dnia || !map[dnia]) continue;

          if (evt.source_app === 'nexus') map[dnia].hasNexusEvents = true;
          if (evt.source_app === 'mentoria') map[dnia].hasMentoriaEvents = true;

          // Legacy scheduling events (Cal.com widget etc.) → always counts as open
          if (evt.event_type === 'scheduling_widget_booked' || evt.event_type === 'meeting_scheduled') {
            map[dnia].hasScheduledMeeting = true;
          }

          // Nexus activity lifecycle (meeting/demo only)
          const md = (evt.metadata || {}) as Record<string, unknown>;
          const activityId = (md.activity_id as string) || null;
          const activityType = ((md.type as string) || '').toLowerCase();
          if (!activityId) continue;

          if (evt.event_type === 'activity_created' && (activityType === 'meeting' || activityType === 'demo')) {
            if (!openByDnia[dnia]) openByDnia[dnia] = new Map();
            if (!openByDnia[dnia].has(activityId)) openByDnia[dnia].set(activityId, true);
          } else if (
            evt.event_type === 'activity_completed' ||
            evt.event_type === 'activity_cancelled' ||
            evt.event_type === 'activity_no_show' ||
            evt.event_type === 'activity_deleted'
          ) {
            if (!openByDnia[dnia]) openByDnia[dnia] = new Map();
            openByDnia[dnia].set(activityId, false);
          }
        }
      }
    }

    // Apply open meetings to map
    for (const dnia of Object.keys(openByDnia)) {
      if (!map[dnia]) continue;
      for (const isOpen of openByDnia[dnia].values()) {
        if (isOpen) { map[dnia].hasScheduledMeeting = true; break; }
      }
    }


    setEcosystemMap(map);
  }, [leads]);

  // Fetch tags for all leads
  const fetchTags = useCallback(async () => {
    const leadIds = leads.map(l => l.id);
    if (leadIds.length === 0) return;

    // Fetch in batches
    const map: Record<string, TagInfo[]> = {};
    for (let i = 0; i < leadIds.length; i += 200) {
      const batch = leadIds.slice(i, i + 200);
      const { data } = await supabase
        .from('lead_tags')
        .select('lead_id, tag_id, tags(id, name, color)')
        .in('lead_id', batch);
      
      if (data) {
        for (const row of data as any[]) {
          if (!map[row.lead_id]) map[row.lead_id] = [];
          if (row.tags) {
            map[row.lead_id].push({
              id: row.tags.id,
              name: row.tags.name,
              color: row.tags.color,
            });
          }
        }
      }
    }
    setTagsMap(map);
  }, [leads]);

  // Fetch all available tags
  const fetchAllTags = useCallback(async () => {
    const { data } = await supabase
      .from('tags')
      .select('id, name, color')
      .order('name');
    if (data) setAllTags(data);
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
