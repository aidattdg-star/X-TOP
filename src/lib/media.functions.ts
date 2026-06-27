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
