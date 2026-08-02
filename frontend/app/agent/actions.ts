'use server'

import { createSupabaseServer } from '@/lib/supabase/server'
import { type UIMessage } from 'ai'
import { generateText } from 'ai'
import { myProvider } from '@/app/agent/lib/ai/providers/providers'

import { AppUsage } from './types'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value: string | undefined): value is string {
  return Boolean(value && UUID_PATTERN.test(value))
}

export async function getChatById(id: string) {
  const supabase = await createSupabaseServer()
  const { data } = await supabase.from('conversations').select('*').eq('id', id).single()
  return data
}

export async function saveChat(chat: { id: string, userId: string, title: string, projectId?: string }) {
  const supabase = await createSupabaseServer()
  const { error } = await supabase.from('conversations').insert({
    id: chat.id,
    user_id: chat.userId,
    project_id: chat.projectId ?? null,
    title: chat.title,
  })
  if (error) {
    console.error('Error creating conversation:', error);
    throw error;
  }
}

export async function saveMessages(messages: UIMessage[], conversationId: string) {
  const supabase = await createSupabaseServer()

  const messagesToInsert = messages.map((message) => ({
    ...(isUuid(message.id) ? { id: message.id } : {}),
    conversation_id: conversationId,
    role: message.role,
    parts: message.parts,
    metadata: {
      ...((message as any).metadata || {}),
      ui_message_id: message.id,
    },
  }))

  const { data, error } = await supabase.from('messages').insert(messagesToInsert).select('id')

  if (error) {
    console.error('Error saving messages:', error)
    throw new Error('Could not save messages')
  }

  return data || []
}

export async function generateTitleFromUserMessage({
  message,
  model
}: {
  message: UIMessage;
  model: string;
}) {
  const { text: title } = await generateText({
    model: myProvider.languageModel(model),
    system: `\n
    - you will generate a short title based on the first message a user begins a conversation with
    - ensure it is not more than 80 characters long
    - the title should be a summary of the user's message
    - do not use quotes or colons`,
    prompt: JSON.stringify(message),
  });

  return title;
}

export async function updateChatUsage(chatId: string, usage: AppUsage) {
  const supabase = await createSupabaseServer()
  const { error } = await supabase
    .from('conversations')
    .update({ lastContext: usage })
    .eq('id', chatId)

  if (error) {
    console.error('Error updating chat usage:', error)
  }
}
