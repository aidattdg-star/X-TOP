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
