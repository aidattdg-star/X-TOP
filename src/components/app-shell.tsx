import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  Workflow,
  ScrollText,
  Activity,
  GraduationCap,
  Image as ImageIcon,
  UserCog,
  LogOut,
  Rocket,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Menu,
  X,
  Send,
  EyeOff,
  Users2,
  TrendingUp,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { useEffect, useState, type ReactNode } from "react";

const nav = [
  { to: "/dashboard", label: "Visão geral", icon: LayoutDashboard },
  { to: "/accounts", label: "Contas & Proxies", icon: Users },
  { to: "/edit-accounts", label: "Editar contas", icon: UserCog },
  { to: "/media", label: "Mídias", icon: ImageIcon },
  { to: "/post-tweet", label: "Postar tweet", icon: Send },
  { to: "/communities", label: "Comunidades", icon: Users2 },
  { to: "/automations", label: "Automações", icon: Workflow },
  { to: "/mass-engage", label: "RT & Like massa", icon: Rocket },
  { to: "/education", label: "Educar conta", icon: GraduationCap },
  { to: "/monitoring", label: "Monitoramento", icon: Activity },
  { to: "/quarantine", label: "Quarentena", icon: EyeOff },
  { to: "/logs", label: "Logs", icon: ScrollText },
] as const;

const ADMIN_NAV = { to: "/admin", label: "Admin", icon: ShieldCheck } as const;
const PERF_NAV = { to: "/performance", label: "Performance", icon: TrendingUp } as const;

const STORAGE_KEY = "mimix.sidebar.collapsed";

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard };

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) === "1") setCollapsed(true);
    supabase.auth.getUser().then(async ({ data }) => {
      setEmail(data.user?.email ?? null);
      if (!data.user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", data.user.id)
        .maybeSingle();
      setIsAdmin(profile?.role === "admin");
    });
  }, []);

  // fecha o drawer ao navegar
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const navItems = isAdmin ? [...nav, PERF_NAV, ADMIN_NAV] : [...nav];

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  // expanded = visual aberto: fixado aberto OU recolhido-mas-com-mouse-em-cima
  const expanded = !collapsed || hovered;
  const compact = !expanded;

  return (
    <TooltipProvider delayDuration={0}>
      <div className="min-h-screen flex w-full bg-background">
        {/* ===================== DESKTOP (md+): barra rail ===================== */}
        <aside
          className={cn(
            "relative shrink-0 sticky top-0 h-screen z-30 transition-[width] duration-300 ease-in-out hidden md:block",
            collapsed ? "w-[68px]" : "w-64",
          )}
        >
          <div
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{ WebkitBackdropFilter: "blur(18px)", backdropFilter: "blur(18px)", willChange: "width", transform: "translateZ(0)" }}
            className={cn(
              // transform-gpu + backdrop via style: corrige o repaint do Safari/macOS
              // ao animar a largura com blur (hover/expandir que ficava "travado").
              "absolute inset-y-0 left-0 h-screen flex flex-col border-r border-border bg-sidebar transform-gpu transition-[width] duration-300 ease-in-out z-30",
              expanded ? "w-64" : "w-[68px]",
              collapsed && hovered ? "shadow-2xl shadow-black/40" : "",
            )}
          >
            {/* Brand */}
            <div
              className={cn(
                "flex items-center h-[68px] border-b border-border",
                compact ? "justify-center px-0" : "px-5",
              )}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl gradient-brand glow-brand">
                  <Rocket className="h-[18px] w-[18px] text-white" strokeWidth={2} />
                </div>
                {!compact && (
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground leading-none">
                      MimixLab
                    </p>
                    <p className="mt-1 text-sm font-semibold text-gradient leading-none truncate">
                      Automation Suite
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Nav */}
            <nav
              className={cn(
                "flex-1 py-4 space-y-1 overflow-y-auto overflow-x-hidden",
                compact ? "px-2.5" : "px-3",
              )}
            >
              {navItems.map((item) => (
                <NavLink key={item.to} item={item} pathname={pathname} compact={compact} />
              ))}
            </nav>

            {/* Footer: user + actions */}
            <div className="border-t border-border p-3 space-y-1">
              {!compact && email && (
                <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg">
                  <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-semibold text-brand uppercase">
                    {email.slice(0, 2)}
                  </div>
                  <span className="text-xs text-muted-foreground truncate">{email}</span>
                </div>
              )}

              <div className={cn("flex gap-1", compact ? "flex-col items-center" : "items-center")}>
                <FooterAction collapsed={compact} onClick={handleSignOut} icon={LogOut} label="Sair" danger />
                <FooterAction
                  collapsed={compact}
                  onClick={toggle}
                  icon={collapsed ? PanelLeftOpen : PanelLeftClose}
                  label={collapsed ? "Fixar aberta" : "Modo rail (hover)"}
                  className={compact ? "" : "ml-auto"}
                />
              </div>
            </div>
          </div>
        </aside>

        {/* ===================== MOBILE (< md): drawer ===================== */}
        {/* backdrop */}
        <div
          onClick={() => setMobileOpen(false)}
          className={cn(
            "md:hidden fixed inset-0 z-40 bg-black/55 backdrop-blur-sm transition-opacity duration-300",
            mobileOpen ? "opacity-100" : "opacity-0 pointer-events-none",
          )}
        />
        {/* drawer */}
        <aside
          className={cn(
            "md:hidden fixed inset-y-0 left-0 z-50 w-72 max-w-[84vw] flex flex-col border-r border-border bg-sidebar backdrop-blur-2xl transition-transform duration-300 ease-out",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex items-center justify-between h-14 px-4 border-b border-border">
            <div className="flex items-center gap-2.5">
              <div className="grid h-8 w-8 place-items-center rounded-xl gradient-brand glow-brand">
                <Rocket className="h-4 w-4 text-white" strokeWidth={2} />
              </div>
              <span className="text-sm font-semibold text-gradient">MimixLab</span>
            </div>
            <button
              onClick={() => setMobileOpen(false)}
              aria-label="Fechar menu"
              className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/60"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <nav className="flex-1 py-3 px-3 space-y-1 overflow-y-auto">
            {navItems.map((item) => (
              <NavLink key={item.to} item={item} pathname={pathname} compact={false} />
            ))}
          </nav>
          <div className="border-t border-border p-3 space-y-2">
            {email && (
              <div className="flex items-center gap-2.5 px-2 py-1.5">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-semibold text-brand uppercase">
                  {email.slice(0, 2)}
                </div>
                <span className="text-xs text-muted-foreground truncate">{email}</span>
              </div>
            )}
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <LogOut className="h-[18px] w-[18px]" strokeWidth={1.75} /> Sair
            </button>
          </div>
        </aside>

        {/* ===================== CONTEÚDO ===================== */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* topbar mobile */}
          <header className="md:hidden sticky top-0 z-30 flex items-center gap-3 h-14 px-4 border-b border-border bg-sidebar backdrop-blur-2xl">
            <button
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menu"
              className="grid h-9 w-9 place-items-center rounded-lg text-foreground hover:bg-accent/60"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              <div className="grid h-7 w-7 place-items-center rounded-lg gradient-brand">
                <Rocket className="h-[15px] w-[15px] text-white" strokeWidth={2} />
              </div>
              <span className="text-sm font-semibold text-gradient">MimixLab</span>
            </div>
          </header>

          <main className="flex-1 min-w-0 overflow-auto">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}

function NavLink({ item, pathname, compact }: { item: NavItem; pathname: string; compact: boolean }) {
  const active = pathname === item.to || pathname.startsWith(item.to + "/");
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      aria-label={item.label}
      className={cn(
        "group relative flex items-center rounded-lg text-sm transition-all duration-200",
        compact ? "justify-center h-10 w-10 mx-auto" : "gap-3 px-3 py-2.5",
        active
          ? "bg-accent text-foreground shadow-[inset_0_1px_0_0_oklch(1_0_0_/_0.06)]"
          : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full gradient-brand" />
      )}
      <Icon
        className={cn(
          "h-[18px] w-[18px] shrink-0 transition-colors",
          active ? "text-brand" : "text-muted-foreground group-hover:text-foreground",
        )}
        strokeWidth={1.75}
      />
      {!compact && <span className="truncate">{item.label}</span>}
    </Link>
  );
}

function FooterAction({
  collapsed,
  onClick,
  icon: Icon,
  label,
  danger,
  className,
}: {
  collapsed: boolean;
  onClick: () => void;
  icon: typeof LogOut;
  label: string;
  danger?: boolean;
  className?: string;
}) {
  const btn = (
    <button
      onClick={onClick}
      aria-label={label}
      className={cn(
        "flex items-center rounded-lg text-sm transition-colors",
        collapsed ? "justify-center h-9 w-9" : "gap-3 px-3 py-2",
        danger
          ? "text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          : "text-muted-foreground hover:text-foreground hover:bg-accent/60",
        !collapsed && danger ? "flex-1" : "",
        className,
      )}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
      {!collapsed && <span>{label}</span>}
    </button>
  );
  if (!collapsed) return btn;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{btn}</TooltipTrigger>
      <TooltipContent side="right" className="bg-popover text-foreground border border-border">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
