'use client'

import { memo } from 'react'
import { AlertTriangle, ExternalLink } from 'lucide-react'

interface WebSearchResultProps {
  args: any
  output: any
}

/**
 * Web results are the one thing here that did not come from the user's footage,
 * so every row carries its host and links out. The distinction matters more
 * than it looks: an unattributed line in this panel reads as something the
 * analysis found in a video.
 */
export const WebSearchResult = memo(function WebSearchResult({ output }: WebSearchResultProps) {
  if (output?.error) {
    return (
      <p className="flex items-start gap-1.5 text-xs text-red-500">
        <AlertTriangle className="mt-0.5 size-3 shrink-0" />
        {output.error}
      </p>
    )
  }

  const results = output?.results ?? []

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {results.length} web result{results.length === 1 ? '' : 's'} for “{output?.query}”
      </p>

      {output?.answer && (
        <p className="whitespace-pre-wrap text-xs leading-relaxed">{output.answer}</p>
      )}

      {results.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing came back.</p>
      ) : (
        <ul className="space-y-1.5">
          {results.slice(0, 8).map((hit: any, index: number) => {
            let host = ''
            try {
              host = new URL(hit.url).hostname.replace(/^www\./, '')
            } catch {
              host = hit.url ?? ''
            }

            return (
              <li key={index} className="text-xs">
                <a
                  href={hit.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start gap-1.5"
                >
                  <ExternalLink className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 font-medium group-hover:underline">
                      {hit.title}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">{host}</span>
                  </span>
                </a>
              </li>
            )
          })}
          {results.length > 8 && (
            <li className="text-xs text-muted-foreground">+{results.length - 8} more</li>
          )}
        </ul>
      )}
    </div>
  )
})
