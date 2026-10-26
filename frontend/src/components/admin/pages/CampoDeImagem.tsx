import { useRef, useState } from 'react';
import { ImageUp, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { enderecoDaImagem } from '@/landing/campos';
import { BASE, ErroApi } from '@/lib/api';
import { subirImagemDeEmail } from '@/lib/config';

// A mesma régua do servidor (`app/captura/urls.py::url_segura`): http(s) com
// host, ou caminho do próprio site — nunca `//host`; barra invertida, tab,
// quebra de linha e NUL recusados (espaço comum, o servidor aceita). Avisar
// aqui poupa a surpresa do 400 no salvamento automático.
function urlAceita(url: string): boolean {
  const u = url.trim();
  if (!u) return true;
  if (/[\\\t\r\n\0]/.test(u)) return false;
  return /^https?:\/\/[^/:?#@\s]/i.test(u) || (u.startsWith('/') && !u.startsWith('//'));
}

// Imagem de página: URL colada ou arquivo subido (o upload devolve o caminho
// publico/imagem/<id>), com prévia. Um componente só para a imagem do topo e
// para as das seções — o upload não se copia.
export function CampoDeImagem({ id, rotulo, valor, onChange, ajuda }: {
  id: string;
  rotulo: string;
  valor: string;
  onChange: (url: string) => void;
  ajuda?: string;
}) {
  const [subindo, setSubindo] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);
  // ⚠️ O upload termina segundos depois do clique. O `onChange` daquela
  // renderização carrega a lista de seções DAQUELE momento: chamá-lo gravaria
  // a lista velha por cima do que se digitou (ou de outro upload) enquanto
  // isso. O ref guarda sempre o da última renderização (revisão, 26/10).
  const onChangeAtual = useRef(onChange);
  onChangeAtual.current = onChange;

  const subir = async (arquivo: File) => {
    setSubindo(true);
    try {
      const { url } = await subirImagemDeEmail(arquivo, 'campaigns');
      onChangeAtual.current(url);
    } catch (e) {
      toast.error(e instanceof ErroApi ? e.message : 'Erro ao subir a imagem');
    } finally {
      setSubindo(false);
      if (arquivoRef.current) arquivoRef.current.value = '';
    }
  };

  const aceita = urlAceita(valor || '');
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{rotulo}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          value={valor || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://… ou suba um arquivo"
          className="flex-1 min-w-48"
          aria-invalid={aceita ? undefined : true}
          aria-describedby={aceita ? undefined : `${id}-erro`}
        />
        <input
          ref={arquivoRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) subir(f); }}
        />
        <Button type="button" variant="outline" size="sm" disabled={subindo}
                onClick={() => arquivoRef.current?.click()}>
          {subindo ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ImageUp className="h-4 w-4 mr-1" />}
          Subir imagem
        </Button>
        {valor && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')}>
            Tirar
          </Button>
        )}
      </div>
      {!aceita && (
        <p id={`${id}-erro`} className="text-xs text-[--on-tint-danger]">
          Endereço não aceito: use https://… ou suba o arquivo. O servidor recusa, e nenhuma alteração da página é salva até corrigir.
        </p>
      )}
      {valor && aceita && (
        <img
          src={enderecoDaImagem(valor, BASE)}
          alt={`Prévia: ${rotulo}`}
          className="max-h-40 rounded-lg border border-borda object-contain"
        />
      )}
      {ajuda && <p className="text-xs text-muted-foreground">{ajuda}</p>}
    </div>
  );
}
