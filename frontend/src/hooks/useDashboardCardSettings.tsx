import { useState, useCallback, useEffect } from 'react';
import { api, ErroApi } from '@/lib/api';

export interface CardConfig {
  key: string;
  label: string;
  defaultVisible: boolean;
}

const STORAGE_PREFIX = 'dashboard-cards-';

// ⚠️ Uma chave só em `dashboard_settings` ("dashboard_cards"), GLOBAL — não
// por usuário (ver o docstring de backend/app/routers/painel.py: escolha de
// cartões é do painel da empresa, não da pessoa). O valor guardado é um
// objeto ÚNICO `{ [tabName]: chaves visíveis[] }`, para as seis abas do
// painel continuarem com conjuntos independentes dentro dessa única chave.
const CHAVE = 'dashboard_cards';

type ValorGuardado = Record<string, string[]>;

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

async function lerValorGuardado(): Promise<ValorGuardado> {
  try {
    const { setting_value } = await api.get<{ setting_value: ValorGuardado }>(
      `/painel/config/${CHAVE}`,
    );
    return setting_value || {};
  } catch (error) {
    // 404 é normal: ninguém definiu cartões visíveis ainda.
    if (error instanceof ErroApi && error.status === 404) return {};
    throw error;
  }
}

export function useDashboardCardSettings(tabName: string, allCards: CardConfig[]) {
  const [visibleCards, setVisibleCards] = useState<string[]>(() =>
    loadFromLocalStorage(tabName, allCards)
  );

  // Sync from DB on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const valor = await lerValorGuardado();
        if (cancelled) return;

        const allKeys = allCards.map(c => c.key);
        const dbCards = (valor[tabName] || []).filter(k => allKeys.includes(k));
        if (dbCards.length > 0) {
          setVisibleCards(dbCards);
          localStorage.setItem(STORAGE_PREFIX + tabName, JSON.stringify(dbCards));
        }
      } catch (error) {
        console.error('useDashboardCardSettings:', error);
      }
    })();
    return () => { cancelled = true; };
  }, [tabName]);

  const updateVisibleCards = useCallback((newVisible: string[]) => {
    setVisibleCards(newVisible);
    localStorage.setItem(STORAGE_PREFIX + tabName, JSON.stringify(newVisible));

    // Persist to DB (fire-and-forget). Lê o objeto inteiro, atualiza só a
    // própria aba e regrava — outras abas continuam com o que já tinham.
    (async () => {
      try {
        const atual = await lerValorGuardado();
        const proximo: ValorGuardado = { ...atual, [tabName]: newVisible };
        await api.put(`/painel/config/${CHAVE}`, proximo);
      } catch (error) {
        console.error('useDashboardCardSettings: falha ao salvar', error);
      }
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
