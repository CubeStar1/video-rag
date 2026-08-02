import { createListProjectVideosTool } from './list-project-videos'
import { searchVideoMomentsTool } from './search-video-moments'
import { askVideoTool } from './ask-video'
import { getVideoTranscriptTool } from './get-video-transcript'
import { semanticSearchVideoTool } from './semantic-search-video'
import { queryVideoIndexTool } from './query-video-index'
import { aggregateVideoIndexTool } from './aggregate-video-index'
import { createVideoClipTool } from './create-video-clip'
import { showClipsTool } from './show-clips'

export interface VideoToolContext {
  projectId?: string
  userId: string
}

/** Every VideoDB tool, bound to the caller's project scope. */
export function createVideoTools(context: VideoToolContext) {
  return {
    list_project_videos: createListProjectVideosTool(context),
    search_video_moments: searchVideoMomentsTool,
    ask_video: askVideoTool,
    get_video_transcript: getVideoTranscriptTool,
    semantic_search_video: semanticSearchVideoTool,
    query_video_index: queryVideoIndexTool,
    aggregate_video_index: aggregateVideoIndexTool,
    create_video_clip: createVideoClipTool,
    show_clips: showClipsTool,
  }
}

export const VIDEO_TOOL_NAMES = [
  'list_project_videos',
  'search_video_moments',
  'ask_video',
  'get_video_transcript',
  'semantic_search_video',
  'query_video_index',
  'aggregate_video_index',
  'create_video_clip',
  'show_clips',
] as const
