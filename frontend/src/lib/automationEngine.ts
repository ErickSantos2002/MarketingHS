import { supabase } from '@/integrations/supabase/client';

export interface AutomationCondition {
  type: string;
  operator: string;
  value: string;
}

export interface AutomationRule {
  id: string;
  name: string;
  is_active: boolean;
  priority: number;
  condition_type: string;
  condition_operator: string;
  condition_value: string;
  conditions: AutomationCondition[];
  condition_logic: 'and' | 'or';
  action_type: string;
  action_value: string | null;
  action_metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

interface LeadForAutomation {
  id: string;
  status: string | null;
  etiqueta: string | null;
  lead_score: number | null;
  dnia_id: string | null;
}

function evaluateSingleCondition(
  cond: AutomationCondition,
  lead: LeadForAutomation,
  tagNames: string[]
): boolean {
  switch (cond.type) {
    case 'status':
      return cond.operator === 'is'
        ? lead.status === cond.value
        : lead.status !== cond.value;

    case 'etiqueta':
      return cond.operator === 'is'
        ? lead.etiqueta === cond.value
        : lead.etiqueta !== cond.value;

    case 'tag':
      return cond.operator === 'contains'
        ? tagNames.includes(cond.value)
        : !tagNames.includes(cond.value);

    case 'score': {
      const score = lead.lead_score || 0;
      const threshold = Number(cond.value);
      return cond.operator === 'greater_than'
        ? score > threshold
        : score < threshold;
    }

    case 'created_at': {
      const createdAt = (lead as any).created_at ? new Date((lead as any).created_at) : null;
      if (!createdAt) return false;
      if (cond.operator === 'between') {
        const parts = cond.value.split('|');
        if (parts.length === 2) {
          return createdAt >= new Date(parts[0]) && createdAt <= new Date(parts[1] + 'T23:59:59');
        }
      } else if (cond.operator === 'after') {
        return createdAt >= new Date(cond.value);
      } else if (cond.operator === 'before') {
        return createdAt <= new Date(cond.value + 'T23:59:59');
      } else if (cond.operator === 'last_n_days') {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - Number(cond.value));
        return createdAt >= cutoff;
      }
      return false;
    }

    default:
      return false;
  }
}

/**
 * Evaluate automation rules for a lead. Returns the first matching rule (highest priority) or null.
 */
export async function evaluateAutomationRules(lead: LeadForAutomation): Promise<AutomationRule | null> {
  try {
    const { data: rules } = await supabase
      .from('automation_rules')
      .select('*')
      .eq('is_active', true)
      .order('priority', { ascending: false });

    if (!rules?.length) return null;

    const { data: leadTagRows } = await supabase
      .from('lead_tags')
      .select('tag_id, tags(name)')
      .eq('lead_id', lead.id);

    const tagNames = (leadTagRows || []).map((lt: any) => lt.tags?.name).filter(Boolean);

    for (const rule of rules) {
      const r = rule as any;
      const conditions: AutomationCondition[] =
        r.conditions && Array.isArray(r.conditions) && r.conditions.length > 0
          ? r.conditions
          : [{ type: r.condition_type, operator: r.condition_operator, value: r.condition_value }];

      const logic: 'and' | 'or' = r.condition_logic || 'and';

      let matches: boolean;
      if (logic === 'and') {
        matches = conditions.every(c => evaluateSingleCondition(c, lead, tagNames));
      } else {
        matches = conditions.some(c => evaluateSingleCondition(c, lead, tagNames));
      }

      if (matches) return r as AutomationRule;
    }

    return null;
  } catch (e) {
    console.error('evaluateAutomationRules error:', e);
    return null;
  }
}

/**
 * Execute the matched automation rule by invoking the handoff edge function.
 */
export async function executeAutomation(
  lead: LeadForAutomation,
  rule: AutomationRule
): Promise<void> {
  try {
    if (rule.action_type === 'block_nexus') return;

    const { error } = await supabase.functions.invoke('handoff-to-nexus', {
      body: { lead_id: lead.id, rule_id: rule.id },
    });

    if (error) {
      console.error('handoff-to-nexus error:', error);
    }
  } catch (e) {
    console.error('executeAutomation error:', e);
  }
}

/**
 * Convenience: evaluate + execute in one call.
 */
export async function evaluateAndExecute(lead: LeadForAutomation): Promise<string | null> {
  const rule = await evaluateAutomationRules(lead);
  if (!rule) return null;
  if (rule.action_type === 'block_nexus') return null;
  await executeAutomation(lead, rule);
  return rule.name;
}
