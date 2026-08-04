'use client'

import { ListChecks, Scissors, Search } from 'lucide-react'

interface SuggestionGroup {
  title: string
  icon: typeof Search
  prompts: string[]
}

/**
 * Grouped by what the agent does rather than by subject, so the openers read
 * sensibly against whatever footage happens to be in the project.
 */
const GROUPS: SuggestionGroup[] = [
  {
    title: 'Search',
    icon: Search,
    prompts: [
      'Find a specific moment',
      'Show every scene with a person',
      'When does the setting change?',
    ],
  },
  {
    title: 'Understand',
    icon: ListChecks,
    prompts: [
      'Summarize what happens',
      'What are the key moments?',
      'Read any on-screen text',
    ],
  },
  {
    title: 'Clip',
    icon: Scissors,
    prompts: ['Clip the highlights', 'Build a reel of key moments', 'Cut a specific segment'],
  },
]

export function PromptSuggestions({ onSelect }: { onSelect: (prompt: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {GROUPS.map((group) => {
        const Icon = group.icon
        return (
          <div key={group.title} className="rounded-xl border bg-card/40 p-3">
            <div className="mb-2 flex items-center gap-1.5 px-1.5">
              <Icon className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">{group.title}</span>
            </div>

            <ul className="space-y-0.5">
              {group.prompts.map((prompt) => (
                <li key={prompt}>
                  <button
                    type="button"
                    onClick={() => onSelect(prompt)}
                    className="w-full rounded-md px-1.5 py-1 text-left text-xs leading-snug text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {prompt}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
