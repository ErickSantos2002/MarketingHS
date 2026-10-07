import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePages } from '@/hooks/usePages';

// Filtro de página do gatilho "Formulário enviado" (R5). Vazio = qualquer
// página. O valor é o SLUG — é o que a captura e `POST /publico/conversao`
// gravam no evento, e o que `journey_enroll_event` compara (migration 026).
const QUALQUER = '__qualquer__';

interface Props {
  value: string;
  onChange: (slug: string) => void;
}

export function EntryPageSelect({ value, onChange }: Props) {
  const { pages, isLoading } = usePages();
  // Enquanto a lista carrega, nenhum slug salvo é "desconhecido".
  const conhecida = !value || isLoading || pages.some((p) => p.slug === value);

  return (
    <div className="space-y-1.5">
      <Label>Em qual página</Label>
      <Select value={value || QUALQUER} onValueChange={(v) => onChange(v === QUALQUER ? '' : v)}>
        <SelectTrigger><SelectValue placeholder="Qualquer página" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={QUALQUER}>Qualquer página</SelectItem>
          {pages.map((p) => (
            <SelectItem key={p.id} value={p.slug}>{p.name} ({p.slug})</SelectItem>
          ))}
          {!conhecida && <SelectItem value={value}>{value} (página não encontrada)</SelectItem>}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Com uma página escolhida, o fluxo começa na hora em que alguém converte nela — contato novo ou que já
        estava na base. Se o endereço (slug) da página mudar, o fluxo para de disparar até você escolher a
        página de novo aqui.
      </p>
    </div>
  );
}
