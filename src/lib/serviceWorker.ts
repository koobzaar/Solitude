export function registerCoverServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return
  try {
    const scriptUrl = new URL('cover-sw.js', document.baseURI)
    const scopeUrl = new URL('./', scriptUrl)
    void navigator.serviceWorker.register(scriptUrl.href, { scope: scopeUrl.pathname }).catch(() => undefined)
  } catch {
    // Artwork keeps using normal <img> requests when registration is unavailable.
  }
}
