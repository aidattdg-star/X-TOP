-- ===== media_folders =====
CREATE TYPE public.media_category AS ENUM ('profile_picture', 'tweet_media');

CREATE TABLE public.media_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  category public.media_category NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, category, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_folders TO authenticated;
GRANT ALL ON public.media_folders TO service_role;
ALTER TABLE public.media_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "media_folders_owner_all" ON public.media_folders
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_media_folders_updated BEFORE UPDATE ON public.media_folders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ===== media_files =====
CREATE TABLE public.media_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id uuid NOT NULL REFERENCES public.media_folders(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL,
  width integer,
  height integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_files TO authenticated;
GRANT ALL ON public.media_files TO service_role;
ALTER TABLE public.media_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "media_files_owner_all" ON public.media_files
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX media_files_folder_idx ON public.media_files (folder_id, created_at DESC);

-- ===== profile_update_log =====
CREATE TYPE public.profile_field AS ENUM ('avatar', 'banner', 'name', 'bio', 'username');

CREATE TABLE public.profile_update_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  twitter_account_id uuid NOT NULL REFERENCES public.twitter_accounts(id) ON DELETE CASCADE,
  field public.profile_field NOT NULL,
  old_value text,
  new_value text,
  status text NOT NULL DEFAULT 'ok',
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.profile_update_log TO authenticated;
GRANT ALL ON public.profile_update_log TO service_role;
ALTER TABLE public.profile_update_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profile_update_log_owner_select" ON public.profile_update_log
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "profile_update_log_owner_insert" ON public.profile_update_log
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE INDEX profile_update_log_account_idx
  ON public.profile_update_log (twitter_account_id, created_at DESC);

-- ===== Storage policies (bucket 'media') =====
-- Layout: {userId}/{folderId}/{uuid}.ext
CREATE POLICY "media_owner_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "media_owner_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "media_owner_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'media' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "media_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'media' AND auth.uid()::text = (storage.foldername(name))[1]);
