'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { X, Maximize2, Minimize2, Copy, Check, FileCode, FileText, Layout } from 'lucide-react'
import { useState } from 'react'
import { useAgentStore } from '../store/agent-store'
import { MessageResponse } from '@/components/ai-elements/message'
import { CodeBlock } from '@/components/ai-elements/code-block'

export function ArtifactPanel() {
  const [isExpanded, setIsExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const artifact = useAgentStore((state) => state.artifactState)
  const onClose = useAgentStore((state) => state.handleArtifactClose)

  const handleCopy = () => {
    if (artifact.content) {
      navigator.clipboard.writeText(artifact.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const getIcon = () => {
    switch (artifact.displayType) {
      case 'code':
        return <FileCode className="size-4" />
      case 'markdown':
        return <FileText className="size-4" />
      default:
        return <Layout className="size-4" />
    }
  }

  return (
    <AnimatePresence mode="wait">
      {artifact.isOpen && (
        <motion.div
          layout
          initial={{ opacity: 0, x: 40, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 40, scale: 0.98 }}
          transition={{
            layout: {
              type: 'spring',
              stiffness: 250,
              damping: 28,
              mass: 0.8,
            },
            opacity: { duration: 0.2 },
          }}
          className={`flex h-full flex-col overflow-hidden bg-background shadow-lg border-l ${
            isExpanded 
              ? 'fixed inset-4 z-[100] rounded-xl border shadow-2xl' 
              : 'relative z-10'
          }`}
        >
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[-1] bg-background/40 backdrop-blur-md"
              onClick={() => setIsExpanded(false)}
            />
          )}
          {/* Header */}
          <div className="flex items-center justify-between border-b px-4 py-3 shrink-0 bg-muted/30">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex items-center justify-center size-8 rounded-lg bg-background border shadow-sm text-foreground/70">
                {getIcon()}
              </div>
              <div className="flex flex-col min-w-0">
                <motion.span
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-sm font-semibold truncate leading-tight"
                >
                  {artifact.title || 'Artifact'}
                </motion.span>
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider"
                >
                  {artifact.displayType}
                </motion.span>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={handleCopy}
                disabled={!artifact.content}
                className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-all active:scale-95 disabled:opacity-50"
                title="Copy content"
              >
                {copied ? (
                  <Check className="size-4 text-emerald-500" />
                ) : (
                  <Copy className="size-4" />
                )}
              </button>
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-all active:scale-95"
                title={isExpanded ? 'Minimize' : 'Maximize'}
              >
                {isExpanded ? (
                  <Minimize2 className="size-4" />
                ) : (
                  <Maximize2 className="size-4" />
                )}
              </button>
              <button
                onClick={onClose}
                className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-all active:scale-95"
                title="Close artifact"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {/* Content */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
            className="flex-1 overflow-hidden"
          >
            {/* The key prop ensures React completely unmounts and remounts the UI when a new one is passed */}
            <div key={artifact.identifier || Date.now()} className="h-full w-full">
              {artifact.displayType === 'markdown' ? (
                <div className="overflow-auto h-full p-6">
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <MessageResponse>{artifact.content || ''}</MessageResponse>
                  </div>
                </div>
              ) : artifact.displayType === 'code' ? (
                <div className="overflow-auto h-full p-6">
                  <CodeBlock code={artifact.content || ''} language="typescript" />
                </div>
              ) : (
                artifact.ui
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
