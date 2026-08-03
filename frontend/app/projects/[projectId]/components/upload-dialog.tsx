'use client'

import { useCallback, useRef, useState } from 'react'
import {
  CheckCircle2,
  FileUp,
  Link2,
  Loader2,
  Plus,
  Scissors,
  Timer,
  X,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { uploadProjectVideo } from '@/lib/supabase/upload-project-video'
import {
  normalizeSegmentation,
  SEGMENTATION_DEFAULTS,
  SEGMENTATION_LIMITS,
  SEGMENTATION_OPTIONS,
} from '@/lib/videodb/segmentation'
import type { SegmentationConfig } from '@/lib/videodb/types'

type JobState = 'uploading' | 'registering' | 'done' | 'error'

interface Job {
  id: string
  label: string
  state: JobState
  message?: string
}

interface UploadDialogProps {
  projectId: string
  projectName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onComplete: () => void
}

export function UploadDialog({
  projectId,
  projectName,
  open,
  onOpenChange,
  onComplete,
}: UploadDialogProps) {
  const [files, setFiles] = useState<File[]>([])
  const [urls, setUrls] = useState<string[]>([''])
  const [jobs, setJobs] = useState<Job[]>([])
  const [isWorking, setIsWorking] = useState(false)
  const [tab, setTab] = useState('upload')
  const [isDragging, setIsDragging] = useState(false)
  // Every key is kept even when its type is inactive, so toggling between shot and
  // time doesn't lose the numbers the user already dialled in.
  const [segmentation, setSegmentation] = useState({ ...SEGMENTATION_DEFAULTS })
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setFiles([])
    setUrls([''])
    setJobs([])
    setTab('upload')
    setSegmentation({ ...SEGMENTATION_DEFAULTS })
  }

  const updateJob = (id: string, patch: Partial<Job>) => {
    setJobs((current) => current.map((job) => (job.id === id ? { ...job, ...patch } : job)))
  }

  const registerVideo = async (body: {
    title: string
    sourceUrl: string
    storagePath?: string
    sourceType: 'upload' | 'url'
    segmentation: SegmentationConfig
  }) => {
    const response = await fetch('/api/videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, ...body }),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(text || 'Failed to register video')
    }
    return response.json()
  }

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    setIsDragging(false)
    const dropped = Array.from(event.dataTransfer.files).filter((file) =>
      file.type.startsWith('video/')
    )
    if (dropped.length === 0) {
      toast.error('Only video files are supported')
      return
    }
    setFiles((current) => [...current, ...dropped])
  }, [])

  const handleSubmit = async () => {
    const validUrls = urls.map((url) => url.trim()).filter(Boolean)
    if (files.length === 0 && validUrls.length === 0) {
      toast.error('Add at least one file or URL')
      return
    }

    setIsWorking(true)
    setTab('progress')

    const initialJobs: Job[] = [
      ...files.map((file) => ({
        id: `file-${file.name}-${file.size}`,
        label: file.name,
        state: 'uploading' as JobState,
      })),
      ...validUrls.map((url) => ({
        id: `url-${url}`,
        label: url,
        state: 'registering' as JobState,
      })),
    ]
    setJobs(initialJobs)

    // Drops the keys that don't apply to the chosen type and clamps the rest.
    const segmentationConfig = normalizeSegmentation(segmentation)

    let succeeded = 0

    for (const file of files) {
      const id = `file-${file.name}-${file.size}`
      try {
        const uploaded = await uploadProjectVideo(projectId, file)
        updateJob(id, { state: 'registering', message: 'Sending to VideoDB…' })
        await registerVideo({
          title: uploaded.title,
          sourceUrl: uploaded.publicUrl,
          storagePath: uploaded.storagePath,
          sourceType: 'upload',
          segmentation: segmentationConfig,
        })
        updateJob(id, { state: 'done', message: 'Indexing started' })
        succeeded += 1
      } catch (error: any) {
        updateJob(id, { state: 'error', message: error.message })
      }
    }

    for (const url of validUrls) {
      const id = `url-${url}`
      try {
        await registerVideo({
          title: deriveTitle(url),
          sourceUrl: url,
          sourceType: 'url',
          segmentation: segmentationConfig,
        })
        updateJob(id, { state: 'done', message: 'Indexing started' })
        succeeded += 1
      } catch (error: any) {
        updateJob(id, { state: 'error', message: error.message })
      }
    }

    setIsWorking(false)
    onComplete()

    if (succeeded > 0) {
      toast.success(
        `${succeeded} video${succeeded === 1 ? '' : 's'} added — indexing runs in the background`
      )
      setFiles([])
      setUrls([''])
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && isWorking) return
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload files</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="upload">Upload</TabsTrigger>
            <TabsTrigger value="progress">
              In Progress{jobs.length ? ` (${jobs.length})` : ''}
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="upload"
            className="max-h-[65vh] space-y-5 overflow-y-auto pt-4 pr-1"
          >
            <div
              onDragOver={(event) => {
                event.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-9 text-center transition-colors',
                isDragging ? 'border-primary bg-primary/5' : 'hover:border-muted-foreground/40'
              )}
            >
              <div className="rounded-full border bg-background p-2.5 shadow-sm">
                <FileUp className="size-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">Select a file or drag and drop here</p>
              <p className="text-xs text-muted-foreground">
                Video files. Large files may exceed the storage limit — use a URL instead.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  setFiles((current) => [...current, ...Array.from(event.target.files ?? [])])
                  event.target.value = ''
                }}
              />
            </div>

            {files.length > 0 && (
              <ul className="space-y-1.5">
                {files.map((file, index) => (
                  <li
                    key={`${file.name}-${index}`}
                    className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {(file.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                    <button
                      type="button"
                      onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="space-y-2">
              <div>
                <p className="text-sm font-medium">Or add file URLs</p>
                <p className="text-xs text-muted-foreground">
                  Direct video links or YouTube URLs — ingested by VideoDB directly.
                </p>
              </div>
              {urls.map((url, index) => (
                <div key={index} className="relative">
                  <Link2 className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={url}
                    placeholder="Paste file URL"
                    className="pl-9 pr-9"
                    onChange={(event) =>
                      setUrls((current) =>
                        current.map((item, i) => (i === index ? event.target.value : item))
                      )
                    }
                  />
                  {urls.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setUrls((current) => current.filter((_, i) => i !== index))}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setUrls((current) => [...current, ''])}
              >
                <Plus className="size-4" />
                Add another URL
              </Button>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">How should we split these videos?</p>
                <p className="text-xs text-muted-foreground">
                  Scenes are the time ranges the visual analyzer describes and indexes.
                  Match this to the footage you&apos;re adding.
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {SEGMENTATION_OPTIONS.map((option) => {
                  const Icon = option.type === 'time' ? Timer : Scissors
                  const isActive = segmentation.type === option.type
                  return (
                    <button
                      key={option.type}
                      type="button"
                      onClick={() =>
                        setSegmentation((current) => ({ ...current, type: option.type }))
                      }
                      className={cn(
                        'rounded-lg border p-3 text-left transition-colors',
                        isActive
                          ? 'border-primary bg-primary/5'
                          : 'hover:border-muted-foreground/40'
                      )}
                    >
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <Icon
                          className={cn(
                            'size-4',
                            isActive ? 'text-primary' : 'text-muted-foreground'
                          )}
                        />
                        {option.label}
                      </span>
                      <span className="mt-1.5 block text-xs text-muted-foreground">
                        {option.hint}
                      </span>
                      <span className="mt-1 block text-[11px] leading-snug text-muted-foreground/70">
                        {option.bestFor}
                      </span>
                    </button>
                  )
                })}
              </div>

              <div className="space-y-4 rounded-lg border bg-muted/20 px-3 py-3">
                {segmentation.type === 'time' ? (
                  <SettingSlider
                    label="Scene length"
                    hint="Shorter scenes give finer search results but cost more to analyze."
                    value={segmentation.seconds}
                    format={(value) => `${value}s`}
                    {...SEGMENTATION_LIMITS.seconds}
                    onChange={(seconds) =>
                      setSegmentation((current) => ({ ...current, seconds }))
                    }
                  />
                ) : (
                  <>
                    <SettingSlider
                      label="Cut sensitivity"
                      hint="Higher values detect fewer cuts, so scenes come out longer."
                      value={segmentation.threshold}
                      {...SEGMENTATION_LIMITS.threshold}
                      onChange={(threshold) =>
                        setSegmentation((current) => ({ ...current, threshold }))
                      }
                    />
                    <SettingSlider
                      label="Minimum scene length"
                      hint="Keeps quick cuts from each becoming their own scene."
                      value={segmentation.min_scene_len}
                      format={(value) => `${value}s`}
                      {...SEGMENTATION_LIMITS.min_scene_len}
                      onChange={(min_scene_len) =>
                        setSegmentation((current) => ({ ...current, min_scene_len }))
                      }
                    />
                  </>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Add files to</p>
              <Input value={projectName} readOnly className="bg-muted/40" />
            </div>
          </TabsContent>

          <TabsContent value="progress" className="pt-4">
            {jobs.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nothing in progress yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {jobs.map((job) => (
                  <li
                    key={job.id}
                    className="flex items-center gap-3 rounded-md border px-3 py-2.5 text-sm"
                  >
                    {job.state === 'done' ? (
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                    ) : job.state === 'error' ? (
                      <XCircle className="size-4 shrink-0 text-red-500" />
                    ) : (
                      <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{job.label}</p>
                      {job.message && (
                        <p
                          className={cn(
                            'truncate text-xs',
                            job.state === 'error' ? 'text-red-500' : 'text-muted-foreground'
                          )}
                        >
                          {job.message}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isWorking}
          >
            {jobs.some((job) => job.state === 'done') ? 'Close' : 'Cancel'}
          </Button>
          <Button onClick={handleSubmit} disabled={isWorking}>
            {isWorking ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Uploading…
              </>
            ) : (
              'Upload'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SettingSlider({
  label,
  hint,
  value,
  min,
  max,
  onChange,
  format = String,
}: {
  label: string
  hint: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  format?: (value: number) => string
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs font-medium tabular-nums text-muted-foreground">
          {format(value)}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={1}
        onValueChange={([next]) => onChange(next)}
      />
      <p className="text-[11px] leading-snug text-muted-foreground/70">{hint}</p>
    </div>
  )
}

function deriveTitle(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.hostname.includes('youtu')) {
      return `YouTube — ${parsed.searchParams.get('v') || parsed.pathname.replace('/', '')}`
    }
    const name = parsed.pathname.split('/').filter(Boolean).pop()
    return name ? decodeURIComponent(name.replace(/\.[^.]+$/, '')) : parsed.hostname
  } catch {
    return 'Video from URL'
  }
}
