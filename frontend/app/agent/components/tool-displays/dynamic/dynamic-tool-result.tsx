'use client'

import { memo, useState } from 'react'
import { DynamicToolUIPart, getToolName } from 'ai'
import { motion } from 'framer-motion'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { CheckCircle2, AlertCircle, ChevronRight, Plug } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Shimmer } from '@/components/ai-elements/shimmer'

interface DynamicToolResultProps {
  part: DynamicToolUIPart
  onOpenDocumentPanel?: (irJson?: string) => void
}

function formatToolName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function DynamicToolResultInternal({ part }: DynamicToolResultProps) {
  const [isOpen, setIsOpen] = useState(false)

  const isLoading = part.state === 'input-available' || part.state === 'input-streaming'
  const isCompleted = part.state === 'output-available'
  const hasError = part.state === 'output-error'

  const displayName = formatToolName(getToolName(part))

  const getTextContent = (output: any): string | null => {
    if (!output) return null

    let data = output
    if (typeof output === 'string') {
      try {
        data = JSON.parse(output)
      } catch {
        return output
      }
    }

    if (data?.content && Array.isArray(data.content)) {
      const textParts = data.content
        .filter((item: any) => item.type === 'text' && item.text)
        .map((item: any) => item.text)
      if (textParts.length > 0) {
        return textParts.join('\n')
      }
    }

    return typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  }

  const outputText = isCompleted ? getTextContent(part.output) : null

  const canExpand = Boolean((isCompleted && outputText) || (isLoading && part.input))

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="my-1"
    >
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild disabled={!canExpand}>
          <button
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors w-full text-left',
              'bg-muted/30 hover:bg-muted/50 border border-border/50',
              !canExpand && 'cursor-default'
            )}
          >
            <Plug className="size-3.5 flex-shrink-0 text-violet-500" />

            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-muted-foreground">{displayName}</span>

              {isLoading ? (
                <Shimmer className="text-xs" duration={1.5}>
                  Running...
                </Shimmer>
              ) : hasError ? (
                <span className="text-red-500 text-xs truncate">
                  {(part as any).errorText || 'Error'}
                </span>
              ) : null}
            </div>

            <div className="flex-shrink-0">
              {isLoading ? (
                <motion.div
                  className="size-2 rounded-full bg-violet-500"
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
            <div className="mt-1 ml-5 pl-3 border-l-2 border-violet-500/30">
              {isLoading && part.input && (
                <div className="py-2">
                  <div className="text-xs text-muted-foreground mb-1 font-medium">Input</div>
                  <pre className="text-xs bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(part.input, null, 2)}
                  </pre>
                </div>
              )}
              {isCompleted && outputText && (
                <div className="py-2">
                  <div className="text-xs text-muted-foreground mb-1 font-medium">Output</div>
                  <pre className="text-xs bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
                    {outputText}
                  </pre>
                </div>
              )}
              {hasError && (part as any).errorText && (
                <div className="py-2 text-xs text-red-500">{(part as any).errorText}</div>
              )}
            </div>
          </CollapsibleContent>
        )}
      </Collapsible>
    </motion.div>
  )
}

export const DynamicToolResult = memo(DynamicToolResultInternal)
