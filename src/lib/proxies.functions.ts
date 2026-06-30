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

    // fetch via proxy com timeout RÍGIDO: proxy travado é abortado e NÃO vira "bom".
    async function proxied(url: string, timeoutMs: number) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const start = Date.now();
      try {
        const res = await nodeProxyFetch(
          url,
          { method: "GET", headers: { accept: "application/json" }, signal: ctrl.signal },
          proxy!,
        );
        const text = await res.text();
        return { ok: res.ok, status: res.status, text, ms: Date.now() - start };
      } finally {
        clearTimeout(t);
      }
    }

    // IP do próprio servidor (sem proxy) — pra pegar proxy "transparente" que não troca o IP.
    const serverIpPromise: Promise<string> = (async () => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 2500);
        const r = await fetch("https://api.ipify.org?format=json", { signal: ctrl.signal });
        clearTimeout(t);
        return (JSON.parse(await r.text())?.ip as string) ?? "";
      } catch {
        return "";
      }
    })();

    // 1) ALCANCE + LATÊNCIA: 2 amostras reais. Reachable = ao menos 1 respondeu.
    let exitIp = "";
    const samples: number[] = [];
    let lastDetail = "";
    for (let i = 0; i < 2; i++) {
      try {
        const r = await proxied("https://api.ipify.org?format=json", 4500);
        if (r.ok) {
          samples.push(r.ms);
          if (!exitIp) {
            try { exitIp = (JSON.parse(r.text)?.ip as string) ?? ""; } catch { exitIp = r.text.trim().slice(0, 40); }
          }
        } else {
          lastDetail = `HTTP ${r.status}`;
        }
      } catch (e) {
        lastDetail = (e as Error)?.name === "AbortError" ? "timeout (>4.5s)" : String((e as Error)?.message ?? "falha").slice(0, 60);
      }
    }
    const reachable = samples.length > 0;
    const median = (arr: number[]): number => {
      if (!arr.length) return 0;
      const s = [...arr].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
    };
    const latency_ms = median(samples);

    const serverIp = await serverIpPromise;
    const transparent = !!(reachable && exitIp && serverIp && exitIp === serverIp);

    // 2) CLASSIFICAÇÃO (datacenter/VPN vs residencial/móvel). Só dá "bom" se DER pra
    //    CONFIRMAR — se a checagem falhar, fica "unknown" (NÃO inventa "bom").
    let classified = false;
    let isHosting = false, isProxyFlag = false, isMobile = false, ispOrg = "";
    if (reachable && !transparent) {
      try {
        const r = await proxied(
          "http://ip-api.com/json/?fields=status,message,query,proxy,hosting,mobile,as,isp,org",
          4000,
        );
        const j = JSON.parse(r.text);
        if (j?.status === "success") {
          isHosting = !!j.hosting; isProxyFlag = !!j.proxy; isMobile = !!j.mobile;
          ispOrg = `${j.as ?? ""} ${j.isp ?? ""} ${j.org ?? ""}`;
          if (j.query) exitIp = j.query;
          classified = true;
        }
      } catch { /* tenta o fallback */ }
      // fallback HTTPS (direto no IP de saída) quando o ip-api falha/limita.
      if (!classified && exitIp) {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 4000);
          const r = await fetch(`https://ipwho.is/${exitIp}`, { signal: ctrl.signal });
          clearTimeout(t);
          const j = JSON.parse(await r.text());
          if (j?.success) {
            ispOrg = `${j?.connection?.asn ?? ""} ${j?.connection?.isp ?? ""} ${j?.connection?.org ?? ""}`;
            classified = true;
          }
        } catch { /* sem classificação */ }
      }
    }

    // ASN/ISP/org de datacenter/host conhecido reforça a detecção.
    const DC = /(amazon|aws|google|gcp|microsoft|azure|digitalocean|ovh|hetzner|linode|akamai|vultr|choopa|m247|leaseweb|contabo|oracle|alibaba|tencent|datacamp|g[\s-]?core|colo|host(ing)?|data\s?cent|\bvps\b|dedicated|cloud)/i;
    const looksDatacenter = isHosting || isProxyFlag || (!!ispOrg && DC.test(ispOrg));

    // 3) VEREDITO
    let quality: ProxyQuality | "unknown";
    let detail = "";
    if (!reachable) { quality = "dead"; detail = lastDetail || "não respondeu"; }
    else if (transparent) { quality = "dead"; detail = "transparente: não troca o IP (inútil p/ isolar conta)"; }
    else if (looksDatacenter && !isMobile) { quality = "datacenter"; detail = "IP de datacenter/VPN — alto risco no X"; }
    else if (!classified) { quality = "unknown"; detail = "responde, mas não deu p/ confirmar a qualidade — teste de novo"; }
    else if (latency_ms > 3500) { quality = "slow"; detail = `residencial, porém lento (${latency_ms}ms)`; }
    else { quality = "good"; detail = isMobile ? "residencial/móvel" : "residencial"; }

    const status = reachable && !transparent ? "active" : "dead";
    await context.supabase
      .from("proxies")
      .update({
        status,
        quality,
        latency_ms: latency_ms || null,
        exit_ip: exitIp || null,
        last_tested_at: new Date().toISOString(),
      })
      .eq("id", data.proxy_id);

    return { status, quality, latency_ms, exit_ip: exitIp, detail, samples: samples.length, transparent };
  });
