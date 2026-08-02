'use client'

import { useMemo, useState } from 'react'
import { Film, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { VideoCard } from './video-card'
import type { ProjectVideo } from '@/lib/videodb/types'

interface MediaGridProps {
  videos: ProjectVideo[]
  isLoading: boolean
  onDelete: (videoId: string) => void
  onReindex: (videoId: string) => void
  onPreview: (video: ProjectVideo) => void
}

export function MediaGrid({
  videos,
  isLoading,
  onDelete,
  onReindex,
  onPreview,
}: MediaGridProps) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return term ? videos.filter((video) => video.title.toLowerCase().includes(term)) : videos
  }, [videos, search])

  return (
    <section className="mt-12">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-2">
        <Tabs defaultValue="video">
          <TabsList className="bg-transparent p-0">
            <TabsTrigger
              value="video"
              className="rounded-none border-b-2 border-transparent px-3 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              Video
              {videos.length > 0 && (
                <span className="ml-1.5 text-xs text-muted-foreground">{videos.length}</span>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search files by title"
            className="h-9 pl-9 text-sm"
          />
        </div>
      </div>

      <div className="pt-6">
        {isLoading && videos.length === 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <div className="aspect-video animate-pulse rounded-xl bg-muted" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
            <div className="rounded-full bg-muted p-3">
              <Film className="size-6 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">
                {videos.length === 0 ? 'No videos yet' : 'No matches'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {videos.length === 0
                  ? 'Upload a video or paste a link to start asking questions about it.'
                  : 'Try a different search term.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((video) => (
              <VideoCard
                key={video.id}
                video={video}
                onDelete={onDelete}
                onReindex={onReindex}
                onPreview={onPreview}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
