'use client'

import { memo } from 'react'
import { AlertTriangle, CheckCircle2, Clock, Loader2, User } from 'lucide-react'
import { Streamdown } from 'streamdown'

interface ResultProps {
  args: any
  output: any
}

function ErrorLine({ message }: { message: string }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-red-500">
      <AlertTriangle className="mt-0.5 size-3 shrink-0" />
      {message}
    </p>
  )
}

function MomentList({ moments }: { moments: any[] }) {
  if (!moments?.length) {
    return <p className="text-xs text-muted-foreground">No moments matched.</p>
  }

  return (
    <ul className="space-y-1.5">
      {moments.slice(0, 10).map((moment, index) => (
        <li key={index} className="flex items-start gap-2 text-xs">
          <span className="mt-px inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-medium tabular-nums text-foreground">
            <Clock className="size-2.5" />
            {moment.timestamp}
          </span>
          <span className="min-w-0 flex-1 text-muted-foreground">
            <span className="line-clamp-2">{moment.text || moment.video_title || '—'}</span>
          </span>
        </li>
      ))}
      {moments.length > 10 && (
        <li className="text-xs text-muted-foreground">+{moments.length - 10} more</li>
      )}
    </ul>
  )
}

export const VideoSearchResult = memo(function VideoSearchResult({ output }: ResultProps) {
  if (output?.error) return <ErrorLine message={output.error} />

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {output?.count ?? 0} moment{output?.count === 1 ? '' : 's'} for “{output?.query}”
        {output?.analyzer && output.analyzer !== 'default_video' ? ` · ${output.analyzer}` : ''}
        {output?.field && output.field !== 'combined' ? ` · ${output.field}` : ''}
      </p>
      <MomentList moments={output?.moments ?? []} />
      {output?.note && <p className="text-xs italic text-muted-foreground">{output.note}</p>}
      {output?.warning && <ErrorLine message={output.warning} />}
    </div>
  )
})

export const VideoAskResult = memo(function VideoAskResult({ output }: ResultProps) {
  if (output?.error) return <ErrorLine message={output.error} />

  // Which video-level results core routed the question to. Worth showing: it is
  // the difference between an answer assembled from segments and one that used
  // the cross-video reasoning those segments cannot contain.
  const routed = Object.values(output?.consulted ?? {})
    .flatMap((entry: any) => entry?.routed_to ?? [])
    .filter(Boolean)

  return (
    <div className="space-y-2">
      <p className="whitespace-pre-wrap text-xs leading-relaxed">{output?.answer}</p>
      {routed.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Consulted: {[...new Set(routed)].join(', ')}
        </p>
      )}
      {output?.sources?.length > 0 && (
        <div className="border-t pt-2">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Sources
          </p>
          <MomentList moments={output.sources} />
        </div>
      )}
    </div>
  )
})

export const VideoListResult = memo(function VideoListResult({ output }: ResultProps) {
  const videos = output?.videos ?? []

  if (videos.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {output?.note || 'No videos in this project yet.'}
      </p>
    )
  }

  return (
    <ul className="space-y-1.5">
      {videos.map((video: any, index: number) => (
        <li key={index} className="flex items-center gap-2 text-xs">
          {video.searchable ? (
            <CheckCircle2 className="size-3 shrink-0 text-emerald-500" />
          ) : video.status === 'failed' ? (
            <AlertTriangle className="size-3 shrink-0 text-red-500" />
          ) : (
            <Loader2 className="size-3 shrink-0 animate-spin text-amber-500" />
          )}
          <span className="min-w-0 flex-1 truncate font-medium">{video.title}</span>
          {video.analyzers?.length > 0 && (
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {video.analyzers.length} analyzer{video.analyzers.length === 1 ? '' : 's'}
            </span>
          )}
          <span className="tabular-nums text-muted-foreground">{video.duration}</span>
        </li>
      ))}
    </ul>
  )
})

export const VideoTranscriptResult = memo(function VideoTranscriptResult({ output }: ResultProps) {
  if (output?.error) return <ErrorLine message={output.error} />

  const transcript: string = output?.transcript ?? output?.text ?? ''

  if (!transcript) {
    return (
      <p className="text-xs text-muted-foreground">
        {output?.note || 'Empty transcript.'}
      </p>
    )
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">
        {output?.segment_count > 0 && (
          <>
            {output.segment_count} line{output.segment_count === 1 ? '' : 's'}
          </>
        )}
        {output?.speakers_attributed && ' · speaker-attributed'}
      </p>
      <div className="max-h-64 overflow-y-auto pr-1">
        <Streamdown
          className="text-xs leading-relaxed text-muted-foreground"
          components={{
            ul: ({ children }) => <ul className="space-y-1">{children}</ul>,
            li: ({ children }) => (
              <li className="[&>strong]:mr-1 [&>strong]:font-medium [&>strong]:tabular-nums [&>strong]:text-foreground">
                {children}
              </li>
            ),
          }}
        >
          {transcript}
        </Streamdown>
      </div>
      {output?.note && <p className="text-xs italic text-muted-foreground">{output.note}</p>}
    </div>
  )
})

/**
 * Video-level results. Their shapes are aggregator-specific and several are
 * LLM-written, so this renders JSON rather than pretending to know each one —
 * a bar chart of "novelty" or "chapters" would be a lie about what came back.
 */
export const VideoInsightResult = memo(function VideoInsightResult({ output }: ResultProps) {
  if (output?.error) return <ErrorLine message={output.error} />

  if (output?.available) {
    return (
      <div className="space-y-1 text-xs">
        <p className="text-muted-foreground">Available for this video:</p>
        <div className="flex flex-wrap gap-1">
          {(output.available as string[]).map((name) => (
            <span key={name} className="rounded bg-muted px-1.5 py-0.5 font-medium">
              {name}
            </span>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">{output?.insight}</p>
      <pre className="max-h-64 overflow-auto rounded bg-muted/50 p-2 text-[11px] leading-relaxed text-muted-foreground">
        {JSON.stringify(output?.result, null, 2)}
      </pre>
    </div>
  )
})

export const VideoEntitiesResult = memo(function VideoEntitiesResult({ output }: ResultProps) {
  if (output?.error) return <ErrorLine message={output.error} />

  const entities = output?.entities ?? []
  if (entities.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">{output?.note || 'Nobody linked.'}</p>
    )
  }

  return (
    <ul className="space-y-2">
      {entities.slice(0, 8).map((entity: any, index: number) => (
        <li key={index} className="flex items-start gap-2 text-xs">
          <User className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2">{entity.description}</span>
            <span className="mt-0.5 block tabular-nums text-[11px] text-muted-foreground">
              {entity.first_seen}–{entity.last_seen} · {entity.appearances} appearances
              {entity.present_for ? ` · present ${entity.present_for}` : ''}
            </span>
          </span>
        </li>
      ))}
      {entities.length > 8 && (
        <li className="text-xs text-muted-foreground">+{entities.length - 8} more</li>
      )}
    </ul>
  )
})

/** Full analyzer output for specific chunks — structurally arbitrary, so JSON. */
export const VideoChunksResult = memo(function VideoChunksResult({ output }: ResultProps) {
  if (output?.error) return <ErrorLine message={output.error} />

  const chunks = output?.chunks ?? []
  if (chunks.length === 0) {
    return <p className="text-xs text-muted-foreground">{output?.note || 'No chunks.'}</p>
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">
        {output.count} of {output.total_matching} chunk{output.total_matching === 1 ? '' : 's'}
      </p>
      <pre className="max-h-64 overflow-auto rounded bg-muted/50 p-2 text-[11px] leading-relaxed text-muted-foreground">
        {JSON.stringify(chunks, null, 2)}
      </pre>
    </div>
  )
})
