import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

type UtmContentMap = Record<string, string[]>;

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

// Cache em memoria compartilhado entre paginas do admin: evita refazer a
// varredura completa de lead_conversions a cada navegacao/montagem.
let cachedMap: UtmContentMap | null = null;
let cachedAt = 0;
let inFlight: Promise<UtmContentMap> | null = null;

async function fetchUtmContentMap(): Promise<UtmContentMap> {
  const grouped: Record<string, Set<string>> = {};
  const pageSize = 1000;
  let from = 0;

  // Paginate to bypass the default 1000-row limit.
  while (true) {
    const { data, error } = await supabase
      .from('lead_conversions')
      .select('lead_id, utm_content')
      .not('utm_content', 'is', null)
      .range(from, from + pageSize - 1);
    if (error || !data || data.length === 0) break;
    for (const row of data as { lead_id: string; utm_content: string | null }[]) {
      if (!row.lead_id || !row.utm_content) continue;
      if (!grouped[row.lead_id]) grouped[row.lead_id] = new Set();
      grouped[row.lead_id].add(row.utm_content);
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }

  const out: UtmContentMap = {};
  for (const k of Object.keys(grouped)) out[k] = Array.from(grouped[k]);
  return out;
}

function getUtmContentMap(): Promise<UtmContentMap> {
  const isFresh = cachedMap && Date.now() - cachedAt < CACHE_TTL_MS;
  if (isFresh) return Promise.resolve(cachedMap as UtmContentMap);
  if (inFlight) return inFlight;

  inFlight = fetchUtmContentMap()
    .then(map => {
      cachedMap = map;
      cachedAt = Date.now();
      return map;
    })
    .catch(err => {
      console.error('useLeadConversionUtmContents:', err);
      return cachedMap || {};
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/**
 * Fetches utm_content values from lead_conversions grouped per lead_id.
 * Used so the global UTM Content filter applies OR semantics across a lead's
 * entire conversion history (not just the latest stored utm_content on the lead row).
 *
 * O resultado e cacheado por 5 minutos em memoria e compartilhado entre todos os
 * consumidores, para nao repetir a varredura completa da tabela.
 */
export function useLeadConversionUtmContents() {
  const [map, setMap] = useState<UtmContentMap>(() => cachedMap || {});

  useEffect(() => {
    let cancelled = false;
    getUtmContentMap().then(result => {
      if (!cancelled) setMap(result);
    });
    return () => { cancelled = true; };
  }, []);

  return map;
}
