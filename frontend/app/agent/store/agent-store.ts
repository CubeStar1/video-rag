import { create } from 'zustand'
import type { ArtifactState, ArtifactDisplayType, StudioState } from '../types'

export interface SetArtifactUIOptions {
  title?: string
  displayType?: ArtifactDisplayType
  identifier?: string
  content?: string
  metadata?: Record<string, unknown>
  /** The conversation opening it — see `ArtifactState.conversationId`. */
  conversationId?: string
}

interface AgentStoreState {
  // State
  artifactState: ArtifactState
  studioState: StudioState

  // Artifact actions
  handleArtifactUpdate: (artifact: Partial<ArtifactState>) => void
  setArtifactUI: (ui: React.ReactNode, options?: SetArtifactUIOptions) => void
  handleArtifactClose: () => void
  /** Reopens only if the stored artifact belongs to `conversationId`. */
  handleArtifactReopen: (conversationId?: string) => void

  // Studio actions
  setStudioOpen: (isOpen: boolean) => void
  toggleStudio: () => void
  setActiveVideo: (videoId: string | undefined) => void
  /**
   * Move the studio player to `seconds`. Callers outside the studio (chat tool
   * results) only know core's video id, so the studio resolves it to a row itself.
   */
  seekStudio: (seconds: number, coreVideoId?: string) => void
}

export const useAgentStore = create<AgentStoreState>((set) => ({
  artifactState: {
    isOpen: false,
    displayType: 'document',
  },

  studioState: {
    isOpen: true,
    activeVideoId: undefined,
    seekRequest: undefined,
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

  setArtifactUI: (ui: React.ReactNode, options: SetArtifactUIOptions = {}) => {
    set((state) => {
      // Carrying the previous title/content forward only makes sense within one
      // conversation; across a switch they belong to an artifact the user is no
      // longer looking at.
      const isSameConversation = state.artifactState.conversationId === options.conversationId
      const previous = isSameConversation ? state.artifactState : undefined

      return {
        artifactState: {
          ...state.artifactState,
          ui,
          title: options.title || previous?.title,
          displayType: options.displayType ?? 'custom',
          identifier: options.identifier || previous?.identifier,
          content: options.content || previous?.content,
          metadata: options.metadata || previous?.metadata,
          conversationId: options.conversationId,
          isOpen: true,
        },
      }
    })
  },

  handleArtifactClose: () => {
    set((state) => ({
      artifactState: {
        ...state.artifactState,
        isOpen: false,
      },
    }))
  },

  handleArtifactReopen: (conversationId?: string) => {
    set((state) => {
      if (state.artifactState.conversationId !== conversationId) return state
      return {
        artifactState: {
          ...state.artifactState,
          isOpen: true,
        },
      }
    })
  },

  setStudioOpen: (isOpen: boolean) => {
    set((state) => ({ studioState: { ...state.studioState, isOpen } }))
  },

  toggleStudio: () => {
    set((state) => ({
      studioState: { ...state.studioState, isOpen: !state.studioState.isOpen },
    }))
  },

  setActiveVideo: (videoId: string | undefined) => {
    set((state) => ({
      studioState: { ...state.studioState, activeVideoId: videoId },
    }))
  },

  seekStudio: (seconds: number, coreVideoId?: string) => {
    set((state) => ({
      studioState: {
        ...state.studioState,
        isOpen: true,
        // The nonce makes a repeat seek to the same second a distinct request.
        seekRequest: { seconds, coreVideoId, nonce: Date.now() },
      },
    }))
  },
}))
