import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import logoHs from '@/assets/logo-hs.png';
import {
  LayoutDashboard, BarChart2, Users, Filter, Send, Layout,
  Upload, Settings, ChevronLeft, ChevronRight, ChevronDown,
  ChevronRight as ChevronRightSm, X, Zap, LayoutTemplate, FlaskConical,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const SIDEBAR_COLLAPSED_KEY = 'marketinghs-sidebar-collapsed';
// Chave do dn.marketing, lida uma única vez na inicialização abaixo para não
// perder a preferência de quem já usa o sistema, e apagada depois de lida.
const SIDEBAR_COLLAPSED_KEY_ANTIGA = 'dnmarketing-sidebar-collapsed';

interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
  badge?: string;
  disabled?: boolean;
  children?: { label: string; path: string }[];
}

const MAIN_ITEMS: NavItem[] = [
  { label: 'Visão Geral', path: '/', icon: LayoutDashboard },
  {
    label: 'Analytics', path: '/analytics', icon: BarChart2,
    children: [
      { label: 'Perfil', path: '/analytics?tab=profile' },
      { label: 'Desafios', path: '/analytics?tab=challenges' },
      { label: 'Tático', path: '/analytics?tab=tactical' },
      { label: 'Operacional', path: '/analytics?tab=operational' },
      { label: 'Insights', path: '/analytics?tab=insights' },
    ],
  },
  { label: 'Contatos', path: '/contacts', icon: Users },
  { label: 'Segmentos', path: '/segments', icon: Filter },
  { label: 'Campanhas', path: '/campaigns', icon: Send },
  { label: 'Templates', path: '/templates', icon: LayoutTemplate },
  { label: 'Automações', path: '/automations', icon: Zap },
  { label: 'Testes A/B', path: '/experiments', icon: FlaskConical },
  { label: 'Páginas', path: '/pages', icon: Layout },
];

const SYSTEM_ITEMS: NavItem[] = [
  { label: 'Importar', path: '/import', icon: Upload },
  { label: 'Configurações', path: '/settings', icon: Settings },
];

interface AdminSidebarProps {
  // O botão que abre o menu do celular mudou de lugar (foi para a topbar em
  // AdminLayout), então o estado sobe também — a sidebar só recebe e reage.
  mobileOpen: boolean;
  onMobileOpenChange: (aberto: boolean) => void;
}

export function AdminSidebar({ mobileOpen, onMobileOpenChange }: AdminSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const atual = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      if (atual !== null) return atual === 'true';
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY_ANTIGA) === 'true';
    } catch {
      return false;
    }
  });
  const [analyticsOpen, setAnalyticsOpen] = useState(
    location.pathname.startsWith('/analytics')
  );

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
      // A leitura da chave antiga já aconteceu na inicialização do estado
      // acima; a partir daqui ela não faz mais falta.
      localStorage.removeItem(SIDEBAR_COLLAPSED_KEY_ANTIGA);
    } catch {}
  }, [collapsed]);

  useEffect(() => {
    if (location.pathname.startsWith('/analytics')) {
      setAnalyticsOpen(true);
    }
  }, [location.pathname]);

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    if (path.includes('?')) {
      const [basePath, query] = path.split('?');
      return location.pathname === basePath && location.search.includes(query);
    }
    return location.pathname.startsWith(path);
  };

  const handleNav = (item: NavItem) => {
    if (item.disabled) return;
    if (item.children && !collapsed) {
      setAnalyticsOpen(!analyticsOpen);
      if (!location.pathname.startsWith('/analytics')) {
        navigate('/analytics');
      }
    } else {
      navigate(item.path);
    }
  };

  const renderItem = (item: NavItem) => {
    const active = isActive(item.path);
    const Icon = item.icon;
    const hasChildren = !!item.children;

    const content = (
      <button
        onClick={() => handleNav(item)}
        disabled={item.disabled}
        className={cn(
          'group relative flex w-full items-center gap-3 rounded-lg border-l-2 border-transparent px-3 py-2 text-sm font-medium text-conteudo-muted transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          !active && !item.disabled && 'hover:bg-surface-elevated',
          active && !item.disabled && 'border-action bg-action-tint text-action',
          item.disabled && 'cursor-not-allowed opacity-50',
          collapsed && 'justify-center border-l-0 py-2.5',
        )}
      >
        <Icon className={cn('h-5 w-5 shrink-0', active && !item.disabled && 'text-action')} />
        {!collapsed && (
          <>
            <span className="flex-1 truncate text-left">{item.label}</span>
            {item.badge && (
              <span className="rounded-full bg-surface-elevated px-1.5 py-0.5 text-[10px] font-normal text-conteudo-muted">
                {item.badge}
              </span>
            )}
            {hasChildren && (
              analyticsOpen
                ? <ChevronDown className="h-4 w-4 shrink-0" />
                : <ChevronRightSm className="h-4 w-4 shrink-0" />
            )}
          </>
        )}
      </button>
    );

    if (collapsed) {
      return (
        <Tooltip key={item.path} delayDuration={0}>
          <TooltipTrigger asChild>{content}</TooltipTrigger>
          <TooltipContent side="right" className="flex items-center gap-2">
            {item.label}
            {item.badge && <span className="text-xs text-conteudo-muted">({item.badge})</span>}
          </TooltipContent>
        </Tooltip>
      );
    }

    return <div key={item.path}>{content}</div>;
  };

  const renderChildren = (item: NavItem) => {
    if (!item.children || collapsed || !analyticsOpen) return null;
    return (
      <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-4">
        {item.children.map(child => {
          const active = isActive(child.path);
          return (
            <button
              key={child.path}
              onClick={() => navigate(child.path.split('?')[0] + '?' + child.path.split('?')[1])}
              className={cn(
                'w-full rounded-md px-3 py-1.5 text-left text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active ? 'bg-action-tint text-action' : 'text-conteudo-muted hover:bg-surface-elevated hover:text-conteudo',
              )}
            >
              {child.label}
            </button>
          );
        })}
      </div>
    );
  };

  const sidebarContent = (
    <div className={cn(
      'flex h-full flex-col border-r border-border bg-surface',
      collapsed ? 'w-[4.5rem]' : 'w-64',
      'transition-[width] duration-300',
    )}>
      {/* Cabeçalho — mesma altura da topbar; só o logo, sempre centrado */}
      <div className="flex h-16 items-center justify-center px-5">
        <img src={logoHs} alt="MarketingHS" className="h-7 w-auto" />
      </div>

      {/* Recolher/expandir — só desktop */}
      <div className={cn('hidden px-2 pb-2 lg:flex', collapsed ? 'justify-center' : 'justify-end')}>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>

      {/* Navegação */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-2">
        {!collapsed && (
          <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-conteudo-faint">
            Principal
          </p>
        )}
        {MAIN_ITEMS.map(item => (
          <div key={item.path}>
            {renderItem(item)}
            {renderChildren(item)}
          </div>
        ))}

        <div className="my-3 border-t border-border" />

        {!collapsed && (
          <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-conteudo-faint">
            Sistema
          </p>
        )}
        {SYSTEM_ITEMS.map(item => renderItem(item))}
      </nav>

      {/* Rodapé — e-mail do usuário e Sair mudaram para a topbar. Recolhido,
          o texto não cabe em 72px; some junto com os rótulos de grupo (e a
          faixa com borda some junto, não fica vazia). */}
      {!collapsed && (
        <div className="border-t border-border px-5 py-4 text-center">
          <p className="truncate text-xs font-medium text-conteudo-muted">MarketingHS</p>
          <p className="truncate text-[11px] text-conteudo-faint">© 2026 Health &amp; Safety Tech</p>
        </div>
      )}
    </div>
  );

  return (
    <TooltipProvider>
      {/* Menu do celular — controlado pela topbar (AdminLayout) */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-[--overlay]" onClick={() => onMobileOpenChange(false)} />
          <div className="relative z-10 h-full">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onMobileOpenChange(false)}
              className="absolute right-[-44px] top-4 bg-surface text-conteudo hover:bg-surface-elevated"
              aria-label="Fechar menu"
            >
              <X className="h-4 w-4" />
            </Button>
            <div className="h-full w-64">{sidebarContent}</div>
          </div>
        </div>
      )}

      {/* Sidebar desktop */}
      <div className="sticky top-0 hidden h-screen lg:block">
        {sidebarContent}
      </div>
    </TooltipProvider>
  );
}
