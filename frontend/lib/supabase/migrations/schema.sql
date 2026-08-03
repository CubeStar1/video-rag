CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS public.projects (
  id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NULL,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT projects_pkey PRIMARY KEY (id)
);

DROP TRIGGER IF EXISTS update_projects_updated_at ON public.projects;
CREATE TRIGGER update_projects_updated_at
BEFORE UPDATE ON public.projects
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  user_id uuid NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  lastContext jsonb NULL,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT conversations_pkey PRIMARY KEY (id)
);

DROP TRIGGER IF EXISTS update_conversations_updated_at ON public.conversations;
CREATE TRIGGER update_conversations_updated_at
BEFORE UPDATE ON public.conversations
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  conversation_id uuid NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role text NOT NULL,
  parts jsonb NOT NULL,
  metadata jsonb NULL,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT messages_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_project_id
  ON public.conversations(project_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id_created_at
  ON public.messages(conversation_id, created_at);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own projects" ON public.projects;
CREATE POLICY "Users can manage own projects"
ON public.projects
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own conversations" ON public.conversations;
CREATE POLICY "Users can manage own conversations"
ON public.conversations
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own messages" ON public.messages;
CREATE POLICY "Users can manage own messages"
ON public.messages
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = messages.conversation_id
      AND c.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = messages.conversation_id
      AND c.user_id = auth.uid()
  )
);

CREATE TABLE IF NOT EXISTS public.videos (
  id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  source_type text NOT NULL DEFAULT 'upload',
  storage_path text NULL,
  source_url text NOT NULL,
  videodb_video_id text NULL,
  videodb_collection_id text NULL,
  stream_url text NULL,
  player_url text NULL,
  thumbnail_url text NULL,
  duration numeric NULL,
  status text NOT NULL DEFAULT 'pending',
  index_status jsonb NULL,
  index_config jsonb NULL,
  error text NULL,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT videos_pkey PRIMARY KEY (id)
);

-- The understanding settings (segmentation) a video was ingested with. Added after
-- the table shipped, so existing databases need the ALTER as well as the column above.
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS index_config jsonb NULL;

CREATE INDEX IF NOT EXISTS idx_videos_project_id
  ON public.videos(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_videodb_video_id
  ON public.videos(videodb_video_id)
  WHERE videodb_video_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_videos_updated_at ON public.videos;
CREATE TRIGGER update_videos_updated_at
BEFORE UPDATE ON public.videos
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own videos" ON public.videos;
CREATE POLICY "Users can manage own videos"
ON public.videos
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

INSERT INTO storage.buckets (id, name, public)
VALUES ('project-assets', 'project-assets', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public Access for project-assets" ON storage.objects;
CREATE POLICY "Public Access for project-assets"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'project-assets');

DROP POLICY IF EXISTS "Authenticated Uploads for project-assets" ON storage.objects;
CREATE POLICY "Authenticated Uploads for project-assets"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'project-assets');

DROP POLICY IF EXISTS "Users can delete their own project-assets" ON storage.objects;
CREATE POLICY "Users can delete their own project-assets"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'project-assets' AND auth.uid() = owner);
