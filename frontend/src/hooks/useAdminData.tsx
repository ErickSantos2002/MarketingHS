import { createContext, useContext, useState, useMemo, ReactNode } from 'react';
import { useLeads, type LeadsFilters } from '@/hooks/useLeads';
import { useDashboardFilters, applyFilters } from '@/hooks/useDashboardFilters';
import { useLeadQualification } from '@/hooks/useLeadQualification';
import { useColumnSettings } from '@/components/admin/ColumnSelector';
import { useLeadConversionUtmContents } from '@/hooks/useLeadConversionUtmContents';

interface AdminDataContextType {
  // Leads
  leads: ReturnType<typeof useLeads>['leads'];
  allLeads: ReturnType<typeof useLeads>['allLeads'];
  isLoading: boolean;
  refetch: () => void;
  
  // Legacy filters (for Contacts/Leads table)
  legacyFilters: LeadsFilters;
  setLegacyFilters: React.Dispatch<React.SetStateAction<LeadsFilters>>;
  
  // Dashboard filters
  dashboardFilters: ReturnType<typeof useDashboardFilters>;
  
  // Filtered & enriched leads
  filteredLeads: ReturnType<typeof useLeadQualification>['enrichedLeads'];
  allEnrichedLeads: ReturnType<typeof useLeadQualification>['enrichedLeads'];
  
  // Column settings
  columnSettings: ReturnType<typeof useColumnSettings>;
  
  // Hot metrics toggle
  showHotMetrics: boolean;
  setShowHotMetrics: React.Dispatch<React.SetStateAction<boolean>>;
}

const AdminDataContext = createContext<AdminDataContextType | undefined>(undefined);

export function AdminDataProvider({ children }: { children: ReactNode }) {
  const [legacyFilters, setLegacyFilters] = useState<LeadsFilters>({});
  const [showHotMetrics, setShowHotMetrics] = useState(false);
  const columnSettings = useColumnSettings();
  const { leads, allLeads, isLoading, refetch } = useLeads(legacyFilters);
  const dashboardFilters = useDashboardFilters();
  const utmContentHistoryMap = useLeadConversionUtmContents();
  
  const { enrichedLeads: baseEnrichedLeads } = useLeadQualification(allLeads);
  
  // Attach conversion-history utm_contents so the UTM Content filter can OR across history.
  const allEnrichedLeads = useMemo(() => {
    return baseEnrichedLeads.map(lead => ({
      ...lead,
      all_utm_contents: utmContentHistoryMap[lead.id] || [],
    }));
  }, [baseEnrichedLeads, utmContentHistoryMap]);
  
  // Apply dashboard filters + search filter
  const filteredLeads = useMemo(() => {
    let result = applyFilters(allEnrichedLeads, dashboardFilters.filters);
    
    if (legacyFilters.search) {
      const q = legacyFilters.search.toLowerCase();
      result = result.filter(l =>
        (l.nome && l.nome.toLowerCase().includes(q)) ||
        (l.email && l.email.toLowerCase().includes(q)) ||
        (l.empresa && l.empresa.toLowerCase().includes(q)) ||
        (l.whatsapp && l.whatsapp.includes(q))
      );
    }
    
    return result;
  }, [allEnrichedLeads, dashboardFilters.filters, legacyFilters.search]);

  return (
    <AdminDataContext.Provider value={{
      leads, allLeads, isLoading, refetch,
      legacyFilters, setLegacyFilters,
      dashboardFilters,
      filteredLeads, allEnrichedLeads,
      columnSettings,
      showHotMetrics, setShowHotMetrics,
    }}>
      {children}
    </AdminDataContext.Provider>
  );
}

export function useAdminData() {
  const context = useContext(AdminDataContext);
  if (!context) throw new Error('useAdminData must be used within AdminDataProvider');
  return context;
}
