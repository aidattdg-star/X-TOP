// Simulated proxy tester. In production this would attempt a real HTTP request
// through the proxy. For the MVP it pings the proxy host with a TCP-ish check
// and randomly marks status (favoring active) to drive UI.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { proxy_id } = await req.json();
    if (!proxy_id) return json({ error: "proxy_id required" }, 400);

    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: proxy, error } = await supabase
      .from("proxies")
      .select("*")
      .eq("id", proxy_id)
      .maybeSingle();
    if (error || !proxy) return json({ error: "proxy not found" }, 404);

    // Lightweight simulated validation
    const start = Date.now();
    let ok = false;
    try {
      // Try a DNS-ish reachability ping (best effort, may fail in edge runtime)
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      await fetch(`https://${proxy.ip}`, { signal: ctrl.signal }).catch(() => null);
      clearTimeout(t);
      // Heuristic: assume active 80% of the time
      ok = Math.random() < 0.8;
    } catch {
      ok = false;
    }
    const latency = Date.now() - start;

    const status = ok ? "active" : "dead";
    await supabase
      .from("proxies")
      .update({ status, last_tested_at: new Date().toISOString() })
      .eq("id", proxy_id);

    return json({ status, latency_ms: latency });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
