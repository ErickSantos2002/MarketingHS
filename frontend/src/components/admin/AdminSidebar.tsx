import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { DniaLogo } from './DniaLogo';
import dnMarketingLogo from '@/assets/dnmarketing-logo.png';
import {
  LayoutDashboard, BarChart2, Users, Filter, Send, Layout,
  Upload, Settings, ChevronLeft, ChevronRight, ChevronDown,
  ChevronRight as ChevronRightSm, LogOut, Menu, X, Zap, LayoutTemplate, FlaskConical,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const SIDEBAR_COLLAPSED_KEY = 'dnmarketing-sidebar-collapsed';

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

export function AdminSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'; } catch { return false; }
  });
  const [analyticsOpen, setAnalyticsOpen] = useState(
    location.pathname.startsWith('/analytics')
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed)); } catch {}
  }, [collapsed]);

  useEffect(() => {
    if (location.pathname.startsWith('/analytics')) {
      setAnalyticsOpen(true);
    }
  }, [location.pathname]);

  // Close mobile sidebar on navigation
  useEffect(() => { setMobileOpen(false); }, [location.pathname, location.search]);

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

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
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
          'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group relative',
          active && !item.disabled && 'bg-primary/15 text-primary',
          active && !item.disabled && 'border-l-[3px] border-primary pl-[9px]',
          !active && !item.disabled && 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
          item.disabled && 'text-muted-foreground/50 cursor-not-allowed',
          collapsed && 'justify-center px-0',
        )}
      >
        <Icon className={cn('h-5 w-5 shrink-0', active && !item.disabled && 'text-primary')} />
        {!collapsed && (
          <>
            <span className="flex-1 text-left truncate">{item.label}</span>
            {item.badge && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-normal">
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
            {item.badge && <span className="text-xs text-muted-foreground">({item.badge})</span>}
          </TooltipContent>
        </Tooltip>
      );
    }

    return <div key={item.path}>{content}</div>;
  };

  const renderChildren = (item: NavItem) => {
    if (!item.children || collapsed || !analyticsOpen) return null;
    return (
      <div className="ml-4 pl-4 border-l border-border/40 space-y-0.5 mt-0.5">
        {item.children.map(child => {
          const active = isActive(child.path);
          return (
            <button
              key={child.path}
              onClick={() => navigate(child.path.split('?')[0] + '?' + child.path.split('?')[1])}
              className={cn(
                'w-full text-left px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                active ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted/40',
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
      'flex flex-col h-full bg-card border-r border-border/50',
      collapsed ? 'w-16' : 'w-[220px]',
      'transition-all duration-200',
    )}>
      {/* Logo */}
      <div className="px-4 py-5 flex items-center justify-center">
        {collapsed ? (
          <DniaLogo className="h-5" />
        ) : (
          <img src={dnMarketingLogo} alt="dnMarketing" className="h-12 w-auto" />
        )}
      </div>

      {/* Toggle */}
      <div className={cn('px-2 mb-2 hidden lg:block', collapsed && 'flex justify-center')}>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-md hover:bg-muted/50 text-muted-foreground transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 space-y-1 overflow-y-auto">
        {!collapsed && <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold px-3 mb-1">Principal</p>}
        {MAIN_ITEMS.map(item => (
          <div key={item.path}>
            {renderItem(item)}
            {renderChildren(item)}
          </div>
        ))}

        <div className="my-3 border-t border-border/30" />

        {!collapsed && <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold px-3 mb-1">Sistema</p>}
        {SYSTEM_ITEMS.map(item => renderItem(item))}
      </nav>

      {/* User Footer */}
      <div className={cn('px-3 py-3 border-t border-border/30', collapsed && 'flex justify-center')}>
        {collapsed ? (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button onClick={handleSignOut} className="p-2 rounded-md hover:bg-muted/50 text-muted-foreground">
                <LogOut className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Sair</TooltipContent>
          </Tooltip>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
            <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={handleSignOut}>
              <LogOut className="h-4 w-4 mr-2" />
              Sair
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <TooltipProvider>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-md bg-card border border-border/50 shadow-sm"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <div className="relative z-10 h-full">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-[-40px] p-1.5 rounded-md bg-card text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="h-full w-[220px]">{sidebarContent}</div>
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <div className="hidden lg:block h-screen sticky top-0">
        {sidebarContent}
      </div>
    </TooltipProvider>
  );
}
