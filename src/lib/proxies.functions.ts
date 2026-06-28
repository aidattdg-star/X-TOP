import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Testa um proxy de verdade: faz uma request HTTPS por ele e mede latência.
// Roda no servidor (Vercel) via undici ProxyAgent.
export const testProxyConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { proxy_id: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: proxy, error } = await context.supabase
      .from("proxies")
      .select("id, ip, port, username, password")
      .eq("id", data.proxy_id)
      .maybeSingle();
    if (error || !proxy) throw new Error("Proxy não encontrado");

    const { nodeProxyFetch } = await import("@/lib/proxy-fetch-node.server");

    const start = Date.now();
    let ok = false;
    let detail = "";
    let exitIp = "";
    try {
      const res = await nodeProxyFetch(
        "https://api.ipify.org?format=json",
        { method: "GET", headers: { accept: "application/json" } },
        proxy,
      );
      const body = await res.text();
      ok = res.ok;
      try {
        exitIp = (JSON.parse(body)?.ip as string) ?? "";
      } catch {
        exitIp = body.slice(0, 40);
      }
      if (!ok) detail = `HTTP ${res.status}`;
    } catch (e) {
      ok = false;
      detail = e instanceof Error ? e.message : String(e);
    }
    const latency_ms = Date.now() - start;

    const status = ok ? "active" : "dead";
    await context.supabase
      .from("proxies")
      .update({ status, last_tested_at: new Date().toISOString() })
      .eq("id", data.proxy_id);

    return { status, latency_ms, exit_ip: exitIp, detail };
  });
