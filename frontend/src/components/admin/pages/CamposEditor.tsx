import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  CHAVE_DE_CAMPO, ROTULOS_PADRAO, type CampoDaPagina, type TipoDeCampo,
} from '@/landing/campos';

// As colunas de `leads` que um campo pode preencher — a lista branca do
// servidor (`app/captura/campos.py::CAMPOS_PERMITIDOS`) menos o que não é
// pergunta de formulário (status, tipo, source, UTMs, A/B) e o vocabulário da
// dn.ia. Qualquer outra chave vira dado personalizado (`leads.campos_extras`),
// usável em segmento e em condição de jornada.
const COLUNAS: { chave: string; rotulo: string }[] = [
  { chave: 'nome', rotulo: 'Nome' },
  { chave: 'whatsapp', rotulo: 'Celular / WhatsApp' },
  { chave: 'empresa', rotulo: 'Empresa' },
  { chave: 'cargo', rotulo: 'Cargo' },
  { chave: 'funcionarios', rotulo: 'Número de colaboradores' },
  { chave: 'faturamento', rotulo: 'Faturamento' },
  { chave: 'desafios', rotulo: 'Desafios' },
];
const CHAVES_DE_COLUNA = new Set(COLUNAS.map((c) => c.chave));
const PERSONALIZADO = '__personalizado__';

const TIPOS: { valor: TipoDeCampo; rotulo: string }[] = [
  { valor: 'texto', rotulo: 'Texto' },
  { valor: 'telefone', rotulo: 'Telefone (Brasil)' },
  { valor: 'lista', rotulo: 'Lista de opções' },
  { valor: 'sim_nao', rotulo: 'Sim / Não' },
  { valor: 'texto_longo', rotulo: 'Texto longo' },
];

function erroDaChave(campo: CampoDaPagina, todos: CampoDaPagina[]): string | null {
  if (campo.chave === 'email') return null;
  if (!campo.chave) return 'Informe a chave do campo.';
  if (!CHAVE_DE_CAMPO.test(campo.chave)) {
    return 'Use letras minúsculas, números e _, começando por letra (até 40).';
  }
  if (campo.chave === 'website') return 'Chave reservada (é o campo-isca contra robô).';
  if (todos.filter((c) => c.chave === campo.chave).length > 1) return 'Outro campo já usa esta chave.';
  return null;
}

// Opções de uma lista, uma por linha. O texto cru fica em estado local: se o
// valor mostrado fosse o array já aparado, a linha em branco que a pessoa
// acabou de abrir com Enter sumiria a cada tecla.
function OpcoesDaLista({ opcoes, onChange, id }: {
  opcoes: string[]; onChange: (o: string[]) => void; id: string;
}) {
  const [texto, setTexto] = useState(opcoes.join('\n'));
  useEffect(() => {
    const atual = texto.split('\n').map((o) => o.trim()).filter(Boolean);
    if (atual.join('\n') !== opcoes.join('\n')) setTexto(opcoes.join('\n'));
    // Só ressincroniza quando as opções mudam por fora (ex.: trocar a ordem).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opcoes.join('\n')]);
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">Opções (uma por linha)</Label>
      <Textarea
        id={id}
        rows={3}
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          onChange(e.target.value.split('\n').map((o) => o.trim()).filter(Boolean));
        }}
        placeholder={'Até 50 colaboradores\n51 a 200\nMais de 200'}
      />
      {opcoes.length === 0 && (
        <p className="text-xs text-[--on-tint-danger]">Lista sem opção não aparece no formulário.</p>
      )}
    </div>
  );
}

export function CamposEditor({ campos, onChange }: {
  campos: CampoDaPagina[];
  onChange: (c: CampoDaPagina[]) => void;
}) {
  const trocar = (i: number, parcial: Partial<CampoDaPagina>) => {
    onChange(campos.map((c, j) => (j === i ? { ...c, ...parcial } : c)));
  };
  const mover = (i: number, passo: -1 | 1) => {
    const j = i + passo;
    if (j < 0 || j >= campos.length) return;
    const proximo = [...campos];
    [proximo[i], proximo[j]] = [proximo[j], proximo[i]];
    onChange(proximo);
  };
  const remover = (i: number) => onChange(campos.filter((_, j) => j !== i));
  const adicionar = () => {
    const livre = COLUNAS.find((c) => !campos.some((x) => x.chave === c.chave));
    onChange([
      ...campos,
      livre
        ? { chave: livre.chave, rotulo: livre.rotulo, tipo: livre.chave === 'whatsapp' ? 'telefone' : 'texto', obrigatorio: false }
        : { chave: '', rotulo: '', tipo: 'texto', obrigatorio: false },
    ]);
  };

  return (
    <div className="space-y-3">
      {campos.map((campo, i) => {
        const ehEmail = campo.chave === 'email';
        const personalizado = !ehEmail && !CHAVES_DE_COLUNA.has(campo.chave);
        const erro = erroDaChave(campo, campos);
        const prefixo = `campo-${i}`;
        return (
          <div key={i} className="rounded-lg border border-borda bg-surface p-3 space-y-3">
            <div className="flex items-start gap-2">
              <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor={`${prefixo}-rotulo`} className="text-xs">Rótulo</Label>
                  <Input
                    id={`${prefixo}-rotulo`}
                    value={campo.rotulo}
                    onChange={(e) => trocar(i, { rotulo: e.target.value })}
                    placeholder={ROTULOS_PADRAO[campo.chave] ?? 'Pergunta mostrada na página'}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Grava em</Label>
                  {ehEmail ? (
                    <Input value="E-mail (sempre presente)" disabled />
                  ) : (
                    <Select
                      value={personalizado ? PERSONALIZADO : campo.chave}
                      onValueChange={(v) => {
                        if (v === PERSONALIZADO) {
                          trocar(i, { chave: '' });
                        } else {
                          const coluna = COLUNAS.find((c) => c.chave === v);
                          trocar(i, {
                            chave: v,
                            rotulo: campo.rotulo || coluna?.rotulo || '',
                            ...(v === 'whatsapp' ? { tipo: 'telefone' as const } : {}),
                          });
                        }
                      }}
                    >
                      <SelectTrigger aria-label="Coluna do contato"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {COLUNAS.map((c) => (
                          <SelectItem key={c.chave} value={c.chave}
                                      disabled={c.chave !== campo.chave && campos.some((x) => x.chave === c.chave)}>
                            {c.rotulo}
                          </SelectItem>
                        ))}
                        <SelectItem value={PERSONALIZADO}>Personalizado…</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
                {personalizado && (
                  <div className="space-y-1">
                    <Label htmlFor={`${prefixo}-chave`} className="text-xs">Chave do dado personalizado</Label>
                    <Input
                      id={`${prefixo}-chave`}
                      value={campo.chave}
                      onChange={(e) => trocar(i, { chave: e.target.value.trim().toLowerCase() })}
                      placeholder="ja_faz_testagem"
                      className="font-mono text-xs"
                      aria-invalid={erro ? true : undefined}
                      aria-describedby={erro ? `${prefixo}-chave-erro` : undefined}
                    />
                    {erro && (
                      <p id={`${prefixo}-chave-erro`} className="text-xs text-[--on-tint-danger]">{erro}</p>
                    )}
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-xs">Tipo</Label>
                  {ehEmail ? (
                    <Input value="E-mail" disabled />
                  ) : (
                    <Select value={campo.tipo}
                            onValueChange={(v) => trocar(i, {
                              tipo: v as TipoDeCampo,
                              ...(v === 'lista' ? { opcoes: campo.opcoes ?? [] } : {}),
                            })}>
                      <SelectTrigger aria-label="Tipo do campo"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TIPOS.map((t) => <SelectItem key={t.valor} value={t.valor}>{t.rotulo}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <Button type="button" variant="ghost" size="icon" aria-label="Subir campo"
                        disabled={i === 0} onClick={() => mover(i, -1)}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="icon" aria-label="Descer campo"
                        disabled={i === campos.length - 1} onClick={() => mover(i, 1)}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                {!ehEmail && (
                  <Button type="button" variant="ghost" size="icon" aria-label="Remover campo"
                          onClick={() => remover(i)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            {campo.tipo === 'lista' && !ehEmail && (
              <OpcoesDaLista id={`${prefixo}-opcoes`} opcoes={campo.opcoes ?? []}
                             onChange={(opcoes) => trocar(i, { opcoes })} />
            )}
            <div className="flex items-center gap-2">
              <Switch
                id={`${prefixo}-obrigatorio`}
                checked={ehEmail || campo.obrigatorio}
                disabled={ehEmail}
                onCheckedChange={(v) => trocar(i, { obrigatorio: v })}
              />
              <Label htmlFor={`${prefixo}-obrigatorio`} className="text-xs">
                Obrigatório{ehEmail && ' (o e-mail é sempre obrigatório)'}
              </Label>
            </div>
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" onClick={adicionar}>
        <Plus className="h-4 w-4 mr-1" /> Novo campo
      </Button>
    </div>
  );
}
