import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Block = { tweet_url: string; account_ids: string[] };

export type MassEngageAction = "like" | "retweet" | "comment";

export type MassEngageInput = {
  blocks: Block[];
  // "Posts entre as contas": cada source posta seu último tweet, engagers fazem RT/like
  source_account_ids: string[];
  engager_account_ids: string[];
  actions: MassEngageAction[];
  // Texto do comentário (suporta spintax {a|b} e variantes com |||). Usado quando actions inclui "comment".
  comment_text?: string;
  // Modo instantâneo: agenda tudo para agora e dispara o worker na hora (sem delays).
  instant?: boolean;
  min_minutes: number;
  max_minutes: number;
};

function parseTweetId(url: string): string | null {
  const m = url.match(/status\/(\d+)/);
  return m ? m[1] : null;
}

function randBetween(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const runMassEngage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: MassEngageInput) => input)
  .handler(async ({ data, context }) => {
    const instant = !!data.instant;
    const minMin = instant ? 0 : Math.max(0.1, Number(data.min_minutes) || 2);
    const maxMin = instant ? 0 : Math.max(minMin, Number(data.max_minutes) || 10);
    const actions = (data.actions?.length ? data.actions : ["like", "retweet"]) as MassEngageAction[];
    const commentText = String(data.comment_text ?? "").trim();
    if (actions.includes("comment") && !commentText) {
      throw new Error("Comentar está ativo mas o texto do comentário está vazio.");
    }

    // Contas em aquecimento (cadeado) — não participam de ações de spam.
    const nowIso = new Date().toISOString();
    const { data: lockedRows } = await context.supabase
      .from("twitter_accounts").select("id").gt("warming_until", nowIso);
    const locked = new Set((lockedRows ?? []).map((r: any) => r.id as string));
    let lockedSkipped = 0;

    // Targets: lista de { tweet_id, engager_account_id }
    const targets: Array<{ tweet_id: string; account_id: string; label: string }> = [];

    // 1) Blocos manuais
    for (const b of data.blocks ?? []) {
      const id = parseTweetId(b.tweet_url);
      if (!id) continue;
      for (const accId of b.account_ids ?? []) {
        if (locked.has(accId)) { lockedSkipped++; continue; }
        targets.push({ tweet_id: id, account_id: accId, label: `block:${id}` });
      }
    }

    // 2) Posts entre contas — buscar último tweet de cada source via tokens próprios
    if (data.source_account_ids?.length && data.engager_account_ids?.length) {
      const { data: sources } = await context.supabase
        .from("twitter_accounts")
        .select("id, username, auth_tokens, proxy_id")
        .in("id", data.source_account_ids);

      const { getUserIdByScreenName, getUserRecentTweets, buildDispatcher } = await import(
        "@/lib/twitter-client.server"
      );

      for (const src of sources ?? []) {
        const tokens = src.auth_tokens as any;
        if (!tokens?.ct0 || !tokens?.auth_token) continue;
        try {
          let proxy: any = null;
          if (src.proxy_id) {
            const { data: p } = await context.supabase
              .from("proxies")
              .select("ip, port, username, password")
              .eq("id", src.proxy_id)
              .maybeSingle();
            proxy = p;
          }
          const dispatcher = buildDispatcher(proxy);
          const userId = await getUserIdByScreenName(tokens, src.username, dispatcher);
          const tweets = await getUserRecentTweets(tokens, userId, 5, dispatcher);
          const latest = tweets[0];
          if (!latest) continue;
          for (const accId of data.engager_account_ids) {
            if (accId === src.id) continue; // não engaja no próprio
            if (locked.has(accId)) { lockedSkipped++; continue; }
            targets.push({
              tweet_id: latest.id,
              account_id: accId,
              label: `@${src.username}`,
            });
          }
        } catch {
          // ignora falhas de leitura individuais
        }
      }
    }

    if (!targets.length) {
      throw new Error(
        lockedSkipped > 0
          ? `Nenhum alvo: ${lockedSkipped} conta(s) estão em aquecimento (cadeado) e foram puladas.`
          : "Nenhum alvo válido para engajar.",
      );
    }

    // 3) Criar flow container
    const { data: flow, error: flowErr } = await context.supabase
      .from("automation_flows")
      .insert({
        user_id: context.userId,
        name: `Mass RT & Like — ${new Date().toLocaleString("pt-BR")}`,
        description: `${targets.length} engajamento(s) agendado(s)`,
        status: "draft",
        react_flow_data: { nodes: [], edges: [] },
        account_ids: [],
      })
      .select("id")
      .single();
    if (flowErr || !flow) throw new Error(`Falha ao criar flow: ${flowErr?.message}`);

    // 4) Agendamento humanizado: por conta, acumula delays randômicos entre minMin e maxMin
    const perAccountOffset = new Map<string, number>();
    const rows: any[] = [];
    const baseTime = Date.now();
    const shuffled = shuffle(targets);

    for (const t of shuffled) {
      for (const act of shuffle(actions)) {
        const cur = perAccountOffset.get(t.account_id) ?? randBetween(0, minMin * 60_000);
        const delta = randBetween(minMin * 60_000, maxMin * 60_000);
        const next = cur + delta;
        perAccountOffset.set(t.account_id, next);
        const isComment = act === "comment";
        rows.push({
          user_id: context.userId,
          flow_id: flow.id,
          twitter_account_id: t.account_id,
          action_type: isComment ? "action.comment" : "action.mass_engage",
          payload: {
            config: isComment
              ? {
                  target_mode: "by_id",
                  tweet_id: t.tweet_id,
                  text: commentText,
                  source: t.label,
                }
              : {
                  action_type: act,
                  target_mode: "by_id",
                  tweet_id: t.tweet_id,
                  source: t.label,
                },
          },
          scheduled_for: new Date(baseTime + next).toISOString(),
          status: "pending",
        });
      }
    }

    // Insert em lotes para evitar payload gigante
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const { error: insErr } = await context.supabase.from("execution_queue").insert(slice);
      if (insErr) throw new Error(`Falha ao enfileirar (${i}): ${insErr.message}`);
    }

    await context.supabase.from("execution_logs").insert({
      user_id: context.userId,
      flow_id: flow.id,
      level: "info",
      message: `Mass RT & Like disparado${instant ? " (instantâneo)" : ""}: ${rows.length} tarefa(s) em ${perAccountOffset.size} conta(s)${lockedSkipped ? ` · ${lockedSkipped} em aquecimento puladas` : ""}`,
    });

    // Instantâneo: aciona o worker na hora pra processar já (cron pega o resto em <=1min).
    // Espera no máx ~6s só pra garantir que o worker iniciou — ele segue rodando
    // como invocação independente mesmo após o abort (evita timeout de 10s no Hobby).
    if (instant) {
      const host = process.env.VERCEL_URL || process.env.SITE_URL || "";
      if (host) {
        const baseUrl = host.startsWith("http") ? host : `https://${host}`;
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6000);
        try {
          await fetch(`${baseUrl}/api/public/hooks/run-queue`, { method: "POST", signal: ctrl.signal });
        } catch {
          /* abort/erro: o worker já foi acionado; o cron processa o resto em até 1 min */
        } finally {
          clearTimeout(t);
        }
      }
    }

    return {
      flow_id: flow.id,
      tasks: rows.length,
      accounts: perAccountOffset.size,
      targets: targets.length,
      locked_skipped: lockedSkipped,
      instant,
    };
  });
