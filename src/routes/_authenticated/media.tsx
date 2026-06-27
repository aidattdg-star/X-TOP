import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Upload, Trash2, FolderPlus, ImagePlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  ensureDefaultFolders,
  createMediaFolder,
  deleteMediaFolder,
  registerMediaFile,
  deleteMediaFile,
} from "@/lib/media.functions";
import { ApplyToAccountsModal } from "@/components/media/apply-to-accounts-modal";

export const Route = createFileRoute("/_authenticated/media")({
  component: MediaPage,
});

type Folder = {
  id: string;
  name: string;
  category: "profile_picture" | "tweet_media";
  created_at: string;
};

type MediaFile = {
  id: string;
  original_filename: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  created_at: string;
  signed_url: string | null;
};

const CATEGORY_LABEL: Record<Folder["category"], string> = {
  profile_picture: "Fotos de perfil",
  tweet_media: "Mídias para tweets",
};

function MediaPage() {
  const qc = useQueryClient();
  const ensureFn = useServerFn(ensureDefaultFolders);
  const createFolderFn = useServerFn(createMediaFolder);
  const deleteFolderFn = useServerFn(deleteMediaFolder);
  const registerFn = useServerFn(registerMediaFile);
  const deleteFileFn = useServerFn(deleteMediaFile);

  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [applyOpen, setApplyOpen] = useState<{ folderId: string; mediaFileId?: string; category: Folder["category"] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) ensureFn().catch(() => {});
    });
  }, [ensureFn]);

  const { data: folders } = useQuery({
    queryKey: ["media_folders"],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) return [] as Folder[];

      const { data, error } = await supabase
        .from("media_folders")
        .select("id, name, category, created_at")
        .order("category", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Folder[];
    },
  });

  useEffect(() => {
    if (!selectedFolderId && folders?.length) setSelectedFolderId(folders[0].id);
  }, [folders, selectedFolderId]);

  const { data: files } = useQuery<MediaFile[]>({
    queryKey: ["media_files", selectedFolderId],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session || !selectedFolderId) return [];

      const { data, error } = await supabase
        .from("media_files")
        .select("id, original_filename, storage_path, mime_type, size_bytes, width, height, created_at")
        .eq("folder_id", selectedFolderId)
        .order("created_at", { ascending: false });
      if (error) throw error;

      return Promise.all(
        (data ?? []).map(async (file) => {
          const { data: signed } = await supabase.storage
            .from("media")
            .createSignedUrl(file.storage_path, 3600);
          return { ...file, signed_url: signed?.signedUrl ?? null } as MediaFile;
        }),
      );
    },
    enabled: !!selectedFolderId,
  });

  const selectedFolder = folders?.find((f) => f.id === selectedFolderId) ?? null;

  const createFolder = useMutation({
    mutationFn: async ({ name, category }: { name: string; category: Folder["category"] }) =>
      createFolderFn({ data: { name, category } }),
    onSuccess: () => {
      toast.success("Pasta criada");
      qc.invalidateQueries({ queryKey: ["media_folders"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const removeFolder = useMutation({
    mutationFn: async (id: string) => deleteFolderFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Pasta excluída");
      setSelectedFolderId(null);
      qc.invalidateQueries({ queryKey: ["media_folders"] });
    },
  });

  const removeFile = useMutation({
    mutationFn: async (id: string) => deleteFileFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Arquivo excluído");
      qc.invalidateQueries({ queryKey: ["media_files", selectedFolderId] });
    },
  });

  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function handleUpload(fileList: FileList | File[] | null) {
    console.log("[media] handleUpload start", { count: fileList?.length, folder: selectedFolderId });
    if (!fileList || !selectedFolderId || !selectedFolder) {
      toast.error("Selecione uma pasta primeiro");
      return;
    }
    const arr = Array.from(fileList);
    if (arr.length === 0) return;

    setUploading(true);
    const tId = toast.loading(`Enviando ${arr.length} arquivo(s)...`);
    try {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) console.error("[media] getUser error", userErr);
      const userId = userData.user?.id;
      if (!userId) { toast.error("Sessão expirada", { id: tId }); return; }

      let ok = 0, fail = 0;
      for (const file of arr) {
        if (!file.type.startsWith("image/")) {
          toast.error(`${file.name}: só imagens`);
          fail++; continue;
        }
        if (file.size > 8 * 1024 * 1024) {
          toast.error(`${file.name}: máx 8MB`);
          fail++; continue;
        }
        try {
          const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
          const uuid = crypto.randomUUID();
          const path = `${userId}/${selectedFolderId}/${uuid}.${ext}`;
          console.log("[media] uploading", file.name, "->", path);
          const { error: upErr } = await supabase.storage.from("media").upload(path, file, {
            contentType: file.type,
            upsert: false,
          });
          if (upErr) { console.error("[media] storage error", upErr); throw new Error(upErr.message); }

          const dims = await readImageDimensions(file).catch(() => ({ width: undefined, height: undefined }));

          await registerFn({
            data: {
              folderId: selectedFolderId,
              storagePath: path,
              originalFilename: file.name,
              mimeType: file.type,
              sizeBytes: file.size,
              width: dims.width,
              height: dims.height,
            },
          });
          ok++;
        } catch (e) {
          console.error("[media] upload failed", file.name, e);
          toast.error(`${file.name}: ${e instanceof Error ? e.message : "falha"}`);
          fail++;
        }
      }
      toast.success(`${ok} enviado(s)${fail ? `, ${fail} falha(s)` : ""}`, { id: tId });
    } finally {
      setUploading(false);
      qc.invalidateQueries({ queryKey: ["media_files", selectedFolderId] });
    }
  }

  const grouped: Record<string, Folder[]> = {};
  for (const f of folders ?? []) (grouped[f.category] ||= []).push(f);

  return (
    <div className="flex h-[calc(100vh-0px)]">
      <aside className="w-64 border-r border-border bg-surface p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Pastas</p>
          <button
            onClick={() => {
              const name = prompt("Nome da pasta:");
              if (!name) return;
              const cat = prompt("Categoria (1=Fotos de perfil, 2=Mídias para tweets):", "1");
              const category: Folder["category"] = cat === "2" ? "tweet_media" : "profile_picture";
              createFolder.mutate({ name, category });
            }}
            className="text-muted-foreground hover:text-foreground"
            title="Nova pasta"
          >
            <FolderPlus className="w-4 h-4" />
          </button>
        </div>

        {(["profile_picture", "tweet_media"] as const).map((cat) => (
          <div key={cat} className="mb-4">
            <p className="text-xs font-medium text-muted-foreground mb-2">{CATEGORY_LABEL[cat]}</p>
            <div className="space-y-1">
              {(grouped[cat] ?? []).map((f) => (
                <div
                  key={f.id}
                  className={`group flex items-center justify-between px-2 py-1.5 rounded text-sm cursor-pointer ${
                    selectedFolderId === f.id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50"
                  }`}
                  onClick={() => setSelectedFolderId(f.id)}
                >
                  <span className="truncate">{f.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Excluir pasta "${f.name}" e todos os arquivos?`)) removeFolder.mutate(f.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-destructive"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </aside>

      <main className="flex-1 p-6 overflow-y-auto">
        {selectedFolder ? (
          <>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-xl font-medium text-foreground">{selectedFolder.name}</h1>
                <p className="text-xs text-muted-foreground mt-1">
                  {CATEGORY_LABEL[selectedFolder.category]} · {files?.length ?? 0} arquivo(s)
                </p>
              </div>
              <div className="flex gap-2">
                {selectedFolder.category === "profile_picture" && (files?.length ?? 0) > 0 && (
                  <button
                    onClick={() => setApplyOpen({ folderId: selectedFolder.id, category: "profile_picture" })}
                    className="px-3 py-2 text-xs border border-border rounded hover:bg-accent flex items-center gap-2"
                  >
                    <ImagePlus className="w-4 h-4" /> Aplicar em lote (aleatório)
                  </button>
                )}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-2 text-xs bg-foreground text-background rounded flex items-center gap-2 hover:opacity-90"
                >
                  <Upload className="w-4 h-4" /> Enviar arquivos
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => { handleUpload(e.target.files); e.target.value = ""; }}
                />
              </div>
            </div>

            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const dropped = e.dataTransfer?.files;
                if (dropped?.length) handleUpload(dropped);
              }}
              className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 rounded-lg p-2 transition ${
                dragOver ? "ring-2 ring-foreground bg-accent/30" : ""
              }`}
            >
              {(files ?? []).map((file) => (
                <div key={file.id} className="group relative border border-border rounded overflow-hidden bg-surface">
                  {file.signed_url ? (
                    <img
                      src={file.signed_url}
                      alt={file.original_filename}
                      className="w-full aspect-square object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full aspect-square bg-accent" />
                  )}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center gap-2 p-2">
                    {selectedFolder.category === "profile_picture" && (
                      <button
                        onClick={() => setApplyOpen({ folderId: selectedFolder.id, mediaFileId: file.id, category: "profile_picture" })}
                        className="px-2 py-1 text-[10px] bg-white text-black rounded w-full"
                      >
                        Aplicar em contas
                      </button>
                    )}
                    <button
                      onClick={() => { if (confirm("Excluir arquivo?")) removeFile.mutate(file.id); }}
                      className="px-2 py-1 text-[10px] bg-destructive text-white rounded w-full"
                    >
                      Excluir
                    </button>
                  </div>
                  <div className="px-2 py-1.5 text-[10px] text-muted-foreground truncate">
                    {file.original_filename}
                  </div>
                </div>
              ))}
              {(files?.length ?? 0) === 0 && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="col-span-full border-2 border-dashed border-border rounded-lg p-12 text-center hover:bg-accent/30 transition disabled:opacity-50"
                >
                  <Upload className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {uploading ? "Enviando..." : "Clique aqui ou arraste arquivos para enviar"}
                  </p>
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="text-sm text-muted-foreground">Selecione ou crie uma pasta.</div>
        )}
      </main>

      {applyOpen && (
        <ApplyToAccountsModal
          open
          onClose={() => setApplyOpen(null)}
          folderId={applyOpen.folderId}
          mediaFileId={applyOpen.mediaFileId}
          kind="avatar"
        />
      )}
    </div>
  );
}

async function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
