// Presentation only: keep bottom panels above the portrait phone keyboard.
export default defineNuxtPlugin((nuxtApp) => {
  const viewport = window.visualViewport
  const root = document.documentElement

  function updateViewport() {
    const height = viewport?.height ?? window.innerHeight
    const offset = Math.max(0, window.innerHeight - height - (viewport?.offsetTop ?? 0))
    root.style.setProperty('--mobile-viewport-height', `${height}px`)
    root.style.setProperty('--mobile-keyboard-offset', `${offset}px`)
    const editing = document.activeElement?.matches('input, textarea, [contenteditable="true"]')
    root.dataset.mobileKeyboard = editing && offset > 100 ? 'open' : 'closed'
  }

  updateViewport()
  viewport?.addEventListener('resize', updateViewport)
  viewport?.addEventListener('scroll', updateViewport)
  window.addEventListener('resize', updateViewport)
  document.addEventListener('focusin', updateViewport)
  document.addEventListener('focusout', updateViewport)

  nuxtApp.vueApp.onUnmount(() => {
    viewport?.removeEventListener('resize', updateViewport)
    viewport?.removeEventListener('scroll', updateViewport)
    window.removeEventListener('resize', updateViewport)
    document.removeEventListener('focusin', updateViewport)
    document.removeEventListener('focusout', updateViewport)
    root.style.removeProperty('--mobile-viewport-height')
    root.style.removeProperty('--mobile-keyboard-offset')
    delete root.dataset.mobileKeyboard
  })
})
