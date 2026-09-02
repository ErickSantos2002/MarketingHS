import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LeadsImport } from '@/components/admin/LeadsImport';
import { DatacoreImport } from '@/components/admin/DatacoreImport';

export default function ImportPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Importar</h1>
      <Tabs defaultValue="csv">
        <TabsList>
          <TabsTrigger value="csv">Arquivo CSV</TabsTrigger>
          <TabsTrigger value="datacore">DataCore (ERP)</TabsTrigger>
        </TabsList>
        <TabsContent value="csv" className="pt-4"><LeadsImport /></TabsContent>
        <TabsContent value="datacore" className="pt-4"><DatacoreImport /></TabsContent>
      </Tabs>
    </div>
  );
}
