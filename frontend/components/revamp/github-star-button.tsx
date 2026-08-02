'use client'

import React from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'

interface GithubStats {
  stargazers_count: number
}

async function fetchGithubStats(): Promise<GithubStats> {
  const response = await fetch('https://api.github.com/repos/CubeStar1/paper-pilot')
  if (!response.ok) {
    throw new Error('Failed to fetch stats')
  }
  return response.json()
}

export function GithubStarButton() {
  const { data, isLoading } = useQuery({
    queryKey: ['github-stars'],
    queryFn: fetchGithubStats,
    staleTime: 1000 * 60 * 5,
  })

  return (
    <Link
      href="https://github.com/CubeStar1/paper-pilot"
      target="_blank"
      rel="noreferrer"
      className="group relative flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm font-medium transition-colors hover:bg-white/10 hover:border-white/20"
    >
      <div className="flex items-center gap-2 border-r border-white/10 pr-2">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-white">
          <path d="M12 2C6.47 2 2 6.47 2 12c0 4.42 2.87 8.17 7.55 9.75.5.09.68-.22.68-.48 0-.24 0-.88-.01-1.73-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.58 9.58 0 012.5-.34c.85.01 1.7.12 2.5.34 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.65.7 1.03 1.59 1.03 2.68 0 3.84-2.33 4.69-4.56 4.93.36.31.68.92.68 1.85 0 1.34-.01 2.41-.01 2.74 0 .27.18.58.69.48A10.02 10.02 0 0022 12c0-5.53-4.47-10-10-10z" />
        </svg>
        <span className="hidden sm:inline-block text-neutral-200 group-hover:text-white">
          Star us
        </span>
      </div>

      <div className="flex items-center gap-1 text-neutral-400 group-hover:text-white transition-colors">
        <Star
          className={cn(
            'h-3.5 w-3.5',
            !isLoading &&
              'fill-yellow-500 text-yellow-500 group-hover:fill-yellow-400 group-hover:text-yellow-400'
          )}
        />
        <span className="font-mono text-xs">
          {isLoading ? (
            <span className="inline-block w-4 h-3 bg-white/10 rounded animate-pulse" />
          ) : (
            (data?.stargazers_count ?? 0)
          )}
        </span>
      </div>
    </Link>
  )
}
