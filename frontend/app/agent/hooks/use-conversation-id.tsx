'use client'

import { createContext, useContext, type ReactNode } from 'react'

/**
 * Which conversation the subtree belongs to.
 *
 * The agent store is a module singleton — it outlives any one conversation, so
 * anything it holds on behalf of a conversation has to say which one, or it
 * leaks into the next. Tool results sit deep under `Messages` and have no other
 * way to know, hence the context rather than a prop.
 */
const ConversationIdContext = createContext<string | undefined>(undefined)

export function ConversationScope({ id, children }: { id: string; children: ReactNode }) {
  return <ConversationIdContext.Provider value={id}>{children}</ConversationIdContext.Provider>
}

export function useConversationId() {
  return useContext(ConversationIdContext)
}
