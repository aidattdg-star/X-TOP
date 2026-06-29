import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type AuthTokens = { ct0: string; auth_token: string; cookie_string?: string; refreshed?: boolean };

/** Lê o arquivo do bucket `media` e devolve como base64 (sem prefixo data:). */
async function downloadAsBase64(supabase: any, storagePath: string): Promise<string> {
  const { data: blob, error } = await supabase.storage.from("media").download(storagePath);
  if (error || !blob) throw new Error(`Falha ao baixar mídia: ${error?.message ?? "vazio"}`);
  const ab = await blob.arrayBuffer();
  const bytes = new Uint8Array(ab);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

// Expande spintax {a|b|c} aleatoriamente (suporta aninhado).
function expandSpintax(text: string): string {
  let out = text;
  for (let i = 0; i < 8; i++) {
    const next = out.replace(/\{([^{}]+)\}/g, (_m, body: string) => {
      const opts = String(body).split("|").map((o) => o.trim()).filter(Boolean);
      return opts.length ? opts[Math.floor(Math.random() * opts.length)] : body;
    });
    if (next === out) break;
    out = next;
  }
  return out;
}
// Escolhe UMA variação por conta: separa por ||| (texto alternativo) e expande {a|b}.
function pickVariant(text: string): string {
  const alts = text.split(/\s*\|\|\|\s*/).map((p) => p.trim()).filter(Boolean);
  const base = alts.length ? alts[Math.floor(Math.random() * alts.length)] : text;
  return expandSpintax(base);
}

// Conta caiu? (suspensa/banida/sessão inválida) — mesmos sinais do worker.
function isDeadMsg(m: string): boolean {
  return /suspended|account is (temporarily )?locked|account has been locked|could not authenticate you|deactivated|user has been suspended|\bbanned\b|\(64\)|\(32\)/i.test(m);
}
// Em falha de ação imediata: se a conta caiu, marca DIE (conta+proxy); se "bounce", LIMITADA.
async function markDownIfFell(supabase: any, accountId: string, msg: string): Promise<void> {
  try {
    if (isDeadMsg(msg)) {
      const { data: a } = await supabase
        .from("twitter_accounts").select("proxy_id").eq("id", accountId).maybeSingle();
      await supabase.from("twitter_accounts")
        .update({ status: "banned", warming_until: null, updated_at: new Date().toISOString() }).eq("id", accountId);
      if (a?.proxy_id) {
        const { error } = await supabase.from("proxies")
          .update({ status: "dead", quality: "dead", updated_at: new Date().toISOString() }).eq("id", a.proxy_id);
        if (error) await supabase.from("proxies").update({ status: "dead" }).eq("id", a.proxy_id);
      }
    } else if (/\bbounce\b/i.test(msg)) {
      await supabase.from("twitter_accounts")
        .update({ limited_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", accountId);
    }
  } catch { /* tolera (colunas podem variar) */ }
}

async function downloadAsBuffer(supabase: any, storagePath: string): Promise<Uint8Array> {
  const { data: blob, error } = await supabase.storage.from("media").download(storagePath);
  if (error || !blob) throw new Error(`Falha ao baixar mídia: ${error?.message ?? "vazio"}`);
  return new Uint8Array(await blob.arrayBuffer());
}

/** Resolve qual mediaFile usar para cada conta, conforme `mode`. */
async function resolveFilesPerAccount(
  supabase: any,
  userId: string,
  accountIds: string[],
  opts: { mediaFileId?: string; folderId?: string; mode: "same" | "random" },
): Promise<Map<string, { id: string; storage_path: string }>> {
  const out = new Map<string, { id: string; storage_path: string }>();
  if (opts.mode === "same") {
    if (!opts.mediaFileId) throw new Error("mediaFileId é obrigatório no modo 'same'");
    const { data: file } = await supabase
      .from("media_files")
      .select("id, storage_path, user_id")
      .eq("id", opts.mediaFileId)
      .maybeSingle();
    if (!file || file.user_id !== userId) throw new Error("Mídia não encontrada");
    for (const id of accountIds) out.set(id, { id: file.id, storage_path: file.storage_path });
    return out;
  }
  // random — sorteia, mas NUNCA repete o mesmo arquivo em sequência (pode reusar
  // não-consecutivamente). Embaralha e percorre em ciclos, garantindo que o
  // primeiro de um ciclo seja diferente do último do ciclo anterior.
  if (!opts.folderId) throw new Error("folderId é obrigatório no modo 'random'");
  const { data: files } = await supabase
    .from("media_files")
    .select("id, storage_path")
    .eq("folder_id", opts.folderId)
    .eq("user_id", userId);
  if (!files?.length) throw new Error("Pasta vazia");

  const shuffle = <T,>(arr: T[]): T[] => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  let prevId: string | null = null;
  if (files.length === 1) {
    for (const id of accountIds) out.set(id, { id: files[0].id, storage_path: files[0].storage_path });
    return out;
  }
  let bag: typeof files = [];
  for (const id of accountIds) {
    if (!bag.length) {
      bag = shuffle(files);
      // evita que o início do novo ciclo repita o último usado
      if (bag[0].id === prevId && bag.length > 1) [bag[0], bag[1]] = [bag[1], bag[0]];
    }
    const pick = bag.shift()!;
    prevId = pick.id;
    out.set(id, { id: pick.id, storage_path: pick.storage_path });
  }
  return out;
}

async function loadAccount(supabase: any, userId: string, accountId: string) {
  const { data: acc } = await supabase
    .from("twitter_accounts")
    .select("id, username, display_name, profile_picture_url, auth_tokens")
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!acc) throw new Error("Conta não encontrada");
  const tokens = { ...(acc.auth_tokens as AuthTokens) } as AuthTokens;
  if (!tokens?.auth_token) throw new Error("auth_token ausente — reimporte a conta");
  // Se a conta foi importada só com auth_token (sem ct0), pedimos um ct0 ao X.
  if (!tokens.ct0) {
    const { bootstrapCt0FromAuthToken } = await import("@/lib/twitter-client.server");
    const boot = await bootstrapCt0FromAuthToken(tokens.auth_token);
    tokens.ct0 = boot.ct0;
    tokens.cookie_string = boot.cookie_string;
    tokens.refreshed = true;
  }
  return { acc, tokens };
}

async function persistRefreshed(supabase: any, accountId: string, tokens: AuthTokens) {
  if (!tokens.refreshed) return;
  const { refreshed: _r, ...persist } = tokens;
  await supabase
    .from("twitter_accounts")
    .update({ auth_tokens: persist, updated_at: new Date().toISOString() })
    .eq("id", accountId);
}

async function logProfile(
  supabase: any,
  userId: string,
  accountId: string,
  field: "avatar" | "banner" | "name" | "bio" | "username" | "website",
  oldValue: string | null,
  newValue: string | null,
  status: "ok" | "failed",
  error?: string,
) {
  // Best-effort: registrar o log NUNCA deve derrubar a operação real.
  // (ex.: enum profile_field sem 'website' até rodar ADD_WEBSITE_FIELD.sql)
  try {
    const { error: insErr } = await supabase.from("profile_update_log").insert({
      user_id: userId,
      twitter_account_id: accountId,
      field,
      old_value: oldValue,
      new_value: newValue,
      status,
      error: error ?? null,
    });
    // Se o enum ainda não tem 'website', cai de volta pra 'bio' só pra registrar
    // (assim a conta entra em "Editadas" e aparece no log mesmo antes do SQL).
    if (insErr && field === "website") {
      await supabase.from("profile_update_log").insert({
        user_id: userId,
        twitter_account_id: accountId,
        field: "bio",
        old_value: oldValue,
        new_value: newValue ? `🔗 ${newValue}` : newValue,
        status,
        error: error ?? null,
      });
    }
  } catch {
    /* logging é best-effort */
  }
}

// ============================================================================
// AVATAR (em lote)
// ============================================================================
export const applyAvatarToAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    accountIds: string[];
    mode: "same" | "random";
    mediaFileId?: string;
    folderId?: string;
  }) =>
    z.object({
      accountIds: z.array(z.string().uuid()).min(1).max(100),
      mode: z.enum(["same", "random"]),
      mediaFileId: z.string().uuid().optional(),
      folderId: z.string().uuid().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const map = await resolveFilesPerAccount(
      context.supabase, context.userId, data.accountIds,
      { mode: data.mode, mediaFileId: data.mediaFileId, folderId: data.folderId },
    );

    const { updateProfileImage } = await import("@/lib/twitter-client.server");

    const results: Array<{ accountId: string; ok: boolean; error?: string }> = [];
    for (const accountId of data.accountIds) {
      const file = map.get(accountId)!;
      try {
        const { acc, tokens } = await loadAccount(context.supabase, context.userId, accountId);
        const b64 = await downloadAsBase64(context.supabase, file.storage_path);
        const resp = await updateProfileImage(tokens, b64);
        const newUrl = String(
          resp?.profile_image_url_https ?? resp?.profile_image_url ?? "",
        ).replace("_normal", "");
        await context.supabase
          .from("twitter_accounts")
          .update({
            profile_picture_url: newUrl || acc.profile_picture_url,
            updated_at: new Date().toISOString(),
          })
          .eq("id", accountId);
        await persistRefreshed(context.supabase, accountId, tokens);
        await logProfile(context.supabase, context.userId, accountId, "avatar",
          acc.profile_picture_url, newUrl || null, "ok");
        results.push({ accountId, ok: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await logProfile(context.supabase, context.userId, accountId, "avatar",
          null, null, "failed", msg);
        results.push({ accountId, ok: false, error: msg });
      }
    }
    return { results };
  });

// ============================================================================
// BANNER (em lote)
// ============================================================================
export const applyBannerToAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    accountIds: string[];
    mode: "same" | "random";
    mediaFileId?: string;
    folderId?: string;
  }) =>
    z.object({
      accountIds: z.array(z.string().uuid()).min(1).max(100),
      mode: z.enum(["same", "random"]),
      mediaFileId: z.string().uuid().optional(),
      folderId: z.string().uuid().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const map = await resolveFilesPerAccount(
      context.supabase, context.userId, data.accountIds,
      { mode: data.mode, mediaFileId: data.mediaFileId, folderId: data.folderId },
    );

    const { updateProfileBanner } = await import("@/lib/twitter-client.server");

    const results: Array<{ accountId: string; ok: boolean; error?: string }> = [];
    for (const accountId of data.accountIds) {
      const file = map.get(accountId)!;
      try {
        const { tokens } = await loadAccount(context.supabase, context.userId, accountId);
        const b64 = await downloadAsBase64(context.supabase, file.storage_path);
        await updateProfileBanner(tokens, b64);
        await persistRefreshed(context.supabase, accountId, tokens);
        await logProfile(context.supabase, context.userId, accountId, "banner",
          null, file.id, "ok");
        results.push({ accountId, ok: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await logProfile(context.supabase, context.userId, accountId, "banner",
          null, null, "failed", msg);
        results.push({ accountId, ok: false, error: msg });
      }
    }
    return { results };
  });

// ============================================================================
// Nome / Bio (lote ou individual com mesmos valores)
// ============================================================================
export const updateAccountsProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    accountIds: string[];
    name?: string;
    bio?: string;
    website?: string;
  }) =>
    z.object({
      accountIds: z.array(z.string().uuid()).min(1).max(100),
      name: z.string().trim().max(50).optional(),
      bio: z.string().trim().max(160).optional(),
      website: z.string().trim().max(100).optional(),
    }).refine((v) => v.name !== undefined || v.bio !== undefined || v.website !== undefined, {
      message: "Forneça pelo menos name, bio ou website",
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { updateProfile } = await import("@/lib/twitter-client.server");
    const results: Array<{ accountId: string; ok: boolean; error?: string }> = [];

    for (const accountId of data.accountIds) {
      try {
        const { acc, tokens } = await loadAccount(context.supabase, context.userId, accountId);
        await updateProfile(tokens, { name: data.name, description: data.bio, url: data.website });
        const patch: any = { updated_at: new Date().toISOString() };
        if (data.name !== undefined) patch.display_name = data.name;
        await context.supabase.from("twitter_accounts").update(patch).eq("id", accountId);
        await persistRefreshed(context.supabase, accountId, tokens);
        if (data.name !== undefined) {
          await logProfile(context.supabase, context.userId, accountId, "name",
            acc.display_name, data.name, "ok");
        }
        if (data.bio !== undefined) {
          await logProfile(context.supabase, context.userId, accountId, "bio",
            null, data.bio, "ok");
        }
        if (data.website !== undefined) {
          await logProfile(context.supabase, context.userId, accountId, "website",
            null, data.website, "ok");
        }
        results.push({ accountId, ok: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await logProfile(context.supabase, context.userId, accountId, "name",
          null, data.name ?? null, "failed", msg);
        results.push({ accountId, ok: false, error: msg });
      }
    }
    return { results };
  });

// ============================================================================
// DESBLOQUEAR (tornar pública) — tira o cadeado "tweets protegidos"
// ============================================================================
export const unprotectAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { accountIds: string[]; makeProtected?: boolean }) =>
    z.object({
      accountIds: z.array(z.string().uuid()).min(1).max(200),
      makeProtected: z.boolean().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { setProtected, buildDispatcher } = await import("@/lib/twitter-client.server");
    const { loadProxyOrFallback } = await import("@/lib/proxy-pool.server");
    const wantProtected = !!data.makeProtected;
    const results: Array<{ accountId: string; username?: string; ok: boolean; error?: string }> = [];
    for (const accountId of data.accountIds) {
      try {
        const { acc, tokens } = await loadAccount(context.supabase, context.userId, accountId);
        const { data: pa } = await context.supabase
          .from("twitter_accounts").select("proxy_id").eq("id", accountId).maybeSingle();
        const proxy = await loadProxyOrFallback(context.supabase, pa?.proxy_id);
        await setProtected(tokens, wantProtected, buildDispatcher(proxy));
        await persistRefreshed(context.supabase, accountId, tokens);
        results.push({ accountId, username: acc.username, ok: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await markDownIfFell(context.supabase, accountId, msg);
        results.push({ accountId, ok: false, error: msg });
      }
    }
    return { results, ok_count: results.filter((r) => r.ok).length, total: data.accountIds.length };
  });

// ============================================================================
// @ USERNAME (individual, com rate-limit 1x/dia)
// ============================================================================
export const updateAccountUsername = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { accountId: string; newUsername: string }) =>
    z.object({
      accountId: z.string().uuid(),
      newUsername: z.string().trim().regex(/^@?[A-Za-z0-9_]{1,15}$/),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    // Rate-limit: 1 tentativa por dia por conta
    const dayAgo = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const { count } = await context.supabase
      .from("profile_update_log")
      .select("id", { count: "exact", head: true })
      .eq("twitter_account_id", data.accountId)
      .eq("field", "username")
      .gte("created_at", dayAgo);
    if ((count ?? 0) > 0) {
      throw new Error("Você já tentou trocar o @ dessa conta nas últimas 24h. Espere para tentar de novo.");
    }

    const { acc, tokens } = await loadAccount(context.supabase, context.userId, data.accountId);
    const newSn = data.newUsername.replace(/^@/, "");

    try {
      const { updateUsername } = await import("@/lib/twitter-client.server");
      await updateUsername(tokens, newSn);
      await context.supabase
        .from("twitter_accounts")
        .update({ username: newSn, updated_at: new Date().toISOString() })
        .eq("id", data.accountId);
      await persistRefreshed(context.supabase, data.accountId, tokens);
      await logProfile(context.supabase, context.userId, data.accountId, "username",
        acc.username, newSn, "ok");
      return { ok: true, newUsername: newSn };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logProfile(context.supabase, context.userId, data.accountId, "username",
        acc.username, newSn, "failed", msg);
      throw new Error(msg);
    }
  });

// ============================================================================
// POSTAR TWEET (texto + mídia opcional) em várias contas
// ============================================================================
export const postTweetToAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    accountIds: string[];
    text: string;
    mode?: "same" | "random";
    mediaFileId?: string;
    mediaFileIds?: string[];
    folderId?: string;
    reply?: { text: string; minSeconds: number; maxSeconds: number };
  }) =>
    z.object({
      accountIds: z.array(z.string().uuid()).min(1).max(200),
      text: z.string().max(280),
      mode: z.enum(["same", "random"]).optional(),
      mediaFileId: z.string().uuid().optional(),
      // Várias imagens fixas (até 4) — todas as contas postam o mesmo conjunto.
      mediaFileIds: z.array(z.string().uuid()).min(1).max(4).optional(),
      folderId: z.string().uuid().optional(),
      // Auto-reply: a própria conta responde o tweet recém-postado após um tempo.
      reply: z.object({
        text: z.string().trim().min(1).max(280),
        minSeconds: z.number().min(10).max(86400),
        maxSeconds: z.number().min(10).max(86400),
      }).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const text = data.text.trim();
    const multiIds = data.mediaFileIds?.length ? data.mediaFileIds : null;
    const withMedia = !!(data.folderId || data.mediaFileId || multiIds);
    if (!text && !withMedia) throw new Error("Escreva o texto ou escolha uma mídia.");

    // Modo "várias imagens/vídeo": carrega os arquivos (na ordem escolhida).
    let multiFiles: { storage_path: string; mime: string }[] | null = null;
    let isVideo = false;
    if (multiIds) {
      const { data: files } = await context.supabase
        .from("media_files")
        .select("id, storage_path, user_id, mime_type")
        .in("id", multiIds);
      const byId = new Map((files ?? []).map((f: any) => [f.id, f]));
      multiFiles = multiIds.map((id) => {
        const f = byId.get(id);
        if (!f || f.user_id !== context.userId) throw new Error("Mídia não encontrada");
        return { storage_path: f.storage_path, mime: String(f.mime_type ?? "") };
      });
      isVideo = multiFiles.some((f) => f.mime.startsWith("video/"));
      if (isVideo && multiFiles.length !== 1)
        throw new Error("Vídeo deve ser postado sozinho (1 vídeo por tweet, sem misturar com imagens).");
    }

    const mediaMap = withMedia && !multiFiles
      ? await resolveFilesPerAccount(context.supabase, context.userId, data.accountIds, {
          mode: data.mode ?? "random",
          mediaFileId: data.mediaFileId,
          folderId: data.folderId,
        })
      : null;

    const { uploadTweetMedia, uploadTweetVideo, postTweet, buildDispatcher } = await import("@/lib/twitter-client.server");
    const { loadProxyOrFallback } = await import("@/lib/proxy-pool.server");

    const results: Array<{ accountId: string; username?: string; ok: boolean; url?: string; error?: string }> = [];
    const posted: Array<{ accountId: string; restId: string }> = [];
    for (const accountId of data.accountIds) {
      try {
        const { acc, tokens } = await loadAccount(context.supabase, context.userId, accountId);

        // proxy da conta (escrita/upload SEMPRE pelo proxy) — com fallback do pool global
        const { data: pa } = await context.supabase
          .from("twitter_accounts").select("proxy_id").eq("id", accountId).maybeSingle();
        const proxy = await loadProxyOrFallback(context.supabase, pa?.proxy_id);
        const dispatcher = buildDispatcher(proxy);

        let mediaIds: string[] | undefined;
        if (multiFiles) {
          mediaIds = [];
          if (isVideo) {
            // 1 vídeo: upload em pedaços + espera processar (por esta conta).
            const bytes = await downloadAsBuffer(context.supabase, multiFiles[0].storage_path);
            mediaIds.push(await uploadTweetVideo(tokens, bytes, multiFiles[0].mime || "video/mp4", dispatcher));
          } else {
            // até 4 imagens (media_id é por sessão) — mantém a ordem
            for (const f of multiFiles) {
              const b64 = await downloadAsBase64(context.supabase, f.storage_path);
              mediaIds.push(await uploadTweetMedia(tokens, b64, dispatcher));
            }
          }
        } else if (mediaMap) {
          const file = mediaMap.get(accountId)!;
          const b64 = await downloadAsBase64(context.supabase, file.storage_path);
          const mid = await uploadTweetMedia(tokens, b64, dispatcher);
          mediaIds = [mid];
        }

        // Cada conta posta UMA variação randomizada (||| alterna textos, {a|b} varia palavras).
        const accText = text ? pickVariant(text) : text;
        const r = await postTweet(tokens, accText, dispatcher, mediaIds);
        await persistRefreshed(context.supabase, accountId, tokens);
        results.push({ accountId, username: acc.username, ok: true, url: `https://x.com/${acc.username}/status/${r.rest_id}` });
        if (r.rest_id) posted.push({ accountId, restId: r.rest_id });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await markDownIfFell(context.supabase, accountId, msg);
        results.push({ accountId, ok: false, error: msg });
      }
    }

    // Auto-reply: agenda a própria conta para responder o tweet recém-postado
    // após um tempo (fixo ou aleatório). O worker (run-queue) publica o reply.
    let repliesScheduled = 0;
    if (data.reply && posted.length) {
      try {
        const replyText = data.reply.text.trim();
        const minS = Math.max(10, data.reply.minSeconds);
        const maxS = Math.max(minS, data.reply.maxSeconds);
        const { data: flow } = await context.supabase
          .from("automation_flows")
          .insert({
            user_id: context.userId,
            name: `Auto-reply — ${new Date().toLocaleString("pt-BR")}`,
            description: `${posted.length} resposta(s) agendada(s)`,
            status: "draft",
            react_flow_data: { nodes: [], edges: [] } as any,
            account_ids: [],
          })
          .select("id")
          .single();
        if (flow) {
          const base = Date.now();
          const rows = posted.map((p) => {
            const delayMs = (minS + Math.random() * (maxS - minS)) * 1000;
            return {
              user_id: context.userId,
              flow_id: flow.id,
              twitter_account_id: p.accountId,
              action_type: "action.comment",
              payload: {
                config: { target_mode: "by_id", tweet_id: p.restId, text: replyText, source: "auto-reply" },
              },
              scheduled_for: new Date(base + delayMs).toISOString(),
              status: "pending",
            };
          });
          for (let i = 0; i < rows.length; i += 500) {
            await context.supabase.from("execution_queue").insert(rows.slice(i, i + 500) as never);
          }
          repliesScheduled = rows.length;
        }
      } catch {
        /* auto-reply é best-effort: o post principal já foi feito */
      }
    }

    return {
      results,
      ok_count: results.filter((r) => r.ok).length,
      total: data.accountIds.length,
      replies_scheduled: repliesScheduled,
    };
  });

// ============================================================================
// RESPONDER UM TWEET JÁ EXISTENTE (sem postar nada novo, sem mídia)
// Cada conta responde: um link específico, OU o próprio último tweet.
// ============================================================================
export const replyToTweetAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    accountIds: string[];
    text: string;
    targetUrl?: string;
    ownLatest?: boolean;
  }) =>
    z.object({
      accountIds: z.array(z.string().uuid()).min(1).max(200),
      text: z.string().trim().min(1).max(280),
      targetUrl: z.string().optional(),
      ownLatest: z.boolean().optional(),
    })
      .refine((v) => v.ownLatest || (!!v.targetUrl && /status\/\d+/.test(v.targetUrl)), {
        message: "Cole o link do tweet a responder ou ative 'último tweet da própria conta'.",
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const text = data.text.trim();
    const urlId = data.targetUrl?.match(/status\/(\d+)/)?.[1];

    const { commentReply, getUserIdByScreenName, getUserRecentTweets, buildDispatcher } = await import(
      "@/lib/twitter-client.server"
    );
    const { loadProxyOrFallback } = await import("@/lib/proxy-pool.server");

    const results: Array<{ accountId: string; username?: string; ok: boolean; url?: string; error?: string }> = [];
    for (const accountId of data.accountIds) {
      try {
        const { acc, tokens } = await loadAccount(context.supabase, context.userId, accountId);

        const { data: pa } = await context.supabase
          .from("twitter_accounts").select("proxy_id").eq("id", accountId).maybeSingle();
        const proxy = await loadProxyOrFallback(context.supabase, pa?.proxy_id);
        const dispatcher = buildDispatcher(proxy);

        let tweetId = urlId;
        if (data.ownLatest) {
          const uid = await getUserIdByScreenName(tokens, acc.username, dispatcher);
          const tweets = await getUserRecentTweets(tokens, uid, 5, dispatcher);
          tweetId = tweets[0]?.id;
          if (!tweetId) throw new Error("Sem tweet recente para responder.");
        }
        if (!tweetId) throw new Error("Tweet alvo não encontrado.");

        const r = await commentReply(tokens, tweetId, text, dispatcher);
        await persistRefreshed(context.supabase, accountId, tokens);
        results.push({ accountId, username: acc.username, ok: true, url: `https://x.com/${acc.username}/status/${r.rest_id}` });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await markDownIfFell(context.supabase, accountId, msg);
        results.push({ accountId, ok: false, error: msg });
      }
    }
    return { results, ok_count: results.filter((r) => r.ok).length, total: data.accountIds.length };
  });

/** Agenda os posts com intervalo humano aleatório (min–max min) na fila; o worker
 *  publica em background, espaçado, pra não dar burst/ban. */
export const schedulePostTweet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    accountIds: string[];
    text: string;
    mode?: "same" | "random";
    mediaFileId?: string;
    folderId?: string;
    minMinutes: number;
    maxMinutes: number;
  }) =>
    z.object({
      accountIds: z.array(z.string().uuid()).min(1).max(500),
      text: z.string().max(280),
      mode: z.enum(["same", "random"]).optional(),
      mediaFileId: z.string().uuid().optional(),
      folderId: z.string().uuid().optional(),
      minMinutes: z.number().min(0.5).max(1440),
      maxMinutes: z.number().min(0.5).max(2880),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const text = data.text.trim();
    const withMedia = !!(data.folderId || data.mediaFileId);
    if (!text && !withMedia) throw new Error("Escreva o texto ou escolha uma mídia.");
    if (withMedia && data.mode !== "same" && data.folderId) {
      const { count } = await context.supabase
        .from("media_files").select("id", { count: "exact", head: true }).eq("folder_id", data.folderId);
      if (!count) throw new Error("Pasta de mídia vazia — envie imagens antes.");
    }

    const minM = Math.max(0.5, data.minMinutes);
    const maxM = Math.max(minM, data.maxMinutes);

    const { data: flow, error: fe } = await context.supabase
      .from("automation_flows")
      .insert({
        user_id: context.userId,
        name: `Postagem agendada — ${new Date().toLocaleString("pt-BR")}`,
        description: `${data.accountIds.length} post(s) humanizado(s)`,
        status: "draft",
        react_flow_data: { nodes: [], edges: [] } as any,
        account_ids: [],
      })
      .select("id")
      .single();
    if (fe || !flow) throw new Error(`Falha ao criar agendamento: ${fe?.message}`);

    // embaralha e espaça com gaps aleatórios entre min e max
    const ids = [...data.accountIds];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    // Pré-atribui a mídia (modo aleatório) sem repetir o mesmo arquivo 2x seguidas.
    const mediaAssign: (string | undefined)[] = [];
    if (withMedia && data.mode !== "same" && data.folderId) {
      const { data: mf } = await context.supabase
        .from("media_files").select("id").eq("folder_id", data.folderId).eq("user_id", context.userId);
      const fileIds = (mf ?? []).map((f: any) => f.id as string);
      if (fileIds.length) {
        const sh = (arr: string[]) => {
          const a = arr.slice();
          for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
          return a;
        };
        let prev: string | null = null;
        let bag: string[] = [];
        for (let i = 0; i < ids.length; i++) {
          if (fileIds.length === 1) { mediaAssign.push(fileIds[0]); continue; }
          if (!bag.length) { bag = sh(fileIds); if (bag[0] === prev && bag.length > 1) [bag[0], bag[1]] = [bag[1], bag[0]]; }
          const p = bag.shift()!;
          prev = p;
          mediaAssign.push(p);
        }
      }
    }

    const base = Date.now();
    let offset = Math.random() * minM * 60_000;
    const rows = ids.map((accId, i) => {
      const at = base + offset;
      offset += (minM + Math.random() * (maxM - minM)) * 60_000;
      const assigned = mediaAssign[i];
      return {
        user_id: context.userId,
        flow_id: flow.id,
        twitter_account_id: accId,
        action_type: "action.post_tweet",
        payload: {
          config: {
            text,
            // mídia pré-atribuída (sem repetir 2x seguidas); fallback p/ pasta aleatória
            media_file_id: data.mode === "same" ? data.mediaFileId : assigned,
            media_folder_id: data.mode !== "same" && !assigned ? data.folderId : undefined,
            anti_duplicate: true,
          },
        },
        scheduled_for: new Date(at).toISOString(),
        status: "pending",
      };
    });

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await context.supabase.from("execution_queue").insert(rows.slice(i, i + 500) as never);
      if (error) throw new Error(`Falha ao enfileirar: ${error.message}`);
    }
    return { flow_id: flow.id, tasks: rows.length, min: minM, max: maxM };
  });

/** Campanha de imagens: distribui as N imagens de uma pasta ao longo de D dias,
 *  uma por post SEM repetir (embaralhada). cycles = quantas vezes repetir o ciclo
 *  (loop). Cada conta selecionada roda a campanha. */
export const scheduleImageCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    accountIds: string[];
    text: string;
    folderId: string;
    days: number;
    cycles?: number;
  }) =>
    z.object({
      accountIds: z.array(z.string().uuid()).min(1).max(500),
      text: z.string().max(280),
      folderId: z.string().uuid(),
      days: z.number().min(0.25).max(90),
      cycles: z.number().int().min(1).max(60).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const text = data.text.trim();
    const { data: files } = await context.supabase
      .from("media_files").select("id").eq("folder_id", data.folderId).eq("user_id", context.userId);
    if (!files?.length) throw new Error("Pasta vazia — envie imagens antes.");
    const imageIds = files.map((f) => f.id as string);
    const cycles = data.cycles ?? 1;
    const dayMs = data.days * 24 * 60 * 60 * 1000;
    const base = Date.now();

    const { data: flow, error: fe } = await context.supabase
      .from("automation_flows")
      .insert({
        user_id: context.userId,
        name: `Campanha de imagens — ${new Date().toLocaleString("pt-BR")}`,
        description: `${imageIds.length} imagem(ns) em ${data.days} dia(s)${cycles > 1 ? ` × ${cycles} ciclos` : ""}`,
        status: "draft",
        react_flow_data: { nodes: [], edges: [] } as any,
        account_ids: [],
      })
      .select("id")
      .single();
    if (fe || !flow) throw new Error(`Falha ao criar campanha: ${fe?.message}`);

    const shuffle = <T,>(a: T[]): T[] => {
      const r = a.slice();
      for (let i = r.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [r[i], r[j]] = [r[j], r[i]];
      }
      return r;
    };

    const rows: any[] = [];
    for (const accId of data.accountIds) {
      // desync entre contas: cada conta começa com um deslocamento aleatório
      const acctOffset = Math.random() * (dayMs / Math.max(1, imageIds.length));
      let cycleStart = base + acctOffset;
      for (let c = 0; c < cycles; c++) {
        const order = shuffle(imageIds);
        const n = order.length;
        for (let i = 0; i < n; i++) {
          // posição do post dentro do span de D dias, com jitter
          const frac = (i + 0.5 + (Math.random() - 0.5) * 0.7) / n;
          const at = cycleStart + Math.max(0, Math.min(1, frac)) * dayMs;
          rows.push({
            user_id: context.userId,
            flow_id: flow.id,
            twitter_account_id: accId,
            action_type: "action.post_tweet",
            payload: { config: { text, media_file_id: order[i], anti_duplicate: true } },
            scheduled_for: new Date(at).toISOString(),
            status: "pending",
          });
        }
        cycleStart += dayMs;
      }
    }

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await context.supabase.from("execution_queue").insert(rows.slice(i, i + 500) as never);
      if (error) throw new Error(`Falha ao agendar campanha: ${error.message}`);
    }
    return { flow_id: flow.id, tasks: rows.length, images: imageIds.length, cycles, days: data.days };
  });
