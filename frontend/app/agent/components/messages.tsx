'use client'

import { UIMessage, isStaticToolUIPart, FileUIPart } from 'ai'
import { memo } from 'react'
import {
  Message,
  MessageContent,
  MessageResponse,
  MessageAttachments,
  MessageAttachment,
  MessageActions,
  MessageAction,
} from '@/components/ai-elements/message'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { DynamicToolResult } from '@/app/agent/components/tool-displays/dynamic/dynamic-tool-result'
import { StaticToolDisplay } from '@/app/agent/components/tool-displays/static/static-tool-display'
import { ThinkingMessage } from './message'
import { CopyIcon, RefreshCcw, Zap, Clock, BrainCircuit } from 'lucide-react'
import { toast } from 'sonner'
import { TelemetryMetadata } from '../types'

import { useAgentStore } from '../store/agent-store'

interface MessagesProps {
  isLoading: boolean
  messages: UIMessage[]
  onRegenerate?: () => void
}

function PureMessages({ isLoading, messages }: MessagesProps) {
  const onArtifactReopen = useAgentStore((state) => state.handleArtifactReopen)
  return (
    <>
      {messages.map((message, index) => {
        const textContent = message.parts
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('')

        const telemetry = message.metadata as TelemetryMetadata | undefined

        return (
          <Message key={message.id || index} from={message.role === 'user' ? 'user' : 'assistant'}>
            <div className="flex flex-col gap-1">
              {message.parts?.some((part) => part.type === 'file') && (
                <MessageAttachments className="mb-2">
                  {message.parts
                    .filter((part): part is FileUIPart => part.type === 'file')
                    .map((filePart, fileIndex) => (
                      <MessageAttachment
                        key={`file-${index}-${fileIndex}`}
                        data={{
                          type: 'file',
                          url: filePart.url,
                          mediaType: filePart.mediaType,
                          filename: filePart.filename,
                        }}
                      />
                    ))}
                </MessageAttachments>
              )}
              <MessageContent>
                {message.parts?.map((part, partIndex) => {
                  if (part.type === 'text') {
                    return (
                      <MessageResponse key={`part-${index}-${partIndex}`}>
                        {part.text}
                      </MessageResponse>
                    )
                  }
                  if (part.type === 'reasoning') {
                    const isLastPart = partIndex === message.parts.length - 1
                    const isLastMessage = message.id === messages.at(-1)?.id
                    return (
                      <Reasoning
                        key={`reasoning-${index}-${partIndex}`}
                        className="w-full"
                        isStreaming={isLoading && isLastPart && isLastMessage}
                      >
                        <ReasoningTrigger />
                        <ReasoningContent>{part.text}</ReasoningContent>
                      </Reasoning>
                    )
                  }
                  if (isStaticToolUIPart(part)) {
                    return <StaticToolDisplay key={`static-${partIndex}`} part={part} />
                  }
                  // Dynamic MCP tools
                  if (part.type === 'dynamic-tool') {
                    return (
                      <DynamicToolResult
                        key={`dynamic-${partIndex}`}
                        part={part as any}
                        onOpenDocumentPanel={onArtifactReopen}
                      />
                    )
                  }
                  return null
                })}
              </MessageContent>
              {message.role === 'assistant' && textContent && (
                <MessageActions className="flex flex-row items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <MessageAction
                    onClick={() => {
                      navigator.clipboard.writeText(textContent)
                      toast.success('Copied to clipboard')
                    }}
                    label="Copy"
                  >
                    <CopyIcon className="size-3" />
                  </MessageAction>

                  {telemetry && (
                    <>
                      {telemetry.model && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground border-l pl-2 ml-1">
                          <span>{telemetry.model}</span>
                        </div>
                      )}

                      {telemetry.tokensPerSecond > 0 && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Zap className="size-3" />
                          <span>{telemetry.tokensPerSecond} tok/sec</span>
                        </div>
                      )}

                      {telemetry.usage?.totalTokens && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <BrainCircuit className="size-3" />
                          <span>{telemetry.usage.outputTokens} tokens</span>
                        </div>
                      )}
                    </>
                  )}
                </MessageActions>
              )}
            </div>
          </Message>
        )
      })}

      {isLoading && messages[messages.length - 1]?.role === 'user' && <ThinkingMessage />}
    </>
  )
}
export const Messages = memo(PureMessages)
