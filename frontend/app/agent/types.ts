
import { LanguageModelUsage } from "ai";
import { UsageData } from "tokenlens/helpers";

export type AppUsage = LanguageModelUsage & UsageData & { modelId?: string };

export interface TelemetryMetadata {
  timeToFirstToken: number | null;
  tokensPerSecond: number;
  duration: number;
  usage?: {
      inputTokens: number
      outputTokens: number
      totalTokens: number
      reasoningTokens?: number | undefined
      cachedInputTokens?: number | undefined
  };
  model?: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  project_id?: string | null;
  title: string;
  updated_at: string;
  created_at: string;
  lastContext?: AppUsage;
}

export interface Message {
  id: string;
  role: string;
  parts: any[];
  created_at: string;
  metadata?: TelemetryMetadata;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description?: string | null;
  created_at: string;
  updated_at: string;
}

export type ArtifactDisplayType = 'document' | 'code' | 'markdown' | 'custom'

export interface ArtifactState {
  isOpen: boolean
  title?: string
  displayType: ArtifactDisplayType
  content?: string
  identifier?: string
  metadata?: Record<string, unknown>
  ui?: React.ReactNode // Canvas UI payload
}


export interface StudioState {
  isOpen: boolean
  /** Supabase `videos.id` of the video loaded in the persistent player. */
  activeVideoId?: string
  seekRequest?: { seconds: number; videodbVideoId?: string; nonce: number }
}


export interface ProjectHistoryItem {
  project: Project
  conversations: Conversation[]
}

