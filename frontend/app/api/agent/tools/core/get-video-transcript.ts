import { tool } from 'ai'
import { z } from 'zod'
import { core, CoreApiError } from '@/lib/core/client'
import { formatTimestamp } from '@/lib/core/format'
import { resolveScope, type VideoToolContext } from './scope'
import type { ChunkOut, TranscriptSegment } from '@/lib/core/types'

const MAX_CHARS = 12000

/** One markdown line per turn, timestamped and attributed so quotes can cite both. */
function toMarkdown(segments: TranscriptSegment[]): string {
  return segments
    .map(
      (segment) =>
        `- **[${formatTimestamp(segment.start)}]**${
          segment.speaker ? ` **${segment.speaker}:**` : ''
        } ${segment.text}`
    )
    .join('\n')
}

/** Cut on a segment boundary, so no sentence is left half-quoted. */
function fitToBudget(segments: TranscriptSegment[]): TranscriptSegment[] {
  const kept: TranscriptSegment[] = []
  let chars = 0
  for (const segment of segments) {
    chars += segment.text.length + 24 // + the timestamp and speaker prefix
    if (chars > MAX_CHARS) break
    kept.push(segment)
  }
  // A single over-long segment would otherwise return nothing at all.
  return kept.length > 0 ? kept : segments.slice(0, 1)
}

function extract(chunks: ChunkOut[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = []
  for (const chunk of chunks) {
    for (const turn of chunk.diarization?.turns ?? []) {
      if (turn.text?.trim()) {
        segments.push({
          start: turn.start,
          end: turn.end,
          text: turn.text.trim(),
          speaker: turn.speaker,
        })
      }
    }
    const plain = chunk.transcript?.text?.trim()
    if (plain) segments.push({ start: chunk.start, end: chunk.end, text: plain })
  }
  return segments.sort((a, b) => a.start - b.start)
}

export function createGetVideoTranscriptTool(context: VideoToolContext) {
  return tool({
    description:
      'Get the spoken-word transcript of a video as timestamped lines, optionally limited to a time range. Use this when the user wants exact wording or a quote, or to read a stretch of speech in full. ' +
      'When the video was analysed with speaker diarization, each line is attributed — so "who said X" is answerable from this, and quotes should name the speaker. Returns markdown lines of `[m:ss] SPEAKER: sentence`; quote from these and cite the timestamp.',
    inputSchema: z.object({
      video_id: z.string().describe('Video id'),
      start: z.number().min(0).optional().describe('Start of the range, in seconds'),
      end: z.number().min(0).optional().describe('End of the range, in seconds'),
    }),
    execute: async ({ video_id, start, end }) => {
      const { ids, note } = await resolveScope(context, [video_id])
      if (ids.length === 0) {
        return { transcript: '', note: note ?? `Video ${video_id} is not searchable here.` }
      }

      // Diarization and transcript are mutually exclusive at ingest, so at most
      // one of these exists. Ask for the richer one first and fall back rather
      // than making the model know which ran.
      let chunks: ChunkOut[] = []
      let source: string | null = null
      for (const analyzer of ['diarization', 'transcript'] as const) {
        try {
          const result = await core.chunks(ids[0], { analyzer, after: start, before: end, limit: 500 })
          chunks = result.chunks
          source = analyzer
          break
        } catch (error) {
          // A 400 means this video has no output from that analyzer; anything
          // else is a real failure worth surfacing.
          if (!(error instanceof CoreApiError) || error.status !== 400) {
            return { error: (error as Error).message, transcript: '' }
          }
        }
      }

      if (!source) {
        return {
          video_id,
          transcript: '',
          note: 'This video was analysed without speech transcription. Re-index it with the transcript or diarization analyzer to make its speech readable.',
        }
      }

      const segments = extract(chunks)
      if (segments.length === 0) {
        return {
          video_id,
          transcript: '',
          note: 'No speech found in that range. The video may be silent.',
        }
      }

      const kept = fitToBudget(segments)
      const truncated = kept.length < segments.length
      const resumeFrom = truncated ? segments[kept.length].start : null

      return {
        video_id,
        source,
        speakers_attributed: source === 'diarization',
        range: start !== undefined || end !== undefined ? { start, end } : 'full',
        segment_count: kept.length,
        transcript: toMarkdown(kept),
        ...(truncated
          ? {
              note: `Transcript truncated after ${formatTimestamp(
                kept[kept.length - 1].end
              )} (${segments.length - kept.length} more lines). Call again with start=${Math.floor(
                resumeFrom ?? 0
              )} for the rest.`,
            }
          : {}),
      }
    },
  })
}
