import { createListProjectVideosTool } from './list-project-videos'
import { createSearchMomentsTool } from './search-moments'
import { createAskVideoTool } from './ask-video'
import { createReadChunksTool } from './read-chunks'
import { createGetVideoTranscriptTool } from './get-video-transcript'
import { createGetVideoInsightsTool } from './get-video-insights'
import { createGetVideoEntitiesTool } from './get-video-entities'
import { createAddVideoTool } from './add-video'
import { showClipsTool } from './show-clips'
import type { VideoToolContext } from './scope'

export type { VideoToolContext } from './scope'

/**
 * Every video tool, bound to the caller's project scope.
 *
 * All but `show_clips` take the context, because core enforces no scoping of its
 * own — the binding here is what stops a tool from reaching a video the caller
 * does not own.
 */
export function createVideoTools(context: VideoToolContext) {
  return {
    list_project_videos: createListProjectVideosTool(context),
    search_moments: createSearchMomentsTool(context),
    ask_video: createAskVideoTool(context),
    read_chunks: createReadChunksTool(context),
    get_video_transcript: createGetVideoTranscriptTool(context),
    get_video_insights: createGetVideoInsightsTool(context),
    get_video_entities: createGetVideoEntitiesTool(context),
    add_video: createAddVideoTool(context),
    show_clips: showClipsTool,
  }
}

export const VIDEO_TOOL_NAMES = [
  'list_project_videos',
  'search_moments',
  'ask_video',
  'read_chunks',
  'get_video_transcript',
  'get_video_insights',
  'get_video_entities',
  'add_video',
  'show_clips',
] as const
