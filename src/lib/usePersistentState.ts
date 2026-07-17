import { useEffect, useState } from 'react'
import { loadState, saveState } from './storage'
import type { StoredStateV2 } from './types'

export function usePersistentState(): {
  state: StoredStateV2
  setState: React.Dispatch<React.SetStateAction<StoredStateV2>>
  notice?: string
  clearNotice: () => void
  showNotice: (message: string) => void
} {
  const [loaded] = useState(() => loadState())
  const [state, setState] = useState(loaded.state)
  const [notice, setNotice] = useState<string | undefined>(
    loaded.recovered ? 'Stored data was unreadable, so Solitude opened a fresh library.' : loaded.notice,
  )

  useEffect(() => {
    const result = saveState(state)
    if (!result.ok) setNotice('Your latest change could not be saved. Browser storage may be full or unavailable.')
  }, [state])

  return {
    state,
    setState,
    notice,
    clearNotice: () => setNotice(undefined),
    showNotice: (message) => setNotice(message),
  }
}
