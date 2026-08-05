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

/**
 * A shareable link to a moment, as a media fragment.
 *
 * This is what replaced the per-clip stream URL: there is no separate object to
 * link to, so the link is the video plus the range. Browsers honour `#t=` on a
 * direct media URL, and Supabase Storage serves ranges, so opening one seeks
 * rather than downloading to the offset.
 */
export function toFragmentUrl(
  url: string | null | undefined,
  start: number,
  end?: number
): string | null {
  if (!url) return null
  const base = url.split('#')[0]
  const range = end !== undefined && end > start ? `${start.toFixed(2)},${end.toFixed(2)}` : start.toFixed(2)
  return `${base}#t=${range}`
}

/** Bytes → `1.4 GB`. Only used where a size is genuinely informative. */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}
