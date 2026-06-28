// Public cron-driven worker. Bypasses auth at /api/public/*.
// Each call:
//   1) Re-enqueues active cron flows whose last enqueue is older than their interval.
//   2) Processes up to N pending tasks in execution_queue (claim → run → mark).
//
// Security: only operates on rows already in the DB; never trusts request input.

import { createFileRoute } from "@tanstack/react-router";

type AuthTokens = { ct0: string; auth_token: string; cookie_string?: string; refreshed?: boolean };
type ProxyInfo = { ip: string; port: number; username?: string | null; password?: string | null };

const BATCH_SIZE = 10;

export const Route = createFileRoute("/api/public/hooks/run-queue")({
  server: {
    handlers: {
      GET: async () => handle(),
      POST: async () => handle(),
    },
  },
});

async function handle(): Promise<Response> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const result = { re_enqueued: 0, processed: 0, succeeded: 0, failed: 0, errors: [] as string[] };

  // ---------- 1) RE-ENQUEUE CRON FLOWS ----------
  try {
    const { data: flows } = await supabaseAdmin
      .from("automation_flows")
      .select("id, user_id, account_ids, react_flow_data, execution_interval")
      .eq("status", "active");

    for (const flow of flows ?? []) {
      const rf = (flow.react_flow_data ?? {}) as { nodes?: any[]; edges?: any[] };
      const nodes = rf.nodes ?? [];
      const edges = rf.edges ?? [];
      const cronTrigger = nodes.find((n: any) => n.data?.kind === "trigger.cron");
      if (!cronTrigger) continue;

      const cfg = cronTrigger.data?.config ?? {};
      const baseMin = cronExprToMinutes(
        (cfg.cron as string) || (flow.execution_interval as string) || "0 */1 * * *",
      ) ?? 60;
      // Intervalo humano randomizado: usa min/max se definidos, senão ±30% do cron base.
      const minM = Math.max(0.5, Number(cfg.interval_min) || baseMin * 0.7);
      const maxM = Math.max(minM, Number(cfg.interval_max) || baseMin * 1.3);

      const { data: lastRows } = await supabaseAdmin
        .from("execution_queue").select("created_at").eq("flow_id", flow.id)
        .order("created_at", { ascending: false }).limit(1);
      const lastAt = lastRows?.[0]?.created_at as string | undefined;
      if (lastAt) {
        const thr = humanThresholdMin(flow.id + ":" + lastAt, minM, maxM);
        if (Date.now() - Date.parse(lastAt) < thr * 60_000) continue;
      }

      const accountIds = await validTwitterAccountIds(supabaseAdmin, flow.account_ids ?? []);
      if (flow.account_ids?.length && accountIds.length < flow.account_ids.length) {
        await log(supabaseAdmin, flow.user_id, flow.id, "warn",
          `Cron: ${flow.account_ids.length - accountIds.length} conta(s) inválida(s) ignorada(s)`);
      }

      const rows = expandActions(flow.id, flow.user_id, accountIds, nodes, edges);
      if (!rows.length) continue;

      const { error: insErr } = await supabaseAdmin.from("execution_queue").insert(rows);
      if (insErr) { result.errors.push(`enqueue ${flow.id}: ${insErr.message}`); continue; }
      result.re_enqueued += rows.length;
      await log(supabaseAdmin, flow.user_id, flow.id, "info", `Re-enfileirado ${rows.length} tarefa(s) (cron)`);
    }
  } catch (e) { result.errors.push(`re-enqueue: ${(e as Error).message}`); }

  // ---------- 1b) MONITOR ACCOUNT TRIGGERS ----------
  try {
    const { data: flows } = await supabaseAdmin
      .from("automation_flows")
      .select("id, user_id, account_ids, react_flow_data")
      .eq("status", "active");

    for (const flow of flows ?? []) {
      const rf = (flow.react_flow_data ?? {}) as { nodes?: any[]; edges?: any[] };
      const nodes = rf.nodes ?? [];
      const edges = rf.edges ?? [];
      const monitor = nodes.find((n: any) => n.data?.kind === "trigger.monitor_account");
      if (!monitor) continue;

      const mcfg = monitor.data?.config ?? {};
      const handle = String(mcfg.account ?? "").replace(/^@/, "").trim();
      if (!handle) continue;
      // Intervalo humano randomizado entre min e max (fallback p/ interval_minutes legado).
      const minM = Math.max(1, Number(mcfg.interval_min) || Number(mcfg.interval_minutes) || 3);
      const maxM = Math.max(minM, Number(mcfg.interval_max) || minM);
      const accountIds: string[] = flow.account_ids ?? [];

      const { data: state } = await supabaseAdmin
        .from("flow_monitor_state").select("last_tweet_id, last_checked_at, processed_tweet_ids")
        .eq("flow_id", flow.id).maybeSingle();

      if (state?.last_checked_at) {
        const lastMs = Date.parse(state.last_checked_at);
        const thr = humanThresholdMin(flow.id + ":" + state.last_checked_at, minM, maxM);
        if (Date.now() - lastMs < thr * 60_000) continue;
      }

      const nowIsoChk = new Date().toISOString();
      const { data: accsRaw } = accountIds.length
        ? await supabaseAdmin
            .from("twitter_accounts")
            .select("id, username, auth_tokens, proxy_id, warming_until")
            .in("id", accountIds)
        : { data: [] as any[] };
      // Exclui contas em aquecimento (cadeado) das ações do monitor.
      const accs = (accsRaw ?? []).filter((a: any) => !a.warming_until || a.warming_until <= nowIsoChk);
      let validAccountIds = accs.map((a: any) => a.id as string);
      if (accountIds.length && validAccountIds.length < accountIds.length) {
        await log(supabaseAdmin, flow.user_id, flow.id, "warn",
          `Monitor @${handle}: ${accountIds.length - validAccountIds.length} conta(s) inválida(s) ignorada(s)`);
      }

      const nowIso = new Date().toISOString();

      try {
        const { getUserIdByScreenName, getUserRecentTweets, buildDispatcher } =
          await import("@/lib/twitter-client.server");
        const { withRotator } = await import("@/lib/account-rotator.server");

        // Leitura via pool rotativo (escolhe a conta menos usada recentemente)
        const readResult = await withRotator(supabaseAdmin, flow.user_id, async (reader) => {
          const dispatcher = buildDispatcher(reader.proxy);
          const xUserId = await getUserIdByScreenName(reader.tokens, handle, dispatcher);
          return await getUserRecentTweets(reader.tokens, xUserId, 20, dispatcher);
        });

        if (!readResult.ok) {
          await log(supabaseAdmin, flow.user_id, flow.id, "warn",
            `Monitor @${handle}: pool sem contas disponíveis (${readResult.reason})`);
          await supabaseAdmin.from("flow_monitor_state")
            .upsert({ flow_id: flow.id, last_checked_at: nowIso, updated_at: nowIso });
          continue;
        }

        const tweets = readResult.value;
        const readerName = readResult.account.username;

        // Garante que pelo menos uma conta executora exista (fallback para a leitora)
        if (!validAccountIds.length) {
          validAccountIds = [readResult.account.id];
          await log(supabaseAdmin, flow.user_id, flow.id, "info",
            `Monitor @${handle}: sem contas no fluxo, usando @${readerName} como executora`);
        }
        const newest = tweets[0]?.id ?? null;

        if (!tweets.length) {
          await log(supabaseAdmin, flow.user_id, flow.id, "warn",
            `Monitor @${handle}: leitura via @${readerName} OK, mas o X retornou 0 tweets recentes`);
        }

        // First run → baseline only, no actions
        if (!state) {
          await supabaseAdmin.from("flow_monitor_state").upsert({
            flow_id: flow.id, last_tweet_id: newest, last_checked_at: nowIso, updated_at: nowIso,
            processed_tweet_ids: newest ? [newest] : [],
          });
          await log(supabaseAdmin, flow.user_id, flow.id, "info",
            `Monitor @${handle} iniciado (baseline: ${newest ?? "nenhum tweet"})`);
          continue;
        }

        // Tweets not yet processed. Prefer the newest-first timeline boundary over timestamps,
        // because X dates can be absent/variant and we must not miss a tweet after a bad read.
        const processedSet = new Set<string>(state.processed_tweet_ids ?? []);
        const candidates: typeof tweets = [];
        for (const tweet of tweets) {
          if (tweet.id === state.last_tweet_id) break;
          if (!processedSet.has(tweet.id)) candidates.push(tweet);
        }

        let picked: { id: string; favorite_count: number; view_count: number } | null = null;
        if (candidates.length) {
          const selectMode = (monitor.data?.config?.select_mode as string) || "last";
          if (selectMode === "most_liked") {
            picked = candidates.reduce((a, b) => (a.favorite_count >= b.favorite_count ? a : b));
          } else if (selectMode === "most_viewed") {
            picked = candidates.reduce((a, b) => (a.view_count >= b.view_count ? a : b));
          } else {
            // "last" → most recent (tweets[] is newest-first)
            picked = candidates[0];
          }
        }

        if (picked) {
          const rows = expandActions(flow.id, flow.user_id, validAccountIds, nodes, edges, picked.id);
          if (rows.length) {
            const { error: insErr } = await supabaseAdmin.from("execution_queue").insert(rows);
            if (insErr) {
              result.errors.push(`monitor enqueue ${flow.id}: ${insErr.message}`);
              await log(supabaseAdmin, flow.user_id, flow.id, "error",
                `Monitor @${handle}: falha ao enfileirar tweet ${picked.id}: ${insErr.message}`);
            } else {
              result.re_enqueued += rows.length;
              processedSet.add(picked.id);
              await log(supabaseAdmin, flow.user_id, flow.id, "info",
                `Monitor @${handle}: tweet ${picked.id} selecionado (${(monitor.data?.config?.select_mode as string) || "last"}) — enfileirado ${rows.length} tarefa(s)`);
            }
          }
        } else if (tweets.length) {
          await log(supabaseAdmin, flow.user_id, flow.id, "info",
            `Monitor @${handle}: nenhum tweet novo no intervalo (${tweets.length} tweet(s) lidos)`);
        }

        // Keep processed list bounded (last 200)
        const processedArr = Array.from(processedSet).slice(-200);

        await supabaseAdmin.from("flow_monitor_state").upsert({
          flow_id: flow.id,
          last_tweet_id: newest ?? state.last_tweet_id,
          last_checked_at: nowIso,
          updated_at: nowIso,
          processed_tweet_ids: processedArr,
        });
      } catch (e) {
        const msg = (e as Error).message;
        result.errors.push(`monitor ${flow.id}: ${msg}`);
        await log(supabaseAdmin, flow.user_id, flow.id, "error", `Monitor @${handle} falhou: ${msg}`);
        await supabaseAdmin.from("flow_monitor_state").upsert({
          flow_id: flow.id, last_checked_at: nowIso, updated_at: nowIso,
        });
      }
    }
  } catch (e) { result.errors.push(`monitor: ${(e as Error).message}`); }

  // ---------- 2) PROCESS PENDING ----------
  try {
    await recoverStaleProcessing(supabaseAdmin);

    const { data: pending } = await supabaseAdmin
      .from("execution_queue")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_for", new Date().toISOString())
      .order("scheduled_for", { ascending: true })
      .limit(BATCH_SIZE);

    for (const task of pending ?? []) {
      const { data: claimed } = await supabaseAdmin
        .from("execution_queue")
        .update({
          status: "processing",
          attempts: (task.attempts ?? 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", task.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (!claimed) continue;
      result.processed++;

      try {
        await runTask(supabaseAdmin, task);
        await supabaseAdmin
          .from("execution_queue")
          .update({ status: "completed", last_error: null, updated_at: new Date().toISOString() })
          .eq("id", task.id);
        await log(supabaseAdmin, task.user_id, task.flow_id, "info", `OK: ${task.action_type}`, task.twitter_account_id);
        result.succeeded++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        // Conta em aquecimento: adia a tarefa pro fim do cadeado, sem contar como falha/tentativa.
        if (msg.startsWith("__WARMING__:")) {
          const until = msg.slice("__WARMING__:".length);
          const next = new Date(Date.parse(until) + Math.floor(Math.random() * 30) * 60_000).toISOString();
          await supabaseAdmin
            .from("execution_queue")
            .update({ status: "pending", scheduled_for: next, attempts: task.attempts ?? 0, last_error: "Conta em aquecimento (cadeado) — adiada", updated_at: new Date().toISOString() })
            .eq("id", task.id);
          continue;
        }

        const attempt = (task.attempts ?? 0) + 1; // valor já persistido no claim
        const MAX_RETRY = 4;

        // Conta limitada/em verificação: X aceitou mas descartou o RT (resposta vazia).
        // Não adianta repetir — sinaliza a conta pra você verificar (telefone/captcha) e falha.
        if (msg.startsWith("__RT_LIMITED__")) {
          await markAccountLimited(supabaseAdmin, task.twitter_account_id);
          await supabaseAdmin
            .from("execution_queue")
            .update({
              status: "failed",
              last_error: "Conta limitada/em verificação: X descartou o RT (like funciona, RT não). Verifique a conta (telefone/captcha).",
              updated_at: new Date().toISOString(),
            })
            .eq("id", task.id);
          await log(supabaseAdmin, task.user_id, task.flow_id, "warn",
            "Conta marcada como LIMITADA: o X aceitou mas não retweetou (provável verificação pendente — telefone/captcha). Like funciona, RT não.",
            task.twitter_account_id);
          result.failed++;
          continue;
        }

        // Perfil morto (suspenso/banido/sessão inválida): marca conta + proxy como die e falha de vez.
        if (isProfileDeadError(msg)) {
          await markProfileDead(supabaseAdmin, task.twitter_account_id);
          await supabaseAdmin
            .from("execution_queue")
            .update({ status: "failed", last_error: `Perfil caiu (die): ${msg.slice(0, 140)}`, updated_at: new Date().toISOString() })
            .eq("id", task.id);
          await log(supabaseAdmin, task.user_id, task.flow_id, "error",
            `Perfil marcado como DIE (conta + proxy): ${msg.slice(0, 120)}`, task.twitter_account_id);
          result.failed++;
          continue;
        }

        // Bloqueios temporários do X: 226 (parece automatizado), rate limit, "try again later".
        const isTemporary = /\(226\)|might be automated|try again later|\b429\b|rate.?limit|over capacity|timeout|ECONN|ETIMEDOUT|socket/i.test(msg);
        // Falha provavelmente ligada ao proxy/IP → conta contra a qualidade do proxy.
        if (isTemporary) await bumpProxyFail(supabaseAdmin, task.twitter_account_id);

        if (isTemporary && attempt < MAX_RETRY) {
          // backoff crescente com jitter: ~15, 30, 60 min
          const baseMin = [15, 30, 60][Math.min(attempt - 1, 2)];
          const cooldownMin = baseMin + Math.floor(Math.random() * 10);
          const next = new Date(Date.now() + cooldownMin * 60_000).toISOString();
          await supabaseAdmin
            .from("execution_queue")
            .update({
              status: "pending",
              scheduled_for: next,
              last_error: `Bloqueio temporário (tentativa ${attempt}/${MAX_RETRY}) — re-agendado p/ +${cooldownMin}min: ${msg.slice(0, 160)}`,
              updated_at: new Date().toISOString(),
            })
            .eq("id", task.id);
          await log(supabaseAdmin, task.user_id, task.flow_id, "warn",
            `RE-AGENDADO ${task.action_type} (+${cooldownMin}min, tent. ${attempt}/${MAX_RETRY}): ${msg.slice(0, 140)}`,
            task.twitter_account_id);
        } else {
          await supabaseAdmin
            .from("execution_queue")
            .update({ status: "failed", last_error: msg, updated_at: new Date().toISOString() })
            .eq("id", task.id);
          await log(supabaseAdmin, task.user_id, task.flow_id, "error", `FAIL ${task.action_type}: ${msg}`, task.twitter_account_id);
          result.failed++;
        }
      }
    }
  } catch (e) { result.errors.push(`process: ${(e as Error).message}`); }

  return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
}

// ---- runner ----

async function recoverStaleProcessing(admin: any) {
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const now = new Date().toISOString();
  const { data: stale } = await admin
    .from("execution_queue")
    .select("id, attempts, action_type")
    .eq("status", "processing")
    .lt("updated_at", cutoff)
    .limit(50);

  for (const task of stale ?? []) {
    const attempts = Number(task.attempts ?? 0);
    if (attempts >= 3) {
      await admin
        .from("execution_queue")
        .update({
          status: "failed",
          last_error: "Tarefa travada em processamento por mais de 15min; marcada como falha automaticamente.",
          updated_at: now,
        })
        .eq("id", task.id)
        .eq("status", "processing");
    } else {
      await admin
        .from("execution_queue")
        .update({
          status: "pending",
          last_error: "Tarefa retomada automaticamente após travar em processamento.",
          updated_at: now,
        })
        .eq("id", task.id)
        .eq("status", "processing");
    }
  }
}

async function runTask(admin: any, task: any) {
  const {
    postTweet,
    retweet,
    commentReply,
    likeTweet,
    buildDispatcher,
  } = await import("@/lib/twitter-client.server");

  if (!task.twitter_account_id) throw new Error("Tarefa sem twitter_account_id");

  const { data: acc, error } = await admin
    .from("twitter_accounts")
    .select("id, username, auth_tokens, proxy_id, warming_until")
    .eq("id", task.twitter_account_id)
    .maybeSingle();
  if (error || !acc) throw new Error("Conta não encontrada");

  // Cadeado de aquecimento: conta travada não executa ações de spam — adia a tarefa.
  if (acc.warming_until && Date.parse(acc.warming_until) > Date.now()) {
    throw new Error(`__WARMING__:${acc.warming_until}`);
  }

  const tokens = { ...(acc.auth_tokens as AuthTokens) };
  if (!tokens?.ct0 || !tokens?.auth_token) throw new Error("Cookies (ct0/auth_token) ausentes na conta");

  // Load proxy (optional)
  let proxy: ProxyInfo | null = null;
  if (acc.proxy_id) {
    const { data: p } = await admin
      .from("proxies").select("ip, port, username, password").eq("id", acc.proxy_id).maybeSingle();
    if (p) proxy = p as ProxyInfo;
  }
  const dispatcher = buildDispatcher(proxy);

  const config = (task.payload?.config ?? {}) as Record<string, any>;
  const kind = task.action_type as string;
  const monitoredHandle = await findMonitoredHandle(admin, task.flow_id);

  try {
    switch (kind) {
      case "action.post_tweet": {
        let text = pickTextVariant(String(config.text ?? "").trim());
        if (!text) throw new Error("Texto do tweet vazio");
        if (config.anti_duplicate !== false) {
          text = humanizeShortContent(text, `${task.id}:${acc.username}:post`);
          const minute = Math.floor(Date.now() / 60_000);
          const zw = "\u200B".repeat((minute % 5) + 1);
          text = `${text}${zw}`;
        }
        const r = await runWithDuplicateRetry(
          (nextText) => postTweet(tokens, nextText, dispatcher),
          text,
          config.anti_duplicate !== false,
          `${task.id}:${acc.username}:post`,
        );
        await log(admin, task.user_id, task.flow_id, "info",
          `Tweet publicado: https://x.com/${acc.username}/status/${r.rest_id}`, task.twitter_account_id);
        break;
      }
      case "action.retweet": {
        const id = await resolveTweetId(admin, task.user_id, config, tokens, monitoredHandle, dispatcher, task.payload?.trigger_tweet_id);
        await retweet(tokens, id, dispatcher);
        await setRetweetCooldown(admin, acc.id);
        break;
      }
      case "action.comment": {
        const id = await resolveTweetId(admin, task.user_id, config, tokens, monitoredHandle, dispatcher, task.payload?.trigger_tweet_id);
        let text = pickTextVariant(String(config.text ?? "").trim());
        if (!text) throw new Error("Comentário vazio");
        if (config.anti_duplicate !== false) {
          text = humanizeShortContent(text, `${task.id}:${acc.username}:comment`);
        }
        await runWithDuplicateRetry(
          (nextText) => commentReply(tokens, id, nextText, dispatcher),
          text,
          config.anti_duplicate !== false,
          `${task.id}:${acc.username}:comment`,
        );
        break;
      }
      case "action.mass_engage": {
        const id = await resolveTweetId(admin, task.user_id, config, tokens, monitoredHandle, dispatcher, task.payload?.trigger_tweet_id);
        const type = (config.action_type as string) || "like";
        if (type === "like") await likeTweet(tokens, id, dispatcher);
        else if (type === "retweet") {
          await retweet(tokens, id, dispatcher);
          await setRetweetCooldown(admin, acc.id);
        } else throw new Error(`mass_engage tipo '${type}' não implementado`);
        break;
      }
      default:
        throw new Error(`Ação desconhecida: ${kind}`);
    }
  } finally {
    // Atualiza last_used_at para o rotator considerar essa conta "usada agora"
    try {
      const { markAccountUsed } = await import("@/lib/account-rotator.server");
      await markAccountUsed(admin, acc.id);
    } catch { /* tolera */ }
    // Sempre persiste cookies se X rotacionou ct0/auth_token — mesmo em falha,
    // o token novo já foi setado e o velho não funciona mais.
    if (tokens.refreshed) {
      const { refreshed: _r, ...persist } = tokens;
      await admin.from("twitter_accounts")
        .update({ auth_tokens: persist, updated_at: new Date().toISOString() })
        .eq("id", acc.id);
    }
  }
}

async function runWithDuplicateRetry<T>(
  run: (text: string) => Promise<T>,
  initialText: string,
  antiDuplicate: boolean,
  seed: string,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    const text = attempt === 0 || !antiDuplicate
      ? initialText
      : addNaturalDuplicateVariant(stripZeroWidth(initialText), seed, attempt);
    try {
      return await run(text);
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!antiDuplicate || !isDuplicateStatusError(msg) || attempt === 3) throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function isDuplicateStatusError(message: string): boolean {
  return /status is a duplicate|code["':\s]+187|\(187\)|duplicate/i.test(message);
}

function pickTextVariant(text: string): string {
  const alternatives = text
    .split(/\s*\|\|\|\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  return expandSpintax(pick(alternatives.length ? alternatives : [text]));
}

function expandSpintax(text: string): string {
  let out = text;
  for (let i = 0; i < 8; i++) {
    const next = out.replace(/\{([^{}]+)\}/g, (_match, body: string) => {
      const options = String(body).split("|").map((option) => option.trim()).filter(Boolean);
      return pick(options.length ? options : [body]);
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

function stripZeroWidth(text: string): string {
  return text.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
}

const HUMANIZE_EMOJI_POOL = [
  "🔥","👀","👇","✅","✨","💬","📌","🤝","🚀","💯","⚡","🎯","🌟","💡","🧠","📈",
  "🙌","👏","💎","🛠️","📎","🔗","🟢","🟣","🟡","🔵","➡️","🆕","🎉","🥳","😎","🤩",
  "👍","💥","🌀","🪄","🧩","🔎","📰","📣","🗣️","🤯","🫡","🫶","🤌","☑️","🟦","🟧",
] as const;

// Aplica variação humanizada quando o conteúdo é curto / só link / só link+pouco texto,
// que é exatamente o caso que dispara o erro 187 (duplicate status) no X.
// Adiciona 1-2 emojis aleatórios em posição variada (fim, início, antes do link, nova linha).
function humanizeShortContent(text: string, seed: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  const withoutUrls = trimmed.replace(/https?:\/\/\S+/g, "").trim();
  const isLinkOnlyOrShort = withoutUrls.length < 25;
  if (!isLinkOnlyOrShort) return trimmed;

  const hash = hashSeed(`${seed}:${Date.now()}:${Math.random()}`);
  const e1 = HUMANIZE_EMOJI_POOL[hash % HUMANIZE_EMOJI_POOL.length];
  const useTwo = ((hash >> 5) & 1) === 1;
  const e2 = useTwo ? HUMANIZE_EMOJI_POOL[(hash >> 8) % HUMANIZE_EMOJI_POOL.length] : "";
  const combo = useTwo && e1 !== e2 ? `${e1}${e2}` : e1;

  const position = (hash >> 11) % 5;
  let candidate: string;
  switch (position) {
    case 0: candidate = `${trimmed} ${combo}`; break;
    case 1: candidate = `${trimmed}\n${combo}`; break;
    case 2: candidate = `${combo} ${trimmed}`; break;
    case 3: {
      // Insere antes do primeiro link, se houver
      const m = trimmed.match(/https?:\/\/\S+/);
      if (m && typeof m.index === "number") {
        candidate = `${trimmed.slice(0, m.index)}${combo} ${trimmed.slice(m.index)}`.replace(/\s+/g, " ").trim();
      } else {
        candidate = `${trimmed} ${combo}`;
      }
      break;
    }
    default: candidate = `${trimmed}  ${combo}`;
  }
  return candidate.length <= 280 ? candidate : `${trimmed} ${e1}`.slice(0, 280);
}

function addNaturalDuplicateVariant(text: string, seed: string, attempt: number): string {
  const suffixes = [
    "sharing this here",
    "worth a look",
    "new one here",
    "quick share",
    "take a look",
    "dropping this here",
    "found this useful",
    "leaving this here",
  ];
  const emojis = ["👇", "👀", "🔥", "💬", "✅", "📌", "✨", "🤝"];
  const punctuation = ["", ".", "!", "!!", "…"];
  const hash = hashSeed(`${seed}:${attempt}:${Date.now()}`);
  const suffix = `${suffixes[hash % suffixes.length]} ${emojis[(hash >> 3) % emojis.length]}${punctuation[(hash >> 6) % punctuation.length]}`;
  return appendWithinTweetLimit(text, `\n\n${suffix}`);
}

function appendWithinTweetLimit(text: string, suffix: string): string {
  if (text.length + suffix.length <= 275) return `${text}${suffix}`;
  const tiny = pick([" 👇", " 👀", " 🔥", " ✅", " 💬", ".", "!"]);
  if (text.length + tiny.length <= 280) return `${text}${tiny}`;
  return text;
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)] ?? items[0];
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// Intervalo "humano": valor randomizado (mas estável por ciclo) entre min e max minutos.
// Evita intervalos redondos (30/60) — cada ciclo gera um gap diferente e quebrado.
function humanThresholdMin(seed: string, minM: number, maxM: number): number {
  if (maxM <= minM) return minM;
  const r = (hashSeed(seed) % 100000) / 100000; // 0..1 determinístico
  return minM + r * (maxM - minM);
}

async function resolveTweetId(
  admin: any,
  userId: string,
  c: Record<string, any>,
  tokens: AuthTokens,
  monitoredHandle: string | null,
  dispatcher?: any,
  triggerTweetId?: string | null,
): Promise<string> {
  const { getUserIdByScreenName, getUserRecentTweets, searchRecentTweets, buildDispatcher } =
    await import("@/lib/twitter-client.server");
  const { withRotator } = await import("@/lib/account-rotator.server");

  const mode =
    c.target_mode ||
    (c.tweet_url ? "tweet_url" : c.tweet_id ? "by_id" : triggerTweetId ? "from_trigger" : null);

  if (mode === "by_id") {
    if (!c.tweet_id) throw new Error("tweet_id ausente");
    return String(c.tweet_id);
  }

  if (mode === "tweet_url") {
    const url = String(c.tweet_url ?? "").trim();
    const m = url.match(/status\/(\d+)/);
    if (!m) throw new Error(`URL de tweet inválida: ${url}`);
    return m[1];
  }

  if (mode === "from_trigger") {
    if (!triggerTweetId) throw new Error("trigger_tweet_id ausente (use um trigger de monitoramento)");
    return String(triggerTweetId);
  }

  const windowMin = Math.max(1, Number(c.window_minutes) || 30);
  const cutoff = Date.now() - windowMin * 60_000;

  // ----- por palavra-chave (leitura via pool rotativo) -----
  if (mode === "keyword_most_liked" || mode === "keyword_most_viewed") {
    const query = String(c.keyword ?? "").trim();
    if (!query) throw new Error("keyword ausente");
    const r = await withRotator(admin, userId, async (reader) => {
      const d = buildDispatcher(reader.proxy);
      return await searchRecentTweets(reader.tokens, query, 40, d);
    });
    if (!r.ok) throw new Error(`Pool sem contas (${r.reason}) para buscar "${query}"`);
    const tweets = r.value;
    if (!tweets.length) throw new Error(`Nenhum tweet encontrado para "${query}"`);
    const inWindow = tweets.filter((t) => {
      const ts = Date.parse(t.created_at);
      return Number.isFinite(ts) ? ts >= cutoff : true;
    });
    const pool = inWindow.length ? inWindow : tweets;
    const pick =
      mode === "keyword_most_viewed"
        ? pool.reduce((a, b) => (a.view_count >= b.view_count ? a : b))
        : pool.reduce((a, b) => (a.favorite_count >= b.favorite_count ? a : b));
    return pick.id;
  }

  // ----- da conta monitorada (leitura via pool rotativo) -----
  if (
    mode === "monitor_last" ||
    mode === "monitor_most_liked" ||
    mode === "monitor_most_viewed" ||
    mode === "last_tweet" ||
    mode === "top_liked_since_refresh"
  ) {
    if (!monitoredHandle) throw new Error("Sem trigger.monitor_account no fluxo — não há conta monitorada");
    const r = await withRotator(admin, userId, async (reader) => {
      const d = buildDispatcher(reader.proxy);
      const xUserId = await getUserIdByScreenName(reader.tokens, monitoredHandle, d);
      return await getUserRecentTweets(reader.tokens, xUserId, 20, d);
    });
    if (!r.ok) throw new Error(`Pool sem contas (${r.reason}) para ler @${monitoredHandle}`);
    const tweets = r.value;
    if (!tweets.length) throw new Error(`Sem tweets recentes de @${monitoredHandle}`);

    if (mode === "monitor_last" || mode === "last_tweet") return tweets[0].id;

    const recent = tweets.filter((t) => {
      const ts = Date.parse(t.created_at);
      return Number.isFinite(ts) ? ts >= cutoff : true;
    });
    const pool = recent.length ? recent : tweets;
    const pick =
      mode === "monitor_most_viewed"
        ? pool.reduce((a, b) => (a.view_count >= b.view_count ? a : b))
        : pool.reduce((a, b) => (a.favorite_count >= b.favorite_count ? a : b));
    return pick.id;
  }

  throw new Error(`target_mode inválido: ${mode}`);
}

async function findMonitoredHandle(admin: any, flowId: string): Promise<string | null> {
  const { data } = await admin.from("automation_flows").select("react_flow_data").eq("id", flowId).maybeSingle();
  const nodes = (data?.react_flow_data?.nodes ?? []) as any[];
  const monitor = nodes.find((n) => n.data?.kind === "trigger.monitor_account");
  const acc = monitor?.data?.config?.account as string | undefined;
  return acc ? acc.replace(/^@/, "") : null;
}

// Detecta perfil "morto" (suspenso/banido/sessão inválida) pelo erro do X.
function isProfileDeadError(msg: string): boolean {
  return /suspended|account is (temporarily )?locked|account has been locked|could not authenticate you|account.*deactivated|this account is suspended|user has been suspended|\bbanned\b|\(64\)|\(32\)/i.test(msg);
}

// Marca o perfil como die (banido) e move o proxy vinculado para die também.
async function markProfileDead(admin: any, accountId?: string | null): Promise<void> {
  if (!accountId) return;
  try {
    const { data: acc } = await admin
      .from("twitter_accounts").select("proxy_id, username").eq("id", accountId).maybeSingle();
    await admin.from("twitter_accounts")
      .update({ status: "banned", warming_until: null, updated_at: new Date().toISOString() })
      .eq("id", accountId);
    if (acc?.proxy_id) {
      // colunas de qualidade podem não existir ainda — tenta com quality, cai pra só status.
      const { error } = await admin.from("proxies")
        .update({ status: "dead", quality: "dead", updated_at: new Date().toISOString() })
        .eq("id", acc.proxy_id);
      if (error) await admin.from("proxies").update({ status: "dead" }).eq("id", acc.proxy_id);
    }
  } catch { /* tolera */ }
}

// Marca a conta como "limitada/em verificação" (X aceita like mas descarta RT).
// Não mexe no proxy nem bane — só sinaliza pra você verificar (telefone/captcha).
// Tolerante: se a coluna limited_at ainda não existir, ignora.
async function markAccountLimited(admin: any, accountId?: string | null): Promise<void> {
  if (!accountId) return;
  try {
    await admin
      .from("twitter_accounts")
      .update({ limited_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", accountId);
  } catch {
    /* coluna limited_at pode não existir ainda — ignora */
  }
}

// Após um retweet, a conta entra em "refresh" (cooldown) por 1h: não é reusada
// pra novos disparos até o tempo passar (humaniza e evita spam de RT).
const RT_COOLDOWN_MIN = 60;
async function setRetweetCooldown(admin: any, accountId?: string | null): Promise<void> {
  if (!accountId) return;
  try {
    await admin
      .from("twitter_accounts")
      .update({
        cooldown_until: new Date(Date.now() + RT_COOLDOWN_MIN * 60_000).toISOString(),
        last_used_at: new Date().toISOString(),
      })
      .eq("id", accountId);
  } catch {
    /* tolera */
  }
}

// Incrementa o contador de falhas do proxy vinculado à conta (sinaliza proxy ruim).
// Tolerante: se as colunas de qualidade ainda não existem, ignora.
async function bumpProxyFail(admin: any, accountId?: string | null): Promise<void> {
  if (!accountId) return;
  try {
    const { data: acc } = await admin
      .from("twitter_accounts").select("proxy_id").eq("id", accountId).maybeSingle();
    const pid = acc?.proxy_id;
    if (!pid) return;
    const { data: px } = await admin
      .from("proxies").select("fail_count").eq("id", pid).maybeSingle();
    const next = Number(px?.fail_count ?? 0) + 1;
    const patch: Record<string, unknown> = { fail_count: next };
    if (next >= 5) patch.quality = "datacenter"; // muitas falhas = IP provavelmente sinalizado
    await admin.from("proxies").update(patch).eq("id", pid);
  } catch {
    /* colunas de qualidade podem não existir ainda — ignora */
  }
}

async function validTwitterAccountIds(admin: any, accountIds: string[]): Promise<string[]> {
  if (!accountIds.length) return [];
  const nowIso = new Date().toISOString();
  const { data } = await admin.from("twitter_accounts").select("id, warming_until").in("id", accountIds);
  // Exclui contas em aquecimento (cadeado): não participam de ações de spam.
  return (data ?? [])
    .filter((a: any) => !a.warming_until || a.warming_until <= nowIso)
    .map((a: any) => a.id as string);
}

function expandActions(flowId: string, userId: string, accountIds: string[], nodes: any[], edges: any[], triggerTweetId?: string | null): any[] {
  const childrenOf = new Map<string, string[]>();
  for (const e of edges) {
    const arr = childrenOf.get(e.source) ?? [];
    arr.push(e.target);
    childrenOf.set(e.source, arr);
  }
  const triggers = nodes.filter((n) => n.data?.kind?.startsWith("trigger."));
  const rows: any[] = [];
  const baseTime = Date.now();
  let offset = 0;
  const visit = (id: string, depth: number, seen: Set<string>) => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = nodes.find((n) => n.id === id);
    if (!node) return;
    if (node.data.kind.startsWith("action.")) {
      for (const accId of accountIds) {
        offset += 5 + depth * 2;
        rows.push({
          user_id: userId,
          flow_id: flowId,
          twitter_account_id: accId,
          action_type: node.data.kind,
          payload: { config: node.data.config ?? {}, node_id: node.id, trigger_tweet_id: triggerTweetId ?? null },
          scheduled_for: new Date(baseTime + offset * 1000).toISOString(),
          status: "pending",
        });
      }
    }
    for (const next of childrenOf.get(id) ?? []) visit(next, depth + 1, seen);
  };
  for (const t of triggers) visit(t.id, 0, new Set());
  return rows;
}

function cronExprToMinutes(expr: string): number | null {
  const m1 = expr.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (m1) return Math.max(1, Number(m1[1]));
  const m2 = expr.match(/^0\s+\*\/(\d+)\s+\*\s+\*\s+\*$/);
  if (m2) return Math.max(1, Number(m2[1]) * 60);
  if (/^0\s+0\s+\*\s+\*\s+\*$/.test(expr)) return 24 * 60;
  if (/^0\s+\*\s+\*\s+\*\s+\*$/.test(expr)) return 60;
  return null;
}

async function log(
  admin: any, userId: string, flowId: string | null,
  level: "info" | "warn" | "error", message: string, accountId?: string | null,
) {
  await admin.from("execution_logs").insert({
    user_id: userId, flow_id: flowId, twitter_account_id: accountId ?? null, level, message,
  });
}
