import { streamText, UIMessage, smoothStream, stepCountIs, convertToModelMessages, createUIMessageStream, JsonToSseTransformStream } from 'ai';
import { createSupabaseServer } from '@/lib/supabase/server';
import { fetchModels, getUsage, type ModelCatalog } from "tokenlens";
import { cache } from 'react';
import { getUser } from '@/app/agent/hooks/get-user';


export const maxDuration = 30;

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new Response('Missing id', { status: 400 });
  }

  const user = await getUser();
  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = await createSupabaseServer();
  const { error } = await supabase
    .from('conversations')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) {
    return new Response(error.message, { status: 500 });
  }

  return new Response('Deleted', { status: 200 });
}

export async function PATCH(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new Response('Missing id', { status: 400 });
  }

  const user = await getUser();
  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { title } = await request.json();

  const supabase = await createSupabaseServer();
  const { error } = await supabase
    .from('conversations')
    .update({ title })
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) {
    return new Response(error.message, { status: 500 });
  }

  return new Response('Updated', { status: 200 });
}
