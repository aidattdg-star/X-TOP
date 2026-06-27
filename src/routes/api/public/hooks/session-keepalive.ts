// Mantém sessões do X "vivas" — simula atividade de navegador real
// (lê Viewer + últimos tweets do próprio user) para que o X:
//   1) renove ct0 / att via Set-Cookie (capturamos e persistimos)
//   2) não classifique a conta como "robô que só aparece pra postar"
// Disparado por pg_cron a cada 15 min.
//
// Segurança: /api/public/* bypassa auth. Só lê contas já cadastradas no DB.

import { createFileRoute } from "@tanstack/react-router";

type AuthTokens = { ct0: string; auth_token: string; cookie_string?: string; refreshed?: boolean };
type ProxyInfo = { ip: string; port: number; username?: string | null; password?: string | null };

export const Route = createFileRoute("/api/public/hooks/session-keepalive")({
  server: {
    handlers: {
      GET: async () => handle(),
      POST: async () => handle(),
    },
  },
});

async function handle(): Promise<Response> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { keepAliveSession, buildDispatcher } = await import("@/lib/twitter-client.server");

  const out = { checked: 0, refreshed: 0, errors: [] as string[] };

  const { data: accounts } = await supabaseAdmin
    .from("twitter_accounts")
    .select("id, user_id, username, auth_tokens, proxy_id, status")
    .eq("status", "active");

  for (const acc of accounts ?? []) {
    const tokens = { ...(acc.auth_tokens as AuthTokens) };
    if (!tokens?.ct0 || !tokens?.auth_token) continue;
    out.checked++;

    let proxy: ProxyInfo | null = null;
    if (acc.proxy_id) {
      const { data: p } = await supabaseAdmin
        .from("proxies").select("ip, port, username, password").eq("id", acc.proxy_id).maybeSingle();
      if (p) proxy = p as ProxyInfo;
    }

    try {
      await keepAliveSession(tokens, buildDispatcher(proxy));
      if (tokens.refreshed) {
        const { refreshed: _r, ...persist } = tokens;
        await supabaseAdmin.from("twitter_accounts")
          .update({ auth_tokens: persist, updated_at: new Date().toISOString() })
          .eq("id", acc.id);
        out.refreshed++;
      }
    } catch (e) {
      const msg = (e as Error).message;
      out.errors.push(`@${acc.username}: ${msg}`);
      // Loga, mas não derruba a sessão (pode ser flake de rede).
      await supabaseAdmin.from("execution_logs").insert({
        user_id: acc.user_id,
        twitter_account_id: acc.id,
        level: "warn",
        message: `Keepalive @${acc.username} falhou: ${msg.slice(0, 200)}`,
      });
    }
  }

  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
}
