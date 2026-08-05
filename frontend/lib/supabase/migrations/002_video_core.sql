-- video_core — the application's view of a video analysed by core/ (VideoMind).
--
-- Purely additive. `videos` (the VideoDB-shaped table) is left in place and is
-- no longer read by anything; nothing here drops or alters it.
--
-- Run after schema.sql, which owns `projects`, `update_updated_at()` and the
-- `project-assets` bucket this table's `storage_path` points into.
--
-- Note the two Supabase projects: this one holds the row, and core's own
-- project holds the bytes. `source_url` points at the object the browser
-- uploaded here; `playback_url` points at core's public copy, which is what
-- actually plays. Both are kept on purpose — see MIGRATION.md, D1.

CREATE TABLE IF NOT EXISTS public.video_core (
  id            uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id)      ON DELETE CASCADE,

  title         text NOT NULL,
  source_type   text NOT NULL DEFAULT 'upload',   -- upload | url
  storage_path  text NULL,                        -- object in this project's project-assets
  source_url    text NOT NULL,                    -- the URL core was handed

  -- Core's identity for this video. `core_video_id` is sha1(bytes)[:16], so the
  -- same file uploaded to two projects yields the same id — unique per project,
  -- never globally, and deleting one project's row must not delete core's video
  -- while another row still references it.
  core_video_id text NULL,
  playback_url  text NULL,                        -- public mp4 in core's bucket
  poster_url    text NULL,                        -- single frame, written by core at ingest
  duration      numeric NULL,
  size_bytes    bigint NULL,

  -- Ingest lifecycle. Core returns 202 + a job id and analyses on a background
  -- thread, so a row exists before core has seen a byte.
  status        text NOT NULL DEFAULT 'pending',  -- pending|uploading|queued|analyzing|ready|failed
  job_id        text NULL,
  stage         text NULL,                        -- fetching|chunking|analyzing|indexing|aggregating|complete
  progress      jsonb NULL,                       -- core's last job `detail` blob
  error         text NULL,

  -- What the pipeline was asked for, replayed verbatim on re-index:
  -- { analyzers[], mode, preset, weights, interval, min_duration, max_duration }
  ingest_config jsonb NULL,
  -- What it actually produced. text[] rather than jsonb because the UI and the
  -- agent both ask "does this video have `people`?" as a predicate.
  analyzers     text[] NOT NULL DEFAULT '{}',
  aggregates    text[] NOT NULL DEFAULT '{}',
  chunk_config  text NULL,                        -- 'audio_video:5-20' | 'interval:10'
  chunk_count   int NOT NULL DEFAULT 0,

  created_at    timestamptz DEFAULT CURRENT_TIMESTAMP,
  updated_at    timestamptz DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT video_core_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_video_core_project
  ON public.video_core(project_id, created_at DESC);

-- Reconciling in-flight ingests looks rows up by the core job they are waiting on.
CREATE INDEX IF NOT EXISTS idx_video_core_job
  ON public.video_core(job_id) WHERE job_id IS NOT NULL;

-- Re-ingesting the same bytes into a project is the same video, whatever it is
-- called. Partial because the id does not exist until core has downloaded it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_video_core_project_core_id
  ON public.video_core(project_id, core_video_id) WHERE core_video_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_video_core_updated_at ON public.video_core;
CREATE TRIGGER update_video_core_updated_at
BEFORE UPDATE ON public.video_core
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.video_core ENABLE ROW LEVEL SECURITY;

-- Core itself has no users and no RLS; scoping is enforced here and by the API
-- routes passing explicit video ids down. This policy is the only thing keeping
-- one user's videos out of another's project view.
DROP POLICY IF EXISTS "Users can manage own core videos" ON public.video_core;
CREATE POLICY "Users can manage own core videos"
ON public.video_core
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
