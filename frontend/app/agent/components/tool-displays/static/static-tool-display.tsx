'use client'

import { memo, useState } from 'react'
import { ToolUIPart, getToolName } from 'ai'
import { motion } from 'framer-motion'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  AppWindow,
  Wrench,
  BarChart3,
  Film,
  FileText,
  Library,
  MessageCircleQuestion,
  Scissors,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { ShowArtifactResult, ShowArtifactAutoOpen } from './show-artifact-result'
import { ShowClipsResult, ShowClipsAutoOpen } from './show-clips-result'
import {
  VideoAggregateResult,
  VideoAskResult,
  VideoClipResult,
  VideoListResult,
  VideoSearchResult,
  VideoTranscriptResult,
} from './video-tool-results'
import { DynamicToolResult } from '../dynamic/dynamic-tool-result'

interface StaticToolDisplayProps {
  part: ToolUIPart
}

// Static tool metadata configuration
const STATIC_TOOLS: Record<
  string,
  { displayName: string; icon: any; color: string }
> = {
  show_artifact: {
    displayName: 'Show Artifact',
    icon: AppWindow,
    color: 'text-amber-500',
  },
  show_clips: {
    displayName: 'Show Clips',
    icon: Film,
    color: 'text-rose-500',
  },
  list_project_videos: {
    displayName: 'List Videos',
    icon: Library,
    color: 'text-sky-500',
  },
  search_video_moments: {
    displayName: 'Search Moments',
    icon: Search,
    color: 'text-sky-500',
  },
  semantic_search_video: {
    displayName: 'Semantic Search',
    icon: Search,
    color: 'text-indigo-500',
  },
  ask_video: {
    displayName: 'Ask Video',
    icon: MessageCircleQuestion,
    color: 'text-emerald-500',
  },
  get_video_transcript: {
    displayName: 'Get Transcript',
    icon: FileText,
    color: 'text-teal-500',
  },
  query_video_index: {
    displayName: 'Filter Moments',
    icon: SlidersHorizontal,
    color: 'text-violet-500',
  },
  aggregate_video_index: {
    displayName: 'Count & Group',
    icon: BarChart3,
    color: 'text-violet-500',
  },
  create_video_clip: {
    displayName: 'Create Clip',
    icon: Scissors,
    color: 'text-rose-500',
  },
}

function getStaticTool(toolName: string) {
  for (const [key, value] of Object.entries(STATIC_TOOLS)) {
    if (toolName === key) return { key, ...value }
  }
  return null
}

function formatToolName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function StaticToolDisplayInternal({ part }: StaticToolDisplayProps) {
  const [isOpen, setIsOpen] = useState(false)

  const toolInvocation = part as any

  const state = toolInvocation.state || 'result'
  const isLoading = state === 'call' || state === 'input-available' || state === 'input-streaming'
  const isCompleted = state === 'result' || state === 'output-available'
  const hasError = state === 'error' || state === 'output-error'

  const rawToolName = getToolName(toolInvocation) || toolInvocation.toolName || 'tool'
  const staticTool = getStaticTool(rawToolName)
  const displayName = staticTool?.displayName || formatToolName(rawToolName)
  const IconComponent = staticTool?.icon || Wrench
  const iconColor = staticTool?.color || 'text-violet-500'

  const args = toolInvocation.args || toolInvocation.input
  const result = toolInvocation.result || toolInvocation.output

  const outputText = isCompleted ? (typeof result === 'string' ? result : JSON.stringify(result, null, 2)) : null
  const inputReady = args ? JSON.stringify(args, null, 2) : null

  // If we can't find a static tool and the user wants a layoutir tool, we just pass to DynamicToolResult 
  // since the user noted we might still receive dynamic tools here previously depending on AI setup
  if (!staticTool) {
    return <DynamicToolResult part={toolInvocation} />
  }

  const canExpand = Boolean((isCompleted) || (isLoading && inputReady))

  const renderToolResult = (toolKey: string, output: any, args: any) => {
    switch (toolKey) {
      case 'show_artifact':
        return <ShowArtifactResult args={args} state={state} />
      case 'show_clips':
        return <ShowClipsResult args={args} state={state} />
      case 'list_project_videos':
        return <VideoListResult args={args} output={output} />
      case 'search_video_moments':
      case 'semantic_search_video':
        return <VideoSearchResult args={args} output={output} />
      case 'ask_video':
        return <VideoAskResult args={args} output={output} />
      case 'get_video_transcript':
        return <VideoTranscriptResult args={args} output={output} />
      case 'query_video_index':
        return <VideoSearchResult args={args} output={output} />
      case 'aggregate_video_index':
        return <VideoAggregateResult args={args} output={output} />
      case 'create_video_clip':
        return <VideoClipResult args={args} output={output} />
      default:
        return null
    }
  }

  const renderToolHeadless = (toolKey: string, args: any) => {
    switch (toolKey) {
      case 'show_artifact':
        return <ShowArtifactAutoOpen args={args} state={state} />
      case 'show_clips':
        return <ShowClipsAutoOpen args={args} state={state} />
      default:
        return null
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="my-1"
    >
      {isCompleted && staticTool && renderToolHeadless(staticTool.key, args)}
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild disabled={!canExpand}>
          <button
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors w-full text-left',
              'bg-muted/30 hover:bg-muted/50 border border-border/50',
              !canExpand && 'cursor-default'
            )}
          >
            <IconComponent className={cn('size-3.5 flex-shrink-0', iconColor)} />

            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-muted-foreground">{displayName}</span>

              {isLoading ? (
                <Shimmer className="text-xs" duration={1.5}>
                  Running...
                </Shimmer>
              ) : hasError ? (
                <span className="text-red-500 text-xs truncate">
                  {toolInvocation.errorText || 'Error'}
                </span>
              ) : null}
            </div>

            <div className="flex-shrink-0">
              {isLoading ? (
                <motion.div
                  className={cn('size-2 rounded-full', staticTool ? iconColor.replace('text-', 'bg-') : 'bg-violet-500')}
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
              ) : hasError ? (
                <AlertCircle className="size-3.5 text-red-500" />
              ) : (
                <CheckCircle2 className="size-3.5 text-green-500" />
              )}
            </div>

            {canExpand && (
              <ChevronRight
                className={cn(
                  'size-3 text-muted-foreground transition-transform',
                  isOpen && 'rotate-90'
                )}
              />
            )}
          </button>
        </CollapsibleTrigger>

        {canExpand && (
          <CollapsibleContent>
            <div className={cn(
              'mt-1 ml-5 pl-3 border-l-2',
              staticTool ? iconColor.replace('text-', 'border-') + '/30' : 'border-violet-500/30'
            )}>
              {isLoading && inputReady && (
                <div className="py-2">
                  <div className="text-xs text-muted-foreground mb-1 font-medium">Input</div>
                  <pre className="text-xs bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                    {inputReady}
                  </pre>
                </div>
              )}
              {isCompleted && (
                <div className="py-2">
                  <div className="text-xs text-muted-foreground mb-1 font-medium">Output</div>
                  {staticTool ? (
                    <div className="bg-muted/50 rounded p-2">
                      {renderToolResult(staticTool.key, result, args)}
                    </div>
                  ) : (
                    <pre className="text-xs bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
                      {outputText}
                    </pre>
                  )}
                </div>
              )}
              {hasError && (
                <div className="py-2 text-xs text-red-500">{toolInvocation.errorText || 'Error occurred while executing the tool.'}</div>
              )}
            </div>
          </CollapsibleContent>
        )}
      </Collapsible>
    </motion.div>
  )
}

export const StaticToolDisplay = memo(StaticToolDisplayInternal)
