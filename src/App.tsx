import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlbumArt } from './components/AlbumArt'
import { Footer, Header } from './components/Shell'
import { albumCoverUrl, firstCollectionAlbums, firstLibraryAlbums } from './lib/home'
import { makeId, makeSeed } from './lib/id'
import { normalizeValue, parseAlbumList } from './lib/importParser'
import { MusicBrainzClient, automaticMatch } from './lib/musicbrainz'
import { appendPaceSample, estimateRemainingMs, formatDuration } from './lib/pace'
import { MODE_DETAILS, battleCount, getBattleState } from './lib/ranking'
import type { Album, BattleRun, CatalogCandidate, Collection, RankingMode } from './lib/types'
import { usePersistentState } from './lib/usePersistentState'

type Screen = 'library' | 'import' | 'review' | 'mode' | 'battle' | 'results'

const pageMotion = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.24 },
}

const homeReveal = {
  hidden: { opacity: 0, y: 22 },
  visible: { opacity: 1, y: 0 },
}

const homeStagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.09, delayChildren: 0.08 } },
}

function nowIso() {
  return new Date().toISOString()
}

function collectionDuplicates(albums: readonly Album[]): Set<string> {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const album of albums) {
    const key = `${normalizeValue(album.title)}::${normalizeValue(album.artist)}`
    if (seen.has(key)) duplicates.add(key)
    seen.add(key)
  }
  return duplicates
}

interface LibraryProps {
  collections: Collection[]
  onCreate: (name: string, vibe?: string, note?: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onImport: (id: string) => void
  onRank: (id: string) => void
  onResume: (id: string) => void
  onViewRun: (collectionId: string, runId: string) => void
}

const COLLECTION_VIBES = ['Late-night', 'Sunday morning', 'Road trip', 'Deep focus', 'Rainy day', 'Party']

const DEMO_RECORDS = [
  { title: 'Afterglow', artist: 'The Quiet Hours', style: 'afterglow' },
  { title: 'Blue Room', artist: 'Mara Vale', style: 'blue-room' },
  { title: 'Soft Static', artist: 'North Window', style: 'soft-static' },
  { title: 'Sunday Gold', artist: 'The Daydreamers', style: 'sunday-gold' },
]

type DemoRecord = (typeof DEMO_RECORDS)[number]

function RitualRecord({ album, demo, delay = 0 }: { album?: Album; demo: DemoRecord; delay?: number }) {
  const title = album?.title ?? demo.title
  const artist = album?.artist ?? demo.artist
  return (
    <motion.div
      className="ritual-record"
      animate={{ y: [0, -7, 0] }}
      transition={{ duration: 4.6, delay, repeat: Infinity, ease: 'easeInOut' }}
    >
      {album ? (
        <AlbumArt src={albumCoverUrl(album)} title={title} artist={artist} className="ritual-record__cover" />
      ) : (
        <div className={`demo-sleeve demo-sleeve--${demo.style} ritual-record__cover`} role="img" aria-label={`Fictional cover for ${title} by ${artist}`}>
          <span className="demo-sleeve__orbit" aria-hidden="true"><i /></span>
          <b>{title}</b>
        </div>
      )}
      <div className="ritual-record__copy"><strong>{title}</strong><small>{artist}</small></div>
    </motion.div>
  )
}

function LibraryScreen({ collections, onCreate, onRename, onDelete, onImport, onRank, onResume, onViewRun }: LibraryProps) {
  const [setupOpen, setSetupOpen] = useState(false)
  const [name, setName] = useState('')
  const [vibe, setVibe] = useState<string>()
  const [note, setNote] = useState('')
  const [editingId, setEditingId] = useState<string>()
  const [editingName, setEditingName] = useState('')
  const ritualAlbums = firstLibraryAlbums(collections, 2)
  const demoRecords = useMemo(() => {
    const first = Math.floor(Math.random() * DEMO_RECORDS.length)
    const offset = 1 + Math.floor(Math.random() * (DEMO_RECORDS.length - 1))
    return [DEMO_RECORDS[first], DEMO_RECORDS[(first + offset) % DEMO_RECORDS.length]]
  }, [])

  const openSetup = () => {
    setName('')
    setVibe(undefined)
    setNote('')
    setSetupOpen(true)
  }

  const create = (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    onCreate(trimmed, vibe, note.trim() || undefined)
  }

  return (
    <div className="page library-page">
      <AnimatePresence mode="wait" initial={false}>
        {setupOpen ? (
          <motion.section className="collection-setup" key="setup" {...pageMotion}>
            <button className="back-button collection-setup__back" type="button" onClick={() => setSetupOpen(false)}>← Back</button>
            <p className="eyebrow">New collection · Step 1 of 3</p>
            <h1>Let’s set the <em>stage.</em></h1>
            <p className="collection-setup__intro">Give this batch a name and a mood. It’s just for you—a way to remember what you were reaching for when you built it.</p>
            <form className="collection-setup__panel" onSubmit={create}>
              <label htmlFor="new-collection">Name this collection</label>
              <input
                id="new-collection"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Late-night records"
                maxLength={80}
              />

              <fieldset>
                <legend>What’s the mood? <span>— optional</span></legend>
                <div className="vibe-list">
                  {COLLECTION_VIBES.map((label) => (
                    <button
                      className={vibe === label ? 'vibe-chip vibe-chip--selected' : 'vibe-chip'}
                      type="button"
                      aria-pressed={vibe === label}
                      key={label}
                      onClick={() => setVibe((current) => current === label ? undefined : label)}
                    >{label}</button>
                  ))}
                </div>
              </fieldset>

              <label htmlFor="collection-note">A note to your future self <span>— optional</span></label>
              <textarea id="collection-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Records for the long winter evenings…" rows={2} maxLength={280} />

              <div className="collection-setup__actions">
                <button className="button button--primary button--large" type="submit" disabled={!name.trim()}>Add your records →</button>
                <span>Next: paste your wishlist.</span>
              </div>
            </form>
          </motion.section>
        ) : (
          <motion.div className="library-home" key="home" {...pageMotion}>
            <section className="library-hero">
              <motion.div className="library-hero__copy" variants={homeStagger} initial="hidden" animate="visible">
                <motion.p className="eyebrow" variants={homeReveal}>Vinyl priority, settled</motion.p>
                <motion.h1 variants={homeReveal}><span>What</span>{' '}<span>deserves the</span><em>next spin?</em></motion.h1>
                <motion.p className="lede" variants={homeReveal}>Your wishlist is longer than your budget—and that’s the fun part. Line the records up two at a time, trust your gut, and let Solitude settle the order one honest choice at a time.</motion.p>
                <motion.div className="library-hero__actions" variants={homeReveal}>
                  <button className="button button--primary button--large" type="button" onClick={openSetup}>Start a ranking →</button>
                  <a href="#shelves">or open a collection you started</a>
                </motion.div>
                <motion.ol className="library-steps" aria-label="How Solitude works" variants={homeReveal}>
                  <li><b>1</b> Paste</li><li><b>2</b> Choose</li><li><b>3</b> A ranking you trust</li>
                </motion.ol>
              </motion.div>

              <motion.aside className="ritual-preview" aria-label="A preview of a ranking battle" initial={{ opacity: 0, x: 34, rotate: 1.2 }} animate={{ opacity: 1, x: 0, rotate: 0 }} transition={{ duration: .62, delay: .18 }} whileHover={{ y: -6, rotate: -.35 }}>
                <div className="ritual-preview__heading"><span>A glimpse of the ritual</span><span>1 of many</span></div>
                <div className="ritual-preview__records">
                  <RitualRecord album={ritualAlbums[0]} demo={demoRecords[0]} />
                  <span className="ritual-preview__or" aria-hidden="true">or</span>
                  <RitualRecord album={ritualAlbums[1]} demo={demoRecords[1]} delay={-2.3} />
                </div>
                <p>Every ranking is built from moments like this—pick the one you’d rather own next. No ties, no maybes.</p>
              </motion.aside>
            </section>

            <motion.section className="library-section" id="shelves" aria-labelledby="your-collections" initial={{ opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: .08 }} transition={{ duration: .5 }}>
              <div className="section-heading">
                <div><p className="eyebrow">The shelves</p><h2 id="your-collections">Your collections</h2></div>
                <span>{collections.length} {collections.length === 1 ? 'collection' : 'collections'}</span>
              </div>

              {collections.length === 0 ? (
                <div className="empty-shelf">
                  <span className="empty-record" aria-hidden="true" />
                  <h3>Your shelf is quiet</h3>
                  <p>Create a collection, then paste in the records you’re considering.</p>
                  <button className="button button--primary" type="button" onClick={openSetup}>Create your first collection</button>
                </div>
              ) : (
                <div className="collection-grid">
                  {collections.map((collection, index) => {
                    const coverAlbum = firstCollectionAlbums(collection, 1)[0]
                    return (
                      <motion.article className="collection-card" key={collection.id} initial={{ opacity: 0, y: 18, rotate: .4 }} whileInView={{ opacity: 1, y: 0, rotate: 0 }} viewport={{ once: true, amount: .15 }} transition={{ delay: index * 0.055, duration: .38 }} whileHover={{ y: -7, rotate: index % 2 ? .35 : -.35 }}>
                        <div className="collection-card__top">
                          <AlbumArt
                            src={coverAlbum ? albumCoverUrl(coverAlbum) : undefined}
                            title={coverAlbum?.title ?? collection.name}
                            artist={coverAlbum?.artist ?? 'No records yet'}
                            className="collection-card__cover"
                          />
                          <div className="collection-card__identity">
                            {editingId === collection.id ? (
                              <form
                                className="rename-form"
                                onSubmit={(event) => {
                                  event.preventDefault()
                                  if (editingName.trim()) onRename(collection.id, editingName.trim())
                                  setEditingId(undefined)
                                }}
                              >
                                <label className="sr-only" htmlFor={`rename-${collection.id}`}>Collection name</label>
                                <input id={`rename-${collection.id}`} autoFocus value={editingName} onChange={(event) => setEditingName(event.target.value)} />
                                <button type="submit" className="text-button">Save</button>
                              </form>
                            ) : <h3>{collection.name}</h3>}
                            <p>{collection.albums.length} {collection.albums.length === 1 ? 'record' : 'records'} · Updated {new Date(collection.updatedAt).toLocaleDateString()}</p>
                            {collection.vibe && <span className="collection-vibe">{collection.vibe}</span>}
                          </div>
                        </div>

                        {collection.activeRun && (
                          <button className="resume-strip" type="button" aria-label={`Resume ${collection.name} battle`} onClick={() => onResume(collection.id)}>
                            <span><strong>Battle in progress</strong><small>{collection.activeRun.decisions.length} choices saved</small></span>
                            <span aria-hidden="true">Resume →</span>
                          </button>
                        )}

                        <div className="card-actions">
                          {collection.albums.length >= 2 && !collection.activeRun && (
                            <button className="button button--small button--ink" type="button" onClick={() => onRank(collection.id)}>Start ranking</button>
                          )}
                          <button className="button button--small" type="button" onClick={() => onImport(collection.id)}>
                            {collection.albums.length ? 'Edit list' : 'Add records'}
                          </button>
                          <span className="card-actions__spacer" />
                          <button className="icon-button" type="button" aria-label={`Rename ${collection.name}`} onClick={() => { setEditingId(collection.id); setEditingName(collection.name) }}>✎</button>
                          <button className="icon-button icon-button--danger" type="button" aria-label={`Delete ${collection.name}`} onClick={() => onDelete(collection.id)}>×</button>
                        </div>

                        {collection.completedRuns.length > 0 && (
                          <details className="history">
                            <summary>Ranking history <span>{collection.completedRuns.length}</span></summary>
                            <ul>
                              {[...collection.completedRuns].reverse().slice(0, 5).map((run) => (
                                <li key={run.id}>
                                  <span><strong>{MODE_DETAILS.find((mode) => mode.id === run.mode)?.name}</strong><small>{new Date(run.completedAt ?? run.updatedAt).toLocaleString()}</small></span>
                                  <button type="button" className="text-button" onClick={() => onViewRun(collection.id, run.id)}>View</button>
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </motion.article>
                    )
                  })}
                  <button className="new-collection-card" type="button" onClick={openSetup}>
                    <span aria-hidden="true">+</span><strong>New collection</strong><small>Start a fresh ranking from a wishlist.</small>
                  </button>
                </div>
              )}
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

interface ImportProps {
  collection: Collection
  onBack: () => void
  onContinue: (albums: Album[]) => void
}

function ImportScreen({ collection, onBack, onContinue }: ImportProps) {
  const [input, setInput] = useState(() => collection.albums.map((album) => `${album.title} - ${album.artist}`).join('\n'))
  const [swapColumns, setSwapColumns] = useState(false)
  const parsed = useMemo(() => parseAlbumList(input, swapColumns), [input, swapColumns])
  const visibleLines = parsed.lines.filter((line) => line.sourceText.trim())
  const validCount = parsed.albums.length
  const canContinue = validCount >= 2 && validCount <= 100 && parsed.duplicateCount === 0 && parsed.invalidCount === 0

  return (
    <div className="page constrained-page">
      <button className="back-button" type="button" onClick={onBack}>← Collections</button>
      <div className="page-title">
        <p className="eyebrow">01 · Build the listening pile</p>
        <h1>Paste your <em>wishlist.</em></h1>
        <p>One album per line. We understand dashes, tabs, “Album by Artist,” and title-only entries.</p>
      </div>

      <div className="import-layout">
        <section className="panel import-editor">
          <div className="panel-heading">
            <label htmlFor="album-list">Album list</label>
            <span>{validCount}/100 unique</span>
          </div>
          <textarea
            id="album-list"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={'Blue Train - John Coltrane\nKind of Blue — Miles Davis\nPromises by Floating Points & Pharoah Sanders'}
            spellCheck="false"
          />
          <label className="switch-row">
            <input type="checkbox" checked={swapColumns} onChange={(event) => setSwapColumns(event.target.checked)} />
            <span><strong>Artist comes first</strong><small>Swap the Artist and Album columns for every two-column line.</small></span>
          </label>
        </section>

        <section className="panel preview-panel" aria-live="polite">
          <div className="panel-heading"><h2>Import preview</h2><span>{visibleLines.length} lines</span></div>
          {visibleLines.length === 0 ? (
            <div className="preview-empty"><span aria-hidden="true">♪</span><p>Your parsed albums will appear here.</p></div>
          ) : (
            <ol className="parse-list">
              {visibleLines.map((line) => (
                <li className={line.error || line.duplicateOf ? 'parse-line parse-line--error' : 'parse-line'} key={line.line}>
                  <span>{line.line}</span>
                  <div><strong>{line.title || 'Could not read line'}</strong><small>{line.error ?? (line.duplicateOf ? `Duplicate of line ${line.duplicateOf}` : line.artist)}</small></div>
                  <i aria-hidden="true">{line.error || line.duplicateOf ? '!' : '✓'}</i>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <div className="validation-summary" aria-live="polite">
        {validCount < 2 && <p>Add at least two unique albums to continue.</p>}
        {parsed.duplicateCount > 0 && <p>Resolve {parsed.duplicateCount} duplicate {parsed.duplicateCount === 1 ? 'line' : 'lines'} before continuing.</p>}
        {parsed.invalidCount > 0 && <p>Fix {parsed.invalidCount} unreadable or over-limit {parsed.invalidCount === 1 ? 'line' : 'lines'}.</p>}
        {validCount > 40 && <p className="warning">A deep ranking of {validCount} albums can take a long time. Quick mode will still be available.</p>}
      </div>

      <div className="page-actions">
        <p>Next, you’ll review metadata and cover art.</p>
        <button className="button button--primary" type="button" disabled={!canContinue} onClick={() => onContinue(parsed.albums)}>
          Review {validCount || ''} albums →
        </button>
      </div>
    </div>
  )
}

interface ReviewProps {
  collection: Collection
  client: MusicBrainzClient
  onBack: () => void
  onChange: (albumId: string, update: Partial<Album>) => void
  onRemove: (albumId: string) => void
  onContinue: () => void
}

function ReviewScreen({ collection, client, onBack, onChange, onRemove, onContinue }: ReviewProps) {
  const [results, setResults] = useState<Record<string, CatalogCandidate[]>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [matchingAll, setMatchingAll] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<{ searched: number; total: number; covers: number; coverTotal: number }>()
  const coverTasks = useRef(new Set<Promise<void>>())
  const duplicates = collectionDuplicates(collection.albums)
  const invalidCover = collection.albums.some((album) => album.coverUrl && !album.coverUrl.startsWith('https://'))
  const matchedCount = collection.albums.filter((album) => album.matchStatus === 'matched').length
  const unresolvedCount = collection.albums.length - matchedCount

  const resolveCover = useCallback((albumId: string, releaseGroupId: string, bypassCache = false) => {
    onChange(albumId, { coverStatus: 'checking' })
    setBulkProgress((current) => current ? { ...current, coverTotal: current.coverTotal + 1 } : current)
    let task: Promise<void>
    task = client.resolveCover(releaseGroupId, bypassCache)
      .then((cover) => {
        if (cover.status === 'available') {
          onChange(albumId, { coverUrl: cover.url, coverStatus: 'available' })
        } else if (cover.status === 'missing') {
          onChange(albumId, { coverUrl: undefined, coverStatus: 'missing' })
        } else {
          onChange(albumId, { coverUrl: undefined, coverStatus: 'error' })
        }
      })
      .finally(() => {
        coverTasks.current.delete(task)
        setBulkProgress((current) => current ? { ...current, covers: current.covers + 1 } : current)
      })
    coverTasks.current.add(task)
    return task
  }, [client, onChange])

  const applyMatch = useCallback((album: Album, candidate: CatalogCandidate, refreshCover = false, automaticallyApplied = false) => {
    onChange(album.id, {
      title: candidate.title,
      artist: candidate.artist,
      year: candidate.year,
      coverUrl: candidate.coverUrl,
      releaseGroupId: candidate.id,
      matchStatus: candidate.weak ? 'weak' : 'matched',
      matchConfidence: candidate.confidence,
      matchKind: candidate.matchKind,
      automaticMatch: automaticallyApplied,
      coverStatus: 'checking',
    })
    void resolveCover(album.id, candidate.id, refreshCover)
  }, [onChange, resolveCover])

  const searchAlbum = useCallback(async (album: Album, bypassCache = false) => {
    setLoading((current) => ({ ...current, [album.id]: true }))
    setErrors((current) => ({ ...current, [album.id]: '' }))
    if (bypassCache && album.matchStatus === 'matched') onChange(album.id, { matchStatus: 'pending', automaticMatch: undefined })
    try {
      const matches = await client.search(album.title, album.artist, bypassCache)
      const automatic = automaticMatch(matches)
      if (automatic) {
        applyMatch(album, automatic, bypassCache, true)
        setResults((current) => ({ ...current, [album.id]: [] }))
        setExpanded((current) => {
          const next = new Set(current)
          next.delete(album.id)
          return next
        })
      } else {
        setResults((current) => ({ ...current, [album.id]: matches }))
        onChange(album.id, { matchStatus: matches.length ? 'weak' : 'manual', automaticMatch: undefined })
      }
      if (!matches.length) setErrors((current) => ({ ...current, [album.id]: 'No catalog matches found. You can continue manually.' }))
    } catch (error) {
      setErrors((current) => ({ ...current, [album.id]: error instanceof Error ? error.message : 'Search failed.' }))
      onChange(album.id, { matchStatus: 'error' })
    } finally {
      setLoading((current) => ({ ...current, [album.id]: false }))
    }
  }, [applyMatch, client, onChange])

  const matchAll = async () => {
    const targets = collection.albums.filter((album) => album.matchStatus !== 'matched' || !album.releaseGroupId)
    if (!targets.length) return
    setMatchingAll(true)
    setBulkProgress({ searched: 0, total: targets.length, covers: 0, coverTotal: 0 })
    await Promise.all(targets.map(async (album) => {
      await searchAlbum(album)
      setBulkProgress((current) => current ? { ...current, searched: current.searched + 1 } : current)
    }))
    await Promise.all(coverTasks.current)
    setMatchingAll(false)
    setBulkProgress(undefined)
  }

  const selectMatch = (album: Album, candidate: CatalogCandidate) => {
    applyMatch(album, candidate)
    setResults((current) => ({ ...current, [album.id]: [] }))
    setExpanded((current) => {
      const next = new Set(current)
      next.delete(album.id)
      return next
    })
  }

  return (
    <div className="page constrained-page review-page">
      <button className="back-button" type="button" onClick={onBack}>← Import</button>
      <div className="page-title review-title">
        <div>
          <p className="eyebrow">02 · Check the sleeves</p>
          <h1>Review your <em>records.</em></h1>
          <p>We’ll settle the obvious matches quietly. You only need to step in when the catalog is unsure.</p>
        </div>
      </div>

      <section className={`catalog-console ${matchingAll ? 'catalog-console--active' : ''}`} aria-label="Catalog matching status">
        <div className="catalog-console__record" aria-hidden="true"><i /></div>
        <div className="catalog-console__copy">
          <span className="eyebrow">Catalog session</span>
          <strong>{matchingAll && bulkProgress ? `${bulkProgress.searched} of ${bulkProgress.total} searched` : `${matchedCount} matched · ${unresolvedCount} need attention`}</strong>
          <small>{matchingAll ? 'Strong matches fold away as they arrive. Cover art continues in parallel.' : 'Cached matches appear immediately; new MusicBrainz searches are paced responsibly.'}</small>
          <div className="catalog-progress" aria-hidden="true"><motion.i animate={{ width: `${bulkProgress?.total ? (bulkProgress.searched / bulkProgress.total) * 100 : matchedCount / Math.max(1, collection.albums.length) * 100}%` }} /></div>
        </div>
        <button className="button button--primary" type="button" disabled={matchingAll || unresolvedCount === 0} onClick={matchAll}>
          {matchingAll ? 'Matching…' : unresolvedCount ? `Match ${unresolvedCount} unresolved` : 'All matched'}
        </button>
      </section>

      <div className="review-list">
        {collection.albums.map((album, index) => {
          const key = `${normalizeValue(album.title)}::${normalizeValue(album.artist)}`
          const resolved = album.matchStatus === 'matched' && !expanded.has(album.id)
          const statusText = album.matchStatus === 'matched'
            ? album.matchKind === 'fuzzy'
              ? `${album.automaticMatch ? 'Auto-corrected' : 'Catalog matched'} · ${Math.round((album.matchConfidence ?? 0) * 100)}%`
              : 'Catalog matched'
            : album.matchStatus === 'weak' ? 'Choose a match' : album.matchStatus === 'error' ? 'Search error' : album.matchStatus === 'manual' ? 'Manual details' : 'Not matched'
          return (
            <motion.article
              layout
              className={`review-card ${resolved ? 'review-card--resolved' : 'review-card--open'} ${loading[album.id] ? 'review-card--searching' : ''} ${duplicates.has(key) ? 'review-card--error' : ''}`}
              key={album.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.035, 0.35), layout: { duration: 0.24 } }}
            >
              <span className="review-number">{String(index + 1).padStart(2, '0')}</span>
              <AlbumArt src={album.coverUrl} title={album.title} artist={album.artist} fallback="artist" />
              {resolved ? (
                <div className="review-resolved">
                  <div className="review-resolved__identity">
                    <span className={`status status--${album.matchStatus}`}>{statusText}</span>
                    <h2>{album.title}</h2>
                    <p>{album.artist}{album.year ? ` · ${album.year}` : ''}</p>
                  </div>
                  <div className="review-resolved__actions">
                    <button className="text-button" type="button" onClick={() => setExpanded((current) => new Set(current).add(album.id))}>Edit details</button>
                    <button className="text-button" type="button" disabled={loading[album.id]} onClick={() => searchAlbum(album, true)}>Rematch</button>
                    <button className="text-button text-button--danger" type="button" onClick={() => onRemove(album.id)}>Remove</button>
                  </div>
                  {album.coverStatus === 'checking' && <p className="cover-note" role="status">Cover arriving from the archive…</p>}
                  {album.coverStatus === 'missing' && <p className="cover-note">No archive cover—showing an artist-inspired fallback. Edit to add a custom HTTPS URL.</p>}
                  {album.coverStatus === 'error' && (
                    <p className="cover-note">Cover check failed. <button className="text-button" type="button" onClick={() => album.releaseGroupId && resolveCover(album.id, album.releaseGroupId, true)}>Retry cover</button></p>
                  )}
                </div>
              ) : (
                <div className="review-fields">
                  <div className="review-open__heading">
                    <div><span className={`status status--${album.matchStatus}`}>{statusText}</span><h2>{album.title}</h2><p>{album.artist}</p></div>
                    {loading[album.id] && <span className="search-pulse" role="status"><i /> Listening for a match…</span>}
                  </div>
                  <div className="field-pair">
                    <label>Album title<input value={album.title} onChange={(event) => onChange(album.id, { title: event.target.value, releaseGroupId: undefined, matchStatus: 'manual', matchConfidence: undefined, matchKind: undefined, automaticMatch: undefined })} /></label>
                    <label>Artist<input value={album.artist} onChange={(event) => onChange(album.id, { artist: event.target.value, releaseGroupId: undefined, matchStatus: 'manual', matchConfidence: undefined, matchKind: undefined, automaticMatch: undefined })} /></label>
                  </div>
                  <div className="field-pair field-pair--minor">
                    <label>Year<input inputMode="numeric" value={album.year ?? ''} onChange={(event) => onChange(album.id, { year: event.target.value ? Number(event.target.value) : undefined })} /></label>
                    <label>HTTPS cover URL<input type="url" value={album.coverUrl ?? ''} placeholder="https://…" onChange={(event) => onChange(album.id, { coverUrl: event.target.value || undefined, coverStatus: event.target.value ? 'custom' : undefined, releaseGroupId: undefined, matchStatus: 'manual', matchConfidence: undefined, matchKind: undefined, automaticMatch: undefined })} /></label>
                  </div>
                  <div className="match-row">
                    <button className="button button--small button--ink" type="button" disabled={loading[album.id]} onClick={() => searchAlbum(album, true)}>{loading[album.id] ? 'Searching…' : 'Find a better match'}</button>
                    {album.releaseGroupId && <button className="text-button" type="button" onClick={() => setExpanded((current) => { const next = new Set(current); next.delete(album.id); return next })}>Done editing</button>}
                    <button className="text-button text-button--danger" type="button" onClick={() => onRemove(album.id)}>Remove</button>
                  </div>
                  {duplicates.has(key) && <p className="field-error">This duplicates another album in the collection.</p>}
                  {album.coverUrl && !album.coverUrl.startsWith('https://') && <p className="field-error">Custom cover URLs must begin with https://</p>}
                  {album.coverStatus === 'checking' && <p className="cover-note" role="status">Cover arriving from the archive…</p>}
                  {album.coverStatus === 'missing' && <p className="cover-note">No archive cover—showing an artist-inspired fallback. Add a custom HTTPS URL if you have one.</p>}
                  {album.coverStatus === 'error' && (
                    <p className="cover-note">Cover check failed. <button className="text-button" type="button" onClick={() => album.releaseGroupId && resolveCover(album.id, album.releaseGroupId, true)}>Retry cover</button></p>
                  )}
                  {errors[album.id] && <p className="field-error" role="alert">{errors[album.id]}</p>}
                  {(results[album.id]?.length ?? 0) > 0 && (
                    <div className="candidate-list" aria-label={`Matches for ${album.title}`}>
                      <p><strong>The catalog is unsure.</strong> Pick the sleeve that feels right.</p>
                      {results[album.id].map((candidate) => (
                        <button type="button" key={candidate.id} onClick={() => selectMatch(album, candidate)}>
                          <AlbumArt src={candidate.coverUrl} title={candidate.title} artist={candidate.artist} fallback="artist" />
                          <span><strong>{candidate.title}</strong><small>{candidate.artist}{candidate.year ? ` · ${candidate.year}` : ''} · {Math.round(candidate.confidence * 100)}% confidence</small></span>
                          <i>{candidate.weak ? 'Low confidence' : 'Choose'}</i>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </motion.article>
          )
        })}
      </div>

      <div className="page-actions sticky-actions">
        <p>{collection.albums.length} unique albums · Minimum 2, maximum 100</p>
        <button className="button button--primary" type="button" disabled={collection.albums.length < 2 || collection.albums.length > 100 || duplicates.size > 0 || invalidCover} onClick={onContinue}>
          Choose ranking mode →
        </button>
      </div>
    </div>
  )
}

interface ModeProps {
  collection: Collection
  paceSamples: number[]
  onBack: () => void
  onStart: (mode: RankingMode) => void
}

function ModeScreen({ collection, paceSamples, onBack, onStart }: ModeProps) {
  const [selected, setSelected] = useState<RankingMode>('balanced')
  return (
    <div className="page constrained-page mode-page">
      <button className="back-button" type="button" onClick={onBack}>← Review records</button>
      <div className="page-title page-title--center">
        <p className="eyebrow">03 · Set the listening depth</p>
        <h1>How certain do you<br />want to <em>feel?</em></h1>
        <p>You can pick a new mode before every run. Every battle requires an A-or-B choice.</p>
      </div>
      {collection.albums.length > 40 && <div className="long-list-warning"><strong>A substantial listening pile.</strong> Thorough mode needs {battleCount('thorough', collection.albums.length).toLocaleString()} choices; consider Quick or Balanced.</div>}
      <div className="mode-grid" role="radiogroup" aria-label="Ranking mode">
        {MODE_DETAILS.map((mode) => {
          const count = battleCount(mode.id, collection.albums.length)
          const duration = formatDuration(estimateRemainingMs(count, paceSamples))
          return (
            <button
              type="button"
              role="radio"
              aria-checked={selected === mode.id}
              className={`mode-card ${selected === mode.id ? 'mode-card--selected' : ''}`}
              key={mode.id}
              onClick={() => setSelected(mode.id)}
            >
              {mode.recommended && <span className="recommended">Recommended</span>}
              <span className="mode-check" aria-hidden="true">{selected === mode.id ? '●' : '○'}</span>
              <p className="eyebrow">{mode.eyebrow}</p>
              <h2>{mode.name}</h2>
              <p>{mode.description}</p>
              <dl>
                <div><dt>{mode.id === 'balanced' ? 'Up to' : 'Exactly'}</dt><dd>{count.toLocaleString()} battles</dd></div>
                <div><dt>About</dt><dd>{duration}</dd></div>
              </dl>
              <ul><li className="pro">+ {mode.pro}</li><li className="con">− {mode.con}</li></ul>
            </button>
          )
        })}
      </div>
      <div className="page-actions page-actions--center">
        <p>Initial order, matchup order, and left/right placement are randomized with a saved seed.</p>
        <button className="button button--primary button--large" type="button" onClick={() => onStart(selected)}>Begin {MODE_DETAILS.find((mode) => mode.id === selected)?.name} battle →</button>
      </div>
    </div>
  )
}

interface BattleProps {
  collection: Collection
  run: BattleRun
  paceSamples: number[]
  onChoose: (winnerId: string, loserId: string, durationMs: number, pageVisible: boolean) => void
  onUndo: () => void
  onRestart: () => void
  onExit: () => void
}

function BattleScreen({ collection, run, paceSamples, onChoose, onUndo, onRestart, onExit }: BattleProps) {
  const reduceMotion = useReducedMotion()
  const battle = useMemo(() => getBattleState(run.mode, collection.albums.map((album) => album.id), run.seed, run.decisions), [collection.albums, run])
  const startedAt = useRef(Date.now())
  const selectionTimer = useRef<number | undefined>(undefined)
  const [selection, setSelection] = useState<{ winnerId: string; decisionIndex: number }>()
  const albumMap = useMemo(() => new Map(collection.albums.map((album) => [album.id, album])), [collection.albums])
  const left = battle.matchup ? albumMap.get(battle.matchup.leftId) : undefined
  const right = battle.matchup ? albumMap.get(battle.matchup.rightId) : undefined
  const completed = battle.completedComparisons
  const remaining = Math.max(0, battle.totalComparisons - completed)
  const progress = battle.totalComparisons ? Math.min(100, (completed / battle.totalComparisons) * 100) : 100

  useEffect(() => { startedAt.current = Date.now() }, [run.decisions.length])

  const activeSelection = selection?.decisionIndex === run.decisions.length ? selection : undefined

  const choose = useCallback((winner: Album, loser: Album) => {
    if (selection?.decisionIndex === run.decisions.length) return
    const durationMs = Date.now() - startedAt.current
    const pageVisible = document.visibilityState === 'visible'
    setSelection({ winnerId: winner.id, decisionIndex: run.decisions.length })
    const commit = () => onChoose(winner.id, loser.id, durationMs, pageVisible)
    if (reduceMotion) commit()
    else selectionTimer.current = window.setTimeout(commit, 260)
  }, [onChoose, reduceMotion, run.decisions.length, selection])

  useEffect(() => () => {
    if (selectionTimer.current) window.clearTimeout(selectionTimer.current)
  }, [])

  useEffect(() => {
    const keyHandler = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (event.target instanceof Element && event.target.matches('input, textarea, select')) return
      if ((event.key === 'ArrowLeft' || event.key === '1') && left && right) {
        event.preventDefault()
        choose(left, right)
      }
      if ((event.key === 'ArrowRight' || event.key === '2') && left && right) {
        event.preventDefault()
        choose(right, left)
      }
    }
    window.addEventListener('keydown', keyHandler)
    return () => window.removeEventListener('keydown', keyHandler)
  }, [choose, left, right])

  if (!left || !right) return <div className="page battle-page"><p>Preparing your ranking…</p></div>

  return (
    <div className="page battle-page">
      <div className="battle-topbar">
        <button className="back-button back-button--light" type="button" onClick={onExit}>← Save & exit</button>
        <div><strong>{collection.name}</strong><span>{MODE_DETAILS.find((mode) => mode.id === run.mode)?.name} mode</span></div>
        <div className="battle-utilities">
          <button className="undo-button" type="button" disabled={!run.decisions.length} onClick={onUndo}>↶ Undo</button>
          <button className="undo-button" type="button" onClick={onRestart}>Restart</button>
        </div>
      </div>
      <div className="battle-progress">
        <div className="battle-progress__labels"><span>Battle {completed + 1} <i>of {battle.totalComparisons}{run.mode === 'balanced' ? ' max' : ''}</i></span><span>About {formatDuration(estimateRemainingMs(remaining, paceSamples))} left</span></div>
        <div className="progress-track"><motion.div animate={{ width: `${progress}%` }} transition={{ duration: 0.3 }} /></div>
      </div>
      <div className="sr-only" aria-live="polite">Choose between {left.title} by {left.artist} and {right.title} by {right.artist}.</div>

      <div className="battle-prompt">
        <p className="eyebrow">Trust your instinct</p>
        <h1>Which record comes <em>first?</em></h1>
        <p>Choose the album you’d rather own next. There are no ties.</p>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          className="matchup"
          key={`${run.id}-${run.decisions.length}`}
          initial={{ opacity: 0, y: 22, filter: 'blur(7px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, scale: 0.97, filter: 'blur(5px)' }}
          transition={{ duration: 0.32 }}
        >
          <motion.button
            className="choice-card"
            type="button"
            aria-keyshortcuts="ArrowLeft 1"
            disabled={Boolean(activeSelection)}
            onClick={() => choose(left, right)}
            animate={activeSelection ? activeSelection.winnerId === left.id ? { x: 20, y: -12, scale: 1.045, rotate: -1.1, opacity: 1 } : { x: -70, scale: .92, rotate: -2, opacity: .14 } : { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            whileHover={{ y: -10, rotate: -.6, scale: 1.015 }}
            whileTap={{ scale: 0.985 }}
          >
            <span className="choice-key">1 · ←</span>
            <AlbumArt src={left.coverUrl} title={left.title} artist={left.artist} />
            <span className="choice-copy"><strong>{left.title}</strong><small>{left.artist}{left.year ? ` · ${left.year}` : ''}</small><i>Choose this record</i></span>
          </motion.button>
          <motion.span className="versus" aria-hidden="true" animate={activeSelection ? { scale: 0, rotate: 180, opacity: 0 } : { scale: 1, rotate: 0, opacity: 1 }}>or</motion.span>
          <motion.button
            className="choice-card"
            type="button"
            aria-keyshortcuts="ArrowRight 2"
            disabled={Boolean(activeSelection)}
            onClick={() => choose(right, left)}
            animate={activeSelection ? activeSelection.winnerId === right.id ? { x: -20, y: -12, scale: 1.045, rotate: 1.1, opacity: 1 } : { x: 70, scale: .92, rotate: 2, opacity: .14 } : { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            whileHover={{ y: -10, rotate: .6, scale: 1.015 }}
            whileTap={{ scale: 0.985 }}
          >
            <span className="choice-key">2 · →</span>
            <AlbumArt src={right.coverUrl} title={right.title} artist={right.artist} />
            <span className="choice-copy"><strong>{right.title}</strong><small>{right.artist}{right.year ? ` · ${right.year}` : ''}</small><i>Choose this record</i></span>
          </motion.button>
        </motion.div>
      </AnimatePresence>
      <p className="keyboard-hint">Keyboard: <kbd>←</kbd> / <kbd>1</kbd> for left · <kbd>→</kbd> / <kbd>2</kbd> for right</p>
    </div>
  )
}

interface ResultsProps {
  collection: Collection
  run: BattleRun
  onHome: () => void
  onAgain: () => void
  onUndo: () => void
}

function ResultsScreen({ collection, run, onHome, onAgain, onUndo }: ResultsProps) {
  const albumMap = new Map((run.albumSnapshot ?? collection.albums).map((album) => [album.id, album]))
  const ranking = (run.finalRanking ?? []).map((id) => albumMap.get(id)).filter((album): album is Album => Boolean(album))
  return (
    <div className="page results-page constrained-page">
      <div className="results-hero">
        <p className="eyebrow">The final sequence</p>
        <h1 aria-label="Your next record is clear.">Your next record<br />is <em>clear.</em></h1>
        <p>{run.decisions.length} choices shaped this {MODE_DETAILS.find((mode) => mode.id === run.mode)?.name.toLowerCase()} ranking for {collection.name}.</p>
      </div>
      <ol className="ranking-list">
        {ranking.map((album, index) => (
          <motion.li key={album.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.045, 0.5) }}>
            <span className="rank-number">{String(index + 1).padStart(2, '0')}</span>
            <AlbumArt src={album.coverUrl} title={album.title} artist={album.artist} />
            <span><strong>{album.title}</strong><small>{album.artist}{album.year ? ` · ${album.year}` : ''}</small></span>
            {index === 0 && <i className="top-pick">Top pick</i>}
          </motion.li>
        ))}
      </ol>
      <div className="results-actions">
        <button className="button button--primary" type="button" onClick={onAgain}>Rank again</button>
        <button className="button button--outline" type="button" onClick={onHome}>Back to collections</button>
        <button className="text-button" type="button" onClick={onUndo}>↶ Undo last choice</button>
      </div>
    </div>
  )
}

export default function App() {
  const { state, setState, notice, clearNotice } = usePersistentState()
  const [screen, setScreen] = useState<Screen>('library')
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | undefined>(state.currentCollectionId)
  const [resultRunId, setResultRunId] = useState<string>()
  const client = useMemo(() => new MusicBrainzClient(), [])
  const selectedCollection = state.collections.find((collection) => collection.id === selectedCollectionId)

  const goHome = () => {
    setScreen('library')
    setResultRunId(undefined)
  }

  const updateCollection = useCallback((id: string, updater: (collection: Collection) => Collection) => {
    setState((current) => ({
      ...current,
      currentCollectionId: id,
      collections: current.collections.map((collection) => collection.id === id ? updater(collection) : collection),
    }))
  }, [setState])

  const selectAndOpen = (id: string, nextScreen: Screen) => {
    setSelectedCollectionId(id)
    setState((current) => ({ ...current, currentCollectionId: id }))
    setScreen(nextScreen)
  }

  const createCollection = (name: string, vibe?: string, note?: string) => {
    const timestamp = nowIso()
    const collection: Collection = { id: makeId('collection'), name, vibe, note, albums: [], createdAt: timestamp, updatedAt: timestamp, completedRuns: [] }
    setState((current) => ({ ...current, collections: [...current.collections, collection], currentCollectionId: collection.id }))
    setSelectedCollectionId(collection.id)
    setScreen('import')
  }

  const startRun = (mode: RankingMode) => {
    if (!selectedCollection) return
    const timestamp = nowIso()
    const run: BattleRun = {
      id: makeId('run'), mode, seed: makeSeed(), decisions: [], status: 'active', createdAt: timestamp, updatedAt: timestamp, paceSamples: [],
    }
    updateCollection(selectedCollection.id, (collection) => ({ ...collection, activeRun: run, updatedAt: timestamp }))
    setScreen('battle')
  }

  const chooseAlbum = (winnerId: string, loserId: string, durationMs: number, pageVisible: boolean) => {
    if (!selectedCollection?.activeRun) return
    const currentRun = selectedCollection.activeRun
    const timestamp = nowIso()
    const decision = { winnerId, loserId, durationMs, chosenAt: timestamp }
    const decisions = [...currentRun.decisions, decision]
    const paceSamples = appendPaceSample(currentRun.paceSamples, durationMs, pageVisible)
    const nextBattle = getBattleState(currentRun.mode, selectedCollection.albums.map((album) => album.id), currentRun.seed, decisions)
    const nextRun: BattleRun = { ...currentRun, decisions, paceSamples, updatedAt: timestamp }

    setState((current) => ({
      ...current,
      learnedPaceSamples: appendPaceSample(current.learnedPaceSamples, durationMs, pageVisible),
      collections: current.collections.map((collection) => {
        if (collection.id !== selectedCollection.id) return collection
        if (nextBattle.complete) {
          const completedRun: BattleRun = { ...nextRun, status: 'completed', completedAt: timestamp, finalRanking: nextBattle.ranking, albumSnapshot: selectedCollection.albums }
          return { ...collection, activeRun: undefined, completedRuns: [...collection.completedRuns, completedRun], updatedAt: timestamp }
        }
        return { ...collection, activeRun: nextRun, updatedAt: timestamp }
      }),
    }))

    if (nextBattle.complete) {
      setResultRunId(currentRun.id)
      setScreen('results')
    }
  }

  const undoActive = () => {
    if (!selectedCollection?.activeRun?.decisions.length) return
    const timestamp = nowIso()
    updateCollection(selectedCollection.id, (collection) => ({
      ...collection,
      updatedAt: timestamp,
      activeRun: collection.activeRun ? { ...collection.activeRun, decisions: collection.activeRun.decisions.slice(0, -1), updatedAt: timestamp } : undefined,
    }))
  }

  const resultRun = selectedCollection?.completedRuns.find((run) => run.id === resultRunId)

  const undoCompleted = () => {
    if (!selectedCollection || !resultRun || !resultRun.decisions.length) return
    const timestamp = nowIso()
    const activeRun: BattleRun = { ...resultRun, status: 'active', completedAt: undefined, finalRanking: undefined, albumSnapshot: undefined, decisions: resultRun.decisions.slice(0, -1), updatedAt: timestamp }
    updateCollection(selectedCollection.id, (collection) => ({
      ...collection,
      activeRun,
      completedRuns: collection.completedRuns.filter((run) => run.id !== resultRun.id),
      updatedAt: timestamp,
    }))
    setResultRunId(undefined)
    setScreen('battle')
  }

  let content: React.ReactNode
  if (screen === 'library') {
    content = (
      <LibraryScreen
        collections={state.collections}
        onCreate={createCollection}
        onRename={(id, name) => updateCollection(id, (collection) => ({ ...collection, name, updatedAt: nowIso() }))}
        onDelete={(id) => {
          const collection = state.collections.find((item) => item.id === id)
          if (!collection || !window.confirm(`Delete “${collection.name}” and its ranking history?`)) return
          setState((current) => ({ ...current, collections: current.collections.filter((item) => item.id !== id), currentCollectionId: current.currentCollectionId === id ? undefined : current.currentCollectionId }))
          if (selectedCollectionId === id) setSelectedCollectionId(undefined)
        }}
        onImport={(id) => selectAndOpen(id, 'import')}
        onRank={(id) => selectAndOpen(id, 'mode')}
        onResume={(id) => selectAndOpen(id, 'battle')}
        onViewRun={(collectionId, runId) => { setSelectedCollectionId(collectionId); setResultRunId(runId); setScreen('results') }}
      />
    )
  } else if (!selectedCollection) {
    content = <div className="page constrained-page"><h1>Collection not found</h1><button className="button" type="button" onClick={goHome}>Return to library</button></div>
  } else if (screen === 'import') {
    content = <ImportScreen collection={selectedCollection} onBack={goHome} onContinue={(albums) => { updateCollection(selectedCollection.id, (collection) => ({ ...collection, albums, activeRun: undefined, updatedAt: nowIso() })); setScreen('review') }} />
  } else if (screen === 'review') {
    content = (
      <ReviewScreen
        collection={selectedCollection}
        client={client}
        onBack={() => setScreen('import')}
        onChange={(albumId, update) => updateCollection(selectedCollection.id, (collection) => ({ ...collection, albums: collection.albums.map((album) => album.id === albumId ? { ...album, ...update } : album), updatedAt: nowIso() }))}
        onRemove={(albumId) => updateCollection(selectedCollection.id, (collection) => ({ ...collection, albums: collection.albums.filter((album) => album.id !== albumId), activeRun: undefined, updatedAt: nowIso() }))}
        onContinue={() => setScreen('mode')}
      />
    )
  } else if (screen === 'mode') {
    content = <ModeScreen collection={selectedCollection} paceSamples={state.learnedPaceSamples} onBack={() => setScreen('review')} onStart={startRun} />
  } else if (screen === 'battle' && selectedCollection.activeRun) {
    content = <BattleScreen collection={selectedCollection} run={selectedCollection.activeRun} paceSamples={state.learnedPaceSamples} onChoose={chooseAlbum} onUndo={undoActive} onRestart={() => { if (window.confirm('Restart this run? Your saved choices from this run will be cleared.')) startRun(selectedCollection.activeRun!.mode) }} onExit={goHome} />
  } else if (screen === 'results' && resultRun) {
    content = <ResultsScreen collection={selectedCollection} run={resultRun} onHome={goHome} onAgain={() => setScreen('mode')} onUndo={undoCompleted} />
  } else {
    content = <div className="page constrained-page"><h1>Nothing to resume</h1><button className="button" type="button" onClick={goHome}>Return to library</button></div>
  }

  const darkHeader = screen === 'battle'
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.24, ease: 'easeOut' }}>
      <div className={`app ${darkHeader ? 'app--battle' : ''} ${screen === 'library' ? 'app--library' : ''}`}>
        {screen !== 'battle' && (
          <Header
            onHome={goHome}
            trailing={screen === 'library'
              ? <span className="library-save-status">{state.collections.length} {state.collections.length === 1 ? 'collection' : 'collections'} · saved on this device</span>
              : selectedCollection ? <span>{selectedCollection.name}</span> : undefined}
          />
        )}
        <AnimatePresence mode="wait">
          <motion.main key={screen} {...pageMotion}>{content}</motion.main>
        </AnimatePresence>
        {screen !== 'battle' && <Footer />}
        {notice && <div className="toast" role="status"><span>{notice}</span><button type="button" onClick={clearNotice} aria-label="Dismiss notice">×</button></div>}
      </div>
    </MotionConfig>
  )
}
