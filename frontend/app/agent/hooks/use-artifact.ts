import { useAgentStore } from '../store/agent-store'
import { useConversationId } from './use-conversation-id'
import type { ReactNode } from 'react'
import type { ArtifactDisplayType } from '../types'

export function useArtifact() {
  const conversationId = useConversationId()
  const setArtifactUI = useAgentStore((state) => state.setArtifactUI)
  const closeArtifact = useAgentStore((state) => state.handleArtifactClose)
  // Open *for this conversation*. The store keeps one artifact for the whole
  // app, so an artifact belonging to another chat reads as closed here.
  const isOpen = useAgentStore(
    (state) => state.artifactState.isOpen && state.artifactState.conversationId === conversationId
  )

  const showArtifact = (
    ui: ReactNode,
    options?: {
      title?: string
      displayType?: ArtifactDisplayType
      identifier?: string
      content?: string
      metadata?: Record<string, unknown>
    }
  ) => {
    setArtifactUI(ui, { ...options, conversationId })
  }

  return {
    showArtifact,
    closeArtifact,
    isOpen,
  }
}
