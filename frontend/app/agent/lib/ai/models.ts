export interface Model {
  id: string;
  label: string;
  provider: string;
}

export const models: Model[] = [
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'OpenAI' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', provider: 'OpenAI' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'Google' },
  { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3', provider: 'Groq' },
  { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', provider: 'Groq' },
  { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B', provider: 'Groq' },
  { id: 'moonshotai/kimi-k2-instruct', label: 'Kimi K2 Instruct', provider: 'Groq' },
  { id: 'llama3.1-8b', label: 'Llama 3.1 8B', provider: 'Cerebras' },
  { id: 'gpt-oss-120b', label: 'GPT OSS 120B', provider: 'Cerebras' },
];

export const defaultModel = 'gpt-4.1-mini';
