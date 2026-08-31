import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Key, Plus, Copy, Check, AlertTriangle, CalendarIcon, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { format, formatDistanceToNow, addDays, isBefore } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';

type ApiKey = {
  id: string;
  name: string;
  description: string | null;
  key_prefix: string;
  permissions: string;
  expires_at: string | null;
  last_used_at: string | null;
  is_active: boolean;
  created_at: string;
};

async function generateKeyHash(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateApiKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = 'dnk_';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function PermissionBadge({ permissions }: { permissions: string }) {
  if (permissions === 'read') return <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/30 text-[10px]" variant="outline">Leitura</Badge>;
  if (permissions === 'write') return <Badge className="bg-yellow-500/15 text-yellow-400 border-yellow-500/30 text-[10px]" variant="outline">Escrita</Badge>;
  return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px]" variant="outline">Leitura + Escrita</Badge>;
}

function StatusBadge({ apiKey }: { apiKey: ApiKey }) {
  if (!apiKey.is_active) return <Badge className="bg-muted/50 text-muted-foreground border-border/30 text-[10px]" variant="outline">Revogada</Badge>;
  if (apiKey.expires_at && isBefore(new Date(apiKey.expires_at), new Date())) {
    return <Badge className="bg-red-500/15 text-red-400 border-red-500/30 text-[10px]" variant="outline">Expirada</Badge>;
  }
  return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px]" variant="outline">Ativa</Badge>;
}

export default function ApiKeysManagement() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [revealOpen, setRevealOpen] = useState(false);
  const [revealedKey, setRevealedKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formPerm, setFormPerm] = useState('read_write');
  const [noExpiry, setNoExpiry] = useState(true);
  const [expiryDate, setExpiryDate] = useState<Date | undefined>();
  const [creating, setCreating] = useState(false);

  const fetchKeys = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('api_keys' as any)
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('Error fetching keys:', error);
      toast.error('Erro ao carregar chaves');
    } else {
      setKeys((data as any[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => { fetchKeys(); }, []);

  const handleCreate = async () => {
    if (!formName.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }
    setCreating(true);
    try {
      const rawKey = generateApiKey();
      const keyHash = await generateKeyHash(rawKey);
      const keyPrefix = rawKey.substring(0, 12);

      const { error } = await supabase
        .from('api_keys' as any)
        .insert({
          name: formName.trim(),
          description: formDesc.trim() || null,
          key_hash: keyHash,
          key_prefix: keyPrefix,
          permissions: formPerm,
          expires_at: noExpiry ? null : expiryDate?.toISOString() || null,
        } as any);

      if (error) throw error;

      setRevealedKey(rawKey);
      setCreateOpen(false);
      setRevealOpen(true);
      resetForm();
      toast.success('Chave criada com sucesso');
    } catch (err: any) {
      console.error('Error creating key:', err);
      toast.error('Erro ao criar chave');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setRevoking(id);
    try {
      const { error } = await supabase
        .from('api_keys' as any)
        .update({ is_active: false } as any)
        .eq('id', id);
      if (error) throw error;
      toast.success('Chave revogada');
      setConfirmRevoke(null);
      fetchKeys();
    } catch {
      toast.error('Erro ao revogar chave');
    } finally {
      setRevoking(null);
    }
  };

  const handleCopyKey = async () => {
    await navigator.clipboard.writeText(revealedKey);
    setCopied(true);
    toast.success('Chave copiada!');
    setTimeout(() => setCopied(false), 2000);
  };

  const resetForm = () => {
    setFormName('');
    setFormDesc('');
    setFormPerm('read_write');
    setNoExpiry(true);
    setExpiryDate(undefined);
  };

  const tomorrow = addDays(new Date(), 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold">API Keys</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Gerencie as chaves de acesso à API do dnMarketing</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          Nova chave
        </Button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : keys.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center mb-3">
            <Key className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">Nenhuma chave criada</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs">
            Crie chaves para integrar agentes, automações e plataformas externas à API do dnMarketing
          </p>
        </div>
      ) : (
        <div className="border border-border/30 rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/30 hover:bg-transparent">
                <TableHead className="text-[11px] h-9">Nome</TableHead>
                <TableHead className="text-[11px] h-9">Permissões</TableHead>
                <TableHead className="text-[11px] h-9">Prefixo</TableHead>
                <TableHead className="text-[11px] h-9">Expira em</TableHead>
                <TableHead className="text-[11px] h-9">Último uso</TableHead>
                <TableHead className="text-[11px] h-9">Status</TableHead>
                <TableHead className="text-[11px] h-9 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map(k => (
                <TableRow key={k.id} className="border-b border-border/20">
                  <TableCell className="py-2.5">
                    <p className="text-xs font-semibold">{k.name}</p>
                    {k.description && <p className="text-[10px] text-muted-foreground mt-0.5">{k.description}</p>}
                  </TableCell>
                  <TableCell className="py-2.5"><PermissionBadge permissions={k.permissions} /></TableCell>
                  <TableCell className="py-2.5">
                    <code className="text-[10px] font-mono text-muted-foreground">{k.key_prefix}...</code>
                  </TableCell>
                  <TableCell className="py-2.5 text-xs text-muted-foreground">
                    {k.expires_at
                      ? formatDistanceToNow(new Date(k.expires_at), { addSuffix: true, locale: ptBR })
                      : 'Nunca'}
                  </TableCell>
                  <TableCell className="py-2.5 text-xs text-muted-foreground">
                    {k.last_used_at
                      ? formatDistanceToNow(new Date(k.last_used_at), { addSuffix: true, locale: ptBR })
                      : 'Nunca usado'}
                  </TableCell>
                  <TableCell className="py-2.5"><StatusBadge apiKey={k} /></TableCell>
                  <TableCell className="py-2.5 text-right">
                    {k.is_active && !(k.expires_at && isBefore(new Date(k.expires_at), new Date())) ? (
                      confirmRevoke === k.id ? (
                        <div className="flex items-center gap-1.5 justify-end">
                          <span className="text-[10px] text-red-400">Revogar esta chave?</span>
                          <Button
                            variant="destructive"
                            size="sm"
                            className="h-6 text-[10px] px-2"
                            onClick={() => handleRevoke(k.id)}
                            disabled={revoking === k.id}
                          >
                            {revoking === k.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Sim'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[10px] px-2"
                            onClick={() => setConfirmRevoke(null)}
                          >
                            Não
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] text-red-400 hover:text-red-300 hover:bg-red-500/10 px-2"
                          onClick={() => setConfirmRevoke(k.id)}
                        >
                          Revogar
                        </Button>
                      )
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create Modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="text-base">Nova API Key</DialogTitle>
            <DialogDescription className="text-xs">
              Crie uma chave para integrar agentes e plataformas externas
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Nome <span className="text-red-400">*</span></Label>
              <Input
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder='ex: "Agente Lia", "Nexus", "N8N Flows"'
                className="text-xs h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Descrição</Label>
              <Textarea
                value={formDesc}
                onChange={e => setFormDesc(e.target.value)}
                placeholder='ex: "Acesso para o agente SDR da DN.IA"'
                className="text-xs min-h-[60px] resize-none"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Permissões</Label>
              <Select value={formPerm} onValueChange={setFormPerm}>
                <SelectTrigger className="text-xs h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="read" className="text-xs">
                    <div>
                      <span className="font-medium">Leitura</span>
                      <span className="text-muted-foreground ml-1">— consultar contatos e identidades</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="write" className="text-xs">
                    <div>
                      <span className="font-medium">Escrita</span>
                      <span className="text-muted-foreground ml-1">— criar eventos e upsert identidades</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="read_write" className="text-xs">
                    <div>
                      <span className="font-medium">Leitura + Escrita</span>
                      <span className="text-muted-foreground ml-1">— acesso completo</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Sem expiração</Label>
                <Switch checked={noExpiry} onCheckedChange={setNoExpiry} />
              </div>
              {!noExpiry && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn("w-full justify-start text-left text-xs h-9", !expiryDate && "text-muted-foreground")}
                    >
                      <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                      {expiryDate ? format(expiryDate, "PPP", { locale: ptBR }) : "Selecione a data de expiração"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={expiryDate}
                      onSelect={setExpiryDate}
                      disabled={(date) => date < tomorrow}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              )}
            </div>
            <Button className="w-full" onClick={handleCreate} disabled={creating || !formName.trim()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Key className="h-4 w-4 mr-2" />}
              Criar chave
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reveal Modal */}
      <Dialog open={revealOpen} onOpenChange={() => {}}>
        <DialogContent className="max-w-[520px]" onPointerDownOutside={e => e.preventDefault()} onEscapeKeyDown={e => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="text-base">Chave criada com sucesso</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
              <AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-yellow-400">
                Copie esta chave agora. Por segurança, ela não será exibida novamente após fechar esta janela.
              </p>
            </div>
            <div className="relative rounded-lg overflow-hidden" style={{ background: '#1E1E2E' }}>
              <pre className="p-4 pr-20 text-xs font-mono break-all" style={{ color: '#A9B1D6' }}>
                {revealedKey}
              </pre>
              <Button
                variant="ghost"
                size="sm"
                className="absolute top-2 right-2 h-7 text-[10px] gap-1 text-[#A9B1D6] hover:text-white hover:bg-white/10"
                onClick={handleCopyKey}
              >
                {copied ? <><Check className="h-3 w-3" /> Copiado ✓</> : <><Copy className="h-3 w-3" /> Copiar</>}
              </Button>
            </div>
            <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.08]">
              <p className="text-[11px] text-muted-foreground">
                Use esta chave no header de todas as requisições:
              </p>
              <code className="text-[10px] font-mono text-primary mt-1 block">
                Authorization: Bearer {revealedKey.substring(0, 16)}...
              </code>
            </div>
            <Button
              className="w-full"
              variant="outline"
              onClick={() => {
                setRevealOpen(false);
                setRevealedKey('');
                setCopied(false);
                fetchKeys();
              }}
            >
              Já copiei, fechar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
