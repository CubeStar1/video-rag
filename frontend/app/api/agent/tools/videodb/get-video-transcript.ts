import { tool } from 'ai'
import { z } from 'zod'
import { videodb } from '@/lib/videodb/backend-client'
import { formatTimestamp } from '@/lib/videodb/format'
import type { TranscriptSegment } from '@/lib/videodb/types'

const MAX_CHARS = 12000

/** One markdown line per sentence, timestamped so the model can cite it directly. */
function toMarkdown(segments: TranscriptSegment[]): string {
  return segments
    .map((segment) => `- **[${formatTimestamp(segment.start)}]** ${segment.text}`)
    .join('\n')
}

/** Cut on a segment boundary, so no sentence is left half-quoted. */
function fitToBudget(segments: TranscriptSegment[]): TranscriptSegment[] {
  const kept: TranscriptSegment[] = []
  let chars = 0
  for (const segment of segments) {
    chars += segment.text.length + 16 // + the timestamp prefix
    if (chars > MAX_CHARS) break
    kept.push(segment)
  }
  // A single over-long segment would otherwise return nothing at all.
  return kept.length > 0 ? kept : segments.slice(0, 1)
}

export const getVideoTranscriptTool = tool({
  description:
    'Get the spoken-word transcript of a video as timestamped sentences, optionally limited to a time range. Use this when the user wants exact wording or a quote, or to read a specific stretch of the video in full. Returns markdown lines of `[m:ss] sentence` — quote from these and cite the timestamp.',
  inputSchema: z.object({
    video_id: z.string().describe('VideoDB video id'),
    start: z.number().min(0).optional().describe('Start of the range, in seconds'),
    end: z.number().min(0).optional().describe('End of the range, in seconds'),
  }),
  execute: async ({ video_id, start, end }) => {
    try {
      const result = await videodb.transcript(video_id, { start, end, segmenter: 'sentence' })
      const segments = result.segments ?? []

      if (segments.length === 0) {
        // No timestamped segments came back — fall back to the flat text.
        const text = result.text.slice(0, MAX_CHARS)
        return {
          video_id,
          range: start !== undefined || end !== undefined ? { start, end } : 'full',
          segment_count: 0,
          transcript: text,
          ...(text ? {} : { note: 'Empty transcript. The video may still be indexing.' }),
        }
      }

      const kept = fitToBudget(segments)
      const truncated = kept.length < segments.length
      const resumeFrom = truncated ? segments[kept.length].start : null

      return {
        video_id,
        range: start !== undefined || end !== undefined ? { start, end } : 'full',
        segment_count: kept.length,
        transcript: toMarkdown(kept),
        ...(truncated
          ? {
              note: `Transcript truncated after ${formatTimestamp(
                kept[kept.length - 1].end
              )} (${segments.length - kept.length} more sentences). Call again with start=${Math.floor(
                resumeFrom ?? 0
              )} for the rest.`,
            }
          : {}),
      }
    } catch (error: any) {
      return { error: error.message, transcript: '' }
    }
  },
})
