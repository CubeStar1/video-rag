import { tool } from 'ai'
import { z } from 'zod'

export const showArtifactTool = tool({
  description:
    'Show an artifact panel to the user. Use this for long markdown documents or code the user should read and copy.',
  inputSchema: z.object({
    title: z.string().describe('Title for the artifact panel'),
    type: z.enum(['markdown', 'code']).describe('Display type for the artifact panel'),
    content: z.string().optional().describe('Optional content to display in the artifact panel'),
    identifier: z.string().optional().describe('Optional unique identifier for the content'),
  }),
  execute: async ({
    title,
    type,
    content,
    identifier,
  }: {
    title: string
    type: 'markdown' | 'code'
    content?: string
    identifier?: string
  }) => {
    return JSON.stringify({
      success: true,
      message: `Artifact panel "${title}" (${type}) is now visible to the user.`,
      identifier: identifier ?? null,
      content: content ?? null,
    })
  },
})
