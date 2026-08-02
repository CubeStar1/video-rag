'use client'

import { ArrowUpRight, ListChecks, MessageCircleQuestion, Scissors, Search } from 'lucide-react'

interface SuggestionGroup {
  title: string
  tag: string
  icon: typeof Search
  color: string
  prompts: string[]
}

const GROUPS: SuggestionGroup[] = [
  {
    title: 'Search & find',
    tag: 'SEMANTIC',
    icon: Search,
    color: 'text-sky-500',
    prompts: [
      'Find the moment where the main topic is introduced',
      'Where does the speaker talk about results?',
      'Show me every scene filmed outdoors',
    ],
  },
  {
    title: 'Summarize & understand',
    tag: 'INSIGHT',
    icon: ListChecks,
    color: 'text-emerald-500',
    prompts: [
      'Summarize this video',
      'What are the key takeaways?',
      'List the action items mentioned',
    ],
  },
  {
    title: 'Clip & highlight',
    tag: 'TIMELINE',
    icon: Scissors,
    color: 'text-rose-500',
    prompts: [
      'Show me clips of the most important moments',
      'Make a highlight reel from this video',
      'Clip the introduction',
    ],
  },
  {
    title: 'Ask across videos',
    tag: 'COMPARE',
    icon: MessageCircleQuestion,
    color: 'text-violet-500',
    prompts: [
      'What topics come up most often?',
      'How many scenes show a person speaking?',
      'Compare what these videos say about the same topic',
    ],
  },
]

export function SuggestionCards({ onSelect }: { onSelect: (prompt: string) => void }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {GROUPS.map((group) => {
        const Icon = group.icon
        return (
          <div key={group.title} className="rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Icon className={`size-4 ${group.color}`} />
                <h3 className="text-sm font-semibold">{group.title}</h3>
              </div>
              <span className="text-[10px] font-medium tracking-wider text-muted-foreground">
                {group.tag}
              </span>
            </div>

            <ul className="mt-3 space-y-2">
              {group.prompts.map((prompt) => (
                <li key={prompt}>
                  <button
                    type="button"
                    onClick={() => onSelect(prompt)}
                    className="group flex w-full items-start gap-1.5 text-left text-[13px] leading-snug text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ArrowUpRight className="mt-0.5 size-3 shrink-0 opacity-50 transition-opacity group-hover:opacity-100" />
                    <span>{prompt}</span>
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
