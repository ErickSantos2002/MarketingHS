// Arquivos PDF para pôr link no e-mail (a ficha técnica da prova do RD).
// Sobe, lista e copia o link público estável — o template leva o link, nunca
// o arquivo anexado.
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertTriangle, Check, Copy, FileText, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { listarArquivos, subirArquivo, TAMANHO_MAXIMO_ARQUIVO, type Arquivo } from '@/lib/config';

function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

function mensagem(e: unknown, padrao: string): string {
  if (e instanceof Error && e.message && e.message !== '[object Object]') return e.message;
  return padrao;
}

/** O que a tela recusa antes de mandar (o servidor confere de novo). */
export function problemaDoArquivo(f: File): string | null {
  const ehPdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
  if (!ehPdf) return 'Só PDF.';
  if (f.size === 0) return 'O arquivo está vazio.';
  if (f.size > TAMANHO_MAXIMO_ARQUIVO) return `Tem ${tamanhoLegivel(f.size)} — o limite é 10 MB.`;
  return null;
}

export function ArquivosDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const entrada = useRef<HTMLInputElement>(null);
  const [escolhido, setEscolhido] = useState<File | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  const { data: arquivos = [], isLoading, error } = useQuery({
    queryKey: ['arquivos'],
    queryFn: listarArquivos,
    enabled: open,
    retry: false,
  });

  const subir = useMutation({
    mutationFn: (f: File) => subirArquivo(f),
    onSuccess: (a: Arquivo) => {
      qc.invalidateQueries({ queryKey: ['arquivos'] });
      toast.success(`"${a.nome}" enviado`);
      setEscolhido(null);
      if (entrada.current) entrada.current.value = '';
    },
    onError: (e) => toast.error(mensagem(e, 'Não foi possível enviar o arquivo')),
  });

  const problema = escolhido ? problemaDoArquivo(escolhido) : null;

  const copiar = async (a: Arquivo) => {
    try {
      await navigator.clipboard.writeText(a.url_publica);
      setCopiado(a.id);
      toast.success('Link copiado');
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      toast.error('Não foi possível copiar');
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => !subir.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-[640px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Arquivos</DialogTitle>
          <DialogDescription className="text-xs">
            PDF de até 10 MB, com link público que não muda. Cole o link no template — o e-mail leva o link,
            não o anexo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              ref={entrada}
              type="file"
              accept="application/pdf,.pdf"
              className="flex-1 min-w-[200px] text-xs"
              aria-label="Escolher PDF"
              onChange={e => setEscolhido(e.target.files?.[0] ?? null)}
            />
            <Button size="sm" className="gap-1.5" disabled={!escolhido || !!problema || subir.isPending}
              onClick={() => escolhido && subir.mutate(escolhido)}>
              {subir.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Enviar
            </Button>
          </div>
          {problema && <p className="text-xs text-[--on-tint-danger]" role="alert">{problema}</p>}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-[--tint-danger] border border-danger/30">
            <AlertTriangle className="h-4 w-4 text-[--on-tint-danger] flex-shrink-0 mt-0.5" />
            <p className="text-xs text-[--on-tint-danger]">
              Não foi possível carregar os arquivos ({mensagem(error, 'erro desconhecido')}).
            </p>
          </div>
        ) : arquivos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
            <FileText className="h-8 w-8 opacity-40 mb-2" />
            <p className="text-sm">Nenhum arquivo enviado</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/40 border border-border/40 rounded-lg">
            {arquivos.map(a => (
              <li key={a.id} className="flex items-center gap-3 p-3">
                <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate" title={a.nome}>{a.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    {tamanhoLegivel(a.tamanho)} · {format(new Date(a.criado_em), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                  </p>
                </div>
                <Button variant="outline" size="sm" className="gap-1.5 flex-shrink-0" onClick={() => copiar(a)}
                  aria-label={`Copiar link de ${a.nome}`}>
                  {copiado === a.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  Link
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
