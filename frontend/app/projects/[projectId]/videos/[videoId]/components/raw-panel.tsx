'use client'

import { Braces, Database } from 'lucide-react'
import { formatBytes, formatDuration } from '@/lib/core/format'
import { describeChunking } from '@/lib/core/chunking'
import type { VideoDetails } from '@/lib/core/types'
import { Chips, EmptyNote, Field, JsonView, RawDisclosure, Section } from './detail-primitives'

/** Aggregators core knows about, so "not run" can be distinguished from "unknown". */
const KNOWN_AGGREGATORS = [
  'summary',
  'chapters',
  'events',
  'stats',
  'novelty',
  'ner',
  'sentiment',
  'speaker_stats',
  'entities',
  'entity_timelines',
  'cooccurrence',
  'object_entities',
]

/**
 * The stored record itself: the row, core's metadata, and every aggregate in the
 * shape core returned it.
 *
 * The other tabs read aggregates they recognise. This one reads all of them,
 * which is what keeps the page honest when core gains an aggregator the
 * frontend has never heard of.
 */
export function RawPanel({ details }: { details: VideoDetails }) {
  const { video, core, aggregates, available } = details
  const ids = [...new Set([...Object.keys(aggregates), ...available])].sort()
  const missing = KNOWN_AGGREGATORS.filter((id) => !ids.includes(id))

  return (
    <div className="space-y-4">
      <Section title="Record" icon={<Database className="size-4" />} defaultOpen>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Title">{video.title}</Field>
          <Field label="Status">
            <span className="capitalize">{video.status}</span>
            {video.stage && <span className="text-muted-foreground"> · {video.stage}</span>}
          </Field>
          <Field label="Duration">{formatDuration(video.duration ?? core?.duration)}</Field>
          <Field label="Size">{formatBytes(video.size_bytes ?? core?.size_bytes)}</Field>
          <Field label="Chunks">
            <span className="tabular-nums">{details.chunk_total || video.chunk_count || 0}</span>
          </Field>
          <Field label="Chunking">
            {video.chunk_config || core?.chunk_config || '—'}
            {video.ingest_config && (
              <span className="block text-[11px] text-muted-foreground">
                {describeChunking(video.ingest_config)}
              </span>
            )}
          </Field>
          <Field label="Source">
            <span className="capitalize">{video.source_type}</span>
          </Field>
          <Field label="Core video id">
            <code className="break-all text-[11px]">{video.core_video_id ?? '—'}</code>
          </Field>
          <Field label="Storage path">
            <code className="break-all text-[11px]">
              {video.storage_path ?? core?.storage_path ?? '—'}
            </code>
          </Field>
          <Field label="Created">{new Date(video.created_at).toLocaleString()}</Field>
          <Field label="Updated">{new Date(video.updated_at).toLocaleString()}</Field>
          <Field label="Job">
            <code className="break-all text-[11px]">{video.job_id ?? '—'}</code>
          </Field>
          <Field label="Analyzers" className="sm:col-span-2">
            <Chips items={core?.analyzers ?? video.analyzers ?? []} tone="outline" />
          </Field>
          <Field label="Aggregates stored">
            <span className="tabular-nums">{ids.length}</span>
          </Field>
        </div>

        {video.error && (
          <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[12px] text-red-600 dark:text-red-400">
            {video.error}
          </p>
        )}

        {core?.params && Object.keys(core.params).length > 0 && (
          <div className="mt-4 border-t pt-3">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Chunking parameters
            </div>
            <JsonView value={core.params} />
          </div>
        )}

        <RawDisclosure label="Raw row and core metadata" value={{ video, core }} />
      </Section>

      <Section
        title="Aggregates"
        defaultOpen={false}
        icon={<Braces className="size-4" />}
        count={ids.length}
        subtitle={missing.length ? `not stored: ${missing.join(', ')}` : undefined}
      >
        {ids.length === 0 ? (
          <EmptyNote>
            No aggregates stored. They run after analysis, and any whose analyzer was not selected
            is skipped rather than failed.
          </EmptyNote>
        ) : (
          <div className="space-y-3">
            {ids.map((id) => (
              <div key={id} className="rounded-lg border bg-background p-3">
                <div className="mb-2 flex items-center gap-2">
                  <h4 className="font-mono text-[12px] font-medium">{id}</h4>
                  {!(id in aggregates) && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      listed but empty
                    </span>
                  )}
                </div>
                <JsonView value={aggregates[id] ?? null} />
                <RawDisclosure label={`Raw ${id} JSON`} value={aggregates[id] ?? null} />
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}
