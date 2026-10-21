// Campos do fluxo da prova do RD que o construtor e a criação dividem:
// o modo teste (lista de e-mails permitidos) e os identificadores de
// formulário do gatilho `form_submitted`.
import { FlaskConical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { lerListaDeEmails } from '@/lib/journeys';

export function ModoTesteCampo({ value, onChange, id = 'modo-teste' }: {
  value: string;
  onChange: (texto: string) => void;
  id?: string;
}) {
  const { validos, invalidos } = lerListaDeEmails(value);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Modo teste — só envia para estes e-mails</Label>
      <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={'erick@healthsafety.com.br\noutra.pessoa@healthsafety.com.br'}
        className="min-h-[64px] font-mono text-xs" aria-describedby={`${id}-ajuda`} />
      <p id={`${id}-ajuda`} className="text-xs text-muted-foreground">
        Com a lista preenchida, e-mail, aviso, webhook e envio ao GrowthHS só acontecem para contato
        cujo e-mail está nela — os outros passam pelo passo como "pulado". Vazia = sem modo teste.
        {validos.length > 0 && <> Valendo: {validos.length} e-mail{validos.length === 1 ? '' : 's'}.</>}
      </p>
      {invalidos.length > 0 && (
        <p className="text-xs text-[--on-tint-danger]" role="alert">
          Não parece e-mail: {invalidos.join(', ')}. Corrija antes de salvar.
        </p>
      )}
    </div>
  );
}

/** Selo do fluxo em modo teste. */
export function SeloModoTeste({ emails }: { emails: string[] | null | undefined }) {
  if (!emails || emails.length === 0) return null;
  return (
    <Badge variant="warning" className="text-xs" title={emails.join(', ')}>
      <FlaskConical className="h-3 w-3" /> Modo teste · {emails.length}
    </Badge>
  );
}

export function EntryFormIdsCampo({ value, onChange, id = 'form-ids' }: {
  value: string;
  onChange: (texto: string) => void;
  id?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Ou nestes formulários de site (identificadores)</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder="prova_cap_phoebus, prova_ficha_phoebus" className="font-mono text-xs"
        aria-describedby={`${id}-ajuda`} />
      <p id={`${id}-ajuda`} className="text-xs text-muted-foreground">
        O identificador é o <code>id</code> do formulário no site (o que aparece nos números da tela de
        Páginas). Separe por vírgula. Com página e formulários, entra quem converter na página <strong>ou</strong> em
        qualquer um deles; sem nenhum dos dois, qualquer origem.
      </p>
    </div>
  );
}

/** "a, b\nc" → ["a", "b", "c"]. */
export const lerFormIds = (texto: string) =>
  [...new Set(texto.split(/[\s,;]+/).map((f) => f.trim()).filter(Boolean))];
