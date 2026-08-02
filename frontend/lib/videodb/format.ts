/** Seconds → `m:ss`, or `h:mm:ss` past an hour. */
export function formatTimestamp(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '0:00'

  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (value: number) => value.toString().padStart(2, '0')

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}

export function formatRange(start: number, end: number): string {
  return `${formatTimestamp(start)} – ${formatTimestamp(end)}`
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '—'
  return formatTimestamp(seconds)
}

export const VIDEODB_PLAYER = 'https://console.videodb.io/player?url='

export function toPlayerUrl(streamUrl: string | null | undefined): string | null {
  return streamUrl ? `${VIDEODB_PLAYER}${streamUrl}` : null
}
