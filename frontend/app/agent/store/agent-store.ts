import { create } from 'zustand'
import type { ArtifactState, ArtifactDisplayType, StudioState } from '../types'

interface AgentStoreState {
  // State
  artifactState: ArtifactState
  studioState: StudioState

  // Artifact actions
  handleArtifactUpdate: (artifact: Partial<ArtifactState>) => void
  setArtifactUI: (ui: React.ReactNode, title?: string, displayType?: ArtifactDisplayType, identifier?: string, content?: string, metadata?: Record<string, unknown>) => void
  handleArtifactClose: () => void
  handleArtifactReopen: () => void

  // Studio actions
  setStudioOpen: (isOpen: boolean) => void
  toggleStudio: () => void
  setActiveVideo: (videoId: string | undefined) => void
  /**
   * Move the studio player to `seconds`. Callers outside the studio (chat tool
   * results) only know the VideoDB id, so the studio resolves it to a row itself.
   */
  seekStudio: (seconds: number, videodbVideoId?: string) => void
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

  seekStudio: (seconds: number, videodbVideoId?: string) => {
    set((state) => ({
      studioState: {
        ...state.studioState,
        isOpen: true,
        // The nonce makes a repeat seek to the same second a distinct request.
        seekRequest: { seconds, videodbVideoId, nonce: Date.now() },
      },
    }))
  },
}))
