'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  acquireClipCut,
  clipCutKey,
  getClipCutState,
  isClipCuttingSupported,
  retryClipCut,
  toClipSpan,
  type ClipCutState,
  type ClipSpan,
} from '@/lib/core/clip-cutter'
import type { ClipItem } from '@/lib/core/types'

export interface UseClipCutResult extends ClipCutState {
  /** False where WebCodecs is missing — callers fall back to range playback. */
  supported: boolean
  retry: () => void
}

const IDLE: ClipCutState = { status: 'idle', url: null, progress: 0, error: null, bytes: 0 }

/**
 * Subscribe to the real cut of a clip, cutting it if nobody has yet.
 *
 * `enabled` is the on-demand switch: a card passes `false` until it is hovered,
 * the panel player passes `true` for the selected clip and for the next one
 * while playing through the reel. Releasing the last subscriber mid-cut cancels
 * it, so leaving a card before its preview is ready costs nothing further.
 */
export function useClipCut(
  clip: Pick<ClipItem, 'url' | 'start' | 'end'> | null | undefined,
  enabled = true
): UseClipCutResult {
  const span: ClipSpan | null = useMemo(
    () => (clip?.url && clip.end > clip.start ? toClipSpan(clip) : null),
    [clip?.url, clip?.start, clip?.end]
  )

  const [state, setState] = useState<ClipCutState>(IDLE)
  const supported = useSupportedOnClient()

  useEffect(() => {
    // Nothing is reported while disabled. A cached cut is only safe to point at
    // while it is held — unheld ones can be evicted and their URL revoked — and
    // re-enabling picks a finished cut back up immediately anyway.
    if (!span || !enabled) {
      setState(IDLE)
      return
    }

    const key = clipCutKey(span)
    const sync = () => setState(getClipCutState(key))

    const release = acquireClipCut(span, sync)
    sync()
    return release
  }, [span, enabled])

  const retry = useCallback(() => {
    if (span) retryClipCut(span)
  }, [span])

  return { ...state, supported, retry }
}

/**
 * Feature detection has to wait for the client: rendering "unsupported" on the
 * server and "supported" on the client is a hydration mismatch.
 */
function useSupportedOnClient(): boolean {
  const [supported, setSupported] = useState(true)
  useEffect(() => setSupported(isClipCuttingSupported()), [])
  return supported
}
