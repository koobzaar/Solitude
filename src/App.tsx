import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlbumArt } from './components/AlbumArt'
import { Footer, Header } from './components/Shell'
import { albumCoverUrl, firstCollectionAlbums, firstLibraryAlbums } from './lib/home'
import { makeId, makeSeed } from './lib/id'
import { normalizeValue, parseAlbumList } from './lib/importParser'
import { MusicBrainzClient, automaticMatch, chooseCanonicalEdition } from './lib/musicbrainz'
import { loadNavigation, saveNavigation } from './lib/navigation'
import type { Screen } from './lib/navigation'
import { appendPaceSample, estimateRemainingMs, formatDuration } from './lib/pace'
import { MODE_DETAILS, battleCount, getBattleState } from './lib/ranking'
import { albumProfileKey, blendedScores, buildTrackAnalysisSnapshot, DEFAULT_HEART_WEIGHT, findDisagreements, validateManualSummary } from './lib/trackAnalysis'
import type { Album, AlbumTrackProfile, BattleDecision, BattleRun, CatalogCandidate, Collection, ManualTrackSummary, RankingMode, TrackCatalogEntry, TrackEdition } from './lib/types'
import { BATTLE_ALGORITHM_VERSION } from './lib/types'
import { usePersistentState } from './lib/usePersistentState'

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
                <p>Every ranking is built from moments like this—pick the one you’d rather own next, or call it even.</p>
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
  initialDraft?: string
  initialSwapColumns?: boolean
  onDraftChange: (draft: string, swapColumns: boolean) => void
  onBack: () => void
  onContinue: (albums: Album[]) => void
}

function ImportScreen({ collection, initialDraft, initialSwapColumns = false, onDraftChange, onBack, onContinue }: ImportProps) {
  const [input, setInput] = useState(() => initialDraft ?? collection.albums.map((album) => `${album.title} - ${album.artist}`).join('\n'))
  const [swapColumns, setSwapColumns] = useState(initialSwapColumns)
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
            onChange={(event) => { setInput(event.target.value); onDraftChange(event.target.value, swapColumns) }}
            placeholder={'Blue Train - John Coltrane\nKind of Blue — Miles Davis\nPromises by Floating Points & Pharoah Sanders'}
            spellCheck="false"
          />
          <label className="switch-row">
            <input type="checkbox" checked={swapColumns} onChange={(event) => { setSwapColumns(event.target.checked); onDraftChange(input, event.target.checked) }} />
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
  selected: RankingMode
  onSelected: (mode: RankingMode) => void
  onBack: () => void
  onStart: (mode: RankingMode) => void
}

function ModeScreen({ collection, paceSamples, selected, onSelected, onBack, onStart }: ModeProps) {
  return (
    <div className="page constrained-page mode-page">
      <button className="back-button" type="button" onClick={onBack}>← Review records</button>
      <div className="page-title page-title--center">
        <p className="eyebrow">03 · Set the listening depth</p>
        <h1>How certain do you<br />want to <em>feel?</em></h1>
        <p>You can pick a new mode before every run. Choose either record, or call it a tie when neither comes first.</p>
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
              onClick={() => onSelected(mode.id)}
            >
              {mode.recommended && <span className="recommended">Recommended</span>}
              <span className="mode-check" aria-hidden="true">{selected === mode.id ? '●' : '○'}</span>
              <p className="eyebrow">{mode.eyebrow}</p>
              <h2>{mode.name}</h2>
              <p>{mode.description}</p>
              <dl>
                <div><dt>Exactly</dt><dd>{count.toLocaleString()} battles</dd></div>
                <div><dt>About</dt><dd>{duration}</dd></div>
              </dl>
              <ul><li className="pro">+ {mode.pro}</li><li className="con">− {mode.con}</li></ul>
            </button>
          )
        })}
      </div>
      <div className="page-actions page-actions--center">
        <p>Initial order, adaptive tie-breaks, and left/right placement are randomized with a saved seed.</p>
        <button className="button button--primary button--large" type="button" onClick={() => onStart(selected)}>Begin {MODE_DETAILS.find((mode) => mode.id === selected)?.name} battle →</button>
      </div>
    </div>
  )
}

interface BattleProps {
  collection: Collection
  run: BattleRun
  paceSamples: number[]
  onChoose: (winnerId: string, loserId: string, outcome: NonNullable<BattleDecision['outcome']>, durationMs: number, pageVisible: boolean) => void
  onUndo: () => void
  onRestart: () => void
  onExit: () => void
}

function BattleScreen({ collection, run, paceSamples, onChoose, onUndo, onRestart, onExit }: BattleProps) {
  const reduceMotion = useReducedMotion()
  const battle = useMemo(() => getBattleState(run.mode, collection.albums.map((album) => album.id), run.seed, run.decisions), [collection.albums, run])
  const startedAt = useRef(Date.now())
  const selectionTimer = useRef<number | undefined>(undefined)
  const pendingSelection = useRef(false)
  const [selection, setSelection] = useState<{ outcome: NonNullable<BattleDecision['outcome']>; winnerId?: string; decisionIndex: number }>()
  const albumMap = useMemo(() => new Map(collection.albums.map((album) => [album.id, album])), [collection.albums])
  const left = battle.matchup ? albumMap.get(battle.matchup.leftId) : undefined
  const right = battle.matchup ? albumMap.get(battle.matchup.rightId) : undefined
  const completed = battle.completedComparisons
  const remaining = Math.max(0, battle.totalComparisons - completed)
  const progress = battle.totalComparisons ? Math.min(100, (completed / battle.totalComparisons) * 100) : 100

  const cancelPendingSelection = useCallback(() => {
    if (selectionTimer.current !== undefined) window.clearTimeout(selectionTimer.current)
    selectionTimer.current = undefined
    pendingSelection.current = false
    setSelection(undefined)
  }, [])

  useEffect(() => {
    cancelPendingSelection()
    startedAt.current = Date.now()
    return cancelPendingSelection
  }, [cancelPendingSelection, run.id, run.decisions.length])

  const activeSelection = selection?.decisionIndex === run.decisions.length ? selection : undefined

  const choose = useCallback((first: Album, second: Album, outcome: NonNullable<BattleDecision['outcome']>) => {
    if (pendingSelection.current) return
    pendingSelection.current = true
    const durationMs = Date.now() - startedAt.current
    const pageVisible = document.visibilityState === 'visible'
    setSelection({ outcome, winnerId: outcome === 'win' ? first.id : undefined, decisionIndex: run.decisions.length })
    const commit = () => {
      selectionTimer.current = undefined
      onChoose(first.id, second.id, outcome, durationMs, pageVisible)
    }
    if (reduceMotion) commit()
    else selectionTimer.current = window.setTimeout(commit, 260)
  }, [onChoose, reduceMotion, run.decisions.length])

  useEffect(() => {
    const keyHandler = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (event.target instanceof Element && event.target.matches('input, textarea, select')) return
      if ((event.key === 'ArrowLeft' || event.key === '1') && left && right) {
        event.preventDefault()
        choose(left, right, 'win')
      }
      if ((event.key === 'ArrowRight' || event.key === '2') && left && right) {
        event.preventDefault()
        choose(right, left, 'win')
      }
      if (event.key === '0' && left && right) {
        event.preventDefault()
        choose(left, right, 'tie')
      }
    }
    window.addEventListener('keydown', keyHandler)
    return () => window.removeEventListener('keydown', keyHandler)
  }, [choose, left, right])

  if (!left || !right) return <div className="page battle-page"><p>Preparing your ranking…</p></div>

  return (
    <div className="page battle-page">
      <div className="battle-topbar">
        <button className="back-button back-button--light" type="button" disabled={Boolean(activeSelection)} onClick={() => { cancelPendingSelection(); onExit() }}>← Save & exit</button>
        <div><strong>{collection.name}</strong><span>{MODE_DETAILS.find((mode) => mode.id === run.mode)?.name} mode</span></div>
        <div className="battle-utilities">
          <button className="undo-button" type="button" disabled={!run.decisions.length || Boolean(activeSelection)} onClick={() => { cancelPendingSelection(); onUndo() }}>↶ Undo</button>
          <button className="undo-button" type="button" disabled={Boolean(activeSelection)} onClick={() => { cancelPendingSelection(); onRestart() }}>Restart</button>
        </div>
      </div>
      <div className="battle-progress">
        <div className="battle-progress__labels"><span>Battle {completed + 1} <i>of {battle.totalComparisons}</i></span><span>About {formatDuration(estimateRemainingMs(remaining, paceSamples))} left</span></div>
        <div className="progress-track"><motion.div animate={{ width: `${progress}%` }} transition={{ duration: 0.3 }} /></div>
      </div>
      <div className="sr-only" aria-live="polite">Choose between {left.title} by {left.artist} and {right.title} by {right.artist}.</div>

      <div className="battle-prompt">
        <p className="eyebrow">Trust your instinct</p>
        <h1>Which record comes <em>first?</em></h1>
        <p>Choose the album you’d rather own next, or call it even when neither comes first.</p>
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
            onClick={() => choose(left, right, 'win')}
            animate={activeSelection ? activeSelection.outcome === 'tie' ? { x: 12, y: -5, scale: .985, rotate: 0, opacity: .72 } : activeSelection.winnerId === left.id ? { x: 20, y: -12, scale: 1.045, rotate: -1.1, opacity: 1 } : { x: -70, scale: .92, rotate: -2, opacity: .14 } : { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            whileHover={{ y: -10, rotate: -.6, scale: 1.015 }}
            whileTap={{ scale: 0.985 }}
          >
            <span className="choice-key">1 · ←</span>
            <AlbumArt src={left.coverUrl} title={left.title} artist={left.artist} />
            <span className="choice-copy"><strong>{left.title}</strong><small>{left.artist}{left.year ? ` · ${left.year}` : ''}</small><i>Choose this record</i></span>
          </motion.button>
          <motion.span className="versus" aria-hidden="true" animate={activeSelection?.outcome === 'win' ? { scale: 0, rotate: 180, opacity: 0 } : activeSelection?.outcome === 'tie' ? { scale: 1.12, rotate: 0, opacity: 1 } : { scale: 1, rotate: 0, opacity: 1 }}>or</motion.span>
          <motion.button
            className="choice-card"
            type="button"
            aria-keyshortcuts="ArrowRight 2"
            disabled={Boolean(activeSelection)}
            onClick={() => choose(right, left, 'win')}
            animate={activeSelection ? activeSelection.outcome === 'tie' ? { x: -12, y: -5, scale: .985, rotate: 0, opacity: .72 } : activeSelection.winnerId === right.id ? { x: -20, y: -12, scale: 1.045, rotate: 1.1, opacity: 1 } : { x: 70, scale: .92, rotate: 2, opacity: .14 } : { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 }}
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
      <motion.button
        className="tie-button"
        type="button"
        aria-keyshortcuts="0"
        disabled={Boolean(activeSelection)}
        onClick={() => choose(left, right, 'tie')}
        animate={activeSelection?.outcome === 'tie' ? { scale: 1.04, opacity: 1 } : { scale: 1, opacity: activeSelection ? .35 : 1 }}
        whileHover={{ y: -2 }}
        whileTap={{ scale: .98 }}
      >
        <kbd>0</kbd>
        <span>Can’t decide</span>
      </motion.button>
      <p className="keyboard-hint">Keyboard: <kbd>←</kbd> / <kbd>1</kbd> for left · <kbd>0</kbd> for a tie · <kbd>→</kbd> / <kbd>2</kbd> for right</p>
    </div>
  )
}

interface TrackDraft {
  editionId?: string
  likedTrackIds: string[]
  manualSummary?: ManualTrackSummary
}

interface TrackReviewProps {
  collection: Collection
  run: BattleRun
  client: MusicBrainzClient
  profiles: Record<string, AlbumTrackProfile>
  currentAlbumId?: string
  onCurrentAlbum: (albumId: string) => void
  onCommit: (album: Album, profile: AlbumTrackProfile, complete: boolean) => void
  onExit: () => void
}

function TrackReviewScreen({ collection, run, client, profiles, currentAlbumId, onCurrentAlbum, onCommit, onExit }: TrackReviewProps) {
  const albums = run.albumSnapshot ?? collection.albums
  const initialIndex = Math.max(0, albums.findIndex((album) => album.id === currentAlbumId))
  const [index, setIndex] = useState(initialIndex)
  const album = albums[index]
  const profile = album ? profiles[albumProfileKey(album)] : undefined
  const [catalog, setCatalog] = useState<TrackCatalogEntry>()
  const [draft, setDraft] = useState<TrackDraft>({ likedTrackIds: [] })
  const [manualMode, setManualMode] = useState(() => Boolean(profile?.manualSummary || !album?.releaseGroupId))
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!album) return
    const existing = profiles[albumProfileKey(album)]
    setDraft({
      editionId: existing?.editionId,
      likedTrackIds: [...(existing?.likedTrackIds ?? [])],
      manualSummary: existing?.manualSummary ? { ...existing.manualSummary } : undefined,
    })
    setManualMode(Boolean(existing?.manualSummary || !album.releaseGroupId))
    setCatalog(undefined)
    setError(undefined)
    onCurrentAlbum(album.id)
    if (!album.releaseGroupId) return
    let cancelled = false
    setLoading(true)
    void client.editions(album.releaseGroupId).then((result) => {
      if (cancelled) return
      setCatalog(result)
      setDraft((current) => ({ ...current, editionId: current.editionId ?? chooseCanonicalEdition(result.editions)?.id }))
      if (!result.editions.length) setManualMode(true)
    }).catch((reason: unknown) => {
      if (cancelled) return
      setError(reason instanceof Error ? reason.message : 'No tracklist could be loaded.')
      setManualMode(true)
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [album?.id, client])

  if (!album) {
    return <div className="page constrained-page"><h1>No albums to review</h1><button className="button" type="button" onClick={onExit}>Return to results</button></div>
  }

  const profileEdition: TrackEdition | undefined = profile?.editionId && profile.tracks.length ? {
    id: profile.editionId,
    title: profile.editionTitle ?? album.title,
    trackCount: profile.tracks.length,
    tracks: profile.tracks,
  } : undefined
  const editions = [...(catalog?.editions ?? [])]
  if (profileEdition && !editions.some((edition) => edition.id === profileEdition.id)) editions.push(profileEdition)
  const selectedEdition = editions.find((edition) => edition.id === draft.editionId) ?? chooseCanonicalEdition(editions)
  const manualSummary = draft.manualSummary ?? { trackCount: 0, likedCount: 0 }
  const manualError = manualMode ? validateManualSummary(manualSummary) : undefined
  const canCommit = manualMode ? !manualError : Boolean(selectedEdition?.tracks.length)

  const toggleLike = (trackId: string) => {
    setDraft((current) => {
      const likedTrackIds = current.likedTrackIds.includes(trackId)
        ? current.likedTrackIds.filter((id) => id !== trackId)
        : [...current.likedTrackIds, trackId]
      return { ...current, likedTrackIds }
    })
  }

  const commit = (skipped: boolean) => {
    const timestamp = nowIso()
    const key = albumProfileKey(album)
    const nextProfile: AlbumTrackProfile = skipped ? {
      albumKey: key,
      releaseGroupId: album.releaseGroupId,
      tracks: [],
      likedTrackIds: [],
      reviewState: 'skipped',
      updatedAt: timestamp,
    } : manualMode ? {
      albumKey: key,
      releaseGroupId: album.releaseGroupId,
      tracks: [],
      likedTrackIds: [],
      manualSummary,
      reviewState: 'reviewed',
      updatedAt: timestamp,
    } : {
      albumKey: key,
      releaseGroupId: album.releaseGroupId,
      editionId: selectedEdition?.id,
      editionTitle: selectedEdition?.title,
      tracks: selectedEdition?.tracks ?? [],
      likedTrackIds: draft.likedTrackIds,
      reviewState: 'reviewed',
      updatedAt: timestamp,
    }
    const complete = index === albums.length - 1
    onCommit(album, nextProfile, complete)
    if (!complete) {
      const nextIndex = index + 1
      setIndex(nextIndex)
      onCurrentAlbum(albums[nextIndex].id)
    }
  }

  const loadMore = async () => {
    if (!album.releaseGroupId || !catalog?.hasMore) return
    setLoadingMore(true)
    setError(undefined)
    try {
      const page = await client.editions(album.releaseGroupId, catalog.offset)
      const byId = new Map([...catalog.editions, ...page.editions].map((edition) => [edition.id, edition]))
      setCatalog({ ...page, editions: [...byId.values()] })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'More editions could not be loaded.')
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="page constrained-page track-review-page">
      <div className="track-review-topbar">
        <button className="back-button" type="button" onClick={onExit}>← Save & return to results</button>
        <span>{index + 1} of {albums.length}</span>
      </div>
      <div className="track-review-heading">
        <p className="eyebrow">A closer listen · optional</p>
        <h1 aria-label="Keep the songs that stay with you.">Keep the songs that<br /><em>stay with you.</em></h1>
        <p>Untouched songs are neutral. Select the heart for any song you like; songs are never ranked against one another.</p>
      </div>
      <section className="track-review-card" aria-labelledby="track-album-title">
        <div className="track-review-sleeve">
          <AlbumArt src={album.coverUrl} title={album.title} artist={album.artist} />
          <span>{String(index + 1).padStart(2, '0')}</span>
        </div>
        <div className="track-review-content">
          <div className="track-review-album">
            <div><h2 id="track-album-title">{album.title}</h2><p>{album.artist}{album.year ? ` · ${album.year}` : ''}</p></div>
            {!manualMode && editions.length > 0 && (
              <label className="edition-select">Edition
                <select value={selectedEdition?.id ?? ''} onChange={(event) => setDraft({ editionId: event.target.value, likedTrackIds: [] })}>
                  {editions.map((edition) => <option key={edition.id} value={edition.id}>{edition.title} · {edition.trackCount} tracks{edition.date ? ` · ${edition.date}` : ''}</option>)}
                </select>
              </label>
            )}
          </div>

          {loading ? (
            <div className="tracklist-skeleton" role="status" aria-label="Loading tracklist"><i /><i /><i /><i /><i /></div>
          ) : manualMode ? (
            <div className="manual-track-summary">
              <h3>Enter a simple album summary</h3>
              <p>{error ?? 'Use this when the catalog has no usable edition. Enter how many tracks you like.'}</p>
              <div>
                <label>Total tracks<input aria-label="Total tracks" type="number" min="1" max="999" value={manualSummary.trackCount || ''} onChange={(event) => setDraft((current) => ({ ...current, manualSummary: { ...manualSummary, trackCount: Number(event.target.value) } }))} /></label>
                <label>Liked<input aria-label="Liked tracks" type="number" min="0" max="999" value={manualSummary.likedCount || ''} onChange={(event) => setDraft((current) => ({ ...current, manualSummary: { ...manualSummary, likedCount: Number(event.target.value) } }))} /></label>
              </div>
              {manualError && <p className="field-error" role="alert">{manualError}</p>}
              {editions.length > 0 && <button className="text-button" type="button" onClick={() => setManualMode(false)}>Use the catalog tracklist</button>}
            </div>
          ) : selectedEdition ? (
            <ol className="tracklist">
              {selectedEdition.tracks.map((track) => {
                const liked = draft.likedTrackIds.includes(track.id)
                return (
                  <li key={track.id}>
                    <span>{track.mediumPosition > 1 ? `${track.mediumPosition}.` : ''}{String(track.position).padStart(2, '0')}</span>
                    <strong>{track.title}</strong>
                    <div>
                      <button type="button" className={liked ? 'track-like track-like--active' : 'track-like'} aria-label={`${liked ? 'Unlike' : 'Like'} ${track.title}`} aria-pressed={liked} title={liked ? 'Unlike' : 'Like'} onClick={() => toggleLike(track.id)}><span aria-hidden="true">{liked ? '♥' : '♡'}</span></button>
                    </div>
                  </li>
                )
              })}
            </ol>
          ) : (
            <div className="manual-track-summary"><p>{error ?? 'No usable tracklist was found for this album.'}</p><button className="button button--small" type="button" onClick={() => setManualMode(true)}>Enter totals manually</button></div>
          )}

          <div className="track-review-tools">
            {!manualMode && catalog?.hasMore && <button className="text-button" type="button" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Loading…' : 'More editions'}</button>}
            {!manualMode && <button className="text-button" type="button" onClick={() => setManualMode(true)}>Enter totals manually</button>}
          </div>
          <div className="track-review-actions">
            <button className="button button--outline" type="button" onClick={() => commit(true)}>Skip unheard album</button>
            <button className="button button--primary" type="button" disabled={!canCommit} onClick={() => commit(false)}>{index === albums.length - 1 ? 'Finish song review' : 'Save & next album →'}</button>
          </div>
        </div>
      </section>
      <p className="sr-only" aria-live="polite">Reviewing {album.title} by {album.artist}, album {index + 1} of {albums.length}.</p>
    </div>
  )
}

type ResultsView = 'heart' | 'record' | 'balance'

interface ResultsProps {
  collection: Collection
  run: BattleRun
  onHome: () => void
  onAgain: () => void
  onUndo: () => void
  onTrackReview: () => void
  onWeightChange: (weight: number) => void
}

function ResultsScreen({ collection, run, onHome, onAgain, onUndo, onTrackReview, onWeightChange }: ResultsProps) {
  const albums = run.albumSnapshot ?? collection.albums
  const albumMap = new Map(albums.map((album) => [album.id, album]))
  const heartRanking = (run.finalRanking ?? []).filter((id) => albumMap.has(id))
  const heartScores = run.heartScores ?? Object.fromEntries(heartRanking.map((id, index) => [id, heartRanking.length - index]))
  const analysis = run.trackAnalysis
  const recordScores = analysis?.recordScores ?? {}
  const hasTrackEvidence = Object.keys(recordScores).length > 0
  const [view, setView] = useState<ResultsView>('heart')
  const weight = run.sliderWeight ?? DEFAULT_HEART_WEIGHT
  const heartTie = new Map(heartRanking.map((id, index) => [id, index]))
  const sortByScore = (ids: string[], scores: Record<string, number>) => ids.sort((left, right) => (scores[right] ?? 0) - (scores[left] ?? 0) || (heartTie.get(left) ?? 0) - (heartTie.get(right) ?? 0))
  const reviewedIds = heartRanking.filter((id) => Number.isFinite(recordScores[id]))
  const unreviewedIds = heartRanking.filter((id) => !Number.isFinite(recordScores[id]))
  const balance = blendedScores(heartRanking, heartScores, recordScores, weight)
  const orderedIds = view === 'record'
    ? sortByScore([...reviewedIds], recordScores)
    : view === 'balance' ? sortByScore([...heartRanking], balance) : heartRanking
  const ranking = orderedIds.map((id) => albumMap.get(id)).filter((album): album is Album => Boolean(album))
  const disagreements = hasTrackEvidence ? findDisagreements(heartRanking, heartScores, recordScores) : []
  const isLegacy = run.algorithmVersion !== BATTLE_ALGORITHM_VERSION

  return (
    <div className="page results-page constrained-page">
      <div className="results-hero">
        <p className="eyebrow">The final sequence</p>
        <h1 aria-label="Your next record is clear.">Your next record<br />is <em>clear.</em></h1>
        <p>{run.decisions.length} choices shaped this {MODE_DETAILS.find((mode) => mode.id === run.mode)?.name.toLowerCase()} ranking for {collection.name}.</p>
      </div>

      {isLegacy && <div className="legacy-result"><strong>This ranking uses Solitude’s original model.</strong><p>It stays exactly as you finished it. Rank again when you want a Bradley–Terry result.</p></div>}

      {hasTrackEvidence && (
        <div className="result-controls">
          <div className="result-tabs" role="tablist" aria-label="Ranking view">
            <button role="tab" type="button" aria-selected={view === 'heart'} onClick={() => setView('heart')}>Heart</button>
            <button role="tab" type="button" aria-selected={view === 'record'} onClick={() => setView('record')}>Record value</button>
            <button role="tab" type="button" aria-selected={view === 'balance'} onClick={() => setView('balance')}>Your balance</button>
          </div>
          {view === 'balance' && (
            <label className="balance-slider">Heart <strong>{Math.round(weight * 100)}%</strong>
              <input aria-label="Heart weight" type="range" min="0" max="100" value={Math.round(weight * 100)} onChange={(event) => onWeightChange(Number(event.target.value) / 100)} />
              <span>Songs {Math.round((1 - weight) * 100)}%</span>
            </label>
          )}
          <p className="result-view-note" aria-live="polite">{view === 'heart' ? 'Album choices only.' : view === 'record' ? 'Song evidence with an eight-track shrinkage prior.' : 'Standardized heart and song evidence, blended live.'}</p>
        </div>
      )}

      <ol className="ranking-list">
        {ranking.map((album, index) => (
          <motion.li key={album.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.045, 0.5) }}>
            <span className="rank-number">{String(index + 1).padStart(2, '0')}</span>
            <AlbumArt src={album.coverUrl} title={album.title} artist={album.artist} />
            <span><strong>{album.title}</strong><small>{album.artist}{album.year ? ` · ${album.year}` : ''}</small></span>
            {index === 0 && !hasTrackEvidence && <i className="top-pick">Top pick</i>}
            {hasTrackEvidence && <small className="ranking-score">{view === 'heart' ? `${(heartScores[album.id] ?? 0).toFixed(2)} heart` : view === 'record' ? `${Math.round((recordScores[album.id] ?? 0) * 100)}% record` : `${(balance[album.id] ?? 0).toFixed(2)} balance`}</small>}
          </motion.li>
        ))}
      </ol>

      {view === 'record' && unreviewedIds.length > 0 && (
        <section className="unreviewed-results"><h2>Not reviewed</h2><p>These albums stay outside Record value until you review or enter their songs.</p><ul>{unreviewedIds.map((id) => <li key={id}>{albumMap.get(id)?.title}</li>)}</ul></section>
      )}

      {view === 'balance' && disagreements.length > 0 && (
        <section className="disagreements"><p className="eyebrow">Where heart and songs part ways</p><ul>{disagreements.map((alert) => <li key={`${alert.firstId}:${alert.secondId}`}><strong>{albumMap.get(alert.heartHigherId)?.title}</strong> wins your album battles, while <strong>{albumMap.get(alert.trackHigherId)?.title}</strong> has the stronger song evidence.</li>)}</ul></section>
      )}

      {!isLegacy && !analysis && (
        <section className="track-invitation">
          <p className="eyebrow">One optional encore</p><h2>Go deeper with the songs?</h2>
          <p>Select the heart beside tracks you like to reveal Record value and Your balance. Your heart ranking is already complete and will not be replaced.</p>
          <div><button className="button button--primary" type="button" onClick={onTrackReview}>Review the songs</button><button className="button button--outline" type="button" onClick={onHome}>Keep this ranking</button></div>
        </section>
      )}

      <div className="results-actions">
        <button className="button button--primary" type="button" onClick={onAgain}>{isLegacy ? 'Rank again with the new model' : 'Rank again'}</button>
        {!isLegacy && analysis && <button className="button button--outline" type="button" onClick={onTrackReview}>Review songs</button>}
        <button className="button button--outline" type="button" onClick={onHome}>Back to collections</button>
        {!isLegacy && <button className="text-button" type="button" onClick={onUndo}>↶ Undo last choice</button>}
      </div>
    </div>
  )
}

export default function App() {
  const { state, setState, notice, clearNotice, showNotice } = usePersistentState()
  const [restoredNavigation] = useState(() => loadNavigation(state))
  const [screen, setScreen] = useState<Screen>(restoredNavigation.navigation.screen)
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | undefined>(restoredNavigation.navigation.collectionId)
  const [resultRunId, setResultRunId] = useState<string | undefined>(restoredNavigation.navigation.runId)
  const [importDraft, setImportDraft] = useState<string | undefined>(restoredNavigation.navigation.importDraft)
  const [swapColumns, setSwapColumns] = useState(restoredNavigation.navigation.swapColumns ?? false)
  const [selectedMode, setSelectedMode] = useState<RankingMode>(restoredNavigation.navigation.selectedMode ?? 'balanced')
  const [trackReviewAlbumId, setTrackReviewAlbumId] = useState<string | undefined>(restoredNavigation.navigation.trackReviewAlbumId)
  const client = useMemo(() => new MusicBrainzClient(), [])
  const selectedCollection = state.collections.find((collection) => collection.id === selectedCollectionId)

  useEffect(() => {
    if (restoredNavigation.invalid) showNotice('That restored page was no longer valid, so Solitude returned to your library.')
  }, [restoredNavigation.invalid])

  useEffect(() => {
    saveNavigation({
      version: 1,
      screen,
      collectionId: screen === 'library' ? undefined : selectedCollectionId,
      runId: screen === 'battle' ? selectedCollection?.activeRun?.id : (screen === 'results' || screen === 'track-review') ? resultRunId : undefined,
      importDraft,
      swapColumns,
      selectedMode,
      trackReviewAlbumId,
    })
  }, [importDraft, resultRunId, screen, selectedCollection?.activeRun?.id, selectedCollectionId, selectedMode, swapColumns, trackReviewAlbumId])

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
    const collection = state.collections.find((candidate) => candidate.id === id)
    setSelectedCollectionId(id)
    setState((current) => ({ ...current, currentCollectionId: id }))
    setResultRunId(undefined)
    if (nextScreen === 'import') {
      setImportDraft(collection?.albums.map((album) => `${album.title} - ${album.artist}`).join('\n') ?? '')
      setSwapColumns(false)
    }
    if (nextScreen === 'mode') setSelectedMode('balanced')
    setScreen(nextScreen)
  }

  const createCollection = (name: string, vibe?: string, note?: string) => {
    const timestamp = nowIso()
    const collection: Collection = { id: makeId('collection'), name, vibe, note, albums: [], createdAt: timestamp, updatedAt: timestamp, completedRuns: [] }
    setState((current) => ({ ...current, collections: [...current.collections, collection], currentCollectionId: collection.id }))
    setSelectedCollectionId(collection.id)
    setImportDraft('')
    setSwapColumns(false)
    setScreen('import')
  }

  const startRun = (mode: RankingMode) => {
    if (!selectedCollection) return
    const timestamp = nowIso()
    const run: BattleRun = {
      id: makeId('run'), mode, seed: makeSeed(), algorithmVersion: BATTLE_ALGORITHM_VERSION, decisions: [], status: 'active', createdAt: timestamp, updatedAt: timestamp, paceSamples: [], sliderWeight: DEFAULT_HEART_WEIGHT,
    }
    updateCollection(selectedCollection.id, (collection) => ({ ...collection, activeRun: run, updatedAt: timestamp }))
    setScreen('battle')
  }

  const chooseAlbum = (winnerId: string, loserId: string, outcome: NonNullable<BattleDecision['outcome']>, durationMs: number, pageVisible: boolean) => {
    if (!selectedCollection?.activeRun) return
    const currentRun = selectedCollection.activeRun
    const timestamp = nowIso()
    const decision: BattleDecision = { winnerId, loserId, outcome, durationMs, chosenAt: timestamp }
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
          const completedRun: BattleRun = { ...nextRun, status: 'completed', completedAt: timestamp, finalRanking: nextBattle.ranking, heartScores: nextBattle.heartScores, albumSnapshot: selectedCollection.albums.map((album) => ({ ...album })) }
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
    if (!selectedCollection || !resultRun || resultRun.algorithmVersion !== BATTLE_ALGORITHM_VERSION || !resultRun.decisions.length) return
    const timestamp = nowIso()
    const activeRun: BattleRun = {
      ...resultRun,
      status: 'active',
      completedAt: undefined,
      finalRanking: undefined,
      heartScores: undefined,
      trackAnalysis: undefined,
      albumSnapshot: undefined,
      decisions: resultRun.decisions.slice(0, -1),
      updatedAt: timestamp,
    }
    updateCollection(selectedCollection.id, (collection) => ({
      ...collection,
      activeRun,
      completedRuns: collection.completedRuns.filter((run) => run.id !== resultRun.id),
      updatedAt: timestamp,
    }))
    setResultRunId(undefined)
    setScreen('battle')
  }

  const openTrackReview = () => {
    if (!resultRun || !selectedCollection) return
    const albums = resultRun.albumSnapshot ?? selectedCollection.albums
    const validCurrent = albums.some((album) => album.id === trackReviewAlbumId)
    const firstUnreviewed = albums.find((album) => state.trackProfiles[albumProfileKey(album)]?.reviewState !== 'reviewed')
    setTrackReviewAlbumId(validCurrent ? trackReviewAlbumId : (firstUnreviewed ?? albums[0])?.id)
    setScreen('track-review')
  }

  const commitTrackProfile = (album: Album, profile: AlbumTrackProfile, complete: boolean) => {
    if (!selectedCollection || !resultRun || profile.albumKey !== albumProfileKey(album)) return
    const collectionId = selectedCollection.id
    const runId = resultRun.id
    setState((current) => {
      const trackProfiles = { ...current.trackProfiles, [profile.albumKey]: profile }
      return {
        ...current,
        trackProfiles,
        collections: current.collections.map((collection) => {
          if (collection.id !== collectionId) return collection
          return {
            ...collection,
            completedRuns: collection.completedRuns.map((run) => {
              if (run.id !== runId || !complete) return run
              const albums = run.albumSnapshot ?? collection.albums
              return { ...run, trackAnalysis: buildTrackAnalysisSnapshot(albums, trackProfiles), updatedAt: nowIso() }
            }),
            updatedAt: nowIso(),
          }
        }),
      }
    })
    if (complete) setScreen('results')
  }

  const updateResultWeight = (weight: number) => {
    if (!selectedCollection || !resultRun) return
    updateCollection(selectedCollection.id, (collection) => ({
      ...collection,
      completedRuns: collection.completedRuns.map((run) => run.id === resultRun.id ? { ...run, sliderWeight: weight, updatedAt: nowIso() } : run),
      updatedAt: nowIso(),
    }))
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
        onViewRun={(collectionId, runId) => { setSelectedCollectionId(collectionId); setState((current) => ({ ...current, currentCollectionId: collectionId })); setResultRunId(runId); setScreen('results') }}
      />
    )
  } else if (!selectedCollection) {
    content = <div className="page constrained-page"><h1>Collection not found</h1><button className="button" type="button" onClick={goHome}>Return to library</button></div>
  } else if (screen === 'import') {
    content = <ImportScreen collection={selectedCollection} initialDraft={importDraft} initialSwapColumns={swapColumns} onDraftChange={(draft, swap) => { setImportDraft(draft); setSwapColumns(swap) }} onBack={goHome} onContinue={(albums) => { updateCollection(selectedCollection.id, (collection) => ({ ...collection, albums, activeRun: undefined, updatedAt: nowIso() })); setScreen('review') }} />
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
    content = <ModeScreen collection={selectedCollection} paceSamples={state.learnedPaceSamples} selected={selectedMode} onSelected={setSelectedMode} onBack={() => setScreen('review')} onStart={startRun} />
  } else if (screen === 'battle' && selectedCollection.activeRun) {
    content = <BattleScreen collection={selectedCollection} run={selectedCollection.activeRun} paceSamples={state.learnedPaceSamples} onChoose={chooseAlbum} onUndo={undoActive} onRestart={() => { if (window.confirm('Restart this run? Your saved choices from this run will be cleared.')) startRun(selectedCollection.activeRun!.mode) }} onExit={goHome} />
  } else if (screen === 'results' && resultRun) {
    content = <ResultsScreen collection={selectedCollection} run={resultRun} onHome={goHome} onAgain={() => setScreen('mode')} onUndo={undoCompleted} onTrackReview={openTrackReview} onWeightChange={updateResultWeight} />
  } else if (screen === 'track-review' && resultRun) {
    content = <TrackReviewScreen collection={selectedCollection} run={resultRun} client={client} profiles={state.trackProfiles} currentAlbumId={trackReviewAlbumId} onCurrentAlbum={setTrackReviewAlbumId} onCommit={commitTrackProfile} onExit={() => setScreen('results')} />
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
