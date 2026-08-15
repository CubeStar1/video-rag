'use client'

import { Loader2, Mic, Square, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useVoiceInput } from '@/hooks/use-voice-input'

interface VoiceInputButtonProps {
  /** Receives the transcript — callers decide where in the prompt it lands. */
  onTranscript: (text: string) => void
  disabled?: boolean
  /** Shape of the button, so it can sit in either prompt box's tool row. */
  className?: string
}

/** Dictate a prompt: click to record, click again to transcribe it with Whisper. */
export function VoiceInputButton({ onTranscript, disabled, className }: VoiceInputButtonProps) {
  const { status, elapsed, isSupported, toggle, cancel } = useVoiceInput(onTranscript)

  if (!isSupported) return null

  const isRecording = status === 'recording'
  const isTranscribing = status === 'transcribing'

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        disabled={disabled || isTranscribing}
        title={isRecording ? 'Stop and transcribe' : 'Dictate a prompt'}
        aria-label={isRecording ? 'Stop recording and transcribe' : 'Record a prompt'}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
          'text-muted-foreground hover:bg-muted hover:text-foreground',
          'disabled:pointer-events-none disabled:opacity-50',
          isRecording && 'text-red-500 hover:text-red-500',
          className
        )}
      >
        {isTranscribing ? (
          <Loader2 className="size-4 animate-spin" />
        ) : isRecording ? (
          <Square className="size-4 fill-current" />
        ) : (
          <Mic className="size-4" />
        )}
        {isRecording ? (
          <span className="tabular-nums">{formatElapsed(elapsed)}</span>
        ) : isTranscribing ? (
          'Transcribing'
        ) : null}
      </button>

      {/* An accidental recording should cost nothing, so let it be thrown away. */}
      {isRecording && (
        <button
          type="button"
          onClick={cancel}
          title="Discard this recording"
          aria-label="Discard this recording"
          className={cn(
            'inline-flex items-center rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
            'text-muted-foreground hover:bg-muted hover:text-foreground',
            className
          )}
        >
          <X className="size-4" />
        </button>
      )}
    </>
  )
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}
