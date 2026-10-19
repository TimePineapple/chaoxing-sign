import type { RecentSignEvent } from '~/types/recentSign'
import type { AccountSessionEvent } from '~/types/accountSession'

export function connectRecentSignEvents(
  onSign: (event: RecentSignEvent) => void,
  onReconnect: () => void,
  onSession?: (event: AccountSessionEvent) => void,
) {
  if (typeof EventSource === 'undefined')
    return () => {}

  const source = new EventSource('/api/cx/recent-sign-events')
  let opened = false
  source.addEventListener('open', () => {
    if (opened)
      onReconnect()
    opened = true
  })
  source.addEventListener('sign', (event) => {
    try { onSign(JSON.parse((event as MessageEvent).data) as RecentSignEvent) }
    catch { /* The next page return or reconnect will reconcile state. */ }
  })
  source.addEventListener('account-session', (event) => {
    try { onSession?.(JSON.parse((event as MessageEvent).data) as AccountSessionEvent) }
    catch { /* A reconnect or account refresh will reconcile state. */ }
  })
  return () => source.close()
}
