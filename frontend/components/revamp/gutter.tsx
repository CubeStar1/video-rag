'use client'

import { cn } from '@/lib/utils'
import React from 'react'

interface GutterProps {
  children: React.ReactNode
  className?: string
  leftGutter?: boolean
  rightGutter?: boolean
  disableMobile?: boolean
}

export function Gutter({
  children,
  className,
  leftGutter = true,
  rightGutter = true,
  disableMobile = false,
}: GutterProps) {
  return (
    <div
      className={cn(
        leftGutter && 'pl-[var(--gutter-h,2rem)]',
        rightGutter && 'pr-[var(--gutter-h,2rem)]',
        disableMobile && 'md:px-0',
        className
      )}
    >
      {children}
    </div>
  )
}
