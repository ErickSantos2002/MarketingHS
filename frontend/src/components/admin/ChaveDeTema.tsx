// Botão da topbar que alterna claro/escuro. O estado vive na classe `dark` do
// <html> e no localStorage — ver src/lib/tema.ts.
import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { alternarTema, lerTema, type Tema } from '@/lib/tema';

export function ChaveDeTema() {
  const [tema, setTema] = useState<Tema>(() => lerTema());
  const escuro = tema === 'escuro';
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTema(alternarTema())}
      aria-label={escuro ? 'Mudar para o tema claro' : 'Mudar para o tema escuro'}
      title={escuro ? 'Tema claro' : 'Tema escuro'}
    >
      {escuro ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
