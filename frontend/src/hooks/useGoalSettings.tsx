import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Json } from '@/integrations/supabase/types';

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

export function useGoalSettings() {
  const [settings, setSettings] = useState<GoalSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const fetchSettings = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('dashboard_settings')
        .select('setting_value')
        .eq('setting_key', 'lead_goal')
        .maybeSingle();

      if (error) throw error;

      if (data?.setting_value) {
        const value = data.setting_value as unknown as GoalSettings;
        setSettings({
          goal: value.goal || DEFAULT_SETTINGS.goal,
          start_date: value.start_date || DEFAULT_SETTINGS.start_date,
          end_date: value.end_date || DEFAULT_SETTINGS.end_date,
          whatsapp_group: value.whatsapp_group || DEFAULT_SETTINGS.whatsapp_group,
        });
      }
    } catch (error) {
      console.error('Error fetching goal settings:', error);
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
    const jsonValue: Json = {
      goal: updatedSettings.goal,
      start_date: updatedSettings.start_date,
      end_date: updatedSettings.end_date,
      whatsapp_group: updatedSettings.whatsapp_group,
    };
    
    try {
      // First check if setting exists
      const { data: existing } = await supabase
        .from('dashboard_settings')
        .select('id')
        .eq('setting_key', 'lead_goal')
        .maybeSingle();

      let error;
      if (existing) {
        // Update existing
        const result = await supabase
          .from('dashboard_settings')
          .update({
            setting_value: jsonValue,
            updated_at: new Date().toISOString(),
          })
          .eq('setting_key', 'lead_goal');
        error = result.error;
      } else {
        // Insert new
        const result = await supabase
          .from('dashboard_settings')
          .insert([{
            setting_key: 'lead_goal',
            setting_value: jsonValue,
          }]);
        error = result.error;
      }

      if (error) throw error;

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
