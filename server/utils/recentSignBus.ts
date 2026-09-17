import type { RecentSignEvent } from '~/types/recentSign'

class RecentSignBus {
  private listeners = new Map<string, Set<(event: RecentSignEvent) => void>>()

  publish(ownerId: string, event: RecentSignEvent) {
    for (const listener of this.listeners.get(ownerId) || []) {
      try { listener(event) }
      catch { /* A disconnected browser cannot interrupt a completed sign. */ }
    }
  }

  subscribe(ownerId: string, listener: (event: RecentSignEvent) => void) {
    let listeners = this.listeners.get(ownerId)
    if (!listeners) {
      listeners = new Set()
      this.listeners.set(ownerId, listeners)
    }
    listeners.add(listener)
    return () => {
      listeners?.delete(listener)
      if (listeners?.size === 0)
        this.listeners.delete(ownerId)
    }
  }
}

export const recentSignBus = new RecentSignBus()
