import { tool } from 'ai'
import { z } from 'zod'
import tvly from '@/lib/tavily/client'

/**
 * Web search, for the context a video cannot supply.
 *
 * Deliberately outside `tools/core` — everything in there is scoped to the
 * caller's project and grounded in their footage. This one reaches the open
 * web, so its results are *background*, never evidence about what a video
 * shows. The system prompt draws that line; the `source` on every result is
 * what lets the model keep it.
 */
export const tavilySearchTool = tool({
  description:
    'Search the web for up-to-date information, news and research. ' +
    'Use it for background the videos cannot supply — who a person or company is, what an event was, what a term means, whether something is still true. ' +
    'Never use it to answer what a video shows or says: that must come from the video tools.',
  inputSchema: z.object({
    query: z.string().describe('The search query, phrased as a full question or topic.'),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(5)
      .describe('How many results to return.'),
    topic: z
      .enum(['general', 'news'])
      .default('general')
      .describe('Use "news" for current events, where recency matters more than authority.'),
  }),
  execute: async ({ query, max_results, topic }) => {
    try {
      const result = await tvly.search(query, {
        includeAnswer: true,
        maxResults: max_results,
        includeRawContent: false,
        includeImages: false,
        topic,
      })

      return {
        query,
        // Tavily's own synthesis across the hits. Usually the answer; the
        // results below are what lets the model cite and check it.
        answer: result.answer ?? null,
        results: (result.results ?? []).map((hit: any) => ({
          title: hit.title,
          url: hit.url,
          content: hit.content,
          score: hit.score,
        })),
      }
    } catch (error: any) {
      console.error('[tavily_search] failed:', error)
      return {
        query,
        answer: null,
        results: [],
        error: error?.message || 'Web search failed.',
      }
    }
  },
})
