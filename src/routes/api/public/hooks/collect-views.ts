// Coleta as VIEWS (impressões) dos tweets recentes de cada conta e guarda um
// snapshot por conta em account_view_stats. O dashboard soma isso pra mostrar
// as "views totais das contas" sem precisar bater no X na hora.
//
// Processa em LOTE (as contas com snapshot mais antigo / sem snapshot primeiro),
// pra não estourar o timeout. Rode por pg_cron a cada poucos minutos — em
// algumas execuções todas as contas ficam atualizadas e seguem sendo renovadas.
//
// Segurança: /api/public/* bypassa auth. Só lê contas já cadastradas.

import { createFileRoute } from "@tanstack/react-router";

type AuthTokens = { ct0: string; auth_token: string; cookie_string?: string; refreshed?: boolean };
type ProxyInfo = { ip: string; port: number; username?: string | null; password?: string | null };

const BATCH = 8; // contas por execução (margem p/ o timeout de 10s da Vercel)

export const Route = createFileRoute("/api/public/hooks/collect-views")({
  server: {
    handlers: {
      GET: async () => handle(),
      POST: async () => handle(),
    },
  },
});

async function handle(): Promise<Response> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { getUserIdByScreenName, getUserRecentTweets, buildDispatcher } = await import(
    "@/lib/twitter-client.server"
  );

  const out = { processed: 0, total_views_batch: 0, errors: [] as string[] };

  const { data: accounts } = await supabaseAdmin
    .from("twitter_accounts")
    .select("id, user_id, username, auth_tokens, proxy_id, status")
    .eq("status", "active");
  if (!accounts?.length) {
    return new Response(JSON.stringify({ ...out, note: "sem contas ativas" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Ordena: contas sem snapshot ou com snapshot mais antigo primeiro.
  const { data: stats } = await (supabaseAdmin as any)
    .from("account_view_stats")
    .select("account_id, updated_at");
  const updatedMap = new Map<string, string>(
    (stats ?? []).map((s: any) => [String(s.account_id), String(s.updated_at)] as [string, string]),
  );
  const ordered = [...accounts].sort((a, b) => {
    const ua = updatedMap.get(a.id);
    const ub = updatedMap.get(b.id);
    if (!ua && ub) return -1;
    if (ua && !ub) return 1;
    if (!ua && !ub) return 0;
    return new Date(ua!).getTime() - new Date(ub!).getTime();
  });

  for (const acc of ordered.slice(0, BATCH)) {
    const tokens = { ...(acc.auth_tokens as AuthTokens) };
    if (!tokens?.ct0 || !tokens?.auth_token) continue;

    let proxy: ProxyInfo | null = null;
    if (acc.proxy_id) {
      const { data: p } = await supabaseAdmin
        .from("proxies").select("ip, port, username, password").eq("id", acc.proxy_id).maybeSingle();
      if (p) proxy = p as ProxyInfo;
    }

    try {
      const dispatcher = buildDispatcher(proxy);
      const uid = await getUserIdByScreenName(tokens, acc.username, dispatcher);
      const tweets = await getUserRecentTweets(tokens, uid, 20, dispatcher);
      const views = tweets.reduce((s, t) => s + (Number(t.view_count) || 0), 0);

      await (supabaseAdmin as any).from("account_view_stats").upsert(
        {
          account_id: acc.id,
          user_id: acc.user_id,
          username: acc.username,
          views,
          tweets: tweets.length,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "account_id" },
      );
      out.processed++;
      out.total_views_batch += views;
    } catch (e) {
      out.errors.push(`@${acc.username}: ${(e as Error).message.slice(0, 120)}`);
    }
  }

  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
}
