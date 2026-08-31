import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { duplicatas, fundirIdentidades } from '@/lib/leitura';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { GitMerge, AlertTriangle, RefreshCw } from 'lucide-react';

interface DuplicateCluster {
  field: 'email' | 'phone';
  value: string;
  identities: {
    dnia_id: string;
    email: string | null;
    phone: string | null;
    nome: string | null;
    stage: string;
    created_at: string | null;
    nexus_contact_id: string | null;
    mentoria_client_id: string | null;
    dndash_lead_id: string | null;
  }[];
}

export function DuplicatesPanel() {
  const queryClient = useQueryClient();
  const [merging, setMerging] = useState<string | null>(null);

  const { data: duplicates, isLoading, refetch } = useQuery({
    queryKey: ['identity-duplicates'],
    queryFn: async (): Promise<DuplicateCluster[]> => {
      // A detecção (agrupar por e-mail e por telefone repetidos) foi para SQL.
      const grupos = await duplicatas();

      const clusters: DuplicateCluster[] = grupos.map((g) => ({
        field: g.tipo === 'email' ? 'email' : 'phone',
        value: g.chave,
        identities: g.identidades as DuplicateCluster['identities'],
      }));

      // ⚠️ Regra do original preservada: um agrupamento por telefone é
      // descartado se já existir um por e-mail com EXATAMENTE as mesmas
      // identidades — senão a mesma dupla apareceria duas vezes na tela, e
      // fundir uma faria a outra virar lixo silencioso.
      const vistos = new Set<string>();
      const semRepetir: DuplicateCluster[] = [];
      for (const c of [...clusters].sort((a) => (a.field === 'email' ? -1 : 1))) {
        const assinatura = c.identities.map((i) => i.dnia_id).sort().join(',');
        if (vistos.has(assinatura)) continue;
        vistos.add(assinatura);
        semRepetir.push(c);
      }
      return semRepetir;
    },
  });

  const mergeMutation = useMutation({
    mutationFn: async ({ keepId, discardId }: { keepId: string; discardId: string }) => {
      return fundirIdentidades(keepId, discardId);
    },
    onSuccess: (data) => {
      toast.success('Identidades mescladas com sucesso');
      queryClient.invalidateQueries({ queryKey: ['identity-duplicates'] });
      refetch();
      setMerging(null);
    },
    onError: (error: any) => {
      toast.error(`Erro ao mesclar: ${error.message}`);
      setMerging(null);
    },
  });

  const handleMerge = (cluster: DuplicateCluster) => {
    // Keep the oldest (first in the sorted list)
    const sorted = [...cluster.identities].sort(
      (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
    );
    const keepId = sorted[0].dnia_id;
    const discardId = sorted[1].dnia_id;
    setMerging(keepId + discardId);
    mergeMutation.mutate({ keepId, discardId });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GitMerge className="h-4 w-4" />
            Duplicatas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <GitMerge className="h-4 w-4" />
          Duplicatas
          {duplicates && duplicates.length > 0 && (
            <Badge variant="destructive" className="ml-1">{duplicates.length}</Badge>
          )}
        </CardTitle>
        <Button variant="ghost" size="icon" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        {!duplicates || duplicates.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma duplicata encontrada ✓</p>
        ) : (
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {duplicates.map((cluster, idx) => (
              <div key={idx} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    <span className="text-sm font-medium">
                      {cluster.field === 'email' ? 'Email' : 'Telefone'}: {cluster.value}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleMerge(cluster)}
                    disabled={merging === cluster.identities[0].dnia_id + cluster.identities[1].dnia_id}
                  >
                    <GitMerge className="h-3 w-3 mr-1" />
                    Mesclar
                  </Button>
                </div>
                <div className="grid gap-1">
                  {cluster.identities.map((identity, i) => (
                    <div key={identity.dnia_id} className="text-xs text-muted-foreground flex items-center gap-2">
                      {i === 0 && <Badge variant="secondary" className="text-[10px]">Manter</Badge>}
                      {i > 0 && <Badge variant="outline" className="text-[10px]">Descartar</Badge>}
                      <span className="font-mono truncate">{identity.dnia_id.slice(0, 8)}...</span>
                      <span>{identity.nome || '—'}</span>
                      <span className="text-muted-foreground/60">{identity.stage}</span>
                      <span className="text-muted-foreground/60">
                        {identity.created_at ? new Date(identity.created_at).toLocaleDateString('pt-BR') : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
