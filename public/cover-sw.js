const IMAGE_CACHE = 'solitude-cover-images-v1'
const META_CACHE = 'solitude-cover-meta-v1'
const CACHE_PREFIX = 'solitude-cover-'
const MAX_IMAGES = 250
const FRESH_FOR_MS = 7 * 24 * 60 * 60 * 1000

function isRemoteHttpsImage(request) {
  if (request.destination !== 'image') return false
  const url = new URL(request.url)
  return url.protocol === 'https:' && url.origin !== self.location.origin
}

function metaRequest(url) {
  return new Request(new URL(`__solitude_cover_meta__/${encodeURIComponent(url)}`, self.registration.scope))
}

async function readMeta(metaCache, url) {
  const response = await metaCache.match(metaRequest(url))
  if (!response) return undefined
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

async function writeMeta(metaCache, url, cachedAt, lastAccess = Date.now()) {
  await metaCache.put(metaRequest(url), new Response(JSON.stringify({ url, cachedAt, lastAccess }), {
    headers: { 'content-type': 'application/json' },
  }))
}

async function enforceLimit(imageCache, metaCache) {
  const keys = await metaCache.keys()
  if (keys.length <= MAX_IMAGES) return
  const entries = await Promise.all(keys.map(async (key) => {
    const response = await metaCache.match(key)
    try {
      return { key, ...(await response.json()) }
    } catch {
      return { key, url: '', lastAccess: 0 }
    }
  }))
  entries.sort((left, right) => (left.lastAccess || 0) - (right.lastAccess || 0) || left.url.localeCompare(right.url))
  await Promise.all(entries.slice(0, entries.length - MAX_IMAGES).map(async (entry) => {
    if (entry.url) await imageCache.delete(entry.url)
    await metaCache.delete(entry.key)
  }))
}

async function cacheRemoteImage(request) {
  const imageCache = await caches.open(IMAGE_CACHE)
  const metaCache = await caches.open(META_CACHE)
  const cached = await imageCache.match(request)
  const meta = await readMeta(metaCache, request.url)
  const now = Date.now()

  if (cached && meta && now - meta.cachedAt < FRESH_FOR_MS) {
    await writeMeta(metaCache, request.url, meta.cachedAt, now)
    return cached
  }

  try {
    const response = await fetch(request)
    if (response.ok || response.type === 'opaque') {
      await imageCache.put(request, response.clone())
      await writeMeta(metaCache, request.url, now, now)
      await enforceLimit(imageCache, metaCache)
      return response
    }
    if (cached) {
      await writeMeta(metaCache, request.url, meta?.cachedAt || now, now)
      return cached
    }
    return response
  } catch (error) {
    if (cached) {
      await writeMeta(metaCache, request.url, meta?.cachedAt || now, now)
      return cached
    }
    throw error
  }
}

self.addEventListener('fetch', (event) => {
  if (!isRemoteHttpsImage(event.request)) return
  event.respondWith(cacheRemoteImage(event.request))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== IMAGE_CACHE && key !== META_CACHE).map((key) => caches.delete(key)),
  )))
})
