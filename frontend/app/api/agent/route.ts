import { showArtifactTool } from './tools/show-artifact';
import { tavilySearchTool } from './tools/tavily-search';
import { createVideoTools } from './tools/core';
import {
  streamText,
  UIMessage,
  convertToModelMessages,
  createUIMessageStream,
  JsonToSseTransformStream,
  stepCountIs,
} from 'ai';
import { createMyProvider } from '@/app/agent/lib/ai/providers/providers';
import { getUser } from '@/app/agent/hooks/get-user';
import { createSupabaseServer } from '@/lib/supabase/server';
import { saveMessages, getChatById, saveChat, generateTitleFromUserMessage } from '@/app/agent/actions';
import { getSystemPrompt, type VideoContextEntry } from '@/app/agent/lib/ai/system-prompt';

export const maxDuration = 300;


export async function POST(req: Request) {
  try {
    const user = await getUser();

    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const {
      messages,
      model='gpt-4.1-mini',
      conversationID,
      projectID,
      selectedVideoIds = [],
    }: {
      messages: UIMessage[];
      model?: string;
      conversationID?: string;
      projectID?: string;
      selectedVideoIds?: string[];
    } = await req.json();

    const userMessage = messages[messages.length - 1];

    // Create or verify conversation
    if (conversationID) {
      const chat = await getChatById(conversationID);
      if (chat) {
        if (chat.user_id !== user.id) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
        }
      } else {
        const title = await generateTitleFromUserMessage({
          message: userMessage,
          model: model || 'gpt-4.1-mini',
        });
        await saveChat({
          id: conversationID,
          userId: user.id,
          projectId: projectID,
          title,
        });
      }

      // Save user message
      await saveMessages([userMessage], conversationID);
    }

    const provider = createMyProvider();

    // The agent needs to know what exists before it can retrieve from it.
    let videos: VideoContextEntry[] = [];
    if (projectID) {
      const supabase = await createSupabaseServer();
      const { data } = await supabase
        .from('video_core')
        .select('core_video_id,title,duration,status,analyzers,aggregates,error')
        .eq('project_id', projectID)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      videos = data ?? [];
    }

    const systemPrompt = getSystemPrompt({
      projectId: projectID,
      conversationId: conversationID,
      videos,
      selectedVideoIds,
    });

    const stream = createUIMessageStream({
      execute: async ({ writer: dataStream }) => {
        const modelMessages = await convertToModelMessages(messages)
        const result = streamText({
          model: provider.languageModel(model as any),
          system: systemPrompt,
          messages: modelMessages,
          tools: {
            show_artifact: showArtifactTool,
            tavily_search: tavilySearchTool,
            ...createVideoTools({ projectId: projectID, userId: user.id }),
          },
          stopWhen: stepCountIs(15),
          onError: (error) => {
            console.error('[Agent] Stream error:', error);
          },
        });

        result.consumeStream();
        dataStream.merge(result.toUIMessageStream());
      },
      onFinish: async ({ messages: generatedMessages }) => {
        if (conversationID && generatedMessages && generatedMessages.length > 0) {
          await saveMessages(generatedMessages as any, conversationID);
        }
      },
    });

    return new Response(stream.pipeThrough(new JsonToSseTransformStream()));
  } catch (error: any) {
    console.error('[Agent] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'An unexpected error occurred.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

