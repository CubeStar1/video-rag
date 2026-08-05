'use client'

import { useState } from 'react'
import { ChevronRight, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatTimestamp } from '@/lib/core/format'

/** A titled block. Every panel on this page is made of these, so they line up. */
export function Section({
  title,
  subtitle,
  count,
  icon,
  actions,
  children,
  className,
}: {
  title: string
  subtitle?: string
  count?: number
  icon?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-xl border bg-card', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          {icon && <span className="text-muted-foreground">{icon}</span>}
          {title}
          {count !== undefined && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-normal tabular-nums text-muted-foreground">
              {count}
            </span>
          )}
        </h3>
        {subtitle && !actions && (
          <span className="text-[11px] text-muted-foreground">{subtitle}</span>
        )}
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

/** Label above a value, the unit the metadata strip and stat grids are built from. */
export function Field({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 min-w-0 text-[13px]">{children}</div>
    </div>
  )
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string
  value: React.ReactNode
  hint?: string
}) {
  return (
    <div className="rounded-lg border bg-background px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums leading-tight">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  )
}

/** Short labels — tags, objects, topics, roles. */
export function Chips({
  items,
  tone = 'muted',
  className,
}: {
  items: (string | null | undefined)[]
  tone?: 'muted' | 'outline' | 'accent'
  className?: string
}) {
  const values = items.filter((item): item is string => Boolean(item && String(item).trim()))
  if (values.length === 0) return null

  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {values.map((value, index) => (
        <span
          key={`${value}-${index}`}
          className={cn(
            'rounded-md px-1.5 py-0.5 text-[11px] leading-snug',
            tone === 'muted' && 'bg-muted text-muted-foreground',
            tone === 'outline' && 'border bg-background text-muted-foreground',
            tone === 'accent' && 'bg-primary/10 text-primary'
          )}
        >
          {value}
        </span>
      ))}
    </div>
  )
}

/** A timestamp that seeks the player above. Every time on this page is one of these. */
export function TimeLink({
  seconds,
  end,
  onSeek,
  className,
  showIcon = false,
}: {
  seconds: number
  end?: number
  onSeek?: (seconds: number) => void
  className?: string
  showIcon?: boolean
}) {
  const label =
    end !== undefined && end > seconds
      ? `${formatTimestamp(seconds)}–${formatTimestamp(end)}`
      : formatTimestamp(seconds)

  if (!onSeek) {
    return (
      <span className={cn('text-[11px] tabular-nums text-muted-foreground', className)}>
        {label}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onSeek(seconds)
      }}
      title="Play from here"
      className={cn(
        'inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] tabular-nums text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary',
        className
      )}
    >
      {showIcon && <Play className="size-2.5 fill-current" />}
      {label}
    </button>
  )
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] text-muted-foreground">{children}</p>
}

/** A count and its bar, for shares that add up to something (talk time, sentiment). */
export function ShareBar({
  value,
  className,
}: {
  value: number
  className?: string
}) {
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}>
      <div
        className="h-full rounded-full bg-primary/70"
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </div>
  )
}

/**
 * Anything this page has no hand-written renderer for.
 *
 * The point of the page is that nothing core stored is hidden, and aggregators
 * are added without the frontend knowing — so an unrecognised shape has to
 * render as *something* readable rather than being dropped.
 */
export function JsonView({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) {
    return <span className="text-[12px] text-muted-foreground">—</span>
  }

  if (typeof value === 'string') {
    return <span className="whitespace-pre-wrap break-words text-[12px]">{value}</span>
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span className="text-[12px] tabular-nums">{String(value)}</span>
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-[12px] text-muted-foreground">empty</span>
    }

    // A flat list of scalars reads far better as chips than as numbered rows.
    if (value.every((item) => typeof item === 'string' || typeof item === 'number')) {
      return <Chips items={value.map(String)} tone="outline" />
    }

    return (
      <ol className="space-y-1.5">
        {value.map((item, index) => (
          <li key={index} className="flex gap-2">
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <JsonView value={item} depth={depth + 1} />
            </div>
          </li>
        ))}
      </ol>
    )
  }

  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) {
    return <span className="text-[12px] text-muted-foreground">empty</span>
  }

  return (
    <dl className={cn('space-y-1.5', depth > 0 && 'border-l pl-3')}>
      {entries.map(([key, item]) => (
        <div key={key} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
          <dt className="shrink-0 text-[11px] font-medium text-muted-foreground sm:w-40">
            {key.replace(/_/g, ' ')}
          </dt>
          <dd className="min-w-0 flex-1">
            <JsonView value={item} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** Collapsed raw output, so "everything" stays true without swamping the page. */
export function RawDisclosure({
  label = 'Raw output',
  value,
}: {
  label?: string
  value: unknown
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-3 border-t pt-2">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
        {label}
      </button>
      {open && (
        <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-muted/50 p-3 text-[11px] leading-relaxed">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  )
}
