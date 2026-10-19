import type { AccountSessionEvent } from '~/types/accountSession'

const listeners = new Map<string, Set<(event: AccountSessionEvent) => void>>()

export const accountSessionBus = {
  publish(ownerId: string, event: AccountSessionEvent) {
    for (const listener of listeners.get(ownerId) || []) {
      try { listener(event) }
      catch { /* A disconnected client must not interrupt authentication. */ }
    }
  },
  subscribe(ownerId: string, listener: (event: AccountSessionEvent) => void) {
    const group = listeners.get(ownerId) || new Set()
    group.add(listener)
    listeners.set(ownerId, group)
    return () => {
      group.delete(listener)
      if (!group.size)
        listeners.delete(ownerId)
    }
  },
}
