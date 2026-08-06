'use client'

import type { ClipItem } from '@/lib/core/types'

/**
 * Cuts a real mp4 out of a video, in the browser.
 *
 * Everywhere else a "clip" is a range the player seeks to inside the whole
 * file. That is cheap, but it is not a clip: the scrubber spans the lecture, the
 * thumbnail plays on into the next scene, and there is nothing to hand someone.
 * This module produces the actual thing — a standalone mp4 containing only the
 * clip's span, starting at 0:00.
 *
 * It runs on Mediabunny over WebCodecs, which matters for two reasons:
 *
 * - The input is a `UrlSource`, so the source video is read with HTTP range
 *   requests. Cutting 0:40–0:55 out of a 2 GB lecture downloads the moov atom
 *   and the bytes for those fifteen seconds, not two gigabytes.
 * - Decode and encode are the platform's, so a cut costs roughly what playback
 *   costs rather than what a wasm build of ffmpeg costs.
 *
 * Cuts are shared and ref-counted across every component that asks for the same
 * span — the panel player, a card's hover preview, and the download button all
 * wait on one conversion and reuse one blob.
 */

/** Cut clips are held in memory as blobs, so these bounds are real. */
const MAX_CACHED_CLIPS = 12
const MAX_CACHED_BYTES = 256 * 1024 * 1024
/** Hovering across a grid should not start twenty encodes at once. */
const MAX_CONCURRENT_CUTS = 2

export type ClipCutStatus = 'idle' | 'queued' | 'cutting' | 'ready' | 'error'

export interface ClipCutState {
  status: ClipCutStatus
  /** A `blob:` URL for the cut mp4, once there is one. */
  url: string | null
  /** 0–1, while cutting. */
  progress: number
  error: string | null
  /** Size of the cut file, once ready. */
  bytes: number
}

/** The part of a clip that identifies the cut; the rest is presentation. */
export interface ClipSpan {
  url: string
  start: number
  end: number
}

interface CutEntry extends ClipCutState {
  key: string
  span: ClipSpan
  blob: Blob | null
  /** Components currently depending on this cut. At zero it may be evicted. */
  holders: number
  lastUsed: number
  listeners: Set<() => void>
  cancel: (() => void) | null
}

const cache = new Map<string, CutEntry>()
const queue: CutEntry[] = []
let running = 0

export function toClipSpan(clip: Pick<ClipItem, 'url' | 'start' | 'end'>): ClipSpan {
  return {
    // Media fragments are for the seek-based path; the cutter wants the file.
    url: clip.url.split('#')[0],
    start: Math.max(0, clip.start),
    end: clip.end,
  }
}

export function clipCutKey(span: ClipSpan): string {
  return `${span.url}|${span.start.toFixed(3)}|${span.end.toFixed(3)}`
}

/**
 * Whether this browser can cut at all.
 *
 * WebCodecs is the whole mechanism, so where it is missing (Firefox before 130,
 * older Safari) callers fall back to seeking a range in the full file.
 */
export function isClipCuttingSupported(): boolean {
  if (typeof window === 'undefined') return false
  const codecs = window as unknown as { VideoEncoder?: unknown; VideoDecoder?: unknown }
  return typeof codecs.VideoEncoder === 'function' && typeof codecs.VideoDecoder === 'function'
}

const IDLE: ClipCutState = {
  status: 'idle',
  url: null,
  progress: 0,
  error: null,
  bytes: 0,
}

export function getClipCutState(key: string): ClipCutState {
  const entry = cache.get(key)
  if (!entry) return IDLE
  return {
    status: entry.status,
    url: entry.url,
    progress: entry.progress,
    error: entry.error,
    bytes: entry.bytes,
  }
}

function emit(entry: CutEntry) {
  for (const listener of entry.listeners) listener()
}

function ensureEntry(span: ClipSpan): CutEntry {
  const key = clipCutKey(span)
  const existing = cache.get(key)
  if (existing) {
    existing.lastUsed = Date.now()
    return existing
  }

  const entry: CutEntry = {
    key,
    span,
    status: 'idle',
    url: null,
    progress: 0,
    error: null,
    bytes: 0,
    blob: null,
    holders: 0,
    lastUsed: Date.now(),
    listeners: new Set(),
    cancel: null,
  }
  cache.set(key, entry)
  return entry
}

/**
 * Drop finished cuts nobody is holding once the cache is over either bound,
 * oldest first. Revoking the object URL is the point — the blob behind it is
 * what the byte budget is protecting.
 */
function evict() {
  const idle = [...cache.values()]
    .filter((entry) => entry.holders === 0 && entry.status !== 'cutting' && entry.status !== 'queued')
    .sort((a, b) => a.lastUsed - b.lastUsed)

  const overCount = () => cache.size > MAX_CACHED_CLIPS
  const overBytes = () =>
    [...cache.values()].reduce((sum, entry) => sum + entry.bytes, 0) > MAX_CACHED_BYTES

  for (const entry of idle) {
    if (!overCount() && !overBytes()) break
    dispose(entry)
  }
}

function dispose(entry: CutEntry) {
  if (entry.url) URL.revokeObjectURL(entry.url)
  entry.url = null
  entry.blob = null
  entry.bytes = 0
  entry.status = 'idle'
  cache.delete(entry.key)
  emit(entry)
}

function pump() {
  while (running < MAX_CONCURRENT_CUTS && queue.length > 0) {
    const entry = queue.shift()
    if (!entry || entry.status !== 'queued') continue
    running += 1
    void run(entry).finally(() => {
      running -= 1
      pump()
    })
  }
}

async function run(entry: CutEntry) {
  entry.status = 'cutting'
  entry.progress = 0
  emit(entry)

  // `Input.dispose()` is how in-flight range requests are abandoned — the
  // source has no abort signal of its own. It is synchronous.
  let input: { dispose: () => void } | null = null

  try {
    // Loaded on first cut only: the demuxers and muxers are a large chunk that
    // nothing in the panel needs until someone actually asks for a clip.
    const {
      ALL_FORMATS,
      BufferTarget,
      Conversion,
      ConversionCanceledError,
      Input,
      Mp4OutputFormat,
      Output,
      UrlSource,
    } = await import('mediabunny')

    const media = new Input({
      formats: ALL_FORMATS,
      source: new UrlSource(entry.span.url),
    })
    input = media

    const output = new Output({
      // Metadata up front, so the blob is seekable the moment it is handed to a
      // video element rather than after a scan to the end.
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new BufferTarget(),
    })

    const conversion = await Conversion.init({
      input: media,
      output,
      trim: { start: entry.span.start, end: entry.span.end },
    })

    if (!conversion.isValid) {
      throw new Error('This video cannot be cut in the browser.')
    }

    entry.cancel = () => void conversion.cancel()
    conversion.onProgress = (progress) => {
      entry.progress = progress
      emit(entry)
    }

    try {
      await conversion.execute()
    } catch (error) {
      if (error instanceof ConversionCanceledError) {
        entry.status = 'idle'
        entry.progress = 0
        emit(entry)
        return
      }
      throw error
    }

    const buffer = output.target.buffer
    if (!buffer) throw new Error('The cut produced no data.')

    entry.blob = new Blob([buffer], { type: 'video/mp4' })
    entry.bytes = buffer.byteLength
    entry.url = URL.createObjectURL(entry.blob)
    entry.status = 'ready'
    entry.progress = 1
    entry.error = null
  } catch (error) {
    entry.status = 'error'
    entry.error = error instanceof Error ? error.message : 'Could not cut this clip.'
  } finally {
    entry.cancel = null
    try {
      input?.dispose()
    } catch {
      // Already disposed, or disposed as part of a cancel — nothing to do.
    }
    emit(entry)
    evict()
  }
}

function start(entry: CutEntry) {
  if (entry.status === 'ready' || entry.status === 'cutting' || entry.status === 'queued') return
  if (!isClipCuttingSupported()) {
    entry.status = 'error'
    entry.error = 'This browser cannot cut video (WebCodecs is unavailable).'
    emit(entry)
    return
  }

  entry.status = 'queued'
  entry.progress = 0
  entry.error = null
  queue.push(entry)
  emit(entry)
  pump()
}

/**
 * Depend on a cut, starting it if it is not already running or done.
 *
 * Returns a release function. While at least one holder remains the cut is kept
 * and cannot be evicted; when the last one leaves mid-cut the conversion is
 * cancelled, which is what makes a hover preview cheap to abandon.
 */
export function acquireClipCut(span: ClipSpan, onChange: () => void): () => void {
  const entry = ensureEntry(span)
  entry.holders += 1
  entry.lastUsed = Date.now()
  entry.listeners.add(onChange)
  start(entry)

  let released = false
  return () => {
    if (released) return
    released = true
    entry.holders -= 1
    entry.lastUsed = Date.now()
    entry.listeners.delete(onChange)
    if (entry.holders === 0 && (entry.status === 'cutting' || entry.status === 'queued')) {
      entry.cancel?.()
      entry.status = 'idle'
      entry.progress = 0
    }
    evict()
  }
}

/** Retry a cut that failed. */
export function retryClipCut(span: ClipSpan) {
  const entry = cache.get(clipCutKey(span))
  if (!entry || entry.status !== 'error') return
  entry.status = 'idle'
  start(entry)
}

/**
 * The cut file itself, waiting for one already in flight rather than starting a
 * second. Used by the download action, which wants bytes and not a URL.
 */
export function getClipCutBlob(span: ClipSpan): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // `acquireClipCut` can notify synchronously (a cached cut, or the queued
    // transition), so `release` may not exist yet when `settle` first runs —
    // hence the flag rather than calling it directly.
    let release: (() => void) | null = null
    let settled = false

    const settle = () => {
      if (settled) return
      const entry = cache.get(clipCutKey(span))
      if (!entry) return
      if (entry.status === 'ready' && entry.blob) {
        settled = true
        resolve(entry.blob)
      } else if (entry.status === 'error') {
        settled = true
        reject(new Error(entry.error ?? 'Could not cut this clip.'))
      }
      if (settled) release?.()
    }

    release = acquireClipCut(span, settle)
    if (settled) release()
    else settle()
  })
}

/** Save a cut clip to disk, cutting it first if it is not already in hand. */
export async function downloadClipCut(span: ClipSpan, filename: string) {
  const blob = await getClipCutBlob(span)
  // Its own URL, not the cache's: the cached one is revoked on eviction, which
  // could land mid-download.
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
