import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const MediaCategory = z.enum(["profile_picture", "tweet_media"]);

/** Garante que o usuário tenha as 2 pastas padrão. Idempotente. */
export const ensureDefaultFolders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const defaults: Array<{ name: string; category: "profile_picture" | "tweet_media" }> = [
      { name: "Fotos de perfil", category: "profile_picture" },
      { name: "Mídias para tweets", category: "tweet_media" },
    ];
    for (const d of defaults) {
      const { data: existing } = await context.supabase
        .from("media_folders")
        .select("id")
        .eq("user_id", context.userId)
        .eq("category", d.category)
        .eq("name", d.name)
        .maybeSingle();
      if (!existing) {
        await context.supabase.from("media_folders").insert({
          user_id: context.userId,
          name: d.name,
          category: d.category,
        });
      }
    }
    return { ok: true };
  });

export const listMediaFolders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("media_folders")
      .select("id, name, category, created_at")
      .order("category", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createMediaFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name: string; category: "profile_picture" | "tweet_media" }) =>
    z.object({
      name: z.string().trim().min(1).max(60),
      category: MediaCategory,
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("media_folders")
      .insert({ user_id: context.userId, name: data.name, category: data.category })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

/** Renomeia e/ou move a pasta (troca de categoria/seção). */
export const updateMediaFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; name?: string; category?: "profile_picture" | "tweet_media" }) =>
    z.object({
      id: z.string().uuid(),
      name: z.string().trim().min(1).max(60).optional(),
      category: MediaCategory.optional(),
    }).refine((v) => v.name !== undefined || v.category !== undefined, { message: "Nada para atualizar" }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.category !== undefined) patch.category = data.category;
    const { error } = await context.supabase
      .from("media_folders").update(patch as never).eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Duplica a pasta + copia todos os arquivos (cópia no storage). */
export const duplicateMediaFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: src } = await context.supabase
      .from("media_folders").select("id, name, category, user_id").eq("id", data.id).maybeSingle();
    if (!src || src.user_id !== context.userId) throw new Error("Pasta não encontrada");

    const { data: dst, error: fe } = await context.supabase
      .from("media_folders")
      .insert({ user_id: context.userId, name: `${src.name} (cópia)`, category: src.category })
      .select("id").single();
    if (fe || !dst) throw new Error(fe?.message ?? "Falha ao criar a pasta");

    const { data: files } = await context.supabase
      .from("media_files")
      .select("storage_path, original_filename, mime_type, size_bytes, width, height")
      .eq("folder_id", src.id);

    let copied = 0;
    for (const f of files ?? []) {
      const ext = (f.storage_path.split(".").pop() || "jpg").toLowerCase();
      const newPath = `${context.userId}/${dst.id}/${crypto.randomUUID()}.${ext}`;
      const { error: cpErr } = await context.supabase.storage.from("media").copy(f.storage_path, newPath);
      if (cpErr) continue;
      const { error: insErr } = await context.supabase.from("media_files").insert({
        user_id: context.userId,
        folder_id: dst.id,
        storage_path: newPath,
        original_filename: f.original_filename,
        mime_type: f.mime_type,
        size_bytes: f.size_bytes,
        width: f.width,
        height: f.height,
      });
      if (!insErr) copied++;
    }
    return { ok: true, folderId: dst.id, copied, total: (files ?? []).length };
  });

export const deleteMediaFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    // Apaga arquivos do storage antes
    const { data: files } = await context.supabase
      .from("media_files")
      .select("storage_path")
      .eq("folder_id", data.id);
    const paths = (files ?? []).map((f) => f.storage_path);
    if (paths.length) {
      await context.supabase.storage.from("media").remove(paths);
    }
    const { error } = await context.supabase
      .from("media_folders")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listMediaFiles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { folderId: string }) =>
    z.object({ folderId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: files, error } = await context.supabase
      .from("media_files")
      .select("id, original_filename, storage_path, mime_type, size_bytes, width, height, created_at")
      .eq("folder_id", data.folderId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    // Gera signed URLs (1h)
    const out = await Promise.all(
      (files ?? []).map(async (f) => {
        const { data: signed } = await context.supabase
          .storage.from("media").createSignedUrl(f.storage_path, 3600);
        return { ...f, signed_url: signed?.signedUrl ?? null };
      }),
    );
    return out;
  });

/** Registra um arquivo já enviado pelo client diretamente ao bucket `media`. */
export const registerMediaFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    folderId: string;
    storagePath: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    width?: number;
    height?: number;
  }) =>
    z.object({
      folderId: z.string().uuid(),
      storagePath: z.string().min(1).max(500),
      originalFilename: z.string().min(1).max(200),
      mimeType: z.string().min(1).max(100),
      sizeBytes: z.number().int().positive().max(20 * 1024 * 1024),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    // Valida pasta pertence ao usuário
    const { data: folder } = await context.supabase
      .from("media_folders")
      .select("id")
      .eq("id", data.folderId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!folder) throw new Error("Pasta não encontrada");

    // Path precisa começar com {userId}/
    if (!data.storagePath.startsWith(`${context.userId}/`)) {
      throw new Error("storage_path inválido");
    }

    const { data: row, error } = await context.supabase
      .from("media_files")
      .insert({
        user_id: context.userId,
        folder_id: data.folderId,
        storage_path: data.storagePath,
        original_filename: data.originalFilename,
        mime_type: data.mimeType,
        size_bytes: data.sizeBytes,
        width: data.width,
        height: data.height,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteMediaFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: file } = await context.supabase
      .from("media_files")
      .select("storage_path")
      .eq("id", data.id)
      .maybeSingle();
    if (file?.storage_path) {
      await context.supabase.storage.from("media").remove([file.storage_path]);
    }
    const { error } = await context.supabase
      .from("media_files")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
