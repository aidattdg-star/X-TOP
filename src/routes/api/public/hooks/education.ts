// Worker do "Educar Conta".
//   1) Para cada conta com educação ativa cuja última execução foi há > 30 min:
//      - escolhe 1 keyword aleatória
//      - busca tweets recentes (Latest), filtra os últimos 30 min, pega top-10 por views
//      - enfileira em education_tasks com gap de 2:30 entre cada like
//   2) Processa education_tasks pendentes (claim → like → mark done).
//
// Bypassa auth (/api/public/*). Não confia em input de request.

import { createFileRoute } from "@tanstack/react-router";

type AuthTokens = { ct0: string; auth_token: string; cookie_string?: string; refreshed?: boolean };
type ProxyInfo = { ip: string; port: number; username?: string | null; password?: string | null };

const DISCOVERY_INTERVAL_MIN = 180; // pausa de 3h entre lotes por conta
const RECENT_WINDOW_MIN = 30;
const TOP_N = 5; // 5 likes por lote, depois conta pausa por 3h
const GAP_SECONDS = 150; // 2:30
const LIKE_BATCH = 5;

export const Route = createFileRoute("/api/public/hooks/education")({
  server: {
    handlers: {
      GET: async () => handle(),
      POST: async () => handle(),
    },
  },
});

async function handle(): Promise<Response> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const result = { discovered: 0, enqueued: 0, liked: 0, failed: 0, errors: [] as string[] };

  // ---------- 1) DISCOVERY ----------
  try {
    const cutoff = new Date(Date.now() - DISCOVERY_INTERVAL_MIN * 60_000).toISOString();
    const { data: eduRows } = await supabaseAdmin
      .from("account_education")
      .select("twitter_account_id, user_id, keywords, last_run_at, enabled")
      .eq("enabled", true);

    const due = (eduRows ?? []).filter(
      (r: any) =>
        (r.keywords?.length ?? 0) > 0 &&
        (!r.last_run_at || r.last_run_at < cutoff),
    );

    for (const row of due) {
      try {
        const { data: acc } = await supabaseAdmin
          .from("twitter_accounts")
          .select("id, username, auth_tokens, proxy_id, status")
          .eq("id", row.twitter_account_id)
          .maybeSingle();
        if (!acc) continue;
        const tokens = acc.auth_tokens as AuthTokens;
        if (!tokens?.ct0 || !tokens?.auth_token) {
          await elog(supabaseAdmin, row.user_id, acc.id, "warn",
            `Educar @${acc.username}: cookies ausentes, pulando`);
          continue;
        }

        const keyword = row.keywords[Math.floor(Math.random() * row.keywords.length)];

        // Busca via pool rotativo (não usa mais a conta sendo educada para buscar)
        const { searchRecentTweets, buildDispatcher } = await import("@/lib/twitter-client.server");
        const { withRotator } = await import("@/lib/account-rotator.server");
        const searchResult = await withRotator(supabaseAdmin, row.user_id, async (reader) => {
          const dispatcher = buildDispatcher(reader.proxy);
          return await searchRecentTweets(reader.tokens, keyword, 50, dispatcher);
        });

        if (!searchResult.ok) {
          await elog(supabaseAdmin, row.user_id, acc.id, "warn",
            `Educar @${acc.username}: "${keyword}" — pool sem contas disponíveis (${searchResult.reason}, tentadas: ${searchResult.tried})`);
          await supabaseAdmin
            .from("account_education")
            .update({ last_run_at: new Date().toISOString() })
            .eq("twitter_account_id", acc.id);
          continue;
        }

        const tweets = searchResult.value;
        const readerName = searchResult.account.username;

        const cutoffMs = Date.now() - RECENT_WINDOW_MIN * 60_000;
        const recent = tweets.filter((t) => {
          const ts = Date.parse(t.created_at);
          return Number.isFinite(ts) ? ts >= cutoffMs : true;
        });

        const pool = recent.length > 0 ? recent : tweets;
        const top = pool
          .sort((a, b) => b.view_count - a.view_count)
          .slice(0, TOP_N);

        const baseTime = Date.now();
        const rows = top.map((t, i) => ({
          user_id: row.user_id,
          twitter_account_id: acc.id,
          tweet_id: t.id,
          keyword,
          view_count: t.view_count,
          scheduled_for: new Date(baseTime + (i + 1) * GAP_SECONDS * 1000).toISOString(),
          status: "pending" as const,
        }));

        result.discovered++;

        if (rows.length) {
          const { error: insErr, count } = await supabaseAdmin
            .from("education_tasks")
            .upsert(rows, { onConflict: "twitter_account_id,tweet_id", ignoreDuplicates: true, count: "exact" });
          if (insErr) {
            result.errors.push(`enqueue ${acc.username}: ${insErr.message}`);
          } else {
            result.enqueued += count ?? rows.length;
            await elog(supabaseAdmin, row.user_id, acc.id, "info",
              `Educar @${acc.username}: "${keyword}" (leitura via @${readerName}) → ${tweets.length} achados / ${recent.length} recentes → ${count ?? rows.length} enfileirado(s) (gap 2:30)`);
          }
        } else {
          await elog(supabaseAdmin, row.user_id, acc.id, "warn",
            `Educar @${acc.username}: "${keyword}" (leitura via @${readerName}) — busca retornou 0 tweets`);
        }

        // Persiste ct0/auth_token rotacionados pela busca
        // last_run_at marca o fim do lote (último like agendado), para que a
        // próxima descoberta só rode 3h após o 5º like dessa conta.
        const lastLikeAt = rows.length
          ? rows[rows.length - 1].scheduled_for
          : new Date().toISOString();
        await supabaseAdmin
          .from("account_education")
          .update({ last_run_at: lastLikeAt })
          .eq("twitter_account_id", acc.id);
        if (tokens.refreshed) {
          const { refreshed: _r, ...persist } = tokens;
          await supabaseAdmin.from("twitter_accounts")
            .update({ auth_tokens: persist, updated_at: new Date().toISOString() })
            .eq("id", acc.id);
        }
      } catch (e) {
        const msg = (e as Error).message;
        result.errors.push(`discovery ${row.twitter_account_id}: ${msg}`);
        await elog(supabaseAdmin, row.user_id, row.twitter_account_id, "error",
          `Educar conta falhou: ${msg}`);
        await supabaseAdmin
          .from("account_education")
          .update({ last_run_at: new Date().toISOString() })
          .eq("twitter_account_id", row.twitter_account_id);
      }
    }
  } catch (e) { result.errors.push(`discovery: ${(e as Error).message}`); }

  // ---------- 2) PROCESS PENDING LIKES ----------
  try {
    const { data: pending } = await supabaseAdmin
      .from("education_tasks")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_for", new Date().toISOString())
      .order("scheduled_for", { ascending: true })
      .limit(LIKE_BATCH);

    for (const task of pending ?? []) {
      const { data: claimed } = await supabaseAdmin
        .from("education_tasks")
        .update({ status: "processing", attempts: (task.attempts ?? 0) + 1 })
        .eq("id", task.id)
        .eq("status", "pending")
        .select("id").maybeSingle();
      if (!claimed) continue;

      try {
        await likeOne(supabaseAdmin, task);
        await supabaseAdmin.from("education_tasks")
          .update({ status: "completed", last_error: null }).eq("id", task.id);
        result.liked++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await supabaseAdmin.from("education_tasks")
          .update({ status: "failed", last_error: msg }).eq("id", task.id);
        await elog(supabaseAdmin, task.user_id, task.twitter_account_id, "error",
          `Educar: like falhou em ${task.tweet_id}: ${msg}`);
        result.failed++;
      }
    }
  } catch (e) { result.errors.push(`process: ${(e as Error).message}`); }

  return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
}

async function likeOne(admin: any, task: any) {
  const { likeTweet, buildDispatcher } = await import("@/lib/twitter-client.server");
  const { data: acc } = await admin
    .from("twitter_accounts")
    .select("id, username, auth_tokens, proxy_id")
    .eq("id", task.twitter_account_id)
    .maybeSingle();
  if (!acc) throw new Error("Conta não encontrada");

  const tokens = { ...(acc.auth_tokens as AuthTokens) };
  if (!tokens?.ct0 || !tokens?.auth_token) throw new Error("Cookies ausentes");

  let proxy: ProxyInfo | null = null;
  if (acc.proxy_id) {
    const { data: p } = await admin
      .from("proxies").select("ip, port, username, password").eq("id", acc.proxy_id).maybeSingle();
    if (p) proxy = p as ProxyInfo;
  }
  const dispatcher = buildDispatcher(proxy);

  try {
    await likeTweet(tokens, task.tweet_id, dispatcher);
    await elog(admin, task.user_id, acc.id, "info",
      `Educar @${acc.username}: like em ${task.tweet_id}${task.keyword ? ` (${task.keyword})` : ""}`);
  } finally {
    try {
      const { markAccountUsed } = await import("@/lib/account-rotator.server");
      await markAccountUsed(admin, acc.id);
    } catch { /* tolera */ }
    if (tokens.refreshed) {
      const { refreshed: _r, ...persist } = tokens;
      await admin.from("twitter_accounts")
        .update({ auth_tokens: persist, updated_at: new Date().toISOString() })
        .eq("id", acc.id);
    }
  }
}

async function elog(
  admin: any, userId: string, accountId: string | null,
  level: "info" | "warn" | "error", message: string,
) {
  await admin.from("execution_logs").insert({
    user_id: userId, flow_id: null, twitter_account_id: accountId, level, message,
  });
}
