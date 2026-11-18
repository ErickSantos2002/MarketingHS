import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { BellRing, Loader2, Save, Send } from 'lucide-react';
import { ErroApi } from '@/lib/api';
import { toast } from 'sonner';
import {
  gravarConfigAvisoLead, lerConfigAvisoLead, testarAvisoLead, type ConfigAvisoLead,
} from '@/lib/config';

// Aviso de lead a vendas. "Enviar teste" manda e-mail de verdade para quem
// estiver salvo — vale o que está gravado, não o que está digitado.
export default function AvisoDeLeadCard() {
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [ligado, setLigado] = useState(true);
  const [para, setPara] = useState('');
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  const aplicar = (c: ConfigAvisoLead) => {
    setLigado(c.ligado);
    setPara(c.padrao ? '' : c.para.join(', '));
  };

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setErroCarga(null);
    (async () => {
      try {
        const c = await lerConfigAvisoLead();
        if (vivo) aplicar(c);
      } catch (e) {
        // Sem a config carregada não há formulário: salvar os padrões por cima
        // do que está gravado seria pior que não mostrar nada.
        if (vivo) setErroCarga(e instanceof ErroApi ? e.message : 'Falha ao carregar o aviso de lead.');
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [tentativa]);

  const salvar = async () => {
    setSalvando(true);
    try {
      aplicar(await gravarConfigAvisoLead({ ligado, para }));
      toast.success('Aviso de lead salvo');
    } catch (e) {
      toast.error('Falha ao salvar o aviso de lead', {
        description: e instanceof ErroApi ? e.message : undefined,
      });
    } finally {
      setSalvando(false);
    }
  };

  const testar = async () => {
    setTestando(true);
    try {
      const r = await testarAvisoLead();
      if (r.enviados.length) {
        toast.success(`Teste enviado para ${r.enviados.join(', ')}`);
      }
      for (const f of r.falhas) {
        toast.error(`Falhou para ${f.para}`, { description: f.erro });
      }
    } catch (e) {
      toast.error('Falha ao enviar o teste', {
        description: e instanceof ErroApi ? e.message : undefined,
      });
    } finally {
      setTestando(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="h-5 w-5" /> Aviso de lead
        </CardTitle>
        <CardDescription>
          A cada lead que chega por formulário, um e-mail para a equipe de vendas — responder vai direto para o lead.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {carregando ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : erroCarga !== null ? (
          <div className="space-y-3">
            <p className="text-sm text-destructive">Não foi possível carregar o aviso de lead. {erroCarga}</p>
            <Button variant="outline" onClick={() => setTentativa((n) => n + 1)}>
              Tentar de novo
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <Switch id="aviso-lead-ligado" checked={ligado} onCheckedChange={setLigado} />
              <Label htmlFor="aviso-lead-ligado">Enviar aviso</Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="aviso-lead-para">Enviar para</Label>
              <Input
                id="aviso-lead-para"
                value={para}
                onChange={(e) => setPara(e.target.value)}
                placeholder="vendas@healthsafetytech.com"
              />
              <p className="text-xs text-muted-foreground">
                Vários endereços separados por vírgula. Vazio = vendas@healthsafetytech.com
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={salvar} disabled={salvando || testando}>
                {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Salvar
              </Button>
              <Button variant="outline" onClick={testar} disabled={salvando || testando}>
                {testando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Enviar teste
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
