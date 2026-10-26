import { LeadsImport } from '@/components/admin/LeadsImport';

// Pergunta 80 (26/10/2026): a aba "DataCore (ERP)" saiu com a sincronização —
// a base de clientes do ERP não entra mais no MarketingHS. Sobrou o CSV, e
// uma aba sozinha não é aba.
export default function ImportPage() {
  return (
    <div className="space-y-6">
      {/* A topbar já escreve "Importar" (AdminLayout) — título duplicado sai daqui. */}
      <LeadsImport />
    </div>
  );
}
