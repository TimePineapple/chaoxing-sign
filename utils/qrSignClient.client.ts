// One loaded page is one client. sessionStorage can be cloned when a tab is
// duplicated, which would make two live clients appear to have the same ID.
let pageClientId: string | undefined

function createClientId(): string {
  if (globalThis.crypto?.randomUUID)
    return globalThis.crypto.randomUUID()
  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues)
    globalThis.crypto.getRandomValues(bytes)
  else
    bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256) })
  bytes[6] = ((bytes[6] ?? 0) & 0x0F) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3F) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function getQrSignClientId(): string {
  pageClientId ||= createClientId()
  return pageClientId
}

export function isOtherQrSignClient(clientId?: string): boolean {
  return Boolean(clientId && clientId !== getQrSignClientId())
}
