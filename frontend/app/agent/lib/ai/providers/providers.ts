import {
  customProvider,
} from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createXai } from '@ai-sdk/xai';
import { createGroq } from "@ai-sdk/groq";
import { createCerebras } from '@ai-sdk/cerebras';
export { models, defaultModel, type Model } from '../models';

export function createMyProvider(apiKeys: {
  openai?: string;
  google?: string;
  xai?: string;
  groq?: string;
  cerebras?: string;
} = {}) {
  const openai = createOpenAI({
    apiKey: apiKeys.openai || process.env.OPENAI_API_KEY,
  });

  const google = createGoogleGenerativeAI({
    apiKey: apiKeys.google || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  });

  const xai = createXai({
    apiKey: apiKeys.xai || process.env.XAI_API_KEY,
  });

  const groq = createGroq({
    apiKey: apiKeys.groq || process.env.GROQ_API_KEY,
  });

  const cerebrasProvider = createCerebras({
    apiKey: apiKeys.cerebras || process.env.CEREBRAS_API_KEY,
  });

  return customProvider({
    languageModels: {
      'gpt-4o-mini': openai('gpt-4o-mini'),
      'gpt-4.1-mini': openai('gpt-4.1-mini'),
      'gemini-2.5-flash': google('gemini-2.5-flash'),
      'llama-3.3-70b-versatile': groq('llama-3.3-70b-versatile'),
      'openai/gpt-oss-120b': groq('openai/gpt-oss-120b'),
      'openai/gpt-oss-20b': groq('openai/gpt-oss-20b'),
      'moonshotai/kimi-k2-instruct': groq('moonshotai/kimi-k2-instruct-0905'),
      'llama3.1-8b': cerebrasProvider('llama3.1-8b'),
      'gpt-oss-120b': cerebrasProvider('gpt-oss-120b'),
    },
    fallbackProvider: openai,
  });
}

export const myProvider = createMyProvider();
