import { tool } from 'ai'
import { z } from 'zod'
import { createSupabaseServer } from '@/lib/supabase/server'
import { ingestVideoFromUrl, IngestRejected } from '@/lib/core/ingest'
import { ANALYZER_CATALOGUE } from '@/lib/core/chunking'
import type { AnalyzerId } from '@/lib/core/types'
import type { VideoToolContext } from './scope'

const ANALYZER_IDS = ANALYZER_CATALOGUE.map((a) => a.id) as [AnalyzerId, ...AnalyzerId[]]

/**
 * The one tool here that writes. Everything else in `tools/core` reads footage
 * the user already added; this adds more, which costs analysis time and, for
 * some analyzers, money per chunk.
 *
 * It returns as soon as core has accepted the job, because analysis takes
 * minutes and nothing pushes progress — the project page's existing poll is
 * where the row becomes `ready`. So the model must not claim the video is
 * searchable, and the description says so.
 */
export function createAddVideoTool(context: VideoToolContext) {
  return tool({
    description:
      'Add a video to this project from a link and start analysing it. ' +
      'Accepts a direct video URL (an .mp4 and similar) or a YouTube link, which is downloaded automatically. ' +
      'Analysis runs in the background and takes minutes, so the video is NOT searchable when this returns — never answer questions about its content off the back of this call. ' +
      'Ask the user before adding a video they did not clearly ask for.',
    inputSchema: z.object({
      url: z
        .string()
        .describe('The video link: a direct http(s) URL to a video file, or a YouTube URL.'),
      title: z
        .string()
        .optional()
        .describe(
          'A short title for the project list. Omit for a YouTube link and the video\'s own title is used.'
        ),
      analyzers: z
        .array(z.enum(ANALYZER_IDS))
        .optional()
        .describe(
          'What to extract. Defaults to scene description plus speech with speakers. ' +
            ANALYZER_CATALOGUE.map((a) => `"${a.id}" ${a.description}`).join(' ') +
            ' Note "diarization" and "transcript" are mutually exclusive; diarization is the superset.'
        ),
      preset: z
        .enum(['audio_video', 'audio', 'video'])
        .default('audio_video')
        .describe(
          'How the video is cut into chunks. "audio_video" for most footage, "audio" for podcasts, calls and lectures, "video" for surveillance, silent footage and b-roll.'
        ),
    }),
    execute: async ({ url, title, analyzers, preset }) => {
      if (!context.projectId) {
        return { added: false, error: 'This conversation is not attached to a project, so there is nowhere to add a video.' }
      }

      // Checked here rather than left to core: core would accept the job and
      // fail it minutes later on a background thread, where the only way the
      // user learns of a typo is a failed row on the project page.
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        return { added: false, error: `${url} is not a valid URL.` }
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { added: false, error: `Unsupported URL scheme "${parsed.protocol}"; expected http or https.` }
      }

      try {
        const supabase = await createSupabaseServer()
        const { video, jobId, error } = await ingestVideoFromUrl({
          supabase,
          userId: context.userId,
          projectId: context.projectId,
          sourceUrl: url,
          title,
          sourceType: 'url',
          config: { analyzers, mode: 'preset', preset },
        })

        if (error) {
          return {
            added: false,
            video_row_id: video.id,
            title: video.title,
            error: `Core refused the video: ${error}`,
          }
        }

        return {
          added: true,
          video_row_id: video.id,
          job_id: jobId,
          title: video.title,
          source_url: url,
          status: video.status,
          analyzers: video.ingest_config?.analyzers ?? [],
          // The id the other tools take is the hash of the video's bytes, so it
          // does not exist until the download finishes. Saying so stops the
          // model inventing one to search with.
          note: 'Queued. Analysis takes a few minutes and the video has no searchable id until it finishes. Tell the user it is being analysed and that they can watch progress on the project page — do not try to search it in this turn.',
        }
      } catch (error: any) {
        if (error instanceof IngestRejected) return { added: false, error: error.message }
        return { added: false, error: error?.message || 'Failed to add the video.' }
      }
    },
  })
}
