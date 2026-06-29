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
  // random
  if (!opts.folderId) throw new Error("folderId é obrigatório no modo 'random'");
  const { data: files } = await supabase
    .from("media_files")
    .select("id, storage_path")
    .eq("folder_id", opts.folderId)
    .eq("user_id", userId);
  if (!files?.length) throw new Error("Pasta vazia");
  for (const id of accountIds) {
    const pick = files[Math.floor(Math.random() * files.length)];
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
  field: "avatar" | "banner" | "name" | "bio" | "username",
  oldValue: string | null,
  newValue: string | null,
  status: "ok" | "failed",
  error?: string,
) {
  await supabase.from("profile_update_log").insert({
    user_id: userId,
    twitter_account_id: accountId,
    field,
    old_value: oldValue,
    new_value: newValue,
    status,
    error: error ?? null,
  });
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
  }) =>
    z.object({
      accountIds: z.array(z.string().uuid()).min(1).max(100),
      name: z.string().trim().max(50).optional(),
      bio: z.string().trim().max(160).optional(),
    }).refine((v) => v.name !== undefined || v.bio !== undefined, {
      message: "Forneça pelo menos name ou bio",
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { updateProfile } = await import("@/lib/twitter-client.server");
    const results: Array<{ accountId: string; ok: boolean; error?: string }> = [];

    for (const accountId of data.accountIds) {
      try {
        const { acc, tokens } = await loadAccount(context.supabase, context.userId, accountId);
        await updateProfile(tokens, { name: data.name, description: data.bio });
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
    folderId?: string;
  }) =>
    z.object({
      accountIds: z.array(z.string().uuid()).min(1).max(200),
      text: z.string().max(280),
      mode: z.enum(["same", "random"]).optional(),
      mediaFileId: z.string().uuid().optional(),
      folderId: z.string().uuid().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const text = data.text.trim();
    const withMedia = !!(data.folderId || data.mediaFileId);
    if (!text && !withMedia) throw new Error("Escreva o texto ou escolha uma mídia.");

    const mediaMap = withMedia
      ? await resolveFilesPerAccount(context.supabase, context.userId, data.accountIds, {
          mode: data.mode ?? "random",
          mediaFileId: data.mediaFileId,
          folderId: data.folderId,
        })
      : null;

    const { uploadTweetMedia, postTweet, buildDispatcher } = await import("@/lib/twitter-client.server");

    const results: Array<{ accountId: string; username?: string; ok: boolean; url?: string; error?: string }> = [];
    for (const accountId of data.accountIds) {
      try {
        const { acc, tokens } = await loadAccount(context.supabase, context.userId, accountId);

        // proxy da conta (escrita/upload SEMPRE pelo proxy)
        let proxy: { ip: string; port: number; username: string | null; password: string | null } | null = null;
        const { data: pa } = await context.supabase
          .from("twitter_accounts").select("proxy_id").eq("id", accountId).maybeSingle();
        if (pa?.proxy_id) {
          const { data: p } = await context.supabase
            .from("proxies").select("ip, port, username, password").eq("id", pa.proxy_id).maybeSingle();
          proxy = p as any;
        }
        const dispatcher = buildDispatcher(proxy);

        let mediaIds: string[] | undefined;
        if (mediaMap) {
          const file = mediaMap.get(accountId)!;
          const b64 = await downloadAsBase64(context.supabase, file.storage_path);
          const mid = await uploadTweetMedia(tokens, b64, dispatcher);
          mediaIds = [mid];
        }

        const r = await postTweet(tokens, text, dispatcher, mediaIds);
        await persistRefreshed(context.supabase, accountId, tokens);
        results.push({ accountId, username: acc.username, ok: true, url: `https://x.com/${acc.username}/status/${r.rest_id}` });
      } catch (e) {
        results.push({ accountId, ok: false, error: e instanceof Error ? e.message : String(e) });
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
    const base = Date.now();
    let offset = Math.random() * minM * 60_000;
    const rows = ids.map((accId) => {
      const at = base + offset;
      offset += (minM + Math.random() * (maxM - minM)) * 60_000;
      return {
        user_id: context.userId,
        flow_id: flow.id,
        twitter_account_id: accId,
        action_type: "action.post_tweet",
        payload: {
          config: {
            text,
            media_folder_id: data.mode !== "same" ? data.folderId : undefined,
            media_file_id: data.mode === "same" ? data.mediaFileId : undefined,
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
