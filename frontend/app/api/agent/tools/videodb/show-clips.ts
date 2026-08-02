import { tool } from 'ai'
import { z } from 'zod'

/**
 * Pass-through tool, like show_artifact: it echoes its input so the client can
 * render the clip reel in the artifact panel. No backend call — the clips were
 * already retrieved by search/ask/create_video_clip.
 */
export const showClipsTool = tool({
  description:
    'Open the artifact panel with a playable reel of video clips. Call this whenever the answer is something to watch — the user asked for clips, moments or a highlight reel, or the retrieved evidence is worth playing. Pass the stream_url values you got back from search_video_moments, ask_video, or create_video_clip. Never paste raw stream URLs into chat; put them here instead.',
  inputSchema: z.object({
    title: z
      .string()
      .describe('Panel heading, e.g. "Moments where pricing is discussed"'),
    identifier: z
      .string()
      .optional()
      .describe('Stable id — reuse it to update the same panel instead of opening a new one'),
    compiled_stream_url: z
      .string()
      .optional()
      .describe('Optional stream of every moment concatenated — powers the "Play all" button'),
    clips: z
      .array(
        z.object({
          label: z.string().optional().describe('Short caption for this moment'),
          video_id: z.string(),
          video_title: z.string().optional(),
          start: z.number().min(0).describe('Start in seconds'),
          end: z.number().min(0).describe('End in seconds'),
          text: z.string().optional().describe('Transcript or scene snippet'),
          score: z.number().optional(),
          stream_url: z.string().describe('Playable HLS URL for this clip'),
          thumbnail_url: z.string().optional(),
        })
      )
      .min(1)
      .describe('The clips to show, in the order they should be listed'),
  }),
  execute: async ({ title, identifier, compiled_stream_url, clips }) => {
    return {
      success: true,
      message: `Clip panel "${title}" is open with ${clips.length} clip${clips.length === 1 ? '' : 's'}.`,
      identifier: identifier ?? null,
      count: clips.length,
    }
  },
})
