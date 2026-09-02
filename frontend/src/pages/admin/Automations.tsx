import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Zap, Plus, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import { useAutomationRules } from '@/hooks/useAutomationRules';
import { AutomationRuleForm } from '@/components/admin/automations/AutomationRuleForm';
import { toast } from 'sonner';
import { AUTOMACAO_NAO_LIGADA, previaDaRegra, type AutomationRule } from '@/lib/automacoes';
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

  // A prévia depois de salvar: quantos contatos a regra pegaria.
  //
  // ⚠️ O PROCESSAMENTO retroativo saiu. Ele percorria os contatos chamando
  // `handoff-to-nexus` um a um, e essa function é do lote 5 — a barra de
  // progresso encheria até 100% sem nada ter sido enviado, que é pior do que
  // não existir. O número continua: saber quantos a regra pega é útil hoje.
  const [previaRegra, setPreviaRegra] = useState<Partial<AutomationRule> | null>(null);
  const [previaTotal, setPreviaTotal] = useState(0);
  const [previaCarregando, setPreviaCarregando] = useState(false);

  const handleCreate = () => {
    setEditingRule(null);
    setShowForm(true);
  };

  const handleEdit = (rule: AutomationRule) => {
    setEditingRule(rule);
    setShowForm(true);
  };

  const handleSave = async (rule: Partial<AutomationRule>) => {
    const ok = await saveRule(rule);
    if (!ok) return;
    setShowForm(false);

    // `block_nexus` não manda ninguém para lugar nenhum: contar quantos ela
    // pegaria não diz nada a quem acabou de criá-la.
    if (rule.action_type === 'block_nexus') return;

    setPreviaRegra(rule);
    setPreviaCarregando(true);
    try {
      // ⚠️ Uma chamada, e volta só o número. A origem trazia a lista inteira
      // de leads para o navegador para ler `.length`.
      const { total } = await previaDaRegra({
        conditions: rule.conditions,
        condition_logic: rule.condition_logic,
        condition_type: rule.condition_type,
        condition_operator: rule.condition_operator,
        condition_value: rule.condition_value,
      });
      setPreviaTotal(total);
    } catch {
      setPreviaTotal(0);
    } finally {
      setPreviaCarregando(false);
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

          {/* ⚠️ O aviso da origem mandava conferir as credenciais do Nexus em
              Configurações, como se faltasse configuração. Não falta: a
              integração inteira é do lote 5. Mandar procurar credencial que
              não existe faz perder tempo procurando defeito onde não há. */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="py-3 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {AUTOMACAO_NAO_LIGADA}
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
                      // Os casts para `any` saíram: `AutomationRule` em
                      // lib/automacoes já garante `conditions` e
                      // `condition_logic`. A regra de campo único continua
                      // sendo o reserva, porque as colunas antigas ainda
                      // existem na tabela.
                      const conds = rule.conditions?.length
                        ? rule.conditions
                        : [{ type: rule.condition_type, operator: rule.condition_operator, value: rule.condition_value }];
                      const separator = (rule.condition_logic || 'and') === 'and' ? ' E ' : ' OU ';
                      return conds.map((c, i) => (
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
                    {typeof rule.action_metadata?.stage_name === 'string' && (
                      <> em "<span className="font-medium text-foreground">{rule.action_metadata.stage_name}</span>"</>
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

      {/* A prévia depois de salvar. Informativa: diz quantos a regra pega e
          quando isso vai acontecer. Não há botão de aplicar — ver o comentário
          do estado acima. */}
      <Dialog open={!!previaRegra} onOpenChange={(open) => { if (!open) setPreviaRegra(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Regra salva</DialogTitle>
            <DialogDescription>
              {previaCarregando ? (
                'Calculando quantos contatos atendem à condição...'
              ) : previaTotal === 0 ? (
                'Nenhum contato existente atende a esta condição (ou todos já estão no Nexus).'
              ) : (
                <>
                  <strong>{previaTotal}</strong> contato{previaTotal !== 1 ? 's' : ''} existente{previaTotal !== 1 ? 's' : ''}
                  {' '}atende{previaTotal === 1 ? '' : 'm'} à condição e ainda não está{previaTotal === 1 ? '' : 'ão'} no Nexus.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {!previaCarregando && previaTotal > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
              <p className="text-xs text-amber-900 dark:text-amber-200">
                Eles não serão enviados agora. {AUTOMACAO_NAO_LIGADA}
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setPreviaRegra(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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