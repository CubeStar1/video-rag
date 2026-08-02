'use client'

import { memo } from 'react'
import { AlertTriangle, CheckCircle2, Clock, Loader2 } from 'lucide-react'
import { Streamdown } from 'streamdown'
import { cn } from '@/lib/utils'

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
      </p>
      <MomentList moments={output?.moments ?? []} />
      {output?.note && <p className="text-xs text-muted-foreground italic">{output.note}</p>}
    </div>
  )
})

export const VideoAskResult = memo(function VideoAskResult({ output }: ResultProps) {
  if (output?.error) return <ErrorLine message={output.error} />

  return (
    <div className="space-y-2">
      <p className="whitespace-pre-wrap text-xs leading-relaxed">{output?.answer}</p>
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
    return <p className="text-xs text-muted-foreground">Empty transcript.</p>
  }

  return (
    <div className="space-y-1.5">
      {output?.segment_count > 0 && (
        <p className="text-xs text-muted-foreground">
          {output.segment_count} sentence{output.segment_count === 1 ? '' : 's'}
        </p>
      )}
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

export const VideoAggregateResult = memo(function VideoAggregateResult({ output }: ResultProps) {
  if (output?.error) return <ErrorLine message={output.error} />

  const rows: Record<string, unknown>[] = output?.rows ?? []
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">{output?.note || 'No rows.'}</p>
  }

  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
  const max = Math.max(
    ...rows.map((row) => Number(row.count ?? row.value ?? 0)).filter((n) => !Number.isNaN(n)),
    1
  )

  return (
    <div className="space-y-1">
      {rows.slice(0, 12).map((row, index) => {
        const label = String(row[columns[0]] ?? '—')
        const count = Number(row.count ?? row.value ?? 0)
        return (
          <div key={index} className="flex items-center gap-2 text-xs">
            <span className="w-32 shrink-0 truncate">{label}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full rounded-full bg-primary/60')}
                style={{ width: `${Math.max(4, (count / max) * 100)}%` }}
              />
            </div>
            <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">
              {count || '—'}
            </span>
          </div>
        )
      })}
    </div>
  )
})

export const VideoClipResult = memo(function VideoClipResult({ output }: ResultProps) {
  if (output?.error) return <ErrorLine message={output.error} />

  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p>
        Clip built from {output?.segments?.length ?? 0} segment
        {output?.segments?.length === 1 ? '' : 's'} · {output?.total_duration_seconds}s
      </p>
      {output?.segments?.length > 0 && (
        <p className="tabular-nums">{output.segments.join(', ')}</p>
      )}
    </div>
  )
})
