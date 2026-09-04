import { useState, useEffect, useCallback } from 'react';
import { api, ErroApi } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

export interface GoalSettings {
  goal: number;
  start_date: string;
  end_date: string;
  whatsapp_group: number;
}

const DEFAULT_SETTINGS: GoalSettings = {
  goal: 1000,
  start_date: new Date().toISOString().split('T')[0],
  end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  whatsapp_group: 0,
};

const CHAVE = 'lead_goal';

export function useGoalSettings() {
  const [settings, setSettings] = useState<GoalSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const fetchSettings = useCallback(async () => {
    try {
      const { setting_value } = await api.get<{ setting_value: GoalSettings }>(
        `/painel/config/${CHAVE}`,
      );
      if (setting_value) {
        setSettings({
          goal: setting_value.goal || DEFAULT_SETTINGS.goal,
          start_date: setting_value.start_date || DEFAULT_SETTINGS.start_date,
          end_date: setting_value.end_date || DEFAULT_SETTINGS.end_date,
          whatsapp_group: setting_value.whatsapp_group || DEFAULT_SETTINGS.whatsapp_group,
        });
      }
    } catch (error) {
      // 404 é normal: a meta ainda não foi definida. Fica no padrão, sem erro.
      if (error instanceof ErroApi && error.status === 404) {
        // segue com DEFAULT_SETTINGS
      } else {
        console.error('Error fetching goal settings:', error);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSettings = useCallback(async (newSettings: Partial<GoalSettings>) => {
    setIsSaving(true);
    const updatedSettings = { ...settings, ...newSettings };

    try {
      await api.put(`/painel/config/${CHAVE}`, updatedSettings);

      setSettings(updatedSettings);
      toast({
        title: 'Configuração salva',
        description: 'As configurações de meta foram atualizadas.',
      });
    } catch (error) {
      console.error('Error saving goal settings:', error);
      toast({
        title: 'Erro ao salvar',
        description: 'Não foi possível salvar as configurações.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  }, [settings, toast]);

  const updateGoal = useCallback((goal: number) => {
    return updateSettings({ goal });
  }, [updateSettings]);

  const updateDates = useCallback((start_date: string, end_date: string) => {
    return updateSettings({ start_date, end_date });
  }, [updateSettings]);

  const updateWhatsappGroup = useCallback((whatsapp_group: number) => {
    return updateSettings({ whatsapp_group });
  }, [updateSettings]);

  return {
    settings,
    isLoading,
    isSaving,
    updateGoal,
    updateDates,
    updateWhatsappGroup,
    updateSettings,
  };
}
