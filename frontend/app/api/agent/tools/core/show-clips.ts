import { tool } from 'ai'
import { z } from 'zod'

/**
 * Pass-through tool, like show_artifact: it echoes its input so the client can
 * render the clip reel in the artifact panel. No backend call — the moments were
 * already retrieved by search_moments or ask_video.
 *
 * A clip is a range of a video, not a stream of its own: the panel loads the mp4
 * once and seeks, so several clips from one video cost one load between them.
 * That is also why there is no "make me a clip" tool any more — there is nothing
 * to build, the data below is the clip.
 */
export const showClipsTool = tool({
  description:
    'Open the artifact panel with a playable reel of moments. Call this whenever the answer is something to watch — the user asked for clips, moments or a highlight reel, or the retrieved evidence is worth playing. Pass the `url`, `start` and `end` you got back from search_moments or ask_video. Never paste raw video URLs into chat; put them here instead.',
  inputSchema: z.object({
    title: z.string().describe('Panel heading, e.g. "Moments where pricing is discussed"'),
    identifier: z
      .string()
      .optional()
      .describe('Stable id — reuse it to update the same panel instead of opening a new one'),
    clips: z
      .array(
        z.object({
          label: z.string().optional().describe('Short caption for this moment'),
          video_id: z.string(),
          video_title: z.string().optional(),
          url: z
            .string()
            .describe('The video\'s mp4 URL, exactly as returned by the retrieval tool'),
          start: z.number().min(0).describe('Start in seconds'),
          end: z.number().min(0).describe('End in seconds'),
          text: z.string().optional().describe('Scene description or transcript snippet'),
          score: z.number().optional(),
          poster_url: z.string().optional(),
        })
      )
      .min(1)
      .describe('The moments to show, in the order they should be listed'),
  }),
  execute: async ({ title, identifier, clips }) => {
    return {
      success: true,
      message: `Clip panel "${title}" is open with ${clips.length} clip${clips.length === 1 ? '' : 's'}.`,
      identifier: identifier ?? null,
      count: clips.length,
    }
  },
})
