'use client'

import { cn } from '@/lib/utils'
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import React from 'react'

interface AnnouncementPillProps {
  text: string
  href: string
  className?: string
}

export function AnnouncementPill({ text, href, className }: AnnouncementPillProps) {
  return (
    <div
      className={cn(
        'animate-fade-in-up relative inline-block w-fit overflow-hidden rounded-lg p-[1px]',
        'shadow-[0_0.25rem_1rem_-0.75rem_var(--color-success-250)]',
        'transition-shadow duration-200 ease-out',
        'hover:shadow-[0_0.25rem_1rem_var(--color-success-100)]',
        className
      )}
    >
      <div
        className={cn(
          'absolute left-0 top-0 -z-10 aspect-square w-[200%]',
          'animate-spin-slow origin-center',
          'bg-[conic-gradient(var(--color-success-150),var(--color-success-150)_70%,var(--color-success-250)_80%,var(--color-base-750))]',
          'opacity-50 transition-opacity duration-400 ease-out',
          'group-hover:opacity-100'
        )}
        style={{
          transform: 'translateY(calc(-50% + 1rem))',
        }}
      />

      <Link
        href={href}
        className={cn(
          'relative z-10 inline-flex items-center gap-2 rounded-[calc(0.5rem-1px)] px-3 py-1.5',
          'bg-emerald-950/80 text-sm text-emerald-100',
          'transition-colors duration-400 ease-out',
          'hover:text-white'
        )}
      >
        {text}
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  )
}
