import { create } from 'zustand'
import { UIMessage } from 'ai'
import type { ArtifactState, ArtifactDisplayType } from '../types'

interface AgentStoreState {
  // State
  artifactState: ArtifactState

  // Actions
  handleArtifactUpdate: (artifact: Partial<ArtifactState>) => void
  setArtifactUI: (ui: React.ReactNode, title?: string, displayType?: ArtifactDisplayType, identifier?: string, content?: string, metadata?: Record<string, unknown>) => void
  handleArtifactClose: () => void
  handleArtifactReopen: () => void
}

export const useAgentStore = create<AgentStoreState>((set) => ({
  artifactState: {
    isOpen: false,
    displayType: 'document',
  },

  handleArtifactUpdate: (artifact: Partial<ArtifactState>) => {
    set((state) => ({
      artifactState: {
        ...state.artifactState,
        ...artifact,
        isOpen: true,
      },
    }))
  },

  setArtifactUI: (ui: React.ReactNode, title?: string, displayType: ArtifactDisplayType = 'custom', identifier?: string, content?: string, metadata?: Record<string, unknown>) => {
    set((state) => ({
      artifactState: {
        ...state.artifactState,
        ui,
        title: title || state.artifactState.title,
        displayType,
        identifier: identifier || state.artifactState.identifier,
        content: content || state.artifactState.content,
        metadata: metadata || state.artifactState.metadata,
        isOpen: true,
      }
    }))
  },

  handleArtifactClose: () => {
    set((state) => ({
      artifactState: {
        ...state.artifactState,
        isOpen: false,
      },
    }))
  },

  handleArtifactReopen: () => {
    set((state) => {
      const updates: Partial<AgentStoreState> = {
        artifactState: {
          ...state.artifactState,
          isOpen: true,
        },
      }
      return updates
    })
  },
}))
