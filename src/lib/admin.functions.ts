import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

type AuthContext = { supabase: SupabaseClient<Database>; userId: string };

export type UserStatus = "pending" | "approved" | "rejected";
export type UserRole = "user" | "admin";

export type AdminUser = {
  id: string;
  email: string | null;
  status: UserStatus;
  role: UserRole;
  created_at: string;
  approved_at: string | null;
};

// Garante que quem chamou é admin. Usa o client autenticado (RLS) — o próprio
// usuário consegue ler o próprio profile, então conseguimos checar a role dele.
async function assertAdmin(context: AuthContext) {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("role")
    .eq("id", context.userId)
    .maybeSingle();
  if (error) throw new Error(`Falha ao verificar permissão: ${error.message}`);
  if (!data || data.role !== "admin") {
    throw new Error("Acesso restrito: apenas administradores.");
  }
}

// ---------------------------------------------------------------------------
// PERFORMANCE (admin only) — agrega as views de TODOS os usuários do SaaS.
// Usa os snapshots já coletados em account_view_stats (atualizados pelo cron
// collect-views a cada ~5 min) + twitter_accounts (seguidores/status) +
// profiles (e-mail pra identificar cada usuário, ex.: Yan, Rodrigo).
// ---------------------------------------------------------------------------
export type AccountPerf = {
  account_id: string;
  username: string;
  user_id: string;
  owner_email: string | null;
  views: number;
  tweets: number;
  follower_count: number;
  status: string | null;
  updated_at: string | null;
};

export type UserPerf = {
  user_id: string;
  email: string | null;
  total_views: number;
  total_tweets: number;
  total_followers: number;
  account_count: number;
  active_count: number;
  last_updated: string | null;
};

export const getPerformanceLeaderboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Contas = fonte da verdade (aparecem mesmo sem snapshot ainda).
    const { data: accounts, error: aErr } = await supabaseAdmin
      .from("twitter_accounts")
      .select("id, user_id, username, status, follower_count");
    if (aErr) throw new Error(`Falha ao ler contas: ${aErr.message}`);

    const { data: stats } = await (supabaseAdmin as any)
      .from("account_view_stats")
      .select("account_id, views, tweets, updated_at");
    const statById = new Map<string, { views: number; tweets: number; updated_at: string }>(
      (stats ?? []).map((s: any) => [
        String(s.account_id),
        { views: Number(s.views ?? 0), tweets: Number(s.tweets ?? 0), updated_at: String(s.updated_at ?? "") },
      ]),
    );

    const { data: profiles } = await supabaseAdmin.from("profiles").select("id, email");
    const emailById = new Map<string, string | null>(
      (profiles ?? []).map((p: any) => [String(p.id), (p.email ?? null) as string | null]),
    );

    const perAccount: AccountPerf[] = (accounts ?? []).map((a: any) => {
      const st = statById.get(String(a.id));
      return {
        account_id: String(a.id),
        username: String(a.username ?? ""),
        user_id: String(a.user_id ?? ""),
        owner_email: emailById.get(String(a.user_id)) ?? null,
        views: st?.views ?? 0,
        tweets: st?.tweets ?? 0,
        follower_count: Number(a.follower_count ?? 0),
        status: (a.status ?? null) as string | null,
        updated_at: st?.updated_at || null,
      };
    });

    const userMap = new Map<string, UserPerf>();
    for (const acc of perAccount) {
      let u = userMap.get(acc.user_id);
      if (!u) {
        u = {
          user_id: acc.user_id,
          email: acc.owner_email,
          total_views: 0,
          total_tweets: 0,
          total_followers: 0,
          account_count: 0,
          active_count: 0,
          last_updated: null,
        };
        userMap.set(acc.user_id, u);
      }
      u.total_views += acc.views;
      u.total_tweets += acc.tweets;
      u.total_followers += acc.follower_count;
      u.account_count += 1;
      if (acc.status === "active") u.active_count += 1;
      if (acc.updated_at && (!u.last_updated || acc.updated_at > u.last_updated)) {
        u.last_updated = acc.updated_at;
      }
    }

    const perUser = Array.from(userMap.values()).sort((a, b) => b.total_views - a.total_views);
    perAccount.sort((a, b) => b.views - a.views);

    const totals = {
      views: perAccount.reduce((s, a) => s + a.views, 0),
      tweets: perAccount.reduce((s, a) => s + a.tweets, 0),
      accounts: perAccount.length,
      users: perUser.length,
      last_updated: perAccount.reduce<string | null>(
        (m, a) => (a.updated_at && (!m || a.updated_at > m) ? a.updated_at : m),
        null,
      ),
    };

    return { perUser, perAccount, totals };
  });

// Lista todos os usuários (admin only). Usa service_role pra ver todo mundo.
export const listUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, email, status, role, created_at, approved_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as AdminUser[];
  });

// Aprova / rejeita / volta pra pendente (admin only).
export const setUserStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { user_id: string; status: UserStatus }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (!["pending", "approved", "rejected"].includes(data.status)) {
      throw new Error("Status inválido.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch =
      data.status === "approved"
        ? {
            status: data.status,
            approved_at: new Date().toISOString(),
            approved_by: context.userId,
          }
        : { status: data.status, approved_at: null, approved_by: null };
    const { error } = await supabaseAdmin.from("profiles").update(patch).eq("id", data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Promove / rebaixa admin (admin only). Não deixa o próprio admin se auto-rebaixar
// (evita ficar sem nenhum admin por acidente).
export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { user_id: string; role: UserRole }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (!["user", "admin"].includes(data.role)) throw new Error("Role inválida.");
    if (data.user_id === context.userId && data.role !== "admin") {
      throw new Error("Você não pode remover o seu próprio acesso de admin.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // promover a admin implica aprovar
    const patch =
      data.role === "admin"
        ? {
            role: data.role,
            status: "approved",
            approved_at: new Date().toISOString(),
            approved_by: context.userId,
          }
        : { role: data.role };
    const { error } = await supabaseAdmin.from("profiles").update(patch).eq("id", data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
