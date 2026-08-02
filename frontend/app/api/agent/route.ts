import { getMCPTools } from '@/lib/ai/mcp/mcp-client';
import { showArtifactTool } from './tools/show-artifact';
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
import { saveMessages, getChatById, saveChat, generateTitleFromUserMessage } from '@/app/agent/actions';
import { getSystemPrompt } from '@/app/agent/lib/ai/system-prompt';

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
    }: {
      messages: UIMessage[];
      model?: string;
      conversationID?: string;
      projectID?: string;
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
    console.log("Model:", model);

    // Build system prompt with frontend conversation context
    const systemPrompt = getSystemPrompt({
      projectId: projectID,
      conversationId: conversationID,
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
            // ...mcpTools,
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

