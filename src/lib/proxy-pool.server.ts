// Pool global de proxies: usa o proxy da conta se estiver saudável; senão,
// cai para um proxy saudável de QUALQUER usuário (fallback compartilhado),
// via a função pick_fallback_proxy() (SECURITY DEFINER). Server-only.

export type ProxyConn = { ip: string; port: number; username: string | null; password: string | null };

export async function loadProxyOrFallback(client: any, proxyId?: string | null): Promise<ProxyConn | null> {
  // 1) proxy da própria conta, se estiver vivo
  if (proxyId) {
    const { data: p } = await client
      .from("proxies")
      .select("ip, port, username, password, status, quality")
      .eq("id", proxyId)
      .maybeSingle();
    if (p && p.status === "active" && p.quality !== "dead") {
      return { ip: p.ip, port: p.port, username: p.username ?? null, password: p.password ?? null };
    }
  }

  // 2) fallback: um proxy saudável do pool global (qualquer usuário)
  try {
    const { data } = await client.rpc("pick_fallback_proxy");
    const f = Array.isArray(data) ? data[0] : data;
    if (f?.ip) return { ip: f.ip, port: Number(f.port), username: f.username ?? null, password: f.password ?? null };
  } catch {
    /* função pode não existir até rodar PROXY_FALLBACK.sql */
  }

  // 3) último recurso: usa o proxy da conta mesmo "morto" (melhor que sem proxy)
  if (proxyId) {
    const { data: p } = await client
      .from("proxies")
      .select("ip, port, username, password")
      .eq("id", proxyId)
      .maybeSingle();
    if (p) return { ip: p.ip, port: p.port, username: p.username ?? null, password: p.password ?? null };
  }
  return null;
}
