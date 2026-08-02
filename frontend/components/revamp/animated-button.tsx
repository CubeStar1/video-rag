'use client'

import { cn } from '@/lib/utils'
import { ArrowUpRight, Loader2 } from 'lucide-react'
import Link from 'next/link'
import React, { useState } from 'react'

type ButtonVariant = 'default' | 'primary' | 'secondary' | 'text'
type ButtonSize = 'default' | 'large' | 'pill'

interface AnimatedButtonProps {
  label: string
  href?: string
  onClick?: () => void
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: 'arrow' | 'loading' | false
  className?: string
  fullWidth?: boolean
  disabled?: boolean
  newTab?: boolean
  hideHorizontalBorders?: boolean
  hideVerticalBorders?: boolean
}

export function AnimatedButton({
  label,
  href,
  onClick,
  variant = 'default',
  size = 'default',
  icon = 'arrow',
  className,
  fullWidth = false,
  disabled = false,
  newTab = false,
  hideHorizontalBorders = false,
  hideVerticalBorders = false,
}: AnimatedButtonProps) {
  const [isHovered, setIsHovered] = useState(false)

  const IconComponent = icon === 'arrow' ? ArrowUpRight : icon === 'loading' ? Loader2 : null

  const baseClasses = cn(
    'group relative inline-flex cursor-pointer items-center overflow-hidden transition-all duration-300',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
    disabled && 'cursor-not-allowed opacity-50',
    fullWidth && 'w-full'
  )

  const variantClasses = {
    default: cn(
      'border border-[var(--grid-line-dark)]',
      !hideHorizontalBorders && 'border-x',
      !hideVerticalBorders && 'border-y',
      hideHorizontalBorders && 'border-x-0',
      hideVerticalBorders && 'border-y-0'
    ),
    primary: 'border border-foreground/90 bg-foreground text-background',
    secondary: 'border border-foreground/50',
    text: 'border-none',
  }

  const sizeClasses = {
    default: 'text-base',
    large: 'text-lg md:text-xl',
    pill: 'rounded-md px-3 py-1 text-sm font-bold',
  }

  const content = (
    <>
      <div
        className={cn(
          'relative flex w-full items-center justify-between px-6 py-5 transition-transform duration-500 ease-out',
          variant === 'default' && 'group-hover:-translate-y-full'
        )}
      >
        <span
          className={cn(
            'font-medium transition-transform duration-500 ease-out',
            variant === 'default' && 'origin-bottom-left group-hover:-rotate-3'
          )}
        >
          {label}
        </span>
        {IconComponent && (
          <>
            <div className="w-3" />
            <IconComponent
              className={cn(
                'h-5 w-5 shrink-0 transition-transform duration-300',
                icon === 'loading' && 'animate-spin',
                icon === 'arrow' && 'group-hover:translate-x-0.5 group-hover:-translate-y-0.5'
              )}
            />
          </>
        )}
      </div>

      {variant === 'default' && (
        <div
          className={cn(
            'absolute inset-0 flex w-full translate-y-full items-center justify-between bg-foreground px-6 py-5 text-background transition-transform duration-500 ease-out',
            'group-hover:translate-y-0'
          )}
        >
          <span className="origin-bottom-left rotate-3 font-medium transition-transform duration-500 ease-out group-hover:rotate-0">
            {label}
          </span>
          {IconComponent && (
            <>
              <div className="w-3" />
              <IconComponent
                className={cn(
                  'h-5 w-5 shrink-0 transition-transform duration-300',
                  icon === 'loading' && 'animate-spin',
                  icon === 'arrow' && 'group-hover:translate-x-0.5 group-hover:-translate-y-0.5'
                )}
              />
            </>
          )}
        </div>
      )}
    </>
  )

  const combinedClasses = cn(baseClasses, variantClasses[variant], sizeClasses[size], className)

  if (href) {
    const linkProps = newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {}
    return (
      <Link
        href={href}
        className={combinedClasses}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        {...linkProps}
      >
        {content}
      </Link>
    )
  }

  return (
    <button
      type="button"
      className={combinedClasses}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {content}
    </button>
  )
}
