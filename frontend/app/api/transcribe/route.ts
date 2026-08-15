import { experimental_transcribe as transcribe } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { getUser } from '@/app/agent/hooks/get-user'

/** Whisper caps uploads at 25 MB; the recorder should never get close. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024

/**
 * `transcribe` sniffs the container from the bytes and falls back to wav when it
 * cannot tell — which would hand OpenAI an `audio.wav` that is not a wav. Only
 * accept what the sniffer actually recognizes, so a bad guess never reaches the
 * API as a confusing 400.
 */
const CONTAINER_SIGNATURES: Array<{ label: string; prefix: (number | null)[] }> = [
  { label: 'webm', prefix: [0x1a, 0x45, 0xdf, 0xa3] },
  { label: 'ogg', prefix: [0x4f, 0x67, 0x67, 0x53] },
  { label: 'wav', prefix: [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x41, 0x56, 0x45] },
  { label: 'flac', prefix: [0x66, 0x4c, 0x61, 0x43] },
  { label: 'mp3', prefix: [0x49, 0x44, 0x33] },
  { label: 'mp3', prefix: [0xff, 0xfb] },
  { label: 'mp3', prefix: [0xff, 0xe2] },
]

function isSniffableAudio(bytes: Uint8Array): boolean {
  return CONTAINER_SIGNATURES.some(
    ({ prefix }) =>
      bytes.length >= prefix.length &&
      prefix.every((byte, index) => byte === null || bytes[index] === byte)
  )
}

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY })

export const maxDuration = 60

/** Voice-to-text for the prompt box: a recorded clip in, plain text out. */
export async function POST(request: Request) {
  const user = await getUser()
  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  if (!process.env.OPENAI_API_KEY) {
    return new Response('Transcription is not configured', { status: 501 })
  }

  const form = await request.formData()
  const audio = form.get('audio')

  if (!(audio instanceof File) || audio.size === 0) {
    return new Response('No audio was uploaded', { status: 400 })
  }

  if (audio.size > MAX_AUDIO_BYTES) {
    return new Response('That recording is too long to transcribe', { status: 413 })
  }

  const bytes = new Uint8Array(await audio.arrayBuffer())

  if (!isSniffableAudio(bytes)) {
    return new Response(
      'Your browser recorded an audio format we cannot transcribe',
      { status: 415 }
    )
  }

  try {
    const result = await transcribe({
      model: openai.transcription('whisper-1'),
      audio: bytes,
      abortSignal: AbortSignal.timeout(55_000),
    })

    return Response.json({
      text: result.text.trim(),
      language: result.language,
      durationInSeconds: result.durationInSeconds,
    })
  } catch (error: any) {
    console.error('Transcription failed:', error)
    return new Response(error?.message || 'Could not transcribe that recording', {
      status: 502,
    })
  }
}
