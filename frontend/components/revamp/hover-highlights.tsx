'use client'

import { cn } from '@/lib/utils'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import React, { useState, useCallback, memo } from 'react'
import { BackgroundGrid } from './background-grid'
import { BackgroundScanline } from './background-scanline'
import { Gutter } from './gutter'

interface Highlight {
  text: string
  description: string
  href?: string
  image: string
}

const highlights: Highlight[] = [
  {
    text: 'Conversational Agent',
    description: 'Interact with an intelligent assistant to build complex workflows simply by describing your needs.',
    image: '/landing/rpa-dashboard.png',
  },
  {
    text: 'Live Visualization',
    description: 'Monitor pipeline stages dynamically with an interactive event graph in real-time.',
    image: '/landing/rpa-dashboard.png',
  },
  {
    text: 'UiPath & LlamaIndex',
    description: 'Powered by robust RPA integration to autonomously orchestrate tasks and process inputs.',
    image: '/landing/rpa-dashboard.png',
  },
  {
    text: 'Automated PRs',
    description: 'AI generates the YAML files, validates them, and automatically opens Pull Requests on your repository.',
    image: '/landing/rpa-dashboard.png',
  },
]

interface HighlightItemProps {
  highlight: Highlight
  index: number
  isLast: boolean
  isActive: boolean
  isExpanded: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
  onToggle: () => void
}

const HighlightItem = memo(function HighlightItem({
  highlight,
  index,
  isLast,
  isActive,
  isExpanded,
  onMouseEnter,
  onMouseLeave,
  onToggle,
}: HighlightItemProps) {
  const Wrapper = highlight.href ? Link : 'div'

  return (
    <div
      className={cn(
        'group flex flex-col border-t border-neutral-800 transition-colors duration-300',
        isLast && 'border-b',
        isExpanded ? 'text-white md:text-neutral-600' : 'text-neutral-600',
        isActive ? 'md:text-white' : 'md:hover:text-white'
      )}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <Wrapper
        href={highlight.href || '#'}
        className={cn(
          'flex w-full items-center justify-between py-6',
          !highlight.href && 'cursor-pointer'
        )}
        onClick={(e) => {
          if (!highlight.href) {
            e.preventDefault()
            onToggle()
          }
        }}
      >
        <h3 className="text-2xl font-semibold tracking-tight transition-colors duration-300 md:text-3xl lg:text-4xl xl:text-5xl">
          {highlight.text}
        </h3>
        <div className="flex items-center gap-2">
          <ArrowUpRight
            className={cn(
              'h-6 w-6 transition-transform duration-300 md:hidden',
              isExpanded ? 'rotate-90 opacity-100' : 'opacity-50'
            )}
          />
          <ArrowUpRight
            className={cn(
              'hidden md:block h-6 w-6 transition-all duration-300 lg:h-8 lg:w-8',
              isActive
                ? 'translate-x-0 opacity-50'
                : '-translate-x-2 opacity-0 group-hover:translate-x-0 group-hover:opacity-50'
            )}
          />
        </div>
      </Wrapper>

      <div
        className={cn(
          'grid transition-all duration-300 ease-out md:hidden',
          isExpanded ? 'grid-rows-[1fr] opacity-100 pb-6' : 'grid-rows-[0fr] opacity-0'
        )}
      >
        <div className="overflow-hidden">
          <div className="relative z-10 bg-neutral-900 rounded-lg overflow-hidden border border-white/5 mb-4">
            <Image
              src={highlight.image}
              alt={highlight.text}
              width={1200}
              height={800}
              className="w-full h-auto object-cover"
              loading="lazy"
            />
          </div>
          <p className="text-base text-neutral-400">{highlight.description}</p>
        </div>
      </div>
    </div>
  )
})

export function HoverHighlights() {
  const [activeIndex, setActiveIndex] = useState(0)
  const [expandedSet, setExpandedSet] = useState<Set<number>>(
    () => new Set(highlights.map((_, i) => i))
  )

  const toggleExpand = useCallback((index: number) => {
    setExpandedSet((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }, [])

  const handleMouseEnter = useCallback((index: number) => {
    setActiveIndex(index)
  }, [])

  const handleMouseLeave = useCallback(() => {}, [])

  return (
    <section className="relative z-[1] min-h-[80vh] overflow-hidden bg-black/90 py-24 md:py-32">
      <BackgroundGrid zIndex={0} />
      <BackgroundScanline className="right-0 w-[calc(var(--gutter-h,96px)+33%)]" />

      <Gutter>
        <div className="grid gap-12 md:grid-cols-2 md:gap-16">
          <div className="flex flex-col justify-center gap-6">
            <div className="flex flex-col gap-6">
              <h2 className="mb-4 text-3xl font-bold tracking-tight text-white md:text-4xl lg:text-5xl">
                Intelligent CI/CD Orchestration
              </h2>
              <p className="text-lg text-neutral-400">
                Everything you need to automate your GitHub Actions workflows
              </p>
            </div>

            <div className="flex flex-col">
              {highlights.map((highlight, index) => (
                <HighlightItem
                  key={index}
                  highlight={highlight}
                  index={index}
                  isLast={index === highlights.length - 1}
                  isActive={activeIndex === index}
                  isExpanded={expandedSet.has(index)}
                  onMouseEnter={() => handleMouseEnter(index)}
                  onMouseLeave={handleMouseLeave}
                  onToggle={() => toggleExpand(index)}
                />
              ))}
            </div>
          </div>

          <div className="relative hidden items-center justify-center md:flex">
            <div className="relative h-[600px] w-full flex items-center justify-center">
              {highlights.map((highlight, index) => (
                <div
                  key={index}
                  className={cn(
                    'absolute left-0 w-full rounded-xl border border-white/10 bg-white/5 p-2',
                    'shadow-2xl transition-all duration-500 ease-out',
                    index === activeIndex
                      ? 'opacity-100 translate-y-0 z-10'
                      : 'opacity-0 translate-y-5 z-0 pointer-events-none'
                  )}
                  aria-hidden={index !== activeIndex}
                >
                  <div className="bg-neutral-900/50 rounded-lg overflow-hidden border border-white/5">
                    <Image
                      src={highlight.image}
                      alt={highlight.text}
                      width={1200}
                      height={800}
                      className="w-full h-auto object-cover"
                      priority={index === 0}
                      loading={index === 0 ? 'eager' : 'lazy'}
                    />
                  </div>
                  <div className="mt-4 px-2 pb-2">
                    <p className="text-lg font-medium text-neutral-200">{highlight.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Gutter>
    </section>
  )
}
