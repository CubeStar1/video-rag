'use client'

import { cn } from '@/lib/utils'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import React from 'react'

export interface SlideUpLinkProps {
  href: string
  label: string
  variant?: 'primary' | 'secondary'
  size?: 'sm' | 'md' | 'lg'
  external?: boolean
  className?: string
  rotateText?: boolean
}

const sizeStyles = {
  sm: 'px-4 py-3',
  md: 'px-6 py-5',
  lg: 'px-6 py-8 md:px-12 md:py-10',
}

export function SlideUpLink({
  href,
  label,
  variant = 'primary',
  size = 'md',
  external = false,
  className,
  rotateText = false,
}: SlideUpLinkProps) {
  const isPrimary = variant === 'primary'
  const padding = sizeStyles[size]

  return (
    <Link
      href={href}
      {...(external && { target: '_blank', rel: 'noopener noreferrer' })}
      className={cn(
        'group/link relative flex w-full items-center justify-between overflow-hidden',
        'transition-all duration-500',
        className
      )}
    >
      <div
        className={cn(
          'flex w-full items-center justify-between transition-transform duration-500 ease-[cubic-bezier(0.165,0.84,0.44,1)] group-hover/link:-translate-y-full',
          padding
        )}
      >
        <span
          className={cn(
            'font-medium transition-all duration-500',
            rotateText && 'origin-bottom-left group-hover/link:-rotate-3',
            isPrimary ? 'text-white' : 'text-neutral-400 group-hover/link:text-white'
          )}
        >
          {label}
        </span>
        <ArrowUpRight
          className={cn(
            'h-5 w-5 transition-all duration-300',
            'group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5',
            isPrimary ? 'text-white' : 'text-neutral-400 group-hover/link:text-white'
          )}
        />
      </div>

      <div
        className={cn(
          'absolute inset-0 flex w-full translate-y-[calc(100%+1px)] items-center justify-between bg-white transition-transform duration-500 ease-[cubic-bezier(0.165,0.84,0.44,1)] group-hover/link:translate-y-0',
          padding
        )}
      >
        <span
          className={cn(
            'font-medium text-black transition-transform duration-500',
            rotateText && 'origin-bottom-left rotate-3 group-hover/link:rotate-0'
          )}
        >
          {label}
        </span>
        <ArrowUpRight className="h-5 w-5 text-black" />
      </div>
    </Link>
  )
}
