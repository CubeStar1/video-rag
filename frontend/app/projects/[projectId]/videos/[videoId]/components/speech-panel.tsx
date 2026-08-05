'use client'

import { useMemo } from 'react'
import { Captions, MessagesSquare, Mic, SmilePlus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDuration } from '@/lib/core/format'
import type { ChunkOut } from '@/lib/core/types'
import { EmptyNote, Section, ShareBar, Stat, TimeLink } from './detail-primitives'
import { asArray, asRecord, num, readSpeakers, speakerLabel, str } from './aggregate-shapes'

interface SpeechPanelProps {
  chunks: ChunkOut[]
  aggregates: Record<string, unknown>
  currentTime: number
  onSeek: (seconds: number) => void
  onOpenChunk: (chunkId: number) => void
}

interface Line {
  start: number
  end: number
  text: string
  speaker?: string
  chunk_id: number
}

/**
 * Everything spoken, and who spoke it.
 *
 * The transcript is rebuilt from the chunks rather than fetched: `diarization`
 * and `transcript` are mutually exclusive at ingest, so at most one of them put
 * anything on a chunk, and whichever it was is already here.
 */
export function SpeechPanel({
  chunks,
  aggregates,
  currentTime,
  onSeek,
  onOpenChunk,
}: SpeechPanelProps) {
  const lines = useMemo<Line[]>(() => {
    const collected: Line[] = []
    for (const chunk of chunks) {
      for (const turn of chunk.diarization?.turns ?? []) {
        if (turn.text?.trim()) {
          collected.push({
            start: turn.start,
            end: turn.end,
            text: turn.text.trim(),
            speaker: turn.speaker,
            chunk_id: chunk.chunk_id,
          })
        }
      }
      const plain = chunk.transcript?.text?.trim()
      if (plain) {
        collected.push({
          start: chunk.start,
          end: chunk.end,
          text: plain,
          chunk_id: chunk.chunk_id,
        })
      }
    }
    return collected.sort((a, b) => a.start - b.start)
  }, [chunks])

  const speakers = readSpeakers(aggregates.speaker_stats)
  const speakerStats = asRecord(aggregates.speaker_stats)
  const sentiment = asRecord(aggregates.sentiment)

  if (lines.length === 0 && speakers.length === 0) {
    return (
      <div className="rounded-xl border border-dashed py-16 text-center">
        <Captions className="mx-auto size-6 text-muted-foreground/60" />
        <p className="mt-2 text-sm font-medium">No speech</p>
        <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
          Either this video has no audible speech, or it was analysed without the{' '}
          <code className="text-[12px]">transcript</code> or{' '}
          <code className="text-[12px]">diarization</code> pass.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {speakers.length > 0 && (
        <Section
          title="Speakers"
          icon={<Mic className="size-4" />}
          count={num(speakerStats.speaker_count, speakers.length)}
          subtitle={`${num(speakerStats.total_turns)} turns · ${num(
            speakerStats.handovers
          )} handovers`}
        >
          <div className="mb-3 grid gap-2 sm:grid-cols-3">
            <Stat
              label="Total speech"
              value={formatDuration(num(speakerStats.total_speech_seconds))}
            />
            <Stat label="Turns" value={num(speakerStats.total_turns)} />
            <Stat
              label="Dominant"
              value={speakerLabel(str(speakerStats.dominant_speaker))}
              hint="most talk time"
            />
          </div>

          <ul className="space-y-2">
            {speakers.map((speaker) => (
              <li key={speaker.speaker} className="rounded-lg border bg-background p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium">{speakerLabel(speaker.speaker)}</span>
                  <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                    {Math.round(speaker.share * 100)}% · {formatDuration(speaker.seconds)}
                  </span>
                </div>
                <ShareBar value={speaker.share} className="mt-1.5" />
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground sm:grid-cols-4">
                  <span>{speaker.turns} turns</span>
                  <span>{speaker.words} words</span>
                  <span>{speaker.words_per_second.toFixed(1)} words/s</span>
                  <span>longest {formatDuration(speaker.longest_turn)}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>
                    First <TimeLink seconds={speaker.first_seen} onSeek={onSeek} />
                  </span>
                  <span>
                    Last <TimeLink seconds={speaker.last_seen} onSeek={onSeek} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {Object.keys(sentiment).length > 0 && (
        <SentimentSection sentiment={sentiment} onSeek={onSeek} />
      )}

      <Section
        title="Transcript"
        icon={<MessagesSquare className="size-4" />}
        count={lines.length}
        subtitle={
          lines.some((line) => line.speaker)
            ? 'speaker-attributed (diarization)'
            : 'plain speech (transcript)'
        }
      >
        {lines.length === 0 ? (
          <EmptyNote>No speech was transcribed on any chunk.</EmptyNote>
        ) : (
          <ul className="space-y-0.5">
            {lines.map((line, index) => {
              const isActive = currentTime >= line.start && currentTime < line.end
              return (
                <li
                  key={`${line.start}-${index}`}
                  className={cn(
                    'flex items-start gap-2 rounded-md px-1.5 py-1 transition-colors',
                    isActive ? 'bg-primary/5' : 'hover:bg-muted/50'
                  )}
                >
                  <TimeLink seconds={line.start} onSeek={onSeek} className="mt-0.5 shrink-0" />
                  {line.speaker && (
                    <span className="mt-0.5 shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {line.speaker.replace(/^SPEAKER_/, 'S')}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 text-[13px] leading-snug">{line.text}</span>
                  <button
                    type="button"
                    onClick={() => onOpenChunk(line.chunk_id)}
                    className="mt-0.5 shrink-0 text-[10px] text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
                  >
                    {line.chunk_id}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Section>
    </div>
  )
}

const SENTIMENT_TONE: Record<string, string> = {
  positive: 'text-emerald-600 dark:text-emerald-400',
  negative: 'text-red-600 dark:text-red-400',
  neutral: 'text-muted-foreground',
}

function SentimentSection({
  sentiment,
  onSeek,
}: {
  sentiment: Record<string, any>
  onSeek: (seconds: number) => void
}) {
  const overall = asRecord(sentiment.overall)
  const total = Object.values(overall).reduce((sum: number, value) => sum + num(value), 0)
  const timeline = asArray(sentiment.timeline)
  const perSpeaker = asArray(sentiment.per_speaker)

  return (
    <Section
      title="Sentiment"
      icon={<SmilePlus className="size-4" />}
      subtitle={str(sentiment.model)}
    >
      <div className="grid gap-2 sm:grid-cols-3">
        {['positive', 'neutral', 'negative'].map((label) => (
          <div key={label} className="rounded-lg border bg-background px-3 py-2">
            <div className="flex items-center justify-between">
              <span
                className={cn(
                  'text-[11px] font-medium capitalize',
                  SENTIMENT_TONE[label] ?? 'text-muted-foreground'
                )}
              >
                {label}
              </span>
              <span className="text-[13px] font-semibold tabular-nums">{num(overall[label])}</span>
            </div>
            <ShareBar value={total ? num(overall[label]) / total : 0} className="mt-1.5" />
          </div>
        ))}
      </div>

      {perSpeaker.length > 0 && (
        <ul className="mt-3 space-y-1">
          {perSpeaker.map((row, index) => {
            const entry = asRecord(row)
            return (
              <li
                key={index}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-background px-3 py-2 text-[12px]"
              >
                <span className="font-medium">{speakerLabel(str(entry.speaker))}</span>
                <span className={cn('capitalize', SENTIMENT_TONE[str(entry.dominant)])}>
                  mostly {str(entry.dominant)}
                </span>
                <span className="ml-auto tabular-nums text-muted-foreground">
                  +{num(entry.positive)} / ={num(entry.neutral)} / −{num(entry.negative)}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {timeline.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Line by line
          </div>
          <ul className="space-y-0.5">
            {timeline.map((row, index) => {
              const entry = asRecord(row)
              const label = str(entry.label)
              return (
                <li key={index} className="flex items-start gap-2 text-[12px]">
                  <TimeLink seconds={num(entry.start)} onSeek={onSeek} className="shrink-0" />
                  <span
                    className={cn(
                      'w-16 shrink-0 capitalize tabular-nums',
                      SENTIMENT_TONE[label] ?? 'text-muted-foreground'
                    )}
                  >
                    {label}
                  </span>
                  <span className="min-w-0 flex-1 leading-snug">{str(entry.text)}</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {sentiment.note && (
        <p className="mt-3 border-t pt-2 text-[11px] text-muted-foreground">{str(sentiment.note)}</p>
      )}
    </Section>
  )
}
