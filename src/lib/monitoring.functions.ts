import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Testa rapidamente se os @ alvos existem no X (antes de criar o monitor).
// Usa uma conta ativa do usuário como leitora (pelo proxy dela).
export const testMonitorTargets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { handles: string[] }) =>
    z.object({ handles: z.array(z.string().min(1)).min(1).max(20) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: accs } = await context.supabase
      .from("twitter_accounts")
      .select("id, username, auth_tokens, proxy_id, status")
      .eq("status", "active")
      .limit(50);
    const reader = (accs ?? []).find(
      (a: any) => a?.auth_tokens?.ct0 && a?.auth_tokens?.auth_token,
    );
    if (!reader) {
      throw new Error("Nenhuma conta ativa com sessão válida para testar. Valide uma conta primeiro.");
    }

    let proxy: { ip: string; port: number; username: string | null; password: string | null } | null = null;
    if (reader.proxy_id) {
      const { data: p } = await context.supabase
        .from("proxies").select("ip, port, username, password").eq("id", reader.proxy_id).maybeSingle();
      proxy = p as any;
    }

    const { verifySession, buildDispatcher } = await import("@/lib/twitter-client.server");
    const dispatcher = buildDispatcher(proxy);
    const tokens = reader.auth_tokens as any;

    // dedup + limpeza
    const handles = Array.from(
      new Set(data.handles.map((h) => h.replace(/^@/, "").trim()).filter(Boolean)),
    ).slice(0, 20);

    const results: Array<{ handle: string; ok: boolean; name?: string; error?: string }> = [];
    for (const handle of handles) {
      try {
        const u = await verifySession(tokens, handle, dispatcher);
        results.push({ handle, ok: true, name: u.name });
      } catch (e) {
        results.push({ handle, ok: false, error: e instanceof Error ? e.message.slice(0, 90) : "não encontrado" });
      }
    }
    return { results, reader: reader.username as string };
  });
