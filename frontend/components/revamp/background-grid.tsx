'use client'

import { cn } from '@/lib/utils'
import React from 'react'

interface GridLineStyles {
  [index: number]: React.CSSProperties
}

interface BackgroundGridProps {
  className?: string
  gridLineStyles?: GridLineStyles
  ignoreGutter?: boolean
  style?: React.CSSProperties
  wideGrid?: boolean
  zIndex?: number
}

export function BackgroundGrid({
  className,
  gridLineStyles = {},
  ignoreGutter = false,
  style,
  wideGrid = false,
  zIndex = -1,
}: BackgroundGridProps) {
  const numColumns = wideGrid ? 4 : 5

  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute top-0 h-full select-none',
        'grid grid-cols-16',
        'md:grid-cols-16',
        className
      )}
      style={{
        ...style,
        zIndex,
        left: ignoreGutter ? 0 : 'var(--gutter-h, 2rem)',
        width: ignoreGutter ? '100%' : 'calc(100% - var(--gutter-h, 2rem) * 2)',
      }}
    >
      {[...Array(numColumns)].map((_, index) => {
        const gridAreas = wideGrid
          ? ['1/1/1/1', '1/4/1/9', '1/14/1/17', '1/17/1/17']
          : ['1/1/1/1', '1/5/1/9', '1/9/1/13', '1/13/1/17', '1/17/1/17']

        return (
          <div
            key={index}
            className={cn(
              'h-full w-[1px]',
              'bg-[var(--grid-line-dark,rgba(255,255,255,0.08))]',
              index === 2 && 'hidden lg:block',
              index === 3 && 'hidden lg:block'
            )}
            style={{
              gridArea: gridAreas[index],
              ...gridLineStyles[index],
            }}
          />
        )
      })}
    </div>
  )
}
