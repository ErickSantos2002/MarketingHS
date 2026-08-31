import { useEffect, useState } from 'react';
import { conversoesUtm } from '@/lib/leitura';

type UtmContentMap = Record<string, string[]>;

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

// Cache em memoria compartilhado entre paginas do admin: evita refazer a
// varredura completa de lead_conversions a cada navegacao/montagem.
let cachedMap: UtmContentMap | null = null;
let cachedAt = 0;
let inFlight: Promise<UtmContentMap> | null = null;

async function fetchUtmContentMap(): Promise<UtmContentMap> {
  // A paginação de 1000 em 1000 e o agrupamento saíram daqui: isso é agregação,
  // e o banco faz numa consulta só.
  const mapa = await conversoesUtm();
  const grouped: UtmContentMap = {};
  for (const [leadId, contents] of Object.entries(mapa)) {
    grouped[leadId] = contents;
  }
  return grouped;
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
