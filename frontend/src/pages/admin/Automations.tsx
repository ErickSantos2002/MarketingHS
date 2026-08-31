import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Zap, Plus, Pencil, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { useAutomationRules } from '@/hooks/useAutomationRules';
import { AutomationRuleForm } from '@/components/admin/automations/AutomationRuleForm';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { AutomationRule } from '@/lib/automationEngine';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { JourneysTab } from '@/components/admin/automations/JourneysTab';

const CONDITION_LABELS: Record<string, string> = {
  status: 'Status',
  etiqueta: 'Etiqueta',
  tag: 'Tag',
  score: 'Score',
  created_at: 'Período',
};

const OPERATOR_LABELS: Record<string, string> = {
  is: 'é',
  is_not: 'não é',
  greater_than: 'maior que',
  less_than: 'menor que',
  contains: 'contém',
  between: 'entre',
  after: 'depois de',
  before: 'antes de',
  last_n_days: 'últimos dias',
};

const ACTION_LABELS: Record<string, string> = {
  create_in_nexus: 'Criar no Nexus',
  move_stage_nexus: 'Mover estágio no Nexus',
  block_nexus: 'Não enviar para o Nexus',
};

export default function Automations() {
  const { rules, loading, toggleRule, deleteRule, saveRule } = useAutomationRules();
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Retroactive processing state
  const [retroRule, setRetroRule] = useState<Partial<AutomationRule> | null>(null);
  const [retroMatchCount, setRetroMatchCount] = useState(0);
  const [retroLoading, setRetroLoading] = useState(false);
  const [retroProcessing, setRetroProcessing] = useState(false);
  const [retroProgress, setRetroProgress] = useState(0);
  const [retroTotal, setRetroTotal] = useState(0);

  const handleCreate = () => {
    setEditingRule(null);
    setShowForm(true);
  };

  const handleEdit = (rule: AutomationRule) => {
    setEditingRule(rule);
    setShowForm(true);
  };

  const applyConditionToQuery = async (
    query: any,
    cond: { type: string; operator: string; value: string }
  ) => {
    switch (cond.type) {
      case 'status':
        return cond.operator === 'is'
          ? query.eq('status', cond.value)
          : query.neq('status', cond.value);
      case 'etiqueta':
        return cond.operator === 'is'
          ? query.eq('etiqueta', cond.value)
          : query.neq('etiqueta', cond.value);
      case 'score': {
        const scoreVal = parseInt(cond.value || '0');
        return cond.operator === 'greater_than'
          ? query.gt('lead_score', scoreVal)
          : query.lt('lead_score', scoreVal);
      }
      case 'created_at': {
        if (cond.operator === 'after') {
          return query.gte('created_at', cond.value);
        } else if (cond.operator === 'before') {
          return query.lte('created_at', cond.value + 'T23:59:59');
        } else if (cond.operator === 'between') {
          const parts = cond.value.split('|');
          if (parts.length === 2) {
            return query.gte('created_at', parts[0]).lte('created_at', parts[1] + 'T23:59:59');
          }
        } else if (cond.operator === 'last_n_days') {
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - Number(cond.value));
          return query.gte('created_at', cutoff.toISOString());
        }
        return query;
      }
      default:
        return query;
    }
  };

  const queryMatchingLeads = async (rule: Partial<AutomationRule>) => {
    const conditions: { type: string; operator: string; value: string }[] =
      rule.conditions && Array.isArray(rule.conditions) && rule.conditions.length > 0
        ? rule.conditions
        : [{ type: rule.condition_type!, operator: rule.condition_operator!, value: rule.condition_value! }];

    const logic = (rule as any).condition_logic || 'and';

    // For AND logic, apply all filterable conditions to a single query
    // For OR logic, run separate queries and merge results
    if (logic === 'and') {
      let query = supabase.from('leads').select('id, dnia_id, etiqueta, created_at');

      // Handle tag conditions separately (need join)
      const tagConditions = conditions.filter(c => c.type === 'tag');
      const otherConditions = conditions.filter(c => c.type !== 'tag');

      for (const cond of otherConditions) {
        query = await applyConditionToQuery(query, cond);
      }

      let { data: leads } = await query;
      if (!leads || leads.length === 0) return [];

      // Apply tag filters client-side if needed
      if (tagConditions.length > 0) {
        for (const tagCond of tagConditions) {
          const { data: tagData } = await supabase.from('tags').select('id').eq('name', tagCond.value).single();
          if (!tagData) return [];
          const { data: leadTagData } = await supabase.from('lead_tags').select('lead_id').eq('tag_id', tagData.id);
          const tagLeadIds = new Set((leadTagData || []).map(lt => lt.lead_id));
          leads = leads!.filter(l =>
            tagCond.operator === 'contains' ? tagLeadIds.has(l.id) : !tagLeadIds.has(l.id)
          );
        }
      }

      return filterOutNexusLeads(leads || []);
    } else {
      // OR: run each condition separately and merge
      const allLeadIds = new Set<string>();
      const allLeads: any[] = [];

      for (const cond of conditions) {
        if (cond.type === 'tag') {
          const { data: tagData } = await supabase.from('tags').select('id').eq('name', cond.value).single();
          if (!tagData) continue;
          const { data: leadTagData } = await supabase.from('lead_tags').select('lead_id').eq('tag_id', tagData.id);
          const leadIds = (leadTagData || []).map(lt => lt.lead_id);
          if (leadIds.length === 0) continue;
          const { data: leads } = await supabase.from('leads').select('id, dnia_id, etiqueta').in('id', leadIds);
          for (const l of leads || []) {
            if (!allLeadIds.has(l.id)) { allLeadIds.add(l.id); allLeads.push(l); }
          }
        } else {
          let query = supabase.from('leads').select('id, dnia_id, etiqueta');
          query = await applyConditionToQuery(query, cond);
          const { data: leads } = await query;
          for (const l of leads || []) {
            if (!allLeadIds.has(l.id)) { allLeadIds.add(l.id); allLeads.push(l); }
          }
        }
      }

      return filterOutNexusLeads(allLeads);
    }
  };

  const filterOutNexusLeads = async (leads: any[]) => {
    if (leads.length === 0) return [];
    const dniaIds = leads.map(l => l.dnia_id).filter(Boolean) as string[];
    let nexusSet = new Set<string>();
    if (dniaIds.length > 0) {
      const { data: identities } = await supabase
        .from('ecosystem_identities')
        .select('dnia_id, nexus_contact_id')
        .in('dnia_id', dniaIds)
        .not('nexus_contact_id', 'is', null);
      nexusSet = new Set((identities || []).map(i => i.dnia_id));
    }
    return leads.filter(l => !l.dnia_id || !nexusSet.has(l.dnia_id));
  };


  const handleSave = async (rule: Partial<AutomationRule>) => {
    const ok = await saveRule(rule);
    if (ok) {
      setShowForm(false);

      // Only offer retroactive processing for create/move actions (not block)
      if (rule.action_type === 'block_nexus') return;

      setRetroRule(rule);
      setRetroLoading(true);

      try {
        const matchingLeads = await queryMatchingLeads(rule);
        setRetroMatchCount(matchingLeads.length);
      } catch {
        setRetroMatchCount(0);
      }
      setRetroLoading(false);
    }
  };

  const handleRetroProcess = async () => {
    if (!retroRule) return;
    setRetroProcessing(true);
    setRetroProgress(0);

    try {
      const matchingLeads = await queryMatchingLeads(retroRule);
      setRetroTotal(matchingLeads.length);

      let processed = 0;
      let errors = 0;

      for (const lead of matchingLeads) {
        try {
          // Find the saved rule id
          const ruleId = retroRule.id || (editingRule?.id);
          
          if (ruleId) {
            await supabase.functions.invoke('handoff-to-nexus', {
              body: { lead_id: lead.id, rule_id: ruleId },
            });
          } else {
            // Manual mode fallback
            await supabase.functions.invoke('handoff-to-nexus', {
              body: { lead_id: lead.id, manual: true },
            });
          }
        } catch {
          errors++;
        }

        processed++;
        setRetroProgress(Math.round((processed / matchingLeads.length) * 100));
      }

      if (errors > 0) {
        toast.warning(`Processados ${processed - errors} de ${matchingLeads.length}. ${errors} com erro.`);
      } else {
        toast.success(`${processed} contatos processados com sucesso!`);
      }
    } catch (err: any) {
      toast.error('Erro ao processar contatos');
    } finally {
      setRetroProcessing(false);
      setRetroRule(null);
      setRetroProgress(0);
    }
  };

  const handleDelete = async () => {
    if (deleteId) {
      await deleteRule(deleteId);
      setDeleteId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Automações</h1>
        <p className="text-sm text-muted-foreground">Regras de handoff para o Nexus e fluxos de email</p>
      </div>

      <Tabs defaultValue="fluxos">
        <TabsList>
          <TabsTrigger value="regras">Regras</TabsTrigger>
          <TabsTrigger value="fluxos">Fluxos</TabsTrigger>
        </TabsList>

        <TabsContent value="regras" className="space-y-4 pt-4">
          <div className="flex items-center justify-end">
            <Button onClick={handleCreate} className="gap-2">
              <Plus className="h-4 w-4" /> Nova regra
            </Button>
          </div>

          {/* Nexus warning banner */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="py-3 flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
          <p className="text-xs text-amber-700 dark:text-amber-400">
            As automações dependem da conexão com o Nexus. Verifique se as credenciais estão configuradas em Configurações.
          </p>
        </CardContent>
      </Card>

      {/* Rules list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
        </div>
      ) : rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Zap className="h-12 w-12 mb-3 opacity-30" />
          <p className="text-sm font-medium">Nenhuma regra criada</p>
          <p className="text-xs mt-1">Clique em "+ Nova regra" para começar</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map(rule => (
            <Card key={rule.id} className={`border-border/40 transition-opacity ${!rule.is_active ? 'opacity-50' : ''}`}>
              <CardContent className="py-4 flex items-center gap-4">
                <Switch
                  checked={rule.is_active}
                  onCheckedChange={(v) => toggleRule(rule.id, v)}
                />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold">{rule.name}</span>
                    <Badge variant="secondary" className="text-[10px]">P{rule.priority}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/70">SE</span>{' '}
                    {(() => {
                      const conds = (rule as any).conditions && Array.isArray((rule as any).conditions) && (rule as any).conditions.length > 0
                        ? (rule as any).conditions
                        : [{ type: rule.condition_type, operator: rule.condition_operator, value: rule.condition_value }];
                      const logic = (rule as any).condition_logic || 'and';
                      const separator = logic === 'and' ? ' E ' : ' OU ';
                      return conds.map((c: any, i: number) => (
                        <span key={i}>
                          {i > 0 && <span className="text-primary/60 font-semibold">{separator}</span>}
                          {CONDITION_LABELS[c.type] || c.type}{' '}
                          {OPERATOR_LABELS[c.operator] || c.operator}{' '}
                          <span className="font-medium text-foreground">{c.value}</span>
                        </span>
                      ));
                    })()}
                    {' → '}
                    <span className="font-medium text-foreground/70">ENTÃO</span>{' '}
                    {ACTION_LABELS[rule.action_type] || rule.action_type}
                    {(rule.action_metadata as any)?.stage_name && (
                      <> em "<span className="font-medium text-foreground">{(rule.action_metadata as any).stage_name}</span>"</>
                    )}
                  </p>
                </div>

                <div className="flex gap-1 flex-shrink-0">
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleEdit(rule)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => setDeleteId(rule.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRule ? 'Editar regra' : 'Nova regra'}</DialogTitle>
          </DialogHeader>
          <AutomationRuleForm
            rule={editingRule}
            onSave={handleSave}
            onCancel={() => setShowForm(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Retroactive processing dialog */}
      <Dialog open={!!retroRule} onOpenChange={(open) => { if (!open && !retroProcessing) setRetroRule(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Aplicar regra a contatos existentes?</DialogTitle>
            <DialogDescription>
              {retroLoading ? (
                'Calculando contatos que atendem à condição...'
              ) : retroProcessing ? (
                `Processando contatos... ${retroProgress}%`
              ) : retroMatchCount === 0 ? (
                'Nenhum contato existente atende a esta condição (ou todos já estão no Nexus).'
              ) : (
                <>
                  <strong>{retroMatchCount}</strong> contato{retroMatchCount !== 1 ? 's' : ''} existente{retroMatchCount !== 1 ? 's' : ''} atende{retroMatchCount === 1 ? '' : 'm'} à condição e ainda não está{retroMatchCount === 1 ? '' : 'ão'} no Nexus. Deseja aplicar a regra agora?
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {retroProcessing && (
            <div className="space-y-2">
              <Progress value={retroProgress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">
                {Math.round((retroProgress / 100) * retroTotal)} de {retroTotal}
              </p>
            </div>
          )}

          <DialogFooter>
            {!retroProcessing && (
              <>
                <Button variant="ghost" size="sm" onClick={() => setRetroRule(null)}>
                  {retroMatchCount === 0 ? 'Fechar' : 'Pular'}
                </Button>
                {retroMatchCount > 0 && !retroLoading && (
                  <Button size="sm" onClick={handleRetroProcess} className="gap-1.5">
                    <Zap className="h-3.5 w-3.5" />
                    Aplicar agora
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir regra?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A regra será removida permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
        </TabsContent>

        <TabsContent value="fluxos" className="pt-4">
          <JourneysTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}