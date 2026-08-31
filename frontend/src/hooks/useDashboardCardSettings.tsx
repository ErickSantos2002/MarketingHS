import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface CardConfig {
  key: string;
  label: string;
  defaultVisible: boolean;
}

const STORAGE_PREFIX = 'dashboard-cards-';

function loadFromLocalStorage(tabName: string, allCards: CardConfig[]): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_PREFIX + tabName);
    if (stored) {
      const parsed = JSON.parse(stored) as string[];
      const allKeys = allCards.map(c => c.key);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.filter(k => allKeys.includes(k));
      }
    }
  } catch {}
  return allCards.filter(c => c.defaultVisible).map(c => c.key);
}

export function useDashboardCardSettings(tabName: string, allCards: CardConfig[]) {
  const [visibleCards, setVisibleCards] = useState<string[]>(() =>
    loadFromLocalStorage(tabName, allCards)
  );

  // Sync from DB on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const settingKey = `card_prefs_${user.id}_${tabName}`;
      const { data } = await supabase
        .from('dashboard_settings')
        .select('setting_value')
        .eq('setting_key', settingKey)
        .maybeSingle();

      if (data?.setting_value && !cancelled) {
        const allKeys = allCards.map(c => c.key);
        const dbCards = (data.setting_value as string[]).filter(k => allKeys.includes(k));
        if (dbCards.length > 0) {
          setVisibleCards(dbCards);
          localStorage.setItem(STORAGE_PREFIX + tabName, JSON.stringify(dbCards));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [tabName]);

  const updateVisibleCards = useCallback((newVisible: string[]) => {
    setVisibleCards(newVisible);
    localStorage.setItem(STORAGE_PREFIX + tabName, JSON.stringify(newVisible));

    // Persist to DB (fire-and-forget)
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const settingKey = `card_prefs_${user.id}_${tabName}`;
      await supabase
        .from('dashboard_settings')
        .upsert(
          { setting_key: settingKey, setting_value: newVisible as any, updated_at: new Date().toISOString() },
          { onConflict: 'setting_key' }
        );
    })();
  }, [tabName]);

  const toggleCard = useCallback((key: string) => {
    setVisibleCards(prev => {
      const next = prev.includes(key)
        ? prev.filter(k => k !== key)
        : [...prev, key];
      // Don't allow hiding everything
      if (next.length === 0) return prev;
      updateVisibleCards(next);
      return next;
    });
  }, [updateVisibleCards]);

  const resetCards = useCallback(() => {
    const defaults = allCards.filter(c => c.defaultVisible).map(c => c.key);
    updateVisibleCards(defaults);
  }, [allCards, updateVisibleCards]);

  const isVisible = useCallback((key: string) => visibleCards.includes(key), [visibleCards]);

  return { visibleCards, toggleCard, resetCards, isVisible, updateVisibleCards };
}
