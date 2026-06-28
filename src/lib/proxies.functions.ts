import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ProxyQuality = "good" | "slow" | "datacenter" | "dead";

// Testa um proxy de verdade: faz requests HTTPS/HTTP por ele, mede latência e
// descobre se o IP de saída é datacenter (ruim p/ escrita no X) ou residencial.
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
    let reachable = false;
    let exitIp = "";
    let detail = "";
    try {
      const res = await nodeProxyFetch(
        "https://api.ipify.org?format=json",
        { method: "GET", headers: { accept: "application/json" } },
        proxy,
      );
      const body = await res.text();
      reachable = res.ok;
      try { exitIp = (JSON.parse(body)?.ip as string) ?? ""; } catch { exitIp = body.slice(0, 40); }
      if (!reachable) detail = `HTTP ${res.status}`;
    } catch (e) {
      reachable = false;
      detail = e instanceof Error ? e.message : String(e);
    }
    const latency_ms = Date.now() - start;

    // Classificação do IP de saída (datacenter vs residencial/móvel) via ip-api (free, sem chave).
    let isHosting = false;
    let isMobile = false;
    if (reachable) {
      try {
        const r2 = await nodeProxyFetch(
          "http://ip-api.com/json/?fields=status,query,proxy,hosting,mobile",
          { method: "GET", headers: { accept: "application/json" } },
          proxy,
        );
        const j = JSON.parse(await r2.text());
        isHosting = !!j?.hosting;
        isMobile = !!j?.mobile;
        if (j?.query) exitIp = j.query;
      } catch {
        /* classificação é best-effort */
      }
    }

    let quality: ProxyQuality;
    if (!reachable) quality = "dead";
    else if (isHosting && !isMobile) quality = "datacenter";
    else if (latency_ms > 4000) quality = "slow";
    else quality = "good";

    const status = reachable ? "active" : "dead";
    await context.supabase
      .from("proxies")
      .update({
        status,
        quality,
        latency_ms,
        exit_ip: exitIp || null,
        last_tested_at: new Date().toISOString(),
      })
      .eq("id", data.proxy_id);

    return { status, quality, latency_ms, exit_ip: exitIp, detail };
  });
