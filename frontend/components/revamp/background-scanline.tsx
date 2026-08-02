'use client'

import { cn } from '@/lib/utils'
import React from 'react'

interface BackgroundScanlineProps {
  className?: string
  enableBorders?: boolean
}

export function BackgroundScanline({ className, enableBorders }: BackgroundScanlineProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0',
        enableBorders && 'border-y border-[var(--grid-line-dark)]',
        className
      )}
    >
      <div
        className="h-full w-full opacity-30"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(255, 255, 255, 0.03) 1px, rgba(255, 255, 255, 0.03) 2px)',
        }}
      />
    </div>
  )
}
