import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard, Users, Workflow, ScrollText, Activity, GraduationCap,
  Image as ImageIcon, UserCog, LogOut, Rocket, PanelLeftClose, PanelLeftOpen,
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
  { to: "/automations", label: "Automações", icon: Workflow },
  { to: "/mass-engage", label: "RT & Like massa", icon: Rocket },
  { to: "/education", label: "Educar conta", icon: GraduationCap },
  { to: "/monitoring", label: "Monitoramento", icon: Activity },
  { to: "/logs", label: "Logs", icon: ScrollText },
] as const;

const STORAGE_KEY = "mimix.sidebar.collapsed";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) === "1") setCollapsed(true);
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

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

  return (
    <TooltipProvider delayDuration={0}>
      <div className="min-h-screen flex w-full bg-background">
        <aside
          className={cn(
            "shrink-0 border-r border-border bg-sidebar backdrop-blur-2xl flex flex-col sticky top-0 h-screen z-30 transition-[width] duration-300 ease-in-out",
            collapsed ? "w-[68px]" : "w-64",
          )}
        >
          {/* Brand */}
          <div className={cn("flex items-center h-[68px] border-b border-border", collapsed ? "justify-center px-0" : "px-5")}>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl gradient-brand glow-brand">
                <Rocket className="h-[18px] w-[18px] text-white" strokeWidth={2} />
              </div>
              {!collapsed && (
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground leading-none">MimixLab</p>
                  <p className="mt-1 text-sm font-semibold text-gradient leading-none truncate">Automation Suite</p>
                </div>
              )}
            </div>
          </div>

          {/* Nav */}
          <nav className={cn("flex-1 py-4 space-y-1 overflow-y-auto overflow-x-hidden", collapsed ? "px-2.5" : "px-3")}>
            {nav.map((item) => {
              const active = pathname === item.to || pathname.startsWith(item.to + "/");
              const Icon = item.icon;
              const link = (
                <Link
                  to={item.to}
                  aria-label={item.label}
                  className={cn(
                    "group relative flex items-center rounded-lg text-sm transition-all duration-200",
                    collapsed ? "justify-center h-10 w-10 mx-auto" : "gap-3 px-3 py-2",
                    active
                      ? "bg-accent text-foreground shadow-[inset_0_1px_0_0_oklch(1_0_0_/_0.06)]"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                  )}
                >
                  {active && (
                    <span className={cn(
                      "absolute top-1/2 -translate-y-1/2 rounded-full gradient-brand",
                      collapsed ? "left-0 h-6 w-[3px]" : "left-0 h-5 w-[3px]",
                    )} />
                  )}
                  <Icon
                    className={cn(
                      "h-[18px] w-[18px] shrink-0 transition-colors",
                      active ? "text-brand" : "text-muted-foreground group-hover:text-foreground",
                    )}
                    strokeWidth={1.75}
                  />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
              );

              return collapsed ? (
                <Tooltip key={item.to}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right" className="bg-popover text-foreground border border-border">
                    {item.label}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <div key={item.to}>{link}</div>
              );
            })}
          </nav>

          {/* Footer: user + actions */}
          <div className="border-t border-border p-3 space-y-1">
            {!collapsed && email && (
              <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg">
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-semibold text-brand uppercase">
                  {email.slice(0, 2)}
                </div>
                <span className="text-xs text-muted-foreground truncate">{email}</span>
              </div>
            )}

            <div className={cn("flex gap-1", collapsed ? "flex-col items-center" : "items-center")}>
              <FooterAction
                collapsed={collapsed}
                onClick={handleSignOut}
                icon={LogOut}
                label="Sair"
                danger
              />
              <FooterAction
                collapsed={collapsed}
                onClick={toggle}
                icon={collapsed ? PanelLeftOpen : PanelLeftClose}
                label={collapsed ? "Expandir" : "Recolher"}
                className={collapsed ? "" : "ml-auto"}
              />
            </div>
          </div>
        </aside>

        <main className="flex-1 min-w-0 overflow-auto">{children}</main>
      </div>
    </TooltipProvider>
  );
}

function FooterAction({
  collapsed, onClick, icon: Icon, label, danger, className,
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
