'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

export type VoiceInputStatus = 'idle' | 'recording' | 'transcribing'

/**
 * Containers `/api/transcribe` can identify, best first. Everything but Safari
 * gives us Opus in WebM; Safari only records mp4, which the endpoint rejects.
 */
const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
]

/** A prompt is a sentence or two — anything longer is a forgotten open mic. */
const MAX_RECORDING_MS = 3 * 60 * 1000

export interface UseVoiceInputResult {
  status: VoiceInputStatus
  /** Seconds recorded so far, for the button's running clock. */
  elapsed: number
  /** False without a microphone API — the button hides rather than teases. */
  isSupported: boolean
  /** Start recording, or stop and transcribe what was recorded. */
  toggle: () => void
  /** Drop the recording without spending a transcription on it. */
  cancel: () => void
}

/**
 * Hold-nothing voice input: click to record, click to transcribe. The finished
 * clip goes to Whisper through `/api/transcribe` and comes back as text for the
 * caller to drop into its prompt box.
 */
export function useVoiceInput(onTranscript: (text: string) => void): UseVoiceInputResult {
  const [status, setStatus] = useState<VoiceInputStatus>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [isSupported, setIsSupported] = useState(false)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const cancelledRef = useRef(false)
  // The callback is re-created on every keystroke in the parent; read it late so
  // the recorder never calls back into a stale `setInput`.
  const onTranscriptRef = useRef(onTranscript)
  onTranscriptRef.current = onTranscript

  // getUserMedia only exists in a secure context, so this has to be a runtime
  // check rather than a build-time one.
  useEffect(() => {
    setIsSupported(
      typeof window !== 'undefined' &&
        typeof window.MediaRecorder !== 'undefined' &&
        Boolean(navigator.mediaDevices?.getUserMedia)
    )
  }, [])

  const stopTracks = useCallback(() => {
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop())
    recorderRef.current = null
  }, [])

  // A recorder left running would keep the tab's mic indicator lit.
  useEffect(() => {
    return () => {
      cancelledRef.current = true
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
      stopTracks()
    }
  }, [stopTracks])

  // Running clock while recording, plus the hard stop.
  useEffect(() => {
    if (status !== 'recording') {
      setElapsed(0)
      return
    }

    const startedAt = Date.now()
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 250)
    const limit = setTimeout(() => {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    }, MAX_RECORDING_MS)

    return () => {
      clearInterval(tick)
      clearTimeout(limit)
    }
  }, [status])

  const send = useCallback(async (clip: Blob) => {
    setStatus('transcribing')

    const extension = clip.type.includes('ogg') ? 'ogg' : 'webm'
    const body = new FormData()
    body.append('audio', clip, `recording.${extension}`)

    try {
      const response = await fetch('/api/transcribe', { method: 'POST', body })
      if (!response.ok) throw new Error(await response.text())

      const { text } = (await response.json()) as { text?: string }
      if (!text) {
        toast.error('Nothing was said', { description: 'That recording came back empty.' })
        return
      }

      onTranscriptRef.current(text)
    } catch (error: any) {
      toast.error('Could not transcribe that', { description: error.message })
    } finally {
      setStatus('idle')
    }
  }, [])

  const start = useCallback(async () => {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error: any) {
      toast.error('Microphone unavailable', {
        description:
          error?.name === 'NotAllowedError'
            ? 'Allow microphone access for this site and try again.'
            : error.message,
      })
      return
    }

    const mimeType = PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
    if (!mimeType) {
      stream.getTracks().forEach((track) => track.stop())
      toast.error('Voice input is not supported in this browser')
      return
    }

    const recorder = new MediaRecorder(stream, { mimeType })
    const chunks: Blob[] = []

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }

    recorder.onstop = () => {
      stopTracks()
      const clip = new Blob(chunks, { type: recorder.mimeType })

      // A tap that stops on the same beat it started catches no audio.
      if (cancelledRef.current || clip.size === 0) {
        setStatus('idle')
        return
      }

      void send(clip)
    }

    recorderRef.current = recorder
    cancelledRef.current = false
    recorder.start()
    setStatus('recording')
  }, [send, stopTracks])

  const toggle = useCallback(() => {
    if (status === 'transcribing') return

    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
      return
    }

    void start()
  }, [start, status])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
    } else {
      stopTracks()
      setStatus('idle')
    }
  }, [stopTracks])

  return { status, elapsed, isSupported, toggle, cancel }
}
