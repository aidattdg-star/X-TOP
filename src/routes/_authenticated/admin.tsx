import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  listUsers,
  setUserStatus,
  setUserRole,
  type AdminUser,
  type UserStatus,
} from "@/lib/admin.functions";
import {
  Check,
  X,
  Shield,
  ShieldOff,
  Clock,
  RefreshCw,
  UserCheck,
  Users as UsersIcon,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .maybeSingle();
    if (profile?.role !== "admin") throw redirect({ to: "/dashboard" });
  },
  component: AdminPage,
});

type Tab = "pending" | "approved" | "rejected" | "all";

const TABS: { key: Tab; label: string }[] = [
  { key: "pending", label: "Pendentes" },
  { key: "approved", label: "Aprovados" },
  { key: "rejected", label: "Rejeitados" },
  { key: "all", label: "Todos" },
];

function AdminPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("pending");
  const [busy, setBusy] = useState<string | null>(null);

  const runList = useServerFn(listUsers);
  const runStatus = useServerFn(setUserStatus);
  const runRole = useServerFn(setUserRole);

  const {
    data: users = [],
    isLoading,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => runList(),
    refetchInterval: 30000,
  });

  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, rejected: 0, all: users.length };
    for (const u of users) if (u.status in c) c[u.status]++;
    return c;
  }, [users]);

  const filtered = useMemo(
    () => (tab === "all" ? users : users.filter((u) => u.status === tab)),
    [users, tab],
  );

  async function changeStatus(u: AdminUser, status: UserStatus) {
    setBusy(u.id);
    try {
      await runStatus({ data: { user_id: u.id, status } });
      toast.success(
        status === "approved"
          ? `@${u.email} aprovado`
          : status === "rejected"
            ? `@${u.email} rejeitado`
            : `@${u.email} voltou para pendente`,
      );
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na ação");
    } finally {
      setBusy(null);
    }
  }

  async function changeRole(u: AdminUser, role: "user" | "admin") {
    setBusy(u.id);
    try {
      await runRole({ data: { user_id: u.id, role } });
      toast.success(
        role === "admin" ? `@${u.email} agora é admin` : `@${u.email} rebaixado a usuário`,
      );
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na ação");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="px-10 py-10 max-w-5xl mx-auto">
      <PageHeader
        eyebrow="Administração"
        title="Aprovação de cadastros"
        description="Libere ou bloqueie o acesso de novos usuários à plataforma."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-2"
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
            Atualizar
          </Button>
        }
      />

      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
        <MiniStat
          icon={Clock}
          label="Pendentes"
          value={counts.pending}
          highlight={counts.pending > 0}
        />
        <MiniStat icon={UserCheck} label="Aprovados" value={counts.approved} />
        <MiniStat icon={X} label="Rejeitados" value={counts.rejected} />
        <MiniStat icon={UsersIcon} label="Total" value={counts.all} />
      </div>

      {/* Tabs */}
      <div className="mt-8 inline-flex gap-1 p-1 rounded-lg bg-muted/40 border border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-1.5 rounded-md text-xs font-medium transition-colors",
              tab === t.key
                ? "bg-surface text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            <span className="ml-1.5 tabular-nums text-muted-foreground">{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {/* Lista */}
      <div className="mt-4 border border-border bg-surface rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="px-6 py-16 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-muted-foreground">
            Nenhum usuário{" "}
            {tab !== "all" ? `${TABS.find((t) => t.key === tab)?.label.toLowerCase()}` : ""}.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((u) => (
              <div
                key={u.id}
                className="px-6 py-4 flex items-center justify-between gap-4 transition-colors hover:bg-accent/30"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-semibold text-brand uppercase">
                    {(u.email ?? "?").slice(0, 2)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-foreground truncate">{u.email ?? "—"}</p>
                      {u.role === "admin" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-medium text-brand">
                          <Shield className="h-3 w-3" /> admin
                        </span>
                      )}
                      <StatusBadge status={u.status} />
                    </div>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      Cadastro: {new Date(u.created_at).toLocaleString("pt-BR")}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {u.status !== "approved" && (
                    <Button
                      size="sm"
                      disabled={busy === u.id}
                      onClick={() => changeStatus(u, "approved")}
                      className="gap-1.5"
                    >
                      <Check className="h-3.5 w-3.5" /> Aprovar
                    </Button>
                  )}
                  {u.status !== "rejected" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === u.id}
                      onClick={() => changeStatus(u, "rejected")}
                      className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <X className="h-3.5 w-3.5" /> Rejeitar
                    </Button>
                  )}
                  {u.role === "admin" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === u.id}
                      onClick={() => changeRole(u, "user")}
                      className="gap-1.5 text-muted-foreground"
                      title="Remover admin"
                    >
                      <ShieldOff className="h-3.5 w-3.5" />
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === u.id}
                      onClick={() => changeRole(u, "admin")}
                      className="gap-1.5 text-muted-foreground"
                      title="Tornar admin"
                    >
                      <Shield className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: typeof Clock;
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "border bg-surface p-5 rounded-xl",
        highlight ? "border-brand/40" : "border-border",
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
        <Icon
          className={cn("h-4 w-4", highlight ? "text-brand" : "text-muted-foreground")}
          strokeWidth={1.75}
        />
      </div>
      <p className="mt-3 text-2xl font-light text-foreground tabular-nums">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "pendente", cls: "bg-amber-400/15 text-amber-400" },
    approved: { label: "aprovado", cls: "bg-emerald-400/15 text-emerald-400" },
    rejected: { label: "rejeitado", cls: "bg-destructive/15 text-destructive" },
  };
  const m = map[status] ?? { label: status, cls: "bg-muted text-muted-foreground" };
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", m.cls)}>{m.label}</span>
  );
}
