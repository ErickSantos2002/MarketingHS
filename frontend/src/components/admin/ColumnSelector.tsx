import { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Settings2, GripVertical, RotateCcw } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';

const STORAGE_KEY = 'leads-table-columns';
const ORDER_STORAGE_KEY = 'leads-table-column-order';

export interface ColumnConfig {
  key: string;
  label: string;
  defaultVisible: boolean;
}

export const ALL_COLUMNS: ColumnConfig[] = [
  { key: 'last_conversion_date', label: 'Última Conversão', defaultVisible: true },
  { key: 'tipo', label: 'Tipo', defaultVisible: true },
  { key: 'status', label: 'Status', defaultVisible: true },
  { key: 'tipo_participante', label: 'Participante', defaultVisible: true },
  { key: 'nome', label: 'Nome', defaultVisible: true },
  { key: 'email', label: 'Email', defaultVisible: true },
  { key: 'whatsapp', label: 'WhatsApp', defaultVisible: true },
  { key: 'indicacao', label: 'Quem te indicou? *', defaultVisible: true },
  { key: 'empresa', label: 'Empresa', defaultVisible: true },
  { key: 'cargo', label: 'Cargo', defaultVisible: true },
  { key: 'faturamento', label: 'Faturamento', defaultVisible: true },
  { key: 'ecosystem', label: 'Ecossistema', defaultVisible: true },
  { key: 'tags', label: 'Tags', defaultVisible: true },
  { key: 'utm_source', label: 'UTM Source', defaultVisible: true },
  { key: 'utm_medium', label: 'UTM Medium', defaultVisible: true },
  { key: 'utm_campaign', label: 'UTM Campaign', defaultVisible: true },
  { key: 'presenca', label: 'Presença', defaultVisible: true },
  { key: 'lead_score', label: 'Score', defaultVisible: true },
  { key: 'etiqueta', label: 'Etiqueta', defaultVisible: false },
  { key: 'origem_campanha', label: 'Origem Campanha', defaultVisible: false },
  { key: 'funcionarios', label: 'Funcionários', defaultVisible: false },
  { key: 'desafios', label: 'Desafios', defaultVisible: false },
  { key: 'source', label: 'Source', defaultVisible: false },
  { key: 'utm_term', label: 'UTM Term', defaultVisible: false },
  { key: 'utm_content', label: 'UTM Content', defaultVisible: true },
  { key: 'session_id', label: 'Session ID', defaultVisible: false },
  { key: 'created_at', label: 'Data de Criação', defaultVisible: false },
  { key: 'interesse_ecossistema', label: 'Interesse Ecossistema', defaultVisible: false },
  { key: 'interesse_mtia', label: 'Interesse MTIA', defaultVisible: false },
  { key: 'interesse_formacao', label: 'Interesse Formação', defaultVisible: false },
  { key: 'data_interesse', label: 'Data Interesse', defaultVisible: false },
];

const getDefaultColumns = (): string[] =>
  ALL_COLUMNS.filter(c => c.defaultVisible).map(c => c.key);

const getDefaultOrder = (): string[] =>
  ALL_COLUMNS.map(c => c.key);

function loadFromLocalStorage(): { visible: string[]; order: string[] } {
  try {
    const storedVisible = localStorage.getItem(STORAGE_KEY);
    const storedOrder = localStorage.getItem(ORDER_STORAGE_KEY);
    const allKeys = ALL_COLUMNS.map(c => c.key);

    let visible = getDefaultColumns();
    if (storedVisible) {
      const parsed = JSON.parse(storedVisible) as string[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        visible = parsed.filter(k => allKeys.includes(k));
      }
    }

    let order = getDefaultOrder();
    if (storedOrder) {
      const parsed = JSON.parse(storedOrder) as string[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        const missing = allKeys.filter(k => !parsed.includes(k));
        order = [...parsed.filter(k => allKeys.includes(k)), ...missing];
      }
    }

    return { visible, order };
  } catch {
    return { visible: getDefaultColumns(), order: getDefaultOrder() };
  }
}

function saveToLocalStorage(visible: string[], order: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(visible));
  localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(order));
}

export function useColumnSettings() {
  const initial = loadFromLocalStorage();
  const [visibleColumns, setVisibleColumns] = useState<string[]>(initial.visible);
  const [columnOrder, setColumnOrder] = useState<string[]>(initial.order);
  const [dbLoaded, setDbLoaded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist to DB (debounced)
  const persistToDb = useCallback((visible: string[], order: string[]) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const settingKey = `column_prefs_${user.id}`;
        await supabase.from('dashboard_settings').upsert(
          { setting_key: settingKey, setting_value: { visibleColumns: visible, columnOrder: order } as any },
          { onConflict: 'setting_key' }
        );
      } catch (e) {
        console.error('Failed to persist column prefs:', e);
      }
    }, 1000);
  }, []);

  // Load from DB on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        const settingKey = `column_prefs_${user.id}`;
        const { data } = await supabase
          .from('dashboard_settings')
          .select('setting_value')
          .eq('setting_key', settingKey)
          .maybeSingle();

        if (cancelled) return;
        if (data?.setting_value) {
          const val = data.setting_value as any;
          const allKeys = ALL_COLUMNS.map(c => c.key);
          if (Array.isArray(val.visibleColumns) && val.visibleColumns.length > 0) {
            const v = (val.visibleColumns as string[]).filter(k => allKeys.includes(k));
            setVisibleColumns(v);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
          }
          if (Array.isArray(val.columnOrder) && val.columnOrder.length > 0) {
            const missing = allKeys.filter(k => !(val.columnOrder as string[]).includes(k));
            const o = [...(val.columnOrder as string[]).filter(k => allKeys.includes(k)), ...missing];
            setColumnOrder(o);
            localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(o));
          }
        }
      } catch (e) {
        console.error('Failed to load column prefs from DB:', e);
      } finally {
        if (!cancelled) setDbLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const updateColumns = useCallback((columns: string[]) => {
    setVisibleColumns(columns);
    setColumnOrder(prev => {
      saveToLocalStorage(columns, prev);
      persistToDb(columns, prev);
      return prev;
    });
  }, [persistToDb]);

  const updateOrder = useCallback((order: string[]) => {
    setColumnOrder(order);
    setVisibleColumns(prev => {
      saveToLocalStorage(prev, order);
      persistToDb(prev, order);
      return prev;
    });
  }, [persistToDb]);

  const resetOrder = useCallback(() => {
    const defaultOrder = getDefaultOrder();
    setColumnOrder(defaultOrder);
    setVisibleColumns(prev => {
      saveToLocalStorage(prev, defaultOrder);
      persistToDb(prev, defaultOrder);
      return prev;
    });
  }, [persistToDb]);

  return { visibleColumns, updateColumns, columnOrder, updateOrder, resetOrder };
}

/** @deprecated Use useColumnSettings instead */
export const useVisibleColumns = useColumnSettings;

interface ColumnSelectorProps {
  visibleColumns: string[];
  onColumnsChange: (columns: string[]) => void;
  columnOrder: string[];
  onOrderChange: (order: string[]) => void;
  onResetOrder: () => void;
}

export function ColumnSelector({
  visibleColumns,
  onColumnsChange,
  columnOrder,
  onOrderChange,
  onResetOrder,
}: ColumnSelectorProps) {
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);

  const orderedColumns = columnOrder
    .map(key => ALL_COLUMNS.find(c => c.key === key)!)
    .filter(Boolean);

  const toggleColumn = (key: string) => {
    const next = visibleColumns.includes(key)
      ? visibleColumns.filter(k => k !== key)
      : [...visibleColumns, key];
    onColumnsChange(next);
  };

  const selectAll = () => onColumnsChange(ALL_COLUMNS.map(c => c.key));
  const deselectAll = () => onColumnsChange([]);

  const handleDragStart = (index: number) => {
    dragIndexRef.current = index;
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    const dragIndex = dragIndexRef.current;
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragOverIndex(null);
      return;
    }

    const newOrder = [...columnOrder];
    const [moved] = newOrder.splice(dragIndex, 1);
    newOrder.splice(dropIndex, 0, moved);
    onOrderChange(newOrder);

    dragIndexRef.current = null;
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    dragIndexRef.current = null;
    setDragOverIndex(null);
  };

  const visibleCount = visibleColumns.length;
  const isDefaultOrder = columnOrder.every((key, i) => key === ALL_COLUMNS[i]?.key);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 className="h-4 w-4 mr-2" />
          Colunas ({visibleCount})
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <div className="p-3 border-b space-y-2">
          <p className="text-sm font-medium">Colunas visíveis</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="text-xs h-7 flex-1" onClick={selectAll}>
              Marcar todas
            </Button>
            <Button variant="outline" size="sm" className="text-xs h-7 flex-1" onClick={deselectAll}>
              Desmarcar todas
            </Button>
          </div>
          {!isDefaultOrder && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7 w-full text-muted-foreground"
              onClick={onResetOrder}
            >
              <RotateCcw className="h-3 w-3 mr-1.5" />
              Resetar ordem
            </Button>
          )}
        </div>
        <ScrollArea className="h-[320px]">
          <div className="p-2 space-y-0.5">
            {orderedColumns.map((col, index) => (
              <div
                key={col.key}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
                className={`flex items-center gap-1.5 px-1.5 py-1.5 rounded-md hover:bg-muted/50 cursor-grab active:cursor-grabbing text-sm transition-colors ${
                  dragOverIndex === index ? 'bg-primary/10 border border-primary/30' : ''
                }`}
              >
                <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50 flex-shrink-0" />
                <Checkbox
                  checked={visibleColumns.includes(col.key)}
                  onCheckedChange={() => toggleColumn(col.key)}
                />
                <span className="select-none">{col.label}</span>
              </div>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
