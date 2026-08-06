import { createSupabaseServer } from '@/lib/supabase/server'
import { getUser } from '@/app/agent/hooks/get-user'
import { core } from '@/lib/core/client'
import type { ChunkOut, ProjectVideo, VideoDetails } from '@/lib/core/types'

type Params = Promise<{ videoId: string }>

export const maxDuration = 60

/** Core's own per-request ceiling. */
const PAGE = 500

/** Enough for ~10 hours at 20 s chunks; past that the page pages itself. */
const MAX_CHUNKS = 2000

/**
 * Every chunk, not the first page.
 *
 * Core paginates because an agent reading chunks wants a few; this page is the
 * opposite case — it exists to show all of them — so it walks the pages until
 * core's `total` is satisfied.
 */
async function allChunks(coreVideoId: string): Promise<{ chunks: ChunkOut[]; total: number }> {
  const first = await core.chunks(coreVideoId, { limit: PAGE, offset: 0 })
  const chunks = first.chunks ?? []
  const total = first.total ?? chunks.length

  while (chunks.length < Math.min(total, MAX_CHUNKS)) {
    const next = await core.chunks(coreVideoId, { limit: PAGE, offset: chunks.length })
    if (!next.chunks?.length) break
    chunks.push(...next.chunks)
  }

  return { chunks, total }
}

/**
 * The whole analysis of one video: row, core metadata, chunks, aggregates.
 *
 * Sources are settled independently. A video analysed without `people` has no
 * `entities` aggregate and a video mid-ingest has no chunks yet — neither is a
 * failure, and neither should blank the parts that did load.
 */
export async function GET(_request: Request, { params }: { params: Params }) {
  const { videoId } = await params

  const user = await getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const supabase = await createSupabaseServer()
  const { data } = await supabase
    .from('video_core')
    .select('*')
    .eq('id', videoId)
    .eq('user_id', user.id)
    .single()

  if (!data) return new Response('Video not found', { status: 404 })

  const video = data as ProjectVideo
  const errors: string[] = []

  // Still ingesting: the row is all there is, and saying so beats a 409 the
  // page would have to special-case anyway.
  if (!video.core_video_id) {
    return Response.json({
      video,
      core: null,
      chunks: [],
      chunk_total: 0,
      aggregates: {},
      available: [],
      errors: ['This video has not finished ingesting, so there is nothing analysed to show yet.'],
    } satisfies VideoDetails)
  }

  const [metadata, chunks, aggregates] = await Promise.allSettled([
    core.video(video.core_video_id),
    allChunks(video.core_video_id),
    core.aggregates(video.core_video_id),
  ])

  if (metadata.status === 'rejected') {
    errors.push(`Video metadata unavailable: ${metadata.reason?.message ?? metadata.reason}`)
  }
  if (chunks.status === 'rejected') {
    errors.push(`Chunks unavailable: ${chunks.reason?.message ?? chunks.reason}`)
  }
  if (aggregates.status === 'rejected') {
    errors.push(`Aggregates unavailable: ${aggregates.reason?.message ?? aggregates.reason}`)
  }

  const aggregateData = aggregates.status === 'fulfilled' ? aggregates.value : null

  const details: VideoDetails = {
    video,
    core: metadata.status === 'fulfilled' ? metadata.value : null,
    chunks: chunks.status === 'fulfilled' ? chunks.value.chunks : [],
    chunk_total: chunks.status === 'fulfilled' ? chunks.value.total : 0,
    aggregates: (aggregateData?.aggregates as Record<string, unknown>) ?? {},
    available: aggregateData?.available ?? [],
    errors,
  }

  return Response.json(details)
}
